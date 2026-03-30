# Runtime Orchestrator Bridge Session

## Purpose

This document defines the next bounded bridge layer above the first concrete
in-process orchestrator/runtime bridge.

The repo now already has:

- a `TurnOrchestrator` that can emit typed protocol events into an optional sink
- a concrete `OrchestratorRuntimeBridge` that can drain those events after the
  turn finishes
- a `RuntimeBridgeRunner` that can turn typed ingress into typed runtime egress

At the time this document was introduced, what was still missing was one bridge
session layer that could drain protocol events while the orchestrator turn was
still active.

That step is now implemented in:

- `packages/runtime/orchestrator_bridge.py`

---

## Position In The Stack

This layer sits:

- above `packages/orchestrator/turn_orchestrator.py`
- above `packages/runtime/runtime_bridge.py`
- above the first concrete after-turn `packages/runtime/orchestrator_bridge.py`
- below any future event bus, websocket, HTTP, STT, TTS, or renderer adapter

Its job is narrow:

- receive typed protocol events as they are emitted during a turn
- preserve exact emission order
- feed those events into runtime incrementally
- record typed runtime egress as the turn progresses
- return one typed turn-session result or failure surface

It is still coordination glue, not a new owner of orchestration or runtime
meaning.

---

## Why This Layer Comes Next

The first concrete bridge shell proved that orchestrator output can be routed
into runtime without inventing a bus.

However, its deterministic after-turn draining strategy means runtime does not
observe the turn until the orchestrator has already finished.

That leaves an important gap:

- runtime cannot progress session state during the active turn
- runtime recovery inspection cannot reflect the turn while it is still running
- later external bridges would need to invent their own live-drain coordination

The next bounded improvement should therefore be one explicit bridge session
that drains protocol events incrementally while the turn is active.

---

## Core Boundary Rules

The turn-active bridge session must obey all of the following:

- `TurnOrchestrator` remains the sole owner of turn execution, parsing,
  handoff, quick reaction, interrupt shell behavior, and playback bridge logic
- `RuntimeBridgeRunner` remains the sole owner of live runtime ingress,
  persistence coordination, replay routing, and runtime egress ordering
- the bridge session must not mutate `SessionRuntime`, `RuntimeRegistry`,
  `RuntimeSupervisor`, `AudioMutex`, or `TurnOrchestrator` internals directly
- the bridge session may consume only already-typed protocol events and
  already-typed runtime egress
- the bridge session must stay in-process and transport-agnostic in v0.1

This keeps the new layer as live coordination glue instead of a hidden second
runtime or second orchestrator.

---

## Required Building Blocks

The first turn-active bridge session should define four concrete pieces.

### 1. Turn-scoped queued protocol-event sink

A typed sink implementation that:

- accepts one typed `BaseEvent`
- preserves exact emission order
- supports incremental draining while the turn is active
- still exposes a stable full ordered event log for the final result surface

This sink remains in-memory only.

### 2. Incremental runtime-drain loop

One bounded live-drain loop that:

- waits for the next protocol event while the turn is active
- wraps each event into one typed ingress envelope
- routes that envelope only through `RuntimeBridgeRunner`
- records one `RuntimeBridgeLiveResult` per successfully drained event

The first version should prefer exact per-event order over aggressive batching.

### 3. Turn-session result and failure surface

One typed turn-session surface that preserves at least:

- the `TurnContext`
- the full ordered protocol-event log
- the ordered subset that was successfully drained into runtime
- the ordered subset that remained undrained at halt time, if any
- the ordered live runtime results produced during the session
- the typed runtime egress captured by the sink
- the final or partial runtime snapshot

### 4. Session coordinator shell

One typed coordinator that owns:

- one `TurnOrchestrator`
- one `RuntimeBridgeRunner`
- one queued protocol-event sink
- one concrete runtime egress recorder
- one incremental drain loop

Its job is to run one orchestrator turn and one runtime-drain loop together
without inventing a real transport.

---

## Turn-Session Execution Model

The first turn-active bridge session should support one bounded flow:

1. create a turn-scoped queued protocol-event sink
2. attach it to `TurnOrchestrator`
3. start `TurnOrchestrator.handle_user_turn(ctx)`
4. start one incremental runtime-drain loop
5. each emitted protocol event becomes one typed runtime ingress envelope
6. each envelope is processed through `RuntimeBridgeRunner`
7. typed runtime egress is recorded in exact sink order
8. when the orchestrator finishes, the sink is closed explicitly
9. the drain loop consumes any remaining queued events and settles
10. the bridge session returns one typed result

The first version should be explicit that live draining is:

- in-process
- deterministic
- single-turn scoped
- non-transactional

---

## Ordering Rules

The session shell must preserve all of the following:

- protocol-event order exactly as emitted by `TurnOrchestrator`
- runtime ingress order exactly matching drained protocol-event order
- runtime egress order exactly as emitted through the bridge-runner sink

It must not:

- reorder events by session state
- coalesce multiple protocol events into undocumented synthetic events
- flatten runtime egress into a transport-specific schema

---

## Failure Semantics

The session shell should stay conservative.

That means:

- if `TurnOrchestrator` fails, the bridge session surfaces that failure directly
  through a typed bridge-session failure
- if runtime draining fails, the bridge session surfaces a typed bridge-session
  failure with the nested `RuntimeBridgeFailure`
- if some protocol events were already drained before failure, the bridge must
  preserve those successful live results
- if some protocol events were collected but not yet drained, the bridge must
  preserve that undrained tail explicitly
- the bridge session must not invent rollback, redelivery, or a real event bus

The first version may choose either of these acceptable post-failure policies:

- allow the orchestrator task to finish while the runtime drain loop stops
- or explicitly stop the session after the first fatal runtime-drain halt

But whichever policy is chosen must be:

- explicit
- deterministic
- fully covered by tests

---

## Relation To The Existing After-Turn Bridge

The turn-active bridge session does not replace the existing after-turn bridge
shell immediately.

Instead, it should be built as:

- a new session-oriented layer above the same typed sink and runtime bridge
  foundations
- or a clearly additive extension inside the existing bridge module

The repo should keep the original after-turn bridge path available until the
turn-active session shell has stable tests and a clearly better result surface.

---

## Non-Goals

This document does not define:

- a real event bus
- websocket or HTTP APIs
- multi-process workers
- STT callbacks
- TTS or renderer adapters
- persistence redesign
- network transport schemas

Those belong later.

---

## Recommended Next Task Shape

The next task should be a larger bundled task that:

- extends the current orchestrator/runtime bridge module with a turn-active
  session shell
- adds one queued protocol-event sink for incremental draining
- adds one typed session result surface and one typed session failure surface
- adds one live runtime-drain loop that routes every drained event through
  `RuntimeBridgeRunner`
- verifies exact ordering, zero-event behavior, partial-drain failure behavior,
  and final-settlement behavior with tests

This task should be larger than the after-turn bridge task because it is the
first point where Echo supports:

- one active orchestrator turn
- one active runtime drain loop
- typed in-process live bridge coordination
- partial-drain failure surfaces
