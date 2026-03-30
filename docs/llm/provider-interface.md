# LLM Provider Interface

## Purpose

This document defines the provider-neutral boundary that concrete llm adapters
must satisfy.

The llm foundation already implements this boundary. Future providers must fit
it without redefining Echo's route or error semantics.

---

## Required Port

The core provider boundary should be one unified `LLMProviderPort`.

It should expose at least:

- one one-shot text generation method
- one streaming text generation method
- one capability/introspection surface

The exact Python names may vary, but the semantic split must remain.

---

## One-Shot Generation

The one-shot method exists primarily for:

- `intent_routing`
- `quick_reaction`
- `ambient_presence`
- deterministic tests
- low-complexity scripted providers

It must:

- accept `LLMConversationInput`
- return one `LLMCompletion` or a route-specific normalized one-shot surface
- surface failures as typed llm-local errors

It must not:

- emit protocol events
- mutate orchestrator/runtime state

---

## Streaming Generation

The streaming method exists primarily for:

- `primary_response`
- later `primary_tool_reasoning`

It must:

- accept `LLMConversationInput`
- emit ordered llm-local stream events
- terminate with one `LLMCompletion`

It must preserve raw text exactly.

---

## Capability Surface

Every provider should expose a small typed capability view that can answer:

- does this provider support one-shot generation
- does it support streaming
- does it support structured hidden routing output
- does it support tool-aware output
- what route kinds it is allowed to serve

This prevents callers from probing raw transport details.

---

## Registry Rules

The registry layer should be explicit.

It should:

- register providers under stable keys
- resolve route kinds to provider/profile choices
- reject unknown provider/profile references clearly

It must not:

- auto-create providers from hidden globals
- silently fall back to arbitrary transports

---

## Cancellation Rules

Provider calls must remain cancellable.

Minimum guarantees:

- if caller cancellation occurs, the provider boundary surfaces a typed cancelled failure
- cancelled requests must not later continue feeding new text deltas into active caller flow
- later raw transport cleanup belongs to the provider adapter, not to orchestrator/runtime

---

## Concrete Provider Families

Already implemented:

- official OpenAI Responses API

Next planned family:

- a local OpenAI-compatible provider family for local fast-path use

That local family should focus on:

- hidden intent routing
- quick reaction
- optional lightweight local primary response
- later ambient presence

It should still avoid:

- tool execution
- multi-provider fallback
- hidden global config
