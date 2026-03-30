# Session Runtime

## Purpose

`packages/runtime/session_runtime.py` is the smallest session-owned runtime shell built on top of the state driver.

It owns:

- one authoritative `session_id`
- one current `SessionState`
- one session-local `TransitionContextTracker`
- one runtime outbox of emitted state-change effects
- one session-local retained blocking error context

It does not yet own:

- cross-session routing
- persistence
- bus forwarding

---

## Current Status

Implemented and accepted:

- [session_runtime.py](/C:/Users/123/Desktop/echo/packages/runtime/session_runtime.py)
- [test_session_runtime.py](/C:/Users/123/Desktop/echo/tests/runtime/test_session_runtime.py)

Current API:

- `get_state()`
- `get_retained_error()`
- `build_context()`
- `build_recovery_snapshot()`
- `observe_event()`
- `ingest_observed_event()`
- `peek_outbox()`
- `drain_outbox()`
- `ingest_event(event, context)`

---

## Ownership Rules

Each `SessionRuntime` is bound to one `session_id`.

It must reject:

- events from another `session_id`
- transition contexts from another `session_id`

This prevents hidden cross-session contamination before a larger runtime registry exists.

---

## Ingest Contract

`ingest_event()` currently expects:

- one typed `ProtocolEvent`
- one typed `TransitionContext`

It then:

1. validates session ownership
2. delegates to `apply_event()`
3. updates owned `SessionState`
4. stores any emitted `SessionStateChangedEvent` into ordered outbox

This design is intentionally small and explicit.

`observe_event()` is separate on purpose.
It lets the session runtime update tracker-owned facts from a typed protocol event without:

- mutating `SessionState`
- emitting runtime outbox events
- applying a transition

`build_context()` then combines:

- current authoritative `SessionState`
- tracker-owned observable facts

into one typed `TransitionContext`.

---

## Outbox Contract

The runtime outbox currently stores:

- only typed `SessionStateChangedEvent`

The outbox must:

- preserve emission order
- be observable without mutation via `peek_outbox()`
- be drainable via `drain_outbox()`

It must not yet become:

- a general event bus
- a transport abstraction
- a persistence queue

---

## Current Limitation

The biggest current limitation is that `SessionRuntime` is still only a single-session shell.

Today, it already supports both:

- explicit ingest via `ingest_event(event, context)`
- bounded context-free ingest via `ingest_observed_event(event)`
- session-local recovery snapshot inspection via `build_recovery_snapshot()`

but it still does not provide:

- a unified outer runtime entrypoint
- persistence or replay orchestration

The next runtime layer should provide:

- a composed outer runtime supervisor shell
- later persistence or replay support beyond the session-local shell

Until that exists, `SessionRuntime` should stay deliberately small.

---

## What Must Stay Out

`SessionRuntime` must not absorb:

- state-machine rules
- orchestrator logic
- adapter callbacks
- persistence semantics
- plugin or memory logic

Those boundaries are what keep runtime maintainable as the rest of Echo grows.
