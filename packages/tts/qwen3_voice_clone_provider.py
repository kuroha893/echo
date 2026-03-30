from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import mimetypes
import os
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import AsyncIterator, Mapping
from enum import StrEnum
from pathlib import Path
from typing import Protocol, Self, runtime_checkable
from uuid import uuid4

from pydantic import ConfigDict, Field, SecretStr, field_validator, model_validator

from packages.protocol.events import EmotionTag, TTSChunk
from packages.tts.errors import (
    TTSProviderExecutionError,
    build_tts_error,
    provider_error_from_exception,
    raise_provider_error,
)
from packages.tts.models import (
    KEY_PATTERN,
    LANGUAGE_PATTERN,
    TTSModel,
    TTSAudioFragment,
    TTSAudioMediaType,
    TTSProviderCapabilities,
    TTSProviderError,
    TTSProviderErrorCode,
    TTSProviderProfile,
    TTSVoiceEnrollmentRequest,
    TTSVoiceEnrollmentResult,
    TTSVoiceEnrollmentVerificationMetadata,
    TTSSynthesisConfig,
    TTSSynthesisRequest,
    TTSVoiceProfile,
)
from packages.tts.provider_ports import (
    TTSProviderPort,
    TTSVoiceEnrollmentProviderPort,
)
from packages.tts.registry import TTSProviderRegistry
from packages.tts.service import TTSService


class Qwen3VoiceCloneTrackKind(StrEnum):
    STANDARD = "standard"
    REALTIME = "realtime"


class Qwen3VoiceCloneTransportMode(StrEnum):
    BASELINE_HTTP = "baseline_http"
    REALTIME_HTTP = "realtime_http"


class Qwen3VoiceCloneSynthesisContractKind(StrEnum):
    SYSTEM_VOICE = "system_voice"
    CLONED_VOICE = "cloned_voice"


class Qwen3VoiceCloneProviderConfig(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: SecretStr
    request_timeout_ms: int = Field(gt=0)
    standard_model_id: str = Field(min_length=1, max_length=256)
    standard_voice_id: str = Field(min_length=1, max_length=256)
    voice_clone_model_id: str = Field(
        default="qwen3-tts-vc-2026-01-22",
        min_length=1,
        max_length=256,
    )
    voice_enrollment_model_id: str = Field(
        default="qwen-voice-enrollment",
        min_length=1,
        max_length=256,
    )
    realtime_model_id: str | None = Field(default=None, min_length=1, max_length=256)
    realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    synthesis_path: str = Field(
        default="/services/aigc/multimodal-generation/generation",
        min_length=1,
        max_length=512,
    )
    enrollment_path: str = Field(
        default="/services/audio/tts/customization",
        min_length=1,
        max_length=512,
    )
    auth_header_name: str = Field(default="Authorization", min_length=1, max_length=64)
    auth_scheme: str = Field(default="Bearer", min_length=1, max_length=32)
    default_media_type: TTSAudioMediaType = TTSAudioMediaType.WAV
    supported_media_types: tuple[TTSAudioMediaType, ...] = (
        TTSAudioMediaType.WAV,
        TTSAudioMediaType.MP3,
        TTSAudioMediaType.OGG_OPUS,
        TTSAudioMediaType.PCM_S16LE,
    )
    default_sample_rate_hz: int = Field(default=24000, gt=0)
    default_channel_count: int = Field(default=1, gt=0, le=8)
    supports_fragment_streaming: bool = True
    supports_reference_audio_paths: bool = False
    supports_prompt_conditioning: bool = True
    supports_emotion_tags: bool = True
    supports_voice_enrollment_from_local_reference_audio: bool = True
    request_realtime_style_markers: tuple[str, ...] = (
        "realtime",
        "real-time",
        "real_time",
        "live",
        "low_latency",
        "low-latency",
    )
    user_agent: str = Field(
        default="Echo/Qwen3VoiceCloneProvider",
        min_length=1,
        max_length=128,
    )

    @model_validator(mode="after")
    def validate_http_config(self) -> Self:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("base_url must be an absolute http or https URL")
        normalized_path = parsed.path.rstrip("/")
        if normalized_path != "/api/v1":
            raise ValueError("base_url must point to the DashScope /api/v1 contract root")
        if not self.synthesis_path.startswith("/"):
            raise ValueError("synthesis_path must start with '/'")
        if not self.enrollment_path.startswith("/"):
            raise ValueError("enrollment_path must start with '/'")
        if self.default_media_type not in self.supported_media_types:
            raise ValueError("default_media_type must be included in supported_media_types")
        if self.standard_model_id == self.voice_enrollment_model_id:
            raise ValueError("standard_model_id must not be the enrollment model id")
        if self.voice_clone_model_id == self.voice_enrollment_model_id:
            raise ValueError("voice_clone_model_id must not be the enrollment model id")
        return self

    @property
    def synthesis_url(self) -> str:
        return f"{self.base_url.rstrip('/')}{self.synthesis_path}"

    @property
    def enrollment_url(self) -> str:
        return f"{self.base_url.rstrip('/')}{self.enrollment_path}"

    @property
    def has_realtime_defaults(self) -> bool:
        return self.realtime_model_id is not None and self.realtime_voice_id is not None

    def build_capabilities(self) -> TTSProviderCapabilities:
        return TTSProviderCapabilities(
            provider_key=self.provider_key,
            display_name="Qwen3 Voice Clone Provider",
            supports_fragment_streaming=self.supports_fragment_streaming,
            supported_media_types=self.supported_media_types,
            supports_reference_audio_conditioning=self.supports_prompt_conditioning
            or self.supports_reference_audio_paths,
            supports_realtime_voice_id=False,
            supports_voice_enrollment_from_local_reference_audio=(
                self.supports_voice_enrollment_from_local_reference_audio
            ),
        )


class Qwen3RealtimeCapabilityMetadata(TTSModel):
    transport_mode: Qwen3VoiceCloneTransportMode
    is_configured: bool
    realtime_model_id: str | None = None
    realtime_voice_id: str | None = None


class Qwen3VoiceCloneProviderMetadata(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    family_name: str = Field(default="qwen3_voice_clone", min_length=1, max_length=64)
    synthesis_url: str = Field(min_length=1, max_length=2048)
    standard_model_id: str = Field(min_length=1, max_length=256)
    standard_voice_id: str = Field(min_length=1, max_length=256)
    voice_clone_model_id: str = Field(min_length=1, max_length=256)
    default_media_type: TTSAudioMediaType
    supported_media_types: tuple[TTSAudioMediaType, ...]
    supports_fragment_streaming: bool
    supports_reference_audio_paths: bool
    supports_prompt_conditioning: bool
    supports_voice_enrollment_from_local_reference_audio: bool
    enrollment_url: str = Field(min_length=1, max_length=2048)
    realtime: Qwen3RealtimeCapabilityMetadata


class Qwen3VoiceCloneResolvedTrack(TTSModel):
    contract_kind: Qwen3VoiceCloneSynthesisContractKind
    track_kind: Qwen3VoiceCloneTrackKind
    transport_mode: Qwen3VoiceCloneTransportMode
    model_id: str = Field(min_length=1, max_length=256)
    voice_id: str = Field(min_length=1, max_length=256)
    style_hint: str | None = Field(default=None, min_length=1, max_length=64)
    realtime_requested: bool = False


class Qwen3VoiceCloneEmotionHint(TTSModel):
    name: str = Field(min_length=1, max_length=64)
    intensity: float = Field(ge=0.0, le=1.0)

    @classmethod
    def from_protocol_tag(cls, tag: EmotionTag) -> "Qwen3VoiceCloneEmotionHint":
        return cls(name=tag.name, intensity=tag.intensity)


class Qwen3VoiceCloneConditioningPayload(TTSModel):
    prompt_text: str | None = Field(default=None, min_length=1, max_length=4000)
    prompt_language: str | None = Field(default=None, min_length=1, max_length=32)
    reference_audio_paths: tuple[str, ...] = ()

    def is_empty(self) -> bool:
        return (
            self.prompt_text is None
            and self.prompt_language is None
            and not self.reference_audio_paths
        )


class Qwen3DashScopeSystemVoiceSynthesisPayload(TTSModel):
    model: str = Field(min_length=1, max_length=256)
    text: str = Field(min_length=1)
    voice: str = Field(min_length=1, max_length=256)
    language_type: str | None = Field(default=None, min_length=1, max_length=32)
    instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    optimize_instructions: bool | None = None

    def to_http_json(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "model": self.model,
            "input": {
                "text": self.text,
                "voice": self.voice,
            },
        }
        if self.language_type is not None:
            payload["input"]["language_type"] = self.language_type
        if self.instructions is not None:
            payload["instructions"] = self.instructions
        if self.optimize_instructions is not None:
            payload["optimize_instructions"] = self.optimize_instructions
        return payload


class Qwen3DashScopeClonedVoiceSynthesisPayload(TTSModel):
    model: str = Field(min_length=1, max_length=256)
    text: str = Field(min_length=1)
    voice: str = Field(min_length=1, max_length=256)
    instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    optimize_instructions: bool | None = None

    def to_http_json(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "model": self.model,
            "input": {
                "text": self.text,
                "voice": self.voice,
            },
        }
        if self.instructions is not None:
            payload["instructions"] = self.instructions
        if self.optimize_instructions is not None:
            payload["optimize_instructions"] = self.optimize_instructions
        return payload


class Qwen3DashScopeVoiceEnrollmentPayload(TTSModel):
    model: str = Field(min_length=1, max_length=256)
    preferred_name: str = Field(min_length=1, max_length=128)
    target_model: str = Field(min_length=1, max_length=256)
    audio_data_uri: str = Field(min_length=1)

    def to_http_json(self) -> dict[str, object]:
        return {
            "model": self.model,
            "input": {
                "action": "create",
                "target_model": self.target_model,
                "preferred_name": self.preferred_name,
                "audio": {
                    "data": self.audio_data_uri,
                },
            },
        }


class Qwen3VoiceCloneHTTPRequest(TTSModel):
    method: str = Field(default="POST", min_length=1, max_length=16)
    url: str = Field(min_length=1, max_length=2048)
    headers: tuple[tuple[str, str], ...] = ()
    body: bytes = b""
    timeout_ms: int = Field(gt=0)

    def header_mapping(self) -> dict[str, str]:
        return {key: value for key, value in self.headers}


class Qwen3VoiceCloneHTTPResponse(TTSModel):
    status_code: int = Field(ge=100, le=599)
    headers: tuple[tuple[str, str], ...] = ()
    body: bytes = b""

    def get_header(self, name: str) -> str | None:
        lowered = name.lower()
        for header_name, header_value in self.headers:
            if header_name.lower() == lowered:
                return header_value
        return None

    @property
    def content_type(self) -> str | None:
        value = self.get_header("content-type")
        if value is None:
            return None
        return value.split(";", 1)[0].strip().lower()

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300


@runtime_checkable
class Qwen3VoiceCloneTransportPort(Protocol):
    async def execute(
        self,
        request: Qwen3VoiceCloneHTTPRequest,
    ) -> Qwen3VoiceCloneHTTPResponse: ...


class UrllibQwen3VoiceCloneTransport(Qwen3VoiceCloneTransportPort):
    async def execute(
        self,
        request: Qwen3VoiceCloneHTTPRequest,
    ) -> Qwen3VoiceCloneHTTPResponse:
        return await asyncio.to_thread(self._execute_sync, request)

    def _execute_sync(
        self,
        request: Qwen3VoiceCloneHTTPRequest,
    ) -> Qwen3VoiceCloneHTTPResponse:
        raw_request = urllib.request.Request(
            url=request.url,
            data=request.body if request.body else None,
            method=request.method,
            headers=request.header_mapping(),
        )
        timeout_sec = request.timeout_ms / 1000.0
        try:
            with urllib.request.urlopen(raw_request, timeout=timeout_sec) as response:
                return Qwen3VoiceCloneHTTPResponse(
                    status_code=response.getcode(),
                    headers=tuple(response.headers.items()),
                    body=response.read(),
                )
        except urllib.error.HTTPError as exc:
            body = exc.read() if exc.fp is not None else b""
            return Qwen3VoiceCloneHTTPResponse(
                status_code=exc.code,
                headers=tuple(exc.headers.items()) if exc.headers is not None else (),
                body=body,
            )
        except urllib.error.URLError as exc:
            reason = exc.reason
            if isinstance(reason, TimeoutError):
                raise asyncio.TimeoutError from exc
            if isinstance(reason, OSError) and "timed out" in str(reason).lower():
                raise asyncio.TimeoutError from exc
            raise OSError(str(reason) or "Qwen3 provider transport failed") from exc


class Qwen3VoiceCloneJSONErrorPayload(TTSModel):
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    code: str | None = Field(default=None, min_length=1, max_length=128)
    type: str | None = Field(default=None, min_length=1, max_length=128)


class Qwen3DashScopeAudioOutputPayload(TTSModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = Field(default=None, min_length=1, max_length=256)
    data: str | None = Field(default=None, min_length=1)
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    expires_at: int | None = None

    @field_validator("id", "data", "url", mode="before")
    @classmethod
    def normalize_optional_string_fields(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_audio_output(self) -> Self:
        if self.data is None and self.url is None:
            raise ValueError("DashScope audio output must include data or url")
        return self


class Qwen3DashScopeSynthesisOutputPayload(TTSModel):
    audio: Qwen3DashScopeAudioOutputPayload
    finish_reason: str | None = Field(default=None, min_length=1, max_length=64)


class Qwen3VoiceCloneJSONAudioPayload(TTSModel):
    audio_base64: str = Field(min_length=1)
    sample_rate_hz: int | None = Field(default=None, gt=0)
    channel_count: int | None = Field(default=None, gt=0, le=8)
    media_type: str | None = Field(default=None, min_length=1, max_length=64)
    is_final: bool = True


class Qwen3VoiceCloneJSONFragmentPayload(TTSModel):
    fragment_index: int | None = Field(default=None, ge=0)
    audio_base64: str = Field(min_length=1)
    sample_rate_hz: int | None = Field(default=None, gt=0)
    channel_count: int | None = Field(default=None, gt=0, le=8)
    media_type: str | None = Field(default=None, min_length=1, max_length=64)
    is_final: bool = False


class Qwen3VoiceCloneResolvedRequest(TTSModel):
    request: TTSSynthesisRequest
    track: Qwen3VoiceCloneResolvedTrack
    effective_timeout_ms: int = Field(gt=0)
    media_type: TTSAudioMediaType
    conditioning: Qwen3VoiceCloneConditioningPayload | None = None
    emotion_hints: tuple[Qwen3VoiceCloneEmotionHint, ...] = ()

    @property
    def provider_key(self) -> str:
        return self.request.effective_provider_key

    @property
    def provider_profile_key(self) -> str | None:
        return self.request.provider_profile_key

    @property
    def voice_profile(self) -> TTSVoiceProfile:
        return self.request.voice_profile


class Qwen3VoiceCloneUploadFilePart(TTSModel):
    field_name: str = Field(min_length=1, max_length=64)
    filename: str = Field(min_length=1, max_length=256)
    content_type: str = Field(min_length=1, max_length=128)
    file_bytes: bytes = Field(min_length=1)


class Qwen3VoiceCloneMultipartField(TTSModel):
    name: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1)


class Qwen3VoiceCloneMultipartBody(TTSModel):
    boundary: str = Field(min_length=1, max_length=128)
    fields: tuple[Qwen3VoiceCloneMultipartField, ...] = ()
    files: tuple[Qwen3VoiceCloneUploadFilePart, ...] = ()

    def content_type(self) -> str:
        return f"multipart/form-data; boundary={self.boundary}"

    def to_bytes(self) -> bytes:
        boundary = self.boundary.encode("ascii")
        lines: list[bytes] = []
        for field in self.fields:
            lines.extend(
                [
                    b"--" + boundary,
                    (
                        f'Content-Disposition: form-data; name="{field.name}"'
                    ).encode("utf-8"),
                    b"",
                    field.value.encode("utf-8"),
                ]
            )
        for file_part in self.files:
            lines.extend(
                [
                    b"--" + boundary,
                    (
                        f'Content-Disposition: form-data; name="{file_part.field_name}"; '
                        f'filename="{file_part.filename}"'
                    ).encode("utf-8"),
                    f"Content-Type: {file_part.content_type}".encode("ascii"),
                    b"",
                    file_part.file_bytes,
                ]
            )
        lines.append(b"--" + boundary + b"--")
        lines.append(b"")
        return b"\r\n".join(lines)


class Qwen3VoiceCloneEnrollmentResponsePayload(TTSModel):
    voice_id: str = Field(min_length=1, max_length=256)
    realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    enrollment_id: str | None = Field(default=None, min_length=1, max_length=256)
    display_name: str | None = Field(default=None, min_length=1, max_length=128)


class Qwen3VoiceCloneProvider(TTSProviderPort, TTSVoiceEnrollmentProviderPort):
    def __init__(
        self,
        *,
        config: Qwen3VoiceCloneProviderConfig,
        transport: Qwen3VoiceCloneTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or UrllibQwen3VoiceCloneTransport()
        self._capabilities = config.build_capabilities()
        self._metadata = Qwen3VoiceCloneProviderMetadata(
            provider_key=config.provider_key,
            synthesis_url=config.synthesis_url,
            enrollment_url=config.enrollment_url,
            standard_model_id=config.standard_model_id,
            standard_voice_id=config.standard_voice_id,
            voice_clone_model_id=config.voice_clone_model_id,
            default_media_type=config.default_media_type,
            supported_media_types=config.supported_media_types,
            supports_fragment_streaming=config.supports_fragment_streaming,
            supports_reference_audio_paths=config.supports_reference_audio_paths,
            supports_prompt_conditioning=config.supports_prompt_conditioning,
            supports_voice_enrollment_from_local_reference_audio=(
                config.supports_voice_enrollment_from_local_reference_audio
            ),
            realtime=Qwen3RealtimeCapabilityMetadata(
                transport_mode=(
                    Qwen3VoiceCloneTransportMode.REALTIME_HTTP
                    if config.has_realtime_defaults
                    else Qwen3VoiceCloneTransportMode.BASELINE_HTTP
                ),
                is_configured=config.has_realtime_defaults,
                realtime_model_id=config.realtime_model_id,
                realtime_voice_id=config.realtime_voice_id,
            ),
        )

    @property
    def provider_key(self) -> str:
        return self._config.provider_key

    def get_capabilities(self) -> TTSProviderCapabilities:
        return self._capabilities

    def get_family_metadata(self) -> Qwen3VoiceCloneProviderMetadata:
        return self._metadata

    def synthesize(self, request: TTSSynthesisRequest) -> AsyncIterator[TTSAudioFragment]:
        return self._synthesize(request)

    async def enroll_voice(
        self,
        request: TTSVoiceEnrollmentRequest,
    ) -> TTSVoiceEnrollmentResult:
        if request.provider_key != self.provider_key:
            raise_provider_error(
                error_code=TTSProviderErrorCode.CONFIGURATION_ERROR,
                message="Qwen3 voice-clone provider received an enrollment request for another provider key",
                retryable=False,
                provider_key=self.provider_key,
            )
        if not self._config.supports_voice_enrollment_from_local_reference_audio:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="Qwen3 voice-clone provider does not support local reference-audio enrollment",
                retryable=False,
                provider_key=self.provider_key,
            )

        try:
            payload = await self._build_enrollment_payload(request)
            http_request = self._build_enrollment_http_request(payload)
            response = await self._transport.execute(http_request)
            return self._decode_enrollment_response(response, request)
        except TTSProviderExecutionError:
            raise
        except asyncio.CancelledError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.CANCELLED,
                    message="Qwen3 voice-clone enrollment was cancelled",
                    retryable=False,
                    provider_key=self.provider_key,
                )
            ) from exc
        except asyncio.TimeoutError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.TIMEOUT,
                    message="Qwen3 voice-clone enrollment timed out",
                    retryable=True,
                    provider_key=self.provider_key,
                )
            ) from exc
        except OSError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.PROVIDER_UNAVAILABLE,
                    message=str(exc) or "Qwen3 voice-clone provider is unavailable",
                    retryable=True,
                    provider_key=self.provider_key,
                )
            ) from exc
        except (UnicodeDecodeError, json.JSONDecodeError, binascii.Error, ValueError) as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                    message=str(exc) or "Qwen3 voice-clone enrollment returned malformed payload",
                    retryable=False,
                    provider_key=self.provider_key,
                )
            ) from exc

    async def _synthesize(
        self,
        request: TTSSynthesisRequest,
    ) -> AsyncIterator[TTSAudioFragment]:
        resolved_request = self._resolve_request(request)

        try:
            if self._should_use_streaming_contract(resolved_request):
                async for fragment in self._synthesize_streaming(resolved_request):
                    yield fragment
                return
            payload = self._build_request_payload(resolved_request)
            http_request = self._build_http_request(payload, resolved_request.effective_timeout_ms)
            response = await self._transport.execute(http_request)
            fragments = await self._decode_response(response, resolved_request)
            for fragment in fragments:
                yield fragment
        except TTSProviderExecutionError:
            raise
        except asyncio.CancelledError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.CANCELLED,
                    message="Qwen3 voice-clone synthesis was cancelled",
                    retryable=False,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            ) from exc
        except asyncio.TimeoutError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.TIMEOUT,
                    message="Qwen3 voice-clone synthesis timed out",
                    retryable=True,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            ) from exc
        except OSError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.PROVIDER_UNAVAILABLE,
                    message=str(exc) or "Qwen3 voice-clone provider is unavailable",
                    retryable=True,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            ) from exc
        except (UnicodeDecodeError, json.JSONDecodeError, binascii.Error, ValueError) as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                    message=str(exc) or "Qwen3 voice-clone provider returned malformed payload",
                    retryable=False,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            ) from exc

    async def _build_enrollment_payload(
        self,
        request: TTSVoiceEnrollmentRequest,
    ) -> Qwen3DashScopeVoiceEnrollmentPayload:
        if request.realtime_reference_audio_path is not None:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="DashScope voice enrollment only supports one reference audio file in the active Echo path",
                retryable=False,
                provider_key=self.provider_key,
            )
        if request.prompt_text is not None or request.prompt_language is not None:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="DashScope voice enrollment prompt conditioning is not supported in the active Echo path",
                retryable=False,
                provider_key=self.provider_key,
            )
        reference_bytes = await asyncio.to_thread(request.reference_audio_path.read_bytes)
        if not reference_bytes:
            raise ValueError("reference_audio_path must not be empty")
        return Qwen3DashScopeVoiceEnrollmentPayload(
            model=self._config.voice_enrollment_model_id,
            preferred_name=self._normalize_enrollment_preferred_name(request.display_name),
            target_model=self._config.voice_clone_model_id,
            audio_data_uri=self._encode_audio_data_uri(
                path=request.reference_audio_path,
                file_bytes=reference_bytes,
            ),
        )

    def _normalize_enrollment_preferred_name(self, display_name: str) -> str:
        normalized_ascii = (
            unicodedata.normalize("NFKD", display_name)
            .encode("ascii", "ignore")
            .decode("ascii")
            .lower()
        )
        preferred_chars: list[str] = []
        last_was_separator = False
        for char in normalized_ascii:
            if char.isalnum():
                preferred_chars.append(char)
                last_was_separator = False
                continue
            if not last_was_separator:
                preferred_chars.append("-")
                last_was_separator = True
        preferred_name = "".join(preferred_chars).strip("-")
        if not preferred_name:
            digest = hashlib.sha1(display_name.encode("utf-8")).hexdigest()[:12]
            preferred_name = f"echo-{digest}"
        if len(preferred_name) > 128:
            preferred_name = preferred_name[:128].rstrip("-")
        return preferred_name

    def _build_enrollment_http_request(
        self,
        payload: Qwen3DashScopeVoiceEnrollmentPayload,
    ) -> Qwen3VoiceCloneHTTPRequest:
        body = json.dumps(
            payload.to_http_json(),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        return Qwen3VoiceCloneHTTPRequest(
            method="POST",
            url=self._config.enrollment_url,
            headers=(
                ("content-type", "application/json"),
                ("accept", "application/json"),
                (
                    self._config.auth_header_name,
                    self._authorization_header_value(),
                ),
                ("user-agent", self._config.user_agent),
            ),
            body=body,
            timeout_ms=self._config.request_timeout_ms,
        )

    def _resolve_request(
        self,
        request: TTSSynthesisRequest,
    ) -> Qwen3VoiceCloneResolvedRequest:
        if request.effective_provider_key != self.provider_key:
            raise_provider_error(
                error_code=TTSProviderErrorCode.CONFIGURATION_ERROR,
                message="Qwen3 voice-clone provider received a request for another provider key",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        if (
            request.voice_profile.prompt_text is not None
            and not self._config.supports_prompt_conditioning
        ):
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="Qwen3 voice-clone provider does not support prompt conditioning",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )
        if request.voice_profile.reference_audio_path is not None or request.voice_profile.aux_reference_audio_paths:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="DashScope synthesis in the active Echo path expects a configured system voice or an enrolled voice id, not local reference audio",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        track = self._resolve_track(request)
        effective_timeout_ms = min(
            request.synthesis_config.timeout_ms,
            self._config.request_timeout_ms,
        )

        emotion_hints: tuple[Qwen3VoiceCloneEmotionHint, ...] = ()
        if request.tts_chunk.emotion_tags and self._config.supports_emotion_tags:
            emotion_hints = tuple(
                Qwen3VoiceCloneEmotionHint.from_protocol_tag(tag)
                for tag in request.tts_chunk.emotion_tags
            )

        media_type = (
            request.synthesis_config.preferred_media_type
            or self._config.default_media_type
        )
        if track.contract_kind == Qwen3VoiceCloneSynthesisContractKind.CLONED_VOICE:
            if (
                request.synthesis_config.preferred_media_type is not None
                and request.synthesis_config.preferred_media_type
                != TTSAudioMediaType.PCM_S16LE
            ):
                raise_provider_error(
                    error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                    message=(
                        "Qwen3 cloned-voice streaming requires PCM S16LE output in the active Echo path"
                    ),
                    retryable=False,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            if (
                request.synthesis_config.sample_rate_hz is not None
                and request.synthesis_config.sample_rate_hz
                != self._config.default_sample_rate_hz
            ):
                raise_provider_error(
                    error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                    message=(
                        "Qwen3 cloned-voice streaming requires 24kHz audio in the active Echo path"
                    ),
                    retryable=False,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            media_type = TTSAudioMediaType.PCM_S16LE

        return Qwen3VoiceCloneResolvedRequest(
            request=request,
            track=track,
            effective_timeout_ms=effective_timeout_ms,
            media_type=media_type,
            conditioning=None,
            emotion_hints=emotion_hints,
        )

    def _resolve_track(
        self,
        request: TTSSynthesisRequest,
    ) -> Qwen3VoiceCloneResolvedTrack:
        raw_style = request.tts_chunk.voice_style
        normalized_style = None if raw_style is None else raw_style.strip()
        realtime_requested = (
            normalized_style is not None
            and normalized_style.lower() in self._config.request_realtime_style_markers
        )

        if realtime_requested:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="DashScope realtime-style TTS is inactive in the active Echo production path",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        resolved_model_id = self._config.standard_model_id
        resolved_voice_id = request.voice_profile.provider_voice_id or self._config.standard_voice_id
        contract_kind = (
            Qwen3VoiceCloneSynthesisContractKind.CLONED_VOICE
            if resolved_model_id == self._config.voice_clone_model_id
            else Qwen3VoiceCloneSynthesisContractKind.SYSTEM_VOICE
        )

        return Qwen3VoiceCloneResolvedTrack(
            contract_kind=contract_kind,
            track_kind=Qwen3VoiceCloneTrackKind.STANDARD,
            transport_mode=Qwen3VoiceCloneTransportMode.BASELINE_HTTP,
            model_id=resolved_model_id,
            voice_id=resolved_voice_id,
            style_hint=normalized_style or None,
            realtime_requested=False,
        )

    def _should_use_streaming_contract(
        self,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> bool:
        return (
            resolved_request.track.contract_kind
            == Qwen3VoiceCloneSynthesisContractKind.CLONED_VOICE
        )

    def _build_request_payload(
        self,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> Qwen3DashScopeSystemVoiceSynthesisPayload | Qwen3DashScopeClonedVoiceSynthesisPayload:
        instructions = self._resolve_dashscope_instructions(resolved_request)
        if resolved_request.track.contract_kind == Qwen3VoiceCloneSynthesisContractKind.SYSTEM_VOICE:
            return Qwen3DashScopeSystemVoiceSynthesisPayload(
                model=resolved_request.track.model_id,
                text=resolved_request.request.tts_chunk.text,
                voice=resolved_request.track.voice_id,
                language_type=self._resolve_language_type(
                    text=resolved_request.request.tts_chunk.text,
                    prompt_language=resolved_request.voice_profile.prompt_language,
                ),
                instructions=instructions,
                optimize_instructions=True if instructions is not None else None,
            )
        return Qwen3DashScopeClonedVoiceSynthesisPayload(
            model=resolved_request.track.model_id,
            text=resolved_request.request.tts_chunk.text,
            voice=resolved_request.track.voice_id,
            instructions=instructions,
            optimize_instructions=True if instructions is not None else None,
        )

    def _build_http_request(
        self,
        payload: Qwen3DashScopeSystemVoiceSynthesisPayload | Qwen3DashScopeClonedVoiceSynthesisPayload,
        timeout_ms: int,
    ) -> Qwen3VoiceCloneHTTPRequest:
        body = json.dumps(
            payload.to_http_json(),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        headers = (
            ("content-type", "application/json"),
            ("accept", self._http_accept_header()),
            (
                self._config.auth_header_name,
                self._authorization_header_value(),
            ),
            ("user-agent", self._config.user_agent),
        )
        return Qwen3VoiceCloneHTTPRequest(
            method="POST",
            url=self._config.synthesis_url,
            headers=headers,
            body=body,
            timeout_ms=timeout_ms,
        )

    def _build_stream_http_request(
        self,
        payload: Qwen3DashScopeClonedVoiceSynthesisPayload,
        timeout_ms: int,
    ) -> Qwen3VoiceCloneHTTPRequest:
        stream_payload = payload.to_http_json()
        stream_payload["stream"] = True
        body = json.dumps(
            stream_payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        headers = (
            ("content-type", "application/json"),
            ("accept", "text/event-stream"),
            ("x-dashscope-sse", "enable"),
            (
                self._config.auth_header_name,
                self._authorization_header_value(),
            ),
            ("user-agent", self._config.user_agent),
        )
        return Qwen3VoiceCloneHTTPRequest(
            method="POST",
            url=self._config.synthesis_url,
            headers=headers,
            body=body,
            timeout_ms=timeout_ms,
        )

    def _http_accept_header(self) -> str:
        accepted = ["application/json"]
        accepted.extend(self._config.supported_media_types)
        return ",".join(accepted)

    def _authorization_header_value(self) -> str:
        api_key = self._config.api_key.get_secret_value().strip()
        if self._config.auth_scheme.lower() == "bearer":
            return f"Bearer {api_key}"
        return f"{self._config.auth_scheme} {api_key}"

    def _encode_audio_data_uri(
        self,
        *,
        path: Path,
        file_bytes: bytes,
    ) -> str:
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        encoded = base64.b64encode(file_bytes).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

    def _resolve_language_type(
        self,
        *,
        text: str,
        prompt_language: str | None,
    ) -> str | None:
        if prompt_language is not None:
            normalized = prompt_language.strip().lower()
            if normalized.startswith("zh"):
                return "Chinese"
            if normalized.startswith("en"):
                return "English"
            if normalized.startswith("ja"):
                return "Japanese"
        for char in text:
            codepoint = ord(char)
            if 0x4E00 <= codepoint <= 0x9FFF:
                return "Chinese"
            if 0x3040 <= codepoint <= 0x30FF:
                return "Japanese"
        if any("a" <= char.lower() <= "z" for char in text):
            return "English"
        return None

    def _resolve_dashscope_instructions(
        self,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> str | None:
        if "instruct" not in resolved_request.track.model_id.lower():
            return None
        return resolved_request.track.style_hint or resolved_request.voice_profile.prompt_text

    async def _decode_response(
        self,
        response: Qwen3VoiceCloneHTTPResponse,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> tuple[TTSAudioFragment, ...]:
        if not response.is_success:
            self._raise_for_http_failure(response, resolved_request)

        if response.content_type == "application/json" or self._looks_like_json(response.body):
            return await self._decode_json_response(response, resolved_request)

        return (self._decode_binary_audio_fragment(response, resolved_request),)

    async def _synthesize_streaming(
        self,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> AsyncIterator[TTSAudioFragment]:
        if resolved_request.media_type != TTSAudioMediaType.PCM_S16LE:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="Qwen3 cloned-voice streaming requires PCM S16LE output",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
            )
        payload = self._build_request_payload(resolved_request)
        if not isinstance(payload, Qwen3DashScopeClonedVoiceSynthesisPayload):
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="Qwen3 streaming contract is only active for cloned-voice synthesis",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
            )
        stream_request = self._build_stream_http_request(
            payload,
            resolved_request.effective_timeout_ms,
        )

        pending_fragment: TTSAudioFragment | None = None
        next_fragment_index = 0
        saw_audio = False
        async for event_payload in self._execute_stream_request(
            stream_request,
            resolved_request,
        ):
            if not isinstance(event_payload, Mapping):
                raise ValueError("Qwen3 streaming payload must be a JSON object")
            self._raise_for_stream_error_payload(event_payload, resolved_request)
            output = event_payload.get("output")
            if not isinstance(output, Mapping):
                continue
            audio_payload = output.get("audio")
            if isinstance(audio_payload, Mapping):
                raw_audio_data = audio_payload.get("data")
                if isinstance(raw_audio_data, str) and raw_audio_data.strip():
                    next_fragment = self._build_stream_fragment(
                        raw_audio_data,
                        next_fragment_index,
                        resolved_request,
                    )
                    next_fragment_index += 1
                    saw_audio = True
                    if pending_fragment is not None:
                        yield pending_fragment
                    pending_fragment = next_fragment
            finish_reason = output.get("finish_reason")
            if finish_reason == "stop":
                break

        if pending_fragment is None or not saw_audio:
            raise ValueError("Qwen3 streaming response did not emit any audio fragments")
        yield pending_fragment.model_copy(update={"is_final": True})

    async def _execute_stream_request(
        self,
        request: Qwen3VoiceCloneHTTPRequest,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> AsyncIterator[Mapping[str, object]]:
        execute_stream = getattr(self._transport, "execute_stream", None)
        if callable(execute_stream):
            async for item in execute_stream(request):
                if isinstance(item, Qwen3VoiceCloneHTTPResponse):
                    self._raise_for_http_failure(item, resolved_request)
                if isinstance(item, BaseException):
                    raise item
                if not isinstance(item, Mapping):
                    raise ValueError("Qwen3 streaming event payload must decode to a JSON object")
                yield item
            return

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[object] = asyncio.Queue()
        sentinel = object()
        response_holder: dict[str, object] = {}

        def push(item: object) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, item)

        def worker() -> None:
            raw_request = urllib.request.Request(
                url=request.url,
                data=request.body if request.body else None,
                method=request.method,
                headers=request.header_mapping(),
            )
            timeout_sec = request.timeout_ms / 1000.0
            try:
                with urllib.request.urlopen(raw_request, timeout=timeout_sec) as response:
                    response_holder["response"] = response
                    data_lines: list[str] = []
                    for raw_line in response:
                        decoded_line = raw_line.decode("utf-8")
                        stripped_line = decoded_line.rstrip("\r\n")
                        if stripped_line == "":
                            if data_lines:
                                payload = "\n".join(data_lines).strip()
                                data_lines.clear()
                                if payload:
                                    push(json.loads(payload))
                            continue
                        if stripped_line.startswith(":"):
                            continue
                        if stripped_line.startswith("data:"):
                            data_lines.append(stripped_line[5:].lstrip())
                    if data_lines:
                        payload = "\n".join(data_lines).strip()
                        if payload:
                            push(json.loads(payload))
            except urllib.error.HTTPError as exc:
                body = exc.read() if exc.fp is not None else b""
                push(
                    Qwen3VoiceCloneHTTPResponse(
                        status_code=exc.code,
                        headers=tuple(exc.headers.items()) if exc.headers is not None else (),
                        body=body,
                    )
                )
            except urllib.error.URLError as exc:
                reason = exc.reason
                if isinstance(reason, TimeoutError):
                    push(asyncio.TimeoutError())
                elif isinstance(reason, OSError) and "timed out" in str(reason).lower():
                    push(asyncio.TimeoutError())
                else:
                    push(OSError(str(reason) or "Qwen3 provider stream transport failed"))
            except BaseException as exc:
                push(exc)
            finally:
                push(sentinel)

        thread = threading.Thread(
            target=worker,
            name="echo-qwen3-stream-request",
            daemon=True,
        )
        thread.start()

        try:
            while True:
                item = await queue.get()
                if item is sentinel:
                    break
                if isinstance(item, Qwen3VoiceCloneHTTPResponse):
                    self._raise_for_http_failure(item, resolved_request)
                if isinstance(item, BaseException):
                    raise item
                if not isinstance(item, Mapping):
                    raise ValueError("Qwen3 streaming event payload must decode to a JSON object")
                yield item
        finally:
            response = response_holder.get("response")
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    def _raise_for_stream_error_payload(
        self,
        payload: Mapping[str, object],
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> None:
        raw_code = payload.get("code")
        raw_message = payload.get("message")
        if isinstance(raw_code, str) and raw_code.strip():
            message = (
                raw_message.strip()
                if isinstance(raw_message, str) and raw_message.strip()
                else "Qwen3 voice-clone stream returned an error event"
            )
            raise_provider_error(
                error_code=TTSProviderErrorCode.VALIDATION_FAILED,
                message=message,
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
            )

    def _build_stream_fragment(
        self,
        audio_base64: str,
        fragment_index: int,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> TTSAudioFragment:
        audio_bytes = self._decode_audio_base64(audio_base64)
        if len(audio_bytes) % 2 != 0:
            raise ValueError("Qwen3 streaming PCM fragment must contain an even number of bytes")
        return TTSAudioFragment(
            fragment_index=fragment_index,
            audio_bytes=audio_bytes,
            sample_rate_hz=self._config.default_sample_rate_hz,
            channel_count=self._config.default_channel_count,
            is_final=False,
            media_type=resolved_request.media_type,
        )

    def _decode_enrollment_response(
        self,
        response: Qwen3VoiceCloneHTTPResponse,
        request: TTSVoiceEnrollmentRequest,
    ) -> TTSVoiceEnrollmentResult:
        if not response.is_success:
            self._raise_for_enrollment_http_failure(response)
        payload = self._decode_json_bytes(response.body)
        normalized = self._normalize_enrollment_payload(payload)
        voice_profile_key = request.voice_profile_key or self._derive_voice_profile_key(
            request.display_name,
            normalized.voice_id,
        )
        return TTSVoiceEnrollmentResult(
            voice_profile=TTSVoiceProfile(
                voice_profile_key=voice_profile_key,
                provider_key=self.provider_key,
                display_name=normalized.display_name or request.display_name,
                provider_voice_id=normalized.voice_id,
                provider_realtime_voice_id=normalized.realtime_voice_id,
            ),
            verification_metadata=TTSVoiceEnrollmentVerificationMetadata(
                provider_key=self.provider_key,
                provider_voice_id=normalized.voice_id,
                provider_realtime_voice_id=normalized.realtime_voice_id,
                provider_enrollment_id=normalized.enrollment_id,
            ),
        )

    def _raise_for_enrollment_http_failure(
        self,
        response: Qwen3VoiceCloneHTTPResponse,
    ) -> None:
        error_message = self._extract_error_message(response.body)
        if response.status_code in {401, 403}:
            raise_provider_error(
                error_code=TTSProviderErrorCode.AUTHENTICATION_FAILED,
                message=error_message or "Qwen3 voice-clone enrollment authentication failed",
                retryable=False,
                provider_key=self.provider_key,
                http_status=response.status_code,
            )
        if response.status_code == 429:
            raise_provider_error(
                error_code=TTSProviderErrorCode.RATE_LIMITED,
                message=error_message or "Qwen3 voice-clone enrollment was rate limited",
                retryable=True,
                provider_key=self.provider_key,
                http_status=response.status_code,
            )
        if response.status_code in {408, 504}:
            raise_provider_error(
                error_code=TTSProviderErrorCode.TIMEOUT,
                message=error_message or "Qwen3 voice-clone enrollment timed out",
                retryable=True,
                provider_key=self.provider_key,
                http_status=response.status_code,
            )
        if response.status_code in {400, 404, 409, 422}:
            raise_provider_error(
                error_code=TTSProviderErrorCode.VALIDATION_FAILED,
                message=error_message or "Qwen3 voice-clone enrollment request was rejected",
                retryable=False,
                provider_key=self.provider_key,
                http_status=response.status_code,
            )
        raise_provider_error(
            error_code=TTSProviderErrorCode.PROVIDER_UNAVAILABLE,
            message=error_message or "Qwen3 voice-clone enrollment provider is unavailable",
            retryable=response.status_code >= 500,
            provider_key=self.provider_key,
            http_status=response.status_code,
        )

    def _normalize_enrollment_payload(
        self,
        payload: object,
    ) -> Qwen3VoiceCloneEnrollmentResponsePayload:
        if not isinstance(payload, Mapping):
            raise ValueError("Qwen3 voice-clone enrollment response must be an object")
        normalized = dict(payload)
        if "output" in normalized and isinstance(normalized["output"], Mapping):
            normalized = dict(normalized["output"])
        if "voice" in normalized and isinstance(normalized["voice"], str):
            normalized = {
                "voice_id": normalized["voice"],
            }
        if "voice_id" not in normalized and "id" in normalized:
            normalized["voice_id"] = normalized["id"]
        normalized.pop("id", None)
        return Qwen3VoiceCloneEnrollmentResponsePayload.model_validate(normalized)

    def _derive_voice_profile_key(
        self,
        display_name: str,
        provider_voice_id: str,
    ) -> str:
        raw = (
            unicodedata.normalize("NFKD", f"{self.provider_key}.{display_name}.{provider_voice_id}")
            .encode("ascii", "ignore")
            .decode("ascii")
            .lower()
        )
        sanitized_chars: list[str] = []
        last_was_separator = False
        for char in raw:
            if char.isalnum():
                sanitized_chars.append(char)
                last_was_separator = False
                continue
            if char in {".", "_", "-"}:
                sanitized_chars.append(char)
                last_was_separator = False
                continue
            if not last_was_separator:
                sanitized_chars.append("-")
                last_was_separator = True
        sanitized = "".join(sanitized_chars).strip("._-")
        if not sanitized:
            sanitized = f"{self.provider_key}.{provider_voice_id}".lower()
        if len(sanitized) > 64:
            sanitized = sanitized[:64].rstrip("._-")
        if not sanitized[0].isalnum():
            sanitized = f"{self.provider_key}.{provider_voice_id}"[:64]
        return sanitized

    def _raise_for_http_failure(
        self,
        response: Qwen3VoiceCloneHTTPResponse,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> None:
        error_message = self._extract_error_message(response.body)
        if response.status_code in {401, 403}:
            raise_provider_error(
                error_code=TTSProviderErrorCode.AUTHENTICATION_FAILED,
                message=error_message or "Qwen3 voice-clone authentication failed",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
                http_status=response.status_code,
            )
        if response.status_code == 429:
            raise_provider_error(
                error_code=TTSProviderErrorCode.RATE_LIMITED,
                message=error_message or "Qwen3 voice-clone provider rate limited the request",
                retryable=True,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
                http_status=response.status_code,
            )
        if response.status_code in {408, 504}:
            raise_provider_error(
                error_code=TTSProviderErrorCode.TIMEOUT,
                message=error_message or "Qwen3 voice-clone provider timed out",
                retryable=True,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
                http_status=response.status_code,
            )
        if response.status_code in {400, 404, 409, 422}:
            raise_provider_error(
                error_code=TTSProviderErrorCode.VALIDATION_FAILED,
                message=error_message or "Qwen3 voice-clone provider rejected the request payload",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=resolved_request.provider_profile_key,
                voice_profile_key=resolved_request.voice_profile.voice_profile_key,
                http_status=response.status_code,
            )
        raise_provider_error(
            error_code=TTSProviderErrorCode.PROVIDER_UNAVAILABLE,
            message=error_message or "Qwen3 voice-clone provider is unavailable",
            retryable=response.status_code >= 500,
            provider_key=self.provider_key,
            provider_profile_key=resolved_request.provider_profile_key,
            voice_profile_key=resolved_request.voice_profile.voice_profile_key,
            http_status=response.status_code,
        )

    def _extract_error_message(self, body: bytes) -> str | None:
        if not body:
            return None
        if not self._looks_like_json(body):
            try:
                text = body.decode("utf-8").strip()
            except UnicodeDecodeError:
                return None
            return text or None
        payload = self._decode_json_bytes(body)
        if not isinstance(payload, Mapping):
            return None
        if "error" in payload and isinstance(payload["error"], Mapping):
            error_payload = Qwen3VoiceCloneJSONErrorPayload.model_validate(payload["error"])
            return error_payload.message
        if "message" in payload and isinstance(payload["message"], str):
            return payload["message"].strip() or None
        return None

    async def _decode_json_response(
        self,
        response: Qwen3VoiceCloneHTTPResponse,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> tuple[TTSAudioFragment, ...]:
        payload = self._decode_json_bytes(response.body)
        if not isinstance(payload, Mapping):
            raise ValueError("Qwen3 voice-clone JSON response must be an object")

        if "output" in payload and isinstance(payload["output"], Mapping):
            output_payload = Qwen3DashScopeSynthesisOutputPayload.model_validate(
                payload["output"]
            )
            if output_payload.audio.data is not None:
                audio_payload = Qwen3VoiceCloneJSONAudioPayload(
                    audio_base64=output_payload.audio.data,
                    is_final=True,
                )
                return (
                    self._fragment_from_audio_payload(
                        audio_payload,
                        0,
                        resolved_request,
                    ),
                )
            assert output_payload.audio.url is not None
            downloaded = await self._download_audio_from_url(
                output_payload.audio.url,
                resolved_request.effective_timeout_ms,
            )
            if not downloaded.is_success:
                self._raise_for_http_failure(downloaded, resolved_request)
            return (self._decode_binary_audio_fragment(downloaded, resolved_request),)

        if "fragments" in payload:
            return self._decode_fragment_list(
                payload["fragments"],
                resolved_request,
            )

        if "audio" in payload and isinstance(payload["audio"], Mapping):
            audio_payload = Qwen3VoiceCloneJSONAudioPayload.model_validate(payload["audio"])
            return (self._fragment_from_audio_payload(audio_payload, 0, resolved_request),)

        if "audio_base64" in payload:
            audio_payload = Qwen3VoiceCloneJSONAudioPayload.model_validate(payload)
            return (self._fragment_from_audio_payload(audio_payload, 0, resolved_request),)

        raise ValueError("Qwen3 voice-clone JSON response did not contain audio payload")

    async def _download_audio_from_url(
        self,
        url: str,
        timeout_ms: int,
    ) -> Qwen3VoiceCloneHTTPResponse:
        request = Qwen3VoiceCloneHTTPRequest(
            method="GET",
            url=url,
            headers=(
                ("accept", self._http_accept_header()),
                ("user-agent", self._config.user_agent),
            ),
            body=b"",
            timeout_ms=timeout_ms,
        )
        return await self._transport.execute(request)

    def _decode_fragment_list(
        self,
        raw_fragments: object,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> tuple[TTSAudioFragment, ...]:
        if not isinstance(raw_fragments, list) or not raw_fragments:
            raise ValueError("Qwen3 voice-clone fragments must be a non-empty list")

        fragments: list[TTSAudioFragment] = []
        for index, raw_fragment in enumerate(raw_fragments):
            fragment_payload = Qwen3VoiceCloneJSONFragmentPayload.model_validate(raw_fragment)
            fragments.append(
                self._fragment_from_fragment_payload(
                    fragment_payload,
                    index,
                    resolved_request,
                )
            )
        return tuple(fragments)

    def _fragment_from_audio_payload(
        self,
        audio_payload: Qwen3VoiceCloneJSONAudioPayload,
        fragment_index: int,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> TTSAudioFragment:
        audio_bytes = self._decode_audio_base64(audio_payload.audio_base64)
        media_type = self._resolve_media_type(
            raw_media_type=audio_payload.media_type,
            fallback_media_type=resolved_request.media_type,
            body=audio_bytes,
        )
        return TTSAudioFragment(
            fragment_index=fragment_index,
            audio_bytes=audio_bytes,
            sample_rate_hz=audio_payload.sample_rate_hz or self._config.default_sample_rate_hz,
            channel_count=audio_payload.channel_count or self._config.default_channel_count,
            is_final=audio_payload.is_final,
            media_type=media_type,
        )

    def _fragment_from_fragment_payload(
        self,
        fragment_payload: Qwen3VoiceCloneJSONFragmentPayload,
        fallback_index: int,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> TTSAudioFragment:
        audio_bytes = self._decode_audio_base64(fragment_payload.audio_base64)
        media_type = self._resolve_media_type(
            raw_media_type=fragment_payload.media_type,
            fallback_media_type=resolved_request.media_type,
            body=audio_bytes,
        )
        fragment_index = (
            fallback_index
            if fragment_payload.fragment_index is None
            else fragment_payload.fragment_index
        )
        return TTSAudioFragment(
            fragment_index=fragment_index,
            audio_bytes=audio_bytes,
            sample_rate_hz=fragment_payload.sample_rate_hz or self._config.default_sample_rate_hz,
            channel_count=fragment_payload.channel_count or self._config.default_channel_count,
            is_final=fragment_payload.is_final,
            media_type=media_type,
        )

    def _decode_binary_audio_fragment(
        self,
        response: Qwen3VoiceCloneHTTPResponse,
        resolved_request: Qwen3VoiceCloneResolvedRequest,
    ) -> TTSAudioFragment:
        audio_bytes = response.body
        if not audio_bytes:
            raise ValueError("Qwen3 voice-clone provider returned an empty audio body")
        media_type = self._resolve_media_type(
            raw_media_type=response.content_type,
            fallback_media_type=resolved_request.media_type,
            body=audio_bytes,
        )
        return TTSAudioFragment(
            fragment_index=0,
            audio_bytes=audio_bytes,
            sample_rate_hz=self._config.default_sample_rate_hz,
            channel_count=self._config.default_channel_count,
            is_final=True,
            media_type=media_type,
        )

    def _resolve_media_type(
        self,
        *,
        raw_media_type: str | None,
        fallback_media_type: TTSAudioMediaType,
        body: bytes,
    ) -> TTSAudioMediaType:
        if raw_media_type is not None:
            normalized = raw_media_type.strip().lower()
            for media_type in TTSAudioMediaType:
                if media_type == normalized:
                    return media_type
            provider_format_map = {
                "wav": TTSAudioMediaType.WAV,
                "audio/wave": TTSAudioMediaType.WAV,
                "audio/x-wav": TTSAudioMediaType.WAV,
                "mp3": TTSAudioMediaType.MP3,
                "audio/mp3": TTSAudioMediaType.MP3,
                "ogg_opus": TTSAudioMediaType.OGG_OPUS,
                "audio/opus": TTSAudioMediaType.OGG_OPUS,
                "pcm_s16le": TTSAudioMediaType.PCM_S16LE,
            }
            if normalized in provider_format_map:
                return provider_format_map[normalized]

        detected = self._detect_media_type_from_bytes(body)
        if detected is not None:
            return detected
        return fallback_media_type

    def _detect_media_type_from_bytes(self, body: bytes) -> TTSAudioMediaType | None:
        if body.startswith(b"RIFF") and b"WAVE" in body[:16]:
            return TTSAudioMediaType.WAV
        if body.startswith(b"OggS"):
            return TTSAudioMediaType.OGG_OPUS
        if body.startswith(b"ID3") or (
            len(body) >= 2 and body[0] == 0xFF and (body[1] & 0xE0) == 0xE0
        ):
            return TTSAudioMediaType.MP3
        return None

    def _decode_json_bytes(self, body: bytes) -> object:
        text = body.decode("utf-8")
        return json.loads(text)

    def _looks_like_json(self, body: bytes) -> bool:
        stripped = body.lstrip()
        return bool(stripped) and stripped[:1] in {b"{", b"["}

    def _decode_audio_base64(self, payload: str) -> bytes:
        decoded = base64.b64decode(payload.encode("ascii"), validate=True)
        if not decoded:
            raise ValueError("Qwen3 voice-clone payload contained empty audio_base64")
        return decoded

    def _media_type_to_provider_format(self, media_type: TTSAudioMediaType) -> str:
        mapping = {
            TTSAudioMediaType.WAV: "wav",
            TTSAudioMediaType.MP3: "mp3",
            TTSAudioMediaType.OGG_OPUS: "ogg_opus",
            TTSAudioMediaType.PCM_S16LE: "pcm_s16le",
        }
        return mapping[media_type]


class Qwen3VoiceCloneLiveVerificationEnvVar(StrEnum):
    ENABLED = "ECHO_TTS_QWEN3_LIVE_VERIFY"
    PROVIDER_KEY = "ECHO_TTS_QWEN3_LIVE_PROVIDER_KEY"
    BASE_URL = "ECHO_TTS_QWEN3_LIVE_BASE_URL"
    API_KEY = "ECHO_TTS_QWEN3_LIVE_API_KEY"
    REQUEST_TIMEOUT_MS = "ECHO_TTS_QWEN3_LIVE_REQUEST_TIMEOUT_MS"
    STANDARD_MODEL_ID = "ECHO_TTS_QWEN3_LIVE_STANDARD_MODEL_ID"
    STANDARD_VOICE_ID = "ECHO_TTS_QWEN3_LIVE_STANDARD_VOICE_ID"
    SAMPLE_TEXT = "ECHO_TTS_QWEN3_LIVE_SAMPLE_TEXT"
    SAMPLE_LANGUAGE = "ECHO_TTS_QWEN3_LIVE_SAMPLE_LANGUAGE"
    SAMPLE_VOICE_STYLE = "ECHO_TTS_QWEN3_LIVE_SAMPLE_VOICE_STYLE"
    PREFERRED_MEDIA_TYPE = "ECHO_TTS_QWEN3_LIVE_PREFERRED_MEDIA_TYPE"
    PROVIDER_PROFILE_KEY = "ECHO_TTS_QWEN3_LIVE_PROVIDER_PROFILE_KEY"
    VOICE_PROFILE_KEY = "ECHO_TTS_QWEN3_LIVE_VOICE_PROFILE_KEY"
    VOICE_DISPLAY_NAME = "ECHO_TTS_QWEN3_LIVE_VOICE_DISPLAY_NAME"
    VERIFY_REALTIME = "ECHO_TTS_QWEN3_LIVE_VERIFY_REALTIME"
    REALTIME_MODEL_ID = "ECHO_TTS_QWEN3_LIVE_REALTIME_MODEL_ID"
    REALTIME_VOICE_ID = "ECHO_TTS_QWEN3_LIVE_REALTIME_VOICE_ID"
    REALTIME_SAMPLE_TEXT = "ECHO_TTS_QWEN3_LIVE_REALTIME_SAMPLE_TEXT"
    REALTIME_SAMPLE_VOICE_STYLE = "ECHO_TTS_QWEN3_LIVE_REALTIME_SAMPLE_VOICE_STYLE"
    VERIFY_ENROLLMENT = "ECHO_TTS_QWEN3_LIVE_VERIFY_ENROLLMENT"
    ENROLLMENT_DISPLAY_NAME = "ECHO_TTS_QWEN3_LIVE_ENROLLMENT_DISPLAY_NAME"
    ENROLLMENT_VOICE_PROFILE_KEY = "ECHO_TTS_QWEN3_LIVE_ENROLLMENT_VOICE_PROFILE_KEY"
    ENROLLMENT_REFERENCE_AUDIO_PATH = "ECHO_TTS_QWEN3_LIVE_ENROLLMENT_REFERENCE_AUDIO_PATH"
    ENROLLMENT_REALTIME_REFERENCE_AUDIO_PATH = (
        "ECHO_TTS_QWEN3_LIVE_ENROLLMENT_REALTIME_REFERENCE_AUDIO_PATH"
    )
    ENROLLMENT_PROMPT_TEXT = "ECHO_TTS_QWEN3_LIVE_ENROLLMENT_PROMPT_TEXT"
    ENROLLMENT_PROMPT_LANGUAGE = "ECHO_TTS_QWEN3_LIVE_ENROLLMENT_PROMPT_LANGUAGE"


class Qwen3VoiceCloneLiveVerificationStepName(StrEnum):
    BASELINE_SYNTHESIS = "baseline_synthesis"
    REALTIME_SYNTHESIS = "realtime_synthesis"
    VOICE_ENROLLMENT = "voice_enrollment"


class Qwen3VoiceCloneLiveVerificationStepStatus(StrEnum):
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


class Qwen3VoiceCloneLiveVerificationConfig(TTSModel):
    provider_key: str = Field(default="qwen3_vc", pattern=KEY_PATTERN)
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: SecretStr
    request_timeout_ms: int = Field(default=30000, gt=0)
    standard_model_id: str = Field(min_length=1, max_length=256)
    standard_voice_id: str = Field(min_length=1, max_length=256)
    sample_text: str = Field(
        default="Echo live verification baseline synthesis check.",
        min_length=1,
        max_length=4000,
    )
    sample_language: str | None = Field(
        default=None,
        pattern=LANGUAGE_PATTERN,
        max_length=32,
    )
    sample_voice_style: str | None = Field(default=None, min_length=1, max_length=64)
    preferred_media_type: TTSAudioMediaType = TTSAudioMediaType.WAV
    provider_profile_key: str = Field(
        default="qwen3.live.verify.profile",
        pattern=KEY_PATTERN,
    )
    voice_profile_key: str = Field(
        default="qwen3.live.verify.voice",
        pattern=KEY_PATTERN,
    )
    voice_display_name: str = Field(
        default="Qwen3 Live Verification Voice",
        min_length=1,
        max_length=128,
    )
    verify_realtime_synthesis: bool = False
    realtime_model_id: str | None = Field(default=None, min_length=1, max_length=256)
    realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    realtime_sample_text: str = Field(
        default="Echo live verification realtime synthesis check.",
        min_length=1,
        max_length=4000,
    )
    realtime_sample_voice_style: str = Field(
        default="realtime",
        min_length=1,
        max_length=64,
    )
    verify_enrollment: bool = False
    enrollment_display_name: str = Field(
        default="Echo Live Verification Enrollment",
        min_length=1,
        max_length=128,
    )
    enrollment_voice_profile_key: str = Field(
        default="qwen3.live.verify.enrolled",
        pattern=KEY_PATTERN,
    )
    enrollment_reference_audio_path: Path | None = None
    enrollment_realtime_reference_audio_path: Path | None = None
    enrollment_prompt_text: str | None = Field(
        default=None,
        min_length=1,
        max_length=4000,
    )
    enrollment_prompt_language: str | None = Field(
        default=None,
        pattern=LANGUAGE_PATTERN,
        max_length=32,
    )

    @model_validator(mode="after")
    def validate_optional_checks(self) -> Self:
        if self.verify_realtime_synthesis and (
            self.realtime_model_id is None or self.realtime_voice_id is None
        ):
            raise ValueError(
                "verify_realtime_synthesis requires realtime_model_id and realtime_voice_id"
            )
        if self.verify_enrollment:
            if self.enrollment_reference_audio_path is None:
                raise ValueError(
                    "verify_enrollment requires enrollment_reference_audio_path"
                )
            if (
                not self.enrollment_reference_audio_path.exists()
                or not self.enrollment_reference_audio_path.is_file()
            ):
                raise ValueError(
                    "enrollment_reference_audio_path must point to an existing local file"
                )
        if self.enrollment_realtime_reference_audio_path is not None and (
            not self.enrollment_realtime_reference_audio_path.exists()
            or not self.enrollment_realtime_reference_audio_path.is_file()
        ):
            raise ValueError(
                "enrollment_realtime_reference_audio_path must point to an existing local file"
            )
        if (
            self.enrollment_prompt_language is not None
            and self.enrollment_prompt_text is None
        ):
            raise ValueError("enrollment_prompt_language requires enrollment_prompt_text")
        return self


class Qwen3VoiceCloneLiveVerificationGate(TTSModel):
    should_run: bool
    opted_in: bool
    skip_reason: str | None = Field(default=None, min_length=1, max_length=4000)
    required_env_keys: tuple[str, ...] = ()
    missing_env_keys: tuple[str, ...] = ()
    config: Qwen3VoiceCloneLiveVerificationConfig | None = None

    @model_validator(mode="after")
    def validate_gate_state(self) -> Self:
        if self.should_run and self.config is None:
            raise ValueError("config is required when should_run is true")
        if not self.should_run and self.skip_reason is None:
            raise ValueError("skip_reason is required when should_run is false")
        if self.config is not None and not self.should_run:
            raise ValueError("config must be omitted when should_run is false")
        return self

    @classmethod
    def ready(
        cls,
        *,
        config: Qwen3VoiceCloneLiveVerificationConfig,
        required_env_keys: tuple[str, ...],
    ) -> "Qwen3VoiceCloneLiveVerificationGate":
        return cls(
            should_run=True,
            opted_in=True,
            required_env_keys=required_env_keys,
            config=config,
        )

    @classmethod
    def skipped(
        cls,
        *,
        opted_in: bool,
        skip_reason: str,
        required_env_keys: tuple[str, ...] = (),
        missing_env_keys: tuple[str, ...] = (),
    ) -> "Qwen3VoiceCloneLiveVerificationGate":
        return cls(
            should_run=False,
            opted_in=opted_in,
            skip_reason=skip_reason,
            required_env_keys=required_env_keys,
            missing_env_keys=missing_env_keys,
        )


class Qwen3VoiceCloneLiveVerificationFragmentSummary(TTSModel):
    fragment_count: int = Field(ge=1)
    total_audio_bytes: int = Field(ge=1)
    final_fragment_index: int = Field(ge=0)
    final_media_type: TTSAudioMediaType | None = None
    final_sample_rate_hz: int = Field(gt=0)
    final_channel_count: int = Field(gt=0, le=8)

    @classmethod
    def from_fragments(
        cls,
        fragments: tuple[TTSAudioFragment, ...],
    ) -> "Qwen3VoiceCloneLiveVerificationFragmentSummary":
        final_fragment = fragments[-1]
        return cls(
            fragment_count=len(fragments),
            total_audio_bytes=sum(len(fragment.audio_bytes) for fragment in fragments),
            final_fragment_index=final_fragment.fragment_index,
            final_media_type=final_fragment.media_type,
            final_sample_rate_hz=final_fragment.sample_rate_hz,
            final_channel_count=final_fragment.channel_count,
        )


class Qwen3VoiceCloneLiveVerificationStep(TTSModel):
    step_name: Qwen3VoiceCloneLiveVerificationStepName
    status: Qwen3VoiceCloneLiveVerificationStepStatus
    detail: str | None = Field(default=None, min_length=1, max_length=4000)
    error: TTSProviderError | None = None

    @model_validator(mode="after")
    def validate_status_alignment(self) -> Self:
        if self.status == Qwen3VoiceCloneLiveVerificationStepStatus.FAILED and self.error is None:
            raise ValueError("failed verification steps require error")
        if (
            self.status != Qwen3VoiceCloneLiveVerificationStepStatus.FAILED
            and self.error is not None
        ):
            raise ValueError("only failed verification steps may carry error")
        return self

    @property
    def succeeded(self) -> bool:
        return self.status == Qwen3VoiceCloneLiveVerificationStepStatus.SUCCESS


class Qwen3VoiceCloneLiveSynthesisCheck(Qwen3VoiceCloneLiveVerificationStep):
    track_kind: Qwen3VoiceCloneTrackKind
    transport_mode: Qwen3VoiceCloneTransportMode
    provider_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    voice_profile_key: str = Field(pattern=KEY_PATTERN)
    requested_text: str = Field(min_length=1, max_length=4000)
    requested_voice_style: str | None = Field(default=None, min_length=1, max_length=64)
    resolved_model_id: str = Field(min_length=1, max_length=256)
    resolved_voice_id: str = Field(min_length=1, max_length=256)
    fragment_summary: Qwen3VoiceCloneLiveVerificationFragmentSummary | None = None

    @model_validator(mode="after")
    def validate_fragment_summary_alignment(self) -> Self:
        if self.status == Qwen3VoiceCloneLiveVerificationStepStatus.SUCCESS:
            if self.fragment_summary is None:
                raise ValueError("successful synthesis verification requires fragment_summary")
        elif self.fragment_summary is not None:
            raise ValueError("only successful synthesis verification may carry fragment_summary")
        return self

    @classmethod
    def success(
        cls,
        *,
        step_name: Qwen3VoiceCloneLiveVerificationStepName,
        track_kind: Qwen3VoiceCloneTrackKind,
        transport_mode: Qwen3VoiceCloneTransportMode,
        provider_profile_key: str | None,
        voice_profile_key: str,
        requested_text: str,
        requested_voice_style: str | None,
        resolved_model_id: str,
        resolved_voice_id: str,
        fragments: tuple[TTSAudioFragment, ...],
    ) -> "Qwen3VoiceCloneLiveSynthesisCheck":
        return cls(
            step_name=step_name,
            status=Qwen3VoiceCloneLiveVerificationStepStatus.SUCCESS,
            detail=f"received {len(fragments)} audio fragment(s) from the real provider",
            track_kind=track_kind,
            transport_mode=transport_mode,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
            requested_text=requested_text,
            requested_voice_style=requested_voice_style,
            resolved_model_id=resolved_model_id,
            resolved_voice_id=resolved_voice_id,
            fragment_summary=Qwen3VoiceCloneLiveVerificationFragmentSummary.from_fragments(
                fragments
            ),
        )

    @classmethod
    def failed(
        cls,
        *,
        step_name: Qwen3VoiceCloneLiveVerificationStepName,
        track_kind: Qwen3VoiceCloneTrackKind,
        transport_mode: Qwen3VoiceCloneTransportMode,
        provider_profile_key: str | None,
        voice_profile_key: str,
        requested_text: str,
        requested_voice_style: str | None,
        resolved_model_id: str,
        resolved_voice_id: str,
        error: TTSProviderError,
    ) -> "Qwen3VoiceCloneLiveSynthesisCheck":
        return cls(
            step_name=step_name,
            status=Qwen3VoiceCloneLiveVerificationStepStatus.FAILED,
            detail=error.message,
            error=error,
            track_kind=track_kind,
            transport_mode=transport_mode,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
            requested_text=requested_text,
            requested_voice_style=requested_voice_style,
            resolved_model_id=resolved_model_id,
            resolved_voice_id=resolved_voice_id,
        )

    @classmethod
    def skipped(
        cls,
        *,
        step_name: Qwen3VoiceCloneLiveVerificationStepName,
        track_kind: Qwen3VoiceCloneTrackKind,
        transport_mode: Qwen3VoiceCloneTransportMode,
        provider_profile_key: str | None,
        voice_profile_key: str,
        requested_text: str,
        requested_voice_style: str | None,
        resolved_model_id: str,
        resolved_voice_id: str,
        detail: str,
    ) -> "Qwen3VoiceCloneLiveSynthesisCheck":
        return cls(
            step_name=step_name,
            status=Qwen3VoiceCloneLiveVerificationStepStatus.SKIPPED,
            detail=detail,
            track_kind=track_kind,
            transport_mode=transport_mode,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
            requested_text=requested_text,
            requested_voice_style=requested_voice_style,
            resolved_model_id=resolved_model_id,
            resolved_voice_id=resolved_voice_id,
        )


class Qwen3VoiceCloneLiveEnrollmentCheck(Qwen3VoiceCloneLiveVerificationStep):
    display_name: str = Field(min_length=1, max_length=128)
    voice_profile_key: str = Field(pattern=KEY_PATTERN)
    reference_audio_path: str | None = Field(default=None, min_length=1, max_length=4096)
    realtime_reference_audio_path: str | None = Field(
        default=None,
        min_length=1,
        max_length=4096,
    )
    result: TTSVoiceEnrollmentResult | None = None

    @model_validator(mode="after")
    def validate_enrollment_result_alignment(self) -> Self:
        if self.status == Qwen3VoiceCloneLiveVerificationStepStatus.SUCCESS:
            if self.result is None:
                raise ValueError("successful enrollment verification requires result")
        elif self.result is not None:
            raise ValueError("only successful enrollment verification may carry result")
        return self

    @classmethod
    def success(
        cls,
        *,
        display_name: str,
        voice_profile_key: str,
        reference_audio_path: Path,
        realtime_reference_audio_path: Path | None,
        result: TTSVoiceEnrollmentResult,
    ) -> "Qwen3VoiceCloneLiveEnrollmentCheck":
        return cls(
            step_name=Qwen3VoiceCloneLiveVerificationStepName.VOICE_ENROLLMENT,
            status=Qwen3VoiceCloneLiveVerificationStepStatus.SUCCESS,
            detail="voice enrollment succeeded through the real provider",
            display_name=display_name,
            voice_profile_key=voice_profile_key,
            reference_audio_path=str(reference_audio_path),
            realtime_reference_audio_path=(
                None
                if realtime_reference_audio_path is None
                else str(realtime_reference_audio_path)
            ),
            result=result,
        )

    @classmethod
    def failed(
        cls,
        *,
        display_name: str,
        voice_profile_key: str,
        reference_audio_path: Path,
        realtime_reference_audio_path: Path | None,
        error: TTSProviderError,
    ) -> "Qwen3VoiceCloneLiveEnrollmentCheck":
        return cls(
            step_name=Qwen3VoiceCloneLiveVerificationStepName.VOICE_ENROLLMENT,
            status=Qwen3VoiceCloneLiveVerificationStepStatus.FAILED,
            detail=error.message,
            error=error,
            display_name=display_name,
            voice_profile_key=voice_profile_key,
            reference_audio_path=str(reference_audio_path),
            realtime_reference_audio_path=(
                None
                if realtime_reference_audio_path is None
                else str(realtime_reference_audio_path)
            ),
        )

    @classmethod
    def skipped(
        cls,
        *,
        display_name: str,
        voice_profile_key: str,
        reference_audio_path: Path | None,
        realtime_reference_audio_path: Path | None,
        detail: str,
    ) -> "Qwen3VoiceCloneLiveEnrollmentCheck":
        return cls(
            step_name=Qwen3VoiceCloneLiveVerificationStepName.VOICE_ENROLLMENT,
            status=Qwen3VoiceCloneLiveVerificationStepStatus.SKIPPED,
            detail=detail,
            display_name=display_name,
            voice_profile_key=voice_profile_key,
            reference_audio_path=None if reference_audio_path is None else str(reference_audio_path),
            realtime_reference_audio_path=(
                None
                if realtime_reference_audio_path is None
                else str(realtime_reference_audio_path)
            ),
        )


class Qwen3VoiceCloneLiveVerificationResult(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    provider_metadata: Qwen3VoiceCloneProviderMetadata
    baseline_synthesis: Qwen3VoiceCloneLiveSynthesisCheck
    realtime_synthesis: Qwen3VoiceCloneLiveSynthesisCheck | None = None
    enrollment: Qwen3VoiceCloneLiveEnrollmentCheck | None = None

    @property
    def succeeded(self) -> bool:
        if not self.baseline_synthesis.succeeded:
            return False
        if self.realtime_synthesis is not None and not self.realtime_synthesis.succeeded:
            return False
        if self.enrollment is not None and not self.enrollment.succeeded:
            return False
        return True

    def to_assertion_message(self) -> str:
        lines = [
            f"provider={self.provider_key}",
            (
                "baseline="
                f"{self.baseline_synthesis.status}"
                + (
                    ""
                    if self.baseline_synthesis.detail is None
                    else f" ({self.baseline_synthesis.detail})"
                )
            ),
        ]
        if self.realtime_synthesis is not None:
            lines.append(
                "realtime="
                f"{self.realtime_synthesis.status}"
                + (
                    ""
                    if self.realtime_synthesis.detail is None
                    else f" ({self.realtime_synthesis.detail})"
                )
            )
        if self.enrollment is not None:
            lines.append(
                "enrollment="
                f"{self.enrollment.status}"
                + (
                    ""
                    if self.enrollment.detail is None
                    else f" ({self.enrollment.detail})"
                )
            )
        return "; ".join(lines)


class Qwen3VoiceCloneLiveVerifier:
    def __init__(
        self,
        *,
        config: Qwen3VoiceCloneLiveVerificationConfig,
        transport: Qwen3VoiceCloneTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport

    @classmethod
    def resolve_from_environment(
        cls,
        environment: Mapping[str, str] | None = None,
    ) -> Qwen3VoiceCloneLiveVerificationGate:
        env = os.environ if environment is None else environment
        opted_in = _qwen3_live_env_flag_enabled(
            env.get(Qwen3VoiceCloneLiveVerificationEnvVar.ENABLED)
        )
        required = cls._required_env_keys_from_environment(env)
        if not opted_in:
            return Qwen3VoiceCloneLiveVerificationGate.skipped(
                opted_in=False,
                skip_reason=(
                    "live verification is disabled; set "
                    f"{Qwen3VoiceCloneLiveVerificationEnvVar.ENABLED}=1 "
                    "plus the required Qwen3 provider env vars to run it"
                ),
                required_env_keys=required,
            )

        missing = tuple(
            env_key for env_key in required if not _qwen3_live_env_has_value(env.get(env_key))
        )
        if missing:
            return Qwen3VoiceCloneLiveVerificationGate.skipped(
                opted_in=True,
                skip_reason=(
                    "missing required env for Qwen3 live verification: "
                    + ", ".join(missing)
                ),
                required_env_keys=required,
                missing_env_keys=missing,
            )

        config = Qwen3VoiceCloneLiveVerificationConfig(
            provider_key=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.PROVIDER_KEY,
                "qwen3_vc",
            ),
            base_url=_qwen3_live_env_required(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.BASE_URL,
            ),
            api_key=SecretStr(
                _qwen3_live_env_required(
                    env,
                    Qwen3VoiceCloneLiveVerificationEnvVar.API_KEY,
                )
            ),
            request_timeout_ms=_qwen3_live_env_int(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.REQUEST_TIMEOUT_MS,
                30000,
            ),
            standard_model_id=_qwen3_live_env_required(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.STANDARD_MODEL_ID,
            ),
            standard_voice_id=_qwen3_live_env_required(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.STANDARD_VOICE_ID,
            ),
            sample_text=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.SAMPLE_TEXT,
                "Echo live verification baseline synthesis check.",
            ),
            sample_language=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.SAMPLE_LANGUAGE,
            ),
            sample_voice_style=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.SAMPLE_VOICE_STYLE,
            ),
            preferred_media_type=_qwen3_live_env_media_type(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.PREFERRED_MEDIA_TYPE,
                TTSAudioMediaType.WAV,
            ),
            provider_profile_key=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.PROVIDER_PROFILE_KEY,
                "qwen3.live.verify.profile",
            ),
            voice_profile_key=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.VOICE_PROFILE_KEY,
                "qwen3.live.verify.voice",
            ),
            voice_display_name=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.VOICE_DISPLAY_NAME,
                "Qwen3 Live Verification Voice",
            ),
            verify_realtime_synthesis=_qwen3_live_env_flag_enabled(
                env.get(Qwen3VoiceCloneLiveVerificationEnvVar.VERIFY_REALTIME)
            ),
            realtime_model_id=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.REALTIME_MODEL_ID,
            ),
            realtime_voice_id=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.REALTIME_VOICE_ID,
            ),
            realtime_sample_text=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.REALTIME_SAMPLE_TEXT,
                "Echo live verification realtime synthesis check.",
            ),
            realtime_sample_voice_style=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.REALTIME_SAMPLE_VOICE_STYLE,
                "realtime",
            ),
            verify_enrollment=_qwen3_live_env_flag_enabled(
                env.get(Qwen3VoiceCloneLiveVerificationEnvVar.VERIFY_ENROLLMENT)
            ),
            enrollment_display_name=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_DISPLAY_NAME,
                "Echo Live Verification Enrollment",
            ),
            enrollment_voice_profile_key=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_VOICE_PROFILE_KEY,
                "qwen3.live.verify.enrolled",
            ),
            enrollment_reference_audio_path=_qwen3_live_env_path_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_REFERENCE_AUDIO_PATH,
            ),
            enrollment_realtime_reference_audio_path=_qwen3_live_env_path_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_REALTIME_REFERENCE_AUDIO_PATH,
            ),
            enrollment_prompt_text=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_PROMPT_TEXT,
            ),
            enrollment_prompt_language=_qwen3_live_env_optional(
                env,
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_PROMPT_LANGUAGE,
            ),
        )
        return Qwen3VoiceCloneLiveVerificationGate.ready(
            config=config,
            required_env_keys=required,
        )

    @classmethod
    def _required_env_keys_from_environment(
        cls,
        environment: Mapping[str, str],
    ) -> tuple[str, ...]:
        required = [
            Qwen3VoiceCloneLiveVerificationEnvVar.BASE_URL,
            Qwen3VoiceCloneLiveVerificationEnvVar.API_KEY,
            Qwen3VoiceCloneLiveVerificationEnvVar.STANDARD_MODEL_ID,
            Qwen3VoiceCloneLiveVerificationEnvVar.STANDARD_VOICE_ID,
        ]
        if _qwen3_live_env_flag_enabled(
            environment.get(Qwen3VoiceCloneLiveVerificationEnvVar.VERIFY_REALTIME)
        ):
            required.extend(
                [
                    Qwen3VoiceCloneLiveVerificationEnvVar.REALTIME_MODEL_ID,
                    Qwen3VoiceCloneLiveVerificationEnvVar.REALTIME_VOICE_ID,
                ]
            )
        if _qwen3_live_env_flag_enabled(
            environment.get(Qwen3VoiceCloneLiveVerificationEnvVar.VERIFY_ENROLLMENT)
        ):
            required.append(
                Qwen3VoiceCloneLiveVerificationEnvVar.ENROLLMENT_REFERENCE_AUDIO_PATH
            )
        return tuple(str(item) for item in required)

    async def run(self) -> Qwen3VoiceCloneLiveVerificationResult:
        provider = self._build_provider()
        service = self._build_service(provider)

        baseline = await self._run_baseline_synthesis(service)

        realtime: Qwen3VoiceCloneLiveSynthesisCheck | None = None
        if self._config.verify_realtime_synthesis:
            if baseline.succeeded:
                realtime = await self._run_realtime_synthesis(service)
            else:
                realtime = self._build_skipped_realtime_check(
                    "skipped because baseline synthesis did not succeed"
                )

        enrollment: Qwen3VoiceCloneLiveEnrollmentCheck | None = None
        if self._config.verify_enrollment:
            if baseline.succeeded:
                enrollment = await self._run_enrollment(service)
            else:
                enrollment = Qwen3VoiceCloneLiveEnrollmentCheck.skipped(
                    display_name=self._config.enrollment_display_name,
                    voice_profile_key=self._config.enrollment_voice_profile_key,
                    reference_audio_path=self._config.enrollment_reference_audio_path,
                    realtime_reference_audio_path=(
                        self._config.enrollment_realtime_reference_audio_path
                    ),
                    detail="skipped because baseline synthesis did not succeed",
                )

        return Qwen3VoiceCloneLiveVerificationResult(
            provider_key=self._config.provider_key,
            provider_metadata=provider.get_family_metadata(),
            baseline_synthesis=baseline,
            realtime_synthesis=realtime,
            enrollment=enrollment,
        )

    def _build_provider(self) -> Qwen3VoiceCloneProvider:
        provider_config = Qwen3VoiceCloneProviderConfig(
            provider_key=self._config.provider_key,
            base_url=self._config.base_url,
            api_key=self._config.api_key,
            request_timeout_ms=self._config.request_timeout_ms,
            standard_model_id=self._config.standard_model_id,
            standard_voice_id=self._config.standard_voice_id,
            realtime_model_id=self._config.realtime_model_id,
            realtime_voice_id=self._config.realtime_voice_id,
            default_media_type=self._config.preferred_media_type,
        )
        return Qwen3VoiceCloneProvider(
            config=provider_config,
            transport=self._transport,
        )

    def _build_service(self, provider: Qwen3VoiceCloneProvider) -> TTSService:
        registry = TTSProviderRegistry()
        registry.register_provider(provider)
        registry.register_voice_profile(self._build_baseline_voice_profile())
        registry.register_provider_profile(
            TTSProviderProfile(
                provider_profile_key=self._config.provider_profile_key,
                provider_key=self._config.provider_key,
                display_name="Qwen3 Live Verification Profile",
                voice_profile_key=self._config.voice_profile_key,
                synthesis_config=TTSSynthesisConfig(
                    timeout_ms=self._config.request_timeout_ms,
                    preferred_media_type=self._config.preferred_media_type,
                ),
                is_default=True,
            )
        )
        return TTSService(registry)

    def _build_baseline_voice_profile(self) -> TTSVoiceProfile:
        return TTSVoiceProfile(
            voice_profile_key=self._config.voice_profile_key,
            provider_key=self._config.provider_key,
            display_name=self._config.voice_display_name,
            provider_voice_id=self._config.standard_voice_id,
            provider_realtime_voice_id=self._config.realtime_voice_id,
        )

    async def _run_baseline_synthesis(
        self,
        service: TTSService,
    ) -> Qwen3VoiceCloneLiveSynthesisCheck:
        try:
            fragments = await service.collect_audio_fragments_for_chunk(
                tts_chunk=self._build_chunk(
                    text=self._config.sample_text,
                    voice_style=self._config.sample_voice_style,
                ),
                voice_profile_key=self._config.voice_profile_key,
                provider_profile_key=self._config.provider_profile_key,
                synthesis_config=TTSSynthesisConfig(
                    timeout_ms=self._config.request_timeout_ms,
                    preferred_media_type=self._config.preferred_media_type,
                ),
            )
            return Qwen3VoiceCloneLiveSynthesisCheck.success(
                step_name=Qwen3VoiceCloneLiveVerificationStepName.BASELINE_SYNTHESIS,
                track_kind=Qwen3VoiceCloneTrackKind.STANDARD,
                transport_mode=Qwen3VoiceCloneTransportMode.BASELINE_HTTP,
                provider_profile_key=self._config.provider_profile_key,
                voice_profile_key=self._config.voice_profile_key,
                requested_text=self._config.sample_text,
                requested_voice_style=self._config.sample_voice_style,
                resolved_model_id=self._config.standard_model_id,
                resolved_voice_id=self._config.standard_voice_id,
                fragments=fragments,
            )
        except Exception as exc:
            return Qwen3VoiceCloneLiveSynthesisCheck.failed(
                step_name=Qwen3VoiceCloneLiveVerificationStepName.BASELINE_SYNTHESIS,
                track_kind=Qwen3VoiceCloneTrackKind.STANDARD,
                transport_mode=Qwen3VoiceCloneTransportMode.BASELINE_HTTP,
                provider_profile_key=self._config.provider_profile_key,
                voice_profile_key=self._config.voice_profile_key,
                requested_text=self._config.sample_text,
                requested_voice_style=self._config.sample_voice_style,
                resolved_model_id=self._config.standard_model_id,
                resolved_voice_id=self._config.standard_voice_id,
                error=provider_error_from_exception(
                    exc,
                    provider_key=self._config.provider_key,
                    provider_profile_key=self._config.provider_profile_key,
                    voice_profile_key=self._config.voice_profile_key,
                ),
            )

    async def _run_realtime_synthesis(
        self,
        service: TTSService,
    ) -> Qwen3VoiceCloneLiveSynthesisCheck:
        assert self._config.realtime_model_id is not None
        assert self._config.realtime_voice_id is not None
        try:
            fragments = await service.collect_audio_fragments_for_chunk(
                tts_chunk=self._build_chunk(
                    text=self._config.realtime_sample_text,
                    voice_style=self._config.realtime_sample_voice_style,
                ),
                voice_profile_key=self._config.voice_profile_key,
                provider_profile_key=self._config.provider_profile_key,
                synthesis_config=TTSSynthesisConfig(
                    timeout_ms=self._config.request_timeout_ms,
                    preferred_media_type=self._config.preferred_media_type,
                ),
            )
            return Qwen3VoiceCloneLiveSynthesisCheck.success(
                step_name=Qwen3VoiceCloneLiveVerificationStepName.REALTIME_SYNTHESIS,
                track_kind=Qwen3VoiceCloneTrackKind.REALTIME,
                transport_mode=Qwen3VoiceCloneTransportMode.REALTIME_HTTP,
                provider_profile_key=self._config.provider_profile_key,
                voice_profile_key=self._config.voice_profile_key,
                requested_text=self._config.realtime_sample_text,
                requested_voice_style=self._config.realtime_sample_voice_style,
                resolved_model_id=self._config.realtime_model_id,
                resolved_voice_id=self._config.realtime_voice_id,
                fragments=fragments,
            )
        except Exception as exc:
            return Qwen3VoiceCloneLiveSynthesisCheck.failed(
                step_name=Qwen3VoiceCloneLiveVerificationStepName.REALTIME_SYNTHESIS,
                track_kind=Qwen3VoiceCloneTrackKind.REALTIME,
                transport_mode=Qwen3VoiceCloneTransportMode.REALTIME_HTTP,
                provider_profile_key=self._config.provider_profile_key,
                voice_profile_key=self._config.voice_profile_key,
                requested_text=self._config.realtime_sample_text,
                requested_voice_style=self._config.realtime_sample_voice_style,
                resolved_model_id=self._config.realtime_model_id,
                resolved_voice_id=self._config.realtime_voice_id,
                error=provider_error_from_exception(
                    exc,
                    provider_key=self._config.provider_key,
                    provider_profile_key=self._config.provider_profile_key,
                    voice_profile_key=self._config.voice_profile_key,
                ),
            )

    async def _run_enrollment(
        self,
        service: TTSService,
    ) -> Qwen3VoiceCloneLiveEnrollmentCheck:
        assert self._config.enrollment_reference_audio_path is not None
        try:
            result = await service.enroll_voice(
                TTSVoiceEnrollmentRequest(
                    provider_key=self._config.provider_key,
                    display_name=self._config.enrollment_display_name,
                    reference_audio_path=self._config.enrollment_reference_audio_path,
                    realtime_reference_audio_path=(
                        self._config.enrollment_realtime_reference_audio_path
                    ),
                    prompt_text=self._config.enrollment_prompt_text,
                    prompt_language=self._config.enrollment_prompt_language,
                    voice_profile_key=self._config.enrollment_voice_profile_key,
                ),
                register_voice_profile=True,
            )
            return Qwen3VoiceCloneLiveEnrollmentCheck.success(
                display_name=self._config.enrollment_display_name,
                voice_profile_key=self._config.enrollment_voice_profile_key,
                reference_audio_path=self._config.enrollment_reference_audio_path,
                realtime_reference_audio_path=(
                    self._config.enrollment_realtime_reference_audio_path
                ),
                result=result,
            )
        except Exception as exc:
            return Qwen3VoiceCloneLiveEnrollmentCheck.failed(
                display_name=self._config.enrollment_display_name,
                voice_profile_key=self._config.enrollment_voice_profile_key,
                reference_audio_path=self._config.enrollment_reference_audio_path,
                realtime_reference_audio_path=(
                    self._config.enrollment_realtime_reference_audio_path
                ),
                error=provider_error_from_exception(
                    exc,
                    provider_key=self._config.provider_key,
                    voice_profile_key=self._config.enrollment_voice_profile_key,
                ),
            )

    def _build_skipped_realtime_check(
        self,
        detail: str,
    ) -> Qwen3VoiceCloneLiveSynthesisCheck:
        assert self._config.realtime_model_id is not None
        assert self._config.realtime_voice_id is not None
        return Qwen3VoiceCloneLiveSynthesisCheck.skipped(
            step_name=Qwen3VoiceCloneLiveVerificationStepName.REALTIME_SYNTHESIS,
            track_kind=Qwen3VoiceCloneTrackKind.REALTIME,
            transport_mode=Qwen3VoiceCloneTransportMode.REALTIME_HTTP,
            provider_profile_key=self._config.provider_profile_key,
            voice_profile_key=self._config.voice_profile_key,
            requested_text=self._config.realtime_sample_text,
            requested_voice_style=self._config.realtime_sample_voice_style,
            resolved_model_id=self._config.realtime_model_id,
            resolved_voice_id=self._config.realtime_voice_id,
            detail=detail,
        )

    def _build_chunk(
        self,
        *,
        text: str,
        voice_style: str | None,
    ) -> TTSChunk:
        return TTSChunk(
            tts_stream_id=uuid4(),
            chunk_index=0,
            text=text,
            voice_style=voice_style,
            emotion_tags=(),
            is_interruptible=True,
        )


def resolve_qwen3_voice_clone_live_verification_from_environment(
    environment: Mapping[str, str] | None = None,
) -> Qwen3VoiceCloneLiveVerificationGate:
    return Qwen3VoiceCloneLiveVerifier.resolve_from_environment(environment)


async def run_qwen3_voice_clone_live_verification_from_environment(
    *,
    environment: Mapping[str, str] | None = None,
    transport: Qwen3VoiceCloneTransportPort | None = None,
) -> Qwen3VoiceCloneLiveVerificationResult:
    gate = resolve_qwen3_voice_clone_live_verification_from_environment(environment)
    if not gate.should_run or gate.config is None:
        raise ValueError(gate.skip_reason or "Qwen3 live verification is not enabled")
    verifier = Qwen3VoiceCloneLiveVerifier(
        config=gate.config,
        transport=transport,
    )
    return await verifier.run()


def _qwen3_live_env_flag_enabled(raw_value: str | None) -> bool:
    if raw_value is None:
        return False
    normalized = raw_value.strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def _qwen3_live_env_has_value(raw_value: str | None) -> bool:
    return raw_value is not None and raw_value.strip() != ""


def _qwen3_live_env_required(
    environment: Mapping[str, str],
    key: Qwen3VoiceCloneLiveVerificationEnvVar,
) -> str:
    value = environment.get(key)
    if not _qwen3_live_env_has_value(value):
        raise ValueError(f"missing required env var {key}")
    assert value is not None
    return value.strip()


def _qwen3_live_env_optional(
    environment: Mapping[str, str],
    key: Qwen3VoiceCloneLiveVerificationEnvVar,
    default: str | None = None,
) -> str | None:
    value = environment.get(key)
    if not _qwen3_live_env_has_value(value):
        return default
    assert value is not None
    return value.strip()


def _qwen3_live_env_int(
    environment: Mapping[str, str],
    key: Qwen3VoiceCloneLiveVerificationEnvVar,
    default: int,
) -> int:
    raw_value = environment.get(key)
    if not _qwen3_live_env_has_value(raw_value):
        return default
    assert raw_value is not None
    return int(raw_value.strip())


def _qwen3_live_env_path_optional(
    environment: Mapping[str, str],
    key: Qwen3VoiceCloneLiveVerificationEnvVar,
) -> Path | None:
    raw_value = environment.get(key)
    if not _qwen3_live_env_has_value(raw_value):
        return None
    assert raw_value is not None
    return Path(raw_value.strip())


def _qwen3_live_env_media_type(
    environment: Mapping[str, str],
    key: Qwen3VoiceCloneLiveVerificationEnvVar,
    default: TTSAudioMediaType,
) -> TTSAudioMediaType:
    raw_value = environment.get(key)
    if not _qwen3_live_env_has_value(raw_value):
        return default
    assert raw_value is not None
    normalized = raw_value.strip().lower()
    for media_type in TTSAudioMediaType:
        if media_type == normalized:
            return media_type
    raise ValueError(f"unsupported media type for {key}: {raw_value}")
