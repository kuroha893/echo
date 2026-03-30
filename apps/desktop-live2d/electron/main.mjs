import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";

import { DesktopCompanionPythonHost } from "./python_companion_host.mjs";
import { DesktopWebControlPlaneServer } from "../../web-ui/control_plane_server.mjs";
import { buildDebugUpdatePayload } from "../../web-ui/public/control_plane_contracts.mjs";
import { AmbientPerceptionController } from "./ambient_perception_controller.mjs";
import {
  BRIDGE_COMMAND,
  buildCompanionSessionResponse,
} from "../bridge/protocol.mjs";
import {
  loadRegisteredModelLibrary,
  resolveRegisteredModelSelection
} from "../bridge/model_assets.mjs";
import {
  loadPersistedAvatarModelSelection,
  savePersistedAvatarModelSelection
} from "./avatar_model_selection_store.mjs";
import { MultiCompanionStoryService } from "../shared/multi_companion_story_service.mjs";
import { sanitizeStoryNarratorVisibleText } from "../shared/story_visible_text.mjs";
import { CompanionSessionStateManager } from "../shared/companion_session_state_manager.mjs";
import { StoryModeOrchestrator } from "./story_mode_orchestrator.mjs";
import { registerStoryModeIPC, unregisterStoryModeIPC } from "./story_mode_ipc.mjs";
import { persistStoryState, loadStoryState, listStoryStateSlots, archiveStoryStateSlot } from "./story_mode_persistence.mjs";
import {
  buildRendererLaunchUrl,
  buildWindowSuiteDefinitions,
  computeAvatarWindowBounds,
  computeBubbleWindowBounds,
  computeChatWindowBounds,
  DESKTOP_WINDOW_ROLE,
  isBridgeExecutionTargetRole,
  resolveBridgeTargetWindowRole
} from "./window_suite_router.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const preloadPath = path.resolve(appRoot, "electron", "preload.mjs");
const rendererRootPath = path.resolve(appRoot, "renderer");
const webUiPublicRoot = path.resolve(appRoot, "..", "web-ui", "public");
const STORY_CAST_FALLBACK_COLORS = Object.freeze([
  Object.freeze({ subtitle: "#ff7b84", timeline: "#45212b" }),
  Object.freeze({ subtitle: "#67c7ff", timeline: "#1b3446" })
]);
const STORY_NARRATOR_SUBTITLE_COLOR_DEFAULT = "#ffd782";

function normalizeHexColor(value, fallback = null) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function resolveStoryCastColor(castMember, fieldName, fallbackIndex) {
  const rawValue = castMember?.[fieldName];
  if (typeof rawValue === "string" && /^#[0-9a-f]{6}$/i.test(rawValue.trim())) {
    return rawValue.trim().toLowerCase();
  }
  const fallback = STORY_CAST_FALLBACK_COLORS[fallbackIndex] || STORY_CAST_FALLBACK_COLORS[0];
  return fieldName === "subtitle_color" ? fallback.subtitle : fallback.timeline;
}

function buildProductionVerificationSettingsPayloadFromEnvironment() {
  const openAiApiKey = process.env.ECHO_DESKTOP_OPENAI_API_KEY;
  const qwenTtsApiKey = process.env.ECHO_DESKTOP_QWEN_TTS_API_KEY;
  if (!openAiApiKey || !qwenTtsApiKey) {
    throw new Error(
      "production Electron verification requires ECHO_DESKTOP_OPENAI_API_KEY and ECHO_DESKTOP_QWEN_TTS_API_KEY"
    );
  }
  return {
    local_fast_llm:
      process.env.ECHO_DESKTOP_LOCAL_FAST_LLM_BASE_URL ||
        process.env.ECHO_DESKTOP_LOCAL_FAST_LLM_API_KEY ||
        process.env.ECHO_DESKTOP_LOCAL_FAST_INTENT_MODEL ||
        process.env.ECHO_DESKTOP_LOCAL_FAST_QUICK_MODEL ||
        process.env.ECHO_DESKTOP_LOCAL_FAST_PRIMARY_MODEL
        ? {
          base_url:
            process.env.ECHO_DESKTOP_LOCAL_FAST_LLM_BASE_URL ||
            "http://127.0.0.1:30000/v1",
          auth_mode:
            process.env.ECHO_DESKTOP_LOCAL_FAST_LLM_AUTH_MODE || "none",
          api_key_update:
            process.env.ECHO_DESKTOP_LOCAL_FAST_LLM_API_KEY
              ? {
                mode: "replace",
                replacement_text: process.env.ECHO_DESKTOP_LOCAL_FAST_LLM_API_KEY
              }
              : { mode: "keep" },
          intent_model_name:
            process.env.ECHO_DESKTOP_LOCAL_FAST_INTENT_MODEL ||
            "qwen3-4b-instruct",
          quick_model_name:
            process.env.ECHO_DESKTOP_LOCAL_FAST_QUICK_MODEL ||
            "qwen3-4b-instruct",
          local_primary_model_name:
            process.env.ECHO_DESKTOP_LOCAL_FAST_PRIMARY_MODEL ||
            "qwen3-8b-instruct",
          request_timeout_ms: Number.parseInt(
            process.env.ECHO_DESKTOP_LOCAL_FAST_TIMEOUT_MS || "4000",
            10
          )
        }
        : null,
    cloud_primary_llm: {
      base_url:
        process.env.ECHO_DESKTOP_OPENAI_BASE_URL ||
        "https://api.openai.com/v1",
      api_key_update: {
        mode: "replace",
        replacement_text: openAiApiKey
      },
      primary_model_name:
        process.env.ECHO_DESKTOP_OPENAI_PRIMARY_MODEL || "gpt-4.1-mini",
      request_timeout_ms: Number.parseInt(
        process.env.ECHO_DESKTOP_OPENAI_TIMEOUT_MS || "30000",
        10
      ),
      organization_id: process.env.ECHO_DESKTOP_OPENAI_ORG_ID || null,
      project_id: process.env.ECHO_DESKTOP_OPENAI_PROJECT_ID || null
    },
    qwen_tts: {
      base_url:
        process.env.ECHO_DESKTOP_QWEN_TTS_BASE_URL ||
        "https://dashscope.aliyuncs.com/api/v1",
      api_key_update: {
        mode: "replace",
        replacement_text: qwenTtsApiKey
      },
      request_timeout_ms: Number.parseInt(
        process.env.ECHO_DESKTOP_QWEN_TTS_TIMEOUT_MS || "30000",
        10
      ),
      standard_model_id:
        process.env.ECHO_DESKTOP_QWEN_TTS_STANDARD_MODEL ||
        "qwen3-tts-flash",
      standard_voice_id:
        process.env.ECHO_DESKTOP_QWEN_TTS_STANDARD_VOICE || "Cherry",
      realtime_model_id: process.env.ECHO_DESKTOP_QWEN_TTS_REALTIME_MODEL || null,
      realtime_voice_id: process.env.ECHO_DESKTOP_QWEN_TTS_REALTIME_VOICE || null,
      preferred_media_type:
        process.env.ECHO_DESKTOP_QWEN_TTS_MEDIA_TYPE ||
        "audio/pcm;encoding=s16le",
      voice_profile_key:
        process.env.ECHO_DESKTOP_QWEN_TTS_VOICE_PROFILE_KEY ||
        "desktop.qwen3.current_voice",
      voice_display_name:
        process.env.ECHO_DESKTOP_QWEN_TTS_VOICE_DISPLAY_NAME || "Desktop Voice",
      provider_profile_key:
        process.env.ECHO_DESKTOP_QWEN_TTS_PROVIDER_PROFILE_KEY ||
        "desktop.qwen3.default_profile"
    }
  };
}

async function delay(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function importElectron() {
  try {
    return await import("electron");
  } catch {
    throw new Error(
      "Electron is not installed. Run this app shell only after installing apps/desktop-live2d dependencies."
    );
  }
}

async function runDesktopLive2DApp() {
  const electron = await importElectron();
  const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = electron;
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

  let suiteDefinitions = null;
  let currentAvatarModelSelection = null;
  const suiteWindows = new Map();
  const activeWindowDrags = new Map();
  const rendererBridgeReadyRoles = new Set();
  const rendererBridgeReadyWindowIds = new Set();
  const pendingRendererBridgeWaiters = new Map();
  const rendererBridgeLog = {
    dispatchedCommandCount: 0,
    lastPlaybackReportKinds: [],
    lastBubbleText: null,
    lastAssistantTranscriptText: null
  };
  let latestBubbleOverlayPayload = null;
  let latestBubbleOverlayReplayToken = 0;
  let bubbleWindowInteractive = false;
  let avatarWindowInteractive = false;
  let companionHost = null;
  let webControlPlaneServer = null;
  let appTray = null;
  let mouseTrackingInterval = null;
  let ambientPerceptionController = null;
  let ambientPerceptionEnabled = false;
  let turnInProgress = false;
  let speakingMotionEnabled = false;
  let storyNarratorSubtitleColor = STORY_NARRATOR_SUBTITLE_COLOR_DEFAULT;
  let consoleWindow = null;
  let storyService = null;
  let storyOrchestrator = null;
  const storyCastAvatarWindows = new Map();
  let storyDesktopCastState = null;
  const storyShadowSessionManager = new CompanionSessionStateManager();

  function getWorkspaceRoot() {
    return path.resolve(appRoot, "..", "..");
  }

  function toWorkspaceRelativePath(resolvedPath) {
    return path.relative(getWorkspaceRoot(), resolvedPath).replaceAll("\\", "/");
  }

  function buildModelPersonaFilePath(modelSelection) {
    return path.join(
      path.dirname(modelSelection.resolved_scene_manifest_path),
      "persona.md"
    );
  }

  async function readModelPersonaMetadata(modelSelection) {
    const personaFilePath = buildModelPersonaFilePath(modelSelection);
    let personaText = "";
    try {
      personaText = await readFile(personaFilePath, "utf8");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        throw error;
      }
    }
    const hasPersona = personaText.trim() !== "";
    return Object.freeze({
      has_persona: hasPersona,
      persona_repo_relative_path: hasPersona
        ? toWorkspaceRelativePath(personaFilePath)
        : null
    });
  }

  function buildAvatarLaunchUrlForSelection(
    modelSelection,
    { passivePreview = false, disableHostBridge = false } = {}
  ) {
    const launchUrl = new URL(
      buildRendererLaunchUrl(rendererRootPath, DESKTOP_WINDOW_ROLE.AVATAR)
    );
    const sceneManifestUrl = pathToFileURL(
      modelSelection.resolved_scene_manifest_path
    ).toString();
    launchUrl.searchParams.set("modelKey", modelSelection.model_key);
    launchUrl.searchParams.set("sceneManifestUrl", sceneManifestUrl);
    if (passivePreview) {
      launchUrl.searchParams.set("passivePreview", "1");
    }
    if (disableHostBridge) {
      launchUrl.searchParams.set("disableHostBridge", "1");
    }
    return launchUrl.toString();
  }

  async function ensureCurrentAvatarModelSelection() {
    if (currentAvatarModelSelection) {
      return currentAvatarModelSelection;
    }
    const persistedSelection = await loadPersistedAvatarModelSelection({
      userDataDirectory: app.getPath("userData"),
      workspaceRoot: getWorkspaceRoot()
    });
    currentAvatarModelSelection = persistedSelection.model;
    return currentAvatarModelSelection;
  }

  async function ensureSuiteDefinitions() {
    const selectedModel = await ensureCurrentAvatarModelSelection();
    suiteDefinitions = buildWindowSuiteDefinitions({
      preloadPath,
      rendererRootPath,
      roleLaunchUrlOverrides: {
        [DESKTOP_WINDOW_ROLE.AVATAR]:
          buildAvatarLaunchUrlForSelection(selectedModel)
      }
    });
    return suiteDefinitions;
  }

  async function buildAvatarModelLibraryPayload() {
    const [library, selectedModel] = await Promise.all([
      loadRegisteredModelLibrary({
        workspaceRoot: getWorkspaceRoot()
      }),
      ensureCurrentAvatarModelSelection()
    ]);
    const models = await Promise.all(
      library.models.map(async (model) => {
        const personaMetadata = await readModelPersonaMetadata(model);
        return {
          model_key: model.model_key,
          display_name: model.display_name,
          presentation_mode: model.presentation_mode,
          window_surface: model.window_surface,
          supported_states: model.supported_states,
          supported_expressions: model.supported_expressions,
          supported_motions: model.supported_motions,
          has_persona: personaMetadata.has_persona,
          persona_repo_relative_path: personaMetadata.persona_repo_relative_path
        };
      })
    );
    return Object.freeze({
      default_model_key: library.default_model_key,
      selected_model_key: selectedModel.model_key,
      models
    });
  }

  async function loadModelPersonaThroughAppConfig(modelKey) {
    const resolvedSelection = await resolveRegisteredModelSelection({
      workspaceRoot: getWorkspaceRoot(),
      modelKey
    });
    const personaPath = path.join(
      path.dirname(resolvedSelection.resolved_scene_manifest_path),
      "persona.md"
    );
    let text = "";
    let exists = true;
    try {
      text = await readFile(personaPath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        exists = false;
      } else {
        throw error;
      }
    }
    return Object.freeze({
      model_key: resolvedSelection.model_key,
      display_name: resolvedSelection.display_name,
      exists,
      persona_text: text
    });
  }

  async function saveModelPersonaThroughAppConfig({ modelKey, personaText }) {
    const resolvedSelection = await resolveRegisteredModelSelection({
      workspaceRoot: getWorkspaceRoot(),
      modelKey
    });
    const personaPath = path.join(
      path.dirname(resolvedSelection.resolved_scene_manifest_path),
      "persona.md"
    );
    await mkdir(path.dirname(personaPath), { recursive: true });
    const normalizedText = String(personaText ?? "").replaceAll("\r\n", "\n");
    await writeFile(personaPath, normalizedText, "utf8");
    return Object.freeze({
      model_key: resolvedSelection.model_key,
      display_name: resolvedSelection.display_name,
      exists: true,
      persona_text: normalizedText
    });
  }

  function getWindowRoleForWebContents(webContents) {
    for (const [role, browserWindow] of suiteWindows.entries()) {
      if (
        browserWindow &&
        !browserWindow.isDestroyed() &&
        browserWindow.webContents.id === webContents.id
      ) {
        return role;
      }
    }
    return null;
  }

  function findStoryCastWindowEntryByWebContents(webContents) {
    for (const [castMemberId, browserWindow] of storyCastAvatarWindows.entries()) {
      if (
        browserWindow &&
        !browserWindow.isDestroyed() &&
        browserWindow.webContents.id === webContents.id
      ) {
        return { castMemberId, browserWindow };
      }
    }
    return null;
  }

  function isStoryCastWindowWebContents(webContents) {
    return findStoryCastWindowEntryByWebContents(webContents) !== null;
  }

  function getWindowForRole(role) {
    const browserWindow = suiteWindows.get(role) || null;
    if (!browserWindow || browserWindow.isDestroyed()) {
      throw new Error(`desktop-live2d ${role} window is unavailable`);
    }
    return browserWindow;
  }

  async function applyCurrentAvatarModelToWindow() {
    const avatarWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
    if (!avatarWindow || avatarWindow.isDestroyed()) {
      return;
    }
    const selectedModel = await ensureCurrentAvatarModelSelection();
    const nextLaunchUrl = buildAvatarLaunchUrlForSelection(selectedModel);
    if (avatarWindow.webContents.getURL() === nextLaunchUrl) {
      return;
    }
    rendererBridgeReadyRoles.delete(DESKTOP_WINDOW_ROLE.AVATAR);
    rejectPendingRendererBridgeWaitersForRole(
      DESKTOP_WINDOW_ROLE.AVATAR,
      "desktop-live2d avatar window is reloading for a different registered model"
    );
    await avatarWindow.loadURL(nextLaunchUrl);
  }

  function buildStoryPeerAvatarBounds({
    avatarBounds,
    display,
    width = 320,
    height = 440,
    gap = 18
  }) {
    const workArea = display?.workArea;
    if (!workArea) {
      return {
        width,
        height,
        x: avatarBounds.x,
        y: avatarBounds.y
      };
    }

    const preferredY = clamp(
      avatarBounds.y - Math.round(height * 0.2),
      workArea.y + 8,
      workArea.y + workArea.height - height - 8
    );
    const rightX = avatarBounds.x + avatarBounds.width + gap;
    const leftX = avatarBounds.x - width - gap;
    let x = rightX;
    if (x + width > workArea.x + workArea.width - 8) {
      x = leftX;
    }
    if (x < workArea.x + 8) {
      x = clamp(
        avatarBounds.x + Math.round((avatarBounds.width - width) / 2),
        workArea.x + 8,
        workArea.x + workArea.width - width - 8
      );
    }
    return {
      width,
      height,
      x,
      y: preferredY
    };
  }

  function closeStoryCastAvatarWindows(exceptCastMemberIds = []) {
    const allowedIds = new Set(exceptCastMemberIds);
    for (const [castMemberId, browserWindow] of storyCastAvatarWindows.entries()) {
      if (allowedIds.has(castMemberId)) {
        continue;
      }
      if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.close();
      }
      storyCastAvatarWindows.delete(castMemberId);
    }
  }

  function buildStoryDesktopCastEntry(castMember, modelSelection, castIndex) {
    return Object.freeze({
      cast_member_id: castMember.cast_member_id,
      display_name: castMember.display_name,
      model_key: modelSelection.model_key,
      model_selection: modelSelection,
      subtitle_color: resolveStoryCastColor(castMember, "subtitle_color", castIndex),
      timeline_color: resolveStoryCastColor(castMember, "timeline_color", castIndex)
    });
  }

  async function resolveStoryCastModelSelection(castMember) {
    const explicitModelKey =
      typeof castMember?.model_profile_ref === "string"
        ? castMember.model_profile_ref.trim()
        : "";
    if (explicitModelKey) {
      return await resolveRegisteredModelSelection({
        workspaceRoot: getWorkspaceRoot(),
        modelKey: explicitModelKey
      });
    }

    const personaProfileRef =
      typeof castMember?.persona_profile_ref === "string"
        ? castMember.persona_profile_ref.trim().replaceAll("\\", "/")
        : "";
    if (personaProfileRef) {
      const pathMatch = personaProfileRef.match(/\/assets\/models\/([^/]+)\/persona\.md$/i);
      if (pathMatch?.[1]) {
        return await resolveRegisteredModelSelection({
          workspaceRoot: getWorkspaceRoot(),
          modelKey: pathMatch[1]
        });
      }
    }

    const library = await loadRegisteredModelLibrary({
      workspaceRoot: getWorkspaceRoot()
    });
    for (const model of library.models) {
      const personaMetadata = await readModelPersonaMetadata(model);
      if (
        personaProfileRef &&
        personaMetadata.persona_repo_relative_path === personaProfileRef
      ) {
        return model;
      }
      if (
        typeof castMember?.display_name === "string" &&
        castMember.display_name.trim() !== "" &&
        model.display_name === castMember.display_name.trim()
      ) {
        return model;
      }
    }

    throw new Error(
      `story cast '${castMember?.display_name || "unknown"}' is missing model_profile_ref and could not be mapped to a registered model`
    );
  }

  function getAllAvatarWindows() {
    const windows = [];
    const mainAvatarWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
    if (mainAvatarWindow && !mainAvatarWindow.isDestroyed()) {
      windows.push(mainAvatarWindow);
    }
    for (const browserWindow of storyCastAvatarWindows.values()) {
      if (browserWindow && !browserWindow.isDestroyed()) {
        windows.push(browserWindow);
      }
    }
    return windows;
  }

  function getStoryCastWindowForCastMemberId(castMemberId) {
    if (!storyDesktopCastState || !castMemberId) {
      return null;
    }
    if (storyDesktopCastState.primary_cast_member_id === castMemberId) {
      return suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
    }
    return storyCastAvatarWindows.get(castMemberId) || null;
  }

  async function ensureStoryCastAvatarWindow(castEntry, bounds) {
    let storyWindow = storyCastAvatarWindows.get(castEntry.cast_member_id) || null;
    if (!storyWindow || storyWindow.isDestroyed()) {
      const avatarDefinition = suiteDefinitions[DESKTOP_WINDOW_ROLE.AVATAR];
      const avatarOptions = avatarDefinition.browserWindowOptions;
      storyWindow = new BrowserWindow({
        ...avatarOptions,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });
      storyWindow.setTitle(`Echo Story Cast: ${castEntry.display_name}`);
      setWindowClickThrough(storyWindow, false);
      const storyWindowWebContentsId = storyWindow.webContents.id;
      storyWindow.once("ready-to-show", () => {
        if (storyWindow && !storyWindow.isDestroyed()) {
          storyWindow.show();
        }
      });
      storyWindow.on("closed", () => {
        rendererBridgeReadyWindowIds.delete(storyWindowWebContentsId);
        storyCastAvatarWindows.delete(castEntry.cast_member_id);
      });
      storyCastAvatarWindows.set(castEntry.cast_member_id, storyWindow);
    }
    return storyWindow;
  }

  async function syncStoryDesktopCastWindows({ castMembers, activeCastMemberId = null }) {
    if (!Array.isArray(castMembers) || castMembers.length !== 2) {
      throw new Error("story desktop rendering requires exactly 2 cast members");
    }

    const castEntries = await Promise.all(
      castMembers.map(async (castMember, castIndex) => {
        const modelSelection = await resolveStoryCastModelSelection(castMember);
        return buildStoryDesktopCastEntry(castMember, modelSelection, castIndex);
      })
    );

    const primaryEntry = castEntries[0];
    const activeEntry =
      castEntries.find((entry) => entry.cast_member_id === activeCastMemberId) ||
      primaryEntry;
    const avatarWindow = getWindowForRole(DESKTOP_WINDOW_ROLE.AVATAR);
    const primaryLaunchUrl = buildAvatarLaunchUrlForSelection(primaryEntry.model_selection);
    const windowsToAwaitBridgeReady = [];
    if (avatarWindow.webContents.getURL() !== primaryLaunchUrl) {
      rendererBridgeReadyRoles.delete(DESKTOP_WINDOW_ROLE.AVATAR);
      rendererBridgeReadyWindowIds.delete(avatarWindow.webContents.id);
      rejectPendingRendererBridgeWaitersForRole(
        DESKTOP_WINDOW_ROLE.AVATAR,
        "desktop-live2d avatar window is reloading for story mode cast binding"
      );
      await avatarWindow.loadURL(primaryLaunchUrl);
      windowsToAwaitBridgeReady.push(avatarWindow);
    }

    const peerEntries = castEntries.filter(
      (entry) => entry.cast_member_id !== primaryEntry.cast_member_id
    );
    if (peerEntries.length > 0) {
      const avatarBounds = avatarWindow.getBounds();
      const display = resolveDisplayForBounds(avatarBounds);
      const peerBounds = buildStoryPeerAvatarBounds({
        avatarBounds,
        display
      });
      const peerEntry = peerEntries[0];
      const peerWindow = await ensureStoryCastAvatarWindow(peerEntry, peerBounds);
      const peerLaunchUrl = buildAvatarLaunchUrlForSelection(
        peerEntry.model_selection
      );
      if (peerWindow.webContents.getURL() !== peerLaunchUrl) {
        rendererBridgeReadyWindowIds.delete(peerWindow.webContents.id);
        await peerWindow.loadURL(peerLaunchUrl);
        windowsToAwaitBridgeReady.push(peerWindow);
      } else if (!rendererBridgeReadyWindowIds.has(peerWindow.webContents.id)) {
        windowsToAwaitBridgeReady.push(peerWindow);
      }
    }
    closeStoryCastAvatarWindows(castEntries.map((entry) => entry.cast_member_id));

    // Wait for all reloaded windows to signal bridge readiness before
    // returning, so that subsequent bridge requests (INITIALIZE, etc.) from
    // the Python runtime do not hit "renderer bridge handler is not ready yet".
    for (const win of windowsToAwaitBridgeReady) {
      if (win.isDestroyed()) continue;
      const wcId = win.webContents.id;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (rendererBridgeReadyWindowIds.has(wcId)) break;
        await delay(100);
      }
    }

    storyDesktopCastState = Object.freeze({
      primary_cast_member_id: primaryEntry.cast_member_id,
      active_cast_member_id: activeEntry.cast_member_id,
      cast_entries: Object.freeze(castEntries)
    });
    publishControlPlaneDebug("story_mode", "desktop_cast_windows_synced", {
      active_cast_member_id: activeEntry.cast_member_id,
      cast_model_keys: castEntries.map((entry) => entry.model_key)
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resolveDisplayForBounds(bounds) {
    if (screen?.getDisplayMatching && bounds) {
      try {
        const matched = screen.getDisplayMatching(bounds);
        if (matched?.workArea) {
          return matched;
        }
      } catch {
        // ignore Electron display lookup failures
      }
    }
    return screen?.getPrimaryDisplay?.() || null;
  }

  function clampWindowBoundsToWorkArea({
    bounds,
    display,
    minWidth = 120,
    minHeight = 160,
    maxWidth = Number.POSITIVE_INFINITY,
    maxHeight = Number.POSITIVE_INFINITY,
    margin = 8,
    maxOffscreenRatio = 0.8,
    aspectRatio = null
  }) {
    const workArea = display?.workArea || null;
    if (!workArea) {
      return bounds;
    }

    const safeAspectRatio =
      Number.isFinite(Number(aspectRatio)) && Number(aspectRatio) > 0
        ? Number(aspectRatio)
        : null;
    const rawWidth = Math.max(1, Math.round(Number(bounds.width) || minWidth));
    const rawHeight = Math.max(1, Math.round(Number(bounds.height) || minHeight));
    const safeMinWidth = Math.max(1, Math.round(Number(minWidth) || 1));
    const safeMinHeight = Math.max(1, Math.round(Number(minHeight) || 1));
    const safeMaxWidth = Math.max(
      safeMinWidth,
      Math.round(Number.isFinite(maxWidth) ? maxWidth : rawWidth)
    );
    const safeMaxHeight = Math.max(
      safeMinHeight,
      Math.round(Number.isFinite(maxHeight) ? maxHeight : rawHeight)
    );
    const safeMaxOffscreenRatio = clamp(Number(maxOffscreenRatio) || 0, 0, 0.95);
    const minVisibleRatio = Math.max(0.05, 1 - safeMaxOffscreenRatio);
    const maxVisibleWidth = Math.max(1, Math.round(workArea.width - margin * 2));
    const maxVisibleHeight = Math.max(1, Math.round(workArea.height - margin * 2));
    const maxAllowedWidth = Math.max(1, Math.round(maxVisibleWidth / minVisibleRatio));
    const maxAllowedHeight = Math.max(1, Math.round(maxVisibleHeight / minVisibleRatio));
    const effectiveMinWidth = Math.min(safeMinWidth, maxVisibleWidth);
    const effectiveMinHeight = Math.min(safeMinHeight, maxVisibleHeight);

    let width;
    let height;
    if (safeAspectRatio) {
      const baseWidth = Math.max(1, rawWidth);
      const baseHeight = Math.max(1, rawHeight);
      const minScale = Math.max(
        effectiveMinWidth / baseWidth,
        effectiveMinHeight / baseHeight
      );
      const maxScale = Math.min(
        Math.min(safeMaxWidth, maxAllowedWidth) / baseWidth,
        Math.min(safeMaxHeight, maxAllowedHeight) / baseHeight
      );
      const safeScale = clamp(1, minScale, maxScale);
      width = Math.max(1, Math.round(baseWidth * safeScale));
      height = Math.max(1, Math.round(baseHeight * safeScale));
    } else {
      width = clamp(rawWidth, effectiveMinWidth, Math.min(safeMaxWidth, maxAllowedWidth));
      height = clamp(rawHeight, effectiveMinHeight, Math.min(safeMaxHeight, maxAllowedHeight));
    }

    const minVisibleWidth = Math.min(
      maxVisibleWidth,
      Math.max(1, Math.round(width * minVisibleRatio))
    );
    const minVisibleHeight = Math.min(
      maxVisibleHeight,
      Math.max(1, Math.round(height * minVisibleRatio))
    );
    const minX = Math.round(workArea.x + margin - width + minVisibleWidth);
    const minY = Math.round(workArea.y + margin - height + minVisibleHeight);
    const maxX = Math.round(workArea.x + workArea.width - margin - minVisibleWidth);
    const maxY = Math.round(workArea.y + workArea.height - margin - minVisibleHeight);

    return {
      x: clamp(Math.round(Number(bounds.x) || minX), minX, maxX),
      y: clamp(Math.round(Number(bounds.y) || minY), minY, maxY),
      width,
      height
    };
  }

  function clearWindowDragState(webContentsId) {
    activeWindowDrags.delete(webContentsId);
  }

  function setWindowClickThrough(browserWindow, interactive) {
    if (!browserWindow || browserWindow.isDestroyed()) {
      return;
    }
    if (typeof browserWindow.setIgnoreMouseEvents !== "function") {
      return;
    }
    browserWindow.setIgnoreMouseEvents(!interactive, interactive ? undefined : { forward: true });
  }

  function setBubbleWindowInteractive(interactive) {
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      bubbleWindowInteractive = false;
      return;
    }
    if (bubbleWindowInteractive === interactive) {
      return;
    }
    bubbleWindowInteractive = interactive;
    setWindowClickThrough(bubbleWindow, interactive);
    bubbleWindow.webContents.send("echo-desktop-live2d:bubble-interaction-mode", {
      interactive
    });
  }

  function setAvatarWindowInteractive(interactive) {
    const avatarWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
    if (!avatarWindow || avatarWindow.isDestroyed()) {
      avatarWindowInteractive = false;
      return;
    }
    // In resize mode, never allow the window to become non-interactive
    if (avatarResizeModeEnabled && !interactive) {
      return;
    }
    const nextInteractive = interactive === true;
    if (avatarWindowInteractive === nextInteractive) {
      return;
    }
    avatarWindowInteractive = nextInteractive;
    setWindowClickThrough(avatarWindow, nextInteractive);
  }

  function setAvatarWindowInteractiveForWindow(browserWindow, interactive) {
    if (!browserWindow || browserWindow.isDestroyed()) {
      return;
    }
    if (avatarResizeModeEnabled && !interactive) {
      return;
    }
    setWindowClickThrough(browserWindow, interactive === true);
  }

  let avatarResizeModeEnabled = false;
  let avatarClickThroughEnabled = false;

  function sendAvatarWindowStateSync() {
    const definition = suiteDefinitions[DESKTOP_WINDOW_ROLE.AVATAR];
    const defaultWidth = definition?.browserWindowOptions?.width || 460;
    const defaultHeight = definition?.browserWindowOptions?.height || 620;
    const aspectRatio = defaultWidth / Math.max(1, defaultHeight);
    for (const avatarWindow of getAllAvatarWindows()) {
      const bounds = avatarWindow.getBounds();
      avatarWindow.webContents.send("echo-desktop-live2d:window-state-sync", {
        resizeModeEnabled: avatarResizeModeEnabled,
        clickThroughEnabled: avatarClickThroughEnabled,
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        defaultWidth,
        defaultHeight,
        minWidth: definition?.browserWindowOptions?.minWidth || 180,
        minHeight: definition?.browserWindowOptions?.minHeight || 260,
        maxWidth: definition?.browserWindowOptions?.maxWidth || 900,
        maxHeight: definition?.browserWindowOptions?.maxHeight || 1400,
        aspectRatio
      });
    }
  }

  function toggleAvatarResizeMode() {
    avatarResizeModeEnabled = !avatarResizeModeEnabled;
    if (avatarResizeModeEnabled) {
      for (const avatarWindow of getAllAvatarWindows()) {
        avatarWindow.setIgnoreMouseEvents(false);
      }
      avatarWindowInteractive = true;
    }
    sendAvatarWindowStateSync();
  }

  function handleAvatarWindowResizeRequest(payload, browserWindow = null) {
    const avatarWindow = browserWindow || suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
    if (!avatarWindow || avatarWindow.isDestroyed()) return;
    const definition = suiteDefinitions[DESKTOP_WINDOW_ROLE.AVATAR];
    const defaultWidth = definition?.browserWindowOptions?.width || 460;
    const defaultHeight = definition?.browserWindowOptions?.height || 620;
    const aspectRatio = defaultWidth / Math.max(1, defaultHeight);
    const requestedWidth = Number(payload?.width);
    if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) return;
    const minW = definition?.browserWindowOptions?.minWidth || 180;
    const maxW = definition?.browserWindowOptions?.maxWidth || 900;
    const minH = definition?.browserWindowOptions?.minHeight || 260;
    const maxH = definition?.browserWindowOptions?.maxHeight || 1400;
    const clampedWidth = Math.max(minW, Math.min(maxW, Math.round(requestedWidth)));
    const clampedHeight = Math.max(minH, Math.min(maxH, Math.round(clampedWidth / aspectRatio)));
    const bounds = avatarWindow.getBounds();
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const nextBounds = clampWindowBoundsToWorkArea({
      bounds: {
        x: Math.round(right - clampedWidth),
        y: Math.round(bottom - clampedHeight),
        width: clampedWidth,
        height: clampedHeight
      },
      display: resolveDisplayForBounds({
        x: Math.round(right - clampedWidth),
        y: Math.round(bottom - clampedHeight),
        width: clampedWidth,
        height: clampedHeight
      }),
      minWidth: minW,
      minHeight: minH,
      maxWidth: maxW,
      maxHeight: maxH,
      margin: 8,
      maxOffscreenRatio: 0.8,
      aspectRatio
    });
    avatarWindow.setBounds(nextBounds, false);
    if ((suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null) === avatarWindow) {
      positionCompanionWindowsForAvatarBounds(nextBounds);
    }
    sendAvatarWindowStateSync();
  }

  function normalizeWindowInteractivityPayload(payload) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    if (typeof payload.interactive !== "boolean") {
      return null;
    }
    return {
      interactive: payload.interactive
    };
  }

  async function applyLatestBubbleOverlayPayloadToWindow(bubbleWindow, attempt = 0, replayToken = null) {
    if (!bubbleWindow || bubbleWindow.isDestroyed() || !latestBubbleOverlayPayload) {
      return;
    }
    const payload = { ...latestBubbleOverlayPayload };
    const activeReplayToken = replayToken ?? ++latestBubbleOverlayReplayToken;
    try {
      bubbleWindow.webContents.send("echo-desktop-live2d:bubble-text", payload);
    } catch (error) {
      process.stderr.write(
        `[desktop-live2d bubble replay] ipc send failed attempt=${attempt} error=${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    let applyResult = null;
    try {
      applyResult = await bubbleWindow.webContents.executeJavaScript(
        `(() => {
          const bootStage = globalThis.__echoDesktopLive2DBootStage || null;
          const hasApplyBubbleText = typeof globalThis.__echoDesktopApplyBubbleText === "function";
          const hasBubbleShell = Boolean(document?.querySelector?.(".bubble-shell"));
          if (hasApplyBubbleText) {
            globalThis.__echoDesktopApplyBubbleText(${JSON.stringify(payload)});
          }
          return {
            applied: hasApplyBubbleText,
            bootStage,
            hasApplyBubbleText,
            hasBubbleShell
          };
        })()`,
        true
      );
    } catch (error) {
      process.stderr.write(
        `[desktop-live2d bubble replay] executeJavaScript failed attempt=${attempt} error=${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    process.stderr.write(
      `[desktop-live2d bubble replay] attempt=${attempt} applied=${applyResult?.applied === true} stage=${String(applyResult?.bootStage || "unknown")} shell=${applyResult?.hasBubbleShell === true} textLength=${payload.text.length}\n`
    );
    syncBubbleWindowVisibilityFromResponse({
      bubble_visible: true,
      bubble_text: payload.text,
    });
    if (applyResult?.applied === true) {
      return;
    }
    if (attempt >= 6) {
      return;
    }
    setTimeout(() => {
      if (
        replayToken !== null &&
        activeReplayToken !== latestBubbleOverlayReplayToken
      ) {
        return;
      }
      if (!latestBubbleOverlayPayload || latestBubbleOverlayPayload.text !== payload.text) {
        return;
      }
      void applyLatestBubbleOverlayPayloadToWindow(
        bubbleWindow,
        attempt + 1,
        activeReplayToken
      );
    }, attempt === 0 ? 80 : 180);
  }

  async function scheduleBubbleOverlayHide(delayMs = 5000) {
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    try {
      await bubbleWindow.webContents.executeJavaScript(
        `globalThis.__echoDesktopBubbleScheduleOverlayHide?.(${Math.max(0, Math.round(delayMs))});`,
        true
      );
    } catch (error) {
      process.stderr.write(
        `[desktop-live2d bubble overlay hide] failed error=${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }

  async function showStoryNarratorBubbleText(text, { speakerLabel = "旁白", speakerColor = null } = {}) {
    if (typeof text !== "string" || text.trim() === "") {
      return;
    }
    const visibleText = sanitizeStoryNarratorVisibleText(text);
    if (visibleText === "") {
      return;
    }
    latestBubbleOverlayPayload = {
      text: visibleText,
      isStreaming: false,
      speakerLabel,
      speakerColor: normalizeHexColor(speakerColor, storyNarratorSubtitleColor)
    };
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    await applyLatestBubbleOverlayPayloadToWindow(bubbleWindow);
    await scheduleBubbleOverlayHide(5000);
  }

  async function showStoryCastBubbleText(text, castMemberId) {
    if (typeof text !== "string" || text.trim() === "") {
      return;
    }
    const activeCastEntry = storyDesktopCastState?.cast_entries?.find(
      (entry) => entry.cast_member_id === castMemberId
    ) || storyDesktopCastState?.cast_entries?.[0] || null;
    latestBubbleOverlayPayload = {
      text: text.trim(),
      isStreaming: false,
      speakerLabel: activeCastEntry?.display_name || "Echo",
      speakerColor: activeCastEntry?.subtitle_color || null
    };
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    await applyLatestBubbleOverlayPayloadToWindow(bubbleWindow);
    await scheduleBubbleOverlayHide(5000);
  }

  async function syncBubbleTextFromAssistantTranscript(bridgeRequest) {
    if (storyOrchestrator) {
      return;
    }
    if (
      bridgeRequest?.bridge_command !== BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT ||
      bridgeRequest?.role !== "assistant"
    ) {
      return;
    }
    if (typeof bridgeRequest.text !== "string" || bridgeRequest.text.trim() === "") {
      return;
    }
    const activeCastEntry = storyDesktopCastState?.cast_entries?.find(
      (entry) => entry.cast_member_id === storyDesktopCastState?.active_cast_member_id
    ) || null;
    latestBubbleOverlayPayload = {
      text: bridgeRequest.text,
      isStreaming: bridgeRequest.is_streaming === true,
      speakerLabel: activeCastEntry?.display_name || "Echo",
      speakerColor: activeCastEntry?.subtitle_color || null
    };
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    await applyLatestBubbleOverlayPayloadToWindow(bubbleWindow);
  }

  function positionCompanionWindowsForAvatarBounds(avatarBounds) {
    const display = resolveDisplayForBounds(avatarBounds);
    const chatWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.CHAT) || null;
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    const chatDefinition = suiteDefinitions[DESKTOP_WINDOW_ROLE.CHAT];
    const bubbleDefinition = suiteDefinitions[DESKTOP_WINDOW_ROLE.BUBBLE];

    if (chatWindow && !chatWindow.isDestroyed()) {
      const chatBounds = computeChatWindowBounds({
        avatarBounds,
        chatWidth: chatDefinition.browserWindowOptions.width,
        chatHeight: chatDefinition.browserWindowOptions.height,
        display
      });
      chatWindow.setBounds(chatBounds, false);
    }
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      const bubbleBounds = computeBubbleWindowBounds({
        avatarBounds,
        bubbleWidth: bubbleDefinition.browserWindowOptions.width,
        bubbleHeight: bubbleDefinition.browserWindowOptions.height,
        display
      });
      bubbleWindow.setBounds(bubbleBounds, false);
    }
  }

  function hideBubbleWindow() {
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    if (bubbleWindow.isVisible()) {
      bubbleWindow.hide();
    }
  }

  function syncBubbleWindowVisibilityFromResponse(response) {
    const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
    if (!bubbleWindow || bubbleWindow.isDestroyed()) {
      return;
    }
    const hasText =
      typeof response?.bubble_text === "string" &&
      response.bubble_text.trim().length > 0;
    const shouldShow = response?.bubble_visible === true && hasText;
    if (shouldShow) {
      if (!bubbleWindow.isVisible()) {
        if (typeof bubbleWindow.showInactive === "function") {
          bubbleWindow.showInactive();
        } else {
          bubbleWindow.show();
        }
      }
      bubbleWindow.moveTop();
      return;
    }
  }

  function rejectPendingRendererBridgeWaitersForRole(role, reason) {
    for (const [requestId, waiter] of pendingRendererBridgeWaiters.entries()) {
      if (waiter.targetRole !== role) {
        continue;
      }
      pendingRendererBridgeWaiters.delete(requestId);
      waiter.reject(new Error(reason));
    }
  }

  function registerWindowDiagnostics(role, browserWindow) {
    browserWindow.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        process.stderr.write(
          `[desktop-live2d ${role} console] level=${level} source=${sourceId}:${line} ${message}\n`
        );
      }
    );
    browserWindow.webContents.on(
      "preload-error",
      (_event, preloadPathValue, error) => {
        process.stderr.write(
          `[desktop-live2d ${role} preload error] ${preloadPathValue} ${error?.stack || error?.message || String(error)}\n`
        );
      }
    );
    browserWindow.webContents.on(
      "render-process-gone",
      (_event, details) => {
        process.stderr.write(
          `[desktop-live2d ${role} render-process-gone] reason=${details.reason} exitCode=${details.exitCode}\n`
        );
      }
    );
    browserWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        process.stderr.write(
          `[desktop-live2d ${role} did-fail-load] code=${errorCode} url=${validatedURL} ${errorDescription}\n`
        );
      }
    );
    const registeredWebContentsId = browserWindow.webContents.id;
    browserWindow.on("closed", () => {
      clearWindowDragState(registeredWebContentsId);
      rendererBridgeReadyRoles.delete(role);
      suiteWindows.delete(role);
      rejectPendingRendererBridgeWaitersForRole(
        role,
        `desktop-live2d ${role} window closed`
      );
    });
  }

  async function createSuiteWindows() {
    await ensureSuiteDefinitions();
    const display = screen?.getPrimaryDisplay?.() || null;
    const avatarDefinition = suiteDefinitions[DESKTOP_WINDOW_ROLE.AVATAR];
    const chatDefinition = suiteDefinitions[DESKTOP_WINDOW_ROLE.CHAT];
    const bubbleDefinition = suiteDefinitions[DESKTOP_WINDOW_ROLE.BUBBLE];
    const avatarBounds = computeAvatarWindowBounds({
      avatarWidth: avatarDefinition.browserWindowOptions.width,
      avatarHeight: avatarDefinition.browserWindowOptions.height,
      display
    });
    const chatBounds = computeChatWindowBounds({
      avatarBounds,
      chatWidth: chatDefinition.browserWindowOptions.width,
      chatHeight: chatDefinition.browserWindowOptions.height,
      display
    });
    const bubbleBounds = computeBubbleWindowBounds({
      avatarBounds,
      bubbleWidth: bubbleDefinition.browserWindowOptions.width,
      bubbleHeight: bubbleDefinition.browserWindowOptions.height,
      display
    });
    const boundsByRole = {
      [DESKTOP_WINDOW_ROLE.AVATAR]: avatarBounds,
      [DESKTOP_WINDOW_ROLE.CHAT]: chatBounds,
      [DESKTOP_WINDOW_ROLE.BUBBLE]: bubbleBounds
    };

    for (const role of [
      DESKTOP_WINDOW_ROLE.AVATAR,
      DESKTOP_WINDOW_ROLE.CHAT,
      DESKTOP_WINDOW_ROLE.BUBBLE
    ]) {
      const definition = suiteDefinitions[role];
      const initialBounds = boundsByRole[role] || null;
      const browserWindow = new BrowserWindow({
        ...definition.browserWindowOptions,
        ...(initialBounds?.x !== undefined ? initialBounds : {}),
        title: definition.title
      });
      suiteWindows.set(role, browserWindow);
      registerWindowDiagnostics(role, browserWindow);
      if (role === DESKTOP_WINDOW_ROLE.AVATAR) {
        setWindowClickThrough(browserWindow, false);
        browserWindow.webContents.on("did-finish-load", () => {
          sendAvatarWindowStateSync();
        });
      }
      if (role === DESKTOP_WINDOW_ROLE.BUBBLE) {
        setWindowClickThrough(browserWindow, false);
        browserWindow.setAlwaysOnTop(true, "screen-saver");
        if (typeof browserWindow.setVisibleOnAllWorkspaces === "function") {
          browserWindow.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true
          });
        }
        browserWindow.once("ready-to-show", () => {
          if (!browserWindow.isDestroyed()) {
            if (typeof browserWindow.showInactive === "function") {
              browserWindow.showInactive();
            } else {
              browserWindow.show();
            }
          }
        });
        browserWindow.webContents.on("did-finish-load", () => {
          void applyLatestBubbleOverlayPayloadToWindow(browserWindow);
        });
      }
      await browserWindow.loadURL(definition.launchUrl);
    }
  }

  async function ensureCompanionHost() {
    if (companionHost) {
      return companionHost;
    }
    companionHost = new DesktopCompanionPythonHost({
      workspaceRoot: getWorkspaceRoot(),
      userDataDirectory: app.getPath("userData"),
      onDesktopBridgeRequest: async (bridgeRequest) => {
        return await requestRendererBridgeResponse(bridgeRequest);
      }
    });
    return companionHost;
  }

  async function ensureStoryOrchestrator() {
    if (storyOrchestrator) {
      return storyOrchestrator;
    }
    if (!storyService) {
      throw new Error("storyService not initialized");
    }
    const host = await ensureCompanionHost();
    storyOrchestrator = new StoryModeOrchestrator({
      storyService,
      companionHost: host,
      onBeforeCastTurn: async (castMemberId) => {
        await syncStoryDesktopCastWindows({
          castMembers: storyService.getCastMembers(),
          activeCastMemberId: castMemberId
        });
      },
      onCastCommitted: async ({ castMemberId, projectionEvent }) => {
        if (!projectionEvent?.text) {
          return;
        }
        await showStoryCastBubbleText(projectionEvent.text, castMemberId);
      },
      onNarratorEvents: async ({ emittedEvents }) => {
        if (!Array.isArray(emittedEvents) || emittedEvents.length === 0) {
          return;
        }
        const latestNarratorEvent = [...emittedEvents]
          .reverse()
          .find((event) => event?.event_kind === "director_note" || event?.event_kind === "scene_transition");
        if (!latestNarratorEvent?.text) {
          return;
        }
        await showStoryNarratorBubbleText(latestNarratorEvent.text, {
          speakerLabel: latestNarratorEvent.event_kind === "scene_transition" ? "旁白转场" : "旁白",
          speakerColor: storyNarratorSubtitleColor
        });
      },
      onDebug: (category, message, detail) => {
        publishControlPlaneDebug(category, message, detail);
      }
    });
    return storyOrchestrator;
  }

  function publishControlPlaneDebug(category, message, detail = null) {
    if (!webControlPlaneServer) {
      return;
    }
    webControlPlaneServer.publishDebugUpdate(
      buildDebugUpdatePayload({
        category,
        message,
        detail
      })
    );
  }

  function publishControlPlaneTranscriptSnapshot(snapshot) {
    if (!webControlPlaneServer || !snapshot) {
      return;
    }
    webControlPlaneServer.publishTranscriptSnapshot(snapshot);
  }

  function publishControlPlaneProviderReadiness(readiness) {
    if (!webControlPlaneServer || !readiness) {
      return;
    }
    webControlPlaneServer.publishProviderReadiness(readiness);
  }

  function buildControlPlaneDebugState() {
    return buildDebugUpdatePayload({
      category: "electron_main",
      message: "desktop-live2d control plane ready",
      detail: {
        renderer_bridge_ready_roles: Array.from(rendererBridgeReadyRoles),
        renderer_bridge_log: rendererBridgeLog,
        companion_host_started: companionHost !== null,
        selected_model_key: currentAvatarModelSelection?.model_key || null,
        control_plane_origin:
          webControlPlaneServer && webControlPlaneServer._address
            ? webControlPlaneServer.getOrigin()
            : null
      }
    });
  }

  async function loadAvatarModelLibraryThroughAppConfig() {
    const payload = await buildAvatarModelLibraryPayload();
    publishControlPlaneDebug("avatar_model", "loaded", {
      selected_model_key: payload.selected_model_key,
      registered_model_count: payload.models.length
    });
    return payload;
  }

  async function saveAvatarModelSelectionThroughAppConfig(payload) {
    const result = await savePersistedAvatarModelSelection({
      userDataDirectory: app.getPath("userData"),
      workspaceRoot: getWorkspaceRoot(),
      selectedModelKey: payload.selected_model_key
    });
    currentAvatarModelSelection = result.model;
    await ensureSuiteDefinitions();
    if (!storyDesktopCastState) {
      await applyCurrentAvatarModelToWindow();
    }
    const snapshot = await buildAvatarModelLibraryPayload();
    const chatWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.CHAT) || null;
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send(
        "echo-desktop-live2d:model-session-scope-changed",
        {
          model_key: snapshot.selected_model_key
        }
      );
    }
    publishControlPlaneDebug("avatar_model", "saved", {
      selected_model_key: snapshot.selected_model_key
    });
    return snapshot;
  }

  async function loadProviderSettingsThroughHost() {
    const host = await ensureCompanionHost();
    const result = await host.loadProviderSettings();
    publishControlPlaneProviderReadiness(result.readiness);
    publishControlPlaneDebug("provider_settings", "loaded", {
      local_fast_configured: result.settings_snapshot.local_fast_llm != null
    });
    return result;
  }

  async function saveProviderSettingsThroughHost(payload) {
    const host = await ensureCompanionHost();
    const result = await host.saveProviderSettings(payload);
    publishControlPlaneProviderReadiness(result.readiness);
    publishControlPlaneDebug("provider_settings", "saved", {
      local_fast_configured: result.settings_snapshot.local_fast_llm != null
    });
    return result;
  }

  async function validateProviderSettingsThroughHost() {
    const host = await ensureCompanionHost();
    const result = await host.validateProviderSettings();
    publishControlPlaneProviderReadiness(result.readiness);
    publishControlPlaneDebug("provider_settings", "validated", {
      runtime_ready: result.readiness?.runtime_ready ?? null
    });
    return result;
  }

  async function getProviderReadinessThroughHost() {
    const host = await ensureCompanionHost();
    const result = await host.getProviderReadiness();
    publishControlPlaneProviderReadiness(result);
    return result;
  }

  async function runTtsVoiceEnrollmentThroughHost(payload) {
    const host = await ensureCompanionHost();
    const result = await host.runTTSVoiceEnrollment(payload);
    publishControlPlaneDebug("voice_enrollment", "completed", {
      voice_profile_key: result?.voice_profile?.voice_profile_key || null
    });
    return result;
  }

  async function submitCompanionTextThroughHost(
    text,
    { images = [], visibleInTranscript = true } = {}
  ) {
    const host = await ensureCompanionHost();
    turnInProgress = true;
    try {
      const result = await host.submitDesktopInput(text, {
        images,
        visibleInTranscript,
        targetSessionKind: "direct"
      });
      publishControlPlaneTranscriptSnapshot(
        result.final_desktop_snapshot?.companion_session_snapshot || null
      );
      publishControlPlaneDebug("text_turn", "submitted", {
        submitted_text: result.submitted_text
      });
      return result;
    } catch (error) {
      hideBubbleWindow();
      publishControlPlaneDebug("text_turn", "failed", {
        submitted_text: text,
        error:
          error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      turnInProgress = false;
    }
  }

  async function snapshotDesktopStateThroughHost() {
    const host = await ensureCompanionHost();
    const result = await host.snapshotDesktopState({
      targetSessionKind: "direct"
    });
    if (!storyOrchestrator) {
      publishControlPlaneTranscriptSnapshot(result?.companion_session_snapshot || null);
    }
    return result;
  }

  function toggleAmbientPerception() {
    ambientPerceptionEnabled = !ambientPerceptionEnabled;
    if (ambientPerceptionEnabled) {
      if (!ambientPerceptionController) {
        ambientPerceptionController = new AmbientPerceptionController({
          onSubmit: async (text, { images }) => {
            return await submitCompanionTextThroughHost(text, {
              images,
              visibleInTranscript: false,
            });
          },
          getSessionState: () => {
            return turnInProgress ? "thinking" : "idle";
          },
          onDebug: (category, action, detail) => {
            publishControlPlaneDebug(category, action, detail);
          },
        });
      }
      ambientPerceptionController.start();
    } else {
      if (ambientPerceptionController) {
        ambientPerceptionController.stop();
      }
    }
  }

  async function startWebControlPlane() {
    if (webControlPlaneServer) {
      return webControlPlaneServer;
    }
    webControlPlaneServer = new DesktopWebControlPlaneServer({
      staticRoot: webUiPublicRoot,
      operations: {
        loadAvatarModelLibrary: async () =>
          await loadAvatarModelLibraryThroughAppConfig(),
        saveAvatarModelSelection: async (payload) =>
          await saveAvatarModelSelectionThroughAppConfig(payload),
        loadProviderSettings: async () => await loadProviderSettingsThroughHost(),
        saveProviderSettings: async (payload) =>
          await saveProviderSettingsThroughHost(payload),
        validateProviderSettings: async () =>
          await validateProviderSettingsThroughHost(),
        getProviderReadiness: async () => await getProviderReadinessThroughHost(),
        snapshotDesktopState: async () => await snapshotDesktopStateThroughHost(),
        submitTextTurn: async (payload) =>
          await submitCompanionTextThroughHost(payload.text, {
            images: Array.isArray(payload.images) ? payload.images : [],
          }),
        runTtsVoiceEnrollment: async (payload) =>
          await runTtsVoiceEnrollmentThroughHost(payload),
        getDebugState: async () => buildControlPlaneDebugState()
      }
    });
    const origin = await webControlPlaneServer.start();
    publishControlPlaneDebug("control_plane", "started", { origin });
    if (process.env.ECHO_WEB_UI_OPEN_BROWSER === "1") {
      await shell.openExternal(origin);
    }
    return webControlPlaneServer;
  }

  function updateRendererBridgeLog(bridgeRequest, response) {
    if (bridgeRequest.bridge_command === "dispatch_command") {
      rendererBridgeLog.dispatchedCommandCount += 1;
      return;
    }
    if (bridgeRequest.bridge_command === "audio_playback_fragment") {
      rendererBridgeLog.lastPlaybackReportKinds = Array.isArray(response?.reports)
        ? response.reports.map((item) => item.report_kind)
        : [];
      return;
    }
    if (
      bridgeRequest.bridge_command === "bubble_replace" ||
      bridgeRequest.bridge_command === "bubble_append"
    ) {
      rendererBridgeLog.lastBubbleText =
        typeof response?.bubble_text === "string" ? response.bubble_text : null;
      return;
    }
    if (
      bridgeRequest.bridge_command === "companion_session_upsert_transcript" &&
      bridgeRequest.role === "assistant"
    ) {
      rendererBridgeLog.lastAssistantTranscriptText = bridgeRequest.text;
    }
  }

  async function requestRendererBridgeResponse(bridgeRequest) {
    // Story mode: handle transcript upserts AND snapshots in a shadow state
    // manager instead of forwarding to the chat window.  This keeps the
    // runtime's transcript tracking intact (full snapshot with entries) while
    // preventing the chat renderer from displaying narrator/cast hidden-session
    // content.
    if (
      storyOrchestrator &&
      bridgeRequest?.bridge_command === BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT
    ) {
      const snapshot = storyShadowSessionManager.upsertTranscript(bridgeRequest);

      // Drive streaming bubble overlay for cast member turns using the
      // transcript upsert (bubble_replace is suppressed at the Python level to
      // avoid model_key mismatches and wrong default colors).
      if (bridgeRequest.role === "assistant" && bridgeRequest.session_id) {
        const castMemberId = storyOrchestrator.getCastMemberIdForSession(bridgeRequest.session_id);
        if (castMemberId) {
          const activeCastEntry = storyDesktopCastState?.cast_entries?.find(
            (entry) => entry.cast_member_id === castMemberId
          ) || null;
          latestBubbleOverlayPayload = {
            text: (bridgeRequest.text || "").trim(),
            isStreaming: bridgeRequest.is_streaming === true,
            speakerLabel: activeCastEntry?.display_name || "Echo",
            speakerColor: activeCastEntry?.subtitle_color || null
          };
          if (latestBubbleOverlayPayload.text !== "") {
            const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
            if (bubbleWindow && !bubbleWindow.isDestroyed()) {
              await applyLatestBubbleOverlayPayloadToWindow(bubbleWindow);
            }
          }
        }
      }

      return buildCompanionSessionResponse({
        requestId: bridgeRequest.request_id || randomUUID(),
        bridgeCommand: BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT,
        companionSessionSnapshot: snapshot
      });
    }
    if (
      storyOrchestrator &&
      bridgeRequest?.bridge_command === BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT
    ) {
      return buildCompanionSessionResponse({
        requestId: bridgeRequest.request_id || randomUUID(),
        bridgeCommand: BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT,
        companionSessionSnapshot: storyShadowSessionManager.getSnapshot()
      });
    }
    const targetRole = resolveBridgeTargetWindowRole(bridgeRequest);
    let targetWindow = null;
    let targetLabel = targetRole;
    if (
      targetRole === DESKTOP_WINDOW_ROLE.AVATAR &&
      storyDesktopCastState?.active_cast_member_id
    ) {
      targetWindow = getStoryCastWindowForCastMemberId(
        storyDesktopCastState.active_cast_member_id
      );
      targetLabel = `story-cast:${storyDesktopCastState.active_cast_member_id}`;
    }
    if (!targetWindow) {
      targetWindow = getWindowForRole(targetRole);
    }
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error(`desktop-live2d ${targetLabel} bridge target is unavailable`);
    }
    const targetWebContentsId = targetWindow.webContents.id;
    if (!rendererBridgeReadyWindowIds.has(targetWebContentsId)) {
      throw new Error(
        `desktop-live2d ${targetLabel} renderer bridge handler is not ready yet`
      );
    }
    const requestId = randomUUID();
    const waiter = new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        pendingRendererBridgeWaiters.delete(requestId);
        reject(
          new Error(`desktop-live2d ${targetRole} renderer bridge timed out`)
        );
      }, 5000);
      pendingRendererBridgeWaiters.set(requestId, {
        targetRole,
        targetWebContentsId,
        resolve(value) {
          clearTimeout(timeoutHandle);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeoutHandle);
          reject(error);
        }
      });
    });
    targetWindow.webContents.send("echo-desktop-live2d:host-bridge-request", {
      requestId,
      bridgeRequest
    });
    const response = await waiter;
    updateRendererBridgeLog(bridgeRequest, response);
    if (
      bridgeRequest.bridge_command === "bubble_replace" ||
      bridgeRequest.bridge_command === "bubble_append" ||
      bridgeRequest.bridge_command === "bubble_clear" ||
      bridgeRequest.bridge_command === "bubble_snapshot"
    ) {
      syncBubbleWindowVisibilityFromResponse(response);
    }
    if (
      bridgeRequest.bridge_command === "companion_session_upsert_transcript" &&
      response?.companion_session_snapshot &&
      !storyOrchestrator
    ) {
      publishControlPlaneTranscriptSnapshot(response.companion_session_snapshot);
    }
    if (
      bridgeRequest.bridge_command === BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT &&
      bridgeRequest.role === "assistant"
    ) {
      await syncBubbleTextFromAssistantTranscript(bridgeRequest);
    }
    if (
      bridgeRequest.bridge_command === BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT &&
      Array.isArray(response?.reports) &&
      response.reports.some((item) => item?.report_kind === "finished")
    ) {
      await scheduleBubbleOverlayHide(5000);
    }
    publishControlPlaneDebug("bridge", bridgeRequest.bridge_command, {
      target_role: targetRole,
      status: response?.status || null
    });
    return response;
  }

  async function collectRendererDebugSnapshot(role) {
    const targetWindow = getWindowForRole(role);
    return await targetWindow.webContents.executeJavaScript(
      "globalThis.__echoDesktopLive2DBuildDebugSnapshot ? globalThis.__echoDesktopLive2DBuildDebugSnapshot() : null",
      true
    );
  }

  async function collectWindowSurfaceFacts(role) {
    const targetWindow = getWindowForRole(role);
    return await targetWindow.webContents.executeJavaScript(
      `(() => ({
        windowRole: document?.documentElement?.dataset?.echoDesktopWindowRole || null,
        windowSurface: document?.documentElement?.dataset?.echoDesktopWindowSurface || null,
        hasChatComposer: Boolean(document?.querySelector?.(".chat-panel__composer")),
        hasChatViewMount: Boolean(document?.getElementById?.("chat-view")),
        hasChatPanelFrame: Boolean(document?.querySelector?.(".chat-window__panel")),
        hasStage: Boolean(document?.getElementById?.("stage")),
        hasBubbleView: Boolean(document?.getElementById?.("bubble-view")),
        hasBubbleShell: Boolean(document?.querySelector?.(".bubble-shell")),
        hasBubbleLines: Boolean(document?.querySelector?.(".bubble-shell__lines"))
      }))()`,
      true
    );
  }

  async function waitForRendererBridgeTargets(targetRoles) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (targetRoles.every((role) => rendererBridgeReadyRoles.has(role))) {
        return;
      }
      await delay(100);
    }
    throw new Error("desktop-live2d renderer bridge targets did not become ready in time");
  }

  async function runElectronSuiteVerification() {
    const submittedText =
      process.env.ECHO_DESKTOP_LIVE2D_VERIFICATION_INPUT_TEXT ||
      "hello desktop electron verification";
    const host = await ensureCompanionHost();
    const settingsPayload = buildProductionVerificationSettingsPayloadFromEnvironment();

    await waitForRendererBridgeTargets([
      DESKTOP_WINDOW_ROLE.AVATAR,
      DESKTOP_WINDOW_ROLE.CHAT,
      DESKTOP_WINDOW_ROLE.BUBBLE
    ]);

    await host.saveProviderSettings(settingsPayload);
    const turnResult = await host.submitDesktopInput(submittedText);
    await delay(120);
    const avatarDebugSnapshot = await collectRendererDebugSnapshot(
      DESKTOP_WINDOW_ROLE.AVATAR
    );
    const chatDebugSnapshot = await collectRendererDebugSnapshot(
      DESKTOP_WINDOW_ROLE.CHAT
    );
    const bubbleDebugSnapshot = await collectRendererDebugSnapshot(
      DESKTOP_WINDOW_ROLE.BUBBLE
    );
    const avatarSurfaceFacts = await collectWindowSurfaceFacts(
      DESKTOP_WINDOW_ROLE.AVATAR
    );
    const chatSurfaceFacts = await collectWindowSurfaceFacts(
      DESKTOP_WINDOW_ROLE.CHAT
    );
    const bubbleSurfaceFacts = await collectWindowSurfaceFacts(
      DESKTOP_WINDOW_ROLE.BUBBLE
    );

    if (
      turnResult.final_desktop_snapshot.companion_session_snapshot.transcript_entries.length < 2
    ) {
      throw new Error("desktop electron verification expected transcript advancement");
    }
    if (!rendererBridgeLog.lastBubbleText) {
      throw new Error("desktop electron verification expected a bubble update");
    }
    if (!rendererBridgeLog.lastAssistantTranscriptText) {
      throw new Error(
        "desktop electron verification expected an assistant transcript update"
      );
    }
    if (rendererBridgeLog.dispatchedCommandCount <= 0) {
      throw new Error(
        "desktop electron verification expected renderer command dispatch activity"
      );
    }
    if (!rendererBridgeLog.lastPlaybackReportKinds.includes("finished")) {
      throw new Error(
        "desktop electron verification expected finished desktop playback reports"
      );
    }
    if (!avatarDebugSnapshot) {
      throw new Error("desktop electron verification could not collect avatar debug state");
    }
    if (!chatDebugSnapshot) {
      throw new Error("desktop electron verification could not collect chat debug state");
    }
    if (!bubbleDebugSnapshot) {
      throw new Error("desktop electron verification could not collect bubble debug state");
    }
    if (avatarDebugSnapshot.scene_snapshot.runtime_mode !== "pixi_cubism") {
      throw new Error(
        `desktop electron verification expected pixi_cubism runtime, got '${avatarDebugSnapshot.scene_snapshot.runtime_mode}'`
      );
    }
    if (avatarDebugSnapshot.audio_playback_backend.runtime_mode !== "device_audio") {
      throw new Error(
        `desktop electron verification expected device_audio backend, got '${avatarDebugSnapshot.audio_playback_backend.runtime_mode}'`
      );
    }
    if (avatarDebugSnapshot.lipsync_snapshot.peak_mouth_open <= 0) {
      throw new Error("desktop electron verification expected lipsync activity");
    }
    if (
      chatDebugSnapshot.companion_session_snapshot.transcript_entries.length < 2
    ) {
      throw new Error(
        "desktop electron verification expected transcript updates to land in the chat window"
      );
    }
    const lastChatEntry =
      chatDebugSnapshot.companion_session_snapshot.transcript_entries[
      chatDebugSnapshot.companion_session_snapshot.transcript_entries.length - 1
      ];
    if (lastChatEntry?.text !== rendererBridgeLog.lastAssistantTranscriptText) {
      throw new Error(
        "desktop electron verification expected chat transcript and bridge assistant text to match"
      );
    }
    if (bubbleDebugSnapshot.shell_info?.windowRole !== "bubble") {
      throw new Error("desktop electron verification expected a dedicated bubble window");
    }
    if (
      bubbleDebugSnapshot.bubble_snapshot?.bubble_text !== rendererBridgeLog.lastBubbleText
    ) {
      throw new Error(
        "desktop electron verification expected bubble window text to match bridge bubble text"
      );
    }
    if (
      chatSurfaceFacts.windowRole !== "chat" ||
      !chatSurfaceFacts.hasChatComposer ||
      !chatSurfaceFacts.hasChatViewMount ||
      !chatSurfaceFacts.hasChatPanelFrame
    ) {
      throw new Error(
        "desktop electron verification expected the dedicated chat window to own transcript and composer UI"
      );
    }
    if (
      avatarSurfaceFacts.windowRole !== "avatar" ||
      !avatarSurfaceFacts.hasStage ||
      avatarSurfaceFacts.hasBubbleView ||
      avatarSurfaceFacts.hasBubbleShell ||
      avatarSurfaceFacts.hasChatComposer
    ) {
      throw new Error(
        "desktop electron verification expected the avatar window to own stage and playback only"
      );
    }
    if (
      bubbleSurfaceFacts.windowRole !== "bubble" ||
      bubbleSurfaceFacts.hasStage ||
      bubbleSurfaceFacts.hasChatComposer ||
      !bubbleSurfaceFacts.hasBubbleView ||
      !bubbleSurfaceFacts.hasBubbleShell ||
      !bubbleSurfaceFacts.hasBubbleLines
    ) {
      throw new Error(
        "desktop electron verification expected the bubble window to own bubble UI only"
      );
    }
    process.stdout.write("desktop-live2d electron verification passed\n");
  }

  ipcMain.handle("echo-desktop-live2d:dispatch", async (_event, commandEnvelope) => {
    return {
      status: "acknowledged",
      commandEnvelope
    };
  });

  ipcMain.handle("echo-desktop-live2d:renderer-bridge-ready", async (event) => {
    const role = getWindowRoleForWebContents(event.sender);
    const storyCastEntry = findStoryCastWindowEntryByWebContents(event.sender);
    if (!role && !storyCastEntry) {
      return { ok: false, accepted: false, reason: "unknown_window_role" };
    }
    if (!storyCastEntry && !isBridgeExecutionTargetRole(role)) {
      return { ok: true, accepted: false, windowRole: role };
    }
    rendererBridgeReadyWindowIds.add(event.sender.id);
    if (role) {
      rendererBridgeReadyRoles.add(role);
    }
    if (
      role === DESKTOP_WINDOW_ROLE.BUBBLE &&
      latestBubbleOverlayPayload &&
      typeof latestBubbleOverlayPayload.text === "string" &&
      latestBubbleOverlayPayload.text.trim() !== ""
    ) {
      const bubbleWindow = BrowserWindow.fromWebContents(event.sender) || null;
      await applyLatestBubbleOverlayPayloadToWindow(bubbleWindow);
    }
    return {
      ok: true,
      accepted: true,
      windowRole: role || DESKTOP_WINDOW_ROLE.AVATAR,
      castMemberId: storyCastEntry?.castMemberId || null
    };
  });

  ipcMain.handle(
    "echo-desktop-live2d:host-bridge-response",
    async (event, payload) => {
      const senderRole = getWindowRoleForWebContents(event.sender);
      const waiter = pendingRendererBridgeWaiters.get(payload.requestId);
      if (!waiter) {
        return { ok: false };
      }
      if (event.sender.id !== waiter.targetWebContentsId) {
        return {
          ok: false,
          reason: `unexpected_bridge_response_source:${senderRole || "story-cast"}`
        };
      }
      pendingRendererBridgeWaiters.delete(payload.requestId);
      if (payload.errorMessage) {
        waiter.reject(new Error(payload.errorMessage));
      } else {
        waiter.resolve(payload.response);
      }
      return { ok: true };
    }
  );

  ipcMain.handle("echo-desktop-live2d:load-provider-settings", async () => {
    return await loadProviderSettingsThroughHost();
  });

  ipcMain.handle("echo-desktop-live2d:load-avatar-model-library", async () => {
    return await loadAvatarModelLibraryThroughAppConfig();
  });

  ipcMain.handle("echo-desktop-live2d:load-model-persona", async (_event, modelKey) => {
    return await loadModelPersonaThroughAppConfig(modelKey);
  });

  ipcMain.handle(
    "echo-desktop-live2d:save-avatar-model-selection",
    async (_event, payload) => {
      return await saveAvatarModelSelectionThroughAppConfig(payload);
    }
  );

  ipcMain.handle("echo-desktop-live2d:save-model-persona", async (_event, payload) => {
    return await saveModelPersonaThroughAppConfig({
      modelKey: payload?.model_key,
      personaText: payload?.persona_text
    });
  });

  ipcMain.handle(
    "echo-desktop-live2d:save-provider-settings",
    async (_event, payload) => {
      return await saveProviderSettingsThroughHost(payload);
    }
  );

  ipcMain.handle("echo-desktop-live2d:validate-provider-settings", async () => {
    return await validateProviderSettingsThroughHost();
  });

  ipcMain.handle("echo-desktop-live2d:get-provider-readiness", async () => {
    return await getProviderReadinessThroughHost();
  });

  ipcMain.handle(
    "echo-desktop-live2d:run-tts-voice-enrollment",
    async (_event, payload) => {
      return await runTtsVoiceEnrollmentThroughHost(payload);
    }
  );

  ipcMain.handle("echo-desktop-live2d:list-cloned-voices", async () => {
    const host = await ensureCompanionHost();
    return await host.listClonedVoices();
  });

  ipcMain.handle(
    "echo-desktop-live2d:submit-companion-text",
    async (_event, payload) => {
      const text = String(payload?.text || "");
      const images = Array.isArray(payload?.images) ? payload.images : [];
      return await submitCompanionTextThroughHost(text, { images });
    }
  );

  ipcMain.handle("echo-desktop-live2d:get-companion-state", async () => {
    return await snapshotDesktopStateThroughHost();
  });

  ipcMain.handle("echo-desktop-live2d:list-sessions", async () => {
    const host = await ensureCompanionHost();
    return await host.listSessions();
  });

  ipcMain.handle("echo-desktop-live2d:create-session", async (_event, payload) => {
    const host = await ensureCompanionHost();
    return await host.createSession(payload || {});
  });

  ipcMain.handle("echo-desktop-live2d:switch-session", async (_event, sessionId) => {
    const host = await ensureCompanionHost();
    return await host.switchSession(sessionId);
  });

  ipcMain.handle("echo-desktop-live2d:delete-session", async (_event, sessionId) => {
    const host = await ensureCompanionHost();
    return await host.deleteSession(sessionId);
  });

  ipcMain.handle("echo-desktop-live2d:fork-session", async (_event, payload) => {
    const host = await ensureCompanionHost();
    return await host.forkSession(
      payload.source_session_id,
      {
        cutAfterIndex: payload.cut_after_index ?? null,
        title: payload.title ?? "",
        makeActive: payload.make_active ?? true
      }
    );
  });

  ipcMain.handle("echo-desktop-live2d:get-active-session", async () => {
    const host = await ensureCompanionHost();
    return await host.getActiveSession();
  });

  ipcMain.handle("echo-desktop-live2d:get-session-detail", async (_event, sessionId) => {
    const host = await ensureCompanionHost();
    return await host.getSessionDetail(sessionId);
  });

  ipcMain.handle(
    "echo-desktop-live2d:choose-reference-audio",
    async (event) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) || null;
      const result = await dialog.showOpenDialog(targetWindow, {
        properties: ["openFile"],
        title: "Choose voice reference audio",
        filters: [
          {
            name: "Audio",
            extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg"]
          }
        ]
      });
      return {
        canceled: result.canceled,
        filePath:
          result.canceled || result.filePaths.length === 0
            ? null
            : result.filePaths[0]
      };
    }
  );

  ipcMain.handle("echo-desktop-live2d:begin-window-drag", async (event, payload) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
    if (!browserWindow) {
      return { ok: false, reason: "window_not_found" };
    }
    if (
      !Number.isFinite(payload?.screenX) ||
      !Number.isFinite(payload?.screenY)
    ) {
      return { ok: false, reason: "invalid_pointer_coordinates" };
    }
    const [windowX, windowY] = browserWindow.getPosition();
    activeWindowDrags.set(event.sender.id, {
      role: getWindowRoleForWebContents(event.sender),
      originCursorX: Number(payload.screenX),
      originCursorY: Number(payload.screenY),
      originWindowX: windowX,
      originWindowY: windowY
    });
    return { ok: true };
  });

  ipcMain.handle("echo-desktop-live2d:update-window-drag", async (event, payload) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
    const dragState = activeWindowDrags.get(event.sender.id) || null;
    if (!browserWindow || !dragState) {
      return { ok: false, reason: "drag_not_active" };
    }
    if (
      !Number.isFinite(payload?.screenX) ||
      !Number.isFinite(payload?.screenY)
    ) {
      return { ok: false, reason: "invalid_pointer_coordinates" };
    }
    const nextX = Math.round(
      dragState.originWindowX + (Number(payload.screenX) - dragState.originCursorX)
    );
    const nextY = Math.round(
      dragState.originWindowY + (Number(payload.screenY) - dragState.originCursorY)
    );
    browserWindow.setPosition(nextX, nextY, false);
    return { ok: true };
  });

  ipcMain.handle("echo-desktop-live2d:end-window-drag", async (event) => {
    clearWindowDragState(event.sender.id);
    return { ok: true };
  });

  ipcMain.handle("echo-desktop-live2d:resize-avatar-window", async (event, payload) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || null;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return { ok: false, reason: "avatar_window_unavailable" };
    }
    const scaleDelta = Number(payload?.scaleDelta);
    if (!Number.isFinite(scaleDelta)) {
      return { ok: false, reason: "invalid_scale_delta" };
    }
    const bounds = targetWindow.getBounds();
    const definition = suiteDefinitions[DESKTOP_WINDOW_ROLE.AVATAR];
    const aspectRatio =
      definition.browserWindowOptions.width /
      Math.max(1, definition.browserWindowOptions.height);
    const scaleFactor = scaleDelta > 0 ? 1.06 : 0.94;
    const requestedHeight = Math.max(
      260,
      Math.min(1400, Math.round(bounds.height * scaleFactor))
    );
    const requestedWidth = Math.max(
      180,
      Math.min(900, Math.round(requestedHeight * aspectRatio))
    );
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const nextBounds = clampWindowBoundsToWorkArea({
      bounds: {
        x: Math.round(right - requestedWidth),
        y: Math.round(bottom - requestedHeight),
        width: requestedWidth,
        height: requestedHeight
      },
      display: resolveDisplayForBounds({
        x: Math.round(right - requestedWidth),
        y: Math.round(bottom - requestedHeight),
        width: requestedWidth,
        height: requestedHeight
      }),
      minWidth: 180,
      minHeight: 260,
      maxWidth: 900,
      maxHeight: 1400,
      margin: 8,
      maxOffscreenRatio: 0.8,
      aspectRatio
    });
    targetWindow.setBounds(nextBounds, false);
    const senderRole = getWindowRoleForWebContents(event.sender);
    if (senderRole === DESKTOP_WINDOW_ROLE.AVATAR) {
      positionCompanionWindowsForAvatarBounds(nextBounds);
      sendAvatarWindowStateSync();
    }
    return { ok: true, bounds: nextBounds };
  });

  ipcMain.handle("echo-desktop-live2d:minimize-window", async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
    if (!browserWindow || browserWindow.isDestroyed()) {
      return { ok: false, reason: "window_not_found" };
    }
    browserWindow.hide();
    return { ok: true };
  });

  ipcMain.handle("echo-desktop-live2d:close-window", async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
    if (!browserWindow || browserWindow.isDestroyed()) {
      return { ok: false, reason: "window_not_found" };
    }
    const role = getWindowRoleForWebContents(event.sender);
    browserWindow.hide();
    if (role === DESKTOP_WINDOW_ROLE.AVATAR) {
      const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
      if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
        bubbleWindow.hide();
      }
    }
    return { ok: true };
  });

  ipcMain.handle("echo-desktop-live2d:show-context-menu", async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
    if (!browserWindow || browserWindow.isDestroyed()) {
      return { ok: false, reason: "window_not_found" };
    }
    const menu = Menu.buildFromTemplate([
      {
        label: "\u8c03\u6574\u89d2\u8272\u7a97\u53e3\u5927\u5c0f",
        click: () => {
          toggleAvatarResizeMode();
        }
      },
      { type: "separator" },
      {
        label: "\u6700\u5c0f\u5316\u89d2\u8272\u7a97\u53e3",
        click: () => {
          const avatarWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
          if (avatarWin && !avatarWin.isDestroyed()) {
            avatarWin.hide();
          }
          const bubbleWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
          if (bubbleWin && !bubbleWin.isDestroyed()) {
            bubbleWin.hide();
          }
        }
      },
      {
        label: "\u6700\u5c0f\u5316\u804a\u5929\u7a97\u53e3",
        click: () => {
          const chatWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.CHAT) || null;
          if (chatWin && !chatWin.isDestroyed()) {
            chatWin.hide();
          }
        }
      },
      { type: "separator" },
      {
        label: "\u5173\u95ed\u6240\u6709\u7a97\u53e3",
        click: () => {
          for (const [, win] of suiteWindows) {
            if (win && !win.isDestroyed()) {
              win.hide();
            }
          }
        }
      }
    ]);
    menu.popup({ window: browserWindow });
    return { ok: true };
  });

  function showAllWindows() {
    for (const role of [
      DESKTOP_WINDOW_ROLE.AVATAR,
      DESKTOP_WINDOW_ROLE.CHAT,
      DESKTOP_WINDOW_ROLE.BUBBLE
    ]) {
      const win = suiteWindows.get(role) || null;
      if (win && !win.isDestroyed()) {
        win.show();
      }
    }
  }

  function showConsoleWindow() {
    if (consoleWindow && !consoleWindow.isDestroyed()) {
      consoleWindow.show();
      consoleWindow.focus();
      return;
    }
    const consoleDefinition = suiteDefinitions?.[DESKTOP_WINDOW_ROLE.CONSOLE];
    if (!consoleDefinition) {
      throw new Error("desktop-live2d console window definition is unavailable");
    }
    consoleWindow = new BrowserWindow({
      ...consoleDefinition.browserWindowOptions,
      title: consoleDefinition.title
    });
    consoleWindow.once("ready-to-show", () => {
      if (!consoleWindow.isDestroyed()) {
        consoleWindow.show();
      }
    });
    consoleWindow.on("closed", () => {
      consoleWindow = null;
    });
    consoleWindow.loadURL(consoleDefinition.launchUrl);
  }

  ipcMain.handle("echo-desktop-live2d:scan-model-library", async () => {
    const scriptPath = path.join(appRoot, "scripts", "register-models.mjs");
    return new Promise((resolve) => {
      execFile("node", [scriptPath], { cwd: getWorkspaceRoot() }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || err.message });
          return;
        }
        resolve({ ok: true, message: stdout || "扫描完成" });
      });
    });
  });

  ipcMain.handle("echo-desktop-live2d:get-speaking-motion-enabled", () => {
    return speakingMotionEnabled;
  });

  ipcMain.handle("echo-desktop-live2d:set-speaking-motion-enabled", (_event, enabled) => {
    speakingMotionEnabled = !!enabled;
    const avatarWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
    if (avatarWin && !avatarWin.isDestroyed()) {
      avatarWin.webContents.send("echo-desktop-live2d:speaking-motion-enabled", speakingMotionEnabled);
    }
    return speakingMotionEnabled;
  });

  ipcMain.handle("echo-desktop-live2d:get-story-narrator-subtitle-color", () => {
    return storyNarratorSubtitleColor;
  });

  ipcMain.handle("echo-desktop-live2d:set-story-narrator-subtitle-color", async (_event, color) => {
    storyNarratorSubtitleColor = normalizeHexColor(color, STORY_NARRATOR_SUBTITLE_COLOR_DEFAULT);
    if (latestBubbleOverlayPayload?.speakerLabel === "旁白" || latestBubbleOverlayPayload?.speakerLabel === "旁白转场") {
      latestBubbleOverlayPayload = {
        ...latestBubbleOverlayPayload,
        speakerColor: storyNarratorSubtitleColor
      };
      const bubbleWindow = suiteWindows.get(DESKTOP_WINDOW_ROLE.BUBBLE) || null;
      if (bubbleWindow && !bubbleWindow.isDestroyed()) {
        await applyLatestBubbleOverlayPayloadToWindow(bubbleWindow);
      }
    }
    return storyNarratorSubtitleColor;
  });

  function createTray() {
    const trayIconDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAA" +
      "AZtJREFUWEftlj1OxDAQhe0VEhyBo3ABDsAJuAHcAI7ALbgDUHIEJCR+xC8Z" +
      "yVl7Yq+z0SJRZeLJ+L15M+OB7PjIO46fOQE2ncC+iNyq6smUh4h4rar3Uzk4" +
      "S4GbiHgzkesDxC8i4r6q3kzB+iwFHojInYh8jgF8J2IIET8BfB8Rfybu/SYi" +
      "Hk0k+TQCgJfW+UMkPYuI1xNxPhORG7Vj030AnFTVa8sGU98lIq6q6t2YjT4A" +
      "OoGTNAF8BwA9J7rr7wWgyIHPAHBqpqO+SUBE3FfVm0kO/BWA7wEA0rqIeDS1" +
      "+9cA4KGqXkxy4LcAvOQBcmpKx6+MBexUx/6pFw+q6tVkH/gPAA+tGx/SgcPU" +
      "v6r6POEDqxsGz7bvADmQPOubiLhV9WKS0HUCbVPgOYZI+Gom7nUfAIBxInJa" +
      "Vc/G8tcXgjG4v82BY+3E7qrxlGPm3J2DZVZB7yvzbiEAOIjbIoIJx9q2XQWA" +
      "gxDxo6peJjn4dwHA9x2k/uVRAXyfHPguAPZHxGNVvcr+8H8AsCrfA/xRObiC" +
      "Gdf7gYIz2v0CiX2YIV9VEGwAAAAASUVORK5CYII=";
    const trayIcon = nativeImage.createFromDataURL(trayIconDataUrl);
    appTray = new Tray(trayIcon);
    appTray.setToolTip("Echo Desktop");
    const trayContextMenu = Menu.buildFromTemplate([
      {
        label: "\u663e\u793a\u89d2\u8272",
        click: () => {
          const avatarWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
          if (avatarWin && !avatarWin.isDestroyed()) {
            avatarWin.show();
          }
        }
      },
      {
        label: "\u663e\u793a\u804a\u5929",
        click: () => {
          const chatWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.CHAT) || null;
          if (chatWin && !chatWin.isDestroyed()) {
            chatWin.show();
          }
        }
      },
      {
        label: "\u663e\u793a\u5168\u90e8",
        click: () => {
          showAllWindows();
        }
      },
      {
        label: "调整角色窗口大小",
        click: () => {
          toggleAvatarResizeMode();
        }
      },
      {
        label: "控制台",
        click: () => {
          showConsoleWindow();
        }
      },
      {
        label: "环境感知（智能评论）",
        type: "checkbox",
        checked: false,
        click: () => {
          toggleAmbientPerception();
        }
      },
      { type: "separator" },
      {
        label: "鼠标视线追踪",
        type: "checkbox",
        checked: false,
        click: (menuItem) => {
          const avatarWin = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
          if (avatarWin && !avatarWin.isDestroyed()) {
            avatarWin.webContents.send("echo-desktop-live2d:toggle-mouse-tracking", menuItem.checked);
          }
          if (menuItem.checked) {
            if (mouseTrackingInterval) {
              clearInterval(mouseTrackingInterval);
            }
            mouseTrackingInterval = setInterval(() => {
              const win = suiteWindows.get(DESKTOP_WINDOW_ROLE.AVATAR) || null;
              if (!win || win.isDestroyed()) {
                clearInterval(mouseTrackingInterval);
                mouseTrackingInterval = null;
                return;
              }
              const cursor = screen.getCursorScreenPoint();
              const winBounds = win.getBounds();
              win.webContents.send("echo-desktop-live2d:cursor-screen-position", {
                x: cursor.x - winBounds.x,
                y: cursor.y - winBounds.y
              });
            }, 33);
          } else {
            if (mouseTrackingInterval) {
              clearInterval(mouseTrackingInterval);
              mouseTrackingInterval = null;
            }
          }
        }
      },
      { type: "separator" },
      {
        label: "\u9000\u51fa Echo",
        click: () => {
          if (appTray) {
            appTray.destroy();
            appTray = null;
          }
          app.quit();
        }
      }
    ]);
    appTray.setContextMenu(trayContextMenu);
    appTray.on("double-click", () => {
      showAllWindows();
    });
  }

  await app.whenReady();
  await createSuiteWindows();
  createTray();
  await startWebControlPlane();

  // ── Story mode ────────────────────────────────────────────────────────
  storyService = new MultiCompanionStoryService();
  registerStoryModeIPC(ipcMain, storyService, {
    persistState: async ({ data, slotId, slotTitle }) => {
      await persistStoryState({
        userDataDirectory: app.getPath("userData"),
        data,
        slotId,
        slotTitle
      });
    },
    loadState: async ({ slotId }) => {
      return await loadStoryState({
        userDataDirectory: app.getPath("userData"),
        slotId
      });
    },
    listStateSlots: async () => {
      return await listStoryStateSlots({
        userDataDirectory: app.getPath("userData")
      });
    },
    archiveStateSlot: async ({ slotId }) => {
      return await archiveStoryStateSlot({
        userDataDirectory: app.getPath("userData"),
        slotId
      });
    },
    ensureOrchestrator: ensureStoryOrchestrator,
    syncDesktopCastWindows: async ({ castMembers, activeCastMemberId = null }) => {
      await syncStoryDesktopCastWindows({
        castMembers,
        activeCastMemberId
      });
    }
  });

  if (process.env.ECHO_DESKTOP_LIVE2D_AUTORUN_ELECTRON_VERIFICATION === "1") {
    try {
      await runElectronSuiteVerification();
      app.quit();
      return;
    } catch (error) {
      process.stderr.write(
        `[desktop-live2d electron verification] ${error instanceof Error ? error.stack || error.message : String(error)}\n`
      );
      app.exit(1);
      return;
    }
  }

  app.on("window-all-closed", async () => {
    if (appTray) {
      return;
    }
    for (const role of rendererBridgeReadyRoles) {
      rejectPendingRendererBridgeWaitersForRole(
        role,
        `desktop-live2d ${role} window closed`
      );
    }
    rendererBridgeReadyRoles.clear();
    rendererBridgeReadyWindowIds.clear();
    if (webControlPlaneServer) {
      await webControlPlaneServer.close();
      webControlPlaneServer = null;
    }
    closeStoryCastAvatarWindows();
    storyDesktopCastState = null;
    if (companionHost) {
      await companionHost.close();
      companionHost = null;
    }
    if (storyService) {
      unregisterStoryModeIPC(ipcMain);
      storyOrchestrator = null;
      storyService = null;
    }
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createSuiteWindows();
    }
  });

  ipcMain.on("echo-desktop-live2d:window-control", (event, payload) => {
    if (!payload || typeof payload !== "object") return;
    const action = payload.action;
    if (action === "close_resize_mode") {
      avatarResizeModeEnabled = false;
      // If click-through is still enabled, re-apply it
      if (avatarClickThroughEnabled) {
        for (const avatarWindow of getAllAvatarWindows()) {
          avatarWindow.setIgnoreMouseEvents(true, { forward: true });
        }
        avatarWindowInteractive = false;
      }
      sendAvatarWindowStateSync();
      return;
    }
    if (action === "save_layout_overrides") {
      // layout overrides are managed renderer-side; acknowledge by syncing state
      sendAvatarWindowStateSync();
      return;
    }
    if (action === "set_click_through") {
      avatarClickThroughEnabled = payload.clickThrough === true;
      if (avatarClickThroughEnabled && !avatarResizeModeEnabled) {
        // Enable mouse pass-through immediately
        for (const avatarWindow of getAllAvatarWindows()) {
          avatarWindow.setIgnoreMouseEvents(true, { forward: true });
        }
        avatarWindowInteractive = false;
      } else {
        const senderWindow = BrowserWindow.fromWebContents(event.sender) || null;
        if (senderWindow && !senderWindow.isDestroyed()) {
          setAvatarWindowInteractiveForWindow(senderWindow, true);
        }
      }
      sendAvatarWindowStateSync();
      return;
    }
  });

  ipcMain.on("echo-desktop-live2d:window-resize-request", (event, payload) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
    handleAvatarWindowResizeRequest(payload, browserWindow);
  });

  ipcMain.on("echo-desktop-live2d:window-interactivity", (event, payload) => {
    const normalized = normalizeWindowInteractivityPayload(payload);
    if (!normalized) {
      return;
    }
    const role = getWindowRoleForWebContents(event.sender);
    if (role === DESKTOP_WINDOW_ROLE.AVATAR) {
      setAvatarWindowInteractive(normalized.interactive);
      return;
    }
    if (findStoryCastWindowEntryByWebContents(event.sender)) {
      const browserWindow = BrowserWindow.fromWebContents(event.sender) || null;
      setAvatarWindowInteractiveForWindow(browserWindow, normalized.interactive);
      return;
    }
    if (role === DESKTOP_WINDOW_ROLE.BUBBLE) {
      setBubbleWindowInteractive(normalized.interactive);
    }
  });
}

runDesktopLive2DApp().catch((error) => {
  process.stderr.write(
    `[desktop-live2d electron] ${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
