from __future__ import annotations

import math
from enum import StrEnum
from uuid import UUID

from pydantic import Field

from packages.orchestrator.audio_mutex import AudioOwner, OrchestratorModel
from packages.orchestrator.tts_audio_sink import (
    TTSAudioPlaybackReport,
    TTSAudioPlaybackReportKind,
    TTSAudioSinkDelivery,
    TTSAudioSinkPort,
    TTSAudioSinkResult,
)
from packages.renderer.desktop_live2d_bridge import (
    DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION,
    DesktopLive2DAudioPlaybackOwner,
    DesktopLive2DAudioPlaybackReport as DesktopBridgePlaybackReport,
    DesktopLive2DAudioPlaybackReportKind as DesktopBridgePlaybackReportKind,
    DesktopLive2DAudioPlaybackResponse,
    DesktopLive2DBridgeConfig,
    DesktopLive2DBridgeErrorResponse,
    DesktopLive2DBridgeTransportPort,
    DesktopLive2DPingResponse,
    DesktopLive2DSubprocessBridgeTransport,
    build_desktop_live2d_audio_playback_fragment_request,
    build_desktop_live2d_ping_request,
)
from packages.tts.models import TTSAudioFragment, TTSAudioMediaType


class DesktopLive2DAudioSinkErrorCode(StrEnum):
    TRANSPORT_FAILURE = "transport_failure"
    BRIDGE_REJECTED = "bridge_rejected"
    MALFORMED_RESPONSE = "malformed_response"
    PLAYBACK_ABORTED = "playback_aborted"
    PLAYBACK_FAILED = "playback_failed"


class DesktopLive2DAudioSinkFailure(OrchestratorModel):
    error_code: DesktopLive2DAudioSinkErrorCode
    message: str = Field(min_length=1, max_length=4000)
    retryable: bool = False
    tts_stream_id: str | None = Field(default=None, min_length=1, max_length=128)
    chunk_index: int | None = Field(default=None, ge=0)
    raw_error_type: str | None = Field(default=None, min_length=1, max_length=256)


class DesktopLive2DAudioSinkExecutionError(RuntimeError):
    def __init__(
        self,
        failure: DesktopLive2DAudioSinkFailure,
        *,
        partial_result: TTSAudioSinkResult | None = None,
    ) -> None:
        super().__init__(failure.message)
        self.failure = failure
        self.partial_result = partial_result


class DesktopLive2DAudioSink(TTSAudioSinkPort):
    _FINAL_FRAGMENT_TIMEOUT_PADDING_MS = 1500

    def __init__(
        self,
        config: DesktopLive2DBridgeConfig,
        *,
        transport: DesktopLive2DBridgeTransportPort | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or DesktopLive2DSubprocessBridgeTransport(config)
        self._ready = False
        self._last_response: DesktopLive2DAudioPlaybackResponse | None = None
        self._last_responses_by_turn_id: dict[UUID, DesktopLive2DAudioPlaybackResponse] = {}
        self._pending_playback_duration_ms_by_job_key: dict[str, int] = {}

    def get_config(self) -> DesktopLive2DBridgeConfig:
        return self._config

    def get_last_response(self) -> DesktopLive2DAudioPlaybackResponse | None:
        return self._last_response

    def get_last_response_for_turn(
        self,
        turn_id: UUID,
    ) -> DesktopLive2DAudioPlaybackResponse | None:
        return self._last_responses_by_turn_id.get(turn_id)

    async def deliver_audio_fragment(
        self,
        delivery: TTSAudioSinkDelivery,
    ) -> TTSAudioSinkResult:
        await self._ensure_ready()
        job_key = self._build_job_key(delivery)
        accumulated_duration_ms = (
            self._pending_playback_duration_ms_by_job_key.get(job_key, 0)
            + self._estimate_fragment_duration_ms(delivery.fragment)
        )
        request = build_desktop_live2d_audio_playback_fragment_request(
            protocol_version=self._config.protocol_version,
            session_id=delivery.session_id,
            trace_id=delivery.trace_id,
            turn_id=delivery.turn_id,
            owner=self._map_owner(delivery.owner),
            tts_stream_id=delivery.tts_chunk.tts_stream_id,
            chunk_index=delivery.tts_chunk.chunk_index,
            tts_text=delivery.tts_chunk.text,
            is_interruptible=delivery.tts_chunk.is_interruptible,
            fragment_index=delivery.fragment.fragment_index,
            audio_bytes=delivery.fragment.audio_bytes,
            sample_rate_hz=delivery.fragment.sample_rate_hz,
            channel_count=delivery.fragment.channel_count,
            is_final=delivery.fragment.is_final,
            media_type=(
                None
                if delivery.fragment.media_type is None
                else delivery.fragment.media_type.value
            ),
        )
        try:
            response = await self._transport.send_request(
                request,
                timeout_ms=self._resolve_request_timeout_ms(
                    accumulated_duration_ms=accumulated_duration_ms,
                    is_final_fragment=delivery.fragment.is_final,
                ),
            )
        except Exception as exc:
            self._pending_playback_duration_ms_by_job_key.pop(job_key, None)
            raise DesktopLive2DAudioSinkExecutionError(
                DesktopLive2DAudioSinkFailure(
                    error_code=DesktopLive2DAudioSinkErrorCode.TRANSPORT_FAILURE,
                    message=(
                        "desktop-live2d audio sink failed to deliver a playback fragment: "
                        f"{exc}"
                    ),
                    tts_stream_id=str(delivery.tts_chunk.tts_stream_id),
                    chunk_index=delivery.tts_chunk.chunk_index,
                    raw_error_type=type(exc).__name__,
                )
            ) from exc

        if isinstance(response, DesktopLive2DBridgeErrorResponse):
            self._pending_playback_duration_ms_by_job_key.pop(job_key, None)
            raise DesktopLive2DAudioSinkExecutionError(
                DesktopLive2DAudioSinkFailure(
                    error_code=DesktopLive2DAudioSinkErrorCode.BRIDGE_REJECTED,
                    message=response.message,
                    retryable=response.retryable,
                    tts_stream_id=str(delivery.tts_chunk.tts_stream_id),
                    chunk_index=delivery.tts_chunk.chunk_index,
                    raw_error_type=response.error_code.value,
                )
            )

        if not isinstance(response, DesktopLive2DAudioPlaybackResponse):
            self._pending_playback_duration_ms_by_job_key.pop(job_key, None)
            raise DesktopLive2DAudioSinkExecutionError(
                DesktopLive2DAudioSinkFailure(
                    error_code=DesktopLive2DAudioSinkErrorCode.MALFORMED_RESPONSE,
                    message=(
                        "desktop-live2d audio sink expected an audio playback response "
                        f"but received bridge command '{response.bridge_command.value}'"
                    ),
                    tts_stream_id=str(delivery.tts_chunk.tts_stream_id),
                    chunk_index=delivery.tts_chunk.chunk_index,
                )
            )

        if delivery.fragment.is_final:
            self._pending_playback_duration_ms_by_job_key.pop(job_key, None)
        else:
            self._pending_playback_duration_ms_by_job_key[job_key] = accumulated_duration_ms

        self._last_response = response
        self._last_responses_by_turn_id[delivery.turn_id] = response
        result = TTSAudioSinkResult(
            reports=tuple(
                self._convert_report(bridge_report=report)
                for report in response.reports
            )
        )
        for report in result.reports:
            if report.report_kind == TTSAudioPlaybackReportKind.ABORTED:
                raise DesktopLive2DAudioSinkExecutionError(
                    DesktopLive2DAudioSinkFailure(
                        error_code=DesktopLive2DAudioSinkErrorCode.PLAYBACK_ABORTED,
                        message=report.message or "desktop-live2d aborted audio playback",
                        tts_stream_id=str(report.tts_stream_id),
                        chunk_index=report.chunk_index,
                        raw_error_type=report.reason,
                    ),
                    partial_result=result,
                )
            if report.report_kind == TTSAudioPlaybackReportKind.FAILED:
                raise DesktopLive2DAudioSinkExecutionError(
                    DesktopLive2DAudioSinkFailure(
                        error_code=DesktopLive2DAudioSinkErrorCode.PLAYBACK_FAILED,
                        message=report.message or "desktop-live2d audio playback failed",
                        tts_stream_id=str(report.tts_stream_id),
                        chunk_index=report.chunk_index,
                        raw_error_type=report.reason,
                    ),
                    partial_result=result,
                )
        return result

    async def close(self) -> None:
        self._ready = False
        self._last_response = None
        self._last_responses_by_turn_id.clear()
        self._pending_playback_duration_ms_by_job_key.clear()
        await self._transport.close()

    async def __aenter__(self) -> "DesktopLive2DAudioSink":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def _ensure_ready(self) -> None:
        if self._ready:
            return
        await self._transport.start()
        ping_response = await self._transport.send_request(
            build_desktop_live2d_ping_request(
                protocol_version=self._config.protocol_version
            ),
            timeout_ms=self._config.launch.startup_timeout_ms,
        )
        if isinstance(ping_response, DesktopLive2DBridgeErrorResponse):
            raise DesktopLive2DAudioSinkExecutionError(
                DesktopLive2DAudioSinkFailure(
                    error_code=DesktopLive2DAudioSinkErrorCode.BRIDGE_REJECTED,
                    message=ping_response.message,
                    retryable=ping_response.retryable,
                    raw_error_type=ping_response.error_code.value,
                )
            )
        if not isinstance(ping_response, DesktopLive2DPingResponse):
            raise DesktopLive2DAudioSinkExecutionError(
                DesktopLive2DAudioSinkFailure(
                    error_code=DesktopLive2DAudioSinkErrorCode.MALFORMED_RESPONSE,
                    message=(
                        "desktop-live2d audio sink expected a ping response during startup"
                    ),
                )
            )
        if ping_response.protocol_version != self._config.protocol_version:
            raise DesktopLive2DAudioSinkExecutionError(
                DesktopLive2DAudioSinkFailure(
                    error_code=DesktopLive2DAudioSinkErrorCode.BRIDGE_REJECTED,
                    message=(
                        "desktop-live2d audio sink protocol version mismatch: "
                        f"expected '{self._config.protocol_version}', "
                        f"got '{ping_response.protocol_version}'"
                    ),
                )
            )
        self._ready = True

    @staticmethod
    def _map_owner(owner: AudioOwner) -> DesktopLive2DAudioPlaybackOwner:
        if owner == AudioOwner.QUICK_REACTION:
            return DesktopLive2DAudioPlaybackOwner.QUICK_REACTION
        if owner == AudioOwner.PRIMARY_RESPONSE:
            return DesktopLive2DAudioPlaybackOwner.PRIMARY_RESPONSE
        raise ValueError("desktop-live2d audio sink does not accept AudioOwner.NONE")

    @staticmethod
    def _convert_report(
        *,
        bridge_report: DesktopBridgePlaybackReport,
    ) -> TTSAudioPlaybackReport:
        return TTSAudioPlaybackReport(
            session_id=bridge_report.session_id,
            trace_id=bridge_report.trace_id,
            turn_id=bridge_report.turn_id,
            owner=AudioOwner(bridge_report.owner.value),
            tts_stream_id=bridge_report.tts_stream_id,
            chunk_index=bridge_report.chunk_index,
            report_kind=TTSAudioPlaybackReportKind(bridge_report.report_kind.value),
            fragment_index=bridge_report.fragment_index,
            is_interruptible=bridge_report.is_interruptible,
            reason=bridge_report.reason,
            message=bridge_report.message,
        )

    @staticmethod
    def _build_job_key(delivery: TTSAudioSinkDelivery) -> str:
        return f"{delivery.tts_chunk.tts_stream_id}:{delivery.tts_chunk.chunk_index}"

    def _resolve_request_timeout_ms(
        self,
        *,
        accumulated_duration_ms: int,
        is_final_fragment: bool,
    ) -> int:
        base_timeout_ms = self._config.launch.request_timeout_ms
        if not is_final_fragment:
            return base_timeout_ms
        return max(
            base_timeout_ms,
            accumulated_duration_ms + self._FINAL_FRAGMENT_TIMEOUT_PADDING_MS,
        )

    @staticmethod
    def _estimate_fragment_duration_ms(fragment: TTSAudioFragment) -> int:
        sample_rate_hz = fragment.sample_rate_hz
        channel_count = fragment.channel_count
        byte_length = len(fragment.audio_bytes)
        media_type = fragment.media_type

        if media_type in (None, TTSAudioMediaType.PCM_S16LE):
            bytes_per_frame = channel_count * 2
            if byte_length % bytes_per_frame != 0:
                raise ValueError(
                    "desktop-live2d PCM playback fragment byte length must align with the declared channel count"
                )
            return max(
                10,
                math.ceil((byte_length / (sample_rate_hz * bytes_per_frame)) * 1000),
            )

        if media_type == TTSAudioMediaType.WAV:
            if byte_length < 44:
                raise ValueError(
                    "desktop-live2d WAV playback fragment must contain at least a 44-byte header"
                )
            payload_byte_length = byte_length - 44
            bytes_per_frame = channel_count * 2
            if payload_byte_length % bytes_per_frame != 0:
                raise ValueError(
                    "desktop-live2d WAV playback fragment payload must align with the declared channel count"
                )
            return max(
                10,
                math.ceil((payload_byte_length / (sample_rate_hz * bytes_per_frame)) * 1000),
            )

        return max(self._FINAL_FRAGMENT_TIMEOUT_PADDING_MS, 10)


__all__ = [
    "DESKTOP_LIVE2D_BRIDGE_PROTOCOL_VERSION",
    "DesktopLive2DAudioSink",
    "DesktopLive2DAudioSinkErrorCode",
    "DesktopLive2DAudioSinkExecutionError",
    "DesktopLive2DAudioSinkFailure",
]
