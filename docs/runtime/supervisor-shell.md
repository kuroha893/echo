# Runtime Supervisor Shell

## Purpose

This document defines the first in-process outer shell above the current runtime primitives.

It exists because runtime already has:

- `SessionRuntime`
- `RuntimeRegistry`
- `RuntimeEffectForwarder`
- session-level and registry-level recovery inspection

but still lacks one unified runtime-facing entrypoint that can:

- explicitly register sessions
- ingest one typed protocol event into the correct session
- forward any resulting runtime effects
- expose the post-event recovery view for the touched session

The next bounded step is therefore not persistence or adapter integration.
It is a small in-process supervisor shell.

---

## Position In The Stack

The supervisor shell sits above:

- `RuntimeRegistry`
- `RuntimeEffectForwarder`
- `SessionRuntime`

and below any future:

- persistence/replay
- external event bus integration
- adapter-facing runtime bridges
- cross-process supervision

Its job is narrow:

- compose the existing runtime pieces into one explicit outer shell
- keep ownership boundaries intact

---

## Why This Comes Next

At this point the runtime core has many useful bounded parts, but callers still need to manually coordinate them:

- register sessions through one object
- ingest events through another
- forward effects through another
- inspect recovery state through another

That is acceptable during early build-out, but it is no longer the smallest useful surface.

The next practical runtime milestone is:

- one explicit entrypoint that composes those pieces without collapsing them into a monolith

---

## Recommended Shape

The first bounded implementation should introduce one new file such as:

- `packages/runtime/runtime_supervisor.py`

It should define:

- one shell class such as `RuntimeSupervisor`
- one typed local result model such as `RuntimeProcessResult`

This remains runtime-local.
Neither type is a protocol event or persistence schema.

---

## Supervisor Responsibilities

The first supervisor shell should own:

- one `RuntimeRegistry`
- one `RuntimeEffectForwarder`

It should provide bounded methods for:

- explicit session registration
- optional session lookup
- processing one typed `ProtocolEvent`
- delegating read-only recovery inspection

It must not become:

- a scheduler
- a background loop
- a message bus
- a persistence service

---

## Event Processing Contract

The main supervisor method should process one event in this order:

1. route and apply the event through `RuntimeRegistry`
2. forward any pending runtime effect batches through `RuntimeEffectForwarder`
3. inspect the touched session's recovery snapshot
4. return one typed result object

The result object should contain at least:

- the `ApplyEventResult`
- the forwarded `SessionEffectBatch` tuple
- the target `SessionRecoverySnapshot`

This gives callers one authoritative post-event view without requiring them to stitch together multiple runtime helpers manually.

---

## Failure Semantics

The supervisor shell should remain conservative.

If event routing/application fails:

- surface the original exception
- do not invent fallback behavior

If effect forwarding fails:

- surface the original exception
- do not roll back session state
- rely on the existing forwarder contract that leaves unforwarded batches pending

This is intentionally not a transactional runtime.

---

## Session Registration Rules

Session creation should remain explicit.

The first supervisor shell should:

- delegate explicit `SessionState` registration into the registry
- preserve duplicate-registration failure behavior
- avoid auto-creating sessions from a raw `session_id`

That keeps session lifecycle semantics stable until persistence is designed.

---

## Recovery Inspection Delegation

The supervisor shell may expose bounded read-only helpers such as:

- `get_recovery_snapshot(session_id)`
- `peek_recovery_snapshots()`

These helpers should delegate to the registry.
They must not re-derive or mutate recovery state.

---

## Non-Goals

This document does not define:

- auto-recovery
- reset commands
- persistence/replay
- event bus forwarding
- adapter callbacks
- orchestrator integration
- async worker loops
- concurrency primitives

Those belong to later runtime or integration docs.

---

## Recommended First Task Shape

The next useful implementation step is:

- create `packages/runtime/runtime_supervisor.py`
- create `tests/runtime/test_runtime_supervisor.py`

That task can be slightly larger than recent micro-steps because it assembles several already-completed runtime pieces into one coherent outer shell.
