~~~md
# Echo Protocol Specification: Events

> Status: Draft v0.1  
> Scope: Core runtime event protocol and foundational data structures  
> Authority: This document is constrained by **《Echo AI 开发规范与工程宪法》** and is the source of truth for `packages/protocol/events.py`.

---

## 1. Purpose

This document defines the **canonical event protocol** for Echo.

Its goals are:

- give every core module a **single, strongly-typed event language**
- prevent ad-hoc `dict` payload passing between packages
- make all state transitions and streaming operations **traceable**
- reserve the necessary fields for:
  - interrupt control
  - chunk-level orchestration
  - cross-module replay/debugging
  - plugin-safe extensibility

This document covers:

- core enums
- `BaseEvent`
- `SessionState`
- chunk models (`ResponseTextChunk`, `TTSChunk`)
- core payload models
- core event models
- copyable Python skeleton for `packages/protocol/events.py`

This document does **not** yet define:

- plugin-specific event families
- memory-specific storage schemas
- renderer adapter implementation details
- transport protocol (WebSocket / queue / in-process bus)

Those belong in later specs.

---

## 2. Mandatory design decisions

### 2.1 Pydantic baseline
All protocol objects in this document use **Python 3.10+** and **Pydantic `BaseModel`** as the canonical representation.

Reason:

- validation is stricter than plain `dataclass`
- better JSON serialization/deserialization
- safer nested models
- better compatibility with event buses, logs, and future API boundaries

**Baseline target: Pydantic v2**.  
If the repository later chooses v1, syntax may be adapted, but the semantic contract of this document must remain unchanged.

---

### 2.2 `source` requirement: necessary adjustment
Original requirement: `source` should be an enum like “用户 / 系统 / 插件名”.

This is **not sufficient** for a real plugin-based system, because plugin names are an **open set**, not a closed enum.

Therefore this spec uses:

- `source_type: SourceType` → closed enum
- `source: str` → concrete source identifier

Examples:

- `source_type=user`, `source="user.microphone"`
- `source_type=system`, `source="system.orchestrator"`
- `source_type=plugin`, `source="plugin.mahjong"`
- `source_type=adapter`, `source="adapter.vts"`
- `source_type=test`, `source="test.integration"`

This preserves strong typing **and** extensibility.

---

### 2.3 Time standard
All timestamps must be:

- timezone-aware
- normalized to **UTC**
- stored as `datetime`

Naive datetimes are forbidden.

---

### 2.4 Event immutability
Event objects are **immutable snapshots**.

Once emitted, an event must not be mutated in place.

Reason:

- prevents state drift
- simplifies debugging and replay
- avoids subtle multi-window AI coding bugs

---

### 2.5 Unknown fields are forbidden
All protocol models must reject undeclared fields.

This prevents:

- silent schema drift
- typo-based bugs
- “AI guessed an extra field” style hallucinations

---

### 2.6 Canonical event naming
`event_type` must be a stable, dot-separated lowercase string.

Format:

`<domain>.<subject>.<action>`

Examples:

- `user.speech.start`
- `user.speech.partial`
- `user.speech.end`
- `assistant.quick_reaction.ready`
- `assistant.response.chunk`
- `tool.call.requested`
- `tool.call.completed`
- `tts.chunk.queued`
- `renderer.command.issued`
- `system.interrupt.signal`
- `session.state.changed`

This naming convention is mandatory.

---

## 3. Serialization and validation rules

### 3.1 UUID rules
The following identifiers must use UUID:

- `event_id`
- `trace_id`
- `session_id`
- `turn_id`
- `call_id`
- any stream or chunk group id where specified
- payload object ids where specified

Default generation rule: `uuid4()` unless created from persisted data.

---

### 3.2 Priority rules
Event priority is fixed to the following enum values:

- `low`
- `normal`
- `high`
- `critical`

This enum is locked.  
Any change requires RFC-level approval.

---

### 3.3 `source` string format
`source` must be a stable machine-readable identifier.

Recommended format:

- lowercase
- dot-separated
- no spaces

Examples:

- `system.orchestrator`
- `system.vad`
- `plugin.coding`
- `adapter.sensevoice`

---

### 3.4 Chunk interruption rules
Any streamable chunk model must provide enough information for the orchestrator to stop, skip, or truncate downstream playback.

Therefore all core chunk types must include at least:

- `chunk_index: int`
- `is_interruptible: bool`

This is mandatory.

---

### 3.5 Session state lock
The session status enum is locked to the following values:

- `idle`
- `listening`
- `thinking`
- `speaking`
- `interrupted`
- `error`

No implicit or undocumented status values are allowed.

---

### 3.6 Tool call correlation rules

For any tool lifecycle event family, the following fields must remain stable across the same logical call:

- `turn_id`
- `call_id`
- `step_index`
- `tool_name`

This is required for:

- replay
- timeout handling
- cancellation settlement
- late-result suppression

Late tool outcomes must never be rebound to a newer turn.

---

## 4. Canonical core enums

### 4.1 `EventPriority`
Used by scheduler, interrupt controller, and event routing.

Values:

- `low`
- `normal`
- `high`
- `critical`

---

### 4.2 `SourceType`
Closed enum for event origin category.

Values:

- `user`
- `system`
- `plugin`
- `adapter`
- `test`

---

### 4.3 `SessionStatus`
Closed enum for the Echo session lifecycle.

Values:

- `idle`
- `listening`
- `thinking`
- `speaking`
- `interrupted`
- `error`

---

### 4.4 `InterruptionPolicy`
Defines how a stream should be interrupted.

Values:

- `wait` — allow current chunk/segment to finish
- `replace` — stop current stream and replace with new output
- `cut_after_chunk` — allow playback only through a specific chunk index, then stop
- `crossfade` — optional future policy for smooth audio replacement

For MVP, implementations may support only `wait` and `replace`, but the enum is reserved now.

---

### 4.5 `RendererCommandType`
Closed enum for renderer commands emitted by protocol layer.

Values:

- `set_state`
- `set_expression`
- `set_motion`
- `set_mouth_open`
- `clear_expression`

---

### 4.6 `ToolErrorCode`
Closed enum for structured tool failure outcomes.

Values:

- `validation_error`
- `tool_not_found`
- `permission_denied`
- `timeout`
- `runtime_error`
- `interrupted`

---

## 5. Canonical core data structures

This section defines the minimum shared models used by runtime, orchestrator, TTS, renderer, and state tracking.

---

### 5.1 `BaseEvent`
Every event must contain:

- `event_id`
- `event_type`
- `timestamp`
- `trace_id`
- `session_id`
- `source_type`
- `source`
- `priority`
- `payload`

Strong tracing fields:

- `causation_event_id`: the event that directly caused this one
- `metadata`: non-critical structured metadata

`BaseEvent` is the root protocol envelope.

---

### 5.2 `EmotionTag`
Represents an emotion or expressive signal extracted from user input, quick reaction output, or LLM generation.

Fields:

- `name: str`
- `intensity: float` in `[0.0, 1.0]`

Examples:

- `smile`
- `thinking`
- `angry`
- `teasing`

This model is semantic only.  
Renderer-specific mapping belongs elsewhere.

---

### 5.3 `RecognizedUtterance`
Represents a speech recognition result.

Fields:

- `utterance_id`
- `text`
- `language`
- `confidence`
- `start_ms`
- `end_ms`
- `is_final`
- `emotion_tags`

This model is used for partial and final STT outputs.

---

### 5.4 `QuickReaction`
Represents the short, low-latency “alive” response emitted by the drafter path.

Fields:

- `reaction_id`
- `text`
- `emotion_tags`
- `is_interruptible`

Quick reaction must not contain strong factual commitments.  
Its role is latency masking and expressive responsiveness.

---

### 5.5 `ResponseTextChunk`
Represents a chunk from the assistant’s primary text stream.

Fields:

- `response_stream_id`
- `chunk_index`
- `text`
- `is_final`
- `is_interruptible`
- `emotion_tags`

This is the canonical text chunk before TTS conversion.

---

### 5.6 `TTSChunk`
Represents a unit of TTS work or playback material.

Fields:

- `tts_stream_id`
- `chunk_index`
- `text`
- `voice_style`
- `emotion_tags`
- `is_interruptible`

This object exists specifically so the orchestrator can cut or clear audio playback at chunk granularity.

---

### 5.7 `RendererCommand`
Represents a single renderer instruction.

Fields:

- `command_id`
- `command_type`
- `target`
- `value`
- `intensity`
- `duration_ms`
- `is_interruptible`

Examples:

- expression → `smile`
- motion → `nod`
- state → `thinking`
- mouth_open → `0.45`

---

### 5.8 `InterruptSignal`
Represents a high-priority instruction to stop, replace, or truncate streams.

Fields:

- `reason`
- `policy`
- `target_tts_stream_id`
- `target_response_stream_id`
- `cut_after_chunk_index`
- `clear_pending_tts`
- `clear_pending_renderer`

If `policy == cut_after_chunk`, `cut_after_chunk_index` is required.

---

### 5.9 `SessionState`
Canonical serializable snapshot of current session state.

This is **not** the entire in-memory runtime object.  
It is the protocol-level snapshot used for logs, events, debug panels, and safe cross-module sharing.

Fields:

- `session_id`
- `status`
- `active_scope`
- `current_trace_id`
- `current_user_utterance_id`
- `current_response_stream_id`
- `current_tts_stream_id`
- `last_event_id`
- `updated_at`

---

### 5.10 `StateTransition`
Represents a state machine transition.

Fields:

- `from_status`
- `to_status`
- `reason`
- `trigger_event_id`

Every state change event must carry this model.

---

### 5.11 `ToolCallRequest`
Represents a single requested tool execution.

Fields:

- `call_id`
- `turn_id`
- `step_index`
- `tool_name`
- `arguments`
- `requested_at`
- `timeout_ms`
- `idempotency_key`

Rules:

- `arguments` is intentionally open-shaped because tool-specific schemas are an open set
- the wrapper object itself must still remain strongly typed and immutable
- concrete `arguments` validation must happen against the selected tool schema before execution

---

### 5.12 `ToolCallStarted`
Represents the point where the execution boundary materially started a tool attempt.

Fields:

- `call_id`
- `turn_id`
- `step_index`
- `tool_name`
- `started_at`

---

### 5.13 `ToolCallResult`
Represents a successful tool outcome before or during reintegration into reasoning context.

Fields:

- `call_id`
- `turn_id`
- `step_index`
- `tool_name`
- `completed_at`
- `ok`
- `summary_text`
- `structured_data`
- `artifact_refs`
- `latency_ms`

Rules:

- `ok` must be fixed to `True`
- `summary_text` is the preferred textual observation form for reintegration
- large or non-text results should be referenced via `artifact_refs` instead of blindly inlined

---

### 5.14 `ToolCallFailure`
Represents an unsuccessful tool outcome.

Fields:

- `call_id`
- `turn_id`
- `step_index`
- `tool_name`
- `failed_at`
- `error_code`
- `error_message`
- `retryable`

Rules:

- ordinary tool failure does **not** by itself imply `system.error.raised`
- `error_code` must use the locked `ToolErrorCode` enum

---

### 5.15 `ToolCallCancelled`
Represents a tool call that stopped being relevant to active turn progression.

Fields:

- `call_id`
- `turn_id`
- `step_index`
- `tool_name`
- `cancelled_at`
- `reason`
- `superseded_by_turn_id`

Typical causes:

- user interruption
- reset
- explicit task cancellation

---

### 5.16 `ToolObservation`
Represents the normalized observation appended back into reasoning context.

Fields:

- `call_id`
- `tool_name`
- `step_index`
- `observation_text`
- `ok`
- `structured_data`
- `error_code`
- `artifact_refs`

Rules:

- the reasoner should consume `ToolObservation`, not arbitrary executor internals
- raw tool output must not be treated as directly user-visible assistant text

---

### 5.17 `PlaybackStarted`
Represents the moment a TTS stream materially begins audible playback.

Fields:

- `tts_stream_id`
- `chunk_index`
- `is_interruptible`

---

### 5.18 `PlaybackFinished`
Represents the moment a TTS stream materially finishes playback.

Fields:

- `tts_stream_id`
- `last_chunk_index`
- `reason`

Rules:

- this event is about actual playback completion, not merely queue exhaustion

---

### 5.19 `ResponseCompleted`
Represents the moment a primary response stream has no more response text to emit.

Fields:

- `response_stream_id`
- `final_chunk_index`
- `had_output`

Rules:

- this event does **not** by itself imply that playback already started
- it is valid for a response to complete without ever entering `speaking`

---

### 5.20 `InterruptApplied`
Represents the barrier point where an interrupt has been materially reconciled.

Fields:

- `reason`
- `playback_stopped`
- `pending_tts_cleared`
- `pending_renderer_cleared`
- `reasoning_cancelled`
- `new_user_input_active`

Rules:

- this event means the interrupt is no longer merely requested
- state resolution out of `interrupted` must wait for this barrier event

---

### 5.21 `SystemErrorRaised`
Represents a protocol-level or runtime-level error outcome.

Fields:

- `error_code`
- `message`
- `is_session_blocking`
- `details`

Rules:

- only session-blocking or protocol-breaking failures should normally drive session state into `error`
- ordinary tool failures should remain represented by `tool.call.failed`, not by this model

---

### 5.22 `ResetRequested`
Represents an explicit request to reset the active session turn state.

Fields:

- `reason`
- `drop_pending_output`
- `drop_pending_input`

---

### 5.23 `ChunkPlaybackStarted`
Represents the moment a specific TTS chunk materially begins audible playback.

Fields:

- `tts_stream_id`
- `chunk_index`
- `is_interruptible`

Rules:

- this event exists for chunk-boundary handoff and interruption accounting
- it must not be inferred solely from queue order

---

### 5.24 `ChunkPlaybackFinished`
Represents the moment a specific TTS chunk materially finishes audible playback.

Fields:

- `tts_stream_id`
- `chunk_index`

Rules:

- this event is the canonical safe-boundary signal for `cut_after_chunk` style handoff
- if a chunk does not finish materially, this event must not be fabricated

---

## 6. Canonical event families in scope for the current protocol surface

The following event families are defined in this file:

### User speech events
- `user.speech.start`
- `user.speech.partial`
- `user.speech.end`

### Assistant output events
- `assistant.quick_reaction.ready`
- `assistant.response.chunk`

### Tool lifecycle events
- `tool.call.requested`
- `tool.call.started`
- `tool.call.completed`
- `tool.call.failed`
- `tool.call.cancelled`

### Playback lifecycle events
- `tts.playback.started`
- `tts.playback.finished`
- `assistant.response.completed`

### Chunk playback lifecycle events
- `tts.chunk.started`
- `tts.chunk.finished`

### Downstream execution events
- `tts.chunk.queued`
- `renderer.command.issued`

### Control/system events
- `system.interrupt.signal`
- `system.interrupt.applied`
- `system.error.raised`
- `system.reset.requested`
- `session.state.changed`

This document now covers both:

- the original MVP core event surface
- the bounded v0.1 tool-aware reasoning extension

---

## 7. Copyable Python skeleton for `packages/protocol/events.py`

> This code is intentionally close to production skeleton quality.  
> It is allowed to copy this into `packages/protocol/events.py` and refine imports/tests around it.  
> Any semantic change must be reflected back into this document.

```python
from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Literal, Union
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ============================================================
# Base model config
# ============================================================

SOURCE_PATTERN = re.compile(r"^[a-z0-9]+([._-][a-z0-9]+)*$")


class EchoProtocolModel(BaseModel):
    """
    Base class for all protocol models.

    Rules:
    - extra fields forbidden
    - immutable after creation
    - strings trimmed
    """
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


# ============================================================
# Enums
# ============================================================

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


# ============================================================
# Shared payload/data models
# ============================================================

class EmotionTag(EchoProtocolModel):
    name: str = Field(min_length=1, max_length=64)
    intensity: float = Field(ge=0.0, le=1.0)


class RecognizedUtterance(EchoProtocolModel):
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
        if self.start_ms is not None and self.end_ms is not None:
            if self.end_ms < self.start_ms:
                raise ValueError("end_ms must be >= start_ms")
        return self


class QuickReaction(EchoProtocolModel):
    reaction_id: UUID = Field(default_factory=uuid4)
    text: str = Field(min_length=1)
    emotion_tags: list[EmotionTag] = Field(default_factory=list)
    is_interruptible: bool = True


class ResponseTextChunk(EchoProtocolModel):
    response_stream_id: UUID = Field(default_factory=uuid4)
    chunk_index: int = Field(ge=0)
    text: str = Field(min_length=1)
    is_final: bool = False
    is_interruptible: bool = True
    emotion_tags: list[EmotionTag] = Field(default_factory=list)


class TTSChunk(EchoProtocolModel):
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
        if self.policy == InterruptionPolicy.CUT_AFTER_CHUNK and self.cut_after_chunk_index is None:
            raise ValueError("cut_after_chunk_index is required when policy='cut_after_chunk'")
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
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("requested_at must be timezone-aware")
        return value.astimezone(timezone.utc)


class ToolCallStarted(EchoProtocolModel):
    call_id: UUID
    turn_id: UUID
    step_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("started_at")
    @classmethod
    def ensure_started_at_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("started_at must be timezone-aware")
        return value.astimezone(timezone.utc)


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
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("completed_at must be timezone-aware")
        return value.astimezone(timezone.utc)


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
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("failed_at must be timezone-aware")
        return value.astimezone(timezone.utc)


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
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("cancelled_at must be timezone-aware")
        return value.astimezone(timezone.utc)


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
    is_interruptible: bool = True


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
    details: dict[str, Any] = Field(default_factory=dict)


class ResetRequested(EchoProtocolModel):
    reason: str = Field(min_length=1, max_length=256)
    drop_pending_output: bool = True
    drop_pending_input: bool = False


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
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("updated_at must be timezone-aware")
        return value.astimezone(timezone.utc)


# ============================================================
# Event envelope
# ============================================================

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
    payload: dict[str, Any] | EchoProtocolModel
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timestamp")
    @classmethod
    def ensure_timestamp_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must be timezone-aware")
        return value.astimezone(timezone.utc)

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        if not SOURCE_PATTERN.match(value):
            raise ValueError(
                "source must be lowercase machine-readable identifier, "
                "e.g. 'system.orchestrator' or 'plugin.mahjong'"
            )
        return value


# ============================================================
# Concrete events
# ============================================================

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
    event_type: Literal["assistant.quick_reaction.ready"] = "assistant.quick_reaction.ready"
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


class TTSChunkStartedEvent(BaseEvent):
    event_type: Literal["tts.chunk.started"] = "tts.chunk.started"
    payload: ChunkPlaybackStarted
    priority: EventPriority = EventPriority.HIGH


class TTSChunkFinishedEvent(BaseEvent):
    event_type: Literal["tts.chunk.finished"] = "tts.chunk.finished"
    payload: ChunkPlaybackFinished
    priority: EventPriority = EventPriority.HIGH


class AssistantResponseCompletedEvent(BaseEvent):
    event_type: Literal["assistant.response.completed"] = "assistant.response.completed"
    payload: ResponseCompleted
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


# ============================================================
# Discriminated union for event parsing
# ============================================================

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
        TTSChunkStartedEvent,
        TTSChunkFinishedEvent,
        AssistantResponseCompletedEvent,
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
~~~

------

## 8. Event-by-event semantic contract

This section defines how each event should be interpreted by the runtime.

------

### 8.1 `user.speech.start`

Meaning:

- VAD or upstream speech detector has recognized the start of a user utterance.

Typical source:

- `system.vad`
- `adapter.microphone`

Priority:

- normally `high`

Must not imply:

- final ASR content is available

------

### 8.2 `user.speech.partial`

Meaning:

- a partial STT hypothesis is available

Typical use:

- update UI transcript
- assist listening animation
- optionally prime drafter context, but not finalize orchestration yet

Must not trigger:

- full main reasoning by itself, unless a future RFC explicitly allows it

------

### 8.3 `user.speech.end`

Meaning:

- the utterance is considered final enough for orchestration
- this is the canonical trigger for:
  - quick reaction
  - primary reasoning
  - session transition into `thinking` or equivalent downstream pipeline

This event is one of the most important runtime triggers.

------

### 8.4 `assistant.quick_reaction.ready`

Meaning:

- drafter/local fast path has produced a short response

Must be:

- low-latency
- lightweight
- interruptible by design

Must not be used for:

- high-risk factual commitment
- final long-form answer

------

### 8.5 `assistant.response.chunk`

Meaning:

- a chunk from the primary response stream is available

This is pre-TTS text-level streaming.

It must be safe for:

- chunked TTS conversion
- expression parsing
- interruption at chunk boundaries

------

### 8.6 `tool.call.requested`

Meaning:

- the reasoning loop has emitted a structured request for one tool execution

This event is the canonical boundary between:

- tool decision
- tool execution

Typical source:

- `system.primary_reasoner`
- `system.orchestrator`

------

### 8.7 `tool.call.started`

Meaning:

- the constrained execution boundary materially started attempting the requested tool

This event is important for:

- timeout accounting
- audit visibility
- replay

------

### 8.8 `tool.call.completed`

Meaning:

- the tool produced a successful structured outcome

This event must not imply:

- the raw tool result is directly user-visible
- the session should leave `thinking`

The successful outcome must still be normalized into a reasoning observation before reintegration.

------

### 8.9 `tool.call.failed`

Meaning:

- the tool attempt failed with a structured, non-ambiguous failure outcome

This event does **not** by itself imply:

- `system.error.raised`

Ordinary failure should usually remain recoverable at the reasoning level.

------

### 8.10 `tool.call.cancelled`

Meaning:

- the active turn stopped waiting for the tool because the call was invalidated by interruption, reset, or task cancellation

This event exists to distinguish:

- active cancellation
- ordinary failure
- successful completion

Late results after cancellation must not be rebound to active turn progression.

------

### 8.11 `tts.chunk.queued`

Meaning:

- a chunk has been accepted into the TTS/output pipeline

This event is emitted after text chunking / style annotation, not before.

This event is essential for:

- queue introspection
- interruption correctness
- playback debugging

------

### 8.12 `renderer.command.issued`

Meaning:

- renderer-facing command has been produced and accepted downstream

This event is the protocol-level boundary before adapter-specific rendering.

------

### 8.13 `system.interrupt.signal`

Meaning:

- current output must be stopped, replaced, or truncated

This is the authoritative interrupt control event.

Typical triggers:

- user starts speaking again
- higher priority command arrives
- explicit “stop / shut up / wait” style input
- orchestration policy decides to preempt lower-priority playback

Priority should normally be `critical`.

------

### 8.14 `session.state.changed`

Meaning:

- state machine moved from one canonical session status to another

Every state transition must be represented explicitly.

No hidden state changes are allowed.

------

### 8.15 `tts.playback.started`

Meaning:

- a TTS stream has materially begun audible playback

This event is the canonical trigger for entering `speaking`.

It must not be emitted merely because:

- text exists
- TTS work was queued
- synthesis finished but playback has not begun

------

### 8.16 `tts.playback.finished`

Meaning:

- a TTS stream has materially finished playback

This event is the canonical playback-finished signal used by:

- state reconciliation
- end-of-turn settlement
- interruption cleanup

------

### 8.17 `assistant.response.completed`

Meaning:

- the primary response text stream is fully exhausted and no more response chunks remain to be emitted

This event is about response generation completion, not guaranteed playback completion.

It may occur:

- before any audible playback starts
- while playback is still pending downstream

------

### 8.18 `system.interrupt.applied`

Meaning:

- the material effects of interruption have been reconciled enough for the system to leave the interrupt barrier

This event is not equivalent to:

- `system.interrupt.signal`

`system.interrupt.signal` requests interruption.  
`system.interrupt.applied` confirms that interruption effects were materially applied.

------

### 8.19 `system.error.raised`

Meaning:

- a protocol-level or runtime-level error outcome has been raised explicitly

This event should carry whether the error is session-blocking.

Not every ordinary subsystem failure belongs here.

------

### 8.20 `system.reset.requested`

Meaning:

- the session was asked to clear the active turn flow and reconcile back toward a clean baseline

Typical causes:

- explicit reset command
- operator/debug action
- recovery path after unrecoverable turn drift

------

### 8.21 `tts.chunk.started`

Meaning:

- a specific queued TTS chunk has materially begun audible playback

This event is important for:

- chunk-boundary handoff
- safe interrupt timing
- playback progress debugging

It must not be inferred from queue order alone.

------

### 8.22 `tts.chunk.finished`

Meaning:

- a specific playing TTS chunk has materially finished audible playback

This event is the canonical safe-boundary signal for:

- `cut_after_chunk`
- quick-reaction to primary handoff
- exact pending-chunk accounting

It must not be emitted if the chunk did not materially finish.

------

## 9. Required implementation rules

### 9.1 Event emission rules

Every emitted event must:

- have valid UUIDs
- carry a valid `trace_id`
- carry the correct `session_id`
- use canonical `event_type`
- use correct `source_type` and `source`
- pass Pydantic validation before entering the bus

No “best effort” malformed event emission is allowed.

------

### 9.2 Traceability rules

For any event that is a direct consequence of another event, `causation_event_id` should be set.

Examples:

- `assistant.quick_reaction.ready` caused by `user.speech.end`
- `tool.call.started` caused by `tool.call.requested`
- `tool.call.completed` caused by `tool.call.started`
- `tool.call.cancelled` caused by `system.interrupt.signal`
- `tts.chunk.started` caused by `tts.chunk.queued`
- `tts.chunk.finished` caused by `tts.chunk.started`
- `tts.chunk.queued` caused by `assistant.response.chunk`
- `session.state.changed` caused by `system.interrupt.signal`

This is strongly recommended for replay/debugging.

------

### 9.3 Tool lifecycle consistency rules

For one logical tool call:

- exactly one `tool.call.requested` must exist before settlement
- `tool.call.started` may occur at most once
- exactly one terminal event may occur:
  - `tool.call.completed`
  - `tool.call.failed`
  - `tool.call.cancelled`

Terminal events are mutually exclusive.

If a tool call is cancelled because the active turn was superseded:

- late results may be logged or persisted
- but they must not be consumed as valid active-turn observations

------

### 9.4 Session state rules

`SessionState` is a snapshot object, not the runtime engine itself.

Allowed uses:

- event payloads
- debug UI
- structured logs
- tests
- replay tools

Disallowed use:

- stuffing arbitrary mutable runtime internals into it

------

### 9.5 Extension rules

Future modules may add new events, but must follow all of the following:

- inherit from `BaseEvent`
- use dot-separated lowercase `event_type`
- define a typed `payload`
- not reuse existing `event_type` with different semantics
- not modify canonical enums without RFC approval

------

## 10. Example event instances

### 10.1 Example: final user speech event

```python
from uuid import uuid4

trace_id = uuid4()
session_id = uuid4()

evt = UserSpeechEndEvent(
    trace_id=trace_id,
    session_id=session_id,
    source_type=SourceType.SYSTEM,
    source="system.stt",
    priority=EventPriority.HIGH,
    payload=RecognizedUtterance(
        text="你看这个报错",
        language="zh",
        confidence=0.97,
        start_ms=0,
        end_ms=1840,
        is_final=True,
        emotion_tags=[EmotionTag(name="frustrated", intensity=0.62)],
    ),
)
```

------

### 10.2 Example: interrupt signal

```python
interrupt_evt = InterruptSignalEvent(
    trace_id=trace_id,
    session_id=session_id,
    source_type=SourceType.SYSTEM,
    source="system.orchestrator",
    payload=InterruptSignal(
        reason="user started speaking again",
        policy=InterruptionPolicy.REPLACE,
        target_tts_stream_id=None,
        clear_pending_tts=True,
        clear_pending_renderer=True,
    ),
)
```

------

### 10.3 Example: TTS chunk

```python
tts_evt = TTSChunkQueuedEvent(
    trace_id=trace_id,
    session_id=session_id,
    source_type=SourceType.SYSTEM,
    source="system.tts_router",
    payload=TTSChunk(
        chunk_index=3,
        text="等等，我先看看这个空指针。",
        voice_style="teasing",
        emotion_tags=[EmotionTag(name="thinking", intensity=0.45)],
        is_interruptible=True,
    ),
)
```

------

## 11. Non-negotiable guardrails for AI-generated code

Any AI coding assistant implementing `packages/protocol/events.py` must obey the following:

- do **not** replace Pydantic with plain dicts
- do **not** weaken enums into free-form strings
- do **not** remove `chunk_index` or `is_interruptible`
- do **not** allow naive datetimes
- do **not** make `source` a raw unvalidated blob
- do **not** introduce implicit state values outside `SessionStatus`
- do **not** silently add undeclared fields to protocol models
- do **not** collapse multiple event types into a single generic event with ambiguous payload
- do **not** emit tool lifecycle events without stable `turn_id` / `call_id` / `step_index`
- do **not** treat raw tool results as directly user-visible assistant text
- do **not** fabricate `tts.chunk.finished` for a chunk that never materially played to completion
- do **not** encode business logic inside protocol models beyond validation

------

## 12. Recommended next files after this spec

After this file is accepted, the next protocol/design files should be written in this order:

1. `docs/protocol/state-machine.md`
2. `docs/protocol/feedback-rules.md`
3. `docs/protocol/orchestrator-spec.md`
4. `docs/protocol/renderer-commands.md`

This order is recommended because event semantics depend on state semantics, and orchestration depends on both.

------

## 13. Acceptance checklist

This document is considered implemented correctly only if:

-  `packages/protocol/events.py` matches these definitions
-  all enums are present and locked
-  `BaseEvent` exists with required traceability fields
-  `SessionState` exists as typed snapshot model
-  chunk models include interruption control fields
-  tool lifecycle payload models exist with locked failure codes
-  `tool.call.*` event classes exist with typed payload models
-  chunk playback lifecycle event classes exist for precise handoff accounting
-  concrete event classes use typed payload models
-  a discriminated union for parsing exists
-  tests verify timestamp/source/interruption validation rules
