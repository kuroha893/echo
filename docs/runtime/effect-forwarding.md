# Runtime Effect Forwarding

## Purpose

This document defines the first bounded forwarding layer on top of the runtime outbox.

It exists because the runtime core can now:

- route incoming `ProtocolEvent` objects into the correct session shell
- produce ordered session-local `session.state.changed` effects
- expose those effects through registry-level batch collection

but it does not yet define how those batches should be forwarded outward without turning runtime into a bus too early.

---

## Position In The Stack

The runtime effect-forwarding layer sits above:

- `SessionRuntime`
- `RuntimeRegistry`
- registry-level batch collection

and below any future:

- event bus integration
- persistence transport
- supervisor/process boundary
- adapter-facing delivery

Its job is narrow:

- collect pending runtime effect batches
- forward them through a typed boundary one batch at a time
- drain only the batches that were forwarded successfully

---

## Current Prerequisites

The repo already has these pieces in place:

- `SessionRuntime` owns an ordered typed outbox
- `RuntimeRegistry` routes incoming events by `session_id`
- `RuntimeRegistry.peek_effect_batches()` exposes non-empty session batches
- `RuntimeRegistry.drain_session_outbox(session_id)` can clear one session outbox at a time

This means the next runtime step does not need to redesign registry ownership or invent a global effect queue.

---

## Forwarding Contract

The first runtime effect-forwarding shell should be implemented in a dedicated file such as:

- `packages/runtime/effect_forwarder.py`

Its public API should stay minimal.

The bounded shape is:

1. ask `RuntimeRegistry` for the current pending batches using `peek_effect_batches()`
2. iterate those batches in the registry-provided stable order
3. forward each `SessionEffectBatch` through one typed boundary method
4. after one batch is forwarded successfully, drain only that session's outbox
5. return the tuple of successfully forwarded batches

This shell must not pre-drain all session outboxes before attempting delivery.

---

## Why Success-Then-Drain

The first forwarding shell should preserve one important safety property:

- a later forwarding failure must not cause unrelated unforwarded session batches to disappear

That means:

- if batch A forwards successfully, A may be drained
- if batch B then fails to forward, B must remain pending
- any later unattempted batch C must also remain pending

This is a bounded local reliability rule.
It is not a retry policy and it is not a persistence guarantee.

---

## Ordering Rules

The forwarding layer must preserve two kinds of order:

### 1. Batch order

Use the stable batch order already defined by `RuntimeRegistry.peek_effect_batches()`.

Today that order is deterministic enumeration by `session_id.hex`.
It is only an implementation-facing stability rule.
It must not be described as a global cross-session time order.

### 2. Effect order inside one batch

Do not reorder or flatten the `effects` inside `SessionEffectBatch`.

The forwarder must treat each batch as an opaque typed packet whose internal event order is already authoritative for that session.

---

## Forwarding Boundary

The first forwarding shell should keep its outward boundary deliberately simple:

- one typed method that accepts exactly one `SessionEffectBatch`

That boundary may be implemented as an overridable no-op helper in the first task.

This keeps the shell testable without prematurely introducing:

- sink registries
- transport protocols
- message brokers
- callback graphs

---

## Failure Semantics

The bounded forwarding shell should behave conservatively:

- stop at the first forwarding exception
- surface that exception to the caller
- keep the failing batch pending in the registry
- keep any later unattempted batches pending in the registry
- do not invent retry, backoff, dead-letter, or persistence behavior

This is enough for the current runtime phase.

---

## Non-Goals

This document does not define:

- a cross-process event bus
- persistence or replay
- global effect flattening across sessions
- adapter-facing delivery
- orchestrator event forwarding
- retry queues
- at-least-once or exactly-once transport guarantees

Those belong to later runtime or integration docs.
