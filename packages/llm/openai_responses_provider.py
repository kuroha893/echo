from __future__ import annotations

import asyncio
import json
import socket
import threading
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable
from urllib import error as urllib_error
from urllib import request as urllib_request

from pydantic import Field, field_validator

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


_DEFAULT_BASE_URL = "https://api.openai.com/v1"
_RESPONSES_PATH = "/responses"
_STREAM_DONE_SENTINEL = object()
_IGNORED_STREAM_EVENT_TYPES = frozenset(
    {
        "response.created",
        "response.in_progress",
        "response.output_item.added",
        "response.output_item.done",
        "response.content_part.added",
        "response.content_part.done",
        "response.output_text.done",
        "response.output_text.annotation.added",
        "response.output_text.annotation.done",
        "response.refusal.delta",
        "response.refusal.done",
    }
)
_MESSAGE_ROLE_PREFIX = {
    "system": "System instructions",
    "developer": "Developer instructions",
}


class OpenAIResponsesProviderConfig(LLMModel):
    provider_key: str = Field(default="openai.responses", min_length=1, max_length=128)
    base_url: str = Field(default=_DEFAULT_BASE_URL, min_length=1, max_length=512)
    api_key: str = Field(min_length=1, max_length=512)
    request_timeout_ms: int = Field(default=30_000, ge=1)
    organization_id: str | None = Field(default=None, min_length=1, max_length=256)
    project_id: str | None = Field(default=None, min_length=1, max_length=256)
    user_agent: str = Field(
        default="echo-openai-responses-provider/0.1",
        min_length=1,
        max_length=256,
    )

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("base_url must not be blank")
        if not (cleaned.startswith("http://") or cleaned.startswith("https://")):
            raise ValueError("base_url must start with http:// or https://")
        return cleaned.rstrip("/")

    @field_validator("api_key")
    @classmethod
    def normalize_api_key(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("api_key must not be blank")
        return cleaned

    @field_validator("organization_id", "project_id", "user_agent")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text config fields must not be blank when provided")
        return cleaned

    @property
    def responses_url(self) -> str:
        return f"{self.base_url}{_RESPONSES_PATH}"


class OpenAIResponsesHTTPHeader(LLMModel):
    name: str = Field(min_length=1, max_length=256)
    value: str = Field(min_length=1, max_length=1024)

    @field_validator("name", "value")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("headers must not contain blank names or values")
        return cleaned


class OpenAIResponsesHTTPRequest(LLMModel):
    method: str = Field(default="POST", min_length=1, max_length=16)
    url: str = Field(min_length=1, max_length=1024)
    headers: tuple[OpenAIResponsesHTTPHeader, ...] = ()
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
    ) -> tuple[OpenAIResponsesHTTPHeader, ...]:
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


class OpenAIResponsesHTTPResponse(LLMModel):
    status_code: int = Field(ge=100, le=599)
    headers: tuple[OpenAIResponsesHTTPHeader, ...] = ()
    body: bytes = b""

    @field_validator("headers", mode="before")
    @classmethod
    def normalize_headers(
        cls,
        value: object,
    ) -> tuple[OpenAIResponsesHTTPHeader, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]


class OpenAIResponsesSSEEvent(LLMModel):
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


@runtime_checkable
class OpenAIResponsesTransportPort(Protocol):
    async def send(self, request: OpenAIResponsesHTTPRequest) -> OpenAIResponsesHTTPResponse:
        ...

    async def stream(
        self,
        request: OpenAIResponsesHTTPRequest,
    ) -> AsyncIterator[OpenAIResponsesSSEEvent]:
        ...


class OpenAIResponsesTransportError(Exception):
    pass


class OpenAIResponsesHTTPStatusError(OpenAIResponsesTransportError):
    def __init__(
        self,
        *,
        status_code: int,
        body: bytes = b"",
        headers: tuple[OpenAIResponsesHTTPHeader, ...] = (),
        raw_error_type: str = "HTTPStatusError",
    ) -> None:
        super().__init__(f"OpenAI Responses request failed with HTTP {status_code}")
        self.status_code = status_code
        self.body = body
        self.headers = headers
        self.raw_error_type = raw_error_type


class OpenAIResponsesTimeoutError(OpenAIResponsesTransportError):
    pass


class OpenAIResponsesNetworkError(OpenAIResponsesTransportError):
    pass


class OpenAIResponsesMalformedStreamError(OpenAIResponsesTransportError):
    pass


def _normalize_header_pairs(
    headers: Iterable[tuple[str, str]] | Mapping[str, str] | None,
) -> tuple[OpenAIResponsesHTTPHeader, ...]:
    if headers is None:
        return ()
    if isinstance(headers, Mapping):
        items = headers.items()
    else:
        items = headers
    normalized: list[OpenAIResponsesHTTPHeader] = []
    for name, value in items:
        normalized.append(OpenAIResponsesHTTPHeader(name=name, value=value))
    return tuple(normalized)


class OpenAIResponsesUrllibTransport(OpenAIResponsesTransportPort):
    """
    Minimal stdlib transport for the official OpenAI Responses HTTPS endpoint.
    """

    async def send(self, request: OpenAIResponsesHTTPRequest) -> OpenAIResponsesHTTPResponse:
        try:
            return await asyncio.to_thread(self._send_sync, request)
        except asyncio.CancelledError as exc:
            raise LLMCancelledFailure(
                build_provider_error(
                    error_code=LLMProviderErrorCode.CANCELLED,
                    message="openai responses request was cancelled",
                    retryable=False,
                    raw_error_type=type(exc).__name__,
                )
            ) from exc

    async def stream(
        self,
        request: OpenAIResponsesHTTPRequest,
    ) -> AsyncIterator[OpenAIResponsesSSEEvent]:
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
                    message="openai responses stream was cancelled",
                    retryable=False,
                    raw_error_type=type(exc).__name__,
                )
            ) from exc

    def _send_sync(self, request: OpenAIResponsesHTTPRequest) -> OpenAIResponsesHTTPResponse:
        url_request = urllib_request.Request(
            url=request.url,
            data=request.body,
            method=request.method,
            headers=request.headers_as_mapping(),
        )
        try:
            with urllib_request.urlopen(
                url_request,
                timeout=request.timeout_ms / 1000,
            ) as response:
                return OpenAIResponsesHTTPResponse(
                    status_code=getattr(response, "status", response.getcode()),
                    headers=_normalize_header_pairs(response.headers.items()),
                    body=response.read(),
                )
        except urllib_error.HTTPError as exc:
            body = exc.read()
            raise OpenAIResponsesHTTPStatusError(
                status_code=exc.code,
                body=body,
                headers=_normalize_header_pairs(exc.headers.items() if exc.headers else None),
            ) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise OpenAIResponsesTimeoutError("openai responses request timed out") from exc
        except urllib_error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise OpenAIResponsesTimeoutError(
                    "openai responses request timed out"
                ) from exc
            raise OpenAIResponsesNetworkError(
                str(reason) or "openai responses request failed"
            ) from exc

    def _stream_sync_worker(
        self,
        request: OpenAIResponsesHTTPRequest,
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
        request: OpenAIResponsesHTTPRequest,
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
            with urllib_request.urlopen(
                url_request,
                timeout=request.timeout_ms / 1000,
            ) as response:
                self._read_sse_events(response, output_queue, loop, stop_event)
        except urllib_error.HTTPError as exc:
            body = exc.read()
            raise OpenAIResponsesHTTPStatusError(
                status_code=exc.code,
                body=body,
                headers=_normalize_header_pairs(exc.headers.items() if exc.headers else None),
            ) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise OpenAIResponsesTimeoutError("openai responses stream timed out") from exc
        except urllib_error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise OpenAIResponsesTimeoutError(
                    "openai responses stream timed out"
                ) from exc
            raise OpenAIResponsesNetworkError(
                str(reason) or "openai responses stream failed"
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
                raise OpenAIResponsesMalformedStreamError(
                    "stream line was not valid utf-8"
                ) from exc
            stripped = line.rstrip("\r\n")
            if not stripped:
                if data_lines:
                    loop.call_soon_threadsafe(
                        output_queue.put_nowait,
                        OpenAIResponsesSSEEvent(
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
            raise OpenAIResponsesMalformedStreamError(
                "stream contained a non-SSE line"
            )
        if data_lines:
            loop.call_soon_threadsafe(
                output_queue.put_nowait,
                OpenAIResponsesSSEEvent(
                    event=event_name,
                    data="\n".join(data_lines),
                ),
            )


class OpenAIResponsesRequestEncoder:
    """
    Deterministic request encoder from llm-local input to Responses payloads.
    """

    def __init__(self, config: OpenAIResponsesProviderConfig) -> None:
        self._config = config

    def build_http_request(
        self,
        request: LLMProviderRequest,
        *,
        stream: bool,
    ) -> OpenAIResponsesHTTPRequest:
        payload = self.build_payload(request, stream=stream)
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        return OpenAIResponsesHTTPRequest(
            url=self._config.responses_url,
            headers=self._build_headers(stream=stream),
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
    ) -> dict[str, Any]:
        self._validate_request_support(request, stream=stream)
        generation_config = request.effective_generation_config
        payload: dict[str, Any] = {
            "model": request.model_name,
            "input": self._encode_input_messages(request),
            "stream": stream,
            "max_output_tokens": generation_config.max_output_tokens,
        }
        instructions = self._build_instructions_text(request)
        if instructions is not None:
            payload["instructions"] = instructions
        if generation_config.temperature is not None:
            payload["temperature"] = generation_config.temperature
        if generation_config.top_p is not None:
            payload["top_p"] = generation_config.top_p
        if self._should_force_disabled_thinking(request):
            payload["thinking"] = {"type": "disabled"}
        return payload

    def _should_force_disabled_thinking(
        self,
        request: LLMProviderRequest,
    ) -> bool:
        base_url = self._config.base_url.lower()
        if "volces.com" not in base_url:
            return False
        model_name = request.model_name.strip().lower()
        return model_name.startswith("doubao-")

    def _build_headers(
        self,
        *,
        stream: bool,
    ) -> tuple[OpenAIResponsesHTTPHeader, ...]:
        headers = [
            OpenAIResponsesHTTPHeader(name="Authorization", value=f"Bearer {self._config.api_key}"),
            OpenAIResponsesHTTPHeader(name="Content-Type", value="application/json"),
            OpenAIResponsesHTTPHeader(name="Accept", value="text/event-stream" if stream else "application/json"),
            OpenAIResponsesHTTPHeader(name="User-Agent", value=self._config.user_agent),
        ]
        if self._config.organization_id is not None:
            headers.append(
                OpenAIResponsesHTTPHeader(
                    name="OpenAI-Organization",
                    value=self._config.organization_id,
                )
            )
        if self._config.project_id is not None:
            headers.append(
                OpenAIResponsesHTTPHeader(
                    name="OpenAI-Project",
                    value=self._config.project_id,
                )
            )
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
                    "openai responses provider shell does not yet support "
                    "'primary_tool_reasoning'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if request.effective_generation_config.stop_sequences:
            raise build_unsupported_capability_failure(
                message=(
                    "openai responses provider shell does not yet encode "
                    "stop_sequences"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if request.effective_generation_config.seed is not None:
            raise build_unsupported_capability_failure(
                message=(
                    "openai responses provider shell does not yet encode "
                    "seeded generation"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if stream and request.route_kind == LLMRouteKind.QUICK_REACTION:
            raise build_unsupported_capability_failure(
                message=(
                    "openai responses provider shell does not expose streaming "
                    "quick_reaction in v0.1"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

    def _encode_input_messages(self, request: LLMProviderRequest) -> list[dict[str, Any]]:
        encoded_messages: list[dict[str, Any]] = []
        for message in request.conversation.messages:
            content_parts: list[dict[str, Any]] = [
                {
                    "type": "input_text",
                    "text": message.content,
                }
            ]
            for img in message.images:
                content_parts.append({
                    "type": "input_image",
                    "image_url": f"data:{img.media_type};base64,{img.data}",
                    "detail": img.detail.value,
                })
            payload: dict[str, Any] = {
                "role": message.role.value,
                "content": content_parts,
            }
            if message.name is not None:
                payload["name"] = message.name
            if message.tool_call_id is not None:
                payload["tool_call_id"] = message.tool_call_id
            encoded_messages.append(payload)
        return encoded_messages

    def _build_instructions_text(self, request: LLMProviderRequest) -> str | None:
        sections: list[str] = []
        if request.conversation.system_instructions is not None:
            sections.append(
                self._format_instruction_section(
                    _MESSAGE_ROLE_PREFIX["system"],
                    request.conversation.system_instructions,
                )
            )
        if request.conversation.developer_instructions is not None:
            sections.append(
                self._format_instruction_section(
                    _MESSAGE_ROLE_PREFIX["developer"],
                    request.conversation.developer_instructions,
                )
            )
        if not sections:
            return None
        return "\n\n".join(sections)

    @staticmethod
    def _format_instruction_section(title: str, content: str) -> str:
        return f"{title}:\n{content}"


@dataclass
class _DecodedCompletionEnvelope:
    completion: LLMCompletion
    raw_payload: dict[str, Any]


@dataclass
class _StreamDecodeState:
    provider_key: str
    profile_key: str
    request_id: str
    text_parts: list[str] = field(default_factory=list)
    final_output_text: str | None = None
    next_delta_index: int = 0
    completion_seen: bool = False
    stream_done_seen: bool = False

    @property
    def accumulated_text(self) -> str:
        return "".join(self.text_parts)


class OpenAIResponsesResponseDecoder:
    """
    Decodes HTTP JSON bodies and streamed SSE events into llm-local outputs.
    """

    def __init__(self, config: OpenAIResponsesProviderConfig) -> None:
        self._config = config

    def decode_one_shot(
        self,
        response: OpenAIResponsesHTTPResponse,
        request: LLMProviderRequest,
    ) -> LLMCompletion:
        payload = self._parse_json_bytes(
            response.body,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            raw_error_type="OpenAIResponsesJSONDecodeError",
        )
        if response.status_code < 200 or response.status_code >= 300:
            raise self._failure_from_status(
                status_code=response.status_code,
                payload=payload if isinstance(payload, dict) else None,
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        if not isinstance(payload, dict):
            raise build_malformed_response_failure(
                message="openai responses body must decode to a JSON object",
                provider_key=request.provider_key,
                profile_key=request.profile_key,
                raw_error_type=type(payload).__name__,
            )
        if "error" in payload and payload["error"] is not None:
            raise self._failure_from_error_object(
                error_object=payload["error"],
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )
        return self._decode_completion_object(
            payload,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        ).completion

    async def decode_stream(
        self,
        events: AsyncIterator[OpenAIResponsesSSEEvent],
        request: LLMProviderRequest,
    ) -> AsyncIterator[LLMStreamOutput]:
        state = _StreamDecodeState(
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            request_id=str(request.request_id),
        )
        try:
            async for event in events:
                async for item in self._decode_stream_event(event, state):
                    yield item
            if not state.completion_seen:
                fallback_output_text = state.final_output_text or state.accumulated_text
                if fallback_output_text != "":
                    yield self._decode_completion_object(
                        {},
                        provider_key=request.provider_key,
                        profile_key=request.profile_key,
                        fallback_output_text=fallback_output_text,
                    ).completion
                    state.completion_seen = True
                    return
                raise build_malformed_response_failure(
                    message="openai responses stream ended without response.completed",
                    provider_key=request.provider_key,
                    profile_key=request.profile_key,
                    raw_error_type="MissingStreamCompletion",
                )
        except asyncio.CancelledError as exc:
            raise LLMCancelledFailure(
                build_provider_error(
                    error_code=LLMProviderErrorCode.CANCELLED,
                    message="openai responses stream was cancelled",
                    retryable=False,
                    provider_key=request.provider_key,
                    profile_key=request.profile_key,
                    raw_error_type=type(exc).__name__,
                )
            ) from exc

    async def _decode_stream_event(
        self,
        event: OpenAIResponsesSSEEvent,
        state: _StreamDecodeState,
    ) -> AsyncIterator[LLMStreamOutput]:
        if event.data == "[DONE]":
            state.stream_done_seen = True
            return
        payload = self._parse_json_text(
            event.data,
            provider_key=state.provider_key,
            profile_key=state.profile_key,
            raw_error_type="OpenAIResponsesStreamJSONDecodeError",
        )
        if not isinstance(payload, dict):
            raise build_malformed_response_failure(
                message="stream event payload must decode to a JSON object",
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type=type(payload).__name__,
            )
        event_type = payload.get("type")
        if not isinstance(event_type, str) or not event_type.strip():
            raise build_malformed_response_failure(
                message="stream event payload was missing a valid 'type'",
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="MissingStreamEventType",
            )
        if event_type == "error":
            raise self._failure_from_error_object(
                error_object=payload.get("error", payload),
                provider_key=state.provider_key,
                profile_key=state.profile_key,
            )
        if event_type == "response.failed":
            error_object = payload.get("error")
            if error_object is not None:
                raise self._failure_from_error_object(
                    error_object=error_object,
                    provider_key=state.provider_key,
                    profile_key=state.profile_key,
                )
            raise build_malformed_response_failure(
                message="response.failed event did not include an error object",
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="MissingFailedErrorObject",
            )
        if event_type == "response.output_text.delta":
            delta = payload.get("delta")
            if not isinstance(delta, str):
                raise build_malformed_response_failure(
                    message="response.output_text.delta event was missing string delta text",
                    provider_key=state.provider_key,
                    profile_key=state.profile_key,
                    raw_error_type="MissingOutputTextDelta",
                )
            state.text_parts.append(delta)
            yield LLMTextDelta(delta_index=state.next_delta_index, text=delta)
            state.next_delta_index += 1
            return
        if event_type == "response.output_text.done":
            done_text = self._extract_output_text(payload)
            if done_text is not None:
                state.final_output_text = done_text
            return
        if event_type == "response.output_item.done":
            item = payload.get("item")
            if isinstance(item, Mapping):
                item_text = self._extract_output_text(item)
                if item_text is not None:
                    state.final_output_text = item_text
            return
        if event_type == "response.completed":
            if state.completion_seen:
                raise build_malformed_response_failure(
                    message="openai responses stream emitted duplicate response.completed",
                    provider_key=state.provider_key,
                    profile_key=state.profile_key,
                    raw_error_type="DuplicateStreamCompletion",
                )
            response_object = payload.get("response")
            if not isinstance(response_object, dict):
                raise build_malformed_response_failure(
                    message="response.completed event did not include a response object",
                    provider_key=state.provider_key,
                    profile_key=state.profile_key,
                    raw_error_type="MissingCompletedResponseObject",
                )
            envelope = self._decode_completion_object(
                response_object,
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                fallback_output_text=state.final_output_text or state.accumulated_text,
            )
            state.completion_seen = True
            yield envelope.completion
            return
        if event_type in _IGNORED_STREAM_EVENT_TYPES:
            return
        return

    def _decode_completion_object(
        self,
        payload: Mapping[str, Any],
        *,
        provider_key: str,
        profile_key: str,
        fallback_output_text: str | None = None,
    ) -> _DecodedCompletionEnvelope:
        output_text = self._extract_output_text(payload)
        if output_text is None:
            output_text = fallback_output_text
        if output_text is None:
            raise build_malformed_response_failure(
                message="openai responses payload did not contain text output",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="MissingOutputText",
            )
        completion = LLMCompletion(
            finish_reason=self._extract_finish_reason(payload),
            output_text=output_text,
            usage=self._extract_usage_snapshot(payload),
            provider_response_id=self._extract_response_id(payload),
        )
        return _DecodedCompletionEnvelope(
            completion=completion,
            raw_payload=dict(payload),
        )

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
                message="provider payload was not valid utf-8",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type="OpenAIResponsesUTF8DecodeError",
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
                message="provider payload was not valid JSON",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=raw_error_type,
            ) from exc

    def _extract_output_text(self, payload: Mapping[str, Any]) -> str | None:
        direct_text = payload.get("output_text")
        if isinstance(direct_text, str):
            return direct_text

        direct_text_value = payload.get("text")
        if isinstance(direct_text_value, str):
            return direct_text_value
        if isinstance(direct_text_value, Mapping):
            nested_direct_text = direct_text_value.get("value")
            if isinstance(nested_direct_text, str):
                return nested_direct_text

        output = payload.get("output")
        text_parts: list[str] = []

        response_object = payload.get("response")
        if isinstance(response_object, Mapping):
            self._append_text_parts_from_container(response_object, text_parts)

        if isinstance(output, list):
            self._append_text_parts_from_container(output, text_parts)

        message = payload.get("message")
        if message is not None:
            self._append_text_parts_from_container(message, text_parts)

        content = payload.get("content")
        if content is not None:
            self._append_text_parts_from_container(content, text_parts)

        choices = payload.get("choices")
        if isinstance(choices, list):
            self._append_text_parts_from_choices(choices, text_parts)

        if not text_parts:
            return None
        return "".join(text_parts)

    def _append_text_parts_from_choices(
        self,
        choices: list[Any],
        text_parts: list[str],
    ) -> None:
        for choice in choices:
            if not isinstance(choice, Mapping):
                continue
            message = choice.get("message")
            if message is not None:
                self._append_text_parts_from_container(message, text_parts)
            delta = choice.get("delta")
            if delta is not None:
                self._append_text_parts_from_container(delta, text_parts)
            text_value = choice.get("text")
            if text_value is not None:
                self._append_text_parts_from_container(text_value, text_parts)

    def _append_text_parts_from_container(
        self,
        value: Any,
        text_parts: list[str],
    ) -> None:
        if isinstance(value, str):
            text_parts.append(value)
            return
        if isinstance(value, list):
            for item in value:
                self._append_text_parts_from_container(item, text_parts)
            return
        if not isinstance(value, Mapping):
            return

        part_type = value.get("type")
        text_value = value.get("text")
        if part_type in {"output_text", "text"}:
            if isinstance(text_value, str):
                text_parts.append(text_value)
            elif isinstance(text_value, Mapping):
                nested_text = text_value.get("value")
                if isinstance(nested_text, str):
                    text_parts.append(nested_text)

        if isinstance(text_value, str) and part_type in {None, "message", "assistant"}:
            text_parts.append(text_value)

        if isinstance(text_value, Mapping):
            nested_text = text_value.get("value")
            if isinstance(nested_text, str):
                text_parts.append(nested_text)

        content = value.get("content")
        if content is not None:
            self._append_text_parts_from_container(content, text_parts)

    def _extract_finish_reason(self, payload: Mapping[str, Any]) -> LLMFinishReason:
        if isinstance(payload.get("finish_reason"), str):
            raw_finish_reason = str(payload["finish_reason"])
            mapped = self._map_finish_reason_token(raw_finish_reason)
            if mapped is not None:
                return mapped

        status = payload.get("status")
        if status == "completed":
            return LLMFinishReason.STOP
        if status == "cancelled":
            return LLMFinishReason.CANCELLED
        if status == "failed":
            return LLMFinishReason.PROVIDER_ERROR

        incomplete_details = payload.get("incomplete_details")
        if isinstance(incomplete_details, Mapping):
            reason = incomplete_details.get("reason")
            if isinstance(reason, str):
                mapped = self._map_finish_reason_token(reason)
                if mapped is not None:
                    return mapped
        return LLMFinishReason.STOP

    def _map_finish_reason_token(self, token: str) -> LLMFinishReason | None:
        normalized = token.strip().lower()
        if normalized in {"stop", "completed"}:
            return LLMFinishReason.STOP
        if normalized in {"length", "max_output_tokens", "max_tokens"}:
            return LLMFinishReason.LENGTH
        if normalized in {"cancelled", "canceled"}:
            return LLMFinishReason.CANCELLED
        if normalized in {"tool_call", "tool_calls", "requires_action"}:
            return LLMFinishReason.TOOL_CALL
        if normalized in {"provider_error", "failed", "error"}:
            return LLMFinishReason.PROVIDER_ERROR
        return None

    def _extract_usage_snapshot(self, payload: Mapping[str, Any]) -> LLMUsageSnapshot | None:
        usage = payload.get("usage")
        if not isinstance(usage, Mapping):
            return None
        cached_input_tokens: int | None = None
        input_details = usage.get("input_tokens_details")
        if isinstance(input_details, Mapping):
            cached = input_details.get("cached_tokens")
            if isinstance(cached, int):
                cached_input_tokens = cached
        input_tokens = usage.get("input_tokens")
        output_tokens = usage.get("output_tokens")
        if not any(
            isinstance(value, int)
            for value in (input_tokens, output_tokens, cached_input_tokens)
        ):
            return None
        return LLMUsageSnapshot(
            input_tokens=input_tokens if isinstance(input_tokens, int) else None,
            output_tokens=output_tokens if isinstance(output_tokens, int) else None,
            cached_input_tokens=cached_input_tokens,
        )

    def _extract_response_id(self, payload: Mapping[str, Any]) -> str | None:
        response_id = payload.get("id")
        if isinstance(response_id, str):
            return response_id
        return None

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
        error_code = self._map_status_code_to_error_code(status_code)
        message = self._extract_error_message(payload) or (
            f"openai responses request failed with HTTP {status_code}"
        )
        return provider_failure_from_error(
            build_provider_error(
                error_code=error_code,
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
            message="provider error payload did not contain a valid error object",
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


class OpenAIResponsesProvider(LLMProviderPort):
    """
    First concrete OpenAI Responses provider shell for Echo.
    """

    def __init__(
        self,
        config: OpenAIResponsesProviderConfig,
        transport: OpenAIResponsesTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or OpenAIResponsesUrllibTransport()
        self._encoder = OpenAIResponsesRequestEncoder(config)
        self._decoder = OpenAIResponsesResponseDecoder(config)
        self._descriptor = LLMProviderDescriptor(
            provider_key=config.provider_key,
            display_name="OpenAI Responses",
            supports_one_shot=True,
            supports_streaming=True,
            supports_structured_intent_routing=False,
            supports_tool_reasoning=False,
            allowed_routes=(
                LLMRouteKind.QUICK_REACTION,
                LLMRouteKind.PRIMARY_RESPONSE,
            ),
        )

    def get_config(self) -> OpenAIResponsesProviderConfig:
        return self._config

    def get_transport(self) -> OpenAIResponsesTransportPort:
        return self._transport

    async def inspect_capabilities(self) -> LLMProviderDescriptor:
        return self._descriptor

    async def generate(self, request: LLMProviderRequest) -> LLMOneShotOutput:
        self._ensure_request_targets_this_provider(request)
        self._ensure_one_shot_supported(request)
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
        self._ensure_streaming_supported(request)
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

    def _ensure_one_shot_supported(self, request: LLMProviderRequest) -> None:
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

    def _ensure_streaming_supported(self, request: LLMProviderRequest) -> None:
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

    def _map_transport_exception(
        self,
        exc: BaseException,
        *,
        provider_key: str,
        profile_key: str,
    ) -> LLMProviderFailure:
        if isinstance(exc, LLMProviderFailure):
            return exc
        if isinstance(exc, OpenAIResponsesHTTPStatusError):
            payload: Mapping[str, Any] | None = None
            if exc.body:
                try:
                    raw_payload = self._decoder._parse_json_bytes(
                        exc.body,
                        provider_key=provider_key,
                        profile_key=profile_key,
                        raw_error_type="OpenAIResponsesStatusBodyDecodeError",
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
        if isinstance(exc, OpenAIResponsesTimeoutError):
            return provider_failure_from_error(
                build_provider_error(
                    error_code=LLMProviderErrorCode.TIMEOUT,
                    message=str(exc) or "openai responses request timed out",
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
                    message="openai responses request was cancelled",
                    retryable=False,
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=type(exc).__name__,
                )
            )
        if isinstance(exc, OpenAIResponsesMalformedStreamError):
            return build_malformed_response_failure(
                message=str(exc) or "openai responses stream was malformed",
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            )
        if isinstance(exc, OpenAIResponsesNetworkError):
            return provider_failure_from_error(
                build_provider_error(
                    error_code=LLMProviderErrorCode.PROVIDER_UNAVAILABLE,
                    message=str(exc) or "openai responses provider became unavailable",
                    retryable=True,
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=type(exc).__name__,
                )
            )
        return provider_failure_from_error(
            build_provider_error(
                error_code=LLMProviderErrorCode.PROVIDER_UNAVAILABLE,
                message=str(exc) or "openai responses provider became unavailable",
                retryable=True,
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            )
        )


__all__ = [
    "OpenAIResponsesHTTPHeader",
    "OpenAIResponsesHTTPRequest",
    "OpenAIResponsesHTTPResponse",
    "OpenAIResponsesHTTPStatusError",
    "OpenAIResponsesMalformedStreamError",
    "OpenAIResponsesNetworkError",
    "OpenAIResponsesProvider",
    "OpenAIResponsesProviderConfig",
    "OpenAIResponsesRequestEncoder",
    "OpenAIResponsesResponseDecoder",
    "OpenAIResponsesSSEEvent",
    "OpenAIResponsesTimeoutError",
    "OpenAIResponsesTransportError",
    "OpenAIResponsesTransportPort",
    "OpenAIResponsesUrllibTransport",
]
