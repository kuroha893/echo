# OpenAI-Compatible Local Provider

## Purpose

This document defines the planned local provider family for Echo's fast path.

The intent is to support local backends such as sglang through one Echo-owned
provider adapter that talks to an OpenAI-compatible HTTP interface.

---

## Why This Family Exists

Echo now already has:

- one official OpenAI Responses provider for the cloud/background path

What it still needs is:

- one local fast-path provider family for hidden routing and low-latency visible
  reactions

The safest first seam is:

- a local OpenAI-compatible text generation family

That keeps Echo from binding itself to any one backend's internal modules.

---

## Intended Route Coverage

The local OpenAI-compatible provider family should be the first intended home
for:

- `intent_routing`
- `quick_reaction`
- optional local `primary_response`
- later `ambient_presence`

It should not be the first target for:

- `primary_tool_reasoning`

That route remains cloud-heavy until explicitly redesigned.

---

## First Approved Backend Reference

The first approved backend reference for this family is:

- [sglang-local-fast-path.md](/C:/Users/123/Desktop/echo/docs/reference/approved/sglang-local-fast-path.md)

This means:

- sglang may be used as a backend reference
- Echo must still implement its own provider adapter and contracts
- Echo must not copy backend server or parser internals

---

## Interface Guidance

The provider family should:

- use explicit typed config
- use explicit base URL injection
- remain testable with fake transport
- normalize backend output into Echo-owned llm contracts

It must not:

- load environment variables internally
- rely on backend-specific Python imports
- leak raw backend transport payloads above `packages/llm`

---

## Structured Routing Output

One important reason this family exists is hidden intent routing.

The provider family should therefore be designed so it can later support:

- structured or strongly normalized one-shot output
- conversion into `LLMIntentRouteDecision`

This should still happen through Echo-owned normalization, not by exposing raw
backend schema above the provider boundary.

---

## Status

Current status:

- documented
- implemented as the first local fast-path provider family in `packages/llm`
- first approved backend reference exists for sglang

The next missing layer is no longer the provider adapter itself. It is the
orchestrator startup policy that consumes this provider family for hidden
routing, quick reaction, and optional local primary.
