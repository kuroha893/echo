# Task Card 0029

## Title
Implement the in-process runtime replay shell above `RuntimeSupervisor`

## Role
Implementer

## Goal
Create the first bounded in-process replay layer for the runtime core based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/supervisor-shell.md`
- `docs/runtime/persistence-replay.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/roadmap.md`

This task should build a replay-capable runtime shell that can:

- restore runtime state from an existing snapshot
- replay a deterministic ordered sequence of typed `ProtocolEvent` values
- surface typed replay step/run/failure information
- expose a final runtime snapshot after replay

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement file/database persistence, event-log storage, async workers, or external transport adapters.

---

## Scope Clarification
This card is intentionally larger than the recent helper-level tasks.

It exists because the replay shell is the first runtime layer that meaningfully composes:

- `RuntimeSupervisor`
- `RuntimeRegistrySnapshot`
- runtime-side effect forwarding semantics
- runtime-side recovery inspection

This card includes only:

- one dedicated replay module
- typed replay result/failure models
- one supervisor-owned sequential batch-processing helper
- deterministic replay tests

This card does **not** authorize:

- persistence backends
- replay daemon/workers
- event-bus integration
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is an in-process replay shell, not a storage system.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **substantial** implementation.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **350-650 lines of non-test Python** across the allowed runtime files is acceptable
- do **not** collapse this card into a thin `for event in events` wrapper with minimal typing
- do **not** split replay models, replay execution, and supervisor batch entry into extra mini-tasks inside this card

The purpose of this section is to keep delivery velocity higher while still landing one coherent runtime layer.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/supervisor-shell.md`
- `docs/runtime/persistence-replay.md`
- `docs/runtime/replay-shell.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/runtime_snapshot.py`
- `packages/runtime/recovery_snapshot.py`
- `packages/runtime/runtime_registry.py`
- `packages/runtime/runtime_supervisor.py`
- `packages/runtime/effect_forwarder.py`
- `packages/runtime/session_runtime.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_replay.py`
- `packages/runtime/runtime_supervisor.py`
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

### 1. New replay module
Create:

- `packages/runtime/runtime_replay.py`

It must define at least these runtime-local types:

- `RuntimeReplayConfig`
- `RuntimeReplayStepResult`
- `RuntimeReplayResult`
- `RuntimeReplayFailure`
- `RuntimeReplayHaltedError`
- `RuntimeReplayer`

Requirements:

- use strong typing
- use **Pydantic v2** style with `extra="forbid"` and `frozen=True` for replay models
- keep these as runtime-local types, not protocol events and not persistence-backend schemas

At minimum:

`RuntimeReplayConfig` must expose:

- `capture_step_snapshots`

`RuntimeReplayStepResult` must preserve:

- replayed `event_id`
- replayed `session_id`
- the returned `RuntimeProcessResult`
- optional `post_step_snapshot`

`RuntimeReplayResult` must preserve:

- total input event count
- successful processed step count
- ordered replay step results
- final runtime snapshot

`RuntimeReplayFailure` must preserve:

- failed event index
- failed `event_id`
- failed `session_id`
- completed step count before failure
- partial runtime snapshot captured at halt time
- original exception type/message in a typed form

### 2. Supervisor sequential batch helper
Extend `RuntimeSupervisor` with a bounded sequential batch helper such as:

- `process_events(events) -> tuple[RuntimeProcessResult, ...]`

Requirements:

- it must process events in caller-provided order
- it must delegate to existing `process_event()` semantics
- it must stop on the first exception and surface the original exception
- it must not invent rollback or retry behavior

This helper is meant to become the supervisor-owned batch entrypoint for non-replay callers.

### 3. Replay construction and ownership
`RuntimeReplayer` must support bounded construction patterns such as:

- direct ownership or injection of a `RuntimeSupervisor`
- `from_snapshot(snapshot, *, effect_forwarder=None, config=None)`

Requirements:

- replay shell must own exactly one supervisor instance
- replay shell must not reach into registry/session internals directly
- replay shell must be able to restore a starting runtime state from a `RuntimeRegistrySnapshot`

Also provide read-only delegation helpers such as:

- `build_snapshot()`
- `get_recovery_snapshot(session_id)`
- `peek_recovery_snapshots()`

Those helpers must delegate to the owned supervisor rather than re-deriving state.

### 4. Replay execution
`RuntimeReplayer` must expose a bounded replay method such as:

- `replay_events(events) -> RuntimeReplayResult`

Requirements:

- process events strictly in the input order provided by the caller
- use `RuntimeSupervisor.process_event()` as the canonical per-event entrypoint
- preserve normal runtime routing, forwarding, and recovery semantics
- collect ordered `RuntimeReplayStepResult` values for all successful steps
- produce one final `RuntimeRegistrySnapshot` after the last successful step

If `capture_step_snapshots` is enabled:

- each successful replay step must include a post-step `RuntimeRegistrySnapshot`

If `capture_step_snapshots` is disabled:

- each successful replay step must leave `post_step_snapshot` as `None`

### 5. Conservative replay failure semantics
Replay must halt conservatively on the first exception.

Requirements:

- do **not** rollback successful earlier steps
- do **not** invent compensation behavior
- on failure, raise `RuntimeReplayHaltedError`
- `RuntimeReplayHaltedError` must carry a typed `RuntimeReplayFailure`
- the failure snapshot must reflect the runtime state **at halt time**, not an imagined rolled-back state

This matters because `RuntimeSupervisor.process_event()` may already have applied state before a later forwarding failure surfaces.

### 6. Minimum test coverage
Update tests with minimum coverage for:

- supervisor `process_events()` success preserves input order
- supervisor `process_events()` stops on first failure and surfaces the original exception
- replay from an injected supervisor works
- replay from a starting `RuntimeRegistrySnapshot` works
- successful replay returns typed ordered step results and final snapshot
- `capture_step_snapshots=False` leaves step snapshots empty
- `capture_step_snapshots=True` captures typed post-step snapshots
- replay halt on routing failure builds typed `RuntimeReplayFailure`
- replay halt on forwarding failure preserves non-rollback semantics
- replay read-only delegation helpers mirror supervisor behavior
- existing runtime tests still pass unchanged in meaning

Keep the tests bounded to replay-shell behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `ProtocolEvent`
   - `RuntimeProcessResult`
   - `RuntimeSupervisor`
   - `RuntimeRegistrySnapshot`
   - `SessionRecoverySnapshot`
   - `RuntimeEffectForwarder`
3. Replay models for this task must be runtime-local typed models, not protocol events.
4. Replay must preserve caller-provided event order exactly.
5. Replay must use `RuntimeSupervisor.process_event()` as the canonical event-processing entrypoint.
6. Failure handling must stop on the first exception and remain non-rollbacking.
7. If step snapshots are captured, they must be typed `RuntimeRegistrySnapshot` values.
8. Do **not** introduce storage backends, replay workers, bus forwarding, or adapter logic.
9. Do **not** return or pass ad-hoc dict payloads.
10. The implementation should be substantial enough to complete one coherent replay layer rather than leaving replay models or failure surfaces as TODO-only placeholders.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- database/file persistence backends
- event-log storage
- replay daemons or background workers
- bus integration
- orchestrator integration
- adapter wiring
- compression/encryption
- cross-process locking
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime
- replay parallelism

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
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

- `packages/runtime/runtime_replay.py` exists
- replay models are typed and complete enough to describe step/run/failure outcomes
- `RuntimeSupervisor` exposes the bounded sequential `process_events()` helper required by this card
- `RuntimeReplayer` can replay events from an injected supervisor or a starting `RuntimeRegistrySnapshot`
- successful replay returns ordered step results and a final runtime snapshot
- replay failure raises a typed halted-error surface with a partial runtime snapshot
- replay remains strictly in-process and does not introduce storage or adapter concerns
- existing runtime routing/forwarding/recovery semantics remain intact
- tests cover the bounded replay behavior at least minimally
