from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from packages.orchestrator.turn_orchestrator import TurnContext
from packages.runtime.orchestrator_bridge import (
    OrchestratorRuntimeBridgeSession,
    OrchestratorRuntimeBridgeSessionFailure,
    OrchestratorRuntimeBridgeSessionHaltedError,
    OrchestratorRuntimeBridgeSessionResult,
    RecordedRuntimeEgress,
    RecordingRuntimeEgressSink,
)
from packages.runtime.orchestrator_bridge_artifacts import (
    OrchestratorBridgeArtifactManager,
    OrchestratorBridgeReplayMaterial,
    OrchestratorBridgeReplaySliceKind,
    PersistedOrchestratorBridgeSessionFailureEnvelope,
    PersistedOrchestratorBridgeSessionSuccessEnvelope,
)
from packages.runtime.runtime_bridge import (
    RuntimeBridgeArtifactPaths,
    RuntimeBridgeFailure,
    RuntimeBridgeHaltedError,
    RuntimeBridgePersistencePolicy,
    RuntimeBridgeReplayResult,
    RuntimeBridgeRunner,
)


ServiceOperationKind = Literal["live_turn", "replay"]


def _validate_non_empty_text(value: str, field_name: str) -> str:
    if not value.strip():
        raise ValueError(f"{field_name} must not be empty")
    return value


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _resolve_optional_path(value: str | Path | None) -> Path | None:
    if value is None:
        return None
    return Path(value)


class OrchestratorBridgeServiceModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class OrchestratorBridgeServiceReplaySourceKind(str, Enum):
    SUCCESS_ARTIFACT = "success_artifact"
    FAILURE_ARTIFACT = "failure_artifact"


class OrchestratorBridgeServiceConfig(OrchestratorBridgeServiceModel):
    persist_success_artifact_by_default: bool = False
    persist_failure_artifact_by_default: bool = False
    default_replay_source_label: str = Field(
        default="bridge.service.replay",
        min_length=1,
        max_length=128,
    )
    default_replay_persistence_policy: RuntimeBridgePersistencePolicy = Field(
        default_factory=RuntimeBridgePersistencePolicy
    )
    emit_recovery_after_replay_by_default: bool = False

    @field_validator("default_replay_source_label")
    @classmethod
    def validate_default_replay_source_label(cls, value: str) -> str:
        return _validate_non_empty_text(value, "default_replay_source_label")


class OrchestratorBridgeServiceArtifactPaths(OrchestratorBridgeServiceModel):
    saved_success_artifact_path: Path | None = None
    saved_failure_artifact_path: Path | None = None

    @property
    def has_success_artifact(self) -> bool:
        return self.saved_success_artifact_path is not None

    @property
    def has_failure_artifact(self) -> bool:
        return self.saved_failure_artifact_path is not None

    @property
    def is_empty(self) -> bool:
        return not self.has_success_artifact and not self.has_failure_artifact

    @model_validator(mode="after")
    def validate_single_live_artifact_role(
        self,
    ) -> "OrchestratorBridgeServiceArtifactPaths":
        if (
            self.saved_success_artifact_path is not None
            and self.saved_failure_artifact_path is not None
        ):
            raise ValueError(
                "service artifact paths must not report both saved success and saved failure artifacts for one operation"
            )
        return self


class OrchestratorBridgeServiceReplayRequest(OrchestratorBridgeServiceModel):
    replay_source_kind: OrchestratorBridgeServiceReplaySourceKind
    slice_kind: OrchestratorBridgeReplaySliceKind
    source_label_override: str | None = None
    artifact_path: Path | None = None

    @field_validator("source_label_override")
    @classmethod
    def validate_source_label_override(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_non_empty_text(value, "source_label_override")

    @model_validator(mode="after")
    def validate_slice_compatibility(
        self,
    ) -> "OrchestratorBridgeServiceReplayRequest":
        if (
            self.replay_source_kind
            is OrchestratorBridgeServiceReplaySourceKind.SUCCESS_ARTIFACT
            and self.slice_kind is not OrchestratorBridgeReplaySliceKind.FULL_COLLECTED
        ):
            raise ValueError(
                "success-artifact replay requests support only the 'full_collected' replay slice"
            )
        return self

    def resolved_source_label(self, default_label: str) -> str:
        if self.source_label_override is None:
            return default_label
        return self.source_label_override


class OrchestratorBridgeServiceLiveResult(OrchestratorBridgeServiceModel):
    turn_context: TurnContext
    session_result: OrchestratorRuntimeBridgeSessionResult
    artifact_paths: OrchestratorBridgeServiceArtifactPaths = Field(
        default_factory=OrchestratorBridgeServiceArtifactPaths
    )
    success_envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope | None = None

    @property
    def saved_success_artifact_path(self) -> Path | None:
        return self.artifact_paths.saved_success_artifact_path

    @model_validator(mode="after")
    def validate_live_success_alignment(
        self,
    ) -> "OrchestratorBridgeServiceLiveResult":
        if self.session_result.turn_context != self.turn_context:
            raise ValueError(
                "live service result turn_context must match the nested bridge-session result turn_context"
            )

        if self.artifact_paths.saved_failure_artifact_path is not None:
            raise ValueError(
                "live service success results must not report a saved failure artifact path"
            )

        if self.success_envelope is not None:
            if self.success_envelope.session_result != self.session_result:
                raise ValueError(
                    "live service success_envelope must preserve the exact nested bridge-session result"
                )

        if (
            self.artifact_paths.saved_success_artifact_path is not None
            and self.success_envelope is None
        ):
            raise ValueError(
                "live service results that report a saved success artifact path must also preserve the built success_envelope"
            )

        return self


class OrchestratorBridgeServiceReplayResult(OrchestratorBridgeServiceModel):
    replay_request: OrchestratorBridgeServiceReplayRequest
    replay_material: OrchestratorBridgeReplayMaterial
    runtime_replay_result: RuntimeBridgeReplayResult
    recorded_runtime_egress: RecordedRuntimeEgress

    @property
    def recorded_replay_egress_envelopes(self):
        return self.recorded_runtime_egress.replay_egress_envelopes

    @property
    def recorded_recovery_inspection_envelopes(self):
        return self.recorded_runtime_egress.recovery_inspection_envelopes

    @property
    def runtime_sink_emission_records(self):
        return self.recorded_runtime_egress.emission_records

    @model_validator(mode="after")
    def validate_replay_alignment(
        self,
    ) -> "OrchestratorBridgeServiceReplayResult":
        expected_source_kind = (
            OrchestratorBridgeServiceReplaySourceKind.SUCCESS_ARTIFACT
            if self.replay_material.source_artifact_kind.value == "success"
            else OrchestratorBridgeServiceReplaySourceKind.FAILURE_ARTIFACT
        )
        if self.replay_request.replay_source_kind is not expected_source_kind:
            raise ValueError(
                "replay_request.replay_source_kind must match replay_material.source_artifact_kind"
            )

        if (
            self.replay_request.slice_kind
            is not self.replay_material.replay_selection.slice_kind
        ):
            raise ValueError(
                "replay_request.slice_kind must match replay_material.replay_selection.slice_kind"
            )

        if self.runtime_replay_result.replay_source.source_kind != "ingress_batch":
            raise ValueError(
                "service replay results must preserve runtime replay only from runner.run_replay_batch(...)"
            )

        if (
            self.runtime_replay_result.replay_source.ingress_batch
            != self.replay_material.replay_ready_ingress_batch
        ):
            raise ValueError(
                "service replay results must preserve the exact replay-ready ingress batch from replay_material"
            )

        if self.recorded_runtime_egress.process_egress_envelopes:
            raise ValueError(
                "service replay results must not capture process_egress_envelopes on the replay path"
            )
        if self.recorded_runtime_egress.process_batch_results:
            raise ValueError(
                "service replay results must not capture process_batch_results on the replay path"
            )
        if self.recorded_runtime_egress.replay_egress_envelopes != (
            self.runtime_replay_result.replay_egress_envelope,
        ):
            raise ValueError(
                "service replay results recorded replay egress must match the nested RuntimeBridgeReplayResult exactly"
            )

        expected_recovery = ()
        if self.runtime_replay_result.recovery_inspection_envelope is not None:
            expected_recovery = (
                self.runtime_replay_result.recovery_inspection_envelope,
            )
        if (
            self.recorded_runtime_egress.recovery_inspection_envelopes
            != expected_recovery
        ):
            raise ValueError(
                "service replay results must preserve recovery inspection emission order exactly"
            )

        return self


class OrchestratorBridgeServiceFailure(OrchestratorBridgeServiceModel):
    operation_kind: ServiceOperationKind
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str
    turn_context: TurnContext | None = None
    live_session_result: OrchestratorRuntimeBridgeSessionResult | None = None
    live_session_failure: OrchestratorRuntimeBridgeSessionFailure | None = None
    artifact_paths: OrchestratorBridgeServiceArtifactPaths = Field(
        default_factory=OrchestratorBridgeServiceArtifactPaths
    )
    success_envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope | None = None
    failure_envelope: PersistedOrchestratorBridgeSessionFailureEnvelope | None = None
    replay_request: OrchestratorBridgeServiceReplayRequest | None = None
    replay_material: OrchestratorBridgeReplayMaterial | None = None
    runtime_bridge_failure: RuntimeBridgeFailure | None = None
    recorded_runtime_egress: RecordedRuntimeEgress | None = None
    saved_at: datetime | None = None

    @field_validator("saved_at")
    @classmethod
    def normalize_saved_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return _normalize_utc_datetime(value, "saved_at")

    @model_validator(mode="after")
    def validate_failure_shape(self) -> "OrchestratorBridgeServiceFailure":
        if self.operation_kind == "live_turn":
            if self.turn_context is None:
                raise ValueError(
                    "live-turn service failures must preserve the consumed TurnContext"
                )
            if self.replay_request is not None or self.replay_material is not None:
                raise ValueError(
                    "live-turn service failures must not carry replay request or replay material surfaces"
                )
            if self.runtime_bridge_failure is not None:
                raise ValueError(
                    "live-turn service failures must preserve runtime-bridge halts inside the nested bridge-session failure, not as a top-level runtime_bridge_failure"
                )
            if (
                self.live_session_result is not None
                and self.live_session_result.turn_context != self.turn_context
            ):
                raise ValueError(
                    "live-turn service failure live_session_result must match the preserved TurnContext"
                )
            if (
                self.live_session_failure is not None
                and self.live_session_failure.turn_context != self.turn_context
            ):
                raise ValueError(
                    "live-turn service failure live_session_failure must match the preserved TurnContext"
                )
            if (
                self.live_session_result is not None
                and self.live_session_failure is not None
            ):
                raise ValueError(
                    "live-turn service failures must preserve either a bridge-session result or a bridge-session failure, not both"
                )
            if self.success_envelope is not None and self.live_session_result is None:
                raise ValueError(
                    "live-turn service failures carrying success_envelope must also preserve the nested live_session_result"
                )
            if self.failure_envelope is not None and self.live_session_failure is None:
                raise ValueError(
                    "live-turn service failures carrying failure_envelope must also preserve the nested live_session_failure"
                )
            if self.success_envelope is not None and self.live_session_result is not None:
                if self.success_envelope.session_result != self.live_session_result:
                    raise ValueError(
                        "live-turn service failure success_envelope must preserve the exact nested live_session_result"
                    )
            if self.failure_envelope is not None and self.live_session_failure is not None:
                if self.failure_envelope.session_failure != self.live_session_failure:
                    raise ValueError(
                        "live-turn service failure failure_envelope must preserve the exact nested live_session_failure"
                    )
            if (
                self.artifact_paths.saved_success_artifact_path is not None
                and self.success_envelope is None
            ):
                raise ValueError(
                    "live-turn service failures that report a saved success artifact path must also preserve the built success_envelope"
                )
            if (
                self.artifact_paths.saved_failure_artifact_path is not None
                and self.failure_envelope is None
            ):
                raise ValueError(
                    "live-turn service failures that report a saved failure artifact path must also preserve the built failure_envelope"
                )
            return self

        if self.replay_request is None:
            raise ValueError("replay service failures must preserve the replay request")
        if self.live_session_result is not None or self.live_session_failure is not None:
            raise ValueError(
                "replay service failures must not preserve live bridge-session result surfaces"
            )
        if self.success_envelope is not None or self.failure_envelope is not None:
            raise ValueError(
                "replay service failures must not preserve live artifact envelopes"
            )
        if self.replay_material is not None:
            expected_source_kind = (
                OrchestratorBridgeServiceReplaySourceKind.SUCCESS_ARTIFACT
                if self.replay_material.source_artifact_kind.value == "success"
                else OrchestratorBridgeServiceReplaySourceKind.FAILURE_ARTIFACT
            )
            if self.replay_request.replay_source_kind is not expected_source_kind:
                raise ValueError(
                    "replay service failure replay_request.replay_source_kind must align with replay_material.source_artifact_kind"
                )
            if (
                self.replay_request.slice_kind
                is not self.replay_material.replay_selection.slice_kind
            ):
                raise ValueError(
                    "replay service failure replay_request.slice_kind must align with replay_material.replay_selection.slice_kind"
                )
        if self.recorded_runtime_egress is not None:
            if self.recorded_runtime_egress.process_egress_envelopes:
                raise ValueError(
                    "replay service failures must not capture process_egress_envelopes"
                )
            if self.recorded_runtime_egress.process_batch_results:
                raise ValueError(
                    "replay service failures must not capture process_batch_results"
                )
        return self


class OrchestratorBridgeServiceHaltedError(RuntimeError):
    def __init__(self, failure: OrchestratorBridgeServiceFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: OrchestratorBridgeServiceFailure) -> str:
        return (
            f"orchestrator bridge service halted during {failure.operation_kind} "
            f"({failure.exception_type}: {failure.exception_message})"
        )


class OrchestratorBridgeService:
    """Local service facade above the live bridge session and bridge-artifact layer.

    This service intentionally owns one coherent local surface rather than a few
    thin delegation helpers. It centralizes:

    - live bridged turn execution through `OrchestratorRuntimeBridgeSession`
    - explicit success/failure bridge-artifact persistence policy
    - replay-from-artifact material selection through `OrchestratorBridgeArtifactManager`
    - replay execution through `RuntimeBridgeRunner.run_replay_batch(...)`
    - typed service-local success and failure reporting

    The implementation stays transport-agnostic and in-process. It does not
    introduce a bus, network API, storage redesign, or adapter logic.
    """

    def __init__(
        self,
        *,
        bridge_session: OrchestratorRuntimeBridgeSession,
        artifact_manager: OrchestratorBridgeArtifactManager | None = None,
        runtime_bridge_runner: RuntimeBridgeRunner | None = None,
        config: OrchestratorBridgeServiceConfig | None = None,
    ) -> None:
        resolved_runner = self._resolve_runtime_bridge_runner(
            bridge_session=bridge_session,
            runtime_bridge_runner=runtime_bridge_runner,
        )
        resolved_artifact_manager = self._resolve_artifact_manager(
            artifact_manager=artifact_manager,
            runtime_bridge_runner=resolved_runner,
        )
        self._assert_dependency_alignment(
            bridge_session=bridge_session,
            runtime_bridge_runner=resolved_runner,
            artifact_manager=resolved_artifact_manager,
        )
        self._bridge_session = bridge_session
        self._runtime_bridge_runner = resolved_runner
        self._artifact_manager = resolved_artifact_manager
        self._config = (
            config if config is not None else OrchestratorBridgeServiceConfig()
        )

    @staticmethod
    def _resolve_runtime_bridge_runner(
        *,
        bridge_session: OrchestratorRuntimeBridgeSession,
        runtime_bridge_runner: RuntimeBridgeRunner | None,
    ) -> RuntimeBridgeRunner:
        if runtime_bridge_runner is not None:
            return runtime_bridge_runner
        return bridge_session.get_runtime_bridge_runner()

    @staticmethod
    def _resolve_artifact_manager(
        *,
        artifact_manager: OrchestratorBridgeArtifactManager | None,
        runtime_bridge_runner: RuntimeBridgeRunner,
    ) -> OrchestratorBridgeArtifactManager:
        if artifact_manager is not None:
            return artifact_manager
        return OrchestratorBridgeArtifactManager(
            runtime_bridge_runner=runtime_bridge_runner
        )

    @staticmethod
    def _assert_dependency_alignment(
        *,
        bridge_session: OrchestratorRuntimeBridgeSession,
        runtime_bridge_runner: RuntimeBridgeRunner,
        artifact_manager: OrchestratorBridgeArtifactManager,
    ) -> None:
        if bridge_session.get_runtime_bridge_runner() is not runtime_bridge_runner:
            raise ValueError(
                "bridge_session and runtime_bridge_runner must share the same RuntimeBridgeRunner instance"
            )
        if artifact_manager.get_runtime_bridge_runner() is not runtime_bridge_runner:
            raise ValueError(
                "artifact_manager and runtime_bridge_runner must share the same RuntimeBridgeRunner instance"
            )

    def get_config(self) -> OrchestratorBridgeServiceConfig:
        return self._config

    def get_bridge_session(self) -> OrchestratorRuntimeBridgeSession:
        return self._bridge_session

    def get_runtime_bridge_runner(self) -> RuntimeBridgeRunner:
        return self._runtime_bridge_runner

    def get_artifact_manager(self) -> OrchestratorBridgeArtifactManager:
        return self._artifact_manager

    def build_runtime_egress_sink(self) -> RecordingRuntimeEgressSink:
        return RecordingRuntimeEgressSink()

    def build_replay_request(
        self,
        *,
        replay_source_kind: OrchestratorBridgeServiceReplaySourceKind,
        slice_kind: OrchestratorBridgeReplaySliceKind,
        source_label_override: str | None = None,
        artifact_path: str | Path | None = None,
    ) -> OrchestratorBridgeServiceReplayRequest:
        return OrchestratorBridgeServiceReplayRequest(
            replay_source_kind=replay_source_kind,
            slice_kind=slice_kind,
            source_label_override=source_label_override,
            artifact_path=_resolve_optional_path(artifact_path),
        )

    def build_success_artifact_replay_request(
        self,
        *,
        artifact_path: str | Path | None = None,
        source_label_override: str | None = None,
    ) -> OrchestratorBridgeServiceReplayRequest:
        return self.build_replay_request(
            replay_source_kind=OrchestratorBridgeServiceReplaySourceKind.SUCCESS_ARTIFACT,
            slice_kind=OrchestratorBridgeReplaySliceKind.FULL_COLLECTED,
            source_label_override=source_label_override,
            artifact_path=artifact_path,
        )

    def build_failure_artifact_replay_request(
        self,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
        artifact_path: str | Path | None = None,
        source_label_override: str | None = None,
    ) -> OrchestratorBridgeServiceReplayRequest:
        return self.build_replay_request(
            replay_source_kind=OrchestratorBridgeServiceReplaySourceKind.FAILURE_ARTIFACT,
            slice_kind=slice_kind,
            source_label_override=source_label_override,
            artifact_path=artifact_path,
        )

    def build_success_envelope(
        self,
        session_result: OrchestratorRuntimeBridgeSessionResult,
        *,
        saved_at: datetime | None = None,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self._artifact_manager.build_success_envelope(
            session_result,
            saved_at=saved_at,
        )

    def build_failure_envelope(
        self,
        session_failure: OrchestratorRuntimeBridgeSessionFailure,
        *,
        saved_at: datetime | None = None,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self._artifact_manager.build_failure_envelope(
            session_failure,
            saved_at=saved_at,
        )

    def load_success_artifact_from_path(
        self,
        path: str | Path,
    ) -> PersistedOrchestratorBridgeSessionSuccessEnvelope:
        return self._artifact_manager.load_success_envelope_from_path(path)

    def load_failure_artifact_from_path(
        self,
        path: str | Path,
    ) -> PersistedOrchestratorBridgeSessionFailureEnvelope:
        return self._artifact_manager.load_failure_envelope_from_path(path)

    async def run_turn(
        self,
        ctx: TurnContext,
        *,
        persist_success_artifact: bool | None = None,
        persist_failure_artifact: bool | None = None,
        success_artifact_directory: str | Path | None = None,
        success_artifact_path: str | Path | None = None,
        failure_artifact_directory: str | Path | None = None,
        failure_artifact_path: str | Path | None = None,
        saved_at: datetime | None = None,
        overwrite: bool = False,
    ) -> OrchestratorBridgeServiceLiveResult:
        persist_success = self._resolve_persist_success_artifact(
            persist_success_artifact
        )
        persist_failure = self._resolve_persist_failure_artifact(
            persist_failure_artifact
        )

        try:
            session_result = await self._bridge_session.run_turn(ctx)
        except OrchestratorRuntimeBridgeSessionHaltedError as exc:
            raise self._build_live_halt_error(
                turn_context=ctx,
                session_failure=exc.failure,
                persist_failure_artifact=persist_failure,
                failure_artifact_directory=failure_artifact_directory,
                failure_artifact_path=failure_artifact_path,
                saved_at=saved_at,
                overwrite=overwrite,
            ) from exc
        except Exception as exc:
            raise self._build_live_untyped_error(
                turn_context=ctx,
                cause=exc,
            ) from exc

        if not persist_success:
            return OrchestratorBridgeServiceLiveResult(
                turn_context=ctx,
                session_result=session_result,
            )

        return self._persist_live_success_result(
            turn_context=ctx,
            session_result=session_result,
            success_artifact_directory=success_artifact_directory,
            success_artifact_path=success_artifact_path,
            saved_at=saved_at,
            overwrite=overwrite,
        )

    def replay_from_artifact_request(
        self,
        replay_request: OrchestratorBridgeServiceReplayRequest,
        *,
        success_artifact_path: str | Path | None = None,
        failure_artifact_path: str | Path | None = None,
        success_envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope | None = None,
        failure_envelope: PersistedOrchestratorBridgeSessionFailureEnvelope | None = None,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        runtime_artifact_directory: str | Path | None = None,
        runtime_artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> OrchestratorBridgeServiceReplayResult:
        replay_material: OrchestratorBridgeReplayMaterial | None = None

        try:
            replay_material = self.derive_replay_material_from_request(
                replay_request,
                success_artifact_path=success_artifact_path,
                failure_artifact_path=failure_artifact_path,
                success_envelope=success_envelope,
                failure_envelope=failure_envelope,
            )
        except Exception as exc:
            raise OrchestratorBridgeServiceHaltedError(
                OrchestratorBridgeServiceFailure(
                    operation_kind="replay",
                    exception_type=type(exc).__name__,
                    exception_message=str(exc),
                    replay_request=replay_request,
                )
            ) from exc

        runtime_egress_sink = self.build_runtime_egress_sink()
        try:
            runtime_replay_result = self._runtime_bridge_runner.run_replay_batch(
                replay_material.replay_ready_ingress_batch,
                runtime_egress_sink,
                persistence_policy=self._resolve_replay_persistence_policy(
                    persistence_policy
                ),
                emit_recovery=self._resolve_emit_recovery_after_replay(emit_recovery),
                artifact_directory=runtime_artifact_directory,
                artifact_paths=runtime_artifact_paths,
                overwrite=overwrite,
            )
        except RuntimeBridgeHaltedError as exc:
            raise OrchestratorBridgeServiceHaltedError(
                OrchestratorBridgeServiceFailure(
                    operation_kind="replay",
                    exception_type=type(exc).__name__,
                    exception_message=str(exc),
                    replay_request=replay_request,
                    replay_material=replay_material,
                    runtime_bridge_failure=exc.failure,
                    recorded_runtime_egress=runtime_egress_sink.build_capture(),
                )
            ) from exc
        except Exception as exc:
            raise OrchestratorBridgeServiceHaltedError(
                OrchestratorBridgeServiceFailure(
                    operation_kind="replay",
                    exception_type=type(exc).__name__,
                    exception_message=str(exc),
                    replay_request=replay_request,
                    replay_material=replay_material,
                    recorded_runtime_egress=runtime_egress_sink.build_capture(),
                )
            ) from exc

        return OrchestratorBridgeServiceReplayResult(
            replay_request=replay_request,
            replay_material=replay_material,
            runtime_replay_result=runtime_replay_result,
            recorded_runtime_egress=runtime_egress_sink.build_capture(),
        )

    def replay_saved_success_artifact_path(
        self,
        path: str | Path,
        *,
        source_label_override: str | None = None,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        runtime_artifact_directory: str | Path | None = None,
        runtime_artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> OrchestratorBridgeServiceReplayResult:
        replay_request = self.build_success_artifact_replay_request(
            artifact_path=path,
            source_label_override=source_label_override,
        )
        return self.replay_from_artifact_request(
            replay_request,
            success_artifact_path=path,
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            runtime_artifact_directory=runtime_artifact_directory,
            runtime_artifact_paths=runtime_artifact_paths,
            overwrite=overwrite,
        )

    def replay_saved_failure_artifact_path(
        self,
        path: str | Path,
        *,
        slice_kind: OrchestratorBridgeReplaySliceKind,
        source_label_override: str | None = None,
        persistence_policy: RuntimeBridgePersistencePolicy | None = None,
        emit_recovery: bool | None = None,
        runtime_artifact_directory: str | Path | None = None,
        runtime_artifact_paths: RuntimeBridgeArtifactPaths | None = None,
        overwrite: bool = False,
    ) -> OrchestratorBridgeServiceReplayResult:
        replay_request = self.build_failure_artifact_replay_request(
            slice_kind=slice_kind,
            artifact_path=path,
            source_label_override=source_label_override,
        )
        return self.replay_from_artifact_request(
            replay_request,
            failure_artifact_path=path,
            persistence_policy=persistence_policy,
            emit_recovery=emit_recovery,
            runtime_artifact_directory=runtime_artifact_directory,
            runtime_artifact_paths=runtime_artifact_paths,
            overwrite=overwrite,
        )

    def derive_replay_material_from_request(
        self,
        replay_request: OrchestratorBridgeServiceReplayRequest,
        *,
        success_artifact_path: str | Path | None = None,
        failure_artifact_path: str | Path | None = None,
        success_envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope | None = None,
        failure_envelope: PersistedOrchestratorBridgeSessionFailureEnvelope | None = None,
    ) -> OrchestratorBridgeReplayMaterial:
        resolved_source_label = replay_request.resolved_source_label(
            self._config.default_replay_source_label
        )

        if (
            replay_request.replay_source_kind
            is OrchestratorBridgeServiceReplaySourceKind.SUCCESS_ARTIFACT
        ):
            return self._derive_success_replay_material(
                replay_request,
                success_artifact_path=success_artifact_path,
                success_envelope=success_envelope,
                source_label=resolved_source_label,
            )

        return self._derive_failure_replay_material(
            replay_request,
            failure_artifact_path=failure_artifact_path,
            failure_envelope=failure_envelope,
            source_label=resolved_source_label,
        )

    def _derive_success_replay_material(
        self,
        replay_request: OrchestratorBridgeServiceReplayRequest,
        *,
        success_artifact_path: str | Path | None,
        success_envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope | None,
        source_label: str,
    ) -> OrchestratorBridgeReplayMaterial:
        if success_envelope is not None:
            if success_artifact_path is not None:
                raise ValueError(
                    "success-artifact replay material derivation accepts either a typed success_envelope or a success_artifact_path, not both"
                )
            return self._artifact_manager.derive_replay_material_from_success_envelope(
                success_envelope,
                slice_kind=replay_request.slice_kind,
                source_label=source_label,
            )

        resolved_path = self._require_artifact_path(
            replay_request,
            explicit_artifact_path=success_artifact_path,
            artifact_role="success artifact",
        )
        return self._artifact_manager.derive_replay_material_from_saved_success_artifact_path(
            resolved_path,
            slice_kind=replay_request.slice_kind,
            source_label=source_label,
        )

    def _derive_failure_replay_material(
        self,
        replay_request: OrchestratorBridgeServiceReplayRequest,
        *,
        failure_artifact_path: str | Path | None,
        failure_envelope: PersistedOrchestratorBridgeSessionFailureEnvelope | None,
        source_label: str,
    ) -> OrchestratorBridgeReplayMaterial:
        if failure_envelope is not None:
            if failure_artifact_path is not None:
                raise ValueError(
                    "failure-artifact replay material derivation accepts either a typed failure_envelope or a failure_artifact_path, not both"
                )
            return self._artifact_manager.derive_replay_material_from_failure_envelope(
                failure_envelope,
                slice_kind=replay_request.slice_kind,
                source_label=source_label,
            )

        resolved_path = self._require_artifact_path(
            replay_request,
            explicit_artifact_path=failure_artifact_path,
            artifact_role="failure artifact",
        )
        return self._artifact_manager.derive_replay_material_from_saved_failure_artifact_path(
            resolved_path,
            slice_kind=replay_request.slice_kind,
            source_label=source_label,
        )

    def _persist_live_success_result(
        self,
        *,
        turn_context: TurnContext,
        session_result: OrchestratorRuntimeBridgeSessionResult,
        success_artifact_directory: str | Path | None,
        success_artifact_path: str | Path | None,
        saved_at: datetime | None,
        overwrite: bool,
    ) -> OrchestratorBridgeServiceLiveResult:
        success_envelope = self.build_success_envelope(
            session_result,
            saved_at=saved_at,
        )
        try:
            saved_path = self._save_success_envelope(
                success_envelope,
                artifact_directory=success_artifact_directory,
                artifact_path=success_artifact_path,
                overwrite=overwrite,
            )
        except Exception as exc:
            raise OrchestratorBridgeServiceHaltedError(
                OrchestratorBridgeServiceFailure(
                    operation_kind="live_turn",
                    exception_type=type(exc).__name__,
                    exception_message=str(exc),
                    turn_context=turn_context,
                    live_session_result=session_result,
                    success_envelope=success_envelope,
                    saved_at=saved_at,
                )
            ) from exc

        return OrchestratorBridgeServiceLiveResult(
            turn_context=turn_context,
            session_result=session_result,
            artifact_paths=OrchestratorBridgeServiceArtifactPaths(
                saved_success_artifact_path=saved_path,
            ),
            success_envelope=success_envelope,
        )

    def _build_live_halt_error(
        self,
        *,
        turn_context: TurnContext,
        session_failure: OrchestratorRuntimeBridgeSessionFailure,
        persist_failure_artifact: bool,
        failure_artifact_directory: str | Path | None,
        failure_artifact_path: str | Path | None,
        saved_at: datetime | None,
        overwrite: bool,
    ) -> OrchestratorBridgeServiceHaltedError:
        if not persist_failure_artifact:
            return OrchestratorBridgeServiceHaltedError(
                OrchestratorBridgeServiceFailure(
                    operation_kind="live_turn",
                    exception_type="OrchestratorRuntimeBridgeSessionHaltedError",
                    exception_message=str(
                        OrchestratorRuntimeBridgeSessionHaltedError(session_failure)
                    ),
                    turn_context=turn_context,
                    live_session_failure=session_failure,
                    saved_at=saved_at,
                )
            )

        failure_envelope = self.build_failure_envelope(
            session_failure,
            saved_at=saved_at,
        )
        try:
            saved_path = self._save_failure_envelope(
                failure_envelope,
                artifact_directory=failure_artifact_directory,
                artifact_path=failure_artifact_path,
                overwrite=overwrite,
            )
        except Exception as exc:
            return OrchestratorBridgeServiceHaltedError(
                OrchestratorBridgeServiceFailure(
                    operation_kind="live_turn",
                    exception_type=type(exc).__name__,
                    exception_message=str(exc),
                    turn_context=turn_context,
                    live_session_failure=session_failure,
                    failure_envelope=failure_envelope,
                    saved_at=saved_at,
                )
            )

        return OrchestratorBridgeServiceHaltedError(
            OrchestratorBridgeServiceFailure(
                operation_kind="live_turn",
                exception_type="OrchestratorRuntimeBridgeSessionHaltedError",
                exception_message=str(
                    OrchestratorRuntimeBridgeSessionHaltedError(session_failure)
                ),
                turn_context=turn_context,
                live_session_failure=session_failure,
                artifact_paths=OrchestratorBridgeServiceArtifactPaths(
                    saved_failure_artifact_path=saved_path,
                ),
                failure_envelope=failure_envelope,
                saved_at=saved_at,
            )
        )

    @staticmethod
    def _build_live_untyped_error(
        *,
        turn_context: TurnContext,
        cause: Exception,
    ) -> OrchestratorBridgeServiceHaltedError:
        return OrchestratorBridgeServiceHaltedError(
            OrchestratorBridgeServiceFailure(
                operation_kind="live_turn",
                exception_type=type(cause).__name__,
                exception_message=str(cause),
                turn_context=turn_context,
            )
        )

    def _save_success_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionSuccessEnvelope,
        *,
        artifact_directory: str | Path | None,
        artifact_path: str | Path | None,
        overwrite: bool,
    ) -> Path:
        if artifact_path is not None:
            return self._artifact_manager.save_success_envelope_to_path(
                artifact_path,
                envelope,
                overwrite=overwrite,
            )

        directory = self._require_live_artifact_directory(
            artifact_directory,
            artifact_role="success artifact",
        )
        return self._artifact_manager.save_success_envelope(
            directory,
            envelope,
            overwrite=overwrite,
        )

    def _save_failure_envelope(
        self,
        envelope: PersistedOrchestratorBridgeSessionFailureEnvelope,
        *,
        artifact_directory: str | Path | None,
        artifact_path: str | Path | None,
        overwrite: bool,
    ) -> Path:
        if artifact_path is not None:
            return self._artifact_manager.save_failure_envelope_to_path(
                artifact_path,
                envelope,
                overwrite=overwrite,
            )

        directory = self._require_live_artifact_directory(
            artifact_directory,
            artifact_role="failure artifact",
        )
        return self._artifact_manager.save_failure_envelope(
            directory,
            envelope,
            overwrite=overwrite,
        )

    @staticmethod
    def _require_live_artifact_directory(
        artifact_directory: str | Path | None,
        *,
        artifact_role: str,
    ) -> Path:
        if artifact_directory is None:
            raise ValueError(
                f"{artifact_role} persistence requires success/failure artifact_directory or explicit artifact_path"
            )
        return Path(artifact_directory)

    @staticmethod
    def _require_artifact_path(
        replay_request: OrchestratorBridgeServiceReplayRequest,
        *,
        explicit_artifact_path: str | Path | None,
        artifact_role: str,
    ) -> Path:
        if explicit_artifact_path is not None:
            return Path(explicit_artifact_path)
        if replay_request.artifact_path is not None:
            return replay_request.artifact_path
        raise ValueError(
            f"{artifact_role} replay requires a saved artifact path or a typed persisted artifact envelope"
        )

    def _resolve_persist_success_artifact(self, value: bool | None) -> bool:
        if value is not None:
            return value
        return self._config.persist_success_artifact_by_default

    def _resolve_persist_failure_artifact(self, value: bool | None) -> bool:
        if value is not None:
            return value
        return self._config.persist_failure_artifact_by_default

    def _resolve_replay_persistence_policy(
        self,
        persistence_policy: RuntimeBridgePersistencePolicy | None,
    ) -> RuntimeBridgePersistencePolicy:
        if persistence_policy is not None:
            return persistence_policy
        return self._config.default_replay_persistence_policy

    def _resolve_emit_recovery_after_replay(self, emit_recovery: bool | None) -> bool:
        if emit_recovery is not None:
            return emit_recovery
        return self._config.emit_recovery_after_replay_by_default


__all__ = [
    "OrchestratorBridgeService",
    "OrchestratorBridgeServiceArtifactPaths",
    "OrchestratorBridgeServiceConfig",
    "OrchestratorBridgeServiceFailure",
    "OrchestratorBridgeServiceHaltedError",
    "OrchestratorBridgeServiceLiveResult",
    "OrchestratorBridgeServiceReplayRequest",
    "OrchestratorBridgeServiceReplayResult",
    "OrchestratorBridgeServiceReplaySourceKind",
]
