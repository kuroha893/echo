from __future__ import annotations

from dataclasses import dataclass

from packages.tts.errors import raise_registry_error
from packages.tts.models import (
    TTSProviderCapabilities,
    TTSProviderErrorCode,
    TTSProviderProfile,
    TTSResolvedRequest,
    TTSVoiceEnrollmentRequest,
    TTSSynthesisConfig,
    TTSSynthesisRequest,
    TTSVoiceProfile,
)
from packages.tts.provider_ports import (
    TTSProviderPort,
    TTSVoiceEnrollmentProviderPort,
    validate_enrollment_request_against_capabilities,
    validate_request_against_capabilities,
)


@dataclass(frozen=True, slots=True)
class ResolvedProviderBinding:
    provider: TTSProviderPort
    resolved_request: TTSResolvedRequest

    @property
    def provider_capabilities(self) -> TTSProviderCapabilities:
        return self.resolved_request.provider_capabilities

    @property
    def synthesis_request(self) -> TTSSynthesisRequest:
        return self.resolved_request.synthesis_request

    @property
    def provider_profile(self) -> TTSProviderProfile | None:
        return self.resolved_request.provider_profile


@dataclass(frozen=True, slots=True)
class ResolvedEnrollmentProviderBinding:
    provider: TTSVoiceEnrollmentProviderPort
    provider_capabilities: TTSProviderCapabilities


class TTSProviderRegistry:
    def __init__(
        self,
        *,
        providers: tuple[TTSProviderPort, ...] = (),
        voice_profiles: tuple[TTSVoiceProfile, ...] = (),
        provider_profiles: tuple[TTSProviderProfile, ...] = (),
    ) -> None:
        self._providers: dict[str, TTSProviderPort] = {}
        self._voice_profiles: dict[str, TTSVoiceProfile] = {}
        self._provider_profiles: dict[str, TTSProviderProfile] = {}

        for provider in providers:
            self.register_provider(provider)
        for voice_profile in voice_profiles:
            self.register_voice_profile(voice_profile)
        for provider_profile in provider_profiles:
            self.register_provider_profile(provider_profile)

    def register_provider(self, provider: TTSProviderPort) -> None:
        provider_key = provider.provider_key
        if provider_key in self._providers:
            raise_registry_error(
                error_code=TTSProviderErrorCode.DUPLICATE_PROVIDER,
                message=f"provider '{provider_key}' is already registered",
                provider_key=provider_key,
            )
        self._providers[provider_key] = provider

    def register_voice_profile(self, voice_profile: TTSVoiceProfile) -> None:
        key = voice_profile.voice_profile_key
        if key in self._voice_profiles:
            raise_registry_error(
                error_code=TTSProviderErrorCode.DUPLICATE_VOICE_PROFILE,
                message=f"voice profile '{key}' is already registered",
                provider_key=voice_profile.provider_key,
                voice_profile_key=key,
            )
        self._voice_profiles[key] = voice_profile

    def register_provider_profile(self, provider_profile: TTSProviderProfile) -> None:
        key = provider_profile.provider_profile_key
        if key in self._provider_profiles:
            raise_registry_error(
                error_code=TTSProviderErrorCode.DUPLICATE_PROVIDER_PROFILE,
                message=f"provider profile '{key}' is already registered",
                provider_key=provider_profile.provider_key,
                provider_profile_key=key,
            )
        self._provider_profiles[key] = provider_profile

    def get_provider(self, provider_key: str) -> TTSProviderPort:
        provider = self._providers.get(provider_key)
        if provider is None:
            raise_registry_error(
                error_code=TTSProviderErrorCode.UNKNOWN_PROVIDER,
                message=f"provider '{provider_key}' is not registered",
                provider_key=provider_key,
            )
        return provider

    def get_voice_profile(self, voice_profile_key: str) -> TTSVoiceProfile:
        voice_profile = self._voice_profiles.get(voice_profile_key)
        if voice_profile is None:
            raise_registry_error(
                error_code=TTSProviderErrorCode.UNKNOWN_VOICE_PROFILE,
                message=f"voice profile '{voice_profile_key}' is not registered",
                voice_profile_key=voice_profile_key,
            )
        return voice_profile

    def get_provider_profile(self, provider_profile_key: str) -> TTSProviderProfile:
        provider_profile = self._provider_profiles.get(provider_profile_key)
        if provider_profile is None:
            raise_registry_error(
                error_code=TTSProviderErrorCode.UNKNOWN_PROVIDER_PROFILE,
                message=f"provider profile '{provider_profile_key}' is not registered",
                provider_profile_key=provider_profile_key,
            )
        return provider_profile

    def list_provider_keys(self) -> tuple[str, ...]:
        return tuple(sorted(self._providers))

    def list_voice_profile_keys(self) -> tuple[str, ...]:
        return tuple(sorted(self._voice_profiles))

    def list_provider_profile_keys(self) -> tuple[str, ...]:
        return tuple(sorted(self._provider_profiles))

    def get_default_provider_profile_key(self, provider_key: str) -> str | None:
        defaults = [
            profile.provider_profile_key
            for profile in self._provider_profiles.values()
            if profile.provider_key == provider_key and profile.is_default
        ]
        if len(defaults) > 1:
            raise_registry_error(
                error_code=TTSProviderErrorCode.CONFIGURATION_ERROR,
                message=f"provider '{provider_key}' has multiple default provider profiles",
                provider_key=provider_key,
            )
        if not defaults:
            return None
        return defaults[0]

    def build_request(
        self,
        *,
        tts_chunk,
        voice_profile_key: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
        synthesis_config: TTSSynthesisConfig | None = None,
    ) -> TTSSynthesisRequest:
        provider_profile = None
        if provider_profile_key is not None:
            provider_profile = self.get_provider_profile(provider_profile_key)

        resolved_voice_profile_key = voice_profile_key
        if resolved_voice_profile_key is None and provider_profile is not None:
            resolved_voice_profile_key = provider_profile.voice_profile_key

        if resolved_voice_profile_key is None:
            raise_registry_error(
                error_code=TTSProviderErrorCode.VALIDATION_FAILED,
                message="voice_profile_key is required when provider profile does not bind a voice profile",
                provider_profile_key=provider_profile_key,
            )

        voice_profile = self.get_voice_profile(resolved_voice_profile_key)
        request = TTSSynthesisRequest(
            tts_chunk=tts_chunk,
            voice_profile=voice_profile,
            synthesis_config=synthesis_config or TTSSynthesisConfig(),
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )
        return self.resolve_request(request).synthesis_request

    def resolve_request(self, request: TTSSynthesisRequest) -> ResolvedProviderBinding:
        provider_profile = None
        if request.provider_profile_key is not None:
            provider_profile = self.get_provider_profile(request.provider_profile_key)

        provider_key = request.effective_provider_key
        if provider_profile is not None and provider_profile.provider_key != provider_key:
            raise_registry_error(
                error_code=TTSProviderErrorCode.PROVIDER_PROFILE_MISMATCH,
                message="provider profile does not belong to the resolved provider",
                provider_key=provider_key,
                provider_profile_key=provider_profile.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        if request.voice_profile.provider_key != provider_key:
            raise_registry_error(
                error_code=TTSProviderErrorCode.VOICE_PROFILE_MISMATCH,
                message="voice profile does not belong to the resolved provider",
                provider_key=provider_key,
                provider_profile_key=request.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        if (
            provider_profile is not None
            and provider_profile.voice_profile_key is not None
            and provider_profile.voice_profile_key != request.voice_profile.voice_profile_key
        ):
            raise_registry_error(
                error_code=TTSProviderErrorCode.VOICE_PROFILE_MISMATCH,
                message="provider profile is bound to a different voice profile",
                provider_key=provider_key,
                provider_profile_key=provider_profile.provider_profile_key,
                voice_profile_key=request.voice_profile.voice_profile_key,
            )

        provider = self.get_provider(provider_key)
        capabilities = provider.get_capabilities()

        effective_config = request.synthesis_config
        if provider_profile is not None:
            effective_config = provider_profile.synthesis_config.merged_with(
                request.synthesis_config
            )

        resolved_request = request.model_copy(update={"synthesis_config": effective_config})
        validate_request_against_capabilities(
            capabilities=capabilities,
            request=resolved_request,
        )

        return ResolvedProviderBinding(
            provider=provider,
            resolved_request=TTSResolvedRequest(
                provider_key=provider_key,
                provider_capabilities=capabilities,
                synthesis_request=resolved_request,
                provider_profile=provider_profile,
            ),
        )

    def resolve_enrollment_provider(
        self,
        request: TTSVoiceEnrollmentRequest,
    ) -> ResolvedEnrollmentProviderBinding:
        provider = self.get_provider(request.provider_key)
        capabilities = provider.get_capabilities()
        validate_enrollment_request_against_capabilities(
            capabilities=capabilities,
            request=request,
        )
        if not isinstance(provider, TTSVoiceEnrollmentProviderPort):
            raise_registry_error(
                error_code=TTSProviderErrorCode.UNSUPPORTED_CAPABILITY,
                message="resolved provider does not implement the voice-enrollment seam",
                provider_key=request.provider_key,
            )
        return ResolvedEnrollmentProviderBinding(
            provider=provider,
            provider_capabilities=capabilities,
        )
