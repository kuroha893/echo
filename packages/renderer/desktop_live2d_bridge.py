from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import os
from collections import deque
from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Protocol, runtime_checkable
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4

from pydantic import Field, field_validator, model_validator

from packages.protocol.events import RendererCommandType
from packages.renderer.adapter_ports import (
    RendererAdapterPort,
    validate_request_against_capabilities,
)
from packages.renderer.errors import (
    RendererAdapterExecutionError,
    build_malformed_response_error,
    build_renderer_error,
    raise_adapter_error,
    wrap_adapter_exception,
)
from packages.renderer.models import (
    KEY_PATTERN,
    RendererAdapterCapabilities,
    RendererAdapterDescriptor,
    RendererAdapterErrorCode,
    RendererAdapterFailure,
    RendererDispatchOutcome,
    RendererDispatchResult,
    RendererModel,
    RendererResolvedDispatchRequest,
)


DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION = "echo.desktop-live2d.bridge.v1"
APP_OWNED_MODEL_PREFIX = "apps/desktop-live2d/assets/models/"


class DesktopLive2DAppLaunchMode(StrEnum):
    NODE_BRIDGE = "node_bridge"
    ELECTRON_APP = "electron_app"


class DesktopLive2DBridgeCommand(StrEnum):
    PING = "ping"
    INITIALIZE = "initialize"
    DISPATCH_COMMAND = "dispatch_command"
    AUDIO_PLAYBACK_FRAGMENT = "audio_playback_fragment"
    AUDIO_PLAYBACK_ABORT = "audio_playback_abort"
    AUDIO_PLAYBACK_SNAPSHOT = "audio_playback_snapshot"
    COMPANION_SESSION_UPSERT_TRANSCRIPT = "companion_session_upsert_transcript"
    COMPANION_SESSION_SNAPSHOT = "companion_session_snapshot"
    COMPANION_SESSION_ENQUEUE_INPUT = "companion_session_enqueue_input"
    COMPANION_SESSION_DRAIN_INPUT = "companion_session_drain_input"
    BUBBLE_REPLACE = "bubble_replace"
    BUBBLE_APPEND = "bubble_append"
    BUBBLE_CLEAR = "bubble_clear"
    BUBBLE_SNAPSHOT = "bubble_snapshot"
    SHUTDOWN = "shutdown"


class DesktopLive2DBridgeResponseStatus(StrEnum):
    OK = "ok"
    ERROR = "error"


class DesktopLive2DBridgeErrorCode(StrEnum):
    INVALID_REQUEST = "invalid_request"
    INVALID_MODEL_ASSET = "invalid_model_asset"
    NOT_INITIALIZED = "not_initialized"
    UNSUPPORTED_COMMAND = "unsupported_command"
    UNSUPPORTED_TARGET = "unsupported_target"
    ADAPTER_UNAVAILABLE = "adapter_unavailable"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    PROTOCOL_ERROR = "protocol_error"
    INTERNAL_APP_ERROR = "internal_app_error"


class DesktopLive2DPresentationMode(StrEnum):
    FULL_BODY = "full_body"


class DesktopLive2DWindowSurface(StrEnum):
    CHARACTER_WINDOW = "character_window"


class DesktopLive2DAudioPlaybackOwner(StrEnum):
    QUICK_REACTION = "quick_reaction"
    PRIMARY_RESPONSE = "primary_response"


class DesktopLive2DAudioBridgeMediaType(StrEnum):
    WAV = "audio/wav"
    PCM_S16LE = "audio/pcm;encoding=s16le"
    MP3 = "audio/mpeg"
    OGG_OPUS = "audio/ogg;codecs=opus"


class DesktopLive2DAudioPlaybackReportKind(StrEnum):
    ACCEPTED = "accepted"
    STARTED = "started"
    FINISHED = "finished"
    ABORTED = "aborted"
    FAILED = "failed"


class DesktopLive2DCompanionTranscriptRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class DesktopLive2DBridgeModel(RendererModel):
    pass


def normalize_repo_relative_asset_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    if not normalized:
        raise ValueError("repo_relative_model_json_path must not be blank")
    path = PurePosixPath(normalized)
    if path.is_absolute():
        raise ValueError("repo_relative_model_json_path must be relative")
    if any(part in ("", ".", "..") for part in path.parts):
        raise ValueError("repo_relative_model_json_path must not contain '.', '..', or empty parts")
    normalized = path.as_posix()
    if not normalized.startswith(APP_OWNED_MODEL_PREFIX):
        raise ValueError(
            "repo_relative_model_json_path must stay under apps/desktop-live2d/assets/models/"
        )
    if not normalized.endswith(".json"):
        raise ValueError("repo_relative_model_json_path must point to a .json asset")
    return normalized


def resolve_repo_owned_model_json_path(
    *,
    workspace_root: Path | str,
    model_asset: "DesktopLive2DModelAssetRef",
) -> Path:
    root = Path(workspace_root)
    resolved = (root / model_asset.repo_relative_model_json_path).resolve()
    app_assets_root = (root / APP_OWNED_MODEL_PREFIX).resolve()
    try:
        resolved.relative_to(app_assets_root)
    except ValueError as exc:  # pragma: no cover - model validation already blocks this
        raise ValueError("resolved model asset escaped apps/desktop-live2d/assets/models") from exc
    return resolved


def normalize_reported_model_json_path(value: str) -> Path:
    normalized = value.strip()
    if not normalized:
        raise ValueError("resolved_model_json_path must not be blank")
    if os.name == "nt":
        windows_path_like = normalized.replace("/", "\\")
        if len(windows_path_like) >= 3 and windows_path_like[1] == ":" and windows_path_like[2] == "\\":
            return Path(windows_path_like).resolve(strict=False)
    parsed = urlsplit(normalized)
    if parsed.scheme:
        if parsed.scheme != "file":
            raise ValueError("resolved_model_json_path must be a local file path")
        normalized = unquote(parsed.path)
        if os.name == "nt" and len(normalized) >= 3 and normalized[0] == "/" and normalized[2] == ":":
            normalized = normalized[1:]
    return Path(normalized).resolve(strict=False)


class DesktopLive2DModelAssetRef(DesktopLive2DBridgeModel):
    model_key: str = Field(min_length=1, max_length=128)
    repo_relative_model_json_path: str
    display_name: str = Field(min_length=1, max_length=128)
    presentation_mode: DesktopLive2DPresentationMode = DesktopLive2DPresentationMode.FULL_BODY
    window_surface: DesktopLive2DWindowSurface = DesktopLive2DWindowSurface.CHARACTER_WINDOW

    @field_validator("repo_relative_model_json_path")
    @classmethod
    def validate_repo_relative_model_json_path(cls, value: str) -> str:
        return normalize_repo_relative_asset_path(value)


class DesktopLive2DAppLaunchEnvVar(DesktopLive2DBridgeModel):
    key: str = Field(min_length=1, max_length=128)
    value: str = Field(max_length=4000)

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("launch environment variable key must not be blank")
        return stripped


class DesktopLive2DAppLaunchConfig(DesktopLive2DBridgeModel):
    mode: DesktopLive2DAppLaunchMode = DesktopLive2DAppLaunchMode.NODE_BRIDGE
    executable: str = Field(min_length=1, max_length=512)
    arguments: tuple[str, ...] = ()
    working_directory: str = Field(min_length=1, max_length=1024)
    environment_overrides: tuple[DesktopLive2DAppLaunchEnvVar, ...] = ()
    startup_timeout_ms: int = Field(default=4000, gt=0)
    request_timeout_ms: int = Field(default=4000, gt=0)

    @field_validator("executable", "working_directory")
    @classmethod
    def validate_non_blank_path_like(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("path-like launch fields must not be blank")
        return stripped

    @field_validator("arguments", mode="before")
    @classmethod
    def normalize_arguments(cls, value: object) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("environment_overrides", mode="before")
    @classmethod
    def normalize_environment_overrides(
        cls,
        value: object,
    ) -> tuple[DesktopLive2DAppLaunchEnvVar, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]


class DesktopLive2DBridgeConfig(DesktopLive2DBridgeModel):
    adapter_key: str = Field(default="desktop.live2d", pattern=KEY_PATTERN)
    display_name: str = Field(default="Desktop Live2D", min_length=1, max_length=128)
    workspace_root: str = Field(min_length=1, max_length=1024)
    launch: DesktopLive2DAppLaunchConfig
    model_asset: DesktopLive2DModelAssetRef
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    stderr_buffer_line_limit: int = Field(default=64, ge=8, le=1024)
    supported_targets: tuple[str, ...] = (
        "state",
        "expression",
        "motion",
        "avatar.state",
        "avatar.expression",
        "avatar.face",
        "avatar.motion",
    )

    @field_validator("workspace_root")
    @classmethod
    def validate_workspace_root(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("workspace_root must not be blank")
        return stripped

    @field_validator("supported_targets", mode="before")
    @classmethod
    def normalize_supported_targets(cls, value: object) -> tuple[str, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("supported_targets")
    @classmethod
    def validate_supported_targets(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(dict.fromkeys(target.strip() for target in value))
        if any(not target for target in normalized):
            raise ValueError("supported_targets must not contain blank values")
        return normalized

    @model_validator(mode="after")
    def validate_model_asset_under_workspace(self) -> "DesktopLive2DBridgeConfig":
        resolve_repo_owned_model_json_path(
            workspace_root=self.workspace_root,
            model_asset=self.model_asset,
        )
        return self


class DesktopLive2DPingRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.PING


class DesktopLive2DInitializeRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.INITIALIZE
    model_asset: DesktopLive2DModelAssetRef
    full_body_required: bool = True


class DesktopLive2DDispatchCommandRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.DISPATCH_COMMAND
    adapter_key: str = Field(pattern=KEY_PATTERN)
    adapter_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    command_id: UUID
    command_type: RendererCommandType
    target: str = Field(min_length=1, max_length=128)
    value: str | float | int | bool
    intensity: float | None = None
    duration_ms: int | None = Field(default=None, gt=0)
    is_interruptible: bool


class DesktopLive2DAudioPlaybackFragmentRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.AUDIO_PLAYBACK_FRAGMENT
    )
    session_id: UUID
    trace_id: UUID
    turn_id: UUID
    owner: DesktopLive2DAudioPlaybackOwner
    tts_stream_id: UUID
    chunk_index: int = Field(ge=0)
    tts_text: str = Field(min_length=1, max_length=4000)
    is_interruptible: bool
    fragment_index: int = Field(ge=0)
    audio_bytes_base64: str = Field(min_length=1, max_length=8_000_000)
    sample_rate_hz: int = Field(gt=0)
    channel_count: int = Field(gt=0, le=8)
    is_final: bool
    media_type: DesktopLive2DAudioBridgeMediaType | None = None


class DesktopLive2DAudioPlaybackAbortRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.AUDIO_PLAYBACK_ABORT
    )
    session_id: UUID
    trace_id: UUID
    turn_id: UUID
    owner: DesktopLive2DAudioPlaybackOwner
    tts_stream_id: UUID
    chunk_index: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=256)


class DesktopLive2DAudioPlaybackSnapshotRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.AUDIO_PLAYBACK_SNAPSHOT
    )


class DesktopLive2DCompanionSessionUpsertTranscriptRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.COMPANION_SESSION_UPSERT_TRANSCRIPT
    )
    session_id: UUID
    turn_id: UUID
    role: DesktopLive2DCompanionTranscriptRole
    text: str = Field(min_length=1, max_length=8000)
    raw_text: str = Field(default="", max_length=16000)
    is_streaming: bool


class DesktopLive2DCompanionSessionSnapshotRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.COMPANION_SESSION_SNAPSHOT
    )


class DesktopLive2DCompanionSessionEnqueueInputRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.COMPANION_SESSION_ENQUEUE_INPUT
    )
    session_id: UUID
    text: str = Field(min_length=1, max_length=4000)


class DesktopLive2DCompanionSessionDrainInputRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = (
        DesktopLive2DBridgeCommand.COMPANION_SESSION_DRAIN_INPUT
    )
    session_id: UUID


class DesktopLive2DBubbleReplaceRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.BUBBLE_REPLACE
    bubble_text: str = Field(min_length=1, max_length=4000)
    speaker_label: str = Field(default="Echo", min_length=1, max_length=64)
    is_streaming: bool = True


class DesktopLive2DBubbleAppendRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.BUBBLE_APPEND
    text_fragment: str = Field(min_length=1, max_length=2000)
    speaker_label: str | None = Field(default=None, min_length=1, max_length=64)
    is_streaming: bool = True


class DesktopLive2DBubbleClearRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.BUBBLE_CLEAR
    reason: str = Field(default="bubble cleared", min_length=1, max_length=512)


class DesktopLive2DBubbleSnapshotRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.BUBBLE_SNAPSHOT


class DesktopLive2DShutdownRequest(DesktopLive2DBridgeModel):
    protocol_version: str = Field(
        default=DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
        min_length=1,
        max_length=128,
    )
    request_id: UUID
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.SHUTDOWN
    reason: str = Field(default="renderer adapter shutdown", min_length=1, max_length=512)


DesktopLive2DBridgeRequest = (
    DesktopLive2DPingRequest
    | DesktopLive2DInitializeRequest
    | DesktopLive2DDispatchCommandRequest
    | DesktopLive2DAudioPlaybackFragmentRequest
    | DesktopLive2DAudioPlaybackAbortRequest
    | DesktopLive2DAudioPlaybackSnapshotRequest
    | DesktopLive2DCompanionSessionUpsertTranscriptRequest
    | DesktopLive2DCompanionSessionSnapshotRequest
    | DesktopLive2DCompanionSessionEnqueueInputRequest
    | DesktopLive2DCompanionSessionDrainInputRequest
    | DesktopLive2DBubbleReplaceRequest
    | DesktopLive2DBubbleAppendRequest
    | DesktopLive2DBubbleClearRequest
    | DesktopLive2DBubbleSnapshotRequest
    | DesktopLive2DShutdownRequest
)


class DesktopLive2DPingResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.PING
    protocol_version: str = Field(min_length=1, max_length=128)
    app_name: str = Field(min_length=1, max_length=128)


class DesktopLive2DInitializeResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.INITIALIZE
    model_key: str = Field(min_length=1, max_length=128)
    resolved_model_json_path: str = Field(min_length=1, max_length=2048)
    presentation_mode: DesktopLive2DPresentationMode
    window_surface: DesktopLive2DWindowSurface


class DesktopLive2DDispatchCommandResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.DISPATCH_COMMAND
    command_id: UUID
    command_type: RendererCommandType
    adapter_key: str = Field(pattern=KEY_PATTERN)
    adapter_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    outcome: RendererDispatchOutcome
    message: str | None = Field(default=None, min_length=1, max_length=4000)


class DesktopLive2DAudioPlaybackReport(DesktopLive2DBridgeModel):
    report_kind: DesktopLive2DAudioPlaybackReportKind
    owner: DesktopLive2DAudioPlaybackOwner
    session_id: UUID
    trace_id: UUID
    turn_id: UUID
    tts_stream_id: UUID
    chunk_index: int = Field(ge=0)
    fragment_index: int | None = Field(default=None, ge=0)
    is_interruptible: bool | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=256)
    message: str | None = Field(default=None, min_length=1, max_length=4000)


class DesktopLive2DAudioPlaybackSnapshot(DesktopLive2DBridgeModel):
    owner: DesktopLive2DAudioPlaybackOwner | None = None
    session_id: UUID | None = None
    trace_id: UUID | None = None
    turn_id: UUID | None = None
    tts_stream_id: UUID | None = None
    chunk_index: int | None = Field(default=None, ge=0)
    playback_active: bool = False
    buffered_fragment_count: int = Field(ge=0)
    final_fragment_received: bool = False
    last_report_kind: DesktopLive2DAudioPlaybackReportKind | None = None
    last_reason: str | None = Field(default=None, min_length=1, max_length=256)


class DesktopLive2DAudioPlaybackResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand
    playback_snapshot: DesktopLive2DAudioPlaybackSnapshot
    reports: tuple[DesktopLive2DAudioPlaybackReport, ...] = ()


class DesktopLive2DCompanionTranscriptEntry(DesktopLive2DBridgeModel):
    entry_id: UUID
    session_id: UUID
    turn_id: UUID
    role: DesktopLive2DCompanionTranscriptRole
    text: str = Field(min_length=1, max_length=8000)
    raw_text: str = Field(default="", max_length=16000)
    is_streaming: bool
    sequence_index: int = Field(ge=0)


class DesktopLive2DCompanionPendingInput(DesktopLive2DBridgeModel):
    input_id: UUID
    session_id: UUID
    text: str = Field(min_length=1, max_length=4000)
    queue_index: int = Field(ge=0)


class DesktopLive2DCompanionSessionSnapshot(DesktopLive2DBridgeModel):
    session_id: UUID | None = None
    transcript_entries: tuple[DesktopLive2DCompanionTranscriptEntry, ...] = ()
    pending_input_count: int = Field(ge=0)
    latest_turn_id: UUID | None = None


class DesktopLive2DCompanionSessionResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand
    companion_session_snapshot: DesktopLive2DCompanionSessionSnapshot
    drained_inputs: tuple[DesktopLive2DCompanionPendingInput, ...] = ()


class DesktopLive2DBubbleResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand
    bubble_visible: bool
    bubble_text: str = Field(default="", max_length=4000)
    speaker_label: str | None = Field(default=None, min_length=1, max_length=64)
    is_streaming: bool = False
    segment_count: int = Field(ge=0)
    last_action: str = Field(min_length=1, max_length=64)


class DesktopLive2DShutdownResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.OK
    bridge_command: DesktopLive2DBridgeCommand = DesktopLive2DBridgeCommand.SHUTDOWN
    message: str = Field(min_length=1, max_length=512)


class DesktopLive2DBridgeErrorResponse(DesktopLive2DBridgeModel):
    request_id: UUID
    status: DesktopLive2DBridgeResponseStatus = DesktopLive2DBridgeResponseStatus.ERROR
    bridge_command: DesktopLive2DBridgeCommand
    error_code: DesktopLive2DBridgeErrorCode
    message: str = Field(min_length=1, max_length=4000)
    retryable: bool = False
    adapter_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    adapter_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    command_id: UUID | None = None
    command_type: RendererCommandType | None = None
    raw_error_type: str | None = Field(default=None, min_length=1, max_length=256)


DesktopLive2DBridgeResponse = (
    DesktopLive2DPingResponse
    | DesktopLive2DInitializeResponse
    | DesktopLive2DDispatchCommandResponse
    | DesktopLive2DAudioPlaybackResponse
    | DesktopLive2DCompanionSessionResponse
    | DesktopLive2DBubbleResponse
    | DesktopLive2DShutdownResponse
    | DesktopLive2DBridgeErrorResponse
)


@runtime_checkable
class DesktopLive2DBridgeTransportPort(Protocol):
    async def start(self) -> None: ...

    async def send_request(
        self,
        request: DesktopLive2DBridgeRequest,
        *,
        timeout_ms: int,
    ) -> DesktopLive2DBridgeResponse: ...

    async def close(self) -> None: ...

    def is_running(self) -> bool: ...

    def get_stderr_lines(self) -> tuple[str, ...]: ...


def build_default_desktop_live2d_model_asset_ref() -> DesktopLive2DModelAssetRef:
    return DesktopLive2DModelAssetRef(
        model_key="open-yachiyo-kaguya",
        repo_relative_model_json_path=(
            "apps/desktop-live2d/assets/models/open-yachiyo-kaguya/open_yachiyo_kaguya.model3.json"
        ),
        display_name="Open Yachiyo Kaguya",
    )


def build_default_desktop_live2d_launch_config(
    *,
    workspace_root: Path | str,
) -> DesktopLive2DAppLaunchConfig:
    app_directory = Path(workspace_root) / "apps" / "desktop-live2d"
    bridge_entrypoint = app_directory / "renderer" / "scene_stdio_bridge.mjs"
    return DesktopLive2DAppLaunchConfig(
        mode=DesktopLive2DAppLaunchMode.NODE_BRIDGE,
        executable="node",
        arguments=(str(bridge_entrypoint),),
        working_directory=str(app_directory),
    )


def build_default_desktop_live2d_bridge_config(
    *,
    workspace_root: Path | str,
) -> DesktopLive2DBridgeConfig:
    return DesktopLive2DBridgeConfig(
        workspace_root=str(Path(workspace_root)),
        launch=build_default_desktop_live2d_launch_config(workspace_root=workspace_root),
        model_asset=build_default_desktop_live2d_model_asset_ref(),
    )


def build_desktop_live2d_ping_request(
    *,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DPingRequest:
    return DesktopLive2DPingRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
    )


def build_desktop_live2d_initialize_request(
    config: DesktopLive2DBridgeConfig,
) -> DesktopLive2DInitializeRequest:
    return DesktopLive2DInitializeRequest(
        protocol_version=config.protocol_version,
        request_id=uuid4(),
        model_asset=config.model_asset,
    )


def build_desktop_live2d_dispatch_request(
    request: RendererResolvedDispatchRequest,
    *,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DDispatchCommandRequest:
    command = request.command
    return DesktopLive2DDispatchCommandRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        adapter_key=request.adapter_key,
        adapter_profile_key=request.adapter_profile_key,
        command_id=command.command_id,
        command_type=command.command_type,
        target=command.target,
        value=command.value,
        intensity=command.intensity,
        duration_ms=command.duration_ms,
        is_interruptible=command.is_interruptible,
    )


def build_desktop_live2d_audio_playback_fragment_request(
    *,
    session_id: UUID,
    trace_id: UUID,
    turn_id: UUID,
    owner: DesktopLive2DAudioPlaybackOwner | str,
    tts_stream_id: UUID,
    chunk_index: int,
    tts_text: str,
    is_interruptible: bool,
    fragment_index: int,
    audio_bytes: bytes,
    sample_rate_hz: int,
    channel_count: int,
    is_final: bool,
    media_type: DesktopLive2DAudioBridgeMediaType | str | None = None,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DAudioPlaybackFragmentRequest:
    normalized_media_type = None
    if media_type is not None:
        normalized_media_type = DesktopLive2DAudioBridgeMediaType(str(media_type))
    return DesktopLive2DAudioPlaybackFragmentRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        session_id=session_id,
        trace_id=trace_id,
        turn_id=turn_id,
        owner=DesktopLive2DAudioPlaybackOwner(str(owner)),
        tts_stream_id=tts_stream_id,
        chunk_index=chunk_index,
        tts_text=tts_text,
        is_interruptible=is_interruptible,
        fragment_index=fragment_index,
        audio_bytes_base64=base64.b64encode(audio_bytes).decode("ascii"),
        sample_rate_hz=sample_rate_hz,
        channel_count=channel_count,
        is_final=is_final,
        media_type=normalized_media_type,
    )


def build_desktop_live2d_audio_playback_abort_request(
    *,
    session_id: UUID,
    trace_id: UUID,
    turn_id: UUID,
    owner: DesktopLive2DAudioPlaybackOwner | str,
    tts_stream_id: UUID,
    chunk_index: int,
    reason: str = "desktop audio playback aborted",
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DAudioPlaybackAbortRequest:
    return DesktopLive2DAudioPlaybackAbortRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        session_id=session_id,
        trace_id=trace_id,
        turn_id=turn_id,
        owner=DesktopLive2DAudioPlaybackOwner(str(owner)),
        tts_stream_id=tts_stream_id,
        chunk_index=chunk_index,
        reason=reason,
    )


def build_desktop_live2d_audio_playback_snapshot_request(
    *,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DAudioPlaybackSnapshotRequest:
    return DesktopLive2DAudioPlaybackSnapshotRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
    )


def build_desktop_live2d_companion_session_upsert_transcript_request(
    *,
    session_id: UUID,
    turn_id: UUID,
    role: DesktopLive2DCompanionTranscriptRole | str,
    text: str,
    raw_text: str = "",
    is_streaming: bool,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DCompanionSessionUpsertTranscriptRequest:
    resolved_role = role
    if isinstance(role, str):
        resolved_role = DesktopLive2DCompanionTranscriptRole(role)
    return DesktopLive2DCompanionSessionUpsertTranscriptRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        session_id=session_id,
        turn_id=turn_id,
        role=resolved_role,
        text=text,
        raw_text=raw_text,
        is_streaming=is_streaming,
    )


def build_desktop_live2d_companion_session_snapshot_request(
    *,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DCompanionSessionSnapshotRequest:
    return DesktopLive2DCompanionSessionSnapshotRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
    )


def build_desktop_live2d_companion_session_enqueue_input_request(
    *,
    session_id: UUID,
    text: str,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DCompanionSessionEnqueueInputRequest:
    return DesktopLive2DCompanionSessionEnqueueInputRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        session_id=session_id,
        text=text,
    )


def build_desktop_live2d_companion_session_drain_input_request(
    *,
    session_id: UUID,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DCompanionSessionDrainInputRequest:
    return DesktopLive2DCompanionSessionDrainInputRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        session_id=session_id,
    )


def build_desktop_live2d_shutdown_request(
    *,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
    reason: str = "renderer adapter shutdown",
) -> DesktopLive2DShutdownRequest:
    return DesktopLive2DShutdownRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        reason=reason,
    )


def build_desktop_live2d_bubble_replace_request(
    *,
    bubble_text: str,
    speaker_label: str = "Echo",
    is_streaming: bool = True,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DBubbleReplaceRequest:
    return DesktopLive2DBubbleReplaceRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        bubble_text=bubble_text,
        speaker_label=speaker_label,
        is_streaming=is_streaming,
    )


def build_desktop_live2d_bubble_append_request(
    *,
    text_fragment: str,
    speaker_label: str | None = None,
    is_streaming: bool = True,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DBubbleAppendRequest:
    return DesktopLive2DBubbleAppendRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        text_fragment=text_fragment,
        speaker_label=speaker_label,
        is_streaming=is_streaming,
    )


def build_desktop_live2d_bubble_clear_request(
    *,
    reason: str = "bubble cleared",
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DBubbleClearRequest:
    return DesktopLive2DBubbleClearRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
        reason=reason,
    )


def build_desktop_live2d_bubble_snapshot_request(
    *,
    protocol_version: str = DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
) -> DesktopLive2DBubbleSnapshotRequest:
    return DesktopLive2DBubbleSnapshotRequest(
        protocol_version=protocol_version,
        request_id=uuid4(),
    )


def decode_desktop_live2d_bridge_response_json(payload: str) -> DesktopLive2DBridgeResponse:
    try:
        raw = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("desktop-live2d bridge returned invalid JSON") from exc

    if not isinstance(raw, dict):
        raise ValueError("desktop-live2d bridge response must be a JSON object")

    status = raw.get("status")
    if status == DesktopLive2DBridgeResponseStatus.ERROR.value:
        return DesktopLive2DBridgeErrorResponse.model_validate(raw)

    bridge_command = raw.get("bridge_command")
    model_map = {
        DesktopLive2DBridgeCommand.PING.value: DesktopLive2DPingResponse,
        DesktopLive2DBridgeCommand.INITIALIZE.value: DesktopLive2DInitializeResponse,
        DesktopLive2DBridgeCommand.DISPATCH_COMMAND.value: DesktopLive2DDispatchCommandResponse,
        DesktopLive2DBridgeCommand.AUDIO_PLAYBACK_FRAGMENT.value: DesktopLive2DAudioPlaybackResponse,
        DesktopLive2DBridgeCommand.AUDIO_PLAYBACK_ABORT.value: DesktopLive2DAudioPlaybackResponse,
        DesktopLive2DBridgeCommand.AUDIO_PLAYBACK_SNAPSHOT.value: DesktopLive2DAudioPlaybackResponse,
        DesktopLive2DBridgeCommand.COMPANION_SESSION_UPSERT_TRANSCRIPT.value: DesktopLive2DCompanionSessionResponse,
        DesktopLive2DBridgeCommand.COMPANION_SESSION_SNAPSHOT.value: DesktopLive2DCompanionSessionResponse,
        DesktopLive2DBridgeCommand.COMPANION_SESSION_ENQUEUE_INPUT.value: DesktopLive2DCompanionSessionResponse,
        DesktopLive2DBridgeCommand.COMPANION_SESSION_DRAIN_INPUT.value: DesktopLive2DCompanionSessionResponse,
        DesktopLive2DBridgeCommand.BUBBLE_REPLACE.value: DesktopLive2DBubbleResponse,
        DesktopLive2DBridgeCommand.BUBBLE_APPEND.value: DesktopLive2DBubbleResponse,
        DesktopLive2DBridgeCommand.BUBBLE_CLEAR.value: DesktopLive2DBubbleResponse,
        DesktopLive2DBridgeCommand.BUBBLE_SNAPSHOT.value: DesktopLive2DBubbleResponse,
        DesktopLive2DBridgeCommand.SHUTDOWN.value: DesktopLive2DShutdownResponse,
    }
    model_cls = model_map.get(bridge_command)
    if model_cls is None:
        raise ValueError("desktop-live2d bridge returned an unknown bridge_command")
    return model_cls.model_validate(raw)


def map_desktop_live2d_bridge_error_code(
    error_code: DesktopLive2DBridgeErrorCode,
) -> RendererAdapterErrorCode:
    mapping = {
        DesktopLive2DBridgeErrorCode.INVALID_REQUEST: RendererAdapterErrorCode.VALIDATION_FAILED,
        DesktopLive2DBridgeErrorCode.INVALID_MODEL_ASSET: RendererAdapterErrorCode.CONFIGURATION_ERROR,
        DesktopLive2DBridgeErrorCode.NOT_INITIALIZED: RendererAdapterErrorCode.ADAPTER_UNAVAILABLE,
        DesktopLive2DBridgeErrorCode.UNSUPPORTED_COMMAND: RendererAdapterErrorCode.UNSUPPORTED_COMMAND,
        DesktopLive2DBridgeErrorCode.UNSUPPORTED_TARGET: RendererAdapterErrorCode.UNSUPPORTED_TARGET,
        DesktopLive2DBridgeErrorCode.ADAPTER_UNAVAILABLE: RendererAdapterErrorCode.ADAPTER_UNAVAILABLE,
        DesktopLive2DBridgeErrorCode.TIMEOUT: RendererAdapterErrorCode.TIMEOUT,
        DesktopLive2DBridgeErrorCode.CANCELLED: RendererAdapterErrorCode.CANCELLED,
        DesktopLive2DBridgeErrorCode.PROTOCOL_ERROR: RendererAdapterErrorCode.MALFORMED_RESPONSE,
        DesktopLive2DBridgeErrorCode.INTERNAL_APP_ERROR: RendererAdapterErrorCode.INTERNAL_ADAPTER_ERROR,
    }
    return mapping[error_code]


def build_renderer_failure_from_bridge_error(
    response: DesktopLive2DBridgeErrorResponse,
    *,
    default_adapter_key: str,
    default_adapter_profile_key: str | None,
    default_command_id: UUID | None,
    default_command_type: RendererCommandType | None,
) -> RendererAdapterFailure:
    return build_renderer_error(
        error_code=map_desktop_live2d_bridge_error_code(response.error_code),
        message=response.message,
        retryable=response.retryable,
        adapter_key=response.adapter_key or default_adapter_key,
        adapter_profile_key=response.adapter_profile_key or default_adapter_profile_key,
        command_id=response.command_id or default_command_id,
        command_type=response.command_type or default_command_type,
        raw_error_type=response.raw_error_type,
    )


def build_renderer_dispatch_result_from_bridge_response(
    response: DesktopLive2DDispatchCommandResponse,
    *,
    expected_request: RendererResolvedDispatchRequest,
) -> RendererDispatchResult:
    if response.command_id != expected_request.command_id:
        malformed = build_malformed_response_error(
            adapter_key=expected_request.adapter_key,
            adapter_profile_key=expected_request.adapter_profile_key,
            command_id=expected_request.command_id,
            command_type=expected_request.command_type,
            message="desktop-live2d bridge returned the wrong command_id",
        )
        raise RendererAdapterExecutionError(malformed)

    if response.command_type != expected_request.command_type:
        malformed = build_malformed_response_error(
            adapter_key=expected_request.adapter_key,
            adapter_profile_key=expected_request.adapter_profile_key,
            command_id=expected_request.command_id,
            command_type=expected_request.command_type,
            message="desktop-live2d bridge returned the wrong command_type",
        )
        raise RendererAdapterExecutionError(malformed)

    if response.adapter_key != expected_request.adapter_key:
        malformed = build_malformed_response_error(
            adapter_key=expected_request.adapter_key,
            adapter_profile_key=expected_request.adapter_profile_key,
            command_id=expected_request.command_id,
            command_type=expected_request.command_type,
            message="desktop-live2d bridge returned the wrong adapter_key",
        )
        raise RendererAdapterExecutionError(malformed)

    if response.adapter_profile_key != expected_request.adapter_profile_key:
        malformed = build_malformed_response_error(
            adapter_key=expected_request.adapter_key,
            adapter_profile_key=expected_request.adapter_profile_key,
            command_id=expected_request.command_id,
            command_type=expected_request.command_type,
            message="desktop-live2d bridge returned the wrong adapter_profile_key",
        )
        raise RendererAdapterExecutionError(malformed)

    return RendererDispatchResult(
        command_id=response.command_id,
        command_type=response.command_type,
        adapter_key=response.adapter_key,
        adapter_profile_key=response.adapter_profile_key,
        outcome=response.outcome,
        message=response.message,
    )


def build_startup_malformed_failure(
    *,
    adapter_key: str,
    message: str,
) -> RendererAdapterFailure:
    return build_renderer_error(
        error_code=RendererAdapterErrorCode.MALFORMED_RESPONSE,
        message=message,
        retryable=False,
        adapter_key=adapter_key,
    )


class DesktopLive2DSubprocessBridgeTransport(DesktopLive2DBridgeTransportPort):
    def __init__(self, config: DesktopLive2DBridgeConfig) -> None:
        self._config = config
        self._process: asyncio.subprocess.Process | None = None
        self._stderr_lines: deque[str] = deque(maxlen=config.stderr_buffer_line_limit)
        self._stderr_task: asyncio.Task[None] | None = None
        self._io_lock = asyncio.Lock()

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    def get_stderr_lines(self) -> tuple[str, ...]:
        return tuple(self._stderr_lines)

    async def start(self) -> None:
        if self.is_running():
            return
        await self.close()
        launch = self._config.launch
        process = await asyncio.create_subprocess_exec(
            launch.executable,
            *launch.arguments,
            cwd=launch.working_directory,
            env=self._build_environment(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._process = process
        self._stderr_task = asyncio.create_task(self._consume_stderr())

    async def send_request(
        self,
        request: DesktopLive2DBridgeRequest,
        *,
        timeout_ms: int,
    ) -> DesktopLive2DBridgeResponse:
        await self.start()
        process = self._require_process()
        if process.stdin is None or process.stdout is None:
            raise ConnectionError("desktop-live2d bridge stdio pipes are unavailable")
        request_line = request.model_dump_json() + "\n"
        async with self._io_lock:
            try:
                process.stdin.write(request_line.encode("utf-8"))
                await asyncio.wait_for(process.stdin.drain(), timeout_ms / 1000)
                raw_line = await asyncio.wait_for(process.stdout.readline(), timeout_ms / 1000)
            except asyncio.TimeoutError:
                raise
            if not raw_line:
                stderr_tail = " | ".join(self.get_stderr_lines())
                message = "desktop-live2d bridge closed before returning a response"
                if stderr_tail:
                    message = f"{message}: {stderr_tail}"
                raise ConnectionError(message)
        try:
            decoded = raw_line.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("desktop-live2d bridge returned non-UTF-8 output") from exc
        return decode_desktop_live2d_bridge_response_json(decoded)

    async def close(self) -> None:
        process = self._process
        if process is None:
            return
        if process.stdin is not None and not process.stdin.is_closing():
            process.stdin.close()
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 1.0)
            except asyncio.TimeoutError:
                process.kill()
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(process.wait(), 1.0)
        if self._stderr_task is not None:
            self._stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._stderr_task
        self._stderr_task = None
        self._process = None

    def _build_environment(self) -> dict[str, str]:
        env = os.environ.copy()
        env["ECHO_DESKTOP_LIVE2D_PROTOCOL_VERSION"] = self._config.protocol_version
        env["ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT"] = self._config.workspace_root
        for item in self._config.launch.environment_overrides:
            env[item.key] = item.value
        return env

    def _require_process(self) -> asyncio.subprocess.Process:
        if self._process is None:
            raise RuntimeError("desktop-live2d bridge process has not been started")
        return self._process

    async def _consume_stderr(self) -> None:
        process = self._require_process()
        if process.stderr is None:
            return
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            with contextlib.suppress(UnicodeDecodeError):
                decoded = line.decode("utf-8").rstrip()
                if decoded:
                    self._stderr_lines.append(decoded)


class DesktopLive2DCompanionBridgeSession:
    def __init__(
        self,
        config: DesktopLive2DBridgeConfig,
        *,
        transport: DesktopLive2DBridgeTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or DesktopLive2DSubprocessBridgeTransport(config)
        self._ready = False

    def get_config(self) -> DesktopLive2DBridgeConfig:
        return self._config

    async def ensure_ready(self) -> None:
        if self._ready:
            return
        await self._transport.start()
        ping_response = await self._transport.send_request(
            build_desktop_live2d_ping_request(
                protocol_version=self._config.protocol_version
            ),
            timeout_ms=self._config.launch.startup_timeout_ms,
        )
        if isinstance(ping_response, DesktopLive2DBridgeErrorResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge startup failed: "
                f"{ping_response.error_code.value}: {ping_response.message}"
            )
        if not isinstance(ping_response, DesktopLive2DPingResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge expected a ping response during startup"
            )
        if ping_response.protocol_version != self._config.protocol_version:
            raise RuntimeError(
                "desktop-live2d companion bridge protocol version mismatch: "
                f"expected '{self._config.protocol_version}', got '{ping_response.protocol_version}'"
            )
        self._ready = True

    async def replace_bubble(
        self,
        *,
        bubble_text: str,
        speaker_label: str = "Echo",
        is_streaming: bool = True,
    ) -> DesktopLive2DBubbleResponse:
        return await self._send_bubble_request(
            build_desktop_live2d_bubble_replace_request(
                bubble_text=bubble_text,
                speaker_label=speaker_label,
                is_streaming=is_streaming,
                protocol_version=self._config.protocol_version,
            )
        )

    async def append_bubble(
        self,
        *,
        text_fragment: str,
        speaker_label: str | None = None,
        is_streaming: bool = True,
    ) -> DesktopLive2DBubbleResponse:
        return await self._send_bubble_request(
            build_desktop_live2d_bubble_append_request(
                text_fragment=text_fragment,
                speaker_label=speaker_label,
                is_streaming=is_streaming,
                protocol_version=self._config.protocol_version,
            )
        )

    async def clear_bubble(
        self,
        *,
        reason: str = "desktop companion bubble cleared",
    ) -> DesktopLive2DBubbleResponse:
        return await self._send_bubble_request(
            build_desktop_live2d_bubble_clear_request(
                reason=reason,
                protocol_version=self._config.protocol_version,
            )
        )

    async def snapshot_bubble(self) -> DesktopLive2DBubbleResponse:
        return await self._send_bubble_request(
            build_desktop_live2d_bubble_snapshot_request(
                protocol_version=self._config.protocol_version
            )
        )

    async def snapshot_audio_playback(self) -> DesktopLive2DAudioPlaybackResponse:
        return await self._send_audio_request(
            build_desktop_live2d_audio_playback_snapshot_request(
                protocol_version=self._config.protocol_version
            )
        )

    async def upsert_transcript(
        self,
        *,
        session_id: UUID,
        turn_id: UUID,
        role: DesktopLive2DCompanionTranscriptRole | str,
        text: str,
        raw_text: str = "",
        is_streaming: bool,
    ) -> DesktopLive2DCompanionSessionResponse:
        return await self._send_companion_session_request(
            build_desktop_live2d_companion_session_upsert_transcript_request(
                session_id=session_id,
                turn_id=turn_id,
                role=role,
                text=text,
                raw_text=raw_text,
                is_streaming=is_streaming,
                protocol_version=self._config.protocol_version,
            )
        )

    async def snapshot_companion_session(
        self,
    ) -> DesktopLive2DCompanionSessionResponse:
        return await self._send_companion_session_request(
            build_desktop_live2d_companion_session_snapshot_request(
                protocol_version=self._config.protocol_version
            )
        )

    async def enqueue_input(
        self,
        *,
        session_id: UUID,
        text: str,
    ) -> DesktopLive2DCompanionSessionResponse:
        return await self._send_companion_session_request(
            build_desktop_live2d_companion_session_enqueue_input_request(
                session_id=session_id,
                text=text,
                protocol_version=self._config.protocol_version,
            )
        )

    async def drain_inputs(
        self,
        *,
        session_id: UUID,
    ) -> DesktopLive2DCompanionSessionResponse:
        return await self._send_companion_session_request(
            build_desktop_live2d_companion_session_drain_input_request(
                session_id=session_id,
                protocol_version=self._config.protocol_version,
            )
        )

    async def shutdown(
        self,
        *,
        reason: str = "desktop companion bridge shutdown",
    ) -> DesktopLive2DShutdownResponse:
        await self.ensure_ready()
        response = await self._transport.send_request(
            build_desktop_live2d_shutdown_request(
                protocol_version=self._config.protocol_version,
                reason=reason,
            ),
            timeout_ms=self._config.launch.request_timeout_ms,
        )
        if isinstance(response, DesktopLive2DBridgeErrorResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge shutdown failed: "
                f"{response.error_code.value}: {response.message}"
            )
        if not isinstance(response, DesktopLive2DShutdownResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge expected a shutdown response"
            )
        self._ready = False
        return response

    async def close(self) -> None:
        self._ready = False
        await self._transport.close()

    async def __aenter__(self) -> "DesktopLive2DCompanionBridgeSession":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def _send_bubble_request(
        self,
        request: DesktopLive2DBridgeRequest,
    ) -> DesktopLive2DBubbleResponse:
        response = await self._send_request(request)
        if not isinstance(response, DesktopLive2DBubbleResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge expected a bubble response"
            )
        return response

    async def _send_audio_request(
        self,
        request: DesktopLive2DBridgeRequest,
    ) -> DesktopLive2DAudioPlaybackResponse:
        response = await self._send_request(request)
        if not isinstance(response, DesktopLive2DAudioPlaybackResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge expected an audio playback response"
            )
        return response

    async def _send_companion_session_request(
        self,
        request: DesktopLive2DBridgeRequest,
    ) -> DesktopLive2DCompanionSessionResponse:
        response = await self._send_request(request)
        if not isinstance(response, DesktopLive2DCompanionSessionResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge expected a companion session response"
            )
        return response

    async def _send_request(
        self,
        request: DesktopLive2DBridgeRequest,
    ) -> DesktopLive2DBridgeResponse:
        await self.ensure_ready()
        response = await self._transport.send_request(
            request,
            timeout_ms=self._config.launch.request_timeout_ms,
        )
        if isinstance(response, DesktopLive2DBridgeErrorResponse):
            raise RuntimeError(
                "desktop-live2d companion bridge request failed: "
                f"{response.error_code.value}: {response.message}"
            )
        return response


class DesktopLive2DBridgeAdapter(RendererAdapterPort):
    def __init__(
        self,
        config: DesktopLive2DBridgeConfig,
        *,
        transport: DesktopLive2DBridgeTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or DesktopLive2DSubprocessBridgeTransport(config)
        self._ready_lock = asyncio.Lock()
        self._initialized = False
        self._descriptor = RendererAdapterDescriptor(
            adapter_key=config.adapter_key,
            display_name=config.display_name,
        )
        self._capabilities = RendererAdapterCapabilities(
            adapter_key=config.adapter_key,
            display_name=config.display_name,
            supported_command_types=(
                RendererCommandType.SET_STATE,
                RendererCommandType.SET_EXPRESSION,
                RendererCommandType.SET_MOTION,
                RendererCommandType.CLEAR_EXPRESSION,
            ),
            allowed_targets=config.supported_targets,
        )

    @property
    def adapter_key(self) -> str:
        return self._config.adapter_key

    def get_descriptor(self) -> RendererAdapterDescriptor:
        return self._descriptor

    def get_capabilities(self) -> RendererAdapterCapabilities:
        return self._capabilities

    def get_config(self) -> DesktopLive2DBridgeConfig:
        return self._config

    async def dispatch(
        self,
        request: RendererResolvedDispatchRequest,
    ) -> RendererDispatchResult:
        validate_request_against_capabilities(request)
        await self._ensure_ready()
        dispatch_request = build_desktop_live2d_dispatch_request(
            request,
            protocol_version=self._config.protocol_version,
        )
        timeout_ms = request.effective_dispatch_timeout_ms or self._config.launch.request_timeout_ms
        try:
            response = await self._transport.send_request(
                dispatch_request,
                timeout_ms=timeout_ms,
            )
        except Exception as exc:
            raise wrap_adapter_exception(
                exc,
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
            ) from exc

        if isinstance(response, DesktopLive2DBridgeErrorResponse):
            failure = build_renderer_failure_from_bridge_error(
                response,
                default_adapter_key=request.adapter_key,
                default_adapter_profile_key=request.adapter_profile_key,
                default_command_id=request.command_id,
                default_command_type=request.command_type,
            )
            raise RendererAdapterExecutionError(failure)

        if not isinstance(response, DesktopLive2DDispatchCommandResponse):
            malformed = build_malformed_response_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
                message="desktop-live2d bridge returned a non-dispatch response for dispatch_command",
            )
            raise RendererAdapterExecutionError(malformed)

        return build_renderer_dispatch_result_from_bridge_response(
            response,
            expected_request=request,
        )

    async def close(self) -> None:
        if self._transport.is_running() and self._initialized:
            shutdown_request = build_desktop_live2d_shutdown_request(
                protocol_version=self._config.protocol_version,
            )
            with contextlib.suppress(Exception):
                await self._transport.send_request(
                    shutdown_request,
                    timeout_ms=self._config.launch.request_timeout_ms,
                )
        self._initialized = False
        await self._transport.close()

    async def __aenter__(self) -> "DesktopLive2DBridgeAdapter":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def _ensure_ready(self) -> None:
        if self._initialized:
            return
        async with self._ready_lock:
            if self._initialized:
                return
            try:
                await self._transport.start()
                await self._perform_handshake()
                await self._perform_initialize()
            except Exception:
                self._initialized = False
                await self._transport.close()
                raise
            self._initialized = True

    async def _perform_handshake(self) -> None:
        ping_request = build_desktop_live2d_ping_request(
            protocol_version=self._config.protocol_version,
        )
        try:
            response = await self._transport.send_request(
                ping_request,
                timeout_ms=self._config.launch.startup_timeout_ms,
            )
        except Exception as exc:
            raise wrap_adapter_exception(
                exc,
                adapter_key=self.adapter_key,
            ) from exc
        if isinstance(response, DesktopLive2DBridgeErrorResponse):
            failure = build_renderer_failure_from_bridge_error(
                response,
                default_adapter_key=self.adapter_key,
                default_adapter_profile_key=None,
                default_command_id=None,
                default_command_type=None,
            )
            raise RendererAdapterExecutionError(failure)
        if not isinstance(response, DesktopLive2DPingResponse):
            malformed = build_startup_malformed_failure(
                adapter_key=self.adapter_key,
                message="desktop-live2d bridge returned a non-ping response during startup",
            )
            raise RendererAdapterExecutionError(malformed)
        if response.protocol_version != self._config.protocol_version:
            raise_adapter_error(
                error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
                message=(
                    "desktop-live2d bridge protocol version mismatch: "
                    f"expected '{self._config.protocol_version}', "
                    f"got '{response.protocol_version}'"
                ),
                retryable=False,
                adapter_key=self.adapter_key,
            )

    async def _perform_initialize(self) -> None:
        initialize_request = build_desktop_live2d_initialize_request(self._config)
        try:
            response = await self._transport.send_request(
                initialize_request,
                timeout_ms=self._config.launch.startup_timeout_ms,
            )
        except Exception as exc:
            raise wrap_adapter_exception(
                exc,
                adapter_key=self.adapter_key,
            ) from exc
        if isinstance(response, DesktopLive2DBridgeErrorResponse):
            failure = build_renderer_failure_from_bridge_error(
                response,
                default_adapter_key=self.adapter_key,
                default_adapter_profile_key=None,
                default_command_id=None,
                default_command_type=None,
            )
            raise RendererAdapterExecutionError(failure)
        if not isinstance(response, DesktopLive2DInitializeResponse):
            malformed = build_startup_malformed_failure(
                adapter_key=self.adapter_key,
                message="desktop-live2d bridge returned a non-initialize response during startup",
            )
            raise RendererAdapterExecutionError(malformed)
        expected_model_path = resolve_repo_owned_model_json_path(
            workspace_root=self._config.workspace_root,
            model_asset=self._config.model_asset,
        )
        if response.model_key != self._config.model_asset.model_key:
            malformed = build_startup_malformed_failure(
                adapter_key=self.adapter_key,
                message="desktop-live2d bridge initialized the wrong model_key",
            )
            raise RendererAdapterExecutionError(malformed)
        try:
            actual_model_path = normalize_reported_model_json_path(
                response.resolved_model_json_path
            )
        except ValueError as exc:
            malformed = build_startup_malformed_failure(
                adapter_key=self.adapter_key,
                message=str(exc),
            )
            raise RendererAdapterExecutionError(malformed) from exc
        if actual_model_path != expected_model_path:
            malformed = build_startup_malformed_failure(
                adapter_key=self.adapter_key,
                message=(
                    "desktop-live2d bridge initialized the wrong model path: "
                    f"expected '{expected_model_path}', got '{actual_model_path}'"
                ),
            )
            raise RendererAdapterExecutionError(malformed)
        if response.presentation_mode != DesktopLive2DPresentationMode.FULL_BODY:
            malformed = build_startup_malformed_failure(
                adapter_key=self.adapter_key,
                message="desktop-live2d bridge did not initialize in full-body mode",
            )
            raise RendererAdapterExecutionError(malformed)


__all__ = [
    "APP_OWNED_MODEL_PREFIX",
    "DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION",
    "DesktopLive2DAppLaunchConfig",
    "DesktopLive2DAppLaunchEnvVar",
    "DesktopLive2DAppLaunchMode",
    "DesktopLive2DAudioBridgeMediaType",
    "DesktopLive2DAudioPlaybackAbortRequest",
    "DesktopLive2DAudioPlaybackFragmentRequest",
    "DesktopLive2DAudioPlaybackOwner",
    "DesktopLive2DAudioPlaybackReport",
    "DesktopLive2DAudioPlaybackReportKind",
    "DesktopLive2DAudioPlaybackResponse",
    "DesktopLive2DAudioPlaybackSnapshot",
    "DesktopLive2DAudioPlaybackSnapshotRequest",
    "DesktopLive2DBridgeAdapter",
    "DesktopLive2DBridgeCommand",
    "DesktopLive2DBridgeConfig",
    "DesktopLive2DBridgeErrorCode",
    "DesktopLive2DBridgeErrorResponse",
    "DesktopLive2DBridgeModel",
    "DesktopLive2DBridgeRequest",
    "DesktopLive2DBridgeResponse",
    "DesktopLive2DBridgeResponseStatus",
    "DesktopLive2DBridgeTransportPort",
    "DesktopLive2DBubbleResponse",
    "DesktopLive2DBubbleAppendRequest",
    "DesktopLive2DBubbleClearRequest",
    "DesktopLive2DBubbleReplaceRequest",
    "DesktopLive2DBubbleSnapshotRequest",
    "DesktopLive2DCompanionBridgeSession",
    "DesktopLive2DCompanionPendingInput",
    "DesktopLive2DCompanionSessionDrainInputRequest",
    "DesktopLive2DCompanionSessionEnqueueInputRequest",
    "DesktopLive2DCompanionSessionResponse",
    "DesktopLive2DCompanionSessionSnapshot",
    "DesktopLive2DCompanionSessionSnapshotRequest",
    "DesktopLive2DCompanionSessionUpsertTranscriptRequest",
    "DesktopLive2DCompanionTranscriptEntry",
    "DesktopLive2DCompanionTranscriptRole",
    "DesktopLive2DDispatchCommandRequest",
    "DesktopLive2DDispatchCommandResponse",
    "DesktopLive2DInitializeRequest",
    "DesktopLive2DInitializeResponse",
    "DesktopLive2DModelAssetRef",
    "DesktopLive2DPingRequest",
    "DesktopLive2DPingResponse",
    "DesktopLive2DPresentationMode",
    "DesktopLive2DShutdownRequest",
    "DesktopLive2DShutdownResponse",
    "DesktopLive2DSubprocessBridgeTransport",
    "DesktopLive2DWindowSurface",
    "build_default_desktop_live2d_bridge_config",
    "build_default_desktop_live2d_launch_config",
    "build_default_desktop_live2d_model_asset_ref",
    "build_desktop_live2d_audio_playback_abort_request",
    "build_desktop_live2d_audio_playback_fragment_request",
    "build_desktop_live2d_audio_playback_snapshot_request",
    "build_desktop_live2d_bubble_append_request",
    "build_desktop_live2d_bubble_clear_request",
    "build_desktop_live2d_bubble_replace_request",
    "build_desktop_live2d_bubble_snapshot_request",
    "build_desktop_live2d_companion_session_drain_input_request",
    "build_desktop_live2d_companion_session_enqueue_input_request",
    "build_desktop_live2d_companion_session_snapshot_request",
    "build_desktop_live2d_companion_session_upsert_transcript_request",
    "build_desktop_live2d_dispatch_request",
    "build_desktop_live2d_initialize_request",
    "build_desktop_live2d_ping_request",
    "build_desktop_live2d_shutdown_request",
    "build_renderer_dispatch_result_from_bridge_response",
    "build_renderer_failure_from_bridge_error",
    "decode_desktop_live2d_bridge_response_json",
    "map_desktop_live2d_bridge_error_code",
    "normalize_repo_relative_asset_path",
    "resolve_repo_owned_model_json_path",
]
