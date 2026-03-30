# GPT-SoVITS Local Alternative Provider

## Purpose

This document defines a later local-provider alternative for Echo's TTS line.

Once the first audible demo path exists, `packages/tts` may later add one
GPT-SoVITS adapter above the stable TTS-local contracts.

This is a later provider choice for stronger local voice ownership, not the
shortest first-demo path.

---

## Why This Family Still Matters

GPT-SoVITS remains relevant when Echo later wants to optimize for:

- stronger user-owned voice control
- self-hosted or offline-friendly deployment
- explicit voice conditioning through typed Echo-owned voice profiles
- future compatibility with chunked or streamed audio output

GPT-SoVITS is a strong later fit because it already supports:

- text-to-speech inference
- reference-audio-conditioned voice behavior
- local deployment
- streaming-related response modes

---

## Repository Boundary

The provider adapter belongs in `packages/tts`.

It must stay below:

- `packages/orchestrator`
- `packages/runtime`

and above:

- raw HTTP transport details
- provider-specific response decoding
- provider-specific error surfaces

It must not absorb:

- expression parsing
- audio mutex policy
- playback device ownership
- session-state mutation
- protocol-event emission

---

## Approved Reference

The approved external reference note for this provider family is:

- [gpt-sovits-tts-adapter.md](/C:/Users/123/Desktop/echo/docs/reference/approved/gpt-sovits-tts-adapter.md)
