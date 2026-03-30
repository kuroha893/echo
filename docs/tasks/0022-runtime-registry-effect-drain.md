# Task Card 0022

## Title
Add bounded effect-drain APIs to `packages/runtime/runtime_registry.py`

## Role
Implementer

## Goal
Create the first bounded runtime-side effect-routing step in `packages/runtime/runtime_registry.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/roadmap.md`

This task implements only the smallest registry-level outbox access layer that:

- exposes typed session-scoped runtime effects from already registered sessions
- allows peeking without mutation
- allows draining one session's runtime outbox deterministically

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement a bus, transport, persistence layer, or a global cross-session forwarding order.

---

## Scope Clarification
This card is intentionally limited to the first bounded step of runtime effect routing.

It includes only:

- session-scoped outbox inspection on `RuntimeRegistry`
- session-scoped outbox drain on `RuntimeRegistry`
- focused tests for order preservation and session isolation

This card does **not** authorize:

- actual forwarding to an event bus or transport
- flattening all session outboxes into one global stream
- persistence or replay
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a conservative outer-shell accessor, not a new transport abstraction.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_registry.py`
- `tests/runtime/test_runtime_registry.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/session_runtime.py`
- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/transition_context_tracker.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Session-scoped outbox peek
Add one registry method that peeks the typed runtime outbox for one already-registered session.

Use a clear name such as:

- `peek_session_outbox(session_id)`

Requirements:

- resolve the target session by `session_id`
- reject unknown sessions clearly
- return the target session's runtime outbox without mutating it
- preserve the outbox's existing order

### 2. Session-scoped outbox drain
Add one registry method that drains the typed runtime outbox for one already-registered session.

Use a clear name such as:

- `drain_session_outbox(session_id)`

Requirements:

- resolve the target session by `session_id`
- reject unknown sessions clearly
- return only that session's runtime effects
- clear only that session's runtime outbox
- leave other registered sessions untouched

### 3. Type boundary
Registry-level outbox access must remain typed.

Requirements:

- work with the session runtime's typed emitted events
- do **not** convert events into dicts
- do **not** wrap them in transport frames

For this task, the only expected runtime effect type is the current typed `session.state.changed` event family already emitted by `SessionRuntime`.

### 4. Preserve existing routing behavior
This task must remain additive.

Requirements:

- keep `register_session()` behavior unchanged
- keep `get_session()` behavior unchanged
- keep `ingest_event()` behavior unchanged
- do **not** reimplement session-local outbox semantics in the registry

### 5. No global flattening yet
Do **not** add a global `drain_all_effects()` or equivalent flattened multi-session stream in this task.

Reason:

- cross-session total ordering is not yet specified
- the current bounded step must remain session-scoped and deterministic

### 6. Minimum test coverage
Update `tests/runtime/test_runtime_registry.py` with minimum coverage for:

- `peek_session_outbox(session_id)` returns typed events without clearing the target session outbox
- `drain_session_outbox(session_id)` returns typed events and clears only the target session outbox
- peeking or draining an unknown session fails clearly
- draining one session does not clear another session's outbox
- per-session event order is preserved through registry-level peek/drain
- existing registration and ingest-routing tests still pass unchanged in meaning

Keep the tests bounded to registry behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `RuntimeRegistry`
   - `SessionRuntime`
   - `SessionStateChangedEvent`
3. Registry-level outbox access must stay session-scoped in this task.
4. Unknown-session access must fail clearly.
5. Peek must not mutate state.
6. Drain must clear only the target session outbox.
7. Do **not** introduce event bus integration, persistence, adapter logic, or orchestrator logic.
8. Do **not** return or pass ad-hoc dict payloads.
9. Do **not** invent new event types or forwarding semantics.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- forwarding to a bus, log sink, or transport
- global cross-session flattened effect streams
- session persistence or replay
- auto-create session behavior
- orchestrator changes
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_runtime_registry.py`
   - `tests/runtime/test_session_runtime.py`
   - `tests/runtime/test_state_driver.py`
   - `tests/runtime/test_transition_context_tracker.py`
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

- `RuntimeRegistry` exposes bounded session-scoped outbox peek/drain APIs
- unknown-session access is rejected clearly
- peek does not clear the outbox
- drain clears only the target session outbox
- per-session effect order remains preserved
- existing registration/routing behavior remains intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded effect-drain behavior at least minimally
