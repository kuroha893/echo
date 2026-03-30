import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  buildCompanionSessionResponse,
  buildErrorEnvelope
} from "../bridge/protocol.mjs";
import { CompanionSessionStateManager } from "../shared/companion_session_state_manager.mjs";
import { DesktopLive2DCompanionSessionContractError } from "../shared/companion_session_contracts.mjs";
import { DesktopLive2DChatHistoryPanelController } from "./chat_history_panel_controller.mjs";
import { DesktopLive2DChatHistoryPanelShell } from "./chat_history_panel_shell.mjs";

function buildCompanionSessionErrorEnvelope(request, error) {
  if (error instanceof DesktopLive2DCompanionSessionContractError) {
    return buildErrorEnvelope({
      requestId: request.request_id,
      bridgeCommand: request.bridge_command,
      errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
      message: error.message,
      retryable: false,
      rawErrorType: error.name
    });
  }
  return buildErrorEnvelope({
    requestId: request.request_id,
    bridgeCommand: request.bridge_command,
    errorCode: BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
    message:
      error instanceof Error
        ? error.message
        : "desktop-live2d chat window bridge failed",
    retryable: false,
    rawErrorType: error instanceof Error ? error.name : typeof error
  });
}

function rebuildCompanionStateManagerFromSnapshot(snapshot) {
  const manager = new CompanionSessionStateManager();
  for (const entry of snapshot.transcript_entries) {
    manager.upsertTranscript({
      session_id: snapshot.session_id,
      turn_id: entry.turn_id,
      role: entry.role,
      text: entry.text,
      raw_text: entry.raw_text || "",
      is_streaming: entry.is_streaming
    });
  }
  return manager;
}

export class DesktopLive2DChatWindowRuntime {
  constructor({
    chatMountElement = null,
    desktopApi,
    shellInfo,
    panelShell = null,
    panelController = null,
    companionSessionStateManager = null
  }) {
    this._desktopApi = desktopApi;
    this._shellInfo = shellInfo;
    this._bridgeTargetAccepted = false;
    this._serviceReady = false;
    this._serviceStatusText = "";
    this._lastCompanionSnapshot = null;
    this._companionSessionStateManager =
      companionSessionStateManager ?? new CompanionSessionStateManager();
    this._panelShell = panelShell;
    this._panelController = panelController;
    if (!this._panelController) {
      this._panelShell =
        this._panelShell ??
        new DesktopLive2DChatHistoryPanelShell({
          mountElement: chatMountElement,
          desktopApi: this._desktopApi
        });
      this._panelController = new DesktopLive2DChatHistoryPanelController({
        shell: this._panelShell,
        companionApi: {
          submitCompanionText: async (text, { images = [] } = {}) =>
            await this._desktopApi.submitCompanionText(text, { images }),
          listSessions: async () => await this._desktopApi.listSessions(),
          createSession: async (params) => await this._desktopApi.createSession(params),
          switchSession: async (sessionId) => await this._desktopApi.switchSession(sessionId),
          deleteSession: async (sessionId) => await this._desktopApi.deleteSession(sessionId),
          forkSession: async (params) => await this._desktopApi.forkSession(params),
          getActiveSession: async () => await this._desktopApi.getActiveSession(),
          getSessionDetail: async (sessionId) => await this._desktopApi.getSessionDetail(sessionId)
        }
      });
    }
  }

  async boot() {
    this._panelController.bind();
    this._desktopApi.onModelSessionScopeChanged?.(async () => {
      this._lastCompanionSnapshot = null;
      this._companionSessionStateManager = new CompanionSessionStateManager();
      this._panelController.applyCompanionSnapshot(null);
      await this._panelController.refreshSessionList({
        hydrateActiveSession: true,
        clearMissingSnapshot: true
      });
      await this._hydrateInitialDesktopState();
    });
    const bridgeResult = await this._desktopApi.registerHostBridgeHandler(
      async (bridgeRequest) => {
        return this.handleBridgeRequest(bridgeRequest);
      }
    );
    this._bridgeTargetAccepted = bridgeResult?.accepted === true;
    if (!this._bridgeTargetAccepted) {
      throw new Error("desktop-live2d chat window was not accepted as a bridge target");
    }
    this._panelController.setServiceReady(false, null);
    await this._hydrateInitialDesktopState();
  }

  buildDebugSnapshot() {
    return Object.freeze({
      shell_info: this._shellInfo,
      bridge_target_accepted: this._bridgeTargetAccepted,
      service_ready: this._serviceReady,
      service_status_text: this._serviceStatusText,
      companion_session_snapshot:
        this._lastCompanionSnapshot || this._companionSessionStateManager.getSnapshot()
    });
  }

  handleBridgeRequest(request) {
    switch (request.bridge_command) {
      case BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT:
        return this._handleCompanionSessionUpsert(request);
      case BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT:
        return buildCompanionSessionResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          companionSessionSnapshot: this._companionSessionStateManager.getSnapshot()
        });
      case BRIDGE_COMMAND.COMPANION_SESSION_ENQUEUE_INPUT:
        return this._handleCompanionSessionEnqueue(request);
      case BRIDGE_COMMAND.COMPANION_SESSION_DRAIN_INPUT:
        return this._handleCompanionSessionDrain(request);
      default:
        return buildErrorEnvelope({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
          message: `unsupported chat bridge command '${request.bridge_command}'`,
          retryable: false
        });
    }
  }

  async _hydrateInitialDesktopState() {
    try {
      const desktopState = await this._desktopApi.getCompanionState();
      if (desktopState?.companion_session_snapshot) {
        this._applyCompanionSnapshot(desktopState.companion_session_snapshot, {
          rebuildStateManager: true
        });
      } else {
        await this._panelController.refreshSessionList({
          hydrateActiveSession: true,
          clearMissingSnapshot: true
        });
      }
      this._serviceReady = true;
      this._serviceStatusText = "";
      this._panelController.setServiceReady(true, null);
    } catch (error) {
      this._serviceReady = false;
      this._serviceStatusText = error instanceof Error ? error.message : String(error);
      this._panelController.setServiceReady(false, this._serviceStatusText);
    }
  }

  _handleCompanionSessionUpsert(request) {
    try {
      const snapshot = this._companionSessionStateManager.upsertTranscript(request);
      this._applyCompanionSnapshot(snapshot);
      return buildCompanionSessionResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        companionSessionSnapshot: snapshot
      });
    } catch (error) {
      return buildCompanionSessionErrorEnvelope(request, error);
    }
  }

  _handleCompanionSessionEnqueue(request) {
    try {
      const enqueueResult = this._companionSessionStateManager.enqueueInput(request);
      this._applyCompanionSnapshot(enqueueResult.snapshot);
      return buildCompanionSessionResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        companionSessionSnapshot: enqueueResult.snapshot
      });
    } catch (error) {
      return buildCompanionSessionErrorEnvelope(request, error);
    }
  }

  _handleCompanionSessionDrain(request) {
    try {
      const drainResult = this._companionSessionStateManager.drainInputs(request);
      this._applyCompanionSnapshot(drainResult.snapshot);
      return buildCompanionSessionResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        companionSessionSnapshot: drainResult.snapshot,
        drainedInputs: drainResult.drained_inputs
      });
    } catch (error) {
      return buildCompanionSessionErrorEnvelope(request, error);
    }
  }

  _applyCompanionSnapshot(snapshot, { rebuildStateManager = false } = {}) {
    if (this._shouldExposeCompanionSnapshot(snapshot)) {
      this._lastCompanionSnapshot = snapshot;
      this._panelController.applyCompanionSnapshot(snapshot);
    }
    if (rebuildStateManager) {
      this._companionSessionStateManager =
        rebuildCompanionStateManagerFromSnapshot(snapshot);
    }
  }

  _shouldExposeCompanionSnapshot(snapshot) {
    const snapshotSessionId = snapshot?.session_id || null;
    const activeSessionId = this._panelController.getActiveSessionId?.() || null;
    if (!snapshotSessionId || !activeSessionId) {
      return true;
    }
    return snapshotSessionId === activeSessionId;
  }
}
