# TTS Provider Interface

## Purpose

This document defines the provider-neutral boundary that concrete TTS adapters
must satisfy.

---

## Required Port

The core provider boundary should be one unified `TTSProviderPort`.

It should expose at least:

- one synthesis method that accepts `TTSSynthesisRequest`
- one capability/introspection surface

When a provider family supports cloned-voice creation, it may also expose a
typed voice-enrollment method that accepts `TTSVoiceEnrollmentRequest`.

If the first provider supports streaming fragments, the provider boundary may
yield multiple `TTSAudioFragment` values.

---

## Synthesis Semantics

The synthesis method exists primarily for:

- `TurnOrchestrator` playback output
- deterministic tests
- low-complexity scripted/fake providers

It must:

- accept `TTSSynthesisRequest`
- return ordered audio fragments
- surface failures as typed TTS-local errors

It must not:

- emit protocol events
- mutate orchestrator/runtime state

---

## Capability Surface

Every provider should expose a typed capability view that can answer:

- does this provider support fragment streaming
- what media types it can return
- whether it supports reference-audio conditioning
- whether it supports voice enrollment from local reference audio
- which voice profiles it is allowed to serve

---

## Registry Rules

The registry layer should be explicit.

It should:

- register providers under stable keys
- resolve provider/profile/voice choices explicitly
- reject unknown provider/profile/voice references clearly

It must not:

- auto-create providers from hidden globals
- silently fall back to arbitrary transports

---

## Live Verification Rules

Real-network verification is allowed only as an explicit, opt-in verification
layer above unit tests.

It should:

- remain gated by explicit config or environment variables
- never run by default in deterministic unit test suites
- verify the real provider through Echo-owned provider/service boundaries

It must not:

- replace fake-transport unit coverage
- force CI or offline contributors to depend on live credentials

---

## Cancellation Rules

Provider calls must remain cancellable.

Minimum guarantees:

- if caller cancellation occurs, the provider boundary surfaces a typed cancelled failure
- cancelled synthesis must not continue feeding fragments into active caller flow
- transport cleanup belongs to the provider adapter, not to orchestrator/runtime
