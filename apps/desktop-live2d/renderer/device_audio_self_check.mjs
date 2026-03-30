import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadModelManifest } from "../bridge/model_assets.mjs";
import { DesktopLive2DAudioPlaybackController } from "../shared/audio_playback_controller.mjs";
import { DesktopLive2DAudioLipsyncDriver } from "../shared/audio_lipsync_driver.mjs";
import { DesktopLive2DDeviceAudioPlaybackBackend } from "../shared/dom_audio_playback_backend.mjs";
import { DesktopLive2DSceneController } from "./scene_controller.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function buildPcmFragmentBase64({ sampleCount, amplitude }) {
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 6) * amplitude * 32767);
    buffer.writeInt16LE(sample, index * 2);
  }
  return buffer.toString("base64");
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class FakeBuffer {
  constructor(length, sampleRate) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._channel = new Float32Array(length);
  }

  copyToChannel(samples) {
    this._channel.set(samples);
  }
}

class FakeBufferSource {
  constructor() {
    this.buffer = null;
    this.onended = null;
  }

  connect() {}

  start(_when = 0) {
    const playbackDurationMs = Math.max(
      1,
      Math.round((this.buffer?.duration || 0) * 1000)
    );
    setTimeout(() => {
      this.onended?.();
    }, playbackDurationMs);
  }

  stop() {
    this.onended?.();
  }
}

class FakeAudioContext {
  constructor({
    sampleRate = 24000
  } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.destination = {};
    this.state = "running";
  }

  createBuffer(_channelCount, length, sampleRate) {
    return new FakeBuffer(length, sampleRate);
  }

  createBufferSource() {
    return new FakeBufferSource();
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

function buildBackend({ playbackDurationMs = 60 } = {}) {
  return new DesktopLive2DDeviceAudioPlaybackBackend({
    audioContextFactory: () => new FakeAudioContext({
      sampleRate: 24000,
      playbackDurationMs
    })
  });
}

async function buildSceneController() {
  const manifest = await loadModelManifest({
    workspaceRoot,
    modelAsset: {
      model_key: "demo-fullbody",
      repo_relative_model_json_path:
        "apps/desktop-live2d/assets/models/demo-fullbody/model3.json",
      display_name: "Demo Full-Body Character",
      presentation_mode: "full_body",
      window_surface: "character_window"
    }
  });
  const sceneController = new DesktopLive2DSceneController();
  await sceneController.initialize(manifest);
  return sceneController;
}

async function runFinishedPlaybackCheck() {
  const sceneController = await buildSceneController();
  const expressionReceipt = await sceneController.dispatchCommand({
    command_id: "expression-before-device-playback",
    command_type: "set_expression",
    target: "expression",
    value: "smile",
    is_interruptible: true
  });
  assert.equal(expressionReceipt.snapshot.active_expression, "smile");

  const lipsyncDriver = new DesktopLive2DAudioLipsyncDriver({
    sceneController,
    waitForFrame: async () => {}
  });
  const playbackController = new DesktopLive2DAudioPlaybackController({
    backend: buildBackend(),
    lipsyncDriver
  });

  assert.equal(
    playbackController.getBackendDescriptor().supports_device_audio_output,
    true
  );

  const sessionId = randomUUID();
  const traceId = randomUUID();
  const turnId = randomUUID();
  const streamId = randomUUID();

  const accepted = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "device backend self-check",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 480,
      amplitude: 0.0
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });
  assert.deepEqual(
    accepted.reports.map((item) => item.report_kind),
    ["accepted"]
  );

  const finished = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "device backend self-check",
    is_interruptible: true,
    fragment_index: 1,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 2400,
      amplitude: 0.72
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });

  assert.deepEqual(
    finished.reports.map((item) => item.report_kind),
    ["accepted", "started", "finished"]
  );
  assert.equal(finished.playback_snapshot.last_report_kind, "finished");
  assert.ok(lipsyncDriver.getFrameHistory().some((frame) => frame.mouth_open > 0.05));

  const motionReceipt = await sceneController.dispatchCommand({
    command_id: "motion-after-device-playback",
    command_type: "set_motion",
    target: "motion",
    value: "nod",
    is_interruptible: true
  });
  assert.equal(motionReceipt.snapshot.last_motion, "nod");

  await playbackController.destroy();
  await sceneController.destroy();
}

async function runAbortPlaybackCheck() {
  const sceneController = await buildSceneController();
  const playbackController = new DesktopLive2DAudioPlaybackController({
    backend: buildBackend({ playbackDurationMs: 120 }),
    lipsyncDriver: new DesktopLive2DAudioLipsyncDriver({
      sceneController,
      waitForFrame: async () => {}
    })
  });
  const sessionId = randomUUID();
  const traceId = randomUUID();
  const turnId = randomUUID();
  const streamId = randomUUID();

  await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "quick_reaction",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "abort device playback",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 480,
      amplitude: 0.0
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });

  const finishRequestPromise = playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "quick_reaction",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "abort device playback",
    is_interruptible: true,
    fragment_index: 1,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 4800,
      amplitude: 0.5
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });

  await wait(10);
  const abortResult = await playbackController.abortChunk({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "quick_reaction",
    tts_stream_id: streamId,
    chunk_index: 0,
    reason: "device-self-check-abort"
  });
  const finishRequestResult = await finishRequestPromise;

  assert.deepEqual(
    abortResult.reports.map((item) => item.report_kind),
    ["aborted"]
  );
  assert.equal(
    finishRequestResult.playback_snapshot.last_report_kind,
    "aborted"
  );
  assert.deepEqual(
    finishRequestResult.reports.map((item) => item.report_kind),
    ["accepted", "started"]
  );

  await playbackController.destroy();
  await sceneController.destroy();
}

async function runLongStreamingPlaybackCheck() {
  const sceneController = await buildSceneController();
  const lipsyncDriver = new DesktopLive2DAudioLipsyncDriver({
    sceneController,
    waitForFrame: async () => {}
  });
  const playbackController = new DesktopLive2DAudioPlaybackController({
    backend: buildBackend({ playbackDurationMs: 180 }),
    lipsyncDriver
  });
  const sessionId = randomUUID();
  const traceId = randomUUID();
  const turnId = randomUUID();
  const streamId = randomUUID();

  const deliveries = [
    {
      fragment_index: 0,
      is_final: false,
      sample_count: 2048,
      amplitude: 0.24
    },
    {
      fragment_index: 1,
      is_final: false,
      sample_count: 4096,
      amplitude: 0.58
    },
    {
      fragment_index: 2,
      is_final: true,
      sample_count: 4096,
      amplitude: 0.72
    }
  ];

  const results = [];
  for (const delivery of deliveries) {
    results.push(
      await playbackController.deliverFragment({
        session_id: sessionId,
        trace_id: traceId,
        turn_id: turnId,
        owner: "primary_response",
        tts_stream_id: streamId,
        chunk_index: 0,
        tts_text: "long streaming device playback",
        is_interruptible: true,
        fragment_index: delivery.fragment_index,
        audio_bytes_base64: buildPcmFragmentBase64({
          sampleCount: delivery.sample_count,
          amplitude: delivery.amplitude
        }),
        sample_rate_hz: 24000,
        channel_count: 1,
        is_final: delivery.is_final,
        media_type: "audio/pcm;encoding=s16le"
      })
    );
  }

  assert.deepEqual(
    results[0].reports.map((item) => item.report_kind),
    ["accepted"]
  );
  assert.deepEqual(
    results[1].reports.map((item) => item.report_kind),
    ["accepted", "started"]
  );
  assert.deepEqual(
    results[2].reports.map((item) => item.report_kind),
    ["accepted", "finished"]
  );
  assert.ok(lipsyncDriver.getFrameHistory().length >= 3);
  assert.ok(lipsyncDriver.getFrameHistory().some((frame) => frame.mouth_open > 0.12));

  await playbackController.destroy();
  await sceneController.destroy();
}

async function runQuickPrefixHandoffCheck() {
  const sceneController = await buildSceneController();
  const lipsyncDriver = new DesktopLive2DAudioLipsyncDriver({
    sceneController,
    waitForFrame: async () => {}
  });
  const playbackController = new DesktopLive2DAudioPlaybackController({
    backend: buildBackend({ playbackDurationMs: 180 }),
    lipsyncDriver
  });
  const sessionId = randomUUID();
  const traceId = randomUUID();
  const turnId = randomUUID();
  const quickStreamId = randomUUID();
  const primaryStreamId = randomUUID();

  const quickResult = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "quick_reaction",
    tts_stream_id: quickStreamId,
    chunk_index: 0,
    tts_text: "让我来看看",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 2400,
      amplitude: 0.62
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });
  assert.deepEqual(
    quickResult.reports.map((item) => item.report_kind),
    ["accepted", "started", "finished"]
  );
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, true);

  const primaryStarted = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: primaryStreamId,
    chunk_index: 0,
    tts_text: "继续说明答案",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 4096,
      amplitude: 0.58
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });
  assert.deepEqual(
    primaryStarted.reports.map((item) => item.report_kind),
    ["accepted", "started"]
  );
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, true);

  const primaryFinished = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: primaryStreamId,
    chunk_index: 0,
    tts_text: "继续说明答案",
    is_interruptible: true,
    fragment_index: 1,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 4096,
      amplitude: 0.72
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });
  assert.deepEqual(
    primaryFinished.reports.map((item) => item.report_kind),
    ["accepted", "finished"]
  );
  assert.ok(lipsyncDriver.getFrameHistory().some((frame) => frame.mouth_open > 0.15));

  await wait(220);
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, false);

  await playbackController.destroy();
  await sceneController.destroy();
}

async function run() {
  await runFinishedPlaybackCheck();
  await runAbortPlaybackCheck();
  await runLongStreamingPlaybackCheck();
  await runQuickPrefixHandoffCheck();
  process.stdout.write("desktop-live2d device audio self-check passed\n");
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
