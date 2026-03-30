# Task Card 0021

## Title
Implement `packages/runtime/runtime_registry.py`

## Role
Implementer

## Goal
Create the first bounded multi-session runtime shell in `packages/runtime/runtime_registry.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/roadmap.md`

This task implements only the smallest outer runtime layer that:

- owns multiple `SessionRuntime` instances
- registers them explicitly from typed `SessionState`
- routes a typed `ProtocolEvent` to the correct session by `session_id`
- delegates session-local application to `SessionRuntime.ingest_observed_event()`

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement persistence, effect forwarding, or a message bus.

---

## Scope Clarification
This card is intentionally limited to the first bounded multi-session shell.

It includes only:

- an in-memory runtime registry keyed by `session_id`
- explicit session registration from caller-provided `SessionState`
- bounded event routing into already registered sessions
- focused tests for cross-session isolation and deterministic routing

This card does **not** authorize:

- auto-creating sessions from arbitrary incoming events
- session persistence or replay
- runtime effect forwarding / event bus integration
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a tiny outer shell, not a full runtime supervisor.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/state_driver.py`
- `packages/runtime/transition_context_tracker.py`
- `packages/runtime/session_runtime.py`

If they already exist, you may also read:

- `packages/runtime/runtime_registry.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_runtime_registry.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_registry.py`
- `tests/runtime/test_runtime_registry.py`

If a directory does not exist, you may create:

- `packages/runtime/`
- `tests/runtime/`

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

### 1. Runtime registry shell
Implement a small in-memory registry in `packages/runtime/runtime_registry.py`.

At minimum it must expose a small typed API such as:

- `RuntimeRegistry`
- `register_session(initial_state)`
- `get_session(session_id)`
- `ingest_event(event)`

Keep the surface small and typed.

### 2. Explicit session registration
Session creation must remain explicit in this task.

Requirements:

- registration must take a typed `SessionState`
- registration must create a `SessionRuntime` for that `session_id`
- duplicate registration for the same `session_id` must fail clearly

Do **not** invent default initial state creation from raw `session_id` in this task.

### 3. Event routing behavior
The registry must route one typed `ProtocolEvent` to the correct already-registered session.

Requirements:

- resolve the target by `event.session_id`
- reject unknown `session_id` clearly
- delegate session-local application through `SessionRuntime.ingest_observed_event()`
- return the delegated `ApplyEventResult`

Do **not** reimplement tracker/state-driver logic in the registry.

### 4. Session isolation
The registry must preserve cross-session isolation.

At minimum:

- state changes for one session must not mutate another session
- outbox effects remain session-local to the target `SessionRuntime`
- no hidden shared mutable session facts across entries

### 5. Safe lookup behavior
Provide one bounded inspection path for already-registered sessions.

Examples:

- `get_session(session_id) -> SessionRuntime | None`

Keep lookup behavior simple and deterministic.

### 6. Minimum test coverage
Create `tests/runtime/test_runtime_registry.py` with minimum coverage for:

- explicit registration creates a `SessionRuntime`
- duplicate registration fails clearly
- routing a legal event updates only the correct session
- routing to an unknown `session_id` fails clearly
- two registered sessions remain isolated across multiple routed events
- routed events use the session-local context-free ingest path rather than bypassing `SessionRuntime`
- session-local outbox effects remain attached to the target session shell

You may reuse small fixtures for `SessionState` and protocol events similar to other runtime tests.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionRuntime`
   - `SessionState`
   - `ProtocolEvent`
   - `ApplyEventResult`
3. The registry must remain in-memory and deterministic.
4. Session registration must be explicit; do **not** auto-create from arbitrary events.
5. Event routing must delegate through `SessionRuntime.ingest_observed_event()`.
6. Do **not** introduce event bus integration, persistence, adapter logic, or orchestrator logic.
7. Do **not** return or pass ad-hoc dict payloads.
8. Do **not** invent new session states, event types, or transition rules.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- auto-creating session state from raw `session_id`
- session persistence or replay
- runtime effect forwarding or bus integration
- cross-process runtime coordination
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

- `packages/runtime/runtime_registry.py` exists
- sessions can be registered explicitly from typed `SessionState`
- duplicate registration is rejected clearly
- routed events are delegated to the correct session via `ingest_observed_event()`
- unknown sessions are rejected clearly
- cross-session state and outbox isolation are preserved
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded multi-session registry behavior at least minimally
