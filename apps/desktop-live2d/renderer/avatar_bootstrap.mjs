import { DesktopLive2DAvatarWindowRuntime } from "./avatar_window_runtime.mjs";

globalThis.__echoDesktopLive2DBootStage = "avatar-bootstrap-module-loaded";

const stage = document.getElementById("stage");
const status = document.getElementById("status");
const runtimeLabel = document.getElementById("avatar-runtime-label");
const runtimeDot = document.getElementById("avatar-runtime-dot");
const playbackLabel = document.getElementById("avatar-playback-label");
const playbackDot = document.getElementById("avatar-playback-dot");
const lipsyncLabel = document.getElementById("avatar-lipsync-label");
const lipsyncMeterFill = document.getElementById("avatar-lipsync-meter-fill");
const desktopApi =
  globalThis.echoDesktopLive2D ?? {
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "character_window",
      windowRole: "avatar"
    },
    registerHostBridgeHandler() {
      return { ok: true, accepted: true, windowRole: "avatar" };
    }
  };
const pageUrl = new URL(globalThis.location?.href || "http://localhost/");
const selectedModelKey = pageUrl.searchParams.get("modelKey") || null;
const sceneManifestUrl = pageUrl.searchParams.get("sceneManifestUrl") || null;
const passivePreview = pageUrl.searchParams.get("passivePreview") === "1";
const disableHostBridge = pageUrl.searchParams.get("disableHostBridge") === "1";

function writeBootStatus(message) {
  if (status) {
    status.textContent = String(message);
  }
  console.error("[desktop-live2d avatar bootstrap]", String(message));
}

writeBootStatus("desktop-live2d avatar bootstrap loaded");

if (document?.documentElement) {
  document.documentElement.dataset.echoDesktopWindowRole =
    desktopApi.shellInfo?.windowRole || "avatar";
  document.documentElement.dataset.echoDesktopWindowSurface =
    desktopApi.shellInfo?.windowSurface || "character_window";
}

globalThis.__echoDesktopLive2DBootStage = "avatar-runtime-constructing";

const runtime = new DesktopLive2DAvatarWindowRuntime({
  stageElement: stage,
  statusElement: status,
  runtimeLabelElement: runtimeLabel,
  runtimeDotElement: runtimeDot,
  playbackLabelElement: playbackLabel,
  playbackDotElement: playbackDot,
  lipsyncLabelElement: lipsyncLabel,
  lipsyncMeterFillElement: lipsyncMeterFill,
  desktopApi,
  shellInfo: desktopApi.shellInfo,
  selectedModelKey,
  sceneManifestUrl,
  passivePreview,
  disableHostBridge
});

globalThis.__echoDesktopLive2DBootStage = "avatar-runtime-constructed";
writeBootStatus("desktop-live2d avatar runtime constructed");

globalThis.__echoDesktopLive2DBuildDebugSnapshot = () => runtime.buildDebugSnapshot();

globalThis.__echoDesktopLive2DBootStage = "avatar-runtime-booting";
writeBootStatus("desktop-live2d avatar runtime booting");

await runtime.boot();
globalThis.__echoDesktopLive2DBootStage = "avatar-runtime-ready";
writeBootStatus("desktop-live2d avatar runtime ready");

function applySpeakingMotionEnabled(enabled) {
  const backend = runtime._sceneHost?.getController()?.getBackend?.();
  if (backend && typeof backend.setSpeakingMotionEnabled === "function") {
    backend.setSpeakingMotionEnabled(enabled);
  }
}

if (desktopApi.getSpeakingMotionEnabled) {
  try {
    applySpeakingMotionEnabled(await desktopApi.getSpeakingMotionEnabled());
  } catch {
    // Ignore sync failures and keep runtime default.
  }
}

if (desktopApi.onSpeakingMotionEnabled) {
  desktopApi.onSpeakingMotionEnabled((enabled) => {
    applySpeakingMotionEnabled(enabled);
  });
}
