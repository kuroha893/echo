from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from packages.protocol.events import TTSChunk
from packages.tts.errors import (
    TTSProviderExecutionError,
    TTSRegistryError,
    TTSServiceError,
    raise_service_error,
    wrap_service_exception,
)
from packages.tts.models import (
    TTSAudioFragment,
    TTSProviderErrorCode,
    TTSVoiceEnrollmentRequest,
    TTSVoiceEnrollmentResult,
    TTSSynthesisConfig,
    TTSSynthesisRequest,
)
from packages.tts.provider_ports import validate_fragment_sequence
from packages.tts.registry import (
    ResolvedEnrollmentProviderBinding,
    ResolvedProviderBinding,
    TTSProviderRegistry,
)


class TTSService:
    def __init__(
        self,
        registry: TTSProviderRegistry | None = None,
    ) -> None:
        self._registry = registry or TTSProviderRegistry()

    def get_registry(self) -> TTSProviderRegistry:
        return self._registry

    def build_request(
        self,
        *,
        tts_chunk: TTSChunk,
        voice_profile_key: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
        synthesis_config: TTSSynthesisConfig | None = None,
    ) -> TTSSynthesisRequest:
        return self._registry.build_request(
            tts_chunk=tts_chunk,
            voice_profile_key=voice_profile_key,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
            synthesis_config=synthesis_config,
        )

    async def synthesize(
        self,
        request: TTSSynthesisRequest,
    ) -> AsyncIterator[TTSAudioFragment]:
        binding = self._resolve_request(request)
        async for fragment in self._stream_binding(binding):
            yield fragment

    async def synthesize_chunk(
        self,
        *,
        tts_chunk: TTSChunk,
        voice_profile_key: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
        synthesis_config: TTSSynthesisConfig | None = None,
    ) -> AsyncIterator[TTSAudioFragment]:
        request = self.build_request(
            tts_chunk=tts_chunk,
            voice_profile_key=voice_profile_key,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
            synthesis_config=synthesis_config,
        )
        async for fragment in self.synthesize(request):
            yield fragment

    async def collect_audio_fragments(
        self,
        request: TTSSynthesisRequest,
    ) -> tuple[TTSAudioFragment, ...]:
        fragments: list[TTSAudioFragment] = []
        async for fragment in self.synthesize(request):
            fragments.append(fragment)
        return tuple(fragments)

    async def collect_audio_fragments_for_chunk(
        self,
        *,
        tts_chunk: TTSChunk,
        voice_profile_key: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
        synthesis_config: TTSSynthesisConfig | None = None,
    ) -> tuple[TTSAudioFragment, ...]:
        request = self.build_request(
            tts_chunk=tts_chunk,
            voice_profile_key=voice_profile_key,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
            synthesis_config=synthesis_config,
        )
        return await self.collect_audio_fragments(request)

    async def enroll_voice(
        self,
        request: TTSVoiceEnrollmentRequest,
        *,
        register_voice_profile: bool = True,
    ) -> TTSVoiceEnrollmentResult:
        binding = self._resolve_enrollment_provider(request)
        try:
            result = await binding.provider.enroll_voice(request)
        except (TTSRegistryError, TTSProviderExecutionError, TTSServiceError):
            raise
        except asyncio.CancelledError as exc:
            raise wrap_service_exception(
                exc,
                provider_key=request.provider_key,
            ) from exc
        except Exception as exc:
            raise wrap_service_exception(
                exc,
                provider_key=request.provider_key,
            ) from exc

        if result.voice_profile.provider_key != request.provider_key:
            raise_service_error(
                error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                message="provider returned an enrolled voice profile for the wrong provider key",
                retryable=False,
                provider_key=request.provider_key,
                voice_profile_key=result.voice_profile.voice_profile_key,
            )

        if register_voice_profile:
            self._registry.register_voice_profile(result.voice_profile)
        return result

    def _resolve_request(self, request: TTSSynthesisRequest) -> ResolvedProviderBinding:
        try:
            return self._registry.resolve_request(request)
        except (TTSRegistryError, TTSProviderExecutionError, TTSServiceError):
            raise
        except Exception as exc:  # pragma: no cover - safety net
            raise wrap_service_exception(
                exc,
                provider_key=request.effective_provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            ) from exc

    def _resolve_enrollment_provider(
        self,
        request: TTSVoiceEnrollmentRequest,
    ) -> ResolvedEnrollmentProviderBinding:
        try:
            return self._registry.resolve_enrollment_provider(request)
        except (TTSRegistryError, TTSProviderExecutionError, TTSServiceError):
            raise
        except Exception as exc:  # pragma: no cover - safety net
            raise wrap_service_exception(
                exc,
                provider_key=request.provider_key,
            ) from exc

    async def _stream_binding(
        self,
        binding: ResolvedProviderBinding,
    ) -> AsyncIterator[TTSAudioFragment]:
        provider = binding.provider
        request = binding.synthesis_request
        capabilities = binding.provider_capabilities
        fragments = provider.synthesize(request)
        if not hasattr(fragments, "__aiter__"):
            raise_service_error(
                error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                message="provider synthesize() did not return an async iterator",
                retryable=False,
                provider_key=capabilities.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        expected_index = 0
        saw_final_fragment = False
        saw_any_fragment = False

        try:
            async for fragment in fragments:
                validate_fragment_sequence(
                    fragment=fragment,
                    expected_index=expected_index,
                    saw_final_fragment=saw_final_fragment,
                    capabilities=capabilities,
                    provider_profile_key=request.provider_profile_key,
                    voice_profile_key=request.voice_profile.voice_profile_key,
                )
                saw_any_fragment = True
                expected_index += 1
                saw_final_fragment = fragment.is_final
                yield fragment
        except (TTSRegistryError, TTSProviderExecutionError, TTSServiceError):
            raise
        except asyncio.CancelledError as exc:
            raise wrap_service_exception(
                exc,
                provider_key=capabilities.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            ) from exc
        except Exception as exc:
            raise wrap_service_exception(
                exc,
                provider_key=capabilities.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            ) from exc

        if not saw_any_fragment:
            raise_service_error(
                error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                message="provider returned no audio fragments",
                retryable=False,
                provider_key=capabilities.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        if not saw_final_fragment:
            raise_service_error(
                error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                message="provider did not yield a terminal final fragment",
                retryable=False,
                provider_key=capabilities.provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )
