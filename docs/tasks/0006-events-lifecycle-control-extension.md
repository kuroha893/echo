# Task Card 0006

## Title
Extend `packages/protocol/events.py` with state-machine-critical lifecycle/control events

## Role
Implementer

## Goal
Update `packages/protocol/events.py` so it implements the playback/control event models newly defined in:

- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`

This task exists to close the protocol gap for the state-machine-critical event family:

- `tts.playback.started`
- `tts.playback.finished`
- `assistant.response.completed`
- `system.interrupt.applied`
- `system.error.raised`
- `system.reset.requested`

Use **Python 3.10+ + Pydantic v2**.

This task is protocol-only.
It does **not** implement runtime playback, interrupt application logic, or state-machine behavior.

---

## Scope Clarification

This card is intentionally limited to:

- new playback/control payload models
- new concrete event classes
- `ProtocolEvent` union extension
- focused protocol tests

This card does **not** authorize:

- runtime playback tracking
- orchestrator interrupt reconciliation code
- state transition logic changes
- `tts.chunk.started` / `tts.chunk.finished`
- tool loop implementation

---

## Allowed Context
You may read only:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

Do **not** read `docs/protocol/orchestrator-spec.md` for this task.
The chunk-level playback events belong to a later card.

---

## Files To Create Or Modify
You may modify only:

- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

Do **not** create or modify any other file.

In particular:

- do not modify docs
- do not modify `packages/protocol/state_machine.py`
- do not modify `packages/protocol/feedback_rules.py`
- do not modify orchestrator/runtime files
- do not create `__init__.py`

---

## Required Scope
You must implement the following additions from `docs/protocol/events.md`.

### 1. New payload/data models
- `PlaybackStarted`
- `PlaybackFinished`
- `ResponseCompleted`
- `InterruptApplied`
- `SystemErrorRaised`
- `ResetRequested`

### 2. New concrete events
- `TTSPlaybackStartedEvent`
- `TTSPlaybackFinishedEvent`
- `AssistantResponseCompletedEvent`
- `InterruptAppliedEvent`
- `SystemErrorRaisedEvent`
- `SystemResetRequestedEvent`

### 3. Event union update
- extend `ProtocolEvent` so it can parse all six new event types by `event_type`

### 4. Minimum test coverage
Extend `tests/protocol/test_events.py` to cover at least:

- `PlaybackStarted.chunk_index` and `PlaybackFinished.last_chunk_index` non-negative validation
- `ResponseCompleted(had_output=False)` as a valid model case
- `InterruptApplied` forbidding undeclared wrapper fields
- `SystemErrorRaised.is_session_blocking` being preserved as a required boolean
- `ProtocolEvent` discriminator parsing for at least:
  - one playback lifecycle event
  - one control event

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Strictly use **Pydantic v2**
2. All protocol models must keep:
   - `extra="forbid"`
   - `frozen=True`
3. Do **not** change existing enum values or existing event type strings
4. The new event type strings must match the docs exactly:
   - `tts.playback.started`
   - `tts.playback.finished`
   - `assistant.response.completed`
   - `system.interrupt.applied`
   - `system.error.raised`
   - `system.reset.requested`
5. `assistant.response.completed` must represent response-stream completion, not guaranteed playback completion
6. `system.interrupt.applied` must remain a barrier/completion event, not merely another name for `system.interrupt.signal`
7. Do **not** add new session statuses
8. Do **not** invent extra lifecycle/control event types in this task
9. Keep the change protocol-only; no runtime logic beyond field validation

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- `tts.chunk.started`
- `tts.chunk.finished`
- any `AudioMutex` implementation
- interrupt controller runtime logic
- playback ownership logic
- state-machine guard changes
- tool-calling runtime behavior
- orchestrator async wiring

---

## Do Not
Do not:

- modify any document
- implement runtime or orchestrator code
- introduce new dependencies
- install dependencies
- rename documented fields
- replace typed protocol objects with dataclasses or plain dicts
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
2. If `pydantic v2` is available locally, run `tests/protocol/test_events.py`
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

- `packages/protocol/events.py` implements all six new payload models
- `packages/protocol/events.py` implements all six new concrete event classes
- `ProtocolEvent` can parse the new lifecycle/control events by discriminator
- event type strings exactly match the docs
- no runtime/orchestrator/state-machine behavior was implemented
- tests cover the new protocol surface at least minimally
