import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  buildBubbleResponse,
  buildErrorEnvelope,
  buildPingResponse,
  buildShutdownResponse
} from "../bridge/protocol.mjs";
import { BubbleStateManager } from "../shared/bubble_state_manager.mjs";
import { DesktopLive2DBubbleShell } from "./bubble_shell.mjs";

export class DesktopLive2DBubbleWindowRuntime {
  constructor({
    bubbleMountElement,
    statusElement = null,
    desktopApi,
    shellInfo,
    bubbleStateManager = null,
    bubbleShell = null
  }) {
    this._desktopApi = desktopApi;
    this._shellInfo = shellInfo;
    this._statusElement = statusElement;
    this._bridgeTargetAccepted = false;
    this._bubbleStateManager = bubbleStateManager || new BubbleStateManager();
    this._bubbleShell =
      bubbleShell ||
      new DesktopLive2DBubbleShell({
        mountElement: bubbleMountElement
      });
  }

  async boot() {
    const bridgeResult = await this._desktopApi.registerHostBridgeHandler(
      async (bridgeRequest) => {
        return this.handleBridgeRequest(bridgeRequest);
      }
    );
    this._bridgeTargetAccepted = bridgeResult?.accepted === true;
    if (!this._bridgeTargetAccepted) {
      throw new Error("desktop-live2d bubble renderer was not accepted as a bridge target");
    }
    this._bubbleShell.render(this._bubbleStateManager.getSnapshot());
    this._writeStatus("desktop-live2d bubble runtime ready");
  }

  buildDebugSnapshot() {
    return Object.freeze({
      shell_info: this._shellInfo,
      bridge_target_accepted: this._bridgeTargetAccepted,
      bubble_snapshot: this._bubbleStateManager.getSnapshot()
    });
  }

  applyExternalBubbleText({
    text,
    isStreaming = false,
    speakerLabel = "Echo"
  }) {
    if (typeof text !== "string" || text.trim() === "") {
      const snapshot = this._bubbleStateManager.clear({ reason: "external_empty_text" });
      this._bubbleShell.render(snapshot);
      this._writeStatus("bubble cleared");
      this._publishDebugSnapshot(snapshot, "bubble cleared");
      return snapshot;
    }
    const snapshot = this._bubbleStateManager.replace({
      bubble_text: text,
      speaker_label: speakerLabel,
      is_streaming: isStreaming === true
    });
    this._bubbleShell.render(snapshot);
    const runtimeStatus = snapshot.is_streaming ? "bubble streaming" : "bubble updated";
    this._writeStatus(runtimeStatus);
    this._publishDebugSnapshot(snapshot, runtimeStatus);
    return snapshot;
  }

  handleBridgeRequest(request) {
    switch (request.bridge_command) {
      case BRIDGE_COMMAND.PING:
        return buildPingResponse(request.request_id);
      case BRIDGE_COMMAND.BUBBLE_REPLACE:
        return this._handleBubbleReplace(request);
      case BRIDGE_COMMAND.BUBBLE_APPEND:
        return this._handleBubbleAppend(request);
      case BRIDGE_COMMAND.BUBBLE_CLEAR:
        return this._handleBubbleClear(request);
      case BRIDGE_COMMAND.BUBBLE_SNAPSHOT:
        return buildBubbleResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          bubbleSnapshot: this._bubbleStateManager.getSnapshot()
        });
      case BRIDGE_COMMAND.SHUTDOWN:
        return buildShutdownResponse(request.request_id, request.reason);
      default:
        return buildErrorEnvelope({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
          message: `unsupported bubble bridge command '${request.bridge_command}'`,
          retryable: false
        });
    }
  }

  _handleBubbleReplace(request) {
    const snapshot = this._bubbleStateManager.replace({
      bubble_text: request.bubble_text,
      speaker_label: request.speaker_label,
      is_streaming: request.is_streaming
    });
    this._bubbleShell.render(snapshot);
    const runtimeStatus = snapshot.bubble_visible ? "bubble visible" : "bubble hidden";
    this._writeStatus(runtimeStatus);
    this._publishDebugSnapshot(snapshot, runtimeStatus);
    return buildBubbleResponse({
      requestId: request.request_id,
      bridgeCommand: request.bridge_command,
      bubbleSnapshot: snapshot
    });
  }

  _handleBubbleAppend(request) {
    const snapshot = this._bubbleStateManager.append({
      text_fragment: request.text_fragment,
      speaker_label: request.speaker_label,
      is_streaming: request.is_streaming
    });
    this._bubbleShell.render(snapshot);
    const runtimeStatus = snapshot.is_streaming ? "bubble streaming" : "bubble updated";
    this._writeStatus(runtimeStatus);
    this._publishDebugSnapshot(snapshot, runtimeStatus);
    return buildBubbleResponse({
      requestId: request.request_id,
      bridgeCommand: request.bridge_command,
      bubbleSnapshot: snapshot
    });
  }

  _handleBubbleClear(request) {
    const snapshot = this._bubbleStateManager.clear({
      reason: request.reason
    });
    this._bubbleShell.render(snapshot);
    this._writeStatus("bubble cleared");
    this._publishDebugSnapshot(snapshot, "bubble cleared");
    return buildBubbleResponse({
      requestId: request.request_id,
      bridgeCommand: request.bridge_command,
      bubbleSnapshot: snapshot
    });
  }

  _publishDebugSnapshot(snapshot, runtimeStatus) {
    globalThis.__echoDesktopBubbleSetDebugState?.({
      runtimeStatus,
      shellVisible: snapshot?.bubble_visible === true,
      isStreaming: snapshot?.is_streaming === true,
      lastAction: snapshot?.last_action || "",
      lastPayloadLength:
        typeof snapshot?.bubble_text === "string" ? snapshot.bubble_text.length : 0,
      lastPayloadPreview:
        typeof snapshot?.bubble_text === "string"
          ? snapshot.bubble_text.slice(0, 120)
          : "",
      overlayText:
        typeof snapshot?.bubble_text === "string" ? snapshot.bubble_text : ""
    });
  }

  _writeStatus(message) {
    if (this._statusElement) {
      this._statusElement.textContent = String(message);
    }
  }
}
