from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.orchestrator.turn_orchestrator import (
    ProtocolEventSinkPort,
    TurnContext,
    TurnOrchestrator,
)
from packages.protocol.events import BaseEvent, ProtocolEvent
from packages.runtime.runtime_bridge import (
    RuntimeBridgeFailure,
    RuntimeBridgeHaltedError,
    RuntimeBridgeLiveResult,
    RuntimeBridgePersistencePolicy,
    RuntimeBridgeRunner,
    RuntimeEgressSinkPort,
    RuntimeIngressSourcePort,
)
from packages.runtime.runtime_service import (
    RuntimeIngressBatch,
    RuntimeIngressEnvelope,
    RuntimeProcessBatchResult,
    RuntimeProcessEgressEnvelope,
    RuntimeRecoveryInspectionEnvelope,
    RuntimeReplayEgressEnvelope,
)
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot

FailureOrigin = Literal["orchestrator", "runtime_bridge"]
RuntimeSinkEmissionKind = Literal[
    "process_egress_envelope",
    "process_batch_result",
    "replay_egress_envelope",
    "recovery_inspection_envelope",
]


class OrchestratorRuntimeBridgeModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class RuntimeSinkEmissionRecord(OrchestratorRuntimeBridgeModel):
    emission_kind: RuntimeSinkEmissionKind
    emission_index: int = Field(ge=0)
    process_event_id: UUID | None = None
    batch_successful_envelope_count: int | None = Field(default=None, ge=0)
    replay_successful_step_count: int | None = Field(default=None, ge=0)
    recovery_snapshot_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_shape(self) -> "RuntimeSinkEmissionRecord":
        if self.emission_kind == "process_egress_envelope":
            if self.process_event_id is None:
                raise ValueError(
                    "process_egress_envelope emission record requires process_event_id"
                )
            return self

        if self.emission_kind == "process_batch_result":
            if self.batch_successful_envelope_count is None:
                raise ValueError(
                    "process_batch_result emission record requires "
                    "batch_successful_envelope_count"
                )
            return self

        if self.emission_kind == "replay_egress_envelope":
            if self.replay_successful_step_count is None:
                raise ValueError(
                    "replay_egress_envelope emission record requires "
                    "replay_successful_step_count"
                )
            return self

        if self.recovery_snapshot_count is None:
            raise ValueError(
                "recovery_inspection_envelope emission record requires "
                "recovery_snapshot_count"
            )
        return self


class RecordedRuntimeEgress(OrchestratorRuntimeBridgeModel):
    process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...] = ()
    process_batch_results: tuple[RuntimeProcessBatchResult, ...] = ()
    replay_egress_envelopes: tuple[RuntimeReplayEgressEnvelope, ...] = ()
    recovery_inspection_envelopes: tuple[RuntimeRecoveryInspectionEnvelope, ...] = ()
    emission_records: tuple[RuntimeSinkEmissionRecord, ...] = ()

    @model_validator(mode="after")
    def validate_emission_record_count(self) -> "RecordedRuntimeEgress":
        expected_record_count = (
            len(self.process_egress_envelopes)
            + len(self.process_batch_results)
            + len(self.replay_egress_envelopes)
            + len(self.recovery_inspection_envelopes)
        )
        if len(self.emission_records) != expected_record_count:
            raise ValueError(
                "recorded runtime egress emission_records must account for every "
                "captured runtime sink emission exactly once"
            )
        return self


class OrchestratorRuntimeBridgeConfig(OrchestratorRuntimeBridgeModel):
    emit_recovery_after_live_runtime_drain: bool = False
    default_runtime_bridge_persistence_policy: RuntimeBridgePersistencePolicy = Field(
        default_factory=RuntimeBridgePersistencePolicy
    )
    default_runtime_source_label: str = Field(
        default="bridge.turn.runtime",
        min_length=1,
        max_length=128,
    )


class OrchestratorRuntimeBridgeResult(OrchestratorRuntimeBridgeModel):
    turn_context: TurnContext
    protocol_events: tuple[BaseEvent, ...] = ()
    runtime_live_results: tuple[RuntimeBridgeLiveResult, ...] = ()
    recorded_process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...] = ()
    recorded_process_batch_results: tuple[RuntimeProcessBatchResult, ...] = ()
    recorded_replay_egress_envelopes: tuple[RuntimeReplayEgressEnvelope, ...] = ()
    recorded_recovery_inspection_envelopes: tuple[
        RuntimeRecoveryInspectionEnvelope, ...
    ] = ()
    runtime_sink_emission_records: tuple[RuntimeSinkEmissionRecord, ...] = ()
    final_runtime_snapshot: RuntimeRegistrySnapshot

    @model_validator(mode="after")
    def validate_live_batch_alignment(self) -> "OrchestratorRuntimeBridgeResult":
        if not self.runtime_live_results:
            return self

        if len(self.runtime_live_results) != 1:
            raise ValueError(
                "after-turn bridge result must preserve exactly one live batch "
                "result when protocol events were drained"
            )

        runtime_live_result = self.runtime_live_results[0]
        ingressed_events = tuple(
            envelope.event for envelope in runtime_live_result.consumed_ingress_batch.envelopes
        )
        if ingressed_events != self.protocol_events:
            raise ValueError(
                "after-turn bridge result protocol_events must match the single "
                "drained live batch event order exactly"
            )

        return self


# Task 0033 named this public result surface OrchestratorRuntimeBridgeTurnResult.
# Keep the original class name for compatibility while exporting the task-aligned name.
OrchestratorRuntimeBridgeTurnResult = OrchestratorRuntimeBridgeResult


class OrchestratorRuntimeBridgeFailure(OrchestratorRuntimeBridgeModel):
    failure_origin: FailureOrigin
    turn_context: TurnContext
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str
    collected_protocol_events: tuple[BaseEvent, ...] = ()
    drained_protocol_events: tuple[BaseEvent, ...] = ()
    undrained_protocol_events: tuple[BaseEvent, ...] = ()
    runtime_live_results: tuple[RuntimeBridgeLiveResult, ...] = ()
    recorded_process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...] = ()
    recorded_process_batch_results: tuple[RuntimeProcessBatchResult, ...] = ()
    recorded_replay_egress_envelopes: tuple[RuntimeReplayEgressEnvelope, ...] = ()
    recorded_recovery_inspection_envelopes: tuple[
        RuntimeRecoveryInspectionEnvelope, ...
    ] = ()
    runtime_sink_emission_records: tuple[RuntimeSinkEmissionRecord, ...] = ()
    partial_runtime_snapshot: RuntimeRegistrySnapshot | None = None
    runtime_bridge_failure: RuntimeBridgeFailure | None = None

    @model_validator(mode="after")
    def validate_drain_partition(self) -> "OrchestratorRuntimeBridgeFailure":
        expected_partition = self.drained_protocol_events + self.undrained_protocol_events
        if expected_partition and expected_partition != self.collected_protocol_events:
            raise ValueError(
                "after-turn bridge failure drained_protocol_events plus "
                "undrained_protocol_events must match collected_protocol_events"
            )
        return self


class OrchestratorRuntimeBridgeHaltedError(RuntimeError):
    def __init__(self, failure: OrchestratorRuntimeBridgeFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: OrchestratorRuntimeBridgeFailure) -> str:
        return (
            f"orchestrator/runtime bridge halted on {failure.failure_origin} side "
            f"({failure.exception_type}: {failure.exception_message})"
        )


class OrchestratorRuntimeBridgeSessionConfig(OrchestratorRuntimeBridgeModel):
    emit_recovery_after_each_successful_live_step: bool = False
    capture_post_step_runtime_snapshots: bool = False
    default_runtime_bridge_persistence_policy: RuntimeBridgePersistencePolicy = Field(
        default_factory=RuntimeBridgePersistencePolicy
    )
    default_runtime_source_label: str = Field(
        default="bridge.turn.session.runtime",
        min_length=1,
        max_length=128,
    )


class OrchestratorRuntimeBridgeStepResult(OrchestratorRuntimeBridgeModel):
    drained_protocol_event: BaseEvent
    live_result: RuntimeBridgeLiveResult
    post_step_runtime_snapshot: RuntimeRegistrySnapshot | None = None

    @model_validator(mode="after")
    def validate_single_event_live_result(self) -> "OrchestratorRuntimeBridgeStepResult":
        consumed_envelopes = self.live_result.consumed_ingress_batch.envelopes
        if len(consumed_envelopes) != 1:
            raise ValueError(
                "turn-active bridge step results must preserve exactly one "
                "ingress envelope per drained protocol event"
            )

        drained_event_id = self.drained_protocol_event.event_id
        consumed_event_id = consumed_envelopes[0].event.event_id
        if drained_event_id != consumed_event_id:
            raise ValueError(
                "turn-active bridge step result drained_protocol_event must match "
                "the single runtime live result envelope event exactly"
            )

        return self


class OrchestratorRuntimeBridgeSessionResult(OrchestratorRuntimeBridgeModel):
    turn_context: TurnContext
    collected_protocol_events: tuple[BaseEvent, ...] = ()
    drained_protocol_events: tuple[BaseEvent, ...] = ()
    undrained_protocol_events: tuple[BaseEvent, ...] = ()
    step_results: tuple[OrchestratorRuntimeBridgeStepResult, ...] = ()
    recorded_process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...] = ()
    recorded_process_batch_results: tuple[RuntimeProcessBatchResult, ...] = ()
    recorded_replay_egress_envelopes: tuple[RuntimeReplayEgressEnvelope, ...] = ()
    recorded_recovery_inspection_envelopes: tuple[
        RuntimeRecoveryInspectionEnvelope, ...
    ] = ()
    runtime_sink_emission_records: tuple[RuntimeSinkEmissionRecord, ...] = ()
    final_runtime_snapshot: RuntimeRegistrySnapshot

    @property
    def runtime_live_results(self) -> tuple[RuntimeBridgeLiveResult, ...]:
        return tuple(step_result.live_result for step_result in self.step_results)

    @model_validator(mode="after")
    def validate_ordered_partition(self) -> "OrchestratorRuntimeBridgeSessionResult":
        expected_partition = self.drained_protocol_events + self.undrained_protocol_events
        if expected_partition != self.collected_protocol_events:
            raise ValueError(
                "turn-active bridge session result must preserve collected event "
                "order as drained prefix plus undrained tail"
            )

        expected_step_events = tuple(
            step_result.drained_protocol_event for step_result in self.step_results
        )
        if expected_step_events != self.drained_protocol_events:
            raise ValueError(
                "turn-active bridge session result step_results order must match "
                "drained_protocol_events exactly"
            )

        return self


class OrchestratorRuntimeBridgeSessionFailure(OrchestratorRuntimeBridgeModel):
    failure_origin: FailureOrigin
    turn_context: TurnContext
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str
    collected_protocol_events: tuple[BaseEvent, ...] = ()
    drained_protocol_events: tuple[BaseEvent, ...] = ()
    undrained_protocol_events: tuple[BaseEvent, ...] = ()
    step_results: tuple[OrchestratorRuntimeBridgeStepResult, ...] = ()
    recorded_process_egress_envelopes: tuple[RuntimeProcessEgressEnvelope, ...] = ()
    recorded_process_batch_results: tuple[RuntimeProcessBatchResult, ...] = ()
    recorded_replay_egress_envelopes: tuple[RuntimeReplayEgressEnvelope, ...] = ()
    recorded_recovery_inspection_envelopes: tuple[
        RuntimeRecoveryInspectionEnvelope, ...
    ] = ()
    runtime_sink_emission_records: tuple[RuntimeSinkEmissionRecord, ...] = ()
    partial_runtime_snapshot: RuntimeRegistrySnapshot | None = None
    runtime_bridge_failure: RuntimeBridgeFailure | None = None

    @property
    def runtime_live_results(self) -> tuple[RuntimeBridgeLiveResult, ...]:
        return tuple(step_result.live_result for step_result in self.step_results)

    @model_validator(mode="after")
    def validate_ordered_partition(self) -> "OrchestratorRuntimeBridgeSessionFailure":
        expected_partition = self.drained_protocol_events + self.undrained_protocol_events
        if expected_partition and expected_partition != self.collected_protocol_events:
            raise ValueError(
                "turn-active bridge session failure must preserve collected event "
                "order as drained prefix plus undrained tail"
            )

        expected_step_events = tuple(
            step_result.drained_protocol_event for step_result in self.step_results
        )
        if expected_step_events != self.drained_protocol_events:
            raise ValueError(
                "turn-active bridge session failure step_results order must match "
                "drained_protocol_events exactly"
            )

        return self


class OrchestratorRuntimeBridgeSessionHaltedError(RuntimeError):
    def __init__(self, failure: OrchestratorRuntimeBridgeSessionFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: OrchestratorRuntimeBridgeSessionFailure) -> str:
        return (
            f"turn-active orchestrator/runtime bridge session halted on "
            f"{failure.failure_origin} side "
            f"({failure.exception_type}: {failure.exception_message})"
        )


@dataclass(slots=True)
class _TurnActiveDrainState:
    drained_protocol_events: list[BaseEvent] = field(default_factory=list)
    step_results: list[OrchestratorRuntimeBridgeStepResult] = field(default_factory=list)
    runtime_bridge_halt: RuntimeBridgeHaltedError | None = None
    last_runtime_snapshot: RuntimeRegistrySnapshot | None = None


class BufferedProtocolEventSink(ProtocolEventSinkPort):
    """In-memory protocol-event collector for deterministic after-turn draining."""

    def __init__(self) -> None:
        self._events: list[BaseEvent] = []

    async def send_protocol_event(self, event: BaseEvent) -> None:
        self._events.append(event)

    def peek_events(self) -> tuple[BaseEvent, ...]:
        return tuple(self._events)

    def drain_events(self) -> tuple[BaseEvent, ...]:
        drained = tuple(self._events)
        self._events.clear()
        return drained

    def is_empty(self) -> bool:
        return not self._events

    def __len__(self) -> int:
        return len(self._events)


class QueuedProtocolEventSink(ProtocolEventSinkPort):
    """Queued turn-scoped protocol-event collector for live bridge draining."""

    def __init__(self) -> None:
        self._event_log: list[BaseEvent] = []
        self._queue: asyncio.Queue[BaseEvent | None] = asyncio.Queue()
        self._closed = False
        self._end_of_stream_observed = False

    async def send_protocol_event(self, event: BaseEvent) -> None:
        if self._closed:
            raise RuntimeError("queued protocol event sink is closed")
        self._event_log.append(event)
        await self._queue.put(event)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._queue.put(None)

    async def wait_for_next_event(self) -> BaseEvent | None:
        if self._closed and self._end_of_stream_observed:
            return None
        item = await self._queue.get()
        if item is None:
            self._end_of_stream_observed = True
            return None
        return item

    def peek_events(self) -> tuple[BaseEvent, ...]:
        return tuple(self._event_log)

    def event_count(self) -> int:
        return len(self._event_log)

    def is_closed(self) -> bool:
        return self._closed

    def has_observed_end_of_stream(self) -> bool:
        return self._end_of_stream_observed


class _EnvelopeBufferRuntimeIngressSource(RuntimeIngressSourcePort):
    def __init__(
        self,
        *,
        runtime_bridge_runner: RuntimeBridgeRunner,
        envelopes: Iterable[RuntimeIngressEnvelope] = (),
    ) -> None:
        self._runtime_bridge_runner = runtime_bridge_runner
        self._pending_envelopes: list[RuntimeIngressEnvelope] = list(envelopes)

    def is_empty(self) -> bool:
        return not self._pending_envelopes

    def queued_envelope_count(self) -> int:
        return len(self._pending_envelopes)

    def peek_envelopes(self) -> tuple[RuntimeIngressEnvelope, ...]:
        return tuple(self._pending_envelopes)

    def pull_ingress_envelope(self) -> RuntimeIngressEnvelope | None:
        if not self._pending_envelopes:
            return None
        return self._pending_envelopes.pop(0)

    def pull_ingress_batch(self) -> RuntimeIngressBatch | None:
        if not self._pending_envelopes:
            return None

        batch = self._runtime_bridge_runner.build_ingress_batch(
            tuple(self._pending_envelopes)
        )
        self._pending_envelopes.clear()
        return batch


class BufferedRuntimeIngressSource(_EnvelopeBufferRuntimeIngressSource):
    @classmethod
    def from_protocol_events(
        cls,
        protocol_events: Iterable[BaseEvent],
        *,
        runtime_bridge_runner: RuntimeBridgeRunner,
        source_label: str | None = None,
    ) -> "BufferedRuntimeIngressSource":
        envelopes = runtime_bridge_runner.build_ingress_envelopes(
            _cast_protocol_events(protocol_events),
            source_label=source_label,
        )
        return cls(
            runtime_bridge_runner=runtime_bridge_runner,
            envelopes=envelopes,
        )


class SingleEnvelopeRuntimeIngressSource(_EnvelopeBufferRuntimeIngressSource):
    @classmethod
    def from_protocol_event(
        cls,
        protocol_event: BaseEvent,
        *,
        runtime_bridge_runner: RuntimeBridgeRunner,
        source_label: str | None = None,
    ) -> "SingleEnvelopeRuntimeIngressSource":
        envelope = runtime_bridge_runner.build_ingress_envelope(
            _cast_protocol_event(protocol_event),
            source_label=source_label,
        )
        return cls(
            runtime_bridge_runner=runtime_bridge_runner,
            envelopes=(envelope,),
        )

    def peek_envelope(self) -> RuntimeIngressEnvelope | None:
        if self.is_empty():
            return None
        return self.peek_envelopes()[0]


class RecordingRuntimeEgressSink(RuntimeEgressSinkPort):
    """Typed in-memory runtime egress recorder shared by both bridge paths."""

    def __init__(self) -> None:
        self._process_egress_envelopes: list[RuntimeProcessEgressEnvelope] = []
        self._process_batch_results: list[RuntimeProcessBatchResult] = []
        self._replay_egress_envelopes: list[RuntimeReplayEgressEnvelope] = []
        self._recovery_inspection_envelopes: list[RuntimeRecoveryInspectionEnvelope] = []
        self._emission_records: list[RuntimeSinkEmissionRecord] = []

    def emit_process_egress_envelope(
        self,
        envelope: RuntimeProcessEgressEnvelope,
    ) -> None:
        self._process_egress_envelopes.append(envelope)
        self._emission_records.append(
            RuntimeSinkEmissionRecord(
                emission_kind="process_egress_envelope",
                emission_index=len(self._emission_records),
                process_event_id=envelope.process_result.apply_result.next_state.last_event_id,
            )
        )

    def emit_process_batch_result(
        self,
        result: RuntimeProcessBatchResult,
    ) -> None:
        self._process_batch_results.append(result)
        self._emission_records.append(
            RuntimeSinkEmissionRecord(
                emission_kind="process_batch_result",
                emission_index=len(self._emission_records),
                batch_successful_envelope_count=result.successful_envelope_count,
            )
        )

    def emit_replay_egress_envelope(
        self,
        envelope: RuntimeReplayEgressEnvelope,
    ) -> None:
        self._replay_egress_envelopes.append(envelope)
        self._emission_records.append(
            RuntimeSinkEmissionRecord(
                emission_kind="replay_egress_envelope",
                emission_index=len(self._emission_records),
                replay_successful_step_count=envelope.replay_result.successful_step_count,
            )
        )

    def emit_recovery_inspection_envelope(
        self,
        envelope: RuntimeRecoveryInspectionEnvelope,
    ) -> None:
        self._recovery_inspection_envelopes.append(envelope)
        self._emission_records.append(
            RuntimeSinkEmissionRecord(
                emission_kind="recovery_inspection_envelope",
                emission_index=len(self._emission_records),
                recovery_snapshot_count=len(envelope.recovery_snapshots),
            )
        )

    def peek_process_egress_envelopes(self) -> tuple[RuntimeProcessEgressEnvelope, ...]:
        return tuple(self._process_egress_envelopes)

    def peek_process_batch_results(self) -> tuple[RuntimeProcessBatchResult, ...]:
        return tuple(self._process_batch_results)

    def peek_replay_egress_envelopes(self) -> tuple[RuntimeReplayEgressEnvelope, ...]:
        return tuple(self._replay_egress_envelopes)

    def peek_recovery_inspection_envelopes(
        self,
    ) -> tuple[RuntimeRecoveryInspectionEnvelope, ...]:
        return tuple(self._recovery_inspection_envelopes)

    def peek_emission_records(self) -> tuple[RuntimeSinkEmissionRecord, ...]:
        return tuple(self._emission_records)

    def peek_emission_order(self) -> tuple[tuple[str, object], ...]:
        ordered: list[tuple[str, object]] = []
        for record in self._emission_records:
            if record.emission_kind == "process_egress_envelope":
                ordered.append((record.emission_kind, record.process_event_id))
                continue

            if record.emission_kind == "process_batch_result":
                ordered.append(
                    (
                        record.emission_kind,
                        record.batch_successful_envelope_count,
                    )
                )
                continue

            if record.emission_kind == "replay_egress_envelope":
                ordered.append(
                    (
                        record.emission_kind,
                        record.replay_successful_step_count,
                    )
                )
                continue

            ordered.append((record.emission_kind, record.recovery_snapshot_count))

        return tuple(ordered)

    def build_capture(self) -> RecordedRuntimeEgress:
        return RecordedRuntimeEgress(
            process_egress_envelopes=self.peek_process_egress_envelopes(),
            process_batch_results=self.peek_process_batch_results(),
            replay_egress_envelopes=self.peek_replay_egress_envelopes(),
            recovery_inspection_envelopes=self.peek_recovery_inspection_envelopes(),
            emission_records=self.peek_emission_records(),
        )


class _OrchestratorRuntimeBridgeSupport:
    def __init__(
        self,
        *,
        turn_orchestrator: TurnOrchestrator,
        runtime_bridge_runner: RuntimeBridgeRunner,
    ) -> None:
        self._turn_orchestrator = turn_orchestrator
        self._runtime_bridge_runner = runtime_bridge_runner

    def get_turn_orchestrator(self) -> TurnOrchestrator:
        return self._turn_orchestrator

    def get_runtime_bridge_runner(self) -> RuntimeBridgeRunner:
        return self._runtime_bridge_runner

    def _attach_protocol_sink(
        self,
        sink: ProtocolEventSinkPort,
    ) -> ProtocolEventSinkPort | None:
        previous_sink = self._turn_orchestrator.get_protocol_event_sink()
        self._turn_orchestrator.set_protocol_event_sink(sink)
        return previous_sink

    def _restore_protocol_sink(
        self,
        previous_sink: ProtocolEventSinkPort | None,
    ) -> None:
        self._turn_orchestrator.set_protocol_event_sink(previous_sink)

    def _build_buffered_runtime_ingress_source(
        self,
        protocol_events: Iterable[BaseEvent],
        *,
        source_label: str | None,
    ) -> BufferedRuntimeIngressSource:
        return BufferedRuntimeIngressSource.from_protocol_events(
            protocol_events,
            runtime_bridge_runner=self._runtime_bridge_runner,
            source_label=source_label,
        )

    def _build_single_envelope_runtime_ingress_source(
        self,
        protocol_event: BaseEvent,
        *,
        source_label: str | None,
    ) -> SingleEnvelopeRuntimeIngressSource:
        return SingleEnvelopeRuntimeIngressSource.from_protocol_event(
            protocol_event,
            runtime_bridge_runner=self._runtime_bridge_runner,
            source_label=source_label,
        )

    def _safe_build_runtime_snapshot(self) -> RuntimeRegistrySnapshot | None:
        try:
            return self._runtime_bridge_runner.build_runtime_snapshot()
        except Exception:
            return None

    def _require_runtime_snapshot(self) -> RuntimeRegistrySnapshot:
        snapshot = self._safe_build_runtime_snapshot()
        if snapshot is None:
            raise RuntimeError("runtime bridge could not build a final runtime snapshot")
        return snapshot

    @staticmethod
    def _best_available_snapshot(
        *snapshots: RuntimeRegistrySnapshot | None,
    ) -> RuntimeRegistrySnapshot | None:
        for snapshot in snapshots:
            if snapshot is not None:
                return snapshot
        return None

    @staticmethod
    def _capture_to_result_fields(
        capture: RecordedRuntimeEgress,
    ) -> dict[str, object]:
        return {
            "recorded_process_egress_envelopes": capture.process_egress_envelopes,
            "recorded_process_batch_results": capture.process_batch_results,
            "recorded_replay_egress_envelopes": capture.replay_egress_envelopes,
            "recorded_recovery_inspection_envelopes": (
                capture.recovery_inspection_envelopes
            ),
            "runtime_sink_emission_records": capture.emission_records,
        }

    @staticmethod
    def _compute_undrained_tail(
        collected_protocol_events: Iterable[BaseEvent],
        drained_protocol_events: Iterable[BaseEvent],
    ) -> tuple[BaseEvent, ...]:
        collected = tuple(collected_protocol_events)
        drained = tuple(drained_protocol_events)
        return collected[len(drained) :]

    @staticmethod
    def _build_synthetic_runtime_bridge_halt(
        cause: Exception,
        *,
        partial_runtime_snapshot: RuntimeRegistrySnapshot | None,
    ) -> RuntimeBridgeHaltedError:
        return RuntimeBridgeHaltedError(
            RuntimeBridgeFailure(
                runner_path="run_single_envelope",
                exception_type=type(cause).__name__,
                exception_message=str(cause),
                partial_runtime_snapshot=partial_runtime_snapshot,
            )
        )


class OrchestratorRuntimeBridge(_OrchestratorRuntimeBridgeSupport):
    """Deterministic after-turn in-process bridge kept for regression safety."""

    def __init__(
        self,
        *,
        turn_orchestrator: TurnOrchestrator,
        runtime_bridge_runner: RuntimeBridgeRunner,
        config: OrchestratorRuntimeBridgeConfig | None = None,
    ) -> None:
        super().__init__(
            turn_orchestrator=turn_orchestrator,
            runtime_bridge_runner=runtime_bridge_runner,
        )
        self._config = (
            config if config is not None else OrchestratorRuntimeBridgeConfig()
        )

    def get_config(self) -> OrchestratorRuntimeBridgeConfig:
        return self._config

    def build_protocol_event_sink(self) -> BufferedProtocolEventSink:
        return BufferedProtocolEventSink()

    def build_runtime_egress_sink(self) -> RecordingRuntimeEgressSink:
        return RecordingRuntimeEgressSink()

    async def run_turn(
        self,
        ctx: TurnContext,
    ) -> OrchestratorRuntimeBridgeTurnResult:
        protocol_sink = self.build_protocol_event_sink()
        runtime_egress_sink = self.build_runtime_egress_sink()
        previous_sink = self._attach_protocol_sink(protocol_sink)

        try:
            await self.get_turn_orchestrator().handle_user_turn(ctx)
        except Exception as exc:
            collected_protocol_events = protocol_sink.peek_events()
            recorded_capture = runtime_egress_sink.build_capture()
            failure = OrchestratorRuntimeBridgeFailure(
                failure_origin="orchestrator",
                turn_context=ctx,
                exception_type=type(exc).__name__,
                exception_message=str(exc),
                collected_protocol_events=collected_protocol_events,
                undrained_protocol_events=collected_protocol_events,
                partial_runtime_snapshot=self._safe_build_runtime_snapshot(),
                **self._capture_to_result_fields(recorded_capture),
            )
            raise OrchestratorRuntimeBridgeHaltedError(failure) from exc
        finally:
            self._restore_protocol_sink(previous_sink)

        protocol_events = protocol_sink.drain_events()
        if not protocol_events:
            recorded_capture = runtime_egress_sink.build_capture()
            return OrchestratorRuntimeBridgeResult(
                turn_context=ctx,
                protocol_events=protocol_events,
                runtime_live_results=(),
                final_runtime_snapshot=self._require_runtime_snapshot(),
                **self._capture_to_result_fields(recorded_capture),
            )

        ingress_source = self._build_buffered_runtime_ingress_source(
            protocol_events,
            source_label=self._config.default_runtime_source_label,
        )
        try:
            live_result = self.get_runtime_bridge_runner().run_next_batch(
                ingress_source,
                runtime_egress_sink,
                persistence_policy=self._config.default_runtime_bridge_persistence_policy,
                emit_recovery=self._config.emit_recovery_after_live_runtime_drain,
            )
            final_runtime_snapshot = self._require_runtime_snapshot()
        except RuntimeBridgeHaltedError as exc:
            recorded_capture = runtime_egress_sink.build_capture()
            failure = OrchestratorRuntimeBridgeFailure(
                failure_origin="runtime_bridge",
                turn_context=ctx,
                exception_type=type(exc).__name__,
                exception_message=str(exc),
                collected_protocol_events=protocol_events,
                undrained_protocol_events=protocol_events,
                partial_runtime_snapshot=self._best_available_snapshot(
                    exc.failure.partial_runtime_snapshot,
                    self._safe_build_runtime_snapshot(),
                ),
                runtime_bridge_failure=exc.failure,
                **self._capture_to_result_fields(recorded_capture),
            )
            raise OrchestratorRuntimeBridgeHaltedError(failure) from exc
        except Exception as exc:
            recorded_capture = runtime_egress_sink.build_capture()
            synthetic_halt = self._build_synthetic_runtime_bridge_halt(
                exc,
                partial_runtime_snapshot=self._safe_build_runtime_snapshot(),
            )
            failure = OrchestratorRuntimeBridgeFailure(
                failure_origin="runtime_bridge",
                turn_context=ctx,
                exception_type=type(exc).__name__,
                exception_message=str(exc),
                collected_protocol_events=protocol_events,
                undrained_protocol_events=protocol_events,
                partial_runtime_snapshot=synthetic_halt.failure.partial_runtime_snapshot,
                runtime_bridge_failure=synthetic_halt.failure,
                **self._capture_to_result_fields(recorded_capture),
            )
            raise OrchestratorRuntimeBridgeHaltedError(failure) from exc

        recorded_capture = runtime_egress_sink.build_capture()
        return OrchestratorRuntimeBridgeResult(
            turn_context=ctx,
            protocol_events=protocol_events,
            runtime_live_results=(live_result,),
            final_runtime_snapshot=final_runtime_snapshot,
            **self._capture_to_result_fields(recorded_capture),
        )


class OrchestratorRuntimeBridgeSession(_OrchestratorRuntimeBridgeSupport):
    """Turn-active incremental in-process bridge session above the after-turn path."""

    def __init__(
        self,
        *,
        turn_orchestrator: TurnOrchestrator,
        runtime_bridge_runner: RuntimeBridgeRunner,
        config: OrchestratorRuntimeBridgeSessionConfig | None = None,
    ) -> None:
        super().__init__(
            turn_orchestrator=turn_orchestrator,
            runtime_bridge_runner=runtime_bridge_runner,
        )
        self._config = (
            config if config is not None else OrchestratorRuntimeBridgeSessionConfig()
        )

    def get_config(self) -> OrchestratorRuntimeBridgeSessionConfig:
        return self._config

    def build_protocol_event_sink(self) -> QueuedProtocolEventSink:
        return QueuedProtocolEventSink()

    def build_runtime_egress_sink(self) -> RecordingRuntimeEgressSink:
        return RecordingRuntimeEgressSink()

    async def run_turn(
        self,
        ctx: TurnContext,
    ) -> OrchestratorRuntimeBridgeSessionResult:
        queued_protocol_sink = self.build_protocol_event_sink()
        runtime_egress_sink = self.build_runtime_egress_sink()
        drain_state = _TurnActiveDrainState()

        previous_sink = self._attach_protocol_sink(queued_protocol_sink)
        drain_task = asyncio.create_task(
            self._run_incremental_runtime_drain(
                queued_protocol_sink=queued_protocol_sink,
                runtime_egress_sink=runtime_egress_sink,
                drain_state=drain_state,
            )
        )

        orchestrator_error: Exception | None = None
        try:
            await self.get_turn_orchestrator().handle_user_turn(ctx)
        except Exception as exc:
            orchestrator_error = exc
        finally:
            await queued_protocol_sink.close()
            self._restore_protocol_sink(previous_sink)

        if orchestrator_error is not None:
            drain_task.cancel()
            try:
                await drain_task
            except asyncio.CancelledError:
                pass

            raise OrchestratorRuntimeBridgeSessionHaltedError(
                self._build_orchestrator_failure(
                    ctx=ctx,
                    queued_protocol_sink=queued_protocol_sink,
                    runtime_egress_sink=runtime_egress_sink,
                    drain_state=drain_state,
                    cause=orchestrator_error,
                )
            ) from orchestrator_error

        try:
            await drain_task
        except asyncio.CancelledError as exc:
            synthetic_halt = self._build_synthetic_runtime_bridge_halt(
                exc,
                partial_runtime_snapshot=self._safe_build_runtime_snapshot(),
            )
            drain_state.runtime_bridge_halt = synthetic_halt

        if drain_state.runtime_bridge_halt is not None:
            raise OrchestratorRuntimeBridgeSessionHaltedError(
                self._build_runtime_bridge_failure(
                    ctx=ctx,
                    queued_protocol_sink=queued_protocol_sink,
                    runtime_egress_sink=runtime_egress_sink,
                    drain_state=drain_state,
                    runtime_bridge_halt=drain_state.runtime_bridge_halt,
                )
            ) from drain_state.runtime_bridge_halt

        recorded_capture = runtime_egress_sink.build_capture()
        collected_protocol_events = queued_protocol_sink.peek_events()
        drained_protocol_events = tuple(drain_state.drained_protocol_events)
        return OrchestratorRuntimeBridgeSessionResult(
            turn_context=ctx,
            collected_protocol_events=collected_protocol_events,
            drained_protocol_events=drained_protocol_events,
            undrained_protocol_events=self._compute_undrained_tail(
                collected_protocol_events,
                drained_protocol_events,
            ),
            step_results=tuple(drain_state.step_results),
            final_runtime_snapshot=self._require_runtime_snapshot(),
            **self._capture_to_result_fields(recorded_capture),
        )

    async def _run_incremental_runtime_drain(
        self,
        *,
        queued_protocol_sink: QueuedProtocolEventSink,
        runtime_egress_sink: RecordingRuntimeEgressSink,
        drain_state: _TurnActiveDrainState,
    ) -> None:
        while True:
            next_event = await queued_protocol_sink.wait_for_next_event()
            if next_event is None:
                return

            try:
                step_result = self._drain_single_protocol_event(
                    next_event,
                    runtime_egress_sink=runtime_egress_sink,
                )
            except RuntimeBridgeHaltedError as exc:
                drain_state.runtime_bridge_halt = exc
                drain_state.last_runtime_snapshot = self._best_available_snapshot(
                    exc.failure.partial_runtime_snapshot,
                    drain_state.last_runtime_snapshot,
                    self._safe_build_runtime_snapshot(),
                )
                return
            except Exception as exc:
                synthetic_halt = self._build_synthetic_runtime_bridge_halt(
                    exc,
                    partial_runtime_snapshot=self._best_available_snapshot(
                        drain_state.last_runtime_snapshot,
                        self._safe_build_runtime_snapshot(),
                    ),
                )
                drain_state.runtime_bridge_halt = synthetic_halt
                drain_state.last_runtime_snapshot = synthetic_halt.failure.partial_runtime_snapshot
                return

            drain_state.drained_protocol_events.append(next_event)
            drain_state.step_results.append(step_result)
            if step_result.post_step_runtime_snapshot is not None:
                drain_state.last_runtime_snapshot = step_result.post_step_runtime_snapshot

    def _drain_single_protocol_event(
        self,
        protocol_event: BaseEvent,
        *,
        runtime_egress_sink: RecordingRuntimeEgressSink,
    ) -> OrchestratorRuntimeBridgeStepResult:
        ingress_source = self._build_single_envelope_runtime_ingress_source(
            protocol_event,
            source_label=self._config.default_runtime_source_label,
        )
        live_result = self.get_runtime_bridge_runner().run_single_envelope(
            ingress_source,
            runtime_egress_sink,
            persistence_policy=self._config.default_runtime_bridge_persistence_policy,
            emit_recovery=self._config.emit_recovery_after_each_successful_live_step,
        )

        post_step_snapshot = (
            self._safe_build_runtime_snapshot()
            if self._config.capture_post_step_runtime_snapshots
            else None
        )
        return OrchestratorRuntimeBridgeStepResult(
            drained_protocol_event=protocol_event,
            live_result=live_result,
            post_step_runtime_snapshot=post_step_snapshot,
        )

    def _build_orchestrator_failure(
        self,
        *,
        ctx: TurnContext,
        queued_protocol_sink: QueuedProtocolEventSink,
        runtime_egress_sink: RecordingRuntimeEgressSink,
        drain_state: _TurnActiveDrainState,
        cause: Exception,
    ) -> OrchestratorRuntimeBridgeSessionFailure:
        recorded_capture = runtime_egress_sink.build_capture()
        collected_protocol_events = queued_protocol_sink.peek_events()
        drained_protocol_events = tuple(drain_state.drained_protocol_events)
        return OrchestratorRuntimeBridgeSessionFailure(
            failure_origin="orchestrator",
            turn_context=ctx,
            exception_type=type(cause).__name__,
            exception_message=str(cause),
            collected_protocol_events=collected_protocol_events,
            drained_protocol_events=drained_protocol_events,
            undrained_protocol_events=self._compute_undrained_tail(
                collected_protocol_events,
                drained_protocol_events,
            ),
            step_results=tuple(drain_state.step_results),
            partial_runtime_snapshot=self._best_available_snapshot(
                drain_state.last_runtime_snapshot,
                self._safe_build_runtime_snapshot(),
            ),
            **self._capture_to_result_fields(recorded_capture),
        )

    def _build_runtime_bridge_failure(
        self,
        *,
        ctx: TurnContext,
        queued_protocol_sink: QueuedProtocolEventSink,
        runtime_egress_sink: RecordingRuntimeEgressSink,
        drain_state: _TurnActiveDrainState,
        runtime_bridge_halt: RuntimeBridgeHaltedError,
    ) -> OrchestratorRuntimeBridgeSessionFailure:
        recorded_capture = runtime_egress_sink.build_capture()
        collected_protocol_events = queued_protocol_sink.peek_events()
        drained_protocol_events = tuple(drain_state.drained_protocol_events)
        return OrchestratorRuntimeBridgeSessionFailure(
            failure_origin="runtime_bridge",
            turn_context=ctx,
            exception_type=type(runtime_bridge_halt).__name__,
            exception_message=str(runtime_bridge_halt),
            collected_protocol_events=collected_protocol_events,
            drained_protocol_events=drained_protocol_events,
            undrained_protocol_events=self._compute_undrained_tail(
                collected_protocol_events,
                drained_protocol_events,
            ),
            step_results=tuple(drain_state.step_results),
            partial_runtime_snapshot=self._best_available_snapshot(
                runtime_bridge_halt.failure.partial_runtime_snapshot,
                drain_state.last_runtime_snapshot,
                self._safe_build_runtime_snapshot(),
            ),
            runtime_bridge_failure=runtime_bridge_halt.failure,
            **self._capture_to_result_fields(recorded_capture),
        )


def _cast_protocol_event(event: BaseEvent) -> ProtocolEvent:
    return cast(ProtocolEvent, event)


def _cast_protocol_events(events: Iterable[BaseEvent]) -> tuple[ProtocolEvent, ...]:
    return tuple(_cast_protocol_event(event) for event in events)


__all__ = [
    "BufferedProtocolEventSink",
    "BufferedRuntimeIngressSource",
    "OrchestratorRuntimeBridge",
    "OrchestratorRuntimeBridgeConfig",
    "OrchestratorRuntimeBridgeFailure",
    "OrchestratorRuntimeBridgeHaltedError",
    "OrchestratorRuntimeBridgeResult",
    "OrchestratorRuntimeBridgeTurnResult",
    "OrchestratorRuntimeBridgeSession",
    "OrchestratorRuntimeBridgeSessionConfig",
    "OrchestratorRuntimeBridgeSessionFailure",
    "OrchestratorRuntimeBridgeSessionHaltedError",
    "OrchestratorRuntimeBridgeSessionResult",
    "OrchestratorRuntimeBridgeStepResult",
    "QueuedProtocolEventSink",
    "RecordedRuntimeEgress",
    "RecordingRuntimeEgressSink",
    "RuntimeSinkEmissionRecord",
]
