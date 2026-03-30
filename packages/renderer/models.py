from __future__ import annotations

from enum import StrEnum
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from packages.protocol.events import RendererCommand, RendererCommandType


KEY_PATTERN = r"^[a-z0-9][a-z0-9._-]{0,63}$"


class RendererModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RendererDispatchOutcome(StrEnum):
    ACKNOWLEDGED = "acknowledged"
    COMPLETED = "completed"


class RendererAdapterErrorCode(StrEnum):
    VALIDATION_FAILED = "validation_failed"
    CONFIGURATION_ERROR = "configuration_error"
    UNKNOWN_ADAPTER = "unknown_adapter"
    UNKNOWN_ADAPTER_PROFILE = "unknown_adapter_profile"
    DUPLICATE_ADAPTER = "duplicate_adapter"
    DUPLICATE_ADAPTER_PROFILE = "duplicate_adapter_profile"
    ADAPTER_PROFILE_MISMATCH = "adapter_profile_mismatch"
    UNSUPPORTED_COMMAND = "unsupported_command"
    UNSUPPORTED_TARGET = "unsupported_target"
    ADAPTER_UNAVAILABLE = "adapter_unavailable"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    NO_RESULT = "no_result"
    MALFORMED_RESPONSE = "malformed_response"
    INTERNAL_ADAPTER_ERROR = "internal_adapter_error"


class RendererAdapterDescriptor(RendererModel):
    adapter_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)


class RendererAdapterCapabilities(RendererModel):
    adapter_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)
    supported_command_types: tuple[RendererCommandType, ...]
    allowed_targets: tuple[str, ...] = ()
    supports_intensity_hints: bool = True
    supports_duration_hints: bool = True
    supports_interruptible_hints: bool = True

    @field_validator("supported_command_types", mode="before")
    @classmethod
    def normalize_supported_command_types(
        cls,
        value: object,
    ) -> tuple[RendererCommandType, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("allowed_targets", mode="before")
    @classmethod
    def normalize_allowed_targets(
        cls,
        value: object,
    ) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("allowed_targets")
    @classmethod
    def validate_allowed_targets(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(dict.fromkeys(target.strip() for target in value))
        if any(not target for target in normalized):
            raise ValueError("allowed_targets must not contain blank values")
        return normalized

    @model_validator(mode="after")
    def validate_supported_command_types(self) -> Self:
        if not self.supported_command_types:
            raise ValueError("supported_command_types must not be empty")
        if len(set(self.supported_command_types)) != len(self.supported_command_types):
            raise ValueError("supported_command_types must not contain duplicates")
        return self

    def supports_command_type(self, command_type: RendererCommandType) -> bool:
        return command_type in self.supported_command_types

    def allows_target(self, target: str) -> bool:
        if not self.allowed_targets:
            return True
        return target in self.allowed_targets


class RendererAdapterProfile(RendererModel):
    adapter_profile_key: str = Field(pattern=KEY_PATTERN)
    adapter_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)
    default_dispatch_timeout_ms: int | None = Field(default=None, gt=0)
    allowed_command_types: tuple[RendererCommandType, ...] = ()
    allowed_targets: tuple[str, ...] = ()
    is_default: bool = False

    @field_validator("allowed_command_types", mode="before")
    @classmethod
    def normalize_allowed_command_types(
        cls,
        value: object,
    ) -> tuple[RendererCommandType, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("allowed_targets", mode="before")
    @classmethod
    def normalize_allowed_targets(
        cls,
        value: object,
    ) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("allowed_targets")
    @classmethod
    def validate_allowed_targets(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(dict.fromkeys(target.strip() for target in value))
        if any(not target for target in normalized):
            raise ValueError("allowed_targets must not contain blank values")
        return normalized

    @model_validator(mode="after")
    def validate_allowed_command_types(self) -> Self:
        if len(set(self.allowed_command_types)) != len(self.allowed_command_types):
            raise ValueError("allowed_command_types must not contain duplicates")
        return self

    def supports_command_type(self, command_type: RendererCommandType) -> bool:
        if not self.allowed_command_types:
            return True
        return command_type in self.allowed_command_types

    def allows_target(self, target: str) -> bool:
        if not self.allowed_targets:
            return True
        return target in self.allowed_targets


class RendererDispatchRequest(RendererModel):
    command: RendererCommand
    adapter_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    adapter_key_override: str | None = Field(default=None, pattern=KEY_PATTERN)
    dispatch_timeout_ms: int | None = Field(default=None, gt=0)

    @property
    def command_id(self) -> UUID:
        return self.command.command_id

    @property
    def command_type(self) -> RendererCommandType:
        return self.command.command_type


class RendererResolvedDispatchRequest(RendererModel):
    dispatch_request: RendererDispatchRequest
    adapter_descriptor: RendererAdapterDescriptor
    adapter_capabilities: RendererAdapterCapabilities
    adapter_profile: RendererAdapterProfile | None = None
    effective_dispatch_timeout_ms: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_alignment(self) -> Self:
        adapter_key = self.adapter_descriptor.adapter_key
        if self.adapter_capabilities.adapter_key != adapter_key:
            raise ValueError("adapter_capabilities.adapter_key must match adapter_descriptor.adapter_key")
        if self.adapter_profile is not None and self.adapter_profile.adapter_key != adapter_key:
            raise ValueError("adapter_profile.adapter_key must match adapter_descriptor.adapter_key")
        if (
            self.dispatch_request.adapter_key_override is not None
            and self.dispatch_request.adapter_key_override != adapter_key
        ):
            raise ValueError("dispatch_request.adapter_key_override must match the resolved adapter")
        if (
            self.dispatch_request.adapter_profile_key is not None
            and self.adapter_profile is None
        ):
            raise ValueError("resolved request must carry adapter_profile when adapter_profile_key is set")
        if (
            self.adapter_profile is not None
            and self.dispatch_request.adapter_profile_key is not None
            and self.dispatch_request.adapter_profile_key
            != self.adapter_profile.adapter_profile_key
        ):
            raise ValueError("dispatch_request.adapter_profile_key must match adapter_profile.adapter_profile_key")
        return self

    @property
    def command(self) -> RendererCommand:
        return self.dispatch_request.command

    @property
    def command_id(self) -> UUID:
        return self.command.command_id

    @property
    def command_type(self) -> RendererCommandType:
        return self.command.command_type

    @property
    def adapter_key(self) -> str:
        return self.adapter_descriptor.adapter_key

    @property
    def adapter_profile_key(self) -> str | None:
        if self.adapter_profile is None:
            return None
        return self.adapter_profile.adapter_profile_key


class RendererDispatchResult(RendererModel):
    command_id: UUID
    command_type: RendererCommandType
    adapter_key: str = Field(pattern=KEY_PATTERN)
    adapter_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    outcome: RendererDispatchOutcome
    message: str | None = Field(default=None, min_length=1, max_length=4000)


class RendererAdapterFailure(RendererModel):
    error_code: RendererAdapterErrorCode
    message: str = Field(min_length=1, max_length=4000)
    retryable: bool
    adapter_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    adapter_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    command_id: UUID | None = None
    command_type: RendererCommandType | None = None
    raw_error_type: str | None = Field(default=None, min_length=1, max_length=256)


__all__ = [
    "KEY_PATTERN",
    "RendererAdapterCapabilities",
    "RendererAdapterDescriptor",
    "RendererAdapterErrorCode",
    "RendererAdapterFailure",
    "RendererAdapterProfile",
    "RendererDispatchOutcome",
    "RendererDispatchRequest",
    "RendererDispatchResult",
    "RendererModel",
    "RendererResolvedDispatchRequest",
]
