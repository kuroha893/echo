import assert from "node:assert/strict";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const appRoot = path.resolve(import.meta.dirname, "..");
const bridgePath = path.resolve(appRoot, "renderer", "scene_stdio_bridge.mjs");

function writeJsonLine(child, payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function readJsonLine(reader) {
  const [line] = await once(reader, "line");
  if (line === undefined) {
    throw new Error("bridge closed before returning a smoke response");
  }
  return JSON.parse(line);
}

async function main() {
  const child = spawn("node", [bridgePath], {
    cwd: appRoot,
    env: {
      ...process.env,
      ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT: workspaceRoot,
      ECHO_DESKTOP_LIVE2D_PROTOCOL_VERSION: "echo.desktop-live2d.bridge.v1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const stdoutReader = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  const stderrChunks = [];
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk.toString("utf8"));
  });

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "ping"
  });
  const pingResponse = await readJsonLine(stdoutReader);
  assert.equal(pingResponse.status, "ok");
  assert.equal(pingResponse.bridge_command, "ping");

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "initialize",
    model_asset: {
      model_key: "demo-fullbody",
      repo_relative_model_json_path: "/tmp/absolute.json",
      display_name: "Broken Model",
      presentation_mode: "full_body",
      window_surface: "character_window"
    },
    full_body_required: true
  });
  const invalidInitResponse = await readJsonLine(stdoutReader);
  assert.equal(invalidInitResponse.status, "error");
  assert.equal(invalidInitResponse.error_code, "invalid_model_asset");

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "initialize",
    model_asset: {
      model_key: "demo-fullbody",
      repo_relative_model_json_path:
        "apps/desktop-live2d/assets/models/demo-fullbody/model3.json",
      display_name: "Demo Full-Body Character",
      presentation_mode: "full_body",
      window_surface: "character_window"
    },
    full_body_required: true
  });
  const initResponse = await readJsonLine(stdoutReader);
  assert.equal(initResponse.status, "ok");
  assert.equal(initResponse.presentation_mode, "full_body");

  const commandSequence = [
    {
      command_type: "set_state",
      target: "state",
      value: "thinking"
    },
    {
      command_type: "set_expression",
      target: "expression",
      value: "smile"
    },
    {
      command_type: "set_motion",
      target: "motion",
      value: "nod"
    },
    {
      command_type: "clear_expression",
      target: "expression",
      value: true
    }
  ];

  for (const command of commandSequence) {
    writeJsonLine(child, {
      protocol_version: "echo.desktop-live2d.bridge.v1",
      request_id: randomUUID(),
      bridge_command: "dispatch_command",
      adapter_key: "desktop.live2d",
      adapter_profile_key: null,
      command_id: randomUUID(),
      command_type: command.command_type,
      target: command.target,
      value: command.value,
      intensity: 1.0,
      duration_ms: null,
      is_interruptible: true
    });
    const dispatchResponse = await readJsonLine(stdoutReader);
    assert.equal(dispatchResponse.status, "ok");
    assert.equal(dispatchResponse.bridge_command, "dispatch_command");
    assert.equal(dispatchResponse.outcome, "completed");
  }

  const playbackStreamId = randomUUID();
  const firstAudioBytes = Buffer.alloc(960, 0).toString("base64");
  const secondAudioBytes = Buffer.alloc(960, 1).toString("base64");

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "audio_playback_fragment",
    session_id: randomUUID(),
    trace_id: randomUUID(),
    turn_id: randomUUID(),
    owner: "primary_response",
    tts_stream_id: playbackStreamId,
    chunk_index: 0,
    tts_text: "desktop audio bridge demo",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: firstAudioBytes,
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });
  const firstAudioResponse = await readJsonLine(stdoutReader);
  assert.equal(firstAudioResponse.status, "ok");
  assert.equal(firstAudioResponse.bridge_command, "audio_playback_fragment");
  assert.deepEqual(
    firstAudioResponse.reports.map((item) => item.report_kind),
    ["accepted"]
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "audio_playback_fragment",
    session_id: firstAudioResponse.reports[0].session_id,
    trace_id: firstAudioResponse.reports[0].trace_id,
    turn_id: firstAudioResponse.reports[0].turn_id,
    owner: "primary_response",
    tts_stream_id: playbackStreamId,
    chunk_index: 0,
    tts_text: "desktop audio bridge demo",
    is_interruptible: true,
    fragment_index: 1,
    audio_bytes_base64: secondAudioBytes,
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });
  const finalAudioResponse = await readJsonLine(stdoutReader);
  assert.equal(finalAudioResponse.status, "ok");
  assert.deepEqual(
    finalAudioResponse.reports.map((item) => item.report_kind),
    ["accepted", "started", "finished"]
  );
  assert.equal(finalAudioResponse.playback_snapshot.playback_active, false);
  assert.equal(
    finalAudioResponse.playback_snapshot.last_report_kind,
    "finished"
  );

  const abortStreamId = randomUUID();
  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "audio_playback_fragment",
    session_id: randomUUID(),
    trace_id: randomUUID(),
    turn_id: randomUUID(),
    owner: "quick_reaction",
    tts_stream_id: abortStreamId,
    chunk_index: 0,
    tts_text: "abort me",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: firstAudioBytes,
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });
  const abortSeedResponse = await readJsonLine(stdoutReader);
  assert.equal(abortSeedResponse.status, "ok");
  assert.deepEqual(
    abortSeedResponse.reports.map((item) => item.report_kind),
    ["accepted"]
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "audio_playback_abort",
    session_id: abortSeedResponse.reports[0].session_id,
    trace_id: abortSeedResponse.reports[0].trace_id,
    turn_id: abortSeedResponse.reports[0].turn_id,
    owner: "quick_reaction",
    tts_stream_id: abortStreamId,
    chunk_index: 0,
    reason: "smoke abort"
  });
  const abortResponse = await readJsonLine(stdoutReader);
  assert.equal(abortResponse.status, "ok");
  assert.deepEqual(
    abortResponse.reports.map((item) => item.report_kind),
    ["aborted"]
  );

  const transcriptSessionId = randomUUID();
  const transcriptTurnId = randomUUID();
  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "companion_session_upsert_transcript",
    session_id: transcriptSessionId,
    turn_id: transcriptTurnId,
    role: "user",
    text: "hello from desktop transcript",
    is_streaming: false
  });
  const userTranscriptResponse = await readJsonLine(stdoutReader);
  assert.equal(userTranscriptResponse.status, "ok");
  assert.equal(
    userTranscriptResponse.bridge_command,
    "companion_session_upsert_transcript"
  );
  assert.equal(
    userTranscriptResponse.companion_session_snapshot.transcript_entries.length,
    1
  );
  assert.equal(
    userTranscriptResponse.companion_session_snapshot.transcript_entries[0].role,
    "user"
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "companion_session_upsert_transcript",
    session_id: transcriptSessionId,
    turn_id: transcriptTurnId,
    role: "assistant",
    text: "streaming assistant text",
    is_streaming: true
  });
  const assistantTranscriptResponse = await readJsonLine(stdoutReader);
  assert.equal(assistantTranscriptResponse.status, "ok");
  assert.equal(
    assistantTranscriptResponse.companion_session_snapshot.transcript_entries.length,
    2
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "companion_session_snapshot"
  });
  const companionSnapshotResponse = await readJsonLine(stdoutReader);
  assert.equal(companionSnapshotResponse.status, "ok");
  assert.equal(
    companionSnapshotResponse.companion_session_snapshot.session_id,
    transcriptSessionId
  );
  assert.equal(
    companionSnapshotResponse.companion_session_snapshot.transcript_entries[1].text,
    "streaming assistant text"
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "companion_session_enqueue_input",
    session_id: transcriptSessionId,
    text: "typed input from desktop app"
  });
  const enqueueInputResponse = await readJsonLine(stdoutReader);
  assert.equal(enqueueInputResponse.status, "ok");
  assert.equal(
    enqueueInputResponse.companion_session_snapshot.pending_input_count,
    1
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "companion_session_drain_input",
    session_id: transcriptSessionId
  });
  const drainInputResponse = await readJsonLine(stdoutReader);
  assert.equal(drainInputResponse.status, "ok");
  assert.equal(drainInputResponse.drained_inputs.length, 1);
  assert.equal(drainInputResponse.drained_inputs[0].text, "typed input from desktop app");
  assert.equal(
    drainInputResponse.companion_session_snapshot.pending_input_count,
    0
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "bubble_replace",
    bubble_text: "Echo is here.",
    speaker_label: "Echo",
    is_streaming: true
  });
  const bubbleReplaceResponse = await readJsonLine(stdoutReader);
  assert.equal(bubbleReplaceResponse.status, "ok");
  assert.equal(bubbleReplaceResponse.bridge_command, "bubble_replace");
  assert.equal(bubbleReplaceResponse.bubble_visible, true);
  assert.equal(bubbleReplaceResponse.bubble_text, "Echo is here.");
  assert.equal(bubbleReplaceResponse.segment_count, 1);

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "bubble_append",
    text_fragment: " Streaming bubble shell is active.",
    speaker_label: null,
    is_streaming: false
  });
  const bubbleAppendResponse = await readJsonLine(stdoutReader);
  assert.equal(bubbleAppendResponse.status, "ok");
  assert.equal(bubbleAppendResponse.bridge_command, "bubble_append");
  assert.equal(
    bubbleAppendResponse.bubble_text,
    "Echo is here. Streaming bubble shell is active."
  );
  assert.equal(bubbleAppendResponse.is_streaming, false);
  assert.equal(bubbleAppendResponse.segment_count, 2);

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "bubble_snapshot"
  });
  const bubbleSnapshotResponse = await readJsonLine(stdoutReader);
  assert.equal(bubbleSnapshotResponse.status, "ok");
  assert.equal(bubbleSnapshotResponse.bridge_command, "bubble_snapshot");
  assert.equal(
    bubbleSnapshotResponse.bubble_text,
    "Echo is here. Streaming bubble shell is active."
  );

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "bubble_clear",
    reason: "smoke complete"
  });
  const bubbleClearResponse = await readJsonLine(stdoutReader);
  assert.equal(bubbleClearResponse.status, "ok");
  assert.equal(bubbleClearResponse.bridge_command, "bubble_clear");
  assert.equal(bubbleClearResponse.bubble_visible, false);
  assert.equal(bubbleClearResponse.bubble_text, "");

  writeJsonLine(child, {
    protocol_version: "echo.desktop-live2d.bridge.v1",
    request_id: randomUUID(),
    bridge_command: "shutdown",
    reason: "smoke complete"
  });
  const shutdownResponse = await readJsonLine(stdoutReader);
  assert.equal(shutdownResponse.status, "ok");
  assert.equal(shutdownResponse.bridge_command, "shutdown");

  await new Promise((resolve, reject) => {
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `desktop-live2d smoke exited with code ${code}: ${stderrChunks.join("")}`
        )
      );
    });
  });

}

main()
  .then(() => {
    process.stdout.write("desktop-live2d smoke passed\n");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
