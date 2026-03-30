import { contextBridge, ipcRenderer } from "electron";
import {
  buildShellInfoForWindowRole,
  parseDesktopWindowRoleFromArgv
} from "./window_suite_router.mjs";
import { STORY_MODE_IPC_CHANNEL } from "./story_mode_ipc.mjs";

let hostBridgeHandler = null;
const windowRole = parseDesktopWindowRoleFromArgv();
const shellInfo = buildShellInfoForWindowRole(windowRole);

ipcRenderer.on(
  "echo-desktop-live2d:host-bridge-request",
  async (_event, payload) => {
    if (typeof hostBridgeHandler !== "function") {
      await ipcRenderer.invoke("echo-desktop-live2d:host-bridge-response", {
        requestId: payload.requestId,
        errorMessage: "desktop-live2d renderer has no host bridge handler"
      });
      return;
    }
    try {
      const response = await hostBridgeHandler(payload.bridgeRequest);
      await ipcRenderer.invoke("echo-desktop-live2d:host-bridge-response", {
        requestId: payload.requestId,
        response
      });
    } catch (error) {
      await ipcRenderer.invoke("echo-desktop-live2d:host-bridge-response", {
        requestId: payload.requestId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }
);

const api = Object.freeze({
  shellInfo,
  async invokeLocalCommand(commandEnvelope) {
    return ipcRenderer.invoke("echo-desktop-live2d:dispatch", commandEnvelope);
  },
  registerHostBridgeHandler(handler) {
    hostBridgeHandler = handler;
    return ipcRenderer.invoke("echo-desktop-live2d:renderer-bridge-ready");
  },
  async submitCompanionText(text, { images = [] } = {}) {
    return await ipcRenderer.invoke("echo-desktop-live2d:submit-companion-text", {
      text,
      images
    });
  },
  async getCompanionState() {
    return await ipcRenderer.invoke("echo-desktop-live2d:get-companion-state");
  },
  async listSessions() {
    return await ipcRenderer.invoke("echo-desktop-live2d:list-sessions");
  },
  async createSession(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:create-session", payload);
  },
  async switchSession(sessionId) {
    return await ipcRenderer.invoke("echo-desktop-live2d:switch-session", sessionId);
  },
  async deleteSession(sessionId) {
    return await ipcRenderer.invoke("echo-desktop-live2d:delete-session", sessionId);
  },
  async forkSession(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:fork-session", payload);
  },
  async getActiveSession() {
    return await ipcRenderer.invoke("echo-desktop-live2d:get-active-session");
  },
  async getSessionDetail(sessionId) {
    return await ipcRenderer.invoke("echo-desktop-live2d:get-session-detail", sessionId);
  },
  async loadAvatarModelLibrary() {
    return await ipcRenderer.invoke("echo-desktop-live2d:load-avatar-model-library");
  },
  async loadModelPersona(modelKey) {
    return await ipcRenderer.invoke("echo-desktop-live2d:load-model-persona", modelKey);
  },
  async saveAvatarModelSelection(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:save-avatar-model-selection", payload);
  },
  async saveModelPersona(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:save-model-persona", payload);
  },
  async scanModelLibrary() {
    return await ipcRenderer.invoke("echo-desktop-live2d:scan-model-library");
  },
  async getSpeakingMotionEnabled() {
    return await ipcRenderer.invoke("echo-desktop-live2d:get-speaking-motion-enabled");
  },
  async setSpeakingMotionEnabled(enabled) {
    return await ipcRenderer.invoke("echo-desktop-live2d:set-speaking-motion-enabled", enabled);
  },
  async getStoryNarratorSubtitleColor() {
    return await ipcRenderer.invoke("echo-desktop-live2d:get-story-narrator-subtitle-color");
  },
  async setStoryNarratorSubtitleColor(color) {
    return await ipcRenderer.invoke("echo-desktop-live2d:set-story-narrator-subtitle-color", color);
  },
  onSpeakingMotionEnabled(callback) {
    ipcRenderer.on("echo-desktop-live2d:speaking-motion-enabled", (_event, enabled) => {
      callback(enabled);
    });
  },
  async loadProviderSettings() {
    return await ipcRenderer.invoke("echo-desktop-live2d:load-provider-settings");
  },
  async saveProviderSettings(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:save-provider-settings", payload);
  },
  async validateProviderSettings() {
    return await ipcRenderer.invoke("echo-desktop-live2d:validate-provider-settings");
  },
  async getProviderReadiness() {
    return await ipcRenderer.invoke("echo-desktop-live2d:get-provider-readiness");
  },
  async runTTSVoiceEnrollment(payload) {
    return await ipcRenderer.invoke(
      "echo-desktop-live2d:run-tts-voice-enrollment",
      payload
    );
  },
  async listClonedVoices() {
    return await ipcRenderer.invoke("echo-desktop-live2d:list-cloned-voices");
  },
  async chooseReferenceAudio() {
    return await ipcRenderer.invoke("echo-desktop-live2d:choose-reference-audio");
  },
  async beginWindowDrag(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:begin-window-drag", payload);
  },
  async updateWindowDrag(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:update-window-drag", payload);
  },
  async endWindowDrag() {
    return await ipcRenderer.invoke("echo-desktop-live2d:end-window-drag");
  },
  async resizeAvatarWindow(payload) {
    return await ipcRenderer.invoke("echo-desktop-live2d:resize-avatar-window", payload);
  },
  async minimizeCurrentWindow() {
    return await ipcRenderer.invoke("echo-desktop-live2d:minimize-window");
  },
  async closeCurrentWindow() {
    return await ipcRenderer.invoke("echo-desktop-live2d:close-window");
  },
  async showContextMenu() {
    return await ipcRenderer.invoke("echo-desktop-live2d:show-context-menu");
  },
  onToggleMouseTracking(callback) {
    ipcRenderer.on("echo-desktop-live2d:toggle-mouse-tracking", (_event, enabled) => {
      callback(enabled);
    });
  },
  onCursorScreenPosition(callback) {
    ipcRenderer.on("echo-desktop-live2d:cursor-screen-position", (_event, point) => {
      callback(point);
    });
  },
  onBubbleText(callback) {
    ipcRenderer.on("echo-desktop-live2d:bubble-text", (_event, payload) => {
      callback(payload);
    });
  },
  sendWindowInteractivity(payload) {
    ipcRenderer.send("echo-desktop-live2d:window-interactivity", payload);
  },
  sendWindowControl(payload) {
    ipcRenderer.send("echo-desktop-live2d:window-control", payload);
  },
  sendWindowResizeRequest(payload) {
    ipcRenderer.send("echo-desktop-live2d:window-resize-request", payload);
  },
  onWindowStateSync(callback) {
    ipcRenderer.on("echo-desktop-live2d:window-state-sync", (_event, payload) => {
      callback(payload);
    });
  },
  onBubbleInteractionMode(callback) {
    ipcRenderer.on("echo-desktop-live2d:bubble-interaction-mode", (_event, payload) => {
      callback(payload);
    });
  },
  onModelSessionScopeChanged(callback) {
    ipcRenderer.on("echo-desktop-live2d:model-session-scope-changed", (_event, payload) => {
      callback(payload);
    });
  },

  // ── Story Mode ──────────────────────────────────────────────────────
  storyMode: Object.freeze({
    async createThread(params) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.CREATE_THREAD, params);
    },
    async getThread() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_THREAD);
    },
    async getCastMembers() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_CAST_MEMBERS);
    },
    async bindCastSession(castMemberId, sessionId) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.BIND_CAST_SESSION, {
        cast_member_id: castMemberId,
        session_id: sessionId
      });
    },
    async submitUserTurn(text, cueTarget) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.SUBMIT_USER_TURN, {
        text,
        cue_target: cueTarget || null
      });
    },
    async assembleForCast(castMemberId, userIntervention) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.ASSEMBLE_FOR_CAST, {
        cast_member_id: castMemberId,
        user_intervention: userIntervention || null
      });
    },
    async registerProvisional(castMemberId, inputSnapshotId, structuredOutput) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.REGISTER_PROVISIONAL, {
        cast_member_id: castMemberId,
        input_snapshot_id: inputSnapshotId,
        structured_output: structuredOutput
      });
    },
    async tryCommitTurn(castMemberId) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.TRY_COMMIT_TURN, {
        cast_member_id: castMemberId
      });
    },
    async decideNextAction() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.DECIDE_NEXT_ACTION);
    },
    async invalidatePlan(reason) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.INVALIDATE_PLAN, {
        reason: reason || "user_intervention"
      });
    },
    async getTimeline() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_TIMELINE);
    },
    async getStageState() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_STAGE_STATE);
    },
    async getNarratorState() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_NARRATOR_STATE);
    },
    async getCastPresentation(castMemberId) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_CAST_PRESENTATION, {
        cast_member_id: castMemberId
      });
    },
    async listStateSlots() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.LIST_STATE_SLOTS);
    },
    async saveState(slotId, slotTitle) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.SAVE_STATE, {
        slot_id: slotId ?? null,
        slot_title: slotTitle || null
      });
    },
    async loadState(slotId) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.LOAD_STATE, {
        slot_id: slotId ?? null
      });
    },
    async archiveState(slotId) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.ARCHIVE_STATE, {
        slot_id: slotId ?? null
      });
    },
    async initOrchestrator(castMembers) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.INIT_ORCHESTRATOR, {
        cast_members: castMembers
      });
    },
    async runStoryTurn(text, cueTarget, choiceMetadata) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.RUN_STORY_TURN, {
        text,
        cue_target: cueTarget || null,
        choice_metadata: choiceMetadata || null
      });
    },
    async stopStoryTurn(reason) {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.STOP_STORY_TURN, {
        reason: reason || "user_interrupt"
      });
    },
    async getOrchestratorStatus() {
      return await ipcRenderer.invoke(STORY_MODE_IPC_CHANNEL.GET_ORCHESTRATOR_STATUS);
    }
  })
});

contextBridge.exposeInMainWorld("echoDesktopLive2D", api);
