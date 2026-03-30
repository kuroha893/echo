# Task Card 0026

## Title
Implement bounded runtime recovery inspection across `packages/runtime`

## Role
Implementer

## Goal
Create the first bounded runtime recovery-inspection layer based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/reset-recovery.md`
- `docs/runtime/recovery-inspection.md`
- `docs/runtime/roadmap.md`

This task implements a small but complete typed inspection surface that:

- builds a typed recovery snapshot for one `SessionRuntime`
- exposes the current retained blocking error context together with current session status
- exposes stable multi-session enumeration of those recovery snapshots from `RuntimeRegistry`

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement automatic recovery, registry-side reset commands, persistence, event-bus forwarding, or adapter behavior.

---

## Scope Clarification
This card is intentionally larger than the last few micro-steps, but it is still one coherent runtime surface.

It includes only:

- one small runtime-local recovery snapshot model file
- one session-level snapshot builder
- one registry-level single-session inspection helper
- one registry-level multi-session inspection helper
- focused tests for typing, stable ordering, and non-mutating behavior

This card does **not** authorize:

- changes to protocol event schemas
- changes to `SessionState`
- automatic reset or recovery actions
- event bus integration
- persistence or replay
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is typed inspection, not recovery policy.

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
- `docs/runtime/reset-recovery.md`
- `docs/runtime/recovery-inspection.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`

If they already exist, you may also read:

- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/recovery_snapshot.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_runtime_registry.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/transition_context_tracker.py`
- do not modify `packages/runtime/effect_forwarder.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Runtime-local recovery snapshot model
Create one small typed runtime-local model file:

- `packages/runtime/recovery_snapshot.py`

It must define at least:

- `SessionRecoverySnapshot`

At minimum the snapshot must contain:

- `session_id`
- current `SessionStatus`
- retained blocking error context as `SystemErrorRaisedEvent | None`

If you add a runtime-local base model, use **Pydantic v2** style with:

- `extra="forbid"`
- `frozen=True`

This snapshot is runtime-local.
It is not a protocol event and not a persistence schema.

### 2. Session-level inspection helper
Extend `SessionRuntime` with one bounded inspection method such as:

- `build_recovery_snapshot() -> SessionRecoverySnapshot`

Requirements:

- use current authoritative `SessionState.status`
- use current retained error context from `get_retained_error()`
- return a fully typed snapshot
- not mutate session state
- not mutate retained error state
- not mutate outbox contents

### 3. Registry single-session inspection helper
Extend `RuntimeRegistry` with one bounded single-session inspection helper such as:

- `get_recovery_snapshot(session_id) -> SessionRecoverySnapshot`

Requirements:

- fail clearly for unknown session ids
- delegate to the owned `SessionRuntime`
- not re-derive recovery state independently in the registry

### 4. Registry multi-session inspection helper
Extend `RuntimeRegistry` with one bounded multi-session inspection helper such as:

- `peek_recovery_snapshots() -> tuple[SessionRecoverySnapshot, ...]`

Requirements:

- include all currently registered sessions
- preserve stable deterministic order by `session_id.hex`
- delegate to session-local snapshot building
- not mutate any session state
- not mutate any retained error state
- not mutate any outbox contents

### 5. Preserve current ownership rules
This task must remain additive.

Requirements:

- retained error state remains owned by `SessionRuntime`
- `RuntimeRegistry` remains an inspection/router shell, not a recovery supervisor
- no new runtime outbox effect family is introduced
- no current ingest or forwarding semantics are changed

### 6. Minimum test coverage
Update tests with minimum coverage for:

- `SessionRuntime.build_recovery_snapshot()` reflects current `status` and retained error
- a session with no retained error yields `retained_error is None`
- a session with a retained blocking error yields that exact typed error in the snapshot
- `RuntimeRegistry.get_recovery_snapshot(session_id)` delegates correctly and fails clearly for unknown sessions
- `RuntimeRegistry.peek_recovery_snapshots()` returns all registered sessions in `session_id.hex` order
- registry-level inspection is read-only and does not clear outboxes or retained errors
- existing runtime session/registry tests still pass unchanged in meaning

Keep the tests bounded to recovery inspection behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionRuntime`
   - `RuntimeRegistry`
   - `SessionStatus`
   - `SystemErrorRaisedEvent`
3. Recovery snapshots for this task must be runtime-local typed models, not protocol events.
4. Registry inspection helpers must delegate to session-owned state instead of re-deriving it.
5. `peek_recovery_snapshots()` ordering must be deterministic by `session_id.hex`, but must not imply a global temporal order.
6. Inspection must be read-only.
7. Do **not** introduce automatic recovery logic, persistence, bus forwarding, or adapter logic.
8. Do **not** return or pass ad-hoc dict payloads.
9. Do **not** invent new event types or new protocol semantics.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- auto-recovery
- registry-level reset commands
- registry-level retained-error mutation
- persistence of recovery snapshots
- multi-error history
- supervisor coordination
- event bus forwarding of recovery snapshots
- orchestrator changes
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_session_runtime.py`
   - `tests/runtime/test_runtime_registry.py`
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

- `packages/runtime/recovery_snapshot.py` exists
- `SessionRuntime` can build a typed recovery snapshot
- `RuntimeRegistry` exposes bounded session-level and multi-session recovery inspection helpers
- multi-session inspection order is stable by `session_id.hex`
- recovery inspection does not mutate state, retained errors, or outboxes
- existing runtime ingest/forwarding behavior remains intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded recovery-inspection behavior at least minimally
