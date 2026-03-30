# Task Card 0031

## Title
Implement the bridge-ready runtime service shell above supervisor, replay, and local persistence

## Role
Implementer

## Goal
Create the first bridge-ready runtime service shell for the Echo runtime core based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/bridge-service.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/roadmap.md`

This task should build one typed façade that can:

- accept typed ingress envelopes around `ProtocolEvent`
- process one envelope or one ordered ingress batch through the live runtime path
- replay one ingress batch through the replay path
- save/load runtime persistence artifacts through the local persistence store
- emit typed runtime-local egress envelopes suitable for later bridges

Use **Python 3.10+** and existing local runtime/protocol modules only.

This task intentionally does **not** implement a real event bus, websocket/http API, STT/TTS/renderer adapter, or external service integration.

---

## Scope Clarification
This card is intentionally larger than the recent runtime tasks.

It exists because the runtime core now has the internal building blocks but still lacks one coherent façade above them:

- live processing via `RuntimeSupervisor`
- replay via `RuntimeReplayer`
- local save/load via `LocalFilesystemRuntimeStore`
- recovery inspection via existing snapshot helpers

This card includes only:

- one dedicated runtime service module
- typed ingress/egress envelope models
- deterministic JSON codec helpers for those service envelopes
- live batch processing
- replay delegation
- persistence save/load delegation
- recovery inspection delegation

This card does **not** authorize:

- event-bus implementations
- network transports
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a bridge-ready service façade, not an actual external integration.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial** implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **600-1100 lines of non-test Python** across the allowed runtime files is acceptable
- do **not** collapse this card into a thin façade that only forwards 2-3 methods
- do **not** split ingress envelopes, egress envelopes, live batch processing, replay delegation, and persistence delegation into extra mini-tasks inside this card

The purpose of this section is to keep delivery velocity materially higher while still landing one coherent runtime-facing layer.

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
- `docs/runtime/persistence-storage.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/runtime_supervisor.py`
- `packages/runtime/runtime_replay.py`
- `packages/runtime/runtime_persistence.py`
- `packages/runtime/runtime_snapshot.py`
- `packages/runtime/recovery_snapshot.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_persistence.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_service.py`
- `packages/runtime/runtime_persistence.py`
- `packages/runtime/runtime_replay.py`
- `packages/runtime/runtime_supervisor.py`
- `tests/runtime/test_runtime_service.py`
- `tests/runtime/test_runtime_persistence.py`
- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_supervisor.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/runtime_registry.py`
- do not modify `packages/runtime/session_runtime.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. New runtime service module
Create:

- `packages/runtime/runtime_service.py`

It must define at least these runtime-local types:

- `RuntimeServiceConfig`
- `RuntimeIngressEnvelope`
- `RuntimeIngressBatch`
- `RuntimeProcessEgressEnvelope`
- `RuntimeProcessBatchResult`
- `RuntimeReplayEgressEnvelope`
- `RuntimeRecoveryInspectionEnvelope`
- `RuntimeServiceBatchFailure`
- `RuntimeServiceBatchHaltedError`
- `RuntimeServiceJsonCodec`
- `RuntimeService`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for service-local models
- keep these as runtime-local bridge/service types, not protocol events and not external transport schemas

At minimum:

`RuntimeServiceConfig` must include explicit bridge-local settings for:

- ingress format version(s)
- egress format version(s)
- optional default source label(s)

`RuntimeIngressEnvelope` must preserve:

- format version
- received-at timestamp
- source label
- one typed `ProtocolEvent`

`RuntimeIngressBatch` must preserve:

- format version
- ordered ingress envelopes

`RuntimeProcessEgressEnvelope` must preserve:

- format version
- emitted-at timestamp
- touched `session_id`
- one `RuntimeProcessResult`

`RuntimeProcessBatchResult` must preserve:

- total input envelope count
- successful envelope count
- ordered process egress envelopes
- final runtime snapshot

`RuntimeReplayEgressEnvelope` must preserve:

- format version
- emitted-at timestamp
- one `RuntimeReplayResult`

`RuntimeRecoveryInspectionEnvelope` must preserve:

- format version
- emitted-at timestamp
- ordered `SessionRecoverySnapshot` values

`RuntimeServiceBatchFailure` must preserve:

- failed envelope index
- failed event id
- failed session id
- completed envelope count before failure
- partial runtime snapshot at halt time
- original exception type/message in typed form

### 2. Deterministic service JSON codec
`RuntimeServiceJsonCodec` must provide deterministic JSON encode/decode helpers for:

- `RuntimeIngressEnvelope`
- `RuntimeIngressBatch`
- `RuntimeProcessEgressEnvelope`
- `RuntimeProcessBatchResult`
- `RuntimeReplayEgressEnvelope`
- `RuntimeRecoveryInspectionEnvelope`

Requirements:

- UTF-8 JSON only
- explicit version validation
- typed decode back into runtime-local service models
- typed decode of nested `ProtocolEvent` values inside ingress payloads
- no ad-hoc dicts returned from public helpers

### 3. Live processing façade
`RuntimeService` must own or be injected with:

- one `RuntimeSupervisor`
- one `RuntimeReplayer`
- one `LocalFilesystemRuntimeStore`
- one `RuntimeServiceJsonCodec`

It must expose bounded live-processing helpers such as:

- `process_envelope(envelope) -> RuntimeProcessEgressEnvelope`
- `process_batch(batch) -> RuntimeProcessBatchResult`

Requirements:

- live processing must preserve caller-provided ingress order exactly
- each envelope must be processed through the existing supervisor-owned live path
- live batch processing must halt conservatively on first failure
- on live batch failure, raise `RuntimeServiceBatchHaltedError`
- the failure object must preserve a typed partial runtime snapshot
- do **not** invent rollback or retry behavior

### 4. Replay façade
`RuntimeService` must expose bounded replay helpers such as:

- `replay_batch(batch) -> RuntimeReplayEgressEnvelope`
- `replay_persisted_log(...) -> RuntimeReplayEgressEnvelope`
- `replay_persisted_bundle(...) -> RuntimeReplayEgressEnvelope`

Requirements:

- ingress-batch replay must preserve caller-provided envelope order exactly
- replay must still delegate to the existing `RuntimeReplayer`
- replay of persisted material must preserve current halt-on-failure and non-rollback semantics

### 5. Persistence delegation façade
`RuntimeService` must expose bounded persistence helpers such as:

- save current runtime snapshot through the local persistence store
- load runtime snapshot into a fresh or restored service shell
- save replay log or persistence bundle derived from ingress batches
- load replay logs or bundles through the local persistence store

Requirements:

- save/load behavior must remain explicit about paths or configured directories
- persistence delegation must remain built on top of the existing persistence shell
- restore paths must re-enter via existing supervisor/replayer ownership boundaries rather than mutating internals directly

### 6. Recovery inspection façade
`RuntimeService` must expose read-only recovery helpers such as:

- `get_recovery_snapshot(session_id)`
- `peek_recovery_snapshots() -> RuntimeRecoveryInspectionEnvelope`

Requirements:

- the service shell must delegate to existing runtime inspection rather than re-deriving recovery state

### 7. Round-trip and fidelity coverage
Update tests with minimum coverage for:

- ingress envelope JSON round-trip
- ingress batch JSON round-trip preserving order
- process egress envelope JSON round-trip
- live single-envelope processing through the service shell
- live batch processing success preserving order
- live batch failure halting conservatively with typed failure surface
- replay from ingress batch through the service shell
- replay from persisted log through the service shell
- replay from persisted bundle through the service shell
- save/load snapshot delegation through the service shell
- save/load replay log or bundle delegation through the service shell
- recovery inspection envelope generation
- existing runtime tests still pass unchanged in meaning

Keep the tests bounded to bridge-ready service-shell behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `ProtocolEvent`
   - `RuntimeProcessResult`
   - `RuntimeReplayResult`
   - `RuntimeSupervisor`
   - `RuntimeReplayer`
   - `LocalFilesystemRuntimeStore`
   - `SessionRecoverySnapshot`
3. Service models for this task must be runtime-local bridge/service types, not protocol events.
4. JSON codec helpers must decode back into typed service models, not raw dicts.
5. Live and replay batch ordering must preserve caller-provided order exactly.
6. Live processing must route through `RuntimeSupervisor`; replay must route through `RuntimeReplayer`.
7. Persistence save/load must build on the existing local persistence shell.
8. Failure handling must remain conservative and non-rollbacking.
9. Do **not** introduce event buses, network APIs, adapter logic, or database logic.
10. The implementation should be substantial enough to complete one coherent bridge-ready façade rather than leaving live/replay/persistence categories as TODO-only placeholders.

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

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
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

- `packages/runtime/runtime_service.py` exists
- ingress/egress envelope models are typed and versioned
- deterministic JSON encode/decode exists for service envelopes
- `RuntimeService` composes live processing, replay, persistence save/load, and recovery inspection in one façade
- live batch processing preserves order and halts conservatively on failure
- replay batch/log/bundle delegation preserves current replay semantics
- persistence delegation preserves current runtime ownership semantics
- no bus, adapter, orchestrator, or database code was implemented
- tests cover the bridge-ready service-shell behavior at least minimally
