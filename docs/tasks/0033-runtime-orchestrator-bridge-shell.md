# Task Card 0033

## Title
Implement the first concrete in-process orchestrator/runtime bridge shell

## Role
Implementer

## Goal
Create the first concrete in-process bridge between the completed orchestrator and runtime bridge layers based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/bridge-runner.md`
- `docs/runtime/orchestrator-bridge.md`
- `docs/runtime/roadmap.md`

This task should build one bounded cross-package vertical slice that:

- receives typed protocol events emitted by `TurnOrchestrator`
- buffers them in exact emission order
- routes them into `RuntimeBridgeRunner`
- records the resulting typed runtime egress
- returns one typed in-process bridge result without inventing a bus or network transport

Use **Python 3.10+** and existing local runtime/orchestrator/protocol modules only.

This task intentionally does **not** implement STT/TTS/renderer adapters, event buses, websocket/http APIs, databases, or external services.

---

## Scope Clarification
This card is intentionally larger than the recent runtime tasks.

The repo already has:

- a `TurnOrchestrator` protocol outbox shell
- a `RuntimeBridgeRunner`
- a bridge-ready `RuntimeService`

What it still lacks is the first concrete place where those pieces work together in-process.

This card includes only:

- one dedicated in-process bridge module in `packages/runtime`
- one optional typed protocol-event sink seam in `TurnOrchestrator`
- one concrete protocol-event collector
- one concrete runtime ingress source
- one concrete runtime egress recorder
- one typed bridge coordinator shell
- bounded after-turn draining of orchestrator protocol events into runtime

This card does **not** authorize:

- a real event bus
- websocket/http transports
- STT / TTS / renderer / VTube integration
- orchestrator scheduling redesign
- runtime persistence redesign
- tool-loop runtime execution

The target is the first concrete in-process orchestrator/runtime bridge, not a general transport stack.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial** implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **900-1500 lines of non-test Python** across the allowed files is acceptable
- do **not** collapse this card into a tiny collector plus a single `run_batch(...)` call
- do **not** split protocol-event sink injection, concrete source/sink implementations, typed bridge result models, and turn-level bridge coordination into extra mini-tasks inside this card

The purpose of this section is to keep development tempo high while landing one meaningful cross-package vertical slice.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/bridge-service.md`
- `docs/runtime/bridge-runner.md`
- `docs/runtime/orchestrator-bridge.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/orchestrator/turn_orchestrator.py`
- `packages/runtime/runtime_service.py`
- `packages/runtime/runtime_bridge.py`
- `packages/runtime/runtime_persistence.py`
- `packages/runtime/runtime_snapshot.py`

If they already exist, you may also read:

- `tests/orchestrator/test_turn_orchestrator.py`
- `tests/runtime/test_runtime_bridge.py`
- `tests/runtime/test_runtime_service.py`
- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_supervisor.py`

Do **not** read STT / TTS / renderer / memory / plugin files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/orchestrator_bridge.py`
- `packages/orchestrator/turn_orchestrator.py`
- `packages/runtime/runtime_bridge.py`
- `tests/runtime/test_orchestrator_bridge.py`
- `tests/orchestrator/test_turn_orchestrator.py`
- `tests/runtime/test_runtime_bridge.py`

Do **not** create or modify any other file.
In particular:

- do not modify protocol files
- do not modify `packages/runtime/runtime_service.py`
- do not modify `packages/runtime/runtime_persistence.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. New in-process bridge module
Create:

- `packages/runtime/orchestrator_bridge.py`

It must define at least these runtime-local types:

- `BufferedProtocolEventSink`
- `BufferedRuntimeIngressSource`
- `RecordingRuntimeEgressSink`
- `OrchestratorRuntimeBridgeConfig`
- `OrchestratorRuntimeBridgeTurnResult`
- `OrchestratorRuntimeBridgeFailure`
- `OrchestratorRuntimeBridgeHaltedError`
- `OrchestratorRuntimeBridge`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for bridge-local models
- keep these as runtime-local integration types, not protocol events and not external transport schemas

At minimum:

`OrchestratorRuntimeBridgeConfig` must include explicit bridge-local settings for:

- whether recovery inspection should be emitted after live runtime draining
- the default `RuntimeBridgePersistencePolicy` to pass into the runtime bridge runner
- the default source label to use when wrapping orchestrator protocol events into runtime ingress envelopes

`OrchestratorRuntimeBridgeTurnResult` must preserve:

- the consumed `TurnContext`
- the ordered protocol events captured from `TurnOrchestrator`
- the ordered `RuntimeBridgeLiveResult` values produced while draining those events
- the ordered typed runtime sink outputs captured by the recording sink
- the final runtime snapshot after the bridge finishes

`OrchestratorRuntimeBridgeFailure` must preserve:

- whether failure came from the orchestrator side or runtime bridge side
- the original exception type/message
- the partial ordered protocol events collected so far
- the partial runtime snapshot when available
- the nested `RuntimeBridgeFailure` when the failure originated in the runtime bridge layer

### 2. Optional protocol-event sink seam in `TurnOrchestrator`
Update `packages/orchestrator/turn_orchestrator.py` to support one optional typed protocol-event sink boundary.

Requirements:

- the seam must remain optional
- current behavior with no sink attached must remain a safe no-op
- `_send_protocol_event(...)` must delegate to the sink when present
- event emission timing and semantics must not change
- do **not** redesign orchestrator task topology, parser behavior, or audio mutex behavior in this card

### 3. Concrete source/sink implementations
The new bridge module must implement concrete in-memory boundaries compatible with the existing runtime bridge layer.

Requirements:

`BufferedProtocolEventSink` must:

- accept typed protocol events from `TurnOrchestrator`
- preserve exact emission order
- expose deterministic read/drain helpers for the collected events

`BufferedRuntimeIngressSource` must:

- implement the existing `RuntimeIngressSourcePort`
- serve one ingress envelope or one ordered ingress batch derived from the buffered protocol events
- preserve event order exactly

`RecordingRuntimeEgressSink` must:

- implement the existing `RuntimeEgressSinkPort`
- record ordered process egress envelopes
- record ordered process batch results
- record ordered replay egress envelopes
- record ordered recovery inspection envelopes

### 4. Turn-level bridge coordinator shell
`OrchestratorRuntimeBridge` must expose one bounded turn-level entrypoint such as:

- `run_turn(ctx) -> OrchestratorRuntimeBridgeTurnResult`

Requirements:

- it must use the concrete protocol-event collector on the orchestrator side
- it must run `TurnOrchestrator.handle_user_turn(ctx)`
- after orchestrator completion, it must deterministically drain collected protocol events in exact order
- it must wrap those events into runtime ingress envelopes using the configured source label
- it must route them into the existing `RuntimeBridgeRunner`
- it must record typed runtime egress through `RecordingRuntimeEgressSink`
- it must return one typed bridge result

If the orchestrator emitted zero protocol events, the bridge must handle that explicitly and safely.

### 5. Runtime bridge delegation
The new bridge shell must route live runtime work only through the existing `RuntimeBridgeRunner`.

Requirements:

- do **not** call `RuntimeService`, `RuntimeSupervisor`, `RuntimeRegistry`, or `SessionRuntime` directly from the bridge coordinator
- do **not** rebuild runtime sink/source semantics yourself when an existing runtime bridge boundary already exists
- if a minor helper is needed in `packages/runtime/runtime_bridge.py`, keep it bounded to enabling this bridge shell

### 6. Failure semantics
Failure handling must remain conservative.

Requirements:

- if `TurnOrchestrator.handle_user_turn(ctx)` fails, surface a typed bridge failure and do not invent rollback
- if runtime bridge draining fails, surface a typed bridge failure and preserve nested `RuntimeBridgeFailure`
- if protocol events were already collected before failure, preserve them in the bridge failure surface
- if a partial runtime snapshot is available, include it
- do **not** invent retries, rollback, or bus-like redelivery behavior

### 7. Minimum test coverage
Update tests with minimum coverage for:

- optional protocol-event sink injection in `TurnOrchestrator`
- no-sink `TurnOrchestrator` behavior remains unchanged in meaning
- ordered protocol-event collection from orchestrator
- concrete runtime ingress source preserves event order
- concrete runtime egress sink preserves emission order
- `OrchestratorRuntimeBridge.run_turn(ctx)` routes through `RuntimeBridgeRunner`, not direct runtime internals
- `run_turn(ctx)` handles a turn with zero emitted protocol events safely
- bridge result preserves ordered protocol events and runtime sink outputs
- orchestrator-side failure surfaces typed bridge failure
- runtime-bridge-side failure surfaces typed bridge failure with nested `RuntimeBridgeFailure`
- existing `test_turn_orchestrator.py` and `test_runtime_bridge.py` semantics still pass

Keep the tests bounded to this first in-process bridge behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing types instead of redefining them:
   - `TurnContext`
   - `BaseEvent`
   - `RuntimeBridgeRunner`
   - `RuntimeBridgeLiveResult`
   - `RuntimeBridgeFailure`
   - `RuntimeBridgePersistencePolicy`
   - `RuntimeIngressEnvelope`
   - `RuntimeIngressBatch`
   - `RuntimeRegistrySnapshot`
3. Bridge models for this task must be runtime-local integration types, not protocol events.
4. Protocol-event collection order must match orchestrator emission order exactly.
5. Runtime ingress order must preserve collected protocol-event order exactly.
6. All runtime processing must still route through `RuntimeBridgeRunner`.
7. The orchestrator-side sink seam must remain optional and non-breaking.
8. Failure handling must remain conservative and non-rollbacking.
9. Do **not** introduce event buses, network APIs, adapter logic, or database logic.
10. The implementation should be substantial enough to complete one coherent in-process bridge slice rather than leaving collection, draining, and failure surfaces as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- event-bus integrations
- websocket/http APIs
- STT/TTS/renderer/VTube adapter work
- orchestrator scheduling redesign
- runtime persistence redesign
- replay redesign
- database backends
- remote object stores
- distributed workers
- tool runtime
- plugin or memory integration

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_orchestrator_bridge.py`
   - `tests/orchestrator/test_turn_orchestrator.py`
   - `tests/runtime/test_runtime_bridge.py`
   - `tests/runtime/test_runtime_service.py`
   - `tests/runtime/test_runtime_replay.py`
   - `tests/runtime/test_runtime_supervisor.py`
   - `tests/runtime/test_runtime_registry.py`
   - `tests/runtime/test_session_runtime.py`
   - `tests/runtime/test_state_driver.py`
   - `tests/runtime/test_transition_context_tracker.py`
   - `tests/runtime/test_effect_forwarder.py`
3. If test execution is blocked by environment limits:
   - do not install dependencies
   - do not fake results
   - explicitly state what was not run and why

---

## Output Format
At completion, report exactly:

1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

---

## Acceptance Criteria
This task is complete only if:

- `packages/runtime/orchestrator_bridge.py` exists
- `TurnOrchestrator` supports one optional typed protocol-event sink seam without changing no-sink semantics
- concrete in-memory protocol-event collection exists
- concrete runtime ingress source and runtime egress sink implementations exist
- `OrchestratorRuntimeBridge` can run one turn, drain ordered protocol events into runtime, and return one typed result
- runtime processing still routes only through `RuntimeBridgeRunner`
- no event-bus, network, adapter, database, or STT/TTS/renderer code was implemented
- tests cover the first in-process orchestrator/runtime bridge behavior at least minimally
