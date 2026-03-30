~~~md
# Echo Protocol Specification: State Machine

> Status: Draft v0.1  
> Scope: Canonical session state machine for Echo runtime  
> Authority: This document is constrained by **《Echo AI 开发规范与工程宪法》** and must remain consistent with `docs/protocol/events.md`.

---

## 1. Purpose

This document defines the **canonical session state machine** for Echo.

Its goals are:

- explicitly define what each session state means
- lock the set of valid states
- define **all legal transitions**
- define the exact **event types** that may trigger each transition
- define guard conditions required for deterministic transitions
- prevent hidden or ad-hoc state drift inside runtime/orchestrator code
- provide a copyable Python skeleton for `packages/protocol/state_machine.py`

This document is the source of truth for:

- `SessionStatus` semantics
- valid transition paths
- transition guards
- transition resolution order
- state-change emission rules

---

## 2. Necessary correction to close the state machine

The current minimal `events.md` is sufficient to define the event envelope and MVP event families, but it is **not yet sufficient to fully close the state machine**.

Reason:

Without a few additional control/lifecycle events, the runtime cannot strictly answer:

- when `thinking` ends without speech output
- when `speaking` actually begins
- when `speaking` truly finishes
- when `interrupted` is resolved and can safely leave
- how `error` and `reset` are represented canonically

Therefore, this document introduces a **small required extension set of control events**.

These are not optional. They are required for a correct, replayable state machine.

### 2.1 Required additional event types

The following event types are added to the protocol surface and should be added to `events.py` in the next patch:

- `tts.playback.started`
- `tts.playback.finished`
- `assistant.response.completed`
- `system.interrupt.applied`
- `system.error.raised`
- `system.reset.requested`

These event types are **state-machine-critical**.

---

## 3. Canonical state set

The canonical session state set is locked to the following enum:

- `idle`
- `listening`
- `thinking`
- `speaking`
- `interrupted`
- `error`

No additional runtime-visible session states are allowed unless approved by RFC.

---

## 4. State semantics and invariants

This section defines the exact semantic meaning of each state.

---

### 4.1 `idle`

#### Meaning
The session is quiescent and not currently processing an active user turn or assistant turn.

#### Required invariants
- no active user speech capture in progress
- no active assistant TTS playback in progress
- no unresolved interruption barrier
- no unrecovered fatal session error

#### Allowed background activity
- low-cost observation
- memory maintenance
- plugin background monitoring
- cache warmup

#### Disallowed interpretation
`idle` does **not** mean “all tasks in the process are stopped”.  
It means the **interactive session turn** is not currently active.

---

### 4.2 `listening`

#### Meaning
The session is actively receiving a user utterance.

#### Required invariants
- user speech capture is active or partial speech is being accumulated
- assistant audio playback must not be active
- if prior assistant output existed, it must already have been interrupted/resolved

#### Notes
`listening` is an input-owned state.

---

### 4.3 `thinking`

#### Meaning
The user turn has been accepted, and the system is now generating or preparing a response, but audible assistant playback has not yet started.

#### Required invariants
At least one of the following must be true:
- drafter task active
- primary reasoning task active
- expression parser / chunk preparation active
- TTS preparation active but playback not yet started

#### Required invariant
- assistant audible playback is not yet active

#### Notes
`thinking` is computation-owned, not playback-owned.

---

### 4.4 `speaking`

#### Meaning
The assistant currently owns the turn and has started audible output playback.

#### Required invariants
- a TTS playback stream is active **or**
- the output pipeline is inside a continuous speaking turn that has not yet emitted `tts.playback.finished`

#### Important clarification
`speaking` is entered on **actual playback start**, not merely when text exists or TTS work is queued.

Therefore:
- `assistant.quick_reaction.ready` does **not** by itself imply `speaking`
- `assistant.response.chunk` does **not** by itself imply `speaking`
- `tts.chunk.queued` does **not** by itself imply `speaking`
- only `tts.playback.started` implies entry into `speaking`

---

### 4.5 `interrupted`

#### Meaning
A previously active turn is being forcefully reconciled due to interruption, replacement, or cancellation.

This is a **barrier state**.

#### Required invariants
At least one of the following is true:
- TTS playback stop/clear is in progress
- pending chunks are being discarded
- reasoning tasks are being canceled or detached
- renderer commands are being reset
- the orchestrator is resolving what the next stable state should be

#### Notes
`interrupted` should usually be short-lived, but it must still exist explicitly in protocol and logs.

---

### 4.6 `error`

#### Meaning
A fatal or session-blocking error occurred and the session is not safe to continue normal turn progression until reset.

#### Required invariants
- a protocol-level or runtime-level error has been raised
- normal transition progression is suspended except reset/recovery logic

#### Notes
`error` is not for harmless warnings.  
It is for failures that invalidate the current interactive session flow.

---

## 5. Important design correction: transitions need guards, not just event names

The user requirement to list “legal transitions + trigger event type” is correct, but **insufficient by itself**.

Reason:

The same event type may lead to different legal transitions depending on context.  
For example, after interruption is applied, the session may go to:

- `idle`
- `listening`
- `thinking`

depending on buffered input/output state.

Therefore this spec defines transitions as:

- `from_status`
- `to_status`
- `trigger_event_type`
- `guard_conditions`
- `transition_priority`
- `side_effect_requirements`

This is mandatory.

---

## 6. Valid transitions

This section is the authoritative list of legal transitions.

---

### 6.1 `idle` transitions

#### `idle -> listening`
- Trigger event: `user.speech.start`
- Guards:
  - event payload accepted by STT/VAD layer
  - no active fatal error
- Meaning:
  - the user started a new utterance

#### `idle -> thinking`
- Trigger event: `user.speech.end`
- Guards:
  - payload is final enough to be accepted as a turn
  - `RecognizedUtterance.is_final == True`
- Meaning:
  - the system may enter thinking directly even if `user.speech.start` was missed or intentionally bypassed

#### `idle -> error`
- Trigger event: `system.error.raised`
- Guards:
  - error classified as session-blocking
- Meaning:
  - unrecoverable turn/session failure

---

### 6.2 `listening` transitions

#### `listening -> listening`
- Trigger event: `user.speech.partial`
- Guards:
  - partial utterance belongs to current session
- Meaning:
  - self-loop while speech is still in progress

#### `listening -> thinking`
- Trigger event: `user.speech.end`
- Guards:
  - final utterance accepted
  - utterance belongs to current active input turn
- Meaning:
  - user turn closed, response generation may begin

#### `listening -> idle`
- Trigger event: `system.reset.requested`
- Guards:
  - session reset accepted
- Meaning:
  - input turn canceled/reset

#### `listening -> interrupted`
- Trigger event: `system.interrupt.signal`
- Guards:
  - interruption applies to current session flow
- Meaning:
  - rare but legal; used when input turn itself must be preempted/reconciled

#### `listening -> error`
- Trigger event: `system.error.raised`
- Guards:
  - session-blocking error
- Meaning:
  - listening failed irrecoverably

---

### 6.3 `thinking` transitions

#### `thinking -> speaking`
- Trigger event: `tts.playback.started`
- Guards:
  - playback stream belongs to current session
  - no unresolved higher-priority interrupt pending
- Meaning:
  - assistant audible output has actually started

#### `thinking -> idle`
- Trigger event: `assistant.response.completed`
- Guards:
  - no TTS playback started
  - no pending response chunk remains
  - no pending quick reaction playback remains
- Meaning:
  - the response path completed but produced no audible output, or output was intentionally suppressed

#### `thinking -> interrupted`
- Trigger event: `system.interrupt.signal`
- Guards:
  - interruption targets current turn or current output preparation
- Meaning:
  - active reasoning/output preparation was preempted

#### `thinking -> error`
- Trigger event: `system.error.raised`
- Guards:
  - session-blocking error
- Meaning:
  - reasoning path failed irrecoverably

#### `thinking -> idle`
- Trigger event: `system.reset.requested`
- Guards:
  - reset accepted
- Meaning:
  - cancel current thinking turn and return to quiescent state

---

### 6.4 `speaking` transitions

#### `speaking -> speaking`
- Trigger event: `tts.chunk.queued`
- Guards:
  - queued chunk belongs to current active speaking turn
- Meaning:
  - self-loop while output stream continues to extend

#### `speaking -> interrupted`
- Trigger event: `system.interrupt.signal`
- Guards:
  - interruption targets current playback/output pipeline
- Meaning:
  - active output is being cut, replaced, or reconciled

#### `speaking -> interrupted`
- Trigger event: `user.speech.start`
- Guards:
  - barge-in policy allows user speech to preempt current playback
- Meaning:
  - user started speaking over the assistant; output must be interrupted

#### `speaking -> idle`
- Trigger event: `tts.playback.finished`
- Guards:
  - no further playback remains for current turn
  - no pending replacement output is already armed
  - no unresolved interrupt pending
- Meaning:
  - assistant turn finished normally

#### `speaking -> error`
- Trigger event: `system.error.raised`
- Guards:
  - session-blocking error
- Meaning:
  - playback/output pipeline failed irrecoverably

#### `speaking -> idle`
- Trigger event: `system.reset.requested`
- Guards:
  - reset accepted
- Meaning:
  - hard reset clears speaking turn

---

### 6.5 `interrupted` transitions

`interrupted` is resolved by a barrier event: `system.interrupt.applied`.

This event means:
- the interrupt has been materially applied
- TTS cancellation/clearing is complete enough
- renderer cleanup is complete enough
- old turn ownership has been reconciled
- the orchestrator may now choose the next stable state

#### `interrupted -> listening`
- Trigger event: `system.interrupt.applied`
- Guards:
  - new user speech is active or partial input already exists
- Meaning:
  - interruption resolved into user input ownership

#### `interrupted -> thinking`
- Trigger event: `system.interrupt.applied`
- Guards:
  - no active playback remains
  - a valid finalized user utterance is pending **or**
  - a replacement reasoning path is active
- Meaning:
  - interruption resolved into new reasoning work

#### `interrupted -> idle`
- Trigger event: `system.interrupt.applied`
- Guards:
  - no active playback
  - no pending user speech
  - no pending accepted reasoning turn
- Meaning:
  - interruption fully resolved with no immediate successor turn

#### `interrupted -> error`
- Trigger event: `system.error.raised`
- Guards:
  - session-blocking error
- Meaning:
  - interruption reconciliation failed

#### `interrupted -> idle`
- Trigger event: `system.reset.requested`
- Guards:
  - reset accepted
- Meaning:
  - force-clear interruption barrier

---

### 6.6 `error` transitions

#### `error -> idle`
- Trigger event: `system.reset.requested`
- Guards:
  - reset accepted
  - error context cleared or intentionally discarded
- Meaning:
  - explicit reset/recovery

#### `error -> error`
- Trigger event: `system.error.raised`
- Guards:
  - additional error observed while already in error
- Meaning:
  - self-loop allowed for logging accumulation

No other exits from `error` are valid in v0.1.

---

## 7. Explicitly forbidden transitions

The following transitions are forbidden unless a future RFC changes the state model.

### 7.1 Forbidden transitions
- `idle -> speaking`
- `listening -> speaking`
- `speaking -> thinking`
- `idle -> interrupted`
- `error -> listening`
- `error -> thinking`
- `error -> speaking`

### 7.2 Why these are forbidden

#### `idle -> speaking`
The assistant must not begin speaking without first entering a turn-preparation path (`thinking`) in v0.1.

#### `listening -> speaking`
The system may not speak over an active input turn without first closing or interrupting it.

#### `speaking -> thinking`
This causes semantic ambiguity and hidden turn drift.  
If output is interrupted, the system must go through `interrupted`.  
If output ends normally, it goes to `idle`.

#### `idle -> interrupted`
There is nothing active to interrupt in a stable idle turn.

#### `error -> listening|thinking|speaking`
Error must be explicitly reset before normal operation resumes.

---

## 8. Transition precedence rules

Some event combinations may race.  
When multiple transitions are plausible, the following precedence applies:

1. `system.error.raised`
2. `system.reset.requested`
3. `system.interrupt.signal`
4. `user.speech.start`
5. `tts.playback.started`
6. `tts.playback.finished`
7. `assistant.response.completed`
8. `user.speech.end`
9. `user.speech.partial`
10. `tts.chunk.queued`

Higher-priority transition resolution wins.

### 8.1 Practical consequence
If `tts.playback.started` and `system.interrupt.signal` are both pending, the interrupt wins.

---

## 9. State-entry and state-exit obligations

A transition is not just a label change.  
Certain side effects are mandatory.

---

### 9.1 Entering `listening`
Required effects:
- assistant playback must be inactive
- capture/input accumulation becomes authoritative
- renderer may switch to listening expression/state

---

### 9.2 Entering `thinking`
Required effects:
- accepted user turn is bound to the session
- drafter and/or primary reasoning may start
- renderer may switch to thinking state
- no audible assistant playback yet

---

### 9.3 Entering `speaking`
Required effects:
- current speaking stream id becomes authoritative
- renderer may switch to speaking state
- playback ownership is established

---

### 9.4 Entering `interrupted`
Required effects:
- interruption barrier is created
- active low-priority output may be canceled/cleared
- pending queues may be truncated
- renderer should reflect interruption resolution, not normal speaking/listening

---

### 9.5 Entering `error`
Required effects:
- session marked unsafe for normal progression
- internal error context retained for diagnostics
- only reset/recovery logic remains valid

---

## 10. `session.state.changed` emission rules

Every successful transition must emit exactly one:

- `session.state.changed`

with payload:

- `from_status`
- `to_status`
- `reason`
- `trigger_event_id`

### 10.1 Requirements
- the event must be emitted **after** transition acceptance
- the event must reference the concrete trigger event that caused the transition
- hidden transitions are forbidden

---

## 11. Required guard context

To evaluate guards deterministically, the orchestrator/state machine needs a minimal read-only guard context.

The following snapshot fields are required:

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

This context is not the same thing as `SessionState`; it is a transition-evaluation snapshot.

---

## 12. Copyable Python skeleton for `packages/protocol/state_machine.py`

> This skeleton is designed to be directly usable as the starting point for implementation.  
> It intentionally imports the protocol definitions from `events.py` and adds only state-machine-specific structures.

```python
from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.protocol.events import SessionStatus


class EchoProtocolModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


# ============================================================
# Event type constants required by the state machine
# ============================================================

class EventType:
    USER_SPEECH_START = "user.speech.start"
    USER_SPEECH_PARTIAL = "user.speech.partial"
    USER_SPEECH_END = "user.speech.end"

    ASSISTANT_QUICK_REACTION_READY = "assistant.quick_reaction.ready"
    ASSISTANT_RESPONSE_CHUNK = "assistant.response.chunk"
    ASSISTANT_RESPONSE_COMPLETED = "assistant.response.completed"

    TTS_CHUNK_QUEUED = "tts.chunk.queued"
    TTS_PLAYBACK_STARTED = "tts.playback.started"
    TTS_PLAYBACK_FINISHED = "tts.playback.finished"

    RENDERER_COMMAND_ISSUED = "renderer.command.issued"

    SYSTEM_INTERRUPT_SIGNAL = "system.interrupt.signal"
    SYSTEM_INTERRUPT_APPLIED = "system.interrupt.applied"
    SYSTEM_ERROR_RAISED = "system.error.raised"
    SYSTEM_RESET_REQUESTED = "system.reset.requested"

    SESSION_STATE_CHANGED = "session.state.changed"


# ============================================================
# Guard context
# ============================================================

class TransitionContext(EchoProtocolModel):
    session_id: UUID
    current_status: SessionStatus
    active_trace_id: UUID | None = None

    has_active_user_input: bool = False
    has_finalized_user_utterance: bool = False

    has_active_tts_playback: bool = False
    has_pending_tts_chunks: bool = False

    has_active_reasoning_task: bool = False
    has_pending_interrupt: bool = False

    current_tts_stream_id: UUID | None = None
    current_response_stream_id: UUID | None = None


# ============================================================
# Transition specification
# ============================================================

class TransitionSpec(EchoProtocolModel):
    from_status: SessionStatus
    to_status: SessionStatus
    trigger_event_type: str = Field(min_length=1)
    priority: int = Field(ge=0, description="Lower number = higher precedence.")
    guard_name: str = Field(min_length=1)
    reason_template: str = Field(min_length=1, max_length=256)


# ============================================================
# Guard functions
# ============================================================

def guard_true(_: TransitionContext) -> bool:
    return True


def guard_no_active_error(_: TransitionContext) -> bool:
    return True


def guard_finalized_user_turn(ctx: TransitionContext) -> bool:
    return ctx.has_finalized_user_utterance


def guard_playback_started(ctx: TransitionContext) -> bool:
    return ctx.has_active_tts_playback


def guard_interrupt_targetable(_: TransitionContext) -> bool:
    return True


def guard_response_completed_without_playback(ctx: TransitionContext) -> bool:
    return (not ctx.has_active_tts_playback) and (not ctx.has_pending_tts_chunks)


def guard_playback_finished_clean(ctx: TransitionContext) -> bool:
    return (not ctx.has_active_tts_playback) and (not ctx.has_pending_interrupt)


def guard_interrupt_resolves_to_listening(ctx: TransitionContext) -> bool:
    return ctx.has_active_user_input


def guard_interrupt_resolves_to_thinking(ctx: TransitionContext) -> bool:
    return (not ctx.has_active_tts_playback) and (
        ctx.has_finalized_user_utterance or ctx.has_active_reasoning_task
    )


def guard_interrupt_resolves_to_idle(ctx: TransitionContext) -> bool:
    return (
        not ctx.has_active_user_input
        and not ctx.has_finalized_user_utterance
        and not ctx.has_active_tts_playback
        and not ctx.has_pending_tts_chunks
        and not ctx.has_active_reasoning_task
    )


GUARDS: dict[str, callable] = {
    "guard_true": guard_true,
    "guard_no_active_error": guard_no_active_error,
    "guard_finalized_user_turn": guard_finalized_user_turn,
    "guard_playback_started": guard_playback_started,
    "guard_interrupt_targetable": guard_interrupt_targetable,
    "guard_response_completed_without_playback": guard_response_completed_without_playback,
    "guard_playback_finished_clean": guard_playback_finished_clean,
    "guard_interrupt_resolves_to_listening": guard_interrupt_resolves_to_listening,
    "guard_interrupt_resolves_to_thinking": guard_interrupt_resolves_to_thinking,
    "guard_interrupt_resolves_to_idle": guard_interrupt_resolves_to_idle,
}


# ============================================================
# Canonical transition table
# ============================================================

VALID_TRANSITIONS: tuple[TransitionSpec, ...] = (
    # idle
    TransitionSpec(
        from_status=SessionStatus.IDLE,
        to_status=SessionStatus.LISTENING,
        trigger_event_type=EventType.USER_SPEECH_START,
        priority=4,
        guard_name="guard_no_active_error",
        reason_template="user started speaking",
    ),
    TransitionSpec(
        from_status=SessionStatus.IDLE,
        to_status=SessionStatus.THINKING,
        trigger_event_type=EventType.USER_SPEECH_END,
        priority=8,
        guard_name="guard_finalized_user_turn",
        reason_template="user utterance finalized",
    ),
    TransitionSpec(
        from_status=SessionStatus.IDLE,
        to_status=SessionStatus.ERROR,
        trigger_event_type=EventType.SYSTEM_ERROR_RAISED,
        priority=1,
        guard_name="guard_true",
        reason_template="session-blocking error raised",
    ),

    # listening
    TransitionSpec(
        from_status=SessionStatus.LISTENING,
        to_status=SessionStatus.LISTENING,
        trigger_event_type=EventType.USER_SPEECH_PARTIAL,
        priority=9,
        guard_name="guard_true",
        reason_template="user speech partial update",
    ),
    TransitionSpec(
        from_status=SessionStatus.LISTENING,
        to_status=SessionStatus.THINKING,
        trigger_event_type=EventType.USER_SPEECH_END,
        priority=8,
        guard_name="guard_finalized_user_turn",
        reason_template="user speech ended",
    ),
    TransitionSpec(
        from_status=SessionStatus.LISTENING,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.SYSTEM_RESET_REQUESTED,
        priority=2,
        guard_name="guard_true",
        reason_template="session reset requested",
    ),
    TransitionSpec(
        from_status=SessionStatus.LISTENING,
        to_status=SessionStatus.INTERRUPTED,
        trigger_event_type=EventType.SYSTEM_INTERRUPT_SIGNAL,
        priority=3,
        guard_name="guard_interrupt_targetable",
        reason_template="listening flow interrupted",
    ),
    TransitionSpec(
        from_status=SessionStatus.LISTENING,
        to_status=SessionStatus.ERROR,
        trigger_event_type=EventType.SYSTEM_ERROR_RAISED,
        priority=1,
        guard_name="guard_true",
        reason_template="session-blocking error raised",
    ),

    # thinking
    TransitionSpec(
        from_status=SessionStatus.THINKING,
        to_status=SessionStatus.SPEAKING,
        trigger_event_type=EventType.TTS_PLAYBACK_STARTED,
        priority=5,
        guard_name="guard_playback_started",
        reason_template="assistant playback started",
    ),
    TransitionSpec(
        from_status=SessionStatus.THINKING,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.ASSISTANT_RESPONSE_COMPLETED,
        priority=7,
        guard_name="guard_response_completed_without_playback",
        reason_template="response completed without playback",
    ),
    TransitionSpec(
        from_status=SessionStatus.THINKING,
        to_status=SessionStatus.INTERRUPTED,
        trigger_event_type=EventType.SYSTEM_INTERRUPT_SIGNAL,
        priority=3,
        guard_name="guard_interrupt_targetable",
        reason_template="thinking flow interrupted",
    ),
    TransitionSpec(
        from_status=SessionStatus.THINKING,
        to_status=SessionStatus.ERROR,
        trigger_event_type=EventType.SYSTEM_ERROR_RAISED,
        priority=1,
        guard_name="guard_true",
        reason_template="session-blocking error raised",
    ),
    TransitionSpec(
        from_status=SessionStatus.THINKING,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.SYSTEM_RESET_REQUESTED,
        priority=2,
        guard_name="guard_true",
        reason_template="session reset requested",
    ),

    # speaking
    TransitionSpec(
        from_status=SessionStatus.SPEAKING,
        to_status=SessionStatus.SPEAKING,
        trigger_event_type=EventType.TTS_CHUNK_QUEUED,
        priority=10,
        guard_name="guard_true",
        reason_template="additional tts chunk queued",
    ),
    TransitionSpec(
        from_status=SessionStatus.SPEAKING,
        to_status=SessionStatus.INTERRUPTED,
        trigger_event_type=EventType.SYSTEM_INTERRUPT_SIGNAL,
        priority=3,
        guard_name="guard_interrupt_targetable",
        reason_template="speaking flow interrupted",
    ),
    TransitionSpec(
        from_status=SessionStatus.SPEAKING,
        to_status=SessionStatus.INTERRUPTED,
        trigger_event_type=EventType.USER_SPEECH_START,
        priority=4,
        guard_name="guard_true",
        reason_template="user barge-in detected",
    ),
    TransitionSpec(
        from_status=SessionStatus.SPEAKING,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.TTS_PLAYBACK_FINISHED,
        priority=6,
        guard_name="guard_playback_finished_clean",
        reason_template="playback finished cleanly",
    ),
    TransitionSpec(
        from_status=SessionStatus.SPEAKING,
        to_status=SessionStatus.ERROR,
        trigger_event_type=EventType.SYSTEM_ERROR_RAISED,
        priority=1,
        guard_name="guard_true",
        reason_template="session-blocking error raised",
    ),
    TransitionSpec(
        from_status=SessionStatus.SPEAKING,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.SYSTEM_RESET_REQUESTED,
        priority=2,
        guard_name="guard_true",
        reason_template="session reset requested",
    ),

    # interrupted
    TransitionSpec(
        from_status=SessionStatus.INTERRUPTED,
        to_status=SessionStatus.LISTENING,
        trigger_event_type=EventType.SYSTEM_INTERRUPT_APPLIED,
        priority=3,
        guard_name="guard_interrupt_resolves_to_listening",
        reason_template="interrupt resolved to listening",
    ),
    TransitionSpec(
        from_status=SessionStatus.INTERRUPTED,
        to_status=SessionStatus.THINKING,
        trigger_event_type=EventType.SYSTEM_INTERRUPT_APPLIED,
        priority=4,
        guard_name="guard_interrupt_resolves_to_thinking",
        reason_template="interrupt resolved to thinking",
    ),
    TransitionSpec(
        from_status=SessionStatus.INTERRUPTED,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.SYSTEM_INTERRUPT_APPLIED,
        priority=5,
        guard_name="guard_interrupt_resolves_to_idle",
        reason_template="interrupt resolved to idle",
    ),
    TransitionSpec(
        from_status=SessionStatus.INTERRUPTED,
        to_status=SessionStatus.ERROR,
        trigger_event_type=EventType.SYSTEM_ERROR_RAISED,
        priority=1,
        guard_name="guard_true",
        reason_template="interrupt reconciliation failed",
    ),
    TransitionSpec(
        from_status=SessionStatus.INTERRUPTED,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.SYSTEM_RESET_REQUESTED,
        priority=2,
        guard_name="guard_true",
        reason_template="session reset requested",
    ),

    # error
    TransitionSpec(
        from_status=SessionStatus.ERROR,
        to_status=SessionStatus.IDLE,
        trigger_event_type=EventType.SYSTEM_RESET_REQUESTED,
        priority=2,
        guard_name="guard_true",
        reason_template="error cleared by reset",
    ),
    TransitionSpec(
        from_status=SessionStatus.ERROR,
        to_status=SessionStatus.ERROR,
        trigger_event_type=EventType.SYSTEM_ERROR_RAISED,
        priority=1,
        guard_name="guard_true",
        reason_template="additional error raised",
    ),
)


# ============================================================
# Resolution helpers
# ============================================================

def get_candidate_transitions(
    status: SessionStatus,
    trigger_event_type: str,
) -> list[TransitionSpec]:
    candidates = [
        spec for spec in VALID_TRANSITIONS
        if spec.from_status == status and spec.trigger_event_type == trigger_event_type
    ]
    return sorted(candidates, key=lambda spec: spec.priority)


def resolve_transition(
    status: SessionStatus,
    trigger_event_type: str,
    context: TransitionContext,
) -> TransitionSpec | None:
    for spec in get_candidate_transitions(status, trigger_event_type):
        guard_fn = GUARDS[spec.guard_name]
        if guard_fn(context):
            return spec
    return None
~~~

------

## 13. Required implementation rules

### 13.1 No hidden transitions

A status change may only happen if:

- there is a valid transition spec
- its trigger event type matches
- its guard evaluates to true

Anything else is invalid.

------

### 13.2 No direct manual status assignment in business code

Application code must not do:

```python
session.status = SessionStatus.SPEAKING
```

unless that assignment is happening inside the dedicated state machine application path **after** a valid transition decision.

------

### 13.3 `session.state.changed` is an effect, not a trigger

`session.state.changed` is emitted **because** a transition occurred.
It must never be consumed as the cause of another transition decision.

------

### 13.4 Content events are not state events

The following are content/lifecycle signals, not direct state labels:

- `assistant.quick_reaction.ready`
- `assistant.response.chunk`
- `renderer.command.issued`
- `tts.chunk.queued`

These may contribute to downstream behavior, but they do not automatically imply a specific status change unless explicitly listed in the transition table.

------

## 14. Suggested tests

The following tests are mandatory for implementation acceptance:

### 14.1 Legal transition tests

- `idle + user.speech.start -> listening`
- `listening + user.speech.end -> thinking`
- `thinking + tts.playback.started -> speaking`
- `speaking + user.speech.start -> interrupted`
- `interrupted + system.interrupt.applied (user input active) -> listening`
- `interrupted + system.interrupt.applied (reasoning active, no playback) -> thinking`
- `interrupted + system.interrupt.applied (all clear) -> idle`
- `error + system.reset.requested -> idle`

### 14.2 Forbidden transition tests

- `idle + tts.playback.started` must not transition to `speaking`
- `listening + tts.playback.started` must not transition to `speaking`
- `error + user.speech.start` must not transition to `listening`
- `speaking + assistant.response.completed` must not directly transition to `thinking`

### 14.3 Guard correctness tests

- `thinking + assistant.response.completed` should only go to `idle` if no playback exists
- `speaking + tts.playback.finished` should only go to `idle` if no interrupt pending
- `interrupted + system.interrupt.applied` must resolve by guard order

------

## 15. Acceptance checklist

This document is considered implemented correctly only if:

-  all six canonical states are present and locked
-  all legal transitions in this document exist in code
-  forbidden transitions do not silently occur
-  transition resolution uses both event type and guard context
-  `system.interrupt.applied` exists as an explicit barrier event
-  `tts.playback.started` and `tts.playback.finished` exist as explicit lifecycle events
-  every successful transition emits `session.state.changed`
-  tests cover both legal and forbidden transitions