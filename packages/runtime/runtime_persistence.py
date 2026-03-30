from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Final, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from packages.protocol.events import ProtocolEvent
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot


RUNTIME_SNAPSHOT_FORMAT_VERSION: Final[str] = "echo.runtime.snapshot.v1"
RUNTIME_REPLAY_LOG_FORMAT_VERSION: Final[str] = "echo.runtime.replay_log.v1"
RUNTIME_BUNDLE_FORMAT_VERSION: Final[str] = "echo.runtime.bundle.v1"

DEFAULT_SNAPSHOT_FILENAME: Final[str] = "runtime-snapshot.json"
DEFAULT_REPLAY_LOG_FILENAME: Final[str] = "runtime-replay-log.json"
DEFAULT_BUNDLE_FILENAME: Final[str] = "runtime-bundle.json"

RuntimePersistenceModelT = TypeVar(
    "RuntimePersistenceModelT",
    bound="RuntimePersistenceModel",
)


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _validate_expected_format_version(
    value: str,
    *,
    expected: str,
    artifact_name: str,
) -> str:
    if value != expected:
        raise ValueError(
            f"unsupported {artifact_name} format_version: expected '{expected}', got '{value}'"
        )
    return value


def _validate_filename(value: str, field_name: str) -> str:
    candidate = Path(value)
    if candidate.name != value or value in {".", ".."}:
        raise ValueError(f"{field_name} must be a plain filename, not a path")
    return value


class RuntimePersistenceModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class RuntimePersistenceConfig(RuntimePersistenceModel):
    snapshot_filename: str = DEFAULT_SNAPSHOT_FILENAME
    replay_log_filename: str = DEFAULT_REPLAY_LOG_FILENAME
    bundle_filename: str = DEFAULT_BUNDLE_FILENAME

    @field_validator("snapshot_filename", "replay_log_filename", "bundle_filename")
    @classmethod
    def validate_filename_fields(cls, value: str, info) -> str:
        return _validate_filename(value, info.field_name)

    @model_validator(mode="after")
    def validate_unique_filenames(self) -> "RuntimePersistenceConfig":
        filenames = (
            self.snapshot_filename,
            self.replay_log_filename,
            self.bundle_filename,
        )
        if len(set(filenames)) != len(filenames):
            raise ValueError("runtime persistence filenames must be unique")
        return self


class PersistedRuntimeSnapshotEnvelope(RuntimePersistenceModel):
    format_version: str = RUNTIME_SNAPSHOT_FORMAT_VERSION
    saved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    runtime_snapshot: RuntimeRegistrySnapshot

    @field_validator("saved_at")
    @classmethod
    def ensure_saved_at_is_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "saved_at")

    @field_validator("format_version")
    @classmethod
    def validate_format_version(cls, value: str) -> str:
        return _validate_expected_format_version(
            value,
            expected=RUNTIME_SNAPSHOT_FORMAT_VERSION,
            artifact_name="runtime snapshot envelope",
        )


class PersistedRuntimeReplayEventRecord(RuntimePersistenceModel):
    sequence_index: int = Field(ge=0)
    event: ProtocolEvent


class PersistedRuntimeReplayLog(RuntimePersistenceModel):
    format_version: str = RUNTIME_REPLAY_LOG_FORMAT_VERSION
    event_records: tuple[PersistedRuntimeReplayEventRecord, ...] = ()

    @field_validator("format_version")
    @classmethod
    def validate_format_version(cls, value: str) -> str:
        return _validate_expected_format_version(
            value,
            expected=RUNTIME_REPLAY_LOG_FORMAT_VERSION,
            artifact_name="runtime replay log",
        )

    @model_validator(mode="after")
    def validate_event_record_order(self) -> "PersistedRuntimeReplayLog":
        for expected_index, record in enumerate(self.event_records):
            if record.sequence_index != expected_index:
                raise ValueError(
                    "replay event records must have contiguous zero-based sequence_index order"
                )
        return self


class PersistedRuntimeBundle(RuntimePersistenceModel):
    format_version: str = RUNTIME_BUNDLE_FORMAT_VERSION
    snapshot_envelope: PersistedRuntimeSnapshotEnvelope
    replay_log: PersistedRuntimeReplayLog

    @field_validator("format_version")
    @classmethod
    def validate_format_version(cls, value: str) -> str:
        return _validate_expected_format_version(
            value,
            expected=RUNTIME_BUNDLE_FORMAT_VERSION,
            artifact_name="runtime persistence bundle",
        )


class RuntimePersistenceError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        cause: Exception | None = None,
    ) -> None:
        self.cause = cause
        super().__init__(message)


class RuntimeJsonCodec:
    """Deterministic UTF-8 JSON codec for runtime persistence artifacts."""

    def encode_snapshot_envelope(
        self,
        envelope: PersistedRuntimeSnapshotEnvelope,
    ) -> str:
        return self._encode_model(envelope)

    def decode_snapshot_envelope(
        self,
        payload: str | bytes,
    ) -> PersistedRuntimeSnapshotEnvelope:
        return self._decode_model(
            payload,
            PersistedRuntimeSnapshotEnvelope,
            artifact_name="runtime snapshot envelope",
        )

    def encode_replay_log(
        self,
        replay_log: PersistedRuntimeReplayLog,
    ) -> str:
        return self._encode_model(replay_log)

    def decode_replay_log(
        self,
        payload: str | bytes,
    ) -> PersistedRuntimeReplayLog:
        return self._decode_model(
            payload,
            PersistedRuntimeReplayLog,
            artifact_name="runtime replay log",
        )

    def encode_bundle(
        self,
        bundle: PersistedRuntimeBundle,
    ) -> str:
        return self._encode_model(bundle)

    def decode_bundle(
        self,
        payload: str | bytes,
    ) -> PersistedRuntimeBundle:
        return self._decode_model(
            payload,
            PersistedRuntimeBundle,
            artifact_name="runtime persistence bundle",
        )

    @staticmethod
    def _encode_model(model: RuntimePersistenceModel) -> str:
        payload = model.model_dump(mode="json", round_trip=True)
        return json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    def _decode_model(
        self,
        payload: str | bytes,
        model_type: type[RuntimePersistenceModelT],
        *,
        artifact_name: str,
    ) -> RuntimePersistenceModelT:
        parsed_payload = self._load_json_payload(payload, artifact_name=artifact_name)

        try:
            return model_type.model_validate(parsed_payload)
        except ValidationError as exc:
            raise RuntimePersistenceError(
                f"invalid {artifact_name} payload: {exc}",
                cause=exc,
            ) from exc

    @staticmethod
    def _load_json_payload(
        payload: str | bytes,
        *,
        artifact_name: str,
    ) -> object:
        raw_text: str
        if isinstance(payload, bytes):
            try:
                raw_text = payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise RuntimePersistenceError(
                    f"{artifact_name} must be UTF-8 JSON",
                    cause=exc,
                ) from exc
        elif isinstance(payload, str):
            raw_text = payload
        else:
            raise RuntimePersistenceError(
                f"{artifact_name} payload must be str or bytes, got {type(payload).__name__}"
            )

        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise RuntimePersistenceError(
                f"invalid JSON for {artifact_name}: {exc}",
                cause=exc,
            ) from exc


class LocalFilesystemRuntimeStore:
    """Stdlib-backed local storage shell for persisted runtime artifacts.

    This store intentionally stays narrow:

    - one JSON file per artifact type
    - deterministic filenames from the injected config
    - explicit overwrite and missing-file behavior
    - no locking, watchers, or background sync
    """

    def __init__(
        self,
        *,
        codec: RuntimeJsonCodec | None = None,
        config: RuntimePersistenceConfig | None = None,
    ) -> None:
        self._codec = codec if codec is not None else RuntimeJsonCodec()
        self._config = config if config is not None else RuntimePersistenceConfig()

    def snapshot_path(self, directory: str | Path) -> Path:
        return self._build_artifact_path(directory, self._config.snapshot_filename)

    def replay_log_path(self, directory: str | Path) -> Path:
        return self._build_artifact_path(directory, self._config.replay_log_filename)

    def bundle_path(self, directory: str | Path) -> Path:
        return self._build_artifact_path(directory, self._config.bundle_filename)

    def save_snapshot_envelope(
        self,
        directory: str | Path,
        envelope: PersistedRuntimeSnapshotEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self.save_snapshot_envelope_to_path(
            self.snapshot_path(directory),
            envelope,
            overwrite=overwrite,
        )

    def save_snapshot_envelope_to_path(
        self,
        path: str | Path,
        envelope: PersistedRuntimeSnapshotEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        target_path = Path(path)
        return self._write_artifact(
            target_path,
            self._codec.encode_snapshot_envelope(envelope),
            overwrite=overwrite,
        )

    def load_snapshot_envelope(
        self,
        directory: str | Path,
    ) -> PersistedRuntimeSnapshotEnvelope:
        return self.load_snapshot_envelope_from_path(self.snapshot_path(directory))

    def load_snapshot_envelope_from_path(
        self,
        path: str | Path,
    ) -> PersistedRuntimeSnapshotEnvelope:
        return self._codec.decode_snapshot_envelope(
            self._read_artifact(Path(path))
        )

    def save_replay_log(
        self,
        directory: str | Path,
        replay_log: PersistedRuntimeReplayLog,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self.save_replay_log_to_path(
            self.replay_log_path(directory),
            replay_log,
            overwrite=overwrite,
        )

    def save_replay_log_to_path(
        self,
        path: str | Path,
        replay_log: PersistedRuntimeReplayLog,
        *,
        overwrite: bool = False,
    ) -> Path:
        target_path = Path(path)
        return self._write_artifact(
            target_path,
            self._codec.encode_replay_log(replay_log),
            overwrite=overwrite,
        )

    def load_replay_log(
        self,
        directory: str | Path,
    ) -> PersistedRuntimeReplayLog:
        return self.load_replay_log_from_path(self.replay_log_path(directory))

    def load_replay_log_from_path(
        self,
        path: str | Path,
    ) -> PersistedRuntimeReplayLog:
        return self._codec.decode_replay_log(
            self._read_artifact(Path(path))
        )

    def save_bundle(
        self,
        directory: str | Path,
        bundle: PersistedRuntimeBundle,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self.save_bundle_to_path(
            self.bundle_path(directory),
            bundle,
            overwrite=overwrite,
        )

    def save_bundle_to_path(
        self,
        path: str | Path,
        bundle: PersistedRuntimeBundle,
        *,
        overwrite: bool = False,
    ) -> Path:
        target_path = Path(path)
        return self._write_artifact(
            target_path,
            self._codec.encode_bundle(bundle),
            overwrite=overwrite,
        )

    def load_bundle(
        self,
        directory: str | Path,
    ) -> PersistedRuntimeBundle:
        return self.load_bundle_from_path(self.bundle_path(directory))

    def load_bundle_from_path(
        self,
        path: str | Path,
    ) -> PersistedRuntimeBundle:
        return self._codec.decode_bundle(
            self._read_artifact(Path(path))
        )

    @staticmethod
    def _build_artifact_path(directory: str | Path, filename: str) -> Path:
        return Path(directory) / filename

    @staticmethod
    def _write_artifact(
        path: Path,
        payload: str,
        *,
        overwrite: bool,
    ) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists() and path.is_dir():
            raise RuntimePersistenceError(
                f"cannot write runtime persistence artifact to directory path: {path}"
            )

        if path.exists() and not overwrite:
            raise RuntimePersistenceError(
                f"refusing to overwrite existing runtime persistence artifact: {path}"
            )

        try:
            path.write_text(payload, encoding="utf-8")
        except OSError as exc:
            raise RuntimePersistenceError(
                f"failed to write runtime persistence artifact: {path}",
                cause=exc,
            ) from exc

        return path

    @staticmethod
    def _read_artifact(path: Path) -> str:
        if not path.exists():
            raise RuntimePersistenceError(
                f"runtime persistence artifact not found: {path}"
            )

        if not path.is_file():
            raise RuntimePersistenceError(
                f"runtime persistence artifact path is not a file: {path}"
            )

        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise RuntimePersistenceError(
                f"failed to read runtime persistence artifact: {path}",
                cause=exc,
            ) from exc
