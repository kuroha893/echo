from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Final

from pydantic import BaseModel, ConfigDict, Field, field_validator

from packages.tts.models import TTSVoiceEnrollmentResult


VOICE_CATALOG_FORMAT_VERSION: Final[str] = "echo.voice_catalog.v1"
DEFAULT_VOICE_CATALOG_FILENAME: Final[str] = "desktop-cloned-voices.json"


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


class VoiceCatalogModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class ClonedVoiceEntry(VoiceCatalogModel):
    voice_profile_key: str = Field(min_length=1, max_length=128)
    provider_key: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=128)
    provider_voice_id: str = Field(min_length=1, max_length=256)
    provider_realtime_voice_id: str | None = Field(default=None, min_length=1, max_length=256)
    reference_audio_path: str | None = Field(default=None, min_length=1, max_length=2048)
    prompt_text: str | None = Field(default=None, min_length=1, max_length=4000)
    prompt_language: str | None = Field(default=None, min_length=1, max_length=32)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("created_at")
    @classmethod
    def ensure_created_at_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "created_at")


class VoiceCatalogEnvelope(VoiceCatalogModel):
    format_version: str = VOICE_CATALOG_FORMAT_VERSION
    voices: tuple[ClonedVoiceEntry, ...] = ()

    @field_validator("format_version")
    @classmethod
    def validate_format_version(cls, value: str) -> str:
        if value != VOICE_CATALOG_FORMAT_VERSION:
            raise ValueError(
                "unsupported voice catalog format_version: "
                f"expected '{VOICE_CATALOG_FORMAT_VERSION}', got '{value}'"
            )
        return value


class ClonedVoiceCatalogStore:
    def __init__(
        self,
        *,
        user_data_dir: str | Path,
        file_name: str = DEFAULT_VOICE_CATALOG_FILENAME,
    ) -> None:
        self._user_data_dir = Path(user_data_dir).resolve()
        self._file_name = file_name
        self._voices: dict[str, ClonedVoiceEntry] = {}
        self._loaded = False

    def get_catalog_path(self) -> Path:
        return self._user_data_dir / self._file_name

    def list_voices(self) -> list[ClonedVoiceEntry]:
        self._ensure_loaded()
        entries = list(self._voices.values())
        entries.sort(key=lambda entry: entry.created_at, reverse=True)
        return entries

    def record_enrollment(self, enrollment_result: TTSVoiceEnrollmentResult) -> ClonedVoiceEntry:
        self._ensure_loaded()
        profile = enrollment_result.voice_profile
        entry = ClonedVoiceEntry(
            voice_profile_key=profile.voice_profile_key,
            provider_key=profile.provider_key,
            display_name=profile.display_name,
            provider_voice_id=profile.provider_voice_id,
            provider_realtime_voice_id=profile.provider_realtime_voice_id,
            reference_audio_path=(
                str(profile.reference_audio_path)
                if profile.reference_audio_path is not None
                else None
            ),
            prompt_text=profile.prompt_text,
            prompt_language=profile.prompt_language,
            created_at=datetime.now(timezone.utc),
        )
        self._voices[entry.voice_profile_key] = entry
        self._persist()
        return entry

    def load(self) -> None:
        self._voices.clear()
        path = self.get_catalog_path()
        if path.is_file():
            raw = json.loads(path.read_text(encoding="utf-8"))
            envelope = VoiceCatalogEnvelope.model_validate(raw)
            for entry in envelope.voices:
                self._voices[entry.voice_profile_key] = entry
        self._loaded = True

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def _persist(self) -> None:
        self._user_data_dir.mkdir(parents=True, exist_ok=True)
        entries = self.list_voices()
        envelope = VoiceCatalogEnvelope(voices=tuple(entries))
        path = self.get_catalog_path()
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(envelope.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        shutil.move(str(tmp_path), str(path))


__all__ = [
    "ClonedVoiceCatalogStore",
    "ClonedVoiceEntry",
    "DEFAULT_VOICE_CATALOG_FILENAME",
    "VOICE_CATALOG_FORMAT_VERSION",
    "VoiceCatalogEnvelope",
    "VoiceCatalogModel",
]