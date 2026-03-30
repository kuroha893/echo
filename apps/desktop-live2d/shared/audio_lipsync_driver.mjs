import {
  AUDIO_LIPSYNC_SOURCE,
  buildAudioLipsyncSnapshot
} from "./audio_lipsync_contracts.mjs";

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class DesktopLive2DAudioLipsyncDriver {
  constructor({
    sceneController,
    waitForFrame = wait
  }) {
    this._sceneController = sceneController;
    this._waitForFrame = waitForFrame;
    this._frameHistory = [];
    this._snapshot = buildAudioLipsyncSnapshot();
  }

  getSnapshot() {
    return this._snapshot;
  }

  getFrameHistory() {
    return Object.freeze(this._frameHistory.slice());
  }

  async applyPlaybackFrame(frame) {
    const sceneSnapshot = await this._sceneController.applyAudioLipsyncFrame({
      source: AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK,
      mouthOpen: frame.mouth_open
    });
    this._frameHistory.push(
      Object.freeze({
        frame_index: frame.frame_index,
        mouth_open: frame.mouth_open,
        root_mean_square: frame.root_mean_square,
        peak_amplitude: frame.peak_amplitude,
        window_duration_ms: frame.window_duration_ms,
        scene_mouth_open: sceneSnapshot.mouth_open
      })
    );
    const peak = Math.max(
      this._snapshot.peak_mouth_open,
      ...this._frameHistory.map((item) => item.mouth_open)
    );
    const totalDurationMs = this._frameHistory.reduce(
      (total, item) => total + item.window_duration_ms,
      0
    );
    this._snapshot = buildAudioLipsyncSnapshot({
      source: AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK,
      lipsyncActive: true,
      currentMouthOpen: frame.mouth_open,
      peakMouthOpen: peak,
      frameCount: this._frameHistory.length,
      totalAnalyzedDurationMs: totalDurationMs
    });
    return sceneSnapshot;
  }

  async drivePlaybackFrames(frames, { waitBetweenFrames = true } = {}) {
    if (!Array.isArray(frames) || frames.length === 0) {
      await this.reset();
      return this._snapshot;
    }

    let peak = 0;
    let totalDurationMs = 0;
    this._frameHistory = [];
    this._snapshot = buildAudioLipsyncSnapshot({
      source: AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK,
      lipsyncActive: true,
      currentMouthOpen: 0,
      peakMouthOpen: 0,
      frameCount: 0,
      totalAnalyzedDurationMs: 0
    });

    for (const frame of frames) {
      peak = Math.max(peak, frame.mouth_open);
      totalDurationMs += frame.window_duration_ms;
      await this.applyPlaybackFrame(frame);
      if (waitBetweenFrames) {
        await this._waitForFrame(frame.window_duration_ms);
      }
    }
    await this.reset({
      peakMouthOpen: peak,
      frameCount: this._frameHistory.length,
      totalAnalyzedDurationMs: totalDurationMs
    });
    return this._snapshot;
  }

  async reset({
    peakMouthOpen = this._snapshot.peak_mouth_open,
    frameCount = this._snapshot.frame_count,
    totalAnalyzedDurationMs = this._snapshot.total_analyzed_duration_ms
  } = {}) {
    await this._sceneController.clearAudioLipsync({
      source: AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK
    });
    this._snapshot = buildAudioLipsyncSnapshot({
      source: AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK,
      lipsyncActive: false,
      currentMouthOpen: 0,
      peakMouthOpen,
      frameCount,
      totalAnalyzedDurationMs
    });
    return this._snapshot;
  }
}
