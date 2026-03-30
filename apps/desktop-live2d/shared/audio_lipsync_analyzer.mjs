import {
  AudioLipsyncContractError,
  buildAudioLipsyncAnalysisConfig,
  buildAudioLipsyncFrame
} from "./audio_lipsync_contracts.mjs";
import { decodeBase64AudioBytes } from "./audio_byte_utils.mjs";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function decodePcmS16leSamples(audioBuffer, channelCount) {
  if (audioBuffer.byteLength % 2 !== 0) {
    throw new AudioLipsyncContractError(
      "pcm s16le audio must contain an even number of bytes"
    );
  }
  const frameStride = channelCount * 2;
  if (audioBuffer.byteLength % frameStride !== 0) {
    throw new AudioLipsyncContractError(
      "pcm s16le audio byte length must align with the declared channel count"
    );
  }
  const view = new DataView(
    audioBuffer.buffer,
    audioBuffer.byteOffset,
    audioBuffer.byteLength
  );
  const samples = [];
  for (let offset = 0; offset < audioBuffer.byteLength; offset += frameStride) {
    let mixed = 0;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = view.getInt16(offset + channelIndex * 2, true) / 32768;
      mixed += sample;
    }
    samples.push(mixed / channelCount);
  }
  return samples;
}

function decodeWavSamples(audioBuffer, channelCount) {
  if (audioBuffer.byteLength <= 44) {
    throw new AudioLipsyncContractError("wav audio must be larger than a header-only payload");
  }
  return decodePcmS16leSamples(audioBuffer.subarray(44), channelCount);
}

function decodeFragmentSamples(fragment) {
  const audioBuffer = decodeBase64AudioBytes(fragment.audio_bytes_base64);
  const mediaType = fragment.media_type || "audio/pcm;encoding=s16le";
  if (mediaType === "audio/pcm;encoding=s16le") {
    return decodePcmS16leSamples(audioBuffer, fragment.channel_count);
  }
  if (mediaType === "audio/wav") {
    return decodeWavSamples(audioBuffer, fragment.channel_count);
  }
  throw new AudioLipsyncContractError(
    `desktop-live2d lipsync analyzer does not support media_type '${mediaType}'`
  );
}

function validateActivePlaybackFormat(fragment) {
  if (fragment.sample_rate_hz !== 24000) {
    throw new AudioLipsyncContractError(
      "desktop-live2d lipsync analyzer requires 24000Hz active playback audio"
    );
  }
  if (fragment.channel_count !== 1) {
    throw new AudioLipsyncContractError(
      "desktop-live2d lipsync analyzer requires mono active playback audio"
    );
  }
}

function calculateWindowStatistics(samples) {
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    sumSquares += magnitude * magnitude;
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  return Object.freeze({
    rms,
    peak
  });
}

function deriveVoiceEnergy({ rms, peak }) {
  return clamp((rms * 0.72) + (peak * 0.28), 0, 1);
}

function deriveRawMouthOpen({
  voiceEnergy,
  config
}) {
  const effectiveEnergy = Math.max(0, voiceEnergy - config.silence_floor);
  const normalized = clamp(
    effectiveEnergy / Math.max(0.0001, config.full_scale_reference - config.silence_floor),
    0,
    1
  );
  if (normalized <= config.minimum_mouth_open) {
    return 0;
  }
  return clamp(normalized, 0, 1);
}

export function analyzeAudioFragmentsForLipsync(
  fragments,
  rawConfig = {}
) {
  if (!Array.isArray(fragments) || fragments.length === 0) {
    return Object.freeze([]);
  }
  const config = buildAudioLipsyncAnalysisConfig(rawConfig);
  const allSamples = [];
  let sampleRateHz = null;
  for (const fragment of fragments) {
    validateActivePlaybackFormat(fragment);
    if (sampleRateHz === null) {
      sampleRateHz = fragment.sample_rate_hz;
    } else if (sampleRateHz !== fragment.sample_rate_hz) {
      throw new AudioLipsyncContractError(
        "desktop-live2d lipsync analyzer requires a stable sample_rate_hz"
      );
    }
    allSamples.push(...decodeFragmentSamples(fragment));
  }

  if (!sampleRateHz || allSamples.length === 0) {
    return Object.freeze([]);
  }

  const samplesPerWindow = Math.max(
    1,
    Math.round((sampleRateHz * config.window_duration_ms) / 1000)
  );
  const frames = [];
  for (let offset = 0, frameIndex = 0; offset < allSamples.length; offset += samplesPerWindow, frameIndex += 1) {
    const windowSamples = allSamples.slice(offset, offset + samplesPerWindow);
    const stats = calculateWindowStatistics(windowSamples);
    const voiceEnergy = deriveVoiceEnergy(stats);
    const mouthOpen = deriveRawMouthOpen({
      voiceEnergy,
      config
    });
    frames.push(
      buildAudioLipsyncFrame({
        frameIndex,
        mouthOpen,
        rawMouthOpen: mouthOpen,
        windowDurationMs: Math.max(
          10,
          Math.round((windowSamples.length / sampleRateHz) * 1000)
        ),
        sampleCount: windowSamples.length,
        rootMeanSquare: stats.rms,
        peakAmplitude: stats.peak,
        voiceEnergy,
        speaking: voiceEnergy >= config.speaking_energy_threshold
      })
    );
  }
  return Object.freeze(frames);
}
