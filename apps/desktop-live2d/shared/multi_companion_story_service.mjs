// ---------------------------------------------------------------------------
// Multi-Companion Story Service — Phase 1
// Top-level story mode orchestrator. Creates and manages story threads,
// coordinates cast sessions, and drives the turn pipeline.
// ---------------------------------------------------------------------------

import {
    buildStoryThread,
    buildCastSessionBinding,
    buildSceneCard,
    normalizeStoryThread,
    normalizeCastMember,
    normalizeCastSessionBinding,
    normalizeSceneCard,
    normalizeDirectorPlan,
    STORY_THREAD_STATUS,
    CAST_ACTIVATION_STATE,
    TURN_TYPE,
    buildRandomUuid
} from "./story_thread_contracts.mjs";
import {
    buildProjectionEvent,
    buildProjectionTimeline,
    appendToTimeline,
    getTimelineEvents,
    STORY_EVENT_KIND
} from "./story_projection_contracts.mjs";
import {
    buildNarratorState,
    normalizeNarratorState,
    normalizeNarratorDecision,
    DIRECTIVE_KIND,
    SPEAKER_LOCK_POLICY,
    NARRATOR_ACTION_KIND,
} from "./story_narrator_contracts.mjs";
import {
    buildFactRecord,
    FACT_TYPE,
    PROVENANCE_KIND,
    VISIBILITY_SCOPE
} from "./story_fact_contracts.mjs";
import { DirectorService } from "./director_service.mjs";
import { TurnCommitCoordinator, COMMIT_RESULT } from "./turn_commit_coordinator.mjs";
import { assembleInputSnapshot } from "./turn_assembler.mjs";
import { StageStateStore } from "./stage_state_store.mjs";
import { DIRECTOR_USER_WAIT_POLICY, advanceStoryThreadRevision } from "./story_thread_contracts.mjs";

// ── Error ──────────────────────────────────────────────────────────────────

export class MultiCompanionStoryServiceError extends Error {
    constructor(message) {
        super(message);
        this.name = "MultiCompanionStoryServiceError";
    }
}

// ── Service ────────────────────────────────────────────────────────────────

export class MultiCompanionStoryService {
    constructor() {
        this._thread = null;
        /** @type {Map<string, object>} cast_member_id → CastMember */
        this._castMembers = new Map();
        /** @type {Map<string, object>} cast_member_id → CastSessionBinding */
        this._bindings = new Map();
        this._sceneCard = null;
        this._lastCommittedCastMemberId = null;
        this._director = new DirectorService();
        this._commitCoordinator = new TurnCommitCoordinator();
        this._timeline = buildProjectionTimeline();
        this._stageStore = new StageStateStore();
        /** @type {object[]} all facts */
        this._facts = [];
        /** @type {object|null} fact_id → cast_member_id[] for subset visibility */
        this._castSubsets = null;
        /** @type {object[]} committed turn artifacts for replay */
        this._commitLog = [];
        /** @type {function|null} callback for projection events */
        this._onProjectionEvent = null;
        this._narratorState = null;
        this._narratorDirective = null;
        this._latestUserIntervention = null;
        this._continuationAnchor = null;
        this._sceneGoalLock = null;
        this._consumedInterventions = [];
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * Create a new story thread with the given cast.
     *
     * @param {object} params
     * @param {string} params.title
     * @param {string} params.mode - STORY_THREAD_MODE value
     * @param {object[]} params.castMembers - array of CastMember objects
     * @param {object} params.sceneCardInit - { sceneGoal, toneTagsList?, discourseConstraints?, userConstraints? }
     * @returns {object} the created StoryThread
     */
    createThread({ title, mode, castMembers, sceneCardInit }) {
        if (this._thread !== null) {
            throw new MultiCompanionStoryServiceError(
                "A story thread is already active. Close it before creating a new one."
            );
        }
        if (!castMembers || castMembers.length < 2) {
            throw new MultiCompanionStoryServiceError(
                "Multi-companion story mode requires at least 2 cast members"
            );
        }

        // Validate and store cast members
        this._castMembers.clear();
        const castIds = [];
        for (const raw of castMembers) {
            const cm = normalizeCastMember(raw);
            if (this._castMembers.has(cm.cast_member_id)) {
                throw new MultiCompanionStoryServiceError(
                    `Duplicate cast_member_id: ${cm.cast_member_id}`
                );
            }
            this._castMembers.set(cm.cast_member_id, cm);
            castIds.push(cm.cast_member_id);
        }

        // Build thread
        this._thread = buildStoryThread({ title, mode, castMemberIds: castIds });
        this._lastCommittedCastMemberId = null;

        // Build initial scene
        this._sceneCard = buildSceneCard({
            threadId: this._thread.thread_id,
            sceneGoal: sceneCardInit.sceneGoal,
            featuredCastIds: castIds,
            toneTagsList: sceneCardInit.toneTagsList || [],
            discourseConstraints: sceneCardInit.discourseConstraints || [],
            userConstraints: sceneCardInit.userConstraints || []
        });

        // Update thread refs
        this._thread = Object.freeze({
            ...this._thread,
            active_scene_id: this._sceneCard.scene_id
        });

        // Initialize stage
        this._stageStore.initializeForThread(this._thread.thread_id, castIds);

        // Reset timeline
        this._timeline = buildProjectionTimeline();
        this._commitLog = [];
        this._facts = [];
        this._castSubsets = null;
        this._narratorDirective = null;
        this._latestUserIntervention = null;
        this._continuationAnchor = null;
        this._sceneGoalLock = null;
        this._consumedInterventions = [];
        this._narratorState = buildNarratorState({
            threadId: this._thread.thread_id,
            sceneLabel: sceneCardInit.sceneLabel || sceneCardInit.sceneGoal,
            currentTimeLabel: sceneCardInit.currentTimeLabel || "永恒之夜",
            sceneGoal: this._sceneCard.scene_goal,
            narrativeFocus: sceneCardInit.sceneGoal,
            chapterSummary: sceneCardInit.sceneGoal,
            relationshipSummaryLines: [],
            pendingEvents: [],
            lastDirectorNote: null,
            suggestedChoices: [],
            stagnationScore: 0,
            closurePressureScore: 0,
            beatCounter: 0
        });

        return this._thread;
    }

    /**
     * Bind a cast member to a session.
     *
     * @param {string} castMemberId
     * @param {string} sessionId
     * @returns {object} CastSessionBinding
     */
    bindCastSession(castMemberId, sessionId) {
        this._ensureActiveThread();
        if (!this._castMembers.has(castMemberId)) {
            throw new MultiCompanionStoryServiceError(
                `Unknown cast_member_id: ${castMemberId}`
            );
        }
        const binding = buildCastSessionBinding({
            threadId: this._thread.thread_id,
            castMemberId,
            sessionId
        });
        this._bindings.set(castMemberId, binding);
        return binding;
    }

    // ── User turn ──────────────────────────────────────────────────────────

    /**
     * Record a user turn and get the next speaker decision.
     *
     * @param {string} text - user input text
     * @param {string|null} cueTarget - optional cast_member_id the user addressed
     * @returns {{ projectionEvent: object, nextSpeaker: object|null }}
     */
    submitUserTurn(text, cueTarget = null, choiceMetadata = null) {
        this._ensureActiveThread();

        // Project user input
        const nextThread = Object.freeze({
            ...this._thread,
            revision: this._thread.revision + 1,
            updated_at: new Date().toISOString(),
            last_user_turn_id: buildRandomUuid()
        });
        this._thread = nextThread;

        const projectionEvent = buildProjectionEvent({
            threadId: this._thread.thread_id,
            eventKind: STORY_EVENT_KIND.USER_INPUT,
            storyRevision: this._thread.revision,
            text
        });
        appendToTimeline(this._timeline, projectionEvent);
        this._emitProjection(projectionEvent);
        if (this._narratorState) {
            this._narratorState = Object.freeze({
                ...this._narratorState,
                suggested_choices: Object.freeze([]),
                last_user_wait_policy: DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN
            });
        }
        this._narratorDirective = null;
        const intervention = this._applyUserInterventionToSharedState(text, cueTarget, choiceMetadata);

        // Director decides next speaker
        this._director.resetChain();
        const decision = this._director.selectNextSpeaker({
            thread: this._thread,
            sceneCard: this._sceneCard,
            castMembers: [...this._castMembers.values()],
            excludeCastMemberId:
                this._castMembers.size > 1 ? this._lastCommittedCastMemberId : null,
            bindings: [...this._bindings.values()],
            userCueTarget: intervention?.response_cue_target || cueTarget,
            preferredCastIds: intervention?.preferred_responder_cast_ids || null,
            reasonOverride: intervention?.director_hint || null
        });

        return {
            projectionEvent,
            nextSpeaker: decision,
            intervention
        };
    }

    // ── Cast turn pipeline ─────────────────────────────────────────────────

    /**
     * Assemble the input snapshot for a cast turn.
     *
     * @param {string} castMemberId
     * @param {string|null} userIntervention
     * @returns {object} frozen input snapshot
     */
    assembleForCast(castMemberId, userIntervention = null) {
        this._ensureActiveThread();
        const castMember = this._castMembers.get(castMemberId);
        if (!castMember) {
            throw new MultiCompanionStoryServiceError(
                `Unknown cast_member_id: ${castMemberId}`
            );
        }

        return assembleInputSnapshot({
            castMember,
            thread: this._thread,
            sceneCard: this._sceneCard,
            recentProjectionEvents: getTimelineEvents(this._timeline),
            facts: this._facts,
            castSubsets: this._castSubsets,
            userIntervention: this._buildTurnUserInterventionText(userIntervention),
            directorPlan: this._director.getCurrentPlan(),
            narratorState: this._narratorState,
            continuationAnchor: this._continuationAnchor?.cast_member_id === castMemberId
                && this._continuationAnchor?.anchor_scene_id === this._sceneCard?.scene_id
                ? this._continuationAnchor
                : null,
        });
    }

    /**
     * Register a provisional generation output.
     *
     * @param {string} castMemberId
     * @param {string} inputSnapshotId
     * @param {object} structuredOutput - structured turn output from model
     */
    registerProvisionalTurn(castMemberId, inputSnapshotId, structuredOutput) {
        this._ensureActiveThread();
        const binding = this._bindings.get(castMemberId);
        if (!binding) {
            throw new MultiCompanionStoryServiceError(
                `No session binding for cast_member_id: ${castMemberId}`
            );
        }

        return this._commitCoordinator.registerProvisional({
            inputSnapshotId,
            castMemberId,
            sessionId: binding.session_id,
            structuredOutput,
            expectedRevision: this._thread.revision
        });
    }

    /**
     * Attempt to commit the provisional turn.
     *
     * @param {string} castMemberId
     * @returns {{ result: string, projectionEvent: object|null, commitArtifact: object|null }}
     */
    tryCommitTurn(castMemberId) {
        this._ensureActiveThread();
        const binding = this._bindings.get(castMemberId);
        if (!binding) {
            throw new MultiCompanionStoryServiceError(
                `No session binding for cast_member_id: ${castMemberId}`
            );
        }

        const commitResult = this._commitCoordinator.tryCommit({
            thread: this._thread,
            sceneCard: this._sceneCard,
            binding
        });

        if (commitResult.result === COMMIT_RESULT.SUCCESS) {
            // Apply committed state
            this._thread = commitResult.thread;
            this._bindings.set(castMemberId, commitResult.binding);

            // Append to timeline with dedup
            appendToTimeline(this._timeline, commitResult.projectionEvent);
            this._emitProjection(commitResult.projectionEvent);

            // Update stage state
            const emotionTag =
                commitResult.commitArtifact &&
                    commitResult.commitArtifact.structured_output
                    ? commitResult.commitArtifact.structured_output.emotion_tag
                    : null;
            this._stageStore.updateAfterCommit(
                this._thread.revision,
                castMemberId,
                emotionTag
            );

            // Log for replay
            this._commitLog.push(commitResult.commitArtifact);
            this._lastCommittedCastMemberId = castMemberId;

            // Release scene_goal_lock if locked speaker committed
            if (this._sceneGoalLock?.release_on_speaker === castMemberId) {
                this._sceneGoalLock = null;
            }
            // Clear continuation_anchor if this cast member completed turn
            if (this._continuationAnchor?.cast_member_id === castMemberId) {
                this._continuationAnchor = null;
            }
        }

        return {
            result: commitResult.result,
            projectionEvent: commitResult.projectionEvent,
            commitArtifact: commitResult.commitArtifact
        };
    }

    // ── Director ───────────────────────────────────────────────────────────

    /**
     * Ask the director for the next action after a committed turn.
     *
     * @returns {{ plan: object|null, decisionTrace: object } | null}
     */
    decideNextAction() {
        this._ensureActiveThread();
        if (
            this._narratorDirective &&
            this._narratorDirective.user_wait_policy !== DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN
        ) {
            return {
                plan: null,
                decisionTrace: Object.freeze({
                    source: "narrator",
                    action_kind: this._narratorDirective.action_kind,
                    user_wait_policy: this._narratorDirective.user_wait_policy
                })
            };
        }
        const castMembers = [...this._castMembers.values()];
        const preferredCastIds = this._narratorDirective?.target_cast_ids || null;
        const userCueTarget = Array.isArray(preferredCastIds) && preferredCastIds.length > 0
            ? preferredCastIds[0]
            : null;
        return this._director.selectNextSpeaker({
            thread: this._thread,
            sceneCard: this._sceneCard,
            castMembers,
            bindings: [...this._bindings.values()],
            userCueTarget,
            preferredCastIds,
            reasonOverride: this._narratorDirective?.director_hint || null,
            excludeCastMemberId:
                castMembers.length > 1 ? this._lastCommittedCastMemberId : null
        });
    }

    applyNarratorDecision(rawDecision) {
        this._ensureActiveThread();
        const decision = normalizeNarratorDecision(rawDecision);

        // scene_goal_lock guard — prevent narrator from overwriting scene_goal
        const lock = this._sceneGoalLock;
        const lockActive = lock?.active === true
            && (typeof lock.expires_after_revision !== "number" || this._thread.revision <= lock.expires_after_revision);

        if (decision.scene_goal !== this._sceneCard.scene_goal) {
            // SCENE_TRANSITION can break through lock
            if (!lockActive || decision.action_kind === NARRATOR_ACTION_KIND.SCENE_TRANSITION) {
                this._sceneCard = Object.freeze({
                    ...this._sceneCard,
                    scene_goal: decision.scene_goal
                });
                if (decision.action_kind === NARRATOR_ACTION_KIND.SCENE_TRANSITION) {
                    this._sceneGoalLock = null;
                    this._continuationAnchor = null;
                }
            }
        }

        if (decision.target_cast_ids.length > 0) {
            this._sceneCard = Object.freeze({
                ...this._sceneCard,
                featured_cast_ids: Object.freeze([...decision.target_cast_ids])
            });
        }

        const emittedEvents = [];
        if (decision.director_note) {
            emittedEvents.push(
                this._appendSystemProjectionEvent(
                    STORY_EVENT_KIND.DIRECTOR_NOTE,
                    decision.director_note
                )
            );
        }
        if (decision.transition_text) {
            emittedEvents.push(
                this._appendSystemProjectionEvent(
                    STORY_EVENT_KIND.SCENE_TRANSITION,
                    decision.transition_text
                )
            );
        }

        const previousState = this._narratorState;
        this._narratorState = buildNarratorState({
            threadId: this._thread.thread_id,
            sceneLabel: decision.scene_label,
            currentTimeLabel: decision.current_time_label,
            sceneGoal: decision.scene_goal,
            narrativeFocus: decision.narrative_focus,
            chapterSummary: decision.chapter_summary,
            relationshipSummaryLines: decision.relationship_summary_lines,
            pendingEvents: decision.pending_events,
            lastDirectorNote: decision.director_note || previousState?.last_director_note || null,
            suggestedChoices: decision.suggested_choices,
            stagnationScore: previousState?.stagnation_score || 0,
            closurePressureScore: previousState?.closure_pressure_score || 0,
            beatCounter: (previousState?.beat_counter || 0) + 1,
            lastNarratorActionKind: decision.action_kind,
            lastUserWaitPolicy: decision.user_wait_policy
        });
        this._narratorDirective = decision;

        return Object.freeze({
            decision,
            emitted_events: Object.freeze(emittedEvents)
        });
    }

    updateNarratorTelemetry({ stagnationScore = null, closurePressureScore = null } = {}) {
        this._ensureActiveThread();
        if (!this._narratorState) {
            return null;
        }
        this._narratorState = Object.freeze({
            ...this._narratorState,
            stagnation_score:
                typeof stagnationScore === "number" && !Number.isNaN(stagnationScore)
                    ? stagnationScore
                    : this._narratorState.stagnation_score,
            closure_pressure_score:
                typeof closurePressureScore === "number" && !Number.isNaN(closurePressureScore)
                    ? closurePressureScore
                    : this._narratorState.closure_pressure_score
        });
        return this._narratorState;
    }

    /**
     * Invalidate the current director plan (e.g. user interrupted).
     */
    invalidatePlan(reason) {
        this._director.invalidateCurrentPlan(reason);
        this._commitCoordinator.discardProvisional();
        this._lastCommittedCastMemberId = null;
        this._narratorDirective = null;
    }

    // ── Query ──────────────────────────────────────────────────────────────

    getThread() {
        return this._thread;
    }

    getSceneCard() {
        return this._sceneCard;
    }

    getCastMembers() {
        return Object.freeze([...this._castMembers.values()]);
    }

    getBindings() {
        return Object.freeze([...this._bindings.values()]);
    }

    getTimeline() {
        return getTimelineEvents(this._timeline);
    }

    getStageState() {
        return this._stageStore.getStageState();
    }

    getCastPresentationState(castMemberId) {
        return this._stageStore.getCastPresentationState(castMemberId);
    }

    getCommitLog() {
        return Object.freeze([...this._commitLog]);
    }

    getNarratorState() {
        return this._narratorState;
    }

    getLatestIntervention() {
        return this._latestUserIntervention;
    }

    getSceneGoalLock() {
        return this._sceneGoalLock;
    }

    isCastMemberActive(castMemberId) {
        const binding = this._bindings.get(castMemberId);
        if (!binding) return false;
        return binding.activation_state === CAST_ACTIVATION_STATE.ACTIVE;
    }

    releaseSceneGoalLock() {
        this._sceneGoalLock = null;
    }

    incrementLockFailedAttempts() {
        if (!this._sceneGoalLock?.active) return;
        this._sceneGoalLock = Object.freeze({
            ...this._sceneGoalLock,
            failed_attempts: (this._sceneGoalLock.failed_attempts || 0) + 1,
        });
    }

    consumeInterventionIfNeeded(castMemberId) {
        if (!this._latestUserIntervention) return;
        if (this._latestUserIntervention.kind !== "authorial_directive") return;
        const lock = this._latestUserIntervention.speaker_lock;
        if (lock && lock !== castMemberId) return;
        this._consumedInterventions.push(Object.freeze({
            ...this._latestUserIntervention,
            consumed_at_revision: this._thread.revision,
        }));
        if (this._consumedInterventions.length > 4) {
            this._consumedInterventions = this._consumedInterventions.slice(-4);
        }
        this._latestUserIntervention = null;
    }

    // ── Projection callback ────────────────────────────────────────────────

    onProjectionEvent(callback) {
        this._onProjectionEvent = callback;
    }

    // ── Persistence ────────────────────────────────────────────────────────

    /**
     * Serialize the full state for persistence.
     */
    toJSON() {
        // Only persist intervention types with durable semantics
        const persistableIntervention = this._latestUserIntervention
            && this._latestUserIntervention.kind !== "generic_user_input"
            ? this._latestUserIntervention
            : null;
        return {
            thread: this._thread,
            cast_members: Object.fromEntries(this._castMembers),
            bindings: Object.fromEntries(this._bindings),
            scene_card: this._sceneCard,
            timeline_events: getTimelineEvents(this._timeline),
            stage_state: this._stageStore.toJSON(),
            facts: this._facts,
            cast_subsets: this._castSubsets,
            commit_log: this._commitLog,
            last_committed_cast_member_id: this._lastCommittedCastMemberId,
            narrator_state: this._narratorState,
            latest_user_intervention: persistableIntervention,
            scene_goal_lock: this._sceneGoalLock,
            continuation_anchor: this._continuationAnchor,
        };
    }

    /**
     * Restore state from persisted data.
     * Recovery rule: any in-flight provisional output is discarded.
     */
    restoreFromJSON(data) {
        if (!data || !data.thread) {
            throw new MultiCompanionStoryServiceError(
                "restoreFromJSON: data.thread is required"
            );
        }

        this._thread = normalizeStoryThread(data.thread);

        this._castMembers.clear();
        if (data.cast_members) {
            for (const [key, value] of Object.entries(data.cast_members)) {
                this._castMembers.set(key, normalizeCastMember(value));
            }
        }

        this._bindings.clear();
        if (data.bindings) {
            for (const [key, value] of Object.entries(data.bindings)) {
                this._bindings.set(key, normalizeCastSessionBinding(value));
            }
        }

        this._sceneCard = data.scene_card
            ? normalizeSceneCard(data.scene_card)
            : null;

        // Rebuild timeline with dedup protection
        this._timeline = buildProjectionTimeline();
        if (Array.isArray(data.timeline_events)) {
            for (const event of data.timeline_events) {
                appendToTimeline(this._timeline, event);
            }
        }

        // Restore stage
        if (data.stage_state) {
            this._stageStore.restoreFromJSON(data.stage_state);
        }

        this._facts = Array.isArray(data.facts) ? [...data.facts] : [];
        this._castSubsets = data.cast_subsets || null;
        this._commitLog = Array.isArray(data.commit_log) ? [...data.commit_log] : [];
        this._lastCommittedCastMemberId =
            typeof data.last_committed_cast_member_id === "string"
                ? data.last_committed_cast_member_id
                : null;

        // Restore intervention state (with validity recheck)
        this._latestUserIntervention = data.latest_user_intervention || null;
        this._sceneGoalLock = data.scene_goal_lock || null;
        this._continuationAnchor = data.continuation_anchor || null;
        this._consumedInterventions = [];
        this._validateRestoredInterventionState();

        this._narratorState = data.narrator_state
            ? normalizeNarratorState(data.narrator_state)
            : buildNarratorState({
                threadId: this._thread.thread_id,
                sceneLabel: this._sceneCard?.scene_goal || this._thread.title,
                currentTimeLabel: "永恒之夜",
                sceneGoal: this._sceneCard?.scene_goal || this._thread.title,
                narrativeFocus: this._sceneCard?.scene_goal || this._thread.title,
                chapterSummary: this._sceneCard?.scene_goal || this._thread.title,
                relationshipSummaryLines: [],
                pendingEvents: []
            });
        this._narratorDirective = null;

        // Director and commit coordinator start fresh — no stale provisional
        this._director = new DirectorService();
        this._commitCoordinator = new TurnCommitCoordinator();

        return this._thread;
    }

    // ── Internal ───────────────────────────────────────────────────────────

    _ensureActiveThread() {
        if (!this._thread) {
            throw new MultiCompanionStoryServiceError(
                "No active story thread"
            );
        }
        if (this._thread.status !== STORY_THREAD_STATUS.ACTIVE) {
            throw new MultiCompanionStoryServiceError(
                `Story thread is ${this._thread.status}, not active`
            );
        }
    }

    _emitProjection(event) {
        if (typeof this._onProjectionEvent === "function") {
            this._onProjectionEvent(event);
        }
    }

    _appendSystemProjectionEvent(eventKind, text) {
        this._thread = advanceStoryThreadRevision(this._thread);
        const projectionEvent = buildProjectionEvent({
            threadId: this._thread.thread_id,
            eventKind,
            storyRevision: this._thread.revision,
            text
        });
        appendToTimeline(this._timeline, projectionEvent);
        this._stageStore.updateAfterDirectorBeat(this._thread.revision);
        this._emitProjection(projectionEvent);
        return projectionEvent;
    }

    _buildTurnUserInterventionText(rawUserIntervention) {
        const normalizedRaw = typeof rawUserIntervention === "string" && rawUserIntervention.trim() !== ""
            ? rawUserIntervention.trim()
            : null;
        const intervention = this._latestUserIntervention;
        if (!normalizedRaw && !intervention) {
            return null;
        }

        const lines = [];
        if (normalizedRaw) {
            lines.push(`Latest user intervention: ${normalizedRaw}`);
        }
        if (intervention?.constraint_text) {
            lines.push("Treat this as an authoritative world-state update, not as dialogue someone literally spoke aloud.");
            lines.push(`Active world rule: ${intervention.constraint_text}`);
        }
        if (intervention?.target_cast_display_name) {
            lines.push(`Affected cast member: ${intervention.target_cast_display_name}`);
        }
        if (intervention?.director_hint) {
            lines.push(`Required response strategy: ${intervention.director_hint}`);
        }
        return lines.join("\n");
    }

    _applyUserInterventionToSharedState(text, cueTarget, choiceMetadata = null) {
        const intervention = this._interpretUserIntervention(text, cueTarget, choiceMetadata);
        this._latestUserIntervention = intervention;
        this._continuationAnchor = intervention?.continuation_anchor || null;
        this._sceneGoalLock = intervention?.scene_goal_lock || null;
        if (!intervention) {
            return null;
        }

        if (intervention.constraint_text) {
            const existingConstraints = Array.isArray(this._sceneCard?.user_constraints)
                ? this._sceneCard.user_constraints.filter((item) => item !== intervention.constraint_text)
                : [];
            this._sceneCard = Object.freeze({
                ...this._sceneCard,
                scene_goal: intervention.scene_goal || this._sceneCard.scene_goal,
                user_constraints: Object.freeze([intervention.constraint_text, ...existingConstraints].slice(0, 8)),
                featured_cast_ids: Object.freeze(
                    Array.isArray(intervention.featured_cast_ids) && intervention.featured_cast_ids.length > 0
                        ? [...intervention.featured_cast_ids]
                        : [...this._sceneCard.featured_cast_ids]
                )
            });
        }

        if (intervention.world_fact_content) {
            this._facts = Object.freeze([
                buildFactRecord({
                    factType: FACT_TYPE.WORLD,
                    content: intervention.world_fact_content,
                    provenance: PROVENANCE_KIND.USER_AUTHORED,
                    visibilityScope: VISIBILITY_SCOPE.PUBLIC_TO_ALL_CAST,
                    revisionIntroduced: this._thread.revision
                }),
                ...this._facts
            ]);
        }

        if (this._narratorState) {
            const nextPendingEvents = intervention.pending_event
                ? [
                    intervention.pending_event,
                    ...(this._narratorState.pending_events || []).filter((item) => item !== intervention.pending_event)
                ].slice(0, 4)
                : this._narratorState.pending_events;
            this._narratorState = Object.freeze({
                ...this._narratorState,
                scene_goal: intervention.scene_goal || this._narratorState.scene_goal,
                narrative_focus: intervention.narrative_focus || this._narratorState.narrative_focus,
                chapter_summary: intervention.chapter_summary || this._narratorState.chapter_summary,
                pending_events: Object.freeze(nextPendingEvents || []),
                suggested_choices: Object.freeze([]),
                last_user_wait_policy: DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN
            });
        }

        return intervention;
    }

    _interpretUserIntervention(text, cueTarget, choiceMetadata = null) {
        if (typeof text !== "string" || text.trim() === "") {
            return null;
        }

        // Path A: structured choice metadata (highest priority, no NLU)
        if (choiceMetadata && typeof choiceMetadata === "object" && choiceMetadata.choice_id) {
            return this._buildInterventionFromChoiceMetadata(choiceMetadata, text);
        }

        // Path B: free-text refusal pattern (existing logic)
        const normalizedText = text.replace(/\s+/g, "").trim();
        const isRefusal = /(不想|不要|不肯|拒绝|不愿|别)(听|看|去|聊|继续|答应|配合)?/.test(normalizedText);
        if (isRefusal) {
            return this._buildRefusalIntervention(normalizedText, cueTarget);
        }

        // Path C: generic free-text — always produce minimal intervention
        return this._buildGenericIntervention(text, cueTarget);
    }

    _buildInterventionFromChoiceMetadata(meta, rawText) {
        // Stale choice check — hard rejection
        // source_revision is the revision when choices were generated.
        // submitUserTurn already bumped revision by 1 for the user_input event,
        // so the expected source_revision is (current - 1).
        if (meta.source_revision != null && meta.source_revision !== this._thread.revision - 1) {
            return Object.freeze({
                kind: "stale_choice",
                choice_id: meta.choice_id,
                source_revision: meta.source_revision,
                current_revision: this._thread.revision,
                director_hint: null,
                response_cue_target: null,
                preferred_responder_cast_ids: null,
                featured_cast_ids: null,
                speaker_lock: null,
                continuation_anchor: null,
                scene_goal_lock: null,
                constraint_text: null,
                world_fact_content: null,
                scene_goal: null,
                chapter_summary: null,
                narrative_focus: null,
                pending_event: null,
            });
        }

        const directiveKind = meta.directive_kind || null;
        const targetCastId = meta.target_speaker_id && this._castMembers.has(meta.target_speaker_id)
            ? meta.target_speaker_id : null;
        const targetCast = targetCastId ? this._castMembers.get(targetCastId) : null;
        const targetDisplayName = targetCast?.display_name || null;
        const currentRevision = this._thread.revision;

        // Speaker lock policy lookup
        const lockPolicy = SPEAKER_LOCK_POLICY[directiveKind] || "forbidden";
        const speakerLock = lockPolicy === "required" ? targetCastId : null;

        // Continuation anchor (for "continue" directive)
        const isContinue = directiveKind === DIRECTIVE_KIND.CONTINUE;
        let continuationAnchor = null;
        if (isContinue && targetCastId) {
            const currentSceneId = this._sceneCard?.scene_id || null;
            const timeline = getTimelineEvents(this._timeline);
            const lastTargetEvent = [...timeline].reverse().find(
                (e) => e.event_kind === "cast_spoken"
                    && e.cast_member_id === targetCastId
                    && e.story_revision >= currentRevision - 4
            );
            if (lastTargetEvent) {
                continuationAnchor = Object.freeze({
                    cast_member_id: targetCastId,
                    anchor_text: lastTargetEvent.text,
                    anchor_revision: lastTargetEvent.story_revision,
                    anchor_event_id: lastTargetEvent.event_id,
                    anchor_scene_id: currentSceneId,
                });
            }
        }

        // Scene goal lock (for "continue" directive)
        const sceneGoalLock = isContinue ? Object.freeze({
            active: true,
            expires_after_revision: currentRevision + 1,
            release_on_speaker: targetCastId,
            max_failed_attempts: 2,
            failed_attempts: 0,
        }) : null;

        // featured_cast_ids: clear for scene_shift/pause
        const isNonSpeaker = directiveKind === DIRECTIVE_KIND.SCENE_SHIFT || directiveKind === DIRECTIVE_KIND.PAUSE;
        const featuredCastIds = isNonSpeaker ? null
            : targetCastId ? Object.freeze([targetCastId]) : null;

        return Object.freeze({
            kind: "authorial_directive",
            choice_id: meta.choice_id,
            source_revision: meta.source_revision || null,
            directive_kind: directiveKind,
            target_cast_id: targetCastId,
            target_cast_display_name: targetDisplayName,
            continuation_anchor: continuationAnchor,
            speaker_lock: speakerLock,
            preferred_responder_cast_ids:
                (lockPolicy === "required" || lockPolicy === "preferred") && targetCastId
                    ? Object.freeze([targetCastId]) : null,
            response_cue_target:
                (lockPolicy === "required" || lockPolicy === "preferred") && targetCastId
                    ? targetCastId : null,
            featured_cast_ids: featuredCastIds,
            scene_goal_lock: sceneGoalLock,
            scene_goal: null,
            constraint_text: null,
            world_fact_content: null,
            chapter_summary: null,
            narrative_focus: null,
            pending_event: null,
            director_hint: targetDisplayName
                ? `${targetDisplayName} should speak next. Directive: ${directiveKind}.`
                : `Directive: ${directiveKind}.`,
        });
    }

    _buildRefusalIntervention(normalizedText, cueTarget) {
        const targetCastId = this._inferInterventionTargetCastId(normalizedText, cueTarget);
        const targetCast = targetCastId ? this._castMembers.get(targetCastId) || null : null;
        const targetCastDisplayName = targetCast?.display_name || "目标角色";
        const otherCastIds = [...this._castMembers.keys()].filter((castMemberId) => castMemberId !== targetCastId);
        const actionLabel = this._resolveRefusalActionLabel(normalizedText);
        const constraintText = `${targetCastDisplayName}明确拒绝${actionLabel}；这条拒绝现在是当前场景的真实约束，其他角色不能继续把${actionLabel}当成默认推进方向。`;

        return Object.freeze({
            kind: "refusal_constraint",
            choice_id: null,
            source_revision: null,
            directive_kind: null,
            target_cast_id: targetCastId,
            target_cast_display_name: targetCastDisplayName,
            continuation_anchor: null,
            speaker_lock: null,
            preferred_responder_cast_ids: otherCastIds.length > 0 ? Object.freeze(otherCastIds) : (targetCastId ? Object.freeze([targetCastId]) : Object.freeze([])),
            response_cue_target: otherCastIds[0] || cueTarget || null,
            featured_cast_ids: Object.freeze(
                [
                    ...(otherCastIds.length > 0 ? [otherCastIds[0]] : []),
                    ...(targetCastId ? [targetCastId] : [])
                ]
            ),
            scene_goal_lock: null,
            constraint_text: constraintText,
            world_fact_content: `${targetCastDisplayName}当前明确拒绝${actionLabel}。`,
            scene_goal: `${targetCastDisplayName}拒绝${actionLabel}后，其他人必须回应这次拒绝并调整互动方向，而不是继续沿着原计划推进。`,
            chapter_summary: `${targetCastDisplayName}已经明确拒绝${actionLabel}，场景方向需要被重算。`,
            narrative_focus: `新的关键事实是${targetCastDisplayName}拒绝${actionLabel}；后续回应必须承认这条新规则。`,
            pending_event: `有人需要正面回应${targetCastDisplayName}拒绝${actionLabel}，而不是继续原来的提议。`,
            director_hint: `Acknowledge that ${targetCastDisplayName} has already refused ${actionLabel}. Do not continue the old plan. Reframe the scene around respecting, challenging, or emotionally processing that refusal.`
        });
    }

    _buildGenericIntervention(text, cueTarget) {
        const targetCastId = this._inferInterventionTargetCastId(text.replace(/\s+/g, ""), cueTarget);
        return Object.freeze({
            kind: "generic_user_input",
            choice_id: null,
            source_revision: null,
            directive_kind: null,
            target_cast_id: targetCastId,
            target_cast_display_name: targetCastId ? (this._castMembers.get(targetCastId)?.display_name || null) : null,
            continuation_anchor: null,
            speaker_lock: null,
            preferred_responder_cast_ids: null,
            response_cue_target: targetCastId || cueTarget,
            featured_cast_ids: null,
            scene_goal_lock: null,
            constraint_text: null,
            world_fact_content: null,
            scene_goal: null,
            chapter_summary: null,
            narrative_focus: null,
            pending_event: null,
            director_hint: `User directed: ${text.slice(0, 200)}`,
        });
    }

    _validateRestoredInterventionState() {
        // After restore, validate that locked/referenced cast members still exist
        if (this._latestUserIntervention?.speaker_lock
            && !this._castMembers.has(this._latestUserIntervention.speaker_lock)) {
            this._latestUserIntervention = null;
        }
        if (this._sceneGoalLock?.release_on_speaker
            && !this._castMembers.has(this._sceneGoalLock.release_on_speaker)) {
            this._sceneGoalLock = null;
        }
        if (this._continuationAnchor) {
            if (!this._castMembers.has(this._continuationAnchor.cast_member_id)) {
                this._continuationAnchor = null;
            } else if (this._continuationAnchor.anchor_scene_id
                && this._sceneCard?.scene_id
                && this._continuationAnchor.anchor_scene_id !== this._sceneCard.scene_id) {
                this._continuationAnchor = null;
            }
        }
    }

    _inferInterventionTargetCastId(text, cueTarget) {
        if (cueTarget && this._castMembers.has(cueTarget)) {
            return cueTarget;
        }

        for (const castMember of this._castMembers.values()) {
            const displayName = typeof castMember.display_name === "string"
                ? castMember.display_name.replace(/\s+/g, "")
                : "";
            if (displayName && text.includes(displayName)) {
                return castMember.cast_member_id;
            }
        }

        if (/(她|他|对方|另一个|另一位)/.test(text) && this._castMembers.size === 2) {
            if (this._lastCommittedCastMemberId) {
                const otherCastId = [...this._castMembers.keys()].find((castMemberId) => castMemberId !== this._lastCommittedCastMemberId);
                if (otherCastId) {
                    return otherCastId;
                }
            }
            const stageFocus = this._stageStore.getStageState()?.camera_focus || null;
            if (stageFocus && this._castMembers.has(stageFocus)) {
                return stageFocus;
            }
        }

        const featuredCastId = this._sceneCard?.featured_cast_ids?.[0] || null;
        if (featuredCastId && this._castMembers.has(featuredCastId)) {
            return featuredCastId;
        }

        return this._lastCommittedCastMemberId && this._castMembers.has(this._lastCommittedCastMemberId)
            ? this._lastCommittedCastMemberId
            : null;
    }

    _resolveRefusalActionLabel(text) {
        if (/(歌|听|唱|曲)/.test(text)) {
            return "听歌";
        }
        if (/(看)/.test(text)) {
            return "看这个提议的内容";
        }
        if (/(去)/.test(text)) {
            return "去做当前提议的事";
        }
        if (/(聊|说)/.test(text)) {
            return "继续这个话题";
        }
        return "继续当前提议";
    }
}
