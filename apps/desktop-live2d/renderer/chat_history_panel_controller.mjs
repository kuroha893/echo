function normalizeTranscriptEntries(snapshot, imageHistoryByTurnId = new Map()) {
  const entries = Array.isArray(snapshot?.transcript_entries)
    ? [...snapshot.transcript_entries]
    : [];
  entries.sort((left, right) => left.sequence_index - right.sequence_index);
  return entries.map((entry) => ({
    entryId: entry.entry_id,
    turnId: entry.turn_id,
    role: entry.role,
    text: entry.text,
    isStreaming: entry.is_streaming,
    sequenceIndex: entry.sequence_index,
    images:
      entry.role === "user" && imageHistoryByTurnId.has(entry.turn_id)
        ? imageHistoryByTurnId.get(entry.turn_id)
        : []
  }));
}

export function buildChatHistoryViewModel({
  companionSnapshot,
  imageHistoryByTurnId,
  composerText,
  isSubmitting,
  serviceReady,
  statusText,
  sessions,
  activeSessionId
}) {
  const messages = normalizeTranscriptEntries(
    companionSnapshot,
    imageHistoryByTurnId
  ).map((entry) => ({
    ...entry,
    roleLabel: entry.role === "user" ? "You" : "Echo"
  }));
  return {
    sessionId: companionSnapshot?.session_id || null,
    latestTurnId: companionSnapshot?.latest_turn_id || null,
    pendingInputCount: companionSnapshot?.pending_input_count || 0,
    messages,
    composerText,
    isSubmitting,
    serviceReady,
    canSubmit: serviceReady && !isSubmitting && composerText.trim().length > 0,
    statusText,
    sessions: sessions || [],
    activeSessionId: activeSessionId || null
  };
}

export class DesktopLive2DChatHistoryPanelController {
  constructor({
    shell,
    companionApi
  }) {
    this._shell = shell;
    this._companionApi = companionApi;
    this._companionSnapshot = null;
    this._composerText = "";
    this._pendingImages = [];
    this._imageHistoryByTurnId = new Map();
    this._isSubmitting = false;
    this._serviceReady = false;
    this._statusText = "";
    this._sessions = [];
    this._activeSessionId = null;
  }

  bind() {
    this._shell.attach({
      onComposerChange: (text) => {
        this.setComposerText(text);
      },
      onSubmit: async () => {
        await this.submitComposerText();
      },
      onImagesChange: (images) => {
        this._pendingImages = images;
        this.render();
      },
      onCreateSession: async () => {
        await this.createSession();
      },
      onSwitchSession: async (sessionId) => {
        await this.switchSession(sessionId);
      },
      onDeleteSession: async (sessionId) => {
        await this.deleteSession(sessionId);
      },
      onForkSession: async (sessionId) => {
        await this.forkSession(sessionId);
      }
    });
    this.render();
    this.refreshSessionList({ hydrateActiveSession: true });
  }

  setServiceReady(serviceReady, detail = null) {
    this._serviceReady = Boolean(serviceReady);
    if (detail) {
      this._statusText = detail;
    } else {
      this._statusText = "";
    }
    this.render();
  }

  applyCompanionSnapshot(snapshot) {
    this._companionSnapshot = snapshot;
    this.render();
  }

  getActiveSessionId() {
    return this._activeSessionId;
  }

  _buildSnapshotFromSessionDetail(sessionId, detail) {
    if (!detail?.transcript || !Array.isArray(detail.transcript)) {
      return null;
    }
    return {
      session_id: sessionId,
      latest_turn_id: detail.transcript.length > 0
        ? detail.transcript[detail.transcript.length - 1].turn_id
        : null,
      pending_input_count: 0,
      transcript_entries: detail.transcript.map((entry, index) => ({
        entry_id: entry.entry_id,
        turn_id: entry.turn_id,
        role: entry.role,
        text: entry.text,
        raw_text: entry.raw_text || "",
        is_streaming: false,
        sequence_index: index
      }))
    };
  }

  _collectTranscriptTurnIds(snapshot) {
    return new Set(
      Array.isArray(snapshot?.transcript_entries)
        ? snapshot.transcript_entries
          .map((entry) => entry?.turn_id)
          .filter((turnId) => typeof turnId === "string" && turnId.trim() !== "")
        : []
    );
  }

  _findSubmittedUserTurnId(snapshot, { submittedText, previousTurnIds }) {
    const transcriptEntries = Array.isArray(snapshot?.transcript_entries)
      ? [...snapshot.transcript_entries]
      : [];
    transcriptEntries.sort((left, right) => right.sequence_index - left.sequence_index);

    const normalizedSubmittedText = String(submittedText || "").trim();
    const previousIds = previousTurnIds instanceof Set ? previousTurnIds : new Set();

    const newestUnseenMatchingUserEntry = transcriptEntries.find(
      (entry) =>
        entry?.role === "user"
        && typeof entry.turn_id === "string"
        && !previousIds.has(entry.turn_id)
        && String(entry.text || "").trim() === normalizedSubmittedText
    );
    if (newestUnseenMatchingUserEntry?.turn_id) {
      return newestUnseenMatchingUserEntry.turn_id;
    }

    const newestUnseenUserEntry = transcriptEntries.find(
      (entry) =>
        entry?.role === "user"
        && typeof entry.turn_id === "string"
        && !previousIds.has(entry.turn_id)
    );
    if (newestUnseenUserEntry?.turn_id) {
      return newestUnseenUserEntry.turn_id;
    }

    const newestMatchingUserEntry = transcriptEntries.find(
      (entry) =>
        entry?.role === "user"
        && typeof entry.turn_id === "string"
        && String(entry.text || "").trim() === normalizedSubmittedText
    );
    if (newestMatchingUserEntry?.turn_id) {
      return newestMatchingUserEntry.turn_id;
    }

    const newestUserEntry = transcriptEntries.find(
      (entry) => entry?.role === "user" && typeof entry.turn_id === "string"
    );
    return newestUserEntry?.turn_id || null;
  }

  _retainImageHistoryForTurnIds(turnIds) {
    const keepIds = new Set(
      Array.isArray(turnIds)
        ? turnIds.filter((turnId) => typeof turnId === "string" && turnId.trim() !== "")
        : []
    );
    if (keepIds.size === 0) {
      this._imageHistoryByTurnId.clear();
      return;
    }
    for (const turnId of Array.from(this._imageHistoryByTurnId.keys())) {
      if (!keepIds.has(turnId)) {
        this._imageHistoryByTurnId.delete(turnId);
      }
    }
  }

  async hydrateSessionDetail(sessionId) {
    const detail = await this._companionApi.getSessionDetail(sessionId);
    this._retainImageHistoryForTurnIds(
      Array.isArray(detail?.transcript)
        ? detail.transcript.map((entry) => entry?.turn_id)
        : []
    );
    this._companionSnapshot = this._buildSnapshotFromSessionDetail(sessionId, detail);
    this.render();
    return detail;
  }

  setComposerText(text) {
    this._composerText = String(text || "");
    this.render();
  }

  async submitComposerText() {
    const submittedText = this._composerText;
    const submittedImages = this._pendingImages;
    const previousTurnIds = this._collectTranscriptTurnIds(this._companionSnapshot);
    const submittedImageHistorySource =
      typeof this._shell.getPendingImages === "function"
        ? this._shell.getPendingImages()
        : submittedImages;
    const submittedImageHistory = submittedImageHistorySource.map(
      ({ media_type, data, detail }) => ({ media_type, data, detail })
    );
    if (!this._serviceReady || !submittedText.trim() || this._isSubmitting) {
      this.render();
      return null;
    }

    this._isSubmitting = true;
    this._statusText = "Sending...";
    this.render();
    try {
      const result = await this._companionApi.submitCompanionText(
        submittedText,
        { images: submittedImages }
      );
      const companionSnapshot =
        result?.final_desktop_snapshot?.companion_session_snapshot || null;
      if (companionSnapshot) {
        this._companionSnapshot = companionSnapshot;
      }
      this._composerText = "";
      this._pendingImages = [];
      this._shell.clearPendingImages?.();
      this._statusText = "";
      const hydratedSessionId =
        companionSnapshot?.session_id || this._activeSessionId || null;
      if (hydratedSessionId) {
        await this.hydrateSessionDetail(hydratedSessionId);
        const submittedTurnId = this._findSubmittedUserTurnId(this._companionSnapshot, {
          submittedText,
          previousTurnIds,
        });
        if (submittedTurnId && submittedImageHistory.length > 0) {
          this._imageHistoryByTurnId.set(submittedTurnId, submittedImageHistory);
          this.render();
        }
        await this.refreshSessionList({ clearMissingSnapshot: true });
      } else {
        await this.refreshSessionList({
          hydrateActiveSession: true,
          clearMissingSnapshot: true
        });
      }
      return result;
    } catch (error) {
      this._statusText = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this._isSubmitting = false;
      this.render();
    }
  }

  async refreshSessionList({ hydrateActiveSession = false, clearMissingSnapshot = false } = {}) {
    try {
      const result = await this._companionApi.listSessions();
      this._sessions = result?.sessions || [];
      this._activeSessionId = result?.active_session_id || null;
      if (
        hydrateActiveSession
        && this._activeSessionId
        && this._companionSnapshot?.session_id !== this._activeSessionId
      ) {
        await this.hydrateSessionDetail(this._activeSessionId);
      } else if (
        clearMissingSnapshot
        && this._companionSnapshot?.session_id
        && !this._sessions.some((session) => session.session_id === this._companionSnapshot.session_id)
      ) {
        this._companionSnapshot = null;
        this._imageHistoryByTurnId.clear();
      }
      this.render();
    } catch {
      // session list unavailable, keep existing state
    }
  }

  async createSession() {
    try {
      await this._companionApi.createSession({ title: "" });
      this._companionSnapshot = null;
      this._imageHistoryByTurnId.clear();
      await this.refreshSessionList({ hydrateActiveSession: true, clearMissingSnapshot: true });
    } catch (error) {
      this._statusText = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  async switchSession(sessionId) {
    if (this._isSubmitting) {
      this._statusText = "Cannot switch sessions while a turn is in progress";
      this.render();
      return;
    }
    try {
      await this._companionApi.switchSession(sessionId);
      this._companionSnapshot = null;
      await this.hydrateSessionDetail(sessionId);
      await this.refreshSessionList();
    } catch (error) {
      this._statusText = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  async deleteSession(sessionId) {
    try {
      await this._companionApi.deleteSession(sessionId);
      if (this._activeSessionId === sessionId) {
        this._companionSnapshot = null;
        this._imageHistoryByTurnId.clear();
      }
      await this.refreshSessionList({ hydrateActiveSession: true, clearMissingSnapshot: true });
    } catch (error) {
      this._statusText = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  async forkSession(sessionId) {
    try {
      await this._companionApi.forkSession({
        source_session_id: sessionId,
        make_active: true
      });
      this._companionSnapshot = null;
      this._imageHistoryByTurnId.clear();
      await this.refreshSessionList({ hydrateActiveSession: true, clearMissingSnapshot: true });
    } catch (error) {
      this._statusText = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  render() {
    this._shell.render(
      buildChatHistoryViewModel({
        companionSnapshot: this._companionSnapshot,
        imageHistoryByTurnId: this._imageHistoryByTurnId,
        composerText: this._composerText,
        isSubmitting: this._isSubmitting,
        serviceReady: this._serviceReady,
        statusText: this._statusText,
        sessions: this._sessions,
        activeSessionId: this._activeSessionId
      })
    );
  }
}
