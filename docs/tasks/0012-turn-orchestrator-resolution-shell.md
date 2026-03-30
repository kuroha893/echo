# Task Card 0012

## Title
Extend `packages/orchestrator/turn_orchestrator.py` with bounded turn-resolution shell

## Role
Implementer

## Goal
Extend the current orchestrator shell so it can make a bounded, typed decision about whether a turn is ready to settle, based on the turn-completion rules in:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

This task is intentionally limited to the **internal turn-resolution shell**:

- read-only playback snapshot access
- bounded turn-resolution snapshot/model
- turn-resolution decision helper(s)
- a bounded wait path in `handle_user_turn()`

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/protocol/events.py`

This task is still **not** adapter/runtime integration.

---

## Scope Clarification
This card is intentionally limited to the portion of orchestrator behavior implied by section 11 of `docs/protocol/orchestrator-spec.md`:

- observing whether the turn is resolved enough to conclude the bounded shell
- doing so without inferring playback completion from task completion alone

This card includes only:

- a read-only playback snapshot accessor on `AudioMutex`
- one bounded typed resolution snapshot/model in `turn_orchestrator.py`
- one or more resolution helper methods in `turn_orchestrator.py`
- updating `handle_user_turn()` so it waits for this bounded resolution step before final shutdown

This card does **not** authorize:

- event bus integration
- state-machine advancement
- real interrupt reconciliation
- STT / TTS / renderer adapter implementation
- playback-device integration
- tool-loop integration
- redesign of the existing orchestrator subpaths

The target is a clean, testable “turn has settled enough for this shell” layer, not the final production end-of-turn truth system.

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

- `tests/orchestrator/test_audio_mutex.py`
- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** read unrelated runtime / memory / plugin / STT / TTS / renderer files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may modify only:

- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/orchestrator/expression_parser.py`
- do not modify `packages/protocol/events.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Read-only playback snapshot access
Add a read-only snapshot accessor to `AudioMutex`.

Requirements:

- it must expose the current `PlaybackSnapshot` without giving callers mutation authority
- it must stay within `packages/orchestrator`
- it must not change playback ownership semantics

You may choose a minimal name such as:

- `get_snapshot()`

The returned value must be a safe read-only copy/snapshot, not the live mutable object itself.

### 2. Turn-resolution snapshot model
Add one bounded typed model in `turn_orchestrator.py` to represent the subset of turn-resolution facts this shell can currently observe.

It must include at least:

- whether drafter path is done
- whether primary path is done
- whether playback is active
- how many pending playback chunks remain
- whether renderer queue is empty
- whether TTS request queue is empty
- whether an interrupt barrier is unresolved

You may choose a concise implementation-oriented name such as:

- `TurnResolutionSnapshot`

This model is internal to the orchestrator shell.

### 3. Resolution helper(s)
Add bounded helper logic in `turn_orchestrator.py` that:

- builds the current `TurnResolutionSnapshot`
- decides whether the current turn is resolved enough for the bounded shell to conclude

The resolution decision must be consistent with the spec’s turn-completion rules:

- drafter path done or explicitly absent
- primary path done
- no active playback remains
- no pending playback chunks remain
- no pending orchestrator output remains in the current bounded shell
- no unresolved interrupt barrier remains

Because full interrupt reconciliation is still out of scope, this task may keep `has_unresolved_interrupt_barrier` as a bounded shell input/flag that defaults to “resolved” unless a test explicitly simulates otherwise.

### 4. Bounded wait path in `handle_user_turn()`
Update `handle_user_turn()` so that after the main coordination tasks settle, it performs a bounded wait/check for turn resolution before final dispatch shutdown.

Requirements:

- do **not** infer turn completion solely from drafter/primary task completion
- use the new resolution helper(s)
- keep the shutdown logic bounded and deterministic
- do not block forever; use a small bounded wait/polling strategy if needed

### 5. Minimum test coverage
Extend `tests/orchestrator/test_turn_orchestrator.py` to cover at least:

- `AudioMutex` snapshot accessor returns a safe copy, not the live mutable object
- resolution snapshot captures playback-active and pending-chunk state
- turn is **not** resolved if playback is still active
- turn is **not** resolved if pending playback chunks remain
- turn is **not** resolved if renderer queue is non-empty
- turn is **not** resolved if TTS request queue is non-empty
- turn is **not** resolved if unresolved interrupt barrier flag is true
- turn is resolved when all bounded-shell conditions are satisfied
- `handle_user_turn()` consults the bounded resolution path before final shutdown

You may use a test subclass / fake mutex to observe this deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Turn completion must not be inferred from task completion alone.
2. Playback truth for this bounded shell must come from `AudioMutex` snapshot state, not from “task ended”.
3. Resolution checks must be deterministic and side-effect free.
4. Queue emptiness must be part of the bounded-shell resolution decision.
5. The new snapshot accessor must not leak mutable ownership of `AudioMutex` internal state.
6. This task must remain an internal orchestrator-shell improvement, not a public protocol redesign.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Any new typed model in this task must use **Pydantic v2** style with:
   - `extra="forbid"`
   - `frozen=True`
3. Reuse existing local types instead of redefining semantics:
   - `PlaybackSnapshot`
   - `AudioMutex`
   - `TurnContext`
   - `OrchestratorConfig`
4. Do **not** return or pass ad-hoc dict payloads.
5. Do **not** invent new protocol event types or session states.
6. Do **not** implement real interrupt reconciliation or event emission.
7. Do **not** add STT/TTS/renderer adapter logic.
8. Do **not** block indefinitely in the new resolution wait path.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- STT integration
- TTS adapter/device implementation
- VTube / renderer adapter integration
- event bus integration
- state-machine advancement
- authoritative interrupt application workflow
- full production playback-truth reconciliation
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

- `AudioMutex` exposes a safe read-only playback snapshot
- `turn_orchestrator.py` has a bounded typed turn-resolution snapshot/helper layer
- bounded resolution logic is consistent with the observable subset of section 11
- `handle_user_turn()` no longer treats task completion alone as sufficient turn completion
- no STT/TTS/VTube/runtime adapter code was implemented
- tests cover the new bounded resolution shell at least minimally
