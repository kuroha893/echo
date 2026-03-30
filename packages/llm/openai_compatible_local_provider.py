from __future__ import annotations

import asyncio
import json
import socket
import threading
from collections.abc import AsyncIterator, Iterable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Protocol, runtime_checkable
from urllib import error as urllib_error
from urllib import request as urllib_request

from pydantic import Field, field_validator, model_validator

from packages.llm.errors import (
    LLMCancelledFailure,
    LLMProviderFailure,
    build_malformed_response_failure,
    build_provider_error,
    build_unsupported_capability_failure,
    provider_failure_from_error,
)
from packages.llm.models import (
    LLMCompletion,
    LLMFinishReason,
    LLMIntentDecisionKind,
    LLMIntentRouteDecision,
    LLMMessage,
    LLMMessageRole,
    LLMModel,
    LLMOneShotOutput,
    LLMProviderDescriptor,
    LLMProviderErrorCode,
    LLMProviderRequest,
    LLMRouteKind,
    LLMStreamOutput,
    LLMTextDelta,
    LLMUsageSnapshot,
)
from packages.llm.provider_ports import (
    LLMProviderPort,
    ensure_provider_can_serve_route,
    ensure_provider_supports_one_shot,
    ensure_provider_supports_streaming,
)


_DEFAULT_BASE_URL = "http://127.0.0.1:30000/v1"
_DEFAULT_CHAT_COMPLETIONS_PATH = "/chat/completions"
_STREAM_DONE_SENTINEL = object()
_MESSAGE_ROLE_PREFIX = {
    "system": "System instructions",
    "developer": "Developer instructions",
}


class OpenAICompatibleLocalAuthMode(str, Enum):
    NONE = "none"
    BEARER = "bearer"


class OpenAICompatibleLocalDeveloperRoleMode(str, Enum):
    SYSTEM_PREFIXED = "system_prefixed"
    DEVELOPER = "developer"


class OpenAICompatibleLocalProviderConfig(LLMModel):
    provider_key: str = Field(default="local.openai_compatible", min_length=1, max_length=128)
    display_name: str = Field(
        default="Local OpenAI-Compatible",
        min_length=1,
        max_length=128,
    )
    base_url: str = Field(default=_DEFAULT_BASE_URL, min_length=1, max_length=512)
    default_model_name: str = Field(min_length=1, max_length=128)
    request_timeout_ms: int = Field(default=4_000, ge=1)
    auth_mode: OpenAICompatibleLocalAuthMode = OpenAICompatibleLocalAuthMode.NONE
    api_key: str | None = Field(default=None, min_length=1, max_length=512)
    extra_headers: tuple["OpenAICompatibleLocalHTTPHeader", ...] = ()
    chat_completions_path: str = Field(
        default=_DEFAULT_CHAT_COMPLETIONS_PATH,
        min_length=1,
        max_length=128,
    )
    supports_primary_response_route: bool = True
    supports_primary_response_streaming: bool = True
    prefer_json_object_for_intent_routing: bool = True
    include_stream_usage: bool = True
    developer_role_mode: OpenAICompatibleLocalDeveloperRoleMode = (
        OpenAICompatibleLocalDeveloperRoleMode.SYSTEM_PREFIXED
    )
    user_agent: str = Field(
        default="echo-openai-compatible-local-provider/0.1",
        min_length=1,
        max_length=256,
    )

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not cleaned:
            raise ValueError("provider_key must not be blank")
        return cleaned

    @field_validator("display_name", "default_model_name", "api_key", "user_agent")
    @classmethod
    def normalize_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text config fields must not be blank")
        return cleaned

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("base_url must not be blank")
        if not (cleaned.startswith("http://") or cleaned.startswith("https://")):
            raise ValueError("base_url must start with http:// or https://")
        return cleaned.rstrip("/")

    @field_validator("chat_completions_path")
    @classmethod
    def normalize_chat_completions_path(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned.startswith("/"):
            raise ValueError("chat_completions_path must start with '/'")
        return cleaned.rstrip("/") or "/"

    @field_validator("extra_headers", mode="before")
    @classmethod
    def normalize_extra_headers(
        cls,
        value: object,
    ) -> tuple["OpenAICompatibleLocalHTTPHeader", ...]:
        if value is None:
            return ()
        raw_items = value if isinstance(value, tuple) else tuple(value)  # type: ignore[arg-type]
        normalized: list[OpenAICompatibleLocalHTTPHeader] = []
        for item in raw_items:
            if isinstance(item, OpenAICompatibleLocalHTTPHeader):
                normalized.append(item)
                continue
            if isinstance(item, Mapping):
                normalized.append(OpenAICompatibleLocalHTTPHeader(**item))
                continue
            if (
                isinstance(item, tuple)
                and len(item) == 2
                and all(isinstance(part, str) for part in item)
            ):
                normalized.append(
                    OpenAICompatibleLocalHTTPHeader(name=item[0], value=item[1])
                )
                continue
            normalized.append(item)  # type: ignore[arg-type]
        return tuple(normalized)

    @model_validator(mode="after")
    def validate_auth_surface(self) -> "OpenAICompatibleLocalProviderConfig":
        if self.auth_mode == OpenAICompatibleLocalAuthMode.NONE and self.api_key is not None:
            raise ValueError("api_key requires auth_mode='bearer'")
        if self.auth_mode == OpenAICompatibleLocalAuthMode.BEARER and self.api_key is None:
            raise ValueError("auth_mode='bearer' requires api_key")
        return self

    @property
    def chat_completions_url(self) -> str:
        return f"{self.base_url}{self.chat_completions_path}"


class OpenAICompatibleLocalHTTPHeader(LLMModel):
    name: str = Field(min_length=1, max_length=256)
    value: str = Field(min_length=1, max_length=1024)

    @field_validator("name", "value")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("headers must not contain blank names or values")
        return cleaned


class OpenAICompatibleLocalHTTPRequest(LLMModel):
    method: str = Field(default="POST", min_length=1, max_length=16)
    url: str = Field(min_length=1, max_length=1024)
    headers: tuple[OpenAICompatibleLocalHTTPHeader, ...] = ()
    body: bytes = Field(min_length=2)
    timeout_ms: int = Field(ge=1)
    request_id: str = Field(min_length=1, max_length=64)
    route_kind: LLMRouteKind
    stream: bool = False

    @field_validator("method")
    @classmethod
    def normalize_method(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("url")
    @classmethod
    def normalize_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("url must not be blank")
        return cleaned

    @field_validator("headers", mode="before")
    @classmethod
    def normalize_headers(
        cls,
        value: object,
    ) -> tuple[OpenAICompatibleLocalHTTPHeader, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("request_id")
    @classmethod
    def normalize_request_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("request_id must not be blank")
        return cleaned

    def headers_as_mapping(self) -> dict[str, str]:
        return {header.name: header.value for header in self.headers}


class OpenAICompatibleLocalHTTPResponse(LLMModel):
    status_code: int = Field(ge=100, le=599)
    headers: tuple[OpenAICompatibleLocalHTTPHeader, ...] = ()
    body: bytes = b""

    @field_validator("headers", mode="before")
    @classmethod
    def normalize_headers(
        cls,
        value: object,
    ) -> tuple[OpenAICompatibleLocalHTTPHeader, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]


class OpenAICompatibleLocalSSEEvent(LLMModel):
    event: str | None = Field(default=None, max_length=128)
    data: str = Field(min_length=1)

    @field_validator("event")
    @classmethod
    def normalize_event(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        return cleaned


class OpenAICompatibleLocalMessagePayload(LLMModel):
    role: str = Field(min_length=1, max_length=64)
    content: str | list[dict[str, Any]] = Field()
    name: str | None = Field(default=None, min_length=1, max_length=128)
    tool_call_id: str | None = Field(default=None, min_length=1, max_length=128)


class OpenAICompatibleLocalRequestPayload(LLMModel):
    model: str = Field(min_length=1, max_length=128)
    messages: tuple[OpenAICompatibleLocalMessagePayload, ...] = Field(min_length=1)
    stream: bool = False
    max_tokens: int = Field(ge=1)
    temperature: float | None = Field(default=None, ge=0.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    stop: tuple[str, ...] = ()
    seed: int | None = None
    response_format: dict[str, Any] | None = None
    stream_options: dict[str, Any] | None = None

    @field_validator("messages", mode="before")
    @classmethod
    def normalize_messages(
        cls,
        value: object,
    ) -> tuple[OpenAICompatibleLocalMessagePayload, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("stop", mode="before")
    @classmethod
    def normalize_stop(cls, value: object) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]


@runtime_checkable
class OpenAICompatibleLocalTransportPort(Protocol):
    async def send(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
    ) -> OpenAICompatibleLocalHTTPResponse:
        ...

    async def stream(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
    ) -> AsyncIterator[OpenAICompatibleLocalSSEEvent]:
        ...


class OpenAICompatibleLocalTransportError(Exception):
    pass


class OpenAICompatibleLocalHTTPStatusError(OpenAICompatibleLocalTransportError):
    def __init__(
        self,
        *,
        status_code: int,
        body: bytes = b"",
        headers: tuple[OpenAICompatibleLocalHTTPHeader, ...] = (),
        raw_error_type: str = "HTTPStatusError",
    ) -> None:
        super().__init__(f"local openai-compatible request failed with HTTP {status_code}")
        self.status_code = status_code
        self.body = body
        self.headers = headers
        self.raw_error_type = raw_error_type


class OpenAICompatibleLocalTimeoutError(OpenAICompatibleLocalTransportError):
    pass


class OpenAICompatibleLocalNetworkError(OpenAICompatibleLocalTransportError):
    pass


class OpenAICompatibleLocalMalformedStreamError(OpenAICompatibleLocalTransportError):
    pass


def _normalize_header_pairs(
    headers: Iterable[tuple[str, str]] | Mapping[str, str] | None,
) -> tuple[OpenAICompatibleLocalHTTPHeader, ...]:
    if headers is None:
        return ()
    items = headers.items() if isinstance(headers, Mapping) else headers
    normalized: list[OpenAICompatibleLocalHTTPHeader] = []
    for name, value in items:
        normalized.append(OpenAICompatibleLocalHTTPHeader(name=name, value=value))
    return tuple(normalized)


class OpenAICompatibleLocalUrllibTransport(OpenAICompatibleLocalTransportPort):
    """
    Minimal stdlib transport for OpenAI-compatible local chat-completions backends.
    """

    async def send(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
    ) -> OpenAICompatibleLocalHTTPResponse:
        try:
            return await asyncio.to_thread(self._send_sync, request)
        except asyncio.CancelledError as exc:
            raise LLMCancelledFailure(
                build_provider_error(
                    error_code=LLMProviderErrorCode.CANCELLED,
                    message="local openai-compatible request was cancelled",
                    retryable=False,
                    raw_error_type=type(exc).__name__,
                )
            ) from exc

    async def stream(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
    ) -> AsyncIterator[OpenAICompatibleLocalSSEEvent]:
        loop = asyncio.get_running_loop()
        output_queue: asyncio.Queue[object] = asyncio.Queue()
        stop_event = threading.Event()
        worker = threading.Thread(
            target=self._stream_sync_worker,
            args=(request, output_queue, loop, stop_event),
            daemon=True,
        )
        worker.start()

        try:
            while True:
                item = await output_queue.get()
                if item is _STREAM_DONE_SENTINEL:
                    break
                if isinstance(item, BaseException):
                    raise item
                yield item  # type: ignore[misc]
        except asyncio.CancelledError as exc:
            stop_event.set()
            raise LLMCancelledFailure(
                build_provider_error(
                    error_code=LLMProviderErrorCode.CANCELLED,
                    message="local openai-compatible stream was cancelled",
                    retryable=False,
                    raw_error_type=type(exc).__name__,
                )
            ) from exc

    def _send_sync(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
    ) -> OpenAICompatibleLocalHTTPResponse:
        url_request = urllib_request.Request(
            url=request.url,
            data=request.body,
            method=request.method,
            headers=request.headers_as_mapping(),
        )
        try:
            with urllib_request.urlopen(url_request, timeout=request.timeout_ms / 1000) as response:
                return OpenAICompatibleLocalHTTPResponse(
                    status_code=getattr(response, "status", response.getcode()),
                    headers=_normalize_header_pairs(response.headers.items()),
                    body=response.read(),
                )
        except urllib_error.HTTPError as exc:
            body = exc.read()
            raise OpenAICompatibleLocalHTTPStatusError(
                status_code=exc.code,
                body=body,
                headers=_normalize_header_pairs(exc.headers.items() if exc.headers else None),
            ) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise OpenAICompatibleLocalTimeoutError(
                "local openai-compatible request timed out"
            ) from exc
        except urllib_error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise OpenAICompatibleLocalTimeoutError(
                    "local openai-compatible request timed out"
                ) from exc
            raise OpenAICompatibleLocalNetworkError(
                str(reason) or "local openai-compatible request failed"
            ) from exc

    def _stream_sync_worker(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
        output_queue: asyncio.Queue[object],
        loop: asyncio.AbstractEventLoop,
        stop_event: threading.Event,
    ) -> None:
        try:
            self._stream_sync(request, output_queue, loop, stop_event)
        except BaseException as exc:
            loop.call_soon_threadsafe(output_queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(output_queue.put_nowait, _STREAM_DONE_SENTINEL)

    def _stream_sync(
        self,
        request: OpenAICompatibleLocalHTTPRequest,
        output_queue: asyncio.Queue[object],
        loop: asyncio.AbstractEventLoop,
        stop_event: threading.Event,
    ) -> None:
        url_request = urllib_request.Request(
            url=request.url,
            data=request.body,
            method=request.method,
            headers=request.headers_as_mapping(),
        )
        try:
            with urllib_request.urlopen(url_request, timeout=request.timeout_ms / 1000) as response:
                self._read_sse_events(response, output_queue, loop, stop_event)
        except urllib_error.HTTPError as exc:
            body = exc.read()
            raise OpenAICompatibleLocalHTTPStatusError(
                status_code=exc.code,
                body=body,
                headers=_normalize_header_pairs(exc.headers.items() if exc.headers else None),
            ) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise OpenAICompatibleLocalTimeoutError(
                "local openai-compatible stream timed out"
            ) from exc
        except urllib_error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise OpenAICompatibleLocalTimeoutError(
                    "local openai-compatible stream timed out"
                ) from exc
            raise OpenAICompatibleLocalNetworkError(
                str(reason) or "local openai-compatible stream failed"
            ) from exc

    def _read_sse_events(
        self,
        response: Any,
        output_queue: asyncio.Queue[object],
        loop: asyncio.AbstractEventLoop,
        stop_event: threading.Event,
    ) -> None:
        event_name: str | None = None
        data_lines: list[str] = []
        while True:
            if stop_event.is_set():
                return
            raw_line = response.readline()
            if raw_line == b"":
                break
            try:
                line = raw_line.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise OpenAICompatibleLocalMalformedStreamError(
                    "stream line was not valid utf-8"
                ) from exc
            stripped = line.rstrip("\r\n")
            if not stripped:
                if data_lines:
                    loop.call_soon_threadsafe(
                        output_queue.put_nowait,
                        OpenAICompatibleLocalSSEEvent(
                            event=event_name,
                            data="\n".join(data_lines),
                        ),
                    )
                    event_name = None
                    data_lines = []
                continue
            if stripped.startswith(":"):
                continue
            if stripped.startswith("event:"):
                event_name = stripped.partition(":")[2].lstrip()
                continue
            if stripped.startswith("data:"):
                data_lines.append(stripped.partition(":")[2].lstrip())
                continue
            raise OpenAICompatibleLocalMalformedStreamError(
                "stream contained a non-SSE line"
            )
        if data_lines:
            loop.call_soon_threadsafe(
                output_queue.put_nowait,
                OpenAICompatibleLocalSSEEvent(
                    event=event_name,
                    data="\n".join(data_lines),
                ),
            )


class OpenAICompatibleLocalRequestEncoder:
    """
    Deterministic request encoder from llm-local input to local chat-completions payloads.
    """

    def __init__(self, config: OpenAICompatibleLocalProviderConfig) -> None:
        self._config = config

    def build_http_request(
        self,
        request: LLMProviderRequest,
        *,
        stream: bool,
    ) -> OpenAICompatibleLocalHTTPRequest:
        payload = self.build_payload(request, stream=stream)
        encoded = json.dumps(
            payload.model_dump(exclude_none=True),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        return OpenAICompatibleLocalHTTPRequest(
            url=self._config.chat_completions_url,
            headers=self._build_headers(),
            body=encoded,
            timeout_ms=self._config.request_timeout_ms,
            request_id=str(request.request_id),
            route_kind=request.route_kind,
            stream=stream,
        )

    def build_payload(
        self,
        request: LLMProviderRequest,
        *,
        stream: bool,
    ) -> OpenAICompatibleLocalRequestPayload:
        self._validate_request_support(request, stream=stream)
        generation_config = request.effective_generation_config
        return OpenAICompatibleLocalRequestPayload(
            model=self._resolve_backend_model_name(request),
            messages=self._encode_messages(request),
            stream=stream,
            max_tokens=generation_config.max_output_tokens,
            temperature=generation_config.temperature,
            top_p=generation_config.top_p,
            stop=generation_config.stop_sequences,
            seed=generation_config.seed,
            response_format=self._build_response_format(request),
            stream_options=self._build_stream_options(request, stream=stream),
        )

    def _build_headers(self) -> tuple[OpenAICompatibleLocalHTTPHeader, ...]:
        headers = [
            OpenAICompatibleLocalHTTPHeader(name="Content-Type", value="application/json"),
            OpenAICompatibleLocalHTTPHeader(name="Accept", value="application/json"),
            OpenAICompatibleLocalHTTPHeader(
                name="User-Agent",
                value=self._config.user_agent,
            ),
        ]
        if self._config.auth_mode == OpenAICompatibleLocalAuthMode.BEARER:
            assert self._config.api_key is not None
            headers.append(
                OpenAICompatibleLocalHTTPHeader(
                    name="Authorization",
                    value=f"Bearer {self._config.api_key}",
                )
            )
        headers.extend(self._config.extra_headers)
        return tuple(headers)

    def _validate_request_support(
        self,
        request: LLMProviderRequest,
        *,
        stream: bool,
    ) -> None:
        if request.route_kind == LLMRouteKind.PRIMARY_TOOL_REASONING:
            raise build_unsupported_capability_failure(
                message=(
                    "local openai-compatible provider does not support "
                    "'primary_tool_reasoning'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if (
            request.route_kind == LLMRouteKind.PRIMARY_RESPONSE
            and not self._config.supports_primary_response_route
        ):
            raise build_unsupported_capability_failure(
                message=(
                    "local openai-compatible provider is not configured to serve "
                    "'primary_response'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if stream and request.route_kind != LLMRouteKind.PRIMARY_RESPONSE:
            raise build_unsupported_capability_failure(
                message=(
                    "local openai-compatible streaming is only supported for "
                    "'primary_response'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if stream and not self._config.supports_primary_response_streaming:
            raise build_unsupported_capability_failure(
                message=(
                    "local openai-compatible provider is configured without "
                    "primary streaming support"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

    def _resolve_backend_model_name(self, request: LLMProviderRequest) -> str:
        # Registry profiles remain the main source of model selection.
        # The provider-local default model exists so local-family wiring stays
        # explicit even if a later shell constructs requests differently.
        return request.model_name or self._config.default_model_name

    def _build_response_format(
        self,
        request: LLMProviderRequest,
    ) -> dict[str, Any] | None:
        if (
            request.route_kind == LLMRouteKind.INTENT_ROUTING
            and self._config.prefer_json_object_for_intent_routing
        ):
            return {"type": "json_object"}
        return None

    def _build_stream_options(
        self,
        request: LLMProviderRequest,
        *,
        stream: bool,
    ) -> dict[str, Any] | None:
        if (
            stream
            and request.route_kind == LLMRouteKind.PRIMARY_RESPONSE
            and self._config.include_stream_usage
        ):
            return {"include_usage": True}
        return None

    def _encode_messages(
        self,
        request: LLMProviderRequest,
    ) -> tuple[OpenAICompatibleLocalMessagePayload, ...]:
        encoded: list[OpenAICompatibleLocalMessagePayload] = []
        if request.conversation.system_instructions is not None:
            encoded.append(
                OpenAICompatibleLocalMessagePayload(
                    role="system",
                    content=request.conversation.system_instructions,
                )
            )
        if request.conversation.developer_instructions is not None:
            encoded.append(
                self._encode_instruction_message(
                    role=LLMMessageRole.DEVELOPER,
                    content=request.conversation.developer_instructions,
                )
            )

        for message in request.conversation.messages:
            encoded.append(self._encode_conversation_message(message))
        return tuple(encoded)

    def _encode_instruction_message(
        self,
        *,
        role: LLMMessageRole,
        content: str,
    ) -> OpenAICompatibleLocalMessagePayload:
        if (
            role == LLMMessageRole.DEVELOPER
            and self._config.developer_role_mode
            == OpenAICompatibleLocalDeveloperRoleMode.DEVELOPER
        ):
            return OpenAICompatibleLocalMessagePayload(role="developer", content=content)
        prefix = _MESSAGE_ROLE_PREFIX[role.value]
        return OpenAICompatibleLocalMessagePayload(
            role="system",
            content=f"{prefix}:\n{content}",
        )

    def _encode_conversation_message(
        self,
        message: LLMMessage,
    ) -> OpenAICompatibleLocalMessagePayload:
        if message.role in {LLMMessageRole.SYSTEM, LLMMessageRole.DEVELOPER}:
            return self._encode_instruction_message(role=message.role, content=message.content)
        content: str | list[dict[str, Any]] = message.content
        if message.images:
            parts: list[dict[str, Any]] = [{"type": "text", "text": message.content}]
            for img in message.images:
                parts.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{img.media_type};base64,{img.data}",
                        "detail": img.detail.value,
                    },
                })
            content = parts
        return OpenAICompatibleLocalMessagePayload(
            role=message.role.value,
            content=content,
            name=message.name,
            tool_call_id=message.tool_call_id,
        )


@dataclass
class _OpenAICompatibleLocalStreamState:
    provider_key: str
    profile_key: str
    route_kind: LLMRouteKind
    next_delta_index: int = 0
    text_parts: list[str] = field(default_factory=list)
    completion_emitted: bool = False
    response_id: str | None = None
    usage: LLMUsageSnapshot | None = None


class OpenAICompatibleLocalResponseDecoder:
    """
    Decoder for one-shot and streaming chat-completions responses.
    """

    def __init__(self, config: OpenAICompatibleLocalProviderConfig) -> None:
        self._config = config

    def decode_one_shot(
        self,
        response: OpenAICompatibleLocalHTTPResponse,
        request: LLMProviderRequest,
    ) -> LLMOneShotOutput:
        if response.status_code >= 400:
            payload = self._parse_json_bytes(
                response.body,
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="OpenAICompatibleLocalStatusBodyDecodeError",
            )
            if not isinstance(payload, Mapping):
                raise build_malformed_response_failure(
                    message="local provider error payload was not a JSON object",
                    provider_key=request.provider_key,
                    profile_key=request.profile_key,
                    raw_error_type="LocalErrorBodyNotObject",
                )
            raise self._failure_from_status(
                status_code=response.status_code,
                payload=payload,
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

        payload = self._parse_json_bytes(
            response.body,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            raw_error_type="OpenAICompatibleLocalJSONDecodeError",
        )
        if not isinstance(payload, Mapping):
            raise build_malformed_response_failure(
                message="local provider payload was not a JSON object",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="LocalPayloadNotObject",
            )
        return self._decode_one_shot_payload(payload, request)

    async def decode_stream(
        self,
        raw_events: AsyncIterator[OpenAICompatibleLocalSSEEvent],
        request: LLMProviderRequest,
    ) -> AsyncIterator[LLMStreamOutput]:
        state = _OpenAICompatibleLocalStreamState(
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            route_kind=request.route_kind,
        )
        async for event in raw_events:
            for item in self._decode_stream_event(event, request, state):
                yield item

        if not state.completion_emitted:
            raise build_malformed_response_failure(
                message="local provider stream ended without terminal completion",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="MissingStreamCompletion",
            )

    def _decode_one_shot_payload(
        self,
        payload: Mapping[str, Any],
        request: LLMProviderRequest,
    ) -> LLMOneShotOutput:
        choice = self._extract_single_choice(
            payload,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            raw_error_type="LocalChoiceDecodeError",
        )
        output_text = self._extract_one_shot_text(
            choice,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )
        if request.route_kind == LLMRouteKind.INTENT_ROUTING:
            return self._normalize_intent_route_decision(
                output_text,
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        return LLMCompletion(
            finish_reason=self._extract_finish_reason(choice, payload),
            output_text=output_text,
            usage=self._extract_usage_snapshot(payload),
            provider_response_id=self._extract_response_id(payload),
        )

    def _decode_stream_event(
        self,
        event: OpenAICompatibleLocalSSEEvent,
        request: LLMProviderRequest,
        state: _OpenAICompatibleLocalStreamState,
    ) -> tuple[LLMStreamOutput, ...]:
        raw_data = event.data.strip()
        if raw_data == "[DONE]":
            return ()

        payload = self._parse_json_text(
            raw_data,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            raw_error_type="OpenAICompatibleLocalStreamJSONDecodeError",
        )
        if not isinstance(payload, Mapping):
            raise build_malformed_response_failure(
                message="local provider stream payload was not a JSON object",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="LocalStreamPayloadNotObject",
            )

        if state.response_id is None:
            state.response_id = self._extract_response_id(payload)
        usage = self._extract_usage_snapshot(payload)
        if usage is not None:
            state.usage = usage

        if "error" in payload:
            raise self._failure_from_error_object(
                error_object=payload["error"],
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

        choices = payload.get("choices")
        if not isinstance(choices, list):
            raise build_malformed_response_failure(
                message="local provider stream payload did not contain choices",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="MissingStreamChoices",
            )
        if not choices:
            return ()
        if len(choices) != 1:
            raise build_malformed_response_failure(
                message="local provider stream returned more than one choice",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="UnexpectedChoiceCount",
            )
        choice = choices[0]
        if not isinstance(choice, Mapping):
            raise build_malformed_response_failure(
                message="local provider stream choice was not an object",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="StreamChoiceNotObject",
            )
        if choice.get("index") not in {None, 0}:
            raise build_malformed_response_failure(
                message="local provider stream returned a non-zero choice index",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type="UnexpectedChoiceIndex",
            )

        items: list[LLMStreamOutput] = []
        delta_text = self._extract_stream_delta_text(
            choice,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )
        if delta_text is not None and delta_text != "":
            items.append(
                LLMTextDelta(
                    delta_index=state.next_delta_index,
                    text=delta_text,
                )
            )
            state.text_parts.append(delta_text)
            state.next_delta_index += 1

        finish_reason = choice.get("finish_reason")
        if finish_reason is not None:
            if state.completion_emitted:
                raise build_malformed_response_failure(
                    message="local provider stream emitted duplicate terminal completion",
                    provider_key=request.provider_key,
                    profile_key=request.profile_key,
                    raw_error_type="DuplicateStreamCompletion",
                )
            state.completion_emitted = True
            items.append(
                LLMCompletion(
                    finish_reason=self._map_finish_reason_token(str(finish_reason)),
                    output_text="".join(state.text_parts),
                    usage=state.usage,
                    provider_response_id=state.response_id,
                )
            )
        return tuple(items)

    def _extract_single_choice(
        self,
        payload: Mapping[str, Any],
        *,
        provider_key: str,
        profile_key: str,
        raw_error_type: str,
    ) -> Mapping[str, Any]:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise build_malformed_response_failure(
                message="local provider payload did not contain at least one choice",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=raw_error_type,
            )
        first = choices[0]
        if not isinstance(first, Mapping):
            raise build_malformed_response_failure(
                message="local provider choice was not an object",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=raw_error_type,
            )
        return first

    def _extract_one_shot_text(
        self,
        choice: Mapping[str, Any],
        *,
        provider_key: str,
        profile_key: str,
    ) -> str:
        if "message" in choice:
            message = choice["message"]
            if not isinstance(message, Mapping):
                raise build_malformed_response_failure(
                    message="local provider choice.message was not an object",
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type="MessageNotObject",
                )
            return self._extract_message_content_text(
                message,
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="MessageContentDecodeError",
            )
        if "text" in choice and isinstance(choice["text"], str):
            return choice["text"]
        raise build_malformed_response_failure(
            message="local provider choice did not contain assistant text",
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type="MissingChoiceText",
        )

    def _extract_stream_delta_text(
        self,
        choice: Mapping[str, Any],
        *,
        provider_key: str,
        profile_key: str,
    ) -> str | None:
        delta = choice.get("delta")
        if delta is None:
            return None
        if not isinstance(delta, Mapping):
            raise build_malformed_response_failure(
                message="local provider stream delta was not an object",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="DeltaNotObject",
            )
        content = delta.get("content")
        if content is None:
            return None
        return self._normalize_content_value(
            content,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type="StreamDeltaContentDecodeError",
        )

    def _extract_message_content_text(
        self,
        message: Mapping[str, Any],
        *,
        provider_key: str,
        profile_key: str,
        raw_error_type: str,
    ) -> str:
        return self._normalize_content_value(
            message.get("content"),
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=raw_error_type,
        )

    def _normalize_content_value(
        self,
        content: Any,
        *,
        provider_key: str,
        profile_key: str,
        raw_error_type: str,
    ) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    text_parts.append(item)
                    continue
                if not isinstance(item, Mapping):
                    raise build_malformed_response_failure(
                        message="local provider content part was not decodable text",
                        provider_key=provider_key,
                        profile_key=profile_key,
                        raw_error_type=raw_error_type,
                    )
                text_value = item.get("text")
                if isinstance(text_value, str):
                    text_parts.append(text_value)
                    continue
                if isinstance(text_value, Mapping):
                    nested = text_value.get("value")
                    if isinstance(nested, str):
                        text_parts.append(nested)
                        continue
                if item.get("type") == "text" and isinstance(item.get("value"), str):
                    text_parts.append(str(item["value"]))
                    continue
                raise build_malformed_response_failure(
                    message="local provider content part was not decodable text",
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=raw_error_type,
                )
            return "".join(text_parts)
        raise build_malformed_response_failure(
            message="local provider content was not plain text",
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=raw_error_type,
        )

    def _normalize_intent_route_decision(
        self,
        output_text: str,
        *,
        provider_key: str,
        profile_key: str,
    ) -> LLMIntentRouteDecision:
        cleaned = output_text.strip()
        if not cleaned:
            raise build_malformed_response_failure(
                message="intent routing output was empty",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="EmptyIntentRoutingOutput",
            )
        direct_token = self._try_parse_intent_decision_token(cleaned)
        if direct_token is not None:
            return LLMIntentRouteDecision(decision_kind=direct_token)

        json_payload = self._try_parse_json_objectish_text(cleaned)
        if json_payload is None:
            raise build_malformed_response_failure(
                message="intent routing output was not valid structured decision text",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="IntentRoutingParseError",
            )
        decision_kind_raw = json_payload.get("decision_kind")
        if not isinstance(decision_kind_raw, str):
            raise build_malformed_response_failure(
                message="intent routing output did not include decision_kind",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="MissingIntentDecisionKind",
            )
        confidence = json_payload.get("confidence")
        reason_text = json_payload.get("reason_text")
        try:
            return LLMIntentRouteDecision(
                decision_kind=LLMIntentDecisionKind(decision_kind_raw),
                confidence=confidence,
                reason_text=(
                    reason_text
                    if isinstance(reason_text, str) or reason_text is None
                    else str(reason_text)
                ),
            )
        except (ValueError, TypeError) as exc:
            raise build_malformed_response_failure(
                message="intent routing output could not be normalized",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            ) from exc

    def _try_parse_intent_decision_token(
        self,
        payload: str,
    ) -> LLMIntentDecisionKind | None:
        normalized = payload.strip().strip('"').strip("'")
        try:
            return LLMIntentDecisionKind(normalized)
        except ValueError:
            return None

    def _try_parse_json_objectish_text(self, payload: str) -> Mapping[str, Any] | None:
        stripped = payload.strip()
        if stripped.startswith("```") and stripped.endswith("```"):
            stripped = self._strip_markdown_code_fence(stripped)
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return None
        if not isinstance(parsed, Mapping):
            return None
        return parsed

    def _strip_markdown_code_fence(self, payload: str) -> str:
        lines = payload.splitlines()
        if len(lines) >= 2 and lines[0].startswith("```") and lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
        return payload

    def _extract_finish_reason(
        self,
        choice: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> LLMFinishReason:
        finish_reason = choice.get("finish_reason")
        if isinstance(finish_reason, str):
            return self._map_finish_reason_token(finish_reason)
        object_level = payload.get("finish_reason")
        if isinstance(object_level, str):
            return self._map_finish_reason_token(object_level)
        return LLMFinishReason.STOP

    def _map_finish_reason_token(self, token: str) -> LLMFinishReason:
        normalized = token.strip().lower()
        if normalized in {"stop", "completed"}:
            return LLMFinishReason.STOP
        if normalized in {"length", "max_tokens"}:
            return LLMFinishReason.LENGTH
        if normalized in {"cancelled", "canceled"}:
            return LLMFinishReason.CANCELLED
        if normalized in {"tool_calls", "tool_call"}:
            return LLMFinishReason.TOOL_CALL
        if normalized in {"error", "failed", "provider_error"}:
            return LLMFinishReason.PROVIDER_ERROR
        return LLMFinishReason.STOP

    def _extract_usage_snapshot(self, payload: Mapping[str, Any]) -> LLMUsageSnapshot | None:
        usage = payload.get("usage")
        if not isinstance(usage, Mapping):
            return None
        input_tokens = usage.get("prompt_tokens")
        output_tokens = usage.get("completion_tokens")
        cached_input_tokens = usage.get("cached_prompt_tokens")
        if not any(
            isinstance(value, int)
            for value in (input_tokens, output_tokens, cached_input_tokens)
        ):
            return None
        return LLMUsageSnapshot(
            input_tokens=input_tokens if isinstance(input_tokens, int) else None,
            output_tokens=output_tokens if isinstance(output_tokens, int) else None,
            cached_input_tokens=(
                cached_input_tokens if isinstance(cached_input_tokens, int) else None
            ),
        )

    def _extract_response_id(self, payload: Mapping[str, Any]) -> str | None:
        response_id = payload.get("id")
        if isinstance(response_id, str):
            return response_id
        return None

    def _parse_json_bytes(
        self,
        payload: bytes,
        *,
        provider_key: str,
        profile_key: str,
        raw_error_type: str,
    ) -> Any:
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise build_malformed_response_failure(
                message="local provider payload was not valid utf-8",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="LocalUTF8DecodeError",
            ) from exc
        return self._parse_json_text(
            text,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=raw_error_type,
        )

    def _parse_json_text(
        self,
        payload: str,
        *,
        provider_key: str,
        profile_key: str,
        raw_error_type: str,
    ) -> Any:
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise build_malformed_response_failure(
                message="local provider payload was not valid JSON",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=raw_error_type,
            ) from exc

    def _failure_from_status(
        self,
        *,
        status_code: int,
        payload: Mapping[str, Any] | None,
        provider_key: str,
        profile_key: str,
    ) -> LLMProviderFailure:
        error_object = payload.get("error") if payload is not None else None
        if error_object is not None:
            failure = self._try_failure_from_error_object(
                error_object=error_object,
                provider_key=provider_key,
                profile_key=profile_key,
                status_code=status_code,
            )
            if failure is not None:
                return failure
        message = self._extract_error_message(payload) or (
            f"local openai-compatible request failed with HTTP {status_code}"
        )
        return provider_failure_from_error(
            build_provider_error(
                error_code=self._map_status_code_to_error_code(status_code),
                message=message,
                retryable=self._is_retryable_status(status_code),
                provider_key=provider_key,
                profile_key=profile_key,
                status_code=status_code,
                raw_error_type=self._extract_error_type(payload) or "HTTPStatusError",
            )
        )

    def _failure_from_error_object(
        self,
        *,
        error_object: Any,
        provider_key: str,
        profile_key: str,
        status_code: int | None = None,
    ) -> LLMProviderFailure:
        failure = self._try_failure_from_error_object(
            error_object=error_object,
            provider_key=provider_key,
            profile_key=profile_key,
            status_code=status_code,
        )
        if failure is not None:
            return failure
        raise build_malformed_response_failure(
            message="local provider error payload did not contain a valid error object",
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type="MalformedErrorObject",
        )

    def _try_failure_from_error_object(
        self,
        *,
        error_object: Any,
        provider_key: str,
        profile_key: str,
        status_code: int | None = None,
    ) -> LLMProviderFailure | None:
        if not isinstance(error_object, Mapping):
            return None
        message = error_object.get("message")
        if not isinstance(message, str) or not message.strip():
            return None
        error_type = error_object.get("type")
        error_code = error_object.get("code")
        llm_error_code = self._map_error_object_code(
            error_type=error_type if isinstance(error_type, str) else None,
            error_code=error_code if isinstance(error_code, str) else None,
            status_code=status_code,
        )
        return provider_failure_from_error(
            build_provider_error(
                error_code=llm_error_code,
                message=message,
                retryable=self._is_retryable_error_code(llm_error_code),
                provider_key=provider_key,
                profile_key=profile_key,
                status_code=status_code,
                raw_error_type=error_type if isinstance(error_type, str) else "ProviderError",
            )
        )

    def _map_error_object_code(
        self,
        *,
        error_type: str | None,
        error_code: str | None,
        status_code: int | None,
    ) -> LLMProviderErrorCode:
        joined = " ".join(
            part.strip().lower()
            for part in (error_type, error_code)
            if isinstance(part, str) and part.strip()
        )
        if status_code in {401, 403} or "auth" in joined or "api_key" in joined:
            return LLMProviderErrorCode.AUTH_FAILED
        if status_code == 429 or "rate" in joined or "quota" in joined:
            return LLMProviderErrorCode.RATE_LIMITED
        if status_code == 408 or "timeout" in joined:
            return LLMProviderErrorCode.TIMEOUT
        if "invalid_request" in joined or "validation" in joined:
            return LLMProviderErrorCode.VALIDATION_ERROR
        if status_code is not None and 500 <= status_code <= 599:
            return LLMProviderErrorCode.PROVIDER_UNAVAILABLE
        return LLMProviderErrorCode.PROVIDER_UNAVAILABLE

    def _map_status_code_to_error_code(self, status_code: int) -> LLMProviderErrorCode:
        if status_code in {401, 403}:
            return LLMProviderErrorCode.AUTH_FAILED
        if status_code == 429:
            return LLMProviderErrorCode.RATE_LIMITED
        if status_code == 408:
            return LLMProviderErrorCode.TIMEOUT
        if status_code in {400, 404, 409, 422}:
            return LLMProviderErrorCode.VALIDATION_ERROR
        if 500 <= status_code <= 599:
            return LLMProviderErrorCode.PROVIDER_UNAVAILABLE
        return LLMProviderErrorCode.PROVIDER_UNAVAILABLE

    def _is_retryable_status(self, status_code: int) -> bool:
        if status_code in {401, 403, 400, 404, 409, 422}:
            return False
        if status_code in {408, 429}:
            return True
        return 500 <= status_code <= 599

    def _is_retryable_error_code(self, error_code: LLMProviderErrorCode) -> bool:
        return error_code in {
            LLMProviderErrorCode.RATE_LIMITED,
            LLMProviderErrorCode.TIMEOUT,
            LLMProviderErrorCode.PROVIDER_UNAVAILABLE,
        }

    def _extract_error_message(self, payload: Mapping[str, Any] | None) -> str | None:
        if payload is None:
            return None
        error_object = payload.get("error")
        if isinstance(error_object, Mapping):
            message = error_object.get("message")
            if isinstance(message, str) and message.strip():
                return message
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message
        return None

    def _extract_error_type(self, payload: Mapping[str, Any] | None) -> str | None:
        if payload is None:
            return None
        error_object = payload.get("error")
        if isinstance(error_object, Mapping):
            error_type = error_object.get("type")
            if isinstance(error_type, str) and error_type.strip():
                return error_type
        return None


class OpenAICompatibleLocalProvider(LLMProviderPort):
    """
    First concrete local fast-path provider family for Echo.

    This adapter targets a generic OpenAI-compatible chat-completions seam,
    making it suitable for backends such as sglang without importing backend
    internals or leaking transport payloads above `packages/llm`.
    """

    def __init__(
        self,
        config: OpenAICompatibleLocalProviderConfig,
        transport: OpenAICompatibleLocalTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or OpenAICompatibleLocalUrllibTransport()
        self._encoder = OpenAICompatibleLocalRequestEncoder(config)
        self._decoder = OpenAICompatibleLocalResponseDecoder(config)
        self._descriptor = self._build_descriptor(config)

    def _build_descriptor(
        self,
        config: OpenAICompatibleLocalProviderConfig,
    ) -> LLMProviderDescriptor:
        allowed_routes: list[LLMRouteKind] = [
            LLMRouteKind.INTENT_ROUTING,
            LLMRouteKind.QUICK_REACTION,
            LLMRouteKind.AMBIENT_PRESENCE,
        ]
        if config.supports_primary_response_route:
            allowed_routes.append(LLMRouteKind.PRIMARY_RESPONSE)
        return LLMProviderDescriptor(
            provider_key=config.provider_key,
            display_name=config.display_name,
            supports_one_shot=True,
            supports_streaming=config.supports_primary_response_streaming,
            supports_structured_intent_routing=True,
            supports_tool_reasoning=False,
            allowed_routes=tuple(allowed_routes),
        )

    def get_config(self) -> OpenAICompatibleLocalProviderConfig:
        return self._config

    def get_transport(self) -> OpenAICompatibleLocalTransportPort:
        return self._transport

    async def inspect_capabilities(self) -> LLMProviderDescriptor:
        return self._descriptor

    async def generate(self, request: LLMProviderRequest) -> LLMOneShotOutput:
        self._ensure_request_targets_this_provider(request)
        self._ensure_generate_supported(request)
        http_request = self._encoder.build_http_request(request, stream=False)
        try:
            response = await self._transport.send(http_request)
        except LLMProviderFailure:
            raise
        except BaseException as exc:
            raise self._map_transport_exception(
                exc,
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            ) from exc
        return self._decoder.decode_one_shot(response, request)

    async def stream(self, request: LLMProviderRequest) -> AsyncIterator[LLMStreamOutput]:
        self._ensure_request_targets_this_provider(request)
        self._ensure_stream_supported(request)
        http_request = self._encoder.build_http_request(request, stream=True)
        try:
            raw_events = self._transport.stream(http_request)
            async for item in self._decoder.decode_stream(raw_events, request):
                yield item
        except LLMProviderFailure:
            raise
        except BaseException as exc:
            raise self._map_transport_exception(
                exc,
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            ) from exc

    def _ensure_request_targets_this_provider(self, request: LLMProviderRequest) -> None:
        if request.provider_key != self._config.provider_key:
            raise build_unsupported_capability_failure(
                message=(
                    f"provider '{self._config.provider_key}' cannot serve request "
                    f"resolved for provider '{request.provider_key}'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

    def _ensure_generate_supported(self, request: LLMProviderRequest) -> None:
        ensure_provider_can_serve_route(
            self._descriptor,
            request.route_kind,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )
        ensure_provider_supports_one_shot(
            self._descriptor,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )
        if request.route_kind == LLMRouteKind.PRIMARY_TOOL_REASONING:
            raise build_unsupported_capability_failure(
                message=(
                    "local openai-compatible provider does not support "
                    "'primary_tool_reasoning'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

    def _ensure_stream_supported(self, request: LLMProviderRequest) -> None:
        ensure_provider_can_serve_route(
            self._descriptor,
            request.route_kind,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )
        ensure_provider_supports_streaming(
            self._descriptor,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )
        if request.route_kind != LLMRouteKind.PRIMARY_RESPONSE:
            raise build_unsupported_capability_failure(
                message=(
                    "local openai-compatible streaming is only supported for "
                    "'primary_response'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

    def _map_transport_exception(
        self,
        exc: BaseException,
        *,
        provider_key: str,
        profile_key: str,
    ) -> LLMProviderFailure:
        if isinstance(exc, LLMProviderFailure):
            return exc
        if isinstance(exc, OpenAICompatibleLocalHTTPStatusError):
            payload: Mapping[str, Any] | None = None
            if exc.body:
                try:
                    raw_payload = self._decoder._parse_json_bytes(
                        exc.body,
                        provider_key=provider_key,
                        profile_key=profile_key,
                        raw_error_type="OpenAICompatibleLocalStatusBodyDecodeError",
                    )
                    if isinstance(raw_payload, Mapping):
                        payload = raw_payload
                except LLMProviderFailure:
                    payload = None
            return self._decoder._failure_from_status(
                status_code=exc.status_code,
                payload=payload,
                provider_key=provider_key,
                profile_key=profile_key,
            )
        if isinstance(exc, OpenAICompatibleLocalTimeoutError):
            return provider_failure_from_error(
                build_provider_error(
                    error_code=LLMProviderErrorCode.TIMEOUT,
                    message=str(exc) or "local openai-compatible request timed out",
                    retryable=True,
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=type(exc).__name__,
                )
            )
        if isinstance(exc, asyncio.CancelledError):
            return provider_failure_from_error(
                build_provider_error(
                    error_code=LLMProviderErrorCode.CANCELLED,
                    message="local openai-compatible request was cancelled",
                    retryable=False,
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=type(exc).__name__,
                )
            )
        if isinstance(exc, OpenAICompatibleLocalMalformedStreamError):
            return build_malformed_response_failure(
                message=str(exc) or "local openai-compatible stream was malformed",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            )
        if isinstance(exc, OpenAICompatibleLocalNetworkError):
            return provider_failure_from_error(
                build_provider_error(
                    error_code=LLMProviderErrorCode.PROVIDER_UNAVAILABLE,
                    message=str(exc) or "local openai-compatible provider became unavailable",
                    retryable=True,
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=type(exc).__name__,
                )
            )
        return provider_failure_from_error(
            build_provider_error(
                error_code=LLMProviderErrorCode.PROVIDER_UNAVAILABLE,
                message=str(exc) or "local openai-compatible provider became unavailable",
                retryable=True,
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            )
        )


__all__ = [
    "OpenAICompatibleLocalAuthMode",
    "OpenAICompatibleLocalDeveloperRoleMode",
    "OpenAICompatibleLocalHTTPHeader",
    "OpenAICompatibleLocalHTTPRequest",
    "OpenAICompatibleLocalHTTPResponse",
    "OpenAICompatibleLocalHTTPStatusError",
    "OpenAICompatibleLocalMalformedStreamError",
    "OpenAICompatibleLocalMessagePayload",
    "OpenAICompatibleLocalNetworkError",
    "OpenAICompatibleLocalProvider",
    "OpenAICompatibleLocalProviderConfig",
    "OpenAICompatibleLocalRequestEncoder",
    "OpenAICompatibleLocalRequestPayload",
    "OpenAICompatibleLocalResponseDecoder",
    "OpenAICompatibleLocalSSEEvent",
    "OpenAICompatibleLocalTimeoutError",
    "OpenAICompatibleLocalTransportError",
    "OpenAICompatibleLocalTransportPort",
    "OpenAICompatibleLocalUrllibTransport",
]
