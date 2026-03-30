from __future__ import annotations

from datetime import datetime
from typing import Iterable
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.protocol.events import ProtocolEvent
from packages.runtime.effect_forwarder import RuntimeEffectForwarder
from packages.runtime.recovery_snapshot import SessionRecoverySnapshot
from packages.runtime.runtime_persistence import (
    PersistedRuntimeBundle,
    PersistedRuntimeReplayEventRecord,
    PersistedRuntimeReplayLog,
    PersistedRuntimeSnapshotEnvelope,
)
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot
from packages.runtime.runtime_supervisor import RuntimeProcessResult, RuntimeSupervisor


class RuntimeReplayModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class RuntimeReplayConfig(RuntimeReplayModel):
    capture_step_snapshots: bool = False


class RuntimeReplayStepResult(RuntimeReplayModel):
    event_id: UUID
    session_id: UUID
    process_result: RuntimeProcessResult
    post_step_snapshot: RuntimeRegistrySnapshot | None = None


class RuntimeReplayResult(RuntimeReplayModel):
    total_input_event_count: int = Field(ge=0)
    successful_step_count: int = Field(ge=0)
    step_results: tuple[RuntimeReplayStepResult, ...] = ()
    final_runtime_snapshot: RuntimeRegistrySnapshot

    @model_validator(mode="after")
    def validate_counts(self) -> "RuntimeReplayResult":
        if self.successful_step_count != len(self.step_results):
            raise ValueError(
                "successful_step_count must match the number of replay step results"
            )

        if self.successful_step_count > self.total_input_event_count:
            raise ValueError(
                "successful_step_count cannot exceed total_input_event_count"
            )

        return self


class RuntimeReplayFailure(RuntimeReplayModel):
    failed_event_index: int = Field(ge=0)
    failed_event_id: UUID
    failed_session_id: UUID
    completed_step_count: int = Field(ge=0)
    partial_runtime_snapshot: RuntimeRegistrySnapshot
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str


class RuntimeReplayHaltedError(RuntimeError):
    def __init__(self, failure: RuntimeReplayFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: RuntimeReplayFailure) -> str:
        return (
            "runtime replay halted at event index "
            f"{failure.failed_event_index} "
            f"({failure.exception_type}: {failure.exception_message})"
        )


class RuntimeReplayer:
    """Bounded in-process replay shell above the runtime supervisor.

    The replayer owns exactly one `RuntimeSupervisor` and re-enters the runtime
    only through that shell's public processing entrypoint. It does not reach
    into the registry or session internals directly, even when replay starts
    from a snapshot.
    """

    def __init__(
        self,
        *,
        supervisor: RuntimeSupervisor | None = None,
        config: RuntimeReplayConfig | None = None,
    ) -> None:
        self._supervisor = supervisor if supervisor is not None else RuntimeSupervisor()
        self._config = config if config is not None else RuntimeReplayConfig()

    @classmethod
    def from_snapshot(
        cls,
        snapshot: RuntimeRegistrySnapshot,
        *,
        effect_forwarder: RuntimeEffectForwarder | None = None,
        config: RuntimeReplayConfig | None = None,
    ) -> "RuntimeReplayer":
        return cls(
            supervisor=RuntimeSupervisor.from_snapshot(
                snapshot,
                effect_forwarder=effect_forwarder,
            ),
            config=config,
        )

    @classmethod
    def from_persisted_snapshot(
        cls,
        envelope: PersistedRuntimeSnapshotEnvelope,
        *,
        effect_forwarder: RuntimeEffectForwarder | None = None,
        config: RuntimeReplayConfig | None = None,
    ) -> "RuntimeReplayer":
        return cls(
            supervisor=RuntimeSupervisor.from_persisted_snapshot(
                envelope,
                effect_forwarder=effect_forwarder,
            ),
            config=config,
        )

    @classmethod
    def from_persisted_bundle(
        cls,
        bundle: PersistedRuntimeBundle,
        *,
        effect_forwarder: RuntimeEffectForwarder | None = None,
        config: RuntimeReplayConfig | None = None,
    ) -> "RuntimeReplayer":
        return cls.from_persisted_snapshot(
            bundle.snapshot_envelope,
            effect_forwarder=effect_forwarder,
            config=config,
        )

    def build_snapshot(self) -> RuntimeRegistrySnapshot:
        return self._supervisor.build_snapshot()

    def get_config(self) -> RuntimeReplayConfig:
        return self._config

    def get_effect_forwarder(self) -> RuntimeEffectForwarder:
        return self._supervisor.get_effect_forwarder()

    def clone_from_snapshot(
        self,
        snapshot: RuntimeRegistrySnapshot,
    ) -> "RuntimeReplayer":
        return type(self).from_snapshot(
            snapshot,
            effect_forwarder=self.get_effect_forwarder(),
            config=self.get_config(),
        )

    def build_replay_log(
        self,
        events: Iterable[ProtocolEvent],
    ) -> PersistedRuntimeReplayLog:
        ordered_events = self._normalize_events(events)
        return PersistedRuntimeReplayLog(
            event_records=tuple(
                PersistedRuntimeReplayEventRecord(
                    sequence_index=index,
                    event=event,
                )
                for index, event in enumerate(ordered_events)
            )
        )

    def build_persisted_bundle(
        self,
        events: Iterable[ProtocolEvent],
        *,
        snapshot_saved_at: datetime | None = None,
    ) -> PersistedRuntimeBundle:
        return PersistedRuntimeBundle(
            snapshot_envelope=self._supervisor.build_persisted_snapshot(
                saved_at=snapshot_saved_at
            ),
            replay_log=self.build_replay_log(events),
        )

    def get_recovery_snapshot(self, session_id: UUID) -> SessionRecoverySnapshot:
        return self._supervisor.get_recovery_snapshot(session_id)

    def peek_recovery_snapshots(self) -> tuple[SessionRecoverySnapshot, ...]:
        return self._supervisor.peek_recovery_snapshots()

    def replay_events(
        self,
        events: Iterable[ProtocolEvent],
    ) -> RuntimeReplayResult:
        ordered_events = self._normalize_events(events)
        step_results: list[RuntimeReplayStepResult] = []

        for event_index, event in enumerate(ordered_events):
            try:
                step_results.append(
                    self._replay_single_event(
                        event=event,
                        event_index=event_index,
                    )
                )
            except Exception as exc:
                self._raise_halted_error(
                    event_index=event_index,
                    event=event,
                    completed_step_count=len(step_results),
                    cause=exc,
                )

        return self._build_replay_result(
            total_input_event_count=len(ordered_events),
            step_results=tuple(step_results),
        )

    def replay_persisted_log(
        self,
        replay_log: PersistedRuntimeReplayLog,
    ) -> RuntimeReplayResult:
        return self.replay_events(
            tuple(record.event for record in replay_log.event_records)
        )

    def replay_persisted_bundle(
        self,
        bundle: PersistedRuntimeBundle,
    ) -> RuntimeReplayResult:
        return self.replay_persisted_log(bundle.replay_log)

    @staticmethod
    def _normalize_events(
        events: Iterable[ProtocolEvent],
    ) -> tuple[ProtocolEvent, ...]:
        return tuple(events)

    def _replay_single_event(
        self,
        *,
        event: ProtocolEvent,
        event_index: int,
    ) -> RuntimeReplayStepResult:
        process_result = self._process_replay_event(event)
        post_step_snapshot = self._capture_post_step_snapshot(
            event=event,
            event_index=event_index,
        )
        return self._build_step_result(
            event=event,
            process_result=process_result,
            post_step_snapshot=post_step_snapshot,
        )

    def _process_replay_event(
        self,
        event: ProtocolEvent,
    ) -> RuntimeProcessResult:
        return self._supervisor.process_event(event)

    def _capture_post_step_snapshot(
        self,
        *,
        event: ProtocolEvent,
        event_index: int,
    ) -> RuntimeRegistrySnapshot | None:
        if not self._config.capture_step_snapshots:
            return None

        return self._build_post_step_snapshot(
            event=event,
            event_index=event_index,
        )

    def _build_post_step_snapshot(
        self,
        *,
        event: ProtocolEvent,
        event_index: int,
    ) -> RuntimeRegistrySnapshot:
        del event
        del event_index
        return self.build_snapshot()

    @staticmethod
    def _build_step_result(
        *,
        event: ProtocolEvent,
        process_result: RuntimeProcessResult,
        post_step_snapshot: RuntimeRegistrySnapshot | None,
    ) -> RuntimeReplayStepResult:
        return RuntimeReplayStepResult(
            event_id=event.event_id,
            session_id=event.session_id,
            process_result=process_result,
            post_step_snapshot=post_step_snapshot,
        )

    def _build_replay_result(
        self,
        *,
        total_input_event_count: int,
        step_results: tuple[RuntimeReplayStepResult, ...],
    ) -> RuntimeReplayResult:
        return RuntimeReplayResult(
            total_input_event_count=total_input_event_count,
            successful_step_count=len(step_results),
            step_results=step_results,
            final_runtime_snapshot=self.build_snapshot(),
        )

    def _raise_halted_error(
        self,
        *,
        event_index: int,
        event: ProtocolEvent,
        completed_step_count: int,
        cause: Exception,
    ) -> None:
        failure = self._build_failure(
            event_index=event_index,
            event=event,
            completed_step_count=completed_step_count,
            cause=cause,
        )
        raise RuntimeReplayHaltedError(failure) from cause

    def _build_failure(
        self,
        *,
        event_index: int,
        event: ProtocolEvent,
        completed_step_count: int,
        cause: Exception,
    ) -> RuntimeReplayFailure:
        return RuntimeReplayFailure(
            failed_event_index=event_index,
            failed_event_id=event.event_id,
            failed_session_id=event.session_id,
            completed_step_count=completed_step_count,
            partial_runtime_snapshot=self._build_halt_snapshot(),
            exception_type=self._extract_exception_type(cause),
            exception_message=self._extract_exception_message(cause),
        )

    def _build_halt_snapshot(self) -> RuntimeRegistrySnapshot:
        return self.build_snapshot()

    @staticmethod
    def _extract_exception_type(cause: Exception) -> str:
        return type(cause).__name__

    @staticmethod
    def _extract_exception_message(cause: Exception) -> str:
        return str(cause)
