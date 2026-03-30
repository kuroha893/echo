export const DESKTOP_SECRET_UPDATE_MODE = Object.freeze({
  KEEP: "keep",
  REPLACE: "replace",
  CLEAR: "clear"
});

export function buildKeepSecretUpdate() {
  return {
    mode: DESKTOP_SECRET_UPDATE_MODE.KEEP
  };
}

export function buildReplaceSecretUpdate(replacementText) {
  if (typeof replacementText !== "string" || replacementText.trim() === "") {
    throw new Error("replacementText must be a non-empty string");
  }
  return {
    mode: DESKTOP_SECRET_UPDATE_MODE.REPLACE,
    replacement_text: replacementText
  };
}

export function buildClearSecretUpdate() {
  return {
    mode: DESKTOP_SECRET_UPDATE_MODE.CLEAR
  };
}

export function assertMaskedSecretState(value, fieldName = "masked secret state") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  if (typeof value.is_configured !== "boolean") {
    throw new Error(`${fieldName}.is_configured must be a boolean`);
  }
  return value;
}

export function assertProviderSettingsSnapshot(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("provider settings snapshot must be an object");
  }
  if (value.local_fast_llm != null) {
    assertMaskedSecretState(value.local_fast_llm?.api_key, "local_fast_llm.api_key");
  }
  assertMaskedSecretState(
    value.cloud_primary_llm?.api_key,
    "cloud_primary_llm.api_key"
  );
  assertMaskedSecretState(value.qwen_tts?.api_key, "qwen_tts.api_key");
  return value;
}

export function assertProviderReadinessSnapshot(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("provider readiness snapshot must be an object");
  }
  if (typeof value.runtime_ready !== "boolean") {
    throw new Error("provider readiness snapshot.runtime_ready must be a boolean");
  }
  return value;
}
