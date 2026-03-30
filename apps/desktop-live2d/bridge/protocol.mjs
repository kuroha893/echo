function buildRandomUuidFallback() {
  const randomBytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let index = 0; index < randomBytes.length; index += 1) {
      randomBytes[index] = Math.floor(Math.random() * 256);
    }
  }
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(randomBytes, (value) =>
    value.toString(16).padStart(2, "0")
  );
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

function buildRandomUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return buildRandomUuidFallback();
}

function resolveBridgeProtocolVersion() {
  if (
    typeof process !== "undefined" &&
    process?.env &&
    typeof process.env.ECHO_DESKTOP_LIVE2D_PROTOCOL_VERSION === "string" &&
    process.env.ECHO_DESKTOP_LIVE2D_PROTOCOL_VERSION.trim() !== ""
  ) {
    return process.env.ECHO_DESKTOP_LIVE2D_PROTOCOL_VERSION;
  }
  return "echo.desktop-live2d.bridge.v1";
}

export const BRIDGE_PROTOCOL_VERSION =
  resolveBridgeProtocolVersion();
export const APP_NAME = "echo-desktop-live2d";
export const BRIDGE_COMMAND = Object.freeze({
  PING: "ping",
  INITIALIZE: "initialize",
  DISPATCH_COMMAND: "dispatch_command",
  AUDIO_PLAYBACK_FRAGMENT: "audio_playback_fragment",
  AUDIO_PLAYBACK_ABORT: "audio_playback_abort",
  AUDIO_PLAYBACK_SNAPSHOT: "audio_playback_snapshot",
  COMPANION_SESSION_UPSERT_TRANSCRIPT: "companion_session_upsert_transcript",
  COMPANION_SESSION_SNAPSHOT: "companion_session_snapshot",
  COMPANION_SESSION_ENQUEUE_INPUT: "companion_session_enqueue_input",
  COMPANION_SESSION_DRAIN_INPUT: "companion_session_drain_input",
  BUBBLE_REPLACE: "bubble_replace",
  BUBBLE_APPEND: "bubble_append",
  BUBBLE_CLEAR: "bubble_clear",
  BUBBLE_SNAPSHOT: "bubble_snapshot",
  SHUTDOWN: "shutdown"
});
export const BRIDGE_STATUS = Object.freeze({
  OK: "ok",
  ERROR: "error"
});
export const BRIDGE_ERROR_CODE = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  INVALID_MODEL_ASSET: "invalid_model_asset",
  NOT_INITIALIZED: "not_initialized",
  UNSUPPORTED_COMMAND: "unsupported_command",
  UNSUPPORTED_TARGET: "unsupported_target",
  ADAPTER_UNAVAILABLE: "adapter_unavailable",
  TIMEOUT: "timeout",
  CANCELLED: "cancelled",
  PROTOCOL_ERROR: "protocol_error",
  INTERNAL_APP_ERROR: "internal_app_error"
});
export const SUPPORTED_COMMAND_TYPES = new Set([
  "set_state",
  "set_expression",
  "set_motion",
  "clear_expression"
]);
export const SUPPORTED_TARGETS = new Set([
  "state",
  "expression",
  "motion",
  "avatar.state",
  "avatar.expression",
  "avatar.face",
  "avatar.motion"
]);
export const SUPPORTED_AUDIO_PLAYBACK_OWNERS = new Set([
  "quick_reaction",
  "primary_response"
]);
export const SUPPORTED_AUDIO_MEDIA_TYPES = new Set([
  "audio/wav",
  "audio/pcm;encoding=s16le",
  "audio/mpeg",
  "audio/ogg;codecs=opus"
]);
export const SUPPORTED_COMPANION_TRANSCRIPT_ROLES = new Set([
  "user",
  "assistant"
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DesktopLive2DBridgeProtocolError extends Error {
  constructor({
    bridgeCommand,
    errorCode,
    message,
    retryable = false,
    commandId = null,
    commandType = null,
    rawErrorType = null
  }) {
    super(message);
    this.name = "DesktopLive2DBridgeProtocolError";
    this.bridgeCommand = bridgeCommand;
    this.errorCode = errorCode;
    this.retryable = retryable;
    this.commandId = commandId;
    this.commandType = commandType;
    this.rawErrorType = rawErrorType;
  }
}

function ensureObject(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function ensureString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function ensureBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function ensureOptionalNumber(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${fieldName} must be numeric when present`);
  }
  return value;
}

function ensureOptionalPositiveInteger(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer when present`);
  }
  return value;
}

function ensurePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return value;
}

function ensureNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function ensureUuidLike(value, fieldName) {
  const normalized = ensureString(value, fieldName);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a UUID`);
  }
  return normalized.toLowerCase();
}

export function buildOkEnvelope({
  requestId,
  bridgeCommand,
  payload
}) {
  return {
    request_id: requestId,
    status: BRIDGE_STATUS.OK,
    bridge_command: bridgeCommand,
    ...payload
  };
}

export function buildErrorEnvelope({
  requestId,
  bridgeCommand,
  errorCode,
  message,
  retryable = false,
  commandId = null,
  commandType = null,
  rawErrorType = null
}) {
  return {
    request_id: requestId,
    status: BRIDGE_STATUS.ERROR,
    bridge_command: bridgeCommand,
    error_code: errorCode,
    message,
    retryable,
    command_id: commandId,
    command_type: commandType,
    raw_error_type: rawErrorType
  };
}

export function buildProtocolErrorFromUnknown({
  bridgeCommand,
  error
}) {
  if (error instanceof DesktopLive2DBridgeProtocolError) {
    return error;
  }
  if (error instanceof SyntaxError) {
    return new DesktopLive2DBridgeProtocolError({
      bridgeCommand,
      errorCode: BRIDGE_ERROR_CODE.PROTOCOL_ERROR,
      message: error.message,
      retryable: false,
      rawErrorType: error.name
    });
  }
  return new DesktopLive2DBridgeProtocolError({
    bridgeCommand,
    errorCode: BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
    message: error instanceof Error ? error.message : "desktop-live2d bridge failed",
    retryable: false,
    rawErrorType: error instanceof Error ? error.name : typeof error
  });
}

function validateModelAsset(rawModelAsset) {
  const modelAsset = ensureObject(rawModelAsset, "model_asset must be an object");
  const modelKey = ensureString(modelAsset.model_key, "model_asset.model_key");
  const repoRelativeModelJsonPath = ensureString(
    modelAsset.repo_relative_model_json_path,
    "model_asset.repo_relative_model_json_path"
  );
  const displayName = ensureString(modelAsset.display_name, "model_asset.display_name");
  const presentationMode = ensureString(
    modelAsset.presentation_mode,
    "model_asset.presentation_mode"
  );
  const windowSurface = ensureString(
    modelAsset.window_surface,
    "model_asset.window_surface"
  );
  return {
    model_key: modelKey,
    repo_relative_model_json_path: repoRelativeModelJsonPath,
    display_name: displayName,
    presentation_mode: presentationMode,
    window_surface: windowSurface
  };
}

function validateDispatchRequest(rawEnvelope) {
  const commandType = ensureString(rawEnvelope.command_type, "command_type");
  const target = ensureString(rawEnvelope.target, "target");
  return {
    protocol_version: ensureString(rawEnvelope.protocol_version, "protocol_version"),
    request_id: ensureUuidLike(rawEnvelope.request_id, "request_id"),
    bridge_command: BRIDGE_COMMAND.DISPATCH_COMMAND,
    adapter_key: ensureString(rawEnvelope.adapter_key, "adapter_key"),
    adapter_profile_key:
      rawEnvelope.adapter_profile_key === null || rawEnvelope.adapter_profile_key === undefined
        ? null
        : ensureString(rawEnvelope.adapter_profile_key, "adapter_profile_key"),
    command_id: ensureUuidLike(rawEnvelope.command_id, "command_id"),
    command_type: commandType,
    target,
    value: rawEnvelope.value,
    intensity: ensureOptionalNumber(rawEnvelope.intensity, "intensity"),
    duration_ms: ensureOptionalPositiveInteger(rawEnvelope.duration_ms, "duration_ms"),
    is_interruptible: ensureBoolean(rawEnvelope.is_interruptible, "is_interruptible")
  };
}

function validateBubbleText(value, fieldName, maxLength = 4000) {
  const normalized = ensureString(value, fieldName);
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} must not exceed ${maxLength} characters`);
  }
  return normalized;
}

function validateAudioPlaybackOwner(value) {
  const normalized = ensureString(value, "owner");
  if (!SUPPORTED_AUDIO_PLAYBACK_OWNERS.has(normalized)) {
    throw new Error(`owner '${normalized}' is unsupported for desktop audio playback`);
  }
  return normalized;
}

function validateAudioMediaType(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = ensureString(value, "media_type");
  if (!SUPPORTED_AUDIO_MEDIA_TYPES.has(normalized)) {
    throw new Error(`media_type '${normalized}' is unsupported for desktop audio playback`);
  }
  return normalized;
}

function validateCompanionTranscriptRole(value) {
  const normalized = ensureString(value, "role").toLowerCase();
  if (!SUPPORTED_COMPANION_TRANSCRIPT_ROLES.has(normalized)) {
    throw new Error(
      `role '${normalized}' is unsupported for desktop companion transcript`
    );
  }
  return normalized;
}

export function parseIncomingJsonLine(rawLine) {
  const parsed = JSON.parse(rawLine);
  const envelope = ensureObject(parsed, "bridge request must be a JSON object");
  const bridgeCommand = ensureString(envelope.bridge_command, "bridge_command");
  switch (bridgeCommand) {
    case BRIDGE_COMMAND.PING:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.PING
      };
    case BRIDGE_COMMAND.INITIALIZE:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.INITIALIZE,
        model_asset: validateModelAsset(envelope.model_asset),
        full_body_required: ensureBoolean(envelope.full_body_required, "full_body_required")
      };
    case BRIDGE_COMMAND.DISPATCH_COMMAND:
      return validateDispatchRequest(envelope);
    case BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT,
        session_id: ensureUuidLike(envelope.session_id, "session_id"),
        trace_id: ensureUuidLike(envelope.trace_id, "trace_id"),
        turn_id: ensureUuidLike(envelope.turn_id, "turn_id"),
        owner: validateAudioPlaybackOwner(envelope.owner),
        tts_stream_id: ensureUuidLike(envelope.tts_stream_id, "tts_stream_id"),
        chunk_index: ensureNonNegativeInteger(envelope.chunk_index, "chunk_index"),
        tts_text: validateBubbleText(envelope.tts_text, "tts_text"),
        is_interruptible: ensureBoolean(envelope.is_interruptible, "is_interruptible"),
        fragment_index: ensureNonNegativeInteger(
          envelope.fragment_index,
          "fragment_index"
        ),
        audio_bytes_base64: validateBubbleText(
          envelope.audio_bytes_base64,
          "audio_bytes_base64",
          8_000_000
        ),
        sample_rate_hz: ensurePositiveInteger(
          envelope.sample_rate_hz,
          "sample_rate_hz"
        ),
        channel_count: ensurePositiveInteger(
          envelope.channel_count,
          "channel_count"
        ),
        is_final: ensureBoolean(envelope.is_final, "is_final"),
        media_type: validateAudioMediaType(envelope.media_type)
      };
    case BRIDGE_COMMAND.AUDIO_PLAYBACK_ABORT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.AUDIO_PLAYBACK_ABORT,
        session_id: ensureUuidLike(envelope.session_id, "session_id"),
        trace_id: ensureUuidLike(envelope.trace_id, "trace_id"),
        turn_id: ensureUuidLike(envelope.turn_id, "turn_id"),
        owner: validateAudioPlaybackOwner(envelope.owner),
        tts_stream_id: ensureUuidLike(envelope.tts_stream_id, "tts_stream_id"),
        chunk_index: ensureNonNegativeInteger(envelope.chunk_index, "chunk_index"),
        reason: validateBubbleText(envelope.reason, "reason", 256)
      };
    case BRIDGE_COMMAND.AUDIO_PLAYBACK_SNAPSHOT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.AUDIO_PLAYBACK_SNAPSHOT
      };
    case BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT,
        session_id: ensureUuidLike(envelope.session_id, "session_id"),
        turn_id: ensureUuidLike(envelope.turn_id, "turn_id"),
        role: validateCompanionTranscriptRole(envelope.role),
        text: validateBubbleText(envelope.text, "text", 8000),
        raw_text: typeof envelope.raw_text === "string" ? envelope.raw_text.slice(0, 16000) : "",
        is_streaming: ensureBoolean(envelope.is_streaming, "is_streaming")
      };
    case BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT
      };
    case BRIDGE_COMMAND.COMPANION_SESSION_ENQUEUE_INPUT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.COMPANION_SESSION_ENQUEUE_INPUT,
        session_id: ensureUuidLike(envelope.session_id, "session_id"),
        text: validateBubbleText(envelope.text, "text", 4000)
      };
    case BRIDGE_COMMAND.COMPANION_SESSION_DRAIN_INPUT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.COMPANION_SESSION_DRAIN_INPUT,
        session_id: ensureUuidLike(envelope.session_id, "session_id")
      };
    case BRIDGE_COMMAND.BUBBLE_REPLACE:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.BUBBLE_REPLACE,
        bubble_text: validateBubbleText(envelope.bubble_text, "bubble_text"),
        speaker_label: validateBubbleText(
          envelope.speaker_label ?? "Echo",
          "speaker_label",
          64
        ),
        is_streaming: ensureBoolean(envelope.is_streaming, "is_streaming")
      };
    case BRIDGE_COMMAND.BUBBLE_APPEND:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.BUBBLE_APPEND,
        text_fragment: validateBubbleText(
          envelope.text_fragment,
          "text_fragment",
          2000
        ),
        speaker_label:
          envelope.speaker_label === null || envelope.speaker_label === undefined
            ? null
            : validateBubbleText(envelope.speaker_label, "speaker_label", 64),
        is_streaming: ensureBoolean(envelope.is_streaming, "is_streaming")
      };
    case BRIDGE_COMMAND.BUBBLE_CLEAR:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.BUBBLE_CLEAR,
        reason: validateBubbleText(envelope.reason, "reason", 512)
      };
    case BRIDGE_COMMAND.BUBBLE_SNAPSHOT:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.BUBBLE_SNAPSHOT
      };
    case BRIDGE_COMMAND.SHUTDOWN:
      return {
        protocol_version: ensureString(envelope.protocol_version, "protocol_version"),
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_command: BRIDGE_COMMAND.SHUTDOWN,
        reason: ensureString(envelope.reason, "reason")
      };
    default:
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand,
        errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
        message: `unknown bridge_command '${bridgeCommand}'`,
        retryable: false
      });
  }
}

export function buildPingResponse(requestId) {
  return buildOkEnvelope({
    requestId,
    bridgeCommand: BRIDGE_COMMAND.PING,
    payload: {
      protocol_version: BRIDGE_PROTOCOL_VERSION,
      app_name: APP_NAME
    }
  });
}

export function buildInitializeResponse({
  requestId,
  modelKey,
  resolvedModelJsonPath,
  presentationMode,
  windowSurface
}) {
  return buildOkEnvelope({
    requestId,
    bridgeCommand: BRIDGE_COMMAND.INITIALIZE,
    payload: {
      model_key: modelKey,
      resolved_model_json_path: resolvedModelJsonPath,
      presentation_mode: presentationMode,
      window_surface: windowSurface
    }
  });
}

export function buildDispatchResponse({
  requestId,
  commandId,
  commandType,
  adapterKey,
  adapterProfileKey,
  outcome,
  message
}) {
  return buildOkEnvelope({
    requestId,
    bridgeCommand: BRIDGE_COMMAND.DISPATCH_COMMAND,
    payload: {
      command_id: commandId,
      command_type: commandType,
      adapter_key: adapterKey,
      adapter_profile_key: adapterProfileKey,
      outcome,
      message
    }
  });
}

export function buildBubbleResponse({
  requestId,
  bridgeCommand,
  bubbleSnapshot
}) {
  return buildOkEnvelope({
    requestId,
    bridgeCommand,
    payload: {
      bubble_visible: bubbleSnapshot.bubble_visible,
      bubble_text: bubbleSnapshot.bubble_text,
      speaker_label: bubbleSnapshot.speaker_label,
      is_streaming: bubbleSnapshot.is_streaming,
      segment_count: bubbleSnapshot.segment_count,
      last_action: bubbleSnapshot.last_action
    }
  });
}

export function buildAudioPlaybackResponse({
  requestId,
  bridgeCommand,
  playbackSnapshot,
  reports = []
}) {
  return buildOkEnvelope({
    requestId,
    bridgeCommand,
    payload: {
      playback_snapshot: playbackSnapshot,
      reports
    }
  });
}

export function buildCompanionSessionResponse({
  requestId,
  bridgeCommand,
  companionSessionSnapshot,
  drainedInputs = []
}) {
  return buildOkEnvelope({
    requestId,
    bridgeCommand,
    payload: {
      companion_session_snapshot: companionSessionSnapshot,
      drained_inputs: drainedInputs
    }
  });
}

export function buildShutdownResponse(requestId, message = "desktop-live2d bridge shutting down") {
  return buildOkEnvelope({
    requestId,
    bridgeCommand: BRIDGE_COMMAND.SHUTDOWN,
    payload: {
      message
    }
  });
}

export function buildRequestId() {
  return buildRandomUuid();
}
