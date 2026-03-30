from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from packages.tts.errors import raise_provider_error
from packages.tts.models import (
    TTSAudioFragment,
    TTSAudioMediaType,
    TTSProviderCapabilities,
    TTSProviderErrorCode,
    TTSVoiceEnrollmentRequest,
    TTSVoiceEnrollmentResult,
    TTSSynthesisRequest,
    TTSVoiceProfile,
)


@runtime_checkable
class TTSProviderPort(Protocol):
    @property
    def provider_key(self) -> str: ...

    def get_capabilities(self) -> TTSProviderCapabilities: ...

    def synthesize(self, request: TTSSynthesisRequest) -> AsyncIterator[TTSAudioFragment]: ...


@runtime_checkable
class TTSVoiceEnrollmentProviderPort(Protocol):
    @property
    def provider_key(self) -> str: ...

    def get_capabilities(self) -> TTSProviderCapabilities: ...

    async def enroll_voice(
        self,
        request: TTSVoiceEnrollmentRequest,
    ) -> TTSVoiceEnrollmentResult: ...


def ensure_capabilities_match_provider_key(
    capabilities: TTSProviderCapabilities,
    provider_key: str,
) -> None:
    if capabilities.provider_key != provider_key:
        raise_provider_error(
            error_code=TTSProviderErrorCode.CONFIGURATION_ERROR,
            message=(
                "provider capabilities provider_key does not match registered provider"
            ),
            retryable=False,
            provider_key=provider_key,
        )


def ensure_media_type_supported(
    *,
    capabilities: TTSProviderCapabilities,
    media_type: TTSAudioMediaType | None,
    provider_profile_key: str | None,
    voice_profile_key: str | None,
) -> None:
    if capabilities.supports_media_type(media_type):
        return
    raise_provider_error(
        error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
        message="provider does not support the requested media type",
        retryable=False,
        provider_key=capabilities.provider_key,
        provider_profile_key=provider_profile_key,
        voice_profile_key=voice_profile_key,
    )


def ensure_voice_profile_allowed(
    *,
    capabilities: TTSProviderCapabilities,
    voice_profile: TTSVoiceProfile,
    provider_profile_key: str | None,
) -> None:
    if not capabilities.allows_voice_profile(voice_profile.voice_profile_key):
        raise_provider_error(
            error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
            message="provider is not allowed to serve the requested voice profile",
            retryable=False,
            provider_key=capabilities.provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile.voice_profile_key,
        )

    if (
        voice_profile.has_reference_audio_conditioning
        and not capabilities.supports_reference_audio_conditioning
    ):
        raise_provider_error(
            error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
            message="provider does not support reference-audio conditioning",
            retryable=False,
            provider_key=capabilities.provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile.voice_profile_key,
        )

    if (
        voice_profile.provider_realtime_voice_id is not None
        and not capabilities.supports_realtime_voice_id
    ):
        raise_provider_error(
            error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
            message="provider does not support realtime voice ids",
            retryable=False,
            provider_key=capabilities.provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile.voice_profile_key,
        )


def validate_request_against_capabilities(
    *,
    capabilities: TTSProviderCapabilities,
    request: TTSSynthesisRequest,
) -> None:
    ensure_capabilities_match_provider_key(capabilities, request.effective_provider_key)
    ensure_voice_profile_allowed(
        capabilities=capabilities,
        voice_profile=request.voice_profile,
        provider_profile_key=request.provider_profile_key,
    )
    ensure_media_type_supported(
        capabilities=capabilities,
        media_type=request.synthesis_config.preferred_media_type,
        provider_profile_key=request.provider_profile_key,
        voice_profile_key=request.voice_profile.voice_profile_key,
    )


def validate_enrollment_request_against_capabilities(
    *,
    capabilities: TTSProviderCapabilities,
    request: TTSVoiceEnrollmentRequest,
) -> None:
    ensure_capabilities_match_provider_key(capabilities, request.provider_key)
    if not capabilities.supports_voice_enrollment_from_local_reference_audio:
        raise_provider_error(
            error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
            message="provider does not support local reference-audio voice enrollment",
            retryable=False,
            provider_key=capabilities.provider_key,
        )


def validate_fragment_sequence(
    *,
    fragment: TTSAudioFragment,
    expected_index: int,
    saw_final_fragment: bool,
    capabilities: TTSProviderCapabilities,
    provider_profile_key: str | None,
    voice_profile_key: str | None,
) -> None:
    if saw_final_fragment:
        raise_provider_error(
            error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
            message="provider yielded fragments after the final fragment",
            retryable=False,
            provider_key=capabilities.provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )

    if fragment.fragment_index != expected_index:
        raise_provider_error(
            error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
            message="provider yielded a non-contiguous fragment_index sequence",
            retryable=False,
            provider_key=capabilities.provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )

    if not capabilities.supports_fragment_streaming:
        if fragment.fragment_index > 0:
            raise_provider_error(
                error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                message="non-streaming provider yielded more than one fragment",
                retryable=False,
                provider_key=capabilities.provider_key,
                provider_profile_key=provider_profile_key,
                voice_profile_key=voice_profile_key,
            )
        if not fragment.is_final:
            raise_provider_error(
                error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
                message="non-streaming provider must yield one terminal final fragment",
                retryable=False,
                provider_key=capabilities.provider_key,
                provider_profile_key=provider_profile_key,
                voice_profile_key=voice_profile_key,
            )

    if not capabilities.supports_media_type(fragment.media_type):
        raise_provider_error(
            error_code=TTSProviderErrorCode.MALFORMED_RESPONSE,
            message="provider yielded an unsupported fragment media type",
            retryable=False,
            provider_key=capabilities.provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
