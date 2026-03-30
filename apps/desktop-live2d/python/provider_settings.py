from __future__ import annotations

import json
from enum import StrEnum
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from packages.llm.openai_compatible_local_provider import OpenAICompatibleLocalAuthMode
from packages.tts.models import TTSAudioMediaType, TTSVoiceEnrollmentResult


_SETTINGS_VERSION = 1
_DEFAULT_SETTINGS_FILE_NAME = "desktop-provider-settings.json"
_DEFAULT_QWEN_TTS_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
_DEFAULT_QWEN_TTS_SYSTEM_MODEL_ID = "qwen3-tts-flash"
_DEFAULT_QWEN_TTS_SYSTEM_VOICE_ID = "Cherry"
_DEFAULT_QWEN_TTS_CLONED_MODEL_ID = "qwen3-tts-vc-2026-01-22"
_LEGACY_QWEN_TTS_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode"
_LEGACY_QWEN_TTS_SYSTEM_MODEL_ID = "qwen-tts-latest"
_LEGACY_QWEN_TTS_SYSTEM_VOICE_ID = "Chelsie"


class DesktopProviderSettingsModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class DesktopSecretUpdateMode(StrEnum):
    KEEP = "keep"
    REPLACE = "replace"
    CLEAR = "clear"


class DesktopMaskedSecretState(DesktopProviderSettingsModel):
    is_configured: bool = False


class DesktopSecretUpdate(DesktopProviderSettingsModel):
    mode: DesktopSecretUpdateMode = DesktopSecretUpdateMode.KEEP
    replacement_text: str | None = Field(default=None, min_length=1, max_length=4096)

    @model_validator(mode="after")
    def validate_secret_update(self) -> Self:
        if self.mode == DesktopSecretUpdateMode.REPLACE and self.replacement_text is None:
            raise ValueError("replacement_text is required when mode='replace'")
        if self.mode != DesktopSecretUpdateMode.REPLACE and self.replacement_text is not None:
            raise ValueError(
                "replacement_text is only allowed when mode='replace'"
            )
        return self

    def apply_to(self, existing_value: str | None) -> str | None:
        if self.mode == DesktopSecretUpdateMode.KEEP:
            return existing_value
        if self.mode == DesktopSecretUpdateMode.CLEAR:
            return None
        return self.replacement_text


class DesktopLocalFastLLMSettings(DesktopProviderSettingsModel):
    base_url: str = Field(default="http://127.0.0.1:30000/v1", min_length=1, max_length=512)
    auth_mode: OpenAICompatibleLocalAuthMode = OpenAICompatibleLocalAuthMode.NONE
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    intent_model_name: str = Field(default="qwen3-4b-instruct", min_length=1, max_length=128)
    quick_model_name: str = Field(default="qwen3-4b-instruct", min_length=1, max_length=128)
    local_primary_model_name: str = Field(
        default="qwen3-8b-instruct",
        min_length=1,
        max_length=128,
    )
    request_timeout_ms: int = Field(default=4_000, ge=1)

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
            raise ValueError("base_url must start with http:// or https://")
        return cleaned.rstrip("/")

    @field_validator("api_key", "intent_model_name", "quick_model_name", "local_primary_model_name")
    @classmethod
    def normalize_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text fields must not be blank when provided")
        return cleaned

    def masked_snapshot(self) -> "DesktopLocalFastLLMSettingsSnapshot":
        return DesktopLocalFastLLMSettingsSnapshot(
            base_url=self.base_url,
            auth_mode=self.auth_mode,
            api_key=DesktopMaskedSecretState(is_configured=self.api_key is not None),
            intent_model_name=self.intent_model_name,
            quick_model_name=self.quick_model_name,
            local_primary_model_name=self.local_primary_model_name,
            request_timeout_ms=self.request_timeout_ms,
        )


class DesktopCloudPrimaryLLMSettings(DesktopProviderSettingsModel):
    base_url: str = Field(default="https://api.openai.com/v1", min_length=1, max_length=512)
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    primary_model_name: str = Field(default="gpt-4.1-mini", min_length=1, max_length=128)
    request_timeout_ms: int = Field(default=30_000, ge=1)
    organization_id: str | None = Field(default=None, min_length=1, max_length=256)
    project_id: str | None = Field(default=None, min_length=1, max_length=256)

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
            raise ValueError("base_url must start with http:// or https://")
        return cleaned.rstrip("/")

    @field_validator("api_key", "primary_model_name", "organization_id", "project_id")
    @classmethod
    def normalize_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text fields must not be blank when provided")
        return cleaned

    def masked_snapshot(self) -> "DesktopCloudPrimaryLLMSettingsSnapshot":
        return DesktopCloudPrimaryLLMSettingsSnapshot(
            base_url=self.base_url,
            api_key=DesktopMaskedSecretState(is_configured=self.api_key is not None),
            primary_model_name=self.primary_model_name,
            request_timeout_ms=self.request_timeout_ms,
            organization_id=self.organization_id,
            project_id=self.project_id,
        )


class DesktopQwenTTSSettings(DesktopProviderSettingsModel):
    base_url: str = Field(
        default=_DEFAULT_QWEN_TTS_BASE_URL,
        min_length=1,
        max_length=512,
    )
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    request_timeout_ms: int = Field(default=30_000, ge=1)
    standard_model_id: str = Field(
        default=_DEFAULT_QWEN_TTS_SYSTEM_MODEL_ID,
        min_length=1,
        max_length=256,
    )
    standard_voice_id: str = Field(
        default=_DEFAULT_QWEN_TTS_SYSTEM_VOICE_ID,
        min_length=1,
        max_length=256,
    )
    realtime_model_id: str | None = Field(default=None, min_length=1, max_length=256)
    realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    preferred_media_type: TTSAudioMediaType = TTSAudioMediaType.PCM_S16LE
    voice_profile_key: str = Field(
        default="desktop.qwen3.current_voice",
        min_length=1,
        max_length=128,
    )
    voice_display_name: str = Field(
        default="Desktop Voice",
        min_length=1,
        max_length=128,
    )
    provider_profile_key: str = Field(
        default="desktop.qwen3.default_profile",
        min_length=1,
        max_length=128,
    )

    @field_validator(
        "base_url",
        "api_key",
        "standard_model_id",
        "standard_voice_id",
        "realtime_model_id",
        "realtime_voice_id",
        "voice_profile_key",
        "voice_display_name",
        "provider_profile_key",
    )
    @classmethod
    def normalize_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text fields must not be blank when provided")
        if cleaned.startswith("http://") or cleaned.startswith("https://"):
            return cleaned.rstrip("/")
        return cleaned

    def masked_snapshot(self) -> "DesktopQwenTTSSettingsSnapshot":
        return DesktopQwenTTSSettingsSnapshot(
            base_url=self.base_url,
            api_key=DesktopMaskedSecretState(is_configured=self.api_key is not None),
            request_timeout_ms=self.request_timeout_ms,
            standard_model_id=self.standard_model_id,
            standard_voice_id=self.standard_voice_id,
            realtime_model_id=self.realtime_model_id,
            realtime_voice_id=self.realtime_voice_id,
            preferred_media_type=self.preferred_media_type,
            voice_profile_key=self.voice_profile_key,
            voice_display_name=self.voice_display_name,
            provider_profile_key=self.provider_profile_key,
        )

    def with_enrolled_voice(
        self,
        enrollment_result: TTSVoiceEnrollmentResult,
    ) -> "DesktopQwenTTSSettings":
        return self.model_copy(
            update={
                "standard_model_id": _DEFAULT_QWEN_TTS_CLONED_MODEL_ID,
                "standard_voice_id": enrollment_result.voice_profile.provider_voice_id,
                "realtime_voice_id": None,
                "voice_profile_key": enrollment_result.voice_profile.voice_profile_key,
                "voice_display_name": enrollment_result.voice_profile.display_name,
            }
        )


class DesktopProviderSettingsDocument(DesktopProviderSettingsModel):
    settings_version: int = Field(default=_SETTINGS_VERSION, ge=1)
    local_fast_llm: DesktopLocalFastLLMSettings | None = None
    cloud_primary_llm: DesktopCloudPrimaryLLMSettings = Field(
        default_factory=DesktopCloudPrimaryLLMSettings
    )
    qwen_tts: DesktopQwenTTSSettings = Field(default_factory=DesktopQwenTTSSettings)
    voice_language: str = Field(default="", max_length=32)
    subtitle_language: str = Field(default="", max_length=32)

    @field_validator("settings_version")
    @classmethod
    def validate_settings_version(cls, value: int) -> int:
        if value != _SETTINGS_VERSION:
            raise ValueError(
                f"unsupported desktop provider settings version '{value}'"
            )
        return value

    def masked_snapshot(self) -> "DesktopProviderSettingsMaskedSnapshot":
        return DesktopProviderSettingsMaskedSnapshot(
            settings_version=self.settings_version,
            local_fast_llm=(
                self.local_fast_llm.masked_snapshot()
                if self.local_fast_llm is not None
                else None
            ),
            cloud_primary_llm=self.cloud_primary_llm.masked_snapshot(),
            qwen_tts=self.qwen_tts.masked_snapshot(),
            voice_language=self.voice_language,
            subtitle_language=self.subtitle_language,
        )

    def with_enrolled_voice(
        self,
        enrollment_result: TTSVoiceEnrollmentResult,
    ) -> "DesktopProviderSettingsDocument":
        return self.model_copy(
            update={"qwen_tts": self.qwen_tts.with_enrolled_voice(enrollment_result)}
        )


class DesktopLocalFastLLMSettingsSnapshot(DesktopProviderSettingsModel):
    base_url: str
    auth_mode: OpenAICompatibleLocalAuthMode
    api_key: DesktopMaskedSecretState
    intent_model_name: str
    quick_model_name: str
    local_primary_model_name: str
    request_timeout_ms: int


class DesktopCloudPrimaryLLMSettingsSnapshot(DesktopProviderSettingsModel):
    base_url: str
    api_key: DesktopMaskedSecretState
    primary_model_name: str
    request_timeout_ms: int
    organization_id: str | None = None
    project_id: str | None = None


class DesktopQwenTTSSettingsSnapshot(DesktopProviderSettingsModel):
    base_url: str
    api_key: DesktopMaskedSecretState
    request_timeout_ms: int
    standard_model_id: str
    standard_voice_id: str
    realtime_model_id: str | None = None
    realtime_voice_id: str | None = None
    preferred_media_type: TTSAudioMediaType
    voice_profile_key: str
    voice_display_name: str
    provider_profile_key: str


class DesktopProviderSettingsMaskedSnapshot(DesktopProviderSettingsModel):
    settings_version: int
    local_fast_llm: DesktopLocalFastLLMSettingsSnapshot | None = None
    cloud_primary_llm: DesktopCloudPrimaryLLMSettingsSnapshot
    qwen_tts: DesktopQwenTTSSettingsSnapshot
    voice_language: str = ""
    subtitle_language: str = ""


class DesktopLocalFastLLMSaveInput(DesktopProviderSettingsModel):
    base_url: str = Field(min_length=1, max_length=512)
    auth_mode: OpenAICompatibleLocalAuthMode
    api_key_update: DesktopSecretUpdate = Field(default_factory=DesktopSecretUpdate)
    intent_model_name: str = Field(min_length=1, max_length=128)
    quick_model_name: str = Field(min_length=1, max_length=128)
    local_primary_model_name: str = Field(min_length=1, max_length=128)
    request_timeout_ms: int = Field(ge=1)

    def apply_to(
        self,
        existing: DesktopLocalFastLLMSettings,
    ) -> DesktopLocalFastLLMSettings:
        return DesktopLocalFastLLMSettings(
            base_url=self.base_url,
            auth_mode=self.auth_mode,
            api_key=self.api_key_update.apply_to(existing.api_key),
            intent_model_name=self.intent_model_name,
            quick_model_name=self.quick_model_name,
            local_primary_model_name=self.local_primary_model_name,
            request_timeout_ms=self.request_timeout_ms,
        )


class DesktopCloudPrimaryLLMSaveInput(DesktopProviderSettingsModel):
    base_url: str = Field(min_length=1, max_length=512)
    api_key_update: DesktopSecretUpdate = Field(default_factory=DesktopSecretUpdate)
    primary_model_name: str = Field(min_length=1, max_length=128)
    request_timeout_ms: int = Field(ge=1)
    organization_id: str | None = Field(default=None, min_length=1, max_length=256)
    project_id: str | None = Field(default=None, min_length=1, max_length=256)

    def apply_to(
        self,
        existing: DesktopCloudPrimaryLLMSettings,
    ) -> DesktopCloudPrimaryLLMSettings:
        return DesktopCloudPrimaryLLMSettings(
            base_url=self.base_url,
            api_key=self.api_key_update.apply_to(existing.api_key),
            primary_model_name=self.primary_model_name,
            request_timeout_ms=self.request_timeout_ms,
            organization_id=self.organization_id,
            project_id=self.project_id,
        )


class DesktopQwenTTSSaveInput(DesktopProviderSettingsModel):
    base_url: str = Field(min_length=1, max_length=512)
    api_key_update: DesktopSecretUpdate = Field(default_factory=DesktopSecretUpdate)
    request_timeout_ms: int = Field(ge=1)
    standard_model_id: str = Field(min_length=1, max_length=256)
    standard_voice_id: str = Field(min_length=1, max_length=256)
    realtime_model_id: str | None = Field(default=None, min_length=1, max_length=256)
    realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    preferred_media_type: TTSAudioMediaType
    voice_profile_key: str = Field(min_length=1, max_length=128)
    voice_display_name: str = Field(min_length=1, max_length=128)
    provider_profile_key: str = Field(min_length=1, max_length=128)

    def apply_to(
        self,
        existing: DesktopQwenTTSSettings,
    ) -> DesktopQwenTTSSettings:
        return DesktopQwenTTSSettings(
            base_url=self.base_url,
            api_key=self.api_key_update.apply_to(existing.api_key),
            request_timeout_ms=self.request_timeout_ms,
            standard_model_id=self.standard_model_id,
            standard_voice_id=self.standard_voice_id,
            realtime_model_id=self.realtime_model_id,
            realtime_voice_id=self.realtime_voice_id,
            preferred_media_type=self.preferred_media_type,
            voice_profile_key=self.voice_profile_key,
            voice_display_name=self.voice_display_name,
            provider_profile_key=self.provider_profile_key,
        )


class DesktopProviderSettingsSaveRequest(DesktopProviderSettingsModel):
    local_fast_llm: DesktopLocalFastLLMSaveInput | None = None
    cloud_primary_llm: DesktopCloudPrimaryLLMSaveInput
    qwen_tts: DesktopQwenTTSSaveInput

    voice_language: str = Field(default="", max_length=32)
    subtitle_language: str = Field(default="", max_length=32)

    def apply_to(
        self,
        existing: DesktopProviderSettingsDocument,
    ) -> DesktopProviderSettingsDocument:
        return DesktopProviderSettingsDocument(
            settings_version=existing.settings_version,
            local_fast_llm=(
                self.local_fast_llm.apply_to(
                    existing.local_fast_llm or DesktopLocalFastLLMSettings()
                )
                if self.local_fast_llm is not None
                else None
            ),
            cloud_primary_llm=self.cloud_primary_llm.apply_to(existing.cloud_primary_llm),
            qwen_tts=self.qwen_tts.apply_to(existing.qwen_tts),
            voice_language=self.voice_language,
            subtitle_language=self.subtitle_language,
        )


class DesktopProviderComponentReadiness(DesktopProviderSettingsModel):
    ready: bool
    message: str = Field(min_length=1, max_length=4000)


class DesktopProviderReadinessSnapshot(DesktopProviderSettingsModel):
    runtime_ready: bool
    runtime_message: str = Field(min_length=1, max_length=4000)
    local_fast_llm: DesktopProviderComponentReadiness
    cloud_primary_llm: DesktopProviderComponentReadiness
    qwen_tts: DesktopProviderComponentReadiness
    voice_enrollment: DesktopProviderComponentReadiness


class DesktopProviderSettingsLoadResult(DesktopProviderSettingsModel):
    settings_path: str = Field(min_length=1)
    settings_snapshot: DesktopProviderSettingsMaskedSnapshot
    readiness: DesktopProviderReadinessSnapshot


class DesktopProviderSettingsSaveResult(DesktopProviderSettingsLoadResult):
    pass


class DesktopProviderSettingsValidationResult(DesktopProviderSettingsLoadResult):
    pass


class DesktopTTSVoiceEnrollmentRequest(DesktopProviderSettingsModel):
    display_name: str = Field(min_length=1, max_length=128)
    reference_audio_path: str = Field(min_length=1, max_length=2048)
    realtime_reference_audio_path: str | None = Field(
        default=None,
        min_length=1,
        max_length=2048,
    )
    prompt_text: str | None = Field(default=None, min_length=1, max_length=4000)
    prompt_language: str | None = Field(default=None, min_length=1, max_length=32)
    replace_active_voice: bool = True
    voice_profile_key: str | None = Field(default=None, min_length=1, max_length=128)


class DesktopTTSVoiceEnrollmentOperationResult(DesktopProviderSettingsModel):
    settings_path: str = Field(min_length=1)
    settings_snapshot: DesktopProviderSettingsMaskedSnapshot
    readiness: DesktopProviderReadinessSnapshot
    enrollment_result: TTSVoiceEnrollmentResult


def build_default_provider_settings_document() -> DesktopProviderSettingsDocument:
    return DesktopProviderSettingsDocument()


class DesktopProviderSettingsStore:
    def __init__(
        self,
        *,
        user_data_dir: str | Path,
        file_name: str = _DEFAULT_SETTINGS_FILE_NAME,
    ) -> None:
        self._user_data_dir = Path(user_data_dir).resolve()
        self._file_name = file_name

    def get_settings_path(self) -> Path:
        return self._user_data_dir / self._file_name

    def load_or_create_document(self) -> DesktopProviderSettingsDocument:
        settings_path = self.get_settings_path()
        if not settings_path.exists():
            document = build_default_provider_settings_document()
            self._write_document(document)
            return document
        return self._read_document()

    def save(
        self,
        request: DesktopProviderSettingsSaveRequest,
    ) -> DesktopProviderSettingsDocument:
        current = self.load_or_create_document()
        updated = request.apply_to(current)
        self._write_document(updated)
        return updated

    def persist_enrolled_voice(
        self,
        enrollment_result: TTSVoiceEnrollmentResult,
    ) -> DesktopProviderSettingsDocument:
        current = self.load_or_create_document()
        updated = current.with_enrolled_voice(enrollment_result)
        self._write_document(updated)
        return updated

    def _read_document(self) -> DesktopProviderSettingsDocument:
        payload = json.loads(self.get_settings_path().read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("desktop provider settings file must contain a JSON object")
        payload = dict(payload)
        payload.pop("selected_mode", None)
        payload = self._migrate_legacy_qwen_tts_payload(payload)
        return DesktopProviderSettingsDocument.model_validate(payload)

    def _migrate_legacy_qwen_tts_payload(self, payload: dict[str, object]) -> dict[str, object]:
        raw_qwen_tts = payload.get("qwen_tts")
        if not isinstance(raw_qwen_tts, dict):
            return payload

        qwen_tts = dict(raw_qwen_tts)
        migrated = False

        if qwen_tts.get("base_url") == _LEGACY_QWEN_TTS_BASE_URL:
            qwen_tts["base_url"] = _DEFAULT_QWEN_TTS_BASE_URL
            migrated = True
        if qwen_tts.get("standard_model_id") == _LEGACY_QWEN_TTS_SYSTEM_MODEL_ID:
            qwen_tts["standard_model_id"] = _DEFAULT_QWEN_TTS_SYSTEM_MODEL_ID
            migrated = True
        if qwen_tts.get("standard_voice_id") == _LEGACY_QWEN_TTS_SYSTEM_VOICE_ID:
            qwen_tts["standard_voice_id"] = _DEFAULT_QWEN_TTS_SYSTEM_VOICE_ID
            migrated = True
        if migrated:
            qwen_tts["realtime_model_id"] = None
            qwen_tts["realtime_voice_id"] = None

        if not migrated:
            return payload

        migrated_payload = dict(payload)
        migrated_payload["qwen_tts"] = qwen_tts
        return migrated_payload

    def _write_document(self, document: DesktopProviderSettingsDocument) -> None:
        settings_path = self.get_settings_path()
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            json.dumps(
                document.model_dump(mode="json"),
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )


__all__ = [
    "DesktopCloudPrimaryLLMSettings",
    "DesktopCloudPrimaryLLMSettingsSnapshot",
    "DesktopCloudPrimaryLLMSaveInput",
    "DesktopLocalFastLLMSettings",
    "DesktopLocalFastLLMSettingsSnapshot",
    "DesktopLocalFastLLMSaveInput",
    "DesktopMaskedSecretState",
    "DesktopProviderComponentReadiness",
    "DesktopProviderReadinessSnapshot",
    "DesktopProviderSettingsDocument",
    "DesktopProviderSettingsLoadResult",
    "DesktopProviderSettingsMaskedSnapshot",
    "DesktopProviderSettingsSaveRequest",
    "DesktopProviderSettingsSaveResult",
    "DesktopProviderSettingsStore",
    "DesktopProviderSettingsValidationResult",
    "DesktopQwenTTSSettings",
    "DesktopQwenTTSSettingsSnapshot",
    "DesktopQwenTTSSaveInput",
    "DesktopSecretUpdate",
    "DesktopSecretUpdateMode",
    "DesktopTTSVoiceEnrollmentOperationResult",
    "DesktopTTSVoiceEnrollmentRequest",
    "build_default_provider_settings_document",
]
