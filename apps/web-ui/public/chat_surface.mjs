import { WEB_UI_API_ROUTE, WEB_UI_SSE_EVENT } from "./control_plane_contracts.mjs";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMessageKey(entry, index) {
  return entry.entry_id || `${entry.turn_id || "turn"}:${entry.role}:${index}`;
}

function summarizeReadiness(readiness) {
  if (!readiness) {
    return {
      label: "Connecting",
      className: "",
      detail: "Loading provider readiness..."
    };
  }
  if (readiness.runtime_ready) {
    return {
      label: "Running",
      className: "running",
      detail: readiness.runtime_message || "Local control plane ready"
    };
  }
  return {
    label: "Degraded",
    className: "",
    detail: readiness.runtime_message || "Provider stack not ready"
  };
}

function buildSessionLabel(snapshot) {
  if (!snapshot?.transcript_entries?.length) {
    return "Current session";
  }
  const firstUserEntry = snapshot.transcript_entries.find(
    (entry) => entry.role === "user" && String(entry.text || "").trim() !== ""
  );
  if (!firstUserEntry) {
    return "Current session";
  }
  return String(firstUserEntry.text).trim().slice(0, 28) || "Current session";
}

function splitAnimatedChunks(text) {
  return Array.from(String(text || ""));
}

export class DesktopWebChatSurfaceController {
  constructor({
    shell,
    controlPlaneClient,
    eventStreamConnector,
    now = () => new Date()
  }) {
    this._shell = shell;
    this._controlPlaneClient = controlPlaneClient;
    this._eventStreamConnector = eventStreamConnector;
    this._now = now;
    this._streamCloser = null;
    this._state = {
      desktopState: null,
      providerReadiness: null,
      providerSettings: null,
      composerText: "",
      sidebarOpen: false,
      debugPanelOpen: true,
      debugConnected: false,
      debugLines: [],
      isSubmitting: false,
      messages: [],
      previousMessageTexts: new Map(),
      booted: false
    };
  }

  async boot() {
    this._shell.attach({
      onComposerChange: (value) => {
        this._state.composerText = String(value || "");
        this._render();
      },
      onSubmit: async () => {
        await this.submitComposer();
      },
      onToggleSidebar: () => {
        this._state.sidebarOpen = !this._state.sidebarOpen;
        this._render();
      },
      onToggleDebugPanel: () => {
        this._state.debugPanelOpen = !this._state.debugPanelOpen;
        this._render();
      }
    });

    const [settingsResult, readinessResult, desktopStateResult] = await Promise.all([
      this._controlPlaneClient.loadProviderSettings(),
      this._controlPlaneClient.getProviderReadiness(),
      this._controlPlaneClient.getDesktopState()
    ]);

    this._state.providerSettings = settingsResult?.settings_snapshot || null;
    this._state.providerReadiness = readinessResult || settingsResult?.readiness || null;
    this._applyDesktopState(desktopStateResult);
    this._appendDebugLine("control_plane_boot", {
      local_fast_configured: this._state.providerSettings?.local_fast_llm != null,
      runtime_ready: this._state.providerReadiness?.runtime_ready ?? null
    });

    this._streamCloser = await this._eventStreamConnector({
      onOpen: () => {
        this._state.debugConnected = true;
        this._appendDebugLine("stream_connected", { route: WEB_UI_API_ROUTE.EVENTS });
        this._render();
      },
      onError: (error) => {
        this._state.debugConnected = false;
        this._appendDebugLine("stream_error", {
          message: error instanceof Error ? error.message : String(error)
        });
        this._render();
      },
      onTranscriptSnapshot: (snapshot) => {
        this._applyTranscriptSnapshot(snapshot);
        this._render();
      },
      onProviderReadiness: (readiness) => {
        this._state.providerReadiness = readiness;
        this._render();
      },
      onDebugUpdate: (update) => {
        this._appendDebugLine(update.category || "debug", update);
        this._render();
      }
    });

    this._state.booted = true;
    this._render();
  }

  async submitComposer() {
    const submittedText = this._state.composerText;
    if (!submittedText.trim() || this._state.isSubmitting) {
      return;
    }
    this._state.isSubmitting = true;
    this._render();
    try {
      const result = await this._controlPlaneClient.submitTextTurn(submittedText);
      this._state.composerText = "";
      this._applyDesktopState(result.final_desktop_snapshot);
      this._appendDebugLine("text_turn_submitted", {
        submitted_text: result.submitted_text
      });
    } finally {
      this._state.isSubmitting = false;
      this._render();
    }
  }

  buildViewModel() {
    const transcriptSnapshot =
      this._state.desktopState?.companion_session_snapshot || null;
    const readinessSummary = summarizeReadiness(this._state.providerReadiness);
    return {
      booted: this._state.booted,
      shellTitle: "Echo Chat",
      sidebarOpen: this._state.sidebarOpen,
      debugPanelOpen: this._state.debugPanelOpen,
      debugConnected: this._state.debugConnected,
      sessionTitle: buildSessionLabel(transcriptSnapshot),
      sessionMeta:
        transcriptSnapshot?.session_id || "single-session desktop companion",
      transcriptEntryCount: transcriptSnapshot?.transcript_entries?.length || 0,
      runtimeStatusLabel: readinessSummary.label,
      runtimeStatusClassName: readinessSummary.className,
      runtimeStatusDetail: readinessSummary.detail,
      composerText: this._state.composerText,
      composerDisabled: this._state.isSubmitting,
      messages: this._state.messages,
      debugLines: this._state.debugLines
    };
  }

  close() {
    if (typeof this._streamCloser === "function") {
      this._streamCloser();
      this._streamCloser = null;
    }
  }

  _applyDesktopState(desktopState) {
    this._state.desktopState = desktopState;
    this._applyTranscriptSnapshot(desktopState?.companion_session_snapshot || null);
  }

  _applyTranscriptSnapshot(snapshot) {
    const previousTexts = this._state.previousMessageTexts;
    const nextTexts = new Map();
    const entries = Array.isArray(snapshot?.transcript_entries)
      ? [...snapshot.transcript_entries].sort(
        (left, right) =>
          (left.sequence_index ?? 0) - (right.sequence_index ?? 0)
      )
      : [];
    this._state.messages = entries.map((entry, index) => {
      const key = buildMessageKey(entry, index);
      const isAssistant = entry.role !== "user";
      const rawText = isAssistant && entry.raw_text ? String(entry.raw_text) : "";
      const displayText = rawText || String(entry.text || "");
      const nextText = displayText;
      const previousText = previousTexts.get(key) || "";
      const appendedText =
        entry.is_streaming &&
          previousText &&
          nextText.startsWith(previousText)
          ? nextText.slice(previousText.length)
          : "";
      nextTexts.set(key, nextText);
      return {
        key,
        role: isAssistant ? "assistant" : "user",
        text: nextText,
        stableText: appendedText ? previousText : nextText,
        appendedText,
        isStreaming: entry.is_streaming === true,
        timestamp:
          entry.created_at ||
          `${this._now().getHours().toString().padStart(2, "0")}:${this._now()
            .getMinutes()
            .toString()
            .padStart(2, "0")}`
      };
    });
    this._state.previousMessageTexts = nextTexts;
  }

  _appendDebugLine(label, detail) {
    const line = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      detail
    };
    this._state.debugLines = [line, ...this._state.debugLines].slice(0, 120);
  }

  _render() {
    this._shell.render(this.buildViewModel());
  }
}

export class DesktopWebChatSurfaceShell {
  constructor(documentObject) {
    this._document = documentObject;
    this._handlers = null;
    this._elements = {
      sidebar: documentObject.getElementById("sidebar"),
      menuBtn: documentObject.getElementById("menuBtn"),
      debugPanelToggleBtn: documentObject.getElementById("debugPanelToggleBtn"),
      sessionList: documentObject.getElementById("sessionList"),
      activeSessionName: documentObject.getElementById("activeSessionName"),
      runtimeStatus: documentObject.getElementById("runtimeStatus"),
      runtimeStatusDetail: documentObject.getElementById("runtimeStatusDetail"),
      transcriptCountChip: documentObject.getElementById("transcriptCountChip"),
      messageList: documentObject.getElementById("messageList"),
      debugPanel: documentObject.getElementById("debugPanel"),
      debugStreamStatus: documentObject.getElementById("debugStreamStatus"),
      debugStreamList: documentObject.getElementById("debugStreamList"),
      chatInput: documentObject.getElementById("chatInput"),
      sendBtn: documentObject.getElementById("sendBtn"),
      statusHint: documentObject.getElementById("statusHint")
    };
  }

  attach(handlers) {
    this._handlers = handlers;
    this._elements.menuBtn?.addEventListener("click", () => {
      handlers.onToggleSidebar();
    });
    this._elements.debugPanelToggleBtn?.addEventListener("click", () => {
      handlers.onToggleDebugPanel();
    });
    this._elements.chatInput?.addEventListener("input", (event) => {
      this._autoResizeComposer();
      handlers.onComposerChange(event.target.value);
    });
    this._elements.chatInput?.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        await handlers.onSubmit();
      }
    });
    this._elements.sendBtn?.addEventListener("click", async () => {
      await handlers.onSubmit();
    });
  }

  render(viewModel) {
    this._elements.sidebar?.classList.toggle("open", viewModel.sidebarOpen);
    this._elements.debugPanel?.classList.toggle(
      "collapsed",
      !viewModel.debugPanelOpen
    );
    if (this._elements.activeSessionName) {
      this._elements.activeSessionName.textContent = viewModel.sessionTitle;
    }
    if (this._elements.runtimeStatus) {
      this._elements.runtimeStatus.textContent = viewModel.runtimeStatusLabel;
      this._elements.runtimeStatus.classList.toggle(
        "running",
        viewModel.runtimeStatusClassName === "running"
      );
    }
    if (this._elements.runtimeStatusDetail) {
      this._elements.runtimeStatusDetail.textContent = viewModel.runtimeStatusDetail;
    }
    if (this._elements.transcriptCountChip) {
      this._elements.transcriptCountChip.textContent = `${viewModel.transcriptEntryCount} lines`;
    }
    if (this._elements.statusHint) {
      this._elements.statusHint.textContent = viewModel.sessionMeta;
    }
    if (this._elements.debugStreamStatus) {
      this._elements.debugStreamStatus.textContent = viewModel.debugConnected
        ? "Connected"
        : "Disconnected";
      this._elements.debugStreamStatus.classList.toggle(
        "connected",
        viewModel.debugConnected
      );
    }
    if (
      this._elements.chatInput &&
      this._elements.chatInput.value !== viewModel.composerText
    ) {
      this._elements.chatInput.value = viewModel.composerText;
      this._autoResizeComposer();
    }
    if (this._elements.sendBtn) {
      this._elements.sendBtn.disabled =
        viewModel.composerDisabled || !viewModel.composerText.trim();
    }
    this._renderSingleSessionList(viewModel);
    this._renderMessages(viewModel.messages);
    this._renderDebugLines(viewModel.debugLines);
  }

  _renderSingleSessionList(viewModel) {
    if (!this._elements.sessionList) {
      return;
    }
    this._elements.sessionList.innerHTML = `
      <button class="session-item active" type="button" aria-current="true">
        <div class="session-item-name">${escapeHtml(viewModel.sessionTitle)}</div>
        <div class="session-item-time">${escapeHtml(viewModel.sessionMeta)}</div>
      </button>
    `;
  }

  _renderMessages(messages) {
    if (!this._elements.messageList) {
      return;
    }
    if (messages.length === 0) {
      this._elements.messageList.innerHTML = `
        <div class="empty-hint">
          Echo is ready on the local control plane. Send a message to start the current session.
        </div>
      `;
      return;
    }
    this._elements.messageList.innerHTML = messages
      .map((message) => {
        const animatedFragment = message.appendedText
          ? splitAnimatedChunks(message.appendedText)
            .map(
              (chunk, index) =>
                `<span class="stream-reveal-chunk" style="animation-delay:${Math.min(
                  index * 24,
                  320
                )}ms">${escapeHtml(chunk)}</span>`
            )
            .join("")
          : "";
        const bodyHtml =
          animatedFragment && message.isStreaming
            ? `${escapeHtml(message.stableText)}${animatedFragment}`
            : escapeHtml(message.text);
        return `
          <article class="message-wrap ${message.role}">
            <div class="message-bubble">
              <div class="message-body ${message.isStreaming ? "stream-reveal" : ""}">${bodyHtml}</div>
            </div>
            <div class="message-meta">${escapeHtml(message.role)} · ${escapeHtml(
          message.timestamp
        )}${message.isStreaming ? " · streaming" : ""}</div>
          </article>
        `;
      })
      .join("");
    this._elements.messageList.scrollTop = this._elements.messageList.scrollHeight;
  }

  _renderDebugLines(debugLines) {
    if (!this._elements.debugStreamList) {
      return;
    }
    this._elements.debugStreamList.innerHTML = debugLines
      .map(
        (line) => `
          <div class="debug-line">
            <span class="debug-line-topic">${escapeHtml(line.label)}</span>
            <span class="debug-line-message">${escapeHtml(
          JSON.stringify(line.detail)
        )}</span>
          </div>
        `
      )
      .join("");
  }

  _autoResizeComposer() {
    if (!this._elements.chatInput) {
      return;
    }
    this._elements.chatInput.style.height = "0px";
    this._elements.chatInput.style.height = `${Math.min(
      this._elements.chatInput.scrollHeight,
      220
    )}px`;
  }
}

export function createBrowserControlPlaneClient() {
  async function readJson(url, init = undefined) {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok || payload.status !== "ok") {
      throw new Error(payload.message || `request to ${url} failed`);
    }
    return payload.payload;
  }

  return {
    async loadProviderSettings() {
      return await readJson(WEB_UI_API_ROUTE.PROVIDER_SETTINGS);
    },
    async getProviderReadiness() {
      return await readJson(WEB_UI_API_ROUTE.PROVIDER_READINESS);
    },
    async getDesktopState() {
      return await readJson(WEB_UI_API_ROUTE.DESKTOP_STATE);
    },
    async submitTextTurn(text, { images = [] } = {}) {
      return await readJson(WEB_UI_API_ROUTE.TEXT_TURNS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, images })
      });
    }
  };
}

export async function connectBrowserControlPlaneStream(handlers) {
  const source = new EventSource(WEB_UI_API_ROUTE.EVENTS);
  source.addEventListener("open", () => {
    handlers.onOpen?.();
  });
  source.addEventListener(WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT, (event) => {
    handlers.onTranscriptSnapshot?.(JSON.parse(event.data));
  });
  source.addEventListener(WEB_UI_SSE_EVENT.PROVIDER_READINESS, (event) => {
    handlers.onProviderReadiness?.(JSON.parse(event.data));
  });
  source.addEventListener(WEB_UI_SSE_EVENT.DEBUG_UPDATE, (event) => {
    handlers.onDebugUpdate?.(JSON.parse(event.data));
  });
  source.addEventListener("error", () => {
    handlers.onError?.(new Error("browser control plane event stream errored"));
  });
  return () => {
    source.close();
  };
}

export async function bootDesktopWebChatSurface(documentObject) {
  const shell = new DesktopWebChatSurfaceShell(documentObject);
  const controller = new DesktopWebChatSurfaceController({
    shell,
    controlPlaneClient: createBrowserControlPlaneClient(),
    eventStreamConnector: connectBrowserControlPlaneStream
  });
  await controller.boot();
  return controller;
}
