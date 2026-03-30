# Voice Profile Boundary

## Purpose

This document defines how Echo should represent voice identity for TTS without
letting backend-specific request payloads leak across package boundaries.

---

## Core Idea

Callers should select a typed voice profile, not assemble raw provider payloads
such as:

- reference audio path
- prompt text
- prompt language
- backend-specific speaker fields

Those details belong inside `TTSVoiceProfile`.

---

## First Demo Rule

For the first demo-oriented TTS line, a voice profile may include:

- one provider-managed voice id
- one optional provider-managed realtime voice id
- optional main reference audio path
- optional auxiliary reference audio paths
- prompt text
- prompt language

This keeps the first commercial voice-clone path viable without blocking later
local-provider paths such as GPT-SoVITS, while still preventing callers from
learning backend-specific request shapes.
