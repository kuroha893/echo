import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DesktopCompanionPythonHost } from "../desktop-live2d/electron/python_companion_host.mjs";
import {
  buildClearSecretUpdate,
  buildKeepSecretUpdate
} from "../desktop-live2d/shared/provider_settings_contracts.mjs";
import { resolveBridgeTargetWindowRole } from "../desktop-live2d/electron/window_suite_router.mjs";
import { DesktopLive2DAvatarWindowRuntime } from "../desktop-live2d/renderer/avatar_window_runtime.mjs";
import { DesktopLive2DBubbleWindowRuntime } from "../desktop-live2d/renderer/bubble_window_runtime.mjs";
import { DesktopLive2DChatWindowRuntime } from "../desktop-live2d/renderer/chat_window_runtime.mjs";
import { DesktopLive2DChatHistoryPanelController } from "../desktop-live2d/renderer/chat_history_panel_controller.mjs";
import { DesktopWebControlPlaneServer } from "./control_plane_server.mjs";
import { DesktopWebChatSurfaceController } from "./public/chat_surface.mjs";
import {
  buildDebugUpdatePayload,
  WEB_UI_API_ROUTE,
  WEB_UI_SSE_EVENT
} from "./public/control_plane_contracts.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

function buildProductionSavePayload() {
  return {
    local_fast_llm: null,
    cloud_primary_llm: {
      base_url: "https://api.openai.com/v1",
      api_key_update: {
        mode: "replace",
        replacement_text: "smoke-cloud-secret"
      },
      primary_model_name: "gpt-4.1-mini",
      request_timeout_ms: 30000,
      organization_id: null,
      project_id: null
    },
    qwen_tts: {
      base_url: "https://dashscope.aliyuncs.com/compatible-mode",
      api_key_update: {
        mode: "replace",
        replacement_text: "smoke-qwen-secret"
      },
      request_timeout_ms: 30000,
      standard_model_id: "qwen-tts-latest",
      standard_voice_id: "Chelsie",
      realtime_model_id: null,
      realtime_voice_id: null,
      preferred_media_type: "audio/pcm;encoding=s16le",
      voice_profile_key: "desktop.qwen3.current_voice",
      voice_display_name: "Desktop Voice",
      provider_profile_key: "desktop.qwen3.default_profile"
    }
  };
}

class FakeBrowserShell {
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

class FakeBubbleShell {
  constructor() {
    this.lastSnapshot = null;
    this.lastNonEmptyBubbleText = null;
  }

  render(snapshot) {
    this.lastSnapshot = snapshot;
    if (snapshot?.bubble_text) {
      this.lastNonEmptyBubbleText = snapshot.bubble_text;
    }
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
      runtime_mode: "suite_sync_avatar",
      model_loaded: true,
      state: "idle",
      active_expression: null,
      last_motion: null,
      mouth_open: 0,
      lipsync_active: false,
      lipsync_source: null
    };
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
      message: "desktop suite sync dispatch completed"
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
      runtime_mode: "suite_sync_audio",
      supports_device_audio_output: false
    });
  }

  async deliverFragment(request) {
    this._lipsyncDriver.ingestPeak(0.68);
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
          message: "desktop suite sync playback aborted"
        }
      ]
    };
  }

  async destroy() {}
}

async function createAvatarRuntime() {
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
  return { runtime, handler };
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

async function createChatRuntime({ submitCompanionText, getCompanionState }) {
  let handler = null;
  const chatShell = new FakeChatShell();
  const panelController = new DesktopLive2DChatHistoryPanelController({
    shell: chatShell,
    companionApi: {
      submitCompanionText
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
      getCompanionState,
      submitCompanionText
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

function createFetchSseConnector(origin) {
  return async (handlers) => {
    const response = await fetch(`${origin}${WEB_UI_API_ROUTE.EVENTS}`, {
      headers: { accept: "text/event-stream" }
    });
    handlers.onOpen?.();
    const reader = response.body.getReader();
    let active = true;
    const loop = (async () => {
      let buffer = "";
      while (active) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += Buffer.from(value).toString("utf8");
        while (buffer.includes("\n\n")) {
          const frameEnd = buffer.indexOf("\n\n");
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const eventMatch = frame.match(/^event:\s*(.+)$/m);
          const dataMatch = frame.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) {
            continue;
          }
          const payload = JSON.parse(dataMatch[1]);
          if (eventMatch[1] === WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT) {
            handlers.onTranscriptSnapshot?.(payload);
          } else if (eventMatch[1] === WEB_UI_SSE_EVENT.PROVIDER_READINESS) {
            handlers.onProviderReadiness?.(payload);
          } else if (eventMatch[1] === WEB_UI_SSE_EVENT.DEBUG_UPDATE) {
            handlers.onDebugUpdate?.(payload);
          }
        }
      }
    })().catch((error) => {
      handlers.onError?.(error);
    });
    return async () => {
      active = false;
      await reader.cancel().catch(() => undefined);
      await loop.catch(() => undefined);
    };
  };
}

async function waitFor(predicate, message, attempts = 40, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(message);
}

async function main() {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "echo-web-ui-desktop-sync-smoke-")
  );
  let server = null;
  let host = null;

  try {
    const avatar = await createAvatarRuntime();
    const bubble = await createBubbleRuntime();
    const chat = await createChatRuntime({
      submitCompanionText: async (text) => {
        const result = await host.submitDesktopInput(text);
        server.publishTranscriptSnapshot(
          result.final_desktop_snapshot.companion_session_snapshot
        );
        return result;
      },
      async getCompanionState() {
        return {
          companion_session_snapshot: null
        };
      }
    });

    const handlersByRole = new Map([
      ["avatar", avatar.handler],
      ["chat", chat.handler],
      ["bubble", bubble.handler]
    ]);

    host = new DesktopCompanionPythonHost({
      workspaceRoot,
      userDataDirectory,
      onDesktopBridgeRequest: async (bridgeRequest) => {
        const targetRole = resolveBridgeTargetWindowRole(bridgeRequest);
        const handler = handlersByRole.get(targetRole);
        if (typeof handler !== "function") {
          throw new Error(`desktop suite sync smoke missing handler for '${targetRole}'`);
        }
        const response = await handler(bridgeRequest);
        if (
          bridgeRequest.bridge_command === "companion_session_upsert_transcript" &&
          response?.companion_session_snapshot &&
          server
        ) {
          server.publishTranscriptSnapshot(response.companion_session_snapshot);
        }
        if (server) {
          server.publishDebugUpdate(
            buildDebugUpdatePayload({
              category: "desktop_bridge",
              message: bridgeRequest.bridge_command,
              detail: { target_role: targetRole, status: response?.status || null }
            })
          );
        }
        return response;
      }
    });

    server = new DesktopWebControlPlaneServer({
      operations: {
        async loadProviderSettings() {
          const result = await host.loadProviderSettings();
          server.publishProviderReadiness(result.readiness);
          return result;
        },
        async saveProviderSettings(payload) {
          const result = await host.saveProviderSettings(payload);
          server.publishProviderReadiness(result.readiness);
          return result;
        },
        async validateProviderSettings() {
          const result = await host.validateProviderSettings();
          server.publishProviderReadiness(result.readiness);
          return result;
        },
        async getProviderReadiness() {
          return await host.getProviderReadiness();
        },
        async snapshotDesktopState() {
          return await host.snapshotDesktopState();
        },
        async submitTextTurn(payload) {
          const result = await host.submitDesktopInput(payload.text);
          server.publishTranscriptSnapshot(
            result.final_desktop_snapshot.companion_session_snapshot
          );
          return result;
        },
        async runTtsVoiceEnrollment(payload) {
          return await host.runTTSVoiceEnrollment(payload);
        },
        async getDebugState() {
          return buildDebugUpdatePayload({
            category: "desktop_suite_sync",
            message: "ready"
          });
        }
      }
    });

    const origin = await server.start();
    const saveResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildProductionSavePayload())
    });
    const savePayload = await saveResponse.json();
    assert.equal(savePayload.status, "ok");

    const browserShell = new FakeBrowserShell();
    const browserController = new DesktopWebChatSurfaceController({
      shell: browserShell,
      controlPlaneClient: {
        async loadProviderSettings() {
          const response = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS}`);
          return (await response.json()).payload;
        },
        async getProviderReadiness() {
          const response = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_READINESS}`);
          return (await response.json()).payload;
        },
        async getDesktopState() {
          const response = await fetch(`${origin}${WEB_UI_API_ROUTE.DESKTOP_STATE}`);
          return (await response.json()).payload;
        },
        async submitTextTurn(text) {
          const response = await fetch(`${origin}${WEB_UI_API_ROUTE.TEXT_TURNS}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text })
          });
          return (await response.json()).payload;
        }
      },
      eventStreamConnector: createFetchSseConnector(origin)
    });
    await browserController.boot();

    browserShell.handlers.onComposerChange("hello from browser to desktop");
    await browserShell.handlers.onSubmit();

    await waitFor(
      () =>
        (browserShell.lastViewModel?.messages || []).length >= 2 &&
        (chat.chatShell.lastViewModel?.messages || []).length >= 2 &&
        Boolean(bubble.bubbleShell.lastNonEmptyBubbleText),
      "browser -> desktop sync did not settle"
    );

    assert.equal(browserShell.lastViewModel.messages[0].role, "user");
    assert.equal(browserShell.lastViewModel.messages[1].role, "assistant");
    assert.equal(chat.chatShell.lastViewModel.messages.length, 2);
    assert.equal(chat.chatShell.lastViewModel.messages[1].role, "assistant");
    assert.equal(
      chat.chatShell.lastViewModel.messages[1].text,
      browserShell.lastViewModel.messages[1].text
    );
    assert.ok(bubble.bubbleShell.lastNonEmptyBubbleText.length > 0);
    assert.equal(
      avatar.runtime.buildDebugSnapshot().audio_playback_snapshot.last_report_kind,
      "finished"
    );
    assert.ok(
      avatar.runtime.buildDebugSnapshot().lipsync_snapshot.peak_mouth_open > 0
    );

    chat.chatShell.handlers.onComposerChange("hello from floating chat to browser");
    await chat.chatShell.handlers.onSubmit();

    await waitFor(
      () => (browserShell.lastViewModel?.messages || []).length >= 4,
      "desktop chat -> browser sync did not settle"
    );

    const browserMessages = browserShell.lastViewModel.messages;
    const desktopMessages = chat.chatShell.lastViewModel.messages;
    assert.equal(browserMessages[browserMessages.length - 2].role, "user");
    assert.equal(browserMessages[browserMessages.length - 2].text, "hello from floating chat to browser");
    assert.equal(browserMessages[browserMessages.length - 1].role, "assistant");
    assert.equal(
      desktopMessages[desktopMessages.length - 1].text,
      browserMessages[browserMessages.length - 1].text
    );
    assert.equal(
      avatar.runtime.buildDebugSnapshot().audio_playback_snapshot.last_report_kind,
      "finished"
    );
    assert.ok(
      avatar.runtime.buildDebugSnapshot().lipsync_snapshot.peak_mouth_open > 0
    );

    browserController.close();
  } finally {
    if (host) {
      await host.close();
    }
    if (server) {
      await server.close();
    }
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }

  process.stdout.write("echo web-ui desktop window sync smoke passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
