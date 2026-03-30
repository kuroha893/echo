# Runtime Recovery Inspection

## Purpose

This document defines the first bounded inspection layer on top of runtime reset/recovery state.

It exists because runtime now has a session-local retained error context, but outer runtime layers still lack a typed way to inspect:

- which session currently retains a blocking error context
- what the current session status is alongside that retained error
- the same information across multiple registered sessions

The next bounded step is therefore not automatic recovery.
It is typed inspection.

---

## Position In The Stack

The recovery-inspection layer sits above:

- `SessionRuntime` retained error context
- `RuntimeRegistry` multi-session routing

and below any future:

- supervisor recovery policy
- persistence/replay
- operator tooling
- external event bus integration

Its job is narrow:

- expose one typed recovery snapshot for one session
- expose stable multi-session collection of those snapshots

---

## Why Inspection Comes Next

The state-machine spec requires retained error context for diagnostics.

After that retained context exists, the next practical runtime need is:

- making it inspectable without poking at runtime internals directly

This is useful for later:

- supervisors
- debugging tools
- persistence layers
- runtime-level recovery policies

But it still avoids prematurely implementing any of those larger systems.

---

## Snapshot Shape

The first bounded inspection step should expose one typed runtime-local snapshot such as:

- `SessionRecoverySnapshot`

At minimum it should contain:

- `session_id`
- current `SessionStatus`
- retained blocking error context as `SystemErrorRaisedEvent | None`

This snapshot is runtime-local.
It is not a protocol event and not a persistence schema.

---

## Session-Level Inspection Contract

`SessionRuntime` should expose one bounded accessor such as:

- `build_recovery_snapshot() -> SessionRecoverySnapshot`

Requirements:

- use the current authoritative `SessionState.status`
- use the currently retained error context
- return a fully typed snapshot

It must not:

- mutate runtime state
- clear retained errors
- emit any outbox event

---

## Registry-Level Inspection Contract

`RuntimeRegistry` should expose one bounded multi-session inspection method such as:

- `peek_recovery_snapshots() -> tuple[SessionRecoverySnapshot, ...]`

Requirements:

- include all currently registered sessions
- preserve stable deterministic order by `session_id.hex`
- delegate to the session-local snapshot builder rather than re-deriving session facts itself

This collection rule is only a stable enumeration rule.
It must not be described as a global time order.

---

## Failure And Ownership Rules

The inspection layer must stay read-only.

That means:

- no implicit reset
- no implicit recovery
- no registry-side mutation of session state
- no registry-side mutation of retained error state

Ownership stays:

- `SessionRuntime` owns one session's retained error state
- `RuntimeRegistry` only enumerates session-owned recovery snapshots

---

## Non-Goals

This document does not define:

- auto-recovery
- registry-level reset commands
- persistence of recovery snapshots
- event bus forwarding of recovery snapshots
- adapter shutdown behavior
- operator UI
- cross-process supervision

Those belong to later runtime or integration docs.

---

## Recommended First Task Shape

The smallest useful implementation step after this doc is:

- extend `packages/runtime/session_runtime.py`
- extend `packages/runtime/runtime_registry.py`
- create a small runtime-local snapshot model file if needed
- extend `tests/runtime/test_session_runtime.py`
- extend `tests/runtime/test_runtime_registry.py`

This is intentionally a little larger than the previous micro-steps because session-level and registry-level inspection are one coherent runtime surface.

That first bounded inspection step is now complete.

The next bounded layer after it is documented in:

- [supervisor-shell.md](/C:/Users/123/Desktop/echo/docs/runtime/supervisor-shell.md)
