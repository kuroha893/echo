# Task Card 0008

## Title
Implement `packages/orchestrator/audio_mutex.py`

## Role
Implementer

## Goal
Create the first implementation of `packages/orchestrator/audio_mutex.py` based on:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

The implementation must cover the v0.1 audio ownership and handoff coordinator used by the orchestrator to arbitrate audible playback.

Use **Python 3.10+** and existing protocol types from `packages/protocol/events.py`.

This task is intentionally limited to the audio mutex layer only.
It does **not** include the full turn orchestrator, playback device integration, queue workers, or async runtime wiring beyond the mutex's own documented methods.

---

## Scope Clarification
This card implements only the self-contained `Audio Mutex` portion defined in `docs/protocol/orchestrator-spec.md`:

- orchestrator-local base model/config
- audio owner enum
- playback snapshot state holder
- audio mutex coordination methods
- deterministic decision outputs for primary-vs-quick handoff
- unit tests for mutex arbitration behavior

This card does **not** authorize the implementer to:

- implement `TurnOrchestrator`
- implement playback engine/device adapters
- emit events directly to a bus
- add renderer, STT, memory, plugin, or tool-loop logic
- redesign protocol/event semantics

The target is a clean, testable coordination module that later orchestrator tasks can import without redefining ownership rules.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`

If they already exist, you may also read:

- `packages/orchestrator/audio_mutex.py`
- `tests/orchestrator/test_audio_mutex.py`

Do **not** read `docs/protocol/state-machine.md` for this task unless blocked by a concrete missing type reference.
Do **not** read unrelated orchestrator/runtime files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/orchestrator/audio_mutex.py`
- `tests/orchestrator/test_audio_mutex.py`

If a directory does not exist, you may create:

- `packages/orchestrator/`
- `tests/orchestrator/`

Do **not** create or modify any other files.
In particular:

- do not modify `packages/protocol/events.py`
- do not modify `packages/orchestrator/expression_parser.py`
- do not create `packages/orchestrator/turn_orchestrator.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following definitions from the `Audio Mutex` section of `docs/protocol/orchestrator-spec.md`.

### 1. Base typed model
- `OrchestratorModel`

This base model is only for typed models in this file.

### 2. Audio owner enum
- `AudioOwner`

It must include exactly:

- `NONE = "none"`
- `QUICK_REACTION = "quick_reaction"`
- `PRIMARY_RESPONSE = "primary_response"`

### 3. Runtime config model
- `OrchestratorConfig`

It must include exactly the audio-mutex-relevant config fields required by the doc skeleton:

- `quick_reaction_max_wait_ms`
- `interrupt_replace_timeout_ms`
- `allow_crossfade`

Do **not** pull parser-only fields into this file for this task.

### 4. Playback state holder
- `PlaybackSnapshot`

It must track:

- `owner`
- `stream_id`
- `chunk_index`
- `playback_active`
- `current_chunk_interruptible`
- `pending_chunks`

### 5. Audio mutex
- `AudioMutex`

At minimum, implement:

- `__init__()`
- `claim_for_quick_reaction()`
- `submit_primary_chunk()`
- `notify_chunk_started()`
- `notify_chunk_finished()`
- `notify_playback_finished()`
- `wait_for_safe_handoff()`
- `force_replace()`

### 6. Decision surface
`submit_primary_chunk()` must return only documented decisions.

For v0.1 acceptance, support at least:

- `"play_now"`
- `"buffer"`
- `"replace_after_chunk"`

If you also keep `"replace_immediately"` as a reserved documented branch, do not invent new behavior around it.

### 7. Minimum test coverage
Create `tests/orchestrator/test_audio_mutex.py` with minimum unit coverage for:

- quick reaction claims ownership when idle
- second quick reaction claim fails while ownership is already held
- primary chunk plays immediately when there is no active owner
- primary chunk submitted during active quick reaction with interruptible current chunk returns `replace_after_chunk`
- primary chunk submitted during active quick reaction with non-interruptible current chunk returns `buffer`
- `notify_chunk_started()` updates snapshot correctly
- `notify_chunk_finished()` decrements pending chunks without going negative
- `notify_playback_finished()` clears ownership deterministically
- `wait_for_safe_handoff()` returns `True` when playback is already safe
- `force_replace()` returns a typed `InterruptSignal` targeting the current stream

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. The mutex is the sole owner of audible playback arbitration inside this module.
2. At any time, ownership must be represented by exactly one `AudioOwner` value.
3. Quick reaction may claim ownership only when the owner is `none`.
4. Primary response must not overlap existing quick-reaction playback.
5. Handoff decisions must be deterministic from current snapshot state.
6. `wait_for_safe_handoff()` must succeed when playback is already inactive or current chunk is interruptible.
7. `force_replace()` must produce a typed `InterruptSignal`, not an ad-hoc dict.
8. This module must not infer playback completion from task completion.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. `OrchestratorModel` and `OrchestratorConfig` must use **Pydantic v2** style with:
   - `extra="forbid"`
   - `frozen=True`
3. Use protocol types from `packages/protocol/events.py` where already defined:
   - `InterruptSignal`
   - `InterruptionPolicy`
   - `TTSChunk`
4. Do **not** return ad-hoc dict payloads.
5. Do **not** invent additional audio owners, config knobs, or snapshot fields.
6. Do **not** modify session status or protocol event semantics.
7. Do **not** infer chunk boundaries without the documented notify methods.
8. Do **not** implement playback device control, queue clearing side effects, or event-bus publishing.
9. Preserve deterministic behavior; no randomization or time-dependent branching beyond explicit timeout waiting.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- `TurnOrchestrator`
- primary/quick task scheduling
- event bus integration
- playback adapter/device integration
- actual queue draining or audio output
- crossfade implementation
- interrupt controller runtime logic beyond returning `InterruptSignal`
- tool-calling, memory, renderer, or plugin integration

---

## Do Not
Do not:

- modify any document
- implement full orchestrator runtime logic
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
2. If `pydantic v2` is available locally, run `tests/orchestrator/test_audio_mutex.py`
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

- `packages/orchestrator/audio_mutex.py` exists
- it implements `AudioOwner`, `OrchestratorConfig`, `PlaybackSnapshot`, and `AudioMutex`
- `AudioMutex` exposes the documented coordination methods
- arbitration behavior stays deterministic and protocol-aligned
- `force_replace()` returns a typed `InterruptSignal`
- no `TurnOrchestrator` or playback device logic was implemented
- tests cover the new coordination surface at least minimally
