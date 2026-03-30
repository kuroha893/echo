import { DesktopLive2DChatHistoryPanelController } from "./chat_history_panel_controller.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class FakeShell {
  constructor() {
    this.rendered = [];
    this.handlers = null;
    this.pendingImages = [];
  }

  attach(handlers) {
    this.handlers = handlers;
  }

  render(viewModel) {
    this.rendered.push(viewModel);
    this.lastViewModel = viewModel;
  }

  clearPendingImages() {
    this.pendingImages = [];
  }

  getPendingImages() {
    return this.pendingImages;
  }
}

async function runSelfCheck() {
  const fakeShell = new FakeShell();
  const submitted = [];
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const turnId = "22222222-2222-4222-8222-222222222222";
  const imageAttachment = {
    media_type: "image/png",
    data: "ZmFrZQ==",
    detail: "auto",
    previewURL: "data:image/png;base64,ZmFrZQ=="
  };
  const controller = new DesktopLive2DChatHistoryPanelController({
    shell: fakeShell,
    companionApi: {
      async submitCompanionText(text) {
        submitted.push(text);
        return {
          final_desktop_snapshot: {
            companion_session_snapshot: {
              session_id: sessionId,
              latest_turn_id: "99999999-9999-4999-8999-999999999999",
              pending_input_count: 0,
              transcript_entries: [
                {
                  entry_id: "33333333-3333-4333-8333-333333333333",
                  session_id: sessionId,
                  turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  role: "user",
                  text: "older user turn",
                  is_streaming: false,
                  sequence_index: 0
                },
                {
                  entry_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                  session_id: sessionId,
                  turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  role: "assistant",
                  text: "Older assistant reply",
                  is_streaming: false,
                  sequence_index: 1
                },
                {
                  entry_id: "33333333-3333-4333-8333-333333333334",
                  session_id: sessionId,
                  turn_id: turnId,
                  role: "user",
                  text,
                  is_streaming: false,
                  sequence_index: 2
                },
                {
                  entry_id: "44444444-4444-4444-8444-444444444444",
                  session_id: sessionId,
                  turn_id: turnId,
                  role: "assistant",
                  text: "Hello there",
                  is_streaming: false,
                  sequence_index: 3
                }
              ]
            }
          }
        };
      },
      async listSessions() {
        return {
          active_session_id: sessionId,
          sessions: [
            {
              session_id: sessionId,
              title: "Self-check session"
            }
          ]
        };
      },
      async getSessionDetail(requestedSessionId) {
        assert(requestedSessionId === sessionId, "panel should hydrate the active session");
        return {
          session_id: sessionId,
          transcript: [
            {
              entry_id: "33333333-3333-4333-8333-333333333333",
              turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              role: "user",
              text: "older user turn",
              raw_text: "older user turn",
              is_streaming: false,
              sequence_index: 0
            },
            {
              entry_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              role: "assistant",
              text: "Older assistant reply",
              raw_text: "Older assistant reply",
              is_streaming: false,
              sequence_index: 1
            },
            {
              entry_id: "33333333-3333-4333-8333-333333333333",
              turn_id: turnId,
              role: "user",
              text: submitted[0],
              raw_text: submitted[0],
              is_streaming: false,
              sequence_index: 2
            },
            {
              entry_id: "44444444-4444-4444-8444-444444444444",
              turn_id: turnId,
              role: "assistant",
              text: "Hello there",
              raw_text: "Hello there",
              is_streaming: false,
              sequence_index: 3
            }
          ]
        };
      }
    }
  });

  controller.bind();
  controller.setServiceReady(true, null);
  controller.applyCompanionSnapshot({
    session_id: sessionId,
    latest_turn_id: null,
    pending_input_count: 0,
    transcript_entries: []
  });

  assert(fakeShell.lastViewModel.messages.length === 0, "panel should start empty");

  fakeShell.handlers.onComposerChange("hello from panel");
  fakeShell.pendingImages = [imageAttachment];
  fakeShell.handlers.onImagesChange([
    {
      media_type: imageAttachment.media_type,
      data: imageAttachment.data,
      detail: imageAttachment.detail
    }
  ]);
  assert(fakeShell.lastViewModel.canSubmit === true, "panel should allow submit for non-empty text");

  await fakeShell.handlers.onSubmit();

  assert(submitted.length === 1, "panel submit should call companion api once");
  assert(submitted[0] === "hello from panel", "panel submit should preserve text");
  assert(fakeShell.lastViewModel.messages.length === 4, "panel should render hydrated current-session history");
  assert(fakeShell.lastViewModel.statusText === "", "panel should not keep a forced completion status");
  assert(
    fakeShell.lastViewModel.messages[0].role === "user" &&
      fakeShell.lastViewModel.messages[1].role === "assistant" &&
      fakeShell.lastViewModel.messages[2].role === "user" &&
      fakeShell.lastViewModel.messages[3].role === "assistant",
    "panel should preserve older and newest user/assistant turn ordering"
  );
  assert(
    Array.isArray(fakeShell.lastViewModel.messages[0].images) &&
      fakeShell.lastViewModel.messages[0].images.length === 0,
    "panel should not attach submitted images to an older user turn"
  );
  assert(
    Array.isArray(fakeShell.lastViewModel.messages[2].images) &&
      fakeShell.lastViewModel.messages[2].images.length === 1,
    "panel should retain submitted images on the newest hydrated user turn"
  );
  assert(fakeShell.lastViewModel.composerText === "", "panel should clear composer after submit");
  process.stdout.write("desktop-live2d chat panel self-check passed\n");
}

runSelfCheck().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
