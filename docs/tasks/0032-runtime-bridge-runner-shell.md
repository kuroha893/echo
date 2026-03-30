# Task Card 0032

## Title
Implement the transport-agnostic runtime bridge-runner shell above `RuntimeService`

## Role
Implementer

## Goal
Create the first transport-agnostic bridge-runner shell for the Echo runtime core based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/bridge-service.md`
- `docs/runtime/bridge-runner.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/roadmap.md`

This task should build one runner layer that can:

- accept ingress batches from an explicit source port
- delegate live processing to `RuntimeService`
- delegate replay to `RuntimeService`
- emit typed egress through an explicit sink port
- coordinate optional local persistence around those paths

Use **Python 3.10+** and existing local runtime/protocol/runtime-service modules only.

This task intentionally does **not** implement a real event bus, websocket/http transport, STT/TTS/renderer adapter, or external service API.

---

## Scope Clarification
This card is intentionally larger than the recent runtime tasks.

It exists because the runtime service façade is now in place, and the next coherent layer is not another helper but a coordination shell above it:

- ingress source ports
- egress sink ports
- live execution coordination
- replay execution coordination
- optional persistence coordination

This card includes only:

- one dedicated bridge-runner module
- typed source/sink port protocols
- runner-local result/failure models
- explicit persistence-policy handling
- live batch execution
- replay execution
- recovery-inspection emission

This card does **not** authorize:

- event-bus implementations
- network transports
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a transport-agnostic runner shell, not a real integration.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial** implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **800-1300 lines of non-test Python** across the allowed runtime files is acceptable
- do **not** collapse this card into a thin runner that just forwards one method call to `RuntimeService`
- do **not** split source/sink ports, live execution, replay execution, persistence coordination, and failure surfaces into extra mini-tasks inside this card

The purpose of this section is to preserve the stronger development tempo while still landing one coherent runtime layer.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/bridge-service.md`
- `docs/runtime/bridge-runner.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/runtime_service.py`
- `packages/runtime/runtime_persistence.py`
- `packages/runtime/runtime_replay.py`
- `packages/runtime/runtime_supervisor.py`
- `packages/runtime/runtime_snapshot.py`
- `packages/runtime/recovery_snapshot.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_service.py`
- `tests/runtime/test_runtime_persistence.py`
- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_runtime_registry.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_bridge.py`
- `packages/runtime/runtime_service.py`
- `tests/runtime/test_runtime_bridge.py`
- `tests/runtime/test_runtime_service.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/runtime_persistence.py`
- do not modify `packages/runtime/runtime_replay.py`
- do not modify `packages/runtime/runtime_supervisor.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. New bridge-runner module
Create:

- `packages/runtime/runtime_bridge.py`

It must define at least these runtime-local types:

- `RuntimeBridgeConfig`
- `RuntimeBridgePersistencePolicy`
- `RuntimeBridgeArtifactPaths`
- `RuntimeBridgeReplaySource`
- `RuntimeIngressSourcePort`
- `RuntimeEgressSinkPort`
- `RuntimeBridgeLiveResult`
- `RuntimeBridgeReplayResult`
- `RuntimeBridgeFailure`
- `RuntimeBridgeHaltedError`
- `RuntimeBridgeRunner`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for runner-local models
- keep these as runtime-local coordination/bridge types, not protocol events and not external transport schemas

At minimum:

`RuntimeBridgeConfig` must include:

- explicit booleans or strategy fields for whether to emit recovery inspection after live/replay paths
- explicit booleans or strategy fields for whether to persist ingress batches before processing
- explicit booleans or strategy fields for whether to persist final snapshots after successful processing

`RuntimeBridgePersistencePolicy` must preserve the runner-owned persistence decisions in a typed form.

`RuntimeBridgeArtifactPaths` must preserve explicit optional local paths for:

- one saved ingress-derived replay log
- one saved ingress-derived replay bundle
- one saved final runtime snapshot

`RuntimeBridgeReplaySource` must preserve a typed description of whether replay came from:

- one ingress batch
- one persisted replay log
- one persisted replay bundle

`RuntimeBridgeLiveResult` must preserve:

- the consumed ingress batch
- the ordered process egress envelopes emitted by the runner
- the resulting `RuntimeProcessBatchResult`
- optional emitted recovery inspection envelope
- optional persisted artifact paths produced by the runner path

`RuntimeBridgeReplayResult` must preserve:

- the replay source description
- the resulting `RuntimeReplayEgressEnvelope`
- optional emitted recovery inspection envelope
- optional persisted artifact paths produced by the runner path

`RuntimeBridgeFailure` must preserve:

- which runner path failed
- original exception type/message
- optional failed ingress/replay context
- partial runtime snapshot at halt time when available

### 2. Source and sink port boundaries
Define explicit typed source/sink port protocols or abstract boundaries.

Requirements:

`RuntimeIngressSourcePort` must support bounded pull-style operations for:

- one ingress envelope
- one ingress batch

`RuntimeEgressSinkPort` must support bounded emit-style operations for:

- one `RuntimeProcessEgressEnvelope`
- one `RuntimeProcessBatchResult`
- one `RuntimeReplayEgressEnvelope`
- one `RuntimeRecoveryInspectionEnvelope`

The runner must depend only on these typed ports, not on any concrete bus or network library.

### 3. Live execution runner path
`RuntimeBridgeRunner` must expose bounded live execution helpers such as:

- `run_single_envelope(source, sink, ...)`
- `run_batch(batch, sink, ...)`
- `run_next_batch(source, sink, ...)`

Requirements:

- live ingress order must be preserved exactly
- live execution must delegate to `RuntimeService`
- success path must emit each per-envelope `RuntimeProcessEgressEnvelope` through the sink in the same order as the batch
- after per-envelope emission, success path must emit one `RuntimeProcessBatchResult`
- if configured, the runner must also emit recovery inspection after successful live processing
- if configured, the runner must persist ingress batch and/or final snapshot through the service façade
- the returned `RuntimeBridgeLiveResult` must preserve the same per-envelope emission order seen by the sink

Failure requirements:

- if live processing halts, the runner must raise `RuntimeBridgeHaltedError`
- the error must carry typed `RuntimeBridgeFailure`
- the runner must not invent rollback over already-completed runtime state or sink emissions

### 4. Replay execution runner path
`RuntimeBridgeRunner` must expose bounded replay helpers such as:

- `run_replay_batch(batch, sink, ...)`
- `run_replay_log(log, sink, ...)`
- `run_replay_bundle(bundle, sink, ...)`

Requirements:

- replay order must preserve the provided batch/log order exactly
- replay must delegate to `RuntimeService`
- success path must emit replay egress through the sink
- if configured, the runner must also emit recovery inspection after successful replay
- if configured, the runner may persist replay bundles/logs before replay
- the returned `RuntimeBridgeReplayResult` must preserve the typed replay source description and any produced artifact paths

Failure requirements:

- replay failures must preserve existing halt-on-failure / non-rollback semantics
- runner failure wrapping must remain typed and conservative

### 5. Persistence coordination
The runner must coordinate persistence explicitly through the service façade.

Requirements:

- persistence decisions must come from `RuntimeBridgePersistencePolicy` or explicit method parameters
- the runner must not bypass `RuntimeService` to talk to lower runtime internals
- persisted artifact paths returned by the runner must be explicit and typed where applicable

This coordination should cover at least:

- saving ingress-derived replay logs or bundles
- saving final runtime snapshots after successful paths
- loading persisted bundles/logs for replay paths when those helpers are part of the runner surface

### 6. Recovery-inspection coordination
The runner must coordinate optional recovery inspection emission.

Requirements:

- when configured, it must obtain recovery inspection through `RuntimeService`
- recovery inspection emission must happen after the successful live or replay path it corresponds to
- the sink must receive already-typed inspection envelopes

### 7. Minimum test coverage
Update tests with minimum coverage for:

- source/sink port compatibility with the runner
- live single-envelope runner path
- live batch runner path preserving order
- live batch runner conservative halt behavior
- replay batch runner path
- replay persisted-log runner path
- replay persisted-bundle runner path
- configured recovery-inspection emission
- configured persistence coordination for ingress/final snapshot artifacts
- sink emission ordering for per-envelope live egress, batch result, and optional recovery inspection
- typed runner failure surface
- existing runtime service/persistence/replay tests still pass unchanged in meaning

Keep the tests bounded to runner-shell behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol/service types instead of redefining them:
   - `RuntimeService`
   - `RuntimeIngressEnvelope`
   - `RuntimeIngressBatch`
   - `RuntimeProcessBatchResult`
   - `RuntimeReplayEgressEnvelope`
   - `RuntimeRecoveryInspectionEnvelope`
   - `RuntimeRegistrySnapshot`
3. Runner models for this task must be runtime-local coordination types, not protocol events.
4. Live and replay ordering must preserve caller/source-provided order exactly.
5. All runtime execution must still route through `RuntimeService`.
6. Persistence coordination must still route through `RuntimeService`.
7. Failure handling must remain conservative and non-rollbacking.
8. Do **not** introduce event buses, network APIs, adapter logic, or database logic.
9. Do **not** return or pass ad-hoc dict payloads across public runtime boundaries.
10. The implementation should be substantial enough to complete one coherent runner layer rather than leaving live/replay/persistence coordination as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- event-bus integrations
- websocket/http APIs
- orchestrator integration
- adapter wiring
- database backends
- remote object stores
- compression/encryption
- distributed locking
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime
- background worker pools

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
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

- `packages/runtime/runtime_bridge.py` exists
- typed source/sink port boundaries exist
- `RuntimeBridgeRunner` composes live execution, replay execution, persistence coordination, and recovery-inspection emission in one runner shell
- runner live and replay paths preserve input order and remain conservative on failure
- runner persistence coordination preserves current runtime ownership semantics
- no event-bus, network, adapter, orchestrator, or database code was implemented
- tests cover the bridge-runner behavior at least minimally
