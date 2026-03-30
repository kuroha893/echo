from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from pydantic import Field, model_validator

from packages.tts.errors import (
    TTSProviderExecutionError,
    build_tts_error,
    raise_provider_error,
)
from packages.tts.models import (
    TTSModel,
    TTSAudioFragment,
    TTSAudioMediaType,
    TTSProviderCapabilities,
    TTSProviderError,
    TTSProviderErrorCode,
    TTSSynthesisRequest,
)
from packages.tts.provider_ports import TTSProviderPort


class ScriptedTTSRequestMatch(TTSModel):
    provider_profile_key: str | None = None
    voice_profile_key: str | None = None
    text: str | None = None
    chunk_index: int | None = Field(default=None, ge=0)
    voice_style: str | None = None
    is_interruptible: bool | None = None

    def matches(self, request: TTSSynthesisRequest) -> bool:
        if (
            self.provider_profile_key is not None
            and request.provider_profile_key != self.provider_profile_key
        ):
            return False
        if (
            self.voice_profile_key is not None
            and request.voice_profile.voice_profile_key != self.voice_profile_key
        ):
            return False
        if self.text is not None and request.tts_chunk.text != self.text:
            return False
        if (
            self.chunk_index is not None
            and request.tts_chunk.chunk_index != self.chunk_index
        ):
            return False
        if self.voice_style is not None and request.tts_chunk.voice_style != self.voice_style:
            return False
        if (
            self.is_interruptible is not None
            and request.tts_chunk.is_interruptible != self.is_interruptible
        ):
            return False
        return True


class ScriptedTTSPlan(TTSModel):
    plan_key: str = Field(min_length=1, max_length=128)
    request_match: ScriptedTTSRequestMatch = Field(default_factory=ScriptedTTSRequestMatch)
    fragments: tuple[TTSAudioFragment, ...] = ()
    failure: TTSProviderError | None = None

    @model_validator(mode="after")
    def validate_terminal_shape(self) -> "ScriptedTTSPlan":
        if self.failure is not None and self.fragments:
            raise ValueError("scripted plan cannot contain both fragments and failure")
        if self.failure is None and not self.fragments:
            raise ValueError("scripted plan must contain fragments or failure")
        return self


class ScriptedTTSCallRecord(TTSModel):
    provider_key: str
    request: TTSSynthesisRequest
    matched_plan_key: str | None = None


class ScriptedTTSProviderConfig(TTSModel):
    provider_key: str
    display_name: str = Field(default="Scripted TTS Provider", min_length=1, max_length=128)
    supports_fragment_streaming: bool = True
    supported_media_types: tuple[TTSAudioMediaType, ...] = (
        TTSAudioMediaType.WAV,
        TTSAudioMediaType.PCM_S16LE,
    )
    supports_reference_audio_conditioning: bool = True
    supports_realtime_voice_id: bool = True
    allowed_voice_profile_keys: tuple[str, ...] = ()
    default_sample_rate_hz: int = Field(default=24000, gt=0)
    default_channel_count: int = Field(default=1, gt=0, le=8)
    default_media_type: TTSAudioMediaType = TTSAudioMediaType.WAV
    allow_default_synthesis: bool = True
    yield_control_between_fragments: bool = False

    def build_capabilities(self) -> TTSProviderCapabilities:
        return TTSProviderCapabilities(
            provider_key=self.provider_key,
            display_name=self.display_name,
            supports_fragment_streaming=self.supports_fragment_streaming,
            supported_media_types=self.supported_media_types,
            supports_reference_audio_conditioning=self.supports_reference_audio_conditioning,
            supports_realtime_voice_id=self.supports_realtime_voice_id,
            allowed_voice_profile_keys=self.allowed_voice_profile_keys,
        )


class ScriptedTTSProvider(TTSProviderPort):
    def __init__(
        self,
        *,
        config: ScriptedTTSProviderConfig,
        plans: tuple[ScriptedTTSPlan, ...] = (),
    ) -> None:
        self._config = config
        self._capabilities = config.build_capabilities()
        self._plans = plans
        self._call_records: list[ScriptedTTSCallRecord] = []

    @property
    def provider_key(self) -> str:
        return self._config.provider_key

    def get_capabilities(self) -> TTSProviderCapabilities:
        return self._capabilities

    def get_call_records(self) -> tuple[ScriptedTTSCallRecord, ...]:
        return tuple(self._call_records)

    def clear_call_records(self) -> None:
        self._call_records.clear()

    def synthesize(self, request: TTSSynthesisRequest) -> AsyncIterator[TTSAudioFragment]:
        return self._synthesize(request)

    async def _synthesize(
        self,
        request: TTSSynthesisRequest,
    ) -> AsyncIterator[TTSAudioFragment]:
        if request.effective_provider_key != self.provider_key:
            raise_provider_error(
                error_code=TTSProviderErrorCode.CONFIGURATION_ERROR,
                message="scripted provider received a request for another provider key",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        plan = self._match_plan(request)
        self._call_records.append(
            ScriptedTTSCallRecord(
                provider_key=self.provider_key,
                request=request,
                matched_plan_key=None if plan is None else plan.plan_key,
            )
        )

        try:
            if plan is not None:
                async for fragment in self._run_plan(plan, request):
                    yield fragment
                return

            if not self._config.allow_default_synthesis:
                raise_provider_error(
                    error_code=TTSProviderErrorCode.CONFIGURATION_ERROR,
                    message="scripted provider has no matching plan for the request",
                    retryable=False,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )

            yield self._build_default_fragment(request)
        except asyncio.CancelledError as exc:
            raise TTSProviderExecutionError(
                build_tts_error(
                    error_code=TTSProviderErrorCode.CANCELLED,
                    message="scripted provider synthesis was cancelled",
                    retryable=False,
                    provider_key=self.provider_key,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
            ) from exc

    def _match_plan(self, request: TTSSynthesisRequest) -> ScriptedTTSPlan | None:
        for plan in self._plans:
            if plan.request_match.matches(request):
                return plan
        return None

    async def _run_plan(
        self,
        plan: ScriptedTTSPlan,
        request: TTSSynthesisRequest,
    ) -> AsyncIterator[TTSAudioFragment]:
        if plan.failure is not None:
            raise TTSProviderExecutionError(plan.failure)

        for fragment in plan.fragments:
            if self._config.yield_control_between_fragments:
                await asyncio.sleep(0)
            yield fragment

    def _build_default_fragment(
        self,
        request: TTSSynthesisRequest,
    ) -> TTSAudioFragment:
        media_type = request.synthesis_config.preferred_media_type or self._config.default_media_type
        if media_type not in self._config.supported_media_types:
            raise_provider_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="scripted provider does not support the requested media type",
                retryable=False,
                provider_key=self.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        audio_bytes = self._build_default_audio_bytes(
            text=request.tts_chunk.text,
            media_type=media_type,
            channel_count=self._config.default_channel_count,
        )
        return TTSAudioFragment(
            fragment_index=0,
            audio_bytes=audio_bytes,
            sample_rate_hz=(
                request.synthesis_config.sample_rate_hz
                or self._config.default_sample_rate_hz
            ),
            channel_count=self._config.default_channel_count,
            is_final=True,
            media_type=media_type,
        )

    def _build_default_audio_bytes(
        self,
        *,
        text: str,
        media_type: TTSAudioMediaType,
        channel_count: int,
    ) -> bytes:
        encoded_text = text.encode("utf-8")
        if media_type == TTSAudioMediaType.PCM_S16LE:
            frame_stride = max(1, channel_count) * 2
            if not encoded_text:
                return b"\x00" * frame_stride
            remainder = len(encoded_text) % frame_stride
            if remainder == 0:
                return encoded_text
            return encoded_text + (b"\x00" * (frame_stride - remainder))
        return encoded_text
