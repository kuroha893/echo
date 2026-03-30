# OpenAI Responses Provider

## Purpose

This document defines the first concrete provider family for Echo's llm line.

`packages/llm` now includes one official OpenAI Responses API adapter above the
already implemented llm-local contracts.

This is a provider choice for the first cloud/background path, not a permanent
exclusivity decision for the repository.

---

## Why This Family Was First

The first concrete provider optimized for:

- the shortest path to a real answer stream
- one official and well-documented transport family
- one route shape that could serve both:
  - `quick_reaction`
  - `primary_response`
- minimal extra architecture beyond the already completed llm foundation

That decision is now complete.

The official OpenAI Responses API is therefore the baseline cloud provider
family for Echo.

---

## Repository Boundary

The provider adapter belongs in `packages/llm`.

It stays below:

- `packages/orchestrator`
- `packages/runtime`

and above:

- raw HTTP transport details
- response event decoding
- provider-specific error surfaces

It must not absorb:

- prompt compilation
- expression parsing
- tool execution
- session-state mutation
- protocol-event emission

---

## Supported Routes In The Current Provider

Implemented:

- `quick_reaction`
- `primary_response`

Explicitly not yet implemented:

- `primary_tool_reasoning`
- `intent_routing`
- `ambient_presence`

The hybrid llm line should therefore treat this provider as the cloud-heavy
background path, not as the local fast-path provider.

---

## Current Architectural Meaning

In the hybrid local/cloud design:

- this provider family is the cloud/background path
- it is suitable for heavier primary-response generation
- it is a natural future home for cloud-heavy `primary_tool_reasoning`

It is not the preferred first provider for:

- near-zero-latency local quick reaction
- hidden local routing
- later standby presence

Those belong to the planned local OpenAI-compatible provider family.

---

## Out Of Scope

This provider line still does not include:

- WebSocket transport
- tool calling
- prompt compiler changes
- multi-provider fallback
- hot reload
- STT / TTS / renderer integration
- app/demo UI wiring
- local-model orchestration

---

## Decision Summary

Echo already has:

- one official OpenAI Responses API provider adapter
- text-only generation
- quick-reaction one-shot support
- primary-response streaming support

The next llm provider milestone is not another cloud transport. It is the local
OpenAI-compatible fast-path family.
