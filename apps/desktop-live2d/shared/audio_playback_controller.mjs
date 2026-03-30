import {
  AUDIO_PLAYBACK_REPORT_KIND,
  AudioPlaybackAbortedError,
  AudioPlaybackContractError,
  buildAudioPlaybackReport,
  buildAudioPlaybackSnapshot,
  normalizeAudioPlaybackAbortRequest,
  normalizeAudioPlaybackFragmentRequest
} from "./audio_playback_contracts.mjs";
import { getBase64DecodedByteLength } from "./audio_byte_utils.mjs";
import { HeadlessAudioPlaybackBackend } from "./headless_audio_playback_backend.mjs";

const DEFAULT_STREAM_PREBUFFER_MS = 160;
const DEFAULT_LIPSYNC_HANDOFF_GRACE_MS = 180;
const LIPSYNC_ACTIVE_ENERGY_MIN = 0.018;
const LIPSYNC_BASELINE_OPEN_ALPHA = 0.032;
const LIPSYNC_VARIANCE_OPEN_GAIN_MIN = 3.0;
const LIPSYNC_VARIANCE_OPEN_GAIN_MAX = 4.0;
const LIPSYNC_VARIANCE_OPEN_NEGATIVE_GAIN = 0.9;
const LIPSYNC_SPEAKING_OPEN_FLOOR_RATIO = 0.22;
const LIPSYNC_OPEN_DEADZONE_ENTER = 0.09;
const LIPSYNC_OPEN_DEADZONE_EXIT = 0.11;
const LIPSYNC_ATTACK_ALPHA = 0.42;
const LIPSYNC_RELEASE_ALPHA = 0.26;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, alpha) {
  return start + ((end - start) * alpha);
}

function decodeAudioByteLength(base64Value) {
  return getBase64DecodedByteLength(base64Value);
}

function buildJobKey({ tts_stream_id, chunk_index }) {
  return `${tts_stream_id}:${chunk_index}`;
}

export class DesktopLive2DAudioPlaybackController {
  constructor({
    backend = null,
    lipsyncDriver = null,
    lipsyncHandoffGraceMs = DEFAULT_LIPSYNC_HANDOFF_GRACE_MS
  } = {}) {
    this._backend = backend || new HeadlessAudioPlaybackBackend();
    this._lipsyncDriver = lipsyncDriver;
    this._lipsyncHandoffGraceMs = Math.max(0, Math.floor(lipsyncHandoffGraceMs));
    this._activeJob = null;
    this._activePlayback = null;
    this._activeLipsyncTurnId = null;
    this._pendingLipsyncSettlement = null;
    this._lipsyncEnhancerState = this.#buildInitialLipsyncEnhancerState();
    this._lastSnapshot = buildAudioPlaybackSnapshot();
  }

  getBackendDescriptor() {
    return this._backend.getDescriptor();
  }

  getSnapshot() {
    return this._lastSnapshot;
  }

  async deliverFragment(rawRequest) {
    const request = normalizeAudioPlaybackFragmentRequest(rawRequest);
    await this.#prepareLipsyncTurn(request.turn_id);
    const reports = [];
    const job = await this.#getOrCreateMatchingJob(request);
    this.#validateFragmentSequence(job, request);
    const fragment = {
      fragment_index: request.fragment_index,
      audio_byte_length: decodeAudioByteLength(request.audio_bytes_base64),
      audio_bytes_base64: request.audio_bytes_base64,
      sample_rate_hz: request.sample_rate_hz,
      channel_count: request.channel_count,
      media_type: request.media_type
    };
    job.fragments.push(fragment);
    job.final_fragment_received = request.is_final;

    reports.push(
      buildAudioPlaybackReport({
        reportKind: AUDIO_PLAYBACK_REPORT_KIND.ACCEPTED,
        owner: request.owner,
        sessionId: request.session_id,
        traceId: request.trace_id,
        turnId: request.turn_id,
        ttsStreamId: request.tts_stream_id,
        chunkIndex: request.chunk_index,
        fragmentIndex: request.fragment_index,
        isInterruptible: request.is_interruptible,
        message: "desktop-live2d accepted audio fragment"
      })
    );

    let appendReceipt;
    try {
      appendReceipt = await this._backend.appendStreamFragment(
        job.stream_session,
        {
          ...fragment,
          is_final: request.is_final
        }
      );
    } catch (error) {
      if (
        this._activePlayback &&
        this._activePlayback.job_key === job.job_key
      ) {
        this._activePlayback.abort_controller.abort();
        this._activePlayback = null;
      }
      this._activeJob = null;
      await this.#finalizeLipsyncTurnNow({
        swallowErrors: true
      });
      throw error;
    }
    if (appendReceipt.started_playback && !job.started_report_emitted) {
      job.started_report_emitted = true;
      reports.push(
        buildAudioPlaybackReport({
          reportKind: AUDIO_PLAYBACK_REPORT_KIND.STARTED,
          owner: request.owner,
          sessionId: request.session_id,
          traceId: request.trace_id,
          turnId: request.turn_id,
          ttsStreamId: request.tts_stream_id,
          chunkIndex: request.chunk_index,
          fragmentIndex: request.fragment_index,
          isInterruptible: request.is_interruptible,
          message: "desktop-live2d started realtime audio playback"
        })
      );
    }

    this._lastSnapshot = this.#buildSnapshotForJob({
      job,
      playbackActive: job.started_report_emitted,
      lastReportKind: job.started_report_emitted
        ? AUDIO_PLAYBACK_REPORT_KIND.STARTED
        : AUDIO_PLAYBACK_REPORT_KIND.ACCEPTED,
      lastReason: null
    });

    if (!request.is_final) {
      return Object.freeze({
        playback_snapshot: this._lastSnapshot,
        reports
      });
    }

    try {
      const playbackReceipt = await this._backend.endStreamSession(job.stream_session);
      this.#scheduleLipsyncTurnSettlement(request.turn_id);
      reports.push(
        buildAudioPlaybackReport({
          reportKind: AUDIO_PLAYBACK_REPORT_KIND.FINISHED,
          owner: request.owner,
          sessionId: request.session_id,
          traceId: request.trace_id,
          turnId: request.turn_id,
          ttsStreamId: request.tts_stream_id,
          chunkIndex: request.chunk_index,
          fragmentIndex: request.fragment_index,
          isInterruptible: request.is_interruptible,
          reason: "desktop_playback_completed",
          message: `desktop-live2d finished playback in ${playbackReceipt.playback_duration_ms}ms`
        })
      );
      this._lastSnapshot = buildAudioPlaybackSnapshot({
        lastReportKind: AUDIO_PLAYBACK_REPORT_KIND.FINISHED,
        lastReason: "desktop_playback_completed"
      });
      this._activeJob = null;
      this._activePlayback = null;
      return Object.freeze({
        playback_snapshot: this._lastSnapshot,
        reports
      });
    } catch (error) {
      if (error instanceof AudioPlaybackAbortedError) {
        await this.#finalizeLipsyncTurnNow({
          swallowErrors: true
        });
        return Object.freeze({
          playback_snapshot: this._lastSnapshot,
          reports
        });
      }
      await this.#finalizeLipsyncTurnNow({
        swallowErrors: true
      });
      const reason =
        error instanceof Error ? error.message : "desktop-live2d audio playback failed";
      reports.push(
        buildAudioPlaybackReport({
          reportKind: AUDIO_PLAYBACK_REPORT_KIND.FAILED,
          owner: request.owner,
          sessionId: request.session_id,
          traceId: request.trace_id,
          turnId: request.turn_id,
          ttsStreamId: request.tts_stream_id,
          chunkIndex: request.chunk_index,
          fragmentIndex: request.fragment_index,
          isInterruptible: request.is_interruptible,
          reason: "desktop_playback_failed",
          message: reason
        })
      );
      this._lastSnapshot = buildAudioPlaybackSnapshot({
        lastReportKind: AUDIO_PLAYBACK_REPORT_KIND.FAILED,
        lastReason: "desktop_playback_failed"
      });
      this._activeJob = null;
      this._activePlayback = null;
      return Object.freeze({
        playback_snapshot: this._lastSnapshot,
        reports
      });
    }
  }

  async abortChunk(rawRequest) {
    const request = normalizeAudioPlaybackAbortRequest(rawRequest);
    if (this._activeJob === null) {
      throw new AudioPlaybackContractError(
        "desktop-live2d has no realtime audio playback job to abort"
      );
    }
    const expectedKey = buildJobKey(request);
    if (this._activeJob.job_key !== expectedKey) {
      throw new AudioPlaybackContractError(
        "desktop-live2d cannot abort a different audio playback job than the active one"
      );
    }

    const report = buildAudioPlaybackReport({
      reportKind: AUDIO_PLAYBACK_REPORT_KIND.ABORTED,
      owner: request.owner,
      sessionId: request.session_id,
      traceId: request.trace_id,
      turnId: request.turn_id,
      ttsStreamId: request.tts_stream_id,
      chunkIndex: request.chunk_index,
      fragmentIndex:
        this._activeJob.fragments.length > 0
          ? this._activeJob.fragments[this._activeJob.fragments.length - 1].fragment_index
          : null,
      isInterruptible: this._activeJob.is_interruptible,
      reason: request.reason,
      message: "desktop-live2d aborted realtime audio playback"
    });
    if (
      this._activePlayback &&
      this._activePlayback.job_key === this._activeJob.job_key
    ) {
      this._activePlayback.abort_controller.abort();
      this._activePlayback = null;
    }
    this._activeJob = null;
    await this.#finalizeLipsyncTurnNow({
      swallowErrors: true
    });
    this._lastSnapshot = buildAudioPlaybackSnapshot({
      lastReportKind: AUDIO_PLAYBACK_REPORT_KIND.ABORTED,
      lastReason: request.reason
    });
    return Object.freeze({
      playback_snapshot: this._lastSnapshot,
      reports: [report]
    });
  }

  async destroy() {
    this.#cancelPendingLipsyncSettlement();
    if (this._activePlayback) {
      this._activePlayback.abort_controller.abort();
      this._activePlayback = null;
    }
    this._activeJob = null;
    await this.#finalizeLipsyncTurnNow({
      swallowErrors: true
    });
    await this._backend.destroy();
  }

  async #getOrCreateMatchingJob(request) {
    const jobKey = buildJobKey(request);
    if (this._activeJob === null) {
      const activePlayback = {
        job_key: jobKey,
        abort_controller: new AbortController()
      };
      const streamSession = await this._backend.startStreamSession({
        sampleRateHz: request.sample_rate_hz,
        channelCount: request.channel_count,
        mediaType: request.media_type || "audio/pcm;encoding=s16le",
        prebufferMs: DEFAULT_STREAM_PREBUFFER_MS,
        signal: activePlayback.abort_controller.signal,
        onLipsyncFrame: async (frame) => {
          if (this._lipsyncDriver) {
            await this._lipsyncDriver.applyPlaybackFrame(
              this.#enhancePlaybackFrame(frame)
            );
          }
        }
      });
      const nextJob = {
        job_key: jobKey,
        owner: request.owner,
        session_id: request.session_id,
        trace_id: request.trace_id,
        turn_id: request.turn_id,
        tts_stream_id: request.tts_stream_id,
        chunk_index: request.chunk_index,
        tts_text: request.tts_text,
        is_interruptible: request.is_interruptible,
        fragments: [],
        final_fragment_received: false,
        started_report_emitted: false,
        stream_session: streamSession
      };
      this._activePlayback = activePlayback;
      this._activeJob = nextJob;
      return nextJob;
    }

    if (this._activeJob.job_key !== jobKey) {
      throw new AudioPlaybackContractError(
        "desktop-live2d currently plays only one realtime audio chunk at a time"
      );
    }
    if (
      this._activeJob.session_id !== request.session_id ||
      this._activeJob.trace_id !== request.trace_id ||
      this._activeJob.turn_id !== request.turn_id ||
      this._activeJob.owner !== request.owner
    ) {
      throw new AudioPlaybackContractError(
        "desktop-live2d audio playback metadata must stay stable across one realtime chunk"
      );
    }
    return this._activeJob;
  }

  #validateFragmentSequence(job, request) {
    if (job.final_fragment_received) {
      throw new AudioPlaybackContractError(
        "desktop-live2d received extra audio fragments after final fragment"
      );
    }
    if (job.fragments.length !== request.fragment_index) {
      throw new AudioPlaybackContractError(
        "desktop-live2d audio fragments must arrive in contiguous fragment_index order"
      );
    }
    if (
      job.fragments.length > 0 &&
      job.is_interruptible !== request.is_interruptible
    ) {
      throw new AudioPlaybackContractError(
        "desktop-live2d audio fragments for one chunk must keep a stable interruptible flag"
      );
    }
    if (
      job.fragments.length > 0 &&
      job.fragments[job.fragments.length - 1].sample_rate_hz !== request.sample_rate_hz
    ) {
      throw new AudioPlaybackContractError(
        "desktop-live2d audio fragments for one chunk must keep a stable sample_rate_hz"
      );
    }
    if (
      job.fragments.length > 0 &&
      job.fragments[job.fragments.length - 1].channel_count !== request.channel_count
    ) {
      throw new AudioPlaybackContractError(
        "desktop-live2d audio fragments for one chunk must keep a stable channel_count"
      );
    }
    if (
      job.fragments.length > 0 &&
      job.fragments[job.fragments.length - 1].media_type !== request.media_type
    ) {
      throw new AudioPlaybackContractError(
        "desktop-live2d audio fragments for one chunk must keep a stable media_type"
      );
    }
  }

  #buildSnapshotForJob({
    job,
    playbackActive,
    lastReportKind,
    lastReason
  }) {
    return buildAudioPlaybackSnapshot({
      owner: job.owner,
      sessionId: job.session_id,
      traceId: job.trace_id,
      turnId: job.turn_id,
      ttsStreamId: job.tts_stream_id,
      chunkIndex: job.chunk_index,
      playbackActive,
      bufferedFragmentCount: job.fragments.length,
      finalFragmentReceived: job.final_fragment_received,
      lastReportKind,
      lastReason
    });
  }

  #buildInitialLipsyncEnhancerState() {
    return Object.freeze({
      baseline_mouth_open: 0,
      current_mouth_open: 0,
      deadzone_active: false
    });
  }

  async #prepareLipsyncTurn(turnId) {
    if (this._pendingLipsyncSettlement !== null) {
      if (this._pendingLipsyncSettlement.turn_id === turnId) {
        this.#cancelPendingLipsyncSettlement();
      } else {
        await this.#finalizeLipsyncTurnNow();
      }
    }
    if (this._activeLipsyncTurnId === null) {
      this._activeLipsyncTurnId = turnId;
      this._lipsyncEnhancerState = this.#buildInitialLipsyncEnhancerState();
      return;
    }
    if (this._activeLipsyncTurnId !== turnId) {
      await this.#finalizeLipsyncTurnNow();
      this._activeLipsyncTurnId = turnId;
      this._lipsyncEnhancerState = this.#buildInitialLipsyncEnhancerState();
    }
  }

  #cancelPendingLipsyncSettlement() {
    if (this._pendingLipsyncSettlement === null) {
      return;
    }
    clearTimeout(this._pendingLipsyncSettlement.timer_handle);
    this._pendingLipsyncSettlement = null;
  }

  #scheduleLipsyncTurnSettlement(turnId) {
    if (this._lipsyncDriver === null) {
      this._activeLipsyncTurnId = null;
      this._lipsyncEnhancerState = this.#buildInitialLipsyncEnhancerState();
      return;
    }
    this.#cancelPendingLipsyncSettlement();
    const timerHandle = setTimeout(() => {
      if (
        this._pendingLipsyncSettlement === null
        || this._pendingLipsyncSettlement.turn_id !== turnId
      ) {
        return;
      }
      this._pendingLipsyncSettlement = null;
      void this.#finalizeLipsyncTurnNow().catch((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
    }, this._lipsyncHandoffGraceMs);
    this._pendingLipsyncSettlement = Object.freeze({
      turn_id: turnId,
      timer_handle: timerHandle
    });
  }

  #enhancePlaybackFrame(frame) {
    const rawOpen = clamp(
      Number(frame.raw_mouth_open ?? frame.mouth_open) || 0,
      0,
      1
    );
    const voiceEnergy = clamp(
      Number(
        frame.voice_energy
        ?? Math.max(
          Number(frame.root_mean_square) || 0,
          Number(frame.peak_amplitude) || 0
        )
      ) || 0,
      0,
      1
    );
    const speaking = Boolean(
      frame.speaking
      ?? voiceEnergy >= LIPSYNC_ACTIVE_ENERGY_MIN
    );
    const enhancerState = {
      ...this._lipsyncEnhancerState
    };
    let boostedOpen = rawOpen;

    if (speaking) {
      enhancerState.baseline_mouth_open = clamp(
        lerp(
          enhancerState.baseline_mouth_open,
          rawOpen,
          LIPSYNC_BASELINE_OPEN_ALPHA
        ),
        0,
        1
      );
      const intensity = clamp((voiceEnergy - LIPSYNC_ACTIVE_ENERGY_MIN) / 0.08, 0, 1);
      const openGain = lerp(
        LIPSYNC_VARIANCE_OPEN_GAIN_MIN,
        LIPSYNC_VARIANCE_OPEN_GAIN_MAX,
        intensity
      );
      const openDelta = rawOpen - enhancerState.baseline_mouth_open;
      const positiveOpenDelta = Math.max(0, openDelta) * openGain;
      const negativeOpenDelta = Math.min(0, openDelta) * LIPSYNC_VARIANCE_OPEN_NEGATIVE_GAIN;
      const speakingOpenFloor = clamp(
        enhancerState.baseline_mouth_open * LIPSYNC_SPEAKING_OPEN_FLOOR_RATIO,
        0,
        1
      );
      boostedOpen = clamp(
        Math.max(
          speakingOpenFloor,
          enhancerState.baseline_mouth_open + positiveOpenDelta + negativeOpenDelta
        ),
        0,
        1
      );
    }

    let smoothedOpen = clamp(
      lerp(
        enhancerState.current_mouth_open,
        boostedOpen,
        boostedOpen >= enhancerState.current_mouth_open
          ? LIPSYNC_ATTACK_ALPHA
          : LIPSYNC_RELEASE_ALPHA
      ),
      0,
      1
    );

    if (enhancerState.deadzone_active) {
      if (smoothedOpen >= LIPSYNC_OPEN_DEADZONE_EXIT) {
        enhancerState.deadzone_active = false;
      } else {
        smoothedOpen = 0;
      }
    }

    if (
      !enhancerState.deadzone_active
      && smoothedOpen <= LIPSYNC_OPEN_DEADZONE_ENTER
      && (!speaking || smoothedOpen <= LIPSYNC_OPEN_DEADZONE_EXIT)
    ) {
      enhancerState.deadzone_active = true;
      smoothedOpen = 0;
    }

    enhancerState.current_mouth_open = smoothedOpen;
    this._lipsyncEnhancerState = Object.freeze(enhancerState);

    return Object.freeze({
      ...frame,
      raw_mouth_open: rawOpen,
      mouth_open: smoothedOpen,
      voice_energy: voiceEnergy,
      speaking
    });
  }

  async #finalizeLipsyncTurnNow({
    swallowErrors = false
  } = {}) {
    this.#cancelPendingLipsyncSettlement();
    this._activeLipsyncTurnId = null;
    this._lipsyncEnhancerState = this.#buildInitialLipsyncEnhancerState();
    if (!this._lipsyncDriver) {
      return;
    }
    try {
      await this._lipsyncDriver.reset();
    } catch (error) {
      if (!swallowErrors) {
        throw error;
      }
    }
  }
}
