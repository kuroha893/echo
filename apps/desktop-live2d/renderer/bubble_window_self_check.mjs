import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { BubbleStateManager } from "../shared/bubble_state_manager.mjs";
import { DesktopLive2DBubbleWindowRuntime } from "./bubble_window_runtime.mjs";

class FakeBubbleShell {
  constructor() {
    this.renderedSnapshots = [];
    this.lastSnapshot = null;
  }

  render(snapshot) {
    this.renderedSnapshots.push(snapshot);
    this.lastSnapshot = snapshot;
  }
}

async function run() {
  const bubbleHtml = await fs.readFile(
    new URL("./bubble.html", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(bubbleHtml, /demo_scripted|real_provider_stack|selected_mode|demo mode|scripted mode/i);
  assert.doesNotMatch(bubbleHtml, />Mode</i);

  let registeredHandler = null;
  const bubbleShell = new FakeBubbleShell();
  const runtime = new DesktopLive2DBubbleWindowRuntime({
    bubbleMountElement: {},
    statusElement: { textContent: "" },
    desktopApi: {
      shellInfo: {
        appName: "echo-desktop-live2d",
        presentationMode: "full_body",
        windowSurface: "bubble_window",
        windowRole: "bubble"
      },
      async registerHostBridgeHandler(handler) {
        registeredHandler = handler;
        return { ok: true, accepted: true, windowRole: "bubble" };
      }
    },
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "bubble_window",
      windowRole: "bubble"
    },
    bubbleStateManager: new BubbleStateManager(),
    bubbleShell
  });

  await runtime.boot();
  assert.equal(typeof registeredHandler, "function");

  const pingResponse = await registeredHandler({
    request_id: "11111111-1111-4111-8111-111111111111",
    bridge_command: "ping"
  });
  assert.equal(pingResponse.status, "ok");

  const replaceResponse = await registeredHandler({
    request_id: "22222222-2222-4222-8222-222222222222",
    bridge_command: "bubble_replace",
    bubble_text: "Hello bubble window",
    speaker_label: "Echo",
    is_streaming: true
  });
  assert.equal(replaceResponse.status, "ok");
  assert.equal(bubbleShell.lastSnapshot.bubble_text, "Hello bubble window");
  assert.equal(runtime.buildDebugSnapshot().bubble_snapshot.is_streaming, true);

  const appendResponse = await registeredHandler({
    request_id: "33333333-3333-4333-8333-333333333333",
    bridge_command: "bubble_append",
    text_fragment: " more",
    speaker_label: "Echo",
    is_streaming: false
  });
  assert.equal(appendResponse.status, "ok");
  assert.equal(runtime.buildDebugSnapshot().bubble_snapshot.bubble_text, "Hello bubble window more");
  assert.equal(runtime.buildDebugSnapshot().bubble_snapshot.segment_count, 2);

  const snapshotResponse = await registeredHandler({
    request_id: "44444444-4444-4444-8444-444444444444",
    bridge_command: "bubble_snapshot"
  });
  assert.equal(snapshotResponse.status, "ok");
  assert.equal(snapshotResponse.bubble_text, "Hello bubble window more");

  const clearResponse = await registeredHandler({
    request_id: "55555555-5555-4555-8555-555555555555",
    bridge_command: "bubble_clear",
    reason: "self check"
  });
  assert.equal(clearResponse.status, "ok");
  assert.equal(runtime.buildDebugSnapshot().bubble_snapshot.bubble_visible, false);

  const unsupportedResponse = await registeredHandler({
    request_id: "66666666-6666-4666-8666-666666666666",
    bridge_command: "dispatch_command"
  });
  assert.equal(unsupportedResponse.status, "error");
  assert.equal(unsupportedResponse.error_code, "invalid_request");

  process.stdout.write("desktop-live2d bubble window self-check passed\n");
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
