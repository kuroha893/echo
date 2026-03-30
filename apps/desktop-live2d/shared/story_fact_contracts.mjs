// ---------------------------------------------------------------------------
// Story Fact Contracts — Phase 1
// Fact records, provenance, visibility, and delta algebra for story mode.
// ---------------------------------------------------------------------------

import { StoryThreadContractError } from "./story_thread_contracts.mjs";

// ── Provenance ─────────────────────────────────────────────────────────────

export const PROVENANCE_KIND = Object.freeze({
    USER_AUTHORED: "user_authored",
    DIRECTOR_AUTHORED: "director_authored",
    CAST_VISIBLE_COMMITTED_TURN_DERIVED: "cast_visible_committed_turn_derived",
    SYSTEM_INFERRED: "system_inferred"
});

// ── Visibility ─────────────────────────────────────────────────────────────

export const VISIBILITY_SCOPE = Object.freeze({
    PUBLIC_TO_ALL_CAST: "public_to_all_cast",
    KNOWN_TO_CAST_SUBSET: "known_to_cast_subset",
    KNOWN_TO_USER_ONLY: "known_to_user_only",
    INFERRED_ONLY_NOT_SPEAKABLE: "inferred_only_not_speakable"
});

// ── Delta operation kinds ──────────────────────────────────────────────────

export const DELTA_OPERATION_KIND = Object.freeze({
    ADD_FACT: "add_fact",
    UPDATE_FACT: "update_fact",
    RESOLVE_FACT: "resolve_fact",
    SET_FLAG: "set_flag",
    CLEAR_FLAG: "clear_flag",
    ADJUST_DIMENSION: "adjust_dimension",
    APPEND_PROMISE: "append_promise",
    RESOLVE_PROMISE: "resolve_promise",
    ADVANCE_SCENE_EXIT_CONDITION: "advance_scene_exit_condition",
    SET_STAGE_FOCUS: "set_stage_focus",
    ENQUEUE_PRESENTATION_ACTION: "enqueue_presentation_action"
});

// ── Fact type ──────────────────────────────────────────────────────────────

export const FACT_TYPE = Object.freeze({
    WORLD: "world",
    RELATIONSHIP: "relationship",
    CHARACTER: "character",
    EVENT: "event"
});

// ── Error ──────────────────────────────────────────────────────────────────

export class StoryFactContractError extends Error {
    constructor(message) {
        super(message);
        this.name = "StoryFactContractError";
    }
}

// ── Validation helpers ─────────────────────────────────────────────────────

function ensureObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new StoryFactContractError(`${label} must be a plain object`);
    }
    return value;
}

function ensureNonEmptyString(value, fieldName, maxLength = 4000) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryFactContractError(
            `${fieldName} must be a non-empty string`
        );
    }
    if (value.length > maxLength) {
        throw new StoryFactContractError(
            `${fieldName} must not exceed ${maxLength} characters`
        );
    }
    return value.trim();
}

function ensureUuidLike(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryFactContractError(`${fieldName} must be a UUID string`);
    }
    return value.trim().toLowerCase();
}

function ensureEnum(value, enumObj, fieldName) {
    const values = Object.values(enumObj);
    if (!values.includes(value)) {
        throw new StoryFactContractError(
            `${fieldName} must be one of: ${values.join(", ")}`
        );
    }
    return value;
}

function ensureNonNegativeInteger(value, fieldName) {
    if (!Number.isInteger(value) || value < 0) {
        throw new StoryFactContractError(
            `${fieldName} must be a non-negative integer`
        );
    }
    return value;
}

// ── FactRecord ─────────────────────────────────────────────────────────────

let _factCounter = 0;

function buildFactId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    _factCounter += 1;
    return `fact-${Date.now()}-${_factCounter}`;
}

export function buildFactRecord({
    factType,
    content,
    provenance,
    visibilityScope,
    revisionIntroduced,
    confidence = 1.0
}) {
    return Object.freeze({
        fact_id: buildFactId(),
        fact_type: ensureEnum(factType, FACT_TYPE, "fact_type"),
        content: ensureNonEmptyString(content, "content"),
        provenance: ensureEnum(provenance, PROVENANCE_KIND, "provenance"),
        visibility_scope: ensureEnum(
            visibilityScope,
            VISIBILITY_SCOPE,
            "visibility_scope"
        ),
        confidence: typeof confidence === "number" ? confidence : 1.0,
        revision_introduced: ensureNonNegativeInteger(
            revisionIntroduced,
            "revision_introduced"
        ),
        revision_resolved: null
    });
}

export function normalizeFactRecord(raw) {
    const obj = ensureObject(raw, "FactRecord");
    return Object.freeze({
        fact_id: ensureUuidLike(obj.fact_id, "fact_id"),
        fact_type: ensureEnum(obj.fact_type, FACT_TYPE, "fact_type"),
        content: ensureNonEmptyString(obj.content, "content"),
        provenance: ensureEnum(obj.provenance, PROVENANCE_KIND, "provenance"),
        visibility_scope: ensureEnum(
            obj.visibility_scope,
            VISIBILITY_SCOPE,
            "visibility_scope"
        ),
        confidence: typeof obj.confidence === "number" ? obj.confidence : 1.0,
        revision_introduced: ensureNonNegativeInteger(
            obj.revision_introduced,
            "revision_introduced"
        ),
        revision_resolved:
            obj.revision_resolved !== null && obj.revision_resolved !== undefined
                ? ensureNonNegativeInteger(obj.revision_resolved, "revision_resolved")
                : null
    });
}

export function resolveFactRecord(fact, revisionResolved) {
    return Object.freeze({
        ...fact,
        revision_resolved: ensureNonNegativeInteger(
            revisionResolved,
            "revision_resolved"
        )
    });
}

// ── Delta candidate ────────────────────────────────────────────────────────

export function buildDeltaCandidate({
    operationKind,
    targetArtifactType,
    payload
}) {
    return Object.freeze({
        operation_kind: ensureEnum(
            operationKind,
            DELTA_OPERATION_KIND,
            "operation_kind"
        ),
        target_artifact_type: ensureNonEmptyString(
            targetArtifactType,
            "target_artifact_type",
            100
        ),
        payload: Object.freeze({ ...ensureObject(payload, "payload") })
    });
}

export function normalizeDeltaCandidate(raw) {
    const obj = ensureObject(raw, "DeltaCandidate");
    return Object.freeze({
        operation_kind: ensureEnum(
            obj.operation_kind,
            DELTA_OPERATION_KIND,
            "operation_kind"
        ),
        target_artifact_type: ensureNonEmptyString(
            obj.target_artifact_type,
            "target_artifact_type",
            100
        ),
        payload: Object.freeze(
            typeof obj.payload === "object" && obj.payload !== null
                ? { ...obj.payload }
                : {}
        )
    });
}

// ── Structured turn output envelope ────────────────────────────────────────

export function buildStructuredTurnOutput({
    spokenText,
    narrationText = null,
    intentTag,
    emotionTag,
    relationshipDeltaCandidates = [],
    worldDeltaCandidates = [],
    beatTags = [],
    cgSignalTags = []
}) {
    return Object.freeze({
        spoken_text: ensureNonEmptyString(spokenText, "spoken_text", 8000),
        narration_text: narrationText || null,
        intent_tag: ensureNonEmptyString(intentTag, "intent_tag", 100),
        emotion_tag: ensureNonEmptyString(emotionTag, "emotion_tag", 100),
        relationship_delta_candidates: Object.freeze(
            relationshipDeltaCandidates.map(normalizeDeltaCandidate)
        ),
        world_delta_candidates: Object.freeze(
            worldDeltaCandidates.map(normalizeDeltaCandidate)
        ),
        beat_tags: Object.freeze([...beatTags]),
        cg_signal_tags: Object.freeze([...cgSignalTags])
    });
}

export function normalizeStructuredTurnOutput(raw) {
    const obj = ensureObject(raw, "StructuredTurnOutput");
    return Object.freeze({
        spoken_text: ensureNonEmptyString(obj.spoken_text, "spoken_text", 8000),
        narration_text: obj.narration_text || null,
        intent_tag: ensureNonEmptyString(obj.intent_tag, "intent_tag", 100),
        emotion_tag: ensureNonEmptyString(obj.emotion_tag, "emotion_tag", 100),
        relationship_delta_candidates: Object.freeze(
            Array.isArray(obj.relationship_delta_candidates)
                ? obj.relationship_delta_candidates.map(normalizeDeltaCandidate)
                : []
        ),
        world_delta_candidates: Object.freeze(
            Array.isArray(obj.world_delta_candidates)
                ? obj.world_delta_candidates.map(normalizeDeltaCandidate)
                : []
        ),
        beat_tags: Object.freeze(
            Array.isArray(obj.beat_tags) ? [...obj.beat_tags] : []
        ),
        cg_signal_tags: Object.freeze(
            Array.isArray(obj.cg_signal_tags) ? [...obj.cg_signal_tags] : []
        )
    });
}

// ── Visibility filter utility ──────────────────────────────────────────────

export function filterFactsByVisibility(facts, castMemberId, castSubsets) {
    return facts.filter((fact) => {
        if (fact.revision_resolved !== null) {
            return false;
        }
        if (fact.visibility_scope === VISIBILITY_SCOPE.PUBLIC_TO_ALL_CAST) {
            return true;
        }
        if (fact.visibility_scope === VISIBILITY_SCOPE.KNOWN_TO_CAST_SUBSET) {
            const subset = castSubsets ? castSubsets[fact.fact_id] : null;
            return Array.isArray(subset) && subset.includes(castMemberId);
        }
        return false;
    });
}
