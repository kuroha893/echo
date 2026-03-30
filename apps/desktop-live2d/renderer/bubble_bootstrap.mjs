import { DesktopLive2DBubbleWindowRuntime } from "./bubble_window_runtime.mjs";

globalThis.__echoDesktopLive2DBootStage = "bubble-bootstrap-module-loaded";

const bubbleMount = document.getElementById("bubble-view");
const status = document.getElementById("status");
const desktopApi = globalThis.echoDesktopLive2D;

if (!bubbleMount) {
  throw new Error("desktop-live2d bubble mount element '#bubble-view' is missing");
}

if (!desktopApi || typeof desktopApi.registerHostBridgeHandler !== "function") {
  throw new Error("desktop-live2d bubble preload API is unavailable");
}

function writeBootStatus(message) {
  globalThis.__echoDesktopBubbleSetDebugState?.({
    bootStage: globalThis.__echoDesktopLive2DBootStage || "unknown",
    bootStatus: String(message)
  });
  if (status) {
    status.textContent = String(message);
  }
  console.error("[desktop-live2d bubble bootstrap]", String(message));
}

writeBootStatus("desktop-live2d bubble bootstrap loaded");

if (document?.documentElement) {
  document.documentElement.dataset.echoDesktopWindowRole =
    desktopApi.shellInfo?.windowRole || "bubble";
  document.documentElement.dataset.echoDesktopWindowSurface =
    desktopApi.shellInfo?.windowSurface || "bubble_window";
}

globalThis.__echoDesktopLive2DBootStage = "bubble-runtime-constructing";

const runtime = new DesktopLive2DBubbleWindowRuntime({
  bubbleMountElement: bubbleMount,
  statusElement: status,
  desktopApi,
  shellInfo: desktopApi.shellInfo
});

globalThis.__echoDesktopLive2DBootStage = "bubble-runtime-constructed";
writeBootStatus("desktop-live2d bubble runtime constructed");

globalThis.__echoDesktopApplyBubbleText = (payload) => {
  globalThis.__echoDesktopBubbleSetDebugState?.({
    lastPayloadPreview: String(payload?.text || "").slice(0, 120),
    lastPayloadLength: typeof payload?.text === "string" ? payload.text.length : 0,
    isStreaming: payload?.isStreaming === true,
    speakerColor: payload?.speakerColor || null
  });
  runtime.applyExternalBubbleText({
    text: payload?.text || "",
    isStreaming: payload?.isStreaming === true,
    speakerLabel: payload?.speakerLabel || "Echo"
  });
};

if (typeof desktopApi.onBubbleText === "function") {
  desktopApi.onBubbleText((payload) => {
    globalThis.__echoDesktopApplyBubbleText(payload);
  });
}

globalThis.__echoDesktopLive2DBuildDebugSnapshot = () => runtime.buildDebugSnapshot();

globalThis.__echoDesktopLive2DBootStage = "bubble-runtime-booting";
writeBootStatus("desktop-live2d bubble runtime booting");

runtime
  .boot()
  .then(() => {
    globalThis.__echoDesktopLive2DBootStage = "bubble-runtime-ready";
    globalThis.__echoDesktopBubbleSetDebugState?.({
      bootStage: globalThis.__echoDesktopLive2DBootStage,
      runtimeStatus: "runtime ready"
    });
    writeBootStatus("desktop-live2d bubble runtime ready");
  })
  .catch((error) => {
    globalThis.__echoDesktopLive2DBootStage = "bubble-runtime-boot-failed";
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    globalThis.__echoDesktopBubbleSetDebugState?.({
      bootStage: globalThis.__echoDesktopLive2DBootStage,
      runtimeStatus: `boot failed: ${detail}`
    });
    writeBootStatus(`desktop-live2d bubble runtime boot failed: ${detail}`);
  });
