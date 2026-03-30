import {
  AudioPlaybackAbortedError,
  AUDIO_PLAYBACK_RUNTIME_MODE,
  estimatePlaybackDurationMs
} from "./audio_playback_contracts.mjs";
import { analyzeAudioFragmentsForLipsync } from "./audio_lipsync_analyzer.mjs";

function wait(ms, signal = null) {
  if (signal?.aborted) {
    throw new AudioPlaybackAbortedError();
  }
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      if (cleanup) {
        cleanup();
      }
      resolve();
    }, ms);
    let cleanup = null;
    if (signal) {
      const onAbort = () => {
        clearTimeout(timeoutHandle);
        signal.removeEventListener("abort", onAbort);
        reject(new AudioPlaybackAbortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };
    }
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  promise.catch(() => {});
  return Object.freeze({
    promise,
    resolve,
    reject
  });
}

function wakeWaiter(session) {
  if (session.waiter) {
    session.waiter();
    session.waiter = null;
  }
}

export class HeadlessAudioPlaybackBackend {
  constructor({
    backendKey = "desktop.live2d.audio.headless",
    maxPlaybackDurationMs = 320
  } = {}) {
    this._descriptor = Object.freeze({
      backend_key: backendKey,
      runtime_mode: AUDIO_PLAYBACK_RUNTIME_MODE.HEADLESS,
      supports_device_audio_output: false
    });
    this._maxPlaybackDurationMs = maxPlaybackDurationMs;
    this._activeSession = null;
  }

  getDescriptor() {
    return this._descriptor;
  }

  async startStreamSession({
    prebufferMs = 160,
    signal = null,
    onLipsyncFrame = null
  } = {}) {
    if (this._activeSession !== null) {
      throw new AudioPlaybackAbortedError(
        "desktop-live2d headless backend already has an active stream session"
      );
    }
    const deferred = createDeferred();
    const session = {
      prebuffer_ms: Math.max(20, Math.floor(prebufferMs)),
      signal,
      on_lipsync_frame: onLipsyncFrame,
      buffered_duration_ms: 0,
      fragment_count: 0,
      lipsync_frame_count: 0,
      stream_ended: false,
      playback_started: false,
      fragments: [],
      pending_fragments: [],
      waiter: null,
      finished: false,
      runner_promise: null,
      completion: deferred
    };
    this._activeSession = session;
    return session;
  }

  async appendStreamFragment(session, fragment) {
    if (this._activeSession !== session || session.finished) {
      throw new AudioPlaybackAbortedError(
        "desktop-live2d headless backend stream session is no longer active"
      );
    }
    if (session.signal?.aborted) {
      throw new AudioPlaybackAbortedError();
    }
    session.fragments.push(fragment);
    session.pending_fragments.push(fragment);
    session.fragment_count += 1;
    session.buffered_duration_ms += estimatePlaybackDurationMs({
      audioByteLength: fragment.audio_byte_length,
      sampleRateHz: fragment.sample_rate_hz,
      channelCount: fragment.channel_count,
      mediaType: fragment.media_type
    });
    const shouldStart =
      !session.playback_started
      && (session.buffered_duration_ms >= session.prebuffer_ms || fragment.is_final);
    if (shouldStart) {
      session.playback_started = true;
      this.#ensureStreamRunner(session);
    }
    wakeWaiter(session);
    return Object.freeze({
      started_playback: shouldStart
    });
  }

  async endStreamSession(session) {
    if (this._activeSession !== session) {
      if (session.finished) {
        return await session.completion.promise;
      }
      throw new AudioPlaybackAbortedError(
        "desktop-live2d headless backend stream session is no longer active"
      );
    }
    if (session.finished) {
      return await session.completion.promise;
    }
    session.stream_ended = true;
    if (!session.playback_started && session.fragments.length > 0) {
      session.playback_started = true;
      this.#ensureStreamRunner(session);
    }
    wakeWaiter(session);
    return await session.completion.promise;
  }

  async playBufferedFragments(
    fragments,
    {
      onLipsyncFrame = null,
      signal = null
    } = {}
  ) {
    const session = await this.startStreamSession({
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
    if (this._activeSession !== null && !this._activeSession.finished) {
      this._activeSession.completion.reject(new AudioPlaybackAbortedError());
      this._activeSession.finished = true;
      wakeWaiter(this._activeSession);
      this._activeSession = null;
    }
  }

  #ensureStreamRunner(session) {
    if (session.runner_promise !== null) {
      return session.runner_promise;
    }
    session.runner_promise = this.#runStreamSession(session);
    return session.runner_promise;
  }

  async #runStreamSession(session) {
    try {
      let simulatedDurationMs = 0;
      while (true) {
        if (session.signal?.aborted) {
          throw new AudioPlaybackAbortedError();
        }
        if (session.pending_fragments.length === 0) {
          if (session.stream_ended) {
            break;
          }
          await new Promise((resolve, reject) => {
            session.waiter = resolve;
            if (session.signal) {
              const onAbort = () => {
                session.signal.removeEventListener("abort", onAbort);
                reject(new AudioPlaybackAbortedError());
              };
              session.signal.addEventListener("abort", onAbort, { once: true });
            }
          });
          continue;
        }
        const fragment = session.pending_fragments.shift();
        const lipsyncFrames = analyzeAudioFragmentsForLipsync([fragment]);
        session.lipsync_frame_count += lipsyncFrames.length;
        for (const frame of lipsyncFrames) {
          if (typeof session.on_lipsync_frame === "function") {
            await session.on_lipsync_frame(frame);
          }
          simulatedDurationMs += frame.window_duration_ms;
          await wait(frame.window_duration_ms, session.signal);
        }
        if (lipsyncFrames.length === 0) {
          const durationMs = estimatePlaybackDurationMs({
            audioByteLength: fragment.audio_byte_length,
            sampleRateHz: fragment.sample_rate_hz,
            channelCount: fragment.channel_count,
            mediaType: fragment.media_type
          });
          simulatedDurationMs += durationMs;
          await wait(durationMs, session.signal);
        }
      }
      const boundedDurationMs = Math.max(
        10,
        Math.min(
          this._maxPlaybackDurationMs,
          Math.max(10, simulatedDurationMs)
        )
      );
      session.finished = true;
      this._activeSession = null;
      session.completion.resolve(
        Object.freeze({
          playback_duration_ms: boundedDurationMs,
          fragment_count: session.fragment_count,
          lipsync_frame_count: session.lipsync_frame_count
        })
      );
    } catch (error) {
      session.finished = true;
      this._activeSession = null;
      session.completion.reject(error);
    } finally {
      session.runner_promise = null;
    }
  }
}
