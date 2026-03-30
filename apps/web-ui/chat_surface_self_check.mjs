import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { DesktopWebChatSurfaceController } from "./public/chat_surface.mjs";

class FakeShell {
  constructor() {
    this.handlers = null;
    this.lastViewModel = null;
    this.rendered = [];
  }

  attach(handlers) {
    this.handlers = handlers;
  }

  render(viewModel) {
    this.lastViewModel = viewModel;
    this.rendered.push(viewModel);
  }
}

function createDeferredConnector() {
  const state = {
    handlers: null
  };
  return {
    connector: async (handlers) => {
      state.handlers = handlers;
      handlers.onOpen?.();
      return () => {
        state.handlers = null;
      };
    },
    emitTranscript(snapshot) {
      state.handlers?.onTranscriptSnapshot(snapshot);
    }
  };
}

async function main() {
  const chatHtml = await fs.readFile(
    new URL("./public/index.html", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(chatHtml, /providerModeChip/);
  assert.doesNotMatch(chatHtml, />Mode</i);
  assert.doesNotMatch(chatHtml, /demo_scripted|real_provider_stack|selected_mode|demo mode|scripted mode/i);

  const shell = new FakeShell();
  const submittedTexts = [];
  const connector = createDeferredConnector();
  let currentSnapshot = {
    session_id: "11111111-1111-4111-8111-111111111111",
    transcript_entries: [
      {
        entry_id: "22222222-2222-4222-8222-222222222222",
        turn_id: "33333333-3333-4333-8333-333333333333",
        role: "assistant",
        text: "Initial browser transcript",
        is_streaming: false,
        sequence_index: 0
      }
    ]
  };

  const controller = new DesktopWebChatSurfaceController({
    shell,
    controlPlaneClient: {
      async loadProviderSettings() {
        return {
          settings_snapshot: {
            local_fast_llm: null
          },
          readiness: {
            runtime_ready: true,
            runtime_message: "ready"
          }
        };
      },
      async getProviderReadiness() {
        return {
          runtime_ready: true,
          runtime_message: "ready"
        };
      },
      async getDesktopState() {
        return {
          companion_session_snapshot: currentSnapshot
        };
      },
      async submitTextTurn(text) {
        submittedTexts.push(text);
        currentSnapshot = {
          session_id: currentSnapshot.session_id,
          transcript_entries: [
            {
              entry_id: "44444444-4444-4444-8444-444444444444",
              turn_id: "55555555-5555-4555-8555-555555555555",
              role: "user",
              text,
              is_streaming: false,
              sequence_index: 0
            },
            {
              entry_id: "66666666-6666-4666-8666-666666666666",
              turn_id: "55555555-5555-4555-8555-555555555555",
              role: "assistant",
              text: "Browser self-check reply",
              is_streaming: false,
              sequence_index: 1
            }
          ]
        };
        return {
          submitted_text: text,
          final_desktop_snapshot: {
            companion_session_snapshot: currentSnapshot
          }
        };
      }
    },
    eventStreamConnector: connector.connector
  });

  await controller.boot();
  assert.equal(shell.lastViewModel.booted, true);
  assert.equal(shell.lastViewModel.messages.length, 1);
  assert.equal(shell.lastViewModel.messages[0].text, "Initial browser transcript");
  assert.equal("providerStackLabel" in shell.lastViewModel, false);

  connector.emitTranscript({
    session_id: currentSnapshot.session_id,
    transcript_entries: [
      currentSnapshot.transcript_entries[0],
      {
        entry_id: "77777777-7777-4777-8777-777777777777",
        turn_id: "88888888-8888-4888-8888-888888888888",
        role: "assistant",
        text: "Streaming",
        is_streaming: true,
        sequence_index: 1
      }
    ]
  });
  assert.equal(shell.lastViewModel.messages.length, 2);
  assert.equal(shell.lastViewModel.messages[1].isStreaming, true);

  connector.emitTranscript({
    session_id: currentSnapshot.session_id,
    transcript_entries: [
      currentSnapshot.transcript_entries[0],
      {
        entry_id: "77777777-7777-4777-8777-777777777777",
        turn_id: "88888888-8888-4888-8888-888888888888",
        role: "assistant",
        text: "Streaming reply complete",
        is_streaming: true,
        sequence_index: 1
      }
    ]
  });
  assert.equal(shell.lastViewModel.messages[1].appendedText, " reply complete");

  connector.emitTranscript({
    session_id: currentSnapshot.session_id,
    transcript_entries: [
      currentSnapshot.transcript_entries[0],
      {
        entry_id: "77777777-7777-4777-8777-777777777777",
        turn_id: "88888888-8888-4888-8888-888888888888",
        role: "assistant",
        text: "Streaming reply complete",
        is_streaming: false,
        sequence_index: 1
      }
    ]
  });
  assert.equal(shell.lastViewModel.messages[1].isStreaming, false);

  shell.handlers.onComposerChange("  hello from browser chat  你好  ");
  await shell.handlers.onSubmit();

  assert.deepEqual(submittedTexts, ["  hello from browser chat  你好  "]);
  assert.equal(shell.lastViewModel.messages.length, 2);
  assert.equal(shell.lastViewModel.messages[0].role, "user");
  assert.equal(shell.lastViewModel.messages[0].text, "  hello from browser chat  你好  ");
  assert.equal(shell.lastViewModel.messages[1].role, "assistant");
  assert.equal(shell.lastViewModel.debugConnected, true);
  assert.equal("providerStackLabel" in shell.lastViewModel, false);

  controller.close();
  process.stdout.write("echo web-ui chat surface self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
