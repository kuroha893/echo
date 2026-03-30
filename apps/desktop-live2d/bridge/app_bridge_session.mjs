import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  DesktopLive2DBridgeProtocolError,
  buildDispatchResponse,
  buildErrorEnvelope,
  buildInitializeResponse,
  buildPingResponse,
  buildProtocolErrorFromUnknown,
  buildShutdownResponse
} from "./protocol.mjs";
import { loadModelManifest } from "./model_assets.mjs";
import { DesktopLive2DSceneRuntime } from "../scene/scene_runtime.mjs";

export class DesktopLive2DBridgeSession {
  constructor({
    adapterKey = "desktop.live2d",
    workspaceRoot,
    sceneRuntime = new DesktopLive2DSceneRuntime({
      adapterKey
    })
  } = {}) {
    this._adapterKey = adapterKey;
    this._workspaceRoot = workspaceRoot;
    this._sceneRuntime = sceneRuntime;
    this._initialized = false;
    this._closing = false;
  }

  isInitialized() {
    return this._initialized;
  }

  isClosing() {
    return this._closing;
  }

  async handleRequest(request) {
    try {
      switch (request.bridge_command) {
        case BRIDGE_COMMAND.PING:
          return buildPingResponse(request.request_id);
        case BRIDGE_COMMAND.INITIALIZE:
          return await this.#handleInitialize(request);
        case BRIDGE_COMMAND.DISPATCH_COMMAND:
          return await this.#handleDispatchCommand(request);
        case BRIDGE_COMMAND.SHUTDOWN:
          return this.#handleShutdown(request);
        default:
          throw new DesktopLive2DBridgeProtocolError({
            bridgeCommand: request.bridge_command,
            errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
            message: `unsupported bridge command '${request.bridge_command}'`,
            retryable: false
          });
      }
    } catch (error) {
      const normalized = buildProtocolErrorFromUnknown({
        bridgeCommand: request.bridge_command,
        error
      });
      return buildErrorEnvelope({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        errorCode: normalized.errorCode,
        message: normalized.message,
        retryable: normalized.retryable,
        commandId: normalized.commandId,
        commandType: normalized.commandType,
        rawErrorType: normalized.rawErrorType
      });
    }
  }

  async #handleInitialize(request) {
    if (request.full_body_required !== true) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: BRIDGE_COMMAND.INITIALIZE,
        errorCode: BRIDGE_ERROR_CODE.INVALID_MODEL_ASSET,
        message: "first desktop-live2d backend requires a full-body model window",
        retryable: false
      });
    }
    const modelManifest = await loadModelManifest({
      workspaceRoot: this._workspaceRoot,
      modelAsset: request.model_asset
    });
    await this._sceneRuntime.initialize(modelManifest);
    this._initialized = true;
    return buildInitializeResponse({
      requestId: request.request_id,
      modelKey: modelManifest.model_key,
      resolvedModelJsonPath: modelManifest.resolved_model_json_path,
      presentationMode: modelManifest.presentation_mode,
      windowSurface: modelManifest.window_surface
    });
  }

  async #handleDispatchCommand(request) {
    if (!this._initialized) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: BRIDGE_COMMAND.DISPATCH_COMMAND,
        errorCode: BRIDGE_ERROR_CODE.NOT_INITIALIZED,
        message: "desktop-live2d bridge must be initialized before dispatch",
        retryable: false,
        commandId: request.command_id,
        commandType: request.command_type
      });
    }
    const dispatchResult = await this._sceneRuntime.dispatchCommand(request);
    return buildDispatchResponse({
      requestId: request.request_id,
      commandId: request.command_id,
      commandType: request.command_type,
      adapterKey: this._adapterKey,
      adapterProfileKey: request.adapter_profile_key,
      outcome: dispatchResult.outcome,
      message: dispatchResult.message
    });
  }

  #handleShutdown(request) {
    this._closing = true;
    return buildShutdownResponse(
      request.request_id,
      request.reason || "desktop-live2d bridge shutting down"
    );
  }
}
