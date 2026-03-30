# TTS Demo Path

## Purpose

This document defines the shortest TTS path from the current Echo core to the
corrected presentable desktop demo.

The target demo is:

- user types input in the browser console or floating chat window
- Echo reacts quickly
- Echo produces speech audio with low enough latency to preserve the local
  fast-path illusion
- the desktop app materially owns playback
- the full-body renderer reacts alongside it

STT is intentionally not required for the first corrected demo.

---

## Minimum TTS Requirements For That Demo

The corrected desktop demo needs:

1. one typed synthesis path from protocol `TTSChunk`
2. one typed service boundary that orchestrator can call
3. one deterministic fake or scripted TTS provider for tests
4. one real concrete provider adapter for synthesis
5. one desktop-owned playback bridge above `packages/tts`

It does not require:

- playback device abstraction inside `packages/tts`
- advanced voice marketplace management
- advanced multi-provider fallback
- a local TTS stack as the first provider

---

## Current Post-Task65 Reality

Echo already has:

- `packages/tts` foundation
- one concrete Qwen3 voice-clone provider
- voice enrollment for local reference audio
- opt-in live provider verification shell
- real `TurnOrchestrator` -> `TTSService` integration
- a real desktop renderer backend and bubble shell
- a desktop-owned playback bridge
- a real single-session desktop companion session service
- a real desktop chat panel prototype
- an app-side audio-driven lipsync shell

So the next TTS-adjacent blocker is no longer synthesis itself.

The current blockers are:

- making real-provider host assembly the stable default path
- moving settings and voice UI to a browser-served console
- keeping playback and lipsync in the corrected floating desktop suite
- verifying the same single-session state across browser and Electron surfaces
