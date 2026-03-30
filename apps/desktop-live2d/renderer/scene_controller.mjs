import {
  SCENE_EXECUTION_KIND,
  SceneContractError,
  buildSceneDispatchReceipt,
  buildSceneExecutionRecord,
  buildSceneSnapshot,
  ensureSceneCommandSupported,
  ensureSupportedModelValue,
  normalizeSceneCommandEnvelope,
  normalizeSceneModelManifest
} from "../shared/scene_contracts.mjs";
import { HeadlessSceneBackend } from "../shared/headless_scene_backend.mjs";
import { PixiCubismSceneBackend } from "../shared/pixi_cubism_backend.mjs";

function clampMouthOpen(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SceneContractError("mouthOpen must be a finite number", {
      field: "mouthOpen"
    });
  }
  return Math.min(1, Math.max(0, value));
}

function toProtocolBridgeError({
  bridgeCommand,
  command,
  error
}) {
  if (command.command_type === "set_mouth_open") {
    return {
      bridgeCommand,
      errorCode: "unsupported_command",
      message: "set_mouth_open remains deferred for the first desktop-live2d backend",
      retryable: false,
      commandId: command.command_id,
      commandType: command.command_type
    };
  }
  if (error instanceof SceneContractError) {
    const message = error.message;
    const unsupportedTarget = message.includes("target '");
    const unsupportedCommand = message.includes("unsupported scene command");
    return {
      bridgeCommand,
      errorCode: unsupportedTarget
        ? "unsupported_target"
        : unsupportedCommand
          ? "unsupported_command"
          : "invalid_request",
      message,
      retryable: false,
      commandId: command.command_id,
      commandType: command.command_type
    };
  }
  return {
    bridgeCommand,
    errorCode: "internal_app_error",
    message: error instanceof Error ? error.message : "scene controller failed",
    retryable: false,
    commandId: command.command_id,
    commandType: command.command_type,
    rawErrorType: error instanceof Error ? error.name : typeof error
  };
}

export class DesktopLive2DSceneController {
  constructor({
    adapterKey = "desktop.live2d",
    domStageElement = null,
    backend = null
  } = {}) {
    this._adapterKey = adapterKey;
    this._domStageElement = domStageElement;
    this._backend =
      backend ||
      (domStageElement
        ? new PixiCubismSceneBackend({
          backendKey: `${adapterKey}.pixi`,
          stageElement: domStageElement
        })
        : new HeadlessSceneBackend({
          backendKey: `${adapterKey}.headless`
        }));
    this._manifest = null;
    this._baseViewportFit = {
      mode: "full_body",
      anchor: "bottom_center",
      scale_hint: 0.84
    };
    this._viewportScaleMultiplier = 1;
    this._snapshot = buildSceneSnapshot({
      modelKey: null,
      displayName: null,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      state: "idle",
      activeExpression: null,
      lastMotion: null,
      commandCount: 0,
      presentationMode: "full_body",
      viewportFit: {
        mode: "full_body",
        anchor: "bottom_center",
        scale_hint: 0.84
      },
      modelLoaded: false,
      executionHistory: []
    });
  }

  getBackendDescriptor() {
    return this._backend.getDescriptor();
  }

  getSnapshot() {
    return this._snapshot;
  }

  getManifest() {
    return this._manifest;
  }

  getViewportScaleMultiplier() {
    return this._viewportScaleMultiplier;
  }

  getBackend() {
    return this._backend;
  }

  async setViewportMetrics(viewportMetrics) {
    if (typeof this._backend.setViewportMetrics !== "function") {
      return this._snapshot;
    }
    await this._backend.setViewportMetrics(viewportMetrics);
    return this._snapshot;
  }

  async initialize(rawManifest) {
    const manifest = normalizeSceneModelManifest(rawManifest);
    await this._backend.mountStage();
    await this._backend.loadModel(manifest);
    this._manifest = manifest;
    this._baseViewportFit = manifest.viewport_fit;
    this._viewportScaleMultiplier = 1;
    const executionRecord = buildSceneExecutionRecord({
      executionKind: SCENE_EXECUTION_KIND.INITIALIZE,
      commandId: "initialize",
      commandType: "initialize",
      target: "scene",
      value: manifest.model_key,
      message: `loaded full-body model '${manifest.display_name}'`,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      sequenceIndex: 0
    });
    this._snapshot = buildSceneSnapshot({
      modelKey: manifest.model_key,
      displayName: manifest.display_name,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      state: "idle",
      activeExpression: null,
      lastMotion: null,
      commandCount: 0,
      presentationMode: manifest.presentation_mode,
      viewportFit: manifest.viewport_fit,
      modelLoaded: true,
      executionHistory: [executionRecord]
    });
    return this._snapshot;
  }

  async setViewportScaleMultiplier(multiplier) {
    if (typeof this._backend.setViewportScaleMultiplier !== "function") {
      return this._snapshot;
    }
    if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new SceneContractError("viewport scale multiplier must be a positive finite number");
    }
    await this._backend.setViewportScaleMultiplier(multiplier);
    this._viewportScaleMultiplier = multiplier;
    this._snapshot = buildSceneSnapshot({
      modelKey: this._snapshot.model_key,
      displayName: this._snapshot.display_name,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      state: this._snapshot.state,
      activeExpression: this._snapshot.active_expression,
      lastMotion: this._snapshot.last_motion,
      mouthOpen: this._snapshot.mouth_open,
      lipsyncActive: this._snapshot.lipsync_active,
      lipsyncSource: this._snapshot.lipsync_source,
      commandCount: this._snapshot.command_count,
      presentationMode: this._snapshot.presentation_mode,
      viewportFit: {
        ...this._baseViewportFit,
        scale_hint: Number(
          (this._baseViewportFit.scale_hint * this._viewportScaleMultiplier).toFixed(4)
        )
      },
      modelLoaded: this._snapshot.model_loaded,
      executionHistory: this._snapshot.execution_history
    });
    return this._snapshot;
  }

  async dispatchCommand(rawCommand) {
    const command = normalizeSceneCommandEnvelope(rawCommand);
    if (this._manifest === null) {
      throw {
        bridgeCommand: "dispatch_command",
        errorCode: "not_initialized",
        message: "desktop-live2d scene controller must be initialized before dispatch",
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      };
    }
    if (command.command_type === "set_mouth_open") {
      throw {
        bridgeCommand: "dispatch_command",
        errorCode: "unsupported_command",
        message: "set_mouth_open remains deferred for the first desktop-live2d backend",
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      };
    }

    try {
      ensureSceneCommandSupported(command);
      switch (command.command_type) {
        case "set_state":
          return await this.#applyState(command);
        case "set_expression":
          return await this.#applyExpression(command);
        case "set_motion":
          return await this.#applyMotion(command);
        case "clear_expression":
          return await this.#clearExpression(command);
        default:
          throw new SceneContractError(
            `unsupported scene command '${command.command_type}'`
          );
      }
    } catch (error) {
      throw toProtocolBridgeError({
        bridgeCommand: "dispatch_command",
        command,
        error
      });
    }
  }

  async applyAudioLipsyncFrame({
    source,
    mouthOpen
  }) {
    if (this._manifest === null) {
      throw new SceneContractError(
        "desktop-live2d scene controller must be initialized before audio lipsync"
      );
    }
    const normalizedMouthOpen = clampMouthOpen(mouthOpen);
    await this._backend.applyMouthOpen(normalizedMouthOpen);
    this._snapshot = buildSceneSnapshot({
      modelKey: this._snapshot.model_key,
      displayName: this._snapshot.display_name,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      state: this._snapshot.state,
      activeExpression: this._snapshot.active_expression,
      lastMotion: this._snapshot.last_motion,
      mouthOpen: normalizedMouthOpen,
      lipsyncActive: true,
      lipsyncSource: source || "desktop_playback",
      commandCount: this._snapshot.command_count,
      presentationMode: this._snapshot.presentation_mode,
      viewportFit: this._snapshot.viewport_fit,
      modelLoaded: true,
      executionHistory: this._snapshot.execution_history
    });
    return this._snapshot;
  }

  async clearAudioLipsync({
    source = null
  } = {}) {
    if (this._manifest === null) {
      return this._snapshot;
    }
    await this._backend.clearMouthOpen();
    this._snapshot = buildSceneSnapshot({
      modelKey: this._snapshot.model_key,
      displayName: this._snapshot.display_name,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      state: this._snapshot.state,
      activeExpression: this._snapshot.active_expression,
      lastMotion: this._snapshot.last_motion,
      mouthOpen: 0,
      lipsyncActive: false,
      lipsyncSource: null,
      commandCount: this._snapshot.command_count,
      presentationMode: this._snapshot.presentation_mode,
      viewportFit: this._snapshot.viewport_fit,
      modelLoaded: true,
      executionHistory: this._snapshot.execution_history
    });
    return this._snapshot;
  }

  async destroy() {
    await this._backend.destroy();
  }

  async #applyState(command) {
    const stateName = ensureSupportedModelValue({
      manifest: this._manifest,
      command,
      valueLabel: "state",
      supportedValues: this._manifest.supported_states
    });
    await this._backend.applyState(stateName);
    return this.#buildUpdatedReceipt({
      command,
      executionKind: SCENE_EXECUTION_KIND.SET_STATE,
      nextState: stateName,
      nextExpression: this._snapshot.active_expression,
      nextMotion: this._snapshot.last_motion,
      message: `state '${stateName}' applied`
    });
  }

  async #applyExpression(command) {
    const expressionName = ensureSupportedModelValue({
      manifest: this._manifest,
      command,
      valueLabel: "expression",
      supportedValues: this._manifest.supported_expressions
    });
    await this._backend.applyExpression(this._snapshot.state, expressionName);
    return this.#buildUpdatedReceipt({
      command,
      executionKind: SCENE_EXECUTION_KIND.SET_EXPRESSION,
      nextState: this._snapshot.state,
      nextExpression: expressionName,
      nextMotion: this._snapshot.last_motion,
      message: `expression '${expressionName}' applied`
    });
  }

  async #applyMotion(command) {
    const motionName = ensureSupportedModelValue({
      manifest: this._manifest,
      command,
      valueLabel: "motion",
      supportedValues: this._manifest.supported_motions
    });
    await this._backend.playMotion(motionName);
    return this.#buildUpdatedReceipt({
      command,
      executionKind: SCENE_EXECUTION_KIND.SET_MOTION,
      nextState: this._snapshot.state,
      nextExpression: this._snapshot.active_expression,
      nextMotion: motionName,
      message: `motion '${motionName}' played`
    });
  }

  async #clearExpression(command) {
    await this._backend.clearExpression(this._snapshot.state);
    return this.#buildUpdatedReceipt({
      command,
      executionKind: SCENE_EXECUTION_KIND.CLEAR_EXPRESSION,
      nextState: this._snapshot.state,
      nextExpression: null,
      nextMotion: this._snapshot.last_motion,
      message: "expression cleared"
    });
  }

  #buildUpdatedReceipt({
    command,
    executionKind,
    nextState,
    nextExpression,
    nextMotion,
    message
  }) {
    const executionRecord = buildSceneExecutionRecord({
      executionKind,
      commandId: command.command_id,
      commandType: command.command_type,
      target: command.target,
      value: command.value,
      message,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      sequenceIndex: this._snapshot.execution_history.length
    });
    const nextSnapshot = buildSceneSnapshot({
      modelKey: this._snapshot.model_key,
      displayName: this._snapshot.display_name,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      state: nextState,
      activeExpression: nextExpression,
      lastMotion: nextMotion,
      mouthOpen: this._snapshot.mouth_open,
      lipsyncActive: this._snapshot.lipsync_active,
      lipsyncSource: this._snapshot.lipsync_source,
      commandCount: this._snapshot.command_count + 1,
      presentationMode: this._snapshot.presentation_mode,
      viewportFit: this._snapshot.viewport_fit,
      modelLoaded: true,
      executionHistory: [...this._snapshot.execution_history, executionRecord]
    });
    this._snapshot = nextSnapshot;
    return buildSceneDispatchReceipt({
      adapterKey: this._adapterKey,
      outcome: "completed",
      message,
      runtimeMode: this._backend.getDescriptor().runtime_mode,
      snapshot: nextSnapshot,
      executionRecord
    });
  }
}
