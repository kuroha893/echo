from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.protocol.events import TTSChunk


KEY_PATTERN = r"^[a-z0-9][a-z0-9._-]{0,63}$"
LANGUAGE_PATTERN = r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$"


class TTSModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class TTSAudioMediaType(StrEnum):
    WAV = "audio/wav"
    PCM_S16LE = "audio/pcm;encoding=s16le"
    MP3 = "audio/mpeg"
    OGG_OPUS = "audio/ogg;codecs=opus"


class TTSProviderErrorCode(StrEnum):
    VALIDATION_FAILED = "validation_failed"
    CONFIGURATION_ERROR = "configuration_error"
    UNKNOWN_PROVIDER = "unknown_provider"
    UNKNOWN_PROVIDER_PROFILE = "unknown_provider_profile"
    UNKNOWN_VOICE_PROFILE = "unknown_voice_profile"
    DUPLICATE_PROVIDER = "duplicate_provider"
    DUPLICATE_PROVIDER_PROFILE = "duplicate_provider_profile"
    DUPLICATE_VOICE_PROFILE = "duplicate_voice_profile"
    PROVIDER_PROFILE_MISMATCH = "provider_profile_mismatch"
    VOICE_PROFILE_MISMATCH = "voice_profile_mismatch"
    UNSUPPORTED_CAPABILITY = "unsupported_capability"
    AUTHENTICATION_FAILED = "authentication_failed"
    RATE_LIMITED = "rate_limited"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    MALFORMED_RESPONSE = "malformed_response"


class TTSVoiceProfile(TTSModel):
    voice_profile_key: str = Field(pattern=KEY_PATTERN)
    provider_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)
    provider_voice_id: str = Field(min_length=1, max_length=256)
    provider_realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    reference_audio_path: Path | None = None
    aux_reference_audio_paths: tuple[Path, ...] = ()
    prompt_text: str | None = Field(default=None, min_length=1, max_length=4000)
    prompt_language: str | None = Field(default=None, pattern=LANGUAGE_PATTERN, max_length=32)

    @model_validator(mode="after")
    def validate_reference_audio_requirements(self) -> Self:
        if self.aux_reference_audio_paths and self.reference_audio_path is None:
            raise ValueError(
                "aux_reference_audio_paths require reference_audio_path to be set"
            )
        if self.prompt_language is not None and self.prompt_text is None:
            raise ValueError("prompt_language requires prompt_text to be set")
        return self

    @property
    def has_reference_audio_conditioning(self) -> bool:
        return (
            self.reference_audio_path is not None
            or bool(self.aux_reference_audio_paths)
            or self.prompt_text is not None
        )


class TTSSynthesisConfig(TTSModel):
    timeout_ms: int = Field(default=30000, gt=0)
    speed_factor: float = Field(default=1.0, gt=0.0, le=4.0)
    sample_rate_hz: int | None = Field(default=None, gt=0)
    preferred_media_type: TTSAudioMediaType | None = None

    def merged_with(self, override: "TTSSynthesisConfig | None") -> "TTSSynthesisConfig":
        if override is None:
            return self

        update: dict[str, object] = {}
        for field_name in override.model_fields_set:
            update[field_name] = getattr(override, field_name)
        if not update:
            return self
        return self.model_copy(update=update)


class TTSProviderProfile(TTSModel):
    provider_profile_key: str = Field(pattern=KEY_PATTERN)
    provider_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)
    voice_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    synthesis_config: TTSSynthesisConfig = Field(default_factory=TTSSynthesisConfig)
    is_default: bool = False


class TTSVoiceEnrollmentRequest(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)
    reference_audio_path: Path
    realtime_reference_audio_path: Path | None = None
    prompt_text: str | None = Field(default=None, min_length=1, max_length=4000)
    prompt_language: str | None = Field(default=None, pattern=LANGUAGE_PATTERN, max_length=32)
    voice_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)

    @model_validator(mode="after")
    def validate_local_audio_inputs(self) -> Self:
        if not self.reference_audio_path.exists() or not self.reference_audio_path.is_file():
            raise ValueError("reference_audio_path must point to an existing local file")
        if self.realtime_reference_audio_path is not None and (
            not self.realtime_reference_audio_path.exists()
            or not self.realtime_reference_audio_path.is_file()
        ):
            raise ValueError(
                "realtime_reference_audio_path must point to an existing local file"
            )
        if self.prompt_language is not None and self.prompt_text is None:
            raise ValueError("prompt_language requires prompt_text to be set")
        return self


class TTSSynthesisRequest(TTSModel):
    tts_chunk: TTSChunk
    voice_profile: TTSVoiceProfile
    synthesis_config: TTSSynthesisConfig = Field(default_factory=TTSSynthesisConfig)
    provider_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    provider_key_override: str | None = Field(default=None, pattern=KEY_PATTERN)

    @model_validator(mode="after")
    def validate_provider_override(self) -> Self:
        if (
            self.provider_key_override is not None
            and self.provider_key_override != self.voice_profile.provider_key
        ):
            raise ValueError(
                "provider_key_override must match voice_profile.provider_key"
            )
        return self

    @property
    def effective_provider_key(self) -> str:
        return self.provider_key_override or self.voice_profile.provider_key


class TTSAudioFragment(TTSModel):
    fragment_index: int = Field(ge=0)
    audio_bytes: bytes = Field(min_length=1)
    sample_rate_hz: int = Field(gt=0)
    channel_count: int = Field(gt=0, le=8)
    is_final: bool
    media_type: TTSAudioMediaType | None = None


class TTSProviderCapabilities(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    display_name: str = Field(min_length=1, max_length=128)
    supports_fragment_streaming: bool
    supported_media_types: tuple[TTSAudioMediaType, ...] = ()
    supports_reference_audio_conditioning: bool = False
    supports_realtime_voice_id: bool = False
    supports_voice_enrollment_from_local_reference_audio: bool = False
    allowed_voice_profile_keys: tuple[str, ...] = ()

    def allows_voice_profile(self, voice_profile_key: str) -> bool:
        if not self.allowed_voice_profile_keys:
            return True
        return voice_profile_key in self.allowed_voice_profile_keys

    def supports_media_type(self, media_type: TTSAudioMediaType | None) -> bool:
        if media_type is None:
            return True
        if not self.supported_media_types:
            return True
        return media_type in self.supported_media_types


class TTSProviderError(TTSModel):
    error_code: TTSProviderErrorCode
    message: str = Field(min_length=1, max_length=4000)
    retryable: bool
    provider_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    provider_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    voice_profile_key: str | None = Field(default=None, pattern=KEY_PATTERN)
    http_status: int | None = Field(default=None, ge=100, le=599)


class TTSVoiceEnrollmentVerificationMetadata(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    provider_voice_id: str = Field(min_length=1, max_length=256)
    provider_realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    provider_enrollment_id: str | None = Field(default=None, min_length=1, max_length=256)


class TTSVoiceEnrollmentResult(TTSModel):
    voice_profile: TTSVoiceProfile
    verification_metadata: TTSVoiceEnrollmentVerificationMetadata

    @model_validator(mode="after")
    def validate_voice_profile_alignment(self) -> Self:
        if self.voice_profile.provider_key != self.verification_metadata.provider_key:
            raise ValueError("voice_profile.provider_key must match verification_metadata.provider_key")
        if self.voice_profile.provider_voice_id != self.verification_metadata.provider_voice_id:
            raise ValueError("voice_profile.provider_voice_id must match verification_metadata.provider_voice_id")
        if (
            self.voice_profile.provider_realtime_voice_id
            != self.verification_metadata.provider_realtime_voice_id
        ):
            raise ValueError(
                "voice_profile.provider_realtime_voice_id must match verification_metadata.provider_realtime_voice_id"
            )
        return self


class TTSResolvedRequest(TTSModel):
    provider_key: str = Field(pattern=KEY_PATTERN)
    provider_capabilities: TTSProviderCapabilities
    synthesis_request: TTSSynthesisRequest
    provider_profile: TTSProviderProfile | None = None

    @property
    def voice_profile(self) -> TTSVoiceProfile:
        return self.synthesis_request.voice_profile

    @property
    def tts_chunk(self) -> TTSChunk:
        return self.synthesis_request.tts_chunk
