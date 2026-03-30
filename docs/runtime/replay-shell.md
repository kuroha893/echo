# Runtime Replay Shell

## Purpose

This document defines the first in-process replay layer for the Echo runtime core.

It exists because the runtime core now has:

- an explicit supervisor entrypoint
- runtime snapshot export/import
- typed session/local recovery inspection

but it still lacks a bounded way to:

- restore a runtime snapshot
- replay a deterministic sequence of protocol events
- capture typed replay results without inventing a persistence backend too early

The replay shell should therefore be the next layer built on top of:

- `RuntimeSupervisor`
- `RuntimeRegistrySnapshot`

not a database layer or async worker.

That replay shell now exists locally.
This document remains as the design contract that later persistence/storage work must preserve.

---

## Position In The Stack

The replay shell sits above:

- `RuntimeSupervisor`
- `RuntimeRegistry`
- `SessionRuntime`
- snapshot export/import helpers

and below any future:

- persistence backends
- replay daemons or workers
- crash recovery orchestration
- operator tooling

Its job is narrow:

- reconstruct a runtime core from a snapshot when needed
- feed typed `ProtocolEvent` values through the canonical supervisor entrypoint
- surface typed replay results and conservative failure semantics

---

## Core Boundary Rules

The replay shell must obey these rules:

- replayed inputs are typed `ProtocolEvent` objects only
- replay processing must flow through `RuntimeSupervisor.process_event()`
- replay must not mutate tracker/session/registry internals directly
- replay output must remain runtime-local typed models, not protocol changes
- replay must stop conservatively on failure unless a later doc explicitly defines a more permissive mode

This keeps replay aligned with normal runtime ownership instead of becoming a second hidden execution path.

---

## Input Model

The first replay shell should accept:

- an ordered sequence of typed `ProtocolEvent` values
- either:
  - an existing `RuntimeSupervisor`, or
  - a starting `RuntimeRegistrySnapshot` from which a supervisor can be reconstructed

Ordering is caller-owned.
The replay shell must preserve the caller-provided event order exactly.

---

## Output Model

The first replay shell should expose typed runtime-local replay results.

Recommended layers:

### Replay step result

One typed result per successfully processed replayed event, containing at minimum:

- the replayed `event_id`
- the touched `session_id`
- the `RuntimeProcessResult` returned by the supervisor

Optionally, the first replay shell may also capture a post-step runtime snapshot if the replay config enables that behavior.

### Replay run result

One typed result for the full replay run, containing at minimum:

- total input event count
- successfully processed step count
- ordered replay step results
- final runtime snapshot after the last successful step

### Replay halt/failure surface

If replay stops because one event fails, the shell should surface a typed failure view that preserves:

- failed event index
- failed `event_id`
- failed `session_id`
- successful step count before failure
- partial runtime snapshot at halt time

Whether this is wrapped in a custom exception or a typed result object is an implementation detail for the task card, but it must remain typed and conservative.

---

## Supervisor Ownership Rule

Replay is not allowed to re-implement registry routing, effect forwarding, or recovery inspection by itself.

Instead:

- supervisor remains the single runtime entrypoint
- replay calls supervisor for each event
- supervisor remains responsible for normal runtime processing semantics

This avoids splitting runtime into one "live path" and one separate "replay path" with different rules.

---

## Snapshot Relation

Replay should treat snapshots as:

- reconstruction boundaries
- optional step/result inspection surfaces

Replay should not treat snapshots as:

- external file formats
- event logs
- transport payloads

The first replay shell may use:

- one initial `RuntimeRegistrySnapshot`
- one final `RuntimeRegistrySnapshot`
- optional per-step post-event snapshots

but should not introduce storage adapters.

---

## Failure Semantics

The first replay shell should be conservative.

That means:

- process events sequentially
- stop on the first processing failure
- do not rollback already applied successful steps
- preserve a typed partial snapshot at halt time

This matches the existing runtime philosophy:

- state application is explicit
- forwarding failure does not imply rollback
- recovery information should remain inspectable

---

## Non-Goals

This document does not define:

- persistence backend APIs
- file/database formats
- replay scheduling
- replay parallelism
- cross-process recovery coordination
- adapter integration
- event-bus integration
- operator dashboards

Those belong later.

---

## Recommended First Task Shape

The first replay task should be a moderately larger bundled task that:

- creates one dedicated replay module
- defines typed replay step/run/failure models
- supports restoration from a `RuntimeRegistrySnapshot`
- supports deterministic sequential replay through `RuntimeSupervisor`
- verifies final snapshot fidelity and halt-on-failure behavior with tests

This task should be larger than the recent helper-level cards, because replay is the first runtime layer that meaningfully composes:

- supervisor
- snapshot foundation
- recovery inspection
- effect forwarding semantics
