# Task Card 0016

## Title
Implement `packages/runtime/state_driver.py`

## Role
Implementer

## Goal
Create the first bounded state-application module in `packages/runtime/state_driver.py` based on:

- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/governance/ai-engineering-constitution.md`

This task implements only the minimal runtime-side state driver that:

- accepts a typed protocol event
- accepts a typed transition guard context
- uses `resolve_transition()` from `packages/protocol/state_machine.py`
- updates canonical `SessionState` when a transition is valid
- emits exactly one typed `session.state.changed` event for each successful transition

Use **Python 3.10+** and existing protocol modules.

This task is intentionally **not** a full runtime/session manager.

---

## Scope Clarification
This card is intentionally limited to the minimal state-application path that the state-machine spec requires.

It includes only:

- a small runtime-local base model if needed
- a bounded state-driver module
- pure application of already-resolved protocol semantics
- tests for transition application and `session.state.changed` emission

This card does **not** authorize:

- orchestrator changes
- event bus integration
- session persistence
- STT / TTS / renderer adapter work
- tool-loop runtime execution
- memory / plugin integration
- redesign of protocol schemas or transition rules

The target is a clean state driver that later runtime tasks can compose into a real session manager.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`

If they already exist, you may also read:

- `packages/runtime/state_driver.py`
- `tests/runtime/test_state_driver.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/state_driver.py`
- `tests/runtime/test_state_driver.py`

If a directory does not exist, you may create:

- `packages/runtime/`
- `tests/runtime/`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/protocol/events.py`
- do not modify `packages/protocol/state_machine.py`
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. State driver module
Implement a runtime-local state driver in `packages/runtime/state_driver.py`.

At minimum it must expose a small public surface that can:

- take a current `SessionState`
- take a `ProtocolEvent`
- take a `TransitionContext`
- decide whether a valid transition exists
- return the next `SessionState`
- optionally return the resulting `SessionStateChangedEvent`

You may choose concise API names such as:

- `apply_event()`
- `apply_transition()`
- `StateDriver`

Keep the API small and typed.

### 2. Transition application behavior
For a valid transition, the driver must:

- call `resolve_transition()`
- update `SessionState.status`
- update `SessionState.last_event_id`
- update `SessionState.updated_at`
- keep existing `SessionState` fields unchanged unless this task explicitly needs them for minimal correctness
- emit exactly one `SessionStateChangedEvent`

The emitted `SessionStateChangedEvent` must:

- use payload `StateTransition`
- set `from_status`
- set `to_status`
- set `reason`
- set `trigger_event_id`

### 3. No-transition behavior
If no valid transition exists:

- return the original `SessionState` unchanged
- emit no `SessionStateChangedEvent`

### 4. Event-envelope requirements
When constructing `SessionStateChangedEvent`, keep the envelope typed and consistent:

- use the input event’s `session_id`
- use the input event’s `trace_id`
- use the input event’s `event_id` as `causation_event_id`
- use a bounded runtime/system source string

Do **not** use ad-hoc dicts.

### 5. Minimum test coverage
Create `tests/runtime/test_state_driver.py` with minimum unit coverage for:

- legal transition updates `SessionState.status`
- legal transition emits exactly one `session.state.changed`
- emitted payload copies `from_status`, `to_status`, `reason`, and `trigger_event_id`
- no-transition input leaves state unchanged and emits `None`
- `session.state.changed` itself does not trigger a new transition
- `system.reset.requested` from `error` returns to `idle`
- `system.error.raised` transitions to `error` when legal
- a self-transition case like `listening + user.speech.partial -> listening` still emits exactly one `session.state.changed`

You may create small test fixtures for `SessionState`, `TransitionContext`, and protocol events.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Transition application must be driven by `resolve_transition()`, not ad-hoc branching.
2. Every successful transition must emit exactly one `session.state.changed`.
3. Hidden transitions are forbidden.
4. `session.state.changed` is an effect, not a trigger.
5. The driver must remain pure state/runtime logic and must not depend on orchestrator internals.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Any new typed model in this task must use **Pydantic v2** style with:
   - `extra="forbid"`
   - `frozen=True`
3. Reuse existing protocol types instead of redefining them:
   - `SessionState`
   - `SessionStateChangedEvent`
   - `StateTransition`
   - `ProtocolEvent`
   - `TransitionContext`
   - `resolve_transition()`
4. Do **not** return or pass ad-hoc dict payloads.
5. Do **not** invent new session states, event types, or transition rules.
6. Do **not** implement persistence, event bus integration, or adapter logic.
7. Do **not** mutate unrelated `SessionState` fields beyond the bounded minimum described above.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- orchestrator changes
- event bus integration
- session persistence
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool-calling runtime execution
- full runtime session manager

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
2. If a working Python interpreter and required dependencies are available locally, run `tests/runtime/test_state_driver.py`
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

- `packages/runtime/state_driver.py` exists
- it can apply typed protocol events through `resolve_transition()`
- successful transitions update `SessionState` and emit exactly one `session.state.changed`
- no-transition cases remain unchanged and emit nothing
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded state-driver behavior at least minimally
