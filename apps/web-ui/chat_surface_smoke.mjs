import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

import { DesktopCompanionPythonHost } from "../desktop-live2d/electron/python_companion_host.mjs";
import {
  buildClearSecretUpdate,
  buildKeepSecretUpdate
} from "../desktop-live2d/shared/provider_settings_contracts.mjs";
import { DesktopWebControlPlaneServer } from "./control_plane_server.mjs";
import { DesktopWebChatSurfaceController } from "./public/chat_surface.mjs";
import {
  buildDebugUpdatePayload,
  WEB_UI_API_ROUTE,
  WEB_UI_SSE_EVENT
} from "./public/control_plane_contracts.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const desktopAppRoot = path.resolve(workspaceRoot, "apps", "desktop-live2d");
const bridgePath = path.resolve(desktopAppRoot, "renderer", "scene_stdio_bridge.mjs");

class FakeShell {
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

function writeJsonLine(child, payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function readJsonLine(reader) {
  const [line] = await once(reader, "line");
  if (line === undefined) {
    throw new Error("desktop-live2d bridge closed before responding");
  }
  return JSON.parse(line);
}

async function createBridgeProxy() {
  const child = spawn("node", [bridgePath], {
    cwd: desktopAppRoot,
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
  let requestLock = Promise.resolve();

  return {
    async request(bridgeRequest) {
      const nextRequest = requestLock.then(async () => {
        writeJsonLine(child, bridgeRequest);
        return await readJsonLine(stdoutReader);
      });
      requestLock = nextRequest.then(
        () => undefined,
        () => undefined
      );
      return await nextRequest;
    },
    async close() {
      child.kill();
      await once(child, "exit").catch(() => undefined);
      if (stderrChunks.length > 0) {
        process.stderr.write(stderrChunks.join(""));
      }
    }
  };
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

async function main() {
  const chatHtml = await fs.readFile(
    path.resolve(workspaceRoot, "apps", "web-ui", "public", "index.html"),
    "utf8"
  );
  assert.doesNotMatch(chatHtml, /providerModeChip|demo_scripted|real_provider_stack|selected_mode|demo mode|scripted mode/i);

  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "echo-web-ui-chat-surface-smoke-")
  );
  const bridgeProxy = await createBridgeProxy();
  let server = null;
  let transcriptSnapshot = {
    session_id: "11111111-1111-4111-8111-111111111111",
    transcript_entries: []
  };
  const host = new DesktopCompanionPythonHost({
    workspaceRoot,
    userDataDirectory,
    onDesktopBridgeRequest: async (bridgeRequest) => {
      const response = await bridgeProxy.request(bridgeRequest);
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
            category: "bridge",
            message: bridgeRequest.bridge_command,
            detail: { status: response?.status || null }
          })
        );
      }
      return response;
    }
  });

  try {
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
          return {
            companion_session_snapshot: transcriptSnapshot
          };
        },
        async submitTextTurn(payload) {
          const turnId = randomUUID();
          const baseIndex = transcriptSnapshot.transcript_entries.length;
          transcriptSnapshot = {
            session_id: transcriptSnapshot.session_id,
            transcript_entries: [
              ...transcriptSnapshot.transcript_entries,
              {
                entry_id: randomUUID(),
                turn_id: turnId,
                role: "user",
                text: payload.text,
                is_streaming: false,
                sequence_index: baseIndex
              },
              {
                entry_id: randomUUID(),
                turn_id: turnId,
                role: "assistant",
                text: "Smoke reply",
                is_streaming: false,
                sequence_index: baseIndex + 1
              }
            ]
          };
          server.publishTranscriptSnapshot(transcriptSnapshot);
          return {
            submitted_text: payload.text,
            final_desktop_snapshot: {
              companion_session_snapshot: transcriptSnapshot
            }
          };
        },
        async runTtsVoiceEnrollment(payload) {
          return await host.runTTSVoiceEnrollment(payload);
        },
        async getDebugState() {
          return buildDebugUpdatePayload({
            category: "control_plane",
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

    const shell = new FakeShell();
    const controller = new DesktopWebChatSurfaceController({
      shell,
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
    await controller.boot();
    shell.handlers.onComposerChange("hello from browser chat smoke");
    await shell.handlers.onSubmit();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((shell.lastViewModel?.messages || []).length >= 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(shell.lastViewModel.messages.length, 2);
    assert.equal(shell.lastViewModel.messages[0].role, "user");
    assert.equal(shell.lastViewModel.messages[1].role, "assistant");
    assert.equal("providerStackLabel" in shell.lastViewModel, false);
    controller.close();
  } finally {
    await host.close();
    if (server) {
      await server.close();
    }
    await bridgeProxy.close();
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }

  process.stdout.write("echo web-ui chat surface smoke passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
