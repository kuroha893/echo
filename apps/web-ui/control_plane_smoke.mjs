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
import {
  buildDebugUpdatePayload,
  WEB_UI_API_ROUTE,
  WEB_UI_SSE_EVENT
} from "./public/control_plane_contracts.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const desktopAppRoot = path.resolve(workspaceRoot, "apps", "desktop-live2d");
const bridgePath = path.resolve(desktopAppRoot, "renderer", "scene_stdio_bridge.mjs");

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

function createSseEventCollector(reader) {
  let buffer = "";
  return async function collect(targetEventName) {
    while (true) {
      const frameEnd = buffer.indexOf("\n\n");
      if (frameEnd >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const eventMatch = frame.match(/^event:\s*(.+)$/m);
        const dataMatch = frame.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) {
          continue;
        }
        if (eventMatch[1] !== targetEventName) {
          continue;
        }
        return JSON.parse(dataMatch[1]);
      }
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(`SSE stream ended before '${targetEventName}'`);
      }
      buffer += Buffer.from(value).toString("utf8");
    }
  };
}

async function collectTranscriptSnapshotUntil(collectSseEvent, minimumEntryCount) {
  while (true) {
    const transcriptEvent = await collectSseEvent(WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT);
    if ((transcriptEvent.transcript_entries || []).length >= minimumEntryCount) {
      return transcriptEvent;
    }
  }
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

async function main() {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "echo-web-ui-control-plane-smoke-")
  );
  const bridgeProxy = await createBridgeProxy();
  let server = null;
  let transcriptSnapshot = {
    session_id: "11111111-1111-4111-8111-111111111111",
    transcript_entries: []
  };
  let avatarModelLibrary = {
    default_model_key: "open-yachiyo-kaguya",
    selected_model_key: "open-yachiyo-kaguya",
    models: [
      {
        model_key: "open-yachiyo-kaguya",
        display_name: "Open Yachiyo Kaguya",
        presentation_mode: "full_body",
        window_surface: "character_window",
        supported_states: ["idle", "listening", "thinking", "speaking"],
        supported_expressions: ["smile", "thinking", "angry"],
        supported_motions: ["nod", "shake_head"]
      },
      {
        model_key: "open-yachiyo-kaguya-lite",
        display_name: "Open Yachiyo Kaguya Lite",
        presentation_mode: "full_body",
        window_surface: "character_window",
        supported_states: ["idle", "listening", "thinking", "speaking"],
        supported_expressions: ["smile"],
        supported_motions: ["nod"]
      }
    ]
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
            detail: {
              status: response?.status || null
            }
          })
        );
      }
      return response;
    }
  });

  try {
    server = new DesktopWebControlPlaneServer({
      operations: {
        async loadAvatarModelLibrary() {
          return avatarModelLibrary;
        },
        async saveAvatarModelSelection(payload) {
          avatarModelLibrary = {
            ...avatarModelLibrary,
            selected_model_key: payload.selected_model_key
          };
          return avatarModelLibrary;
        },
        async loadProviderSettings() {
          const result = await host.loadProviderSettings();
          server.publishProviderReadiness(result.readiness);
          return result;
        },
        async saveProviderSettings(payload) {
          const result = await host.saveProviderSettings(payload);
          server.publishProviderReadiness(result.readiness);
          server.publishDebugUpdate(
            buildDebugUpdatePayload({
              category: "provider_settings",
              message: "saved",
              detail: { local_fast_configured: result.settings_snapshot.local_fast_llm != null }
            })
          );
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
          const baseIndex = transcriptSnapshot.transcript_entries.length;
          transcriptSnapshot = {
            session_id: transcriptSnapshot.session_id,
            transcript_entries: [
              ...transcriptSnapshot.transcript_entries,
              {
                entry_id: randomUUID(),
                turn_id: randomUUID(),
                role: "user",
                text: payload.text,
                is_streaming: false,
                sequence_index: baseIndex
              },
              {
                entry_id: randomUUID(),
                turn_id: randomUUID(),
                role: "assistant",
                text: "Smoke reply",
                is_streaming: false,
                sequence_index: baseIndex + 1
              }
            ]
          };
          server.publishTranscriptSnapshot(transcriptSnapshot);
          server.publishDebugUpdate(
            buildDebugUpdatePayload({
              category: "text_turn",
              message: "submitted",
              detail: { submitted_text: payload.text }
            })
          );
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
    const avatarModelResponse = await fetch(
      `${origin}${WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY}`
    );
    const avatarModelPayload = await avatarModelResponse.json();
    assert.equal(avatarModelPayload.status, "ok");
    assert.equal(avatarModelPayload.payload.models.length, 2);

    const saveResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildProductionSavePayload())
    });
    const savePayload = await saveResponse.json();
    assert.equal(savePayload.status, "ok");
    assert.equal(savePayload.payload.settings_snapshot.local_fast_llm, null);

    const readinessResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_READINESS}`);
    const readinessPayload = await readinessResponse.json();
    assert.equal(readinessPayload.status, "ok");

    const sseResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.EVENTS}`, {
      headers: { accept: "text/event-stream" }
    });
    const reader = sseResponse.body.getReader();
    const collectSseEvent = createSseEventCollector(reader);
    await collectSseEvent(WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT);
    await collectSseEvent(WEB_UI_SSE_EVENT.PROVIDER_READINESS);
    await collectSseEvent(WEB_UI_SSE_EVENT.DEBUG_UPDATE);

    const turnResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.TEXT_TURNS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello web ui smoke" })
    });
    const turnPayload = await turnResponse.json();
    assert.equal(turnPayload.status, "ok");
    assert.equal(turnPayload.payload.submitted_text, "hello web ui smoke");

    const transcriptEvent = await collectTranscriptSnapshotUntil(
      collectSseEvent,
      2
    );
    assert.equal(transcriptEvent.transcript_entries.length, 2);
    const stateResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.DESKTOP_STATE}`);
    const statePayload = await stateResponse.json();
    assert.equal(
      statePayload.payload.companion_session_snapshot.transcript_entries.length,
      2
    );
    await reader.cancel();
  } finally {
    await host.close();
    if (server) {
      await server.close();
    }
    await bridgeProxy.close();
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }

  process.stdout.write("echo web-ui control plane smoke passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
