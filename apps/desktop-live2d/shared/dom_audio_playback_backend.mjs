import {
  AUDIO_PLAYBACK_RUNTIME_MODE,
  AudioPlaybackAbortedError,
  AudioPlaybackContractError
} from "./audio_playback_contracts.mjs";
import { decodeBase64AudioBytes } from "./audio_byte_utils.mjs";
import { analyzeAudioFragmentsForLipsync } from "./audio_lipsync_analyzer.mjs";

function rejectIfAborted(signal) {
  if (signal?.aborted) {
    throw new AudioPlaybackAbortedError();
  }
}

function defaultAudioContextFactory() {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof AudioContextCtor !== "function") {
    throw new AudioPlaybackContractError(
      "desktop-live2d real audio backend requires AudioContext"
    );
  }
  return new AudioContextCtor();
}

function decodePcm16leToFloat32(audioBytes) {
  if (audioBytes.byteLength % 2 !== 0) {
    throw new AudioPlaybackContractError(
      "desktop-live2d realtime PCM chunk must contain an even number of bytes"
    );
  }
  const sampleCount = audioBytes.byteLength / 2;
  const samples = new Float32Array(sampleCount);
  const view = new DataView(
    audioBytes.buffer,
    audioBytes.byteOffset,
    audioBytes.byteLength
  );
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return Object.freeze({
    promise,
    resolve,
    reject
  });
}

function scheduleLipsyncFrames(session, frames, startAtSeconds) {
  if (typeof session.on_lipsync_frame !== "function" || frames.length === 0) {
    return;
  }
  let offsetMs = 0;
  for (const frame of frames) {
    const timerDelayMs = Math.max(
      0,
      Math.round(((startAtSeconds - session.audio_context.currentTime) * 1000) + offsetMs)
    );
    const timerHandle = setTimeout(() => {
      if (session.finished || session.signal?.aborted) {
        return;
      }
      void session.on_lipsync_frame(frame);
    }, timerDelayMs);
    session.lipsync_timers.add(timerHandle);
    offsetMs += frame.window_duration_ms;
  }
}

function cleanupLipsyncTimers(session) {
  for (const timerHandle of session.lipsync_timers) {
    clearTimeout(timerHandle);
  }
  session.lipsync_timers.clear();
}

export class DesktopLive2DDeviceAudioPlaybackBackend {
  constructor({
    backendKey = "desktop.live2d.audio.device",
    audioContextFactory = defaultAudioContextFactory
  } = {}) {
    this._descriptor = Object.freeze({
      backend_key: backendKey,
      runtime_mode: AUDIO_PLAYBACK_RUNTIME_MODE.DEVICE_AUDIO,
      supports_device_audio_output: true
    });
    this._audioContextFactory = audioContextFactory;
    this._audioContext = null;
    this._activeSession = null;
  }

  getDescriptor() {
    return this._descriptor;
  }

  async startStreamSession({
    sampleRateHz,
    channelCount,
    mediaType,
    prebufferMs = 160,
    outputDelayMs = 0,
    signal = null,
    onLipsyncFrame = null
  } = {}) {
    if (this._activeSession !== null) {
      throw new AudioPlaybackContractError(
        "desktop-live2d real audio backend already has an active stream session"
      );
    }
    if (mediaType !== "audio/pcm;encoding=s16le") {
      throw new AudioPlaybackContractError(
        "desktop-live2d realtime audio backend only supports PCM S16LE streaming"
      );
    }
    if (sampleRateHz !== 24000) {
      throw new AudioPlaybackContractError(
        "desktop-live2d realtime audio backend requires 24000Hz PCM streaming"
      );
    }
    if (channelCount !== 1) {
      throw new AudioPlaybackContractError(
        "desktop-live2d realtime audio backend requires mono PCM streaming"
      );
    }
    rejectIfAborted(signal);
    if (this._audioContext === null) {
      this._audioContext = this._audioContextFactory();
    }
    if (this._audioContext.state === "suspended") {
      await this._audioContext.resume();
    }
    const completion = createDeferred();
    const session = {
      audio_context: this._audioContext,
      sample_rate_hz: sampleRateHz,
      prebuffer_ms: Math.max(20, Math.floor(prebufferMs)),
      output_delay_ms: Math.max(0, Math.floor(outputDelayMs)),
      signal,
      on_lipsync_frame: onLipsyncFrame,
      pending_segments: [],
      pending_sample_count: 0,
      inflight_count: 0,
      active_sources: new Set(),
      lipsync_timers: new Set(),
      playback_started: false,
      stream_ended: false,
      finished: false,
      fragment_count: 0,
      lipsync_frame_count: 0,
      next_start_time: 0,
      completion
    };
    this._activeSession = session;
    if (signal) {
      const onAbort = () => {
        this.#abortSession(session);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      session.abort_listener = onAbort;
    }
    return session;
  }

  async appendStreamFragment(session, fragment) {
    if (this._activeSession !== session || session.finished) {
      throw new AudioPlaybackAbortedError(
        "desktop-live2d realtime session is no longer active"
      );
    }
    rejectIfAborted(session.signal);
    const audioBytes = decodeBase64AudioBytes(fragment.audio_bytes_base64);
    const samples = decodePcm16leToFloat32(audioBytes);
    const lipsyncFrames = analyzeAudioFragmentsForLipsync([fragment]);
    session.pending_segments.push({
      samples,
      duration_sec: samples.length / session.sample_rate_hz,
      lipsync_frames: lipsyncFrames
    });
    session.pending_sample_count += samples.length;
    session.fragment_count += 1;
    session.lipsync_frame_count += lipsyncFrames.length;
    const shouldStart =
      !session.playback_started
      && (
        (session.pending_sample_count / session.sample_rate_hz) * 1000
        >= session.prebuffer_ms
        || fragment.is_final
      );
    if (shouldStart) {
      session.playback_started = true;
      const outputDelaySec = session.output_delay_ms / 1000;
      session.next_start_time = Math.max(
        session.audio_context.currentTime + 0.025 + outputDelaySec,
        session.audio_context.currentTime
      );
    }
    if (session.playback_started) {
      this.#schedulePendingSegments(session);
    }
    return Object.freeze({
      started_playback: shouldStart
    });
  }

  async endStreamSession(session) {
    if (this._activeSession !== session || session.finished) {
      throw new AudioPlaybackAbortedError(
        "desktop-live2d realtime session is no longer active"
      );
    }
    session.stream_ended = true;
    if (!session.playback_started && session.pending_segments.length > 0) {
      session.playback_started = true;
      session.next_start_time = Math.max(
        session.audio_context.currentTime + 0.025,
        session.audio_context.currentTime
      );
      this.#schedulePendingSegments(session);
    }
    this.#maybeFinishSession(session);
    return await session.completion.promise;
  }

  async playBufferedFragments(
    fragments,
    {
      onLipsyncFrame = null,
      signal = null
    } = {}
  ) {
    if (!Array.isArray(fragments) || fragments.length === 0) {
      throw new AudioPlaybackContractError(
        "desktop-live2d realtime audio backend requires at least one fragment"
      );
    }
    const session = await this.startStreamSession({
      sampleRateHz: fragments[0].sample_rate_hz,
      channelCount: fragments[0].channel_count,
      mediaType: fragments[0].media_type,
      prebufferMs: 20,
      signal,
      onLipsyncFrame
    });
    for (const fragment of fragments) {
      await this.appendStreamFragment(session, fragment);
    }
    return await this.endStreamSession(session);
  }

  async destroy() {
    if (this._activeSession !== null) {
      this.#abortSession(this._activeSession);
      try {
        await this._activeSession.completion.promise;
      } catch {}
    }
    if (this._audioContext !== null && typeof this._audioContext.close === "function") {
      await this._audioContext.close();
      this._audioContext = null;
    }
  }

  #schedulePendingSegments(session) {
    while (session.pending_segments.length > 0 && !session.finished) {
      const segment = session.pending_segments.shift();
      session.pending_sample_count -= segment.samples.length;
      const buffer = session.audio_context.createBuffer(
        1,
        segment.samples.length,
        session.sample_rate_hz
      );
      buffer.copyToChannel(segment.samples, 0);
      const source = session.audio_context.createBufferSource();
      source.buffer = buffer;
      source.connect(session.audio_context.destination);
      const startAt = Math.max(
        session.next_start_time,
        session.audio_context.currentTime + 0.01
      );
      session.next_start_time = startAt + segment.duration_sec;
      session.inflight_count += 1;
      session.active_sources.add(source);
      source.onended = () => {
        if (session.finished) {
          return;
        }
        session.inflight_count = Math.max(0, session.inflight_count - 1);
        session.active_sources.delete(source);
        this.#maybeFinishSession(session);
      };
      scheduleLipsyncFrames(session, segment.lipsync_frames, startAt);
      source.start(startAt);
    }
  }

  #maybeFinishSession(session) {
    if (
      session.finished
      || !session.stream_ended
      || session.pending_segments.length > 0
      || session.inflight_count > 0
    ) {
      return;
    }
    session.finished = true;
    cleanupLipsyncTimers(session);
    if (session.abort_listener) {
      session.signal?.removeEventListener("abort", session.abort_listener);
    }
    this._activeSession = null;
    session.completion.resolve(
      Object.freeze({
        playback_duration_ms: Math.max(
          10,
          Math.round(
            Math.max(0, session.next_start_time - session.audio_context.currentTime) * 1000
          )
        ),
        fragment_count: session.fragment_count,
        lipsync_frame_count: session.lipsync_frame_count
      })
    );
  }

  #abortSession(session) {
    if (session.finished) {
      return;
    }
    session.finished = true;
    cleanupLipsyncTimers(session);
    for (const source of session.active_sources) {
      try {
        source.stop();
      } catch {}
    }
    session.active_sources.clear();
    if (session.abort_listener) {
      session.signal?.removeEventListener("abort", session.abort_listener);
    }
    this._activeSession = null;
    session.completion.reject(new AudioPlaybackAbortedError());
  }
}
