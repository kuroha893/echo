# Transition Context Tracker

## Purpose

The state machine requires a `TransitionContext`, but the current runtime shell does not yet own a way to derive that context from event history.

This document defines the missing layer:

- a session-owned `TransitionContextTracker`
- updated only by typed protocol events
- able to build a fresh `TransitionContext` from current `SessionState`

This is the key bridge between:

- raw event history
- guard evaluation
- `SessionRuntime`

---

## Why It Exists

Without a tracker, the runtime must rely on external callers to handcraft `TransitionContext`.

That is acceptable for early isolated tests, but it is not acceptable as the long-term runtime contract because:

- guard facts would drift outside the runtime package
- different callers could derive different contexts for the same session
- state application would stop being replay-friendly

So the runtime package needs one canonical context tracker.

---

## Owned Facts

The tracker should own only the minimal facts needed to build `TransitionContext`:

- active user input
- finalized user utterance
- active TTS playback
- pending TTS chunk truth
- active reasoning truth
- pending interrupt truth
- current TTS stream id
- current response stream id

It may also keep hidden internal counters when needed, for example:

- pending TTS chunk count

but those internal counters exist only to derive the public `TransitionContext` deterministically.

---

## Event-to-Context Mapping

The tracker should support bounded updates for at least these events:

### User input

- `user.speech.start`
- `user.speech.partial`
- `user.speech.end`

### Primary response

- `assistant.response.chunk`
- `assistant.response.completed`

### TTS queue/playback

- `tts.chunk.queued`
- `tts.playback.started`
- `tts.chunk.finished`
- `tts.playback.finished`

### Interrupt/reset

- `system.interrupt.signal`
- `system.interrupt.applied`
- `system.reset.requested`

These mappings should follow the state-machine guard semantics, not invent runtime-only meanings.

---

## Snapshot Build Rule

`build_context(session_state)` must:

- take `session_state.status` as authoritative `current_status`
- take `session_state.current_trace_id` as authoritative `active_trace_id`
- combine that with tracker-owned facts to build a fresh `TransitionContext`

The tracker must not invent `current_status` on its own.

---

## Session Ownership

The tracker must be session-owned exactly like `SessionRuntime`.

That means:

- one tracker per `session_id`
- reject cross-session events clearly
- never merge event facts across sessions

---

## Safe No-Op Policy

For unmapped events:

- no exception by default
- no mutation by default

For `session.state.changed` specifically:

- it must be ignored as a tracker input

This keeps the tracker narrow and prevents feedback loops.

---

## Relationship to SessionRuntime

The intended next runtime shape is:

1. `SessionRuntime` owns a `TransitionContextTracker`
2. incoming event updates the tracker
3. tracker builds `TransitionContext`
4. `SessionRuntime` calls `apply_event()`
5. emitted `session.state.changed` enters runtime outbox

This is the next important runtime integration step after the current minimal session shell.
