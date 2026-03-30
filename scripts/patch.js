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
    angleX: 2.7,
    bodyAngleX: 14,
    bodyAngleY: 4.5,
    bodyAngleZ: 3.5,
    breathBase: 0.55,
    breathWave: 0.18
  }),
  warm: Object.freeze({
    angleX: 3.7,
    bodyAngleX: 19,
    bodyAngleY: 6.3,
    bodyAngleZ: 5.1,
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

function stepFaceBlendState(state) {
  const current = state.current;
  const target = state.target;
  const attack = clampNumber(Number(state.attack) || FACE_BLEND_ATTACK, 0.01, 1.0);
  const release = clampNumber(Number(state.release) || FACE_BLEND_RELEASE, 0.01, 1.0);
  const keys = Object.keys(FACE_BLEND_DEFAULTS);
  let changed = false;
  for (const key of keys) {
    const c = current[key] || 0;
    const t = target[key] || 0;
    if (Math.abs(c - t) < 0.001) {
      if (c !== t) {
        current[key] = t;
        changed = true;
      }
      continue;
    }
    const rate = t > c ? attack : release;
    current[key] = c + (t - c) * rate;
    changed = true;
  }
  return changed ? normalizeFaceBlendValues(current) : current;
}

function buildCompositeFacePose({ mouthOpen, speaking, faceBlend }) {
  const actualMouthForm = clampNumber(
    faceBlend.mouthForm + (speaking ? FACE_BLEND_SPEECH_MOUTHFORM_WEIGHT : 0),
    -1,
    1
  );
  return Object.freeze({
    mouthOpen: Math.max(0, mouthOpen),
    mouthForm: actualMouthForm,
    eyeSmileL: faceBlend.eyeSmileL,
    eyeSmileR: faceBlend.eyeSmileR,
    cheek: faceBlend.cheek
  });
}

function tryApplyCompositeFacePose(model, pose) {
  if (!model) {
    return false;
  }
  let appliedAny = false;
  appliedAny = trySetModelMouthOpen(model, pose.mouthOpen) || appliedAny;
  const expressionManager = resolveExpressionManager(model);
  const fallbackModel =
    model?.internalModel?.coreModel ||
    model?.coreModel ||
    null;
  if (!expressionManager && fallbackModel && typeof fallbackModel.setParameterValueById === "function") {
    try {
      fallbackModel.setParameterValueById("ParamMouthForm", pose.mouthForm);
      fallbackModel.setParameterValueById("ParamEyeLSmile", pose.eyeSmileL);
      fallbackModel.setParameterValueById("ParamEyeRSmile", pose.eyeSmileR);
      fallbackModel.setParameterValueById("ParamCheek", pose.cheek);
      appliedAny = true;
    } catch {
      // ignore
    }
  }
  return appliedAny;
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

function resolveActiveSpeakingMotionTier(expressionName) {
  if (expressionName === "thinking" || expressionName === "tears" || expressionName === "angry") {
    return "warm";
  }
  if (expressionName === "smile" || expressionName === "happy") {
    return "warm";
  }
  return "neutral";
}

function stepSpeakingMotionState(state, { nowMs, expressionName, mouthOpen }) {
  if (mouthOpen <= SPEAKING_MOTION_MIN_MOUTH_OPEN) {
    state.active = false;
  } else {
    state.active = true;
  }
  if (!state.active) {
    state.phase = 0;
    state.velocity = createSpeakingMotionValues();
    state.current = createSpeakingMotionValues();
    state.target = createSpeakingMotionValues();
    state.lastUpdateMs = nowMs;
    return state.current;
  }
  state.tier = resolveActiveSpeakingMotionTier(expressionName);
  const cfg = SPEAKING_MOTION_TIER_CONFIGS[state.tier] || SPEAKING_MOTION_TIER_CONFIGS.neutral;
  let dtSeconds = (nowMs - state.lastUpdateMs) / 1000;
  if (dtSeconds <= 0) {
    return state.current;
  }
  if (dtSeconds > SPEAKING_MOTION_MAX_DT_SECONDS) {
    dtSeconds = SPEAKING_MOTION_MAX_DT_SECONDS;
  }
  state.lastUpdateMs = nowMs;
  state.phase += 2 * Math.PI * SPEAKING_MOTION_FREQUENCY_HZ * dtSeconds;
  if (state.phase > 100000) {
    state.phase = state.phase % (2 * Math.PI);
  }
  const sinValue = Math.sin(state.phase);
  const cosValue = Math.cos(state.phase * 0.5);
  state.target = createSpeakingMotionValues({
    angleX: cfg.angleX * sinValue,
    bodyAngleX: cfg.bodyAngleX * cosValue,
    bodyAngleY: cfg.bodyAngleY * sinValue,
    bodyAngleZ: cfg.bodyAngleZ * Math.sin(state.phase * 0.75),
    breath: cfg.breathBase + cfg.breathWave * sinValue
  });
  const k = SPEAKING_MOTION_SPRING_STIFFNESS;
  const b = SPEAKING_MOTION_SPRING_DAMPING;
  const keys = ["angleX", "bodyAngleX", "bodyAngleY", "bodyAngleZ", "breath"];
  const newCurrent = { ...state.current };
  for (const key of keys) {
    const c = state.current[key];
    const t = state.target[key];
    const v = state.velocity[key];
    const force = k * (t - c) - b * v;
    const acceleration = force;
    state.velocity[key] = v + acceleration * dtSeconds;
    newCurrent[key] = c + state.velocity[key] * dtSeconds;
  }
  state.current = createSpeakingMotionValues(newCurrent);
  return state.current;
}

function createSpeakingMotionProbeSnapshot(data) {
  return Object.freeze({
    tier: data.tier || "none",
    mouthOpen: Math.round((Number(data.mouthOpen) || 0) * 1000) / 1000,
    expressionName: data.expressionName || null,
    target: createSpeakingMotionValues(data.target),
    current: createSpeakingMotionValues(data.current),
    appliedPose: createSpeakingMotionValues(data.appliedPose),
    frameCount: Number(data.frameCount) || 0,
    lastUpdateMs: Number(data.lastUpdateMs) || 0
  });
}

function tryApplySpeakingMotionPose(model, pose, capability) {
  if (!model) {
    return false;
  }
  const coreModel =
    model?.internalModel?.coreModel ||
    model?.coreModel ||
    null;
  if (!coreModel) {
    return false;
  }
  const isCdiLoaded = Boolean(model?.internalModel?.parameters);
  if (isCdiLoaded) {
    let appliedAny = false;
    if (capability.hasAngleX) {
      appliedAny = trySetCoreModelParameter(coreModel, "ParamAngleX", pose.angleX) || appliedAny;
    }
    if (capability.hasBodyAngleX) {
      appliedAny = trySetCoreModelParameter(coreModel, "ParamBodyAngleX", pose.bodyAngleX) || appliedAny;
    }
    if (capability.hasBodyAngleY) {
      appliedAny = trySetCoreModelParameter(coreModel, "ParamBodyAngleY", pose.bodyAngleY) || appliedAny;
    }
    if (capability.hasBodyAngleZ) {
      appliedAny = trySetCoreModelParameter(coreModel, "ParamBodyAngleZ", pose.bodyAngleZ) || appliedAny;
    }
    if (capability.hasBreath) {
      appliedAny = trySetCoreModelParameter(coreModel, "ParamBreath", pose.breath) || appliedAny;
    }
    return appliedAny;
  }
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

function buildPortraitFramingConfig(viewportMetrics, scaleMultiplier) {
  const width = Math.max(1, Number(viewportMetrics?.width) || 460);
  const height = Math.max(1, Number(viewportMetrics?.height) || 620);
  return Object.freeze({
    scaleMultiplier,
    targetWidthRatio: 0.9,
    targetHeightRatio: 0.952,
    anchorXRatio: 0.5,
    anchorYRatio: 0.992,
    offsetX: 0,
    offsetY: Math.round(height * 0.008),
    marginX: Math.max(8, Math.round(width * 0.022)),
    marginY: 0,
    minVisibleRatioX: 0.24,
    minVisibleRatioY: 0.22,
    visibleMarginTop: Math.max(22, Math.round(height * 0.07)),
    visibleMarginBottom: Math.max(10, Math.round(height * 0.028)),
    pivotXRatio: 0.5,
    pivotYRatio: 1,
    minScale: 0.04,
    maxScale: 2
  });
}
