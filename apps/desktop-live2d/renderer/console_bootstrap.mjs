// Console bootstrap — wires the echoDesktopLive2D preload API to the console runtime.
import { bootConsoleRuntime } from "./console_runtime.mjs";

const api = window.echoDesktopLive2D;
if (!api) {
  document.body.textContent = "Echo preload API unavailable";
} else {
  bootConsoleRuntime(api);
}
