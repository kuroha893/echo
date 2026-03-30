// ---------------------------------------------------------------------------
// Story Projection Contracts — Phase 1
// Shared story view events and projection builders.
// ---------------------------------------------------------------------------

import { StoryThreadContractError } from "./story_thread_contracts.mjs";

// ── Enums ──────────────────────────────────────────────────────────────────

export const STORY_EVENT_KIND = Object.freeze({
  CAST_SPOKEN: "cast_spoken",
  CAST_NARRATION: "cast_narration",
  USER_INPUT: "user_input",
  DIRECTOR_NOTE: "director_note",
  SCENE_TRANSITION: "scene_transition"
});

// ── Error ──────────────────────────────────────────────────────────────────

export class StoryProjectionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoryProjectionContractError";
  }
}

// ── Validation helpers ─────────────────────────────────────────────────────

function ensureObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StoryProjectionContractError(`${label} must be a plain object`);
  }
  return value;
}

function ensureNonEmptyString(value, fieldName, maxLength = 8000) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StoryProjectionContractError(
      `${fieldName} must be a non-empty string`
    );
  }
  if (value.length > maxLength) {
    throw new StoryProjectionContractError(
      `${fieldName} must not exceed ${maxLength} characters`
    );
  }
  return value.trim();
}

function ensureUuidLike(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StoryProjectionContractError(
      `${fieldName} must be a UUID string`
    );
  }
  return value.trim().toLowerCase();
}

function ensureEnum(value, enumObj, fieldName) {
  const values = Object.values(enumObj);
  if (!values.includes(value)) {
    throw new StoryProjectionContractError(
      `${fieldName} must be one of: ${values.join(", ")}`
    );
  }
  return value;
}

function ensureNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new StoryProjectionContractError(
      `${fieldName} must be a non-negative integer`
    );
  }
  return value;
}

function buildRandomUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const randomBytes = new Uint8Array(16);
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
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

// ── Projection Event ───────────────────────────────────────────────────────

export function buildProjectionEvent({
  threadId,
  eventKind,
  castMemberId = null,
  sessionId = null,
  storyRevision,
  text,
  inputSnapshotId = null,
  committedTurnId = null
}) {
  const eventId = buildRandomUuid();
  return Object.freeze({
    event_id: eventId,
    thread_id: ensureUuidLike(threadId, "thread_id"),
    event_kind: ensureEnum(eventKind, STORY_EVENT_KIND, "event_kind"),
    cast_member_id: castMemberId || null,
    session_id: sessionId || null,
    story_revision: ensureNonNegativeInteger(storyRevision, "story_revision"),
    text: ensureNonEmptyString(text, "text"),
    input_snapshot_id: inputSnapshotId || null,
    committed_turn_id: committedTurnId || null,
    idempotency_key: `${threadId}:${storyRevision}:${eventId}`,
    created_at: new Date().toISOString()
  });
}

export function normalizeProjectionEvent(raw) {
  const obj = ensureObject(raw, "ProjectionEvent");
  return Object.freeze({
    event_id: ensureUuidLike(obj.event_id, "event_id"),
    thread_id: ensureUuidLike(obj.thread_id, "thread_id"),
    event_kind: ensureEnum(obj.event_kind, STORY_EVENT_KIND, "event_kind"),
    cast_member_id: obj.cast_member_id || null,
    session_id: obj.session_id || null,
    story_revision: ensureNonNegativeInteger(
      obj.story_revision,
      "story_revision"
    ),
    text: ensureNonEmptyString(obj.text, "text"),
    input_snapshot_id: obj.input_snapshot_id || null,
    committed_turn_id: obj.committed_turn_id || null,
    idempotency_key: ensureNonEmptyString(
      obj.idempotency_key,
      "idempotency_key"
    ),
    created_at: obj.created_at || new Date().toISOString()
  });
}

// ── Projection timeline (append-only with dedup) ──────────────────────────

export function buildProjectionTimeline() {
  return {
    _events: [],
    _seenKeys: new Set()
  };
}

export function appendToTimeline(timeline, event) {
  if (timeline._seenKeys.has(event.idempotency_key)) {
    return false;
  }
  timeline._seenKeys.add(event.idempotency_key);
  timeline._events.push(event);
  return true;
}

export function getTimelineEvents(timeline) {
  return Object.freeze([...timeline._events]);
}

export function getTimelineEventsSinceRevision(timeline, sinceRevision) {
  return Object.freeze(
    timeline._events.filter(
      (event) => event.story_revision > sinceRevision
    )
  );
}

export function getTimelineLength(timeline) {
  return timeline._events.length;
}
