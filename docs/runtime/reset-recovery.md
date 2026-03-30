# Runtime Reset And Recovery

## Purpose

This document defines the next bounded runtime layer after local effect forwarding:

- session-local retained error context
- explicit reset-driven clearing of that retained context

It exists because the protocol and state machine already define:

- `system.error.raised`
- `system.reset.requested`
- `error -> idle` recovery through explicit reset

and the state-machine spec explicitly requires that entering `error` retain internal error context for diagnostics.

Runtime therefore needs a small session-owned recovery shell before any larger persistence or supervisor work begins.

---

## Position In The Stack

The reset/recovery layer sits inside `SessionRuntime`.

It is above:

- `state_driver.apply_event()`
- `TransitionContextTracker`

and below any future:

- persistence of error context
- cross-session recovery coordination
- external supervision or operator tooling

Its job is narrow:

- retain the latest session-blocking error context for one session
- expose that retained context through a typed accessor
- clear the retained context when an explicit reset request arrives

---

## Why This Belongs In Runtime

The constitution gives `packages/runtime` ownership of:

- lifecycle
- session management
- event intake and forwarding
- state switching

A retained error context is session-owned runtime state.

It is not:

- a protocol schema change
- an orchestrator concern
- an adapter concern
- a persistence concern

That makes `SessionRuntime` the correct first home for this logic.

---

## Minimal Retained Error Contract

The first bounded reset/recovery step should keep only one retained diagnostic value:

- the latest session-blocking `SystemErrorRaisedEvent`

This may be stored directly as the typed protocol event.
The first task does not need a separate persistence model or history list.

The shell should expose a bounded accessor such as:

- `get_retained_error() -> SystemErrorRaisedEvent | None`

---

## Retention Rules

The session runtime should retain error context only when:

- the observed event is `SystemErrorRaisedEvent`
- `payload.is_session_blocking` is `True`

It should not retain context for:

- harmless warnings
- non-blocking errors
- unrelated protocol events

If a later session-blocking `SystemErrorRaisedEvent` arrives, it may replace the previously retained one.

This is intentionally the smallest useful rule.
It is not a historical error ledger.

---

## Reset Clearing Rule

When `SessionRuntime` observes `SystemResetRequestedEvent`, it should clear the retained error context.

This clearing rule is intentionally simple:

- explicit reset means the prior blocking error context is being discarded for session-local recovery purposes

The first bounded task does not need to wait for persistence confirmation, operator acknowledgement, or cross-session coordination.

---

## Interaction With State Application

Retained error context must not replace canonical state application.

The boundaries stay:

- session status still changes only through `apply_event()`
- `session.state.changed` remains the only runtime outbox effect family
- retained error context is runtime-local diagnostic state only

That means the reset/recovery shell must not:

- emit new protocol events on its own
- rewrite state-machine rules
- bypass `apply_event()`

---

## Interaction With Outbox Semantics

Reset/recovery context is not part of the current runtime outbox.

Therefore the first bounded task must not:

- clear previously emitted runtime effects
- mutate registry-level effect batches
- drop pending `session.state.changed` effects

Outbox history and retained diagnostic context are separate concerns.

---

## Non-Goals

This document does not define:

- persistence of retained errors
- multi-error history
- global runtime supervisor recovery
- session auto-removal
- event bus error forwarding
- adapter shutdown procedures
- operator UI or debugging endpoints

Those belong to later runtime or integration docs.

---

## Recommended First Task Shape

The smallest safe implementation step after this doc is:

- extend `packages/runtime/session_runtime.py`
- extend `tests/runtime/test_session_runtime.py`

with:

- one retained-error field
- one accessor
- bounded observe-time retention/clearing logic

This should remain additive and session-local.

That first bounded step is now complete.

The next bounded layer after it is documented in:

- [recovery-inspection.md](/C:/Users/123/Desktop/echo/docs/runtime/recovery-inspection.md)
