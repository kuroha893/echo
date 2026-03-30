# Task Card 0028

## Title
Implement the runtime snapshot export/import foundation across `packages/runtime`

## Role
Implementer

## Goal
Create the first bounded persistence/replay foundation for the runtime core based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/recovery-inspection.md`
- `docs/runtime/supervisor-shell.md`
- `docs/runtime/persistence-replay.md`
- `docs/runtime/roadmap.md`

This task implements a coherent snapshot export/import bundle that:

- captures tracker-owned guard facts
- captures session-owned runtime state
- captures registry-owned multi-session state
- exposes top-level supervisor snapshot delegation

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement a database backend, file format, replay loop, event-log playback service, or external storage adapter.

---

## Scope Clarification
This card is intentionally larger than the recent shell tasks.

It exists because persistence foundations cut across several already-completed runtime primitives:

- `TransitionContextTracker`
- `SessionRuntime`
- `RuntimeRegistry`
- `RuntimeSupervisor`

This card includes only:

- one new runtime-local snapshot model file
- export/import or reconstruction helpers at tracker/session/registry layers
- top-level supervisor snapshot delegation
- focused round-trip tests for runtime-state fidelity

This card does **not** authorize:

- persistence backends
- replay engines
- event-bus integration
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is an in-memory snapshot foundation, not a storage product.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial** implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **300-600 lines of non-test Python** across the allowed runtime files is acceptable
- do **not** reduce this card to a thin serializer stub if the documented snapshot/export/import behavior can be completed now
- do **not** split tracker/session/registry/supervisor snapshot logic into extra mini-tasks inside this card

The purpose of this section is to increase delivery size while keeping the task architecturally coherent.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/recovery-inspection.md`
- `docs/runtime/supervisor-shell.md`
- `docs/runtime/persistence-replay.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/transition_context_tracker.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`
- `packages/runtime/recovery_snapshot.py`
- `packages/runtime/runtime_supervisor.py`

If they already exist, you may also read:

- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_snapshot.py`
- `packages/runtime/transition_context_tracker.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`
- `packages/runtime/runtime_supervisor.py`
- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_runtime_supervisor.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/effect_forwarder.py`
- do not modify `packages/runtime/recovery_snapshot.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. New runtime-local snapshot model file
Create:

- `packages/runtime/runtime_snapshot.py`

It must define at least these runtime-local typed snapshot models:

- `TransitionContextTrackerSnapshot`
- `SessionRuntimeSnapshot`
- `RuntimeRegistrySnapshot`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True`
- keep these as runtime-local types, not protocol events and not persistence-backend schemas

At minimum:

`TransitionContextTrackerSnapshot` must preserve:

- `session_id`
- all boolean guard-fact fields required to rebuild tracker state
- `current_tts_stream_id`
- `current_response_stream_id`
- `pending_tts_counts_by_stream`

`SessionRuntimeSnapshot` must preserve:

- current `SessionState`
- tracker snapshot
- retained blocking error context
- pending runtime outbox effects

`RuntimeRegistrySnapshot` must preserve:

- all session snapshots in stable deterministic order

### 2. Tracker export/import foundation
Extend `TransitionContextTracker` with bounded snapshot helpers such as:

- `build_snapshot() -> TransitionContextTrackerSnapshot`
- `from_snapshot(snapshot) -> TransitionContextTracker`

Requirements:

- exporting must not mutate tracker state
- imported tracker must rebuild equivalent `TransitionContext` values when paired with the same `SessionState`
- `pending_tts_counts_by_stream` counts must remain non-negative

### 3. Session export/import foundation
Extend `SessionRuntime` with bounded snapshot helpers such as:

- `build_snapshot() -> SessionRuntimeSnapshot`
- `from_snapshot(snapshot) -> SessionRuntime`

Requirements:

- export must preserve current `SessionState`
- export must preserve retained error context
- export must preserve pending outbox order
- import must reconstruct an equivalent session-owned runtime shell
- exported/imported session data must remain session-id consistent across nested fields

### 4. Registry export/import foundation
Extend `RuntimeRegistry` with bounded snapshot helpers such as:

- `build_snapshot() -> RuntimeRegistrySnapshot`
- `from_snapshot(snapshot) -> RuntimeRegistry`

Requirements:

- export must preserve all registered session snapshots
- export ordering must be deterministic by `session_id.hex`
- import must reconstruct a registry with equivalent session state, retained errors, and pending outboxes
- import must reject duplicate session ids inside one registry snapshot clearly

### 5. Supervisor snapshot delegation
Extend `RuntimeSupervisor` with bounded snapshot delegation such as:

- `build_snapshot() -> RuntimeRegistrySnapshot`
- `from_snapshot(snapshot, *, effect_forwarder: RuntimeEffectForwarder | None = None) -> RuntimeSupervisor`

Requirements:

- supervisor must delegate to the registry snapshot foundation rather than re-serializing session state itself
- restored supervisor must own a valid registry and forwarder
- snapshot delegation must remain in-process and non-persistent in this task

### 6. Consistency and ownership rules
This task must preserve current ownership boundaries.

Requirements:

- tracker snapshot owns tracker facts only
- session snapshot owns session-local runtime state only
- registry snapshot owns multi-session composition only
- supervisor snapshot delegates over the registry snapshot only
- do not move outbox ownership away from `SessionRuntime`
- do not move retained error ownership away from `SessionRuntime`

### 7. Minimum round-trip test coverage
Update tests with minimum coverage for:

- tracker snapshot round-trip preserves future `build_context()` semantics
- session snapshot round-trip preserves `SessionState`, retained error, and pending outbox order
- registry snapshot round-trip preserves all sessions in stable `session_id.hex` order
- registry snapshot import rejects duplicate session ids clearly
- supervisor snapshot build/restore delegates correctly and restores equivalent recovery inspection visibility
- snapshot export helpers are read-only
- existing runtime tests still pass unchanged in meaning

Keep the tests bounded to snapshot foundation behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionState`
   - `SessionStateChangedEvent`
   - `SystemErrorRaisedEvent`
   - `RuntimeEffectForwarder`
   - `SessionRecoverySnapshot`
3. Snapshot models for this task must be runtime-local typed models, not protocol events.
4. Export helpers must be read-only.
5. Import or reconstruction helpers must rebuild equivalent runtime semantics without bypassing ownership boundaries.
6. Registry snapshot ordering must be deterministic by `session_id.hex`, but must not imply a global time order.
7. Pending runtime outbox effects must be preserved in snapshots; they must not be silently discarded.
8. Do **not** introduce storage backends, file formats, replay loops, bus forwarding, or adapter logic.
9. Do **not** return or pass ad-hoc dict payloads.
10. The implementation should be substantial enough to complete the bounded snapshot foundation in one card rather than leaving key layers as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- database/file persistence backends
- replay workers or replay controllers
- event-log ingestion
- bus integration
- orchestrator integration
- adapter wiring
- compression/encryption
- cross-process locking
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_transition_context_tracker.py`
   - `tests/runtime/test_session_runtime.py`
   - `tests/runtime/test_runtime_registry.py`
   - `tests/runtime/test_runtime_supervisor.py`
   - `tests/runtime/test_state_driver.py`
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

- `packages/runtime/runtime_snapshot.py` exists
- tracker/session/registry snapshot models are typed and complete enough to rebuild equivalent runtime state
- `TransitionContextTracker`, `SessionRuntime`, `RuntimeRegistry`, and `RuntimeSupervisor` all expose the bounded snapshot helpers required by this card
- snapshot round-trips preserve tracker facts, session state, retained errors, and pending outbox ordering
- duplicate session ids in a registry snapshot are rejected clearly
- existing runtime routing/forwarding/recovery semantics remain intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded snapshot foundation behavior at least minimally
