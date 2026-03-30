import {
  SCENE_RUNTIME_MODE,
  buildSceneBackendDescriptor,
  SceneContractError
} from "./scene_contracts.mjs";
import {
  buildVisualThemeFromStateAndExpression,
  resolveMotionPreset,
  resolveStatePreset
} from "./scene_presets.mjs";
import {
  computeFullBodyLayout,
  computeModelLayout,
  normalizeViewportMetrics
} from "./viewport_layout.mjs";

function resolvePixiCubismDependenciesFromGlobals() {
  const pixiModule = globalThis.PIXI || null;
  const live2dModule =
    globalThis.PIXI?.live2d ||
    globalThis.PIXI?.live2dDisplay ||
    globalThis.Live2DModel ||
    null;
  return Object.freeze({
    pixiModule,
    live2dModule,
    cubismCoreLoaded: Boolean(globalThis.Live2DCubismCore),
    available: Boolean(
      pixiModule?.Application &&
      (live2dModule?.Live2DModel || typeof live2dModule?.from === "function") &&
      globalThis.Live2DCubismCore
    )
  });
}

function clearElementChildren(element) {
  if (!element) {
    return;
  }
  if (typeof element.replaceChildren === "function") {
    element.replaceChildren();
    return;
  }
  if (typeof element.innerHTML === "string") {
    element.innerHTML = "";
    return;
  }
  if (Array.isArray(element.children)) {
    element.children.length = 0;
  }
}

function appendElementChild(element, child) {
  if (!element || !child) {
    return;
  }
  if (typeof element.appendChild === "function") {
    element.appendChild(child);
    return;
  }
  if (Array.isArray(element.children)) {
    element.children.push(child);
  }
}

function createRuntimeOverlay(stageElement) {
  return null;
}

function getPixiApplicationView(app) {
  return app?.canvas || app?.view || null;
}

async function createPixiApplication(pixiModule, stageElement, viewportMetrics) {
  if (!pixiModule?.Application) {
    throw new SceneContractError("pixi.js Application export is unavailable");
  }
  const options = {
    width: viewportMetrics.width,
    height: viewportMetrics.height,
    antialias: true,
    backgroundAlpha: 0,
    resolution:
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? Math.max(1, window.devicePixelRatio)
        : 1,
    autoDensity: true
  };
  let app = null;
  try {
    app = new pixiModule.Application(options);
  } catch {
    app = new pixiModule.Application();
  }
  if (typeof app.init === "function") {
    await app.init({
      ...options,
      resizeTo:
        stageElement &&
          typeof stageElement.clientWidth === "number" &&
          typeof stageElement.clientHeight === "number"
          ? stageElement
          : undefined
    });
  }
  if (!app.stage) {
    throw new SceneContractError("pixi.js Application did not expose a stage");
  }
  const view = getPixiApplicationView(app);
  if (!view) {
    throw new SceneContractError("pixi.js Application did not expose a canvas/view");
  }
  if (view.style) {
    view.style.width = "100%";
    view.style.height = "100%";
    view.style.display = "block";
  }
  return Object.freeze({
    app,
    view
  });
}

async function createLive2DModel(live2dModule, modelJsonPath) {
  const Live2DModel =
    live2dModule?.Live2DModel ||
    live2dModule?.live2d?.Live2DModel ||
    live2dModule?.Live2DModel ||
    live2dModule?.default?.Live2DModel ||
    live2dModule?.default ||
    null;
  if (!Live2DModel || typeof Live2DModel.from !== "function") {
    throw new SceneContractError(
      "pixi-live2d-display did not expose Live2DModel.from(...)"
    );
  }
  return await Live2DModel.from(modelJsonPath, {
    autoInteract: false,
    autoUpdate: true
  });
}

function getDisplayBounds(displayObject) {
  if (!displayObject) {
    return null;
  }
  if (typeof displayObject.getLocalBounds === "function") {
    try {
      return displayObject.getLocalBounds();
    } catch {
      return null;
    }
  }
  const width = Number(displayObject.width);
  const height = Number(displayObject.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return null;
}

function setVector(target, x, y) {
  if (!target) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(x, y);
    return;
  }
  target.x = x;
  target.y = y;
}

function setScalarPair(target, x, y) {
  if (!target) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(x, y);
    return;
  }
  target.x = x;
  target.y = y;
}

function removeDisplayObject(parent, child) {
  if (!parent || !child) {
    return;
  }
  if (typeof parent.removeChild === "function") {
    try {
      parent.removeChild(child);
    } catch {
      // ignore
    }
  }
}

function applyStateHudText({
  target,
  visualTheme,
  displayName,
  mouthOpen,
  runtimeLabel
}) {
  return;
}

function applyHudMouth(target, mouthOpen) {
  return;
}

function setModelOpacity(model, alpha) {
  if (typeof model?.alpha === "number") {
    model.alpha = alpha;
  }
}

function setModelRotation(model, rotation) {
  if (typeof model?.rotation === "number") {
    model.rotation = rotation;
  }
}

function setModelScale(model, uniformScale) {
  if (!model) {
    return;
  }
  if (model.scale && typeof model.scale.set === "function") {
    model.scale.set(uniformScale, uniformScale);
    return;
  }
  if (model.scale && typeof model.scale === "object") {
    model.scale.x = uniformScale;
    model.scale.y = uniformScale;
  }
}

function setModelAnchor(model, anchorX, anchorY) {
  if (!model) {
    return;
  }
  if (model.anchor && typeof model.anchor.set === "function") {
    model.anchor.set(anchorX, anchorY);
  }
}

function setModelPosition(model, x, y) {
  if (!model) {
    return;
  }
  if (model.position && typeof model.position.set === "function") {
    model.position.set(x, y);
    return;
  }
  model.x = x;
  model.y = y;
}

function setModelPivot(model, x, y) {
  if (!model?.pivot) {
    return;
  }
  if (typeof model.pivot.set === "function") {
    model.pivot.set(x, y);
    return;
  }
  model.pivot.x = x;
  model.pivot.y = y;
}

function tryPlayModelMotion(model, motionName) {
  if (!model) {
    return false;
  }
  const motionAliases = [motionName];
  if (motionName === "nod") {
    motionAliases.push("Greet");
  } else if (motionName === "shake_head") {
    motionAliases.push("ReactError");
  }
  for (const alias of motionAliases) {
    const motionCandidates = [
      ["motion", alias],
      ["startMotion", alias],
      ["playMotion", alias]
    ];
    for (const [methodName, motionValue] of motionCandidates) {
      if (typeof model[methodName] === "function") {
        model[methodName](motionValue);
        return true;
      }
    }
  }
  return false;
}

function tryApplyModelExpression(model, expressionName) {
  if (!model) {
    return false;
  }
  const expressionAliases = [expressionName];
  if (expressionName === "thinking") {
    expressionAliases.push("narrow_eyes");
  } else if (expressionName === "angry") {
    expressionAliases.push("tears");
  }
  for (const alias of expressionAliases) {
    const candidates = ["expression", "setExpression", "playExpression"];
    for (const methodName of candidates) {
      if (typeof model[methodName] === "function") {
        model[methodName](alias);
        return true;
      }
    }
  }
  return false;
}

function trySetModelMouthOpen(model, mouthOpen) {
  const coreModel =
    model?.internalModel?.coreModel ||
    model?.coreModel ||
    null;
  if (!coreModel || typeof coreModel.setParameterValueById !== "function") {
    return false;
  }
  try {
    coreModel.setParameterValueById("ParamMouthOpenY", mouthOpen);
    return true;
  } catch {
    return false;
  }
}

function resolveInternalModelEventTarget(model) {
  const internalModel = model?.internalModel || null;
  if (
    !internalModel ||
    typeof internalModel.on !== "function" ||
    typeof internalModel.off !== "function"
  ) {
    return null;
  }
  return internalModel;
}

function resolveExpressionManager(model) {
  return model?.internalModel?.motionManager?.expressionManager || null;
}

function tryResetModelExpression(model) {
  const expressionManager = resolveExpressionManager(model);
  if (!expressionManager || typeof expressionManager.resetExpression !== "function") {
    return false;
  }
  expressionManager.resetExpression();
  return true;
}

const FACE_BLEND_ATTACK = 0.42;
const FACE_BLEND_RELEASE = 0.18;
const FACE_BLEND_SPEECH_MOUTHFORM_WEIGHT = 0.18;
const SPEAKING_MOTION_MIN_MOUTH_OPEN = 0.001;
const SPEAKING_MOTION_FREQUENCY_HZ = 0.75;
const SPEAKING_MOTION_MAX_DT_SECONDS = 0.05;
const SPEAKING_MOTION_SPRING_STIFFNESS = 62;
const SPEAKING_MOTION_SPRING_DAMPING = 16;
const FACE_BLEND_DEFAULTS = Object.freeze({
  mouthForm: 0,
  eyeSmileL: 0,
  eyeSmileR: 0,
  cheek: 0
});
const SPEAKING_MOTION_TIER_CONFIGS = Object.freeze({
  none: Object.freeze({
    angleX: 0,
    bodyAngleX: 0,
    bodyAngleY: 0,
    bodyAngleZ: 0,
    breathBase: 0,
    breathWave: 0
  }),
  neutral: Object.freeze({
    angleX: 4.5,
    bodyAngleX: 24,
    bodyAngleY: 8,
    bodyAngleZ: 6,
    breathBase: 0.55,
    breathWave: 0.18
  }),
  warm: Object.freeze({
    angleX: 6.2,
    bodyAngleX: 32,
    bodyAngleY: 10.5,
    bodyAngleZ: 8.5,
    breathBase: 0.68,
    breathWave: 0.22
  })
});

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeFaceBlendValues(input = {}) {
  return Object.freeze({
    mouthForm: Math.round(clampNumber(Number(input.mouthForm) || 0, -1, 1) * 100) / 100,
    eyeSmileL: Math.round(clampNumber(Number(input.eyeSmileL) || 0, 0, 1) * 100) / 100,
    eyeSmileR: Math.round(clampNumber(Number(input.eyeSmileR) || 0, 0, 1) * 100) / 100,
    cheek: Math.round(clampNumber(Number(input.cheek) || 0, 0, 1) * 100) / 100
  });
}

function createFaceBlendValues(input = {}) {
  return normalizeFaceBlendValues({
    ...FACE_BLEND_DEFAULTS,
    ...(input && typeof input === "object" ? input : {})
  });
}

function resolveCoreModel(model) {
  return model?.internalModel?.coreModel || model?.coreModel || null;
}

function hasVerifiedCoreModelParameter(coreModel, parameterId) {
  if (
    !coreModel ||
    typeof coreModel.getParameterIndex !== "function" ||
    typeof coreModel.getParameterCount !== "function"
  ) {
    return false;
  }
  const parameterIndex = coreModel.getParameterIndex(parameterId);
  const parameterCount = coreModel.getParameterCount();
  return (
    Number.isInteger(parameterIndex) &&
    Number.isInteger(parameterCount) &&
    parameterIndex >= 0 &&
    parameterIndex < parameterCount
  );
}

function createSpeakingMotionValues(input = {}) {
  return Object.freeze({
    angleX: Number(input.angleX) || 0,
    bodyAngleX: Number(input.bodyAngleX) || 0,
    bodyAngleY: Number(input.bodyAngleY) || 0,
    bodyAngleZ: Number(input.bodyAngleZ) || 0,
    breath: Number(input.breath) || 0
  });
}

function createMutableSpeakingMotionValues() {
  return {
    angleX: 0,
    bodyAngleX: 0,
    bodyAngleY: 0,
    bodyAngleZ: 0,
    breath: 0
  };
}

const SPEAKING_MOTION_PHASE_ORIGIN = 0;
const SPEAKING_MOTION_PHASE_LIMIT = Math.PI * 2;

function createSpeakingMotionState() {
  return {
    capability: null,
    tier: "none",
    phaseRadians: SPEAKING_MOTION_PHASE_ORIGIN,
    cycleActive: false,
    lastUpdateMs: null,
    current: createMutableSpeakingMotionValues(),
    target: createMutableSpeakingMotionValues(),
    velocity: createMutableSpeakingMotionValues()
  };
}

function createSpeakingMotionProbeSnapshot(input = {}) {
  return Object.freeze({
    tier: String(input.tier || "none"),
    mouthOpen: Number(input.mouthOpen) || 0,
    expressionName:
      input.expressionName === null || input.expressionName === undefined
        ? null
        : String(input.expressionName),
    target: createSpeakingMotionValues(input.target),
    current: createSpeakingMotionValues(input.current),
    appliedPose: createSpeakingMotionValues(input.appliedPose),
    frameCount: Math.max(0, Number(input.frameCount) || 0),
    lastUpdateMs:
      input.lastUpdateMs === null || input.lastUpdateMs === undefined
        ? null
        : Number(input.lastUpdateMs)
  });
}

function createUnsupportedSpeakingMotionCapability(reason, missingParameters = []) {
  return Object.freeze({
    supported: false,
    reason,
    missing_parameters: Object.freeze([...missingParameters])
  });
}

function resolveSpeakingMotionCapability(model) {
  const coreModel = resolveCoreModel(model);
  if (!coreModel) {
    return createUnsupportedSpeakingMotionCapability("missing_core_model");
  }
  if (typeof coreModel.setParameterValueById !== "function") {
    return createUnsupportedSpeakingMotionCapability(
      "missing_set_parameter_value_api"
    );
  }
  const requiredParameters = [
    "ParamAngleX",
    "ParamBodyAngleX",
    "ParamBodyAngleY",
    "ParamBodyAngleZ",
    "ParamBreath"
  ];
  const missingParameters = requiredParameters.filter(
    (parameterId) => !hasVerifiedCoreModelParameter(coreModel, parameterId)
  );
  if (missingParameters.length > 0) {
    return createUnsupportedSpeakingMotionCapability(
      "missing_required_speaking_motion_parameters",
      missingParameters
    );
  }
  return Object.freeze({
    supported: true,
    reason: null,
    missing_parameters: Object.freeze([])
  });
}

function mapExpressionNameToFaceBlendTarget(expressionName) {
  switch (String(expressionName || "").trim()) {
    case "smile":
      return createFaceBlendValues({
        mouthForm: 0.28,
        eyeSmileL: 0.92,
        eyeSmileR: 0.92,
        cheek: 0.2
      });
    case "thinking":
      return createFaceBlendValues({
        mouthForm: 0.04,
        eyeSmileL: 0.12,
        eyeSmileR: 0.12,
        cheek: 0.08
      });
    case "angry":
      return createFaceBlendValues({
        mouthForm: -0.12,
        eyeSmileL: 0,
        eyeSmileR: 0,
        cheek: 0.06
      });
    case "soft":
      return createFaceBlendValues({
        mouthForm: 0.12,
        eyeSmileL: 0.24,
        eyeSmileR: 0.24,
        cheek: 0.08
      });
    default:
      return createFaceBlendValues();
  }
}

function stepFaceBlendValue(currentValue, targetValue) {
  const coefficient =
    Math.abs(targetValue) > Math.abs(currentValue)
      ? FACE_BLEND_ATTACK
      : FACE_BLEND_RELEASE;
  return currentValue + (targetValue - currentValue) * coefficient;
}

function resolveSpeakingMotionTier(expressionName, mouthOpen) {
  if ((Number(mouthOpen) || 0) <= SPEAKING_MOTION_MIN_MOUTH_OPEN) {
    return "none";
  }
  switch (String(expressionName || "").trim()) {
    case "angry":
      return "none";
    case "smile":
    case "soft":
      return "warm";
    default:
      return "neutral";
  }
}

function stepSpringValue(currentValue, velocityValue, targetValue, dtSeconds) {
  const acceleration =
    SPEAKING_MOTION_SPRING_STIFFNESS * (targetValue - currentValue) -
    SPEAKING_MOTION_SPRING_DAMPING * velocityValue;
  const nextVelocity = velocityValue + acceleration * dtSeconds;
  const nextValue = currentValue + nextVelocity * dtSeconds;
  return Object.freeze({
    value: nextValue,
    velocity: nextVelocity
  });
}

function resolveSpeakingMotionTarget({
  phaseRadians,
  tier,
  mouthOpen
}) {
  const config = SPEAKING_MOTION_TIER_CONFIGS[tier] || SPEAKING_MOTION_TIER_CONFIGS.none;
  if (tier === "none") {
    return createSpeakingMotionValues();
  }
  const amplitudeScale = clampNumber(0.55 + (Number(mouthOpen) || 0) * 0.85, 0.55, 1);
  const horizontalWave = Math.sin(phaseRadians);
  const centerCrossingWeight = Math.pow(1 - Math.abs(horizontalWave), 1.35);
  const twistWave = Math.sin(phaseRadians + Math.PI / 10);
  const breathWave = 0.5 + 0.5 * Math.sin(phaseRadians - Math.PI / 2);
  return createSpeakingMotionValues({
    angleX: config.angleX * horizontalWave * amplitudeScale,
    bodyAngleX: config.bodyAngleX * horizontalWave * amplitudeScale,
    bodyAngleY: -config.bodyAngleY * centerCrossingWeight * amplitudeScale,
    bodyAngleZ: config.bodyAngleZ * twistWave * amplitudeScale,
    breath: (config.breathBase + config.breathWave * breathWave) * amplitudeScale
  });
}

function stepSpeakingMotionState(state, { nowMs, expressionName, mouthOpen }) {
  const dtSeconds =
    state.lastUpdateMs === null
      ? 1 / 60
      : clampNumber((nowMs - state.lastUpdateMs) / 1000, 1 / 240, SPEAKING_MOTION_MAX_DT_SECONDS);
  state.lastUpdateMs = nowMs;
  const prevTier = state.tier;
  const nextTier = resolveSpeakingMotionTier(expressionName, mouthOpen);
  state.tier = nextTier;
  if (prevTier === "none" && nextTier !== "none") {
    state.phaseRadians = SPEAKING_MOTION_PHASE_ORIGIN;
    state.cycleActive = true;
  }
  if (nextTier !== "none" && state.cycleActive) {
    state.phaseRadians += dtSeconds * Math.PI * 2 * SPEAKING_MOTION_FREQUENCY_HZ;
    if (state.phaseRadians >= SPEAKING_MOTION_PHASE_LIMIT) {
      state.phaseRadians = SPEAKING_MOTION_PHASE_LIMIT;
      state.cycleActive = false;
    }
  }
  const target = resolveSpeakingMotionTarget({
    phaseRadians: state.phaseRadians,
    tier: nextTier,
    mouthOpen
  });
  state.target = target;
  for (const parameterId of Object.keys(state.current)) {
    const springStep = stepSpringValue(
      state.current[parameterId],
      state.velocity[parameterId],
      target[parameterId],
      dtSeconds
    );
    state.current[parameterId] = springStep.value;
    state.velocity[parameterId] = springStep.velocity;
  }
  return createSpeakingMotionValues(state.current);
}

function stepFaceBlendState(faceBlendState) {
  faceBlendState.current = createFaceBlendValues({
    mouthForm: stepFaceBlendValue(
      faceBlendState.current.mouthForm,
      faceBlendState.target.mouthForm
    ),
    eyeSmileL: stepFaceBlendValue(
      faceBlendState.current.eyeSmileL,
      faceBlendState.target.eyeSmileL
    ),
    eyeSmileR: stepFaceBlendValue(
      faceBlendState.current.eyeSmileR,
      faceBlendState.target.eyeSmileR
    ),
    cheek: stepFaceBlendValue(
      faceBlendState.current.cheek,
      faceBlendState.target.cheek
    )
  });
  return faceBlendState.current;
}

function buildCompositeFacePose({
  mouthOpen,
  speaking,
  faceBlend
}) {
  const emotionMouthWeight = speaking ? FACE_BLEND_SPEECH_MOUTHFORM_WEIGHT : 1;
  return Object.freeze({
    mouthOpen: clampNumber(Number(mouthOpen) || 0, 0, 1),
    jawOpen: clampNumber((Number(mouthOpen) || 0) * 0.92, 0, 1),
    mouthForm: clampNumber(faceBlend.mouthForm * emotionMouthWeight, -1, 1),
    eyeSmileL: clampNumber(faceBlend.eyeSmileL, 0, 1),
    eyeSmileR: clampNumber(faceBlend.eyeSmileR, 0, 1),
    cheek: clampNumber(faceBlend.cheek, 0, 1)
  });
}

function trySetCoreModelParameter(coreModel, parameterId, value) {
  if (!coreModel || typeof coreModel.setParameterValueById !== "function") {
    return false;
  }
  try {
    coreModel.setParameterValueById(parameterId, value);
    return true;
  } catch {
    return false;
  }
}

function tryApplyCompositeFacePose(model, pose) {
  const coreModel = resolveCoreModel(model);
  if (!coreModel) {
    return false;
  }
  let appliedAny = false;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamMouthOpenY", pose.mouthOpen) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamJawOpen", pose.jawOpen) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamMouthForm", pose.mouthForm) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamEyeLSmile", pose.eyeSmileL) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamEyeRSmile", pose.eyeSmileR) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamCheek", pose.cheek) || appliedAny;
  return appliedAny;
}

function tryApplySpeakingMotionPose(model, pose, capability) {
  if (!capability?.supported) {
    return false;
  }
  const coreModel = resolveCoreModel(model);
  return tryApplySpeakingMotionPoseToCoreModel(coreModel, pose);
}

function tryApplySpeakingMotionPoseToCoreModel(coreModel, pose) {
  if (!coreModel) {
    return false;
  }
  let appliedAny = false;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamAngleX", pose.angleX) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamBodyAngleX", pose.bodyAngleX) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamBodyAngleY", pose.bodyAngleY) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamBodyAngleZ", pose.bodyAngleZ) || appliedAny;
  appliedAny =
    trySetCoreModelParameter(coreModel, "ParamBreath", pose.breath) || appliedAny;
  return appliedAny;
}

function cancelMotionTimer(timerHandle) {
  if (timerHandle !== null) {
    clearTimeout(timerHandle);
  }
}

function buildPortraitFramingConfig(viewportMetrics, scaleMultiplier, layoutOverrides) {
  const width = Math.max(1, Number(viewportMetrics?.width) || 460);
  const height = Math.max(1, Number(viewportMetrics?.height) || 620);
  const overrides = layoutOverrides && typeof layoutOverrides === "object" ? layoutOverrides : {};
  return Object.freeze({
    scaleMultiplier: Number.isFinite(Number(overrides.scaleMultiplier))
      ? Number(overrides.scaleMultiplier)
      : (scaleMultiplier || 1.0),
    targetWidthRatio: 0.94,
    targetHeightRatio: 0.985,
    anchorXRatio: 0.5,
    anchorYRatio: 1,
    offsetX: Number.isFinite(Number(overrides.offsetX)) ? Number(overrides.offsetX) : 0,
    offsetY: Number.isFinite(Number(overrides.offsetY)) ? Number(overrides.offsetY) : 0,
    marginX: Math.max(2, Math.round(width * 0.005)),
    marginY: 0,
    minVisibleRatioX: 0.2,
    minVisibleRatioY: 0.2,
    pivotXRatio: 0.5,
    pivotYRatio: 1,
    minScale: 0.04,
    maxScale: 2
  });
}

export class PixiCubismSceneBackend {
  constructor({
    backendKey = "desktop.live2d.pixi",
    stageElement = null,
    viewportMetrics = null,
    dependenciesResolver = async () => resolvePixiCubismDependenciesFromGlobals(),
    nowMs = () =>
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()
  } = {}) {
    this._backendKey = backendKey;
    this._stageElement = stageElement;
    this._viewportMetrics = normalizeViewportMetrics(viewportMetrics);
    this._dependenciesResolver = dependenciesResolver;
    this._nowMs = nowMs;
    this._descriptor = buildSceneBackendDescriptor({
      backendKey,
      runtimeMode: SCENE_RUNTIME_MODE.PIXI_CUBISM,
      supportsRealPixiCubism: false
    });
    this._dependencies = null;
    this._pixiApplication = null;
    this._pixiTicker = null;
    this._pixiTickerCallback = null;
    this._modelUpdateHookTarget = null;
    this._modelUpdateHookCallback = null;
    this._pixiCanvas = null;
    this._hudLayer = null;
    this._loadedModel = null;
    this._loadedManifest = null;
    this._currentLayout = null;
    this._layoutOverrides = null;
    this._currentStateName = "idle";
    this._viewportScaleMultiplier = 1;
    this._mouthOpen = 0;
    this._activeExpressionName = null;
    this._faceBlendState = {
      current: createFaceBlendValues(),
      target: createFaceBlendValues()
    };
    this._speakingMotionState = createSpeakingMotionState();
    this._speakingMotionProbe = createSpeakingMotionProbeSnapshot();
    this._speakingMotionEnabled = false;
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName: "idle",
      expressionName: null
    });
    this._motionTimer = null;
  }

  async prepare() {
    if (this._dependencies !== null) {
      return this.getDescriptor();
    }
    this._dependencies = await this._dependenciesResolver();
    if (!this._dependencies.available) {
      throw new SceneContractError(
        "desktop-live2d avatar requires real Pixi/Cubism dependencies; no shell fallback is allowed"
      );
    }
    this._descriptor = buildSceneBackendDescriptor({
      backendKey: this._backendKey,
      runtimeMode: SCENE_RUNTIME_MODE.PIXI_CUBISM,
      supportsRealPixiCubism: true
    });
    return this.getDescriptor();
  }

  getDescriptor() {
    return this._descriptor;
  }

  getViewportScaleMultiplier() {
    return this._viewportScaleMultiplier;
  }

  getLayoutOverrides() {
    return this._layoutOverrides ? { ...this._layoutOverrides } : null;
  }

  setLayoutOverrides(overrides) {
    this._layoutOverrides = overrides && typeof overrides === "object"
      ? { ...overrides }
      : null;
  }

  setSpeakingMotionEnabled(enabled) {
    this._speakingMotionEnabled = !!enabled;
  }

  reapplyLayout() {
    if (!this._loadedModel || !this._loadedManifest) {
      return;
    }
    this.#applyModelLayout(this._currentLayout || {});
  }

  getSpeakingMotionRuntimeProbe() {
    return this._speakingMotionProbe;
  }

  async mountStage() {
    await this.prepare();
    this.#detachTicker();
    clearElementChildren(this._stageElement);
    this._hudLayer = null;
    this._pixiApplication = null;
    this._pixiCanvas = null;

    if (!this._stageElement) {
      return Object.freeze({
        mounted: false,
        runtime_mode: this._descriptor.runtime_mode
      });
    }

    this._viewportMetrics = normalizeViewportMetrics({
      width: this._stageElement.clientWidth,
      height: this._stageElement.clientHeight
    });

    const pixiRuntime = await createPixiApplication(
      this._dependencies.pixiModule,
      this._stageElement,
      this._viewportMetrics
    );
    this._pixiApplication = pixiRuntime.app;
    this._pixiTicker = this.#resolvePixiTicker(this._pixiApplication);
    this._pixiTickerCallback = () => {
      if (!this._loadedModel) {
        return;
      }
      this.#renderPresentation();
    };
    this._pixiTicker.add(this._pixiTickerCallback);
    this._pixiCanvas = pixiRuntime.view;
    appendElementChild(this._stageElement, this._pixiCanvas);
    this._hudLayer = createRuntimeOverlay(this._stageElement);

    this.#renderPresentation();
    return Object.freeze({
      mounted: true,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async loadModel(manifest) {
    const idlePreset = resolveStatePreset("idle");
    const layout = computeFullBodyLayout({
      viewportMetrics: this._viewportMetrics,
      viewportFit: manifest.viewport_fit,
      silhouetteScale: idlePreset.silhouetteScale * this._viewportScaleMultiplier
    });
    this._loadedManifest = manifest;
    this._currentLayout = layout;
    this._currentStateName = "idle";

    if (!this._pixiApplication) {
      throw new SceneContractError(
        "pixi/cubism stage must be mounted before loading a model"
      );
    }
    const model = await createLive2DModel(
      this._dependencies.live2dModule,
      manifest.resolved_model_json_path
    );
    const speakingMotionCapability = resolveSpeakingMotionCapability(model);
    if (!speakingMotionCapability.supported) {
      throw new SceneContractError(
        `pixi/cubism speaking motion requires registered model parameters ParamAngleX, ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ, ParamBreath; missing: ${speakingMotionCapability.missing_parameters.join(", ")}`
      );
    }
    this._speakingMotionState = createSpeakingMotionState();
    this._speakingMotionState.capability = speakingMotionCapability;
    this.#attachModelUpdateHook(model);
    this._loadedModel = model;
    if (typeof this._pixiApplication.stage.addChild === "function") {
      this._pixiApplication.stage.addChild(model);
    }
    this.#applyModelLayout(layout);
    this.#applyCompositePresentation({
      advanceSpeakingMotion: false
    });

    this.#renderPresentation();
    return Object.freeze({
      model_key: manifest.model_key,
      layout
    });
  }

  async applyState(stateName) {
    const statePreset = resolveStatePreset(stateName);
    this._currentStateName = stateName;
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName,
      expressionName: this._activeExpressionName
    });
    if (this._loadedManifest && this._currentLayout) {
      const nextLayout = computeFullBodyLayout({
        viewportMetrics: this._viewportMetrics,
        viewportFit: this._loadedManifest.viewport_fit,
        silhouetteScale: statePreset.silhouetteScale * this._viewportScaleMultiplier
      });
      this._currentLayout = nextLayout;
      this.#applyModelLayout(nextLayout);
      if (statePreset.motionHint) {
        tryPlayModelMotion(this._loadedModel, statePreset.motionHint);
      }
    }
    this.#applyCompositePresentation({
      advanceSpeakingMotion: false
    });
    this.#renderPresentation();
    return Object.freeze({
      state_name: stateName,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async applyExpression(stateName, expressionName) {
    this._activeExpressionName = expressionName;
    this._faceBlendState.target = mapExpressionNameToFaceBlendTarget(expressionName);
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName,
      expressionName
    });
    tryApplyModelExpression(this._loadedModel, expressionName);
    this.#applyCompositePresentation({
      advanceSpeakingMotion: false
    });
    this.#renderPresentation();
    return Object.freeze({
      expression_name: expressionName,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async clearExpression(stateName) {
    this._activeExpressionName = null;
    this._faceBlendState.target = createFaceBlendValues();
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName,
      expressionName: null
    });
    if (!tryResetModelExpression(this._loadedModel)) {
      throw new SceneContractError(
        "pixi-live2d-display expression manager resetExpression() is required for active expression clearing"
      );
    }
    this.#applyCompositePresentation({
      advanceSpeakingMotion: false
    });
    this.#renderPresentation();
    return Object.freeze({
      cleared: true,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async playMotion(motionName) {
    const motionPreset = resolveMotionPreset(motionName);
    tryPlayModelMotion(this._loadedModel, motionName);
    cancelMotionTimer(this._motionTimer);
    if (motionPreset && this._loadedModel) {
      const amplitude = motionPreset.amplitude;
      setModelRotation(this._loadedModel, amplitude);
      this._motionTimer = setTimeout(() => {
        setModelRotation(this._loadedModel, 0);
        this._motionTimer = null;
      }, Math.max(90, Math.round(140 * motionPreset.durationScale)));
    }
    return Object.freeze({
      motion_name: motionName,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async applyMouthOpen(mouthOpen) {
    this._mouthOpen = mouthOpen;
    this.#applyCompositePresentation({
      advanceSpeakingMotion: false
    });
    applyHudMouth(this._hudLayer, mouthOpen);
    this.#renderPresentation();
    return Object.freeze({
      mouth_open: this._mouthOpen,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async clearMouthOpen() {
    return await this.applyMouthOpen(0);
  }

  async setViewportScaleMultiplier(multiplier) {
    this._viewportScaleMultiplier = Math.min(2.2, Math.max(0.45, multiplier));
    if (this._loadedManifest && this._loadedModel) {
      const statePreset = resolveStatePreset(this._currentStateName);
      const nextLayout = computeFullBodyLayout({
        viewportMetrics: this._viewportMetrics,
        viewportFit: this._loadedManifest.viewport_fit,
        silhouetteScale: statePreset.silhouetteScale * this._viewportScaleMultiplier
      });
      this._currentLayout = nextLayout;
      this.#applyModelLayout(nextLayout);
      this.#renderPresentation();
    }
    return Object.freeze({
      viewport_scale_multiplier: this._viewportScaleMultiplier,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async setViewportMetrics(viewportMetrics) {
    this._viewportMetrics = normalizeViewportMetrics(viewportMetrics);
    if (typeof this._pixiApplication?.renderer?.resize === "function") {
      this._pixiApplication.renderer.resize(
        this._viewportMetrics.width,
        this._viewportMetrics.height
      );
    }
    if (this._loadedManifest && this._loadedModel) {
      const statePreset = resolveStatePreset(this._currentStateName);
      const nextLayout = computeFullBodyLayout({
        viewportMetrics: this._viewportMetrics,
        viewportFit: this._loadedManifest.viewport_fit,
        silhouetteScale: statePreset.silhouetteScale * this._viewportScaleMultiplier
      });
      this._currentLayout = nextLayout;
      this.#applyModelLayout(nextLayout);
      this.#renderPresentation();
    }
    return Object.freeze({
      viewport_metrics: this._viewportMetrics,
      runtime_mode: this._descriptor.runtime_mode
    });
  }

  async destroy() {
    cancelMotionTimer(this._motionTimer);
    this._motionTimer = null;
    this.#detachTicker();
    this.#detachModelUpdateHook();
    if (this._pixiApplication?.stage && this._loadedModel) {
      removeDisplayObject(this._pixiApplication.stage, this._loadedModel);
    }
    if (typeof this._loadedModel?.destroy === "function") {
      try {
        this._loadedModel.destroy();
      } catch {
        // ignore
      }
    }
    if (typeof this._pixiApplication?.destroy === "function") {
      try {
        this._pixiApplication.destroy(true, { children: true });
      } catch {
        try {
          this._pixiApplication.destroy(true);
        } catch {
          // ignore
        }
      }
    }
    clearElementChildren(this._stageElement);
    this._pixiApplication = null;
    this._pixiCanvas = null;
    this._hudLayer = null;
    this._loadedModel = null;
    this._loadedManifest = null;
    this._currentLayout = null;
    this._mouthOpen = 0;
    this._activeExpressionName = null;
    this._faceBlendState = {
      current: createFaceBlendValues(),
      target: createFaceBlendValues()
    };
    this._speakingMotionState = createSpeakingMotionState();
    this._speakingMotionProbe = createSpeakingMotionProbeSnapshot();
  }

  #applyModelLayout(layout) {
    if (!this._loadedModel) {
      return;
    }
    const bounds = getDisplayBounds(this._loadedModel);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      const fallbackScale = layout.height / Math.max(1, layout.stage_height);
      setModelAnchor(this._loadedModel, layout.anchor_x, layout.anchor_y);
      setModelScale(this._loadedModel, fallbackScale);
      setModelPosition(this._loadedModel, layout.x, layout.y);
      setModelOpacity(this._loadedModel, 1);
      return;
    }

    const portraitFraming = buildPortraitFramingConfig(
      this._viewportMetrics,
      this._loadedManifest?.viewport_fit?.scale_hint || 1.0,
      this._layoutOverrides
    );

    const modelLayout = computeModelLayout({
      viewportMetrics: this._viewportMetrics,
      boundsX: Number(bounds.x) || 0,
      boundsY: Number(bounds.y) || 0,
      boundsWidth: Number(bounds.width) || 1,
      boundsHeight: Number(bounds.height) || 1,
      ...portraitFraming
    });

    setModelAnchor(this._loadedModel, 0, 0);
    setModelPivot(this._loadedModel, modelLayout.pivotX, modelLayout.pivotY);
    setModelScale(this._loadedModel, modelLayout.scale);
    setModelPosition(this._loadedModel, modelLayout.positionX, modelLayout.positionY);
    setModelOpacity(this._loadedModel, 1);
    this._currentLayout = modelLayout;
  }

  #renderPresentation() {
    const displayName =
      this._loadedManifest?.display_name ||
      this._loadedModel?.display_name ||
      "Echo Desktop Character";
    const runtimeLabel =
      this._descriptor.runtime_mode === SCENE_RUNTIME_MODE.PIXI_CUBISM
        ? "Pixi/Cubism"
        : "Pixi shell";
    applyStateHudText({
      target: this._hudLayer,
      visualTheme: this._visualTheme,
      displayName,
      mouthOpen: this._mouthOpen,
      runtimeLabel
    });
    applyHudMouth(this._hudLayer, this._mouthOpen);
  }

  #resolvePixiTicker(app) {
    const ticker = app?.ticker || null;
    if (!ticker || typeof ticker.add !== "function" || typeof ticker.remove !== "function") {
      throw new SceneContractError(
        "pixi.js Application did not expose a compatible ticker"
      );
    }
    return ticker;
  }

  #detachTicker() {
    if (this._pixiTicker && this._pixiTickerCallback) {
      this._pixiTicker.remove(this._pixiTickerCallback);
    }
    this._pixiTicker = null;
    this._pixiTickerCallback = null;
  }

  #attachModelUpdateHook(model) {
    this.#detachModelUpdateHook();
    const eventTarget = resolveInternalModelEventTarget(model);
    if (!eventTarget) {
      throw new SceneContractError(
        "pixi-live2d-display internal model must expose beforeModelUpdate hooks"
      );
    }
    this._modelUpdateHookTarget = eventTarget;
    this._modelUpdateHookCallback = () => {
      this.#applyCompositePresentation({
        advanceSpeakingMotion: true
      });
    };
    eventTarget.on("beforeModelUpdate", this._modelUpdateHookCallback);
  }

  #detachModelUpdateHook() {
    if (this._modelUpdateHookTarget && this._modelUpdateHookCallback) {
      this._modelUpdateHookTarget.off("beforeModelUpdate", this._modelUpdateHookCallback);
    }
    this._modelUpdateHookTarget = null;
    this._modelUpdateHookCallback = null;
  }

  #applyCompositePresentation({ advanceSpeakingMotion }) {
    const faceBlend = stepFaceBlendState(this._faceBlendState);
    const speaking = this._mouthOpen > 0.001;
    tryApplyCompositeFacePose(
      this._loadedModel,
      buildCompositeFacePose({
        mouthOpen: this._mouthOpen,
        speaking,
        faceBlend
      })
    );
    const effectiveAdvance = advanceSpeakingMotion && this._speakingMotionEnabled;
    const speakingMotionPose = effectiveAdvance
      ? stepSpeakingMotionState(this._speakingMotionState, {
        nowMs: this._nowMs(),
        expressionName: this._activeExpressionName,
        mouthOpen: this._mouthOpen
      })
      : createSpeakingMotionValues(this._speakingMotionState.current);
    tryApplySpeakingMotionPose(
      this._loadedModel,
      speakingMotionPose,
      this._speakingMotionState.capability
    );
    this._speakingMotionProbe = createSpeakingMotionProbeSnapshot({
      tier: this._speakingMotionState.tier,
      mouthOpen: this._mouthOpen,
      expressionName: this._activeExpressionName,
      target: this._speakingMotionState.target,
      current: this._speakingMotionState.current,
      appliedPose: speakingMotionPose,
      frameCount: this._speakingMotionProbe.frameCount + 1,
      lastUpdateMs: this._speakingMotionState.lastUpdateMs
    });
  }
}
