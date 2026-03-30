import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DesktopCompanionPythonHost } from "./python_companion_host.mjs";
import {
  assertProviderReadinessSnapshot,
  assertProviderSettingsSnapshot,
  buildClearSecretUpdate,
  buildKeepSecretUpdate,
  buildReplaceSecretUpdate
} from "../shared/provider_settings_contracts.mjs";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

function buildRealProviderSavePayload() {
  return {
    local_fast_llm: null,
    cloud_primary_llm: {
      base_url: "https://api.openai.com/v1",
      api_key_update: buildReplaceSecretUpdate("demo-cloud-secret"),
      primary_model_name: "gpt-4.1-mini",
      request_timeout_ms: 30000,
      organization_id: null,
      project_id: null
    },
    qwen_tts: {
      base_url: "https://dashscope.aliyuncs.com/compatible-mode",
      api_key_update: buildReplaceSecretUpdate("demo-qwen-secret"),
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

async function main() {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "echo-desktop-provider-settings-")
  );
  const host = new DesktopCompanionPythonHost({
    workspaceRoot: WORKSPACE_ROOT,
    userDataDirectory,
    onDesktopBridgeRequest: async () => {
      throw new Error("provider settings self-check should not need renderer bridge requests");
    }
  });

  try {
    const initialLoad = await host.loadProviderSettings();
    assertProviderSettingsSnapshot(initialLoad.settings_snapshot);
    assertProviderReadinessSnapshot(initialLoad.readiness);
    if (initialLoad.settings_snapshot.local_fast_llm !== null) {
      throw new Error("default desktop provider settings should leave local fast LLM unconfigured");
    }

    const realSave = await host.saveProviderSettings(buildRealProviderSavePayload());
    assertProviderSettingsSnapshot(realSave.settings_snapshot);
    if (!realSave.settings_snapshot.cloud_primary_llm.api_key.is_configured) {
      throw new Error("cloud secret should be masked as configured after save");
    }
    if (!realSave.settings_snapshot.qwen_tts.api_key.is_configured) {
      throw new Error("tts secret should be masked as configured after save");
    }
    const readiness = await host.getProviderReadiness();
    assertProviderReadinessSnapshot(readiness);
    if (!readiness.runtime_ready) {
      throw new Error("real-provider settings should be assembly-ready after save");
    }
    const validated = await host.validateProviderSettings();
    assertProviderReadinessSnapshot(validated.readiness);
    if (!validated.readiness.runtime_ready) {
      throw new Error("validated real-provider settings should stay runtime-ready");
    }

    process.stdout.write("desktop-live2d provider settings self-check passed\n");
  } finally {
    await host.close();
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
