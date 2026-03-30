# Provider Verification

## Purpose

This document defines how Echo should verify real TTS providers without making
its core test suites depend on live network access.

---

## Core Rule

Echo must keep two layers of provider validation:

1. deterministic fake-transport unit tests
2. explicit opt-in live verification

The first layer is mandatory and always-on.
The second layer is optional and never runs by default.

---

## Why Live Verification Exists

Fake-transport tests prove that Echo's own adapter logic is correct.

They do **not** prove:

- real credentials are wired correctly
- the provider endpoint shape still matches assumptions
- the chosen model / voice ids still work
- the commercial provider has not drifted in a way that breaks enrollment or
  synthesis

So Echo needs a small but explicit live verification path.

---

## Verification Shape

Live verification should:

- run only when explicit environment/config gating is present
- stay outside the default unit suite
- exercise the real provider through Echo-owned boundaries
- return or assert typed Echo-owned outputs

For the first Qwen3 line, useful live checks are:

- one baseline synthesis request
- one optional realtime-track synthesis request
- later one voice-enrollment request from a local reference audio file

---

## What Live Verification Must Not Become

It must not become:

- a mandatory CI gate
- a replacement for unit tests
- a vague manual "try it once in production" ritual
- a backdoor for provider-specific logic to escape Echo's typed boundaries

---

## Artifact And Safety Expectations

A live verification path should be able to report:

- which provider/profile/model/voice was used
- whether the call succeeded or failed
- the typed Echo-owned error surface on failure

If it creates temporary audio output or enrollment artifacts, the verification
path should keep ownership explicit and avoid silent persistence.
