import {
  BRIDGE_ERROR_CODE,
  DesktopLive2DBridgeProtocolError
} from "../bridge/protocol.mjs";
import { DesktopLive2DSceneHooks } from "./scene_hooks.mjs";

function ensureSupportedName(allowedValues, candidate, bridgeCommand, label, command) {
  if (!allowedValues.includes(candidate)) {
    throw new DesktopLive2DBridgeProtocolError({
      bridgeCommand,
      errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
      message: `${label} '${candidate}' is not supported by the loaded model`,
      retryable: false,
      commandId: command.command_id,
      commandType: command.command_type
    });
  }
}

export class DesktopLive2DSceneRuntime {
  constructor({
    adapterKey = "desktop.live2d",
    sceneHooks = new DesktopLive2DSceneHooks()
  } = {}) {
    this._adapterKey = adapterKey;
    this._sceneHooks = sceneHooks;
    this._modelManifest = null;
    this._snapshot = {
      model_key: null,
      presentation_mode: "full_body",
      state: "idle",
      active_expression: null,
      last_motion: null,
      command_count: 0
    };
  }

  getSnapshot() {
    return Object.freeze({
      ...this._snapshot
    });
  }

  getModelManifest() {
    return this._modelManifest;
  }

  async initialize(modelManifest) {
    this._modelManifest = Object.freeze({
      ...modelManifest
    });
    this._snapshot = {
      model_key: modelManifest.model_key,
      presentation_mode: modelManifest.presentation_mode,
      state: "idle",
      active_expression: null,
      last_motion: null,
      command_count: 0
    };
    await this._sceneHooks.onModelLoaded(modelManifest);
    return this.getSnapshot();
  }

  async dispatchCommand(command) {
    if (this._modelManifest === null) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: "dispatch_command",
        errorCode: BRIDGE_ERROR_CODE.NOT_INITIALIZED,
        message: "desktop-live2d scene runtime has not been initialized",
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      });
    }
    if (command.command_type === "set_mouth_open") {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: "dispatch_command",
        errorCode: BRIDGE_ERROR_CODE.UNSUPPORTED_COMMAND,
        message: "set_mouth_open remains deferred for the first desktop-live2d backend",
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      });
    }
    switch (command.command_type) {
      case "set_state":
        return this.#applyStateCommand(command);
      case "set_expression":
        return this.#applyExpressionCommand(command);
      case "set_motion":
        return this.#applyMotionCommand(command);
      case "clear_expression":
        return this.#applyClearExpressionCommand(command);
      default:
        throw new DesktopLive2DBridgeProtocolError({
          bridgeCommand: "dispatch_command",
          errorCode: BRIDGE_ERROR_CODE.UNSUPPORTED_COMMAND,
          message: `unsupported renderer command '${command.command_type}'`,
          retryable: false,
          commandId: command.command_id,
          commandType: command.command_type
        });
    }
  }

  async #applyStateCommand(command) {
    if (!(command.target === "state" || command.target === "avatar.state")) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: "dispatch_command",
        errorCode: BRIDGE_ERROR_CODE.UNSUPPORTED_TARGET,
        message: `target '${command.target}' is not supported for set_state`,
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      });
    }
    const stateName = String(command.value);
    ensureSupportedName(
      this._modelManifest.supported_states,
      stateName,
      "dispatch_command",
      "state",
      command
    );
    this._snapshot.state = stateName;
    this._snapshot.command_count += 1;
    await this._sceneHooks.onStateApplied(stateName, command);
    return {
      adapter_key: this._adapterKey,
      outcome: "completed",
      message: `state '${stateName}' applied`
    };
  }

  async #applyExpressionCommand(command) {
    if (
      !(
        command.target === "expression" ||
        command.target === "avatar.expression" ||
        command.target === "avatar.face"
      )
    ) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: "dispatch_command",
        errorCode: BRIDGE_ERROR_CODE.UNSUPPORTED_TARGET,
        message: `target '${command.target}' is not supported for set_expression`,
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      });
    }
    const expressionName = String(command.value);
    ensureSupportedName(
      this._modelManifest.supported_expressions,
      expressionName,
      "dispatch_command",
      "expression",
      command
    );
    this._snapshot.active_expression = expressionName;
    this._snapshot.command_count += 1;
    await this._sceneHooks.onExpressionApplied(expressionName, command);
    return {
      adapter_key: this._adapterKey,
      outcome: "completed",
      message: `expression '${expressionName}' applied`
    };
  }

  async #applyMotionCommand(command) {
    if (!(command.target === "motion" || command.target === "avatar.motion")) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: "dispatch_command",
        errorCode: BRIDGE_ERROR_CODE.UNSUPPORTED_TARGET,
        message: `target '${command.target}' is not supported for set_motion`,
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      });
    }
    const motionName = String(command.value);
    ensureSupportedName(
      this._modelManifest.supported_motions,
      motionName,
      "dispatch_command",
      "motion",
      command
    );
    this._snapshot.last_motion = motionName;
    this._snapshot.command_count += 1;
    await this._sceneHooks.onMotionPlayed(motionName, command);
    return {
      adapter_key: this._adapterKey,
      outcome: "completed",
      message: `motion '${motionName}' played`
    };
  }

  async #applyClearExpressionCommand(command) {
    if (
      !(
        command.target === "expression" ||
        command.target === "avatar.expression" ||
        command.target === "avatar.face"
      )
    ) {
      throw new DesktopLive2DBridgeProtocolError({
        bridgeCommand: "dispatch_command",
        errorCode: BRIDGE_ERROR_CODE.UNSUPPORTED_TARGET,
        message: `target '${command.target}' is not supported for clear_expression`,
        retryable: false,
        commandId: command.command_id,
        commandType: command.command_type
      });
    }
    this._snapshot.active_expression = null;
    this._snapshot.command_count += 1;
    await this._sceneHooks.onExpressionCleared(command);
    return {
      adapter_key: this._adapterKey,
      outcome: "completed",
      message: "expression cleared"
    };
  }
}
