from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Final, TypeVar
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from packages.protocol.events import ProtocolEvent
from packages.runtime.recovery_snapshot import SessionRecoverySnapshot
from packages.runtime.runtime_persistence import (
    LocalFilesystemRuntimeStore,
    PersistedRuntimeBundle,
    PersistedRuntimeReplayLog,
    PersistedRuntimeSnapshotEnvelope,
)
from packages.runtime.runtime_replay import (
    RuntimeReplayResult,
    RuntimeReplayer,
)
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot
from packages.runtime.runtime_supervisor import RuntimeProcessResult, RuntimeSupervisor


DEFAULT_INGRESS_ENVELOPE_FORMAT_VERSION: Final[str] = (
    "echo.runtime.ingress_envelope.v1"
)
DEFAULT_INGRESS_BATCH_FORMAT_VERSION: Final[str] = "echo.runtime.ingress_batch.v1"
DEFAULT_PROCESS_EGRESS_FORMAT_VERSION: Final[str] = (
    "echo.runtime.process_egress.v1"
)
DEFAULT_PROCESS_BATCH_RESULT_FORMAT_VERSION: Final[str] = (
    "echo.runtime.process_batch_result.v1"
)
DEFAULT_REPLAY_EGRESS_FORMAT_VERSION: Final[str] = "echo.runtime.replay_egress.v1"
DEFAULT_RECOVERY_INSPECTION_FORMAT_VERSION: Final[str] = (
    "echo.runtime.recovery_inspection.v1"
)
DEFAULT_INGRESS_SOURCE_LABEL: Final[str] = "runtime.service"

RuntimeServiceModelT = TypeVar(
    "RuntimeServiceModelT",
    bound="RuntimeServiceModel",
)


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _validate_non_empty_text(value: str, field_name: str) -> str:
    if not value.strip():
        raise ValueError(f"{field_name} must not be empty")
    return value


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


class RuntimeServiceModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class RuntimeServiceConfig(RuntimeServiceModel):
    ingress_envelope_format_version: str = DEFAULT_INGRESS_ENVELOPE_FORMAT_VERSION
    ingress_batch_format_version: str = DEFAULT_INGRESS_BATCH_FORMAT_VERSION
    process_egress_format_version: str = DEFAULT_PROCESS_EGRESS_FORMAT_VERSION
    process_batch_result_format_version: str = (
        DEFAULT_PROCESS_BATCH_RESULT_FORMAT_VERSION
    )
    replay_egress_format_version: str = DEFAULT_REPLAY_EGRESS_FORMAT_VERSION
    recovery_inspection_format_version: str = (
        DEFAULT_RECOVERY_INSPECTION_FORMAT_VERSION
    )
    default_ingress_source_label: str = DEFAULT_INGRESS_SOURCE_LABEL

    @field_validator(
        "ingress_envelope_format_version",
        "ingress_batch_format_version",
        "process_egress_format_version",
        "process_batch_result_format_version",
        "replay_egress_format_version",
        "recovery_inspection_format_version",
        "default_ingress_source_label",
    )
    @classmethod
    def validate_text_fields(cls, value: str, info) -> str:
        return _validate_non_empty_text(value, info.field_name)


class RuntimeIngressEnvelope(RuntimeServiceModel):
    format_version: str = DEFAULT_INGRESS_ENVELOPE_FORMAT_VERSION
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source_label: str = Field(
        default=DEFAULT_INGRESS_SOURCE_LABEL,
        min_length=1,
        max_length=256,
    )
    event: ProtocolEvent

    @field_validator("received_at")
    @classmethod
    def normalize_received_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "received_at")

    @field_validator("source_label")
    @classmethod
    def validate_source_label(cls, value: str) -> str:
        return _validate_non_empty_text(value, "source_label")


class RuntimeIngressBatch(RuntimeServiceModel):
    format_version: str = DEFAULT_INGRESS_BATCH_FORMAT_VERSION
    envelopes: tuple[RuntimeIngressEnvelope, ...] = ()


class RuntimeProcessEgressEnvelope(RuntimeServiceModel):
    format_version: str = DEFAULT_PROCESS_EGRESS_FORMAT_VERSION
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    session_id: UUID
    process_result: RuntimeProcessResult

    @field_validator("emitted_at")
    @classmethod
    def normalize_emitted_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "emitted_at")

    @model_validator(mode="after")
    def validate_nested_session_id(self) -> "RuntimeProcessEgressEnvelope":
        if self.process_result.recovery_snapshot.session_id != self.session_id:
            raise ValueError(
                "process egress session_id must match process_result.recovery_snapshot.session_id"
            )
        return self


class RuntimeProcessBatchResult(RuntimeServiceModel):
    format_version: str = DEFAULT_PROCESS_BATCH_RESULT_FORMAT_VERSION
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    total_input_envelope_count: int = Field(ge=0)
    successful_envelope_count: int = Field(ge=0)
    process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...] = ()
    final_runtime_snapshot: RuntimeRegistrySnapshot

    @field_validator("emitted_at")
    @classmethod
    def normalize_emitted_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "emitted_at")

    @model_validator(mode="after")
    def validate_counts(self) -> "RuntimeProcessBatchResult":
        if self.successful_envelope_count != len(self.process_egress_envelopes):
            raise ValueError(
                "successful_envelope_count must match the number of process_egress_envelopes"
            )

        if self.successful_envelope_count > self.total_input_envelope_count:
            raise ValueError(
                "successful_envelope_count cannot exceed total_input_envelope_count"
            )

        return self


class RuntimeReplayEgressEnvelope(RuntimeServiceModel):
    format_version: str = DEFAULT_REPLAY_EGRESS_FORMAT_VERSION
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    replay_result: RuntimeReplayResult

    @field_validator("emitted_at")
    @classmethod
    def normalize_emitted_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "emitted_at")


class RuntimeRecoveryInspectionEnvelope(RuntimeServiceModel):
    format_version: str = DEFAULT_RECOVERY_INSPECTION_FORMAT_VERSION
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    recovery_snapshots: tuple[SessionRecoverySnapshot, ...] = ()

    @field_validator("emitted_at")
    @classmethod
    def normalize_emitted_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "emitted_at")


class RuntimeServiceBatchFailure(RuntimeServiceModel):
    failed_envelope_index: int = Field(ge=0)
    failed_event_id: UUID
    failed_session_id: UUID
    completed_envelope_count: int = Field(ge=0)
    partial_runtime_snapshot: RuntimeRegistrySnapshot
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str


class RuntimeServiceBatchHaltedError(RuntimeError):
    def __init__(self, failure: RuntimeServiceBatchFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: RuntimeServiceBatchFailure) -> str:
        return (
            "runtime service batch halted at envelope index "
            f"{failure.failed_envelope_index} "
            f"({failure.exception_type}: {failure.exception_message})"
        )


class RuntimeServiceJsonCodec:
    """Deterministic UTF-8 JSON codec for runtime service envelopes."""

    def __init__(
        self,
        *,
        config: RuntimeServiceConfig | None = None,
    ) -> None:
        self._config = config if config is not None else RuntimeServiceConfig()

    def get_config(self) -> RuntimeServiceConfig:
        return self._config

    def assert_compatible_ingress_envelope(
        self,
        envelope: RuntimeIngressEnvelope,
    ) -> RuntimeIngressEnvelope:
        _validate_expected_format_version(
            envelope.format_version,
            expected=self._config.ingress_envelope_format_version,
            artifact_name="runtime ingress envelope",
        )
        return envelope

    def assert_compatible_ingress_batch(
        self,
        batch: RuntimeIngressBatch,
    ) -> RuntimeIngressBatch:
        _validate_expected_format_version(
            batch.format_version,
            expected=self._config.ingress_batch_format_version,
            artifact_name="runtime ingress batch",
        )
        for envelope in batch.envelopes:
            self.assert_compatible_ingress_envelope(envelope)
        return batch

    def assert_compatible_process_egress_envelope(
        self,
        envelope: RuntimeProcessEgressEnvelope,
    ) -> RuntimeProcessEgressEnvelope:
        _validate_expected_format_version(
            envelope.format_version,
            expected=self._config.process_egress_format_version,
            artifact_name="runtime process egress envelope",
        )
        return envelope

    def assert_compatible_process_batch_result(
        self,
        result: RuntimeProcessBatchResult,
    ) -> RuntimeProcessBatchResult:
        _validate_expected_format_version(
            result.format_version,
            expected=self._config.process_batch_result_format_version,
            artifact_name="runtime process batch result",
        )
        for envelope in result.process_egress_envelopes:
            self.assert_compatible_process_egress_envelope(envelope)
        return result

    def assert_compatible_replay_egress_envelope(
        self,
        envelope: RuntimeReplayEgressEnvelope,
    ) -> RuntimeReplayEgressEnvelope:
        _validate_expected_format_version(
            envelope.format_version,
            expected=self._config.replay_egress_format_version,
            artifact_name="runtime replay egress envelope",
        )
        return envelope

    def assert_compatible_recovery_inspection_envelope(
        self,
        envelope: RuntimeRecoveryInspectionEnvelope,
    ) -> RuntimeRecoveryInspectionEnvelope:
        _validate_expected_format_version(
            envelope.format_version,
            expected=self._config.recovery_inspection_format_version,
            artifact_name="runtime recovery inspection envelope",
        )
        return envelope

    def encode_ingress_envelope(self, envelope: RuntimeIngressEnvelope) -> str:
        self.assert_compatible_ingress_envelope(envelope)
        return self._encode_model(envelope)

    def decode_ingress_envelope(
        self,
        payload: str | bytes,
    ) -> RuntimeIngressEnvelope:
        envelope = self._decode_model(
            payload,
            RuntimeIngressEnvelope,
            artifact_name="runtime ingress envelope",
        )
        return self.assert_compatible_ingress_envelope(envelope)

    def encode_ingress_batch(self, batch: RuntimeIngressBatch) -> str:
        self.assert_compatible_ingress_batch(batch)
        return self._encode_model(batch)

    def decode_ingress_batch(
        self,
        payload: str | bytes,
    ) -> RuntimeIngressBatch:
        batch = self._decode_model(
            payload,
            RuntimeIngressBatch,
            artifact_name="runtime ingress batch",
        )
        return self.assert_compatible_ingress_batch(batch)

    def encode_process_egress_envelope(
        self,
        envelope: RuntimeProcessEgressEnvelope,
    ) -> str:
        self.assert_compatible_process_egress_envelope(envelope)
        return self._encode_model(envelope)

    def decode_process_egress_envelope(
        self,
        payload: str | bytes,
    ) -> RuntimeProcessEgressEnvelope:
        envelope = self._decode_model(
            payload,
            RuntimeProcessEgressEnvelope,
            artifact_name="runtime process egress envelope",
        )
        return self.assert_compatible_process_egress_envelope(envelope)

    def encode_process_batch_result(
        self,
        result: RuntimeProcessBatchResult,
    ) -> str:
        self.assert_compatible_process_batch_result(result)
        return self._encode_model(result)

    def decode_process_batch_result(
        self,
        payload: str | bytes,
    ) -> RuntimeProcessBatchResult:
        result = self._decode_model(
            payload,
            RuntimeProcessBatchResult,
            artifact_name="runtime process batch result",
        )
        return self.assert_compatible_process_batch_result(result)

    def encode_replay_egress_envelope(
        self,
        envelope: RuntimeReplayEgressEnvelope,
    ) -> str:
        self.assert_compatible_replay_egress_envelope(envelope)
        return self._encode_model(envelope)

    def decode_replay_egress_envelope(
        self,
        payload: str | bytes,
    ) -> RuntimeReplayEgressEnvelope:
        envelope = self._decode_model(
            payload,
            RuntimeReplayEgressEnvelope,
            artifact_name="runtime replay egress envelope",
        )
        return self.assert_compatible_replay_egress_envelope(envelope)

    def encode_recovery_inspection_envelope(
        self,
        envelope: RuntimeRecoveryInspectionEnvelope,
    ) -> str:
        self.assert_compatible_recovery_inspection_envelope(envelope)
        return self._encode_model(envelope)

    def decode_recovery_inspection_envelope(
        self,
        payload: str | bytes,
    ) -> RuntimeRecoveryInspectionEnvelope:
        envelope = self._decode_model(
            payload,
            RuntimeRecoveryInspectionEnvelope,
            artifact_name="runtime recovery inspection envelope",
        )
        return self.assert_compatible_recovery_inspection_envelope(envelope)

    @staticmethod
    def _encode_model(model: RuntimeServiceModel) -> str:
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
        model_type: type[RuntimeServiceModelT],
        *,
        artifact_name: str,
    ) -> RuntimeServiceModelT:
        parsed_payload = self._load_json_payload(payload, artifact_name=artifact_name)

        try:
            return model_type.model_validate(parsed_payload)
        except ValidationError as exc:
            raise ValueError(f"invalid {artifact_name} payload: {exc}") from exc

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
                raise ValueError(f"{artifact_name} must be UTF-8 JSON") from exc
        elif isinstance(payload, str):
            raw_text = payload
        else:
            raise ValueError(
                f"{artifact_name} payload must be str or bytes, got {type(payload).__name__}"
            )

        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON for {artifact_name}: {exc}") from exc


class RuntimeService:
    """Bridge-ready runtime facade above supervisor, replay, and local persistence."""

    def __init__(
        self,
        *,
        supervisor: RuntimeSupervisor | None = None,
        replayer: RuntimeReplayer | None = None,
        store: LocalFilesystemRuntimeStore | None = None,
        codec: RuntimeServiceJsonCodec | None = None,
        config: RuntimeServiceConfig | None = None,
    ) -> None:
        resolved_config = self._resolve_config(config=config, codec=codec)
        resolved_codec = (
            codec if codec is not None else RuntimeServiceJsonCodec(config=resolved_config)
        )
        self._config = resolved_config
        self._codec = resolved_codec
        self._store = store if store is not None else LocalFilesystemRuntimeStore()
        self._supervisor = supervisor if supervisor is not None else RuntimeSupervisor()
        self._replayer = (
            replayer
            if replayer is not None
            else RuntimeReplayer.from_snapshot(self._supervisor.build_snapshot())
        )

    @staticmethod
    def _resolve_config(
        *,
        config: RuntimeServiceConfig | None,
        codec: RuntimeServiceJsonCodec | None,
    ) -> RuntimeServiceConfig:
        if config is None and codec is None:
            return RuntimeServiceConfig()

        if config is None and codec is not None:
            return codec.get_config()

        assert config is not None
        if codec is not None and codec.get_config() != config:
            raise ValueError(
                "runtime service codec config must match the provided runtime service config"
            )
        return config

    def build_ingress_envelope(
        self,
        event: ProtocolEvent,
        *,
        received_at: datetime | None = None,
        source_label: str | None = None,
    ) -> RuntimeIngressEnvelope:
        return RuntimeIngressEnvelope(
            format_version=self._config.ingress_envelope_format_version,
            received_at=received_at
            if received_at is not None
            else datetime.now(timezone.utc),
            source_label=source_label
            if source_label is not None
            else self._config.default_ingress_source_label,
            event=event,
        )

    def build_ingress_batch(
        self,
        envelopes: Iterable[RuntimeIngressEnvelope],
    ) -> RuntimeIngressBatch:
        return RuntimeIngressBatch(
            format_version=self._config.ingress_batch_format_version,
            envelopes=tuple(envelopes),
        )

    def process_envelope(
        self,
        envelope: RuntimeIngressEnvelope,
    ) -> RuntimeProcessEgressEnvelope:
        self._codec.assert_compatible_ingress_envelope(envelope)

        try:
            process_result = self._supervisor.process_event(envelope.event)
        except Exception:
            self._synchronize_replayer_from_supervisor()
            raise

        self._synchronize_replayer_from_supervisor()
        return self._build_process_egress_envelope(process_result)

    def process_batch(
        self,
        batch: RuntimeIngressBatch,
    ) -> RuntimeProcessBatchResult:
        self._codec.assert_compatible_ingress_batch(batch)
        egress_envelopes: list[RuntimeProcessEgressEnvelope] = []

        for envelope_index, envelope in enumerate(batch.envelopes):
            try:
                egress_envelopes.append(self.process_envelope(envelope))
            except Exception as exc:
                failure = self._build_batch_failure(
                    failed_envelope_index=envelope_index,
                    envelope=envelope,
                    completed_envelope_count=len(egress_envelopes),
                    cause=exc,
                )
                raise RuntimeServiceBatchHaltedError(failure) from exc

        return self._build_process_batch_result(
            total_input_envelope_count=len(batch.envelopes),
            process_egress_envelopes=tuple(egress_envelopes),
        )

    def replay_batch(
        self,
        batch: RuntimeIngressBatch,
    ) -> RuntimeReplayEgressEnvelope:
        self._codec.assert_compatible_ingress_batch(batch)
        replay_result = self._replayer.replay_events(
            tuple(envelope.event for envelope in batch.envelopes)
        )
        return self._build_replay_egress_envelope(replay_result)

    def replay_persisted_log(
        self,
        replay_log: PersistedRuntimeReplayLog,
    ) -> RuntimeReplayEgressEnvelope:
        replay_result = self._replayer.replay_persisted_log(replay_log)
        return self._build_replay_egress_envelope(replay_result)

    def replay_persisted_bundle(
        self,
        bundle: PersistedRuntimeBundle,
    ) -> RuntimeReplayEgressEnvelope:
        replay_result = self._replayer.replay_persisted_bundle(bundle)
        return self._build_replay_egress_envelope(replay_result)

    def build_persisted_snapshot(
        self,
        *,
        saved_at: datetime | None = None,
    ) -> PersistedRuntimeSnapshotEnvelope:
        return self._supervisor.build_persisted_snapshot(saved_at=saved_at)

    def save_current_runtime_snapshot(
        self,
        directory: str | Path,
        *,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_snapshot_envelope(
            directory,
            self.build_persisted_snapshot(saved_at=saved_at),
            overwrite=overwrite,
        )

    def save_current_runtime_snapshot_to_path(
        self,
        path: str | Path,
        *,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_snapshot_envelope_to_path(
            path,
            self.build_persisted_snapshot(saved_at=saved_at),
            overwrite=overwrite,
        )

    def load_persisted_snapshot(
        self,
        directory: str | Path,
    ) -> PersistedRuntimeSnapshotEnvelope:
        return self._store.load_snapshot_envelope(directory)

    def load_persisted_snapshot_from_path(
        self,
        path: str | Path,
    ) -> PersistedRuntimeSnapshotEnvelope:
        return self._store.load_snapshot_envelope_from_path(path)

    def build_replay_log(
        self,
        batch: RuntimeIngressBatch,
    ) -> PersistedRuntimeReplayLog:
        self._codec.assert_compatible_ingress_batch(batch)
        return self._replayer.build_replay_log(
            tuple(envelope.event for envelope in batch.envelopes)
        )

    def save_replay_log(
        self,
        directory: str | Path,
        batch: RuntimeIngressBatch,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_replay_log(
            directory,
            self.build_replay_log(batch),
            overwrite=overwrite,
        )

    def save_replay_log_to_path(
        self,
        path: str | Path,
        batch: RuntimeIngressBatch,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_replay_log_to_path(
            path,
            self.build_replay_log(batch),
            overwrite=overwrite,
        )

    def load_replay_log(
        self,
        directory: str | Path,
    ) -> PersistedRuntimeReplayLog:
        return self._store.load_replay_log(directory)

    def load_replay_log_from_path(
        self,
        path: str | Path,
    ) -> PersistedRuntimeReplayLog:
        return self._store.load_replay_log_from_path(path)

    def build_persisted_bundle(
        self,
        batch: RuntimeIngressBatch,
        *,
        snapshot_saved_at: datetime | None = None,
    ) -> PersistedRuntimeBundle:
        self._codec.assert_compatible_ingress_batch(batch)
        return PersistedRuntimeBundle(
            snapshot_envelope=self._supervisor.build_persisted_snapshot(
                saved_at=snapshot_saved_at
            ),
            replay_log=self.build_replay_log(batch),
        )

    def save_persisted_bundle(
        self,
        directory: str | Path,
        batch: RuntimeIngressBatch,
        *,
        snapshot_saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_bundle(
            directory,
            self.build_persisted_bundle(
                batch,
                snapshot_saved_at=snapshot_saved_at,
            ),
            overwrite=overwrite,
        )

    def save_persisted_bundle_to_path(
        self,
        path: str | Path,
        batch: RuntimeIngressBatch,
        *,
        snapshot_saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_bundle_to_path(
            path,
            self.build_persisted_bundle(
                batch,
                snapshot_saved_at=snapshot_saved_at,
            ),
            overwrite=overwrite,
        )

    def load_persisted_bundle(
        self,
        directory: str | Path,
    ) -> PersistedRuntimeBundle:
        return self._store.load_bundle(directory)

    def load_persisted_bundle_from_path(
        self,
        path: str | Path,
    ) -> PersistedRuntimeBundle:
        return self._store.load_bundle_from_path(path)

    @classmethod
    def from_persisted_snapshot(
        cls,
        envelope: PersistedRuntimeSnapshotEnvelope,
        *,
        store: LocalFilesystemRuntimeStore | None = None,
        codec: RuntimeServiceJsonCodec | None = None,
        config: RuntimeServiceConfig | None = None,
    ) -> "RuntimeService":
        return cls(
            supervisor=RuntimeSupervisor.from_persisted_snapshot(envelope),
            replayer=RuntimeReplayer.from_persisted_snapshot(envelope),
            store=store,
            codec=codec,
            config=config,
        )

    @classmethod
    def load_from_snapshot_directory(
        cls,
        directory: str | Path,
        *,
        store: LocalFilesystemRuntimeStore | None = None,
        codec: RuntimeServiceJsonCodec | None = None,
        config: RuntimeServiceConfig | None = None,
    ) -> "RuntimeService":
        resolved_store = store if store is not None else LocalFilesystemRuntimeStore()
        envelope = resolved_store.load_snapshot_envelope(directory)
        return cls.from_persisted_snapshot(
            envelope,
            store=resolved_store,
            codec=codec,
            config=config,
        )

    @classmethod
    def load_from_snapshot_path(
        cls,
        path: str | Path,
        *,
        store: LocalFilesystemRuntimeStore | None = None,
        codec: RuntimeServiceJsonCodec | None = None,
        config: RuntimeServiceConfig | None = None,
    ) -> "RuntimeService":
        resolved_store = store if store is not None else LocalFilesystemRuntimeStore()
        envelope = resolved_store.load_snapshot_envelope_from_path(path)
        return cls.from_persisted_snapshot(
            envelope,
            store=resolved_store,
            codec=codec,
            config=config,
        )

    def get_recovery_snapshot(self, session_id: UUID) -> SessionRecoverySnapshot:
        return self._supervisor.get_recovery_snapshot(session_id)

    def peek_recovery_snapshots(self) -> RuntimeRecoveryInspectionEnvelope:
        return self._build_recovery_inspection_envelope(
            self._supervisor.peek_recovery_snapshots()
        )

    def build_runtime_snapshot(self) -> RuntimeRegistrySnapshot:
        return self._supervisor.build_snapshot()

    def _synchronize_replayer_from_supervisor(self) -> None:
        self._replayer = self._replayer.clone_from_snapshot(
            self._supervisor.build_snapshot()
        )

    def _build_process_egress_envelope(
        self,
        process_result: RuntimeProcessResult,
    ) -> RuntimeProcessEgressEnvelope:
        return RuntimeProcessEgressEnvelope(
            format_version=self._config.process_egress_format_version,
            emitted_at=datetime.now(timezone.utc),
            session_id=process_result.recovery_snapshot.session_id,
            process_result=process_result,
        )

    def _build_process_batch_result(
        self,
        *,
        total_input_envelope_count: int,
        process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...],
    ) -> RuntimeProcessBatchResult:
        result = RuntimeProcessBatchResult(
            format_version=self._config.process_batch_result_format_version,
            emitted_at=datetime.now(timezone.utc),
            total_input_envelope_count=total_input_envelope_count,
            successful_envelope_count=len(process_egress_envelopes),
            process_egress_envelopes=process_egress_envelopes,
            final_runtime_snapshot=self._supervisor.build_snapshot(),
        )
        self._codec.assert_compatible_process_batch_result(result)
        return result

    def _build_replay_egress_envelope(
        self,
        replay_result: RuntimeReplayResult,
    ) -> RuntimeReplayEgressEnvelope:
        envelope = RuntimeReplayEgressEnvelope(
            format_version=self._config.replay_egress_format_version,
            emitted_at=datetime.now(timezone.utc),
            replay_result=replay_result,
        )
        self._codec.assert_compatible_replay_egress_envelope(envelope)
        return envelope

    def _build_recovery_inspection_envelope(
        self,
        recovery_snapshots: tuple[SessionRecoverySnapshot, ...],
    ) -> RuntimeRecoveryInspectionEnvelope:
        envelope = RuntimeRecoveryInspectionEnvelope(
            format_version=self._config.recovery_inspection_format_version,
            emitted_at=datetime.now(timezone.utc),
            recovery_snapshots=recovery_snapshots,
        )
        self._codec.assert_compatible_recovery_inspection_envelope(envelope)
        return envelope

    def _build_batch_failure(
        self,
        *,
        failed_envelope_index: int,
        envelope: RuntimeIngressEnvelope,
        completed_envelope_count: int,
        cause: Exception,
    ) -> RuntimeServiceBatchFailure:
        return RuntimeServiceBatchFailure(
            failed_envelope_index=failed_envelope_index,
            failed_event_id=envelope.event.event_id,
            failed_session_id=envelope.event.session_id,
            completed_envelope_count=completed_envelope_count,
            partial_runtime_snapshot=self._supervisor.build_snapshot(),
            exception_type=type(cause).__name__,
            exception_message=str(cause),
        )
