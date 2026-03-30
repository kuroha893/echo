# LLM Streaming And Routes

## Purpose

This document defines how Echo-owned generation routes should behave when they
pass through `packages/llm`.

It deliberately separates:

- route semantics owned by Echo
- transport semantics owned by provider adapters

---

## `intent_routing` Route

This route is:

- hidden
- local-first
- low-latency
- one-shot
- structured rather than user-visible by default

It exists to help the orchestrator decide whether a turn should proceed as:

- `action_feedback`
- `local_chat`
- `cloud_primary`
- `cloud_tool`

Recommended constraints:

- very short timeout
- very small token budget
- deterministic or low-variance output settings

This route should prefer a normalized `LLMIntentRouteDecision` surface rather
than free-form assistant text.

---

## `quick_reaction` Route

This route is:

- short
- low-latency
- user-visible
- local-first
- allowed to return `None` at higher layers if no quick reaction is desired

Recommended constraints:

- short timeout
- small token budget
- short output length
- low commitment

For the responsive demo line, callers should treat it as logically one quick
draft even if a provider later supports very short streaming.

---

## `primary_response` Route

This route is required for the first responsive demo.

It must:

- support streaming text deltas
- preserve caller order exactly
- preserve raw text exactly
- allow expression tags to pass through untouched

It may be served by:

- a local lightweight profile for low-cost local chat
- or a cloud profile for heavier primary answer quality

It must not:

- strip markup intended for `ExpressionParser`
- directly perform TTS/renderer splitting
- emit protocol events itself

---

## `primary_tool_reasoning` Route

This route is reserved for later work after the first responsive demo.

Important rules:

- it must stay subordinate to `docs/protocol/reasoning-tool-loop.md`
- no tool execution belongs inside `packages/llm`
- llm output for this route may eventually include normalized tool intents
- audible primary playback still must not begin before tool settlement in v0.1

This route should be designed now, but not be the next implementation target.

---

## `ambient_presence` Route

This route is:

- standby-oriented
- low-priority
- local-first
- permitted to no-op

It exists for proactive behavior such as:

- short idle chatter
- small reminders
- lightweight topic nudges

It must not be treated as ordinary user-turn primary response generation.

Suppression, cooldown, and anti-interruption policy remain caller-owned.

---

## Streaming Ordering Rules

For any streaming llm route:

- delta order must be stable
- `delta_index` must start at `0`
- no delta may be silently reordered
- exactly one terminal completion must close the stream

If a provider transport reports partial fragments awkwardly, the provider
adapter is responsible for normalizing them into stable llm-local ordering.

---

## Empty Output Rules

For `primary_response`:

- empty total output should be treated as a valid but unusual completion only if
  the provider completed successfully without transport error

For `quick_reaction`:

- empty output should usually be interpreted by callers as "no quick reaction"
  rather than as a user-visible answer

For `ambient_presence`:

- empty output should normally be interpreted as silent no-op

For `intent_routing`:

- empty or unparseable output should be treated as routing failure, not as a
  valid silent decision

---

## Failure Rules

Provider failure during streaming must result in:

- no more downstream deltas from that active request
- one typed llm-local failure surface

The llm layer must not decide:

- session `error`
- interrupt application
- audio handoff

Those remain caller-owned.

Hybrid-specific rules:

- `intent_routing` timeout or failure must not permanently stall the turn
- `ambient_presence` failure should degrade to silence
- local fast-path failure must not force a session-level error by itself
