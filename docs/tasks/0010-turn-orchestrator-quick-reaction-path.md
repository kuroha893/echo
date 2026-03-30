# Task Card 0010

## Title
Extend `packages/orchestrator/turn_orchestrator.py` with quick-reaction drafter path

## Role
Implementer

## Goal
Extend `packages/orchestrator/turn_orchestrator.py` so it implements the bounded quick-reaction slice of the orchestrator skeleton defined in:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

This task is the counterpart to Task 0009.
It adds only the **local drafter / quick-reaction path**, so that both orchestrator subpaths exist before a later task wires them together.

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/expression_parser.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/protocol/events.py`

This task is intentionally **not** the full turn orchestrator.

---

## Scope Clarification
This card is intentionally limited to the self-contained quick-reaction portion of the `TurnOrchestrator` skeleton:

- `_run_local_drafter()`
- `_generate_quick_reaction()` as a typed boundary method only

This card does **not** authorize:

- `handle_user_turn()`
- `_run_primary_reasoning()`
- provider/model integration
- state-machine integration
- event-bus publishing
- playback-device integration
- tool-loop integration
- redesign of `AudioMutex` or `ExpressionParser`

The target is a clean, testable quick-reaction path that can later be composed into the full dual-track orchestrator.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`
- `packages/orchestrator/expression_parser.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`

If it already exists, you may also read:

- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** read unrelated runtime / memory / plugin / state-machine files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may modify only:

- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/protocol/events.py`
- do not modify `packages/orchestrator/audio_mutex.py`
- do not modify `packages/orchestrator/expression_parser.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following additions from the `TurnOrchestrator` skeleton in `docs/protocol/orchestrator-spec.md`.

### 1. Quick-reaction boundary method
Implement `_generate_quick_reaction()`.

For this task it is a typed boundary method only.
It may remain a no-op placeholder that returns `None`, but it must:

- exist on `TurnOrchestrator`
- be async
- return `QuickReaction | None`

Do **not** add provider logic or hard-coded production content beyond a safe placeholder.

### 2. Local drafter path
Implement `_run_local_drafter()` with the documented responsibilities:

- create an `ExpressionParser`
- call `_generate_quick_reaction(ctx)`
- if result is `None`, exit cleanly
- parse quick-reaction text through `ExpressionParser`
- forward renderer commands to `renderer_command_queue`
- convert clean text into typed `TTSChunk`
- attempt ownership through `AudioMutex.claim_for_quick_reaction()`
- queue quick-reaction TTS only if ownership claim succeeds
- flush parser tail via `end_of_stream()`
- preserve typed `emotion_tags`
- preserve `is_interruptible`
- always set `drafter_done_event` in `finally`
- keep `quick_reaction_finished_event` behavior aligned to the current skeleton comment:
  - set it in this bounded task
  - do not claim that this is the final playback-truth implementation

### 3. Minimum test coverage
Extend `tests/orchestrator/test_turn_orchestrator.py` to cover at least:

- `_generate_quick_reaction()` default boundary behavior is typed and non-crashing
- if quick reaction is `None`, no TTS chunk is queued and `drafter_done_event` is still set
- quick reaction clean text is parsed and submitted through `claim_for_quick_reaction()`
- claim success queues the first quick-reaction TTS chunk
- claim failure does **not** queue the first quick-reaction TTS chunk
- renderer commands from quick reaction are forwarded to `renderer_command_queue`
- parser tail clean text becomes a later quick-reaction `TTSChunk`
- `emotion_tags` and `is_interruptible` are preserved on queued quick-reaction chunks
- `quick_reaction_finished_event` is set in the current bounded implementation
- failure inside `_generate_quick_reaction()` still sets `drafter_done_event` in `finally`

You may use a fake/subclass orchestrator and fake audio mutex to observe calls deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Quick-reaction text must always pass through `ExpressionParser` before TTS submission.
2. Renderer commands must be separated from audible text.
3. `AudioMutex` remains the sole authority for initial quick-reaction audio claim.
4. The first quick-reaction audible chunk must not be queued unless ownership claim succeeds.
5. Parser tail text must not be lost.
6. Quick-reaction path must preserve `emotion_tags` and `is_interruptible` from `QuickReaction` where applicable.
7. This task must not treat `quick_reaction_finished_event` as authoritative playback truth beyond the current bounded placeholder behavior.
8. Drafter failure must not bypass the `finally` cleanup events.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing local types instead of redefining protocol semantics:
   - `QuickReaction`
   - `RendererCommand`
   - `TTSChunk`
   - `ExpressionParser`
   - `AudioMutex`
   - `TurnContext`
3. Do **not** return or pass ad-hoc dict payloads.
4. Do **not** invent new event types, state statuses, or interrupt policies.
5. Do **not** bypass `AudioMutex.claim_for_quick_reaction()` for the first quick-reaction TTS chunk.
6. Do **not** implement actual playback-finished truth logic in this task.
7. Do **not** implement provider/model integration or external calls.
8. Do **not** implement `handle_user_turn()` or dual-track task spawning.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- `handle_user_turn()`
- `_run_primary_reasoning()`
- primary provider streaming
- actual quick-reaction generation backend
- event bus integration
- playback adapter/device code
- state-machine advancement
- tool-calling integration
- authoritative playback-finished reconciliation

---

## Do Not
Do not:

- modify any document
- implement the full orchestrator
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

- `packages/orchestrator/turn_orchestrator.py` implements the bounded quick-reaction path in this card
- quick-reaction text is parser-mediated
- the first quick-reaction chunk is `AudioMutex`-mediated
- queued quick-reaction chunks preserve documented typed fields
- `drafter_done_event` cleanup is reliable
- no full `handle_user_turn()` / provider / runtime wiring was implemented
- tests cover the new quick-reaction path at least minimally
