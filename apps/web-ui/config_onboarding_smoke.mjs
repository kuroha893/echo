import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { DesktopWebConfigSurfaceController } from "./public/config_surface.mjs";
import { DesktopWebControlPlaneServer } from "./control_plane_server.mjs";
import { WEB_UI_API_ROUTE } from "./public/control_plane_contracts.mjs";

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

function buildMaskedSecretState(isConfigured) {
  return { is_configured: isConfigured === true };
}

function buildSettingsSnapshotFromEditableDraft(draft) {
  return {
    local_fast_llm:
      draft.local_fast_llm == null
        ? null
        : {
            base_url: draft.local_fast_llm.base_url,
            auth_mode: draft.local_fast_llm.auth_mode,
            api_key: buildMaskedSecretState(draft.local_fast_llm.api_key_update?.mode === "replace"),
            intent_model_name: draft.local_fast_llm.intent_model_name,
            quick_model_name: draft.local_fast_llm.quick_model_name,
            local_primary_model_name: draft.local_fast_llm.local_primary_model_name,
            request_timeout_ms: Number(draft.local_fast_llm.request_timeout_ms),
            organization_id: null,
            project_id: null
          },
    cloud_primary_llm: {
      base_url: draft.cloud_primary_llm.base_url,
      api_key: buildMaskedSecretState(draft.cloud_primary_llm.api_key_update?.mode === "replace"),
      primary_model_name: draft.cloud_primary_llm.primary_model_name,
      request_timeout_ms: Number(draft.cloud_primary_llm.request_timeout_ms),
      organization_id: draft.cloud_primary_llm.organization_id || null,
      project_id: draft.cloud_primary_llm.project_id || null
    },
    qwen_tts: {
      base_url: draft.qwen_tts.base_url,
      api_key: buildMaskedSecretState(draft.qwen_tts.api_key_update?.mode === "replace"),
      request_timeout_ms: Number(draft.qwen_tts.request_timeout_ms),
      standard_model_id: draft.qwen_tts.standard_model_id,
      standard_voice_id: draft.qwen_tts.standard_voice_id,
      realtime_model_id: draft.qwen_tts.realtime_model_id || null,
      realtime_voice_id: draft.qwen_tts.realtime_voice_id || null,
      preferred_media_type: draft.qwen_tts.preferred_media_type,
      voice_profile_key: draft.qwen_tts.voice_profile_key,
      voice_display_name: draft.qwen_tts.voice_display_name,
      provider_profile_key: draft.qwen_tts.provider_profile_key
    }
  };
}

function buildReadinessSnapshot(settingsSnapshot, voiceEnrollmentReady) {
  const cloudReady = settingsSnapshot.cloud_primary_llm.api_key.is_configured;
  const qwenReady = settingsSnapshot.qwen_tts.api_key.is_configured;
  const runtimeReady = cloudReady && qwenReady && voiceEnrollmentReady;
  return {
    runtime_ready: runtimeReady,
    runtime_message: runtimeReady ? "Runtime ready" : "Provider stack still needs setup",
    local_fast_llm: {
      ready: settingsSnapshot.local_fast_llm != null,
      message:
        settingsSnapshot.local_fast_llm != null
          ? "browser smoke local endpoint"
          : "not configured; cloud-only production path will be used"
    },
    cloud_primary_llm: {
      ready: cloudReady,
      message: cloudReady ? "configured" : "missing API key"
    },
    qwen_tts: {
      ready: qwenReady,
      message: qwenReady ? "configured" : "missing API key"
    },
    voice_enrollment: {
      ready: voiceEnrollmentReady,
      message: voiceEnrollmentReady ? "voice ready" : "voice not enrolled"
    }
  };
}

function createOriginBoundClient(origin) {
  return {
    async loadAvatarModelLibrary() {
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY}`);
      const payload = await response.json();
      return payload.payload;
    },
    async saveAvatarModelSelection(selectionPayload) {
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectionPayload)
      });
      const payload = await response.json();
      return payload.payload;
    },
    async loadProviderSettings() {
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS}`);
      const payload = await response.json();
      return payload.payload;
    },
    async saveProviderSettings(settingsPayload) {
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsPayload)
      });
      const payload = await response.json();
      return payload.payload;
    },
    async validateProviderSettings() {
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.PROVIDER_SETTINGS_VALIDATE}`, {
        method: "POST"
      });
      const payload = await response.json();
      return payload.payload;
    },
    async uploadVoiceEnrollmentAudio(file) {
      const arrayBuffer = await file.arrayBuffer();
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.TTS_VOICE_ENROLLMENT_UPLOAD}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          media_type: file.type,
          data_base64: Buffer.from(arrayBuffer).toString("base64")
        })
      });
      const payload = await response.json();
      return payload.payload;
    },
    async runTtsVoiceEnrollment(enrollmentPayload) {
      const response = await fetch(`${origin}${WEB_UI_API_ROUTE.TTS_VOICE_ENROLLMENT}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enrollmentPayload)
      });
      const payload = await response.json();
      return payload.payload;
    }
  };
}

async function main() {
  const indexHtml = await fs.readFile(
    new URL("./public/index.html", import.meta.url),
    "utf8"
  );
  const configHtml = await fs.readFile(
    new URL("./public/config-v2.html", import.meta.url),
    "utf8"
  );
  const onboardingHtml = await fs.readFile(
    new URL("./public/onboarding.html", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(indexHtml, /onboarding\.html/i);
  assert.doesNotMatch(configHtml, /Open onboarding|onboarding\.html/i);
  assert.match(configHtml, /voice enrollment/i);
  assert.doesNotMatch(configHtml, /Reference audio path/i);
  assert.match(onboardingHtml, /Onboarding moved to Config v2/i);

  let voiceEnrollmentReady = false;
  let lastEnrollmentPayload = null;
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
  let settingsSnapshot = buildSettingsSnapshotFromEditableDraft({
    local_fast_llm: null,
    cloud_primary_llm: {
      base_url: "https://api.openai.com/v1",
      api_key_update: { mode: "keep" },
      primary_model_name: "gpt-4.1-mini",
      request_timeout_ms: 30000,
      organization_id: null,
      project_id: null
    },
    qwen_tts: {
      base_url: "https://dashscope.aliyuncs.com/api/v1",
      api_key_update: { mode: "keep" },
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
  });
  let readinessSnapshot = buildReadinessSnapshot(settingsSnapshot, voiceEnrollmentReady);

  const server = new DesktopWebControlPlaneServer({
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
        return {
          settings_snapshot: settingsSnapshot,
          readiness: readinessSnapshot
        };
      },
      async saveProviderSettings(payload) {
        settingsSnapshot = buildSettingsSnapshotFromEditableDraft(payload);
        readinessSnapshot = buildReadinessSnapshot(settingsSnapshot, voiceEnrollmentReady);
        return {
          settings_snapshot: settingsSnapshot,
          readiness: readinessSnapshot
        };
      },
      async validateProviderSettings() {
        readinessSnapshot = buildReadinessSnapshot(settingsSnapshot, voiceEnrollmentReady);
        return {
          settings_snapshot: settingsSnapshot,
          readiness: readinessSnapshot
        };
      },
      async getProviderReadiness() {
        return readinessSnapshot;
      },
      async snapshotDesktopState() {
        return { companion_session_snapshot: null };
      },
      async submitTextTurn() {
        return {
          submitted_text: "smoke",
          final_desktop_snapshot: { companion_session_snapshot: null }
        };
      },
      async runTtsVoiceEnrollment(payload) {
        lastEnrollmentPayload = payload;
        const persistedStats = await fs.stat(payload.reference_audio_path);
        assert.ok(persistedStats.size > 0);
        voiceEnrollmentReady = true;
        settingsSnapshot = {
          ...settingsSnapshot,
          qwen_tts: {
            ...settingsSnapshot.qwen_tts,
            standard_model_id: "qwen3-tts-vc-2026-01-22",
            standard_voice_id: "qwen-tts-vc-smoke",
            voice_display_name: payload.display_name
          }
        };
        readinessSnapshot = buildReadinessSnapshot(settingsSnapshot, voiceEnrollmentReady);
        return {
          voice_profile: {
            voice_profile_key: "desktop.qwen3.current_voice",
            display_name: payload.display_name
          }
        };
      },
      async getDebugState() {
        return {
          category: "smoke",
          message: "ready"
        };
      }
    }
  });

  const origin = await server.start();
  try {
    const configPageResponse = await fetch(`${origin}/config-v2.html`);
    assert.equal(configPageResponse.status, 200);
    assert.match(await configPageResponse.text(), /Config v2/i);

    const onboardingPageResponse = await fetch(`${origin}/onboarding.html`);
    assert.equal(onboardingPageResponse.status, 200);
    assert.match(await onboardingPageResponse.text(), /Onboarding moved to Config v2/i);

    const client = createOriginBoundClient(origin);

    const configShell = new FakeShell();
    const configController = new DesktopWebConfigSurfaceController({
      shell: configShell,
      client
    });
    await configController.boot();
    configShell.handlers.onSelectTab("avatar_model");
    await configShell.handlers.onSaveAvatarModelSelection("open-yachiyo-kaguya-lite");
    assert.equal(
      configShell.lastViewModel.sections.avatar_model.selectedModelKey,
      "open-yachiyo-kaguya-lite"
    );

    configShell.handlers.onSelectTab("cloud_primary_llm");
    configShell.handlers.onFieldChange({
      path: "cloud_primary_llm.api_key_update.mode",
      value: "replace"
    });
    configShell.handlers.onFieldChange({
      path: "cloud_primary_llm.api_key_update.replacement_text",
      value: "sk-browser-cloud"
    });
    configShell.handlers.onSelectTab("qwen_tts");
    configShell.handlers.onFieldChange({
      path: "qwen_tts.api_key_update.mode",
      value: "replace"
    });
    configShell.handlers.onFieldChange({
      path: "qwen_tts.api_key_update.replacement_text",
      value: "sk-browser-qwen"
    });
    await configShell.handlers.onSave();

    configShell.handlers.onSelectTab("voice_enrollment");
    configShell.handlers.onFieldChange({
      path: "voice_enrollment.display_name",
      value: "Smoke Voice"
    });
    configShell.handlers.onEnrollmentFileSelected({
      name: "smoke-reference.wav",
      type: "audio/wav",
      size: 4096,
      async arrayBuffer() {
        return new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 65, 86, 69]).buffer;
      }
    });
    await configShell.handlers.onRunEnrollment();
    await configShell.handlers.onValidate();

    assert.equal(lastEnrollmentPayload.display_name, "Smoke Voice");
    assert.match(lastEnrollmentPayload.reference_audio_path, /echo-web-ui/i);
    assert.equal(
      configShell.lastViewModel.sections.voice_enrollment.resultItems[0].value,
      "desktop.qwen3.current_voice"
    );
    assert.equal(
      configShell.lastViewModel.readinessItems.find((item) => item.label === "Voice enrollment").ready,
      true
    );
    assert.equal(
      settingsSnapshot.cloud_primary_llm.api_key.is_configured &&
        settingsSnapshot.qwen_tts.api_key.is_configured,
      true
    );
    assert.equal(settingsSnapshot.qwen_tts.standard_voice_id, "qwen-tts-vc-smoke");

    process.stdout.write("echo web-ui config/onboarding smoke passed\n");
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
