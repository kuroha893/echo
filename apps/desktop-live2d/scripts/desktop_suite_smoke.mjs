import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveBridgeTargetWindowRole } from "../electron/window_suite_router.mjs";
import { DesktopLive2DAvatarWindowRuntime } from "../renderer/avatar_window_runtime.mjs";
import { DesktopLive2DBubbleWindowRuntime } from "../renderer/bubble_window_runtime.mjs";
import { DesktopLive2DChatWindowRuntime } from "../renderer/chat_window_runtime.mjs";
import { DesktopLive2DChatHistoryPanelController } from "../renderer/chat_history_panel_controller.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

class FakeSceneController {
  constructor() {
    const resolvedModelJsonPath = path.resolve(
      workspaceRoot,
      "apps/desktop-live2d/assets/models/demo-fullbody/model3.json"
    );
    this._snapshot = {
      model_key: "demo-fullbody",
      display_name: "Demo Full-Body Character",
      presentation_mode: "full_body",
      window_surface: "character_window",
      resolved_model_json_path: resolvedModelJsonPath,
      runtime_mode: "suite_smoke_avatar",
      model_loaded: true,
      state: "idle",
      active_expression: null,
      last_motion: null,
      mouth_open: 0,
      lipsync_active: false,
      lipsync_source: null
    };
    this.dispatchCount = 0;
  }

  getSnapshot() {
    return Object.freeze({ ...this._snapshot });
  }

  getManifest() {
    return {
      model_key: this._snapshot.model_key,
      resolved_model_json_path: this._snapshot.resolved_model_json_path,
      presentation_mode: this._snapshot.presentation_mode,
      window_surface: this._snapshot.window_surface
    };
  }

  async dispatchCommand(request) {
    this.dispatchCount += 1;
    if (request.command_type === "set_state") {
      this._snapshot.state = request.value;
    } else if (request.command_type === "set_expression") {
      this._snapshot.active_expression = request.value;
    } else if (request.command_type === "set_motion") {
      this._snapshot.last_motion = request.value;
    }
    return {
      adapter_key: "desktop.live2d",
      outcome: "completed",
      message: "suite smoke dispatch completed"
    };
  }
}

class FakeSceneHost {
  constructor() {
    this._controller = new FakeSceneController();
  }

  getController() {
    return this._controller;
  }

  async boot() {
    return this._controller.getSnapshot();
  }
}

class FakeLipsyncDriver {
  constructor() {
    this._snapshot = {
      lipsync_active: false,
      current_mouth_open: 0,
      peak_mouth_open: 0
    };
    this._history = [];
  }

  ingestPeak(value) {
    this._snapshot = {
      lipsync_active: value > 0,
      current_mouth_open: value,
      peak_mouth_open: Math.max(this._snapshot.peak_mouth_open, value)
    };
    this._history.push({ mouth_open: value });
  }

  getSnapshot() {
    return Object.freeze({ ...this._snapshot });
  }

  getFrameHistory() {
    return Object.freeze([...this._history]);
  }
}

class FakeAudioPlaybackController {
  constructor({ lipsyncDriver }) {
    this._lipsyncDriver = lipsyncDriver;
    this._snapshot = {
      owner: null,
      session_id: null,
      trace_id: null,
      turn_id: null,
      tts_stream_id: null,
      chunk_index: null,
      playback_active: false,
      buffered_fragment_count: 0,
      final_fragment_received: false,
      last_report_kind: null,
      last_reason: null
    };
  }

  getSnapshot() {
    return Object.freeze({ ...this._snapshot });
  }

  getBackendDescriptor() {
    return Object.freeze({
      backend_key: "desktop.live2d.audio.fake",
      runtime_mode: "suite_smoke_audio",
      supports_device_audio_output: false
    });
  }

  async deliverFragment(request) {
    this._lipsyncDriver.ingestPeak(0.64);
    const baseReport = {
      owner: request.owner,
      session_id: request.session_id,
      trace_id: request.trace_id,
      turn_id: request.turn_id,
      tts_stream_id: request.tts_stream_id,
      chunk_index: request.chunk_index,
      fragment_index: request.fragment_index,
      is_interruptible: request.is_interruptible,
      reason: null,
      message: null
    };
    this._snapshot = {
      owner: request.owner,
      session_id: request.session_id,
      trace_id: request.trace_id,
      turn_id: request.turn_id,
      tts_stream_id: request.tts_stream_id,
      chunk_index: request.chunk_index,
      playback_active: !request.is_final,
      buffered_fragment_count: request.is_final ? 0 : request.fragment_index + 1,
      final_fragment_received: request.is_final,
      last_report_kind: request.is_final ? "finished" : "accepted",
      last_reason: null
    };
    return {
      playback_snapshot: this.getSnapshot(),
      reports: request.is_final
        ? [
            { ...baseReport, report_kind: "accepted" },
            { ...baseReport, report_kind: "started" },
            { ...baseReport, report_kind: "finished" }
          ]
        : [{ ...baseReport, report_kind: "accepted" }]
    };
  }

  async abortChunk(request) {
    this._snapshot = {
      owner: request.owner,
      session_id: request.session_id,
      trace_id: request.trace_id,
      turn_id: request.turn_id,
      tts_stream_id: request.tts_stream_id,
      chunk_index: request.chunk_index,
      playback_active: false,
      buffered_fragment_count: 0,
      final_fragment_received: false,
      last_report_kind: "aborted",
      last_reason: request.reason
    };
    return {
      playback_snapshot: this.getSnapshot(),
      reports: [
        {
          report_kind: "aborted",
          owner: request.owner,
          session_id: request.session_id,
          trace_id: request.trace_id,
          turn_id: request.turn_id,
          tts_stream_id: request.tts_stream_id,
          chunk_index: request.chunk_index,
          fragment_index: null,
          is_interruptible: null,
          reason: request.reason,
          message: "suite smoke playback aborted"
        }
      ]
    };
  }

  async destroy() {}
}

class FakeBubbleShell {
  constructor() {
    this.lastSnapshot = null;
  }

  render(snapshot) {
    this.lastSnapshot = snapshot;
  }
}

class FakeChatShell {
  constructor() {
    this.handlers = null;
    this.lastViewModel = null;
  }

  attach(handlers) {
    this.handlers = handlers;
  }

  render(viewModel) {
    this.lastViewModel = viewModel;
  }
}

async function createAvatarRuntime() {
  let handler = null;
  const sceneHost = new FakeSceneHost();
  const lipsyncDriver = new FakeLipsyncDriver();
  const audioPlaybackController = new FakeAudioPlaybackController({
    lipsyncDriver
  });
  const runtime = new DesktopLive2DAvatarWindowRuntime({
    stageElement: { innerHTML: "", appendChild() {} },
    statusElement: { textContent: "" },
    desktopApi: {
      shellInfo: {
        appName: "echo-desktop-live2d",
        presentationMode: "full_body",
        windowSurface: "character_window",
        windowRole: "avatar"
      },
      async registerHostBridgeHandler(nextHandler) {
        handler = nextHandler;
        return { ok: true, accepted: true, windowRole: "avatar" };
      }
    },
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "character_window",
      windowRole: "avatar"
    },
    sceneHost,
    audioLipsyncDriver: lipsyncDriver,
    audioPlaybackController
  });
  await runtime.boot();
  return { runtime, handler, sceneHost };
}

async function createBubbleRuntime() {
  let handler = null;
  const bubbleShell = new FakeBubbleShell();
  const runtime = new DesktopLive2DBubbleWindowRuntime({
    bubbleMountElement: {},
    statusElement: { textContent: "" },
    desktopApi: {
      shellInfo: {
        appName: "echo-desktop-live2d",
        presentationMode: "full_body",
        windowSurface: "bubble_window",
        windowRole: "bubble"
      },
      async registerHostBridgeHandler(nextHandler) {
        handler = nextHandler;
        return { ok: true, accepted: true, windowRole: "bubble" };
      }
    },
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "bubble_window",
      windowRole: "bubble"
    },
    bubbleShell
  });
  await runtime.boot();
  return { runtime, handler, bubbleShell };
}

async function createChatRuntime() {
  let handler = null;
  const chatShell = new FakeChatShell();
  const panelController = new DesktopLive2DChatHistoryPanelController({
    shell: chatShell,
    companionApi: {
      async submitCompanionText() {
        throw new Error("suite smoke should not use chat-side submit path");
      }
    }
  });
  const runtime = new DesktopLive2DChatWindowRuntime({
    desktopApi: {
      shellInfo: {
        appName: "echo-desktop-live2d",
        presentationMode: "full_body",
        windowSurface: "chat_window",
        windowRole: "chat"
      },
      async registerHostBridgeHandler(nextHandler) {
        handler = nextHandler;
        return { ok: true, accepted: true, windowRole: "chat" };
      },
      async getCompanionState() {
        return {
          companion_session_snapshot: null
        };
      },
      async submitCompanionText() {
        throw new Error("suite smoke should not use chat-side submit path");
      }
    },
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "chat_window",
      windowRole: "chat"
    },
    panelController
  });
  await runtime.boot();
  return { runtime, handler, chatShell };
}

async function main() {
  globalThis.document = {
    createElement() {
      return {
        style: {},
        textContent: "",
        appendChild() {},
        remove() {}
      };
    }
  };
  const avatar = await createAvatarRuntime();
  const chat = await createChatRuntime();
  const bubble = await createBubbleRuntime();

  const handlersByRole = new Map([
    ["avatar", avatar.handler],
    ["chat", chat.handler],
    ["bubble", bubble.handler]
  ]);
  const liveBridgeLog = {
    lastBubbleText: null,
    lastAssistantTranscriptText: null,
    routedCommandsByRole: {
      avatar: [],
      chat: [],
      bubble: []
    }
  };
  async function routeBridgeRequest(bridgeRequest) {
    const targetRole = resolveBridgeTargetWindowRole(bridgeRequest);
    liveBridgeLog.routedCommandsByRole[targetRole].push(bridgeRequest.bridge_command);
    const handler = handlersByRole.get(targetRole);
    if (typeof handler !== "function") {
      throw new Error(`suite smoke has no handler for role '${targetRole}'`);
    }
    const response = await handler(bridgeRequest);
    if (
      bridgeRequest.bridge_command === "bubble_replace" ||
      bridgeRequest.bridge_command === "bubble_append"
    ) {
      liveBridgeLog.lastBubbleText = response.bubble_text;
    }
    if (
      bridgeRequest.bridge_command === "companion_session_upsert_transcript" &&
      bridgeRequest.role === "assistant"
    ) {
      liveBridgeLog.lastAssistantTranscriptText = bridgeRequest.text;
    }
    return response;
  }

  const sessionId = randomUUID();
  const turnId = randomUUID();
  const traceId = randomUUID();
  const streamId = randomUUID();

  await routeBridgeRequest({
    request_id: randomUUID(),
    bridge_command: "companion_session_upsert_transcript",
    session_id: sessionId,
    turn_id: turnId,
    role: "user",
    text: "hello desktop suite smoke",
    is_streaming: false
  });
  const assistantTranscriptResponse = await routeBridgeRequest({
    request_id: randomUUID(),
    bridge_command: "companion_session_upsert_transcript",
    session_id: sessionId,
    turn_id: turnId,
    role: "assistant",
    text: "desktop suite synthetic reply",
    is_streaming: false
  });
  const bubbleResponse = await routeBridgeRequest({
    request_id: randomUUID(),
    bridge_command: "bubble_replace",
    bubble_text: "desktop suite synthetic reply",
    speaker_label: "Echo",
    is_streaming: false
  });
  await routeBridgeRequest({
    request_id: randomUUID(),
    bridge_command: "dispatch_command",
    adapter_key: "desktop.live2d",
    adapter_profile_key: null,
    command_id: randomUUID(),
    command_type: "set_state",
    target: "state",
    value: "thinking",
    intensity: 1,
    duration_ms: null,
    is_interruptible: true
  });
  await routeBridgeRequest({
    request_id: randomUUID(),
    bridge_command: "audio_playback_fragment",
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "desktop suite synthetic reply",
    is_interruptible: true,
    fragment_index: 0,
    audio_bytes_base64: Buffer.alloc(960, 0).toString("base64"),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: false,
    media_type: "audio/pcm;encoding=s16le"
  });
  const audioResponse = await routeBridgeRequest({
    request_id: randomUUID(),
    bridge_command: "audio_playback_fragment",
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    owner: "primary_response",
    tts_stream_id: streamId,
    chunk_index: 0,
    tts_text: "desktop suite synthetic reply",
    is_interruptible: true,
    fragment_index: 1,
    audio_bytes_base64: Buffer.alloc(960, 1).toString("base64"),
    sample_rate_hz: 24000,
    channel_count: 1,
    is_final: true,
    media_type: "audio/pcm;encoding=s16le"
  });

  assert.ok(
    liveBridgeLog.routedCommandsByRole.avatar.length > 0,
    `avatar runtime should receive at least one routed command, got ${JSON.stringify(liveBridgeLog.routedCommandsByRole)}`
  );
  assert.ok(
    liveBridgeLog.routedCommandsByRole.chat.length > 0,
    `chat runtime should receive at least one routed command, got ${JSON.stringify(liveBridgeLog.routedCommandsByRole)}`
  );
  assert.ok(
    liveBridgeLog.routedCommandsByRole.bubble.length > 0,
    `bubble runtime should receive at least one routed command, got ${JSON.stringify(liveBridgeLog.routedCommandsByRole)}`
  );
  assert.equal(
    assistantTranscriptResponse.companion_session_snapshot.transcript_entries.length >= 2,
    true
  );
  assert.equal(
    chat.chatShell.lastViewModel.messages[chat.chatShell.lastViewModel.messages.length - 1].text,
    "desktop suite synthetic reply"
  );
  assert.equal(bubbleResponse.bubble_text, "desktop suite synthetic reply");
  assert.equal(audioResponse.playback_snapshot.last_report_kind, "finished");
  assert.equal(avatar.runtime.buildDebugSnapshot().scene_snapshot.state, "thinking");
  assert.equal(
    avatar.runtime.buildDebugSnapshot().lipsync_snapshot.peak_mouth_open > 0,
    true
  );

  process.stdout.write("desktop-live2d avatar/chat/bubble suite smoke passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
