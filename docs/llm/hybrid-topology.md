# Hybrid Local/Cloud LLM Topology

## Purpose

This document defines Echo's intended llm topology for a responsive companion:

- a local fast path that keeps the agent visibly alive
- a cloud-heavy path that handles deeper answer quality and later reasoning

It exists so Echo does not treat "quick local filler" as an afterthought.

---

## Core Goal

When the user finishes a turn, Echo should avoid visibly idling while heavier
reasoning is still in progress.

The intended shape is:

1. local hidden routing decides what class of turn this is
2. local quick reaction may emit a small visible filler or action
3. the primary path proceeds locally or in the cloud depending on that decision
4. later heavy tool-aware reasoning stays on the cloud path

---

## Turn Classes

The hidden routing result should classify a turn into one of these decision
kinds:

- `action_feedback`
- `local_chat`
- `cloud_primary`
- `cloud_tool`

Their intended meanings are:

### `action_feedback`

The turn mainly needs:

- a small acknowledgement
- a lightweight visible action
- no heavy reasoning

This is the cheapest path.

### `local_chat`

The turn can plausibly be handled by a lightweight local chat profile.

This is intended for:

- small talk
- low-risk short replies
- lightweight conversational continuity

### `cloud_primary`

The turn should use the cloud-heavy primary response path.

This is intended for:

- open-ended answers
- knowledge-heavy replies
- higher-quality responses that do not require tool use

### `cloud_tool`

The turn should eventually use the cloud-heavy tool-aware reasoning path.

This is intended for:

- planned agent reasoning
- later tool invocation
- heavier multi-step output generation

---

## Startup Sequence

The intended startup order is:

1. accept the user turn
2. begin hidden local `intent_routing`
3. begin local `quick_reaction`
4. choose the primary path from the routing result
5. continue with local or cloud primary handling

The local quick reaction is allowed to happen while the heavier path is still
warming up or streaming.

---

## Ownership Boundaries

`packages/llm` owns:

- the route kinds
- the hidden routing decision contract
- provider/profile selection

`packages/orchestrator` owns:

- when routes are invoked
- what startup policy is used
- whether quick reaction is emitted or suppressed
- how audio mutex, interrupt, and playback semantics are applied

`packages/runtime` still owns:

- session lifecycle
- effect routing
- replay/persistence

---

## Safety Rules

Hybrid topology must obey these rules:

- hidden routing must not emit user-visible output by itself
- local fast-path failure must not force session error by itself
- cloud-primary failure must surface honestly rather than being silently hidden
- quick reaction must remain low-commitment
- tool-aware reasoning must still remain subordinate to
  `docs/protocol/reasoning-tool-loop.md`

---

## Fallback Rules

If hidden local routing fails or times out:

- the turn must not remain stalled
- callers should fall back to a safe primary path

If local quick reaction fails:

- the turn may continue without a visible filler

If the local-chat primary path is unavailable:

- callers may escalate to the cloud primary path

These are caller-owned fallback policies, not llm-owned decisions.

---

## Status

Current status:

- hybrid topology is now documented
- official cloud provider exists
- local fast-path provider now exists
- hidden routing contracts now exist in code
- the missing layer is orchestrator startup policy

This document is therefore architecture-first, not implementation-complete.
