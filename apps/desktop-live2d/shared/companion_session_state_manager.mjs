import {
  buildCompanionPendingInputFromRequest,
  buildCompanionSessionSnapshot,
  buildCompanionTranscriptEntryFromRequest,
  DesktopLive2DCompanionSessionContractError,
  normalizeCompanionInputDrainRequest,
  normalizeCompanionInputEnqueueRequest,
  normalizeCompanionTranscriptUpsertRequest
} from "./companion_session_contracts.mjs";

function cloneTranscriptEntry(entry) {
  return {
    entry_id: entry.entry_id,
    session_id: entry.session_id,
    turn_id: entry.turn_id,
    role: entry.role,
    text: entry.text,
    raw_text: entry.raw_text || "",
    is_streaming: entry.is_streaming,
    sequence_index: entry.sequence_index
  };
}

function clonePendingInput(item) {
  return {
    input_id: item.input_id,
    session_id: item.session_id,
    text: item.text,
    queue_index: item.queue_index
  };
}

export class CompanionSessionStateManager {
  constructor() {
    this._sessionId = null;
    this._latestTurnId = null;
    this._transcriptEntries = [];
    this._pendingInputs = [];
  }

  getSnapshot() {
    return buildCompanionSessionSnapshot({
      sessionId: this._sessionId,
      transcriptEntries: this._transcriptEntries.map(cloneTranscriptEntry),
      pendingInputCount: this._pendingInputs.length,
      latestTurnId: this._latestTurnId
    });
  }

  resetForSession(sessionId, transcriptEntries = []) {
    this._sessionId = sessionId;
    this._latestTurnId = null;
    this._transcriptEntries = transcriptEntries.map((entry, idx) => ({
      entry_id: entry.entry_id || `restored-${idx}`,
      session_id: sessionId,
      turn_id: entry.turn_id,
      role: entry.role,
      text: entry.text,
      raw_text: entry.raw_text || "",
      is_streaming: false,
      sequence_index: idx
    }));
    this._pendingInputs = [];
    if (this._transcriptEntries.length > 0) {
      this._latestTurnId =
        this._transcriptEntries[this._transcriptEntries.length - 1].turn_id;
    }
    return this.getSnapshot();
  }

  upsertTranscript(rawRequest) {
    const request = normalizeCompanionTranscriptUpsertRequest(rawRequest);
    this._ensureSessionConsistency(request.session_id);
    this._latestTurnId = request.turn_id;

    const existingIndex = this._transcriptEntries.findIndex(
      (entry) =>
        entry.turn_id === request.turn_id &&
        entry.role === request.role
    );
    if (existingIndex >= 0) {
      const existingEntry = this._transcriptEntries[existingIndex];
      this._transcriptEntries[existingIndex] = buildCompanionTranscriptEntryFromRequest({
        request,
        sequenceIndex: existingEntry.sequence_index,
        existingEntryId: existingEntry.entry_id
      });
      return this.getSnapshot();
    }

    this._transcriptEntries.push(
      buildCompanionTranscriptEntryFromRequest({
        request,
        sequenceIndex: this._transcriptEntries.length
      })
    );
    return this.getSnapshot();
  }

  enqueueInput(rawRequest) {
    const request = normalizeCompanionInputEnqueueRequest(rawRequest);
    this._ensureSessionConsistency(request.session_id);
    this._pendingInputs.push(
      buildCompanionPendingInputFromRequest({
        request,
        queueIndex: this._pendingInputs.length
      })
    );
    return {
      snapshot: this.getSnapshot(),
      pending_input: clonePendingInput(this._pendingInputs[this._pendingInputs.length - 1])
    };
  }

  drainInputs(rawRequest) {
    const request = normalizeCompanionInputDrainRequest(rawRequest);
    if (this._sessionId !== null && request.session_id !== this._sessionId) {
      throw new DesktopLive2DCompanionSessionContractError(
        `companion session input drain session_id '${request.session_id}' does not match active session '${this._sessionId}'`
      );
    }
    const drained = this._pendingInputs.map(clonePendingInput);
    this._pendingInputs = [];
    return {
      snapshot: this.getSnapshot(),
      drained_inputs: drained
    };
  }

  _ensureSessionConsistency(sessionId) {
    if (this._sessionId === null) {
      this._sessionId = sessionId;
      return;
    }
    if (this._sessionId !== sessionId) {
      this.resetForSession(sessionId);
    }
  }
}
