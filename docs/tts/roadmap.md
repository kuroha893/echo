# TTS Roadmap

## Purpose

This document defines the intended development order for `packages/tts` and the
playback work that sits above it.

It exists to keep TTS work cumulative, demo-oriented, and aligned with the
already completed protocol/orchestrator/runtime/llm/renderer core.

---

## Phase 0: Documentation And Boundaries

Status:

- completed

Outputs:

- package boundary definition
- TTS-local contracts planning
- provider port and registry planning
- voice-profile boundary
- playback/chunking rules
- error-handling rules
- first provider family selection

---

## Phase 1: TTS Foundation

Status:

- completed by task43

Goal:

- create the first real `packages/tts` package without choosing a concrete
  transport implementation yet

---

## Phase 2: First Concrete Commercial Voice-Clone Provider

Status:

- completed by tasks44 through 46

---

## Phase 3: Orchestrator Integration

Status:

- completed by task47

---

## Phase 4: Desktop Playback Bridge Above TTS

Status:

- completed by task53

Goal:

- let the desktop app own real playback once synthesized audio leaves
  `packages/tts`

---

## Phase 5: Runnable Desktop Demo Wiring

Status:

- completed by tasks54 through 56

Goal:

- wire the already-real TTS line into a runnable single-session desktop demo

---

## Phase 6: Real Provider Desktop Demo Backend

Status:

- completed as backend-chain work by tasks57 through 65

Goal:

- turn the current desktop demo backend into a real-provider-capable stack
  without changing TTS package boundaries

Required outputs:

- typed desktop provider/source settings for the existing Qwen3 provider family
- voice settings and enrollment paths above the stable TTS line
- real device audio output in app mode
- opt-in live demo verification above the stable TTS line

Note:

- the Electron full-console UI path proven during tasks58 through 65 is now
  deprecated as product UI, but the TTS backend-chain work remains accepted

---

## Phase 7: Browser Console Plus Floating Desktop Suite Reset

Status:

- next mainline

Goal:

- keep TTS boundaries unchanged while rebuilding the product surfaces around
  them

Required outputs:

- browser console voice/settings surfaces
- floating avatar/chat/bubble surfaces consuming the same playback truth
- synchronized browser/Electron demo verification

---

## Later Local Alternative Provider

Goal:

- add a stronger local-provider alternative such as GPT-SoVITS when user-owned
  voice control, offline use, or self-hosted customization become more
  important than first-demo speed

---

## Explicitly Deferred

These are not part of the next TTS mainline:

- playback device abstraction redesign inside `packages/tts`
- voice library/product management beyond the first single-session voice page
- multi-provider balancing
- STT work
