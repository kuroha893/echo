// ---------------------------------------------------------------------------
// Story Mode IPC — Phase 1
// Thin Electron-side IPC boundary for story mode operations.
// Accepts ipcMain as parameter (electron is dynamically imported in main.mjs).
// ---------------------------------------------------------------------------

import { buildCastMember } from "../shared/story_thread_contracts.mjs";

// ── IPC Channels ───────────────────────────────────────────────────────────

export const STORY_MODE_IPC_CHANNEL = Object.freeze({
    CREATE_THREAD: "echo-desktop-live2d:story-create-thread",
    GET_THREAD: "echo-desktop-live2d:story-get-thread",
    GET_CAST_MEMBERS: "echo-desktop-live2d:story-get-cast-members",
    BIND_CAST_SESSION: "echo-desktop-live2d:story-bind-cast-session",
    SUBMIT_USER_TURN: "echo-desktop-live2d:story-submit-user-turn",
    ASSEMBLE_FOR_CAST: "echo-desktop-live2d:story-assemble-for-cast",
    REGISTER_PROVISIONAL: "echo-desktop-live2d:story-register-provisional",
    TRY_COMMIT_TURN: "echo-desktop-live2d:story-try-commit-turn",
    DECIDE_NEXT_ACTION: "echo-desktop-live2d:story-decide-next-action",
    INVALIDATE_PLAN: "echo-desktop-live2d:story-invalidate-plan",
    GET_TIMELINE: "echo-desktop-live2d:story-get-timeline",
    GET_STAGE_STATE: "echo-desktop-live2d:story-get-stage-state",
    GET_NARRATOR_STATE: "echo-desktop-live2d:story-get-narrator-state",
    GET_CAST_PRESENTATION: "echo-desktop-live2d:story-get-cast-presentation",
    LIST_STATE_SLOTS: "echo-desktop-live2d:story-list-state-slots",
    SAVE_STATE: "echo-desktop-live2d:story-save-state",
    LOAD_STATE: "echo-desktop-live2d:story-load-state",
    ARCHIVE_STATE: "echo-desktop-live2d:story-archive-state",
    // Orchestrator-driven channels (require companion host)
    INIT_ORCHESTRATOR: "echo-desktop-live2d:story-init-orchestrator",
    RUN_STORY_TURN: "echo-desktop-live2d:story-run-story-turn",
    STOP_STORY_TURN: "echo-desktop-live2d:story-stop-story-turn",
    GET_ORCHESTRATOR_STATUS: "echo-desktop-live2d:story-get-orchestrator-status"
});

// ── Error ──────────────────────────────────────────────────────────────────

export class StoryModeIPCError extends Error {
    constructor(message) {
        super(message);
        this.name = "StoryModeIPCError";
    }
}

// ── IPC result helpers ─────────────────────────────────────────────────────

function okResult(payload) {
    return { status: "ok", payload, error_message: null };
}

function errorResult(error) {
    return {
        status: "error",
        payload: null,
        error_message: error instanceof Error ? error.message : String(error)
    };
}

// ── Registration ───────────────────────────────────────────────────────────

/**
 * Register story mode IPC handlers on the main process.
 *
 * @param {object} ipcMain - Electron ipcMain module
 * @param {import("../shared/multi_companion_story_service.mjs").MultiCompanionStoryService} storyService
 * @param {object} options
 * @param {function} options.persistState - async ({ data, slotId, slotTitle }) => void
 * @param {function} options.loadState - async ({ slotId }) => data|null
 * @param {function} options.listStateSlots - async () => object[]
 * @param {function} options.archiveStateSlot - async ({ slotId }) => object
 * @param {function} [options.ensureOrchestrator] - async () => StoryModeOrchestrator
 * @param {function} [options.syncDesktopCastWindows] - async ({ castMembers, activeCastMemberId }) => void
 */
export function registerStoryModeIPC(
    ipcMain,
    storyService,
    {
        persistState,
        loadState,
        listStateSlots,
        archiveStateSlot,
        ensureOrchestrator,
        syncDesktopCastWindows
    }
) {
    ipcMain.handle(STORY_MODE_IPC_CHANNEL.CREATE_THREAD, async (_event, params) => {
        try {
            const castMembers = (params.castMembers || []).map((raw) =>
                raw.cast_member_id
                    ? raw
                    : buildCastMember({
                        displayName: raw.display_name || raw.displayName,
                        personaProfileRef: raw.persona_profile_ref || raw.personaProfileRef,
                        modelProfileRef: raw.model_profile_ref || raw.modelProfileRef || null,
                        voiceProfileRef: raw.voice_profile_ref || raw.voiceProfileRef || null,
                        subtitleColor: raw.subtitle_color || raw.subtitleColor || null,
                        timelineColor: raw.timeline_color || raw.timelineColor || null,
                        roleType: raw.role_type || raw.roleType
                    })
            );
            const thread = storyService.createThread({ ...params, castMembers });
            if (syncDesktopCastWindows) {
                await syncDesktopCastWindows({
                    castMembers: storyService.getCastMembers(),
                    activeCastMemberId: thread.cast_member_ids[0] || null
                });
            }
            return okResult(thread);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_THREAD, async () => {
        try {
            return okResult(storyService.getThread());
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_CAST_MEMBERS, async () => {
        try {
            return okResult(storyService.getCastMembers());
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.BIND_CAST_SESSION, async (_event, params) => {
        try {
            const binding = storyService.bindCastSession(
                params.cast_member_id,
                params.session_id
            );
            return okResult(binding);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.SUBMIT_USER_TURN, async (_event, params) => {
        try {
            const result = storyService.submitUserTurn(
                params.text,
                params.cue_target || null
            );
            return okResult(result);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.ASSEMBLE_FOR_CAST, async (_event, params) => {
        try {
            const snapshot = storyService.assembleForCast(
                params.cast_member_id,
                params.user_intervention || null
            );
            return okResult(snapshot);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.REGISTER_PROVISIONAL, async (_event, params) => {
        try {
            const provisional = storyService.registerProvisionalTurn(
                params.cast_member_id,
                params.input_snapshot_id,
                params.structured_output
            );
            return okResult(provisional);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.TRY_COMMIT_TURN, async (_event, params) => {
        try {
            const result = storyService.tryCommitTurn(params.cast_member_id);
            return okResult(result);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.DECIDE_NEXT_ACTION, async () => {
        try {
            const decision = storyService.decideNextAction();
            return okResult(decision);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.INVALIDATE_PLAN, async (_event, params) => {
        try {
            storyService.invalidatePlan(params.reason || "user_intervention");
            return okResult(null);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_TIMELINE, async () => {
        try {
            return okResult(storyService.getTimeline());
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_STAGE_STATE, async () => {
        try {
            return okResult(storyService.getStageState());
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_NARRATOR_STATE, async () => {
        try {
            return okResult(storyService.getNarratorState());
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_CAST_PRESENTATION, async (_event, params) => {
        try {
            return okResult(
                storyService.getCastPresentationState(params.cast_member_id)
            );
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.LIST_STATE_SLOTS, async () => {
        try {
            if (!listStateSlots) {
                throw new StoryModeIPCError("story state slot listing not configured");
            }
            return okResult(await listStateSlots());
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.SAVE_STATE, async (_event, params) => {
        try {
            const data = storyService.toJSON();
            const slotId = params?.slot_id ?? null;
            const slotTitle = params?.slot_title ?? null;
            const saveResult = await persistState({ data, slotId, slotTitle });
            return okResult(saveResult || null);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.LOAD_STATE, async (_event, params) => {
        try {
            if (ensureOrchestrator) {
                const orchestrator = await ensureOrchestrator();
                await orchestrator.stopAndWait("story_state_load");
            }
            const data = await loadState({ slotId: params?.slot_id ?? null });
            if (!data) {
                return okResult(null);
            }
            const thread = storyService.restoreFromJSON(data);
            if (ensureOrchestrator) {
                const orchestrator = await ensureOrchestrator();
                await orchestrator.bindAllCastSessions(storyService.getCastMembers());
            }
            if (syncDesktopCastWindows) {
                await syncDesktopCastWindows({
                    castMembers: storyService.getCastMembers(),
                    activeCastMemberId: thread.cast_member_ids?.[0] || null
                });
            }
            return okResult(thread);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.ARCHIVE_STATE, async (_event, params) => {
        try {
            if (!archiveStateSlot) {
                throw new StoryModeIPCError("story state slot archive not configured");
            }
            return okResult(await archiveStateSlot({ slotId: params?.slot_id ?? null }));
        } catch (err) {
            return errorResult(err);
        }
    });

    // ── Orchestrator-driven channels ──────────────────────────────────────

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.INIT_ORCHESTRATOR, async (_event, params) => {
        try {
            if (!ensureOrchestrator) {
                throw new StoryModeIPCError("orchestrator support not configured");
            }
            const castMembers = storyService.getCastMembers();
            if (!Array.isArray(castMembers) || castMembers.length === 0) {
                throw new StoryModeIPCError("story thread has no cast members to initialize");
            }
            const orchestrator = await ensureOrchestrator();
            await orchestrator.bindAllCastSessions(castMembers);
            return okResult(null);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.RUN_STORY_TURN, async (_event, params) => {
        try {
            if (!ensureOrchestrator) {
                throw new StoryModeIPCError("orchestrator support not configured");
            }
            const orchestrator = await ensureOrchestrator();
            const result = await orchestrator.startStoryTurn(
                params.text,
                params.cue_target || null,
                params.choice_metadata || null
            );
            return okResult(result);
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.STOP_STORY_TURN, async (_event, params) => {
        try {
            if (!ensureOrchestrator) {
                throw new StoryModeIPCError("orchestrator support not configured");
            }
            const orchestrator = await ensureOrchestrator();
            return okResult(
                await orchestrator.stopAndWait(params?.reason || "user_interrupt")
            );
        } catch (err) {
            return errorResult(err);
        }
    });

    ipcMain.handle(STORY_MODE_IPC_CHANNEL.GET_ORCHESTRATOR_STATUS, async () => {
        try {
            if (!ensureOrchestrator) {
                return okResult({ available: false, running: false, last_error_message: null });
            }
            const orchestrator = await ensureOrchestrator();
            return okResult({
                available: true,
                ...orchestrator.getStatus()
            });
        } catch (err) {
            return errorResult(err);
        }
    });
}

/**
 * Remove all story mode IPC handlers (for cleanup).
 *
 * @param {object} ipcMain - Electron ipcMain module
 */
export function unregisterStoryModeIPC(ipcMain) {
    for (const channel of Object.values(STORY_MODE_IPC_CHANNEL)) {
        ipcMain.removeHandler(channel);
    }
}
