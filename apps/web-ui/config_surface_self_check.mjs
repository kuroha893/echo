import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { DesktopWebConfigSurfaceController } from "./public/config_surface.mjs";
import { buildProviderSettingsDraft } from "./public/provider_settings_helpers.mjs";

class FakeShell {
  constructor() {
    this.handlers = null;
    this.lastViewModel = null;
    this.rendered = [];
  }

  attach(handlers) {
    this.handlers = handlers;
  }

  render(viewModel) {
    this.lastViewModel = viewModel;
    this.rendered.push(viewModel);
  }
}

function buildSettingsSnapshot() {
  return {
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
      api_key: { is_configured: true },
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
  };
}

function buildReadinessSnapshot(overrides = {}) {
  return {
    runtime_ready: false,
    runtime_message: "Cloud primary still needs a key",
    local_fast_llm: { ready: false, message: "not configured; cloud-only production path will be used" },
    cloud_primary_llm: { ready: false, message: "missing API key" },
    qwen_tts: { ready: true, message: "configured" },
    voice_enrollment: { ready: false, message: "no enrollment yet" },
    ...overrides
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
  const configSurfaceSource = await fs.readFile(
    new URL("./public/config_surface.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(indexHtml, /onboarding\.html/i);
  assert.doesNotMatch(configHtml, /Open onboarding|onboarding\.html/i);
  assert.doesNotMatch(configHtml, /demo_scripted|real_provider_stack|selected_mode|demo mode|scripted mode/i);
  assert.match(configHtml, /voice enrollment/i);
  assert.match(configSurfaceSource, /Drop an audio sample here/i);
  assert.doesNotMatch(configSurfaceSource, /Reference audio path/i);

  const shell = new FakeShell();
  let latestSettingsSnapshot = buildSettingsSnapshot();
  let latestReadinessSnapshot = buildReadinessSnapshot();
  let avatarModelLibrary = {
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
  let savedPayload = null;
  let enrollmentPayload = null;
  let uploadPayload = null;
  let savedAvatarModelPayload = null;
  const initialDraft = buildProviderSettingsDraft(latestSettingsSnapshot);
  assert.equal(initialDraft.local_fast_llm, null);

  const controller = new DesktopWebConfigSurfaceController({
    shell,
    client: {
      async loadAvatarModelLibrary() {
        return avatarModelLibrary;
      },
      async saveAvatarModelSelection(payload) {
        savedAvatarModelPayload = payload;
        avatarModelLibrary = {
          ...avatarModelLibrary,
          selected_model_key: payload.selected_model_key
        };
        return avatarModelLibrary;
      },
      async loadProviderSettings() {
        return {
          settings_snapshot: latestSettingsSnapshot,
          readiness: latestReadinessSnapshot
        };
      },
      async saveProviderSettings(settingsPayload) {
        savedPayload = settingsPayload;
        latestSettingsSnapshot = {
          ...latestSettingsSnapshot,
          cloud_primary_llm: {
            ...latestSettingsSnapshot.cloud_primary_llm,
            primary_model_name: settingsPayload.cloud_primary_llm.primary_model_name,
            api_key: {
              is_configured:
                settingsPayload.cloud_primary_llm.api_key_update?.mode === "replace"
            }
          }
        };
        return {
          settings_snapshot: latestSettingsSnapshot,
          readiness: latestReadinessSnapshot
        };
      },
      async validateProviderSettings() {
        latestReadinessSnapshot = buildReadinessSnapshot({
          runtime_ready: true,
          runtime_message: "Runtime ready",
          cloud_primary_llm: { ready: true, message: "configured" },
          voice_enrollment: { ready: true, message: "voice ready" }
        });
        return { readiness: latestReadinessSnapshot };
      },
      async runTtsVoiceEnrollment(payload) {
        enrollmentPayload = payload;
        latestReadinessSnapshot = buildReadinessSnapshot({
          cloud_primary_llm: latestReadinessSnapshot.cloud_primary_llm,
          voice_enrollment: { ready: true, message: "voice ready" }
        });
        latestSettingsSnapshot = {
          ...latestSettingsSnapshot,
          qwen_tts: {
            ...latestSettingsSnapshot.qwen_tts,
            standard_voice_id: "qwen-tts-vc-self-check",
            voice_display_name: payload.display_name
          }
        };
        return {
          voice_profile: {
            voice_profile_key: "desktop.qwen3.current_voice",
            display_name: payload.display_name
          }
        };
      },
      async uploadVoiceEnrollmentAudio(file) {
        uploadPayload = file;
        return {
          persisted_reference_audio_path: "C:\\temp\\voice-self-check.wav"
        };
      }
    }
  });

  await controller.boot();
  assert.equal(shell.lastViewModel.activeTabId, "overview");
  assert.equal(shell.lastViewModel.overviewCards.length, 4);
  assert.equal(shell.lastViewModel.readinessSummary.runtimeStatus, "Needs attention");
  assert.deepEqual(
    shell.lastViewModel.tabs.map((tab) => tab.id),
    ["overview", "avatar_model", "local_fast_llm", "cloud_primary_llm", "qwen_tts", "voice_enrollment", "readiness"]
  );
  assert.equal(
    shell.lastViewModel.overviewCards[0].value,
    "Open Yachiyo Kaguya Lite"
  );

  shell.handlers.onSelectTab("avatar_model");
  assert.equal(shell.lastViewModel.sections.avatar_model.models.length, 2);
  assert.equal(
    shell.lastViewModel.sections.avatar_model.selectedModelKey,
    "open-yachiyo-kaguya-lite"
  );
  await shell.handlers.onSaveAvatarModelSelection("open-yachiyo-kaguya");
  assert.equal(savedAvatarModelPayload.selected_model_key, "open-yachiyo-kaguya");
  assert.equal(
    shell.lastViewModel.sections.avatar_model.selectedModelKey,
    "open-yachiyo-kaguya"
  );

  shell.handlers.onSelectTab("voice_enrollment");
  assert.equal(shell.lastViewModel.sections.voice_enrollment.fields.length, 1);
  shell.handlers.onEnrollmentFileSelected({
    name: "notes.txt",
    type: "text/plain",
    size: 24,
    async arrayBuffer() {
      return new Uint8Array([1, 2, 3]).buffer;
    }
  });
  assert.match(
    shell.lastViewModel.sections.voice_enrollment.selectionErrorText,
    /audio files/i
  );
  shell.handlers.onFieldChange({
    path: "voice_enrollment.display_name",
    value: "Browser Voice"
  });
  shell.handlers.onEnrollmentFileSelected({
    name: "browser-reference.wav",
    type: "audio/wav",
    size: 4096,
    async arrayBuffer() {
      return new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0]).buffer;
    }
  });
  await shell.handlers.onRunEnrollment();
  assert.equal(uploadPayload.name, "browser-reference.wav");
  assert.equal(enrollmentPayload.display_name, "Browser Voice");
  assert.equal(enrollmentPayload.reference_audio_path, "C:\\temp\\voice-self-check.wav");
  assert.equal(shell.lastViewModel.sections.voice_enrollment.resultItems[0].value, "desktop.qwen3.current_voice");
  assert.equal(shell.lastViewModel.sections.voice_enrollment.activeVoiceCards[1].value, "qwen-tts-vc-self-check");

  shell.handlers.onSelectTab("local_fast_llm");
  shell.handlers.onEnableLocalFast();
  assert.equal(shell.lastViewModel.sections.local_fast_llm.isConfigured, true);
  assert.equal(
    controller._state.draft.local_fast_llm.base_url,
    "http://127.0.0.1:30000/v1"
  );
  shell.handlers.onDisableLocalFast();
  assert.equal(controller._state.draft.local_fast_llm, null);

  shell.handlers.onSelectTab("cloud_primary_llm");
  shell.handlers.onFieldChange({
    path: "cloud_primary_llm.primary_model_name",
    value: "gpt-5-mini"
  });
  shell.handlers.onFieldChange({
    path: "cloud_primary_llm.api_key_update.mode",
    value: "replace"
  });
  shell.handlers.onFieldChange({
    path: "cloud_primary_llm.api_key_update.replacement_text",
    value: "sk-config-self-check"
  });
  await shell.handlers.onSave();

  assert.equal(savedPayload.local_fast_llm, null);
  assert.equal(savedPayload.cloud_primary_llm.primary_model_name, "gpt-5-mini");
  assert.equal(savedPayload.cloud_primary_llm.api_key_update.mode, "replace");
  assert.equal(
    savedPayload.cloud_primary_llm.api_key_update.replacement_text,
    "sk-config-self-check"
  );

  await shell.handlers.onValidate();
  shell.handlers.onSelectTab("readiness");
  assert.equal(shell.lastViewModel.readinessSummary.runtimeStatus, "Ready");
  assert.equal(
    shell.lastViewModel.readinessItems.find((item) => item.label === "Cloud primary LLM").ready,
    true
  );

  process.stdout.write("echo web-ui config surface self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
