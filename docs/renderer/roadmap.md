# Renderer Roadmap

## Purpose

This document defines the intended development order for Echo's renderer line.

It exists to keep renderer work cumulative, backend-first, and aligned with the
already completed protocol/orchestrator/llm/tts core.

---

## Phase 0: Documentation And References

Status:

- completed

Outputs:

- renderer doc set
- protocol renderer-command spec
- approved `open-yachiyo` desktop-live2d note
- approved `AIRI` Pixi + Live2D scene note

---

## Phase 1: Renderer Foundation

Status:

- completed by task48

Outputs:

- renderer-local models
- adapter port
- adapter registry
- renderer service shell
- deterministic scripted adapter

---

## Phase 2: Orchestrator Integration

Status:

- completed by task49

Outputs:

- real `TurnOrchestrator` -> `RendererService` dispatch
- preserved parser and protocol-event semantics
- deterministic failure surface

---

## Phase 3: Desktop-Live2D App Shell And Bridge

Status:

- completed by task50

Outputs:

- Electron main/preload/renderer boot baseline
- one full-body model window baseline
- typed bridge request/response flow
- bounded smoke startup path

---

## Phase 4: Pixi/Cubism Full-Body Scene Controller

Status:

- completed by task51

Outputs:

- scene controller for state/expression/motion/clear-expression
- deterministic headless/self-check backend
- bounded browser-side Pixi/Cubism shell
- explicit unsupported behavior for `set_mouth_open`

---

## Phase 5: Bubble Demo Shell

Status:

- completed by task52

Outputs:

- streaming bubble UI
- app-side bubble state shell
- preserved renderer foundation boundaries

---

## Phase 6: Desktop Playback And Runnable Demo Wiring

Status:

- completed by tasks53 through 55

Goal:

- stop treating renderer as an isolated visible subsystem and wire it into a
  runnable single-session desktop demo

Required outputs:

- desktop-owned playback bridge above `packages/tts`
- runtime-side desktop companion session service
- desktop chat history panel

---

## Phase 7: Audio-Driven Lipsync

Status:

- completed by task56

Goal:

- make the character feel alive using real playback/audio analysis

Required outputs:

- app-side mouth/lipsync driver tied to real playback
- no protocol redesign
- no fake claim of generic `set_mouth_open` support

---

## Phase 8: Real Provider Desktop Demo Backend

Status:

- completed as backend-chain work by tasks57 through 65

Goal:

- turn the runnable desktop demo backend into a real-provider-capable stack
  without locking Echo into the wrong UI topology

Required outputs:

- typed desktop provider/source config foundation and real host assembly
- real device audio output in app mode
- real Pixi/Cubism runtime landing and bounded end-to-end demo verification

Note:

- tasks58 through 65 proved useful backend-chain and multi-window groundwork
  but are no longer the accepted product UI direction

---

## Phase 9: UI Fidelity Governance Reset

Status:

- next mainline

Goal:

- update Echo governance so UI-surface reproduction may directly inspect local
  reference source and target high-fidelity recreation

Required outputs:

- governance exception for UI-surface direct inspection
- approved web-console UI fidelity note for open-yachiyo
- approved desktop-live2d UI fidelity note for open-yachiyo
- deprecation of the Electron full-console product path

---

## Phase 10: Browser Console And Floating Desktop Suite Reset

Status:

- next mainline after governance reset

Goal:

- rebuild Echo's product surfaces as:
  - browser web console
  - floating avatar window
  - floating chat window
  - floating bubble window

Required outputs:

- local browser console app foundation
- high-fidelity `chat`, `config-v2`, and `onboarding` recreation
- Electron suite reduced to `avatar + chat + bubble`
- high-fidelity floating desktop UI recreation
- synchronized cross-surface demo verification
