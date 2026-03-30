# Task Card 0030

## Title
Implement the runtime persistence storage shell above snapshot and replay foundations

## Role
Implementer

## Goal
Create the first bounded persistence backend / storage adapter shell for the runtime core based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/persistence-replay.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/roadmap.md`

This task should build a typed local persistence shell that can:

- wrap runtime snapshots in versioned persisted envelopes
- wrap replay-ready event sequences in versioned persisted logs
- encode/decode those artifacts deterministically as JSON
- save/load them through a local stdlib-backed file storage shell
- restore a `RuntimeSupervisor` or `RuntimeReplayer` from stored artifacts without bypassing current ownership boundaries

Use **Python 3.10+** and existing local runtime/protocol modules only.

This task intentionally does **not** implement databases, remote storage services, event buses, or adapter integration.

---

## Scope Clarification
This card is intentionally larger than recent runtime shell tasks.

It exists because persistence storage is the first runtime layer that has to compose:

- the snapshot foundation
- the replay foundation
- deterministic serialization rules
- restoration back into supervisor/replayer entrypoints

This card includes only:

- one dedicated persistence/storage module
- versioned persisted snapshot/log/bundle models
- deterministic JSON codec helpers
- a local stdlib-backed filesystem storage shell
- bounded supervisor/replayer persistence delegation
- focused round-trip and restore tests

This card does **not** authorize:

- databases
- network persistence services
- event-bus integration
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a local persistence shell, not full infrastructure.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial** implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **500-1000 lines of non-test Python** across the allowed runtime files is acceptable
- do **not** collapse this card into a thin JSON wrapper or a minimal save/load stub
- do **not** split persisted models, codecs, local file storage, and supervisor/replayer delegation into extra mini-tasks inside this card

The purpose of this section is to keep delivery velocity materially higher while still landing one coherent runtime layer.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/persistence-replay.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/persistence-storage.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/runtime_snapshot.py`
- `packages/runtime/runtime_replay.py`
- `packages/runtime/runtime_supervisor.py`
- `packages/runtime/effect_forwarder.py`
- `packages/runtime/recovery_snapshot.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_persistence.py`
- `packages/runtime/runtime_replay.py`
- `packages/runtime/runtime_supervisor.py`
- `tests/runtime/test_runtime_persistence.py`
- `tests/runtime/test_runtime_replay.py`
- `tests/runtime/test_runtime_supervisor.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/runtime_registry.py`
- do not modify `packages/runtime/session_runtime.py`
- do not modify `packages/runtime/runtime_snapshot.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. New persistence/storage module
Create:

- `packages/runtime/runtime_persistence.py`

It must define at least these runtime-local types:

- `RuntimePersistenceConfig`
- `PersistedRuntimeSnapshotEnvelope`
- `PersistedRuntimeReplayEventRecord`
- `PersistedRuntimeReplayLog`
- `PersistedRuntimeBundle`
- `RuntimeJsonCodec`
- `LocalFilesystemRuntimeStore`
- `RuntimePersistenceError`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for persisted models
- keep these as runtime-local persistence/storage types, not protocol events and not infrastructure-agnostic public schemas

At minimum:

`RuntimePersistenceConfig` must include:

- `snapshot_filename`
- `replay_log_filename`
- `bundle_filename`

`PersistedRuntimeSnapshotEnvelope` must preserve:

- `format_version`
- `saved_at`
- `runtime_snapshot: RuntimeRegistrySnapshot`

`PersistedRuntimeReplayEventRecord` must preserve:

- `sequence_index`
- `event: ProtocolEvent`

`PersistedRuntimeReplayLog` must preserve:

- `format_version`
- ordered event records

`PersistedRuntimeBundle` must preserve:

- one persisted snapshot envelope
- one persisted replay log

### 2. Deterministic JSON codec
`RuntimeJsonCodec` must provide deterministic JSON encode/decode helpers for:

- `PersistedRuntimeSnapshotEnvelope`
- `PersistedRuntimeReplayLog`
- `PersistedRuntimeBundle`

Requirements:

- UTF-8 JSON only
- explicit version validation
- typed decode back into runtime-local persisted models
- typed decoding of nested `ProtocolEvent` records inside replay logs
- no ad-hoc dicts returned from public helpers

Also require:

- unsupported or mismatched format versions fail clearly
- malformed or incomplete payloads fail clearly with typed errors

### 3. Local filesystem storage shell
`LocalFilesystemRuntimeStore` must implement a bounded stdlib-backed file storage shell.

Requirements:

- use only Python stdlib file/path operations
- support saving/loading:
  - snapshot envelope
  - replay log
  - persistence bundle
- keep filename behavior deterministic
- make overwrite behavior explicit
- make missing-file behavior explicit

Recommended surface shape:

- save/load snapshot envelope by path
- save/load replay log by path
- save/load persistence bundle by path

The first implementation may use one-file-per-artifact JSON files.
It does **not** need to implement locking, watchers, or background sync.

### 4. Supervisor persistence delegation
Extend `RuntimeSupervisor` with bounded persistence delegation such as:

- `build_persisted_snapshot(...) -> PersistedRuntimeSnapshotEnvelope`
- `from_persisted_snapshot(...) -> RuntimeSupervisor`

Requirements:

- delegation must build on the existing snapshot foundation
- it must not re-derive session state outside `build_snapshot()`
- restored supervisor must still own a valid `RuntimeRegistry` and `RuntimeEffectForwarder`

If a codec/store object is needed by the design, keep it explicit and injected rather than hidden globally.

### 5. Replayer persistence delegation
Extend `RuntimeReplayer` with bounded persistence delegation such as:

- `build_replay_log(events, ...) -> PersistedRuntimeReplayLog`
- `from_persisted_snapshot(...) -> RuntimeReplayer`
- `from_persisted_bundle(...) -> RuntimeReplayer`
- `replay_persisted_log(...) -> RuntimeReplayResult`

Requirements:

- replay log ordering must preserve caller-provided event order exactly
- persisted replay restoration must still re-enter through current supervisor/replayer entrypoints
- replay of persisted logs must preserve current halt-on-failure semantics

### 6. Round-trip and restore fidelity
The persistence shell must preserve the semantics of the current runtime foundation.

Requirements:

- snapshot envelope round-trip preserves the nested `RuntimeRegistrySnapshot`
- replay log round-trip preserves event order and event typing
- bundle round-trip preserves both snapshot and replay-log content
- restoring a supervisor from stored snapshot material yields equivalent recovery inspection visibility
- restoring a replayer from stored snapshot/bundle material yields equivalent replay behavior

### 7. Minimum test coverage
Update tests with minimum coverage for:

- snapshot envelope JSON encode/decode round-trip
- replay log JSON encode/decode round-trip with multiple typed event kinds
- bundle JSON encode/decode round-trip
- unsupported format version rejection
- malformed stored payload rejection
- local filesystem save/load for snapshot envelope
- local filesystem save/load for replay log
- local filesystem save/load for persistence bundle
- supervisor persisted snapshot build/restore delegation
- replayer replay from persisted snapshot
- replayer replay from persisted bundle/log
- persisted replay still halts conservatively on failure
- existing runtime tests still pass unchanged in meaning

Keep the tests bounded to persistence/storage-shell behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `ProtocolEvent`
   - `RuntimeRegistrySnapshot`
   - `RuntimeSupervisor`
   - `RuntimeReplayer`
   - `RuntimeReplayResult`
   - `RuntimeEffectForwarder`
3. Persisted models for this task must be runtime-local persistence/storage types, not protocol events.
4. JSON codec helpers must decode back into typed persisted models, not raw dicts.
5. Replay-log event ordering must preserve caller-provided order exactly.
6. Restore paths must delegate back into `RuntimeSupervisor.from_snapshot()` and `RuntimeReplayer.from_snapshot()`-style ownership boundaries rather than mutating internals directly.
7. Version validation must be explicit and deterministic.
8. Do **not** introduce databases, remote services, bus forwarding, or adapter logic.
9. Do **not** return or pass ad-hoc dict payloads across public runtime boundaries.
10. The implementation should be substantial enough to complete one coherent persistence/storage layer rather than leaving codec, storage, or restore behavior as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- database backends
- remote object stores
- network APIs
- event-bus integration
- orchestrator integration
- adapter wiring
- compression/encryption
- distributed locking
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime
- replay daemons or worker processes

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
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

- `packages/runtime/runtime_persistence.py` exists
- persisted snapshot/log/bundle models are typed and versioned
- deterministic JSON encode/decode exists for snapshot/log/bundle artifacts
- local filesystem save/load exists for snapshot/log/bundle artifacts
- `RuntimeSupervisor` and `RuntimeReplayer` expose the bounded persistence delegation required by this card
- persisted replay logs preserve event order and typed event reconstruction
- stored snapshot/bundle restoration preserves current runtime ownership semantics
- replay from persisted material remains halt-on-failure and non-rollbacking
- no database, bus, adapter, or orchestrator code was implemented
- tests cover the bounded persistence/storage behavior at least minimally
