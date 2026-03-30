export const SCENE_RUNTIME_MODE = Object.freeze({
  HEADLESS: "headless",
  PIXI_CUBISM: "pixi_cubism",
  PIXI_CUBISM_SHELL: "pixi_cubism_shell"
});

export const SCENE_EXECUTION_KIND = Object.freeze({
  INITIALIZE: "initialize",
  SET_STATE: "set_state",
  SET_EXPRESSION: "set_expression",
  SET_MOTION: "set_motion",
  CLEAR_EXPRESSION: "clear_expression"
});

export const SCENE_COMMAND_SUPPORT = Object.freeze({
  set_state: {
    allowedTargets: new Set(["state", "avatar.state"]),
    valueKind: "state_name"
  },
  set_expression: {
    allowedTargets: new Set(["expression", "avatar.expression", "avatar.face"]),
    valueKind: "expression_name"
  },
  set_motion: {
    allowedTargets: new Set(["motion", "avatar.motion"]),
    valueKind: "motion_name"
  },
  clear_expression: {
    allowedTargets: new Set(["expression", "avatar.expression", "avatar.face"]),
    valueKind: "clear_marker"
  }
});

export class SceneContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SceneContractError";
    this.details = Object.freeze({ ...details });
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SceneContractError(`${label} must be a non-empty string`, {
      label
    });
  }
  return value.trim();
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new SceneContractError(`${label} must be an array of strings`, {
      label
    });
  }
  return Object.freeze([...new Set(value.map((item) => item.trim()).filter(Boolean))]);
}

function assertOptionalObject(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SceneContractError(`${label} must be an object when present`, {
      label
    });
  }
  return value;
}

export function normalizeViewportFit(rawViewportFit) {
  const viewportFit = assertOptionalObject(rawViewportFit, "viewport_fit") || {};
  return Object.freeze({
    mode: typeof viewportFit.mode === "string" ? viewportFit.mode : "full_body",
    anchor:
      typeof viewportFit.anchor === "string"
        ? viewportFit.anchor
        : "bottom_center",
    scale_hint:
      typeof viewportFit.scale_hint === "number" && Number.isFinite(viewportFit.scale_hint)
        ? viewportFit.scale_hint
        : 0.84
  });
}

export function normalizeSceneModelManifest(rawManifest) {
  if (rawManifest === null || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
    throw new SceneContractError("scene model manifest must be an object");
  }
  return Object.freeze({
    model_key: assertNonEmptyString(rawManifest.model_key, "model_key"),
    display_name: assertNonEmptyString(rawManifest.display_name, "display_name"),
    presentation_mode: assertNonEmptyString(
      rawManifest.presentation_mode,
      "presentation_mode"
    ),
    window_surface: assertNonEmptyString(rawManifest.window_surface, "window_surface"),
    viewport_fit: normalizeViewportFit(rawManifest.viewport_fit),
    supported_states: assertStringArray(rawManifest.supported_states, "supported_states"),
    supported_expressions: assertStringArray(
      rawManifest.supported_expressions,
      "supported_expressions"
    ),
    supported_motions: assertStringArray(rawManifest.supported_motions, "supported_motions"),
    repo_relative_model_json_path: assertNonEmptyString(
      rawManifest.repo_relative_model_json_path,
      "repo_relative_model_json_path"
    ),
    resolved_model_json_path: assertNonEmptyString(
      rawManifest.resolved_model_json_path,
      "resolved_model_json_path"
    )
  });
}

export function normalizeSceneCommandEnvelope(rawCommand) {
  if (rawCommand === null || typeof rawCommand !== "object" || Array.isArray(rawCommand)) {
    throw new SceneContractError("scene command must be an object");
  }
  const commandType = assertNonEmptyString(rawCommand.command_type, "command_type");
  const target = assertNonEmptyString(rawCommand.target, "target");
  const commandId = assertNonEmptyString(rawCommand.command_id, "command_id");
  return Object.freeze({
    command_id: commandId,
    command_type: commandType,
    target,
    value: rawCommand.value,
    intensity:
      typeof rawCommand.intensity === "number" && Number.isFinite(rawCommand.intensity)
        ? rawCommand.intensity
        : null,
    duration_ms:
      Number.isInteger(rawCommand.duration_ms) && rawCommand.duration_ms > 0
        ? rawCommand.duration_ms
        : null,
    is_interruptible: Boolean(rawCommand.is_interruptible)
  });
}

export function ensureSceneCommandSupported(command) {
  const support = SCENE_COMMAND_SUPPORT[command.command_type];
  if (!support) {
    throw new SceneContractError(`unsupported scene command '${command.command_type}'`, {
      command_type: command.command_type,
      target: command.target
    });
  }
  if (!support.allowedTargets.has(command.target)) {
    throw new SceneContractError(
      `target '${command.target}' is not supported for ${command.command_type}`,
      {
        command_type: command.command_type,
        target: command.target
      }
    );
  }
  return support;
}

export function buildSceneExecutionRecord({
  executionKind,
  commandId,
  commandType,
  target,
  value,
  message,
  runtimeMode,
  sequenceIndex
}) {
  return Object.freeze({
    execution_kind: executionKind,
    command_id: commandId,
    command_type: commandType,
    target,
    value,
    message,
    runtime_mode: runtimeMode,
    sequence_index: sequenceIndex
  });
}

export function buildSceneSnapshot({
  modelKey,
  displayName,
  runtimeMode,
  state,
  activeExpression,
  lastMotion,
  mouthOpen = 0,
  lipsyncActive = false,
  lipsyncSource = null,
  commandCount,
  presentationMode,
  viewportFit,
  modelLoaded,
  executionHistory
}) {
  return Object.freeze({
    model_key: modelKey,
    display_name: displayName,
    runtime_mode: runtimeMode,
    state,
    active_expression: activeExpression,
    last_motion: lastMotion,
    mouth_open: mouthOpen,
    lipsync_active: lipsyncActive,
    lipsync_source: lipsyncSource,
    command_count: commandCount,
    presentation_mode: presentationMode,
    viewport_fit: Object.freeze({ ...viewportFit }),
    model_loaded: modelLoaded,
    execution_history: Object.freeze(executionHistory.slice())
  });
}

export function buildSceneDispatchReceipt({
  adapterKey,
  outcome = "completed",
  message,
  runtimeMode,
  snapshot,
  executionRecord
}) {
  return Object.freeze({
    adapter_key: adapterKey,
    outcome,
    message,
    runtime_mode: runtimeMode,
    snapshot,
    execution_record: executionRecord
  });
}

export function ensureSupportedModelValue({
  manifest,
  command,
  valueLabel,
  supportedValues
}) {
  const normalized = String(command.value);
  if (!supportedValues.includes(normalized)) {
    throw new SceneContractError(
      `${valueLabel} '${normalized}' is not supported by the loaded model`,
      {
        command_type: command.command_type,
        command_id: command.command_id,
        value: normalized
      }
    );
  }
  return normalized;
}

export function buildSceneBackendDescriptor({
  backendKey,
  runtimeMode,
  supportsRealPixiCubism
}) {
  return Object.freeze({
    backend_key: backendKey,
    runtime_mode: runtimeMode,
    supports_real_pixi_cubism: supportsRealPixiCubism
  });
}
