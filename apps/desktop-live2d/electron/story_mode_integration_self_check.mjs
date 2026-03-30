// ---------------------------------------------------------------------------
// Story Mode Integration Self-Check — Phase 1
// Validates the orchestrator, persistence, IPC channel constants, and the
// full pipeline from service → orchestrator → mock host → commit.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
    buildCastMember,
    CAST_ROLE_TYPE,
    STORY_THREAD_MODE
} from "../shared/story_thread_contracts.mjs";
import {
    buildStructuredTurnOutput,
    DELTA_OPERATION_KIND
} from "../shared/story_fact_contracts.mjs";
import { MultiCompanionStoryService } from "../shared/multi_companion_story_service.mjs";
import { StoryModeOrchestrator } from "./story_mode_orchestrator.mjs";
import { sanitizeStoryNarratorVisibleText } from "../shared/story_visible_text.mjs";
import { persistStoryState, loadStoryState, listStoryStateSlots, archiveStoryStateSlot } from "./story_mode_persistence.mjs";
import { STORY_MODE_IPC_CHANNEL } from "./story_mode_ipc.mjs";
import { buildNarratorDecision, NARRATOR_ACTION_KIND } from "../shared/story_narrator_contracts.mjs";
import { DIRECTOR_USER_WAIT_POLICY } from "../shared/story_thread_contracts.mjs";

// ── Mock Companion Host ────────────────────────────────────────────────────
// Simulates DesktopCompanionPythonHost for self-check (no Python subprocess).

class MockCompanionHost {
    constructor() {
        this._sessions = new Map();
        this._activeSessionId = null;
        this._nextSessionSeq = 1;
        this.callLog = [];
        this._narratorTargetIds = [];
        this._narratorCallCount = 0;
        this._maxNarratorCastTurns = 3;
        this._narratorForceFailCount = 0;
        this._narratorFailCallCount = 0;
        this._choicesForceEmpty = false;
    }

    setNarratorTargets(ids) {
        this._narratorTargetIds = ids;
    }

    setMaxNarratorCastTurns(n) {
        this._maxNarratorCastTurns = n;
    }

    resetNarratorCallCount() {
        this._narratorCallCount = 0;
    }

    setNarratorForceFailCount(n) {
        this._narratorForceFailCount = n;
        this._narratorFailCallCount = 0;
    }

    setChoicesForceEmpty(flag) {
        this._choicesForceEmpty = flag;
    }

    async deleteSession(sessionId) {
        this._sessions.delete(sessionId);
        if (this._activeSessionId === sessionId) {
            this._activeSessionId = null;
        }
        this.callLog.push({ operation: "deleteSession", sessionId });
        return { deleted: sessionId };
    }

    async createSession({ title = "", makeActive = true, modelKey = null, voiceProfileKey = null } = {}) {
        const sessionKind = arguments[0]?.sessionKind || "direct";
        const sessionId = `mock-session-${this._nextSessionSeq++}`;
        this._sessions.set(sessionId, {
            session_id: sessionId,
            title,
            model_key: modelKey,
            session_kind: sessionKind,
            voice_profile_key: voiceProfileKey
        });
        if (makeActive) {
            this._activeSessionId = sessionId;
        }
        this.callLog.push({ operation: "createSession", sessionId, title, modelKey, makeActive, sessionKind, voiceProfileKey });
        return { session_id: sessionId };
    }

    async getActiveSession() {
        if (!this._activeSessionId) {
            return { active_session_id: null };
        }
        const session = this._sessions.get(this._activeSessionId);
        return {
            session_id: this._activeSessionId,
            model_key: session?.model_key || null,
            session_kind: session?.session_kind || "direct"
        };
    }

    async switchSession(sessionId, { modelKey = null } = {}) {
        if (!this._sessions.has(sessionId)) {
            throw new Error(`session not found: ${sessionId}`);
        }
        this._activeSessionId = sessionId;
        this.callLog.push({ operation: "switchSession", sessionId, modelKey });
        return { session_id: sessionId };
    }

    async submitDesktopInput(text, { visibleInTranscript = true, modelKey = null } = {}) {
        this.callLog.push({
            operation: "submitDesktopInput",
            text: text.substring(0, 100),
            sessionId: this._activeSessionId,
            visibleInTranscript,
            modelKey
        });

        const currentSession = this._sessions.get(this._activeSessionId);
        const isNarrator = typeof currentSession?.title === "string"
            && currentSession.title.startsWith("story-narrator");
        let responseText;

        if (isNarrator) {
            if (text.includes("选项生成器")) {
                if (this._choicesForceEmpty) {
                    responseText = "嗯，让我想想……";
                } else if (text.includes("电影")) {
                    responseText = JSON.stringify({
                        choices: [
                            { directive: "continue", label: "让彩叶继续聊刚才那部电影" },
                            { directive: "respond", label: "让另一位角色吐槽那部电影" },
                            { directive: "scene_shift", label: "把场景切到电影院外继续聊" }
                        ]
                    });
                } else if (text.includes("苹果糖")) {
                    responseText = JSON.stringify({
                        choices: [
                            { directive: "continue", label: "让彩叶继续把苹果糖的话题说下去" },
                            { directive: "respond", label: "让另一位角色接着聊苹果糖" },
                            { directive: "scene_shift", label: "把场景转到卖苹果糖的摊位旁" }
                        ]
                    });
                } else {
                    responseText = "<choices>\n继续聊下去\n换个话题\n先走了\n</choices>";
                }
            } else {
                // Check if we should simulate a malformed (character-speech) response
                if (this._narratorForceFailCount > 0 && this._narratorFailCallCount < this._narratorForceFailCount) {
                    this._narratorFailCallCount += 1;
                    responseText = "欢迎回来呀，是不是累坏啦？快过来这边坐下好好休息吧~";
                } else {
                    this._narratorCallCount += 1;
                    const targets = this._narratorTargetIds.join(", ");
                    const shouldYield = this._narratorCallCount > this._maxNarratorCastTurns;
                    responseText = shouldYield
                        ? "TARGETS: []\n\n**时间**：测试\n**地点**：测试\n\n等待玩家。\n\n<update_notes>\n  <status>{\"scene_label\": \"测试\", \"current_time_label\": \"测试\", \"scene_goal\": \"等待\", \"narrative_focus\": \"等待\", \"chapter_summary\": \"等待\"}</status>\n</update_notes>"
                        : `TARGETS: [${targets}]\n\n**时间**：测试时间\n**地点**：测试场景\n\n测试环境描写。\n\n<update_notes>\n  <status>{"scene_label": "测试场景", "current_time_label": "测试时间", "scene_goal": "继续推进", "narrative_focus": "测试焦点", "chapter_summary": "测试概要"}</status>\n</update_notes>`;
                }
            }
        } else {
            responseText = `Mock response to: ${text.substring(0, 40)}`;
        }

        return {
            submitted_text: text,
            run_results: [
                {
                    final_companion_session_snapshot: {
                        transcript_entries: [
                            { role: "assistant", text: responseText }
                        ]
                    }
                }
            ],
            final_desktop_snapshot: {
                companion_session_snapshot: {
                    transcript_entries: [
                        { role: "assistant", text: "stale desktop snapshot reply" }
                    ]
                }
            }
        };
    }
}

class DelayedMockCompanionHost extends MockCompanionHost {
    async submitDesktopInput(text, options = {}) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return await super.submitDesktopInput(text, options);
    }
}

// ── Orchestrator + Mock Host pipeline ──────────────────────────────────────

async function testOrchestratorPipeline() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();
    const debugLog = [];
    const committedCastEvents = [];

    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost,
        onCastCommitted: async (payload) => {
            committedCastEvents.push(payload);
        },
        onDebug: (category, message, detail) => {
            debugLog.push({ category, message, detail });
        }
    });

    // Create cast
    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        voiceProfileRef: "voice.alice",
        subtitleColor: "#ff7b84",
        timelineColor: "#45212b",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        voiceProfileRef: "voice.bob",
        subtitleColor: "#67c7ff",
        timelineColor: "#1b3446",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    // Create thread
    service.createThread({
        title: "Orchestrator Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Alice and Bob chat about the weather.",
            toneTagsList: ["casual"],
            discourseConstraints: []
        }
    });

    // Bind cast via orchestrator (creates mock host sessions)
    await orchestrator.bindAllCastSessions([alice, bob]);

    assert.equal(mockHost.callLog.length, 5);
    assert.equal(mockHost.callLog[0].operation, "createSession");
    assert.equal(mockHost.callLog[1].operation, "createSession");
    assert.equal(mockHost.callLog[2].operation, "createSession");
    assert.equal(mockHost.callLog[3].operation, "createSession");
    assert.equal(mockHost.callLog[4].operation, "createSession");
    assert.equal(mockHost.callLog[0].modelKey, "open-yachiyo-kaguya");
    assert.equal(mockHost.callLog[1].modelKey, "七七の量贩私皮");
    assert.equal(mockHost.callLog[2].modelKey, "open-yachiyo-kaguya");
    assert.equal(mockHost.callLog[3].modelKey, "open-yachiyo-kaguya");
    assert.equal(mockHost.callLog[4].modelKey, null);
    assert.equal(mockHost.callLog[0].sessionKind, "story_cast");
    assert.equal(mockHost.callLog[1].sessionKind, "story_cast");
    assert.equal(mockHost.callLog[2].sessionKind, "story_narrator");
    assert.equal(mockHost.callLog[3].sessionKind, "story_narrator");
    assert.equal(mockHost.callLog[4].sessionKind, "direct");
    assert.equal(mockHost.callLog[0].voiceProfileKey, "voice.alice");
    assert.equal(mockHost.callLog[1].voiceProfileKey, "voice.bob");
    assert.equal(mockHost.callLog[2].voiceProfileKey, null);
    assert.equal(mockHost.callLog[3].voiceProfileKey, null);
    assert.equal(mockHost.callLog[4].voiceProfileKey, null);
    assert.equal(mockHost.callLog[0].makeActive, false);
    assert.equal(mockHost.callLog[1].makeActive, false);
    assert.equal(mockHost.callLog[2].makeActive, false);
    assert.equal(mockHost.callLog[3].makeActive, false);
    assert.equal(mockHost.callLog[4].makeActive, true);

    // Verify bindings exist
    const bindings = service.getBindings();
    assert.equal(bindings.length, 2);

    // Configure narrator mock to return targets
    mockHost.setNarratorTargets([alice.cast_member_id, bob.cast_member_id]);

    // Run a full story turn
    const result = await orchestrator.runStoryTurn(
        "How's the weather?",
        alice.cast_member_id
    );

    assert.ok(result.userEvent !== null);
    assert.equal(result.userEvent.event_kind, "user_input");
    assert.ok(Array.isArray(result.narratorDecisions));
    assert.ok(result.narratorDecisions.length >= 1);
    // Single-narrator pattern: with 2 cast members, exactly 2 cast results per turn
    assert.ok(result.castResults.length >= 2);
    assert.ok(result.castResults.every((entry) => entry.result === "success"));

    // Verify mock host was called: switchSession + submitDesktopInput
    const switchCalls = mockHost.callLog.filter(
        (c) => c.operation === "switchSession"
    );
    assert.ok(switchCalls.length >= 1);
    const submitCalls = mockHost.callLog.filter(
        (c) => c.operation === "submitDesktopInput"
    );
    // Submit calls include narrator, cast, and choices calls
    const castSubmitCalls = submitCalls.filter((c) => {
        const session = mockHost._sessions.get(c.sessionId);
        return session?.session_kind === "story_cast";
    });
    assert.equal(castSubmitCalls.length, result.castResults.length);
    assert.ok(submitCalls.every((c) => typeof c.modelKey === "string" && c.modelKey.length > 0));
    assert.ok(submitCalls.every((c) => c.visibleInTranscript === false));

    // Verify service state advanced
    assert.ok(service.getThread().revision >= 2);
    assert.ok(service.getTimeline().length >= 2);
    assert.equal(committedCastEvents.length, result.castResults.length);
    assert.ok(committedCastEvents.every((payload) => payload?.projectionEvent?.event_kind === "cast_spoken"));

    // Verify debug log captured events
    const orchestratorDebug = debugLog.filter(
        (d) => d.category === "story_orchestrator"
    );
    assert.ok(orchestratorDebug.length >= 2);

    // isRunning should be false after completion
    assert.equal(orchestrator.isRunning(), false);

    console.log("  orchestrator_pipeline: ok");
}

async function testBackgroundStartStatus() {
    const service = new MultiCompanionStoryService();
    const mockHost = new DelayedMockCompanionHost();

    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Background Run Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Alice and Bob keep chatting.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    await orchestrator.bindAllCastSessions([alice, bob]);
    const startResult = await orchestrator.startStoryTurn("Keep going.", null);
    assert.equal(startResult.started, true);
    assert.equal(orchestrator.getStatus().running, true);
    await orchestrator.stopAndWait("self_check_stop");
    assert.equal(orchestrator.getStatus().running, false);

    console.log("  background_start_status: ok");
}

async function testNarratorParsingAndEventCallback() {
    const service = new MultiCompanionStoryService();
    const narratorEvents = [];
    const mockHost = new MockCompanionHost();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost,
        onNarratorEvents: async (payload) => {
            narratorEvents.push(payload);
        }
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Narrator Parsing Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test narrator parsing.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    // Test _parseNarratorTargets
    const validCastIds = new Set([alice.cast_member_id, bob.cast_member_id]);
    const targets = orchestrator._parseNarratorTargets(
        `TARGETS: [${alice.cast_member_id}, ${bob.cast_member_id}]\n\n**时间**：测试`,
        validCastIds
    );
    assert.deepEqual(targets, [alice.cast_member_id, bob.cast_member_id]);

    const filteredTargets = orchestrator._parseNarratorTargets(
        `TARGETS: [${alice.cast_member_id}, invalid-id]`,
        validCastIds
    );
    assert.deepEqual(filteredTargets, [alice.cast_member_id]);

    // Test _parseNarratorUpdateNotes
    const updateNotes = orchestrator._parseNarratorUpdateNotes(
        `<update_notes>\n  <status>{"scene_label": "公园", "current_time_label": "下午3点", "scene_goal": "散步", "narrative_focus": "测试", "chapter_summary": "测试"}</status>\n  <add_event>【突发事件】下雨了</add_event>\n</update_notes>`
    );
    assert.equal(updateNotes.status.scene_label, "公园");
    assert.equal(updateNotes.status.current_time_label, "下午3点");
    assert.equal(updateNotes.addEvents.length, 1);
    assert.ok(updateNotes.addEvents[0].includes("下雨了"));

    // Test _parseNarratorSceneText strips metadata headers
    const sceneTextInput = [
        `TARGETS: [${alice.cast_member_id}]`,
        "",
        "**时间**：夜晚21点30分",
        "**地点**：月读空间中心休息区",
        "**在场**：",
        "- 玩家：在沙发上",
        "- 月读：站在吧台后面",
        "",
        "月色透过落地窗洒在休息区的地板上，空气中弥漫着淡淡的咖啡香。",
        "",
        "<update_notes>",
        '  <status>{"scene_label": "月读空间中心休息区"}</status>',
        "</update_notes>"
    ].join("\n");
    const sceneText = orchestrator._parseNarratorSceneText(sceneTextInput);
    // Should only contain the narrative prose, not metadata
    assert.ok(!sceneText.includes("TARGETS"));
    assert.ok(!sceneText.includes("**时间**"));
    assert.ok(!sceneText.includes("**地点**"));
    assert.ok(!sceneText.includes("**在场**"));
    assert.ok(!sceneText.includes("- 玩家"));
    assert.ok(!sceneText.includes("- 月读"));
    assert.ok(sceneText.includes("月色透过落地窗"));

    const subtitleText = sanitizeStoryNarratorVisibleText([
        `TARGETS: [${alice.cast_member_id}]`,
        "",
        "**时间**：现世2024年秋 晚20:00",
        "**地点**：元宇宙空间「月读」中央广场入口的樱树下",
        "",
        "风吹动了树梢，细碎的灯光在地面上晃动。",
        "",
        '<update_notes>',
        '  <status>{"scene_label": "樱树下"}</status>',
        '</update_notes>'
    ].join("\n"));
    assert.equal(subtitleText, "风吹动了树梢，细碎的灯光在地面上晃动。");

    // Test _inferActionKind: INJECT_EVENT when add_event present
    const injectKind = orchestrator._inferActionKind(
        { status: { scene_label: "公园", current_time_label: "下午3点" }, triggered: [], addEvents: ["新事件"] },
        { scene_label: "公园", current_time_label: "下午3点" },
        [alice.cast_member_id]
    );
    assert.equal(injectKind, NARRATOR_ACTION_KIND.INJECT_EVENT);

    // Test _inferActionKind: SCENE_TRANSITION when scene changes
    const transitionKind = orchestrator._inferActionKind(
        { status: { scene_label: "教室" }, triggered: [], addEvents: [] },
        { scene_label: "公园", current_time_label: "下午3点" },
        [alice.cast_member_id]
    );
    assert.equal(transitionKind, NARRATOR_ACTION_KIND.SCENE_TRANSITION);

    // Test _inferActionKind: YIELD_TO_USER when no targets
    const yieldKind = orchestrator._inferActionKind(
        { status: null, triggered: [], addEvents: [] },
        {},
        []
    );
    assert.equal(yieldKind, NARRATOR_ACTION_KIND.YIELD_TO_USER);

    // Test _parseChoicesResponse (JSON format)
    const choicesJson = JSON.stringify({
        choices: [
            { target_speaker_id: alice.cast_member_id, directive: "continue", label: "（想了想）你说的有道理" },
            { target_speaker_id: bob.cast_member_id, directive: "respond", label: "等一下，没那么简单吧？" },
            { directive: "scene_shift", label: "算了，不聊了" }
        ]
    });
    const choices = orchestrator._parseChoicesResponse(
        "前缀\n```json\n" + choicesJson + "\n```"
    );
    assert.equal(choices.length, 3);
    assert.ok(choices[0].label.includes("你说的有道理"));

    const tagChoices = orchestrator._parseChoicesResponse(
        "<choices>\n继续聊苹果糖\n让另一位角色回应\n切到新场景\n</choices>"
    );
    assert.equal(tagChoices.length, 3);
    assert.equal(tagChoices[0].label, "继续聊苹果糖");

    // Test event callback fires via full orchestrator run
    await orchestrator.bindAllCastSessions([alice, bob]);
    mockHost.setNarratorTargets([alice.cast_member_id, bob.cast_member_id]);
    const result = await orchestrator.runStoryTurn("测试输入", alice.cast_member_id);
    assert.ok(narratorEvents.length >= 1);
    assert.ok(Array.isArray(narratorEvents[0].emittedEvents));
    // With single-narrator pattern the LLM-driven narrator event is the first
    // one; the last may be the forced yield (no director_note).
    const latestNarratorProjection = narratorEvents
        .flatMap((ne) => ne.emittedEvents || [])
        .find(
            (event) => event?.event_kind === "director_note" || event?.event_kind === "scene_transition"
        );
    assert.ok(latestNarratorProjection?.text);
    assert.ok(!latestNarratorProjection.text.includes("TARGETS"));
    assert.ok(!latestNarratorProjection.text.includes("**时间**"));

    console.log("  narrator_parsing_and_event_callback: ok");
}

function testCastReplyExtractionTakesLastNewAssistantEntry() {
    const orchestrator = new StoryModeOrchestrator({
        storyService: new MultiCompanionStoryService(),
        companionHost: new MockCompanionHost()
    });
    const hostResult = {
        drain_result: {
            companion_session_snapshot: {
                transcript_entries: [
                    {
                        entry_id: "old-assistant",
                        role: "assistant",
                        text: "旧对白"
                    }
                ]
            }
        },
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [
                    {
                        entry_id: "old-assistant",
                        role: "assistant",
                        text: "旧对白"
                    },
                    {
                        entry_id: "assistant-a",
                        role: "assistant",
                        text: "第一句"
                    },
                    {
                        entry_id: "assistant-b",
                        role: "assistant",
                        text: "第二句"
                    }
                ]
            }
        }]
    };

    // mode "new" takes only the LAST new assistant entry (avoids phantom first line)
    const lastNew = orchestrator._extractAssistantReplyText(hostResult, { mode: "new" });
    assert.equal(lastNew, "第二句");

    const latest = orchestrator._extractAssistantReplyText(hostResult, { mode: "latest" });
    assert.equal(latest, "第二句");

    console.log("  cast_reply_extraction_takes_last_new_assistant_entry: ok");
}

async function testNarratorResponseInference() {
    const service = new MultiCompanionStoryService();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: new MockCompanionHost()
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Narrator Response Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test narrator response inference.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    const narratorState = {
        scene_label: "音乐教室",
        current_time_label: "深夜",
        scene_goal: "听歌",
        narrative_focus: "测试",
        chapter_summary: "测试",
        relationship_summary_lines: [],
        pending_events: ["明天的活动"],
        beat_counter: 5
    };

    // Test SCENE_TRANSITION: scene label changes
    const transitionResponse = {
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [{
                    role: "assistant",
                    text: `TARGETS: [${alice.cast_member_id}]\n\n**时间**：次日清晨\n**地点**：校门前\n\n晨光打在校门上。\n\n<update_notes>\n  <status>{"scene_label": "校门前", "current_time_label": "次日清晨", "scene_goal": "新一天", "narrative_focus": "接住昨晚的情绪", "chapter_summary": "过了一夜"}</status>\n  <triggered>明天的活动</triggered>\n</update_notes>`
                }]
            }
        }],
        final_desktop_snapshot: { companion_session_snapshot: { transcript_entries: [] } }
    };
    const transitionDecision = orchestrator._extractNarratorDecision(transitionResponse, narratorState);
    assert.equal(transitionDecision.action_kind, NARRATOR_ACTION_KIND.SCENE_TRANSITION);
    assert.equal(transitionDecision.scene_label, "校门前");
    assert.ok(transitionDecision.current_time_label.includes("清晨"));
    assert.ok(transitionDecision.transition_text);
    // Triggered event removed from pending
    assert.ok(!transitionDecision.pending_events.includes("明天的活动"));

    // Test CAST_TURN: same scene, no new events
    const castResponse = {
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [{
                    role: "assistant",
                    text: `TARGETS: [${alice.cast_member_id}, ${bob.cast_member_id}]\n\n**时间**：深夜\n**地点**：音乐教室\n\n安静的空气。\n\n<update_notes>\n  <status>{"scene_label": "音乐教室", "current_time_label": "深夜", "scene_goal": "听歌", "narrative_focus": "测试", "chapter_summary": "测试"}</status>\n</update_notes>`
                }]
            }
        }],
        final_desktop_snapshot: { companion_session_snapshot: { transcript_entries: [] } }
    };
    const castDecision = orchestrator._extractNarratorDecision(castResponse, narratorState);
    assert.equal(castDecision.action_kind, NARRATOR_ACTION_KIND.CAST_TURN);
    assert.deepEqual([...castDecision.target_cast_ids], [alice.cast_member_id, bob.cast_member_id]);

    // Test INJECT_EVENT: add_event present
    const injectResponse = {
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [{
                    role: "assistant",
                    text: `TARGETS: [${alice.cast_member_id}]\n\n**时间**：深夜\n**地点**：音乐教室\n\n手机突然响了。\n\n<update_notes>\n  <status>{"scene_label": "音乐教室", "current_time_label": "深夜", "scene_goal": "接电话", "narrative_focus": "来电", "chapter_summary": "测试"}</status>\n  <add_event>【来电】有人打来电话</add_event>\n</update_notes>`
                }]
            }
        }],
        final_desktop_snapshot: { companion_session_snapshot: { transcript_entries: [] } }
    };
    const injectDecision = orchestrator._extractNarratorDecision(injectResponse, narratorState);
    assert.equal(injectDecision.action_kind, NARRATOR_ACTION_KIND.INJECT_EVENT);
    assert.ok(injectDecision.pending_events.some((e) => e.includes("打来电话")));

    // Test YIELD_TO_USER: empty targets
    const yieldResponse = {
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [{
                    role: "assistant",
                    text: "TARGETS: []\n\n**时间**：深夜\n**地点**：音乐教室\n\n安静了。\n\n<update_notes>\n  <status>{\"scene_label\": \"音乐教室\", \"current_time_label\": \"深夜\", \"scene_goal\": \"等待\", \"narrative_focus\": \"等待\", \"chapter_summary\": \"等待\"}</status>\n</update_notes>"
                }]
            }
        }],
        final_desktop_snapshot: { companion_session_snapshot: { transcript_entries: [] } }
    };
    const yieldDecision = orchestrator._extractNarratorDecision(yieldResponse, narratorState);
    assert.equal(yieldDecision.action_kind, NARRATOR_ACTION_KIND.YIELD_TO_USER);

    console.log("  narrator_response_inference: ok");
}

async function testChainLimitForcesYield() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Chain Limit Yield Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Keep going until forced yield.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    await orchestrator.bindAllCastSessions([alice, bob]);
    mockHost.setNarratorTargets([alice.cast_member_id, bob.cast_member_id]);
    // Narrator never voluntarily yields — chain limit forces it
    mockHost.setMaxNarratorCastTurns(100);

    const result = await orchestrator.runStoryTurn("Keep chaining until forced yield.", null);
    const lastDecision = result.narratorDecisions[result.narratorDecisions.length - 1] || null;
    assert.ok(lastDecision);
    assert.equal(lastDecision.user_wait_policy, DIRECTOR_USER_WAIT_POLICY.YIELD_TO_USER);
    assert.equal(lastDecision.action_kind, NARRATOR_ACTION_KIND.YIELD_TO_USER);
    assert.ok(Array.isArray(lastDecision.suggested_choices));
    assert.ok(lastDecision.suggested_choices.length > 0);

    console.log("  chain_limit_forces_yield: ok");
}

function testPromptBudgetAndAssistantExtraction() {
    const service = new MultiCompanionStoryService();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: new MockCompanionHost()
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Prompt Budget Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "A very long conversation test.",
            toneTagsList: ["verbose"],
            discourseConstraints: ["Keep going."]
        }
    });
    service.bindCastSession(alice.cast_member_id, "session-alice-00000000-0000-4000-8000-000000000021");
    service.bindCastSession(bob.cast_member_id, "session-bob-00000000-0000-4000-8000-000000000022");

    for (let index = 0; index < 12; index += 1) {
        service.submitUserTurn(`user turn ${index} ${"x".repeat(220)}`, null);
        const snapshot = service.assembleForCast(alice.cast_member_id);
        const promptText = orchestrator._buildCastPrompt(snapshot);
        assert.ok(promptText.length <= 4000);
    }

    const extracted = orchestrator._extractStructuredOutput(
        {
            submitted_text: "[Role] prompt that must not be reused",
            run_results: [
                {
                    final_companion_session_snapshot: {
                        transcript_entries: [
                            { role: "assistant", text: "[smile]<voice>Actual assistant reply.</voice>" }
                        ]
                    }
                }
            ],
            final_desktop_snapshot: {
                companion_session_snapshot: {
                    transcript_entries: [
                        { role: "user", text: "[Role] prompt that must not be reused" },
                        { role: "assistant", text: "Stale assistant reply." }
                    ]
                }
            }
        },
        alice.cast_member_id
    );
    assert.equal(extracted.spoken_text, "Actual assistant reply.");

    console.log("  prompt_budget_and_assistant_extraction: ok");
}

// ── Persistence round-trip ─────────────────────────────────────────────────

async function testPersistenceRoundTrip() {
    const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "echo-story-selfcheck-")
    );

    try {
        const service = new MultiCompanionStoryService();
        const alice = buildCastMember({
            displayName: "Alice",
            personaProfileRef: "persona/alice",
            modelProfileRef: "open-yachiyo-kaguya",
            roleType: CAST_ROLE_TYPE.PROTAGONIST
        });
        const bob = buildCastMember({
            displayName: "Bob",
            personaProfileRef: "persona/bob",
            modelProfileRef: "七七の量贩私皮",
            roleType: CAST_ROLE_TYPE.SUPPORTING
        });

        service.createThread({
            title: "Persist Test",
            mode: STORY_THREAD_MODE.FREE_PLAY,
            castMembers: [alice, bob],
            sceneCardInit: { sceneGoal: "Test persistence" }
        });
        service.bindCastSession(alice.cast_member_id, "session-persist-001");
        service.bindCastSession(bob.cast_member_id, "session-persist-002");
        service.submitUserTurn("Save me", null);

        // Persist
        const data = service.toJSON();
        const { file_path } = await persistStoryState({
            userDataDirectory: tmpDir,
            data
        });
        assert.ok(file_path.endsWith("story-state.json"));

        // Verify file exists and is valid JSON
        const rawText = await fs.readFile(file_path, "utf8");
        const parsed = JSON.parse(rawText);
        assert.equal(parsed.thread.title, "Persist Test");

        // Load
        const loaded = await loadStoryState({ userDataDirectory: tmpDir });
        assert.ok(loaded !== null);
        assert.equal(loaded.thread.title, "Persist Test");

        // Restore into a new service
        const recovered = new MultiCompanionStoryService();
        recovered.restoreFromJSON(loaded);
        assert.equal(recovered.getThread().title, "Persist Test");
        assert.equal(recovered.getThread().revision, 1);
        assert.equal(recovered.getTimeline().length, 1);

        // Load non-existent directory returns null
        const nonExistent = await loadStoryState({
            userDataDirectory: path.join(tmpDir, "no-such-dir")
        });
        assert.equal(nonExistent, null);

        const slotSave = await persistStoryState({
            userDataDirectory: tmpDir,
            data,
            slotId: 3,
            slotTitle: "Chapter 1"
        });
        assert.ok(slotSave.file_path.endsWith("slot-03.json"));

        const listedSlots = await listStoryStateSlots({ userDataDirectory: tmpDir });
        const slotThree = listedSlots.find((slot) => slot.slot_id === 3);
        assert.ok(slotThree);
        assert.equal(slotThree.exists, true);
        assert.equal(slotThree.slot_title, "Chapter 1");
        assert.equal(slotThree.thread_title, "Persist Test");
        assert.deepEqual(slotThree.cast_names, ["Alice", "Bob"]);
        assert.equal(slotThree.chapter_summary, "Test persistence");
        assert.equal(slotThree.latest_event_preview, "Save me");

        const loadedSlot = await loadStoryState({ userDataDirectory: tmpDir, slotId: 3 });
        assert.ok(loadedSlot !== null);
        assert.equal(loadedSlot.thread.title, "Persist Test");

        const archiveResult = await archiveStoryStateSlot({ userDataDirectory: tmpDir, slotId: 3 });
        assert.equal(archiveResult.deleted, true);
        const listedAfterArchive = await listStoryStateSlots({ userDataDirectory: tmpDir });
        const archivedSlot = listedAfterArchive.find((slot) => slot.slot_id === 3);
        assert.ok(archivedSlot);
        assert.equal(archivedSlot.exists, false);

        console.log("  persistence_round_trip: ok");
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

// ── IPC channel constant integrity ─────────────────────────────────────────

function testIPCChannelConstants() {
    const channels = Object.values(STORY_MODE_IPC_CHANNEL);

    // All channels must be non-empty strings
    for (const ch of channels) {
        assert.equal(typeof ch, "string");
        assert.ok(ch.length > 0);
    }

    // All channels must start with the expected prefix
    for (const ch of channels) {
        assert.ok(
            ch.startsWith("echo-desktop-live2d:story-"),
            `channel "${ch}" must use prefix "echo-desktop-live2d:story-"`
        );
    }

    // No duplicate channel strings
    const unique = new Set(channels);
    assert.equal(unique.size, channels.length, "duplicate IPC channels detected");

    // Expected channel count: 22 with narrator state query and slot archive support
    assert.equal(channels.length, 22, `expected 22 channels, got ${channels.length}`);

    // Verify orchestrator channels exist
    assert.ok(STORY_MODE_IPC_CHANNEL.INIT_ORCHESTRATOR);
    assert.ok(STORY_MODE_IPC_CHANNEL.RUN_STORY_TURN);
    assert.ok(STORY_MODE_IPC_CHANNEL.STOP_STORY_TURN);
    assert.ok(STORY_MODE_IPC_CHANNEL.GET_ORCHESTRATOR_STATUS);
    assert.ok(STORY_MODE_IPC_CHANNEL.GET_CAST_MEMBERS);
    assert.ok(STORY_MODE_IPC_CHANNEL.GET_NARRATOR_STATE);
    assert.ok(STORY_MODE_IPC_CHANNEL.LIST_STATE_SLOTS);
    assert.ok(STORY_MODE_IPC_CHANNEL.ARCHIVE_STATE);

    console.log("  ipc_channel_constants: ok");
}

// ── Orchestrator error handling ────────────────────────────────────────────

async function testOrchestratorErrors() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();

    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost
    });

    // Cannot execute cast turn without a host session binding
    await assert.rejects(
        () => orchestrator.executeCastTurn("nonexistent-cast-id"),
        (err) => {
            assert.ok(err.name === "StoryModeOrchestratorError");
            assert.ok(err.message.includes("nonexistent-cast-id"));
            return true;
        }
    );

    console.log("  orchestrator_errors: ok");
}

// ── Narrator retry on malformed response ───────────────────────────────────

async function testNarratorRetryOnMalformedResponse() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();
    const debugLog = [];
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost,
        onDebug: (category, message, detail) => {
            debugLog.push({ category, message, detail });
        }
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Narrator Retry Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test narrator retry.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    await orchestrator.bindAllCastSessions([alice, bob]);
    mockHost.setNarratorTargets([alice.cast_member_id, bob.cast_member_id]);

    // First call returns character speech, retry returns structured text
    mockHost.setNarratorForceFailCount(1);
    const result = await orchestrator.runStoryTurn("开始", alice.cast_member_id);

    // Should have retried and succeeded — narrator should NOT produce YIELD_TO_USER
    const initialDecision = result.narratorDecisions[0];
    assert.ok(initialDecision);
    assert.notEqual(initialDecision.action_kind, NARRATOR_ACTION_KIND.YIELD_TO_USER);
    // directorNote/transitionText should come from the valid retry response, not character speech
    if (initialDecision.director_note) {
        assert.ok(!initialDecision.director_note.includes("欢迎回来"));
    }
    if (initialDecision.transition_text) {
        assert.ok(!initialDecision.transition_text.includes("欢迎回来"));
    }

    // Debug log should show at least one narrator_parse_failed entry
    const parseFailLogs = debugLog.filter((d) => d.message === "narrator_parse_failed");
    assert.ok(parseFailLogs.length >= 1);

    console.log("  narrator_retry_on_malformed_response: ok");
}

async function testNarratorFallbackOnAllRetryFailed() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();
    const debugLog = [];
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost,
        onDebug: (category, message, detail) => {
            debugLog.push({ category, message, detail });
        }
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Narrator Fallback Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test narrator total fallback.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    await orchestrator.bindAllCastSessions([alice, bob]);
    mockHost.setNarratorTargets([alice.cast_member_id, bob.cast_member_id]);

    // Both attempts return character speech — all retries fail
    mockHost.setNarratorForceFailCount(100);
    const result = await orchestrator.runStoryTurn("开始", alice.cast_member_id);

    // Should fallback to CAST_TURN with all members and no directorNote
    const initialDecision = result.narratorDecisions[0];
    assert.ok(initialDecision);
    assert.equal(initialDecision.action_kind, NARRATOR_ACTION_KIND.CAST_TURN);
    assert.equal(initialDecision.director_note, null);
    assert.equal(initialDecision.transition_text, null);
    assert.ok(initialDecision.target_cast_ids.length >= 2);

    // Debug log should show fallback
    const fallbackLogs = debugLog.filter((d) => d.message === "narrator_fallback_cast_turn");
    assert.ok(fallbackLogs.length >= 1);

    console.log("  narrator_fallback_on_all_retry_failed: ok");
}

async function testFallbackChoicesWhenLLMFails() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "Fallback Choices Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test fallback choices.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    await orchestrator.bindAllCastSessions([alice, bob]);
    mockHost.setNarratorTargets([alice.cast_member_id, bob.cast_member_id]);
    mockHost.setMaxNarratorCastTurns(1);
    // Force choices LLM to return empty (no <choices> tags)
    mockHost.setChoicesForceEmpty(true);

    const result = await orchestrator.runStoryTurn("测试", alice.cast_member_id);

    // The final YIELD_TO_USER decision should have fallback choices
    const yieldDecision = result.narratorDecisions.find(
        (d) => d.action_kind === NARRATOR_ACTION_KIND.YIELD_TO_USER
    );
    assert.ok(yieldDecision);
    assert.ok(Array.isArray(yieldDecision.suggested_choices));
    assert.ok(yieldDecision.suggested_choices.length >= 2, "fallback choices should have at least 2 options");
    // Fallback choices should have label and promptText
    for (const choice of yieldDecision.suggested_choices) {
        assert.ok(typeof choice.label === "string" && choice.label.length > 0);
        assert.ok(typeof choice.prompt_text === "string" && choice.prompt_text.length > 0);
    }

    console.log("  fallback_choices_when_llm_fails: ok");
}

async function testLLMChoicesFollowLatestContext() {
    const service = new MultiCompanionStoryService();
    const mockHost = new MockCompanionHost();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: mockHost
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "LLM Choices Context Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test contextual choice generation.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    await orchestrator.bindAllCastSessions([alice, bob]);
    service.submitUserTurn("我们去买苹果糖吧", alice.cast_member_id);
    orchestrator._lastNarratorSceneText = "苹果糖摊位前，空气里有甜味。";
    const appleChoices = await orchestrator._generateLLMChoices();
    assert.ok(appleChoices.length >= 2);
    assert.ok(appleChoices.some((choice) => choice.label.includes("苹果糖")));

    service.submitUserTurn("那改聊电影吧", bob.cast_member_id);
    orchestrator._lastNarratorSceneText = "电影院门口，海报还在亮着。";
    const movieChoices = await orchestrator._generateLLMChoices();
    assert.ok(movieChoices.length >= 2);
    assert.ok(movieChoices.some((choice) => choice.label.includes("电影")));
    assert.notDeepEqual(
        appleChoices.map((choice) => choice.label),
        movieChoices.map((choice) => choice.label)
    );

    console.log("  llm_choices_follow_latest_context: ok");
}

async function testMalformedNarratorNoDirectorNote() {
    const service = new MultiCompanionStoryService();
    const orchestrator = new StoryModeOrchestrator({
        storyService: service,
        companionHost: new MockCompanionHost()
    });

    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    service.createThread({
        title: "No Director Note Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers: [alice, bob],
        sceneCardInit: {
            sceneGoal: "Test no director note from malformed response.",
            toneTagsList: [],
            discourseConstraints: []
        }
    });

    // Test: response with TARGETS but no <update_notes> should NOT produce directorNote
    const malformedResponse = {
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [{
                    role: "assistant",
                    text: `TARGETS: [${alice.cast_member_id}]\n\n欢迎回来呀~是不是累坏啦？`
                }]
            }
        }],
        final_desktop_snapshot: { companion_session_snapshot: { transcript_entries: [] } }
    };
    const decision = orchestrator._extractNarratorDecision(malformedResponse, {
        scene_label: "测试",
        current_time_label: "现在",
        pending_events: []
    });
    // Without update_notes, scene text must NOT be set as directorNote
    assert.equal(decision.director_note, null);
    assert.equal(decision.transition_text, null);

    // Test: response WITH update_notes SHOULD produce directorNote
    const structuredResponse = {
        run_results: [{
            final_companion_session_snapshot: {
                transcript_entries: [{
                    role: "assistant",
                    text: `TARGETS: [${alice.cast_member_id}]\n\n阳光洒在教室的桌面上。\n\n<update_notes>\n  <status>{"scene_label": "教室", "current_time_label": "下午", "scene_goal": "上课", "narrative_focus": "日常", "chapter_summary": "普通一天"}</status>\n</update_notes>`
                }]
            }
        }],
        final_desktop_snapshot: { companion_session_snapshot: { transcript_entries: [] } }
    };
    const goodDecision = orchestrator._extractNarratorDecision(structuredResponse, {
        scene_label: "教室",
        current_time_label: "下午",
        pending_events: []
    });
    assert.ok(goodDecision.director_note !== null);
    assert.ok(goodDecision.director_note.includes("阳光"));

    console.log("  malformed_narrator_no_director_note: ok");
}

// ── Run all ────────────────────────────────────────────────────────────────

async function run() {
    testIPCChannelConstants();
    await testOrchestratorPipeline();
    await testBackgroundStartStatus();
    await testNarratorParsingAndEventCallback();
    testCastReplyExtractionTakesLastNewAssistantEntry();
    await testNarratorResponseInference();
    await testChainLimitForcesYield();
    testPromptBudgetAndAssistantExtraction();
    await testPersistenceRoundTrip();
    await testOrchestratorErrors();
    await testNarratorRetryOnMalformedResponse();
    await testNarratorFallbackOnAllRetryFailed();
    await testFallbackChoicesWhenLLMFails();
    await testLLMChoicesFollowLatestContext();
    await testMalformedNarratorNoDirectorNote();
    console.log("story_mode_integration_self_check: ok");
}

run();
