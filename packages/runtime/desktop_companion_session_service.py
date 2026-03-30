from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from packages.llm.models import LLMImageAttachment, LLMMessage, LLMMessageRole
from packages.llm.service import LLMService
from packages.orchestrator.audio_mutex import AudioMutex, OrchestratorConfig
from packages.orchestrator.desktop_live2d_audio_sink import DesktopLive2DAudioSink
from packages.orchestrator.expression_parser import ExpressionParser
from packages.orchestrator.turn_orchestrator import (
    ProtocolEventSinkPort,
    TurnContext,
    TurnOrchestrator,
)
from packages.protocol.events import (
    AssistantResponseChunkEvent,
    AssistantResponseCompletedEvent,
    BaseEvent,
    QuickReactionReadyEvent,
    RecognizedUtterance,
    RendererCommand,
    RendererCommandIssuedEvent,
    RendererCommandType,
    SessionState,
    SessionStatus,
    SourceType,
    TTSChunkQueuedEvent,
    TTSPlaybackFinishedEvent,
    TTSPlaybackStartedEvent,
    UserSpeechEndEvent,
    UserSpeechStartEvent,
    UserSpeechStartPayload,
)
from packages.renderer.desktop_live2d_bridge import (
    DesktopLive2DAudioPlaybackResponse,
    DesktopLive2DBridgeAdapter,
    DesktopLive2DBridgeConfig,
    DesktopLive2DBridgeTransportPort,
    DesktopLive2DBubbleResponse,
    DesktopLive2DCompanionBridgeSession,
    DesktopLive2DCompanionPendingInput,
    DesktopLive2DCompanionSessionResponse,
    DesktopLive2DCompanionSessionSnapshot,
    DesktopLive2DCompanionTranscriptEntry,
    DesktopLive2DCompanionTranscriptRole,
    DesktopLive2DSubprocessBridgeTransport,
    build_default_desktop_live2d_bridge_config,
)
from packages.renderer.models import RendererAdapterProfile
from packages.renderer.registry import RendererRegistry
from packages.renderer.service import RendererService
from packages.runtime.recovery_snapshot import SessionRecoverySnapshot
from packages.runtime.runtime_supervisor import RuntimeProcessResult, RuntimeSupervisor
from packages.tts.service import TTSService


_AMBIENT_PROMPT_PREFIX = "[环境感知]"
_AMBIENT_PREVIOUS_COMMENT_PREFIX = "上一条环境评论（避免同义复述）:"
_AMBIENT_SILENCE_TOKEN_RE = re.compile(r"\[(?:沉默|silence)\]", re.IGNORECASE)
_AMBIENT_SIMILARITY_CLEAN_RE = re.compile(r"[\W_]+", re.UNICODE)
_AMBIENT_DUPLICATE_RATIO_THRESHOLD = 0.88
_PROTOCOL_SQUARE_TAG_RE = re.compile(r"\[[^\[\]\s\r\n]{1,32}\]")
_PROTOCOL_INLINE_COMMAND_TAG_RE = re.compile(
    r"<\s*(?:action|tone)\s*=\s*[^>\r\n]{1,64}\s*>",
    re.IGNORECASE,
)
_PROTOCOL_BLOCK_TAG_RE = re.compile(r"</?\s*(?:voice|subtitle)\s*>", re.IGNORECASE)


ServiceOperationKind = Literal[
    "run_text_turn",
    "drain_desktop_inputs",
    "snapshot_desktop_state",
    "submit_desktop_input",
]


class DesktopCompanionSessionServiceModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class DesktopCompanionSessionServiceConfig(DesktopCompanionSessionServiceModel):
    session_id: UUID = Field(default_factory=uuid4)
    desktop_bridge_config: DesktopLive2DBridgeConfig
    orchestrator_config: OrchestratorConfig = Field(default_factory=OrchestratorConfig)
    renderer_adapter_profiles: tuple[RendererAdapterProfile, ...] = ()
    initial_session_status: SessionStatus = SessionStatus.IDLE
    initial_active_scope: str = Field(default="desktop", min_length=1, max_length=64)
    user_event_source: str = Field(
        default="user.desktop_live2d",
        min_length=1,
        max_length=128,
    )
    bubble_speaker_label: str = Field(default="Echo", min_length=1, max_length=64)
    clear_bubble_after_turn_settlement: bool = True
    suppress_bubble_and_expression: bool = False
    suppress_tts_output: bool = False

    @field_validator("renderer_adapter_profiles", mode="before")
    @classmethod
    def normalize_renderer_adapter_profiles(
        cls,
        value: object,
    ) -> tuple[RendererAdapterProfile, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("initial_active_scope", "user_event_source", "bubble_speaker_label")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text fields must not be blank")
        return cleaned

    @model_validator(mode="after")
    def validate_renderer_profiles(self) -> "DesktopCompanionSessionServiceConfig":
        seen_keys: set[str] = set()
        for profile in self.renderer_adapter_profiles:
            if profile.adapter_profile_key in seen_keys:
                raise ValueError(
                    "renderer_adapter_profiles must have unique adapter_profile_key values"
                )
            seen_keys.add(profile.adapter_profile_key)
            if profile.adapter_key != self.desktop_bridge_config.adapter_key:
                raise ValueError(
                    "renderer adapter profiles for the desktop companion session service "
                    "must target the configured desktop bridge adapter"
                )
        return self


def build_default_desktop_companion_session_service_config(
    *,
    workspace_root: str | Path,
    session_id: UUID | None = None,
    orchestrator_config: OrchestratorConfig | None = None,
    renderer_adapter_profiles: tuple[RendererAdapterProfile, ...] = (),
) -> DesktopCompanionSessionServiceConfig:
    return DesktopCompanionSessionServiceConfig(
        session_id=session_id or uuid4(),
        desktop_bridge_config=build_default_desktop_live2d_bridge_config(
            workspace_root=workspace_root,
        ),
        orchestrator_config=orchestrator_config or OrchestratorConfig(),
        renderer_adapter_profiles=renderer_adapter_profiles,
    )


class DesktopCompanionSessionRunResult(DesktopCompanionSessionServiceModel):
    turn_context: TurnContext
    ingested_events: tuple[BaseEvent, ...] = ()
    protocol_events: tuple[BaseEvent, ...] = ()
    runtime_process_results: tuple[RuntimeProcessResult, ...] = ()
    bubble_responses: tuple[DesktopLive2DBubbleResponse, ...] = ()
    companion_session_responses: tuple[DesktopLive2DCompanionSessionResponse, ...] = ()
    final_companion_session_snapshot: DesktopLive2DCompanionSessionSnapshot
    final_bubble_response: DesktopLive2DBubbleResponse
    final_audio_playback_response: DesktopLive2DAudioPlaybackResponse
    final_recovery_snapshot: SessionRecoverySnapshot

    @model_validator(mode="after")
    def validate_result_alignment(self) -> "DesktopCompanionSessionRunResult":
        if len(self.ingested_events) != len(self.runtime_process_results):
            raise ValueError(
                "runtime_process_results must align one-to-one with ingested_events"
            )
        if self.protocol_events:
            expected_suffix = self.ingested_events[-len(self.protocol_events) :]
            if expected_suffix != self.protocol_events:
                raise ValueError(
                    "protocol_events must preserve the ingested orchestrator event suffix exactly"
                )
        if self.final_recovery_snapshot.session_id != self.turn_context.session_id:
            raise ValueError(
                "final_recovery_snapshot.session_id must match turn_context.session_id"
            )
        return self


class DesktopCompanionSessionInputDrainResult(DesktopCompanionSessionServiceModel):
    session_id: UUID
    drained_inputs: tuple[DesktopLive2DCompanionPendingInput, ...] = ()
    companion_session_snapshot: DesktopLive2DCompanionSessionSnapshot
    recovery_snapshot: SessionRecoverySnapshot

    @model_validator(mode="after")
    def validate_session_alignment(self) -> "DesktopCompanionSessionInputDrainResult":
        if self.recovery_snapshot.session_id != self.session_id:
            raise ValueError(
                "recovery_snapshot.session_id must match the drained session_id"
            )
        if (
            self.companion_session_snapshot.session_id is not None
            and self.companion_session_snapshot.session_id != self.session_id
        ):
            raise ValueError(
                "companion_session_snapshot.session_id must match the drained session_id"
            )
        for pending_input in self.drained_inputs:
            if pending_input.session_id != self.session_id:
                raise ValueError("drained_inputs must all belong to the drained session_id")
        return self


class DesktopCompanionSessionDesktopSnapshot(DesktopCompanionSessionServiceModel):
    session_id: UUID
    companion_session_snapshot: DesktopLive2DCompanionSessionSnapshot
    bubble_response: DesktopLive2DBubbleResponse
    audio_playback_response: DesktopLive2DAudioPlaybackResponse
    recovery_snapshot: SessionRecoverySnapshot

    @model_validator(mode="after")
    def validate_session_alignment(self) -> "DesktopCompanionSessionDesktopSnapshot":
        if self.recovery_snapshot.session_id != self.session_id:
            raise ValueError(
                "recovery_snapshot.session_id must match the desktop snapshot session_id"
            )
        if (
            self.companion_session_snapshot.session_id is not None
            and self.companion_session_snapshot.session_id != self.session_id
        ):
            raise ValueError(
                "companion_session_snapshot.session_id must match the desktop snapshot session_id"
            )
        return self


class DesktopCompanionSessionSubmitInputResult(DesktopCompanionSessionServiceModel):
    session_id: UUID
    submitted_text: str = Field(min_length=1, max_length=4000)
    drain_result: DesktopCompanionSessionInputDrainResult
    run_results: tuple[DesktopCompanionSessionRunResult, ...] = ()
    final_desktop_snapshot: DesktopCompanionSessionDesktopSnapshot

    @model_validator(mode="after")
    def validate_session_alignment(self) -> "DesktopCompanionSessionSubmitInputResult":
        if self.drain_result.session_id != self.session_id:
            raise ValueError(
                "drain_result.session_id must match the submitted desktop session_id"
            )
        if self.final_desktop_snapshot.session_id != self.session_id:
            raise ValueError(
                "final_desktop_snapshot.session_id must match the submitted desktop session_id"
            )
        for result in self.run_results:
            if result.turn_context.session_id != self.session_id:
                raise ValueError(
                    "run_results must all belong to the submitted desktop session_id"
                )
        return self


class DesktopCompanionSessionServiceFailure(DesktopCompanionSessionServiceModel):
    operation_kind: ServiceOperationKind
    session_id: UUID
    exception_type: str = Field(min_length=1, max_length=256)
    exception_message: str
    turn_context: TurnContext | None = None
    ingested_events: tuple[BaseEvent, ...] = ()
    protocol_events: tuple[BaseEvent, ...] = ()
    runtime_process_results: tuple[RuntimeProcessResult, ...] = ()
    bubble_responses: tuple[DesktopLive2DBubbleResponse, ...] = ()
    companion_session_responses: tuple[DesktopLive2DCompanionSessionResponse, ...] = ()
    partial_companion_session_snapshot: DesktopLive2DCompanionSessionSnapshot | None = None
    partial_bubble_response: DesktopLive2DBubbleResponse | None = None
    partial_audio_playback_response: DesktopLive2DAudioPlaybackResponse | None = None
    recovery_snapshot: SessionRecoverySnapshot | None = None

    @model_validator(mode="after")
    def validate_failure_alignment(self) -> "DesktopCompanionSessionServiceFailure":
        if len(self.runtime_process_results) > len(self.ingested_events):
            raise ValueError(
                "runtime_process_results must not outnumber ingested_events on failure"
            )
        if self.protocol_events:
            if len(self.protocol_events) > len(self.ingested_events):
                raise ValueError(
                    "protocol_events must not outnumber ingested_events on failure"
                )
            expected_suffix = self.ingested_events[-len(self.protocol_events) :]
            if expected_suffix != self.protocol_events:
                raise ValueError(
                    "failure protocol_events must preserve the ingested orchestrator event suffix exactly"
                )
        if (
            self.recovery_snapshot is not None
            and self.recovery_snapshot.session_id != self.session_id
        ):
            raise ValueError(
                "failure recovery_snapshot.session_id must match the service session_id"
            )
        return self


class DesktopCompanionSessionServiceHaltedError(RuntimeError):
    def __init__(self, failure: DesktopCompanionSessionServiceFailure) -> None:
        self.failure = failure
        super().__init__(self._build_message(failure))

    @staticmethod
    def _build_message(failure: DesktopCompanionSessionServiceFailure) -> str:
        return (
            f"desktop companion session service halted during {failure.operation_kind} "
            f"({failure.exception_type}: {failure.exception_message})"
        )


@dataclass(slots=True)
class _ActiveTurnState:
    turn_context: TurnContext
    user_text: str
    include_user_transcript: bool = True
    is_hidden_ambient_turn: bool = False
    previous_ambient_comment_text: str = ""
    ingested_events: list[BaseEvent] = field(default_factory=list)
    protocol_events: list[BaseEvent] = field(default_factory=list)
    runtime_process_results: list[RuntimeProcessResult] = field(default_factory=list)
    bubble_responses: list[DesktopLive2DBubbleResponse] = field(default_factory=list)
    companion_responses: list[DesktopLive2DCompanionSessionResponse] = field(default_factory=list)
    quick_reaction_text: str | None = None
    spoken_quick_reaction_text: str = ""
    primary_response_text: str = ""
    primary_raw_response_text: str = ""
    primary_subtitle_text: str = ""
    primary_chunk_seen: bool = False
    primary_tts_chunk_queued: bool = False
    quick_tts_chunk_queued: bool = False
    response_completed: bool = False
    quick_playback_finished: bool = False
    primary_playback_finished: bool = False
    bubble_cleared: bool = False
    expression_command_seen: bool = False
    ambient_response_policy_resolved: bool = False
    ambient_response_allowed: bool = True
    ambient_response_suppressed: bool = False
    ambient_tts_gate: asyncio.Event | None = None


class _SuppressedTTSService(TTSService):
    """No-op TTS wrapper for hidden sessions that must never emit audible output."""

    def __init__(self, inner_service: TTSService) -> None:
        super().__init__(inner_service.get_registry())

    async def synthesize(self, request):
        return
        yield  # pragma: no cover — typed as AsyncGenerator

    async def synthesize_chunk(
        self,
        *,
        tts_chunk,
        voice_profile_key: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
        synthesis_config=None,
    ):
        return
        yield  # pragma: no cover — typed as AsyncGenerator


class _AmbientAwareTTSService(TTSService):
    def __init__(
        self,
        inner_service: TTSService,
        *,
        ambient_tts_policy_resolver,
    ) -> None:
        super().__init__(inner_service.get_registry())
        self._inner_service = inner_service
        self._ambient_tts_policy_resolver = ambient_tts_policy_resolver

    async def synthesize(self, request):
        async for fragment in self._inner_service.synthesize(request):
            yield fragment

    async def synthesize_chunk(
        self,
        *,
        tts_chunk,
        voice_profile_key: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
        synthesis_config=None,
    ):
        if not await self._ambient_tts_policy_resolver():
            return
        async for fragment in self._inner_service.synthesize_chunk(
            tts_chunk=tts_chunk,
            voice_profile_key=voice_profile_key,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
            synthesis_config=synthesis_config,
        ):
            yield fragment


class _DesktopCompanionProtocolEventSink(ProtocolEventSinkPort):
    def __init__(self, owner: "DesktopCompanionSessionService") -> None:
        self._owner = owner

    async def send_protocol_event(self, event: BaseEvent) -> None:
        await self._owner._consume_protocol_event(event)


class DesktopCompanionSessionService:
    _POST_TURN_EXPRESSION_CLEAR_DELAY_SEC = 0.45

    def __init__(
        self,
        *,
        config: DesktopCompanionSessionServiceConfig,
        llm_service: LLMService,
        tts_service: TTSService,
        runtime_supervisor: RuntimeSupervisor | None = None,
        transport: DesktopLive2DBridgeTransportPort | None = None,
        transcript_source: Any | None = None,
    ) -> None:
        self._config = config
        self._llm_service = llm_service
        if config.suppress_tts_output:
            self._tts_service = _SuppressedTTSService(tts_service)
        else:
            self._tts_service = _AmbientAwareTTSService(
                tts_service,
                ambient_tts_policy_resolver=self._await_active_turn_tts_permission,
            )
        self._runtime_supervisor = (
            runtime_supervisor if runtime_supervisor is not None else RuntimeSupervisor()
        )
        self._transport = (
            transport
            if transport is not None
            else DesktopLive2DSubprocessBridgeTransport(config.desktop_bridge_config)
        )
        self._transcript_source = transcript_source
        self._desktop_bridge_session = DesktopLive2DCompanionBridgeSession(
            config.desktop_bridge_config,
            transport=self._transport,
        )
        self._desktop_renderer_adapter = DesktopLive2DBridgeAdapter(
            config.desktop_bridge_config,
            transport=self._transport,
        )
        self._renderer_registry = RendererRegistry(
            adapters=(self._desktop_renderer_adapter,),
            adapter_profiles=config.renderer_adapter_profiles,
        )
        self._renderer_service = RendererService(self._renderer_registry)
        self._desktop_audio_sink = DesktopLive2DAudioSink(
            config.desktop_bridge_config,
            transport=self._transport,
        )
        self._latest_companion_session_snapshot: DesktopLive2DCompanionSessionSnapshot | None = None
        self._audio_mutex = AudioMutex(config.orchestrator_config)
        self._protocol_event_sink = _DesktopCompanionProtocolEventSink(self)
        self._turn_orchestrator = TurnOrchestrator(
            config=config.orchestrator_config,
            audio_mutex=self._audio_mutex,
            protocol_event_sink=self._protocol_event_sink,
            renderer_service=self._renderer_service,
            llm_service=self._llm_service,
            tts_service=self._tts_service,
            tts_audio_sink=self._desktop_audio_sink,
        )
        self._operation_lock = asyncio.Lock()
        self._active_turn_state: _ActiveTurnState | None = None
        self._closed = False
        self._ensure_runtime_session_registered()

    def get_config(self) -> DesktopCompanionSessionServiceConfig:
        return self._config

    def get_session_id(self) -> UUID:
        return self._config.session_id

    def get_runtime_supervisor(self) -> RuntimeSupervisor:
        return self._runtime_supervisor

    def get_turn_orchestrator(self) -> TurnOrchestrator:
        return self._turn_orchestrator

    def get_renderer_service(self) -> RendererService:
        return self._renderer_service

    def get_llm_service(self) -> LLMService:
        return self._llm_service

    def get_tts_service(self) -> TTSService:
        return self._tts_service

    def get_desktop_bridge_session(self) -> DesktopLive2DCompanionBridgeSession:
        return self._desktop_bridge_session

    async def ensure_ready(self) -> None:
        self._ensure_not_closed()
        await self._desktop_bridge_session.ensure_ready()

    async def run_text_turn(
        self,
        text: str,
        *,
        images: tuple[LLMImageAttachment, ...] = (),
        visible_in_transcript: bool = True,
    ) -> DesktopCompanionSessionRunResult:
        self._ensure_not_closed()

        async with self._operation_lock:
            await self.ensure_ready()
            try:
                return await self._run_text_turn_unlocked(
                    text,
                    images=images,
                    visible_in_transcript=visible_in_transcript,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                turn_state = getattr(exc, "_echo_turn_state", None)
                if turn_state is None:
                    turn_context = getattr(exc, "_echo_turn_context", None)
                    if turn_context is not None:
                        turn_state = _ActiveTurnState(turn_context=turn_context, user_text=text)
                raise DesktopCompanionSessionServiceHaltedError(
                    await self._build_turn_failure(turn_state, exc)
                ) from exc

    async def drain_desktop_inputs(self) -> DesktopCompanionSessionInputDrainResult:
        self._ensure_not_closed()
        async with self._operation_lock:
            await self.ensure_ready()
            try:
                return await self._drain_desktop_inputs_unlocked()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                raise DesktopCompanionSessionServiceHaltedError(
                    await self._build_input_drain_failure(exc)
                ) from exc

    async def snapshot_desktop_state(self) -> DesktopCompanionSessionDesktopSnapshot:
        self._ensure_not_closed()
        async with self._operation_lock:
            await self.ensure_ready()
            try:
                return await self._build_desktop_snapshot()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                raise DesktopCompanionSessionServiceHaltedError(
                    DesktopCompanionSessionServiceFailure(
                        operation_kind="snapshot_desktop_state",
                        session_id=self._config.session_id,
                        exception_type=type(exc).__name__,
                        exception_message=str(exc),
                        partial_companion_session_snapshot=await self._safe_snapshot_companion_session(),
                        partial_bubble_response=await self._safe_snapshot_bubble(),
                        partial_audio_playback_response=await self._safe_snapshot_audio_playback(),
                        recovery_snapshot=self._safe_recovery_snapshot(),
                    )
                ) from exc

    async def submit_desktop_input(
        self,
        text: str,
        *,
        images: tuple[LLMImageAttachment, ...] = (),
        visible_in_transcript: bool = True,
    ) -> DesktopCompanionSessionSubmitInputResult:
        self._ensure_not_closed()
        submitted_text = self._validate_turn_text(text)
        async with self._operation_lock:
            await self.ensure_ready()
            try:
                await self._desktop_bridge_session.enqueue_input(
                    session_id=self._config.session_id,
                    text=submitted_text,
                )
                drain_result = await self._drain_desktop_inputs_unlocked()
                run_results: list[DesktopCompanionSessionRunResult] = []
                for pending_input in drain_result.drained_inputs:
                    run_results.append(
                        await self._run_text_turn_unlocked(
                            pending_input.text,
                            images=images,
                            visible_in_transcript=visible_in_transcript,
                        )
                    )
                return DesktopCompanionSessionSubmitInputResult(
                    session_id=self._config.session_id,
                    submitted_text=submitted_text,
                    drain_result=drain_result,
                    run_results=tuple(run_results),
                    final_desktop_snapshot=await self._build_desktop_snapshot(),
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                raise DesktopCompanionSessionServiceHaltedError(
                    DesktopCompanionSessionServiceFailure(
                        operation_kind="submit_desktop_input",
                        session_id=self._config.session_id,
                        exception_type=type(exc).__name__,
                        exception_message=str(exc),
                        partial_companion_session_snapshot=await self._safe_snapshot_companion_session(),
                        partial_bubble_response=await self._safe_snapshot_bubble(),
                        partial_audio_playback_response=await self._safe_snapshot_audio_playback(),
                        recovery_snapshot=self._safe_recovery_snapshot(),
                    )
                ) from exc

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._desktop_bridge_session.close()

    async def __aenter__(self) -> "DesktopCompanionSessionService":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    def _ensure_runtime_session_registered(self) -> None:
        if self._runtime_supervisor.get_session(self._config.session_id) is not None:
            return
        self._runtime_supervisor.register_session(
            SessionState(
                session_id=self._config.session_id,
                status=self._config.initial_session_status,
                active_scope=self._config.initial_active_scope,
            )
        )

    def _ensure_not_closed(self) -> None:
        if self._closed:
            raise RuntimeError("desktop companion session service is closed")

    @staticmethod
    def _validate_turn_text(text: str) -> str:
        if text.strip() == "":
            raise ValueError("run_text_turn text must not be blank")
        return text

    def _build_user_turn_events(
        self,
        turn_context: TurnContext,
    ) -> tuple[UserSpeechStartEvent, UserSpeechEndEvent]:
        utterance_id = uuid4()
        metadata = {"turn_id": turn_context.turn_id}
        start_event = UserSpeechStartEvent(
            trace_id=turn_context.trace_id,
            session_id=turn_context.session_id,
            source_type=SourceType.USER,
            source=self._config.user_event_source,
            payload=UserSpeechStartPayload(utterance_id=utterance_id),
            metadata=metadata,
        )
        end_event = UserSpeechEndEvent(
            trace_id=turn_context.trace_id,
            session_id=turn_context.session_id,
            source_type=SourceType.USER,
            source=self._config.user_event_source,
            payload=RecognizedUtterance(
                utterance_id=utterance_id,
                text=turn_context.utterance_text,
                is_final=True,
            ),
            metadata=metadata,
        )
        return start_event, end_event

    async def _run_text_turn_unlocked(
        self,
        text: str,
        *,
        images: tuple[LLMImageAttachment, ...] = (),
        visible_in_transcript: bool = True,
    ) -> DesktopCompanionSessionRunResult:
        user_text = self._validate_turn_text(text)
        is_hidden_ambient_turn = self._is_hidden_ambient_turn(
            user_text,
            visible_in_transcript=visible_in_transcript,
        )
        turn_context = TurnContext(
            session_id=self._config.session_id,
            trace_id=uuid4(),
            utterance_text=user_text,
            input_images=images,
        )
        turn_state = _ActiveTurnState(
            turn_context=turn_context,
            user_text=user_text,
            include_user_transcript=visible_in_transcript,
            is_hidden_ambient_turn=is_hidden_ambient_turn,
            previous_ambient_comment_text=(
                self._extract_previous_ambient_comment_text(user_text)
                if is_hidden_ambient_turn
                else ""
            ),
            ambient_tts_gate=asyncio.Event() if is_hidden_ambient_turn else None,
        )
        if self._active_turn_state is not None:
            raise RuntimeError("desktop companion session service already has an active turn")

        self._active_turn_state = turn_state
        try:
            recent_context_messages = await self._build_recent_context_messages()
            turn_context = turn_context.model_copy(
                update={"recent_context_messages": recent_context_messages}
            )
            turn_state.turn_context = turn_context
            user_start_event, user_end_event = self._build_user_turn_events(turn_context)
            await self._consume_event(
                turn_state=turn_state,
                event=user_start_event,
                is_protocol_event=False,
            )
            await self._consume_event(
                turn_state=turn_state,
                event=user_end_event,
                is_protocol_event=False,
            )
            await self._turn_orchestrator.handle_user_turn(turn_context)
            await self._finalize_bubble_after_turn_resolution(turn_state)
            await self._clear_expression_after_turn_resolution(turn_state)
            return await self._build_run_result(turn_state)
        except Exception as exc:
            setattr(exc, "_echo_turn_context", turn_context)
            setattr(exc, "_echo_turn_state", turn_state)
            raise
        finally:
            self._active_turn_state = None

    async def _drain_desktop_inputs_unlocked(self) -> DesktopCompanionSessionInputDrainResult:
        response = await self._desktop_bridge_session.drain_inputs(
            session_id=self._config.session_id,
        )
        return DesktopCompanionSessionInputDrainResult(
            session_id=self._config.session_id,
            drained_inputs=response.drained_inputs,
            companion_session_snapshot=response.companion_session_snapshot,
            recovery_snapshot=self._runtime_supervisor.get_recovery_snapshot(
                self._config.session_id
            ),
        )

    async def _build_desktop_snapshot(self) -> DesktopCompanionSessionDesktopSnapshot:
        companion_response = await self._desktop_bridge_session.snapshot_companion_session()
        companion_snapshot = self._build_effective_companion_session_snapshot(
            companion_response.companion_session_snapshot
        )
        self._latest_companion_session_snapshot = companion_snapshot
        bubble_response = await self._desktop_bridge_session.snapshot_bubble()
        audio_response = await self._desktop_bridge_session.snapshot_audio_playback()
        recovery_snapshot = self._runtime_supervisor.get_recovery_snapshot(
            self._config.session_id
        )
        return DesktopCompanionSessionDesktopSnapshot(
            session_id=self._config.session_id,
            companion_session_snapshot=companion_snapshot,
            bubble_response=bubble_response,
            audio_playback_response=audio_response,
            recovery_snapshot=recovery_snapshot,
        )

    def _build_effective_companion_session_snapshot(
        self,
        bridge_snapshot: DesktopLive2DCompanionSessionSnapshot | None,
    ) -> DesktopLive2DCompanionSessionSnapshot:
        if self._transcript_source is None:
            return bridge_snapshot or DesktopLive2DCompanionSessionSnapshot(
                session_id=self._config.session_id,
            )

        persisted_entries = self._transcript_source(self._config.session_id)
        transcript_entries = tuple(
            DesktopLive2DCompanionTranscriptEntry(
                entry_id=entry.entry_id,
                session_id=self._config.session_id,
                turn_id=entry.turn_id,
                role=DesktopLive2DCompanionTranscriptRole(entry.role),
                text=entry.text,
                raw_text=entry.raw_text,
                is_streaming=entry.is_streaming,
                sequence_index=entry.sequence_index,
            )
            for entry in persisted_entries
        )
        latest_turn_id = transcript_entries[-1].turn_id if transcript_entries else None
        pending_input_count = 0
        if bridge_snapshot is not None and bridge_snapshot.session_id == self._config.session_id:
            pending_input_count = bridge_snapshot.pending_input_count
        return DesktopLive2DCompanionSessionSnapshot(
            session_id=self._config.session_id,
            transcript_entries=transcript_entries,
            pending_input_count=pending_input_count,
            latest_turn_id=latest_turn_id,
        )

    async def _build_recent_context_messages(self) -> tuple[LLMMessage, ...]:
        if self._transcript_source is not None:
            return self._build_recent_context_from_transcript_source()

        snapshot = self._latest_companion_session_snapshot
        if snapshot is None:
            try:
                companion_response = await self._desktop_bridge_session.snapshot_companion_session()
            except Exception:
                return ()
            snapshot = companion_response.companion_session_snapshot
            self._latest_companion_session_snapshot = snapshot
        ordered_entries = sorted(
            snapshot.transcript_entries,
            key=lambda entry: entry.sequence_index,
        )
        recent_context_messages: list[LLMMessage] = []
        for entry in ordered_entries:
            if entry.is_streaming:
                continue
            if entry.role == DesktopLive2DCompanionTranscriptRole.USER:
                role = LLMMessageRole.USER
                content = entry.text
            elif entry.role == DesktopLive2DCompanionTranscriptRole.ASSISTANT:
                role = LLMMessageRole.ASSISTANT
                content = entry.text
            else:
                raise RuntimeError(
                    "desktop companion session snapshot contained an unsupported transcript role"
                )
            recent_context_messages.append(
                LLMMessage(
                    role=role,
                    content=content,
                )
            )
        return tuple(recent_context_messages)

    def _build_recent_context_from_transcript_source(self) -> tuple[LLMMessage, ...]:
        entries = self._transcript_source(self._config.session_id)
        recent_context_messages: list[LLMMessage] = []
        for entry in entries:
            if entry.is_streaming:
                continue
            if entry.role == "user":
                role = LLMMessageRole.USER
                content = entry.text
            elif entry.role == "assistant":
                role = LLMMessageRole.ASSISTANT
                content = entry.text
            else:
                continue
            recent_context_messages.append(
                LLMMessage(role=role, content=content)
            )
        return tuple(recent_context_messages)

    async def _consume_protocol_event(self, event: BaseEvent) -> None:
        turn_state = self._active_turn_state
        if turn_state is None:
            raise RuntimeError(
                "desktop companion session service received an orchestrator protocol event with no active turn"
            )
        await self._consume_event(
            turn_state=turn_state,
            event=event,
            is_protocol_event=True,
        )

    async def _consume_event(
        self,
        *,
        turn_state: _ActiveTurnState,
        event: BaseEvent,
        is_protocol_event: bool,
    ) -> None:
        turn_state.ingested_events.append(event)
        if is_protocol_event:
            turn_state.protocol_events.append(event)

        runtime_result = self._runtime_supervisor.process_event(event)
        turn_state.runtime_process_results.append(runtime_result)
        await self._drive_desktop_from_event(turn_state, event)
        await self._maybe_settle_bubble(
            turn_state,
            reason=f"{event.event_type}.settlement",
        )

    async def _drive_desktop_from_event(
        self,
        turn_state: _ActiveTurnState,
        event: BaseEvent,
    ) -> None:
        if isinstance(event, UserSpeechEndEvent):
            if turn_state.include_user_transcript:
                await self._upsert_user_transcript(
                    turn_state,
                    text=event.payload.text,
                )
            return

        if isinstance(event, QuickReactionReadyEvent):
            visible_text, expression_seen = self._extract_visible_quick_reaction_text(
                event.payload.text
            )
            turn_state.quick_reaction_text = visible_text
            turn_state.expression_command_seen = (
                turn_state.expression_command_seen or expression_seen
            )
            return

        if isinstance(event, RendererCommandIssuedEvent):
            if event.payload.command_type == RendererCommandType.SET_EXPRESSION:
                turn_state.expression_command_seen = True
            return

        if isinstance(event, AssistantResponseChunkEvent):
            if event.payload.response_stream_id != turn_state.turn_context.primary_response_stream_id:
                return
            turn_state.primary_chunk_seen = True
            turn_state.primary_response_text += event.payload.text
            turn_state.primary_raw_response_text += event.payload.raw_text or event.payload.text
            if event.payload.subtitle_text:
                turn_state.primary_subtitle_text += event.payload.subtitle_text
            if turn_state.is_hidden_ambient_turn:
                return
            combined_text = self._compose_assistant_visible_text(turn_state)
            combined_raw_text = self._compose_assistant_raw_text(turn_state)
            await self._upsert_assistant_transcript(
                turn_state,
                text=combined_text,
                raw_text=combined_raw_text,
                is_streaming=not event.payload.is_final,
            )
            bubble_text = turn_state.primary_subtitle_text or combined_text
            await self._replace_bubble(
                turn_state,
                bubble_text=bubble_text,
                is_streaming=not event.payload.is_final,
            )
            return

        if isinstance(event, AssistantResponseCompletedEvent):
            if event.payload.response_stream_id != turn_state.turn_context.primary_response_stream_id:
                return
            turn_state.response_completed = True
            if turn_state.is_hidden_ambient_turn:
                await self._resolve_hidden_ambient_response_policy(turn_state)
                if not turn_state.ambient_response_allowed:
                    return
                combined_text = self._sanitize_ambient_output_text(
                    self._compose_assistant_visible_text(turn_state)
                )
                combined_raw_text = self._sanitize_ambient_output_text(
                    self._compose_assistant_raw_text(turn_state)
                )
                if turn_state.primary_chunk_seen:
                    await self._upsert_assistant_transcript(
                        turn_state,
                        text=combined_text,
                        raw_text=combined_raw_text,
                        is_streaming=False,
                    )
                    bubble_text = self._sanitize_ambient_output_text(
                        turn_state.primary_subtitle_text or combined_text
                    )
                    await self._replace_bubble(
                        turn_state,
                        bubble_text=bubble_text,
                        is_streaming=False,
                    )
                elif turn_state.spoken_quick_reaction_text != "":
                    await self._upsert_assistant_transcript(
                        turn_state,
                        text=combined_text,
                        raw_text=combined_raw_text,
                        is_streaming=False,
                    )
                    await self._replace_bubble(
                        turn_state,
                        bubble_text=combined_text,
                        is_streaming=False,
                    )
                return
            if turn_state.primary_chunk_seen:
                combined_text = self._compose_assistant_visible_text(turn_state)
                combined_raw_text = self._compose_assistant_raw_text(turn_state)
                await self._upsert_assistant_transcript(
                    turn_state,
                    text=combined_text,
                    raw_text=combined_raw_text,
                    is_streaming=False,
                )
            elif turn_state.spoken_quick_reaction_text != "":
                await self._upsert_assistant_transcript(
                    turn_state,
                    text=turn_state.spoken_quick_reaction_text,
                    is_streaming=False,
                )
                await self._replace_bubble(
                    turn_state,
                    bubble_text=turn_state.spoken_quick_reaction_text,
                    is_streaming=False,
                )
            return

        if isinstance(event, TTSChunkQueuedEvent):
            if event.payload.tts_stream_id == turn_state.turn_context.primary_tts_stream_id:
                turn_state.primary_tts_chunk_queued = True
            elif event.payload.tts_stream_id == turn_state.turn_context.quick_reaction_stream_id:
                if self._config.suppress_bubble_and_expression:
                    return
                turn_state.quick_tts_chunk_queued = True
                turn_state.spoken_quick_reaction_text = self._append_visible_assistant_text(
                    turn_state.spoken_quick_reaction_text,
                    event.payload.text,
                )
                if turn_state.is_hidden_ambient_turn:
                    return
                combined_text = self._compose_assistant_visible_text(turn_state)
                combined_raw_text = self._compose_assistant_raw_text(turn_state)
                await self._upsert_assistant_transcript(
                    turn_state,
                    text=combined_text,
                    raw_text=combined_raw_text,
                    is_streaming=not turn_state.response_completed,
                )
                await self._replace_bubble(
                    turn_state,
                    bubble_text=combined_text,
                    is_streaming=not turn_state.response_completed,
                )
            return

        if isinstance(event, TTSPlaybackStartedEvent):
            return

        if isinstance(event, TTSPlaybackFinishedEvent):
            if event.payload.tts_stream_id == turn_state.turn_context.primary_tts_stream_id:
                turn_state.primary_playback_finished = True
            elif event.payload.tts_stream_id == turn_state.turn_context.quick_reaction_stream_id:
                turn_state.quick_playback_finished = True
            return

    async def _upsert_user_transcript(
        self,
        turn_state: _ActiveTurnState,
        *,
        text: str,
    ) -> None:
        response = await self._desktop_bridge_session.upsert_transcript(
            session_id=self._config.session_id,
            turn_id=turn_state.turn_context.turn_id,
            role=DesktopLive2DCompanionTranscriptRole.USER,
            text=text,
            raw_text=text,
            is_streaming=False,
        )
        turn_state.companion_responses.append(response)
        self._latest_companion_session_snapshot = response.companion_session_snapshot

    async def _upsert_assistant_transcript(
        self,
        turn_state: _ActiveTurnState,
        *,
        text: str,
        raw_text: str = "",
        is_streaming: bool,
    ) -> None:
        normalized_text = self._strip_leading_line_breaks(text)
        normalized_raw_text = self._strip_leading_line_breaks(raw_text)
        if normalized_text.strip() == "":
            return
        response = await self._desktop_bridge_session.upsert_transcript(
            session_id=self._config.session_id,
            turn_id=turn_state.turn_context.turn_id,
            role=DesktopLive2DCompanionTranscriptRole.ASSISTANT,
            text=normalized_text,
            raw_text=normalized_raw_text,
            is_streaming=is_streaming,
        )
        turn_state.companion_responses.append(response)
        self._latest_companion_session_snapshot = response.companion_session_snapshot

    async def _replace_bubble(
        self,
        turn_state: _ActiveTurnState,
        *,
        bubble_text: str,
        is_streaming: bool,
    ) -> None:
        if self._config.suppress_bubble_and_expression:
            return
        normalized_bubble_text = self._sanitize_protocol_markup_text(
            self._strip_leading_line_breaks(bubble_text)
        )
        if normalized_bubble_text.strip() == "":
            return
        response = await self._desktop_bridge_session.replace_bubble(
            bubble_text=normalized_bubble_text,
            speaker_label=self._config.bubble_speaker_label,
            is_streaming=is_streaming,
        )
        turn_state.bubble_responses.append(response)
        turn_state.bubble_cleared = False

    async def _append_bubble(
        self,
        turn_state: _ActiveTurnState,
        *,
        text_fragment: str,
        is_streaming: bool,
    ) -> None:
        if self._config.suppress_bubble_and_expression:
            return
        text_fragment = self._sanitize_protocol_markup_text(text_fragment)
        if text_fragment.strip() == "":
            return
        response = await self._desktop_bridge_session.append_bubble(
            text_fragment=text_fragment,
            speaker_label=self._config.bubble_speaker_label,
            is_streaming=is_streaming,
        )
        turn_state.bubble_responses.append(response)
        turn_state.bubble_cleared = False

    async def _clear_bubble(
        self,
        turn_state: _ActiveTurnState,
        *,
        reason: str,
    ) -> None:
        if self._config.suppress_bubble_and_expression:
            return
        response = await self._desktop_bridge_session.clear_bubble(reason=reason)
        turn_state.bubble_responses.append(response)
        turn_state.bubble_cleared = True

    async def _maybe_settle_bubble(
        self,
        turn_state: _ActiveTurnState,
        *,
        reason: str,
    ) -> None:
        if (
            not self._config.clear_bubble_after_turn_settlement
            or turn_state.bubble_cleared
        ):
            return

        if turn_state.primary_chunk_seen:
            if not turn_state.response_completed:
                return
            if turn_state.primary_tts_chunk_queued and not turn_state.primary_playback_finished:
                return
            await self._clear_bubble(
                turn_state,
                reason=f"primary_playback_settled:{reason}",
            )
            return

        if not turn_state.response_completed:
            return

        if turn_state.spoken_quick_reaction_text == "":
            await self._clear_bubble(
                turn_state,
                reason=f"empty_response_settled:{reason}",
            )
            return

        if turn_state.quick_tts_chunk_queued and not turn_state.quick_playback_finished:
            return

        await self._clear_bubble(
            turn_state,
            reason=f"quick_playback_settled:{reason}",
        )

    async def _finalize_bubble_after_turn_resolution(
        self,
        turn_state: _ActiveTurnState,
    ) -> None:
        if (
            not self._config.clear_bubble_after_turn_settlement
            or turn_state.bubble_cleared
            or not turn_state.bubble_responses
        ):
            return
        await self._clear_bubble(
            turn_state,
            reason="turn_resolution_completed",
        )

    async def _clear_expression_after_turn_resolution(
        self,
        turn_state: _ActiveTurnState,
    ) -> None:
        if self._config.suppress_bubble_and_expression:
            return
        if not turn_state.expression_command_seen:
            return
        await asyncio.sleep(self._POST_TURN_EXPRESSION_CLEAR_DELAY_SEC)
        await self._renderer_service.dispatch_command(
            RendererCommand(
                command_type=RendererCommandType.CLEAR_EXPRESSION,
                target="expression",
                value=True,
                is_interruptible=True,
            ),
            adapter_key_override=self._config.desktop_bridge_config.adapter_key,
        )

    def _extract_visible_quick_reaction_text(
        self,
        quick_text: str,
    ) -> tuple[str | None, bool]:
        parser = ExpressionParser(
            self._config.orchestrator_config.parser_max_tag_buffer_chars
        )
        parsed = parser.feed(quick_text)
        tail = parser.end_of_stream()
        visible_text = self._sanitize_protocol_markup_text(
            f"{parsed.clean_text}{tail.clean_text}"
        )
        expression_seen = self._parsed_result_contains_expression(parsed) or (
            self._parsed_result_contains_expression(tail)
        )
        if visible_text.strip() == "":
            return None, expression_seen
        return visible_text, expression_seen

    @staticmethod
    def _parsed_result_contains_expression(parsed_result) -> bool:
        for command in parsed_result.renderer_commands:
            if command.command_type == RendererCommandType.SET_EXPRESSION:
                return True
        for cue in parsed_result.special_cues:
            if (
                cue.renderer_command is not None
                and cue.renderer_command.command_type == RendererCommandType.SET_EXPRESSION
            ):
                return True
        return False

    @staticmethod
    def _is_cjk_character(value: str) -> bool:
        if value == "":
            return False
        code_point = ord(value)
        return (
            0x3400 <= code_point <= 0x4DBF
            or 0x4E00 <= code_point <= 0x9FFF
            or 0x3040 <= code_point <= 0x30FF
            or 0xAC00 <= code_point <= 0xD7AF
        )

    @classmethod
    def _append_visible_assistant_text(
        cls,
        existing_text: str,
        new_text: str,
    ) -> str:
        if new_text == "":
            return existing_text
        if existing_text == "":
            return new_text
        if existing_text.endswith((" ", "\n")):
            return f"{existing_text}{new_text}"
        if new_text.startswith(
            (" ", "\n", ".", ",", "!", "?", "。", "，", "！", "？", "；", "：", "、")
        ):
            return f"{existing_text}{new_text}"
        existing_tail = existing_text.rstrip()[-1]
        new_head = new_text.lstrip()[0]
        if (
            existing_tail.isalnum()
            and new_head.isalnum()
            and not cls._is_cjk_character(existing_tail)
            and not cls._is_cjk_character(new_head)
        ):
            return f"{existing_text} {new_text}"
        if (
            existing_tail in {".", "!", "?", ";", ":"}
            and new_head.isalnum()
            and not cls._is_cjk_character(new_head)
        ):
            return f"{existing_text} {new_text}"
        return f"{existing_text}{new_text}"

    @classmethod
    def _compose_assistant_visible_text(
        cls,
        turn_state: _ActiveTurnState,
    ) -> str:
        return cls._sanitize_protocol_markup_text(
            cls._append_visible_assistant_text(
                turn_state.spoken_quick_reaction_text,
                turn_state.primary_response_text,
            )
        )

    @classmethod
    def _compose_assistant_raw_text(
        cls,
        turn_state: _ActiveTurnState,
    ) -> str:
        return cls._append_visible_assistant_text(
            turn_state.spoken_quick_reaction_text,
            turn_state.primary_raw_response_text,
        )

    @staticmethod
    def _strip_leading_line_breaks(text: str) -> str:
        return text.lstrip("\r\n")

    @staticmethod
    def _is_hidden_ambient_turn(
        text: str,
        *,
        visible_in_transcript: bool,
    ) -> bool:
        return (not visible_in_transcript) and text.lstrip().startswith(_AMBIENT_PROMPT_PREFIX)

    @staticmethod
    def _extract_previous_ambient_comment_text(text: str) -> str:
        for line in text.splitlines():
            if line.startswith(_AMBIENT_PREVIOUS_COMMENT_PREFIX):
                return line.removeprefix(_AMBIENT_PREVIOUS_COMMENT_PREFIX).strip()
        return ""

    @staticmethod
    def _sanitize_ambient_output_text(text: str) -> str:
        cleaned = _AMBIENT_SILENCE_TOKEN_RE.sub("", text)
        cleaned = DesktopCompanionSessionService._sanitize_protocol_markup_text(cleaned)
        cleaned = DesktopCompanionSessionService._strip_leading_line_breaks(cleaned)
        return cleaned.strip()

    @staticmethod
    def _sanitize_protocol_markup_text(text: str) -> str:
        cleaned = _PROTOCOL_BLOCK_TAG_RE.sub("", text)
        cleaned = _PROTOCOL_INLINE_COMMAND_TAG_RE.sub("", cleaned)
        cleaned = _PROTOCOL_SQUARE_TAG_RE.sub("", cleaned)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
        cleaned = re.sub(r" *\n+ *", "\n", cleaned)
        cleaned = re.sub(r"\s+([,.;:!?，。！？；：、])", r"\1", cleaned)
        return cleaned.strip()

    @classmethod
    def _normalize_ambient_similarity_text(cls, text: str) -> str:
        cleaned = cls._sanitize_ambient_output_text(text).casefold()
        return _AMBIENT_SIMILARITY_CLEAN_RE.sub("", cleaned)

    @classmethod
    def _is_hard_duplicate_ambient_response(
        cls,
        previous_text: str,
        current_text: str,
    ) -> bool:
        normalized_current = cls._normalize_ambient_similarity_text(current_text)
        if normalized_current == "":
            return True
        normalized_previous = cls._normalize_ambient_similarity_text(previous_text)
        if normalized_previous == "":
            return False
        if normalized_previous == normalized_current:
            return True
        shorter_length = min(len(normalized_previous), len(normalized_current))
        longer_length = max(len(normalized_previous), len(normalized_current))
        if (
            shorter_length >= 12
            and (normalized_previous in normalized_current or normalized_current in normalized_previous)
        ):
            return True
        if longer_length == 0:
            return False
        similarity_ratio = SequenceMatcher(
            a=normalized_previous,
            b=normalized_current,
        ).ratio()
        length_delta_ratio = abs(len(normalized_previous) - len(normalized_current)) / longer_length
        return (
            similarity_ratio >= _AMBIENT_DUPLICATE_RATIO_THRESHOLD
            and length_delta_ratio <= 0.35
        )

    async def _resolve_hidden_ambient_response_policy(
        self,
        turn_state: _ActiveTurnState,
    ) -> None:
        if not turn_state.is_hidden_ambient_turn or turn_state.ambient_response_policy_resolved:
            return
        visible_text = self._sanitize_ambient_output_text(
            self._compose_assistant_visible_text(turn_state)
        )
        is_duplicate = self._is_hard_duplicate_ambient_response(
            turn_state.previous_ambient_comment_text,
            visible_text,
        )
        turn_state.ambient_response_policy_resolved = True
        turn_state.ambient_response_allowed = not is_duplicate
        turn_state.ambient_response_suppressed = is_duplicate
        if turn_state.ambient_tts_gate is not None:
            turn_state.ambient_tts_gate.set()

    async def _await_active_turn_tts_permission(self) -> bool:
        turn_state = self._active_turn_state
        if turn_state is None or not turn_state.is_hidden_ambient_turn:
            return True
        if turn_state.ambient_response_policy_resolved:
            return turn_state.ambient_response_allowed
        if turn_state.ambient_tts_gate is None:
            return True
        await turn_state.ambient_tts_gate.wait()
        return turn_state.ambient_response_allowed

    async def _build_run_result(
        self,
        turn_state: _ActiveTurnState,
    ) -> DesktopCompanionSessionRunResult:
        if turn_state.companion_responses:
            final_companion_snapshot = (
                turn_state.companion_responses[-1].companion_session_snapshot
            )
        else:
            final_companion_snapshot = (
                await self._desktop_bridge_session.snapshot_companion_session()
            ).companion_session_snapshot

        if turn_state.bubble_responses:
            final_bubble_response = turn_state.bubble_responses[-1]
        else:
            final_bubble_response = await self._desktop_bridge_session.snapshot_bubble()

        final_audio_playback_response = self._desktop_audio_sink.get_last_response_for_turn(
            turn_state.turn_context.turn_id
        )
        if final_audio_playback_response is None:
            final_audio_playback_response = (
                await self._desktop_bridge_session.snapshot_audio_playback()
            )
        final_recovery_snapshot = self._runtime_supervisor.get_recovery_snapshot(
            self._config.session_id
        )
        return DesktopCompanionSessionRunResult(
            turn_context=turn_state.turn_context,
            ingested_events=tuple(turn_state.ingested_events),
            protocol_events=tuple(turn_state.protocol_events),
            runtime_process_results=tuple(turn_state.runtime_process_results),
            bubble_responses=tuple(turn_state.bubble_responses),
            companion_session_responses=tuple(turn_state.companion_responses),
            final_companion_session_snapshot=final_companion_snapshot,
            final_bubble_response=final_bubble_response,
            final_audio_playback_response=final_audio_playback_response,
            final_recovery_snapshot=final_recovery_snapshot,
        )

    async def _build_turn_failure(
        self,
        turn_state: _ActiveTurnState,
        cause: Exception,
    ) -> DesktopCompanionSessionServiceFailure:
        companion_snapshot = await self._safe_snapshot_companion_session()
        bubble_response = await self._safe_snapshot_bubble()
        audio_response = await self._safe_snapshot_audio_playback()
        recovery_snapshot = self._safe_recovery_snapshot()
        return DesktopCompanionSessionServiceFailure(
            operation_kind="run_text_turn",
            session_id=self._config.session_id,
            exception_type=type(cause).__name__,
            exception_message=str(cause),
            turn_context=turn_state.turn_context,
            ingested_events=tuple(turn_state.ingested_events),
            protocol_events=tuple(turn_state.protocol_events),
            runtime_process_results=tuple(turn_state.runtime_process_results),
            bubble_responses=tuple(turn_state.bubble_responses),
            companion_session_responses=tuple(turn_state.companion_responses),
            partial_companion_session_snapshot=companion_snapshot,
            partial_bubble_response=bubble_response,
            partial_audio_playback_response=audio_response,
            recovery_snapshot=recovery_snapshot,
        )

    async def _build_input_drain_failure(
        self,
        cause: Exception,
    ) -> DesktopCompanionSessionServiceFailure:
        return DesktopCompanionSessionServiceFailure(
            operation_kind="drain_desktop_inputs",
            session_id=self._config.session_id,
            exception_type=type(cause).__name__,
            exception_message=str(cause),
            partial_companion_session_snapshot=await self._safe_snapshot_companion_session(),
            partial_bubble_response=await self._safe_snapshot_bubble(),
            partial_audio_playback_response=await self._safe_snapshot_audio_playback(),
            recovery_snapshot=self._safe_recovery_snapshot(),
        )

    async def _safe_snapshot_companion_session(
        self,
    ) -> DesktopLive2DCompanionSessionSnapshot | None:
        if not self._transport.is_running() and self._transcript_source is None:
            return None
        bridge_snapshot: DesktopLive2DCompanionSessionSnapshot | None = None
        if self._transport.is_running():
            try:
                response = await self._desktop_bridge_session.snapshot_companion_session()
            except Exception:
                if self._transcript_source is None:
                    return None
            else:
                bridge_snapshot = response.companion_session_snapshot
        try:
            snapshot = self._build_effective_companion_session_snapshot(bridge_snapshot)
        except Exception:
            return bridge_snapshot
        self._latest_companion_session_snapshot = snapshot
        return snapshot

    async def _safe_snapshot_bubble(self) -> DesktopLive2DBubbleResponse | None:
        if not self._transport.is_running():
            return None
        try:
            return await self._desktop_bridge_session.snapshot_bubble()
        except Exception:
            return None

    async def _safe_snapshot_audio_playback(
        self,
    ) -> DesktopLive2DAudioPlaybackResponse | None:
        if not self._transport.is_running():
            return None
        try:
            return await self._desktop_bridge_session.snapshot_audio_playback()
        except Exception:
            return None

    def _safe_recovery_snapshot(self) -> SessionRecoverySnapshot | None:
        try:
            return self._runtime_supervisor.get_recovery_snapshot(self._config.session_id)
        except Exception:
            return None


__all__ = [
    "DesktopCompanionSessionDesktopSnapshot",
    "DesktopCompanionSessionInputDrainResult",
    "DesktopCompanionSessionRunResult",
    "DesktopCompanionSessionSubmitInputResult",
    "DesktopCompanionSessionService",
    "DesktopCompanionSessionServiceConfig",
    "DesktopCompanionSessionServiceFailure",
    "DesktopCompanionSessionServiceHaltedError",
    "build_default_desktop_companion_session_service_config",
]
