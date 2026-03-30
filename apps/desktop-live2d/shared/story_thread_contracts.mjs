// ---------------------------------------------------------------------------
// Story Thread Contracts — Phase 1
// Core domain model types for multi-companion story mode.
// ---------------------------------------------------------------------------

function buildRandomUuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
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

// ── Enums ──────────────────────────────────────────────────────────────────

export const STORY_THREAD_STATUS = Object.freeze({
    ACTIVE: "active",
    PAUSED: "paused",
    COMPLETED: "completed",
    ABANDONED: "abandoned"
});

export const STORY_THREAD_MODE = Object.freeze({
    FREE_PLAY: "free_play",
    CHAPTER_DRIVEN: "chapter_driven",
    EVENT_DRIVEN: "event_driven"
});

export const CAST_ROLE_TYPE = Object.freeze({
    PROTAGONIST: "protagonist",
    SUPPORTING: "supporting",
    OBSERVER: "observer"
});

export const CAST_MEMBER_STATUS = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive"
});

export const CAST_ACTIVATION_STATE = Object.freeze({
    ACTIVE: "active",
    STANDBY: "standby",
    SUSPENDED: "suspended"
});

export const SCENE_STATUS = Object.freeze({
    PENDING: "pending",
    ACTIVE: "active",
    COMPLETED: "completed",
    ABANDONED: "abandoned"
});

export const TURN_TYPE = Object.freeze({
    USER_TURN: "user_turn",
    CAST_TURN: "cast_turn",
    OBSERVER_TURN: "observer_turn",
    DIRECTOR_TURN: "director_turn"
});

export const DIRECTOR_PLAN_URGENCY = Object.freeze({
    LOW: "low",
    NORMAL: "normal",
    HIGH: "high"
});

export const DIRECTOR_USER_WAIT_POLICY = Object.freeze({
    YIELD_TO_USER: "yield_to_user",
    CONTINUE_CHAIN: "continue_chain",
    REQUIRE_CONFIRMATION: "require_confirmation"
});

// ── Error ──────────────────────────────────────────────────────────────────

export class StoryThreadContractError extends Error {
    constructor(message) {
        super(message);
        this.name = "StoryThreadContractError";
    }
}

// ── Validation helpers ─────────────────────────────────────────────────────

function ensureObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new StoryThreadContractError(`${label} must be a plain object`);
    }
    return value;
}

function ensureNonEmptyString(value, fieldName, maxLength = 4000) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryThreadContractError(
            `${fieldName} must be a non-empty string`
        );
    }
    if (value.length > maxLength) {
        throw new StoryThreadContractError(
            `${fieldName} must not exceed ${maxLength} characters`
        );
    }
    return value.trim();
}

function ensureUuidLike(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryThreadContractError(`${fieldName} must be a UUID string`);
    }
    return value.trim().toLowerCase();
}

function ensureEnum(value, enumObj, fieldName) {
    const values = Object.values(enumObj);
    if (!values.includes(value)) {
        throw new StoryThreadContractError(
            `${fieldName} must be one of: ${values.join(", ")}`
        );
    }
    return value;
}

function ensureArray(value, fieldName) {
    if (!Array.isArray(value)) {
        throw new StoryThreadContractError(`${fieldName} must be an array`);
    }
    return value;
}

function ensureNonNegativeInteger(value, fieldName) {
    if (!Number.isInteger(value) || value < 0) {
        throw new StoryThreadContractError(
            `${fieldName} must be a non-negative integer`
        );
    }
    return value;
}

function ensureIsoTimestamp(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryThreadContractError(
            `${fieldName} must be an ISO timestamp string`
        );
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new StoryThreadContractError(
            `${fieldName} must be a valid ISO timestamp`
        );
    }
    return value;
}

function ensureOptionalHexColor(value, fieldName) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (typeof value !== "string") {
        throw new StoryThreadContractError(`${fieldName} must be a hex color string`);
    }
    const normalized = value.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
        throw new StoryThreadContractError(
            `${fieldName} must be a #RRGGBB hex color`
        );
    }
    return normalized;
}

function inferModelProfileRef({ modelProfileRef, personaProfileRef }) {
    if (typeof modelProfileRef === "string" && modelProfileRef.trim() !== "") {
        return modelProfileRef.trim();
    }
    if (typeof personaProfileRef !== "string" || personaProfileRef.trim() === "") {
        return null;
    }
    const normalized = personaProfileRef.trim().replaceAll("\\", "/");
    const match = normalized.match(/\/assets\/models\/([^/]+)\/persona\.md$/i);
    if (!match) {
        return null;
    }
    return match[1] || null;
}

function utcNow() {
    return new Date().toISOString();
}

// ── StoryThread ────────────────────────────────────────────────────────────

export function buildStoryThread({
    threadId = null,
    title,
    mode,
    castMemberIds
}) {
    const now = utcNow();
    return Object.freeze({
        thread_id: threadId || buildRandomUuid(),
        title: ensureNonEmptyString(title, "title", 200),
        mode: ensureEnum(mode, STORY_THREAD_MODE, "mode"),
        status: STORY_THREAD_STATUS.ACTIVE,
        created_at: now,
        updated_at: now,
        world_state_id: null,
        active_scene_id: null,
        director_plan_id: null,
        cast_member_ids: Object.freeze(
            ensureArray(castMemberIds, "cast_member_ids").map((id) =>
                ensureUuidLike(id, "cast_member_id")
            )
        ),
        last_user_turn_id: null,
        revision: 0
    });
}

export function normalizeStoryThread(raw) {
    const obj = ensureObject(raw, "StoryThread");
    return Object.freeze({
        thread_id: ensureUuidLike(obj.thread_id, "thread_id"),
        title: ensureNonEmptyString(obj.title, "title", 200),
        mode: ensureEnum(obj.mode, STORY_THREAD_MODE, "mode"),
        status: ensureEnum(obj.status, STORY_THREAD_STATUS, "status"),
        created_at: ensureIsoTimestamp(obj.created_at, "created_at"),
        updated_at: ensureIsoTimestamp(obj.updated_at, "updated_at"),
        world_state_id: obj.world_state_id || null,
        active_scene_id: obj.active_scene_id || null,
        director_plan_id: obj.director_plan_id || null,
        cast_member_ids: Object.freeze(
            ensureArray(obj.cast_member_ids, "cast_member_ids").map((id) =>
                ensureUuidLike(id, "cast_member_id")
            )
        ),
        last_user_turn_id: obj.last_user_turn_id || null,
        revision: ensureNonNegativeInteger(obj.revision, "revision")
    });
}

export function advanceStoryThreadRevision(thread) {
    ensureObject(thread, "StoryThread");
    return Object.freeze({
        ...thread,
        revision: thread.revision + 1,
        updated_at: utcNow()
    });
}

// ── CastMember ─────────────────────────────────────────────────────────────

export function buildCastMember({
    castMemberId = null,
    displayName,
    personaProfileRef,
    modelProfileRef = null,
    voiceProfileRef = null,
    subtitleColor = null,
    timelineColor = null,
    rendererProfileRef = null,
    roleType
}) {
    const normalizedPersonaProfileRef = ensureNonEmptyString(
        personaProfileRef,
        "persona_profile_ref",
        500
    );
    return Object.freeze({
        cast_member_id: castMemberId || buildRandomUuid(),
        display_name: ensureNonEmptyString(displayName, "display_name", 100),
        persona_profile_ref: normalizedPersonaProfileRef,
        model_profile_ref: inferModelProfileRef({
            modelProfileRef,
            personaProfileRef: normalizedPersonaProfileRef
        }),
        voice_profile_ref: voiceProfileRef || null,
        subtitle_color: ensureOptionalHexColor(subtitleColor, "subtitle_color"),
        timeline_color: ensureOptionalHexColor(timelineColor, "timeline_color"),
        renderer_profile_ref: rendererProfileRef || null,
        role_type: ensureEnum(roleType, CAST_ROLE_TYPE, "role_type"),
        default_visibility: true,
        relationship_anchor_ids: Object.freeze([]),
        status: CAST_MEMBER_STATUS.ACTIVE
    });
}

export function normalizeCastMember(raw) {
    const obj = ensureObject(raw, "CastMember");
    const normalizedPersonaProfileRef = ensureNonEmptyString(
        obj.persona_profile_ref,
        "persona_profile_ref",
        500
    );
    return Object.freeze({
        cast_member_id: ensureUuidLike(obj.cast_member_id, "cast_member_id"),
        display_name: ensureNonEmptyString(obj.display_name, "display_name", 100),
        persona_profile_ref: normalizedPersonaProfileRef,
        model_profile_ref: inferModelProfileRef({
            modelProfileRef: obj.model_profile_ref,
            personaProfileRef: normalizedPersonaProfileRef
        }),
        voice_profile_ref: obj.voice_profile_ref || null,
        subtitle_color: ensureOptionalHexColor(obj.subtitle_color, "subtitle_color"),
        timeline_color: ensureOptionalHexColor(obj.timeline_color, "timeline_color"),
        renderer_profile_ref: obj.renderer_profile_ref || null,
        role_type: ensureEnum(obj.role_type, CAST_ROLE_TYPE, "role_type"),
        default_visibility:
            typeof obj.default_visibility === "boolean"
                ? obj.default_visibility
                : true,
        relationship_anchor_ids: Object.freeze(
            Array.isArray(obj.relationship_anchor_ids)
                ? obj.relationship_anchor_ids.map((id) =>
                    ensureUuidLike(id, "relationship_anchor_id")
                )
                : []
        ),
        status: ensureEnum(obj.status, CAST_MEMBER_STATUS, "status")
    });
}

// ── CastSessionBinding ────────────────────────────────────────────────────

export function buildCastSessionBinding({
    threadId,
    castMemberId,
    sessionId
}) {
    return Object.freeze({
        binding_id: buildRandomUuid(),
        thread_id: ensureUuidLike(threadId, "thread_id"),
        cast_member_id: ensureUuidLike(castMemberId, "cast_member_id"),
        session_id: ensureUuidLike(sessionId, "session_id"),
        activation_state: CAST_ACTIVATION_STATE.ACTIVE,
        last_turn_at: null,
        last_observed_story_revision: 0,
        resume_payload_ref: null
    });
}

export function normalizeCastSessionBinding(raw) {
    const obj = ensureObject(raw, "CastSessionBinding");
    return Object.freeze({
        binding_id: ensureUuidLike(obj.binding_id, "binding_id"),
        thread_id: ensureUuidLike(obj.thread_id, "thread_id"),
        cast_member_id: ensureUuidLike(obj.cast_member_id, "cast_member_id"),
        session_id: ensureUuidLike(obj.session_id, "session_id"),
        activation_state: ensureEnum(
            obj.activation_state,
            CAST_ACTIVATION_STATE,
            "activation_state"
        ),
        last_turn_at: obj.last_turn_at || null,
        last_observed_story_revision: ensureNonNegativeInteger(
            obj.last_observed_story_revision,
            "last_observed_story_revision"
        ),
        resume_payload_ref: obj.resume_payload_ref || null
    });
}

export function markBindingTurnCompleted(binding, storyRevision) {
    return Object.freeze({
        ...binding,
        last_turn_at: utcNow(),
        last_observed_story_revision: storyRevision
    });
}

// ── SceneCard (Phase 1 minimal) ────────────────────────────────────────────

export function buildSceneCard({
    threadId,
    sceneGoal,
    featuredCastIds,
    toneTagsList = [],
    discourseConstraints = [],
    userConstraints = []
}) {
    return Object.freeze({
        scene_id: buildRandomUuid(),
        thread_id: ensureUuidLike(threadId, "thread_id"),
        scene_goal: ensureNonEmptyString(sceneGoal, "scene_goal", 2000),
        entry_conditions: Object.freeze([]),
        exit_conditions: Object.freeze([]),
        featured_cast_ids: Object.freeze(
            ensureArray(featuredCastIds, "featured_cast_ids").map((id) =>
                ensureUuidLike(id, "featured_cast_id")
            )
        ),
        location_id: null,
        tone_tags: Object.freeze([...toneTagsList]),
        discourse_constraints: Object.freeze([...discourseConstraints]),
        commonsense_constraints: Object.freeze([]),
        user_constraints: Object.freeze([...userConstraints]),
        cg_candidate_score: 0,
        status: SCENE_STATUS.ACTIVE
    });
}

export function normalizeSceneCard(raw) {
    const obj = ensureObject(raw, "SceneCard");
    return Object.freeze({
        scene_id: ensureUuidLike(obj.scene_id, "scene_id"),
        thread_id: ensureUuidLike(obj.thread_id, "thread_id"),
        scene_goal: ensureNonEmptyString(obj.scene_goal, "scene_goal", 2000),
        entry_conditions: Object.freeze(
            Array.isArray(obj.entry_conditions) ? [...obj.entry_conditions] : []
        ),
        exit_conditions: Object.freeze(
            Array.isArray(obj.exit_conditions) ? [...obj.exit_conditions] : []
        ),
        featured_cast_ids: Object.freeze(
            ensureArray(obj.featured_cast_ids, "featured_cast_ids").map((id) =>
                ensureUuidLike(id, "featured_cast_id")
            )
        ),
        location_id: obj.location_id || null,
        tone_tags: Object.freeze(
            Array.isArray(obj.tone_tags) ? [...obj.tone_tags] : []
        ),
        discourse_constraints: Object.freeze(
            Array.isArray(obj.discourse_constraints)
                ? [...obj.discourse_constraints]
                : []
        ),
        commonsense_constraints: Object.freeze(
            Array.isArray(obj.commonsense_constraints)
                ? [...obj.commonsense_constraints]
                : []
        ),
        user_constraints: Object.freeze(
            Array.isArray(obj.user_constraints) ? [...obj.user_constraints] : []
        ),
        cg_candidate_score:
            typeof obj.cg_candidate_score === "number" ? obj.cg_candidate_score : 0,
        status: ensureEnum(obj.status, SCENE_STATUS, "status")
    });
}

// ── DirectorPlan (Phase 1 minimal) ─────────────────────────────────────────

export function buildDirectorPlan({
    threadId,
    sceneId,
    turnQueue,
    userWaitPolicy = DIRECTOR_USER_WAIT_POLICY.YIELD_TO_USER,
    decisionTrace = null
}) {
    const now = utcNow();
    return Object.freeze({
        director_plan_id: buildRandomUuid(),
        thread_id: ensureUuidLike(threadId, "thread_id"),
        scene_id: ensureUuidLike(sceneId, "scene_id"),
        turn_queue: Object.freeze(
            ensureArray(turnQueue, "turn_queue").map((entry) =>
                normalizeTurnQueueEntry(entry)
            )
        ),
        urgency_level: DIRECTOR_PLAN_URGENCY.NORMAL,
        interruptibility: true,
        user_wait_policy: ensureEnum(
            userWaitPolicy,
            DIRECTOR_USER_WAIT_POLICY,
            "user_wait_policy"
        ),
        replan_reason: null,
        created_at: now,
        expires_at: null,
        decision_trace: decisionTrace || null
    });
}

export function normalizeDirectorPlan(raw) {
    const obj = ensureObject(raw, "DirectorPlan");
    return Object.freeze({
        director_plan_id: ensureUuidLike(
            obj.director_plan_id,
            "director_plan_id"
        ),
        thread_id: ensureUuidLike(obj.thread_id, "thread_id"),
        scene_id: ensureUuidLike(obj.scene_id, "scene_id"),
        turn_queue: Object.freeze(
            ensureArray(obj.turn_queue, "turn_queue").map((entry) =>
                normalizeTurnQueueEntry(entry)
            )
        ),
        urgency_level: ensureEnum(
            obj.urgency_level,
            DIRECTOR_PLAN_URGENCY,
            "urgency_level"
        ),
        interruptibility:
            typeof obj.interruptibility === "boolean" ? obj.interruptibility : true,
        user_wait_policy: ensureEnum(
            obj.user_wait_policy,
            DIRECTOR_USER_WAIT_POLICY,
            "user_wait_policy"
        ),
        replan_reason: obj.replan_reason || null,
        created_at: ensureIsoTimestamp(obj.created_at, "created_at"),
        expires_at: obj.expires_at || null,
        decision_trace: obj.decision_trace || null
    });
}

// ── Turn queue entry ───────────────────────────────────────────────────────

export function buildTurnQueueEntry({
    castMemberId,
    turnType,
    reason = ""
}) {
    return Object.freeze({
        entry_id: buildRandomUuid(),
        cast_member_id: ensureUuidLike(castMemberId, "cast_member_id"),
        turn_type: ensureEnum(turnType, TURN_TYPE, "turn_type"),
        reason: typeof reason === "string" ? reason : "",
        status: "pending"
    });
}

function normalizeTurnQueueEntry(raw) {
    const obj = ensureObject(raw, "TurnQueueEntry");
    return Object.freeze({
        entry_id: ensureUuidLike(obj.entry_id, "entry_id"),
        cast_member_id: ensureUuidLike(obj.cast_member_id, "cast_member_id"),
        turn_type: ensureEnum(obj.turn_type, TURN_TYPE, "turn_type"),
        reason: typeof obj.reason === "string" ? obj.reason : "",
        status: typeof obj.status === "string" ? obj.status : "pending"
    });
}

// ── Convenience exports ────────────────────────────────────────────────────

export { buildRandomUuid };
