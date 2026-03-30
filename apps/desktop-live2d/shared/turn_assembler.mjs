// ---------------------------------------------------------------------------
// Turn Assembler — Phase 1
// Builds the frozen input snapshot for one cast turn.
// ---------------------------------------------------------------------------

import { filterFactsByVisibility } from "./story_fact_contracts.mjs";

// ── Error ──────────────────────────────────────────────────────────────────

export class TurnAssemblerError extends Error {
    constructor(message) {
        super(message);
        this.name = "TurnAssemblerError";
    }
}

// ── Input snapshot ─────────────────────────────────────────────────────────

function buildRandomUuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `snap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Assemble a frozen input snapshot for one cast turn.
 *
 * The snapshot captures every piece of context the model will see.
 * Missing critical artifacts cause a hard failure.
 *
 * @param {object} params
 * @param {object} params.castMember - CastMember
 * @param {object} params.thread - StoryThread
 * @param {object} params.sceneCard - SceneCard
 * @param {object[]} params.recentProjectionEvents - last N shared events
 * @param {object[]} params.facts - FactRecord[] (unfiltered)
 * @param {object|null} params.castSubsets - fact_id → cast_member_ids map
 * @param {string|null} params.userIntervention - latest user text if any
 * @param {object|null} params.directorPlan - current DirectorPlan
 * @param {object|null} params.narratorState - narrator state snapshot
 * @returns {object} frozen input snapshot
 */
export function assembleInputSnapshot({
    castMember,
    thread,
    sceneCard,
    recentProjectionEvents = [],
    facts = [],
    castSubsets = null,
    userIntervention = null,
    directorPlan = null,
    narratorState = null,
    continuationAnchor = null
}) {
    // Hard-fail on missing critical artifacts
    if (!castMember) {
        throw new TurnAssemblerError("assembleInputSnapshot: castMember is required");
    }
    if (!thread) {
        throw new TurnAssemblerError("assembleInputSnapshot: thread is required");
    }
    if (!sceneCard) {
        throw new TurnAssemblerError("assembleInputSnapshot: sceneCard is required");
    }

    // Filter facts by visibility for this specific cast member
    const visibleFacts = filterFactsByVisibility(
        facts,
        castMember.cast_member_id,
        castSubsets
    );

    const snapshotId = buildRandomUuid();

    // Section 1: Session persona base
    const personaSection = Object.freeze({
        cast_member_id: castMember.cast_member_id,
        display_name: castMember.display_name,
        persona_profile_ref: castMember.persona_profile_ref,
        role_type: castMember.role_type
    });

    // Section 2: Story thread context
    const threadSection = Object.freeze({
        thread_id: thread.thread_id,
        title: thread.title,
        mode: thread.mode,
        revision: thread.revision,
        last_user_turn_id: thread.last_user_turn_id
    });

    // Section 3: Scene card
    const sceneSection = Object.freeze({
        scene_id: sceneCard.scene_id,
        scene_goal: sceneCard.scene_goal,
        tone_tags: sceneCard.tone_tags,
        discourse_constraints: sceneCard.discourse_constraints,
        user_constraints: sceneCard.user_constraints,
        featured_cast_ids: sceneCard.featured_cast_ids
    });

    // Section 4: World facts (visible to this cast)
    const worldFactSection = Object.freeze(
        visibleFacts
            .filter((f) => f.fact_type === "world")
            .map((f) => ({
                fact_id: f.fact_id,
                content: f.content,
                provenance: f.provenance
            }))
    );

    // Section 5: Relationship facts (visible to this cast)
    const relationshipFactSection = Object.freeze(
        visibleFacts
            .filter((f) => f.fact_type === "relationship")
            .map((f) => ({
                fact_id: f.fact_id,
                content: f.content,
                provenance: f.provenance
            }))
    );

    // Section 6: Recent conversation for context
    const recentEventsSection = Object.freeze(
        recentProjectionEvents.slice(-20).map((e) => ({
            event_id: e.event_id,
            event_kind: e.event_kind,
            cast_member_id: e.cast_member_id,
            text: e.text,
            story_revision: e.story_revision
        }))
    );

    // Section 7: Turn contract
    const turnContractSection = Object.freeze({
        expected_output: "structured_envelope",
        user_intervention: userIntervention || null,
        director_hint:
            directorPlan && directorPlan.turn_queue && directorPlan.turn_queue[0]
                ? directorPlan.turn_queue[0].reason
                : null
    });

    const narratorSection = narratorState
        ? Object.freeze({
            scene_label: narratorState.scene_label,
            current_time_label: narratorState.current_time_label,
            narrative_focus: narratorState.narrative_focus,
            chapter_summary: narratorState.chapter_summary,
            relationship_summary_lines: narratorState.relationship_summary_lines,
            pending_events: narratorState.pending_events,
            last_director_note: narratorState.last_director_note,
            stagnation_score: narratorState.stagnation_score,
            closure_pressure_score: narratorState.closure_pressure_score
        })
        : null;

    // Assembly report
    const assemblyReport = Object.freeze({
        snapshot_id: snapshotId,
        cast_member_id: castMember.cast_member_id,
        thread_revision: thread.revision,
        visible_fact_count: visibleFacts.length,
        recent_event_count: recentEventsSection.length,
        has_user_intervention: userIntervention !== null,
        assembled_at: new Date().toISOString()
    });

    return Object.freeze({
        snapshot_id: snapshotId,
        persona: personaSection,
        thread_context: threadSection,
        scene: sceneSection,
        world_facts: worldFactSection,
        relationship_facts: relationshipFactSection,
        recent_events: recentEventsSection,
        narrator_context: narratorSection,
        turn_contract: turnContractSection,
        continuation_anchor: continuationAnchor ? Object.freeze({
            cast_member_id: continuationAnchor.cast_member_id,
            anchor_text: continuationAnchor.anchor_text,
            anchor_revision: continuationAnchor.anchor_revision,
        }) : null,
        assembly_report: assemblyReport
    });
}
