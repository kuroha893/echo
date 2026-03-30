// ---------------------------------------------------------------------------
// Director Service — Phase 1
// Deterministic speaker selection and plan management.
// ---------------------------------------------------------------------------

import {
    buildDirectorPlan,
    buildTurnQueueEntry,
    StoryThreadContractError,
    TURN_TYPE,
    DIRECTOR_USER_WAIT_POLICY,
    CAST_ACTIVATION_STATE
} from "./story_thread_contracts.mjs";

// ── Error ──────────────────────────────────────────────────────────────────

export class DirectorServiceError extends Error {
    constructor(message) {
        super(message);
        this.name = "DirectorServiceError";
    }
}

// ── Default scoring weights ────────────────────────────────────────────────

const DEFAULT_WEIGHTS = Object.freeze({
    scene_relevance: 1.0,
    relationship_tension: 0.8,
    user_cue_match: 2.0,
    recency_penalty: -0.6,
    latency_penalty: -0.2,
    presentation_focus_bonus: 0.3
});

const DEFAULT_MINIMUM_ACTION_THRESHOLD = 0.3;
const DEFAULT_MAX_CHAIN_LENGTH = 64;

// ── Score computation ──────────────────────────────────────────────────────

function computeCastScore(castMemberId, features, weights) {
    const w = weights || DEFAULT_WEIGHTS;
    let score = 0;

    score += (w.scene_relevance || 0) * (features.scene_relevance || 0);
    score +=
        (w.relationship_tension || 0) * (features.relationship_tension || 0);
    score += (w.user_cue_match || 0) * (features.user_cue_match || 0);
    score += (w.recency_penalty || 0) * (features.recency_penalty || 0);
    score += (w.latency_penalty || 0) * (features.latency_penalty || 0);
    score +=
        (w.presentation_focus_bonus || 0) *
        (features.presentation_focus_bonus || 0);

    return { cast_member_id: castMemberId, score, features };
}

// ── Phase 1 tie-break ──────────────────────────────────────────────────────

function tieBreakCompare(a, b) {
    // 1. explicit user cue match
    const aCue = (a.features && a.features.user_cue_match) || 0;
    const bCue = (b.features && b.features.user_cue_match) || 0;
    if (aCue !== bCue) return bCue - aCue;

    // 2. higher scene relevance
    const aRel = (a.features && a.features.scene_relevance) || 0;
    const bRel = (b.features && b.features.scene_relevance) || 0;
    if (aRel !== bRel) return bRel - aRel;

    // 3. longer time since last visible turn (lower recency_penalty = longer ago)
    const aRecency = (a.features && a.features.recency_penalty) || 0;
    const bRecency = (b.features && b.features.recency_penalty) || 0;
    if (aRecency !== bRecency) return aRecency - bRecency;

    // 4. lower predicted latency
    const aLatency = (a.features && a.features.latency_penalty) || 0;
    const bLatency = (b.features && b.features.latency_penalty) || 0;
    if (aLatency !== bLatency) return aLatency - bLatency;

    // 5. stable cast-member id ordering for determinism
    return a.cast_member_id < b.cast_member_id ? -1 : 1;
}

// ── Feature extraction helpers ─────────────────────────────────────────────

function extractCastFeatures(
    castMemberId,
    { sceneCard, bindings, thread, userCueTarget }
) {
    const binding = bindings.find(
        (b) => b.cast_member_id === castMemberId
    );

    const isFeatured =
        sceneCard &&
        sceneCard.featured_cast_ids &&
        sceneCard.featured_cast_ids.includes(castMemberId);

    const turnsSinceLastSpoken = binding
        ? thread.revision - (binding.last_observed_story_revision || 0)
        : thread.revision;

    const isUserCued =
        userCueTarget !== null && userCueTarget !== undefined
            ? userCueTarget === castMemberId
            : false;

    return {
        scene_relevance: isFeatured ? 1.0 : 0.3,
        relationship_tension: 0.0, // Phase 1: no rich relationship scoring
        user_cue_match: isUserCued ? 1.0 : 0.0,
        recency_penalty: turnsSinceLastSpoken > 0 ? 1.0 / turnsSinceLastSpoken : 1.0,
        latency_penalty: 0.0, // Phase 1: uniform latency assumption
        presentation_focus_bonus: 0.0 // Phase 1: no stage focus scoring
    };
}

// ── DirectorService ────────────────────────────────────────────────────────

export class DirectorService {
    constructor({
        weights = null,
        minimumActionThreshold = DEFAULT_MINIMUM_ACTION_THRESHOLD,
        maxChainLength = DEFAULT_MAX_CHAIN_LENGTH
    } = {}) {
        this._weights = weights || DEFAULT_WEIGHTS;
        this._minimumActionThreshold = minimumActionThreshold;
        this._maxChainLength = maxChainLength;
        this._currentPlan = null;
        this._chainCount = 0;
    }

    getCurrentPlan() {
        return this._currentPlan;
    }

    /**
     * Select the next speaker and produce a DirectorPlan.
     *
     * @param {object} params
     * @param {object} params.thread - StoryThread
     * @param {object} params.sceneCard - SceneCard
     * @param {object[]} params.castMembers - available CastMember[]
     * @param {object[]} params.bindings - CastSessionBinding[]
     * @param {string|null} params.userCueTarget - cast_member_id user explicitly named
     * @returns {{ plan: object, decisionTrace: object } | null}
     */
    selectNextSpeaker({
        thread,
        sceneCard,
        castMembers,
        bindings,
        userCueTarget = null,
        excludeCastMemberId = null,
        preferredCastIds = null,
        reasonOverride = null
    }) {
        if (!thread || !sceneCard) {
            throw new DirectorServiceError(
                "DirectorService.selectNextSpeaker requires thread and sceneCard"
            );
        }

        // Filter to eligible cast (active bindings only)
        const activeCastIds = new Set(
            bindings
                .filter((b) => b.activation_state === CAST_ACTIVATION_STATE.ACTIVE)
                .map((b) => b.cast_member_id)
        );

        let eligible = castMembers.filter(
            (cm) => activeCastIds.has(cm.cast_member_id)
        );

        if (Array.isArray(preferredCastIds) && preferredCastIds.length > 0) {
            const preferredSet = new Set(preferredCastIds);
            const preferredEligible = eligible.filter((cm) => preferredSet.has(cm.cast_member_id));
            if (preferredEligible.length > 0) {
                eligible = preferredEligible;
            }
        }

        if (excludeCastMemberId && eligible.length > 1) {
            const filteredEligible = eligible.filter(
                (cm) => cm.cast_member_id !== excludeCastMemberId
            );
            if (filteredEligible.length > 0) {
                eligible = filteredEligible;
            }
        }

        if (eligible.length === 0) {
            this._currentPlan = null;
            return null;
        }

        // Score each eligible cast member
        const scored = eligible.map((cm) => {
            const features = extractCastFeatures(cm.cast_member_id, {
                sceneCard,
                bindings,
                thread,
                userCueTarget
            });
            return computeCastScore(cm.cast_member_id, features, this._weights);
        });

        // Sort by score descending, then apply tie-break
        scored.sort((a, b) => {
            const diff = b.score - a.score;
            if (Math.abs(diff) > 1e-9) return diff;
            return tieBreakCompare(a, b);
        });

        const decisionTrace = Object.freeze({
            scores: scored.map((s) => ({
                cast_member_id: s.cast_member_id,
                score: s.score,
                features: { ...s.features }
            })),
            preferred_cast_ids: Array.isArray(preferredCastIds) ? [...preferredCastIds] : [],
            threshold: this._minimumActionThreshold,
            chain_count: this._chainCount,
            max_chain_length: this._maxChainLength
        });

        // Check chain budget
        if (this._chainCount >= this._maxChainLength) {
            this._chainCount = 0;
            this._currentPlan = null;
            return { plan: null, decisionTrace };
        }

        const top = scored[0];
        if (top.score < this._minimumActionThreshold) {
            // No cast member crosses the threshold — yield to user
            this._chainCount = 0;
            this._currentPlan = null;
            return { plan: null, decisionTrace };
        }

        // Build a single-entry turn queue with the selected speaker
        const turnEntry = buildTurnQueueEntry({
            castMemberId: top.cast_member_id,
            turnType: TURN_TYPE.CAST_TURN,
            reason:
                typeof reasonOverride === "string" && reasonOverride.trim() !== ""
                    ? reasonOverride.trim()
                    : `score=${top.score.toFixed(3)}`
        });

        const plan = buildDirectorPlan({
            threadId: thread.thread_id,
            sceneId: sceneCard.scene_id,
            turnQueue: [turnEntry],
            userWaitPolicy: DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN,
            decisionTrace
        });

        this._currentPlan = plan;
        this._chainCount += 1;

        return { plan, decisionTrace };
    }

    /**
     * Invalidate the current plan (e.g. on user intervention).
     */
    invalidateCurrentPlan(reason) {
        this._currentPlan = null;
        this._chainCount = 0;
    }

    /**
     * Reset chain counter (e.g. after user turn).
     */
    resetChain() {
        this._chainCount = 0;
    }
}
