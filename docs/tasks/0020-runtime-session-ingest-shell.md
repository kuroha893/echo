# Task Card 0020

## Title
Implement bounded context-free ingest in `packages/runtime/session_runtime.py`

## Role
Implementer

## Goal
Create the next bounded runtime-core step in `packages/runtime/session_runtime.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/transition-context-tracker.md`
- `docs/runtime/roadmap.md`

This task implements only the smallest session-facing ingest helper that:

- accepts one typed `ProtocolEvent`
- updates the owned `TransitionContextTracker`
- builds a typed `TransitionContext` from the owned `SessionState`
- delegates canonical state application to the existing explicit ingest/state-driver path

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** create a multi-session runtime router, event bus, or persistence layer.

---

## Scope Clarification
This card is intentionally limited to the first half of runtime roadmap Phase 2.

It includes only:

- one bounded context-free ingest helper on `SessionRuntime`
- reuse of the already completed tracker ownership and explicit ingest path
- focused tests proving the observation -> context build -> state application order

This card does **not** authorize:

- replacing the existing explicit `ingest_event(event, context)` API
- multi-session runtime registry or router work
- event bus integration
- session persistence
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a session-local ingress helper, not a full runtime shell redesign.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/transition-context-tracker.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/state_driver.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/transition_context_tracker.py`

If they already exist, you may also read:

- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_transition_context_tracker.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/session_runtime.py`
- `tests/runtime/test_session_runtime.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/transition_context_tracker.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Context-free session ingest helper
Add one new typed helper on `SessionRuntime` that lets callers ingest a `ProtocolEvent`
without handcrafting `TransitionContext`.

Use a clear name such as:

- `ingest_observed_event()`
- `ingest_with_tracked_context()`

Keep the public surface small and typed.

### 2. Required ingest order
The new helper must perform these steps in order:

1. validate session ownership
2. update the owned tracker from the incoming event
3. build a fresh typed `TransitionContext` from current owned state
4. delegate actual state application to the existing explicit path

The helper must not skip the tracker step and must not bypass the existing state-application path.

### 3. Delegation rule
The new helper must reuse the existing explicit ingest logic rather than reimplement transition handling.

At minimum:

- it may call `observe_event()`
- it may call `build_context()`
- it should then delegate to `ingest_event(event, context)`

Do **not** duplicate `apply_event()` logic in a second place.

### 4. State / outbox behavior
The new helper must preserve current runtime semantics:

- successful transitions update owned `SessionState`
- successful transitions enqueue exactly the emitted typed runtime effect
- no-transition events leave state unchanged and enqueue nothing
- tracker facts still update even if the event produces no state transition

### 5. Preserve existing explicit API
This task must remain additive.

Requirements:

- keep `ingest_event(event, context)` available and behaviorally unchanged
- keep `observe_event()` available
- keep `build_context()` available
- do **not** force all callers to switch in this task

### 6. Safe handling for effect events
The new helper must safely handle events that should not cause a state transition, including:

- `session.state.changed`
- ordinary unmapped or no-transition protocol events already covered by current runtime logic

Tracker and state behavior must stay deterministic and bounded.

### 7. Minimum test coverage
Update `tests/runtime/test_session_runtime.py` with minimum coverage for:

- new context-free ingest helper updates tracker then applies transition successfully for a legal event
- legal context-free ingest updates owned state and enqueues exactly one `session.state.changed`
- no-transition context-free ingest leaves state unchanged but still preserves tracker-observed facts when applicable
- `user.speech.start` through the new helper yields derived context showing active user input
- `user.speech.end` through the new helper can transition to `thinking` when the tracker-derived context is sufficient
- `session.state.changed` through the new helper is safely ignored as a trigger
- cross-session event is rejected clearly
- existing explicit `ingest_event(event, context)` tests still pass unchanged in meaning

You may add focused fixtures or helper assertions, but keep the tests bounded to session runtime behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionRuntime`
   - `TransitionContextTracker`
   - `ProtocolEvent`
   - `TransitionContext`
   - `SessionState`
   - `ApplyEventResult`
3. The new helper must be session-owned and reject cross-session contamination clearly.
4. The new helper must observe the event before building context.
5. The new helper must delegate actual transition application through existing runtime/state-driver logic.
6. `ingest_event(event, context)` must remain available and behaviorally unchanged.
7. Do **not** introduce event bus integration, persistence, adapter logic, or orchestrator logic.
8. Do **not** return or pass ad-hoc dict payloads.
9. Do **not** invent new session states, event types, or transition rules.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- removing the explicit-context ingest API
- multi-session runtime registry or router
- runtime effect forwarding or bus integration
- session persistence or replay
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

- `SessionRuntime` exposes one bounded context-free ingest helper
- that helper performs tracker observation before building context
- that helper delegates state application through the existing explicit runtime path
- successful transitions still update state and emit typed runtime effects correctly
- no-transition cases remain bounded and deterministic
- existing explicit ingest API remains available
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded session-ingest-shell behavior at least minimally
