from __future__ import annotations

from enum import StrEnum
from typing import Protocol, runtime_checkable
from uuid import UUID

from packages.orchestrator.audio_mutex import AudioOwner, OrchestratorModel
from packages.protocol.events import TTSChunk
from packages.tts.models import TTSAudioFragment


class TTSAudioSinkModel(OrchestratorModel):
    pass


class TTSAudioSinkDelivery(TTSAudioSinkModel):
    session_id: UUID
    trace_id: UUID
    turn_id: UUID
    owner: AudioOwner
    tts_chunk: TTSChunk
    fragment: TTSAudioFragment


class TTSAudioPlaybackReportKind(StrEnum):
    ACCEPTED = "accepted"
    STARTED = "started"
    FINISHED = "finished"
    ABORTED = "aborted"
    FAILED = "failed"


class TTSAudioPlaybackReport(TTSAudioSinkModel):
    session_id: UUID
    trace_id: UUID
    turn_id: UUID
    owner: AudioOwner
    tts_stream_id: UUID
    chunk_index: int
    report_kind: TTSAudioPlaybackReportKind
    fragment_index: int | None = None
    is_interruptible: bool | None = None
    reason: str | None = None
    message: str | None = None


class TTSAudioSinkResult(TTSAudioSinkModel):
    reports: tuple[TTSAudioPlaybackReport, ...] = ()


@runtime_checkable
class TTSAudioSinkPort(Protocol):
    async def deliver_audio_fragment(
        self,
        delivery: TTSAudioSinkDelivery,
    ) -> TTSAudioSinkResult: ...


class RecordingTTSAudioSink:
    def __init__(self) -> None:
        self._deliveries: list[TTSAudioSinkDelivery] = []

    async def deliver_audio_fragment(
        self,
        delivery: TTSAudioSinkDelivery,
    ) -> TTSAudioSinkResult:
        self._deliveries.append(delivery)
        return TTSAudioSinkResult()

    def peek_deliveries(self) -> tuple[TTSAudioSinkDelivery, ...]:
        return tuple(self._deliveries)

    def drain_deliveries(self) -> tuple[TTSAudioSinkDelivery, ...]:
        drained = tuple(self._deliveries)
        self._deliveries.clear()
        return drained
