from __future__ import annotations

from typing import Callable
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


class TransitionSpec(EchoProtocolModel):
    from_status: SessionStatus
    to_status: SessionStatus
    trigger_event_type: str = Field(min_length=1)
    priority: int = Field(ge=0, description="Lower number = higher precedence.")
    guard_name: str = Field(min_length=1)
    reason_template: str = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def validate_trigger_event_type(self) -> "TransitionSpec":
        if self.trigger_event_type == EventType.SESSION_STATE_CHANGED:
            raise ValueError("session.state.changed cannot be used as a trigger")
        return self


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


GuardFn = Callable[[TransitionContext], bool]


GUARDS: dict[str, GuardFn] = {
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


VALID_TRANSITIONS: tuple[TransitionSpec, ...] = (
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


def get_candidate_transitions(
    status: SessionStatus,
    trigger_event_type: str,
) -> list[TransitionSpec]:
    candidates = [
        spec
        for spec in VALID_TRANSITIONS
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
