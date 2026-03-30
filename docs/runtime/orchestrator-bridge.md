# Runtime Orchestrator Bridge

## Purpose

This document defines the first concrete in-process bridge between:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/runtime/runtime_bridge.py`

It exists because the repo now already has:

- a `TurnOrchestrator` that emits typed protocol events through an internal outbox shell
- a `RuntimeBridgeRunner` that can consume typed ingress batches and emit typed runtime egress

At the time this document was introduced, what was missing was one bounded
integration layer that let those two completed subsystems talk to each other without:

- bypassing orchestrator ownership
- bypassing runtime ownership
- inventing a real event bus too early

That step is now implemented in:

- `packages/runtime/orchestrator_bridge.py`

---

## Position In The Stack

This bridge sits:

- above `TurnOrchestrator`
- above `RuntimeBridgeRunner`
- below any future event bus, websocket, HTTP, STT, TTS, or renderer adapter

Its job is narrow:

- receive typed protocol events from the orchestrator side
- preserve their order
- hand them to the runtime bridge-runner shell
- capture typed runtime egress

It is a composition layer, not a new owner of orchestration or runtime semantics.

---

## Why This Layer Comes Next

If we stop at the transport-agnostic runner shell, the repo still lacks one concrete place where:

- `TurnOrchestrator` can emit real typed protocol events to a non-no-op target
- those events can be buffered and drained deterministically
- runtime bridge execution can be driven from actual orchestrator output

Without this layer, the next external bridge or adapter would have to solve all of that itself.
That would scatter responsibility and make later integrations harder to audit.

This bridge is the first place where the already-built pieces become one real in-process pipeline:

1. orchestrator emits typed protocol events
2. bridge buffers them
3. runtime bridge-runner ingests them
4. runtime emits typed egress
5. bridge records that egress for later external delivery

---

## Core Boundary Rules

The in-process orchestrator/runtime bridge must obey all of the following:

- `TurnOrchestrator` remains the sole owner of turn execution, parsing, handoff, and interrupt logic
- `RuntimeBridgeRunner` remains the sole owner of runtime ingress processing, replay routing, persistence coordination, and runtime egress ordering
- the bridge must not mutate `SessionRuntime`, `RuntimeRegistry`, `RuntimeSupervisor`, or `TurnOrchestrator` internals directly
- the bridge may only consume already-typed protocol events and already-typed runtime egress
- the bridge must stay in-process and transport-agnostic in v0.1

This keeps the bridge as coordination glue instead of a hidden second implementation.

---

## Concrete Building Blocks

The first in-process bridge should define four concrete pieces.

### 1. Orchestrator-side protocol event sink

A typed sink boundary that `TurnOrchestrator` can call whenever it emits a protocol event.

This sink should:

- accept one typed `BaseEvent`
- preserve exact emission order
- avoid mutating event payloads
- remain in-memory only

### 2. Runtime ingress source implementation

A concrete `RuntimeIngressSourcePort` implementation backed by the collected protocol events.

It should be able to provide:

- one ingress envelope
- one ordered ingress batch

### 3. Runtime egress sink implementation

A concrete `RuntimeEgressSinkPort` implementation that records:

- ordered live process egress envelopes
- ordered batch results
- ordered replay egress envelopes
- ordered recovery inspection envelopes

This recording sink is still in-memory and typed.

### 4. Bridge coordinator shell

A typed shell that owns:

- one `TurnOrchestrator`
- one `RuntimeBridgeRunner`
- one orchestrator-side protocol event sink
- one concrete runtime ingress source
- one concrete runtime egress sink

Its job is to run one orchestrator turn and drain the resulting protocol events into runtime.

---

## Turn-Level Execution Model

The first concrete bridge should support one bounded turn-level flow:

1. create a turn-scoped protocol event collector
2. attach it to `TurnOrchestrator`
3. run `handle_user_turn(ctx)`
4. drain the collected protocol events in caller-preserved order
5. feed them to `RuntimeBridgeRunner`
6. record the resulting runtime egress
7. return one typed turn-level bridge result

The first version may choose one of two acceptable draining strategies:

- incremental draining while the turn is still active
- final draining immediately after orchestrator completion

But whichever strategy is chosen, it must be:

- explicit
- deterministic
- fully covered by tests

---

## Required Result Surface

The first bridge shell should return a typed result that preserves at least:

- the turn context used
- the ordered protocol events emitted by the orchestrator
- the ordered runtime bridge live results produced while draining those events
- the typed runtime egress captured by the recording sink
- the final runtime snapshot after the bridge work completes

This result is still runtime-local and in-process.
It is not yet an external transport payload.

---

## Failure Semantics

The bridge should stay conservative.

That means:

- if `TurnOrchestrator` fails, the bridge surfaces that failure directly
- if runtime bridge processing fails, the bridge surfaces a typed bridge failure directly
- if some runtime work has already completed, the bridge must not invent rollback
- if the orchestrator emits no protocol events, that should be handled explicitly rather than hidden

This keeps the bridge aligned with the existing non-transactional runtime philosophy.

---

## Required Small Change In `TurnOrchestrator`

The current orchestrator protocol outbox shell already exists, but the default send boundary is still a no-op.

The first bridge task is therefore allowed to add one bounded integration seam:

- an injectable typed protocol-event sink or equivalent callback boundary

That seam must:

- remain optional
- preserve current no-op behavior when no sink is attached
- avoid changing any event emission timing or semantics

This is the only orchestrator-side behavior change that should be required.

---

## Non-Goals

This document does not define:

- a real event bus
- websocket or HTTP APIs
- STT callbacks
- TTS or renderer adapters
- multi-process workers
- remote persistence
- authentication

Those belong later.

---

## Recommended First Task Shape

The first in-process orchestrator/runtime bridge task should be a larger bundled task that:

- creates one dedicated bridge module in `packages/runtime`
- defines one concrete protocol-event collector
- defines one concrete runtime ingress source
- defines one concrete runtime egress recorder
- adds one optional protocol-event sink seam to `TurnOrchestrator`
- implements one typed bridge coordinator shell
- verifies ordered orchestrator emission, ordered runtime ingestion, typed runtime egress capture, and conservative failure handling with tests

This task should be somewhat larger than the recent runtime tasks because it is the first concrete cross-package vertical slice that composes:

- orchestrator protocol outbox
- runtime bridge-runner
- live runtime processing
- concrete in-process bridge recording
