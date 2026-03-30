// ---------------------------------------------------------------------------
// Story Mode Orchestrator — Phase 2
// Narrator-first story orchestration with stagnation breaking, scene steering,
// optional player choices, and cast-session execution through the companion host.
// ---------------------------------------------------------------------------

import { COMMIT_RESULT } from "../shared/turn_commit_coordinator.mjs";
import { DIRECTOR_USER_WAIT_POLICY } from "../shared/story_thread_contracts.mjs";
import {
    NARRATOR_ACTION_KIND,
    buildNarratorDecision,
    buildStoryChoice
} from "../shared/story_narrator_contracts.mjs";
import { sanitizeStoryVisibleText } from "../shared/story_visible_text.mjs";

const STORY_MODE_HOST_INPUT_MAX_LENGTH = 4000;
const STORY_MODE_TARGET_PROMPT_LENGTH = 3600;
const STORY_MODE_MAX_RECENT_EVENTS = 8;
const STORY_MODE_MAX_RECENT_EVENT_TEXT = 180;
const STORY_MODE_MAX_FACT_ITEMS = 6;
const STORY_MODE_MAX_FACT_TEXT = 180;
const STORY_MODE_MIN_SECTION_LENGTH = 48;
const STORY_MODE_MAX_CAST_CHAIN = 8;
const STORY_MODE_CHOICE_INTERVAL_BEATS = 6;
const STORY_MODE_CHOICE_PROBABILITY = 0.18;
const STORY_MODE_YIELD_MIN_LOOP_COUNT = 4;
const STORY_MODE_YIELD_MIN_BEAT = 6;
const STORY_MODE_YIELD_BEAT_INTERVAL = 6;
const STORY_MODE_CHOICE_LABEL_MAX_LENGTH = 300;
const STORY_MODE_CHOICE_PROMPT_MAX_LENGTH = 500;
const STORY_MODE_CHOICE_RATIONALE_MAX_LENGTH = 500;
const STORY_MODE_SCENE_DOMAIN = Object.freeze({
    SCHOOL: "school",
    WORK: "work",
    HOME: "home",
    STREET: "street",
    GENERIC: "generic"
});

export class StoryModeOrchestratorError extends Error {
    constructor(message) {
        super(message);
        this.name = "StoryModeOrchestratorError";
    }
}

export class StoryModeOrchestrator {
    constructor({ storyService, companionHost, onBeforeCastTurn, onNarratorEvents, onDebug }) {
        this._storyService = storyService;
        this._companionHost = companionHost;
        this._onBeforeCastTurn = onBeforeCastTurn || (async () => { });
        this._onNarratorEvents = onNarratorEvents || (async () => { });
        this._onDebug = onDebug || (() => { });
        this._hostSessionIds = new Map();
        this._castModelKeys = new Map();
        this._narratorSessionId = null;
        this._narratorModelKey = null;
        this._directSessionId = null;
        this._activeRunPromise = null;
        this._stopRequested = false;
        this._runId = 0;
        this._lastErrorMessage = null;
        this._running = false;
        this._recentSuggestedChoiceSets = [];
        this._recentTransitionLeads = [];
    }

    async bindAllCastSessions(castMembers) {
        this._hostSessionIds.clear();
        this._castModelKeys.clear();
        this._recentSuggestedChoiceSets = [];
        this._recentTransitionLeads = [];

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

        this._narratorSessionId = null;
        this._narratorModelKey = this._resolveNarratorModelKey(castMembers);
        this._directSessionId = await this._ensureVisibleDirectSession();
    }

    async executeUserTurn(text, cueTarget = null) {
        const { projectionEvent } = this._storyService.submitUserTurn(text, cueTarget);
        this._debug("story_orchestrator", "user_turn", {
            revision: this._storyService.getThread().revision,
            cue_target: cueTarget
        });
        return { userEvent: projectionEvent };
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

        return commitResult;
    }

    async runStoryTurn(text, cueTarget = null) {
        if (this._running) {
            throw new StoryModeOrchestratorError(
                "story mode orchestrator is already running"
            );
        }
        this._running = true;
        this._stopRequested = false;
        this._lastErrorMessage = null;
        try {
            return await this._runStoryTurnLoop(text, cueTarget);
        } catch (error) {
            this._lastErrorMessage = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            this._running = false;
            this._stopRequested = false;
        }
    }

    async startStoryTurn(text, cueTarget = null) {
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

        const runPromise = this._runStoryTurnLoop(normalizedText, cueTarget)
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

    async _runStoryTurnLoop(text, cueTarget = null) {
        const castResults = [];
        const narratorDecisions = [];
        const { userEvent } = await this.executeUserTurn(text, cueTarget);
        let forcedYieldEmitted = false;

        const initialDecision = await this._executeNarratorTurn(text, true, 0);
        narratorDecisions.push(initialDecision);

        if (initialDecision.action_kind === NARRATOR_ACTION_KIND.YIELD_TO_USER) {
            return { userEvent, castResults, narratorDecisions };
        }

        let loopCount = 0;
        while (!this._stopRequested && loopCount < STORY_MODE_MAX_CAST_CHAIN) {
            const nextAction = this._storyService.decideNextAction();
            if (!nextAction || !nextAction.plan) {
                if (!this._stopRequested) {
                    const forcedYieldDecision = await this._executeNarratorTurn(null, false, loopCount, {
                        forceYieldToUser: true,
                        forceReason: "no_next_action"
                    });
                    narratorDecisions.push(forcedYieldDecision);
                    forcedYieldEmitted = true;
                }
                break;
            }
            const nextCastId = nextAction.plan.turn_queue[0].cast_member_id;
            const nextResult = await this.executeCastTurn(nextCastId, loopCount === 0 ? text : null);
            castResults.push(nextResult);
            if (nextResult.result !== COMMIT_RESULT.SUCCESS) {
                break;
            }
            loopCount += 1;

            const narratorDecision = await this._executeNarratorTurn(null, false, loopCount);
            narratorDecisions.push(narratorDecision);
            if (narratorDecision.user_wait_policy !== DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN) {
                break;
            }
        }

        if (!this._stopRequested && !forcedYieldEmitted && loopCount >= STORY_MODE_MAX_CAST_CHAIN) {
            const forcedYieldDecision = await this._executeNarratorTurn(null, false, loopCount, {
                forceYieldToUser: true,
                forceReason: "chain_limit"
            });
            narratorDecisions.push(forcedYieldDecision);
        }

        return { userEvent, castResults, narratorDecisions };
    }

    async _executeNarratorTurn(userText, isInitialTurn, loopCount, options = {}) {
        const telemetry = this._analyzeStoryMomentum();
        this._storyService.updateNarratorTelemetry(telemetry);
        const decision = this._buildHeuristicNarratorDecision({
            userText,
            telemetry,
            isInitialTurn,
            loopCount,
            forceYieldToUser: options.forceYieldToUser === true,
            forceReason: options.forceReason || null
        });
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

    _buildHeuristicNarratorDecision({ userText, telemetry, isInitialTurn, loopCount, forceYieldToUser = false, forceReason = null }) {
        const castMembers = this._storyService.getCastMembers();
        const narratorState = this._storyService.getNarratorState();
        const currentSceneGoal = this._storyService.getSceneCard()?.scene_goal || narratorState?.scene_goal || "";
        const context = this._collectNarrativeContext(narratorState, currentSceneGoal, userText);
        const beatCounter = narratorState?.beat_counter || 0;
        const shouldBreakStagnation = telemetry.stagnationScore >= 0.68 || telemetry.closurePressureScore >= 0.72;
        const shouldTransitionScene = !isInitialTurn && !shouldBreakStagnation && beatCounter > 0 && beatCounter % 5 === 0;
        const shouldYieldToUser =
            forceYieldToUser ||
            !isInitialTurn &&
            !shouldBreakStagnation &&
            !shouldTransitionScene &&
            loopCount >= STORY_MODE_YIELD_MIN_LOOP_COUNT &&
            beatCounter >= STORY_MODE_YIELD_MIN_BEAT &&
            beatCounter % STORY_MODE_YIELD_BEAT_INTERVAL === 0 &&
            telemetry.closurePressureScore >= 0.44;

        let actionKind = NARRATOR_ACTION_KIND.CAST_TURN;
        if (shouldBreakStagnation) {
            actionKind = NARRATOR_ACTION_KIND.INJECT_EVENT;
        } else if (shouldTransitionScene) {
            actionKind = NARRATOR_ACTION_KIND.SCENE_TRANSITION;
        } else if (shouldYieldToUser) {
            actionKind = NARRATOR_ACTION_KIND.YIELD_TO_USER;
        }

        const progression = this._buildSceneProgression({
            actionKind,
            narratorState,
            currentSceneGoal,
            telemetry,
            context,
            isInitialTurn
        });
        const suggestedChoices = actionKind === NARRATOR_ACTION_KIND.YIELD_TO_USER
            ? this._buildFallbackChoices(narratorState, progression.sceneGoal, context)
            : [];

        return buildNarratorDecision({
            actionKind,
            userWaitPolicy: actionKind === NARRATOR_ACTION_KIND.YIELD_TO_USER
                ? DIRECTOR_USER_WAIT_POLICY.YIELD_TO_USER
                : DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN,
            targetCastIds: castMembers.map((cast) => cast.cast_member_id),
            directorHint: sanitizeStoryVisibleText(
                forceYieldToUser
                    ? this._buildForcedYieldHint(forceReason, narratorState, currentSceneGoal)
                    : this._buildDirectorHint({ actionKind, telemetry, narratorState })
            ),
            sceneGoal: progression.sceneGoal,
            sceneLabel: progression.sceneLabel,
            currentTimeLabel: progression.currentTimeLabel,
            narrativeFocus: progression.narrativeFocus,
            chapterSummary: progression.chapterSummary,
            relationshipSummaryLines: this._normalizeNarratorLines(
                narratorState?.relationship_summary_lines || [],
                narratorState?.relationship_summary_lines || []
            ),
            pendingEvents: progression.pendingEvents,
            directorNote: progression.directorNote,
            transitionText: progression.transitionText,
            suggestedChoices
        });
    }

    _buildForcedYieldHint(forceReason, narratorState, currentSceneGoal) {
        const focus = narratorState?.narrative_focus || currentSceneGoal || "当前局面";
        if (forceReason === "chain_limit") {
            return `这一轮自动推进已经把${focus}推到了新的节点，现在必须让用户决定接下来往哪里走。`;
        }
        return `当前没有稳定的下一位说话者可继续推进，应该让用户直接决定${focus}接下来怎么展开。`;
    }

    _buildNarratorPrompt({ userText, telemetry, isInitialTurn }) {
        const thread = this._storyService.getThread();
        const scene = this._storyService.getSceneCard();
        const narratorState = this._storyService.getNarratorState();
        const castMembers = this._storyService.getCastMembers();
        const timeline = this._storyService.getTimeline().slice(-STORY_MODE_MAX_RECENT_EVENTS);
        const recentLines = timeline
            .map((event) => {
                const speaker = event.cast_member_id
                    ? castMembers.find((cast) => cast.cast_member_id === event.cast_member_id)?.display_name || event.cast_member_id
                    : event.event_kind === "user_input"
                        ? "User"
                        : event.event_kind;
                return `- ${speaker}: ${this._truncateText(event.text, STORY_MODE_MAX_RECENT_EVENT_TEXT)}`;
            })
            .join("\n");
        const castLines = castMembers
            .map((cast) => `- ${cast.cast_member_id}: ${cast.display_name} (${cast.role_type})`)
            .join("\n");
        const stateLines = narratorState
            ? [
                `[Narrative Focus]\n${narratorState.narrative_focus}`,
                `[Chapter Summary]\n${narratorState.chapter_summary}`,
                `[Scene Label]\n${narratorState.scene_label}`,
                `[Current Time]\n${narratorState.current_time_label}`,
                narratorState.relationship_summary_lines.length > 0
                    ? `[Relationship Summary]\n${narratorState.relationship_summary_lines.map((line) => `- ${line}`).join("\n")}`
                    : "",
                narratorState.pending_events.length > 0
                    ? `[Pending Events]\n${narratorState.pending_events.map((line) => `- ${line}`).join("\n")}`
                    : "",
                narratorState.last_director_note
                    ? `[Last Director Note]\n${narratorState.last_director_note}`
                    : ""
            ].filter(Boolean)
            : [];

        const parts = [
            "[Role]\nYou are the story narrator and beat director. You never speak as a cast member. You decide how to keep the scene emotionally rich, surprising, and coherent.",
            "[Output Contract]\nReturn exactly one JSON object with keys: action_kind, user_wait_policy, target_cast_ids, director_hint, scene_goal, scene_label, current_time_label, narrative_focus, chapter_summary, relationship_summary_lines, pending_events, director_note, transition_text, suggested_choices.",
            "[Action Rules]\naction_kind must be one of cast_turn, inject_event, scene_transition, yield_to_user. Use inject_event or scene_transition whenever the scene is flattening out, becoming too predictable, or repeatedly closing toward rest/comfort without new stakes.",
            "[Choice Rules]\nSuggested choices are optional. Only include 2-3 choices when the player would benefit from a meaningful fork or re-entry point. Leave suggested_choices as [] otherwise.",
            `[Thread]\n${thread.title} · rev ${thread.revision}`,
            `[Scene Goal]\n${scene.scene_goal}`,
            `[Cast]\n${castLines}`,
            `[Momentum]\nstagnation_score=${telemetry.stagnationScore.toFixed(2)}\nclosure_pressure_score=${telemetry.closurePressureScore.toFixed(2)}\nrepeated_topic_score=${telemetry.repeatedTopicScore.toFixed(2)}`,
            ...stateLines
        ];

        if (recentLines) {
            parts.push(`[Recent]\n${recentLines}`);
        }
        if (isInitialTurn && typeof userText === "string" && userText.trim() !== "") {
            parts.push(`[Latest User Input]\n${userText.trim()}`);
        }
        parts.push("[Narrator Goal]\nPreserve tenderness when it fits, but resist easy closure. Introduce a fresh pressure, reveal, interruption, sensory cue, memory shard, technical complication, or choice whenever the interaction starts collapsing toward a predictable rest state.");

        return this._fitPromptToBudget(parts);
    }

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
            `[Style]\nProduce exactly one short in-character reply for ${activeCastName}. Keep it concise, emotionally specific, and suitable for turn-based dialogue. Do not repeat or summarize the recent dialogue. Accept progress and push it sideways with a fresh detail, a risky thought, a concrete action, or a sharper question.`
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

        if (inputSnapshot.turn_contract.user_intervention) {
            parts.push("[User Intervention Rule]\nTreat the latest user intervention as authoritative scene control or world-state change. Do not quote it back as if a visible character literally said it aloud. If it conflicts with the previous trajectory, abandon the previous trajectory.");
            parts.push(`[Latest User Intervention]\n${inputSnapshot.turn_contract.user_intervention}`);
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

        if (inputSnapshot.turn_contract.user_intervention) {
            parts.push(`[User]\n${inputSnapshot.turn_contract.user_intervention}`);
        }

        return this._fitPromptToBudget(parts);
    }

    _extractStructuredOutput(hostResult, castMemberId) {
        const responseText = this._extractAssistantReplyText(hostResult);
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

    _extractNarratorDecision(hostResult, telemetry, isInitialTurn) {
        const responseText = this._extractAssistantReplyText(hostResult);
        const parsedJson = this._parseJsonObject(responseText);
        const castMembers = this._storyService.getCastMembers();
        const narratorState = this._storyService.getNarratorState();
        const currentSceneGoal = this._storyService.getSceneCard()?.scene_goal || narratorState?.scene_goal || "";
        const context = this._collectNarrativeContext(narratorState, currentSceneGoal, null);
        const validCastIds = new Set(castMembers.map((cast) => cast.cast_member_id));
        const preferredCastIds = Array.isArray(parsedJson?.target_cast_ids)
            ? parsedJson.target_cast_ids.filter((value) => validCastIds.has(String(value).trim().toLowerCase()))
            : [];

        const shouldBreakStagnation = telemetry.stagnationScore >= 0.68 || telemetry.closurePressureScore >= 0.72;
        const fallbackAction = shouldBreakStagnation
            ? NARRATOR_ACTION_KIND.INJECT_EVENT
            : NARRATOR_ACTION_KIND.CAST_TURN;
        const actionKind = Object.values(NARRATOR_ACTION_KIND).includes(parsedJson?.action_kind)
            ? parsedJson.action_kind
            : fallbackAction;
        const userWaitPolicy = Object.values(DIRECTOR_USER_WAIT_POLICY).includes(parsedJson?.user_wait_policy)
            ? parsedJson.user_wait_policy
            : (actionKind === NARRATOR_ACTION_KIND.YIELD_TO_USER
                ? DIRECTOR_USER_WAIT_POLICY.YIELD_TO_USER
                : DIRECTOR_USER_WAIT_POLICY.CONTINUE_CHAIN);
        const injectedEvent = this._buildInjectedEventText({ telemetry, narratorState, isInitialTurn });
        const transitionText = actionKind === NARRATOR_ACTION_KIND.SCENE_TRANSITION
            ? sanitizeStoryVisibleText(parsedJson?.transition_text || this._buildTransitionText(narratorState, currentSceneGoal))
            : null;
        const directorNote = actionKind === NARRATOR_ACTION_KIND.INJECT_EVENT
            ? sanitizeStoryVisibleText(parsedJson?.director_note || injectedEvent)
            : sanitizeStoryVisibleText(parsedJson?.director_note || "");
        const suggestedChoices = this._normalizeSuggestedChoices(parsedJson?.suggested_choices, narratorState, currentSceneGoal);

        return buildNarratorDecision({
            actionKind,
            userWaitPolicy,
            targetCastIds: preferredCastIds.length > 0 ? preferredCastIds : castMembers.map((cast) => cast.cast_member_id),
            directorHint: sanitizeStoryVisibleText(
                parsedJson?.director_hint || this._buildDirectorHint({ actionKind, telemetry, narratorState })
            ),
            sceneGoal: sanitizeStoryVisibleText(parsedJson?.scene_goal || currentSceneGoal || narratorState?.scene_goal || "继续推进关系并制造新张力。"),
            sceneLabel: sanitizeStoryVisibleText(parsedJson?.scene_label || narratorState?.scene_label || currentSceneGoal || "当前场景"),
            currentTimeLabel: sanitizeStoryVisibleText(parsedJson?.current_time_label || narratorState?.current_time_label || "永恒之夜"),
            narrativeFocus: sanitizeStoryVisibleText(parsedJson?.narrative_focus || this._buildNarrativeFocus(telemetry, narratorState, currentSceneGoal, context)),
            chapterSummary: sanitizeStoryVisibleText(parsedJson?.chapter_summary || this._buildChapterSummary(narratorState, currentSceneGoal, context)),
            relationshipSummaryLines: this._normalizeNarratorLines(parsedJson?.relationship_summary_lines, narratorState?.relationship_summary_lines || []),
            pendingEvents: this._normalizeNarratorLines(parsedJson?.pending_events, this._mergePendingEvents(narratorState?.pending_events || [], telemetry, currentSceneGoal, context)),
            directorNote: directorNote || null,
            transitionText,
            suggestedChoices
        });
    }

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

    _collectNarrativeContext(narratorState, currentSceneGoal, userText = null) {
        const castMembers = this._storyService.getCastMembers();
        const timeline = this._storyService.getTimeline().slice(-10);
        const castNames = castMembers
            .map((cast) => sanitizeStoryVisibleText(cast.display_name || ""))
            .filter(Boolean);
        const pairLabel = castNames.length >= 2
            ? `${castNames[0]}和${castNames[1]}`
            : (castNames[0] || "她们");
        const normalizedEvents = timeline.map((event) => ({
            eventKind: event?.event_kind || "",
            text: sanitizeStoryVisibleText(event?.text || ""),
            castMemberId: event?.cast_member_id || null
        }));
        const castEvents = normalizedEvents.filter((event) => event.eventKind === "cast_spoken" && event.text);
        const userEvents = normalizedEvents.filter((event) => event.eventKind === "user_input" && event.text);
        const recentNarratorTexts = normalizedEvents
            .filter((event) => event.eventKind === "director_note" || event.eventKind === "scene_transition")
            .map((event) => event.text)
            .filter(Boolean)
            .slice(-4);
        const latestCastText = castEvents.length > 0 ? castEvents[castEvents.length - 1].text : "";
        const previousCastText = castEvents.length > 1 ? castEvents[castEvents.length - 2].text : "";
        const latestUserText = typeof userText === "string" && userText.trim() !== ""
            ? sanitizeStoryVisibleText(userText)
            : (userEvents.length > 0 ? userEvents[userEvents.length - 1].text : "");
        const recentCastTexts = castEvents.map((event) => event.text).filter(Boolean).slice(-4);
        const scopeText = [
            narratorState?.scene_label || "",
            currentSceneGoal || "",
            narratorState?.current_time_label || "",
            latestUserText,
            ...recentCastTexts
        ].join(" ");
        const dialogueText = [latestUserText, ...recentCastTexts].join(" ");
        const sceneDomain = this._inferSceneDomain(scopeText);
        const timeBucket = this._inferTimeBucket(scopeText);
        const closureSignal = /(晚安|睡|休息|先这样|明天|明早|之后再|回去|走吧|该走了|不早了|下次再|明天见)/.test(dialogueText);
        const intimacySignal = /(抱|靠近|靠着|牵|握|肩|相拥|脸红|亲|贴近|依偎|陪我|别走|一起睡)/.test(dialogueText);
        const musicSignal = /(歌|曲|旋律|耳机|demo|新曲|唱|副歌|和声|音轨|听完)/.test(dialogueText);
        const taskSignal = /(工作|项目|稿|图|提案|会议|总监|老师|作业|上课|练习|比赛|活动|报名|值日|企划)/.test(dialogueText);
        const weatherSignal = /(雨|伞|风|降温|雷|天色|夜风|雪)/.test(dialogueText);
        const primaryPendingEvent = Array.isArray(narratorState?.pending_events) && narratorState.pending_events.length > 0
            ? narratorState.pending_events[0]
            : "";
        const latestQuestionText = [...castEvents, ...userEvents]
            .reverse()
            .find((event) => /[？?]/.test(event.text))
            ?.text || "";
        return Object.freeze({
            castNames: Object.freeze(castNames),
            pairLabel,
            recentCastTexts: Object.freeze(recentCastTexts),
            latestCastText,
            previousCastText,
            latestUserText,
            latestQuestionText,
            recentNarratorTexts: Object.freeze(recentNarratorTexts),
            sceneDomain,
            timeBucket,
            closureSignal,
            intimacySignal,
            musicSignal,
            taskSignal,
            weatherSignal,
            primaryPendingEvent,
            scopeText
        });
    }

    _inferSceneDomain(text) {
        const normalized = String(text || "").toLowerCase();
        if (/(学校|教室|校门|社团|操场|走廊|天台|上学|放学|课堂)/.test(normalized)) {
            return STORY_MODE_SCENE_DOMAIN.SCHOOL;
        }
        if (/(公司|办公室|工位|会议室|茶水间|总监|加班|电梯|企划|部门)/.test(normalized)) {
            return STORY_MODE_SCENE_DOMAIN.WORK;
        }
        if (/(家里|房间|卧室|客厅|厨房|床边|沙发|阳台|洗手间)/.test(normalized)) {
            return STORY_MODE_SCENE_DOMAIN.HOME;
        }
        if (/(便利店|车站|路口|街|公园|咖啡|河边|商场|楼下|门口)/.test(normalized)) {
            return STORY_MODE_SCENE_DOMAIN.STREET;
        }
        return STORY_MODE_SCENE_DOMAIN.GENERIC;
    }

    _inferTimeBucket(text) {
        const normalized = String(text || "").toLowerCase();
        if (/(清晨|早上|早晨|晨光|晨间)/.test(normalized)) {
            return "morning";
        }
        if (/(中午|午休|午后|正午)/.test(normalized)) {
            return "noon";
        }
        if (/(傍晚|黄昏|放学后|下班后)/.test(normalized)) {
            return "dusk";
        }
        if (/(深夜|凌晨|夜深|晚安|不早了)/.test(normalized)) {
            return "late_night";
        }
        if (/(晚上|夜里|夜晚)/.test(normalized)) {
            return "night";
        }
        return "unspecified";
    }

    _buildRotationKey(text) {
        return sanitizeStoryVisibleText(String(text || ""))
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, "")
            .slice(0, 80);
    }

    _pickRotatingItem(candidates, seed = 0, recentTexts = [], key = null) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return null;
        }
        const recentKeys = new Set(
            recentTexts
                .map((text) => this._buildRotationKey(text))
                .filter(Boolean)
        );
        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[(seed + index) % candidates.length];
            const compareText = key ? candidate?.[key] : candidate;
            if (!recentKeys.has(this._buildRotationKey(compareText))) {
                return candidate;
            }
        }
        return candidates[seed % candidates.length];
    }

    _dedupeLines(lines, maxLength = 4) {
        const accepted = [];
        const seen = new Set();
        for (const line of lines) {
            const normalized = sanitizeStoryVisibleText(String(line || ""));
            if (!normalized) {
                continue;
            }
            const key = this._buildRotationKey(normalized);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            accepted.push(normalized);
            if (accepted.length >= maxLength) {
                break;
            }
        }
        return accepted;
    }

    _buildSceneProgression({ actionKind, narratorState, currentSceneGoal, telemetry, context, isInitialTurn }) {
        const baseSceneGoal = sanitizeStoryVisibleText(currentSceneGoal || narratorState?.scene_goal || "继续推进关系并制造新张力。");
        const baseSceneLabel = sanitizeStoryVisibleText(narratorState?.scene_label || currentSceneGoal || "当前场景");
        const baseTimeLabel = sanitizeStoryVisibleText(narratorState?.current_time_label || "永恒之夜");
        const baseFocus = sanitizeStoryVisibleText(
            this._buildNarrativeFocus(telemetry, narratorState, currentSceneGoal, context)
        );
        const baseChapterSummary = sanitizeStoryVisibleText(
            this._buildChapterSummary(narratorState, currentSceneGoal, context, baseFocus)
        );
        const basePendingEvents = this._mergePendingEvents(
            narratorState?.pending_events || [],
            telemetry,
            baseSceneGoal,
            context
        );
        const baseProgression = {
            sceneGoal: baseSceneGoal,
            sceneLabel: baseSceneLabel,
            currentTimeLabel: baseTimeLabel,
            narrativeFocus: baseFocus,
            chapterSummary: baseChapterSummary,
            pendingEvents: basePendingEvents,
            directorNote: null,
            transitionText: null
        };

        if (actionKind === NARRATOR_ACTION_KIND.INJECT_EVENT) {
            const eventBeat = this._buildInjectedEventBeat(context, narratorState, baseSceneGoal, isInitialTurn);
            return {
                sceneGoal: sanitizeStoryVisibleText(eventBeat.sceneGoal || baseProgression.sceneGoal),
                sceneLabel: baseProgression.sceneLabel,
                currentTimeLabel: baseProgression.currentTimeLabel,
                narrativeFocus: sanitizeStoryVisibleText(eventBeat.narrativeFocus || baseProgression.narrativeFocus),
                chapterSummary: sanitizeStoryVisibleText(eventBeat.chapterSummary || eventBeat.sceneGoal || baseProgression.chapterSummary),
                pendingEvents: Array.isArray(eventBeat.pendingEventsOverride)
                    ? this._dedupeLines(eventBeat.pendingEventsOverride, 4)
                    : this._mergePendingEvents(
                        narratorState?.pending_events || [],
                        telemetry,
                        eventBeat.sceneGoal || baseProgression.sceneGoal,
                        context,
                        eventBeat.pendingEvents || []
                    ),
                directorNote: sanitizeStoryVisibleText(eventBeat.text || "") || null,
                transitionText: null
            };
        }

        if (actionKind === NARRATOR_ACTION_KIND.SCENE_TRANSITION) {
            const transitionBeat = this._buildSceneTransitionBeat(context, narratorState, baseSceneGoal);
            return {
                sceneGoal: sanitizeStoryVisibleText(transitionBeat.sceneGoal || baseProgression.sceneGoal),
                sceneLabel: sanitizeStoryVisibleText(transitionBeat.sceneLabel || baseProgression.sceneLabel),
                currentTimeLabel: sanitizeStoryVisibleText(transitionBeat.currentTimeLabel || baseProgression.currentTimeLabel),
                narrativeFocus: sanitizeStoryVisibleText(transitionBeat.narrativeFocus || baseProgression.narrativeFocus),
                chapterSummary: sanitizeStoryVisibleText(transitionBeat.chapterSummary || transitionBeat.sceneGoal || baseProgression.chapterSummary),
                pendingEvents: Array.isArray(transitionBeat.pendingEventsOverride)
                    ? this._dedupeLines(transitionBeat.pendingEventsOverride, 4)
                    : this._mergePendingEvents(
                        narratorState?.pending_events || [],
                        telemetry,
                        transitionBeat.sceneGoal || baseProgression.sceneGoal,
                        context,
                        transitionBeat.pendingEvents || []
                    ),
                directorNote: null,
                transitionText: sanitizeStoryVisibleText(transitionBeat.text || "") || null
            };
        }

        return baseProgression;
    }

    _buildInjectedEventBeat(context, narratorState, currentSceneGoal, isInitialTurn) {
        const existingPendingEvents = Array.isArray(narratorState?.pending_events)
            ? narratorState.pending_events
            : [];
        if (existingPendingEvents.length > 0) {
            const pendingEvent = existingPendingEvents[0];
            return {
                text: `就在这时，${pendingEvent}这件事真的落到了眼前，谁也没法再把它继续留到“之后再说”。`,
                sceneGoal: `接住已经落地的${pendingEvent}`,
                narrativeFocus: "让角色立刻在眼前的情绪和新落下的事件之间做选择。",
                chapterSummary: `${pendingEvent}把场面从原地推开了。`,
                pendingEventsOverride: existingPendingEvents.slice(1)
            };
        }

        const seed = (narratorState?.beat_counter || 0) + (isInitialTurn ? 1 : 0);
        const pairLabel = context.pairLabel || "她们";
        const schoolCandidates = [
            {
                text: "走廊尽头的广播突然响起，月见夜活动的报名名单临时空出一个位置，截止时间就卡在今晚。",
                sceneGoal: "决定要不要接住月见夜活动突然空出的名额",
                pendingEvents: ["月见夜活动的空缺名额今晚就要定下来。"]
            },
            {
                text: "社团群忽然刷出一条消息，烟火大会的摊位临时缺人，能不能赶上要看她们现在怎么选。",
                sceneGoal: "判断要不要临时加入烟火大会的摊位安排",
                pendingEvents: ["烟火大会的摊位临时缺人，需要她们尽快表态。"]
            },
            {
                text: `老师把下一场比赛的分组名单发了出来，偏偏把${pairLabel}一起推到了同一组，再装作只是顺路已经有点难。`,
                sceneGoal: "回应突如其来的同组安排",
                pendingEvents: ["比赛分组把她们推到了同一组。"]
            }
        ];
        const workCandidates = [
            {
                text: "部门群忽然丢下一条临时通知，今晚的展示稿要在一小时内补一版，原本只属于两个人的安静被硬生生撕开了一道口子。",
                sceneGoal: "决定先接住临时展示稿，还是顺着刚才的情绪继续往前",
                pendingEvents: ["临时展示稿要在一小时内补完。"]
            },
            {
                text: "楼下的门一开，外头的雨比刚才更密了，门边只剩下一把还能撑两个人的伞。",
                sceneGoal: "回应突如其来的雨和只剩一把伞的窘境",
                pendingEvents: ["外面只剩一把伞，得决定谁先开口。"]
            },
            {
                text: "前台忽然把一张活动邀请函送了上来，写着今晚的行业小赛最后还能临时补一组名字。",
                sceneGoal: "判断要不要临时接住今晚的小赛邀请",
                pendingEvents: ["行业小赛今晚还能临时报名。"]
            }
        ];
        const homeCandidates = [
            {
                text: "桌上的手机突然震了一下，屏幕顶端跳出一条提醒，说明天一早就要决定月见夜活动的最终名单。",
                sceneGoal: "在夜色和明早的截止提醒之间做决定",
                pendingEvents: ["明早要决定月见夜活动的最终名单。"]
            },
            {
                text: "楼下的广播忽然响起来，说社区烟火夜的志愿名单还缺最后两个人，想装没听见都难。",
                sceneGoal: "判断要不要接住楼下突然送到门口的烟火夜安排",
                pendingEvents: ["社区烟火夜还缺最后两个人。"]
            },
            {
                text: "窗外的雨声一下子压近了，阳台边只剩一件外套，气氛忽然从温柔变成了谁都得先动作的那种近。",
                sceneGoal: "在突来的天气和靠近里逼出下一步动作",
                pendingEvents: ["雨一下子压近了，得有人先做决定。"]
            }
        ];
        const streetCandidates = [
            {
                text: "路口那边忽然亮起活动海报，写着今晚的烟火大会还有最后一轮报名，像是专门替她们把新的由头送到了眼前。",
                sceneGoal: "决定要不要顺势改道去看烟火大会",
                pendingEvents: ["烟火大会的最后一轮报名就在今晚。"]
            },
            {
                text: "刚走到街边，手机就震了起来，一通不早不晚的来电把眼前的安静拦腰截断。",
                sceneGoal: "先接住突然插进来的来电，再决定关系往哪边推",
                pendingEvents: ["一通突然打进来的电话要求她们立刻选择。"]
            },
            {
                text: "风把路边的宣传单吹到脚边，上面偏偏写着她们刚才提过的那场活动，像有人故意把下一拍塞到了手里。",
                sceneGoal: "回应突然撞上门的活动线索",
                pendingEvents: ["刚才提过的活动突然撞到了眼前。"]
            }
        ];
        const genericCandidates = context.weatherSignal
            ? [
                {
                    text: "夜风忽然带着雨气压了过来，原本还能慢慢拖着的那句话，一下子变成了谁都得先做决定的眼前事。",
                    sceneGoal: "在突来的天气里逼出新的行动",
                    pendingEvents: ["天气突然变了，眼前必须有人先动作。"]
                }
            ]
            : [
                {
                    text: "手机忽然震了一下，新的提醒恰好在最暧昧的时候跳出来，像是专门来把这一拍往前推。",
                    sceneGoal: "先接住突然跳出来的新提醒",
                    pendingEvents: ["新的提醒在最微妙的时候闯了进来。"]
                },
                {
                    text: "门口传来一阵急促的脚步声，原本封闭的气氛被外力轻轻一碰，就再也不适合停在原地。",
                    sceneGoal: "回应外部打断带来的新选择",
                    pendingEvents: ["门外的动静把原本封闭的气氛打开了。"]
                }
            ];
        const candidates = context.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL
            ? schoolCandidates
            : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK
                ? workCandidates
                : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.HOME
                    ? homeCandidates
                    : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.STREET
                        ? streetCandidates
                        : genericCandidates;
        return this._pickRotatingItem(candidates, seed, context.recentNarratorTexts, "text") || candidates[0] || {
            text: "新的动静突然闯进来，眼前这点安静已经不适合继续原样拖下去了。",
            sceneGoal: `接住突然落进${currentSceneGoal}的新变量`,
            pendingEvents: [`${currentSceneGoal}里突然多了一个必须被回应的新变量。`]
        };
    }

    _buildSceneTransitionBeat(context, narratorState, currentSceneGoal) {
        const seed = (narratorState?.beat_counter || 0) + context.recentCastTexts.length;
        const overnight = context.closureSignal && (context.timeBucket === "late_night" || context.intimacySignal);
        const destination = this._pickSceneTransitionDestination(context, seed, overnight);
        const resultLead = this._buildTransitionResultLead(context, seed, overnight);
        const sceneGoal = this._buildTransitionSceneGoal(context, destination.sceneLabel, currentSceneGoal, overnight);
        const pendingEvent = this._buildTransitionFollowUpEvent(context, destination.sceneLabel, overnight);
        return {
            text: `${resultLead}${destination.bridgeText}`,
            sceneLabel: destination.sceneLabel,
            currentTimeLabel: destination.timeLabel,
            sceneGoal,
            narrativeFocus: this._buildTransitionNarrativeFocus(context, destination.sceneLabel, overnight),
            chapterSummary: sceneGoal,
            pendingEventsOverride: this._dedupeLines([
                pendingEvent,
                ...(Array.isArray(narratorState?.pending_events) ? narratorState.pending_events : [])
            ], 4)
        };
    }

    _pickSceneTransitionDestination(context, seed, overnight) {
        const overnightDestinations = context.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL
            ? [
                { sceneLabel: "校门前", timeLabel: "次日清晨", bridgeText: "次日清晨，校门前的人流刚起，新的由头已经把她们重新推回了彼此的视线里。" },
                { sceneLabel: "教室后门", timeLabel: "次日早上", bridgeText: "次日早上，教室后门的光线把昨晚没说完的东西照得无处可躲。" }
            ]
            : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK
                ? [
                    { sceneLabel: "公司楼下", timeLabel: "次日早上", bridgeText: "次日早上，公司楼下的风把昨晚那点没落地的情绪又吹回了眼前。" },
                    { sceneLabel: "电梯口", timeLabel: "次日清晨", bridgeText: "次日清晨，电梯口重新把她们留在了只差一句话就会越界的距离里。" }
                ]
                : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.HOME
                    ? [
                        { sceneLabel: "厨房", timeLabel: "第二天清晨", bridgeText: "第二天清晨，厨房里的光线把昨晚留下的余温照得更明显了。" },
                        { sceneLabel: "楼下小路", timeLabel: "第二天早上", bridgeText: "第二天早上，楼下小路上的脚步声让新的相遇变得顺理成章。" }
                    ]
                    : [
                        { sceneLabel: "楼下门口", timeLabel: "第二天清晨", bridgeText: "第二天清晨，门口新聚起来的人声把下一拍直接送到了眼前。" },
                        { sceneLabel: "街角便利店", timeLabel: "次日早上", bridgeText: "次日早上，街角便利店亮起的灯把她们又拢回了同一个场景里。" }
                    ];
        if (overnight) {
            return this._pickRotatingItem(overnightDestinations, seed, context.recentNarratorTexts, "bridgeText") || overnightDestinations[0];
        }

        const schoolDestinations = [
            { sceneLabel: "教学楼天台门口", timeLabel: "课间之后", bridgeText: "课间之后，教学楼天台门口的风把刚才没说完的话又推近了一格。" },
            { sceneLabel: "社团活动室外", timeLabel: "傍晚", bridgeText: "傍晚，社团活动室外的嘈杂声把新的由头送到了她们面前。" },
            { sceneLabel: "校门前", timeLabel: "放学前", bridgeText: "放学前，校门前的人流又把她们逼回了同一条路上。" }
        ];
        const workDestinations = [
            { sceneLabel: "楼下便利店", timeLabel: "十几分钟后", bridgeText: "十几分钟后，楼下便利店的冷气把话题从原地扯去了更近的一层。" },
            { sceneLabel: "茶水间靠窗的位置", timeLabel: "下班前", bridgeText: "下班前，茶水间靠窗的位置恰好让新的试探有了落脚的地方。" },
            { sceneLabel: "电梯口", timeLabel: "夜里更深一点的时候", bridgeText: "夜里更深一点的时候，电梯口把原本可以装作无事的停顿放大得刚刚好。" }
        ];
        const homeDestinations = [
            { sceneLabel: "阳台边", timeLabel: "半小时后", bridgeText: "半小时后，阳台边的新风把原本压着的情绪吹得更清楚了。" },
            { sceneLabel: "楼下小路", timeLabel: "再晚一点的时候", bridgeText: "再晚一点的时候，楼下小路的安静把并肩这件事变得比刚才更有分量。" },
            { sceneLabel: "客厅窗边", timeLabel: "夜更深时", bridgeText: "夜更深时，客厅窗边剩下的光正好容得下下一句更近的话。" }
        ];
        const streetDestinations = [
            { sceneLabel: "公交站台", timeLabel: "二十分钟后", bridgeText: "二十分钟后，公交站台把原本要散掉的气氛又重新扣回了同一条线上。" },
            { sceneLabel: "河边步道", timeLabel: "夜风起的时候", bridgeText: "夜风起的时候，河边步道反而让那些没说完的东西更难再躲。" },
            { sceneLabel: "街角便利店", timeLabel: "片刻后", bridgeText: "片刻后，街角便利店亮起来的灯让新的小插曲刚好能落地。" }
        ];
        const genericDestinations = [
            { sceneLabel: "门口", timeLabel: "片刻后", bridgeText: "片刻后，门口新的动静已经把下一拍递到了她们面前。" },
            { sceneLabel: "窗边", timeLabel: "十几分钟后", bridgeText: "十几分钟后，窗边的静光把新一轮试探照得更清楚了。" },
            { sceneLabel: "走廊拐角", timeLabel: "再晚一点的时候", bridgeText: "再晚一点的时候，走廊拐角还是把她们重新留在了彼此能看见的距离里。" }
        ];
        const candidates = context.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL
            ? schoolDestinations
            : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK
                ? workDestinations
                : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.HOME
                    ? homeDestinations
                    : context.sceneDomain === STORY_MODE_SCENE_DOMAIN.STREET
                        ? streetDestinations
                        : genericDestinations;
        return this._pickRotatingItem(candidates, seed, context.recentNarratorTexts, "bridgeText") || candidates[0];
    }

    _buildTransitionResultLead(context, seed, overnight) {
        const pairLabel = context.pairLabel || "她们";
        const musicLeads = [
            `${pairLabel}把那段新曲安静地听到了尾声，最后一个音落下去时，空气里剩下的已经不只是音乐。`,
            `那段旋律从头走到尾，${pairLabel}谁也没有先移开视线，真正被留下来的反而是她们都没说破的情绪。`,
            `耳机摘下来的那一刻，那段旋律的余韵还留在${pairLabel}之间，沉默比音乐本身还要响。`,
            `最后一段旋律在空气里散掉以后，${pairLabel}都没有急着开口，好像怕说出来的第一句话配不上剩下的余韵。`
        ];
        const intimateOvernightLeads = [
            `后来谁都没有再硬把夜拖长，${pairLabel}靠近过后的余温把剩下的话都压成了很轻的呼吸。`,
            `${pairLabel}把这一夜的最后一点力气都留在了彼此身边，真正没落地的部分自然被带到了下一天。`,
            `夜色收走了语言，${pairLabel}留给彼此的只是一段不需要翻译的靠近。`,
            `${pairLabel}谁也没再说"晚安"，只是呼吸慢慢对齐了节奏，剩下的留给了天亮以后。`
        ];
        const closureLeads = [
            `${pairLabel}把这一拍的话说到了尽头，可真正没解决的东西并没有跟着一起结束。`,
            `那段对话到底还是落了地，只是${pairLabel}都知道，最要紧的部分还在后面等着。`,
            `话是停住了，可${pairLabel}都没动——像是在等对方先承认这次不只是聊天。`,
            `${pairLabel}把最后一句话收得很轻，但空气里留下来的分量谁都听得出来。`
        ];
        const taskLeads = [
            `手边的事暂时告一段落，可${pairLabel}之间那点没说穿的偏爱并没有跟着一起结束。`,
            `眼前该处理的流程终于放下去了，可真正把人拴住的，还是刚才那句没有说完的话。`,
            `事情算是办完了，可${pairLabel}都清楚，刚才那点多余的眼神已经不在正事的范围里了。`,
            `该做的事告一段落，${pairLabel}往门口走的时候，步调不自觉地慢了下来。`
        ];
        const genericLeads = [
            `${pairLabel}把眼前这一拍暂时接稳了，可新的由头已经在更近的地方等着她们。`,
            `原本可以停在这里的气氛没有真的停住，它只是顺势把下一拍递到了更合适的地方。`,
            `${pairLabel}之间的安静刚撑了不到几秒，就被一个新的念头打断了。`,
            `刚才那句话的余波还没散，新的由头已经主动把自己送了过来。`
        ];

        const candidates = context.musicSignal
            ? musicLeads
            : overnight && context.intimacySignal
                ? intimateOvernightLeads
                : context.closureSignal
                    ? closureLeads
                    : context.taskSignal
                        ? taskLeads
                        : genericLeads;
        const selected = this._pickRotatingItem(candidates, seed, this._recentTransitionLeads) || candidates[0];
        this._recentTransitionLeads.unshift(selected);
        this._recentTransitionLeads = this._recentTransitionLeads.slice(0, 6);
        return selected;
    }

    _buildTransitionSceneGoal(context, sceneLabel, currentSceneGoal, overnight) {
        if (context.musicSignal) {
            return `让${sceneLabel}里的对话从那段旋律的情绪延伸到两人真正在意的事上。`;
        }
        if (overnight) {
            return `在${sceneLabel}重新接住昨晚没落地的情绪。`;
        }
        if (context.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL) {
            return `在${sceneLabel}让新的活动或独处把关系再往前推一步。`;
        }
        if (context.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK) {
            return `在${sceneLabel}把公事外壳下的偏爱和试探继续往前推。`;
        }
        if (context.primaryPendingEvent) {
            return `在${sceneLabel}回应${context.primaryPendingEvent}`;
        }
        return `在${sceneLabel}继续推进${currentSceneGoal || "眼前这段关系"}`;
    }

    _buildTransitionNarrativeFocus(context, sceneLabel, overnight) {
        if (context.musicSignal) {
            return `不要让对话继续围绕"听完歌的感觉"空转，要把互动推向具体的下一步行动或承诺。`;
        }
        if (overnight) {
            return `让${sceneLabel}把昨晚没说完的情绪重新推回可行动的位置。`;
        }
        if (context.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL) {
            return `利用${sceneLabel}的新场合，把校园里的并肩和试探变成更具体的推进。`;
        }
        if (context.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK) {
            return `利用${sceneLabel}这种半公半私的缝隙，让偏爱更难继续藏着。`;
        }
        return `让${sceneLabel}成为新的互动节点，而不是无效过场。`;
    }

    _buildTransitionFollowUpEvent(context, sceneLabel, overnight) {
        if (context.musicSignal) {
            const musicFollowUps = [
                `决定下一首歌到底要不要一起写。`,
                `把刚才那首歌带出来的勇气用在一个具体的约定上。`,
                `确认她愿不愿意把这段旋律变成两个人的事。`
            ];
            return this._pickRotatingItem(musicFollowUps, (context.recentCastTexts?.length || 0), this._recentTransitionLeads) || musicFollowUps[0];
        }
        if (overnight) {
            return `在${sceneLabel}把昨晚没说完的那句话补上。`;
        }
        if (context.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL) {
            return `在${sceneLabel}决定要不要把这次并肩继续延长到下一段路。`;
        }
        if (context.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK) {
            return `在${sceneLabel}确认这次单独留步到底只是顺路还是偏爱。`;
        }
        return `在${sceneLabel}接住刚才没落地的情绪。`;
    }

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

    _buildInjectedEventText({ telemetry, narratorState, isInitialTurn }) {
        const currentSceneGoal = this._storyService.getSceneCard()?.scene_goal || narratorState?.scene_goal || "";
        const context = this._collectNarrativeContext(narratorState, currentSceneGoal, null);
        return this._buildInjectedEventBeat(context, narratorState, currentSceneGoal, isInitialTurn).text;
    }

    _buildTransitionText(narratorState, currentSceneGoal) {
        const context = this._collectNarrativeContext(narratorState, currentSceneGoal, null);
        return this._buildSceneTransitionBeat(context, narratorState, currentSceneGoal).text;
    }

    _buildDirectorHint({ actionKind, telemetry, narratorState }) {
        if (actionKind === NARRATOR_ACTION_KIND.INJECT_EVENT) {
            return "React to the new disturbance instead of comforting the user back into a predictable rest state. Give one concrete observation or decision that widens the scene.";
        }
        if (actionKind === NARRATOR_ACTION_KIND.SCENE_TRANSITION) {
            return "Accept the time skip and land on a fresh interactive moment with unresolved emotional tension.";
        }
        if (telemetry.repeatedTopicScore >= 0.55) {
            return "Do not keep circling the same topic. Introduce a new emotional angle, memory shard, technical obstacle, or invitation that changes what the next beat is about.";
        }
        if (narratorState?.pending_events?.length) {
            return `Advance one pending thread: ${narratorState.pending_events[0]}`;
        }
        return "Move the relationship sideways with a specific new beat rather than closing it down.";
    }

    _buildNarrativeFocus(telemetry, narratorState, currentSceneGoal, context = null) {
        if (telemetry.closurePressureScore >= 0.72) {
            return "不要把刚生成的余温直接收掉，要让下一拍把没说开的东西真正逼到眼前。";
        }
        if (context?.musicSignal) {
            return "把音乐带出来的情绪转化成具体的行动或约定，不要让对话停在感想阶段。";
        }
        if (context?.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL) {
            return "把校园里的并肩、留步和活动安排变成真正的关系推进器。";
        }
        if (context?.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK) {
            return "利用公事外壳下的独处缝隙，把偏爱和克制推到更难回避的位置。";
        }
        return narratorState?.narrative_focus || currentSceneGoal || "推进关系与隐藏张力。";
    }

    _buildChapterSummary(narratorState, currentSceneGoal, context = null, narrativeFocus = "") {
        if (context?.latestCastText) {
            const snippet = sanitizeStoryVisibleText(context.latestCastText).slice(0, 40);
            return `上一拍停在"${snippet}"，接下来要从这里往前走。`;
        }
        if (context?.primaryPendingEvent) {
            return context.primaryPendingEvent;
        }
        if (narrativeFocus && narrativeFocus !== currentSceneGoal) {
            return narrativeFocus;
        }
        return narratorState?.chapter_summary || currentSceneGoal || "新的互动节点刚刚开始。";
    }

    _mergePendingEvents(existingPendingEvents, telemetry, currentSceneGoal, context = null, extraEvents = []) {
        const pending = this._dedupeLines([
            ...extraEvents,
            ...existingPendingEvents
        ], 8);
        if (telemetry.stagnationScore >= 0.68) {
            if (context?.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL) {
                pending.unshift("校园里的活动或比赛需要有人现在就表态。");
            } else if (context?.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK) {
                pending.unshift("工作表层下的新安排正在逼她们单独相处。");
            } else if (context?.musicSignal) {
                pending.unshift("听完那段旋律后的真正情绪还没有被说破。");
            } else {
                pending.unshift(`当前场景里需要一个新的变量来推进${currentSceneGoal}`);
            }
        }
        return this._dedupeLines(pending, 4);
    }

    _normalizeNarratorLines(rawLines, fallbackLines) {
        if (Array.isArray(rawLines) && rawLines.length > 0) {
            return rawLines
                .map((line) => sanitizeStoryVisibleText(String(line || "")))
                .filter((line) => line.length > 0)
                .slice(0, 4);
        }
        return Array.isArray(fallbackLines) ? [...fallbackLines].slice(0, 4) : [];
    }

    _normalizeSuggestedChoices(rawChoices, narratorState, currentSceneGoal = "") {
        if (Array.isArray(rawChoices) && rawChoices.length > 0) {
            return rawChoices
                .map((choice) => {
                    if (typeof choice === "string") {
                        return buildStoryChoice({
                            label: this._normalizeChoiceText(choice, STORY_MODE_CHOICE_LABEL_MAX_LENGTH)
                        });
                    }
                    const label = this._normalizeChoiceText(choice?.label || "", STORY_MODE_CHOICE_LABEL_MAX_LENGTH);
                    const promptText = this._normalizeChoiceText(
                        choice?.prompt_text || choice?.label || "",
                        STORY_MODE_CHOICE_PROMPT_MAX_LENGTH
                    );
                    const rationale = this._normalizeChoiceText(
                        choice?.rationale || "",
                        STORY_MODE_CHOICE_RATIONALE_MAX_LENGTH
                    );
                    return buildStoryChoice({
                        label,
                        promptText: promptText || label,
                        rationale: rationale || null
                    });
                })
                .slice(0, 3);
        }

        const beatCounter = narratorState?.beat_counter || 0;
        if (beatCounter > 0 && beatCounter % STORY_MODE_CHOICE_INTERVAL_BEATS === 0) {
            return this._buildFallbackChoices(narratorState, currentSceneGoal);
        }
        if (Math.random() < STORY_MODE_CHOICE_PROBABILITY && (narratorState?.stagnation_score || 0) >= 0.5) {
            return this._buildFallbackChoices(narratorState, currentSceneGoal);
        }
        return [];
    }

    _buildFallbackChoices(narratorState, currentSceneGoal = "", context = null) {
        const storyContext = context || this._collectNarrativeContext(narratorState, currentSceneGoal, null);
        const sceneLabel = narratorState?.scene_label || "这里";
        const candidateChoices = [];

        // --- Dialogue-derived choices (always vary with context) ---
        const latestSnippet = this._truncateText(storyContext.latestCastText, 20);
        const previousSnippet = this._truncateText(storyContext.previousCastText, 20);

        if (latestSnippet) {
            candidateChoices.push({
                label: `你刚才说"${latestSnippet}"——这句话不只是随便说说的吧？`,
                rationale: "直接引用上一拍的原话，让选项紧贴当前对话。"
            });
        }
        if (previousSnippet && previousSnippet !== latestSnippet) {
            candidateChoices.push({
                label: `等等，你之前那句"${previousSnippet}"，我还没问完。`,
                rationale: "拾起稍早的对话线索，让用户有机会追溯前文。"
            });
        }

        // --- Signal-driven choices (with dialogue grounding) ---
        if (storyContext.primaryPendingEvent) {
            const pendingChoiceLabel = storyContext.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK
                ? "（拿起外套）先把刚冒出来的事处理掉，路上你继续说。"
                : storyContext.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL
                    ? "（朝那边看过去）先去把刚出现的那件事看清楚，回来再说。"
                    : storyContext.sceneDomain === STORY_MODE_SCENE_DOMAIN.HOME
                        ? "（站起来看了一眼）先确认一下刚才那个消息，你等我一下。"
                        : "（停下脚步）先去把刚出现的那件事看清楚，你继续说。";
            candidateChoices.push({
                label: pendingChoiceLabel,
                rationale: `当前最合理的下一步，就是正面接住${storyContext.primaryPendingEvent}。`
            });
        }
        if (storyContext.musicSignal && latestSnippet) {
            candidateChoices.push({
                label: `你说"${latestSnippet}"的时候，心里想的是这首歌还是别的什么？`,
                rationale: "把音乐信号和对话锚点绑在一起，避免选项空降。"
            });
        }
        if (storyContext.latestQuestionText) {
            const questionSnippet = this._truncateText(storyContext.latestQuestionText, 18);
            candidateChoices.push({
                label: `"${questionSnippet}"——你真要我认真回答？`,
                rationale: "直接引用最近的提问，让选项成为对话内的回应而不是外部旁白。"
            });
        }
        if (storyContext.intimacySignal) {
            candidateChoices.push({
                label: "你刚才靠过来的那一下，我可没打算装作没感觉到。",
                rationale: "既然关系已经靠近了，选项就应该允许用户直接接住这份靠近。"
            });
        }
        if (storyContext.closureSignal) {
            if (storyContext.sceneDomain === STORY_MODE_SCENE_DOMAIN.SCHOOL) {
                candidateChoices.push({
                    label: "我们边走边说吧，去校门口或者天台都行。",
                    rationale: "当前对话已经自然收束，应该给出换地点继续的出口。"
                });
            } else if (storyContext.sceneDomain === STORY_MODE_SCENE_DOMAIN.WORK) {
                candidateChoices.push({
                    label: "去楼下买杯喝的吧，换个地方你再继续说。",
                    rationale: "工作场景聊尽时，最自然的推进就是切到更私人的下一处。"
                });
            } else if (storyContext.timeBucket === "late_night") {
                candidateChoices.push({
                    label: "今晚先到这里，明早我再去找你。",
                    rationale: "夜已经深了，直接把时间推到第二天，比继续空转更有推动力。"
                });
            } else {
                candidateChoices.push({
                    label: "别一直站在这里了，我们边走边说。",
                    rationale: `让${sceneLabel}里的收尾自然落到下一个可互动场景。`
                });
            }
        }

        // --- Rotating generic pool (indexed by beat_counter to guarantee variation) ---
        const beatCounter = narratorState?.beat_counter || 0;
        const genericPool = [
            { label: "不然换个地方继续？一直停在这里也说不清。", rationale: "提供真实的转场出口。" },
            { label: "你先把真正想说的那句说完，我不想只听表面。", rationale: "逼近核心情绪。" },
            { label: "我们先往前走，看看下一处会不会让你更敢说真话。", rationale: "明确的场景推进口。" },
            { label: "这件事你真的想好了吗？我再问你一次。", rationale: "中性确认型推进。" },
            { label: "你不用急着回答，但我等你的时间不是无限的。", rationale: "温柔施压型推进。" },
            { label: "算了，那你下次想好要怎么说了再来找我。", rationale: "给出退出当前话题的出口。" },
            { label: "有没有什么你一直想做但还没开口的事？", rationale: "打开全新话题线。" },
            { label: "别光看着我，你到底想走哪边？", rationale: "中性行动催促。" },
            { label: "你每次到最关键的地方就停——这次我不让你跑。", rationale: "锁定逃避阻力。" },
            { label: "我现在说的这些，你到底听进去了多少？", rationale: "确认对方在场感。" }
        ];
        const genericStart = beatCounter % genericPool.length;
        for (let index = 0; index < genericPool.length; index += 1) {
            candidateChoices.push(genericPool[(genericStart + index) % genericPool.length]);
        }

        // --- Dedup and rotation (use rotation keys, not exact strings) ---
        const previousSet = new Set(
            (Array.isArray(narratorState?.suggested_choices)
                ? narratorState.suggested_choices.map((choice) => this._buildRotationKey(choice?.label || ""))
                : []
            ).filter(Boolean)
        );
        const recentSet = new Set(
            this._recentSuggestedChoiceSets
                .flatMap((set) => set)
                .map((label) => this._buildRotationKey(label))
                .filter(Boolean)
        );
        const dedupedCandidates = [];
        const seenLabels = new Set();
        for (const choice of candidateChoices) {
            const label = sanitizeStoryVisibleText(choice?.label || "").trim();
            if (!label) {
                continue;
            }
            const key = this._buildRotationKey(label);
            if (seenLabels.has(key)) {
                continue;
            }
            seenLabels.add(key);
            dedupedCandidates.push({
                label,
                rationale: sanitizeStoryVisibleText(choice?.rationale || "") || null
            });
        }
        const freshCandidates = dedupedCandidates.filter((choice) => {
            const key = this._buildRotationKey(choice.label);
            return !previousSet.has(key) && !recentSet.has(key);
        });
        const staleCandidatesNotPrevious = dedupedCandidates.filter((choice) => {
            const key = this._buildRotationKey(choice.label);
            return !previousSet.has(key) && recentSet.has(key);
        });
        const stalePrevious = dedupedCandidates.filter((choice) => {
            const key = this._buildRotationKey(choice.label);
            return previousSet.has(key);
        });
        const rotatedSource = [...freshCandidates, ...staleCandidatesNotPrevious, ...stalePrevious];
        const source = rotatedSource.length > 0 ? rotatedSource : dedupedCandidates;
        const selected = [];
        for (let index = 0; index < source.length && selected.length < 3; index += 1) {
            if (selected.some((item) => item.label === source[index].label)) {
                continue;
            }
            selected.push(source[index]);
        }
        this._recentSuggestedChoiceSets.unshift(selected.map((choice) => choice.label));
        this._recentSuggestedChoiceSets = this._recentSuggestedChoiceSets.slice(0, 3);
        return selected.map((choice) => buildStoryChoice({
            label: choice.label,
            promptText: choice.label,
            rationale: choice.rationale
        }));
    }

    _normalizeChoiceText(text, maxLength) {
        const normalized = sanitizeStoryVisibleText(String(text || ""));
        if (!normalized) {
            return "";
        }
        return this._truncateText(normalized, maxLength);
    }

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
        const text = this._truncateText(
            typeof event?.text === "string" ? event.text : "",
            STORY_MODE_MAX_RECENT_EVENT_TEXT
        );
        if (!text || text === "(no response)") {
            return "";
        }
        const speaker = event?.cast_member_id
            ? castNameById.get(event.cast_member_id) || event.cast_member_id
            : event?.event_kind === "user_input"
                ? "User"
                : event?.event_kind || "System";
        return `${speaker}: ${text}`;
    }

    _extractAssistantReplyText(hostResult) {
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
        if (!assistantEntry) {
            return "";
        }

        if (typeof assistantEntry.text === "string" && assistantEntry.text.trim()) {
            return assistantEntry.text.trim();
        }
        if (typeof assistantEntry.raw_text === "string" && assistantEntry.raw_text.trim()) {
            return assistantEntry.raw_text.trim();
        }
        return "";
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

    _fitPromptToBudget(parts) {
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
            const remaining = STORY_MODE_TARGET_PROMPT_LENGTH - currentLength - separatorLength;
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
