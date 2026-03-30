# State Driver

## Purpose

`packages/runtime/state_driver.py` is the minimal runtime-side state application helper.

It exists to answer one question only:

> Given the current `SessionState`, one typed `ProtocolEvent`, and one typed `TransitionContext`, does the canonical state machine accept a transition, and if so what state-effect should be produced?

It is not a session manager and it is not a runtime loop.

---

## Current Status

Implemented and accepted:

- [state_driver.py](/C:/Users/123/Desktop/echo/packages/runtime/state_driver.py)
- [test_state_driver.py](/C:/Users/123/Desktop/echo/tests/runtime/test_state_driver.py)

---

## Public Contract

Current public surface:

- `apply_event(current_state, event, context) -> ApplyEventResult`

`ApplyEventResult` contains:

- `next_state`
- `emitted_event`

where `emitted_event` is either:

- one typed `SessionStateChangedEvent`
- or `None`

---

## Required Behavior

For each call:

1. ignore `session.state.changed` as a trigger
2. call `resolve_transition()`
3. if no valid transition exists:
   - keep state unchanged
   - emit nothing
4. if a valid transition exists:
   - update `SessionState.status`
   - update `SessionState.last_event_id`
   - update `SessionState.updated_at`
   - emit exactly one `SessionStateChangedEvent`

Hidden transitions are forbidden.

---

## Emission Rules

For every successful transition:

- exactly one `session.state.changed` must be emitted
- the payload must be `StateTransition`
- `causation_event_id` must reference the concrete trigger event

The state driver must not:

- emit extra side effects
- perform persistence
- perform adapter logic
- infer additional business semantics beyond the state-machine result

---

## Boundaries

The state driver must stay pure relative to the rest of runtime.

It may depend on:

- protocol event types
- `TransitionContext`
- `resolve_transition()`

It must not depend on:

- orchestrator internals
- adapter callbacks
- hidden mutable runtime globals

---

## Future Relationship to SessionRuntime

`SessionRuntime` should treat the state driver as its canonical transition engine.

That means:

- no duplicate transition logic in `SessionRuntime`
- no parallel “shortcut” state mutations elsewhere in runtime

Any later runtime shell should still funnel canonical status changes through this module.
