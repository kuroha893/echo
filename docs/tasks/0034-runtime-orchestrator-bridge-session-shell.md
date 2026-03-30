# Task Card 0034

## Title
Implement the turn-active incremental orchestrator/runtime bridge session shell

## Role
Implementer

## Goal
Extend the existing in-process orchestrator/runtime bridge into a turn-active
incremental bridge session based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/bridge-runner.md`
- `docs/runtime/orchestrator-bridge.md`
- `docs/runtime/orchestrator-bridge-session.md`
- `docs/runtime/roadmap.md`

This task should upgrade the current after-turn bridge behavior into one
bounded turn-session shell that:

- captures typed protocol events while `TurnOrchestrator.handle_user_turn(...)`
  is still running
- drains those events into runtime incrementally in exact orchestrator emission
  order
- records ordered typed runtime egress as the turn progresses
- returns one typed session result or typed session failure surface without
  inventing a bus or network transport

Use **Python 3.10+** and existing local runtime/orchestrator/protocol modules
only.

This task intentionally does **not** implement event buses, websocket/http
bridges, STT/TTS/renderer adapters, databases, or external services.

---

## Scope Clarification
This card intentionally builds on top of the completed first concrete
orchestrator/runtime bridge.

The repo already has:

- a `TurnOrchestrator` with an optional typed protocol-event sink seam
- a concrete after-turn `OrchestratorRuntimeBridge`
- a `RuntimeBridgeRunner` that can process one ingress envelope or one ingress
  batch

What it still lacks is one explicit live bridge session where runtime can ingest
protocol events while the turn is active.

This card includes only:

- one queued turn-scoped protocol-event sink
- one turn-active runtime drain loop
- one typed per-step session result surface
- one typed session failure surface with explicit drained vs undrained tails
- additive session-shell logic in the existing runtime orchestrator bridge layer
- tests for live draining, ordering, zero-event behavior, and partial-drain
  failure handling

This card does **not** authorize:

- a real event bus
- websocket/http transport layers
- STT / TTS / renderer / VTube integration
- orchestrator scheduling redesign
- runtime service or persistence redesign
- replay redesign
- tool-loop runtime execution

The target is a turn-active in-process bridge session, not a general external
transport stack.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial**
implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **900-1500 lines of non-test Python** across the allowed
  files is acceptable
- do **not** collapse this card into a thin wrapper around the existing
  after-turn bridge
- do **not** split queued sink behavior, live drain coordination, typed
  step-result models, typed session-failure models, and settlement logic into
  extra mini-tasks inside this card

The purpose of this section is to keep development tempo high while landing one
meaningful turn-active bridge slice rather than another thin delegation shell.

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
- `docs/runtime/bridge-runner.md`
- `docs/runtime/orchestrator-bridge.md`
- `docs/runtime/orchestrator-bridge-session.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/orchestrator/turn_orchestrator.py`
- `packages/runtime/orchestrator_bridge.py`
- `packages/runtime/runtime_bridge.py`
- `packages/runtime/runtime_snapshot.py`

If they already exist, you may also read:

- `tests/runtime/test_orchestrator_bridge.py`
- `tests/runtime/test_runtime_bridge.py`
- `tests/runtime/test_runtime_service.py`
- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read STT / TTS / renderer / memory / plugin files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/orchestrator_bridge.py`
- `packages/runtime/runtime_bridge.py`
- `tests/runtime/test_orchestrator_bridge.py`
- `tests/runtime/test_runtime_bridge.py`

Do **not** create or modify any other file.
In particular:

- do not modify protocol files
- do not modify `packages/orchestrator/turn_orchestrator.py`
- do not modify `packages/runtime/runtime_service.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Turn-active bridge session models
Extend `packages/runtime/orchestrator_bridge.py` with additive turn-session
types at least equivalent to:

- `QueuedProtocolEventSink`
- `OrchestratorRuntimeBridgeSessionConfig`
- `OrchestratorRuntimeBridgeStepResult`
- `OrchestratorRuntimeBridgeSessionResult`
- `OrchestratorRuntimeBridgeSessionFailure`
- `OrchestratorRuntimeBridgeSessionHaltedError`
- `OrchestratorRuntimeBridgeSession`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for all
  bridge-local models
- keep these as runtime-local integration/session types, not protocol events and
  not transport schemas

At minimum:

`OrchestratorRuntimeBridgeSessionConfig` must include explicit bridge-local
settings for:

- whether recovery inspection should be emitted after each successful live step
- whether post-step runtime snapshots should be captured in the session result
- the default `RuntimeBridgePersistencePolicy` to pass into the runtime bridge
  runner
- the default source label to use when wrapping orchestrator protocol events
  into runtime ingress envelopes

`OrchestratorRuntimeBridgeStepResult` must preserve:

- the drained `BaseEvent`
- the `RuntimeBridgeLiveResult` produced for that event
- an optional post-step `RuntimeRegistrySnapshot`

`OrchestratorRuntimeBridgeSessionResult` must preserve:

- the consumed `TurnContext`
- the full ordered protocol-event log collected from the orchestrator
- the ordered subset that was successfully drained into runtime
- the ordered undrained tail, if any
- the ordered step results
- the ordered typed runtime sink outputs captured during the session
- the final runtime snapshot after settlement

`OrchestratorRuntimeBridgeSessionFailure` must preserve:

- whether failure came from the orchestrator side or runtime bridge side
- the original exception type/message
- the full ordered protocol-event log collected so far
- the ordered drained subset
- the ordered undrained tail
- the partial ordered step results
- the partial recorded runtime sink outputs
- the partial runtime snapshot when available
- the nested `RuntimeBridgeFailure` when the failure originated in the runtime
  bridge layer

### 2. Queued protocol-event sink for live draining
The bridge module must implement one queued, turn-scoped protocol-event sink
that supports live draining.

Requirements:

`QueuedProtocolEventSink` must:

- accept typed protocol events from `TurnOrchestrator`
- preserve exact orchestrator emission order
- expose one stable full ordered event log for final reporting
- expose the next queued event for incremental draining while the turn is active
- expose an explicit closed/end-of-stream signal so the drain loop can settle
  deterministically
- avoid mutating event payloads

It must remain entirely in-memory and in-process.

### 3. Turn-active runtime drain loop
`OrchestratorRuntimeBridgeSession` must expose one bounded turn-level entrypoint
such as:

- `run_turn(ctx) -> OrchestratorRuntimeBridgeSessionResult`

Requirements:

- it must attach the queued sink to `TurnOrchestrator`
- it must run `TurnOrchestrator.handle_user_turn(ctx)` and one runtime drain
  loop concurrently
- the drain loop must convert drained protocol events into runtime ingress one
  event at a time
- each drained event must still route only through
  `RuntimeBridgeRunner.run_single_envelope(...)`
- runtime egress must be captured through the existing typed recording sink
- after orchestrator completion, the session must close the queued sink
  explicitly and settle any remaining queued events
- if the orchestrator emitted zero protocol events, the session must handle that
  explicitly and safely

### 4. Ordered per-step live results
The turn-active bridge session must keep exact per-step accounting.

Requirements:

- every successfully drained protocol event must produce exactly one
  `OrchestratorRuntimeBridgeStepResult`
- step-result order must match drained protocol-event order exactly
- if post-step runtime snapshots are enabled, those snapshots must align with
  step-result order exactly
- the final session result must not reorder protocol events, step results, or
  recorded runtime sink outputs

### 5. Conservative partial-drain failure semantics
Failure handling must remain conservative and explicit.

Requirements:

- if `TurnOrchestrator.handle_user_turn(ctx)` fails, surface a typed session
  failure and preserve any already-drained results plus any remaining undrained
  collected events
- if runtime bridge draining fails, stop further runtime ingestion, preserve the
  nested `RuntimeBridgeFailure`, and preserve the undrained tail explicitly
- do **not** invent retries, rollback, redelivery, or a real event bus
- if a partial runtime snapshot is available, include it
- if the final runtime snapshot is unavailable after failure, use the best
  partial snapshot available rather than faking completeness

### 6. Regression safety for the existing after-turn bridge
The new session shell must be additive.

Requirements:

- keep the existing `OrchestratorRuntimeBridge` after-turn path available
- do not silently change its result model or after-turn draining semantics
- if shared helpers are refactored, keep that refactor bounded to enabling the
  new session shell

### 7. Bounded runtime bridge helper changes
If a small helper is needed in `packages/runtime/runtime_bridge.py`, keep it
strictly bounded to enabling the turn-active bridge session.

Requirements:

- do **not** redesign runtime bridge public semantics
- do **not** move persistence, replay, or service logic into the bridge session
- do **not** bypass the existing runner paths

### 8. Minimum test coverage
Update tests with minimum coverage for:

- queued protocol-event sink exact-order behavior
- queued sink close/end-of-stream behavior
- live turn-session draining one protocol event at a time in exact order
- step-result ordering and alignment with drained protocol events
- optional post-step runtime snapshots when enabled
- zero-event turn success
- runtime-bridge-side halt yielding nested `RuntimeBridgeFailure` and an
  explicit undrained tail
- orchestrator-side halt yielding partial drained results plus typed session
  failure
- existing after-turn bridge behavior still passing regression coverage
- any bounded runtime-bridge helper changes still preserving current semantics

Keep the tests bounded to this turn-active in-process session behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing types instead of redefining them:
   - `TurnContext`
   - `TurnOrchestrator`
   - `BaseEvent`
   - `RuntimeBridgeRunner`
   - `RuntimeBridgeLiveResult`
   - `RuntimeBridgeFailure`
   - `RuntimeBridgePersistencePolicy`
   - `RuntimeRegistrySnapshot`
3. All runtime ingestion must still route only through
   `RuntimeBridgeRunner.run_single_envelope(...)`.
4. Protocol-event collection order must match orchestrator emission order
   exactly.
5. Drained event order must match runtime live step order exactly.
6. The queued sink must remain in-process and optional from the orchestrator's
   perspective.
7. Failure handling must remain conservative and non-rollbacking.
8. The existing after-turn bridge path must remain available and non-breaking.
9. Do **not** introduce event buses, network APIs, adapter logic, database
   logic, or external transport schemas.
10. The implementation should be substantial enough to complete one coherent
    turn-active bridge session slice rather than leaving queueing, live drain
    coordination, or typed failure surfaces as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- event-bus integrations
- websocket/http APIs
- STT/TTS/renderer/VTube adapter work
- orchestrator scheduling redesign
- runtime service redesign
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
2. If a working Python interpreter and required dependencies are available
   locally, run:
   - `tests/runtime/test_orchestrator_bridge.py`
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

- `packages/runtime/orchestrator_bridge.py` now contains one explicit
  turn-active bridge session shell
- a queued protocol-event sink exists for incremental draining
- live runtime draining occurs while the turn is active, not only after final
  turn completion
- every drained protocol event routes through
  `RuntimeBridgeRunner.run_single_envelope(...)`
- session results preserve full collected order, drained order, and any
  undrained tail explicitly
- typed partial-drain failure surfaces exist for both orchestrator-side and
  runtime-side halts
- the existing after-turn `OrchestratorRuntimeBridge` path remains available and
  unbroken
- no event-bus, network, adapter, database, or STT/TTS/renderer code was
  implemented
- tests cover the turn-active bridge session behavior at least minimally
