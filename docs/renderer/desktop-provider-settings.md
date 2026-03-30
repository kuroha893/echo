# Desktop Provider Settings

## Purpose

This document defines the provider/settings ownership boundary for the corrected
presentable desktop demo.

It exists to keep provider configuration, secret handling, and browser-console
UI scope explicit without moving those concerns into `packages/protocol` or
redesigning stable llm/tts/runtime boundaries.

---

## Current Goal

The next desktop milestone is not "invent more providers".

It is:

- expose the already-implemented Echo providers through a usable browser
  console
- replace the scripted host as the default desktop path
- keep one explicit offline `demo_scripted` fallback for tests/self-checks

The first settings line should therefore wire exactly these sources:

- local fast LLM:
  - existing OpenAI-compatible local provider family
- cloud primary LLM:
  - existing OpenAI Responses provider
- TTS:
  - existing Qwen3 voice-clone provider family
- offline fallback:
  - explicit `demo_scripted` mode only

---

## Ownership Split

`packages/runtime` and the existing desktop companion session service own:

- session-level turn execution
- wiring assembled `LLMService` / `TTSService`
- using already-assembled provider services, not parsing UI forms

the browser-console app plus desktop host main/preload own:

- reading and writing the app-local provider settings file
- validating settings
- assembling real desktop-host service objects from those settings
- masking secrets before exposing snapshots to UI surfaces

the browser-console renderer owns:

- `Services`, `Voice`, `config-v2`, and onboarding UI
- local form state
- browser-console navigation and presentation

Renderer must not:

- read the settings file directly
- assemble `LLMService` or `TTSService` on its own
- invent ad-hoc secret storage rules

---

## Storage Rule

For the first real desktop demo, provider settings are stored in one JSON file
under app-owned local user data.

This is a demo-grade storage choice.

It is intentionally:

- local
- explicit
- single-file
- app-owned

It is not:

- a protocol contract
- a runtime-core persistence format
- an OS keychain integration

UI surfaces receive only typed masked snapshots through the app-local control
plane.

---

## Secret Handling Rule

The first settings flow should be explicit and simple:

- settings snapshots sent to UI surfaces include:
  - non-secret fields directly
  - secret field status as masked metadata
- save operations sent back from UI surfaces use typed secret updates:
  - keep existing secret
  - replace with new secret
  - clear secret

The browser console or floating desktop windows should never receive the stored
raw secret value after initial save.

---

## Browser Console Relationship

The first presentable browser console should use these first-class surfaces:

- `chat`
- `config-v2`
- `onboarding`
- `Services`
- `Voice`

`Services` and `config-v2` own:

- LLM source chooser cards
- TTS source chooser cards
- provider-specific config forms for currently supported sources
- readiness and validation results

`Voice` owns:

- local reference-audio upload
- reference transcript input
- enrollment submit
- current voice summary

Browser `chat` remains current-session only and coexists with:

- the floating chat window
- the avatar-local bubble window

---

## Direct UI Reference Rule

For high-fidelity UI work, the primary reference sources are:

- `docs/reference/open-yachiyo-main/apps/gateway/public`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d`

Under Echo's UI fidelity exception, those sources may be directly inspected for
UI-surface reproduction. Echo still must not copy backend, protocol, host, or
runtime logic from them.

---

## Explicitly Deferred

This settings line does not include:

- OS keychain integration
- multi-session provider profiles
- screenshot attachments
- standby/presence controls
- broader provider marketplace/product management
