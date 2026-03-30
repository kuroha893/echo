# Runtime Orchestrator Bridge Artifacts

## Purpose

This document defines the first persisted artifact layer above the
turn-active in-process orchestrator/runtime bridge session.

The repo now already has:

- a `TurnOrchestrator` that can emit typed protocol events
- a turn-active `OrchestratorRuntimeBridgeSession` that can drain those events
  into runtime while the turn is still active
- typed runtime persistence and replay foundations

At the time this document was introduced, what was still missing was one local
artifact layer that could preserve the result of a bridged turn in a
deterministic, replay-friendly form.

That step is now implemented in:

- `packages/runtime/orchestrator_bridge_artifacts.py`

---

## Position In The Stack

This layer sits:

- above `packages/runtime/orchestrator_bridge.py`
- above `packages/runtime/runtime_bridge.py`
- above `packages/runtime/runtime_persistence.py`
- below any future bus, HTTP, websocket, STT, TTS, or renderer bridge

Its job is narrow:

- persist typed turn-success and turn-failure results from the live bridge
  session
- preserve exact event and egress ordering
- expose deterministic local save/load boundaries
- derive replay-ready ingress material from persisted bridge artifacts

It is still in-process and local.

---

## Why This Layer Comes Next

The turn-active bridge session made the orchestrator/runtime path live.

The next missing capability is not another transport abstraction.
It is one operator- and tooling-friendly artifact surface that can answer:

- what exact protocol events were emitted during the turn
- which ones were drained into runtime
- which ones remained undrained when a halt occurred
- what typed runtime egress was produced
- what runtime snapshot existed at the end or at failure time

Without this layer, later operator tooling or external bridges would need to
reconstruct that information ad hoc from multiple in-memory objects.

---

## Core Boundary Rules

The bridge-artifact layer must obey all of the following:

- it may persist only already-typed bridge-session results and failures
- it must not redefine protocol event meaning
- it must not redefine runtime egress meaning
- it must not mutate `TurnOrchestrator`, `RuntimeBridgeRunner`,
  `RuntimeService`, `RuntimeSupervisor`, or `SessionRuntime` internals directly
- it must stay local, deterministic, and replay-friendly in v0.1

This keeps the new layer as artifact packaging rather than a second bridge
implementation.

---

## Required Artifact Surfaces

The first persisted bridge-artifact shell should define these concrete
surfaces.

### 1. Persisted turn-success envelope

One typed persisted model that preserves at least:

- format version
- saved-at timestamp
- the full `OrchestratorRuntimeBridgeSessionResult`

### 2. Persisted turn-failure envelope

One typed persisted model that preserves at least:

- format version
- saved-at timestamp
- the full `OrchestratorRuntimeBridgeSessionFailure`

### 3. Replay-material view

One typed replay-material surface that can expose:

- full collected protocol-event log from a saved success artifact
- full collected protocol-event log from a saved failure artifact
- drained prefix from a saved failure artifact
- undrained tail from a saved failure artifact
- one replay-ready ingress batch derived from any selected event slice

This replay-material view must remain explicit that it is:

- replay preparation
- not automatic resume
- not bus redelivery

### 4. Local codec and store

One deterministic JSON codec and one local filesystem store that can:

- save success artifacts
- save failure artifacts
- load success artifacts
- load failure artifacts
- reject malformed payloads and unsupported format versions clearly

This store remains stdlib-backed and local only.

---

## Ordering Rules

The artifact layer must preserve all of the following exactly:

- full collected protocol-event order
- drained prefix order
- undrained tail order
- step-result order
- runtime sink emission order

It must not:

- flatten success and failure into one ambiguous schema
- reorder drained vs undrained event slices
- regenerate protocol events from dicts
- regenerate runtime egress from summaries only

---

## Replay Relation

The first artifact layer should support replay-material derivation, but only as
an explicit helper.

That means:

- the caller may ask for replay material from a saved success artifact
- the caller may ask for replay material from a saved failure artifact
- the caller may explicitly select whether replay uses:
  - the full collected event log
  - the drained prefix
  - the undrained tail
- replay-ready ingress must still be built only through the existing
  `RuntimeBridgeRunner` ingress helpers

This prevents the artifact layer from silently inventing a second replay path.

---

## Failure Semantics

The artifact layer should stay conservative.

That means:

- malformed JSON or schema mismatch fails clearly
- unsupported format versions fail clearly
- missing local files fail clearly
- replay-material derivation from an empty selected event slice is handled
  explicitly
- the layer must not invent rollback, redelivery, or automatic resume

---

## Non-Goals

This document does not define:

- a real event bus
- websocket or HTTP APIs
- database backends
- remote object stores
- STT/TTS/renderer adapters
- cross-process workers
- automatic replay resume

Those belong later.

---

## Recommended Next Task Shape

The next task should be a larger bundled task that:

- creates one dedicated bridge-artifact module in `packages/runtime`
- defines persisted success and failure envelope models
- defines replay-material models and selection rules
- defines deterministic JSON codec helpers
- defines a local filesystem store for success/failure artifacts
- derives replay-ready ingress material only through `RuntimeBridgeRunner`
- verifies round-trip persistence, ordering, replay-material selection, and
  clear failure handling with tests

This task should be larger than a normal helper task because it is the first
point where Echo preserves a complete bridged turn as a local, replay-friendly
artifact rather than only as in-memory bridge state.
