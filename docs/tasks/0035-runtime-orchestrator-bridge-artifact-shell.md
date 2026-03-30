# Task Card 0035

## Title
Implement the persisted orchestrator/runtime bridge-artifact and replay-material shell

## Role
Implementer

## Goal
Create `packages/runtime/orchestrator_bridge_artifacts.py` as the first
persisted artifact layer above the turn-active in-process orchestrator/runtime
bridge session, based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/orchestrator-bridge-session.md`
- `docs/runtime/orchestrator-bridge-artifacts.md`
- `docs/runtime/roadmap.md`

This task should land one coherent bridge-artifact shell that can:

- preserve a full typed `OrchestratorRuntimeBridgeSessionResult`
- preserve a full typed `OrchestratorRuntimeBridgeSessionFailure`
- save and load those artifacts deterministically as local JSON
- derive explicit replay-material views from saved success or failure artifacts
- convert selected replay-material back into a replay-ready
  `RuntimeIngressBatch`, but only through `RuntimeBridgeRunner`

Use **Python 3.10+** and existing local runtime/orchestrator/protocol modules
only.

This task intentionally does **not** implement a bus, websocket/http bridge,
database, remote store, adapter, or automatic resume mechanism.

---

## Scope Clarification
This card builds directly on top of the completed turn-active bridge session in
`packages/runtime/orchestrator_bridge.py`.

The repo already has:

- typed live bridge-session result/failure objects
- deterministic runtime snapshot/replay foundations
- deterministic local runtime persistence primitives

What is still missing is one local artifact layer that can package bridged turn
results and failures into deterministic, replay-friendly artifacts without
redefining runtime or protocol semantics.

This card includes only:

- persisted bridge-session success envelope models
- persisted bridge-session failure envelope models
- typed replay-selection and replay-material models
- deterministic bridge-artifact JSON codec
- stdlib-backed local filesystem store for bridge artifacts
- one bridge-artifact manager/facade that derives replay-ready ingress only
  through `RuntimeBridgeRunner`
- tests for round-trip persistence, ordering preservation, replay selection, and
  explicit failure handling

This card does **not** authorize:

- event buses
- websocket/http APIs
- STT / TTS / renderer / VTube integration
- replay worker loops
- database or remote-object-store backends
- redesign of `RuntimeBridgeRunner`, `RuntimeService`, or `TurnOrchestrator`
- direct mutation of runtime/session internals
- automatic replay resume or redelivery

The target is a persisted artifact shell above the live bridge session, not a
new transport stack.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial**
implementation.

Requirements:

- it is allowed and desired to write **a large amount of non-test code**
- a rough target of **1000-1600 lines of non-test Python** across the allowed
  files is acceptable
- do **not** collapse this card into a thin JSON wrapper or a few save/load
  helpers
- do **not** split envelope models, replay-material models, deterministic codec,
  local store, and bridge-artifact manager into later mini-tasks

The purpose of this section is to keep development tempo high while landing one
meaningful persisted bridge-artifact slice rather than another thin helper.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/external-bridges.md`
- `docs/runtime/orchestrator-bridge-session.md`
- `docs/runtime/orchestrator-bridge-artifacts.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/orchestrator_bridge.py`
- `packages/runtime/runtime_bridge.py`
- `packages/runtime/runtime_service.py`
- `packages/runtime/runtime_persistence.py`
- `packages/runtime/runtime_snapshot.py`

If they already exist, you may also read:

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

Do **not** read STT / TTS / renderer / memory / plugin files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/orchestrator_bridge_artifacts.py`
- `tests/runtime/test_orchestrator_bridge_artifacts.py`

Do **not** create or modify any other file.
In particular:

- do not modify protocol files
- do not modify docs
- do not modify `packages/orchestrator/*`
- do not modify `packages/runtime/orchestrator_bridge.py`
- do not modify `packages/runtime/runtime_bridge.py`
- do not modify `packages/runtime/runtime_service.py`
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Bridge-artifact model family
Create one runtime-local model family in
`packages/runtime/orchestrator_bridge_artifacts.py`, at least equivalent to:

- `OrchestratorBridgeArtifactConfig`
- `PersistedOrchestratorBridgeSessionSuccessEnvelope`
- `PersistedOrchestratorBridgeSessionFailureEnvelope`
- `OrchestratorBridgeReplaySliceKind`
- `OrchestratorBridgeReplaySelection`
- `OrchestratorBridgeReplayMaterial`
- `OrchestratorBridgeArtifactError`
- `OrchestratorBridgeArtifactJsonCodec`
- `LocalFilesystemOrchestratorBridgeArtifactStore`
- `OrchestratorBridgeArtifactManager`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for all
  bridge-local models
- keep these as runtime-local artifact types, not protocol events and not
  transport schemas

At minimum:

`OrchestratorBridgeArtifactConfig` must include explicit bridge-artifact-local
settings for:

- the success artifact format version
- the failure artifact format version
- the default success artifact filename
- the default failure artifact filename
- the default source label to use when deriving replay-ready ingress from saved
  artifacts

### 2. Persisted success and failure envelopes
Implement distinct typed persisted envelopes for bridge-session success and
bridge-session failure.

Requirements:

`PersistedOrchestratorBridgeSessionSuccessEnvelope` must preserve at least:

- format version
- saved-at timestamp
- the full `OrchestratorRuntimeBridgeSessionResult`

`PersistedOrchestratorBridgeSessionFailureEnvelope` must preserve at least:

- format version
- saved-at timestamp
- the full `OrchestratorRuntimeBridgeSessionFailure`

Additional requirements:

- timestamps must be UTC-aware
- format versions must be validated explicitly
- success and failure artifacts must remain distinct schemas
- do **not** flatten success and failure into one ambiguous envelope

### 3. Replay-selection and replay-material surface
Implement one explicit replay-selection and replay-material layer above saved
bridge artifacts.

Requirements:

`OrchestratorBridgeReplaySliceKind` must cover at least:

- `full_collected`
- `drained_prefix`
- `undrained_tail`

`OrchestratorBridgeReplaySelection` must preserve at least:

- which artifact kind was used (`success` or `failure`)
- which replay slice kind was selected
- the selected event count

`OrchestratorBridgeReplayMaterial` must preserve at least:

- the source artifact kind
- the replay selection
- the ordered selected protocol-event slice
- the replay-ready `RuntimeIngressBatch`
- the source `TurnContext`
- the source final or partial runtime snapshot when available

Additional requirements:

- selection from success artifacts must support `full_collected`
- selection from failure artifacts must support:
  - `full_collected`
  - `drained_prefix`
  - `undrained_tail`
- selected event order must exactly match the source artifact order
- replay-material derivation from an empty selected slice must fail clearly
- replay-material must remain an explicit helper, not automatic resume

### 4. Deterministic JSON codec
Implement one deterministic UTF-8 JSON codec dedicated to bridge artifacts.

Requirements:

`OrchestratorBridgeArtifactJsonCodec` must:

- encode success envelopes deterministically
- decode success envelopes back into strong types
- encode failure envelopes deterministically
- decode failure envelopes back into strong types
- reject malformed JSON clearly
- reject non-UTF-8 payloads clearly
- reject unsupported format versions clearly

The codec must return typed models, not raw dicts.

### 5. Local filesystem bridge-artifact store
Implement one stdlib-backed local filesystem store for bridge artifacts.

Requirements:

`LocalFilesystemOrchestratorBridgeArtifactStore` must support:

- deterministic success artifact paths from a directory
- deterministic failure artifact paths from a directory
- save success artifact by directory
- save success artifact by explicit path
- load success artifact by directory
- load success artifact by explicit path
- save failure artifact by directory
- save failure artifact by explicit path
- load failure artifact by directory
- load failure artifact by explicit path

Additional requirements:

- clear overwrite semantics
- clear missing-file semantics
- no background workers, locking, or remote I/O

### 6. Bridge-artifact manager / facade
Implement one bridge-artifact facade above the codec/store that can package
saved bridge results and derive replay-ready ingress.

Requirements:

`OrchestratorBridgeArtifactManager` must at least provide:

- building a success envelope from
  `OrchestratorRuntimeBridgeSessionResult`
- building a failure envelope from
  `OrchestratorRuntimeBridgeSessionFailure`
- save/load delegation for success envelopes
- save/load delegation for failure envelopes
- replay-material derivation from a success envelope
- replay-material derivation from a failure envelope

Critical rule:

- replay-ready ingress must be built only through
  `RuntimeBridgeRunner.build_ingress_batch_from_events(...)`
- do **not** rebuild ingress envelopes or batches manually from dicts
- do **not** bypass `RuntimeBridgeRunner`

The manager may depend on an injected `RuntimeBridgeRunner`, codec, and store,
but it must not redesign them.

### 7. Minimum test coverage
Add minimum coverage for:

- success envelope JSON round-trip
- failure envelope JSON round-trip
- unsupported success/failure format version rejection
- malformed JSON decode failure
- deterministic directory path generation
- explicit path save/load for success artifacts
- explicit path save/load for failure artifacts
- overwrite refusal and missing-file failure
- replay-material selection from a success artifact
- replay-material selection from a failure artifact for:
  - `full_collected`
  - `drained_prefix`
  - `undrained_tail`
- selected replay event order preservation
- explicit failure on empty replay selection
- replay-ready ingress being derived only through `RuntimeBridgeRunner`

Keep tests bounded to persisted bridge artifacts and replay-material behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing types instead of redefining them:
   - `TurnContext`
   - `BaseEvent`
   - `RuntimeIngressBatch`
   - `RuntimeRegistrySnapshot`
   - `RuntimeBridgeRunner`
   - `OrchestratorRuntimeBridgeSessionResult`
   - `OrchestratorRuntimeBridgeSessionFailure`
3. All replay-ready ingress derivation must still route only through
   `RuntimeBridgeRunner.build_ingress_batch_from_events(...)`.
4. Protocol-event selection order must remain exactly deterministic.
5. Success and failure artifacts must remain explicit separate schemas.
6. Failure handling must remain conservative and non-rollbacking.
7. The artifact layer must stay local, in-process, and transport-agnostic.
8. Do **not** introduce event buses, network APIs, adapter logic, database
   logic, remote stores, or external transport schemas.
9. Do **not** mutate or redesign `TurnOrchestrator`, `OrchestratorRuntimeBridge`,
   `OrchestratorRuntimeBridgeSession`, `RuntimeBridgeRunner`, or
   `RuntimeService`.
10. The implementation should be substantial enough to complete one coherent
    bridge-artifact slice rather than leaving envelope models, replay material,
    codec, store, or manager logic as TODO-only placeholders.

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
- after-turn bridge artifact support
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

- `packages/runtime/orchestrator_bridge_artifacts.py` exists
- typed persisted success and failure bridge-artifact envelopes exist
- typed replay-selection and replay-material models exist
- a deterministic JSON codec exists for bridge artifacts
- a stdlib-backed local filesystem store exists for bridge artifacts
- one bridge-artifact manager exists and can derive replay-ready ingress from
  saved artifacts
- replay-ready ingress is built only through
  `RuntimeBridgeRunner.build_ingress_batch_from_events(...)`
- success/failure artifacts preserve exact protocol-event order
- replay selection preserves exact source ordering for the selected slice
- malformed payloads, unsupported versions, empty replay selections, missing
  files, and forbidden overwrites fail clearly
- no event-bus, network, adapter, database, or external-transport logic was
  implemented
- tests cover the persisted bridge-artifact behavior at least minimally
