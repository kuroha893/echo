import { DIRECTOR_USER_WAIT_POLICY } from "./story_thread_contracts.mjs";

export const NARRATOR_ACTION_KIND = Object.freeze({
    CAST_TURN: "cast_turn",
    INJECT_EVENT: "inject_event",
    SCENE_TRANSITION: "scene_transition",
    YIELD_TO_USER: "yield_to_user"
});

export const DIRECTIVE_KIND = Object.freeze({
    CONTINUE: "continue",
    REDIRECT: "redirect",
    SCENE_SHIFT: "scene_shift",
    RESPOND: "respond",
    ESCALATE: "escalate",
    DEESCALATE: "deescalate",
    PAUSE: "pause",
    REVEAL: "reveal",
});

export const SPEAKER_LOCK_POLICY = Object.freeze({
    [DIRECTIVE_KIND.CONTINUE]: "required",
    [DIRECTIVE_KIND.RESPOND]: "required",
    [DIRECTIVE_KIND.REVEAL]: "required",
    [DIRECTIVE_KIND.REDIRECT]: "preferred",
    [DIRECTIVE_KIND.ESCALATE]: "preferred",
    [DIRECTIVE_KIND.DEESCALATE]: "preferred",
    [DIRECTIVE_KIND.SCENE_SHIFT]: "forbidden",
    [DIRECTIVE_KIND.PAUSE]: "forbidden",
});

export class StoryNarratorContractError extends Error {
    constructor(message) {
        super(message);
        this.name = "StoryNarratorContractError";
    }
}

function ensureObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new StoryNarratorContractError(`${label} must be a plain object`);
    }
    return value;
}

function ensureNonEmptyString(value, fieldName, maxLength = 4000) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryNarratorContractError(`${fieldName} must be a non-empty string`);
    }
    if (value.length > maxLength) {
        throw new StoryNarratorContractError(`${fieldName} must not exceed ${maxLength} characters`);
    }
    return value.trim();
}

function ensureOptionalString(value, fieldName, maxLength = 4000) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return ensureNonEmptyString(value, fieldName, maxLength);
}

function normalizeBoundedChoiceString(value, fieldName, maxLength) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryNarratorContractError(`${fieldName} must be a non-empty string`);
    }
    const normalized = value.trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return normalized.slice(0, maxLength).trimEnd();
}

function normalizeOptionalBoundedChoiceString(value, fieldName, maxLength) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return normalizeBoundedChoiceString(value, fieldName, maxLength);
}

function ensureUuidLike(value, fieldName) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoryNarratorContractError(`${fieldName} must be a UUID string`);
    }
    return value.trim().toLowerCase();
}

function ensureEnum(value, enumObj, fieldName) {
    const values = Object.values(enumObj);
    if (!values.includes(value)) {
        throw new StoryNarratorContractError(`${fieldName} must be one of: ${values.join(", ")}`);
    }
    return value;
}

function ensureStringArray(values, fieldName, maxLength = 4000) {
    if (!Array.isArray(values)) {
        throw new StoryNarratorContractError(`${fieldName} must be an array`);
    }
    return Object.freeze(values.map((value, index) => ensureNonEmptyString(value, `${fieldName}[${index}]`, maxLength)));
}

function ensureNonNegativeNumber(value, fieldName) {
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
        throw new StoryNarratorContractError(`${fieldName} must be a non-negative number`);
    }
    return value;
}

function buildRandomUuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `narr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function buildStoryChoice({
    choiceId = null,
    label,
    promptText = null,
    rationale = null,
    targetSpeakerId = null,
    directiveKind = null,
    sourceRevision = null,
    choiceBatchId = null,
}) {
    const normalizedLabel = normalizeBoundedChoiceString(label, "label", 300);
    return Object.freeze({
        choice_id: choiceId || buildRandomUuid(),
        label: normalizedLabel,
        // prompt_text is kept as label mirror for backward compat + audit trail.
        // Control semantics are carried by directive_kind + target_speaker_id exclusively.
        // Do NOT use prompt_text for NL→control inference.
        prompt_text: normalizeOptionalBoundedChoiceString(promptText, "prompt_text", 500) || normalizedLabel,
        rationale: normalizeOptionalBoundedChoiceString(rationale, "rationale", 500),
        target_speaker_id: ensureOptionalString(targetSpeakerId, "target_speaker_id", 200),
        directive_kind: directiveKind && Object.values(DIRECTIVE_KIND).includes(directiveKind)
            ? directiveKind : null,
        source_revision: typeof sourceRevision === "number" ? sourceRevision : null,
        choice_batch_id: ensureOptionalString(choiceBatchId, "choice_batch_id", 200),
    });
}

export function normalizeStoryChoice(raw) {
    const obj = ensureObject(raw, "StoryChoice");
    return Object.freeze({
        choice_id: ensureUuidLike(obj.choice_id, "choice_id"),
        label: normalizeBoundedChoiceString(obj.label, "label", 300),
        prompt_text: normalizeBoundedChoiceString(obj.prompt_text || obj.label, "prompt_text", 500),
        rationale: normalizeOptionalBoundedChoiceString(obj.rationale, "rationale", 500),
        target_speaker_id: ensureOptionalString(obj.target_speaker_id, "target_speaker_id", 200),
        directive_kind: obj.directive_kind && Object.values(DIRECTIVE_KIND).includes(obj.directive_kind)
            ? obj.directive_kind : null,
        source_revision: typeof obj.source_revision === "number" ? obj.source_revision : null,
        choice_batch_id: ensureOptionalString(obj.choice_batch_id, "choice_batch_id", 200),
    });
}

export function buildNarratorState({
    threadId,
    sceneLabel,
    currentTimeLabel,
    sceneGoal,
    narrativeFocus,
    chapterSummary,
    relationshipSummaryLines = [],
    pendingEvents = [],
    lastDirectorNote = null,
    suggestedChoices = [],
    stagnationScore = 0,
    closurePressureScore = 0,
    beatCounter = 0,
    lastNarratorActionKind = NARRATOR_ACTION_KIND.CAST_TURN,
    lastUserWaitPolicy = DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN
}) {
    return Object.freeze({
        thread_id: ensureUuidLike(threadId, "thread_id"),
        scene_label: ensureNonEmptyString(sceneLabel, "scene_label", 300),
        current_time_label: ensureNonEmptyString(currentTimeLabel, "current_time_label", 300),
        scene_goal: ensureNonEmptyString(sceneGoal, "scene_goal", 2000),
        narrative_focus: ensureNonEmptyString(narrativeFocus, "narrative_focus", 1000),
        chapter_summary: ensureNonEmptyString(chapterSummary, "chapter_summary", 1000),
        relationship_summary_lines: ensureStringArray(relationshipSummaryLines, "relationship_summary_lines", 400),
        pending_events: ensureStringArray(pendingEvents, "pending_events", 400),
        last_director_note: ensureOptionalString(lastDirectorNote, "last_director_note", 1000),
        suggested_choices: Object.freeze(suggestedChoices.map(normalizeStoryChoice)),
        stagnation_score: ensureNonNegativeNumber(stagnationScore, "stagnation_score"),
        closure_pressure_score: ensureNonNegativeNumber(closurePressureScore, "closure_pressure_score"),
        beat_counter: ensureNonNegativeNumber(beatCounter, "beat_counter"),
        last_narrator_action_kind: ensureEnum(lastNarratorActionKind, NARRATOR_ACTION_KIND, "last_narrator_action_kind"),
        last_user_wait_policy: ensureEnum(lastUserWaitPolicy, DIRECTOR_USER_WAIT_POLICY, "last_user_wait_policy")
    });
}

export function normalizeNarratorState(raw) {
    const obj = ensureObject(raw, "NarratorState");
    return Object.freeze({
        thread_id: ensureUuidLike(obj.thread_id, "thread_id"),
        scene_label: ensureNonEmptyString(obj.scene_label, "scene_label", 300),
        current_time_label: ensureNonEmptyString(obj.current_time_label, "current_time_label", 300),
        scene_goal: ensureNonEmptyString(obj.scene_goal, "scene_goal", 2000),
        narrative_focus: ensureNonEmptyString(obj.narrative_focus, "narrative_focus", 1000),
        chapter_summary: ensureNonEmptyString(obj.chapter_summary, "chapter_summary", 1000),
        relationship_summary_lines: ensureStringArray(obj.relationship_summary_lines || [], "relationship_summary_lines", 400),
        pending_events: ensureStringArray(obj.pending_events || [], "pending_events", 400),
        last_director_note: ensureOptionalString(obj.last_director_note, "last_director_note", 1000),
        suggested_choices: Object.freeze(
            Array.isArray(obj.suggested_choices) ? obj.suggested_choices.map(normalizeStoryChoice) : []
        ),
        stagnation_score: ensureNonNegativeNumber(
            typeof obj.stagnation_score === "number" ? obj.stagnation_score : 0,
            "stagnation_score"
        ),
        closure_pressure_score: ensureNonNegativeNumber(
            typeof obj.closure_pressure_score === "number" ? obj.closure_pressure_score : 0,
            "closure_pressure_score"
        ),
        beat_counter: ensureNonNegativeNumber(
            typeof obj.beat_counter === "number" ? obj.beat_counter : 0,
            "beat_counter"
        ),
        last_narrator_action_kind: ensureEnum(
            obj.last_narrator_action_kind || NARRATOR_ACTION_KIND.CAST_TURN,
            NARRATOR_ACTION_KIND,
            "last_narrator_action_kind"
        ),
        last_user_wait_policy: ensureEnum(
            obj.last_user_wait_policy || DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN,
            DIRECTOR_USER_WAIT_POLICY,
            "last_user_wait_policy"
        )
    });
}

export function buildNarratorDecision({
    actionKind,
    userWaitPolicy,
    targetCastIds = [],
    directorHint,
    sceneGoal,
    sceneLabel,
    currentTimeLabel,
    narrativeFocus,
    chapterSummary,
    relationshipSummaryLines = [],
    pendingEvents = [],
    directorNote = null,
    transitionText = null,
    suggestedChoices = []
}) {
    return Object.freeze({
        action_kind: ensureEnum(actionKind, NARRATOR_ACTION_KIND, "action_kind"),
        user_wait_policy: ensureEnum(userWaitPolicy, DIRECTOR_USER_WAIT_POLICY, "user_wait_policy"),
        target_cast_ids: Object.freeze(targetCastIds.map((value, index) => ensureUuidLike(value, `target_cast_ids[${index}]`))),
        director_hint: ensureNonEmptyString(directorHint, "director_hint", 1000),
        scene_goal: ensureNonEmptyString(sceneGoal, "scene_goal", 2000),
        scene_label: ensureNonEmptyString(sceneLabel, "scene_label", 300),
        current_time_label: ensureNonEmptyString(currentTimeLabel, "current_time_label", 300),
        narrative_focus: ensureNonEmptyString(narrativeFocus, "narrative_focus", 1000),
        chapter_summary: ensureNonEmptyString(chapterSummary, "chapter_summary", 1000),
        relationship_summary_lines: ensureStringArray(relationshipSummaryLines, "relationship_summary_lines", 400),
        pending_events: ensureStringArray(pendingEvents, "pending_events", 400),
        director_note: ensureOptionalString(directorNote, "director_note", 1000),
        transition_text: ensureOptionalString(transitionText, "transition_text", 1000),
        suggested_choices: Object.freeze(suggestedChoices.map(normalizeStoryChoice))
    });
}

export function normalizeNarratorDecision(raw) {
    const obj = ensureObject(raw, "NarratorDecision");
    return Object.freeze({
        action_kind: ensureEnum(obj.action_kind, NARRATOR_ACTION_KIND, "action_kind"),
        user_wait_policy: ensureEnum(obj.user_wait_policy, DIRECTOR_USER_WAIT_POLICY, "user_wait_policy"),
        target_cast_ids: Object.freeze(
            Array.isArray(obj.target_cast_ids)
                ? obj.target_cast_ids.map((value, index) => ensureUuidLike(value, `target_cast_ids[${index}]`))
                : []
        ),
        director_hint: ensureNonEmptyString(obj.director_hint, "director_hint", 1000),
        scene_goal: ensureNonEmptyString(obj.scene_goal, "scene_goal", 2000),
        scene_label: ensureNonEmptyString(obj.scene_label, "scene_label", 300),
        current_time_label: ensureNonEmptyString(obj.current_time_label, "current_time_label", 300),
        narrative_focus: ensureNonEmptyString(obj.narrative_focus, "narrative_focus", 1000),
        chapter_summary: ensureNonEmptyString(obj.chapter_summary, "chapter_summary", 1000),
        relationship_summary_lines: ensureStringArray(obj.relationship_summary_lines || [], "relationship_summary_lines", 400),
        pending_events: ensureStringArray(obj.pending_events || [], "pending_events", 400),
        director_note: ensureOptionalString(obj.director_note, "director_note", 1000),
        transition_text: ensureOptionalString(obj.transition_text, "transition_text", 1000),
        suggested_choices: Object.freeze(
            Array.isArray(obj.suggested_choices) ? obj.suggested_choices.map(normalizeStoryChoice) : []
        )
    });
}