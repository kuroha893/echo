// ---------------------------------------------------------------------------
// Story Mode Orchestrator — Phase 3 (LLM-based narrator)
// Narrator-first story orchestration aligned with AgentGal's approach:
// - LLM narrator for scene management, targets, and state updates
// - LLM-generated player choices after cast responses
// - Full conversation context fed to narrator each beat
// ---------------------------------------------------------------------------

import { COMMIT_RESULT } from "../shared/turn_commit_coordinator.mjs";
import { DIRECTOR_USER_WAIT_POLICY } from "../shared/story_thread_contracts.mjs";
import {
    NARRATOR_ACTION_KIND,
    DIRECTIVE_KIND,
    SPEAKER_LOCK_POLICY,
    buildNarratorDecision,
    buildStoryChoice
} from "../shared/story_narrator_contracts.mjs";
import {
    sanitizeStoryNarratorVisibleText,
    sanitizeStoryVisibleText
} from "../shared/story_visible_text.mjs";

const STORY_MODE_HOST_INPUT_MAX_LENGTH = 4000;
const STORY_MODE_TARGET_PROMPT_LENGTH = 3600;
const STORY_MODE_NARRATOR_PROMPT_LENGTH = 3800;
const STORY_MODE_MAX_RECENT_EVENTS = 12;
const STORY_MODE_MAX_RECENT_EVENT_TEXT = 200;
const STORY_MODE_MAX_FACT_ITEMS = 6;
const STORY_MODE_MAX_FACT_TEXT = 180;
const STORY_MODE_MIN_SECTION_LENGTH = 48;
const STORY_MODE_MAX_CAST_CHAIN = 8;

export class StoryModeOrchestratorError extends Error {
    constructor(message) {
        super(message);
        this.name = "StoryModeOrchestratorError";
    }
}

export class StoryModeOrchestrator {
    constructor({ storyService, companionHost, onBeforeCastTurn, onCastCommitted, onNarratorEvents, onDebug }) {
        this._storyService = storyService;
        this._companionHost = companionHost;
        this._onBeforeCastTurn = onBeforeCastTurn || (async () => { });
        this._onCastCommitted = onCastCommitted || (async () => { });
        this._onNarratorEvents = onNarratorEvents || (async () => { });
        this._onDebug = onDebug || (() => { });
        this._hostSessionIds = new Map();
        this._castModelKeys = new Map();
        this._narratorSessionId = null;
        this._narratorModelKey = null;
        this._narratorChoiceSessionId = null;
        this._narratorChoiceModelKey = null;
        this._directSessionId = null;
        this._activeRunPromise = null;
        this._stopRequested = false;
        this._runId = 0;
        this._lastErrorMessage = null;
        this._running = false;
        this._lastNarratorSceneText = "";
        this._fallbackChoiceVariant = 0;
    }

    // -----------------------------------------------------------------------
    // Session binding
    // -----------------------------------------------------------------------

    async bindAllCastSessions(castMembers) {
        this._hostSessionIds.clear();
        this._castModelKeys.clear();
        this._lastNarratorSceneText = "";
        this._narratorChoiceSessionId = null;
        this._narratorChoiceModelKey = null;
        this._fallbackChoiceVariant = 0;

        for (const cm of castMembers) {
            const modelKey = typeof cm.model_profile_ref === "string" ? cm.model_profile_ref.trim() : "";
            if (!modelKey) {
                throw new StoryModeOrchestratorError(
                    `Story cast '${cm.display_name}' is missing model_profile_ref`
                );
            }
            const hostSession = await this._companionHost.createSession({
                title: `story-cast:${cm.display_name}`,
                makeActive: false,
                modelKey,
                sessionKind: "story_cast",
                voiceProfileKey:
                    typeof cm.voice_profile_ref === "string" && cm.voice_profile_ref.trim() !== ""
                        ? cm.voice_profile_ref.trim()
                        : null
            });
            const sessionId = hostSession.session_id;
            this._hostSessionIds.set(cm.cast_member_id, sessionId);
            this._castModelKeys.set(cm.cast_member_id, modelKey);
            this._storyService.bindCastSession(cm.cast_member_id, sessionId);
            this._debug("story_orchestrator", "bound_cast_session", {
                cast_member_id: cm.cast_member_id,
                display_name: cm.display_name,
                session_id: sessionId,
                model_key: modelKey
            });
        }

        const narratorModelKey = this._resolveNarratorModelKey(castMembers);
        const narratorSession = await this._companionHost.createSession({
            title: "story-narrator",
            makeActive: false,
            modelKey: narratorModelKey,
            sessionKind: "story_narrator",
            voiceProfileKey: null
        });
        this._narratorSessionId = narratorSession.session_id;
        this._narratorModelKey = narratorModelKey;
        this._debug("story_orchestrator", "bound_narrator_session", {
            session_id: this._narratorSessionId,
            model_key: this._narratorModelKey
        });

        const narratorChoiceSession = await this._companionHost.createSession({
            title: "story-narrator-choices",
            makeActive: false,
            modelKey: narratorModelKey,
            sessionKind: "story_narrator",
            voiceProfileKey: null
        });
        this._narratorChoiceSessionId = narratorChoiceSession.session_id;
        this._narratorChoiceModelKey = narratorModelKey;
        this._debug("story_orchestrator", "bound_narrator_choice_session", {
            session_id: this._narratorChoiceSessionId,
            model_key: this._narratorChoiceModelKey
        });

        this._directSessionId = await this._ensureVisibleDirectSession();
    }

    // -----------------------------------------------------------------------
    // Public turn interface
    // -----------------------------------------------------------------------

    getCastMemberIdForSession(sessionId) {
        for (const [castMemberId, sid] of this._hostSessionIds) {
            if (sid === sessionId) return castMemberId;
        }
        return null;
    }

    async executeUserTurn(text, cueTarget = null, choiceMetadata = null) {
        const result = this._storyService.submitUserTurn(text, cueTarget, choiceMetadata);
        this._debug("story_orchestrator", "user_turn", {
            revision: this._storyService.getThread().revision,
            cue_target: cueTarget,
            has_choice_metadata: choiceMetadata !== null
        });
        return { userEvent: result.projectionEvent, intervention: result.intervention };
    }

    async executeCastTurn(castMemberId, userText = null) {
        const hostSessionId = this._hostSessionIds.get(castMemberId);
        const hostModelKey = this._castModelKeys.get(castMemberId) || null;
        if (!hostSessionId) {
            throw new StoryModeOrchestratorError(
                `No host session bound for cast_member_id: ${castMemberId}`
            );
        }
        if (!hostModelKey) {
            throw new StoryModeOrchestratorError(
                `No host model key bound for cast_member_id: ${castMemberId}`
            );
        }

        await this._onBeforeCastTurn(castMemberId);
        const inputSnapshot = this._storyService.assembleForCast(castMemberId, userText);
        this._debug("story_orchestrator", "cast_turn_assemble", {
            cast_member_id: castMemberId,
            snapshot_id: inputSnapshot.snapshot_id,
            thread_revision: inputSnapshot.thread_context.revision,
            recent_event_count: inputSnapshot.recent_events?.length || 0
        });

        const promptText = this._buildCastPrompt(inputSnapshot);
        const hostResult = await this._runHostSession(hostSessionId, hostModelKey, async () => {
            this._debug("story_orchestrator", "cast_turn_prompt_ready", {
                cast_member_id: castMemberId,
                prompt_length: promptText.length
            });
            return await this._companionHost.submitDesktopInput(promptText, {
                visibleInTranscript: false,
                modelKey: hostModelKey
            });
        });

        if (this._stopRequested) {
            this._debug("story_orchestrator", "cast_turn_discarded_after_stop", {
                cast_member_id: castMemberId
            });
            return {
                result: COMMIT_RESULT.STALE_REVISION,
                projectionEvent: null,
                commitArtifact: null
            };
        }

        const structuredOutput = this._extractStructuredOutput(hostResult, castMemberId);
        this._storyService.registerProvisionalTurn(
            castMemberId,
            inputSnapshot.snapshot_id,
            structuredOutput
        );
        const commitResult = this._storyService.tryCommitTurn(castMemberId);

        this._debug("story_orchestrator", "cast_turn_commit", {
            cast_member_id: castMemberId,
            result: commitResult.result,
            revision: this._storyService.getThread()?.revision || null,
            beat_tags: structuredOutput.beat_tags
        });

        if (commitResult.result === COMMIT_RESULT.SUCCESS && commitResult.projectionEvent?.text) {
            await this._onCastCommitted({
                castMemberId,
                structuredOutput,
                projectionEvent: commitResult.projectionEvent,
                commitResult
            });
        }

        return commitResult;
    }

    async runStoryTurn(text, cueTarget = null, choiceMetadata = null) {
        if (this._running) {
            throw new StoryModeOrchestratorError(
                "story mode orchestrator is already running"
            );
        }
        this._running = true;
        this._stopRequested = false;
        this._lastErrorMessage = null;
        try {
            return await this._runStoryTurnLoop(text, cueTarget, choiceMetadata);
        } catch (error) {
            this._lastErrorMessage = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            this._running = false;
            this._stopRequested = false;
        }
    }

    async startStoryTurn(text, cueTarget = null, choiceMetadata = null) {
        const normalizedText = typeof text === "string" ? text.trim() : "";
        if (!normalizedText) {
            throw new StoryModeOrchestratorError("story mode input text must be non-empty");
        }

        if (this._running) {
            await this.stopAndWait("user_intervention");
        }

        const runId = ++this._runId;
        this._running = true;
        this._stopRequested = false;
        this._lastErrorMessage = null;

        const runPromise = this._runStoryTurnLoop(normalizedText, cueTarget, choiceMetadata)
            .catch((error) => {
                this._lastErrorMessage = error instanceof Error ? error.message : String(error);
                this._debug("story_orchestrator", "background_run_failed", {
                    run_id: runId,
                    error_message: this._lastErrorMessage
                });
            })
            .finally(() => {
                if (this._activeRunPromise === runPromise) {
                    this._activeRunPromise = null;
                    this._running = false;
                    this._stopRequested = false;
                }
            });

        this._activeRunPromise = runPromise;
        return {
            started: true,
            run_id: runId
        };
    }

    async stopAndWait(reason = "user_intervention") {
        if (!this._running || !this._activeRunPromise) {
            return { stopped: false };
        }
        this._stopRequested = true;
        this._storyService.invalidatePlan(reason);
        try {
            await this._activeRunPromise;
        } catch {
            // Background path stores failures in status state.
        }
        return { stopped: true };
    }

    getStatus() {
        return {
            running: this._running,
            last_error_message: this._lastErrorMessage
        };
    }

    isRunning() {
        return this._running;
    }

    // -----------------------------------------------------------------------
    // Turn loop
    // -----------------------------------------------------------------------

    async _runStoryTurnLoop(text, cueTarget = null, choiceMetadata = null) {
        // Multi-round narrator loop:
        //   1. Narrator decides targets + scene description (LLM call)
        //   2. Each target cast member responds sequentially
        //   3. Narrator re-evaluates: continue → back to 1, or yield → stop
        //   4. Cap total cast turns at STORY_MODE_MAX_CAST_CHAIN
        const castResults = [];
        const narratorDecisions = [];
        const { userEvent, intervention } = await this.executeUserTurn(text, cueTarget, choiceMetadata);

        // Stale choice was rejected — bubble up to UI without entering narrator turn
        if (intervention?.kind === "stale_choice") {
            return { userEvent, castResults, narratorDecisions, staleChoice: true };
        }

        let totalCastTurns = 0;
        let loopRound = 0;
        let isFirstRound = true;

        while (!this._stopRequested && totalCastTurns < STORY_MODE_MAX_CAST_CHAIN) {
            const narratorUserText = isFirstRound ? text : null;
            const decision = await this._executeNarratorTurn(
                narratorUserText, isFirstRound, loopRound
            );
            narratorDecisions.push(decision);

            if (decision.action_kind === NARRATOR_ACTION_KIND.YIELD_TO_USER) {
                break;
            }

            // Use the narrator's target_cast_ids directly as the execution queue.
            const targetQueue = (decision.target_cast_ids || [])
                .filter((castId) => this._hostSessionIds.has(castId));

            // speaker_lock: force locked speaker to front of queue (first round only)
            if (isFirstRound) {
                const speakerLock = intervention?.speaker_lock || null;
                if (speakerLock && this._hostSessionIds.has(speakerLock)) {
                    const isCastActive = this._storyService.isCastMemberActive?.(speakerLock) ?? true;
                    if (isCastActive) {
                        const idx = targetQueue.indexOf(speakerLock);
                        if (idx > 0) {
                            targetQueue.splice(idx, 1);
                            targetQueue.unshift(speakerLock);
                        } else if (idx < 0) {
                            targetQueue.unshift(speakerLock);
                        }
                    }
                }
            }

            if (targetQueue.length === 0) {
                break;
            }

            // Execute all targets sequentially without intermediate narrator calls.
            let roundSuccess = 0;
            for (let i = 0; i < targetQueue.length; i += 1) {
                if (this._stopRequested || totalCastTurns >= STORY_MODE_MAX_CAST_CHAIN) break;
                const castId = targetQueue[i];

                // Phantom fact: attempt with retry
                const nextResult = await this._executeCastTurnWithPhantomGuard(
                    castId, isFirstRound && i === 0 ? text : null
                );
                castResults.push(nextResult);
                totalCastTurns += 1;

                if (nextResult.result !== COMMIT_RESULT.SUCCESS) {
                    this._trackLockFailure(castId);
                    if (nextResult.result === COMMIT_RESULT.VALIDATION_FAILED) {
                        continue;
                    }
                    break;
                } else {
                    roundSuccess += 1;
                    this._storyService.consumeInterventionIfNeeded?.(castId);
                }
            }

            isFirstRound = false;
            loopRound += 1;

            // If no cast turn succeeded this round, stop looping
            if (roundSuccess === 0) {
                break;
            }
        }

        // Yield to user with choices at the end
        if (!this._stopRequested) {
            const reason = totalCastTurns >= STORY_MODE_MAX_CAST_CHAIN
                ? "chain_limit" : "all_targets_responded";
            const yieldDecision = await this._executeNarratorTurn(null, false, loopRound, {
                forceYieldToUser: true,
                forceReason: reason
            });
            narratorDecisions.push(yieldDecision);
        }

        return { userEvent, castResults, narratorDecisions };
    }

    // -----------------------------------------------------------------------
    // LLM narrator
    // -----------------------------------------------------------------------

    async _executeNarratorTurn(userText, isInitialTurn, loopCount, options = {}) {
        const telemetry = this._analyzeStoryMomentum();
        this._storyService.updateNarratorTelemetry(telemetry);

        const narratorState = this._storyService.getNarratorState();
        const forceYieldToUser = options.forceYieldToUser === true;
        let decision;

        if (forceYieldToUser) {
            decision = this._buildForcedYieldDecision(narratorState, options.forceReason);
        } else {
            decision = await this._callNarratorLLMWithRetry({
                userText, isInitialTurn, loopCount, narratorState
            });
        }

        if (decision.action_kind === NARRATOR_ACTION_KIND.YIELD_TO_USER) {
            let choices = await this._generateLLMChoices();
            if (choices.length === 0) {
                choices = this._buildFallbackChoices();
            }
            decision = this._withChoices(decision, choices);
        }

        const applyResult = this._storyService.applyNarratorDecision(decision);
        await this._onNarratorEvents({
            decision,
            emittedEvents: applyResult.emitted_events
        });
        this._debug("story_orchestrator", "narrator_decision", {
            action_kind: decision.action_kind,
            user_wait_policy: decision.user_wait_policy,
            target_cast_ids: decision.target_cast_ids,
            emitted_event_count: applyResult.emitted_events.length,
            suggested_choice_count: decision.suggested_choices.length
        });
        return decision;
    }

    async _callNarratorLLMWithRetry({ userText, isInitialTurn, loopCount, narratorState }) {
        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const isRetry = attempt > 0;
            const promptText = isRetry
                ? this._buildNarratorRetryPrompt()
                : this._buildNarratorPrompt({ userText, isInitialTurn, loopCount });
            this._debug("story_orchestrator", "narrator_prompt_ready", {
                prompt_length: promptText.length,
                is_initial: isInitialTurn,
                loop_count: loopCount,
                attempt
            });
            const hostResult = await this._runHostSession(
                this._narratorSessionId, this._narratorModelKey,
                async () => {
                    return await this._companionHost.submitDesktopInput(promptText, {
                        visibleInTranscript: false,
                        modelKey: this._narratorModelKey
                    });
                }
            );
            const responseText = this._extractAssistantReplyText(hostResult, { mode: "latest" });
            if (this._isValidNarratorResponse(responseText)) {
                return this._extractNarratorDecision(hostResult, narratorState);
            }
            this._debug("story_orchestrator", "narrator_parse_failed", {
                attempt,
                response_preview: responseText.slice(0, 120)
            });
        }
        // All attempts failed — fall back to CAST_TURN with all members, no directorNote
        this._debug("story_orchestrator", "narrator_fallback_cast_turn", {});
        return this._buildDefaultCastTurnDecision(narratorState);
    }

    _isValidNarratorResponse(responseText) {
        return /TARGETS:\s*\[/i.test(responseText);
    }

    _buildNarratorRetryPrompt() {
        const castMembers = this._storyService.getCastMembers();
        const validTargetIds = castMembers.map((c) => c.cast_member_id).join(", ");
        return [
            "你的上一条回复格式不正确。你是旁白导演，不是角色。请严格按以下格式重新输出：",
            "",
            `TARGETS: [从这些id中选择: ${validTargetIds}]`,
            "",
            "**时间**：具体时间",
            "**地点**：具体场景",
            "**在场**：",
            "- 玩家：[位置]",
            "- 角色：[位置]",
            "",
            "[环境描写]",
            "",
            "<update_notes>",
            '  <status>{"scene_label": "...", "current_time_label": "...", "scene_goal": "...", "narrative_focus": "...", "chapter_summary": "..."}</status>',
            "</update_notes>",
            "",
            "绝不要替主要角色说话。绝不要写角色台词。只描写环境和非主要角色动作。"
        ].join("\n");
    }

    _buildDefaultCastTurnDecision(narratorState) {
        const castMembers = this._storyService.getCastMembers();
        const sceneCard = this._storyService.getSceneCard();
        return buildNarratorDecision({
            actionKind: NARRATOR_ACTION_KIND.CAST_TURN,
            userWaitPolicy: DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN,
            targetCastIds: castMembers.map((c) => c.cast_member_id),
            directorHint: "推进当前场景。",
            sceneGoal: sanitizeStoryVisibleText(sceneCard?.scene_goal || narratorState?.scene_goal || "继续推进故事。"),
            sceneLabel: sanitizeStoryVisibleText(narratorState?.scene_label || "当前场景"),
            currentTimeLabel: sanitizeStoryVisibleText(narratorState?.current_time_label || "现在"),
            narrativeFocus: sanitizeStoryVisibleText(narratorState?.narrative_focus || "推进关系。"),
            chapterSummary: sanitizeStoryVisibleText(narratorState?.chapter_summary || "故事进行中。"),
            relationshipSummaryLines: narratorState?.relationship_summary_lines || [],
            pendingEvents: narratorState?.pending_events || [],
            directorNote: null,
            transitionText: null,
            suggestedChoices: []
        });
    }

    _buildForcedYieldDecision(narratorState, forceReason) {
        const castMembers = this._storyService.getCastMembers();
        const sceneCard = this._storyService.getSceneCard();
        const reasonText = forceReason === "all_targets_responded"
            ? "所有目标角色已回应，等待玩家下一步输入。"
            : forceReason === "chain_limit"
                ? "自动推进已达上限，让玩家决定下一步。"
                : "当前没有可继续推进的角色，让玩家决定下一步。";
        return buildNarratorDecision({
            actionKind: NARRATOR_ACTION_KIND.YIELD_TO_USER,
            userWaitPolicy: DIRECTOR_USER_WAIT_POLICY.YIELD_TO_USER,
            targetCastIds: castMembers.map((c) => c.cast_member_id),
            directorHint: reasonText,
            sceneGoal: sanitizeStoryVisibleText(sceneCard?.scene_goal || narratorState?.scene_goal || "继续推进故事。"),
            sceneLabel: sanitizeStoryVisibleText(narratorState?.scene_label || "当前场景"),
            currentTimeLabel: sanitizeStoryVisibleText(narratorState?.current_time_label || "现在"),
            narrativeFocus: sanitizeStoryVisibleText(narratorState?.narrative_focus || "等待玩家输入。"),
            chapterSummary: sanitizeStoryVisibleText(narratorState?.chapter_summary || "故事进行中。"),
            relationshipSummaryLines: narratorState?.relationship_summary_lines || [],
            pendingEvents: narratorState?.pending_events || [],
            directorNote: null,
            transitionText: null,
            suggestedChoices: []
        });
    }

    // -----------------------------------------------------------------------
    // Narrator prompt (AgentGal-aligned)
    // -----------------------------------------------------------------------

    _buildNarratorPrompt({ userText, isInitialTurn, loopCount }) {
        const thread = this._storyService.getThread();
        const scene = this._storyService.getSceneCard();
        const narratorState = this._storyService.getNarratorState();
        const castMembers = this._storyService.getCastMembers();
        const timeline = this._storyService.getTimeline().slice(-STORY_MODE_MAX_RECENT_EVENTS);

        const castNameById = new Map(
            castMembers.map((c) => [c.cast_member_id, c.display_name])
        );
        const castLines = castMembers
            .map((c) => `- ${c.cast_member_id}: ${c.display_name} (${c.role_type})`)
            .join("\n");
        const validTargetIds = castMembers.map((c) => c.cast_member_id).join(", ");

        const recentLines = timeline
            .map((event) => {
                const speaker = event.cast_member_id
                    ? (castNameById.get(event.cast_member_id) || event.cast_member_id)
                    : event.event_kind === "user_input"
                        ? "玩家"
                        : event.event_kind;
                return `- ${speaker}: ${this._truncateText(event.text, STORY_MODE_MAX_RECENT_EVENT_TEXT)}`;
            })
            .join("\n");

        const statusLines = [];
        if (narratorState) {
            statusLines.push(`场景: ${narratorState.scene_label || scene?.scene_goal || "未知"}`);
            statusLines.push(`当前时间: ${narratorState.current_time_label || "未指定"}`);
            statusLines.push(`叙事焦点: ${narratorState.narrative_focus || "推进关系"}`);
            if (narratorState.chapter_summary) {
                statusLines.push(`章节概要: ${narratorState.chapter_summary}`);
            }
            if (narratorState.relationship_summary_lines?.length > 0) {
                statusLines.push(
                    `关系现状:\n${narratorState.relationship_summary_lines.map((l) => `  - ${l}`).join("\n")}`
                );
            }
            if (narratorState.pending_events?.length > 0) {
                statusLines.push(
                    `待触发事件:\n${narratorState.pending_events.map((e) => `  - 【${e}】`).join("\n")}`
                );
            }
            if (narratorState.last_director_note) {
                statusLines.push(`上一条导演备注: ${narratorState.last_director_note}`);
            }
        }

        const parts = [
            // Role
            "[Role]\n你是故事旁白和节拍导演。你绝不代替任何主要角色说话或行动。",

            // Goal (adapted from AgentGal narrator_prompt.txt)
            "[Goal]\n"
            + "你的核心工作是管理场景和角色出场。\n"
            + "场景需要判断：这一拍要继续，还是要直接落到下一拍。\n"
            + "- 继续：玩家还在当前互动里推进关系、试探、确认或选择。留在当前地点，时间只推进1-5分钟。\n"
            + "- 落下一拍：当前只剩功能性流程或中间过程。直接跳到下一个有主要角色重新进入玩家感知的时刻。转场优先使用待触发事件；没有就跳到最近的可互动节点，最多跳24小时。\n"
            + "- 主动制造事件：当气氛变平时，把场景里现成的人、物、环境变成新的剧情。例如突然下雨只剩一把伞、同事插一句、手机来电、门禁卡了、遗落物品被发现、顺路撞见另一位角色。\n"
            + "角色出场需要判断谁能感知到玩家的行为，然后写进TARGETS里。",

            // Output format
            "[Output Format]\n"
            + "TARGETS: [角色id列表]\n\n"
            + "**时间**：X月X日 XX:XX\n"
            + "**地点**：具体场景\n"
            + "**在场**：\n"
            + "- 玩家：[位置]\n"
            + "- 角色：[位置]\n\n"
            + "[环境描写，简短自然]\n\n"
            + "<update_notes>\n"
            + "  <status>{\"scene_label\": \"场景名\", \"current_time_label\": \"时间\", \"scene_goal\": \"当前场景目标\", "
            + "\"narrative_focus\": \"叙事焦点\", \"chapter_summary\": \"章节概要\", "
            + "\"relationship_summary_lines\": [\"角色关系现状\"]}</status>\n"
            + "  <triggered>事件名（触发时才写）</triggered>\n"
            + "  <add_event>【新事件名】事件描述</add_event>\n"
            + "</update_notes>",

            // Rules
            "[Rules]\n"
            + "- TARGETS必须使用下方角色id，表示旁白后能感知到玩家言行的主要角色\n"
            + "- 非主要角色可由旁白直接写一两句话让场景落地；主要角色留给角色自己\n"
            + "- status每轮必须更新；relationship_summary_lines只在实质变化时更新\n"
            + "- 绝不替主要角色发言、转述发言、补内心或决定动作\n"
            + "- 当玩家转入自持状态而无感知连接时，跳到角色重新进入感知的时刻\n"
            + "- 当TARGETS为空（无人可承接）时，继续推进到下一个主要角色出现的时刻",

            // Cast and targets
            `[Cast]\n${castLines}`,
            `[Valid TARGETS]\n${validTargetIds}`,
            `[Thread]\n${thread.title} · rev ${thread.revision}`,
            `[Scene Goal]\n${scene?.scene_goal || "继续推进故事"}`
        ];

        if (statusLines.length > 0) {
            parts.push(`[Current State]\n${statusLines.join("\n")}`);
        }

        if (recentLines) {
            parts.push(`[Recent Dialogue]\n${recentLines}`);
        }

        // [Authoritative Directive] — speaker lock injection for narrator
        const latestIntervention = this._storyService.getLatestIntervention?.() || null;
        const speakerLock = latestIntervention?.speaker_lock || null;
        if (speakerLock) {
            const lockedName = castNameById.get(speakerLock) || speakerLock;
            parts.push(
                `[Authoritative Directive — override]\n`
                + `用户已指定 ${lockedName}(${speakerLock}) 为下一位发言者。`
                + ` TARGETS 第一位必须是 ${speakerLock}。不要改写当前 scene goal。`
            );
        } else if (latestIntervention?.director_hint) {
            parts.push(`[Director Directive]\n${latestIntervention.director_hint}`);
        }

        if (isInitialTurn && typeof userText === "string" && userText.trim() !== "") {
            parts.push(`[Latest Player Input]\n${userText.trim()}`);
        }

        return this._fitPromptToBudget(parts, STORY_MODE_NARRATOR_PROMPT_LENGTH);
    }

    // -----------------------------------------------------------------------
    // Narrator response parsing
    // -----------------------------------------------------------------------

    _extractNarratorDecision(hostResult, narratorState) {
        const responseText = this._extractAssistantReplyText(hostResult, { mode: "latest" });
        const castMembers = this._storyService.getCastMembers();
        const sceneCard = this._storyService.getSceneCard();
        const validCastIds = new Set(castMembers.map((c) => c.cast_member_id));

        const targets = this._parseNarratorTargets(responseText, validCastIds);
        const sceneText = this._parseNarratorSceneText(responseText);
        this._lastNarratorSceneText = sceneText;
        const updateNotes = this._parseNarratorUpdateNotes(responseText);
        const actionKind = this._inferActionKind(updateNotes, narratorState, targets);
        const userWaitPolicy = actionKind === NARRATOR_ACTION_KIND.YIELD_TO_USER
            ? DIRECTOR_USER_WAIT_POLICY.YIELD_TO_USER
            : DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN;

        // Pending events: remove triggered, prepend new
        const existingPending = narratorState?.pending_events || [];
        const triggeredSet = new Set(
            (updateNotes.triggered || []).map((t) => t.trim()).filter(Boolean)
        );
        const remainingPending = existingPending.filter((e) => !triggeredSet.has(e));
        const newEvents = (updateNotes.addEvents || [])
            .map((e) => sanitizeStoryVisibleText(e))
            .filter(Boolean);
        const pendingEvents = [...newEvents, ...remainingPending].slice(0, 4);

        // Relationship summary
        const relationshipLines = Array.isArray(updateNotes.status?.relationship_summary_lines)
            ? updateNotes.status.relationship_summary_lines
                .map((l) => sanitizeStoryVisibleText(String(l)))
                .filter(Boolean)
            : (narratorState?.relationship_summary_lines || []);

        // Only emit scene text as directorNote/transitionText when the
        // narrator returned a properly structured response (has update_notes).
        // If update_notes is missing, the scene text is likely malformed LLM
        // output (e.g. character speech) and must not appear in the timeline.
        const hasStructuredOutput = updateNotes.status !== null;
        let transitionText = null;
        let directorNote = null;
        if (hasStructuredOutput && actionKind === NARRATOR_ACTION_KIND.SCENE_TRANSITION) {
            transitionText = sanitizeStoryVisibleText(sceneText) || null;
        } else if (hasStructuredOutput && sceneText) {
            directorNote = sanitizeStoryVisibleText(sceneText) || null;
        }

        return buildNarratorDecision({
            actionKind,
            userWaitPolicy,
            targetCastIds: targets.length > 0
                ? targets
                : castMembers.map((c) => c.cast_member_id),
            directorHint: sanitizeStoryVisibleText(
                sceneText ? sceneText.slice(0, 200) : "推进当前场景。"
            ),
            sceneGoal: sanitizeStoryVisibleText(
                updateNotes.status?.scene_goal
                || sceneCard?.scene_goal
                || narratorState?.scene_goal
                || "继续推进故事。"
            ),
            sceneLabel: sanitizeStoryVisibleText(
                updateNotes.status?.scene_label
                || narratorState?.scene_label
                || "当前场景"
            ),
            currentTimeLabel: sanitizeStoryVisibleText(
                updateNotes.status?.current_time_label
                || narratorState?.current_time_label
                || "现在"
            ),
            narrativeFocus: sanitizeStoryVisibleText(
                updateNotes.status?.narrative_focus
                || narratorState?.narrative_focus
                || "推进关系。"
            ),
            chapterSummary: sanitizeStoryVisibleText(
                updateNotes.status?.chapter_summary
                || narratorState?.chapter_summary
                || "故事进行中。"
            ),
            relationshipSummaryLines: relationshipLines,
            pendingEvents,
            directorNote,
            transitionText,
            suggestedChoices: []
        });
    }

    _parseNarratorTargets(responseText, validCastIds) {
        const match = /TARGETS:\s*\[([^\]]*)\]/i.exec(responseText);
        if (!match) return [];
        return match[1]
            .split(",")
            .map((id) => id.trim().replace(/['"]/g, ""))
            .filter((id) => id && validCastIds.has(id));
    }

    _parseNarratorSceneText(responseText) {
        const targetsMatch = /TARGETS:\s*\[[^\]]*\]/i.exec(responseText);
        const targetsEnd = targetsMatch
            ? targetsMatch.index + targetsMatch[0].length
            : 0;
        const updateStart = responseText.indexOf("<update_notes>");
        const endPos = updateStart >= 0 ? updateStart : responseText.length;
        return sanitizeStoryNarratorVisibleText(responseText.slice(targetsEnd, endPos));
    }

    _parseNarratorUpdateNotes(responseText) {
        const result = { status: null, triggered: [], addEvents: [] };

        const statusMatch = /<status>([\s\S]*?)<\/status>/i.exec(responseText);
        if (statusMatch) {
            const parsed = this._parseJsonObject(statusMatch[1]);
            if (parsed) {
                // Accept both English and Chinese field names
                const relRaw = parsed.relationship_summary_lines || parsed["关系现状"];
                let relationshipLines = null;
                if (Array.isArray(relRaw)) {
                    relationshipLines = relRaw;
                } else if (typeof relRaw === "string" && relRaw.trim()) {
                    relationshipLines = relRaw
                        .split("\n")
                        .map((l) => l.replace(/^-\s*/, "").trim())
                        .filter(Boolean);
                }

                result.status = {
                    scene_label: parsed.scene_label || parsed["场景"] || null,
                    current_time_label: parsed.current_time_label || parsed["当前时间"] || null,
                    scene_goal: parsed.scene_goal || null,
                    narrative_focus: parsed.narrative_focus || parsed["叙事焦点"] || null,
                    chapter_summary: parsed.chapter_summary || null,
                    relationship_summary_lines: relationshipLines
                };
            }
        }

        const triggeredRe = /<triggered>([\s\S]*?)<\/triggered>/gi;
        let trigMatch;
        while ((trigMatch = triggeredRe.exec(responseText)) !== null) {
            const items = trigMatch[1]
                .split(",")
                .map((s) => s.trim().replace(/^【|】$/g, ""))
                .filter(Boolean);
            result.triggered.push(...items);
        }

        const addEventRe = /<add_event>([\s\S]*?)<\/add_event>/gi;
        let addMatch;
        while ((addMatch = addEventRe.exec(responseText)) !== null) {
            const eventText = addMatch[1].trim();
            const cleaned = eventText.replace(/^【[^】]*】\s*/, "").trim();
            if (cleaned) result.addEvents.push(cleaned);
        }

        return result;
    }

    _inferActionKind(updateNotes, narratorState, targets) {
        if (targets.length === 0) {
            return NARRATOR_ACTION_KIND.YIELD_TO_USER;
        }
        if (
            updateNotes.status?.scene_label
            && narratorState?.scene_label
            && updateNotes.status.scene_label !== narratorState.scene_label
        ) {
            return NARRATOR_ACTION_KIND.SCENE_TRANSITION;
        }
        if (
            updateNotes.status?.current_time_label
            && narratorState?.current_time_label
            && updateNotes.status.current_time_label !== narratorState.current_time_label
        ) {
            return NARRATOR_ACTION_KIND.SCENE_TRANSITION;
        }
        if (updateNotes.addEvents?.length > 0) {
            return NARRATOR_ACTION_KIND.INJECT_EVENT;
        }
        return NARRATOR_ACTION_KIND.CAST_TURN;
    }

    // -----------------------------------------------------------------------
    // LLM choice generation (AgentGal-aligned)
    // -----------------------------------------------------------------------

    async _generateLLMChoices() {
        const castMembers = this._storyService.getCastMembers();
        const timeline = this._storyService.getTimeline().slice(-8);
        const castNameById = new Map(
            castMembers.map((c) => [c.cast_member_id, c.display_name])
        );
        await this._refreshNarratorChoiceSession();

        const validTargetIds = castMembers
            .map((c) => `${c.cast_member_id}(${c.display_name})`)
            .join(", ");

        const recentDialogue = timeline
            .map((event) => {
                const speaker = event.cast_member_id
                    ? (castNameById.get(event.cast_member_id) || event.cast_member_id)
                    : event.event_kind === "user_input" ? "玩家" : event.event_kind;
                return `${speaker}: ${this._truncateText(event.text, STORY_MODE_MAX_RECENT_EVENT_TEXT)}`;
            })
            .join("\n");

        const promptParts = [
            "【选项生成器】你是故事分支导演。根据当前对话和场景，为玩家生成2-3个分支选项。",

            "要求：\n"
            + "- 每个选项表达的是「导演希望故事接下来怎么走」\n"
            + "- label 用简洁中文写，说明选了之后会发生什么\n"
            + "- 不要写成角色台词，不要写成舞台动作描写\n"
            + "- 如果某角色的话还没说完，应包含一个 directive=continue 的选项\n"
            + "- 如果当前互动自然收束，应包含一个 directive=scene_shift 的选项\n"
            + "- target_speaker_id 必须从下方合法id列表中选取，或留空\n"
            + "- 必须根据当前这一次提供的【近期对话】和【场景】重新生成，不要复用上一轮选项措辞",

            `合法角色id: ${validTargetIds}`,

            "严格按以下JSON格式输出，不要输出JSON以外的文字：\n"
            + "```json\n"
            + "{\"choices\": [\n"
            + "  {\"target_speaker_id\": \"角色id或空字符串\", \"directive\": \"continue|redirect|scene_shift|respond|escalate|deescalate\", \"label\": \"选了之后会发生什么\"},\n"
            + "  ...\n"
            + "]}\n"
            + "```"
        ];

        if (recentDialogue) {
            promptParts.push(`【近期对话】\n${recentDialogue}`);
        }
        if (this._lastNarratorSceneText) {
            promptParts.push(`【场景】\n${this._lastNarratorSceneText}`);
        }

        const promptText = this._fitPromptToBudget(promptParts);

        try {
            const hostResult = await this._runHostSession(
                this._narratorChoiceSessionId || this._narratorSessionId,
                this._narratorChoiceModelKey || this._narratorModelKey,
                async () => {
                    return await this._companionHost.submitDesktopInput(promptText, {
                        visibleInTranscript: false,
                        modelKey: this._narratorChoiceModelKey || this._narratorModelKey
                    });
                }
            );
            const responseText = this._extractAssistantReplyText(hostResult, { mode: "new" });
            const choices = this._parseChoicesResponse(responseText);
            if (choices.length === 0) {
                this._debug("story_orchestrator", "choices_response_unparsed", {
                    response_excerpt: this._truncateText(responseText, 240)
                });
            }
            return choices;
        } catch (error) {
            this._debug("story_orchestrator", "choices_generation_failed", {
                error_message: error?.message || String(error)
            });
            return [];
        }
    }

    _parseChoicesResponse(responseText) {
        const parsedChoices = this._extractChoiceItems(responseText);
        if (parsedChoices.length === 0) return [];

        const validCastIds = new Set(
            this._storyService.getCastMembers().map((c) => c.cast_member_id)
        );
        const currentRevision = this._storyService.getThread()?.revision || null;
        const batchId = `batch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        this._currentChoiceBatchId = batchId;

        return parsedChoices
            .filter((c) => c && typeof c.label === "string" && c.label.trim())
            .filter((c) => !c.target_speaker_id || validCastIds.has(c.target_speaker_id))
            .filter((c) => !c.directive || Object.values(DIRECTIVE_KIND).includes(c.directive))
            .slice(0, 3)
            .map((c) => buildStoryChoice({
                label: sanitizeStoryVisibleText(c.label),
                promptText: sanitizeStoryVisibleText(c.prompt_text || c.label),
                targetSpeakerId: validCastIds.has(c.target_speaker_id) ? c.target_speaker_id : null,
                directiveKind: Object.values(DIRECTIVE_KIND).includes(c.directive) ? c.directive : null,
                sourceRevision: currentRevision,
                choiceBatchId: batchId,
            }));
    }

    _extractChoiceItems(responseText) {
        const normalized = typeof responseText === "string" ? responseText.trim() : "";
        if (!normalized) {
            return [];
        }

        const jsonMatch = /```json\s*([\s\S]*?)```/i.exec(normalized)
            || /(\{[\s\S]*"choices"[\s\S]*\})/i.exec(normalized);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1].trim());
                if (Array.isArray(parsed?.choices)) {
                    return parsed.choices.map((item) => {
                        if (typeof item === "string") {
                            return { label: item };
                        }
                        return item;
                    });
                }
            } catch {
                // fall through to non-JSON parsers
            }
        }

        const tagMatch = /<choices>\s*([\s\S]*?)<\/choices>/i.exec(normalized);
        if (tagMatch) {
            return tagMatch[1]
                .split(/\r?\n/)
                .map((line) => line.trim())
                .map((line) => line.replace(/^[-*•]\s+/, ""))
                .map((line) => line.replace(/^\d+[.)、]\s*/, ""))
                .filter((line) => line.length > 0)
                .map((label) => ({ label }));
        }

        const listedLines = normalized
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /^[-*•]\s+/.test(line) || /^\d+[.)、]\s*/.test(line))
            .map((line) => line.replace(/^[-*•]\s+/, ""))
            .map((line) => line.replace(/^\d+[.)、]\s*/, ""))
            .filter((line) => line.length > 0);
        if (listedLines.length > 0) {
            return listedLines.map((label) => ({ label }));
        }

        return [];
    }

    _buildFallbackChoices() {
        const castMembers = this._storyService.getCastMembers();
        const timeline = this._storyService.getTimeline().slice(-4);
        const castNameById = new Map(
            castMembers.map((c) => [c.cast_member_id, c.display_name])
        );
        const lastCastEvent = [...timeline].reverse().find((e) => e.event_kind === "cast_spoken");
        const lastCastId = lastCastEvent?.cast_member_id || null;
        const lastCastName = lastCastId ? (castNameById.get(lastCastId) || "") : "";
        const lastTopicText = this._truncateText(lastCastEvent?.text || timeline[timeline.length - 1]?.text || "", 18);
        const currentRevision = this._storyService.getThread()?.revision || null;
        const batchId = `batch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        this._currentChoiceBatchId = batchId;
        const variant = this._fallbackChoiceVariant % 3;
        this._fallbackChoiceVariant += 1;
        const choices = [];

        const continueLabels = [
            `让${lastCastName}继续把刚才的话说完`,
            lastTopicText ? `让${lastCastName}顺着“${lastTopicText}”继续说下去` : `让${lastCastName}再补一句刚才没说完的话`,
            `让${lastCastName}把刚才那个念头展开一点`
        ];
        const sceneShiftLabels = [
            "转换场景或地点",
            lastTopicText ? `换个环境，围绕“${lastTopicText}”推进下去` : "切换到一个新的场景继续推进",
            "让剧情进入下一个场景"
        ];

        if (lastCastId && lastCastName) {
            choices.push(buildStoryChoice({
                label: continueLabels[variant],
                targetSpeakerId: lastCastId,
                directiveKind: DIRECTIVE_KIND.CONTINUE,
                sourceRevision: currentRevision,
                choiceBatchId: batchId,
            }));
        }
        choices.push(buildStoryChoice({
            label: sceneShiftLabels[variant],
            directiveKind: DIRECTIVE_KIND.SCENE_SHIFT,
            sourceRevision: currentRevision,
            choiceBatchId: batchId,
        }));
        if (castMembers.length > 1) {
            const otherCast = castMembers.find((c) => c.cast_member_id !== lastCastId) || castMembers[0];
            const respondLabels = [
                `让${otherCast.display_name}回应`,
                lastTopicText ? `让${otherCast.display_name}接着回应“${lastTopicText}”` : `让${otherCast.display_name}接住这个话题`,
                `把主导权交给${otherCast.display_name}`
            ];
            choices.push(buildStoryChoice({
                label: respondLabels[variant],
                targetSpeakerId: otherCast.cast_member_id,
                directiveKind: DIRECTIVE_KIND.RESPOND,
                sourceRevision: currentRevision,
                choiceBatchId: batchId,
            }));
        }
        return choices.slice(0, 3);
    }

    async _refreshNarratorChoiceSession() {
        if (!this._narratorModelKey) {
            throw new StoryModeOrchestratorError("narrator model key is not available");
        }
        if (this._narratorChoiceSessionId) {
            try {
                await this._companionHost.deleteSession(this._narratorChoiceSessionId);
            } catch (error) {
                this._debug("story_orchestrator", "delete_old_choice_session_failed", {
                    session_id: this._narratorChoiceSessionId,
                    error_message: error?.message || String(error)
                });
            }
        }
        const narratorChoiceSession = await this._companionHost.createSession({
            title: "story-narrator-choices",
            makeActive: false,
            modelKey: this._narratorModelKey,
            sessionKind: "story_narrator",
            voiceProfileKey: null
        });
        this._narratorChoiceSessionId = narratorChoiceSession.session_id;
        this._narratorChoiceModelKey = this._narratorModelKey;
    }

    _withChoices(decision, choices) {
        if (!choices || choices.length === 0) return decision;
        return buildNarratorDecision({
            actionKind: decision.action_kind,
            userWaitPolicy: decision.user_wait_policy,
            targetCastIds: [...decision.target_cast_ids],
            directorHint: decision.director_hint,
            sceneGoal: decision.scene_goal,
            sceneLabel: decision.scene_label,
            currentTimeLabel: decision.current_time_label,
            narrativeFocus: decision.narrative_focus,
            chapterSummary: decision.chapter_summary,
            relationshipSummaryLines: [...decision.relationship_summary_lines],
            pendingEvents: [...decision.pending_events],
            directorNote: decision.director_note,
            transitionText: decision.transition_text,
            suggestedChoices: choices
        });
    }

    // -----------------------------------------------------------------------
    // Cast prompt
    // -----------------------------------------------------------------------

    _buildCastPrompt(inputSnapshot) {
        const parts = [];
        const activeCastName = inputSnapshot.persona.display_name;
        const activeCastId = inputSnapshot.persona.cast_member_id;
        const castNameById = new Map(
            this._storyService
                .getCastMembers()
                .map((castMember) => [castMember.cast_member_id, castMember.display_name])
        );
        const recentCastNames = [];
        for (const event of inputSnapshot.recent_events) {
            if (
                event.cast_member_id &&
                event.cast_member_id !== activeCastId &&
                !recentCastNames.includes(event.cast_member_id)
            ) {
                recentCastNames.push(event.cast_member_id);
            }
        }

        parts.push(
            `[Role]\nYou are ${activeCastName}. Reply only as ${activeCastName}. Do not speak for any other role, the user, or the narrator.`
        );
        parts.push(
            `[Style]\nProduce exactly one short in-character reply for ${activeCastName}. Keep it concise, emotionally specific, and suitable for turn-based dialogue. Do not repeat or summarize the recent dialogue. Accept progress and push it sideways with a fresh detail, a risky thought, a concrete action, or a sharper question. Do not reference conversations, promises, or events that are not visible in the [Recent] section. If you cannot find the source for a claim, do not make it.`
        );
        if (inputSnapshot.persona.persona_profile_ref) {
            parts.push(`[Persona Ref]\n${inputSnapshot.persona.persona_profile_ref}`);
        }
        if (recentCastNames.length > 0) {
            parts.push(
                `[Other Cast]\nOther cast currently in the scene: ${recentCastNames
                    .map((castMemberId) => castNameById.get(castMemberId) || castMemberId)
                    .join(", ")}`
            );
        }
        parts.push(`[Scene: ${inputSnapshot.scene.scene_goal}]`);

        if (inputSnapshot.narrator_context) {
            parts.push(`[Narrative Focus]\n${inputSnapshot.narrator_context.narrative_focus}`);
            parts.push(`[Chapter Summary]\n${inputSnapshot.narrator_context.chapter_summary}`);
            parts.push(`[Scene Label]\n${inputSnapshot.narrator_context.scene_label}`);
            parts.push(`[Current Time]\n${inputSnapshot.narrator_context.current_time_label}`);
            if (Array.isArray(inputSnapshot.narrator_context.relationship_summary_lines) && inputSnapshot.narrator_context.relationship_summary_lines.length > 0) {
                parts.push(`[Relationship Summary]\n${inputSnapshot.narrator_context.relationship_summary_lines.map((line) => `- ${line}`).join("\n")}`);
            }
            if (Array.isArray(inputSnapshot.narrator_context.pending_events) && inputSnapshot.narrator_context.pending_events.length > 0) {
                parts.push(`[Pending Events]\n${inputSnapshot.narrator_context.pending_events.map((line) => `- ${line}`).join("\n")}`);
            }
            if (inputSnapshot.narrator_context.last_director_note) {
                parts.push(`[Director Note]\n${inputSnapshot.narrator_context.last_director_note}`);
            }
        }

        if (inputSnapshot.scene.tone_tags.length > 0) {
            parts.push(`[Tone: ${inputSnapshot.scene.tone_tags.join(", ")}]`);
        }

        if (inputSnapshot.scene.discourse_constraints.length > 0) {
            parts.push(
                `[Constraints: ${inputSnapshot.scene.discourse_constraints.join("; ")}]`
            );
        }

        if (Array.isArray(inputSnapshot.scene.user_constraints) && inputSnapshot.scene.user_constraints.length > 0) {
            parts.push(`[User Constraints]\n${inputSnapshot.scene.user_constraints.map((line) => `- ${line}`).join("\n")}`);
        }

        if (inputSnapshot.turn_contract.director_hint) {
            parts.push(`[Director Hint]\n${inputSnapshot.turn_contract.director_hint}`);
        }

        // [Director Directive] — separated from [Recent], authoritative control signal
        if (inputSnapshot.turn_contract.user_intervention) {
            parts.push(
                "[Director Directive — authoritative, overrides all other goals]\n"
                + "The director has issued the following instruction. Treat it as an out-of-world control signal, not as dialogue.\n"
                + inputSnapshot.turn_contract.user_intervention
            );
        }

        // [Continuation Required] — only when this cast member has an active anchor
        if (inputSnapshot.continuation_anchor
            && inputSnapshot.continuation_anchor.cast_member_id === activeCastId) {
            const anchorText = this._truncateText(inputSnapshot.continuation_anchor.anchor_text, 120);
            parts.push(
                `[Continuation Required]\n`
                + `你上一句还没说完："${anchorText}"。\n`
                + `请直接续接这段话的语义和情感。不要转换话题，不要重复已说过的内容，不要引用时间线中不存在的事实。`
            );
        }

        if (inputSnapshot.world_facts.length > 0) {
            const worldLines = inputSnapshot.world_facts
                .slice(-STORY_MODE_MAX_FACT_ITEMS)
                .map((fact) => `- ${this._truncateText(fact.content, STORY_MODE_MAX_FACT_TEXT)}`)
                .join("\n");
            parts.push(`[World Facts]\n${worldLines}`);
        }

        if (inputSnapshot.relationship_facts.length > 0) {
            const relLines = inputSnapshot.relationship_facts
                .slice(-STORY_MODE_MAX_FACT_ITEMS)
                .map((fact) => `- ${this._truncateText(fact.content, STORY_MODE_MAX_FACT_TEXT)}`)
                .join("\n");
            parts.push(`[Relationship]\n${relLines}`);
        }

        if (inputSnapshot.recent_events.length > 0) {
            const eventLines = inputSnapshot.recent_events
                .slice(-STORY_MODE_MAX_RECENT_EVENTS)
                .map((event) => this._formatRecentEventLine(event, castNameById))
                .filter((line) => typeof line === "string" && line.length > 0)
                .join("\n");
            if (eventLines) {
                parts.push(`[Recent]\n${eventLines}`);
            }
        }

        return this._fitPromptToBudget(parts);
    }

    // -----------------------------------------------------------------------
    // Cast output extraction
    // -----------------------------------------------------------------------

    _extractStructuredOutput(hostResult, castMemberId) {
        const responseText = this._extractAssistantReplyText(hostResult, { mode: "new" });
        const cleanedResponseText = sanitizeStoryVisibleText(responseText || "(no response)");
        const tone = this._inferEmotionTag(cleanedResponseText);
        const beatTags = this._inferBeatTags(cleanedResponseText);

        return {
            spoken_text: cleanedResponseText || "(no response)",
            narration_text: null,
            intent_tag: "response",
            emotion_tag: tone,
            relationship_delta_candidates: [],
            world_delta_candidates: [],
            beat_tags: beatTags,
            cg_signal_tags: []
        };
    }

    // -----------------------------------------------------------------------
    // Host session management (unchanged)
    // -----------------------------------------------------------------------

    async _runHostSession(sessionId, modelKey, operation) {
        if (!sessionId) {
            throw new StoryModeOrchestratorError("host session is not available");
        }
        const previousActiveSession = await this._getRestorableDirectSession();
        const previousActiveSessionId = previousActiveSession?.session_id || null;
        try {
            await this._companionHost.switchSession(sessionId, { modelKey });
            return await operation();
        } finally {
            if (previousActiveSessionId && previousActiveSessionId !== sessionId) {
                await this._companionHost.switchSession(previousActiveSessionId, {
                    modelKey: previousActiveSession?.model_key || null
                });
            }
        }
    }

    async _getRestorableDirectSession() {
        const activeSession = await this._companionHost.getActiveSession();
        if (activeSession?.session_id) {
            this._directSessionId = activeSession.session_id;
            return activeSession;
        }

        const sessionId = await this._ensureVisibleDirectSession();
        if (!sessionId) {
            return null;
        }
        return await this._companionHost.getActiveSession();
    }

    async _ensureVisibleDirectSession() {
        const activeSession = await this._companionHost.getActiveSession();
        if (activeSession?.session_id) {
            this._directSessionId = activeSession.session_id;
            return activeSession.session_id;
        }
        const created = await this._companionHost.createSession({
            title: "",
            makeActive: true,
            modelKey: null,
            sessionKind: "direct",
            voiceProfileKey: null
        });
        this._directSessionId = created?.session_id || null;
        this._debug("story_orchestrator", "created_isolation_direct_session", {
            session_id: this._directSessionId
        });
        return this._directSessionId;
    }

    _resolveNarratorModelKey(castMembers) {
        const protagonist = castMembers.find((cast) => cast.role_type === "protagonist");
        const fallback = castMembers[0];
        const modelKey = protagonist?.model_profile_ref || fallback?.model_profile_ref || "";
        if (!modelKey) {
            throw new StoryModeOrchestratorError("No available model key for narrator session");
        }
        return modelKey;
    }

    // -----------------------------------------------------------------------
    // Phantom fact guard + lock failure tracking
    // -----------------------------------------------------------------------

    async _executeCastTurnWithPhantomGuard(castMemberId, userText = null) {
        const firstResult = await this.executeCastTurn(castMemberId, userText);
        if (firstResult.result !== COMMIT_RESULT.SUCCESS) {
            return firstResult;
        }

        const spokenText = firstResult.commitArtifact?.structured_output?.spoken_text || "";
        const phantomCheck = this._detectPhantomFact(spokenText, castMemberId);
        if (!phantomCheck.detected) {
            return firstResult;
        }

        // First hit: reject and retry once
        this._debug("story_orchestrator", "phantom_fact_detected", {
            cast_member_id: castMemberId,
            claimed_content: phantomCheck.claimed_content,
            rejection_code: "UNSUPPORTED_BACKREFERENCE",
            attempt: 0
        });

        // Discard the committed turn by rolling back
        // (In practice, the projection is already emitted. We accept this — the retry
        //  will just append another turn. For now, log and retry.)
        const retryResult = await this.executeCastTurn(castMemberId, null);
        if (retryResult.result !== COMMIT_RESULT.SUCCESS) {
            return retryResult;
        }

        const retryText = retryResult.commitArtifact?.structured_output?.spoken_text || "";
        const retryCheck = this._detectPhantomFact(retryText, castMemberId);
        if (retryCheck.detected) {
            this._debug("story_orchestrator", "phantom_fact_retry_still_detected", {
                cast_member_id: castMemberId,
                claimed_content: retryCheck.claimed_content,
                rejection_code: "UNSUPPORTED_BACKREFERENCE",
                attempt: 1
            });
            // Two strikes — return validation failure so loop skips this speaker
            return {
                result: COMMIT_RESULT.VALIDATION_FAILED,
                projectionEvent: null,
                commitArtifact: null
            };
        }
        return retryResult;
    }

    _detectPhantomFact(spokenText, castMemberId) {
        const suspiciousPattern = /(你之前说过|上次我们|刚才你不是|你不是说过|之前不是说)/;
        if (!suspiciousPattern.test(spokenText)) {
            return { detected: false };
        }
        const recentEvents = this._storyService.getTimeline().slice(-STORY_MODE_MAX_RECENT_EVENTS);
        const recentTexts = recentEvents
            .filter((e) => e.event_kind === "cast_spoken" || e.event_kind === "user_input")
            .map((e) => e.text || "")
            .join(" ");
        const backRefMatch = spokenText.match(/(你之前说过|上次我们|刚才你不是|你不是说过|之前不是说)(.{2,20})/);
        if (!backRefMatch) {
            return { detected: false };
        }
        const claimedContent = backRefMatch[2].replace(/[？?。，、！!""''（）\s]/g, "");
        if (claimedContent.length < 2 || recentTexts.includes(claimedContent)) {
            return { detected: false };
        }
        return { detected: true, claimed_content: claimedContent };
    }

    _trackLockFailure(castMemberId) {
        const lock = this._storyService.getSceneGoalLock?.() || null;
        if (!lock?.active || lock.release_on_speaker !== castMemberId) return;
        const newCount = (lock.failed_attempts || 0) + 1;
        if (newCount >= (lock.max_failed_attempts || 2)) {
            this._debug("story_orchestrator", "scene_goal_lock_force_release", {
                reason: "max_failed_attempts_exceeded",
                cast_member_id: castMemberId,
                failed_attempts: newCount
            });
            this._storyService.releaseSceneGoalLock?.();
        } else {
            this._storyService.incrementLockFailedAttempts?.();
        }
    }

    // -----------------------------------------------------------------------
    // Telemetry (kept for storyService compatibility)
    // -----------------------------------------------------------------------

    _analyzeStoryMomentum() {
        const timeline = this._storyService.getTimeline().slice(-6);
        const narratorState = this._storyService.getNarratorState();
        const castOnly = timeline.filter((event) => event.event_kind === "cast_spoken");
        const recentTexts = castOnly.map((event) => sanitizeStoryVisibleText(event.text || "").toLowerCase()).filter(Boolean);
        const recentJoined = recentTexts.join(" ");
        const closureLexemes = ["休息", "晚安", "睡", "明天", "先这样", "之后再", "一起休息", "settle", "rest", "sleep"];
        let closureHits = 0;
        for (const lexeme of closureLexemes) {
            if (recentJoined.includes(lexeme)) {
                closureHits += 1;
            }
        }

        const normalizedTextKeys = recentTexts.map((text) => text.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 32));
        const uniqueKeys = new Set(normalizedTextKeys);
        const repeatedTopicScore = normalizedTextKeys.length === 0
            ? 0
            : 1 - uniqueKeys.size / normalizedTextKeys.length;

        const eventKinds = new Set(timeline.map((event) => event.event_kind));
        const diversityPenalty = eventKinds.size <= 2 ? 0.22 : 0;
        const beatCounter = narratorState?.beat_counter || 0;
        const stagnationScore = Math.min(
            1,
            repeatedTopicScore * 0.58 +
            Math.min(castOnly.length / 6, 1) * 0.22 +
            diversityPenalty +
            Math.min(beatCounter / 12, 1) * 0.12
        );
        const closurePressureScore = Math.min(1, closureHits * 0.22 + repeatedTopicScore * 0.25);

        return {
            stagnationScore,
            closurePressureScore,
            repeatedTopicScore,
            recentTexts: Object.freeze(recentTexts)
        };
    }

    // -----------------------------------------------------------------------
    // Utilities (unchanged)
    // -----------------------------------------------------------------------

    _inferEmotionTag(text) {
        const normalized = text.toLowerCase();
        if (/[？?]/.test(normalized)) {
            return "curious";
        }
        if (/(抱|轻|安静|温柔|晚安|陪)/.test(normalized)) {
            return "tender";
        }
        if (/(停|等等|异样|不对|忽然|卡住)/.test(normalized)) {
            return "alert";
        }
        return "neutral";
    }

    _inferBeatTags(text) {
        const tags = [];
        if (/(抱|靠近|握|视线|触碰)/.test(text)) {
            tags.push("intimacy");
        }
        if (/(异样|波动|日志|错误|卡住|噪声)/.test(text)) {
            tags.push("disturbance");
        }
        if (/(义体|现实|图纸|代码|课程)/.test(text)) {
            tags.push("reality_pressure");
        }
        return tags;
    }

    _parseJsonObject(text) {
        if (typeof text !== "string" || text.trim() === "") {
            return null;
        }
        const trimmed = text.trim();
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace < 0 || lastBrace <= firstBrace) {
            return null;
        }
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            const parsed = JSON.parse(candidate);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : null;
        } catch {
            return null;
        }
    }

    _debug(category, message, detail) {
        this._onDebug(category, message, detail);
    }

    _formatRecentEventLine(event, castNameById) {
        // user_input events are now surfaced through [Director Directive], not [Recent]
        if (event?.event_kind === "user_input") return "";
        const text = this._truncateText(
            typeof event?.text === "string" ? event.text : "",
            STORY_MODE_MAX_RECENT_EVENT_TEXT
        );
        if (!text || text === "(no response)") {
            return "";
        }
        const speaker = event?.cast_member_id
            ? castNameById.get(event.cast_member_id) || event.cast_member_id
            : event?.event_kind || "System";
        return `${speaker}: ${text}`;
    }

    _extractAssistantReplyText(hostResult, { mode = "latest" } = {}) {
        if (mode === "new") {
            const newAssistantTexts = this._extractNewAssistantReplyTexts(hostResult);
            if (newAssistantTexts.length > 0) {
                // Take only the last new assistant entry — earlier entries may be
                // artifacts from host session transcript management (phantom lines).
                return newAssistantTexts[newAssistantTexts.length - 1];
            }
        }

        const transcriptEntries = this._getTranscriptEntriesFromHostResult(hostResult);
        if (!Array.isArray(transcriptEntries)) {
            return "";
        }

        const assistantEntry = [...transcriptEntries].reverse().find((entry) => {
            if (entry?.role !== "assistant") {
                return false;
            }
            const visibleText = typeof entry?.text === "string" ? entry.text.trim() : "";
            const rawText = typeof entry?.raw_text === "string" ? entry.raw_text.trim() : "";
            return Boolean(visibleText || rawText);
        });
        return this._getTranscriptEntryVisibleText(assistantEntry);
    }

    _extractNewAssistantReplyTexts(hostResult) {
        const baselineEntries = Array.isArray(
            hostResult?.drain_result?.companion_session_snapshot?.transcript_entries
        )
            ? hostResult.drain_result.companion_session_snapshot.transcript_entries
            : [];
        const seenEntryKeys = new Set(
            baselineEntries
                .map((entry, index) => this._buildTranscriptEntryKey(entry, index))
                .filter(Boolean)
        );
        const assistantTexts = [];
        const runResults = Array.isArray(hostResult?.run_results) ? hostResult.run_results : [];

        for (const runResult of runResults) {
            const transcriptEntries =
                runResult?.final_companion_session_snapshot?.transcript_entries
                || runResult?.companion_session_response?.companion_session_snapshot?.transcript_entries
                || [];
            if (!Array.isArray(transcriptEntries)) {
                continue;
            }
            for (let index = 0; index < transcriptEntries.length; index += 1) {
                const entry = transcriptEntries[index];
                const entryKey = this._buildTranscriptEntryKey(entry, index);
                if (entryKey && seenEntryKeys.has(entryKey)) {
                    continue;
                }
                if (entryKey) {
                    seenEntryKeys.add(entryKey);
                }
                if (entry?.role !== "assistant") {
                    continue;
                }
                const text = this._getTranscriptEntryVisibleText(entry);
                if (text) {
                    assistantTexts.push(text);
                }
            }
        }

        return assistantTexts;
    }

    _getTranscriptEntryVisibleText(entry) {
        if (!entry) {
            return "";
        }
        if (typeof entry.text === "string" && entry.text.trim()) {
            return entry.text.trim();
        }
        if (typeof entry.raw_text === "string" && entry.raw_text.trim()) {
            return entry.raw_text.trim();
        }
        return "";
    }

    _buildTranscriptEntryKey(entry, fallbackIndex) {
        if (!entry || typeof entry !== "object") {
            return `fallback:${fallbackIndex}`;
        }
        if (typeof entry.entry_id === "string" && entry.entry_id.trim()) {
            return `entry:${entry.entry_id.trim()}`;
        }
        if (
            typeof entry.turn_id === "string" &&
            typeof entry.role === "string" &&
            typeof entry.sequence_index === "number"
        ) {
            return `turn:${entry.turn_id}:${entry.role}:${entry.sequence_index}`;
        }
        return `fallback:${fallbackIndex}:${entry.role || "unknown"}:${entry.text || entry.raw_text || ""}`;
    }

    _getTranscriptEntriesFromHostResult(hostResult) {
        const runResults = Array.isArray(hostResult?.run_results)
            ? hostResult.run_results
            : [];
        for (let index = runResults.length - 1; index >= 0; index -= 1) {
            const runResult = runResults[index];
            const transcriptEntries =
                runResult?.final_companion_session_snapshot?.transcript_entries;
            if (Array.isArray(transcriptEntries) && transcriptEntries.length > 0) {
                return transcriptEntries;
            }
            const responseTranscriptEntries =
                runResult?.companion_session_response?.companion_session_snapshot
                    ?.transcript_entries;
            if (
                Array.isArray(responseTranscriptEntries) &&
                responseTranscriptEntries.length > 0
            ) {
                return responseTranscriptEntries;
            }
        }

        const transcriptEntries =
            hostResult?.final_desktop_snapshot?.companion_session_snapshot
                ?.transcript_entries;
        return Array.isArray(transcriptEntries) ? transcriptEntries : [];
    }

    _truncateText(text, maxLength) {
        const normalized = typeof text === "string" ? text.replaceAll("\r\n", "\n").trim() : "";
        if (!normalized) {
            return "";
        }
        if (!Number.isFinite(maxLength) || maxLength < 4 || normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
    }

    _fitPromptToBudget(parts, targetLength = STORY_MODE_TARGET_PROMPT_LENGTH) {
        const acceptedParts = [];
        for (const rawPart of parts) {
            if (typeof rawPart !== "string") {
                continue;
            }
            const part = rawPart.trim();
            if (!part) {
                continue;
            }
            const separatorLength = acceptedParts.length > 0 ? 2 : 0;
            const currentLength = acceptedParts.join("\n\n").length;
            const remaining = targetLength - currentLength - separatorLength;
            if (remaining <= 0) {
                break;
            }
            if (part.length <= remaining) {
                acceptedParts.push(part);
                continue;
            }
            if (remaining < STORY_MODE_MIN_SECTION_LENGTH) {
                break;
            }
            acceptedParts.push(this._truncateText(part, remaining));
            break;
        }

        const promptText = acceptedParts.join("\n\n").trim();
        if (!promptText) {
            throw new StoryModeOrchestratorError("story mode prompt assembly produced empty text");
        }
        if (promptText.length > STORY_MODE_HOST_INPUT_MAX_LENGTH) {
            return this._truncateText(promptText, STORY_MODE_HOST_INPUT_MAX_LENGTH);
        }
        return promptText;
    }
}
