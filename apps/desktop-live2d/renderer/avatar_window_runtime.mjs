import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  buildAudioPlaybackResponse,
  buildErrorEnvelope,
  buildInitializeResponse,
  buildPingResponse,
  buildShutdownResponse
} from "../bridge/protocol.mjs";
import { DesktopLive2DAudioPlaybackController } from "../shared/audio_playback_controller.mjs";
import { AudioPlaybackContractError } from "../shared/audio_playback_contracts.mjs";
import { DesktopLive2DAudioLipsyncDriver } from "../shared/audio_lipsync_driver.mjs";
import { DesktopLive2DDeviceAudioPlaybackBackend } from "../shared/dom_audio_playback_backend.mjs";
import { DesktopLive2DDomSceneHost } from "./dom_scene_host.mjs";
import { setSceneStatus } from "./scene_runtime_hooks.mjs";

function buildSceneErrorEnvelope(request, error) {
  return buildErrorEnvelope({
    requestId: request.request_id,
    bridgeCommand: request.bridge_command,
    errorCode: error.errorCode || BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
    message: error.message || "desktop-live2d avatar bridge failed",
    retryable: Boolean(error.retryable),
    commandId: error.commandId || null,
    commandType: error.commandType || null,
    rawErrorType: error.rawErrorType || null
  });
}

function buildAudioPlaybackErrorEnvelope(request, error) {
  if (error instanceof AudioPlaybackContractError) {
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
      error instanceof Error ? error.message : "desktop-live2d audio playback failed",
    retryable: false,
    rawErrorType: error instanceof Error ? error.name : typeof error
  });
}

export class DesktopLive2DAvatarWindowRuntime {
  constructor({
    stageElement,
    statusElement,
    runtimeLabelElement = null,
    runtimeDotElement = null,
    playbackLabelElement = null,
    playbackDotElement = null,
    lipsyncLabelElement = null,
    lipsyncMeterFillElement = null,
    desktopApi,
    shellInfo,
    selectedModelKey = null,
    sceneManifestUrl = null,
    sceneHost = null,
    audioLipsyncDriver = null,
    audioPlaybackController = null,
    audioPlaybackBackend = null,
    passivePreview = false,
    disableHostBridge = false
  }) {
    this._desktopApi = desktopApi;
    this._shellInfo = shellInfo;
    this._statusElement = statusElement;
    this._stageElement = stageElement;
    this._runtimeLabelElement = runtimeLabelElement;
    this._runtimeDotElement = runtimeDotElement;
    this._playbackLabelElement = playbackLabelElement;
    this._playbackDotElement = playbackDotElement;
    this._lipsyncLabelElement = lipsyncLabelElement;
    this._lipsyncMeterFillElement = lipsyncMeterFillElement;
    this._passivePreview = passivePreview;
    this._disableHostBridge = disableHostBridge;
    this._bridgeTargetAccepted = false;
    this._sceneHost =
      sceneHost ||
      new DesktopLive2DDomSceneHost({
        stageElement,
        statusElement,
        selectedModelKey,
        modelManifestUrl: sceneManifestUrl || undefined
      });
    this._audioLipsyncDriver =
      audioLipsyncDriver ||
      new DesktopLive2DAudioLipsyncDriver({
        sceneController: this._sceneHost.getController()
      });
    this._audioPlaybackController =
      audioPlaybackController ||
      new DesktopLive2DAudioPlaybackController({
        backend: audioPlaybackBackend || new DesktopLive2DDeviceAudioPlaybackBackend(),
        lipsyncDriver: this._audioLipsyncDriver
      });
    this._bootPromise = null;
    this._windowDragActive = false;
    this._boundPointerMove = null;
    this._boundPointerUp = null;
    this._boundWheel = null;
    this._boundResize = null;
  }

  async boot() {
    if (!this._passivePreview && !this._disableHostBridge) {
      const bridgeResult = await this._desktopApi.registerHostBridgeHandler(
        async (bridgeRequest) => {
          return await this.handleBridgeRequest(bridgeRequest);
        }
      );
      this._bridgeTargetAccepted = bridgeResult?.accepted === true;
      if (!this._bridgeTargetAccepted) {
        throw new Error("desktop-live2d avatar renderer was not accepted as a bridge target");
      }
    }
    if (this._stageElement && typeof this._stageElement.innerHTML === "string") {
      this._stageElement.innerHTML = "";
    }
    this._renderHud();
    await this._ensureSceneBooted();
    this._bindWindowInteractions();
  }

  buildDebugSnapshot() {
    return Object.freeze({
      shell_info: this._shellInfo,
      passive_preview: this._passivePreview,
      host_bridge_disabled: this._disableHostBridge,
      bridge_target_accepted: this._bridgeTargetAccepted,
      scene_snapshot: this._sceneHost.getController().getSnapshot(),
      audio_playback_snapshot: this._audioPlaybackController.getSnapshot(),
      audio_playback_backend: this._audioPlaybackController.getBackendDescriptor(),
      lipsync_snapshot: this._audioLipsyncDriver.getSnapshot(),
      lipsync_frame_history: this._audioLipsyncDriver.getFrameHistory()
    });
  }

  async handleBridgeRequest(request) {
    switch (request.bridge_command) {
      case BRIDGE_COMMAND.PING:
        return buildPingResponse(request.request_id);
      case BRIDGE_COMMAND.INITIALIZE:
        return await this._handleInitialize(request);
      case BRIDGE_COMMAND.DISPATCH_COMMAND:
        return await this._handleDispatchCommand(request);
      case BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT:
        return await this._handleAudioPlaybackFragment(request);
      case BRIDGE_COMMAND.AUDIO_PLAYBACK_ABORT:
        return await this._handleAudioPlaybackAbort(request);
      case BRIDGE_COMMAND.AUDIO_PLAYBACK_SNAPSHOT:
        return buildAudioPlaybackResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          playbackSnapshot: this._audioPlaybackController.getSnapshot(),
          reports: []
        });
      case BRIDGE_COMMAND.SHUTDOWN:
        await this._audioPlaybackController.destroy();
        return buildShutdownResponse(request.request_id, request.reason);
      default:
        return buildErrorEnvelope({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
          message: `unsupported avatar bridge command '${request.bridge_command}'`,
          retryable: false
        });
    }
  }

  async _ensureSceneBooted() {
    if (this._bootPromise) {
      return await this._bootPromise;
    }
    this._bootPromise = this._sceneHost
      .boot()
      .then((snapshot) => {
        setSceneStatus(
          this._statusElement,
          `${this._shellInfo.appName} ${snapshot.runtime_mode} scene ready`
        );
        this._renderHud();
        return snapshot;
      })
      .catch((error) => {
        setSceneStatus(
          this._statusElement,
          error instanceof Error ? error.message : String(error)
        );
        this._renderHud();
        throw error;
      });
    return await this._bootPromise;
  }

  async _handleInitialize(request) {
    if (request.full_body_required !== true) {
      return buildErrorEnvelope({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        errorCode: BRIDGE_ERROR_CODE.INVALID_MODEL_ASSET,
        message: "desktop-live2d avatar window requires a full-body character model",
        retryable: false
      });
    }
    await this._ensureSceneBooted();
    const manifest = this._sceneHost.getController().getManifest();
    const bridgeResolvedModelPath =
      typeof this._sceneHost.getBridgeResolvedModelPath === "function"
        ? this._sceneHost.getBridgeResolvedModelPath()
        : manifest.resolved_model_json_path;
    return buildInitializeResponse({
      requestId: request.request_id,
      modelKey: manifest.model_key,
      resolvedModelJsonPath: bridgeResolvedModelPath,
      presentationMode: manifest.presentation_mode,
      windowSurface: manifest.window_surface
    });
  }

  async _handleDispatchCommand(request) {
    try {
      await this._ensureSceneBooted();
      const receipt = await this._sceneHost.getController().dispatchCommand(request);
      this._renderHud();
      return {
        request_id: request.request_id,
        status: "ok",
        bridge_command: BRIDGE_COMMAND.DISPATCH_COMMAND,
        command_id: request.command_id,
        command_type: request.command_type,
        adapter_key: receipt.adapter_key,
        adapter_profile_key: request.adapter_profile_key,
        outcome: receipt.outcome,
        message: receipt.message
      };
    } catch (error) {
      return buildSceneErrorEnvelope(request, error);
    }
  }

  async _handleAudioPlaybackFragment(request) {
    try {
      const playbackResult = await this._audioPlaybackController.deliverFragment(request);
      this._renderHud();
      return buildAudioPlaybackResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        playbackSnapshot: playbackResult.playback_snapshot,
        reports: playbackResult.reports
      });
    } catch (error) {
      return buildAudioPlaybackErrorEnvelope(request, error);
    }
  }

  async _handleAudioPlaybackAbort(request) {
    try {
      const playbackResult = await this._audioPlaybackController.abortChunk(request);
      this._renderHud();
      return buildAudioPlaybackResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        playbackSnapshot: playbackResult.playback_snapshot,
        reports: playbackResult.reports
      });
    } catch (error) {
      return buildAudioPlaybackErrorEnvelope(request, error);
    }
  }

  _renderHud() {
    const sceneSnapshot = this._sceneHost.getController().getSnapshot();
    const playbackSnapshot = this._audioPlaybackController.getSnapshot();
    const lipsyncSnapshot = this._audioLipsyncDriver.getSnapshot();

    if (this._passivePreview) {
      if (this._runtimeLabelElement) {
        this._runtimeLabelElement.textContent = sceneSnapshot?.model_loaded
          ? "story preview"
          : "loading preview";
      }
      if (this._playbackLabelElement) {
        this._playbackLabelElement.textContent = "passive";
      }
      if (this._lipsyncLabelElement) {
        this._lipsyncLabelElement.textContent = "passive";
      }
      if (this._lipsyncMeterFillElement) {
        this._lipsyncMeterFillElement.style.width = "0%";
      }
      return;
    }

    if (this._runtimeLabelElement) {
      this._runtimeLabelElement.textContent = sceneSnapshot?.model_loaded
        ? `${sceneSnapshot.runtime_mode || "avatar"} ready`
        : "syncing";
    }
    if (this._runtimeDotElement) {
      this._runtimeDotElement.classList.toggle(
        "avatar-chip__dot--idle",
        !sceneSnapshot?.model_loaded
      );
    }
    if (this._playbackLabelElement) {
      this._playbackLabelElement.textContent = playbackSnapshot?.playback_active
        ? "speaking"
        : playbackSnapshot?.last_report_kind === "finished"
          ? "settled"
          : "silent";
    }
    if (this._playbackDotElement) {
      this._playbackDotElement.classList.toggle(
        "avatar-chip__dot--idle",
        !playbackSnapshot?.playback_active
      );
    }
    if (this._lipsyncLabelElement) {
      this._lipsyncLabelElement.textContent = lipsyncSnapshot?.lipsync_active
        ? `lipsync ${(Number(lipsyncSnapshot.current_mouth_open || 0) * 100).toFixed(0)}%`
        : playbackSnapshot?.last_report_kind === "finished"
          ? "playback settled"
          : "lipsync idle";
    }
    if (this._lipsyncMeterFillElement) {
      const width = Math.max(
        0,
        Math.min(100, Math.round(Number(lipsyncSnapshot?.current_mouth_open || 0) * 100))
      );
      this._lipsyncMeterFillElement.style.width = `${width}%`;
    }
  }

  _bindWindowInteractions() {
    if (
      !this._stageElement ||
      typeof this._stageElement.addEventListener !== "function" ||
      typeof window === "undefined" ||
      this._boundResize
    ) {
      return;
    }

    // ── Resize mode state ──
    this._resizeModeEnabled = false;
    this._layoutTunerOpen = false;
    this._windowState = null;
    this._dragPointerState = null;
    const MODEL_TAP_SUPPRESS_AFTER_DRAG_MS = 220;
    let suppressModelTapUntil = 0;

    const DEFAULT_LAYOUT = Object.freeze({
      offsetX: 0,
      offsetY: 0,
      scaleMultiplier: 1.0
    });

    const SLIDER_CONFIG = Object.freeze({
      offsetX: { min: -120, max: 120, step: 1, decimals: 0 },
      offsetY: { min: -120, max: 120, step: 1, decimals: 0 },
      scaleMultiplier: { min: 0.7, max: 1.5, step: 0.01, decimals: 2 }
    });

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const roundToStep = (value, step, decimals) => {
      const safeStep = Math.max(0.0001, Number(step) || 1);
      const safeDecimals = Math.max(0, Number(decimals) || 0);
      const rounded = Math.round(value / safeStep) * safeStep;
      return Number(rounded.toFixed(safeDecimals));
    };

    const normalizeLayoutOverrides = (layout) => {
      const input = layout && typeof layout === "object" ? layout : {};
      return {
        offsetX: roundToStep(
          clamp(Number(input.offsetX) || 0, SLIDER_CONFIG.offsetX.min, SLIDER_CONFIG.offsetX.max),
          SLIDER_CONFIG.offsetX.step, SLIDER_CONFIG.offsetX.decimals
        ),
        offsetY: roundToStep(
          clamp(Number(input.offsetY) || 0, SLIDER_CONFIG.offsetY.min, SLIDER_CONFIG.offsetY.max),
          SLIDER_CONFIG.offsetY.step, SLIDER_CONFIG.offsetY.decimals
        ),
        scaleMultiplier: roundToStep(
          clamp(
            Number.isFinite(Number(input.scaleMultiplier)) ? Number(input.scaleMultiplier) : DEFAULT_LAYOUT.scaleMultiplier,
            SLIDER_CONFIG.scaleMultiplier.min, SLIDER_CONFIG.scaleMultiplier.max
          ),
          SLIDER_CONFIG.scaleMultiplier.step, SLIDER_CONFIG.scaleMultiplier.decimals
        )
      };
    };

    let currentLayoutOverrides = normalizeLayoutOverrides(DEFAULT_LAYOUT);

    // ── Layout Tuner DOM ──
    const resizeModeCloseBtn = document.getElementById("resize-mode-close");
    const layoutTunerToggleBtn = document.getElementById("layout-tuner-toggle");
    const layoutTunerCloseBtn = document.getElementById("layout-tuner-close");
    const layoutResetBtn = document.getElementById("layout-reset");
    const layoutSaveBtn = document.getElementById("layout-save");
    const layoutStatusEl = document.getElementById("layout-tuner-status");
    const offsetXInput = document.getElementById("layout-offset-x");
    const offsetYInput = document.getElementById("layout-offset-y");
    const scaleInput = document.getElementById("layout-scale");
    const offsetXValue = document.getElementById("layout-offset-x-value");
    const offsetYValue = document.getElementById("layout-offset-y-value");
    const scaleValue = document.getElementById("layout-scale-value");

    const setLayoutStatus = (msg) => {
      if (layoutStatusEl) layoutStatusEl.textContent = String(msg || "");
    };

    const syncLayoutInputs = (layout) => {
      if (offsetXInput) offsetXInput.value = String(layout.offsetX);
      if (offsetYInput) offsetYInput.value = String(layout.offsetY);
      if (scaleInput) scaleInput.value = layout.scaleMultiplier.toFixed(2);
      if (offsetXValue) offsetXValue.textContent = String(layout.offsetX);
      if (offsetYValue) offsetYValue.textContent = String(layout.offsetY);
      if (scaleValue) scaleValue.textContent = layout.scaleMultiplier.toFixed(2);
    };

    const applyLayoutToBackend = (layout) => {
      const backend = this._sceneHost?.getController()?.getBackend?.();
      if (backend && typeof backend.setLayoutOverrides === "function") {
        backend.setLayoutOverrides(layout);
        backend.reapplyLayout();
      }
    };

    const applyLayout = (layout, statusMsg = "Unsaved changes") => {
      const normalized = normalizeLayoutOverrides(layout);
      currentLayoutOverrides = normalized;
      syncLayoutInputs(normalized);
      applyLayoutToBackend(normalized);
      setLayoutStatus(statusMsg);
      return normalized;
    };

    const readLayoutFromInputs = () => normalizeLayoutOverrides({
      offsetX: offsetXInput?.value,
      offsetY: offsetYInput?.value,
      scaleMultiplier: scaleInput?.value
    });

    // ── Click-Through State ──
    this._clickThroughEnabled = false;
    const clickThroughToggleBtn = document.getElementById("click-through-toggle");

    const updateBodyClasses = () => {
      document.body.classList.toggle("resize-mode-active", this._resizeModeEnabled);
      document.body.classList.toggle("layout-tuner-open", this._resizeModeEnabled && this._layoutTunerOpen);
      document.body.classList.toggle("click-through-active", this._clickThroughEnabled);
    };

    const applyClickThroughToMain = () => {
      if (typeof this._desktopApi?.sendWindowControl === "function") {
        this._desktopApi.sendWindowControl({
          action: "set_click_through",
          clickThrough: this._clickThroughEnabled
        });
      }
    };

    clickThroughToggleBtn?.addEventListener("click", () => {
      this._clickThroughEnabled = !this._clickThroughEnabled;
      updateBodyClasses();
      applyClickThroughToMain();
    });

    // Initialize layout inputs with defaults
    syncLayoutInputs(currentLayoutOverrides);
    applyLayoutToBackend(currentLayoutOverrides);

    // ── Resize Mode Controls ──
    resizeModeCloseBtn?.addEventListener("click", () => {
      this._resizeModeEnabled = false;
      this._layoutTunerOpen = false;
      updateBodyClasses();
      if (typeof this._desktopApi?.sendWindowControl === "function") {
        this._desktopApi.sendWindowControl({ action: "close_resize_mode" });
      }
    });

    layoutTunerToggleBtn?.addEventListener("click", () => {
      if (!this._resizeModeEnabled) return;
      this._layoutTunerOpen = !this._layoutTunerOpen;
      updateBodyClasses();
    });

    layoutTunerCloseBtn?.addEventListener("click", () => {
      this._layoutTunerOpen = false;
      updateBodyClasses();
    });

    layoutResetBtn?.addEventListener("click", () => {
      applyLayout(DEFAULT_LAYOUT, "Reset to defaults");
    });

    layoutSaveBtn?.addEventListener("click", () => {
      const normalized = applyLayout(readLayoutFromInputs(), "Saved");
      if (typeof this._desktopApi?.sendWindowControl === "function") {
        this._desktopApi.sendWindowControl({
          action: "save_layout_overrides",
          layout: normalized
        });
      }
    });

    for (const input of [offsetXInput, offsetYInput, scaleInput]) {
      input?.addEventListener("input", () => {
        applyLayout(readLayoutFromInputs());
      });
    }

    // ── Window State Sync ──
    if (typeof this._desktopApi?.onWindowStateSync === "function") {
      this._desktopApi.onWindowStateSync((payload) => {
        if (payload && typeof payload === "object") {
          this._windowState = { ...(this._windowState || {}), ...payload };
          if (typeof payload.resizeModeEnabled === "boolean") {
            this._resizeModeEnabled = payload.resizeModeEnabled;
            if (!this._resizeModeEnabled) {
              this._layoutTunerOpen = false;
            }
            updateBodyClasses();
          }
          if (typeof payload.clickThroughEnabled === "boolean") {
            this._clickThroughEnabled = payload.clickThroughEnabled;
            updateBodyClasses();
          }
        }
      });
    }

    // ── Mouse tracking ──
    this._mouseTrackingEnabled = false;
    if (typeof window.echoDesktopLive2D?.onToggleMouseTracking === "function") {
      window.echoDesktopLive2D.onToggleMouseTracking((enabled) => {
        this._mouseTrackingEnabled = enabled;
        const backend = this._sceneHost?.getController()?.getBackend?.();
        const model = backend?._loadedModel;
        if (!enabled && model) {
          const fc = model.internalModel?.focusController;
          if (fc && typeof fc.focus === "function") {
            fc.focus(0, 0, true);
          }
        }
      });
    }
    if (typeof window.echoDesktopLive2D?.onCursorScreenPosition === "function") {
      window.echoDesktopLive2D.onCursorScreenPosition((point) => {
        if (!this._mouseTrackingEnabled) return;
        const backend = this._sceneHost?.getController()?.getBackend?.();
        const model = backend?._loadedModel;
        if (model && typeof model.focus === "function") {
          model.focus(point.x, point.y);
        }
      });
    }

    this._stageElement.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      await this._desktopApi.showContextMenu();
    });

    // ── Window interactivity reporting ──
    let lastWindowInteractivity = null;
    const reportWindowInteractivity = (interactive) => {
      if (typeof this._desktopApi?.sendWindowInteractivity !== "function") return;
      // When click-through is enabled and not in resize mode, always report non-interactive
      const effective = this._clickThroughEnabled && !this._resizeModeEnabled ? false : interactive;
      const nextInteractive = effective === true;
      if (lastWindowInteractivity === nextInteractive) return;
      lastWindowInteractivity = nextInteractive;
      this._desktopApi.sendWindowInteractivity({ interactive: nextInteractive });
    };

    this._stageElement.addEventListener("mouseenter", () => {
      reportWindowInteractivity(true);
    });
    this._stageElement.addEventListener("mousemove", () => {
      reportWindowInteractivity(true);
    });
    this._stageElement.addEventListener("mouseleave", () => {
      if (!this._windowDragActive) {
        reportWindowInteractivity(false);
      }
    });

    // ── Random expression/motion on tap ──
    let expressionResetTimer = null;
    const EXPRESSION_RESET_DELAY_MS = 5000;

    const triggerRandomExpressionAndMotion = () => {
      const backend = this._sceneHost?.getController()?.getBackend?.();
      if (!backend) return;
      const manifest = backend._loadedManifest;
      if (!manifest) return;
      const expressions = manifest.supported_expressions;
      const motions = manifest.supported_motions;
      if (Array.isArray(expressions) && expressions.length > 0) {
        const randomExpr = expressions[Math.floor(Math.random() * expressions.length)];
        backend.applyExpression(null, randomExpr);
      }
      if (Array.isArray(motions) && motions.length > 0) {
        const randomMotion = motions[Math.floor(Math.random() * motions.length)];
        backend.playMotion(randomMotion);
      }
      // Reset expression back to idle after 5 seconds
      if (expressionResetTimer) clearTimeout(expressionResetTimer);
      expressionResetTimer = setTimeout(() => {
        expressionResetTimer = null;
        const b = this._sceneHost?.getController()?.getBackend?.();
        if (b && typeof b.clearExpression === "function") {
          b.clearExpression("idle");
        }
      }, EXPRESSION_RESET_DELAY_MS);
    };

    // ── Window drag gesture ──
    const MOVE_THRESHOLD_PX = 6;

    this._stageElement.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      // When click-through is on (and not in resize mode), don't handle pointer
      if (this._clickThroughEnabled && !this._resizeModeEnabled) return;

      this._dragPointerState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        startWindowWidth: Number(this._windowState?.width) || window.innerWidth || 460,
        dragging: false
      };
      if (typeof this._stageElement.setPointerCapture === "function") {
        this._stageElement.setPointerCapture(event.pointerId);
      }
      reportWindowInteractivity(true);

      if (this._resizeModeEnabled) {
        event.preventDefault();
        return;
      }
      // In normal mode (click-through OFF), begin drag
      this._desktopApi.beginWindowDrag({
        screenX: event.screenX,
        screenY: event.screenY
      });
    });

    this._stageElement.addEventListener("pointermove", (event) => {
      if (!this._dragPointerState || event.pointerId !== this._dragPointerState.pointerId) return;
      const deltaX = event.clientX - this._dragPointerState.startClientX;
      const deltaY = event.clientY - this._dragPointerState.startClientY;
      const moved = Math.hypot(deltaX, deltaY);
      if (!this._dragPointerState.dragging && moved >= MOVE_THRESHOLD_PX) {
        this._dragPointerState.dragging = true;
        this._windowDragActive = true;
      }
      if (!this._dragPointerState.dragging) return;

      if (this._resizeModeEnabled) {
        // In resize mode, drag changes window size
        const widthDelta = this._dragPointerState.startScreenX - event.screenX;
        const requestedWidth = this._dragPointerState.startWindowWidth + widthDelta;
        if (typeof this._desktopApi?.sendWindowResizeRequest === "function") {
          this._desktopApi.sendWindowResizeRequest({
            action: "set",
            width: Math.max(1, Math.round(requestedWidth)),
            persist: false,
            source: "resize-mode"
          });
        }
      } else {
        this._desktopApi.updateWindowDrag({
          screenX: event.screenX,
          screenY: event.screenY
        });
      }
      event.preventDefault();
    });

    const completeDrag = (event) => {
      if (!this._dragPointerState || event.pointerId !== this._dragPointerState.pointerId) return;
      const wasDragging = this._dragPointerState.dragging;
      if (!this._resizeModeEnabled) {
        this._desktopApi.endWindowDrag();
        // If it was a tap (no drag movement) and click-through is off, trigger random expression
        if (!wasDragging && !this._clickThroughEnabled && Date.now() > suppressModelTapUntil) {
          triggerRandomExpressionAndMotion();
        }
      } else if (wasDragging) {
        // Persist the resize
        if (typeof this._desktopApi?.sendWindowResizeRequest === "function") {
          this._desktopApi.sendWindowResizeRequest({
            action: "set",
            width: Number(this._windowState?.width) || this._dragPointerState.startWindowWidth,
            persist: true,
            source: "resize-mode"
          });
        }
      }
      if (this._dragPointerState.dragging) {
        suppressModelTapUntil = Date.now() + MODEL_TAP_SUPPRESS_AFTER_DRAG_MS;
      }
      if (typeof this._stageElement.releasePointerCapture === "function") {
        try { this._stageElement.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
      }
      this._dragPointerState = null;
      this._windowDragActive = false;
      reportWindowInteractivity(false);
    };

    this._stageElement.addEventListener("pointerup", completeDrag);
    this._stageElement.addEventListener("pointercancel", completeDrag);

    // ── Window resize handler ──
    this._boundResize = async () => {
      await this._sceneHost.setViewportMetrics({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener("blur", () => {
      if (this._dragPointerState) {
        this._dragPointerState = null;
        this._windowDragActive = false;
      }
      reportWindowInteractivity(false);
    });
    window.addEventListener("resize", this._boundResize);
    void this._boundResize();
  }
}
