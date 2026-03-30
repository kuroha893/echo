import assert from "node:assert/strict";

import {
    buildCastMember,
    CAST_ROLE_TYPE,
    STORY_THREAD_MODE
} from "../shared/story_thread_contracts.mjs";
import {
    buildStructuredTurnOutput,
    buildDeltaCandidate,
    DELTA_OPERATION_KIND
} from "../shared/story_fact_contracts.mjs";
import { MultiCompanionStoryService } from "../shared/multi_companion_story_service.mjs";

function run() {
    const service = new MultiCompanionStoryService();

    // ── Create cast ────────────────────────────────────────────────────────
    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    // ── Create thread ──────────────────────────────────────────────────────
    const thread = service.createThread({
        title: "Demo Story",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Alice and Bob react to the user's arrival.",
            toneTagsList: ["gentle"],
            discourseConstraints: ["Keep it concise."]
        }
    });

    assert.equal(thread.title, "Demo Story");
    assert.equal(thread.mode, STORY_THREAD_MODE.FREE_PLAY);
    assert.equal(thread.revision, 0);
    assert.equal(thread.cast_member_ids.length, 2);

    // ── Bind sessions ───────────────────────────────────────────────────────
    const aliceBinding = service.bindCastSession(
        alice.cast_member_id,
        "session-alice-00000000-0000-4000-8000-000000000001"
    );
    const bobBinding = service.bindCastSession(
        bob.cast_member_id,
        "session-bob-00000000-0000-4000-8000-000000000002"
    );

    assert.equal(aliceBinding.cast_member_id, alice.cast_member_id);
    assert.equal(bobBinding.cast_member_id, bob.cast_member_id);

    // ── User turn ──────────────────────────────────────────────────────────
    const userTurn = service.submitUserTurn(
        "Hello Alice, what do you think?",
        alice.cast_member_id
    );

    assert.equal(userTurn.projectionEvent.event_kind, "user_input");
    assert.equal(service.getThread().revision, 1);
    assert.ok(userTurn.nextSpeaker !== null);
    assert.ok(userTurn.nextSpeaker.plan !== null);
    const selectedCastId =
        userTurn.nextSpeaker.plan.turn_queue[0].cast_member_id;
    assert.equal(selectedCastId, alice.cast_member_id);

    // ── Assemble turn ───────────────────────────────────────────────────────
    const inputSnapshot = service.assembleForCast(alice.cast_member_id);
    assert.equal(inputSnapshot.thread_context.revision, 1);
    assert.equal(inputSnapshot.persona.cast_member_id, alice.cast_member_id);
    assert.equal(inputSnapshot.scene.scene_goal.includes("react"), true);

    // ── Provisional turn ────────────────────────────────────────────────────
    const structuredOutput = buildStructuredTurnOutput({
        spokenText: "I think the user seems friendly.",
        intentTag: "greeting",
        emotionTag: "warm",
        relationshipDeltaCandidates: [
            buildDeltaCandidate({
                operationKind: DELTA_OPERATION_KIND.ADJUST_DIMENSION,
                targetArtifactType: "relationship",
                payload: {
                    edge: [alice.cast_member_id, bob.cast_member_id],
                    dimension: "comfort",
                    delta: 0.1
                }
            })
        ],
        worldDeltaCandidates: []
    });

    const provisional = service.registerProvisionalTurn(
        alice.cast_member_id,
        inputSnapshot.snapshot_id,
        structuredOutput
    );

    assert.equal(provisional.expected_revision, 1);
    assert.equal(provisional.cast_member_id, alice.cast_member_id);

    // ── Commit ──────────────────────────────────────────────────────────────
    const commitResult = service.tryCommitTurn(alice.cast_member_id);
    assert.equal(commitResult.result, "success");
    assert.ok(commitResult.projectionEvent !== null);
    assert.equal(commitResult.projectionEvent.event_kind, "cast_spoken");
    assert.equal(commitResult.projectionEvent.story_revision, 2);
    assert.equal(service.getThread().revision, 2);

    // Projection timeline should have user input + cast turn
    const timeline = service.getTimeline();
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].event_kind, "user_input");
    assert.equal(timeline[1].event_kind, "cast_spoken");

    // Stage state should be updated
    const stageState = service.getStageState();
    assert.equal(stageState.revision, 2);
    assert.equal(stageState.camera_focus, alice.cast_member_id);
    const alicePresentation = service.getCastPresentationState(
        alice.cast_member_id
    );
    assert.equal(alicePresentation.expression, "warm");
    assert.equal(alicePresentation.revision, 2);

    // Commit log should contain the turn artifact
    const commitLog = service.getCommitLog();
    assert.equal(commitLog.length, 1);
    assert.equal(commitLog[0].committed_revision, 2);
    assert.equal(commitLog[0].structured_output.emotion_tag, "warm");

    // ── Recovery ────────────────────────────────────────────────────────────
    const saved = service.toJSON();
    const recovered = new MultiCompanionStoryService();
    recovered.restoreFromJSON(saved);

    assert.equal(recovered.getThread().revision, 2);
    assert.equal(recovered.getTimeline().length, 2);
    assert.equal(recovered.getCommitLog().length, 1);
    assert.equal(
        recovered.getCastPresentationState(alice.cast_member_id).expression,
        "warm"
    );

    // ── Stale-turn invalidation ─────────────────────────────────────────────
    // Build a fresh service to isolate the scenario.
    const staleService = new MultiCompanionStoryService();
    staleService.createThread({
        title: "Stale Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: { sceneGoal: "Test stale commit" }
    });
    staleService.bindCastSession(
        alice.cast_member_id,
        "session-alice-00000000-0000-4000-8000-000000000011"
    );
    staleService.bindCastSession(
        bob.cast_member_id,
        "session-bob-00000000-0000-4000-8000-000000000012"
    );

    staleService.submitUserTurn("Hi", null);
    const staleSnapshot = staleService.assembleForCast(alice.cast_member_id);
    staleService.registerProvisionalTurn(
        alice.cast_member_id,
        staleSnapshot.snapshot_id,
        structuredOutput
    );

    // User interrupts before commit — revision changes.
    staleService.submitUserTurn("Actually, Bob first.", bob.cast_member_id);
    const staleCommit = staleService.tryCommitTurn(alice.cast_member_id);
    assert.equal(staleCommit.result, "stale_revision");

    // ── User intervention should become shared constraint ──────────────────
    const interventionService = new MultiCompanionStoryService();
    const kaguya = buildCastMember({
        displayName: "Open Yachiyo Kaguya",
        personaProfileRef: "persona/kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const nanase = buildCastMember({
        displayName: "七七の量贩私皮",
        personaProfileRef: "persona/nanase",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });
    interventionService.createThread({
        title: "Intervention Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [kaguya, nanase],
        sceneCardInit: { sceneGoal: "Nanase wants Kaguya to hear a new song." }
    });
    interventionService.bindCastSession(
        kaguya.cast_member_id,
        "session-kaguya-00000000-0000-4000-8000-000000000021"
    );
    interventionService.bindCastSession(
        nanase.cast_member_id,
        "session-nanase-00000000-0000-4000-8000-000000000022"
    );
    interventionService.submitUserTurn("开始", null);
    const nanaseSnapshot = interventionService.assembleForCast(nanase.cast_member_id);
    interventionService.registerProvisionalTurn(
        nanase.cast_member_id,
        nanaseSnapshot.snapshot_id,
        buildStructuredTurnOutput({
            spokenText: "我给你写了新歌，来听听吧。",
            intentTag: "offer_song",
            emotionTag: "eager"
        })
    );
    interventionService.tryCommitTurn(nanase.cast_member_id);

    const interventionTurn = interventionService.submitUserTurn("她不想听", null);
    const interventionSnapshot = interventionService.assembleForCast(nanase.cast_member_id, "她不想听");

    assert.equal(
        interventionTurn.nextSpeaker.plan.turn_queue[0].cast_member_id,
        nanase.cast_member_id
    );
    assert.ok(
        interventionService.getSceneCard().scene_goal.includes("拒绝听歌")
    );
    assert.ok(
        interventionSnapshot.scene.user_constraints.some((item) => item.includes("明确拒绝听歌"))
    );
    assert.ok(
        interventionSnapshot.world_facts.some((fact) => fact.content.includes("明确拒绝听歌"))
    );
    assert.ok(
        interventionSnapshot.turn_contract.user_intervention.includes("authoritative world-state update")
    );

    // ── Structured choice metadata path (authorial_directive) ──────────────
    const metaService = new MultiCompanionStoryService();
    const miku = buildCastMember({
        displayName: "Miku",
        personaProfileRef: "persona/miku",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const luka = buildCastMember({
        displayName: "Luka",
        personaProfileRef: "persona/luka",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });
    metaService.createThread({
        title: "Metadata Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [miku, luka],
        sceneCardInit: { sceneGoal: "Miku tells Luka a story." }
    });
    metaService.bindCastSession(miku.cast_member_id, "session-miku-00000000-0000-4000-8000-000000000031");
    metaService.bindCastSession(luka.cast_member_id, "session-luka-00000000-0000-4000-8000-000000000032");
    metaService.submitUserTurn("开始", null);

    const metaTurn = metaService.submitUserTurn("继续", null, {
        choice_id: "choice-00000000-0000-4000-8000-000000000099",
        target_speaker_id: miku.cast_member_id,
        directive_kind: "continue",
        source_revision: metaService.getThread().revision,
        choice_batch_id: "batch-001"
    });
    assert.equal(metaTurn.intervention.kind, "authorial_directive");
    assert.equal(metaTurn.intervention.directive_kind, "continue");
    assert.equal(metaTurn.intervention.speaker_lock, miku.cast_member_id);
    assert.ok(metaTurn.intervention.continuation_anchor === null || typeof metaTurn.intervention.continuation_anchor === "object");
    assert.equal(metaTurn.intervention.scene_goal_lock.active, true);

    // ── Stale choice should return stale_choice intervention ───────────────
    const staleTurn = metaService.submitUserTurn("过期选项", null, {
        choice_id: "choice-00000000-0000-4000-8000-000000000100",
        target_speaker_id: miku.cast_member_id,
        directive_kind: "continue",
        source_revision: 0,
        choice_batch_id: "batch-old"
    });
    assert.equal(staleTurn.intervention.kind, "stale_choice");

    // ── Generic free-text intervention ─────────────────────────────────────
    const genericTurn = metaService.submitUserTurn("场面有点冷", null);
    assert.equal(genericTurn.intervention.kind, "generic_user_input");
    assert.equal(genericTurn.intervention.speaker_lock, null);
    assert.ok(genericTurn.intervention.director_hint.includes("场面有点冷"));

    // ── Continuation anchor in snapshot ────────────────────────────────────
    const metaSnapshot = metaService.assembleForCast(miku.cast_member_id);
    assert.ok("continuation_anchor" in metaSnapshot);

    // ── Legacy narrator choice rationale should be truncated on restore ────
    const restoredFromLegacy = new MultiCompanionStoryService();
    restoredFromLegacy.restoreFromJSON({
        ...interventionService.toJSON(),
        narrator_state: {
            ...interventionService.toJSON().narrator_state,
            suggested_choices: [
                {
                    choice_id: "legacy-choice-00000000-0000-4000-8000-000000000001",
                    label: "继续问下去",
                    prompt_text: "继续问下去",
                    rationale: "理".repeat(900)
                }
            ]
        }
    });
    assert.ok(
        restoredFromLegacy.getNarratorState().suggested_choices[0].rationale.length <= 500
    );

    console.log("story_mode_self_check: ok");
}

run();
