import { randomUUID } from "node:crypto";

export const COMPANION_HOST_MESSAGE_KIND = Object.freeze({
  SERVICE_OPERATION_REQUEST: "service_operation_request",
  SERVICE_OPERATION_RESPONSE: "service_operation_response",
  DESKTOP_BRIDGE_REQUEST: "desktop_bridge_request",
  DESKTOP_BRIDGE_RESPONSE: "desktop_bridge_response"
});

export const COMPANION_HOST_OPERATION = Object.freeze({
  LOAD_PROVIDER_SETTINGS: "load_provider_settings",
  SAVE_PROVIDER_SETTINGS: "save_provider_settings",
  VALIDATE_PROVIDER_SETTINGS: "validate_provider_settings",
  GET_PROVIDER_READINESS: "get_provider_readiness",
  RUN_TTS_VOICE_ENROLLMENT: "run_tts_voice_enrollment",
  LIST_CLONED_VOICES: "list_cloned_voices",
  SNAPSHOT_DESKTOP_STATE: "snapshot_desktop_state",
  SUBMIT_DESKTOP_INPUT: "submit_desktop_input",
  ENUMERATE_AUDIO_DEVICES: "enumerate_audio_devices",
  START_VOICE_PERCEPTION: "start_voice_perception",
  STOP_VOICE_PERCEPTION: "stop_voice_perception",
  GET_VOICE_PERCEPTION_STATUS: "get_voice_perception_status",
  LIST_SESSIONS: "list_sessions",
  CREATE_SESSION: "create_session",
  SWITCH_SESSION: "switch_session",
  DELETE_SESSION: "delete_session",
  FORK_SESSION: "fork_session",
  GET_ACTIVE_SESSION: "get_active_session",
  GET_SESSION_DETAIL: "get_session_detail",
  SHUTDOWN: "shutdown"
});

export const COMPANION_HOST_STATUS = Object.freeze({
  OK: "ok",
  ERROR: "error"
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DesktopCompanionHostProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "DesktopCompanionHostProtocolError";
  }
}

function ensureObject(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopCompanionHostProtocolError(message);
  }
  return value;
}

function ensureString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DesktopCompanionHostProtocolError(
      `${fieldName} must be a non-empty string`
    );
  }
  return value;
}

function ensureUuidLike(value, fieldName) {
  const normalized = ensureString(value, fieldName);
  if (!UUID_PATTERN.test(normalized)) {
    throw new DesktopCompanionHostProtocolError(
      `${fieldName} must be a UUID string`
    );
  }
  return normalized.toLowerCase();
}

function ensureOperation(value) {
  const normalized = ensureString(value, "operation");
  if (!Object.values(COMPANION_HOST_OPERATION).includes(normalized)) {
    throw new DesktopCompanionHostProtocolError(
      `unsupported companion host operation '${normalized}'`
    );
  }
  return normalized;
}

function ensureStatus(value) {
  const normalized = ensureString(value, "status");
  if (!Object.values(COMPANION_HOST_STATUS).includes(normalized)) {
    throw new DesktopCompanionHostProtocolError(
      `unsupported companion host status '${normalized}'`
    );
  }
  return normalized;
}

export function buildCompanionHostRequestId() {
  return randomUUID();
}

export function buildServiceOperationRequest({
  requestId = buildCompanionHostRequestId(),
  operation,
  payload = {}
}) {
  return {
    message_kind: COMPANION_HOST_MESSAGE_KIND.SERVICE_OPERATION_REQUEST,
    request_id: requestId,
    operation,
    payload
  };
}

export function buildServiceOperationResponse({
  requestId,
  operation,
  status,
  payload = null,
  errorType = null,
  errorMessage = null,
  failure = null
}) {
  return {
    message_kind: COMPANION_HOST_MESSAGE_KIND.SERVICE_OPERATION_RESPONSE,
    request_id: requestId,
    operation,
    status,
    payload,
    error_type: errorType,
    error_message: errorMessage,
    failure
  };
}

export function buildDesktopBridgeRequestMessage({
  requestId,
  bridgeRequest
}) {
  return {
    message_kind: COMPANION_HOST_MESSAGE_KIND.DESKTOP_BRIDGE_REQUEST,
    request_id: requestId,
    bridge_request: bridgeRequest
  };
}

export function buildDesktopBridgeResponseMessage({
  requestId,
  bridgeResponse
}) {
  return {
    message_kind: COMPANION_HOST_MESSAGE_KIND.DESKTOP_BRIDGE_RESPONSE,
    request_id: requestId,
    bridge_response: bridgeResponse
  };
}

export function parseCompanionHostMessage(rawLine) {
  const parsed = JSON.parse(rawLine);
  const envelope = ensureObject(parsed, "companion host message must be an object");
  const messageKind = ensureString(envelope.message_kind, "message_kind");

  switch (messageKind) {
    case COMPANION_HOST_MESSAGE_KIND.SERVICE_OPERATION_REQUEST:
      return {
        message_kind: messageKind,
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        operation: ensureOperation(envelope.operation),
        payload:
          envelope.payload === null || envelope.payload === undefined
            ? {}
            : ensureObject(envelope.payload, "payload must be an object")
      };
    case COMPANION_HOST_MESSAGE_KIND.SERVICE_OPERATION_RESPONSE:
      return {
        message_kind: messageKind,
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        operation: ensureOperation(envelope.operation),
        status: ensureStatus(envelope.status),
        payload:
          envelope.payload === null || envelope.payload === undefined
            ? null
            : ensureObject(envelope.payload, "payload must be an object"),
        error_type:
          envelope.error_type === null || envelope.error_type === undefined
            ? null
            : ensureString(envelope.error_type, "error_type"),
        error_message:
          envelope.error_message === null || envelope.error_message === undefined
            ? null
            : ensureString(envelope.error_message, "error_message"),
        failure:
          envelope.failure === null || envelope.failure === undefined
            ? null
            : ensureObject(envelope.failure, "failure must be an object")
      };
    case COMPANION_HOST_MESSAGE_KIND.DESKTOP_BRIDGE_REQUEST:
      return {
        message_kind: messageKind,
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_request: ensureObject(
          envelope.bridge_request,
          "bridge_request must be an object"
        )
      };
    case COMPANION_HOST_MESSAGE_KIND.DESKTOP_BRIDGE_RESPONSE:
      return {
        message_kind: messageKind,
        request_id: ensureUuidLike(envelope.request_id, "request_id"),
        bridge_response: ensureObject(
          envelope.bridge_response,
          "bridge_response must be an object"
        )
      };
    default:
      throw new DesktopCompanionHostProtocolError(
        `unsupported companion host message_kind '${messageKind}'`
      );
  }
}
