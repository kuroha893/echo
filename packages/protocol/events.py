from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Literal, Union
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SOURCE_PATTERN = re.compile(r"^[a-z0-9]+([._-][a-z0-9]+)*$")


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


class EchoProtocolModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class ExactTextProtocolModel(EchoProtocolModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=False,
        validate_assignment=True,
    )


class EventPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class SourceType(str, Enum):
    USER = "user"
    SYSTEM = "system"
    PLUGIN = "plugin"
    ADAPTER = "adapter"
    TEST = "test"


class SessionStatus(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    INTERRUPTED = "interrupted"
    ERROR = "error"


class InterruptionPolicy(str, Enum):
    WAIT = "wait"
    REPLACE = "replace"
    CUT_AFTER_CHUNK = "cut_after_chunk"
    CROSSFADE = "crossfade"


class RendererCommandType(str, Enum):
    SET_STATE = "set_state"
    SET_EXPRESSION = "set_expression"
    SET_MOTION = "set_motion"
    SET_MOUTH_OPEN = "set_mouth_open"
    CLEAR_EXPRESSION = "clear_expression"


class ToolErrorCode(str, Enum):
    VALIDATION_ERROR = "validation_error"
    TOOL_NOT_FOUND = "tool_not_found"
    PERMISSION_DENIED = "permission_denied"
    TIMEOUT = "timeout"
    RUNTIME_ERROR = "runtime_error"
    INTERRUPTED = "interrupted"


class EmotionTag(EchoProtocolModel):
    name: str = Field(min_length=1, max_length=64)
    intensity: float = Field(ge=0.0, le=1.0)


class RecognizedUtterance(ExactTextProtocolModel):
    utterance_id: UUID = Field(default_factory=uuid4)
    text: str = Field(min_length=1)
    language: str = Field(default="auto", min_length=2, max_length=16)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)
    is_final: bool = False
    emotion_tags: list[EmotionTag] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_time_range(self) -> "RecognizedUtterance":
        if (
            self.start_ms is not None
            and self.end_ms is not None
            and self.end_ms < self.start_ms
        ):
            raise ValueError("end_ms must be >= start_ms")
        return self


class QuickReaction(ExactTextProtocolModel):
    reaction_id: UUID = Field(default_factory=uuid4)
    text: str = Field(min_length=1)
    emotion_tags: list[EmotionTag] = Field(default_factory=list)
    is_interruptible: bool = True


class ResponseTextChunk(ExactTextProtocolModel):
    response_stream_id: UUID = Field(default_factory=uuid4)
    chunk_index: int = Field(ge=0)
    text: str = Field(min_length=1)
    raw_text: str = ""
    subtitle_text: str = ""
    is_final: bool = False
    is_interruptible: bool = True
    emotion_tags: list[EmotionTag] = Field(default_factory=list)


class TTSChunk(ExactTextProtocolModel):
    tts_stream_id: UUID = Field(default_factory=uuid4)
    chunk_index: int = Field(ge=0)
    text: str = Field(min_length=1)
    voice_style: str | None = Field(default=None, max_length=64)
    emotion_tags: list[EmotionTag] = Field(default_factory=list)
    is_interruptible: bool = True


class RendererCommand(EchoProtocolModel):
    command_id: UUID = Field(default_factory=uuid4)
    command_type: RendererCommandType
    target: str = Field(min_length=1, max_length=64)
    value: str | float | int | bool
    intensity: float = Field(default=1.0, ge=0.0, le=1.0)
    duration_ms: int | None = Field(default=None, ge=0)
    is_interruptible: bool = True


class InterruptSignal(EchoProtocolModel):
    reason: str = Field(min_length=1, max_length=256)
    policy: InterruptionPolicy = InterruptionPolicy.REPLACE
    target_tts_stream_id: UUID | None = None
    target_response_stream_id: UUID | None = None
    cut_after_chunk_index: int | None = Field(default=None, ge=0)
    clear_pending_tts: bool = True
    clear_pending_renderer: bool = True

    @model_validator(mode="after")
    def validate_cut_policy(self) -> "InterruptSignal":
        if (
            self.policy == InterruptionPolicy.CUT_AFTER_CHUNK
            and self.cut_after_chunk_index is None
        ):
            raise ValueError(
                "cut_after_chunk_index is required when policy='cut_after_chunk'"
            )
        return self


class StateTransition(EchoProtocolModel):
    from_status: SessionStatus
    to_status: SessionStatus
    reason: str = Field(min_length=1, max_length=256)
    trigger_event_id: UUID


class ToolCallRequest(EchoProtocolModel):
    call_id: UUID = Field(default_factory=uuid4)
    turn_id: UUID
    step_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)
    requested_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    timeout_ms: int | None = Field(default=None, ge=1)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("requested_at")
    @classmethod
    def ensure_requested_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "requested_at")


class ToolCallStarted(EchoProtocolModel):
    call_id: UUID
    turn_id: UUID
    step_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("started_at")
    @classmethod
    def ensure_started_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "started_at")


class ToolCallResult(EchoProtocolModel):
    call_id: UUID
    turn_id: UUID
    step_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    completed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ok: Literal[True] = True
    summary_text: str | None = Field(default=None, min_length=1)
    structured_data: dict[str, Any] | None = None
    artifact_refs: list[str] = Field(default_factory=list)
    latency_ms: int | None = Field(default=None, ge=0)

    @field_validator("completed_at")
    @classmethod
    def ensure_completed_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "completed_at")


class ToolCallFailure(EchoProtocolModel):
    call_id: UUID
    turn_id: UUID
    step_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    failed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    error_code: ToolErrorCode
    error_message: str = Field(min_length=1, max_length=1024)
    retryable: bool = False

    @field_validator("failed_at")
    @classmethod
    def ensure_failed_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "failed_at")


class ToolCallCancelled(EchoProtocolModel):
    call_id: UUID
    turn_id: UUID
    step_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    cancelled_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    reason: str = Field(min_length=1, max_length=256)
    superseded_by_turn_id: UUID | None = None

    @field_validator("cancelled_at")
    @classmethod
    def ensure_cancelled_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "cancelled_at")


class ToolObservation(EchoProtocolModel):
    call_id: UUID
    tool_name: str = Field(min_length=1, max_length=128)
    step_index: int = Field(ge=0)
    observation_text: str = Field(min_length=1)
    ok: bool
    structured_data: dict[str, Any] | None = None
    error_code: ToolErrorCode | None = None
    artifact_refs: list[str] = Field(default_factory=list)


class PlaybackStarted(EchoProtocolModel):
    tts_stream_id: UUID
    chunk_index: int = Field(ge=0)
    is_interruptible: bool


class PlaybackFinished(EchoProtocolModel):
    tts_stream_id: UUID
    last_chunk_index: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=256)


class ResponseCompleted(EchoProtocolModel):
    response_stream_id: UUID
    final_chunk_index: int = Field(ge=0)
    had_output: bool


class InterruptApplied(EchoProtocolModel):
    reason: str = Field(min_length=1, max_length=256)
    playback_stopped: bool
    pending_tts_cleared: bool
    pending_renderer_cleared: bool
    reasoning_cancelled: bool
    new_user_input_active: bool


class SystemErrorRaised(EchoProtocolModel):
    error_code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=1024)
    is_session_blocking: bool
    details: dict[str, Any]


class ResetRequested(EchoProtocolModel):
    reason: str = Field(min_length=1, max_length=256)
    drop_pending_output: bool
    drop_pending_input: bool


class ChunkPlaybackStarted(EchoProtocolModel):
    tts_stream_id: UUID
    chunk_index: int = Field(ge=0)
    is_interruptible: bool = True


class ChunkPlaybackFinished(EchoProtocolModel):
    tts_stream_id: UUID
    chunk_index: int = Field(ge=0)


class SessionState(EchoProtocolModel):
    session_id: UUID
    status: SessionStatus
    active_scope: str = Field(default="global", min_length=1, max_length=64)
    current_trace_id: UUID | None = None
    current_user_utterance_id: UUID | None = None
    current_response_stream_id: UUID | None = None
    current_tts_stream_id: UUID | None = None
    last_event_id: UUID | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("updated_at")
    @classmethod
    def ensure_updated_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "updated_at")


class BaseEvent(EchoProtocolModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    trace_id: UUID
    session_id: UUID
    source_type: SourceType
    source: str = Field(min_length=1, max_length=128)
    priority: EventPriority = EventPriority.NORMAL
    causation_event_id: UUID | None = None
    payload: EchoProtocolModel
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timestamp")
    @classmethod
    def ensure_timestamp_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "timestamp")

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        if not SOURCE_PATTERN.match(value):
            raise ValueError(
                "source must be lowercase machine-readable identifier, "
                "e.g. 'system.orchestrator' or 'plugin.mahjong'"
            )
        return value


class UserSpeechStartPayload(EchoProtocolModel):
    utterance_id: UUID = Field(default_factory=uuid4)
    vad_confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class UserSpeechStartEvent(BaseEvent):
    event_type: Literal["user.speech.start"] = "user.speech.start"
    payload: UserSpeechStartPayload


class UserSpeechPartialEvent(BaseEvent):
    event_type: Literal["user.speech.partial"] = "user.speech.partial"
    payload: RecognizedUtterance


class UserSpeechEndEvent(BaseEvent):
    event_type: Literal["user.speech.end"] = "user.speech.end"
    payload: RecognizedUtterance


class QuickReactionReadyEvent(BaseEvent):
    event_type: Literal["assistant.quick_reaction.ready"] = (
        "assistant.quick_reaction.ready"
    )
    payload: QuickReaction


class AssistantResponseChunkEvent(BaseEvent):
    event_type: Literal["assistant.response.chunk"] = "assistant.response.chunk"
    payload: ResponseTextChunk


class ToolCallRequestedEvent(BaseEvent):
    event_type: Literal["tool.call.requested"] = "tool.call.requested"
    payload: ToolCallRequest
    priority: EventPriority = EventPriority.HIGH


class ToolCallStartedEvent(BaseEvent):
    event_type: Literal["tool.call.started"] = "tool.call.started"
    payload: ToolCallStarted
    priority: EventPriority = EventPriority.HIGH


class ToolCallCompletedEvent(BaseEvent):
    event_type: Literal["tool.call.completed"] = "tool.call.completed"
    payload: ToolCallResult
    priority: EventPriority = EventPriority.HIGH


class ToolCallFailedEvent(BaseEvent):
    event_type: Literal["tool.call.failed"] = "tool.call.failed"
    payload: ToolCallFailure
    priority: EventPriority = EventPriority.HIGH


class ToolCallCancelledEvent(BaseEvent):
    event_type: Literal["tool.call.cancelled"] = "tool.call.cancelled"
    payload: ToolCallCancelled
    priority: EventPriority = EventPriority.HIGH


class TTSPlaybackStartedEvent(BaseEvent):
    event_type: Literal["tts.playback.started"] = "tts.playback.started"
    payload: PlaybackStarted
    priority: EventPriority = EventPriority.HIGH


class TTSPlaybackFinishedEvent(BaseEvent):
    event_type: Literal["tts.playback.finished"] = "tts.playback.finished"
    payload: PlaybackFinished
    priority: EventPriority = EventPriority.HIGH


class AssistantResponseCompletedEvent(BaseEvent):
    event_type: Literal["assistant.response.completed"] = (
        "assistant.response.completed"
    )
    payload: ResponseCompleted
    priority: EventPriority = EventPriority.HIGH


class TTSChunkStartedEvent(BaseEvent):
    event_type: Literal["tts.chunk.started"] = "tts.chunk.started"
    payload: ChunkPlaybackStarted
    priority: EventPriority = EventPriority.HIGH


class TTSChunkFinishedEvent(BaseEvent):
    event_type: Literal["tts.chunk.finished"] = "tts.chunk.finished"
    payload: ChunkPlaybackFinished
    priority: EventPriority = EventPriority.HIGH


class TTSChunkQueuedEvent(BaseEvent):
    event_type: Literal["tts.chunk.queued"] = "tts.chunk.queued"
    payload: TTSChunk


class RendererCommandIssuedEvent(BaseEvent):
    event_type: Literal["renderer.command.issued"] = "renderer.command.issued"
    payload: RendererCommand


class InterruptSignalEvent(BaseEvent):
    event_type: Literal["system.interrupt.signal"] = "system.interrupt.signal"
    payload: InterruptSignal
    priority: EventPriority = EventPriority.CRITICAL


class InterruptAppliedEvent(BaseEvent):
    event_type: Literal["system.interrupt.applied"] = "system.interrupt.applied"
    payload: InterruptApplied
    priority: EventPriority = EventPriority.CRITICAL


class SystemErrorRaisedEvent(BaseEvent):
    event_type: Literal["system.error.raised"] = "system.error.raised"
    payload: SystemErrorRaised
    priority: EventPriority = EventPriority.CRITICAL


class SystemResetRequestedEvent(BaseEvent):
    event_type: Literal["system.reset.requested"] = "system.reset.requested"
    payload: ResetRequested
    priority: EventPriority = EventPriority.HIGH


class SessionStateChangedEvent(BaseEvent):
    event_type: Literal["session.state.changed"] = "session.state.changed"
    payload: StateTransition


ProtocolEvent = Annotated[
    Union[
        UserSpeechStartEvent,
        UserSpeechPartialEvent,
        UserSpeechEndEvent,
        QuickReactionReadyEvent,
        AssistantResponseChunkEvent,
        ToolCallRequestedEvent,
        ToolCallStartedEvent,
        ToolCallCompletedEvent,
        ToolCallFailedEvent,
        ToolCallCancelledEvent,
        TTSPlaybackStartedEvent,
        TTSPlaybackFinishedEvent,
        AssistantResponseCompletedEvent,
        TTSChunkStartedEvent,
        TTSChunkFinishedEvent,
        TTSChunkQueuedEvent,
        RendererCommandIssuedEvent,
        InterruptSignalEvent,
        InterruptAppliedEvent,
        SystemErrorRaisedEvent,
        SystemResetRequestedEvent,
        SessionStateChangedEvent,
    ],
    Field(discriminator="event_type"),
]
