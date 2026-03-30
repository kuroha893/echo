import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { DesktopWebControlPlaneServer } from "./control_plane_server.mjs";
import {
  WEB_UI_API_ROUTE,
  WEB_UI_SSE_EVENT
} from "./public/control_plane_contracts.mjs";

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

async function main() {
  const transcriptSnapshot = {
    session_id: "00000000-0000-4000-8000-000000000001",
    transcript_entries: [
      {
        role: "assistant",
        text: "hello from self-check"
      }
    ]
  };
  const providerReadiness = {
    runtime_ready: true
  };
  const debugState = {
    category: "self_check",
    message: "ready"
  };
  const avatarModelLibrary = {
    default_model_key: "open-yachiyo-kaguya",
    selected_model_key: "open-yachiyo-kaguya-lite",
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

  const server = new DesktopWebControlPlaneServer({
    operations: {
      async loadAvatarModelLibrary() {
        return avatarModelLibrary;
      },
      async saveAvatarModelSelection(payload) {
        avatarModelLibrary.selected_model_key = payload.selected_model_key;
        return avatarModelLibrary;
      },
      async loadProviderSettings() {
        return {
          settings_snapshot: {
            local_fast_llm: null,
            cloud_primary_llm: {
              base_url: "https://api.openai.com/v1",
              api_key: { is_configured: false },
              primary_model_name: "gpt-4.1-mini",
              request_timeout_ms: 30000,
              organization_id: null,
              project_id: null
            },
            qwen_tts: {
              base_url: "https://dashscope.aliyuncs.com/api/v1",
              api_key: { is_configured: false },
              request_timeout_ms: 30000,
              standard_model_id: "qwen3-tts-flash",
              standard_voice_id: "Cherry",
              realtime_model_id: null,
              realtime_voice_id: null,
              preferred_media_type: "audio/pcm;encoding=s16le",
              voice_profile_key: "desktop.qwen3.current_voice",
              voice_display_name: "Desktop Voice",
              provider_profile_key: "desktop.qwen3.default_profile"
            }
          },
          readiness: providerReadiness
        };
      },
      async saveProviderSettings(payload) {
        assert.equal(payload.local_fast_llm, null);
        return {
          settings_snapshot: payload,
          readiness: providerReadiness
        };
      },
      async validateProviderSettings() {
        return { readiness: providerReadiness };
      },
      async getProviderReadiness() {
        return providerReadiness;
      },
      async snapshotDesktopState() {
        return {
          companion_session_snapshot: transcriptSnapshot
        };
      },
      async submitTextTurn(payload) {
        return {
          submitted_text: payload.text,
          final_desktop_snapshot: {
            companion_session_snapshot: transcriptSnapshot
          }
        };
      },
      async runTtsVoiceEnrollment(payload) {
        return {
          display_name: payload.display_name,
          voice_profile: {
            voice_profile_key: "voice.self-check"
          }
        };
      },
      async getDebugState() {
        return debugState;
      }
    }
  });

  try {
    const origin = await server.start();
    const indexResponse = await fetch(origin);
    assert.equal(indexResponse.status, 200);

    const readinessResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_READINESS}`);
    const readinessPayload = await readinessResponse.json();
    assert.equal(readinessPayload.status, "ok");
    assert.equal(readinessPayload.payload.runtime_ready, true);

    const avatarModelResponse = await fetch(
      `${origin}${WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY}`
    );
    const avatarModelPayload = await avatarModelResponse.json();
    assert.equal(avatarModelPayload.status, "ok");
    assert.equal(avatarModelPayload.payload.selected_model_key, "open-yachiyo-kaguya-lite");
    assert.equal(avatarModelPayload.payload.models.length, 2);

    const avatarModelSaveResponse = await fetch(
      `${origin}${WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selected_model_key: "open-yachiyo-kaguya"
        })
      }
    );
    const avatarModelSavePayload = await avatarModelSaveResponse.json();
    assert.equal(avatarModelSavePayload.status, "ok");
    assert.equal(avatarModelSavePayload.payload.selected_model_key, "open-yachiyo-kaguya");

    const saveResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        local_fast_llm: null,
        cloud_primary_llm: {},
        qwen_tts: {}
      })
    });
    const savePayload = await saveResponse.json();
    assert.equal(savePayload.status, "ok");
    assert.equal(savePayload.payload.settings_snapshot.local_fast_llm, null);

    const uploadResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.TTS_VOICE_ENROLLMENT_UPLOAD}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_name: "self-check.wav",
        media_type: "audio/wav",
        data_base64: Buffer.from("RIFFSELF").toString("base64")
      })
    });
    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadPayload.status, "ok");
    const uploadedPath = uploadPayload.payload.persisted_reference_audio_path;
    const uploadedStats = await fs.stat(uploadedPath);
    assert.ok(uploadedStats.size > 0);

    const sseResponse = await fetch(`${origin}${WEB_UI_API_ROUTE.EVENTS}`, {
      headers: { accept: "text/event-stream" }
    });
    const reader = sseResponse.body.getReader();
    const collectSseEvent = createSseEventCollector(reader);
    const initialTranscript = await collectSseEvent(WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT);
    assert.equal(initialTranscript.transcript_entries.length, 1);
    const initialReadiness = await collectSseEvent(WEB_UI_SSE_EVENT.PROVIDER_READINESS);
    assert.equal(initialReadiness.runtime_ready, true);
    const initialDebug = await collectSseEvent(WEB_UI_SSE_EVENT.DEBUG_UPDATE);
    assert.equal(initialDebug.category, "self_check");

    server.publishTranscriptSnapshot({
      session_id: transcriptSnapshot.session_id,
      transcript_entries: [
        ...transcriptSnapshot.transcript_entries,
        { role: "assistant", text: "stream update" }
      ]
    });
    const pushedTranscript = await collectSseEvent(WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT);
    assert.equal(pushedTranscript.transcript_entries.length, 2);
    await reader.cancel();
  } finally {
    await server.close();
  }

  process.stdout.write("echo web-ui control plane self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
