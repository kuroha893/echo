from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.protocol.events import ProtocolEvent
from packages.runtime.runtime_persistence import (
    PersistedRuntimeBundle,
    PersistedRuntimeReplayLog,
)
from packages.runtime.runtime_replay import RuntimeReplayFailure, RuntimeReplayHaltedError
from packages.runtime.runtime_service import (
    RuntimeIngressBatch,
    RuntimeIngressEnvelope,
    RuntimeProcessBatchResult,
    RuntimeProcessEgressEnvelope,
    RuntimeRecoveryInspectionEnvelope,
    RuntimeReplayEgressEnvelope,
    RuntimeService,
    RuntimeServiceBatchFailure,
    RuntimeServiceBatchHaltedError,
)
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot

RuntimeBridgePath = Literal[
    "run_single_envelope",
    "run_batch",
    "run_next_batch",
    "run_replay_batch",
    "run_replay_log",
    "run_replay_bundle",
]
RuntimeReplaySourceKind = Literal[
    "ingress_batch",
    "persisted_replay_log",
    "persisted_replay_bundle",
]


class RuntimeBridgeModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class RuntimeBridgePersistencePolicy(RuntimeBridgeModel):
    persist_ingress_replay_log_before_live: bool = False
    persist_ingress_replay_bundle_before_live: bool = False
    persist_ingress_replay_log_before_replay_batch: bool = False
    persist_ingress_replay_bundle_before_replay_batch: bool = False
    persist_final_snapshot_after_live: bool = False
    persist_final_snapshot_after_replay: bool = False


class RuntimeBridgeConfig(RuntimeBridgeModel):
    emit_recovery_after_live: bool = False
    emit_recovery_after_replay: bool = False
    default_persistence_policy: RuntimeBridgePersistencePolicy = Field(
        default_factory=RuntimeBridgePersistencePolicy
    )


class RuntimeBridgeArtifactPaths(RuntimeBridgeModel):
    saved_replay_log_path: Path | None = None
    saved_replay_bundle_path: Path | None = None
    saved_final_snapshot_path: Path | None = None


class RuntimeBridgeReplaySource(RuntimeBridgeModel):
    source_kind: RuntimeReplaySourceKind
    ingress_batch: RuntimeIngressBatch | None = None
    replay_log: PersistedRuntimeReplayLog | None = None
    replay_bundle: PersistedRuntimeBundle | None = None
    source_path: Path | None = None

    @model_validator(mode="after")
    def validate_source_shape(self) -> "RuntimeBridgeReplaySource":
        active_payload_count = sum(
            value is not None
            for value in (
                self.ingress_batch,
                self.replay_log,
                self.replay_bundle,
            )
        )
        if active_payload_count != 1:
            raise ValueError(
                "runtime bridge replay source must carry exactly one typed replay payload"
            )

        if self.source_kind == "ingress_batch" and self.ingress_batch is None:
            raise ValueError(
                "ingress_batch replay source_kind requires ingress_batch payload"
            )
        if self.source_kind == "persisted_replay_log" and self.replay_log is None:
            raise ValueError(
                "persisted_replay_log source_kind requires replay_log payload"
            )
        if (
            self.source_kind == "persisted_replay_bundle"
            and self.replay_bundle is None
        ):
            raise ValueError(
                "persisted_replay_bundle source_kind requires replay_bundle payload"
            )

        return self


@runtime_checkable
class RuntimeIngressSourcePort(Protocol):
    def pull_ingress_envelope(self) -> RuntimeIngressEnvelope | None: ...

    def pull_ingress_batch(self) -> RuntimeIngressBatch | None: ...


@runtime_checkable
class RuntimeEgressSinkPort(Protocol):
    def emit_process_egress_envelope(
        self,
        envelope: RuntimeProcessEgressEnvelope,
    ) -> None: ...

    def emit_process_batch_result(
        self,
        result: RuntimeProcessBatchResult,
    ) -> None: ...

    def emit_replay_egress_envelope(
        self,
        envelope: RuntimeReplayEgressEnvelope,
    ) -> None: ...

    def emit_recovery_inspection_envelope(
        self,
        envelope: RuntimeRecoveryInspectionEnvelope,
    ) -> None: ...


class RuntimeBridgeLiveResult(RuntimeBridgeModel):
    consumed_ingress_batch: RuntimeIngressBatch
    process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...]
    process_batch_result: RuntimeProcessBatchResult
    recovery_inspection_envelope: RuntimeRecoveryInspectionEnvelope | None = None
    artifact_paths: RuntimeBridgeArtifactPaths = Field(
        default_factory=RuntimeBridgeArtifactPaths
    )

    @model_validator(mode="after")
    def validate_ordered_egress(self) -> "RuntimeBridgeLiveResult":
        if self.process_egress_envelopes != self.process_batch_result.process_egress_envelopes:
            raise ValueError(
                "runtime bridge live result process_egress_envelopes must match process_batch_result order exactly"
            )
        return self


class RuntimeBridgeReplayResult(RuntimeBridgeModel):
    replay_source: RuntimeBridgeReplaySource
    replay_egress_envelope: RuntimeReplayEgressEnvelope
    recovery_inspection_envelope: RuntimeRecoveryInspectionEnvelope | None = None
    artifact_paths: RuntimeBridgeArtifactPaths = Field(
        default_factory=RuntimeBridgeArtifactPaths
    )


class RuntimeBridgeFailure(RuntimeBridgeModel):
    runner_path: RuntimeBridgePath
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str
    failed_ingress_batch: RuntimeIngressBatch | None = None
    failed_replay_source: RuntimeBridgeReplaySource | None = None
    partial_runtime_snapshot: RuntimeRegistrySnapshot | None = None
    service_batch_failure: RuntimeServiceBatchFailure | None = None
    replay_failure: RuntimeReplayFailure | None = None


class RuntimeBridgeHaltedError(RuntimeError):
    def __init__(self, failure: RuntimeBridgeFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: RuntimeBridgeFailure) -> str:
        return (
            f"runtime bridge runner path '{failure.runner_path}' halted "
            f"({failure.exception_type}: {failure.exception_message})"
        )


class RuntimeBridgeRunner:
    """Transport-agnostic coordination shell above `RuntimeService`.

    The runner owns one service facade and composes a narrow, explicit set of
    responsibilities around it:

    - pull typed ingress work from a source port
    - process or replay it through `RuntimeService`
    - emit already-typed runtime egress through a sink port
    - optionally persist artifacts through the service facade
    - optionally emit recovery inspection after successful paths

    It intentionally does not implement a bus, transport, async worker pool, or
    any runtime-internal mutation path outside the service facade.
    """

    def __init__(
        self,
        *,
        service: RuntimeService | None = None,
        config: RuntimeBridgeConfig | None = None,
    ) -> None:
        self._service = service if service is not None else RuntimeService()
        self._config = config if config is not None else RuntimeBridgeConfig()

    def get_service(self) -> RuntimeService:
        return self._service

    def get_config(self) -> RuntimeBridgeConfig:
        return self._config

    def build_runtime_snapshot(self) -> RuntimeRegistrySnapshot:
        return self._service.build_runtime_snapshot()

    def build_ingress_envelope(
        self,
        event: ProtocolEvent,
        *,
        source_label: str | None = None,
    ) -> RuntimeIngressEnvelope:
        return self._service.build_ingress_envelope(
            event,
            source_label=source_label,
        )

    def build_ingress_batch(
        self,
        envelopes: Iterable[RuntimeIngressEnvelope],
    ) -> RuntimeIngressBatch:
        return self._service.build_ingress_batch(envelopes)

    def build_ingress_batch_from_events(
        self,
        events: Iterable[ProtocolEvent],
        *,
        source_label: str | None = None,
    ) -> RuntimeIngressBatch:
        return self.build_ingress_batch(
            self.build_ingress_envelopes(
                events,
                source_label=source_label,
            )
        )

    def build_ingress_envelopes(
        self,
        events: Iterable[ProtocolEvent],
        *,
        source_label: str | None = None,
    ) -> tuple[RuntimeIngressEnvelope, ...]:
        return tuple(
            self.build_ingress_envelope(
                event,
                source_label=source_label,
            )
            for event in events
        )

    def run_single_envelope(
        self,
        source: RuntimeIngressSourcePort,
        sink: RuntimeEgressSinkPort,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        artifact_directory: str | Path | None = None,
        artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> RuntimeBridgeLiveResult:
        envelope = source.pull_ingress_envelope()
        if envelope is None:
            raise ValueError("runtime ingress source did not provide an ingress envelope")

        batch = self._service.build_ingress_batch((envelope,))
        return self._run_live_batch(
            batch=batch,
            sink=sink,
            runner_path="run_single_envelope",
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            artifact_directory=artifact_directory,
            artifact_paths=artifact_paths,
            overwrite=overwrite,
        )

    def run_batch(
        self,
        batch: RuntimeIngressBatch,
        sink: RuntimeEgressSinkPort,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        artifact_directory: str | Path | None = None,
        artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> RuntimeBridgeLiveResult:
        return self._run_live_batch(
            batch=batch,
            sink=sink,
            runner_path="run_batch",
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            artifact_directory=artifact_directory,
            artifact_paths=artifact_paths,
            overwrite=overwrite,
        )

    def run_next_batch(
        self,
        source: RuntimeIngressSourcePort,
        sink: RuntimeEgressSinkPort,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        artifact_directory: str | Path | None = None,
        artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> RuntimeBridgeLiveResult:
        batch = source.pull_ingress_batch()
        if batch is None:
            raise ValueError("runtime ingress source did not provide an ingress batch")

        return self._run_live_batch(
            batch=batch,
            sink=sink,
            runner_path="run_next_batch",
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            artifact_directory=artifact_directory,
            artifact_paths=artifact_paths,
            overwrite=overwrite,
        )

    def run_replay_batch(
        self,
        batch: RuntimeIngressBatch,
        sink: RuntimeEgressSinkPort,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        artifact_directory: str | Path | None = None,
        artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> RuntimeBridgeReplayResult:
        replay_source = RuntimeBridgeReplaySource(
            source_kind="ingress_batch",
            ingress_batch=batch,
        )
        return self._run_replay(
            replay_source=replay_source,
            sink=sink,
            runner_path="run_replay_batch",
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            artifact_directory=artifact_directory,
            artifact_paths=artifact_paths,
            overwrite=overwrite,
        )

    def run_replay_log(
        self,
        replay_log: PersistedRuntimeReplayLog,
        sink: RuntimeEgressSinkPort,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        artifact_directory: str | Path | None = None,
        artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
        source_path: str | Path | None = None,
    ) -> RuntimeBridgeReplayResult:
        replay_source = RuntimeBridgeReplaySource(
            source_kind="persisted_replay_log",
            replay_log=replay_log,
            source_path=Path(source_path) if source_path is not None else None,
        )
        return self._run_replay(
            replay_source=replay_source,
            sink=sink,
            runner_path="run_replay_log",
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            artifact_directory=artifact_directory,
            artifact_paths=artifact_paths,
            overwrite=overwrite,
        )

    def run_replay_bundle(
        self,
        replay_bundle: PersistedRuntimeBundle,
        sink: RuntimeEgressSinkPort,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        artifact_directory: str | Path | None = None,
        artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
        source_path: str | Path | None = None,
    ) -> RuntimeBridgeReplayResult:
        replay_source = RuntimeBridgeReplaySource(
            source_kind="persisted_replay_bundle",
            replay_bundle=replay_bundle,
            source_path=Path(source_path) if source_path is not None else None,
        )
        return self._run_replay(
            replay_source=replay_source,
            sink=sink,
            runner_path="run_replay_bundle",
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            artifact_directory=artifact_directory,
            artifact_paths=artifact_paths,
            overwrite=overwrite,
        )

    def _run_live_batch(
        self,
        *,
        batch: RuntimeIngressBatch,
        sink: RuntimeEgressSinkPort,
        runner_path: RuntimeBridgePath,
        persistence_policy: RuntimeBridgePersistencePolicy | None,
        emit_recovery: bool | None,
        artifact_directory: str | Path | None,
        artifact_paths: RuntimeBridgeArtifactPaths | None,
        overwrite: bool,
    ) -> RuntimeBridgeLiveResult:
        resolved_policy = self._resolve_persistence_policy(persistence_policy)
        resolved_emit_recovery = self._resolve_live_recovery_emission(emit_recovery)

        try:
            pre_processing_artifacts = self._persist_live_ingress_artifacts(
                batch=batch,
                persistence_policy=resolved_policy,
                artifact_directory=artifact_directory,
                artifact_paths=artifact_paths,
                overwrite=overwrite,
            )
            batch_result = self._service.process_batch(batch)
            emitted_envelopes = self._emit_live_egress(
                sink=sink,
                batch_result=batch_result,
            )
            recovery_envelope = self._emit_recovery_if_needed(
                sink=sink,
                should_emit=resolved_emit_recovery,
            )
            final_snapshot_artifacts = self._persist_final_snapshot_after_live_if_needed(
                persistence_policy=resolved_policy,
                artifact_directory=artifact_directory,
                artifact_paths=artifact_paths,
                overwrite=overwrite,
            )
        except Exception as exc:
            raise RuntimeBridgeHaltedError(
                self._build_live_failure(
                    runner_path=runner_path,
                    cause=exc,
                    batch=batch,
                )
            ) from exc

        artifact_report = self._merge_artifact_paths(
            pre_processing_artifacts,
            final_snapshot_artifacts,
        )
        return RuntimeBridgeLiveResult(
            consumed_ingress_batch=batch,
            process_egress_envelopes=emitted_envelopes,
            process_batch_result=batch_result,
            recovery_inspection_envelope=recovery_envelope,
            artifact_paths=artifact_report,
        )

    def _run_replay(
        self,
        *,
        replay_source: RuntimeBridgeReplaySource,
        sink: RuntimeEgressSinkPort,
        runner_path: RuntimeBridgePath,
        persistence_policy: RuntimeBridgePersistencePolicy | None,
        emit_recovery: bool | None,
        artifact_directory: str | Path | None,
        artifact_paths: RuntimeBridgeArtifactPaths | None,
        overwrite: bool,
    ) -> RuntimeBridgeReplayResult:
        resolved_policy = self._resolve_persistence_policy(persistence_policy)
        resolved_emit_recovery = self._resolve_replay_recovery_emission(emit_recovery)

        try:
            pre_replay_artifacts = self._persist_replay_input_artifacts_if_needed(
                replay_source=replay_source,
                persistence_policy=resolved_policy,
                artifact_directory=artifact_directory,
                artifact_paths=artifact_paths,
                overwrite=overwrite,
            )
            replay_egress = self._run_replay_through_service(replay_source)
            sink.emit_replay_egress_envelope(replay_egress)
            recovery_envelope = self._emit_recovery_if_needed(
                sink=sink,
                should_emit=resolved_emit_recovery,
            )
            final_snapshot_artifacts = self._persist_final_snapshot_after_replay_if_needed(
                persistence_policy=resolved_policy,
                artifact_directory=artifact_directory,
                artifact_paths=artifact_paths,
                overwrite=overwrite,
            )
        except Exception as exc:
            raise RuntimeBridgeHaltedError(
                self._build_replay_failure(
                    runner_path=runner_path,
                    cause=exc,
                    replay_source=replay_source,
                )
            ) from exc

        artifact_report = self._merge_artifact_paths(
            pre_replay_artifacts,
            final_snapshot_artifacts,
        )
        return RuntimeBridgeReplayResult(
            replay_source=replay_source,
            replay_egress_envelope=replay_egress,
            recovery_inspection_envelope=recovery_envelope,
            artifact_paths=artifact_report,
        )

    def _run_replay_through_service(
        self,
        replay_source: RuntimeBridgeReplaySource,
    ) -> RuntimeReplayEgressEnvelope:
        if replay_source.source_kind == "ingress_batch":
            assert replay_source.ingress_batch is not None
            return self._service.replay_batch(replay_source.ingress_batch)

        if replay_source.source_kind == "persisted_replay_log":
            assert replay_source.replay_log is not None
            return self._service.replay_persisted_log(replay_source.replay_log)

        assert replay_source.replay_bundle is not None
        return self._service.replay_persisted_bundle(replay_source.replay_bundle)

    def _resolve_persistence_policy(
        self,
        persistence_policy: RuntimeBridgePersistencePolicy | None,
    ) -> RuntimeBridgePersistencePolicy:
        if persistence_policy is not None:
            return persistence_policy
        return self._config.default_persistence_policy

    def _resolve_live_recovery_emission(self, emit_recovery: bool | None) -> bool:
        if emit_recovery is not None:
            return emit_recovery
        return self._config.emit_recovery_after_live

    def _resolve_replay_recovery_emission(self, emit_recovery: bool | None) -> bool:
        if emit_recovery is not None:
            return emit_recovery
        return self._config.emit_recovery_after_replay

    def _persist_live_ingress_artifacts(
        self,
        *,
        batch: RuntimeIngressBatch,
        persistence_policy: RuntimeBridgePersistencePolicy,
        artifact_directory: str | Path | None,
        artifact_paths: RuntimeBridgeArtifactPaths | None,
        overwrite: bool,
    ) -> RuntimeBridgeArtifactPaths:
        saved_replay_log_path: Path | None = None
        saved_replay_bundle_path: Path | None = None

        if persistence_policy.persist_ingress_replay_log_before_live:
            saved_replay_log_path = self._save_replay_log(
                batch=batch,
                artifact_directory=artifact_directory,
                explicit_path=artifact_paths.saved_replay_log_path
                if artifact_paths is not None
                else None,
                overwrite=overwrite,
            )

        if persistence_policy.persist_ingress_replay_bundle_before_live:
            saved_replay_bundle_path = self._save_replay_bundle(
                batch=batch,
                artifact_directory=artifact_directory,
                explicit_path=artifact_paths.saved_replay_bundle_path
                if artifact_paths is not None
                else None,
                overwrite=overwrite,
            )

        return RuntimeBridgeArtifactPaths(
            saved_replay_log_path=saved_replay_log_path,
            saved_replay_bundle_path=saved_replay_bundle_path,
        )

    def _persist_replay_input_artifacts_if_needed(
        self,
        *,
        replay_source: RuntimeBridgeReplaySource,
        persistence_policy: RuntimeBridgePersistencePolicy,
        artifact_directory: str | Path | None,
        artifact_paths: RuntimeBridgeArtifactPaths | None,
        overwrite: bool,
    ) -> RuntimeBridgeArtifactPaths:
        if replay_source.ingress_batch is None:
            return RuntimeBridgeArtifactPaths()

        saved_replay_log_path: Path | None = None
        saved_replay_bundle_path: Path | None = None

        if persistence_policy.persist_ingress_replay_log_before_replay_batch:
            saved_replay_log_path = self._save_replay_log(
                batch=replay_source.ingress_batch,
                artifact_directory=artifact_directory,
                explicit_path=artifact_paths.saved_replay_log_path
                if artifact_paths is not None
                else None,
                overwrite=overwrite,
            )

        if persistence_policy.persist_ingress_replay_bundle_before_replay_batch:
            saved_replay_bundle_path = self._save_replay_bundle(
                batch=replay_source.ingress_batch,
                artifact_directory=artifact_directory,
                explicit_path=artifact_paths.saved_replay_bundle_path
                if artifact_paths is not None
                else None,
                overwrite=overwrite,
            )

        return RuntimeBridgeArtifactPaths(
            saved_replay_log_path=saved_replay_log_path,
            saved_replay_bundle_path=saved_replay_bundle_path,
        )

    def _persist_final_snapshot_after_live_if_needed(
        self,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy,
        artifact_directory: str | Path | None,
        artifact_paths: RuntimeBridgeArtifactPaths | None,
        overwrite: bool,
    ) -> RuntimeBridgeArtifactPaths:
        if not persistence_policy.persist_final_snapshot_after_live:
            return RuntimeBridgeArtifactPaths()

        return RuntimeBridgeArtifactPaths(
            saved_final_snapshot_path=self._save_final_snapshot(
                artifact_directory=artifact_directory,
                explicit_path=artifact_paths.saved_final_snapshot_path
                if artifact_paths is not None
                else None,
                overwrite=overwrite,
            )
        )

    def _persist_final_snapshot_after_replay_if_needed(
        self,
        *,
        persistence_policy: RuntimeBridgePersistencePolicy,
        artifact_directory: str | Path | None,
        artifact_paths: RuntimeBridgeArtifactPaths | None,
        overwrite: bool,
    ) -> RuntimeBridgeArtifactPaths:
        if not persistence_policy.persist_final_snapshot_after_replay:
            return RuntimeBridgeArtifactPaths()

        return RuntimeBridgeArtifactPaths(
            saved_final_snapshot_path=self._save_final_snapshot(
                artifact_directory=artifact_directory,
                explicit_path=artifact_paths.saved_final_snapshot_path
                if artifact_paths is not None
                else None,
                overwrite=overwrite,
            )
        )

    def _save_replay_log(
        self,
        *,
        batch: RuntimeIngressBatch,
        artifact_directory: str | Path | None,
        explicit_path: Path | None,
        overwrite: bool,
    ) -> Path:
        if explicit_path is not None:
            return self._service.save_replay_log_to_path(
                explicit_path,
                batch,
                overwrite=overwrite,
            )

        directory = self._require_artifact_directory(
            artifact_directory,
            artifact_kind="runtime replay log",
        )
        return self._service.save_replay_log(
            directory,
            batch,
            overwrite=overwrite,
        )

    def _save_replay_bundle(
        self,
        *,
        batch: RuntimeIngressBatch,
        artifact_directory: str | Path | None,
        explicit_path: Path | None,
        overwrite: bool,
    ) -> Path:
        if explicit_path is not None:
            return self._service.save_persisted_bundle_to_path(
                explicit_path,
                batch,
                overwrite=overwrite,
            )

        directory = self._require_artifact_directory(
            artifact_directory,
            artifact_kind="runtime replay bundle",
        )
        return self._service.save_persisted_bundle(
            directory,
            batch,
            overwrite=overwrite,
        )

    def _save_final_snapshot(
        self,
        *,
        artifact_directory: str | Path | None,
        explicit_path: Path | None,
        overwrite: bool,
    ) -> Path:
        if explicit_path is not None:
            return self._service.save_current_runtime_snapshot_to_path(
                explicit_path,
                overwrite=overwrite,
            )

        directory = self._require_artifact_directory(
            artifact_directory,
            artifact_kind="runtime snapshot",
        )
        return self._service.save_current_runtime_snapshot(
            directory,
            overwrite=overwrite,
        )

    @staticmethod
    def _require_artifact_directory(
        artifact_directory: str | Path | None,
        *,
        artifact_kind: str,
    ) -> Path:
        if artifact_directory is None:
            raise ValueError(
                f"{artifact_kind} persistence requires artifact_directory or an explicit artifact path"
            )
        return Path(artifact_directory)

    @staticmethod
    def _merge_artifact_paths(
        left: RuntimeBridgeArtifactPaths,
        right: RuntimeBridgeArtifactPaths,
    ) -> RuntimeBridgeArtifactPaths:
        return RuntimeBridgeArtifactPaths(
            saved_replay_log_path=right.saved_replay_log_path
            if right.saved_replay_log_path is not None
            else left.saved_replay_log_path,
            saved_replay_bundle_path=right.saved_replay_bundle_path
            if right.saved_replay_bundle_path is not None
            else left.saved_replay_bundle_path,
            saved_final_snapshot_path=right.saved_final_snapshot_path
            if right.saved_final_snapshot_path is not None
            else left.saved_final_snapshot_path,
        )

    def _emit_live_egress(
        self,
        *,
        sink: RuntimeEgressSinkPort,
        batch_result: RuntimeProcessBatchResult,
    ) -> tuple[RuntimeProcessEgressEnvelope, ...]:
        emitted: list[RuntimeProcessEgressEnvelope] = []

        for envelope in batch_result.process_egress_envelopes:
            sink.emit_process_egress_envelope(envelope)
            emitted.append(envelope)

        sink.emit_process_batch_result(batch_result)
        return tuple(emitted)

    def _emit_recovery_if_needed(
        self,
        *,
        sink: RuntimeEgressSinkPort,
        should_emit: bool,
    ) -> RuntimeRecoveryInspectionEnvelope | None:
        if not should_emit:
            return None

        envelope = self._service.peek_recovery_snapshots()
        sink.emit_recovery_inspection_envelope(envelope)
        return envelope

    def _build_live_failure(
        self,
        *,
        runner_path: RuntimeBridgePath,
        cause: Exception,
        batch: RuntimeIngressBatch,
    ) -> RuntimeBridgeFailure:
        service_batch_failure = (
            cause.failure if isinstance(cause, RuntimeServiceBatchHaltedError) else None
        )
        partial_snapshot = (
            service_batch_failure.partial_runtime_snapshot
            if service_batch_failure is not None
            else self._safe_build_runtime_snapshot()
        )
        return RuntimeBridgeFailure(
            runner_path=runner_path,
            exception_type=type(cause).__name__,
            exception_message=str(cause),
            failed_ingress_batch=batch,
            partial_runtime_snapshot=partial_snapshot,
            service_batch_failure=service_batch_failure,
        )

    def _build_replay_failure(
        self,
        *,
        runner_path: RuntimeBridgePath,
        cause: Exception,
        replay_source: RuntimeBridgeReplaySource,
    ) -> RuntimeBridgeFailure:
        replay_failure = (
            cause.failure if isinstance(cause, RuntimeReplayHaltedError) else None
        )
        partial_snapshot = (
            replay_failure.partial_runtime_snapshot
            if replay_failure is not None
            else self._safe_build_runtime_snapshot()
        )
        return RuntimeBridgeFailure(
            runner_path=runner_path,
            exception_type=type(cause).__name__,
            exception_message=str(cause),
            failed_replay_source=replay_source,
            partial_runtime_snapshot=partial_snapshot,
            replay_failure=replay_failure,
        )

    def _safe_build_runtime_snapshot(self) -> RuntimeRegistrySnapshot | None:
        try:
            return self._service.build_runtime_snapshot()
        except Exception:
            return None
