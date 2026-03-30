from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Final, TypeVar, cast

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from packages.protocol.events import BaseEvent, ProtocolEvent
from packages.runtime.orchestrator_bridge import (
    OrchestratorRuntimeBridgeSessionFailure,
    OrchestratorRuntimeBridgeSessionResult,
    TurnContext,
)
from packages.runtime.runtime_bridge import RuntimeBridgeRunner
from packages.runtime.runtime_service import RuntimeIngressBatch
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot


DEFAULT_SUCCESS_ARTIFACT_FORMAT_VERSION: Final[str] = (
    "echo.runtime.orchestrator_bridge_session_success.v1"
)
DEFAULT_FAILURE_ARTIFACT_FORMAT_VERSION: Final[str] = (
    "echo.runtime.orchestrator_bridge_session_failure.v1"
)
DEFAULT_SUCCESS_ARTIFACT_FILENAME: Final[str] = (
    "orchestrator-bridge-session-success.json"
)
DEFAULT_FAILURE_ARTIFACT_FILENAME: Final[str] = (
    "orchestrator-bridge-session-failure.json"
)
DEFAULT_REPLAY_SOURCE_LABEL: Final[str] = "bridge.artifact.replay"

OrchestratorBridgeArtifactModelT = TypeVar(
    "OrchestratorBridgeArtifactModelT",
    bound="OrchestratorBridgeArtifactModel",
)


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _validate_non_empty_text(value: str, field_name: str) -> str:
    if not value.strip():
        raise ValueError(f"{field_name} must not be empty")
    return value


def _validate_plain_filename(value: str, field_name: str) -> str:
    _validate_non_empty_text(value, field_name)
    candidate = Path(value)
    if candidate.name != value or value in {".", ".."}:
        raise ValueError(f"{field_name} must be a plain filename, not a path")
    return value


def _cast_protocol_event(event: BaseEvent) -> ProtocolEvent:
    return cast(ProtocolEvent, event)


def _cast_protocol_events(
    events: tuple[BaseEvent, ...] | list[BaseEvent],
) -> tuple[ProtocolEvent, ...]:
    return tuple(_cast_protocol_event(event) for event in events)


def _base_event_identity_slice(events: tuple[BaseEvent, ...]) -> tuple[str, ...]:
    return tuple(str(event.event_id) for event in events)


def _protocol_event_identity_slice(events: tuple[ProtocolEvent, ...]) -> tuple[str, ...]:
    return tuple(str(event.event_id) for event in events)


def _validate_event_identity_alignment(
    *,
    typed_events: tuple[ProtocolEvent, ...],
    base_events: tuple[BaseEvent, ...],
    field_name: str,
) -> None:
    typed_ids = _protocol_event_identity_slice(typed_events)
    base_ids = _base_event_identity_slice(base_events)
    if typed_ids != base_ids:
        raise ValueError(
            f"{field_name} must preserve exact event_id order from the nested bridge-session surface"
        )


class OrchestratorBridgeArtifactModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class OrchestratorBridgeArtifactKind(str, Enum):
    SUCCESS = "success"
    FAILURE = "failure"


class OrchestratorBridgeReplaySliceKind(str, Enum):
    FULL_COLLECTED = "full_collected"
    DRAINED_PREFIX = "drained_prefix"
    UNDRAINED_TAIL = "undrained_tail"


class OrchestratorBridgeArtifactConfig(OrchestratorBridgeArtifactModel):
    success_artifact_format_version: str = DEFAULT_SUCCESS_ARTIFACT_FORMAT_VERSION
    failure_artifact_format_version: str = DEFAULT_FAILURE_ARTIFACT_FORMAT_VERSION
    default_success_artifact_filename: str = DEFAULT_SUCCESS_ARTIFACT_FILENAME
    default_failure_artifact_filename: str = DEFAULT_FAILURE_ARTIFACT_FILENAME
    default_replay_source_label: str = DEFAULT_REPLAY_SOURCE_LABEL

    @field_validator(
        "success_artifact_format_version",
        "failure_artifact_format_version",
        "default_replay_source_label",
    )
    @classmethod
    def validate_text_fields(cls, value: str, info) -> str:
        return _validate_non_empty_text(value, info.field_name)

    @field_validator(
        "default_success_artifact_filename",
        "default_failure_artifact_filename",
    )
    @classmethod
    def validate_filename_fields(cls, value: str, info) -> str:
        return _validate_plain_filename(value, info.field_name)

    @model_validator(mode="after")
    def validate_distinct_versions_and_filenames(
        self,
    ) -> "OrchestratorBridgeArtifactConfig":
        if self.success_artifact_format_version == self.failure_artifact_format_version:
            raise ValueError(
                "success and failure bridge-artifact format versions must remain distinct"
            )

        if (
            self.default_success_artifact_filename
            == self.default_failure_artifact_filename
        ):
            raise ValueError(
                "success and failure bridge-artifact filenames must remain distinct"
            )

        return self


class _PersistedOrchestratorBridgeEnvelopeBase(OrchestratorBridgeArtifactModel):
    format_version: str
    saved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("format_version")
    @classmethod
    def validate_format_version_text(cls, value: str) -> str:
        return _validate_non_empty_text(value, "format_version")

    @field_validator("saved_at")
    @classmethod
    def normalize_saved_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "saved_at")


class PersistedOrchestratorBridgeSessionSuccessEnvelope(
    _PersistedOrchestratorBridgeEnvelopeBase
):
    session_result: OrchestratorRuntimeBridgeSessionResult
    collected_protocol_events: tuple[ProtocolEvent, ...] = ()

    @property
    def artifact_kind(self) -> OrchestratorBridgeArtifactKind:
        return OrchestratorBridgeArtifactKind.SUCCESS

    @property
    def turn_context(self) -> TurnContext:
        return self.session_result.turn_context

    @property
    def runtime_snapshot(self) -> RuntimeRegistrySnapshot:
        return self.session_result.final_runtime_snapshot

    @property
    def collected_event_count(self) -> int:
        return len(self.collected_protocol_events)

    @property
    def drained_event_count(self) -> int:
        return len(self.collected_protocol_events)

    @property
    def undrained_event_count(self) -> int:
        return 0

    @property
    def replayable_full_collected_events(self) -> tuple[ProtocolEvent, ...]:
        return self.collected_protocol_events

    @model_validator(mode="after")
    def validate_event_alignment(
        self,
    ) -> "PersistedOrchestratorBridgeSessionSuccessEnvelope":
        _validate_event_identity_alignment(
            typed_events=self.collected_protocol_events,
            base_events=self.session_result.collected_protocol_events,
            field_name="collected_protocol_events",
        )
        return self


class PersistedOrchestratorBridgeSessionFailureEnvelope(
    _PersistedOrchestratorBridgeEnvelopeBase
):
    session_failure: OrchestratorRuntimeBridgeSessionFailure
    collected_protocol_events: tuple[ProtocolEvent, ...] = ()
    drained_protocol_events: tuple[ProtocolEvent, ...] = ()
    undrained_protocol_events: tuple[ProtocolEvent, ...] = ()

    @property
    def artifact_kind(self) -> OrchestratorBridgeArtifactKind:
        return OrchestratorBridgeArtifactKind.FAILURE

    @property
    def turn_context(self) -> TurnContext:
        return self.session_failure.turn_context

    @property
    def runtime_snapshot(self) -> RuntimeRegistrySnapshot | None:
        return self.session_failure.partial_runtime_snapshot

    @property
    def collected_event_count(self) -> int:
        return len(self.collected_protocol_events)

    @property
    def drained_event_count(self) -> int:
        return len(self.drained_protocol_events)

    @property
    def undrained_event_count(self) -> int:
        return len(self.undrained_protocol_events)

    @property
    def replayable_full_collected_events(self) -> tuple[ProtocolEvent, ...]:
        return self.collected_protocol_events

    @property
    def replayable_drained_prefix_events(self) -> tuple[ProtocolEvent, ...]:
        return self.drained_protocol_events

    @property
    def replayable_undrained_tail_events(self) -> tuple[ProtocolEvent, ...]:
        return self.undrained_protocol_events

    @model_validator(mode="after")
    def validate_event_alignment(
        self,
    ) -> "PersistedOrchestratorBridgeSessionFailureEnvelope":
        _validate_event_identity_alignment(
            typed_events=self.collected_protocol_events,
            base_events=self.session_failure.collected_protocol_events,
            field_name="collected_protocol_events",
        )
        _validate_event_identity_alignment(
            typed_events=self.drained_protocol_events,
            base_events=self.session_failure.drained_protocol_events,
            field_name="drained_protocol_events",
        )
        _validate_event_identity_alignment(
            typed_events=self.undrained_protocol_events,
            base_events=self.session_failure.undrained_protocol_events,
            field_name="undrained_protocol_events",
        )

        expected_partition = (
            self.drained_protocol_events + self.undrained_protocol_events
        )
        if expected_partition != self.collected_protocol_events:
            raise ValueError(
                "drained_protocol_events plus undrained_protocol_events must preserve collected_protocol_events order exactly"
            )

        return self


class OrchestratorBridgeReplaySelection(OrchestratorBridgeArtifactModel):
    source_artifact_kind: OrchestratorBridgeArtifactKind
    slice_kind: OrchestratorBridgeReplaySliceKind
    selected_event_count: int = Field(ge=0)


class OrchestratorBridgeReplayMaterial(OrchestratorBridgeArtifactModel):
    source_artifact_kind: OrchestratorBridgeArtifactKind
    replay_selection: OrchestratorBridgeReplaySelection
    selected_protocol_events: tuple[ProtocolEvent, ...] = ()
    replay_ready_ingress_batch: RuntimeIngressBatch
    source_turn_context: TurnContext
    source_runtime_snapshot: RuntimeRegistrySnapshot | None = None
    source_artifact_format_version: str
    source_artifact_saved_at: datetime

    @field_validator("source_artifact_format_version")
    @classmethod
    def validate_source_artifact_format_version(cls, value: str) -> str:
        return _validate_non_empty_text(value, "source_artifact_format_version")

    @field_validator("source_artifact_saved_at")
    @classmethod
    def normalize_source_artifact_saved_at(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "source_artifact_saved_at")

    @model_validator(mode="after")
    def validate_selection_alignment(self) -> "OrchestratorBridgeReplayMaterial":
        if self.source_artifact_kind != self.replay_selection.source_artifact_kind:
            raise ValueError(
                "replay material source_artifact_kind must match replay_selection.source_artifact_kind"
            )

        if self.replay_selection.selected_event_count != len(
            self.selected_protocol_events
        ):
            raise ValueError(
                "replay material selected_protocol_events length must match replay_selection.selected_event_count"
            )

        batch_events = tuple(
            envelope.event for envelope in self.replay_ready_ingress_batch.envelopes
        )
        if batch_events != self.selected_protocol_events:
            raise ValueError(
                "replay_ready_ingress_batch envelopes must preserve selected_protocol_events order exactly"
            )

        return self


class OrchestratorBridgeArtifactError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        cause: Exception | None = None,
    ) -> None:
        self.cause = cause
        super().__init__(message)


class OrchestratorBridgeArtifactJsonCodec:
    """Deterministic UTF-8 JSON codec for persisted bridge-session artifacts."""

    def __init__(
        self,
        *,
        config: OrchestratorBridgeArtifactConfig | None = None,
    ) -> None:
        self._config = (
            config if config is not None else OrchestratorBridgeArtifactConfig()
        )

    def get_config(self) -> OrchestratorBridgeArtifactConfig:
        return self._config

    def assert_compatible_success_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        if envelope.format_version != self._config.success_artifact_format_version:
            raise OrchestratorBridgeArtifactError(
                "unsupported persisted orchestrator bridge success format_version: "
                f"expected '{self._config.success_artifact_format_version}', "
                f"got '{envelope.format_version}'"
            )
        return envelope

    def assert_compatible_failure_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        if envelope.format_version != self._config.failure_artifact_format_version:
            raise OrchestratorBridgeArtifactError(
                "unsupported persisted orchestrator bridge failure format_version: "
                f"expected '{self._config.failure_artifact_format_version}', "
                f"got '{envelope.format_version}'"
            )
        return envelope

    def encode_success_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
    ) -> str:
        self.assert_compatible_success_envelope(envelope)
        return self._encode_model(envelope)

    def decode_success_envelope(
        self,
        payload: str | bytes,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        envelope = self._decode_model(
            payload,
            PersistedOrchestratorBridgeSessionSuccessEnvelope,
            artifact_name="persisted orchestrator bridge success envelope",
        )
        return self.assert_compatible_success_envelope(envelope)

    def encode_failure_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
    ) -> str:
        self.assert_compatible_failure_envelope(envelope)
        return self._encode_model(envelope)

    def decode_failure_envelope(
        self,
        payload: str | bytes,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        envelope = self._decode_model(
            payload,
            PersistedOrchestratorBridgeSessionFailureEnvelope,
            artifact_name="persisted orchestrator bridge failure envelope",
        )
        return self.assert_compatible_failure_envelope(envelope)

    @staticmethod
    def _encode_model(model: OrchestratorBridgeArtifactModel) -> str:
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
        model_type: type[OrchestratorBridgeArtifactModelT],
        *,
        artifact_name: str,
    ) -> OrchestratorBridgeArtifactModelT:
        parsed_payload = self._load_json_payload(payload, artifact_name=artifact_name)

        try:
            return model_type.model_validate(parsed_payload)
        except ValidationError as exc:
            raise OrchestratorBridgeArtifactError(
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
                raise OrchestratorBridgeArtifactError(
                    f"{artifact_name} must be UTF-8 JSON",
                    cause=exc,
                ) from exc
        elif isinstance(payload, str):
            raw_text = payload
        else:
            raise OrchestratorBridgeArtifactError(
                f"{artifact_name} payload must be str or bytes, got {type(payload).__name__}"
            )

        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise OrchestratorBridgeArtifactError(
                f"invalid JSON for {artifact_name}: {exc}",
                cause=exc,
            ) from exc


class LocalFilesystemOrchestratorBridgeArtifactStore:
    """Stdlib-backed local artifact store for persisted bridge-session artifacts.

    The store is intentionally narrow:

    - one success artifact JSON file
    - one failure artifact JSON file
    - deterministic filenames from the injected config
    - explicit overwrite semantics
    - explicit missing-file semantics
    """

    def __init__(
        self,
        *,
        codec: OrchestratorBridgeArtifactJsonCodec | None = None,
        config: OrchestratorBridgeArtifactConfig | None = None,
    ) -> None:
        resolved_config = (
            config if config is not None else OrchestratorBridgeArtifactConfig()
        )
        resolved_codec = (
            codec
            if codec is not None
            else OrchestratorBridgeArtifactJsonCodec(config=resolved_config)
        )

        if resolved_codec.get_config() != resolved_config:
            raise ValueError(
                "bridge artifact store codec config must match the provided bridge artifact config"
            )

        self._codec = resolved_codec
        self._config = resolved_config

    def get_config(self) -> OrchestratorBridgeArtifactConfig:
        return self._config

    def get_codec(self) -> OrchestratorBridgeArtifactJsonCodec:
        return self._codec

    def success_artifact_path(self, directory: str | Path) -> Path:
        return self._build_artifact_path(
            directory,
            self._config.default_success_artifact_filename,
        )

    def failure_artifact_path(self, directory: str | Path) -> Path:
        return self._build_artifact_path(
            directory,
            self._config.default_failure_artifact_filename,
        )

    def save_success_envelope(
        self,
        directory: str | Path,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self.save_success_envelope_to_path(
            self.success_artifact_path(directory),
            envelope,
            overwrite=overwrite,
        )

    def save_success_envelope_to_path(
        self,
        path: str | Path,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        target_path = Path(path)
        payload = self._codec.encode_success_envelope(envelope)
        return self._write_artifact(target_path, payload, overwrite=overwrite)

    def load_success_envelope(
        self,
        directory: str | Path,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self.load_success_envelope_from_path(self.success_artifact_path(directory))

    def load_success_envelope_from_path(
        self,
        path: str | Path,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self._codec.decode_success_envelope(self._read_artifact(Path(path)))

    def save_failure_envelope(
        self,
        directory: str | Path,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self.save_failure_envelope_to_path(
            self.failure_artifact_path(directory),
            envelope,
            overwrite=overwrite,
        )

    def save_failure_envelope_to_path(
        self,
        path: str | Path,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        target_path = Path(path)
        payload = self._codec.encode_failure_envelope(envelope)
        return self._write_artifact(target_path, payload, overwrite=overwrite)

    def load_failure_envelope(
        self,
        directory: str | Path,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self.load_failure_envelope_from_path(self.failure_artifact_path(directory))

    def load_failure_envelope_from_path(
        self,
        path: str | Path,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self._codec.decode_failure_envelope(self._read_artifact(Path(path)))

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
            raise OrchestratorBridgeArtifactError(
                f"cannot write bridge artifact to directory path: {path}"
            )

        if path.exists() and not overwrite:
            raise OrchestratorBridgeArtifactError(
                f"refusing to overwrite existing bridge artifact: {path}"
            )

        try:
            path.write_text(payload, encoding="utf-8")
        except OSError as exc:
            raise OrchestratorBridgeArtifactError(
                f"failed to write bridge artifact: {path}",
                cause=exc,
            ) from exc

        return path

    @staticmethod
    def _read_artifact(path: Path) -> str:
        if not path.exists():
            raise OrchestratorBridgeArtifactError(
                f"bridge artifact not found: {path}"
            )

        if not path.is_file():
            raise OrchestratorBridgeArtifactError(
                f"bridge artifact path is not a file: {path}"
            )

        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise OrchestratorBridgeArtifactError(
                f"failed to read bridge artifact: {path}",
                cause=exc,
            ) from exc


class OrchestratorBridgeArtifactManager:
    """Facade above persisted bridge-session artifacts and replay-material views.

    This manager composes four narrow responsibilities:

    - package live bridge-session results/failures into persisted envelopes
    - delegate deterministic JSON save/load through the local store
    - derive explicit replay selections from persisted success/failure artifacts
    - build replay-ready ingress batches only through RuntimeBridgeRunner

    It intentionally does not redesign the runtime bridge runner, replay shell,
    or turn-active orchestrator bridge session.
    """

    def __init__(
        self,
        *,
        runtime_bridge_runner: RuntimeBridgeRunner,
        codec: OrchestratorBridgeArtifactJsonCodec | None = None,
        store: LocalFilesystemOrchestratorBridgeArtifactStore | None = None,
        config: OrchestratorBridgeArtifactConfig | None = None,
    ) -> None:
        resolved_config = self._resolve_config(
            config=config,
            codec=codec,
            store=store,
        )
        resolved_codec = (
            codec
            if codec is not None
            else OrchestratorBridgeArtifactJsonCodec(config=resolved_config)
        )
        resolved_store = (
            store
            if store is not None
            else LocalFilesystemOrchestratorBridgeArtifactStore(
                codec=resolved_codec,
                config=resolved_config,
            )
        )

        if resolved_codec.get_config() != resolved_config:
            raise ValueError(
                "bridge artifact codec config must match the provided bridge artifact config"
            )
        if resolved_store.get_config() != resolved_config:
            raise ValueError(
                "bridge artifact store config must match the provided bridge artifact config"
            )

        self._runtime_bridge_runner = runtime_bridge_runner
        self._codec = resolved_codec
        self._store = resolved_store
        self._config = resolved_config

    @staticmethod
    def _resolve_config(
        *,
        config: OrchestratorBridgeArtifactConfig | None,
        codec: OrchestratorBridgeArtifactJsonCodec | None,
        store: LocalFilesystemOrchestratorBridgeArtifactStore | None,
    ) -> OrchestratorBridgeArtifactConfig:
        if config is not None:
            if codec is not None and codec.get_config() != config:
                raise ValueError(
                    "bridge artifact codec config must match the provided bridge artifact config"
                )
            if store is not None and store.get_config() != config:
                raise ValueError(
                    "bridge artifact store config must match the provided bridge artifact config"
                )
            return config

        if codec is not None:
            if store is not None and store.get_config() != codec.get_config():
                raise ValueError(
                    "bridge artifact codec config must match the provided bridge artifact store config"
                )
            return codec.get_config()

        if store is not None:
            return store.get_config()

        return OrchestratorBridgeArtifactConfig()

    def get_config(self) -> OrchestratorBridgeArtifactConfig:
        return self._config

    def get_runtime_bridge_runner(self) -> RuntimeBridgeRunner:
        return self._runtime_bridge_runner

    def get_codec(self) -> OrchestratorBridgeArtifactJsonCodec:
        return self._codec

    def get_store(self) -> LocalFilesystemOrchestratorBridgeArtifactStore:
        return self._store

    def success_artifact_path(self, directory: str | Path) -> Path:
        return self._store.success_artifact_path(directory)

    def failure_artifact_path(self, directory: str | Path) -> Path:
        return self._store.failure_artifact_path(directory)

    def build_success_envelope(
        self,
        session_result: OrchestratorRuntimeBridgeSessionResult,
        *,
        saved_at: datetime | None = None,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return PersistedOrchestratorBridgeSessionSuccessEnvelope(
            format_version=self._config.success_artifact_format_version,
            saved_at=self._resolve_saved_at(saved_at),
            session_result=session_result,
            collected_protocol_events=_cast_protocol_events(
                session_result.collected_protocol_events
            ),
        )

    def build_failure_envelope(
        self,
        session_failure: OrchestratorRuntimeBridgeSessionFailure,
        *,
        saved_at: datetime | None = None,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return PersistedOrchestratorBridgeSessionFailureEnvelope(
            format_version=self._config.failure_artifact_format_version,
            saved_at=self._resolve_saved_at(saved_at),
            session_failure=session_failure,
            collected_protocol_events=_cast_protocol_events(
                session_failure.collected_protocol_events
            ),
            drained_protocol_events=_cast_protocol_events(
                session_failure.drained_protocol_events
            ),
            undrained_protocol_events=_cast_protocol_events(
                session_failure.undrained_protocol_events
            ),
        )

    def encode_success_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
    ) -> str:
        return self._codec.encode_success_envelope(envelope)

    def decode_success_envelope(
        self,
        payload: str | bytes,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self._codec.decode_success_envelope(payload)

    def encode_failure_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
    ) -> str:
        return self._codec.encode_failure_envelope(envelope)

    def decode_failure_envelope(
        self,
        payload: str | bytes,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self._codec.decode_failure_envelope(payload)

    def save_success_envelope(
        self,
        directory: str | Path,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_success_envelope(
            directory,
            envelope,
            overwrite=overwrite,
        )

    def save_success_envelope_to_path(
        self,
        path: str | Path,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_success_envelope_to_path(
            path,
            envelope,
            overwrite=overwrite,
        )

    def save_success_result(
        self,
        directory: str | Path,
        session_result: OrchestratorRuntimeBridgeSessionResult,
        *,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self.save_success_envelope(
            directory,
            self.build_success_envelope(
                session_result,
                saved_at=saved_at,
            ),
            overwrite=overwrite,
        )

    def save_success_result_to_path(
        self,
        path: str | Path,
        session_result: OrchestratorRuntimeBridgeSessionResult,
        *,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self.save_success_envelope_to_path(
            path,
            self.build_success_envelope(
                session_result,
                saved_at=saved_at,
            ),
            overwrite=overwrite,
        )

    def load_success_envelope(
        self,
        directory: str | Path,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self._store.load_success_envelope(directory)

    def load_success_envelope_from_path(
        self,
        path: str | Path,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self._store.load_success_envelope_from_path(path)

    def save_failure_envelope(
        self,
        directory: str | Path,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_failure_envelope(
            directory,
            envelope,
            overwrite=overwrite,
        )

    def save_failure_envelope_to_path(
        self,
        path: str | Path,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        overwrite: bool = False,
    ) -> Path:
        return self._store.save_failure_envelope_to_path(
            path,
            envelope,
            overwrite=overwrite,
        )

    def save_failure_result(
        self,
        directory: str | Path,
        session_failure: OrchestratorRuntimeBridgeSessionFailure,
        *,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self.save_failure_envelope(
            directory,
            self.build_failure_envelope(
                session_failure,
                saved_at=saved_at,
            ),
            overwrite=overwrite,
        )

    def save_failure_result_to_path(
        self,
        path: str | Path,
        session_failure: OrchestratorRuntimeBridgeSessionFailure,
        *,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> Path:
        return self.save_failure_envelope_to_path(
            path,
            self.build_failure_envelope(
                session_failure,
                saved_at=saved_at,
            ),
            overwrite=overwrite,
        )

    def load_failure_envelope(
        self,
        directory: str | Path,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self._store.load_failure_envelope(directory)

    def load_failure_envelope_from_path(
        self,
        path: str | Path,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self._store.load_failure_envelope_from_path(path)

    def build_success_replay_selection(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind = OrchestratorBridgeReplaySliceKind.FULL_COLLECTED,
    ) -> OrchestratorBridgeReplaySelection:
        if slice_kind is not OrchestratorBridgeReplaySliceKind.FULL_COLLECTED:
            raise OrchestratorBridgeArtifactError(
                "success bridge artifacts support replay selection only for 'full_collected'"
            )

        return OrchestratorBridgeReplaySelection(
            source_artifact_kind=OrchestratorBridgeArtifactKind.SUCCESS,
            slice_kind=slice_kind,
            selected_event_count=envelope.collected_event_count,
        )

    def build_failure_replay_selection(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
    ) -> OrchestratorBridgeReplaySelection:
        selected_events = self._select_failure_protocol_events(
            envelope,
            slice_kind=slice_kind,
        )
        return OrchestratorBridgeReplaySelection(
            source_artifact_kind=OrchestratorBridgeArtifactKind.FAILURE,
            slice_kind=slice_kind,
            selected_event_count=len(selected_events),
        )

    def derive_replay_material_from_success_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind = OrchestratorBridgeReplaySliceKind.FULL_COLLECTED,
        source_label: str | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        selection = self.build_success_replay_selection(
            envelope,
            slice_kind=slice_kind,
        )
        selected_events = self._select_success_protocol_events(
            envelope,
            slice_kind=slice_kind,
        )
        return self._build_replay_material(
            source_artifact_kind=OrchestratorBridgeArtifactKind.SUCCESS,
            selection=selection,
            selected_events=selected_events,
            source_turn_context=envelope.turn_context,
            source_runtime_snapshot=envelope.runtime_snapshot,
            source_artifact_format_version=envelope.format_version,
            source_artifact_saved_at=envelope.saved_at,
            source_label=source_label,
        )

    def derive_replay_material_from_failure_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
        source_label: str | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        selection = self.build_failure_replay_selection(
            envelope,
            slice_kind=slice_kind,
        )
        selected_events = self._select_failure_protocol_events(
            envelope,
            slice_kind=slice_kind,
        )
        return self._build_replay_material(
            source_artifact_kind=OrchestratorBridgeArtifactKind.FAILURE,
            selection=selection,
            selected_events=selected_events,
            source_turn_context=envelope.turn_context,
            source_runtime_snapshot=envelope.runtime_snapshot,
            source_artifact_format_version=envelope.format_version,
            source_artifact_saved_at=envelope.saved_at,
            source_label=source_label,
        )

    def derive_replay_material_from_saved_success_artifact(
        self,
        directory: str | Path,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind = OrchestratorBridgeReplaySliceKind.FULL_COLLECTED,
        source_label: str | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        return self.derive_replay_material_from_success_envelope(
            self.load_success_envelope(directory),
            slice_kind=slice_kind,
            source_label=source_label,
        )

    def derive_replay_material_from_saved_success_artifact_path(
        self,
        path: str | Path,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind = OrchestratorBridgeReplaySliceKind.FULL_COLLECTED,
        source_label: str | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        return self.derive_replay_material_from_success_envelope(
            self.load_success_envelope_from_path(path),
            slice_kind=slice_kind,
            source_label=source_label,
        )

    def derive_replay_material_from_saved_failure_artifact(
        self,
        directory: str | Path,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
        source_label: str | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        return self.derive_replay_material_from_failure_envelope(
            self.load_failure_envelope(directory),
            slice_kind=slice_kind,
            source_label=source_label,
        )

    def derive_replay_material_from_saved_failure_artifact_path(
        self,
        path: str | Path,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
        source_label: str | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        return self.derive_replay_material_from_failure_envelope(
            self.load_failure_envelope_from_path(path),
            slice_kind=slice_kind,
            source_label=source_label,
        )

    def _select_success_protocol_events(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
    ) -> tuple[ProtocolEvent, ...]:
        if slice_kind is not OrchestratorBridgeReplaySliceKind.FULL_COLLECTED:
            raise OrchestratorBridgeArtifactError(
                "success bridge artifacts support replay selection only for 'full_collected'"
            )
        return envelope.replayable_full_collected_events

    def _select_failure_protocol_events(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
    ) -> tuple[ProtocolEvent, ...]:
        if slice_kind is OrchestratorBridgeReplaySliceKind.FULL_COLLECTED:
            return envelope.replayable_full_collected_events
        if slice_kind is OrchestratorBridgeReplaySliceKind.DRAINED_PREFIX:
            return envelope.replayable_drained_prefix_events
        if slice_kind is OrchestratorBridgeReplaySliceKind.UNDRAINED_TAIL:
            return envelope.replayable_undrained_tail_events

        raise OrchestratorBridgeArtifactError(
            f"unsupported failure bridge replay slice kind: {slice_kind.value}"
        )

    def _build_replay_material(
        self,
        *,
        source_artifact_kind: OrchestratorBridgeArtifactKind,
        selection: OrchestratorBridgeReplaySelection,
        selected_events: tuple[ProtocolEvent, ...],
        source_turn_context: TurnContext,
        source_runtime_snapshot: RuntimeRegistrySnapshot | None,
        source_artifact_format_version: str,
        source_artifact_saved_at: datetime,
        source_label: str | None,
    ) -> OrchestratorBridgeReplayMaterial:
        self._assert_non_empty_replay_selection(
            selected_events,
            source_artifact_kind=source_artifact_kind,
            slice_kind=selection.slice_kind,
        )
        replay_ready_ingress_batch = self._build_replay_ingress_batch(
            selected_events,
            source_label=source_label,
        )
        return OrchestratorBridgeReplayMaterial(
            source_artifact_kind=source_artifact_kind,
            replay_selection=selection,
            selected_protocol_events=selected_events,
            replay_ready_ingress_batch=replay_ready_ingress_batch,
            source_turn_context=source_turn_context,
            source_runtime_snapshot=source_runtime_snapshot,
            source_artifact_format_version=source_artifact_format_version,
            source_artifact_saved_at=source_artifact_saved_at,
        )

    def _build_replay_ingress_batch(
        self,
        selected_events: tuple[ProtocolEvent, ...],
        *,
        source_label: str | None,
    ) -> RuntimeIngressBatch:
        resolved_source_label = self._resolve_replay_source_label(source_label)
        return self._runtime_bridge_runner.build_ingress_batch_from_events(
            selected_events,
            source_label=resolved_source_label,
        )

    def _resolve_replay_source_label(self, source_label: str | None) -> str:
        if source_label is None:
            return self._config.default_replay_source_label
        return _validate_non_empty_text(source_label, "source_label")

    @staticmethod
    def _assert_non_empty_replay_selection(
        selected_events: tuple[ProtocolEvent, ...],
        *,
        source_artifact_kind: OrchestratorBridgeArtifactKind,
        slice_kind: OrchestratorBridgeReplaySliceKind,
    ) -> None:
        if selected_events:
            return

        raise OrchestratorBridgeArtifactError(
            "cannot derive replay material from an empty selected event slice "
            f"({source_artifact_kind.value}/{slice_kind.value})"
        )

    @staticmethod
    def _resolve_saved_at(saved_at: datetime | None) -> datetime:
        if saved_at is None:
            return datetime.now(timezone.utc)
        return _normalize_utc_datetime(saved_at, "saved_at")


__all__ = [
    "DEFAULT_FAILURE_ARTIFACT_FILENAME",
    "DEFAULT_FAILURE_ARTIFACT_FORMAT_VERSION",
    "DEFAULT_REPLAY_SOURCE_LABEL",
    "DEFAULT_SUCCESS_ARTIFACT_FILENAME",
    "DEFAULT_SUCCESS_ARTIFACT_FORMAT_VERSION",
    "LocalFilesystemOrchestratorBridgeArtifactStore",
    "OrchestratorBridgeArtifactConfig",
    "OrchestratorBridgeArtifactError",
    "OrchestratorBridgeArtifactJsonCodec",
    "OrchestratorBridgeArtifactKind",
    "OrchestratorBridgeArtifactManager",
    "OrchestratorBridgeReplayMaterial",
    "OrchestratorBridgeReplaySelection",
    "OrchestratorBridgeReplaySliceKind",
    "PersistedOrchestratorBridgeSessionFailureEnvelope",
    "PersistedOrchestratorBridgeSessionSuccessEnvelope",
]
