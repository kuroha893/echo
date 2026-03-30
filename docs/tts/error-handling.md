# TTS Error Handling

## Purpose

This document defines how TTS failures should surface without letting
`packages/tts` take over orchestrator or runtime ownership.

---

## Core Principle

`packages/tts` may classify and normalize provider failure.

`packages/tts` must not decide:

- session state transitions
- interrupt application
- playback replacement
- user-visible fallback phrasing

Those remain caller-owned decisions.

---

## Failure Classes

The first TTS line should distinguish at least:

- validation/configuration failure
- provider unavailable / network failure
- timeout
- cancelled request
- malformed provider response
- unsupported capability

All of them should be normalized to `TTSProviderError`.

---

## Responsive Demo Rule

For the first audible demo path:

- provider failure should halt the current synthesis clearly
- it should not silently fabricate audio
- callers may decide whether to continue the turn without speech
