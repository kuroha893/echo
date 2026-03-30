# Task Card 0013

## Title
Extend `packages/orchestrator/turn_orchestrator.py` with bounded interrupt-application shell

## Role
Implementer

## Goal
Extend the current orchestrator shell so it can perform a bounded local interrupt application flow consistent with:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

This task is intentionally limited to the **internal interrupt shell**:

- interrupt barrier tracking inside the current bounded orchestrator shell
- local pending-output clearing
- bounded `_apply_interrupt_signal()` behavior
- integration with the existing turn-resolution helper path

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/protocol/events.py`

This task is still **not** real playback/device interrupt integration.

---

## Scope Clarification
This card is intentionally limited to the portion of interrupt handling that the current orchestrator shell can implement without external adapters:

- mark that an interrupt barrier is locally unresolved while the shell is reconciling
- clear pending renderer/TTS output owned by the shell
- update bounded resolution logic so it sees the interrupt barrier state

This card includes only:

- adding bounded interrupt-barrier tracking to `handle_user_turn()`
- updating `_apply_interrupt_signal()` so it performs local shell reconciliation
- wiring the existing resolution helper(s) to the new barrier state
- focused unit tests for the new interrupt shell behavior

This card does **not** authorize:

- emission of real `system.interrupt.signal` / `system.interrupt.applied` events
- playback-device stop/replace control
- state-machine advancement
- event bus integration
- STT / TTS / renderer adapter implementation
- redesign of existing parser/audio-mutex behavior

The target is a safe bounded shell: “we know an interrupt is being applied locally, we clear pending shell outputs, and we don’t pretend the barrier is resolved before that local reconciliation finishes.”

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

### 1. Interrupt-barrier state in the shell
Add bounded interrupt-barrier tracking to the active turn shell in `handle_user_turn()`.

Requirements:

- it must let the shell represent “interrupt reconciliation still in progress”
- it must be observable by the existing resolution helper path
- it must default to “resolved” when no interrupt is actively being applied

A simple `asyncio.Event`-style resolved/unresolved flag is acceptable.

### 2. Bounded `_apply_interrupt_signal()` behavior
Update `_apply_interrupt_signal()` so it performs the bounded local reconciliation this shell can honestly do.

At minimum it must:

- mark the interrupt barrier as unresolved at entry
- mark `interrupt_event` so producer/consumer loops can observe the interrupt
- clear pending renderer commands that are still sitting in the orchestrator-owned queue
- clear pending TTS requests that are still sitting in the orchestrator-owned queue
- finish by marking the bounded interrupt barrier as resolved again

It must keep `InterruptSignal` typed and must not use ad-hoc dicts.

### 3. Resolution integration
Update the existing turn-resolution helper path so it no longer relies on a pure injected boolean.

Requirements:

- the resolution snapshot must reflect the current bounded interrupt-barrier state
- a turn must not be considered resolved while the local interrupt barrier is unresolved

### 4. Focused tests
Extend `tests/orchestrator/test_turn_orchestrator.py` to cover at least:

- `_apply_interrupt_signal()` sets `interrupt_event`
- `_apply_interrupt_signal()` drains pending renderer commands from the shell queue
- `_apply_interrupt_signal()` drains pending TTS chunks from the shell queue
- interrupt barrier is unresolved during the bounded application path and resolved after reconciliation
- turn-resolution snapshot sees the interrupt barrier state
- turn is not resolved while the bounded interrupt barrier is unresolved

You may use a test subclass / fake orchestrator hooks to observe this deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Interruptions are first-class control flow, not UI hints.
2. The bounded shell must not claim that interrupt application is done before local queue reconciliation finishes.
3. Local pending output must be clearable without adapter/device integration.
4. Resolution logic must observe the bounded interrupt barrier state.
5. This task must remain honest about scope: it is local shell reconciliation, not full playback/device reconciliation.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing local types instead of redefining semantics:
   - `InterruptSignal`
   - `TurnResolutionSnapshot`
   - `TurnContext`
3. Do **not** return or pass ad-hoc dict payloads.
4. Do **not** invent new protocol event types or session states.
5. Do **not** emit actual protocol events in this task.
6. Do **not** implement playback-device stop/replace behavior.
7. Do **not** add STT/TTS/renderer adapter logic.
8. Do **not** mark the interrupt barrier resolved before local pending-output reconciliation completes.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- emission of `system.interrupt.signal`
- emission of `system.interrupt.applied`
- playback-device integration
- state-machine advancement
- event bus integration
- authoritative playback-truth reconciliation
- STT/TTS/VTube adapter work
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

- `turn_orchestrator.py` has a bounded interrupt-application shell
- local orchestrator-owned pending output can be cleared on interrupt
- turn-resolution logic reflects the bounded interrupt-barrier state
- no STT/TTS/VTube/runtime adapter code was implemented
- tests cover the new bounded interrupt shell at least minimally
