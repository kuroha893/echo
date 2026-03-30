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

export const COMPANION_TRANSCRIPT_ROLE = Object.freeze({
  USER: "user",
  ASSISTANT: "assistant"
});

export class DesktopLive2DCompanionSessionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "DesktopLive2DCompanionSessionContractError";
  }
}

function ensureObject(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopLive2DCompanionSessionContractError(message);
  }
  return value;
}

function ensureNonEmptyString(value, fieldName, maxLength = 8000) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DesktopLive2DCompanionSessionContractError(
      `${fieldName} must be a non-empty string`
    );
  }
  if (value.length > maxLength) {
    throw new DesktopLive2DCompanionSessionContractError(
      `${fieldName} must not exceed ${maxLength} characters`
    );
  }
  return value;
}

function ensureBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new DesktopLive2DCompanionSessionContractError(
      `${fieldName} must be a boolean`
    );
  }
  return value;
}

function ensureUuidLike(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DesktopLive2DCompanionSessionContractError(
      `${fieldName} must be a UUID string`
    );
  }
  return value.trim().toLowerCase();
}

function ensureTranscriptRole(value) {
  const normalized = ensureNonEmptyString(value, "role", 32).toLowerCase();
  if (
    normalized !== COMPANION_TRANSCRIPT_ROLE.USER &&
    normalized !== COMPANION_TRANSCRIPT_ROLE.ASSISTANT
  ) {
    throw new DesktopLive2DCompanionSessionContractError(
      `role '${normalized}' is unsupported for companion session transcript`
    );
  }
  return normalized;
}

export function buildCompanionTranscriptEntry({
  entryId,
  sessionId,
  turnId,
  role,
  text,
  rawText,
  isStreaming,
  sequenceIndex
}) {
  return {
    entry_id: entryId,
    session_id: sessionId,
    turn_id: turnId,
    role,
    text,
    raw_text: rawText || "",
    is_streaming: isStreaming,
    sequence_index: sequenceIndex
  };
}

export function buildCompanionPendingInput({
  inputId,
  sessionId,
  text,
  queueIndex
}) {
  return {
    input_id: inputId,
    session_id: sessionId,
    text,
    queue_index: queueIndex
  };
}

export function buildCompanionSessionSnapshot({
  sessionId = null,
  transcriptEntries = [],
  pendingInputCount = 0,
  latestTurnId = null
}) {
  return {
    session_id: sessionId,
    transcript_entries: transcriptEntries,
    pending_input_count: pendingInputCount,
    latest_turn_id: latestTurnId
  };
}

export function normalizeCompanionTranscriptUpsertRequest(rawRequest) {
  const request = ensureObject(
    rawRequest,
    "companion transcript update must be an object"
  );
  return {
    session_id: ensureUuidLike(request.session_id, "session_id"),
    turn_id: ensureUuidLike(request.turn_id, "turn_id"),
    role: ensureTranscriptRole(request.role),
    text: ensureNonEmptyString(request.text, "text"),
    raw_text: typeof request.raw_text === "string" ? request.raw_text : "",
    is_streaming: ensureBoolean(request.is_streaming, "is_streaming")
  };
}

export function normalizeCompanionInputEnqueueRequest(rawRequest) {
  const request = ensureObject(rawRequest, "companion input enqueue must be an object");
  return {
    session_id: ensureUuidLike(request.session_id, "session_id"),
    text: ensureNonEmptyString(request.text, "text", 4000)
  };
}

export function normalizeCompanionInputDrainRequest(rawRequest) {
  const request = ensureObject(rawRequest, "companion input drain must be an object");
  return {
    session_id: ensureUuidLike(request.session_id, "session_id")
  };
}

export function buildCompanionTranscriptEntryFromRequest({
  request,
  sequenceIndex,
  existingEntryId = null
}) {
  return buildCompanionTranscriptEntry({
    entryId: existingEntryId || buildRandomUuid(),
    sessionId: request.session_id,
    turnId: request.turn_id,
    role: request.role,
    text: request.text,
    rawText: request.raw_text || "",
    isStreaming: request.is_streaming,
    sequenceIndex
  });
}

export function buildCompanionPendingInputFromRequest({
  request,
  queueIndex
}) {
  return buildCompanionPendingInput({
    inputId: buildRandomUuid(),
    sessionId: request.session_id,
    text: request.text,
    queueIndex
  });
}
