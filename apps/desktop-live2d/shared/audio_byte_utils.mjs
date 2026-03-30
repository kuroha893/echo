import { AudioPlaybackContractError } from "./audio_playback_contracts.mjs";

function decodeBase64InBrowser(base64Value) {
  if (typeof atob !== "function") {
    throw new AudioPlaybackContractError(
      "desktop-live2d audio utilities could not decode base64 bytes in this environment"
    );
  }
  const binaryText = atob(base64Value);
  const bytes = new Uint8Array(binaryText.length);
  for (let index = 0; index < binaryText.length; index += 1) {
    bytes[index] = binaryText.charCodeAt(index);
  }
  return bytes;
}

export function decodeBase64AudioBytes(base64Value) {
  if (typeof base64Value !== "string" || base64Value.trim() === "") {
    throw new AudioPlaybackContractError("audio base64 payload must be a non-empty string");
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64Value, "base64"));
  }
  return decodeBase64InBrowser(base64Value);
}

export function getBase64DecodedByteLength(base64Value) {
  return decodeBase64AudioBytes(base64Value).byteLength;
}

export function concatenateAudioBytes(byteArrays) {
  const totalLength = byteArrays.reduce(
    (total, value) => total + value.byteLength,
    0
  );
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const value of byteArrays) {
    combined.set(value, offset);
    offset += value.byteLength;
  }
  return combined;
}

export function buildWavBytesFromPcmS16le({
  pcmBytes,
  sampleRateHz,
  channelCount
}) {
  const bytesPerSample = 2;
  const byteRate = sampleRateHz * channelCount * bytesPerSample;
  const blockAlign = channelCount * bytesPerSample;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const encoder = new TextEncoder();
  const riffBytes = encoder.encode("RIFF");
  const waveBytes = encoder.encode("WAVE");
  const fmtBytes = encoder.encode("fmt ");
  const dataBytes = encoder.encode("data");
  new Uint8Array(header, 0, 4).set(riffBytes);
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  new Uint8Array(header, 8, 4).set(waveBytes);
  new Uint8Array(header, 12, 4).set(fmtBytes);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  new Uint8Array(header, 36, 4).set(dataBytes);
  view.setUint32(40, pcmBytes.byteLength, true);
  return concatenateAudioBytes([new Uint8Array(header), pcmBytes]);
}

function mergeWavFragments(fragmentBytes) {
  if (fragmentBytes.length === 0) {
    return new Uint8Array();
  }
  const [first, ...rest] = fragmentBytes;
  const payloads = [
    first,
    ...rest.map((value) => {
      if (value.byteLength <= 44) {
        throw new AudioPlaybackContractError(
          "desktop-live2d wav fragment payload must be larger than a header-only buffer"
        );
      }
      return value.subarray(44);
    })
  ];
  const mergedPayload = concatenateAudioBytes([
    first.subarray(44),
    ...payloads.slice(1)
  ]);
  if (first.byteLength < 44) {
    throw new AudioPlaybackContractError(
      "desktop-live2d wav fragment payload must include a 44-byte header"
    );
  }
  const merged = first.slice();
  const headerView = new DataView(
    merged.buffer,
    merged.byteOffset,
    merged.byteLength
  );
  const totalPayloadLength = mergedPayload.byteLength;
  headerView.setUint32(4, 36 + totalPayloadLength, true);
  headerView.setUint32(40, totalPayloadLength, true);
  return concatenateAudioBytes([merged.subarray(0, 44), mergedPayload]);
}

export function buildPlayableAudioPayloadFromFragments(fragments) {
  if (!Array.isArray(fragments) || fragments.length === 0) {
    throw new AudioPlaybackContractError(
      "desktop-live2d requires at least one fragment to build playable audio"
    );
  }
  const mediaType = fragments[0].media_type || "audio/pcm;encoding=s16le";
  const fragmentBytes = fragments.map((fragment) =>
    decodeBase64AudioBytes(fragment.audio_bytes_base64)
  );

  if (mediaType === "audio/pcm;encoding=s16le") {
    return Object.freeze({
      media_type: "audio/wav",
      audio_bytes: buildWavBytesFromPcmS16le({
        pcmBytes: concatenateAudioBytes(fragmentBytes),
        sampleRateHz: fragments[0].sample_rate_hz,
        channelCount: fragments[0].channel_count
      })
    });
  }

  if (mediaType === "audio/wav") {
    return Object.freeze({
      media_type: "audio/wav",
      audio_bytes: mergeWavFragments(fragmentBytes)
    });
  }

  if (mediaType === "audio/mpeg" || mediaType === "audio/ogg;codecs=opus") {
    return Object.freeze({
      media_type: mediaType,
      audio_bytes: concatenateAudioBytes(fragmentBytes)
    });
  }

  throw new AudioPlaybackContractError(
    `desktop-live2d audio output backend does not support media_type '${mediaType}'`
  );
}
