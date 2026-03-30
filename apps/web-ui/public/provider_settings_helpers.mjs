import {
  buildDefaultLocalFastDraft,
  buildEditableProviderSettingsDraft
} from "./control_plane_contracts.mjs";

export function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function buildProviderSettingsDraft(settingsSnapshot) {
  return buildEditableProviderSettingsDraft(settingsSnapshot);
}

export function buildLocalFastDraftTemplate() {
  return buildDefaultLocalFastDraft();
}

export function describeLocalFastAcceleration(settingsSnapshot, readiness) {
  const configured = settingsSnapshot?.local_fast_llm != null;
  const readinessMessage = readiness?.local_fast_llm?.message || "";
  if (configured) {
    return {
      value: "configured",
      meta:
        readinessMessage
          ? `Optional accelerator configured. ${readinessMessage}`
          : "Optional accelerator for faster local quick and intent routes."
    };
  }
  return {
    value: "not configured",
    meta:
      readinessMessage
        ? `Optional accelerator not configured. ${readinessMessage}`
        : "Optional accelerator only. Echo stays on the required cloud primary path."
  };
}

export function getMaskedSecretLabel(maskedSecretState) {
  return maskedSecretState?.is_configured ? "configured" : "not configured";
}

export function setValueByPath(target, path, value) {
  const segments = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (cursor[key] === null || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

export function getValueByPath(target, path) {
  return String(path)
    .split(".")
    .reduce((cursor, key) => (cursor === null || cursor === undefined ? undefined : cursor[key]), target);
}

export function summarizeProviderReadiness(readiness) {
  if (!readiness) {
    return {
      runtimeStatus: "Connecting",
      runtimeMessage: "Loading provider readiness..."
    };
  }
  return {
    runtimeStatus: readiness.runtime_ready ? "Ready" : "Needs attention",
    runtimeMessage: readiness.runtime_message || "No readiness detail available"
  };
}

export function buildProviderReadinessItems(readiness) {
  if (!readiness) {
    return [];
  }
  return [
    ["Local fast LLM", readiness.local_fast_llm],
    ["Cloud primary LLM", readiness.cloud_primary_llm],
    ["Qwen TTS", readiness.qwen_tts],
    ["Voice enrollment", readiness.voice_enrollment]
  ].map(([label, item]) => ({
    label,
    ready: item?.ready === true,
    message: item?.message || ""
  }));
}
