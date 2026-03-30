export const AUDIO_PLAYBACK_RUNTIME_MODE = Object.freeze({
  HEADLESS: "headless",
  DEVICE_AUDIO: "device_audio"
});

export const AUDIO_PLAYBACK_REPORT_KIND = Object.freeze({
  ACCEPTED: "accepted",
  STARTED: "started",
  FINISHED: "finished",
  ABORTED: "aborted",
  FAILED: "failed"
});

export class AudioPlaybackContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "AudioPlaybackContractError";
  }
}

export class AudioPlaybackAbortedError extends Error {
  constructor(message = "desktop-live2d audio playback aborted") {
    super(message);
    this.name = "AudioPlaybackAbortedError";
  }
}

function ensureString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AudioPlaybackContractError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function ensureBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new AudioPlaybackContractError(`${fieldName} must be a boolean`);
  }
  return value;
}

function ensureNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new AudioPlaybackContractError(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function ensurePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AudioPlaybackContractError(`${fieldName} must be a positive integer`);
  }
  return value;
}

export function buildAudioPlaybackSnapshot({
  owner = null,
  sessionId = null,
  traceId = null,
  turnId = null,
  ttsStreamId = null,
  chunkIndex = null,
  playbackActive = false,
  bufferedFragmentCount = 0,
  finalFragmentReceived = false,
  lastReportKind = null,
  lastReason = null
} = {}) {
  return Object.freeze({
    owner,
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    tts_stream_id: ttsStreamId,
    chunk_index: chunkIndex,
    playback_active: playbackActive,
    buffered_fragment_count: bufferedFragmentCount,
    final_fragment_received: finalFragmentReceived,
    last_report_kind: lastReportKind,
    last_reason: lastReason
  });
}

export function buildAudioPlaybackReport({
  reportKind,
  owner,
  sessionId,
  traceId,
  turnId,
  ttsStreamId,
  chunkIndex,
  fragmentIndex = null,
  isInterruptible = null,
  reason = null,
  message = null
}) {
  return Object.freeze({
    report_kind: reportKind,
    owner,
    session_id: sessionId,
    trace_id: traceId,
    turn_id: turnId,
    tts_stream_id: ttsStreamId,
    chunk_index: chunkIndex,
    fragment_index: fragmentIndex,
    is_interruptible: isInterruptible,
    reason,
    message
  });
}

export function normalizeAudioPlaybackFragmentRequest(rawRequest) {
  const fragmentIndex = ensureNonNegativeInteger(
    rawRequest.fragment_index,
    "fragment_index"
  );
  const chunkIndex = ensureNonNegativeInteger(rawRequest.chunk_index, "chunk_index");
  return Object.freeze({
    session_id: ensureString(rawRequest.session_id, "session_id"),
    trace_id: ensureString(rawRequest.trace_id, "trace_id"),
    turn_id: ensureString(rawRequest.turn_id, "turn_id"),
    owner: ensureString(rawRequest.owner, "owner"),
    tts_stream_id: ensureString(rawRequest.tts_stream_id, "tts_stream_id"),
    chunk_index: chunkIndex,
    tts_text: ensureString(rawRequest.tts_text, "tts_text"),
    is_interruptible: ensureBoolean(rawRequest.is_interruptible, "is_interruptible"),
    fragment_index: fragmentIndex,
    audio_bytes_base64: ensureString(rawRequest.audio_bytes_base64, "audio_bytes_base64"),
    sample_rate_hz: ensurePositiveInteger(rawRequest.sample_rate_hz, "sample_rate_hz"),
    channel_count: ensurePositiveInteger(rawRequest.channel_count, "channel_count"),
    is_final: ensureBoolean(rawRequest.is_final, "is_final"),
    media_type:
      rawRequest.media_type === null || rawRequest.media_type === undefined
        ? null
        : ensureString(rawRequest.media_type, "media_type")
  });
}

export function normalizeAudioPlaybackAbortRequest(rawRequest) {
  return Object.freeze({
    session_id: ensureString(rawRequest.session_id, "session_id"),
    trace_id: ensureString(rawRequest.trace_id, "trace_id"),
    turn_id: ensureString(rawRequest.turn_id, "turn_id"),
    owner: ensureString(rawRequest.owner, "owner"),
    tts_stream_id: ensureString(rawRequest.tts_stream_id, "tts_stream_id"),
    chunk_index: ensureNonNegativeInteger(rawRequest.chunk_index, "chunk_index"),
    reason: ensureString(rawRequest.reason, "reason")
  });
}

export function estimatePlaybackDurationMs({
  audioByteLength,
  sampleRateHz,
  channelCount,
  mediaType
}) {
  ensurePositiveInteger(audioByteLength, "audioByteLength");
  ensurePositiveInteger(sampleRateHz, "sampleRateHz");
  ensurePositiveInteger(channelCount, "channelCount");

  if (mediaType === null || mediaType === "audio/pcm;encoding=s16le") {
    const bytesPerFrame = channelCount * 2;
    return Math.max(
      10,
      Math.ceil((audioByteLength / (sampleRateHz * bytesPerFrame)) * 1000)
    );
  }

  if (mediaType === "audio/wav") {
    const payloadLength = Math.max(1, audioByteLength - 44);
    const bytesPerFrame = channelCount * 2;
    return Math.max(
      10,
      Math.ceil((payloadLength / (sampleRateHz * bytesPerFrame)) * 1000)
    );
  }

  throw new AudioPlaybackContractError(
    `desktop-live2d headless audio backend does not support media_type '${mediaType}'`
  );
}
