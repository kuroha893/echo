export const WEB_UI_API_ROUTE = Object.freeze({
  INDEX: "/",
  EVENTS: "/api/events",
  AVATAR_MODEL_LIBRARY: "/api/avatar-model-library",
  PROVIDER_SETTINGS: "/api/provider-settings",
  PROVIDER_SETTINGS_VALIDATE: "/api/provider-settings/validate",
  PROVIDER_READINESS: "/api/provider-readiness",
  DESKTOP_STATE: "/api/desktop-state",
  TEXT_TURNS: "/api/text-turns",
  TTS_VOICE_ENROLLMENT_UPLOAD: "/api/tts-voice-enrollment-upload",
  TTS_VOICE_ENROLLMENT: "/api/tts-voice-enrollment"
});

export const WEB_UI_SSE_EVENT = Object.freeze({
  TRANSCRIPT_SNAPSHOT: "transcript_snapshot",
  PROVIDER_READINESS: "provider_readiness",
  DEBUG_UPDATE: "debug_update"
});

export const WEB_UI_RESPONSE_STATUS = Object.freeze({
  OK: "ok",
  ERROR: "error"
});

export const WEB_UI_ERROR_CODE = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  INTERNAL_ERROR: "internal_error"
});

export class DesktopWebControlPlaneError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DesktopWebControlPlaneError";
    this.httpStatus = options.httpStatus ?? 400;
    this.errorCode = options.errorCode ?? WEB_UI_ERROR_CODE.INVALID_REQUEST;
  }
}

function ensureObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopWebControlPlaneError(`${fieldName} must be an object`);
  }
  return value;
}

function ensureNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DesktopWebControlPlaneError(
      `${fieldName} must be a non-empty string`
    );
  }
  return value;
}

export function buildDefaultLocalFastDraft() {
  return {
    base_url: "http://127.0.0.1:30000/v1",
    auth_mode: "none",
    api_key_update: { mode: "keep" },
    intent_model_name: "qwen3-4b-instruct",
    quick_model_name: "qwen3-4b-instruct",
    local_primary_model_name: "qwen3-8b-instruct",
    request_timeout_ms: 4000
  };
}

export function buildJsonSuccess(payload) {
  return {
    status: WEB_UI_RESPONSE_STATUS.OK,
    payload
  };
}

export function buildJsonError({
  errorCode,
  message,
  details = null
}) {
  return {
    status: WEB_UI_RESPONSE_STATUS.ERROR,
    error_code: errorCode,
    message,
    details
  };
}

export function parseProviderSettingsSavePayload(rawPayload) {
  return ensureObject(rawPayload, "provider_settings_save_payload");
}

export function parseAvatarModelSelectionSavePayload(rawPayload) {
  const payload = ensureObject(rawPayload, "avatar_model_selection_save_payload");
  return {
    selected_model_key: ensureNonEmptyString(
      payload.selected_model_key,
      "selected_model_key"
    )
  };
}

export function parseTextTurnSubmitPayload(rawPayload) {
  const payload = ensureObject(rawPayload, "text_turn_submit_payload");
  return {
    text: ensureNonEmptyString(payload.text, "text")
  };
}

export function parseTTSVoiceEnrollmentPayload(rawPayload) {
  const payload = ensureObject(rawPayload, "tts_voice_enrollment_payload");
  return {
    display_name: ensureNonEmptyString(payload.display_name, "display_name"),
    reference_audio_path: ensureNonEmptyString(
      payload.reference_audio_path,
      "reference_audio_path"
    )
  };
}

export function parseTTSVoiceEnrollmentUploadPayload(rawPayload) {
  const payload = ensureObject(rawPayload, "tts_voice_enrollment_upload_payload");
  const fileName = ensureNonEmptyString(payload.file_name, "file_name");
  const mediaType = ensureNonEmptyString(payload.media_type, "media_type");
  const dataBase64 = ensureNonEmptyString(payload.data_base64, "data_base64");
  if (!mediaType.toLowerCase().startsWith("audio/")) {
    throw new DesktopWebControlPlaneError("media_type must be an audio type");
  }
  return {
    file_name: fileName,
    media_type: mediaType,
    data_base64: dataBase64
  };
}

export function buildSseEventFrame({
  event,
  data
}) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildDebugUpdatePayload({
  category,
  message,
  detail = null
}) {
  return {
    category: ensureNonEmptyString(category, "category"),
    message: ensureNonEmptyString(message, "message"),
    detail,
    emitted_at: new Date().toISOString()
  };
}

export function buildEditableProviderSettingsDraft(settingsSnapshot) {
  const snapshot = ensureObject(settingsSnapshot, "settings_snapshot");
  const localFastSnapshot =
    snapshot.local_fast_llm == null
      ? null
      : ensureObject(snapshot.local_fast_llm, "settings_snapshot.local_fast_llm");
  const {
    api_key: _cloudPrimaryApiKey,
    ...cloudPrimaryLlm
  } = ensureObject(
    snapshot.cloud_primary_llm,
    "settings_snapshot.cloud_primary_llm"
  );
  const {
    api_key: _qwenTtsApiKey,
    ...qwenTts
  } = ensureObject(snapshot.qwen_tts, "settings_snapshot.qwen_tts");
  return {
    local_fast_llm:
      localFastSnapshot == null
        ? null
        : {
          ...Object.fromEntries(
            Object.entries(localFastSnapshot).filter(([key]) => key !== "api_key")
          ),
          api_key_update: { mode: "keep" }
        },
    cloud_primary_llm: {
      ...cloudPrimaryLlm,
      api_key_update: { mode: "keep" }
    },
    qwen_tts: {
      ...qwenTts,
      api_key_update: { mode: "keep" }
    },
    voice_language: snapshot.voice_language || "",
    subtitle_language: snapshot.subtitle_language || ""
  };
}
