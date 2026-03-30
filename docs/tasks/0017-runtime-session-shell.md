# Task Card 0017

## Title
Implement `packages/runtime/session_runtime.py`

## Role
Implementer

## Goal
Create the first bounded session-runtime shell in `packages/runtime/session_runtime.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`

This task implements only the minimal runtime shell that:

- owns a current `SessionState`
- accepts typed protocol events at a session boundary
- delegates state application to `packages/runtime/state_driver.py`
- stores emitted `session.state.changed` events in a typed runtime outbox

Use **Python 3.10+** and existing local runtime/protocol modules.

This task is intentionally **not** a full runtime loop or event bus.

---

## Scope Clarification
This card is intentionally limited to the smallest session-facing runtime shell that can sit on top of the completed `state_driver`.

It includes only:

- session-owned current state
- bounded event-ingest method
- bounded typed outbox for runtime-emitted protocol events
- simple read/drain helpers
- unit tests for event ingest and outbox behavior

This card does **not** authorize:

- orchestrator changes
- event bus integration
- session persistence
- STT / TTS / renderer adapter work
- tool-loop runtime execution
- memory / plugin integration
- deriving `TransitionContext` internally from hidden mutable runtime state

The target is a clean session shell that later runtime tasks can connect to richer event-routing and persistence layers.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/state_driver.py`

If they already exist, you may also read:

- `packages/runtime/session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_session_runtime.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/session_runtime.py`
- `tests/runtime/test_session_runtime.py`

If a directory does not exist, you may create:

- `packages/runtime/`
- `tests/runtime/`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/state_driver.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Session runtime shell
Implement a small session-owned runtime shell in `packages/runtime/session_runtime.py`.

At minimum it must expose:

- an initializer that takes an initial `SessionState`
- a way to read the current `SessionState`
- a way to ingest one typed `ProtocolEvent` plus one typed `TransitionContext`
- a way to read or drain emitted runtime protocol events

You may choose concise names such as:

- `SessionRuntime`
- `ingest_event()`
- `get_state()`
- `drain_outbox()`

Keep the API small and typed.

### 2. Event ingest behavior
The ingest path must:

- call `apply_event()` from `packages/runtime/state_driver.py`
- update the owned current state to `ApplyEventResult.next_state`
- if `ApplyEventResult.emitted_event` exists:
  - enqueue/store it in the runtime outbox
- return the `ApplyEventResult`

### 3. Session ownership safety
This shell must remain session-owned.

At minimum:

- the initial state’s `session_id` is the authoritative session for the shell
- events ingested into the shell must belong to that same `session_id`

If an event for a different `session_id` is passed in, fail clearly instead of silently mutating the wrong session shell.

### 4. Outbox behavior
The runtime outbox must be typed and deterministic.

Requirements:

- it must store only typed protocol events
- it must preserve emission order
- it must be drainable without hidden side effects

The outbox may be implemented with a simple in-memory queue/list/deque.
No bus or transport integration is authorized in this task.

### 5. Minimum test coverage
Create `tests/runtime/test_session_runtime.py` with minimum unit coverage for:

- legal ingest updates internal current state
- legal ingest enqueues exactly one `session.state.changed`
- no-transition ingest leaves state unchanged and enqueues nothing
- multiple ingests preserve state across calls
- outbox preserves emission order
- draining the outbox returns emitted events and clears the outbox
- mismatched `session_id` event fails clearly
- the shell never stores non-protocol objects in the outbox path

You may reuse small fixtures for `SessionState`, `TransitionContext`, and protocol events similar to `test_state_driver.py`.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. The runtime shell must delegate transition logic to `apply_event()`, not reimplement state rules.
2. The shell must remain session-owned and reject cross-session contamination.
3. Outbox behavior must be deterministic and replay-friendly.
4. This task must remain a local runtime shell, not a hidden event bus.
5. `TransitionContext` must still be an explicit input; do not invent hidden context derivation logic in this task.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Any new typed model in this task must use **Pydantic v2** style with:
   - `extra="forbid"`
   - `frozen=True`
3. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionState`
   - `ProtocolEvent`
   - `SessionStateChangedEvent`
   - `TransitionContext`
   - `ApplyEventResult`
   - `apply_event()`
4. Do **not** return or pass ad-hoc dict payloads.
5. Do **not** invent new session states, event types, or transition rules.
6. Do **not** implement event bus integration, persistence, or adapter logic.
7. Do **not** derive `TransitionContext` from hidden mutable fields in this task.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- orchestrator changes
- event bus integration
- session persistence
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool-calling runtime execution
- full runtime session manager lifecycle

---

## Do Not
Do not:

- modify any document
- implement runtime adapters
- introduce new dependencies
- install dependencies
- rename documented fields
- replace typed protocol objects with plain dicts
- claim tests passed unless you actually ran them

---

## Execution Protocol
Before editing, follow `AGENTS.md`:

1. State your role as `Implementer`
2. State which files you will read
3. State which files you will modify
4. State which files you will not modify
5. If anything is missing, state it explicitly instead of guessing

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_state_driver.py`
   - `tests/runtime/test_session_runtime.py`
3. If test execution is blocked by missing dependencies or environment limits:
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

- `packages/runtime/session_runtime.py` exists
- it owns current `SessionState` and ingests typed protocol events through `apply_event()`
- successful transitions are retained in a typed runtime outbox
- cross-session events are rejected clearly
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded session-runtime shell behavior at least minimally
