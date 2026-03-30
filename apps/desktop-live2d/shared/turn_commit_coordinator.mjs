// ---------------------------------------------------------------------------
// Turn Commit Coordinator — Phase 1
// Provisional-to-committed cast turn pipeline with compare-and-swap.
// ---------------------------------------------------------------------------

import {
    advanceStoryThreadRevision,
    markBindingTurnCompleted,
    StoryThreadContractError
} from "./story_thread_contracts.mjs";
import {
    normalizeStructuredTurnOutput,
    normalizeDeltaCandidate
} from "./story_fact_contracts.mjs";
import {
    buildProjectionEvent,
    STORY_EVENT_KIND
} from "./story_projection_contracts.mjs";

// ── Error ──────────────────────────────────────────────────────────────────

export class TurnCommitError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "TurnCommitError";
        this.code = code || "COMMIT_FAILED";
    }
}

// ── Commit result codes ────────────────────────────────────────────────────

export const COMMIT_RESULT = Object.freeze({
    SUCCESS: "success",
    STALE_REVISION: "stale_revision",
    VALIDATION_FAILED: "validation_failed"
});

// ── Phase 1 delta validator ────────────────────────────────────────────────

function validateDeltaCandidates(deltas, _thread, _sceneCard) {
    // Phase 1: structural validation only — no rich world/relationship checks
    const errors = [];
    for (let i = 0; i < deltas.length; i += 1) {
        const d = deltas[i];
        if (!d.operation_kind) {
            errors.push(`delta[${i}]: missing operation_kind`);
        }
        if (!d.target_artifact_type) {
            errors.push(`delta[${i}]: missing target_artifact_type`);
        }
    }
    return Object.freeze({
        valid: errors.length === 0,
        errors: Object.freeze(errors)
    });
}

// ── TurnCommitCoordinator ──────────────────────────────────────────────────

export class TurnCommitCoordinator {
    constructor() {
        this._pendingProvisional = null;
    }

    /**
     * Step 1–2: Register a provisional turn output from generation.
     *
     * @param {object} params
     * @param {string} params.inputSnapshotId - The frozen input snapshot id
     * @param {string} params.castMemberId
     * @param {string} params.sessionId
     * @param {object} params.structuredOutput - raw structured output from model
     * @param {number} params.expectedRevision - thread.revision at generation time
     */
    registerProvisional({
        inputSnapshotId,
        castMemberId,
        sessionId,
        structuredOutput,
        expectedRevision
    }) {
        if (this._pendingProvisional !== null) {
            throw new TurnCommitError(
                "Previous provisional turn not yet committed or discarded",
                "PROVISIONAL_CONFLICT"
            );
        }

        const validated = normalizeStructuredTurnOutput(structuredOutput);

        const provisionalId =
            globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
                ? globalThis.crypto.randomUUID()
                : `prov-${Date.now()}`;

        this._pendingProvisional = Object.freeze({
            provisional_id: provisionalId,
            input_snapshot_id: inputSnapshotId,
            cast_member_id: castMemberId,
            session_id: sessionId,
            structured_output: validated,
            expected_revision: expectedRevision,
            created_at: new Date().toISOString()
        });

        return this._pendingProvisional;
    }

    /**
     * Step 3–6: Attempt to commit the provisional turn.
     *
     * Compare-and-swap: commits only if thread.revision === expectedRevision.
     *
     * @param {object} params
     * @param {object} params.thread - current StoryThread
     * @param {object} params.sceneCard - current SceneCard
     * @param {object} params.binding - CastSessionBinding for this cast
     * @returns {{ result: string, thread: object|null, binding: object|null,
     *             projectionEvent: object|null, commitArtifact: object|null,
     *             validationResult: object|null }}
     */
    tryCommit({ thread, sceneCard, binding }) {
        const prov = this._pendingProvisional;
        if (prov === null) {
            throw new TurnCommitError(
                "No provisional turn to commit",
                "NO_PROVISIONAL"
            );
        }

        // Compare-and-swap check
        if (thread.revision !== prov.expected_revision) {
            this._pendingProvisional = null;
            return {
                result: COMMIT_RESULT.STALE_REVISION,
                thread: null,
                binding: null,
                projectionEvent: null,
                commitArtifact: null,
                validationResult: null
            };
        }

        // Collect all delta candidates
        const allDeltas = [
            ...prov.structured_output.relationship_delta_candidates,
            ...prov.structured_output.world_delta_candidates
        ];

        // Validate deltas
        const validationResult = validateDeltaCandidates(
            allDeltas,
            thread,
            sceneCard
        );
        if (!validationResult.valid) {
            this._pendingProvisional = null;
            return {
                result: COMMIT_RESULT.VALIDATION_FAILED,
                thread: null,
                binding: null,
                projectionEvent: null,
                commitArtifact: null,
                validationResult
            };
        }

        // Commit: advance revision
        const nextThread = advanceStoryThreadRevision(thread);

        // Update binding
        const nextBinding = markBindingTurnCompleted(
            binding,
            nextThread.revision
        );

        // Build committed turn id
        const committedTurnId =
            globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
                ? globalThis.crypto.randomUUID()
                : `turn-${Date.now()}`;

        // Produce projection event
        const projectionEvent = buildProjectionEvent({
            threadId: nextThread.thread_id,
            eventKind: STORY_EVENT_KIND.CAST_SPOKEN,
            castMemberId: prov.cast_member_id,
            sessionId: prov.session_id,
            storyRevision: nextThread.revision,
            text: prov.structured_output.spoken_text,
            inputSnapshotId: prov.input_snapshot_id,
            committedTurnId
        });

        // Build commit artifact for debugging/replay
        const commitArtifact = Object.freeze({
            committed_turn_id: committedTurnId,
            provisional_id: prov.provisional_id,
            input_snapshot_id: prov.input_snapshot_id,
            cast_member_id: prov.cast_member_id,
            session_id: prov.session_id,
            committed_revision: nextThread.revision,
            structured_output: prov.structured_output,
            delta_candidates: Object.freeze(allDeltas),
            validation_result: validationResult,
            projection_event_id: projectionEvent.event_id,
            committed_at: new Date().toISOString()
        });

        this._pendingProvisional = null;

        return {
            result: COMMIT_RESULT.SUCCESS,
            thread: nextThread,
            binding: nextBinding,
            projectionEvent,
            commitArtifact,
            validationResult
        };
    }

    /**
     * Discard the current provisional turn without committing.
     */
    discardProvisional() {
        const discarded = this._pendingProvisional;
        this._pendingProvisional = null;
        return discarded;
    }

    /**
     * Check whether a provisional turn is pending.
     */
    hasPendingProvisional() {
        return this._pendingProvisional !== null;
    }

    getPendingProvisional() {
        return this._pendingProvisional;
    }
}
