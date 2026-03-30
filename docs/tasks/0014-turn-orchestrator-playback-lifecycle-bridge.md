# Task Card 0014

## Title
Extend `packages/orchestrator/turn_orchestrator.py` with playback-lifecycle bridge

## Role
Implementer

## Goal
Extend the current orchestrator shell so it can consume the already-defined playback lifecycle protocol events and use them to update local orchestrator truth, based on:

- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`

This task is intentionally limited to the **playback-lifecycle bridge inside the orchestrator shell**:

- map playback events to `AudioMutex` snapshot updates
- resolve which logical owner a stream belongs to
- improve quick-reaction finished handling so it is no longer always tied to drafter task completion

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/protocol/events.py`

This task is still **not** TTS adapter/device integration.

---

## Scope Clarification
This card is intentionally limited to the portion of playback truth the orchestrator shell can implement using existing protocol events:

- `tts.playback.started`
- `tts.chunk.started`
- `tts.chunk.finished`
- `tts.playback.finished`

This card includes only:

- active-turn playback ownership resolution inside `TurnOrchestrator`
- event-to-`AudioMutex` bridge methods
- improved `quick_reaction_finished_event` behavior
- focused unit tests

This card does **not** authorize:

- playback device control
- TTS adapter implementation
- event bus integration
- state-machine advancement
- real STT/TTS/renderer adapter work
- redesign of protocol events or `AudioMutex` ownership policy

The target is a clean internal bridge from playback lifecycle events to orchestrator shell state.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`

If it already exists, you may also read:

- `tests/orchestrator/test_turn_orchestrator.py`
- `tests/orchestrator/test_audio_mutex.py`

Do **not** read unrelated runtime / memory / plugin / STT / TTS / renderer files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may modify only:

- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/orchestrator/audio_mutex.py`
- do not modify `packages/orchestrator/expression_parser.py`
- do not modify `packages/protocol/events.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Active turn playback references
Extend `TurnOrchestrator` so that during `handle_user_turn()` it keeps the minimum active-turn references needed to interpret playback lifecycle events.

At minimum this must let the orchestrator know:

- the current `TurnContext`
- the current `quick_reaction_finished_event`

These active-turn references must be restored/cleared safely when the turn exits.

### 2. Stream-to-owner resolution
Add a bounded helper that resolves which logical owner a TTS stream belongs to for the current active turn.

At minimum it must distinguish:

- quick-reaction stream
- primary-response stream
- unknown/non-current stream

Do **not** invent new owners.

### 3. Playback lifecycle bridge methods
Add bounded bridge methods on `TurnOrchestrator` for the already-defined playback events.

At minimum implement:

- a method for `tts.playback.started`
- a method for `tts.chunk.started`
- a method for `tts.chunk.finished`
- a method for `tts.playback.finished`

These methods must:

- accept the typed protocol event objects from `packages/protocol/events.py`
- ignore or safely no-op unknown/non-current streams
- update `AudioMutex` via its existing notify methods where applicable

### 4. Quick-reaction finished behavior
Update the bounded shell so `quick_reaction_finished_event` behaves more truthfully:

- if quick reaction is absent / suppressed / never claimed, it may still be set by the drafter path
- if quick reaction successfully claimed audible playback, do **not** treat drafter task completion alone as equivalent to playback finished
- when the quick-reaction stream receives `tts.playback.finished`, set `quick_reaction_finished_event`

This is still a bounded shell improvement, not the final production playback-truth system.

### 5. Minimum test coverage
Extend `tests/orchestrator/test_turn_orchestrator.py` to cover at least:

- stream-to-owner resolution for current quick stream
- stream-to-owner resolution for current primary stream
- unknown stream resolves safely
- `tts.chunk.started` bridge updates `AudioMutex` playback snapshot for the correct owner
- `tts.chunk.finished` bridge reduces pending-chunk truth through `AudioMutex`
- `tts.playback.finished` bridge clears playback truth through `AudioMutex`
- quick-reaction claim success does **not** prematurely set `quick_reaction_finished_event` on drafter completion alone
- quick-reaction absent/suppressed still leaves `quick_reaction_finished_event` set
- quick-reaction `tts.playback.finished` sets `quick_reaction_finished_event`
- primary `tts.playback.finished` does **not** incorrectly set quick-reaction finished

You may use a test subclass / fake active turn setup to exercise the bridge deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Playback truth inside the orchestrator shell must come from playback lifecycle events, not only task completion.
2. `AudioMutex` remains the owner of playback snapshot truth; the orchestrator bridge only routes lifecycle information into it.
3. Unknown/non-current streams must not corrupt the current turn’s playback truth.
4. Quick-reaction completion must no longer always be equated with drafter task completion once audio ownership was actually claimed.
5. This task must remain inside the orchestrator shell and must not pretend to be real adapter/device playback control.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing protocol event types instead of redefining them:
   - `TTSPlaybackStartedEvent`
   - `TTSPlaybackFinishedEvent`
   - `TTSChunkStartedEvent`
   - `TTSChunkFinishedEvent`
3. Do **not** return or pass ad-hoc dict payloads.
4. Do **not** invent new protocol event types or session states.
5. Do **not** implement playback device control or adapter callbacks beyond the bounded shell methods in this task.
6. Do **not** modify `AudioMutex` ownership policy.
7. Do **not** add STT/TTS/VTube adapter logic.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- TTS adapter/device implementation
- event bus subscription/publishing
- state-machine advancement
- authoritative production playback-truth reconciliation
- STT/VTube adapter work
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
2. If a working Python interpreter and required dependencies are available locally, run `tests/orchestrator/test_turn_orchestrator.py`
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

- `turn_orchestrator.py` has bounded playback-lifecycle bridge methods for the defined playback events
- current-turn stream ownership can be resolved safely
- `AudioMutex` snapshot truth can be updated through those bridge methods
- quick-reaction finished handling is more playback-truthful than pure task completion
- no STT/TTS/VTube/runtime adapter code was implemented
- tests cover the new bounded playback-lifecycle bridge at least minimally
