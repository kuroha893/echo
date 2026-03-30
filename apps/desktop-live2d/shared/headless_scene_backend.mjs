import {
  SCENE_RUNTIME_MODE,
  buildSceneBackendDescriptor
} from "./scene_contracts.mjs";
import {
  buildVisualThemeFromStateAndExpression,
  resolveMotionPreset,
  resolveStatePreset
} from "./scene_presets.mjs";
import { computeFullBodyLayout, createDefaultViewportMetrics } from "./viewport_layout.mjs";

export class HeadlessSceneBackend {
  constructor({
    backendKey = "desktop.live2d.headless"
  } = {}) {
    this._descriptor = buildSceneBackendDescriptor({
      backendKey,
      runtimeMode: SCENE_RUNTIME_MODE.HEADLESS,
      supportsRealPixiCubism: false
    });
    this._stageMetrics = createDefaultViewportMetrics();
    this._mounted = false;
    this._loadedModel = null;
    this._mouthOpen = 0;
    this._viewportScaleMultiplier = 1;
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName: "idle",
      expressionName: null
    });
  }

  getDescriptor() {
    return this._descriptor;
  }

  getStageMetrics() {
    return this._stageMetrics;
  }

  getViewportScaleMultiplier() {
    return this._viewportScaleMultiplier;
  }

  async setViewportMetrics(viewportMetrics) {
    this._stageMetrics = createDefaultViewportMetrics();
    if (viewportMetrics && Number.isFinite(viewportMetrics.width) && Number.isFinite(viewportMetrics.height)) {
      this._stageMetrics = Object.freeze({
        width: viewportMetrics.width,
        height: viewportMetrics.height
      });
    }
    return Object.freeze({
      viewport_metrics: this._stageMetrics
    });
  }

  async mountStage() {
    this._mounted = true;
    return {
      mounted: true,
      stage_metrics: this._stageMetrics
    };
  }

  async loadModel(manifest) {
    const statePreset = resolveStatePreset("idle");
    const layout = computeFullBodyLayout({
      viewportMetrics: this._stageMetrics,
      viewportFit: manifest.viewport_fit,
      silhouetteScale: statePreset.silhouetteScale * this._viewportScaleMultiplier
    });
    this._loadedModel = Object.freeze({
      model_key: manifest.model_key,
      display_name: manifest.display_name,
      layout
    });
    return Object.freeze({
      model_key: manifest.model_key,
      layout
    });
  }

  async applyState(stateName) {
    const statePreset = resolveStatePreset(stateName);
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName,
      expressionName: null
    });
    return Object.freeze({
      state_name: stateName,
      preset: statePreset,
      visual_theme: this._visualTheme
    });
  }

  async applyExpression(stateName, expressionName) {
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName,
      expressionName
    });
    return Object.freeze({
      expression_name: expressionName,
      visual_theme: this._visualTheme
    });
  }

  async clearExpression(stateName) {
    this._visualTheme = buildVisualThemeFromStateAndExpression({
      stateName,
      expressionName: null
    });
    return Object.freeze({
      cleared: true,
      visual_theme: this._visualTheme
    });
  }

  async playMotion(motionName) {
    const motionPreset = resolveMotionPreset(motionName);
    return Object.freeze({
      motion_name: motionName,
      motion_preset: motionPreset
    });
  }

  async applyMouthOpen(mouthOpen) {
    this._mouthOpen = mouthOpen;
    return Object.freeze({
      mouth_open: this._mouthOpen
    });
  }

  async clearMouthOpen() {
    this._mouthOpen = 0;
    return Object.freeze({
      mouth_open: this._mouthOpen
    });
  }

  async setViewportScaleMultiplier(multiplier) {
    this._viewportScaleMultiplier = Math.min(2.2, Math.max(0.45, multiplier));
    return Object.freeze({
      viewport_scale_multiplier: this._viewportScaleMultiplier
    });
  }

  async destroy() {
    this._mounted = false;
    this._loadedModel = null;
    this._mouthOpen = 0;
  }
}
