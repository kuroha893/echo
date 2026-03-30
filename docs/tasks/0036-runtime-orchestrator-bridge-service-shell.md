# Task Card 0036

## Title
Implement the local orchestrator/runtime bridge service shell

## Role
Implementer

## Goal
Create `packages/runtime/orchestrator_bridge_service.py` as the first local
service façade above:

- `packages/runtime/orchestrator_bridge.py`
- `packages/runtime/orchestrator_bridge_artifacts.py`
- `packages/runtime/runtime_bridge.py`

based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/orchestrator-bridge-session.md`
- `docs/runtime/orchestrator-bridge-artifacts.md`
- `docs/runtime/orchestrator-bridge-service.md`
- `docs/runtime/roadmap.md`

This task should land one coherent service shell that can:

- run one live `TurnContext` through `OrchestratorRuntimeBridgeSession`
- optionally persist success or failure artifacts through
  `OrchestratorBridgeArtifactManager`
- replay from saved success or failure artifacts through
  `RuntimeBridgeRunner.run_replay_batch(...)`
- return typed service-local success and failure surfaces without inventing a
  bus or network transport

Use **Python 3.10+** and existing local runtime/orchestrator/protocol modules
only.

This task intentionally does **not** implement a bus, websocket/http bridge,
database, remote store, adapter, or automatic resume mechanism.

---

## Scope Clarification
This card builds directly on top of the completed live bridge session and the
completed persisted bridge-artifact layer.

The repo already has:

- a turn-active `OrchestratorRuntimeBridgeSession`
- a persisted bridge-artifact and replay-material layer
- a stable `RuntimeBridgeRunner`

What it still lacks is one explicit local service surface that can coordinate
those pieces without forcing later callers to manually stitch them together.

This card includes only:

- service-local config and typed result/failure models
- one live-turn service entrypoint
- one replay-from-artifact service entrypoint
- optional artifact persistence coordination for live success/failure
- typed artifact-path reporting
- typed replay-source reporting
- tests for service-level live success, service-level halt, artifact save/load
  coordination, replay selection, and conservative failure handling

This card does **not** authorize:

- event buses
- websocket/http APIs
- STT / TTS / renderer / VTube integration
- replay worker loops
- database or remote-object-store backends
- redesign of `RuntimeBridgeRunner`, `RuntimeService`, or `TurnOrchestrator`
- direct mutation of runtime/session/orchestrator internals
- automatic replay resume or redelivery

The target is a local service façade above the live bridge stack, not a new
transport layer.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial**
implementation.

Requirements:

- it is allowed and desired to write **a large amount of non-test code**
- a rough target of **1100-1700 lines of non-test Python** across the allowed
  files is acceptable
- do **not** collapse this card into a thin wrapper that only delegates a couple
  of methods
- do **not** split service-local result models, failure models, live execution,
  artifact persistence coordination, and replay-from-artifact coordination into
  later mini-tasks

The purpose of this section is to keep development tempo high while landing one
meaningful local bridge-service slice rather than another thin façade.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/orchestrator-bridge-session.md`
- `docs/runtime/orchestrator-bridge-artifacts.md`
- `docs/runtime/orchestrator-bridge-service.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/orchestrator/turn_orchestrator.py`
- `packages/runtime/orchestrator_bridge.py`
- `packages/runtime/orchestrator_bridge_artifacts.py`
- `packages/runtime/runtime_bridge.py`
- `packages/runtime/runtime_service.py`
- `packages/runtime/runtime_snapshot.py`

If they already exist, you may also read:

- `tests/runtime/test_orchestrator_bridge.py`
- `tests/runtime/test_orchestrator_bridge_artifacts.py`
- `tests/runtime/test_runtime_bridge.py`
- `tests/runtime/test_runtime_service.py`
- `tests/runtime/test_runtime_persistence.py`
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

- `packages/runtime/orchestrator_bridge_service.py`
- `tests/runtime/test_orchestrator_bridge_service.py`

Do **not** create or modify any other file.
In particular:

- do not modify protocol files
- do not modify docs
- do not modify `packages/orchestrator/*`
- do not modify `packages/runtime/orchestrator_bridge.py`
- do not modify `packages/runtime/orchestrator_bridge_artifacts.py`
- do not modify `packages/runtime/runtime_bridge.py`
- do not modify `packages/runtime/runtime_service.py`
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Service-local model family
Create one runtime-local service model family in
`packages/runtime/orchestrator_bridge_service.py`, at least equivalent to:

- `OrchestratorBridgeServiceConfig`
- `OrchestratorBridgeServiceArtifactPaths`
- `OrchestratorBridgeServiceReplaySourceKind`
- `OrchestratorBridgeServiceReplayRequest`
- `OrchestratorBridgeServiceLiveResult`
- `OrchestratorBridgeServiceReplayResult`
- `OrchestratorBridgeServiceFailure`
- `OrchestratorBridgeServiceHaltedError`
- `OrchestratorBridgeService`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for all
  service-local models
- keep these as runtime-local service types, not protocol events and not
  transport schemas

At minimum:

`OrchestratorBridgeServiceConfig` must include explicit service-local settings
for:

- whether successful live turns should persist a success artifact by default
- whether failed live turns should persist a failure artifact by default
- the default replay source label to use when replaying from saved artifacts
- the default `RuntimeBridgePersistencePolicy` to use for replay
- whether recovery inspection should be emitted after replay by default

`OrchestratorBridgeServiceArtifactPaths` must preserve at least:

- the saved success artifact path when one was written
- the saved failure artifact path when one was written

`OrchestratorBridgeServiceReplayRequest` must preserve at least:

- whether replay comes from a success artifact or failure artifact
- the replay slice selection kind
- the source label override when provided

### 2. Live-turn service entrypoint
The service must expose one bounded live-turn entrypoint such as:

- `run_turn(ctx, ...) -> OrchestratorBridgeServiceLiveResult`

Requirements:

- it must route live execution only through `OrchestratorRuntimeBridgeSession`
- it must not reimplement the sink seam, queue drain loop, or per-step bridge
  session logic
- on success, it may optionally persist a success artifact through
  `OrchestratorBridgeArtifactManager`
- on halt, it may optionally persist a failure artifact through
  `OrchestratorBridgeArtifactManager`
- artifact persistence decisions must remain explicit and configurable

`OrchestratorBridgeServiceLiveResult` must preserve at least:

- the consumed `TurnContext`
- the nested `OrchestratorRuntimeBridgeSessionResult`
- the saved success artifact path when persistence occurred
- the built success envelope when available

### 3. Replay-from-artifact service entrypoints
The service must expose bounded replay entrypoints above saved bridge artifacts.

Requirements:

Support at least:

- replay from a saved success artifact using `full_collected`
- replay from a saved failure artifact using:
  - `full_collected`
  - `drained_prefix`
  - `undrained_tail`

The service may implement these as one typed replay request path or as several
explicit helpers, but all replay must:

- load or accept typed persisted bridge artifacts
- derive replay material only through `OrchestratorBridgeArtifactManager`
- route replay only through `RuntimeBridgeRunner.run_replay_batch(...)`
- avoid rebuilding replay ingress manually from dicts

`OrchestratorBridgeServiceReplayResult` must preserve at least:

- the replay request
- the typed replay material used
- the nested `RuntimeBridgeReplayResult`
- ordered recorded runtime sink outputs observed during replay

### 4. Typed failure surface
Failure handling must remain conservative and explicit.

Requirements:

`OrchestratorBridgeServiceFailure` must preserve at least:

- the service operation kind (`live_turn` or `replay`)
- the original exception type/message
- the `TurnContext` when failure came from the live-turn path
- the nested `OrchestratorRuntimeBridgeSessionFailure` when live execution
  halted
- the nested `RuntimeBridgeFailure` when replay halted inside the runtime bridge
- the saved artifact path when artifact persistence succeeded before halt
- the typed replay request and replay material when failure came from replay

Additional requirements:

- if live bridge-session execution halts, surface a typed service failure and
  preserve the nested session failure exactly
- if artifact saving fails after a live success or live halt, surface that
  failure clearly instead of pretending the save succeeded
- if replay halts, stop immediately and preserve the nested
  `RuntimeBridgeFailure`
- do **not** invent retries, rollback, redelivery, or automatic resume

### 5. Dependency and ownership boundaries
The service may own or inject:

- one `OrchestratorRuntimeBridgeSession`
- one `OrchestratorBridgeArtifactManager`
- one `RuntimeBridgeRunner`

But it must not:

- rederive runtime replay semantics itself
- mutate `TurnOrchestrator` internals directly
- bypass public bridge/session/artifact APIs

If shared helpers are needed, keep them bounded to enabling this service shell.

### 6. Minimum test coverage
Add minimum coverage for:

- live-turn success without artifact persistence
- live-turn success with success-artifact persistence
- live-turn halt with failure-artifact persistence
- typed saved-artifact-path reporting
- replay from a saved success artifact
- replay from a saved failure artifact for:
  - `full_collected`
  - `drained_prefix`
  - `undrained_tail`
- preservation of replay slice order into runtime replay ingress
- live-turn halt surfacing nested bridge-session failure
- replay halt surfacing nested `RuntimeBridgeFailure`
- artifact-save failure surfacing a typed service failure rather than fake success
- default dependency path and injected dependency path

Keep tests bounded to this local bridge-service behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing types instead of redefining them:
   - `TurnContext`
   - `RuntimeBridgeRunner`
   - `RuntimeBridgePersistencePolicy`
   - `RuntimeBridgeReplayResult`
   - `RuntimeBridgeFailure`
   - `OrchestratorRuntimeBridgeSession`
   - `OrchestratorRuntimeBridgeSessionResult`
   - `OrchestratorRuntimeBridgeSessionFailure`
   - `OrchestratorBridgeArtifactManager`
   - `PersistedOrchestratorBridgeSessionSuccessEnvelope`
   - `PersistedOrchestratorBridgeSessionFailureEnvelope`
   - `OrchestratorBridgeReplayMaterial`
3. All live turn execution must still route only through
   `OrchestratorRuntimeBridgeSession`.
4. All replay from artifacts must still route only through
   `RuntimeBridgeRunner.run_replay_batch(...)`.
5. Artifact persistence must still route only through
   `OrchestratorBridgeArtifactManager`.
6. Failure handling must remain conservative and non-rollbacking.
7. The service must stay local, in-process, and transport-agnostic.
8. Do **not** introduce event buses, network APIs, adapter logic, database
   logic, remote stores, or external transport schemas.
9. Do **not** redesign `TurnOrchestrator`, `OrchestratorRuntimeBridgeSession`,
   `RuntimeBridgeRunner`, `RuntimeService`, or the bridge-artifact layer.
10. The implementation should be substantial enough to complete one coherent
    local bridge-service slice rather than leaving service-local result/failure
    surfaces or replay-from-artifact coordination as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- event-bus integrations
- websocket/http APIs
- STT/TTS/renderer/VTube adapter work
- database backends
- remote object stores
- replay workers
- automatic replay resume
- automatic redelivery
- after-turn bridge service support
- runtime service redesign
- runtime bridge redesign
- protocol changes
- tool runtime
- plugin or memory integration

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available
   locally, run:
   - `tests/runtime/test_orchestrator_bridge_service.py`
   - `tests/runtime/test_orchestrator_bridge_artifacts.py`
   - `tests/runtime/test_orchestrator_bridge.py`
   - `tests/runtime/test_runtime_bridge.py`
   - `tests/runtime/test_runtime_service.py`
   - `tests/runtime/test_runtime_persistence.py`
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

- `packages/runtime/orchestrator_bridge_service.py` exists
- typed service-local config, result, replay, and failure surfaces exist
- one live-turn service entrypoint exists above `OrchestratorRuntimeBridgeSession`
- live success/failure artifact persistence is coordinated through
  `OrchestratorBridgeArtifactManager`
- one replay-from-artifact service path exists above the bridge-artifact layer
- replay from artifacts routes only through `RuntimeBridgeRunner.run_replay_batch(...)`
- typed saved-artifact-path reporting exists
- typed nested failure surfaces exist for both live-turn halts and replay halts
- no event-bus, network, adapter, database, or external-transport logic was
  implemented
- tests cover the local bridge-service behavior at least minimally
