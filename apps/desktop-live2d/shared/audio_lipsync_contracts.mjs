export const AUDIO_LIPSYNC_SOURCE = Object.freeze({
  DESKTOP_PLAYBACK: "desktop_playback"
});

export class AudioLipsyncContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "AudioLipsyncContractError";
  }
}

function ensureFiniteNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AudioLipsyncContractError(`${fieldName} must be a finite number`);
  }
  return value;
}

function ensurePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AudioLipsyncContractError(`${fieldName} must be a positive integer`);
  }
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeMouthOpen(value) {
  return clamp(ensureFiniteNumber(value, "mouthOpen"), 0, 1);
}

export function normalizeVoiceEnergy(value) {
  return clamp(ensureFiniteNumber(value, "voiceEnergy"), 0, 1);
}

export function buildAudioLipsyncFrame({
  frameIndex,
  mouthOpen,
  rawMouthOpen = mouthOpen,
  windowDurationMs,
  sampleCount,
  rootMeanSquare,
  peakAmplitude,
  voiceEnergy = Math.max(
    Number(rootMeanSquare) || 0,
    Number(peakAmplitude) || 0
  ),
  speaking = false,
  source = AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK
}) {
  return Object.freeze({
    frame_index: ensurePositiveInteger(frameIndex + 1, "frameIndex+1") - 1,
    mouth_open: normalizeMouthOpen(mouthOpen),
    raw_mouth_open: normalizeMouthOpen(rawMouthOpen),
    window_duration_ms: ensurePositiveInteger(windowDurationMs, "windowDurationMs"),
    sample_count: ensurePositiveInteger(sampleCount, "sampleCount"),
    root_mean_square: clamp(ensureFiniteNumber(rootMeanSquare, "rootMeanSquare"), 0, 1),
    peak_amplitude: clamp(ensureFiniteNumber(peakAmplitude, "peakAmplitude"), 0, 1),
    voice_energy: normalizeVoiceEnergy(voiceEnergy),
    speaking: Boolean(speaking),
    source
  });
}

export function buildAudioLipsyncSnapshot({
  source = AUDIO_LIPSYNC_SOURCE.DESKTOP_PLAYBACK,
  lipsyncActive = false,
  currentMouthOpen = 0,
  peakMouthOpen = 0,
  frameCount = 0,
  totalAnalyzedDurationMs = 0
} = {}) {
  return Object.freeze({
    source,
    lipsync_active: Boolean(lipsyncActive),
    current_mouth_open: normalizeMouthOpen(currentMouthOpen),
    peak_mouth_open: normalizeMouthOpen(peakMouthOpen),
    frame_count: Math.max(0, Number.isInteger(frameCount) ? frameCount : 0),
    total_analyzed_duration_ms: Math.max(
      0,
      Number.isFinite(totalAnalyzedDurationMs) ? Math.round(totalAnalyzedDurationMs) : 0
    )
  });
}

export function buildAudioLipsyncAnalysisConfig({
  windowDurationMs = 32,
  silenceFloor = 0.018,
  speakingEnergyThreshold = 0.02,
  fullScaleReference = 0.28,
  attackSmoothing = 0.42,
  releaseSmoothing = 0.26,
  minimumMouthOpen = 0.04
} = {}) {
  return Object.freeze({
    window_duration_ms: ensurePositiveInteger(windowDurationMs, "windowDurationMs"),
    silence_floor: clamp(ensureFiniteNumber(silenceFloor, "silenceFloor"), 0, 1),
    speaking_energy_threshold: clamp(
      ensureFiniteNumber(speakingEnergyThreshold, "speakingEnergyThreshold"),
      0,
      1
    ),
    full_scale_reference: clamp(
      ensureFiniteNumber(fullScaleReference, "fullScaleReference"),
      0.0001,
      1
    ),
    attack_smoothing: clamp(ensureFiniteNumber(attackSmoothing, "attackSmoothing"), 0, 1),
    release_smoothing: clamp(
      ensureFiniteNumber(releaseSmoothing, "releaseSmoothing"),
      0,
      1
    ),
    minimum_mouth_open: clamp(
      ensureFiniteNumber(minimumMouthOpen, "minimumMouthOpen"),
      0,
      1
    )
  });
}
