# Runtime Event Routing

## Purpose

This document defines how runtime should accept typed protocol events and route their effects without introducing an event bus too early.

It exists because the constitution gives `packages/runtime` ownership of:

- event intake
- session management
- state switching

but the current implementation only covers the inner state-application pieces.

---

## Input Model

Runtime ingress should accept only typed `ProtocolEvent` objects.

No runtime ingress path may accept:

- ad-hoc dict payloads
- adapter-private callback objects
- loosely shaped transport frames

Normalization into protocol objects must happen before the event reaches the runtime core.

---

## Routing Levels

Runtime event routing should happen in two levels.

### 1. Session resolution

Determine which `session_id` owns the incoming event.

This shell is now represented in bounded form by the runtime registry layer.
It is responsible for:

- locating or creating the right `SessionRuntime`
- rejecting malformed or cross-session routing

In the current implementation, creation remains explicit and routing is in-memory only.

### 2. Session-local application

Inside the chosen session shell:

1. update `TransitionContextTracker`
2. build `TransitionContext`
3. call `state_driver.apply_event()`
4. update current `SessionState`
5. append any emitted `session.state.changed` effect to runtime outbox

---

## Ordering Rules

Within one session, runtime routing must preserve event order.

That means:

- events are applied one by one
- outbox effects preserve the order in which they were produced
- no hidden reordering step is allowed inside the session shell

Cross-session parallelism is allowed later, but per-session determinism is required from the beginning.

---

## Runtime Outbox Semantics

The runtime outbox is the boundary between:

- internal session-state application
- later forwarding to logs, buses, or supervisors

In the current development phase the outbox should remain:

- local
- typed
- replay-friendly
- explicitly drainable

This is enough for early runtime development and testing.

Do not skip directly to a bus abstraction before the local outbox semantics are stable.

---

## What Runtime Should Forward Later

After the session shell is stable, the next routing layer can forward:

- `session.state.changed`
- later runtime-owned error/reset effects
- eventually orchestrator-produced outbox events

But that forwarding is a later task.
This document only defines the local runtime routing contract.

The supervisor shell is now the bounded in-process runtime entrypoint above those local routing pieces.

Later external routing work should stay conservative:

- preserve per-session event order
- avoid inventing a global cross-session total order too early
- avoid becoming a bus or transport abstraction

That later bridge layer is documented in:

- [external-bridges.md](/C:/Users/123/Desktop/echo/docs/runtime/external-bridges.md)

---

## Non-Goals

This document does not define:

- adapter transport APIs
- persistence schema
- cross-process buses
- plugin event routing
- memory event routing

Those belong to later runtime or integration docs.
