# TTS Contracts

## Purpose

This document defines the TTS-local typed contracts that `packages/tts` should
expose to callers and providers.

These are not protocol events.
They are package-local contracts for safe synthesis interaction.

---

## Core Models

### `TTSVoiceProfile`

Provider-neutral voice identity.

Typical fields:

- `voice_profile_key`
- `provider_key`
- `display_name`
- `reference_audio_path`
- `prompt_text`
- `prompt_language`
- optional `aux_reference_audio_paths`

Rules:

- this is a typed Echo-owned voice boundary
- callers should not need to hand raw backend payloads around
- provider-managed voice ids belong here after a successful voice-enrollment
  flow

### `TTSVoiceEnrollmentRequest`

Typed request for creating or registering a cloned voice from local reference
audio.

Typical fields:

- `provider_key`
- `display_name`
- `reference_audio_path`
- optional `realtime_reference_audio_path`
- optional `prompt_text`
- optional `prompt_language`

Rules:

- this is distinct from synthesis
- callers should not upload local files ad hoc through normal synthesis calls

### `TTSVoiceEnrollmentResult`

Typed output from a successful provider-side voice enrollment.

Typical fields:

- `voice_profile`
- provider-managed voice ids
- optional provider-side voice metadata

### `TTSSynthesisConfig`

Provider-neutral synthesis controls.

Typical fields:

- `timeout_ms`
- `speed_factor`
- optional narrow sampling controls only if required by the first provider

### `TTSSynthesisRequest`

Full TTS-local synthesis request.

Required fields:

- `tts_chunk`
- `voice_profile`
- `synthesis_config`

Optional fields:

- `provider_profile_key`
- `provider_key_override`

Rules:

- `tts_chunk` remains the upstream protocol-owned text chunk contract

### `TTSAudioFragment`

Normalized audio output fragment.

Typical required fields:

- `fragment_index`
- `audio_bytes`
- `sample_rate_hz`
- `channel_count`
- `is_final`

Optional fields:

- `media_type`

### `TTSProviderError`

Normalized provider failure surface.

Typical fields:

- `error_code`
- `message`
- `retryable`
- optional provider/profile/status metadata

For later live verification and enrollment work, this surface may also carry:

- optional transport/status hints
- optional provider request identifiers

---

## Contract Rules

All TTS-local models should obey:

- Pydantic v2 style
- `extra="forbid"`
- immutability after construction
- explicit enums instead of free strings where the value set is closed

No ad hoc dict payloads may cross the public `packages/tts` boundary.
