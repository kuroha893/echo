import assert from "node:assert/strict";

import { PixiCubismSceneBackend } from "../shared/pixi_cubism_backend.mjs";
import { DesktopLive2DSceneController } from "./scene_controller.mjs";

class FakeStageElement {
  constructor() {
    this.children = [];
    this.clientWidth = 960;
    this.clientHeight = 960;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  appendChild(child) {
    this.children.push(child);
  }
}

function buildFakePixiModule() {
  class FakeTicker {
    constructor() {
      this._listeners = [];
    }

    add(listener, context = null, priority = 0) {
      this._listeners.push({ listener, context, priority });
      this._listeners.sort((left, right) => right.priority - left.priority);
    }

    remove(listener, context = null) {
      this._listeners = this._listeners.filter(
        (item) => item.listener !== listener || item.context !== context
      );
    }

    update() {
      for (const item of [...this._listeners]) {
        if (item.context) {
          item.listener.call(item.context);
        } else {
          item.listener();
        }
      }
    }
  }

  class FakeStage {
    constructor() {
      this.children = [];
    }

    addChild(child) {
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
    }
  }

  class FakeApplication {
    constructor(options = {}) {
      this.options = options;
      this.stage = new FakeStage();
      this.ticker = new FakeTicker();
      this.canvas = {
        style: {},
        dataset: {}
      };
    }

    async init(options = {}) {
      this.options = {
        ...this.options,
        ...options
      };
    }

    destroy() {
      this.destroyed = true;
    }
  }

  return Object.freeze({
    Application: FakeApplication,
    UPDATE_PRIORITY: Object.freeze({
      HIGH: 25,
      NORMAL: 0,
      LOW: -25,
      UTILITY: -50
    })
  });
}

function buildFakeLive2DModule(activityLog, { missingParameters = [] } = {}) {
  class FakeEventTarget {
    constructor(onEmit) {
      this._listeners = new Map();
      this._onEmit = onEmit;
    }

    on(eventName, listener) {
      const listeners = this._listeners.get(eventName) || [];
      listeners.push(listener);
      this._listeners.set(eventName, listeners);
    }

    off(eventName, listener) {
      const listeners = this._listeners.get(eventName) || [];
      this._listeners.set(
        eventName,
        listeners.filter((item) => item !== listener)
      );
    }

    emit(eventName) {
      const listeners = this._listeners.get(eventName) || [];
      for (const listener of [...listeners]) {
        listener();
      }
      this._onEmit(eventName);
    }
  }

  class FakeLive2DModel {
    constructor() {
      const parameterIds = [
        "ParamMouthOpenY",
        "ParamJawOpen",
        "ParamMouthForm",
        "ParamEyeLSmile",
        "ParamEyeRSmile",
        "ParamCheek",
        "ParamAngleX",
        "ParamBodyAngleX",
        "ParamBodyAngleY",
        "ParamBodyAngleZ",
        "ParamBreath"
      ].filter((parameterId) => !missingParameters.includes(parameterId));
      const additiveParameterIds = new Set([
        "ParamAngleX",
        "ParamBodyAngleX",
        "ParamBodyAngleY",
        "ParamBodyAngleZ",
        "ParamBreath"
      ]);
      const supportedParameterSet = new Set(parameterIds);
      const currentParameterValues = new Map(
        parameterIds.map((parameterId) => [parameterId, 0])
      );
      const internalModelEvents = new FakeEventTarget((eventName) => {
        activityLog.eventEmits.push(eventName);
        activityLog.frameSnapshots.push(Object.freeze(Object.fromEntries(currentParameterValues)));
      });
      this.scale = {
        set: (x, y) => {
          this.scaleX = x;
          this.scaleY = y;
        }
      };
      this.anchor = {
        set: (x, y) => {
          this.anchorX = x;
          this.anchorY = y;
        }
      };
      this.position = {
        set: (x, y) => {
          this.x = x;
          this.y = y;
        }
      };
      this.width = 420;
      this.height = 860;
      this.alpha = 1;
      this.rotation = 0;
      this.focus = () => {
        activityLog.focusCalls += 1;
      };
      this.internalModel = {
        on: internalModelEvents.on.bind(internalModelEvents),
        off: internalModelEvents.off.bind(internalModelEvents),
        emit: (eventName) => {
          for (const parameterId of additiveParameterIds) {
            if (supportedParameterSet.has(parameterId)) {
              currentParameterValues.set(parameterId, 0);
            }
          }
          internalModelEvents.emit(eventName);
        },
        motionManager: {
          update: (coreModel) => coreModel,
          expressionManager: {
            resetExpression: () => {
              activityLog.expressionResetCount += 1;
            }
          }
        },
        focusController: {
          focus: () => {
            activityLog.focusControllerCalls += 1;
          }
        },
        coreModel: {
          getParameterCount: () => parameterIds.length,
          getParameterIndex: (parameterId) => parameterIds.indexOf(parameterId),
          setParameterValueById: (parameterId, value) => {
            assert.ok(supportedParameterSet.has(parameterId));
            currentParameterValues.set(parameterId, value);
            activityLog.parameterWrites.push({ parameterId, value });
          },
          addParameterValueById: (parameterId, value) => {
            assert.ok(supportedParameterSet.has(parameterId));
            const nextValue = (Number(currentParameterValues.get(parameterId)) || 0) + value;
            currentParameterValues.set(parameterId, nextValue);
            activityLog.parameterWrites.push({ parameterId, value, additive: true });
          }
        }
      };
    }

    static async from(modelJsonPath) {
      const model = new FakeLive2DModel();
      model.modelJsonPath = modelJsonPath;
      activityLog.loadedModelPath = modelJsonPath;
      activityLog.live2dFromOptions = arguments[1] || null;
      return model;
    }

    expression(name) {
      activityLog.expressions.push(name);
    }

    motion(name) {
      activityLog.motions.push(name);
    }

    destroy() {
      activityLog.destroyed = true;
    }
  }

  return Object.freeze({
    Live2DModel: FakeLive2DModel
  });
}

function buildManifest() {
  return {
    model_key: "demo-fullbody",
    display_name: "Demo Full-Body Character",
    presentation_mode: "full_body",
    window_surface: "character_window",
    viewport_fit: {
      mode: "full_body",
      anchor: "bottom_center",
      scale_hint: 0.84
    },
    supported_states: ["idle", "thinking", "speaking", "listening"],
    supported_expressions: ["smile", "thinking", "angry", "soft"],
    supported_motions: ["nod", "shake_head"],
    repo_relative_model_json_path:
      "apps/desktop-live2d/assets/models/demo-fullbody/model3.json",
    resolved_model_json_path:
      "file:///C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models/demo-fullbody/model3.json"
  };
}

function createActivityLog() {
  return {
    loadedModelPath: null,
    expressions: [],
    expressionResetCount: 0,
    motions: [],
    parameterWrites: [],
    frameSnapshots: [],
    eventEmits: [],
    focusCalls: 0,
    focusControllerCalls: 0,
    destroyed: false
  };
}

async function createRuntime({ missingParameters = [] } = {}) {
  const activityLog = createActivityLog();
  const stageElement = new FakeStageElement();
  const clock = {
    nowMs: 1000
  };
  const backend = new PixiCubismSceneBackend({
    stageElement,
    nowMs: () => clock.nowMs,
    dependenciesResolver: async () =>
      Object.freeze({
        pixiModule: buildFakePixiModule(),
        live2dModule: buildFakeLive2DModule(activityLog, {
          missingParameters
        }),
        available: true
      })
  });
  const controller = new DesktopLive2DSceneController({
    domStageElement: stageElement,
    backend
  });
  return {
    activityLog,
    stageElement,
    clock,
    backend,
    controller
  };
}

function getAbsolutePeak(activityLog, parameterId, startIndex = 0) {
  return activityLog.frameSnapshots
    .slice(startIndex)
    .reduce(
      (peak, snapshot) => Math.max(peak, Math.abs(Number(snapshot[parameterId]) || 0)),
      0
    );
}

function getLastValue(activityLog, parameterId) {
  const lastSnapshot = activityLog.frameSnapshots[activityLog.frameSnapshots.length - 1] || {};
  return Number(lastSnapshot[parameterId]) || 0;
}

async function emitSpeakingFrames({
  controller,
  backend,
  clock,
  frameCount,
  mouthOpen,
  voiceEnergy = 0.58
}) {
  for (let index = 0; index < frameCount; index += 1) {
    await controller.applyAudioLipsyncFrame({
      mouthOpen,
      voiceEnergy,
      speaking: mouthOpen > 0.001
    });
    clock.nowMs += 1000 / 60;
    backend._loadedModel.internalModel.motionManager.update(
      backend._loadedModel.internalModel.coreModel,
      clock.nowMs
    );
    backend._loadedModel.internalModel.emit("beforeModelUpdate");
  }
}

async function main() {
  const runtime = await createRuntime();
  const {
    activityLog,
    stageElement,
    clock,
    backend,
    controller
  } = runtime;

  const initialized = await controller.initialize(buildManifest());
  assert.equal(initialized.runtime_mode, "pixi_cubism");
  assert.equal(controller.getBackendDescriptor().supports_real_pixi_cubism, true);
  assert.ok(stageElement.children.length >= 1);
  assert.ok(activityLog.loadedModelPath?.endsWith("model3.json"));
  assert.deepEqual(activityLog.live2dFromOptions, {
    autoInteract: false,
    autoUpdate: true
  });

  const stateReceipt = await controller.dispatchCommand({
    command_id: "pixi-state",
    command_type: "set_state",
    target: "state",
    value: "thinking",
    is_interruptible: true
  });
  assert.equal(stateReceipt.snapshot.state, "thinking");

  const neutralStartIndex = activityLog.frameSnapshots.length;
  await emitSpeakingFrames({
    controller,
    backend,
    clock,
    frameCount: 60,
    mouthOpen: 0.64
  });

  assert.ok(
    activityLog.parameterWrites.some((item) => item.parameterId === "ParamMouthOpenY")
  );
  assert.ok(
    activityLog.parameterWrites.some((item) => item.parameterId === "ParamJawOpen")
  );
  assert.equal(
    activityLog.parameterWrites.some(
      (item) =>
        item.additive === true &&
        [
          "ParamAngleX",
          "ParamBodyAngleX",
          "ParamBodyAngleY",
          "ParamBodyAngleZ",
          "ParamBreath"
        ].includes(item.parameterId)
    ),
    false
  );
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleX", neutralStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleY", neutralStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleZ", neutralStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamBreath", neutralStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamAngleX", neutralStartIndex) < 0.12);

  backend.setSpeakingMotionEnabled(true);
  const enabledNeutralStartIndex = activityLog.frameSnapshots.length;
  await emitSpeakingFrames({
    controller,
    backend,
    clock,
    frameCount: 60,
    mouthOpen: 0.64
  });
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleX", enabledNeutralStartIndex) > 8);
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleY", enabledNeutralStartIndex) > 2.8);
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleZ", enabledNeutralStartIndex) > 1.8);
  assert.ok(getAbsolutePeak(activityLog, "ParamBreath", enabledNeutralStartIndex) > 0.32);
  assert.ok(getAbsolutePeak(activityLog, "ParamAngleX", enabledNeutralStartIndex) > 1.1);
  const neutralProbe = backend.getSpeakingMotionRuntimeProbe();
  assert.equal(neutralProbe.tier, "neutral");
  assert.ok(neutralProbe.current.breath > 0.18);
  assert.ok(neutralProbe.appliedPose.breath > 0.18);
  assert.ok(neutralProbe.frameCount > 0);
  assert.equal(activityLog.focusCalls, 0);
  assert.equal(activityLog.focusControllerCalls, 0);
  assert.equal(
    activityLog.parameterWrites.some(
      (item) => item.parameterId === "ParamEyeLOpen" || item.parameterId === "ParamEyeROpen"
    ),
    false
  );

  const neutralBodyPeak = getAbsolutePeak(activityLog, "ParamBodyAngleX", enabledNeutralStartIndex);
  const neutralHeadPeak = getAbsolutePeak(activityLog, "ParamAngleX", enabledNeutralStartIndex);
  const neutralBreathPeak = getAbsolutePeak(activityLog, "ParamBreath", enabledNeutralStartIndex);

  const expressionReceipt = await controller.dispatchCommand({
    command_id: "pixi-expression",
    command_type: "set_expression",
    target: "expression",
    value: "smile",
    is_interruptible: true
  });
  assert.equal(expressionReceipt.snapshot.active_expression, "smile");
  assert.deepEqual(activityLog.expressions, ["smile"]);

  const warmStartIndex = activityLog.frameSnapshots.length;
  await emitSpeakingFrames({
    controller,
    backend,
    clock,
    frameCount: 30,
    mouthOpen: 0.64
  });

  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleX", warmStartIndex) > neutralBodyPeak);
  assert.ok(getAbsolutePeak(activityLog, "ParamAngleX", warmStartIndex) > neutralHeadPeak);
  assert.ok(getAbsolutePeak(activityLog, "ParamBreath", warmStartIndex) > neutralBreathPeak);
  const warmProbe = backend.getSpeakingMotionRuntimeProbe();
  assert.equal(warmProbe.tier, "warm");
  assert.ok(warmProbe.current.breath > neutralProbe.current.breath);
  assert.ok(warmProbe.appliedPose.breath > neutralProbe.appliedPose.breath);
  assert.ok(
    activityLog.parameterWrites.some(
      (item) => item.parameterId === "ParamEyeLSmile" && item.value > 0
    )
  );
  assert.ok(
    activityLog.parameterWrites.some(
      (item) => item.parameterId === "ParamEyeRSmile" && item.value > 0
    )
  );

  await controller.dispatchCommand({
    command_id: "pixi-angry",
    command_type: "set_expression",
    target: "expression",
    value: "angry",
    is_interruptible: true
  });
  const negativeStartIndex = activityLog.frameSnapshots.length;
  await emitSpeakingFrames({
    controller,
    backend,
    clock,
    frameCount: 90,
    mouthOpen: 0.64
  });
  const negativeTailStartIndex = Math.max(
    negativeStartIndex,
    activityLog.frameSnapshots.length - 20
  );
  const negativeProbe = backend.getSpeakingMotionRuntimeProbe();
  assert.equal(negativeProbe.tier, "none");
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleX", negativeTailStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleY", negativeTailStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleZ", negativeTailStartIndex) < 0.12);
  assert.ok(getAbsolutePeak(activityLog, "ParamAngleX", negativeTailStartIndex) < 0.12);

  const clearExpressionReceipt = await controller.dispatchCommand({
    command_id: "pixi-clear-expression",
    command_type: "clear_expression",
    target: "expression",
    value: true,
    is_interruptible: true
  });
  assert.equal(clearExpressionReceipt.snapshot.active_expression, null);
  assert.equal(activityLog.expressionResetCount, 1);

  const settleStartIndex = activityLog.frameSnapshots.length;
  await emitSpeakingFrames({
    controller,
    backend,
    clock,
    frameCount: 24,
    mouthOpen: 0.64
  });
  assert.ok(getAbsolutePeak(activityLog, "ParamBodyAngleX", settleStartIndex) > 8);
  await emitSpeakingFrames({
    controller,
    backend,
    clock,
    frameCount: 90,
    mouthOpen: 0
  });
  assert.ok(Math.abs(getLastValue(activityLog, "ParamBodyAngleX")) < 0.2);
  assert.ok(Math.abs(getLastValue(activityLog, "ParamBodyAngleY")) < 0.2);
  assert.ok(Math.abs(getLastValue(activityLog, "ParamBodyAngleZ")) < 0.2);
  assert.ok(Math.abs(getLastValue(activityLog, "ParamAngleX")) < 0.15);

  await controller.dispatchCommand({
    command_id: "pixi-motion",
    command_type: "set_motion",
    target: "motion",
    value: "nod",
    is_interruptible: true
  });
  assert.ok(activityLog.motions.includes("nod"));

  await controller.destroy();
  assert.equal(backend._pixiTicker, null);
  assert.equal(backend._modelUpdateHookTarget, null);
  assert.equal(activityLog.destroyed, true);

  const capabilityRuntime = await createRuntime({
    missingParameters: ["ParamBodyAngleY"]
  });
  let capabilityFailureCaught = false;
  try {
    await capabilityRuntime.controller.initialize(buildManifest());
  } catch (error) {
    capabilityFailureCaught = true;
    assert.match(String(error?.message || error), /ParamBodyAngleY/);
  }
  assert.equal(capabilityFailureCaught, true);

  process.stdout.write("desktop-live2d pixi runtime self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
