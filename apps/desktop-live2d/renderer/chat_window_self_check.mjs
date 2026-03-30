import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { DesktopLive2DChatHistoryPanelController } from "./chat_history_panel_controller.mjs";
import { DesktopLive2DChatWindowRuntime } from "./chat_window_runtime.mjs";

class FakeShell {
  constructor() {
    this.handlers = null;
    this.rendered = [];
    this.lastViewModel = null;
  }

  attach(handlers) {
    this.handlers = handlers;
  }

  render(viewModel) {
    this.rendered.push(viewModel);
    this.lastViewModel = viewModel;
  }
}

async function run() {
  const chatHtml = await fs.readFile(
    new URL("./chat.html", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(chatHtml, /demo_scripted|real_provider_stack|selected_mode|demo mode|scripted mode/i);
  assert.doesNotMatch(chatHtml, />Mode</i);

  let registeredHandler = null;
  const submittedTexts = [];
  const fakeShell = new FakeShell();
  const submitCompanionText = async (text) => {
    submittedTexts.push(text);
    return {
      final_desktop_snapshot: {
        companion_session_snapshot: {
          session_id: "11111111-1111-4111-8111-111111111111",
          latest_turn_id: "66666666-6666-4666-8666-666666666666",
          pending_input_count: 0,
          transcript_entries: [
            {
              entry_id: "77777777-7777-4777-8777-777777777777",
              session_id: "11111111-1111-4111-8111-111111111111",
              turn_id: "66666666-6666-4666-8666-666666666666",
              role: "user",
              text,
              is_streaming: false,
              sequence_index: 0
            },
            {
              entry_id: "88888888-8888-4888-8888-888888888888",
              session_id: "11111111-1111-4111-8111-111111111111",
              turn_id: "66666666-6666-4666-8666-666666666666",
              role: "assistant",
              text: "Chat window turn complete",
              is_streaming: false,
              sequence_index: 1
            }
          ]
        }
      }
    };
  };
  const panelController = new DesktopLive2DChatHistoryPanelController({
    shell: fakeShell,
    companionApi: {
      submitCompanionText
    }
  });

  const desktopApi = {
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "chat_window",
      windowRole: "chat"
    },
    async registerHostBridgeHandler(handler) {
      registeredHandler = handler;
      return { ok: true, accepted: true, windowRole: "chat" };
    },
    async getCompanionState() {
      return {
        companion_session_snapshot: {
          session_id: "11111111-1111-4111-8111-111111111111",
          latest_turn_id: "22222222-2222-4222-8222-222222222222",
          pending_input_count: 0,
          transcript_entries: [
            {
              entry_id: "33333333-3333-4333-8333-333333333333",
              session_id: "11111111-1111-4111-8111-111111111111",
              turn_id: "22222222-2222-4222-8222-222222222222",
              role: "assistant",
              text: "Initial desktop transcript",
              is_streaming: false,
              sequence_index: 0
            }
          ]
        }
      };
    },
    submitCompanionText
  };

  const runtime = new DesktopLive2DChatWindowRuntime({
    desktopApi,
    shellInfo: desktopApi.shellInfo,
    panelController
  });

  await runtime.boot();

  assert.equal(typeof registeredHandler, "function");
  assert.equal(runtime.buildDebugSnapshot().bridge_target_accepted, true);
  assert.equal(fakeShell.lastViewModel.statusText, "");
  assert.equal(fakeShell.lastViewModel.messages.length, 1);
  assert.equal(
    fakeShell.lastViewModel.messages[0].text,
    "Initial desktop transcript"
  );

  const streamingResponse = await registeredHandler({
    request_id: "99999999-9999-4999-8999-999999999999",
    bridge_command: "companion_session_upsert_transcript",
    session_id: "11111111-1111-4111-8111-111111111111",
    turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "assistant",
    text: "streaming chat reply",
    is_streaming: true
  });
  assert.equal(streamingResponse.status, "ok");
  assert.equal(fakeShell.lastViewModel.messages.length, 2);
  assert.equal(fakeShell.lastViewModel.messages[1].isStreaming, true);

  const settledResponse = await registeredHandler({
    request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    bridge_command: "companion_session_upsert_transcript",
    session_id: "11111111-1111-4111-8111-111111111111",
    turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "assistant",
    text: "streaming chat reply finished",
    is_streaming: false
  });
  assert.equal(settledResponse.status, "ok");
  assert.equal(fakeShell.lastViewModel.messages.length, 2);
  assert.equal(
    fakeShell.lastViewModel.messages[1].text,
    "streaming chat reply finished"
  );
  assert.equal(fakeShell.lastViewModel.messages[1].isStreaming, false);

  const enqueueResponse = await registeredHandler({
    request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    bridge_command: "companion_session_enqueue_input",
    session_id: "11111111-1111-4111-8111-111111111111",
    text: "queued from host bridge"
  });
  assert.equal(enqueueResponse.status, "ok");
  assert.equal(
    enqueueResponse.companion_session_snapshot.pending_input_count,
    1
  );

  const drainResponse = await registeredHandler({
    request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    bridge_command: "companion_session_drain_input",
    session_id: "11111111-1111-4111-8111-111111111111"
  });
  assert.equal(drainResponse.status, "ok");
  assert.equal(drainResponse.drained_inputs.length, 1);
  assert.equal(drainResponse.drained_inputs[0].text, "queued from host bridge");
  assert.equal(
    drainResponse.companion_session_snapshot.pending_input_count,
    0
  );

  fakeShell.handlers.onComposerChange("  hello from dedicated chat window  你好  ");
  await fakeShell.handlers.onSubmit();

  assert.deepEqual(submittedTexts, ["  hello from dedicated chat window  你好  "]);
  assert.equal(fakeShell.lastViewModel.messages.length, 2);
  assert.equal(fakeShell.lastViewModel.statusText, "");
  assert.equal(fakeShell.lastViewModel.messages[0].role, "user");
  assert.equal(
    fakeShell.lastViewModel.messages[0].text,
    "  hello from dedicated chat window  你好  "
  );
  assert.equal(fakeShell.lastViewModel.messages[1].role, "assistant");
  assert.equal(
    fakeShell.lastViewModel.messages[1].text,
    "Chat window turn complete"
  );

  process.stdout.write("desktop-live2d chat window self-check passed\n");
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
