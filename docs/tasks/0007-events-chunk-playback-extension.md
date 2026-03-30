# Task Card 0007

## Title
Extend `packages/protocol/events.py` with chunk playback lifecycle events

## Role
Implementer

## Goal
Update `packages/protocol/events.py` so it implements the chunk playback lifecycle protocol objects newly defined in:

- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`

This task closes the protocol gap for the orchestrator-critical playback events:

- `tts.chunk.started`
- `tts.chunk.finished`

Use **Python 3.10+ + Pydantic v2**.

This task is protocol-only.
It does **not** implement playback tracking, AudioMutex, interrupt handoff logic, or any orchestrator runtime behavior.

---

## Scope Clarification

This card is intentionally limited to:

- new chunk playback payload models
- new concrete event classes
- `ProtocolEvent` union extension
- focused protocol tests

This card does **not** authorize:

- `AudioMutex`
- playback engine integration
- chunk-boundary handoff runtime logic
- interrupt controller logic
- state-machine changes
- tool loop changes

---

## Allowed Context
You may read only:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

Do **not** read `docs/protocol/state-machine.md` for this task unless blocked by a concrete missing type reference.

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
- `ChunkPlaybackStarted`
- `ChunkPlaybackFinished`

### 2. New concrete events
- `TTSChunkStartedEvent`
- `TTSChunkFinishedEvent`

### 3. Event union update
- extend `ProtocolEvent` so it can parse:
  - `tts.chunk.started`
  - `tts.chunk.finished`

### 4. Minimum test coverage
Extend `tests/protocol/test_events.py` to cover at least:

- `ChunkPlaybackStarted.chunk_index` non-negative validation
- `ChunkPlaybackFinished.chunk_index` non-negative validation
- `ChunkPlaybackStarted.is_interruptible` being preserved as a typed boolean
- `ProtocolEvent` discriminator parsing for:
  - one `tts.chunk.started` event
  - one `tts.chunk.finished` event
- undeclared wrapper fields still being forbidden on the new payload models

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Strictly use **Pydantic v2**
2. All protocol models must keep:
   - `extra="forbid"`
   - `frozen=True`
3. Do **not** change existing enum values or existing event type strings
4. The new event type strings must match the docs exactly:
   - `tts.chunk.started`
   - `tts.chunk.finished`
5. `ChunkPlaybackStarted` must preserve:
   - `tts_stream_id`
   - `chunk_index`
   - `is_interruptible`
6. `ChunkPlaybackFinished` must preserve:
   - `tts_stream_id`
   - `chunk_index`
7. Do **not** invent extra chunk playback fields beyond the documented minimum
8. Do **not** add runtime logic, playback ownership behavior, or interrupt policy code
9. Keep the change protocol-only; no business logic beyond validation

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- `AudioMutex`
- `TurnOrchestrator`
- playback progress accounting logic
- `cut_after_chunk` runtime behavior
- queue clearing logic
- `tts.playback.started` / `tts.playback.finished` behavior changes
- renderer/runtime integration
- any async wiring

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

- `packages/protocol/events.py` implements both chunk playback payload models
- `packages/protocol/events.py` implements both concrete chunk playback event classes
- `ProtocolEvent` can parse `tts.chunk.started` and `tts.chunk.finished` by discriminator
- event type strings exactly match the docs
- no runtime/orchestrator behavior was implemented
- tests cover the new protocol surface at least minimally
