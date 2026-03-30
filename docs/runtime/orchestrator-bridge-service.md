# Runtime Orchestrator Bridge Service

## Purpose

This layer is now implemented in:

- `packages/runtime/orchestrator_bridge_service.py`

This document defines the first local service façade above the live
orchestrator/runtime bridge session and the persisted bridge-artifact layer.

The repo now already has:

- a turn-active `OrchestratorRuntimeBridgeSession`
- a persisted bridge-artifact and replay-material shell
- a stable `RuntimeBridgeRunner`

This document captured the last missing local service layer that needed to coordinate:

- running one bridged turn
- optionally persisting the resulting success or failure artifact
- deriving replay material from saved artifacts
- replaying that material back through the stable runtime bridge runner

That step is now complete.

Later work should now move above this layer into:

- concrete external transports
- adapter-facing bridges
- demo-critical module lines that consume this local service surface

---

## Position In The Stack

This layer sits:

- above `packages/runtime/orchestrator_bridge.py`
- above `packages/runtime/orchestrator_bridge_artifacts.py`
- above `packages/runtime/runtime_bridge.py`
- below any future bus, HTTP, websocket, STT, TTS, or renderer bridge

Its job is narrow:

- own one service-level live-turn entrypoint
- own one service-level replay-from-artifact entrypoint
- centralize optional artifact persistence policy
- centralize typed result and failure reporting for local tooling

It is still fully local and in-process.

---

## Why This Layer Existed

The bridge session made orchestrator/runtime live.
The bridge-artifact layer made that live result persistable and replay-ready.

The next missing capability is not another persistence helper.
It is one service surface that stops later tooling from having to manually
compose:

- `OrchestratorRuntimeBridgeSession`
- `OrchestratorBridgeArtifactManager`
- `RuntimeBridgeRunner`
- ad hoc success/failure persistence policy

Without this layer, every later bridge or operator tool would have needed to recreate
that coordination by hand.

---

## Core Boundary Rules

The orchestrator bridge service must obey all of the following:

- it may coordinate existing bridge/session/artifact/runner components
- it must not redefine protocol event meaning
- it must not redefine runtime egress meaning
- it must not mutate `TurnOrchestrator`, `RuntimeBridgeRunner`, `RuntimeService`,
  `RuntimeSupervisor`, or `SessionRuntime` internals directly
- it must stay local, deterministic, and replay-friendly in v0.1

This keeps the service as a façade, not a second implementation of the bridge
stack.

---

## Required Service Surfaces

The first local bridge service should define these concrete surfaces.

### 1. Live turn entrypoint

One typed service entrypoint that:

- accepts a `TurnContext`
- runs one `OrchestratorRuntimeBridgeSession`
- returns one typed success surface on completion
- surfaces one typed failure on halt

### 2. Optional artifact persistence policy

One explicit service-level policy surface that can decide:

- whether successful turns should save a success artifact
- whether failed turns should save a failure artifact
- where those artifacts should be saved

This policy must remain explicit.
No hidden autosave behavior.

### 3. Replay from saved artifacts

One typed replay surface that can:

- load a saved success artifact and replay its full collected protocol events
- load a saved failure artifact and replay:
  - full collected events
  - drained prefix
  - undrained tail

Replay must still route only through the stable runtime bridge runner.

### 4. Typed service result / failure surfaces

The service must not return ad hoc dicts.
It should preserve at least:

- the nested live bridge-session result or failure
- saved artifact paths when persistence occurred
- replay material selection when replay occurred
- the nested runtime bridge live or replay result

---

## Failure Semantics

The service layer should stay conservative.

That means:

- live bridge-session failures surface clearly
- artifact save failures surface clearly
- replay-from-artifact failures surface clearly
- persistence should not pretend success if artifact saving failed
- the layer must not invent rollback, retries, or automatic resume

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
- transport schemas for external clients

Those belong later.

---

## Recommended Next Task Shape

The next task should be a larger bundled task that:

- creates one dedicated local bridge-service module in `packages/runtime`
- defines service-local config, result, and failure models
- coordinates live turn execution through `OrchestratorRuntimeBridgeSession`
- coordinates optional success/failure artifact persistence through the
  bridge-artifact manager
- coordinates replay from saved artifacts through `RuntimeBridgeRunner`
- verifies typed result surfaces, persistence paths, replay slice selection, and
  clear failure handling with tests

This task should be larger than a normal helper task because it is the first
point where Echo exposes one coherent local service façade over the entire
orchestrator/runtime bridge stack instead of leaving callers to manually stitch
that stack together.
