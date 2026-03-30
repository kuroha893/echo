# TTS Architecture

## Purpose

`packages/tts` is the synthesis-adapter layer that sits between:

- protocol/orchestrator-owned `TTSChunk` requests
- concrete local or cloud TTS provider transports

It is not the orchestrator and it is not the playback device layer.

Its job is to turn Echo-owned chunk requests into normalized audio-fragment
output without leaking provider-specific transport details into:

- `packages/orchestrator`
- `packages/runtime`
- later app/device shells

---

## Responsibilities

TTS owns these concerns:

- provider-neutral synthesis request models
- provider-neutral voice-enrollment request models
- provider-neutral audio-fragment output models
- voice-profile resolution
- provider registry and route/provider selection
- provider capability checks
- provider error normalization
- timeout / cancellation boundaries for synthesis calls
- a single TTS-local service facade for callers

TTS must not absorb:

- expression parsing
- audio mutex decisions
- interrupt policy
- renderer behavior
- session state mutation

---

## Position In The Stack

The intended stack is:

1. `TurnOrchestrator` or a playback coordinator produces protocol `TTSChunk`
2. caller invokes `packages/tts`
3. `packages/tts` selects a provider/profile and voice profile
4. provider emits normalized TTS-local audio fragments
5. caller/device layer decides how to play them

For Echo v0.1, the main callers are expected to be:

- `TurnOrchestrator` TTS dispatch path
- later bridge/demo shells that forward audio to a local playback device

---

## Core Objects

The TTS package should converge on these core objects:

- `TTSVoiceProfile`
- `TTSVoiceEnrollmentRequest`
- `TTSVoiceEnrollmentResult`
- `TTSSynthesisConfig`
- `TTSSynthesisRequest`
- `TTSAudioFragment`
- `TTSProviderError`
- `TTSProviderPort`
- `TTSProviderRegistry`
- `TTSService`

---

## First Demo Boundary

For the first audible text-input demo, the TTS architecture only needs to
guarantee:

- one typed synthesis path from protocol `TTSChunk`
- one typed service boundary that orchestrator can call
- deterministic scripted/fake provider for tests
- one concrete local provider adapter for real synthesis

For the first custom-voice demo path immediately after that, the TTS
architecture should also guarantee:

- one typed voice-enrollment path from local reference audio
- one provider-managed cloned-voice output that can be stored as
  `TTSVoiceProfile`
- one opt-in live verification path that proves the real provider works without
  making unit tests depend on the network

It does not require before first audible demo:

- multi-provider fallback
- remote cloud TTS
- voice marketplace abstractions
- device playback implementation inside `packages/tts`

Those are later layers.
