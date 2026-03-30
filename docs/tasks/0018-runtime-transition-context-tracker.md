# Task Card 0018

## Title
Implement `packages/runtime/transition_context_tracker.py`

## Role
Implementer

## Goal
Create the first bounded runtime-side transition-context tracker in `packages/runtime/transition_context_tracker.py` based on:

- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/governance/ai-engineering-constitution.md`

This task implements only the minimal runtime helper that:

- owns session-local guard-context facts
- updates those facts from typed protocol events
- builds a typed `TransitionContext` snapshot for the state machine

Use **Python 3.10+** and existing protocol/runtime modules.

This task is intentionally **not** a full session manager and does **not** yet integrate adapters.

---

## Scope Clarification
This card is intentionally limited to the missing layer between:

- protocol events
- `TransitionContext`
- the existing `SessionRuntime` / `state_driver`

It includes only:

- a session-owned transition-context tracker
- bounded event-to-context update logic
- hidden internal counters/flags as needed to derive the public `TransitionContext`
- unit tests for deterministic context tracking

This card does **not** authorize:

- changes to protocol schemas
- orchestrator changes
- event bus integration
- session persistence
- STT / TTS / renderer adapter work
- tool-loop runtime execution
- memory / plugin integration

The target is a clean tracker that later runtime tasks can compose into `SessionRuntime` without inventing hidden state rules.

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
- `packages/runtime/session_runtime.py`

If they already exist, you may also read:

- `packages/runtime/transition_context_tracker.py`
- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_session_runtime.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/transition_context_tracker.py`
- `tests/runtime/test_transition_context_tracker.py`

If a directory does not exist, you may create:

- `packages/runtime/`
- `tests/runtime/`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/session_runtime.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Session-owned context tracker
Implement a small session-owned tracker in `packages/runtime/transition_context_tracker.py`.

At minimum it must:

- bind to one authoritative `session_id`
- accept typed `ProtocolEvent` updates for that session
- expose a method that builds a typed `TransitionContext`

You may choose concise names such as:

- `TransitionContextTracker`
- `apply_event()`
- `build_context()`

Keep the API small and typed.

### 2. Public snapshot API
The tracker must be able to build a `TransitionContext` using:

- the current `SessionState.status`
- the current `SessionState.current_trace_id`
- the tracker’s own session-local observable flags

The public `TransitionContext` must contain the required state-machine fields:

- `session_id`
- `current_status`
- `active_trace_id`
- `has_active_user_input`
- `has_finalized_user_utterance`
- `has_active_tts_playback`
- `has_pending_tts_chunks`
- `has_active_reasoning_task`
- `has_pending_interrupt`
- `current_tts_stream_id`
- `current_response_stream_id`

### 3. Bounded event update rules
The tracker must support deterministic updates for at least the following event families:

- `user.speech.start`
- `user.speech.partial`
- `user.speech.end`
- `assistant.response.chunk`
- `assistant.response.completed`
- `tts.chunk.queued`
- `tts.playback.started`
- `tts.chunk.finished`
- `tts.playback.finished`
- `system.interrupt.signal`
- `system.interrupt.applied`
- `system.reset.requested`

For these events, implement at least the following bounded effects:

#### User input events
- `user.speech.start` / `user.speech.partial`
  - `has_active_user_input = True`
  - `has_finalized_user_utterance = False`
- `user.speech.end`
  - `has_active_user_input = False`
  - `has_finalized_user_utterance = True`
  - `has_active_reasoning_task = True`

#### Primary response events
- `assistant.response.chunk`
  - `has_active_reasoning_task = True`
  - `current_response_stream_id = payload.response_stream_id`
- `assistant.response.completed`
  - `has_active_reasoning_task = False`
  - `current_response_stream_id = payload.response_stream_id`
  - `has_finalized_user_utterance = False`

#### TTS queue/playback events
- `tts.chunk.queued`
  - increment an internal pending-TTS counter
  - `current_tts_stream_id = payload.tts_stream_id`
- `tts.playback.started`
  - `has_active_tts_playback = True`
  - `current_tts_stream_id = payload.tts_stream_id`
- `tts.chunk.finished`
  - decrement the internal pending-TTS counter without going below zero
- `tts.playback.finished`
  - `has_active_tts_playback = False`
  - clear pending-TTS count for that finished stream in this bounded tracker
  - `current_tts_stream_id = None`

#### Interrupt / reset events
- `system.interrupt.signal`
  - `has_pending_interrupt = True`
- `system.interrupt.applied`
  - `has_pending_interrupt = False`
  - if `payload.playback_stopped == True`, clear active playback / current TTS stream
  - if `payload.pending_tts_cleared == True`, clear pending-TTS count
  - if `payload.reasoning_cancelled == True`, set `has_active_reasoning_task = False`
  - if `payload.new_user_input_active == True`, set:
    - `has_active_user_input = True`
    - `has_finalized_user_utterance = False`
- `system.reset.requested`
  - always clear `has_pending_interrupt`
  - if `payload.drop_pending_output == True`, clear:
    - active playback
    - pending TTS count
    - current TTS stream id
    - active reasoning task
    - current response stream id
  - if `payload.drop_pending_input == True`, clear:
    - active user input
    - finalized user utterance

### 4. Safe no-op behavior
For protocol events outside the bounded mapping above, the tracker must safely no-op.

At minimum:

- no exception for ordinary unmapped event families
- no mutation for `session.state.changed`

### 5. Session ownership safety
The tracker must reject cross-session contamination.

If an event for a different `session_id` is passed in, fail clearly instead of silently mutating the wrong tracker.

### 6. Minimum test coverage
Create `tests/runtime/test_transition_context_tracker.py` with minimum unit coverage for:

- `user.speech.start` and `user.speech.partial` set active input
- `user.speech.end` sets finalized utterance and active reasoning
- `assistant.response.chunk` sets current response stream id
- `assistant.response.completed` clears active reasoning and finalized utterance
- `tts.chunk.queued` sets pending TTS truth and current TTS stream id
- `tts.chunk.finished` decrements pending count without going negative
- `tts.playback.started` / `tts.playback.finished` toggle active playback truth
- `system.interrupt.signal` sets pending interrupt
- `system.interrupt.applied` clears pending interrupt and applies bounded payload-driven cleanup
- `system.reset.requested` clears input/output flags according to payload booleans
- `session.state.changed` is ignored safely
- cross-session event is rejected clearly
- `build_context()` returns a typed `TransitionContext` using `SessionState.status` and `SessionState.current_trace_id`

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. The tracker must remain session-owned.
2. `TransitionContext` must be derived from observable protocol facts, not hidden ad-hoc runtime guesses.
3. Hidden internal counters are allowed only to derive public context fields deterministically.
4. Unmapped events must not corrupt tracker state.
5. This task must remain a local runtime helper, not a hidden session manager or event bus.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Any new typed model in this task must use **Pydantic v2** style with:
   - `extra="forbid"`
   - `frozen=True`
3. Reuse existing protocol/runtime types instead of redefining them:
   - `ProtocolEvent`
   - `SessionState`
   - `TransitionContext`
4. Do **not** return or pass ad-hoc dict payloads.
5. Do **not** invent new session states, event types, or transition rules.
6. Do **not** modify `TransitionContext` schema.
7. Do **not** implement event bus integration, persistence, or adapter logic.
8. Do **not** derive `current_status` from anything other than the provided `SessionState`.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- modifying `SessionRuntime` to use this tracker
- orchestrator changes
- event bus integration
- session persistence
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool-calling runtime execution

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
   - `tests/runtime/test_transition_context_tracker.py`
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

- `packages/runtime/transition_context_tracker.py` exists
- it can update session-local guard facts from typed protocol events
- it can build a typed `TransitionContext` from a `SessionState`
- cross-session events are rejected clearly
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded transition-context tracking behavior at least minimally
