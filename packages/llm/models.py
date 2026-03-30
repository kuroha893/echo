from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Literal, TypeAlias
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PROVIDER_KEY_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
PROFILE_KEY_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
MESSAGE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
MODEL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
PROVIDER_RESPONSE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$")


def _normalize_machine_key(value: str, *, field_name: str) -> str:
    normalized = value.strip().lower()
    pattern = PROVIDER_KEY_PATTERN if field_name == "provider_key" else PROFILE_KEY_PATTERN
    if not pattern.fullmatch(normalized):
        raise ValueError(
            f"{field_name} must be a lowercase machine-readable key such as "
            f"'scripted' or 'primary.default'"
        )
    return normalized


def _dedupe_preserve_order(values: tuple[str, ...], *, field_name: str) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in values:
        candidate = raw
        if field_name in {"provider_key", "profile_key", "stop_sequences"}:
            candidate = raw.strip()
        if field_name == "stop_sequences" and not candidate:
            raise ValueError("stop_sequences must not contain empty strings")
        if field_name in {"provider_key", "profile_key"}:
            candidate = _normalize_machine_key(candidate, field_name=field_name)
        if candidate in seen:
            continue
        seen.add(candidate)
        ordered.append(candidate)
    return tuple(ordered)


class LLMModel(BaseModel):
    """
    Base model for llm-local typed contracts.

    Whitespace is not stripped globally because raw model text must be preserved
    exactly for later expression parsing.
    """

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        validate_assignment=True,
    )


class LLMRouteKind(str, Enum):
    INTENT_ROUTING = "intent_routing"
    QUICK_REACTION = "quick_reaction"
    PRIMARY_RESPONSE = "primary_response"
    PRIMARY_TOOL_REASONING = "primary_tool_reasoning"
    AMBIENT_PRESENCE = "ambient_presence"


class LLMIntentDecisionKind(str, Enum):
    ACTION_FEEDBACK = "action_feedback"
    LOCAL_CHAT = "local_chat"
    CLOUD_PRIMARY = "cloud_primary"
    CLOUD_TOOL = "cloud_tool"


class LLMMessageRole(str, Enum):
    SYSTEM = "system"
    DEVELOPER = "developer"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class LLMFinishReason(str, Enum):
    STOP = "stop"
    LENGTH = "length"
    CANCELLED = "cancelled"
    TOOL_CALL = "tool_call"
    PROVIDER_ERROR = "provider_error"


class LLMProviderErrorCode(str, Enum):
    VALIDATION_ERROR = "validation_error"
    CONFIGURATION_ERROR = "configuration_error"
    AUTH_FAILED = "auth_failed"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    MALFORMED_RESPONSE = "malformed_response"
    UNSUPPORTED_CAPABILITY = "unsupported_capability"


class LLMImageDetail(str, Enum):
    LOW = "low"
    HIGH = "high"
    AUTO = "auto"


IMAGE_MEDIA_TYPE_PATTERN = re.compile(r"^image/(png|jpeg|gif|webp)$")


class LLMImageAttachment(LLMModel):
    """Base64-encoded image for vision-capable providers."""

    media_type: str = Field(min_length=1, max_length=64)
    data: str = Field(min_length=1)
    detail: LLMImageDetail = LLMImageDetail.AUTO

    @field_validator("media_type")
    @classmethod
    def validate_media_type(cls, value: str) -> str:
        if not IMAGE_MEDIA_TYPE_PATTERN.fullmatch(value):
            raise ValueError(
                "media_type must be image/png, image/jpeg, image/gif, or image/webp"
            )
        return value


class LLMMessage(LLMModel):
    """
    Provider-neutral conversation item.

    Content is plain text. Images are carried as separate attachments so that
    text-only consumers can ignore them without format changes.
    """

    role: LLMMessageRole
    content: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=128)
    tool_call_id: str | None = Field(default=None, min_length=1, max_length=128)
    images: tuple[LLMImageAttachment, ...] = ()

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not MESSAGE_NAME_PATTERN.fullmatch(cleaned):
            raise ValueError(
                "name must be a compact machine-readable identifier such as "
                "'planner' or 'weather_tool'"
            )
        return cleaned

    @field_validator("tool_call_id")
    @classmethod
    def validate_tool_call_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("tool_call_id must not be blank")
        return cleaned

    @field_validator("images", mode="before")
    @classmethod
    def normalize_images(cls, value: object) -> tuple[LLMImageAttachment, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @model_validator(mode="after")
    def validate_tool_message_fields(self) -> "LLMMessage":
        if self.role == LLMMessageRole.TOOL and self.tool_call_id is None:
            raise ValueError("tool role messages require tool_call_id")
        if self.role != LLMMessageRole.TOOL and self.tool_call_id is not None:
            raise ValueError("tool_call_id is only valid for tool role messages in v0.1")
        if self.images and self.role != LLMMessageRole.USER:
            raise ValueError("images are only supported on user role messages")
        return self


class LLMRequestContext(LLMModel):
    """
    Trace-owned request identity.

    The llm layer treats these identifiers as caller-owned and opaque.
    """

    request_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    trace_id: UUID
    turn_id: UUID
    route_kind: LLMRouteKind
    step_index: int | None = Field(default=None, ge=0)
    response_stream_id: UUID | None = None

    def with_route_kind(self, route_kind: LLMRouteKind) -> "LLMRequestContext":
        return self.model_copy(update={"route_kind": route_kind})


class LLMGenerationConfig(LLMModel):
    """
    Provider-neutral generation controls.

    The required fields stay provider-agnostic. Provider transports may map them
    internally but must not widen this public surface with raw transport knobs.
    """

    max_output_tokens: int = Field(ge=1)
    timeout_ms: int = Field(ge=1)
    temperature: float | None = Field(default=None, ge=0.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    stop_sequences: tuple[str, ...] = Field(default_factory=tuple, max_length=16)
    seed: int | None = None

    @field_validator("stop_sequences", mode="before")
    @classmethod
    def normalize_stop_sequences(cls, value: object) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            raw_values = value
        else:
            raw_values = tuple(value)  # type: ignore[arg-type]
        return _dedupe_preserve_order(raw_values, field_name="stop_sequences")

    def overlay_defaults(self, defaults: "LLMGenerationConfig | None") -> "LLMGenerationConfig":
        if defaults is None:
            return self
        effective_stop_sequences = self.stop_sequences or defaults.stop_sequences
        return LLMGenerationConfig(
            max_output_tokens=self.max_output_tokens,
            timeout_ms=self.timeout_ms,
            temperature=self.temperature if self.temperature is not None else defaults.temperature,
            top_p=self.top_p if self.top_p is not None else defaults.top_p,
            stop_sequences=effective_stop_sequences,
            seed=self.seed if self.seed is not None else defaults.seed,
        )


class LLMConversationInput(LLMModel):
    """
    Caller-facing llm request envelope.

    The caller owns prompt assembly and message ordering. The llm package only
    transports these materials and resolves provider/profile selection.
    """

    context: LLMRequestContext
    messages: tuple[LLMMessage, ...] = Field(min_length=1)
    generation_config: LLMGenerationConfig
    system_instructions: str | None = None
    developer_instructions: str | None = None
    provider_profile_key: str | None = Field(default=None, max_length=128)
    provider_key_override: str | None = Field(default=None, max_length=128)

    @field_validator("messages", mode="before")
    @classmethod
    def normalize_messages(cls, value: object) -> tuple[LLMMessage, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("provider_profile_key")
    @classmethod
    def normalize_provider_profile_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_machine_key(value, field_name="profile_key")

    @field_validator("provider_key_override")
    @classmethod
    def normalize_provider_key_override(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_machine_key(value, field_name="provider_key")

    def with_route_kind(self, route_kind: LLMRouteKind) -> "LLMConversationInput":
        return self.model_copy(update={"context": self.context.with_route_kind(route_kind)})


class LLMTextDelta(LLMModel):
    """
    Normalized streaming text unit.

    Raw text is preserved exactly. Expression tags remain intact for later
    `ExpressionParser` ownership.
    """

    item_kind: Literal["text_delta"] = "text_delta"
    delta_index: int = Field(ge=0)
    text: str = Field(min_length=1)


class LLMIntentRouteDecision(LLMModel):
    """
    Normalized hidden routing output.

    This is an llm-local control artifact, not visible assistant speech.
    """

    item_kind: Literal["intent_route_decision"] = "intent_route_decision"
    decision_kind: LLMIntentDecisionKind
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    reason_text: str | None = None

    @field_validator("reason_text")
    @classmethod
    def normalize_reason_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value.strip() == "":
            return None
        return value


class LLMToolCallIntent(LLMModel):
    """
    Reserved llm-local tool call intent model for later tool-aware routes.
    """

    item_kind: Literal["tool_call_intent"] = "tool_call_intent"
    intent_index: int = Field(ge=0)
    tool_name: str = Field(min_length=1, max_length=128)
    arguments_text: str = Field(min_length=1)

    @field_validator("tool_name")
    @classmethod
    def validate_tool_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("tool_name must not be blank")
        return cleaned


class LLMUsageSnapshot(LLMModel):
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    cached_input_tokens: int | None = Field(default=None, ge=0)


class LLMCompletion(LLMModel):
    """
    Terminal completion summary.

    For text routes, output_text must equal the concatenation of streamed deltas.
    The service layer validates that invariant for active streams.
    """

    item_kind: Literal["completion"] = "completion"
    finish_reason: LLMFinishReason
    output_text: str
    usage: LLMUsageSnapshot | None = None
    provider_response_id: str | None = Field(default=None, max_length=256)

    @field_validator("provider_response_id")
    @classmethod
    def validate_provider_response_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not PROVIDER_RESPONSE_ID_PATTERN.fullmatch(cleaned):
            raise ValueError("provider_response_id must be a compact identifier")
        return cleaned


class LLMProviderError(LLMModel):
    """
    Normalized provider failure surface.
    """

    error_code: LLMProviderErrorCode
    message: str = Field(min_length=1)
    retryable: bool
    provider_key: str | None = Field(default=None, max_length=128)
    profile_key: str | None = Field(default=None, max_length=128)
    status_code: int | None = Field(default=None, ge=100, le=599)
    raw_error_type: str | None = Field(default=None, max_length=256)

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_machine_key(value, field_name="provider_key")

    @field_validator("profile_key")
    @classmethod
    def normalize_profile_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_machine_key(value, field_name="profile_key")

    @field_validator("raw_error_type")
    @classmethod
    def normalize_raw_error_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("raw_error_type must not be blank")
        return cleaned


class LLMProviderDescriptor(LLMModel):
    """
    Stable provider identity and capability view.
    """

    provider_key: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=128)
    supports_one_shot: bool = True
    supports_streaming: bool = False
    supports_structured_intent_routing: bool = False
    supports_tool_reasoning: bool = False
    allowed_routes: tuple[LLMRouteKind, ...] = Field(min_length=1)

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="provider_key")

    @field_validator("allowed_routes", mode="before")
    @classmethod
    def normalize_allowed_routes(cls, value: object) -> tuple[LLMRouteKind, ...]:
        if isinstance(value, tuple):
            raw_values = value
        else:
            raw_values = tuple(value)  # type: ignore[arg-type]
        seen: set[LLMRouteKind] = set()
        ordered: list[LLMRouteKind] = []
        for raw in raw_values:
            route = raw if isinstance(raw, LLMRouteKind) else LLMRouteKind(raw)
            if route in seen:
                continue
            seen.add(route)
            ordered.append(route)
        return tuple(ordered)

    @model_validator(mode="after")
    def validate_capability_surface(self) -> "LLMProviderDescriptor":
        if (
            self.supports_structured_intent_routing
            and LLMRouteKind.INTENT_ROUTING not in self.allowed_routes
        ):
            raise ValueError(
                "supports_structured_intent_routing requires 'intent_routing' in "
                "allowed_routes"
            )
        if not self.supports_streaming and LLMRouteKind.PRIMARY_RESPONSE in self.allowed_routes:
            # A route may be bound to this provider, but callers should still be able
            # to reject unsupported streaming explicitly. The descriptor therefore
            # keeps the route while advertising the unsupported capability.
            return self
        return self


class LLMModelProfile(LLMModel):
    """
    Echo-owned reusable model profile.
    """

    profile_key: str = Field(min_length=1, max_length=128)
    provider_key: str = Field(min_length=1, max_length=128)
    model_name: str = Field(min_length=1, max_length=128)
    default_generation_config: LLMGenerationConfig

    @field_validator("profile_key")
    @classmethod
    def normalize_profile_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="profile_key")

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="provider_key")

    @field_validator("model_name")
    @classmethod
    def validate_model_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not MODEL_NAME_PATTERN.fullmatch(cleaned):
            raise ValueError("model_name must be a compact provider-agnostic identifier")
        return cleaned


class LLMRouteBinding(LLMModel):
    """
    Explicit route-to-profile mapping.
    """

    route_kind: LLMRouteKind
    profile_key: str = Field(min_length=1, max_length=128)

    @field_validator("profile_key")
    @classmethod
    def normalize_profile_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="profile_key")


class LLMProviderRequest(LLMModel):
    """
    Resolved provider-facing request.

    This stays provider-neutral while carrying the profile/model selection that a
    provider adapter needs after registry resolution.
    """

    provider_key: str = Field(min_length=1, max_length=128)
    profile_key: str = Field(min_length=1, max_length=128)
    model_name: str = Field(min_length=1, max_length=128)
    conversation: LLMConversationInput
    effective_generation_config: LLMGenerationConfig

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="provider_key")

    @field_validator("profile_key")
    @classmethod
    def normalize_profile_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="profile_key")

    @field_validator("model_name")
    @classmethod
    def normalize_model_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not MODEL_NAME_PATTERN.fullmatch(cleaned):
            raise ValueError("model_name must be a compact provider-facing identifier")
        return cleaned

    @property
    def route_kind(self) -> LLMRouteKind:
        return self.conversation.context.route_kind

    @property
    def request_id(self) -> UUID:
        return self.conversation.context.request_id


class LLMResolvedRoute(LLMModel):
    """
    Registry resolution summary for caller-side inspection and debugging.
    """

    route_kind: LLMRouteKind
    provider_key: str = Field(min_length=1, max_length=128)
    profile_key: str = Field(min_length=1, max_length=128)
    model_name: str = Field(min_length=1, max_length=128)
    effective_generation_config: LLMGenerationConfig
    profile_override_applied: bool = False
    provider_override_applied: bool = False

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="provider_key")

    @field_validator("profile_key")
    @classmethod
    def normalize_profile_key(cls, value: str) -> str:
        return _normalize_machine_key(value, field_name="profile_key")

    @field_validator("model_name")
    @classmethod
    def normalize_model_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not MODEL_NAME_PATTERN.fullmatch(cleaned):
            raise ValueError("model_name must be a compact provider-facing identifier")
        return cleaned


LLMOneShotOutput: TypeAlias = Annotated[
    LLMCompletion | LLMIntentRouteDecision,
    Field(discriminator="item_kind"),
]


LLMStreamOutput: TypeAlias = Annotated[
    LLMTextDelta | LLMToolCallIntent | LLMCompletion,
    Field(discriminator="item_kind"),
]


__all__ = [
    "LLMCompletion",
    "LLMConversationInput",
    "LLMIntentDecisionKind",
    "LLMIntentRouteDecision",
    "LLMFinishReason",
    "LLMGenerationConfig",
    "LLMMessage",
    "LLMMessageRole",
    "LLMModel",
    "LLMModelProfile",
    "LLMOneShotOutput",
    "LLMProviderDescriptor",
    "LLMProviderError",
    "LLMProviderErrorCode",
    "LLMProviderRequest",
    "LLMRequestContext",
    "LLMResolvedRoute",
    "LLMRouteBinding",
    "LLMRouteKind",
    "LLMStreamOutput",
    "LLMTextDelta",
    "LLMToolCallIntent",
    "LLMUsageSnapshot",
]
