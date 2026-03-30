import { DesktopLive2DChatWindowRuntime } from "./chat_window_runtime.mjs";

globalThis.__echoDesktopLive2DBootStage = "chat-bootstrap-module-loaded";

const status = document.getElementById("status");
const chatMount = document.getElementById("chat-view");
const desktopApi =
  globalThis.echoDesktopLive2D ?? {
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "chat_window",
      windowRole: "chat"
    },
    registerHostBridgeHandler() {
      return { ok: true, accepted: true, windowRole: "chat" };
    },
    async submitCompanionText() {
      throw new Error("desktop companion api is unavailable");
    },
    async getCompanionState() {
      return null;
    }
  };

function writeBootStatus(message) {
  if (status) {
    status.textContent = String(message);
  }
  console.error("[desktop-live2d chat bootstrap]", String(message));
}

writeBootStatus("desktop-live2d chat bootstrap loaded");

if (document?.documentElement) {
  document.documentElement.dataset.echoDesktopWindowRole =
    desktopApi.shellInfo?.windowRole || "chat";
  document.documentElement.dataset.echoDesktopWindowSurface =
    desktopApi.shellInfo?.windowSurface || "chat_window";
}

globalThis.__echoDesktopLive2DBootStage = "chat-runtime-constructing";

const runtime = new DesktopLive2DChatWindowRuntime({
  chatMountElement: chatMount,
  desktopApi,
  shellInfo: desktopApi.shellInfo
});

globalThis.__echoDesktopLive2DBootStage = "chat-runtime-constructed";
writeBootStatus("desktop-live2d chat runtime constructed");

globalThis.__echoDesktopLive2DBuildDebugSnapshot = () => runtime.buildDebugSnapshot();

globalThis.__echoDesktopLive2DBootStage = "chat-runtime-booting";
writeBootStatus("desktop-live2d chat runtime booting");

runtime
  .boot()
  .then(() => {
    globalThis.__echoDesktopLive2DBootStage = "chat-runtime-ready";
    writeBootStatus("desktop-live2d chat runtime ready");
  })
  .catch((error) => {
    globalThis.__echoDesktopLive2DBootStage = "chat-runtime-boot-failed";
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    writeBootStatus(`desktop-live2d chat runtime boot failed: ${detail}`);
  });
