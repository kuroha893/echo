import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadModelManifest } from "../bridge/model_assets.mjs";
import { DesktopLive2DAudioLipsyncDriver } from "../shared/audio_lipsync_driver.mjs";
import { HeadlessAudioPlaybackBackend } from "../shared/headless_audio_playback_backend.mjs";
import { DesktopLive2DAudioPlaybackController } from "../shared/audio_playback_controller.mjs";
import { DesktopLive2DSceneController } from "./scene_controller.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function buildPcmFragmentBase64({
  sampleCount,
  amplitude
}) {
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

async function buildSceneController() {
  const manifest = await loadModelManifest({
    workspaceRoot,
    modelAsset: {
      model_key: "open-yachiyo-kaguya",
      repo_relative_model_json_path:
        "apps/desktop-live2d/assets/models/open-yachiyo-kaguya/open_yachiyo_kaguya.model3.json",
      display_name: "Open Yachiyo Kaguya",
      presentation_mode: "full_body",
      window_surface: "character_window"
    }
  });

  const sceneController = new DesktopLive2DSceneController();
  await sceneController.initialize(manifest);
  return sceneController;
}

async function buildPlaybackRuntime(sceneController, { maxPlaybackDurationMs = 120 } = {}) {
  const expressionReceipt = await sceneController.dispatchCommand({
    command_id: `expression-before-lipsync-${randomUUID()}`,
    command_type: "set_expression",
    target: "expression",
    value: "smile",
    is_interruptible: true
  });
  assert.equal(expressionReceipt.snapshot.active_expression, "smile");
  assert.equal(expressionReceipt.snapshot.mouth_open, 0);

  const lipsyncDriver = new DesktopLive2DAudioLipsyncDriver({
    sceneController,
    waitForFrame: async () => {}
  });
  const playbackController = new DesktopLive2DAudioPlaybackController({
    backend: new HeadlessAudioPlaybackBackend({
      maxPlaybackDurationMs
    }),
    lipsyncDriver
  });
  return {
    lipsyncDriver,
    playbackController
  };
}

async function runPrimaryPlaybackCheck() {
  const sceneController = await buildSceneController();
  const {
    lipsyncDriver,
    playbackController
  } = await buildPlaybackRuntime(sceneController, {
    maxPlaybackDurationMs: 180
  });

  const sessionId = randomUUID();
  const traceId = randomUUID();
  const turnId = randomUUID();
  const streamId = randomUUID();

  const acceptedResult = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "desktop lipsync self-check",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 480,
      amplitude: 0
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });
  assert.deepEqual(
    acceptedResult.reports.map((item) => item.report_kind),
    ["accepted"]
  );

  const finishedResult = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "desktop lipsync self-check",
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
    finishedResult.reports.map((item) => item.report_kind),
    ["accepted", "started", "finished"]
  );
  assert.equal(finishedResult.playback_snapshot.playback_active, false);

  const frameHistory = lipsyncDriver.getFrameHistory();
  assert.ok(frameHistory.length > 0);
  assert.ok(frameHistory.some((frame) => frame.mouth_open > 0.05));
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, true);

  await wait(220);

  const lipsyncSnapshot = lipsyncDriver.getSnapshot();
  assert.equal(lipsyncSnapshot.lipsync_active, false);
  assert.equal(lipsyncSnapshot.current_mouth_open, 0);
  assert.ok(lipsyncSnapshot.peak_mouth_open > 0.05);

  const sceneSnapshot = sceneController.getSnapshot();
  assert.equal(sceneSnapshot.active_expression, "smile");
  assert.equal(sceneSnapshot.mouth_open, 0);
  assert.equal(sceneSnapshot.lipsync_active, false);
  assert.equal(sceneSnapshot.lipsync_source, null);

  let unsupportedCaught = false;
  try {
    await sceneController.dispatchCommand({
      command_id: "mouth-unsupported",
      command_type: "set_mouth_open",
      target: "mouth",
      value: 0.7,
      is_interruptible: true
    });
  } catch (error) {
    unsupportedCaught = true;
    assert.equal(error.errorCode, "unsupported_command");
  }
  assert.equal(unsupportedCaught, true);

  await playbackController.destroy();
  await sceneController.destroy();
}

async function runLocalShortCircuitCheck() {
  const sceneController = await buildSceneController();
  const {
    lipsyncDriver,
    playbackController
  } = await buildPlaybackRuntime(sceneController, {
    maxPlaybackDurationMs: 120
  });
  const turnId = randomUUID();

  const finishedResult = await playbackController.deliverFragment({
    session_id: randomUUID(),
    trace_id: randomUUID(),
    turn_id: turnId,
    owner: "quick_reaction",
    tts_stream_id: randomUUID(),
    chunk_index: 0,
    tts_text: "short-circuit quick reply",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 2400,
      amplitude: 0.68
    }),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });

  assert.deepEqual(
    finishedResult.reports.map((item) => item.report_kind),
    ["accepted", "started", "finished"]
  );
  assert.ok(lipsyncDriver.getFrameHistory().some((frame) => frame.mouth_open > 0.05));
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, true);

  await wait(220);
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, false);
  assert.equal(sceneController.getSnapshot().mouth_open, 0);

  await playbackController.destroy();
  await sceneController.destroy();
}

async function runAudibleQuickPrefixHandoffCheck() {
  const sceneController = await buildSceneController();
  const {
    lipsyncDriver,
    playbackController
  } = await buildPlaybackRuntime(sceneController, {
    maxPlaybackDurationMs: 180
  });
  const sessionId = randomUUID();
  const traceId = randomUUID();
  const turnId = randomUUID();

  const quickResult = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "quick_reaction",
    tts_stream_id: randomUUID(),
    chunk_index: 0,
    tts_text: "let me take a look",
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
  const quickFrameCount = lipsyncDriver.getFrameHistory().length;
  assert.ok(quickFrameCount > 0);
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, true);

  const primaryStreamId = randomUUID();
  const primaryAccepted = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: primaryStreamId,
    chunk_index: 0,
    tts_text: "continue the detailed answer",
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
    primaryAccepted.reports.map((item) => item.report_kind),
    ["accepted", "started"]
  );
  assert.ok(lipsyncDriver.getFrameHistory().length > quickFrameCount);
  assert.equal(lipsyncDriver.getSnapshot().lipsync_active, true);

  const primaryFinished = await playbackController.deliverFragment({
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: primaryStreamId,
    chunk_index: 0,
    tts_text: "continue the detailed answer",
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
  assert.equal(sceneController.getSnapshot().mouth_open, 0);

  await playbackController.destroy();
  await sceneController.destroy();
}

async function runAnalyzerFormatCheck() {
  const sceneController = await buildSceneController();
  const {
    lipsyncDriver,
    playbackController
  } = await buildPlaybackRuntime(sceneController);
  const result = await playbackController.deliverFragment({
    session_id: randomUUID(),
    trace_id: randomUUID(),
    turn_id: randomUUID(),
    owner: "primary_response",
    tts_stream_id: randomUUID(),
    chunk_index: 0,
    tts_text: "unsupported format",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: buildPcmFragmentBase64({
      sampleCount: 1024,
      amplitude: 0.3
    }),
    sample_rate_hz: 22050,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });
  assert.equal(result.playback_snapshot.last_report_kind, "failed");
  assert.equal(
    result.reports[result.reports.length - 1]?.report_kind,
    "failed"
  );
  assert.match(
    String(result.reports[result.reports.length - 1]?.message || ""),
    /24000Hz active playback audio/
  );
  assert.equal(lipsyncDriver.getFrameHistory().length, 0);
  await playbackController.destroy();
  await sceneController.destroy();
}

async function run() {
  await runPrimaryPlaybackCheck();
  await runLocalShortCircuitCheck();
  await runAudibleQuickPrefixHandoffCheck();
  await runAnalyzerFormatCheck();
  console.log("desktop-live2d lipsync self-check passed");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
