// ---------------------------------------------------------------------------
// Stage State Store — Phase 1
// Global desktop stage state and per-cast presentation state.
// ---------------------------------------------------------------------------

// ── Error ──────────────────────────────────────────────────────────────────

export class StageStateError extends Error {
    constructor(message) {
        super(message);
        this.name = "StageStateError";
    }
}

// ── Validation helpers ─────────────────────────────────────────────────────

function ensureUuidLike(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StageStateError(`${fieldName} must be a UUID string`);
    }
    return value.trim().toLowerCase();
}

// ── StageState ─────────────────────────────────────────────────────────────

export function buildStageState({ threadId }) {
    return Object.freeze({
        stage_state_id:
            globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
                ? globalThis.crypto.randomUUID()
                : `stage-${Date.now()}`,
        thread_id: ensureUuidLike(threadId, "thread_id"),
        active_layout: "default",
        camera_focus: null,
        available_slots: Object.freeze([]),
        scene_lighting: null,
        bgm_cue: null,
        current_beat_id: null,
        revision: 0
    });
}

export function updateStageRevision(stageState, storyRevision) {
    return Object.freeze({
        ...stageState,
        revision: storyRevision
    });
}

export function setStageCamera(stageState, cameraFocus) {
    return Object.freeze({
        ...stageState,
        camera_focus: cameraFocus
    });
}

// ── CastPresentationState ──────────────────────────────────────────────────

export function buildCastPresentationState({ castMemberId, threadId }) {
    return Object.freeze({
        cast_member_id: ensureUuidLike(castMemberId, "cast_member_id"),
        thread_id: ensureUuidLike(threadId, "thread_id"),
        position: Object.freeze({ x: 0, y: 0 }),
        scale: 1.0,
        z_index: 0,
        facing_target: null,
        expression: "neutral",
        motion_queue: Object.freeze([]),
        visibility: true,
        speech_bubble_state: null,
        revision: 0
    });
}

export function updateCastPresentationExpression(state, expression, revision) {
    return Object.freeze({
        ...state,
        expression: expression || "neutral",
        revision
    });
}

export function updateCastPresentationVisibility(state, visible, revision) {
    return Object.freeze({
        ...state,
        visibility: !!visible,
        revision
    });
}

export function updateCastPresentationSpeechBubble(state, bubbleState, revision) {
    return Object.freeze({
        ...state,
        speech_bubble_state: bubbleState,
        revision
    });
}

// ── StageStateStore ────────────────────────────────────────────────────────

export class StageStateStore {
    constructor() {
        this._stageState = null;
        /** @type {Map<string, object>} cast_member_id → CastPresentationState */
        this._castStates = new Map();
    }

    initializeForThread(threadId, castMemberIds) {
        this._stageState = buildStageState({ threadId });
        this._castStates.clear();
        for (const castMemberId of castMemberIds) {
            this._castStates.set(
                castMemberId,
                buildCastPresentationState({ castMemberId, threadId })
            );
        }
        return this._stageState;
    }

    getStageState() {
        return this._stageState;
    }

    getCastPresentationState(castMemberId) {
        return this._castStates.get(castMemberId) || null;
    }

    getAllCastPresentationStates() {
        return Object.freeze([...this._castStates.values()]);
    }

    updateAfterCommit(storyRevision, castMemberId, emotionTag) {
        if (this._stageState) {
            this._stageState = updateStageRevision(this._stageState, storyRevision);
            this._stageState = setStageCamera(this._stageState, castMemberId);
        }
        const castState = this._castStates.get(castMemberId);
        if (castState) {
            this._castStates.set(
                castMemberId,
                updateCastPresentationExpression(castState, emotionTag, storyRevision)
            );
        }
    }

    updateAfterDirectorBeat(storyRevision) {
        if (this._stageState) {
            this._stageState = updateStageRevision(this._stageState, storyRevision);
        }
    }

    toJSON() {
        return {
            stage_state: this._stageState,
            cast_presentation_states: Object.fromEntries(this._castStates)
        };
    }

    restoreFromJSON(data) {
        if (!data) {
            throw new StageStateError("StageStateStore.restoreFromJSON: data is required");
        }
        this._stageState = data.stage_state || null;
        this._castStates.clear();
        if (data.cast_presentation_states) {
            for (const [key, value] of Object.entries(
                data.cast_presentation_states
            )) {
                this._castStates.set(key, Object.freeze(value));
            }
        }
    }
}
