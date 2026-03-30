from __future__ import annotations

import asyncio
import re
import unicodedata
from collections.abc import AsyncIterator
from dataclasses import dataclass
from enum import Enum
from typing import Protocol, runtime_checkable
from uuid import UUID, uuid4

from pydantic import ConfigDict, Field

from packages.llm.errors import LLMProviderFailure
from packages.llm.models import (
    LLMCompletion,
    LLMImageAttachment,
    LLMIntentDecisionKind,
    LLMIntentRouteDecision,
    LLMGenerationConfig,
    LLMMessage,
    LLMMessageRole,
    LLMRequestContext,
    LLMRouteKind,
    LLMTextDelta,
    LLMToolCallIntent,
)
from packages.llm.service import LLMService
from packages.orchestrator.audio_mutex import (
    AudioMutex,
    AudioOwner,
    OrchestratorConfig,
    OrchestratorModel,
)
from packages.orchestrator.expression_parser import ExpressionParser, ParsedExpressionResult, StageCue
from packages.orchestrator.tts_audio_sink import (
    TTSAudioPlaybackReportKind,
    TTSAudioSinkDelivery,
    TTSAudioSinkPort,
    TTSAudioSinkResult,
)
from packages.protocol.events import (
    AssistantResponseChunkEvent,
    AssistantResponseCompletedEvent,
    BaseEvent,
    ChunkPlaybackFinished,
    ChunkPlaybackStarted,
    EchoProtocolModel,
    InterruptSignal,
    InterruptSignalEvent,
    PlaybackFinished,
    PlaybackStarted,
    QuickReaction,
    QuickReactionReadyEvent,
    RendererCommand,
    RendererCommandIssuedEvent,
    RendererCommandType,
    ResponseCompleted,
    ResponseTextChunk,
    SourceType,
    TTSChunk,
    TTSChunkFinishedEvent,
    TTSChunkQueuedEvent,
    TTSChunkStartedEvent,
    TTSPlaybackFinishedEvent,
    TTSPlaybackStartedEvent,
)
from packages.renderer.service import RendererService
from packages.tts.service import TTSService


class TurnContext(OrchestratorModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=False,
        validate_assignment=True,
    )
    turn_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    trace_id: UUID
    utterance_text: str = Field(min_length=1)
    input_images: tuple[LLMImageAttachment, ...] = ()
    recent_context_messages: tuple[LLMMessage, ...] = ()
    quick_reaction_stream_id: UUID = Field(default_factory=uuid4)
    primary_response_stream_id: UUID = Field(default_factory=uuid4)
    primary_tts_stream_id: UUID = Field(default_factory=uuid4)


class TurnResolutionSnapshot(OrchestratorModel):
    is_drafter_done: bool
    is_primary_done: bool
    is_playback_active: bool
    pending_playback_chunks: int = Field(ge=0)
    is_renderer_queue_empty: bool
    is_tts_request_queue_empty: bool
    is_stage_cue_queue_empty: bool = True
    is_stage_cue_dispatch_idle: bool = True
    has_unresolved_interrupt_barrier: bool = False


class TTSDispatchBinding(OrchestratorModel):
    owner: AudioOwner
    voice_profile_key: str | None = Field(default=None, min_length=1, max_length=128)
    provider_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )


class RendererDispatchBinding(OrchestratorModel):
    adapter_profile_key: str | None = Field(default=None, min_length=1, max_length=128)


@runtime_checkable
class ProtocolEventSinkPort(Protocol):
    async def send_protocol_event(
        self,
        event: BaseEvent,
    ) -> None: ...


class HiddenIntentRoutingStatus(str, Enum):
    SKIPPED = "skipped"
    DECIDED = "decided"
    TIMED_OUT = "timed_out"
    FAILED = "failed"


class PrimaryProfileSelectionSource(str, Enum):
    DEFAULT_ROUTE = "default_route"
    LOCAL_PRIMARY = "local_primary"
    CLOUD_PRIMARY = "cloud_primary"


class HiddenIntentRoutingResolution(OrchestratorModel):
    status: HiddenIntentRoutingStatus
    decision: LLMIntentRouteDecision | None = None
    detail: str | None = None


class PrimaryStartupSelection(OrchestratorModel):
    hidden_routing: HiddenIntentRoutingResolution
    selected_source: PrimaryProfileSelectionSource
    selected_profile_key: str | None = Field(default=None, min_length=1, max_length=128)
    degraded_cloud_tool: bool = False
    short_circuit_with_quick_reaction: bool = False
    detail: str | None = None

    @property
    def uses_default_primary_route(self) -> bool:
        return self.selected_profile_key is None


class _QuickReactionHandoffState:
    def __init__(self) -> None:
        self.materialized_spoken_text: str | None = None
        self.is_audible_local_prefix = False


@dataclass(slots=True)
class _QueuedStageCue:
    delay_ms: int | None = None
    renderer_command: RendererCommand | None = None
    dispatch_binding: RendererDispatchBinding | None = None
    emit_protocol_event: bool = False


class _StageCueDispatchState:
    def __init__(self) -> None:
        self.is_busy = False


class TurnOrchestrator:
    _TURN_RESOLUTION_POLL_INTERVAL_SEC = 0.01
    _PRIMARY_TTS_BOOST_CHUNK_COUNT = 2
    _PRIMARY_TTS_MIN_WORD_UNITS = 4
    _PRIMARY_TTS_BOOST_MAX_WORD_UNITS = 8
    _PRIMARY_TTS_MAX_WORD_UNITS = 12
    _PRIMARY_TTS_MIN_CJK_GRAPHEMES = 6
    _PRIMARY_TTS_BOOST_MAX_CJK_GRAPHEMES = 18
    _PRIMARY_TTS_MAX_CJK_GRAPHEMES = 28
    _PRIMARY_TTS_HARD_BOUNDARY_GRAPHEMES = frozenset(
        (".", "!", "?", "。", "！", "？", "…", "\n")
    )
    _PRIMARY_TTS_SOFT_BOUNDARY_GRAPHEMES = frozenset(
        (",", "，", ";", "；", ":", "：", "、", ")", "]", "}", "）", "】", "」", "』")
    )
    _TTS_MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\((?:[^()\\]|\\.)*?\)")
    _TTS_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\((?:[^()\\]|\\.)*?\)")
    _TTS_AUTOLINK_RE = re.compile(r"<(https?://[^>\s]+)>", re.IGNORECASE)
    _TTS_URL_RE = re.compile(r"https?://[^\s)]+", re.IGNORECASE)
    _TTS_HEADING_RE = re.compile(r"(?m)^\s{0,3}#{1,6}\s*")
    _TTS_BLOCKQUOTE_RE = re.compile(r"(?m)^\s{0,3}>\s?")
    _TTS_BULLET_RE = re.compile(r"(?m)^\s*[-*+]\s+")
    _TTS_ORDERED_LIST_RE = re.compile(r"(?m)^\s*\d+[.)][ \t]*")
    _TTS_SNAKE_CASE_SEPARATOR_RE = re.compile(r"(?<=\w)_(?=\w)")
    _INTENT_ROUTING_SYSTEM_INSTRUCTIONS = (
        "Classify the user's latest utterance into one hidden routing decision. "
        "Choose exactly one of: action_feedback, local_chat, cloud_primary, "
        "cloud_tool. This decision is internal only and must not contain "
        "assistant-visible reply text."
    )
    _INTENT_ROUTING_DEVELOPER_INSTRUCTIONS = (
        "Return only a structured routing decision. Do not write assistant "
        "speech, markdown, or explanatory prose outside the decision itself."
    )
    _QUICK_REACTION_SYSTEM_INSTRUCTIONS = (
        "Produce one short quick reaction to the user's latest utterance. "
        "Keep it low-latency, brief, and non-committal. You may include "
        "expression tags such as [Smile] or <action=nod> if they help the "
        "later expression parser."
    )
    _QUICK_REACTION_DEVELOPER_INSTRUCTIONS = (
        "Return only the quick reaction text with no speaker labels, no "
        "explanatory preamble, and no markdown fences."
    )
    _PRIMARY_RESPONSE_SYSTEM_INSTRUCTIONS = (
        "Answer the user's latest utterance directly. Preserve raw response "
        "text exactly and leave any expression tags untouched for a later "
        "expression parser. Do not produce tool-call output in this route."
    )
    _PRIMARY_RESPONSE_DEVELOPER_INSTRUCTIONS = (
        "Return only assistant response text suitable for streaming. Do not "
        "wrap the answer in speaker labels or transport metadata."
    )

    def __init__(
        self,
        config: OrchestratorConfig,
        audio_mutex: AudioMutex,
        protocol_event_sink: ProtocolEventSinkPort | None = None,
        renderer_service: RendererService | None = None,
        llm_service: LLMService | None = None,
        tts_service: TTSService | None = None,
        tts_audio_sink: TTSAudioSinkPort | None = None,
    ) -> None:
        self.config = config
        self.audio_mutex = audio_mutex
        self._protocol_event_sink = protocol_event_sink
        self._renderer_service = renderer_service
        self._llm_service = llm_service
        self._tts_service = tts_service
        self._tts_audio_sink = tts_audio_sink
        self._active_turn_context: TurnContext | None = None
        self._active_quick_reaction_finished_event: asyncio.Event | None = None
        self._active_protocol_event_queue: asyncio.Queue[BaseEvent] | None = None
        self._active_interrupt_event: asyncio.Event | None = None
        self._active_renderer_command_queue: asyncio.Queue[RendererCommand] | None = None
        self._active_tts_request_queue: asyncio.Queue[TTSChunk] | None = None
        self._active_stage_cue_queue: asyncio.Queue[_QueuedStageCue] | None = None
        self._interrupt_barrier_resolved_event: asyncio.Event | None = None
        self._active_renderer_dispatch_bindings: dict[
            UUID,
            RendererDispatchBinding,
        ] | None = None

    def get_protocol_event_sink(self) -> ProtocolEventSinkPort | None:
        return self._protocol_event_sink

    def set_protocol_event_sink(
        self,
        protocol_event_sink: ProtocolEventSinkPort | None,
    ) -> None:
        self._protocol_event_sink = protocol_event_sink

    def get_renderer_service(self) -> RendererService | None:
        return self._renderer_service

    def set_renderer_service(
        self,
        renderer_service: RendererService | None,
    ) -> None:
        self._renderer_service = renderer_service

    def get_llm_service(self) -> LLMService | None:
        return self._llm_service

    def set_llm_service(self, llm_service: LLMService | None) -> None:
        self._llm_service = llm_service

    def get_tts_service(self) -> TTSService | None:
        return self._tts_service

    def set_tts_service(self, tts_service: TTSService | None) -> None:
        self._tts_service = tts_service

    def get_tts_audio_sink(self) -> TTSAudioSinkPort | None:
        return self._tts_audio_sink

    def set_tts_audio_sink(self, tts_audio_sink: TTSAudioSinkPort | None) -> None:
        self._tts_audio_sink = tts_audio_sink

    @staticmethod
    def _first_non_cancelled_exception(
        results: tuple[object, ...] | list[object],
    ) -> BaseException | None:
        for result in results:
            if isinstance(result, BaseException) and not isinstance(
                result,
                asyncio.CancelledError,
            ):
                return result
        return None

    @staticmethod
    def _coerce_tts_audio_sink_result(
        result: TTSAudioSinkResult | None,
    ) -> TTSAudioSinkResult:
        if result is None:
            return TTSAudioSinkResult()
        return result

    @staticmethod
    def _task_exception(
        task: asyncio.Task[object],
    ) -> BaseException | None:
        if not task.done() or task.cancelled():
            return None
        try:
            return task.exception()
        except asyncio.CancelledError:
            return None

    def _is_local_fast_backed_quick_reaction_enabled(
        self,
        ctx: TurnContext,
    ) -> bool:
        llm_service = self._llm_service
        quick_profile_key = self.config.llm_quick_reaction_profile_key
        local_primary_profile_key = self.config.llm_local_primary_response_profile_key
        if (
            llm_service is None
            or quick_profile_key is None
            or local_primary_profile_key is None
        ):
            return False
        registry = llm_service.get_registry()
        quick_route = registry.describe_route(
            LLMRouteKind.QUICK_REACTION,
            profile_key=quick_profile_key,
            context=self._build_llm_request_context(ctx, LLMRouteKind.QUICK_REACTION),
        )
        local_primary_route = registry.describe_route(
            LLMRouteKind.PRIMARY_RESPONSE,
            profile_key=local_primary_profile_key,
            context=self._build_llm_request_context(ctx, LLMRouteKind.PRIMARY_RESPONSE),
        )
        return quick_route.provider_key == local_primary_route.provider_key

    async def handle_user_turn(
        self,
        ctx: TurnContext,
    ) -> None:
        """
        Entry point after user.speech.end has been accepted and the
        state machine has entered THINKING.
        """
        interrupt_event = asyncio.Event()
        drafter_done_event = asyncio.Event()
        primary_done_event = asyncio.Event()
        primary_first_chunk_ready_event = asyncio.Event()
        primary_chunks_consumed_event = asyncio.Event()
        quick_reaction_finished_event = asyncio.Event()
        quick_reaction_resolved_event = asyncio.Event()
        quick_reaction_handoff_state = _QuickReactionHandoffState()
        allow_audible_quick_reaction = self._is_local_fast_backed_quick_reaction_enabled(
            ctx
        )

        primary_chunk_queue: asyncio.Queue[str | None] = asyncio.Queue(
            maxsize=self.config.max_pending_primary_chunks
        )
        protocol_event_queue: asyncio.Queue[BaseEvent] = asyncio.Queue()
        renderer_command_queue: asyncio.Queue[RendererCommand] = asyncio.Queue()
        tts_request_queue: asyncio.Queue[TTSChunk] = asyncio.Queue()
        stage_cue_queue: asyncio.Queue[_QueuedStageCue] = asyncio.Queue()
        stage_cue_dispatch_state = _StageCueDispatchState()

        previous_protocol_event_queue = self._active_protocol_event_queue
        previous_interrupt_event = self._active_interrupt_event
        previous_renderer_queue = self._active_renderer_command_queue
        previous_tts_queue = self._active_tts_request_queue
        previous_stage_cue_queue = self._active_stage_cue_queue
        previous_barrier_event = self._interrupt_barrier_resolved_event
        previous_turn_context = self._active_turn_context
        previous_quick_finished_event = self._active_quick_reaction_finished_event
        previous_renderer_dispatch_bindings = self._active_renderer_dispatch_bindings
        interrupt_barrier_resolved_event = asyncio.Event()
        interrupt_barrier_resolved_event.set()

        self._active_turn_context = ctx
        self._active_quick_reaction_finished_event = quick_reaction_finished_event
        self._active_protocol_event_queue = protocol_event_queue
        self._active_interrupt_event = interrupt_event
        self._active_renderer_command_queue = renderer_command_queue
        self._active_tts_request_queue = tts_request_queue
        self._active_stage_cue_queue = stage_cue_queue
        self._interrupt_barrier_resolved_event = interrupt_barrier_resolved_event
        self._active_renderer_dispatch_bindings = {}

        drafter_task = asyncio.create_task(
            self._run_local_drafter(
                ctx=ctx,
                interrupt_event=interrupt_event,
                renderer_command_queue=renderer_command_queue,
                tts_request_queue=tts_request_queue,
                stage_cue_queue=stage_cue_queue,
                drafter_done_event=drafter_done_event,
                quick_reaction_finished_event=quick_reaction_finished_event,
                allow_audible_quick_reaction=allow_audible_quick_reaction,
                quick_reaction_handoff_state=quick_reaction_handoff_state,
                quick_reaction_resolved_event=quick_reaction_resolved_event,
            )
        )

        primary_task = asyncio.create_task(
            self._run_primary_reasoning(
                ctx=ctx,
                interrupt_event=interrupt_event,
                primary_chunk_queue=primary_chunk_queue,
                primary_done_event=primary_done_event,
                primary_chunks_consumed_event=primary_chunks_consumed_event,
                allow_audible_quick_reaction=allow_audible_quick_reaction,
                quick_reaction_handoff_state=quick_reaction_handoff_state,
                quick_reaction_resolved_event=quick_reaction_resolved_event,
            )
        )

        primary_consumer_task = asyncio.create_task(
            self._consume_primary_chunks(
                ctx=ctx,
                interrupt_event=interrupt_event,
                primary_chunk_queue=primary_chunk_queue,
                renderer_command_queue=renderer_command_queue,
                tts_request_queue=tts_request_queue,
                stage_cue_queue=stage_cue_queue,
                primary_first_chunk_ready_event=primary_first_chunk_ready_event,
                primary_chunks_consumed_event=primary_chunks_consumed_event,
            )
        )

        stage_cue_task = asyncio.create_task(
            self._dispatch_stage_cues(
                interrupt_event=interrupt_event,
                renderer_command_queue=renderer_command_queue,
                stage_cue_queue=stage_cue_queue,
                dispatch_state=stage_cue_dispatch_state,
            )
        )

        renderer_task = asyncio.create_task(
            self._dispatch_renderer_commands(
                interrupt_event=interrupt_event,
                renderer_command_queue=renderer_command_queue,
            )
        )

        protocol_event_task = asyncio.create_task(
            self._dispatch_protocol_events(
                interrupt_event=interrupt_event,
                protocol_event_queue=protocol_event_queue,
            )
        )

        tts_task = asyncio.create_task(
            self._dispatch_tts_chunks(
                ctx=ctx,
                interrupt_event=interrupt_event,
                tts_request_queue=tts_request_queue,
            )
        )

        main_results: list[object] | None = None
        dispatch_results: tuple[object, ...] = ()
        try:
            main_results = await asyncio.gather(
                drafter_task,
                primary_task,
                primary_consumer_task,
                return_exceptions=True,
            )
            main_error = self._first_non_cancelled_exception(main_results)
            if main_error is not None:
                raise main_error

            dispatch_error = self._first_non_cancelled_exception(
                (
                    self._task_exception(renderer_task),
                    self._task_exception(protocol_event_task),
                    self._task_exception(tts_task),
                    self._task_exception(stage_cue_task),
                )
            )
            if dispatch_error is not None:
                raise dispatch_error

            await self._wait_for_turn_resolution(
                drafter_done_event=drafter_done_event,
                primary_done_event=primary_done_event,
                renderer_command_queue=renderer_command_queue,
                tts_request_queue=tts_request_queue,
                stage_cue_queue=stage_cue_queue,
                stage_cue_dispatch_state=stage_cue_dispatch_state,
            )
        finally:
            interrupt_event.set()
            stage_cue_task.cancel()
            renderer_task.cancel()
            protocol_event_task.cancel()
            tts_task.cancel()
            dispatch_results = tuple(
                await asyncio.gather(
                stage_cue_task,
                renderer_task,
                protocol_event_task,
                tts_task,
                return_exceptions=True,
            )
            )
            self._active_turn_context = previous_turn_context
            self._active_quick_reaction_finished_event = previous_quick_finished_event
            self._active_protocol_event_queue = previous_protocol_event_queue
            self._active_interrupt_event = previous_interrupt_event
            self._active_renderer_command_queue = previous_renderer_queue
            self._active_tts_request_queue = previous_tts_queue
            self._active_stage_cue_queue = previous_stage_cue_queue
            self._interrupt_barrier_resolved_event = previous_barrier_event
            self._active_renderer_dispatch_bindings = previous_renderer_dispatch_bindings

        dispatch_error = self._first_non_cancelled_exception(dispatch_results)
        if dispatch_error is not None:
            raise dispatch_error

    def _build_turn_resolution_snapshot(
        self,
        drafter_done_event: asyncio.Event,
        primary_done_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        tts_request_queue: asyncio.Queue[TTSChunk],
        stage_cue_queue: asyncio.Queue[_QueuedStageCue],
        stage_cue_dispatch_state: _StageCueDispatchState,
    ) -> TurnResolutionSnapshot:
        playback_snapshot = self.audio_mutex.get_snapshot()
        return TurnResolutionSnapshot(
            is_drafter_done=drafter_done_event.is_set(),
            is_primary_done=primary_done_event.is_set(),
            is_playback_active=playback_snapshot.playback_active,
            pending_playback_chunks=playback_snapshot.pending_chunks,
            is_renderer_queue_empty=renderer_command_queue.empty(),
            is_tts_request_queue_empty=tts_request_queue.empty(),
            is_stage_cue_queue_empty=stage_cue_queue.empty(),
            is_stage_cue_dispatch_idle=not stage_cue_dispatch_state.is_busy,
            has_unresolved_interrupt_barrier=self._has_unresolved_interrupt_barrier(),
        )

    def _is_turn_resolved(
        self,
        snapshot: TurnResolutionSnapshot,
    ) -> bool:
        return (
            snapshot.is_drafter_done
            and snapshot.is_primary_done
            and not snapshot.is_playback_active
            and snapshot.pending_playback_chunks == 0
            and snapshot.is_renderer_queue_empty
            and snapshot.is_tts_request_queue_empty
            and snapshot.is_stage_cue_queue_empty
            and snapshot.is_stage_cue_dispatch_idle
            and not snapshot.has_unresolved_interrupt_barrier
        )

    async def _wait_for_turn_resolution(
        self,
        drafter_done_event: asyncio.Event,
        primary_done_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        tts_request_queue: asyncio.Queue[TTSChunk],
        stage_cue_queue: asyncio.Queue[_QueuedStageCue],
        stage_cue_dispatch_state: _StageCueDispatchState,
    ) -> TurnResolutionSnapshot:
        deadline = (
            asyncio.get_running_loop().time()
            + (self.config.turn_resolution_timeout_ms / 1000.0)
        )
        snapshot = self._build_turn_resolution_snapshot(
            drafter_done_event=drafter_done_event,
            primary_done_event=primary_done_event,
            renderer_command_queue=renderer_command_queue,
            tts_request_queue=tts_request_queue,
            stage_cue_queue=stage_cue_queue,
            stage_cue_dispatch_state=stage_cue_dispatch_state,
        )
        while True:
            if self._is_turn_resolved(snapshot):
                return snapshot
            if asyncio.get_running_loop().time() >= deadline:
                return snapshot
            await asyncio.sleep(self._TURN_RESOLUTION_POLL_INTERVAL_SEC)
            snapshot = self._build_turn_resolution_snapshot(
                drafter_done_event=drafter_done_event,
                primary_done_event=primary_done_event,
                renderer_command_queue=renderer_command_queue,
                tts_request_queue=tts_request_queue,
                stage_cue_queue=stage_cue_queue,
                stage_cue_dispatch_state=stage_cue_dispatch_state,
            )

    def _has_unresolved_interrupt_barrier(self) -> bool:
        if self._interrupt_barrier_resolved_event is None:
            return False
        return not self._interrupt_barrier_resolved_event.is_set()

    def _resolve_active_turn_stream_owner(
        self,
        tts_stream_id: UUID,
    ) -> AudioOwner | None:
        if self._active_turn_context is None:
            return None
        if tts_stream_id == self._active_turn_context.quick_reaction_stream_id:
            return AudioOwner.QUICK_REACTION
        if tts_stream_id == self._active_turn_context.primary_tts_stream_id:
            return AudioOwner.PRIMARY_RESPONSE
        return None

    def _resolve_tts_dispatch_binding(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSDispatchBinding:
        if chunk.tts_stream_id == ctx.quick_reaction_stream_id:
            return TTSDispatchBinding(
                owner=AudioOwner.QUICK_REACTION,
                voice_profile_key=self.config.tts_quick_reaction_voice_profile_key,
                provider_profile_key=(
                    self.config.tts_quick_reaction_provider_profile_key
                ),
            )
        if chunk.tts_stream_id == ctx.primary_tts_stream_id:
            return TTSDispatchBinding(
                owner=AudioOwner.PRIMARY_RESPONSE,
                voice_profile_key=self.config.tts_primary_response_voice_profile_key,
                provider_profile_key=(
                    self.config.tts_primary_response_provider_profile_key
                ),
            )
        raise RuntimeError(
            "TurnOrchestrator cannot resolve TTS dispatch binding for "
            f"unknown tts_stream_id {chunk.tts_stream_id}"
        )

    def _require_tts_service(self) -> TTSService:
        if self._tts_service is None:
            raise RuntimeError(
                "TurnOrchestrator requires tts_service to dispatch TTSChunk output"
            )
        return self._tts_service

    def _require_tts_audio_sink(self) -> TTSAudioSinkPort:
        if self._tts_audio_sink is None:
            raise RuntimeError(
                "TurnOrchestrator requires tts_audio_sink to dispatch synthesized audio fragments"
            )
        return self._tts_audio_sink

    def _require_renderer_service(self) -> RendererService:
        if self._renderer_service is None:
            raise RuntimeError(
                "TurnOrchestrator requires renderer_service to dispatch renderer commands"
            )
        return self._renderer_service

    def _resolve_renderer_dispatch_binding(
        self,
        owner: AudioOwner,
    ) -> RendererDispatchBinding:
        if owner == AudioOwner.QUICK_REACTION:
            return RendererDispatchBinding(
                adapter_profile_key=self.config.renderer_quick_reaction_profile_key
            )
        if owner == AudioOwner.PRIMARY_RESPONSE:
            return RendererDispatchBinding(
                adapter_profile_key=self.config.renderer_primary_response_profile_key
            )
        raise RuntimeError(
            "TurnOrchestrator cannot resolve renderer dispatch binding for "
            f"owner '{owner.value}'"
        )

    def _remember_renderer_dispatch_binding(
        self,
        *,
        command: RendererCommand,
        dispatch_binding: RendererDispatchBinding,
    ) -> None:
        if self._active_renderer_dispatch_bindings is None:
            return
        self._active_renderer_dispatch_bindings[command.command_id] = dispatch_binding

    def _forget_renderer_dispatch_binding(
        self,
        command_id: UUID,
    ) -> RendererDispatchBinding:
        if self._active_renderer_dispatch_bindings is None:
            return RendererDispatchBinding()
        return self._active_renderer_dispatch_bindings.pop(
            command_id,
            RendererDispatchBinding(),
        )

    def _clear_pending_queue(self, queue: asyncio.Queue[object]) -> None:
        while True:
            try:
                item = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            if isinstance(item, RendererCommand):
                self._forget_renderer_dispatch_binding(item.command_id)

    def _build_protocol_event(
        self,
        event_cls: type[BaseEvent],
        payload: EchoProtocolModel,
    ) -> BaseEvent | None:
        if self._active_turn_context is None:
            return None
        return event_cls(
            trace_id=self._active_turn_context.trace_id,
            session_id=self._active_turn_context.session_id,
            source_type=SourceType.SYSTEM,
            source="system.orchestrator",
            payload=payload,
            metadata={"turn_id": self._active_turn_context.turn_id},
        )

    async def _emit_protocol_event(
        self,
        event_cls: type[BaseEvent],
        payload: EchoProtocolModel,
    ) -> BaseEvent | None:
        event = self._build_protocol_event(event_cls=event_cls, payload=payload)
        if event is None or self._active_protocol_event_queue is None:
            return event
        await self._active_protocol_event_queue.put(event)
        return event

    async def _queue_renderer_command(
        self,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        command: RendererCommand,
        dispatch_binding: RendererDispatchBinding | None,
        emit_protocol_event: bool,
    ) -> None:
        self._remember_renderer_dispatch_binding(
            command=command,
            dispatch_binding=dispatch_binding or RendererDispatchBinding(),
        )
        await renderer_command_queue.put(command)
        if emit_protocol_event:
            await self._emit_protocol_event(RendererCommandIssuedEvent, command)

    def _coerce_stage_cues(
        self,
        parsed: ParsedExpressionResult,
    ) -> tuple[StageCue, ...]:
        supported_expr_lower = frozenset(
            e.lower() for e in self.config.avatar_supported_expressions
        )
        motion_canonical: dict[str, str] = {
            m.lower(): m for m in self.config.avatar_supported_motions
        }

        cues_to_validate = (
            tuple(parsed.special_cues)
            if parsed.special_cues
            else tuple(
                StageCue(
                    kind="renderer_command",
                    renderer_command=command,
                )
                for command in parsed.renderer_commands
            )
        )

        coerced: list[StageCue] = []
        for cue in cues_to_validate:
            if cue.renderer_command is None:
                coerced.append(cue)
                continue

            command = cue.renderer_command
            if command.command_type == RendererCommandType.SET_EXPRESSION:
                if command.target not in {"expression", "avatar.expression"}:
                    continue
                if str(command.value).lower() not in supported_expr_lower:
                    continue
            elif command.command_type == RendererCommandType.SET_MOTION:
                if command.target not in {"motion", "avatar.motion"}:
                    continue
                canonical = motion_canonical.get(str(command.value).lower())
                if canonical is None:
                    continue
                if str(command.value) != canonical:
                    command = RendererCommand(
                        command_id=command.command_id,
                        command_type=command.command_type,
                        target=command.target,
                        value=canonical,
                        intensity=command.intensity,
                        duration_ms=command.duration_ms,
                        is_interruptible=command.is_interruptible,
                    )
            coerced.append(
                cue.model_copy(
                    update={"renderer_command": command}
                )
            )
        return tuple(coerced)

    @staticmethod
    def _build_queued_stage_cue(
        cue: StageCue,
        *,
        dispatch_binding: RendererDispatchBinding,
        emit_protocol_event: bool,
    ) -> _QueuedStageCue:
        return _QueuedStageCue(
            delay_ms=cue.delay_ms,
            renderer_command=cue.renderer_command,
            dispatch_binding=dispatch_binding if cue.renderer_command is not None else None,
            emit_protocol_event=emit_protocol_event if cue.renderer_command is not None else False,
        )

    async def _emit_stage_cues(
        self,
        *,
        parsed: ParsedExpressionResult,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        stage_cue_queue: asyncio.Queue[_QueuedStageCue] | None,
        dispatch_binding: RendererDispatchBinding,
        emit_protocol_event: bool,
        interrupt_event: asyncio.Event,
    ) -> None:
        for cue in self._coerce_stage_cues(parsed):
            if interrupt_event.is_set():
                return
            queued_cue = self._build_queued_stage_cue(
                cue,
                dispatch_binding=dispatch_binding,
                emit_protocol_event=emit_protocol_event,
            )
            if stage_cue_queue is not None:
                await stage_cue_queue.put(queued_cue)
                continue
            await self._process_stage_cue(
                interrupt_event=interrupt_event,
                renderer_command_queue=renderer_command_queue,
                queued_cue=queued_cue,
            )

    async def _process_stage_cue(
        self,
        *,
        interrupt_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        queued_cue: _QueuedStageCue,
    ) -> None:
        if queued_cue.delay_ms is not None:
            if queued_cue.delay_ms == 0:
                return
            try:
                await asyncio.wait_for(
                    interrupt_event.wait(),
                    timeout=queued_cue.delay_ms / 1000.0,
                )
            except asyncio.TimeoutError:
                return
            return
        if interrupt_event.is_set() or queued_cue.renderer_command is None:
            return
        await self._queue_renderer_command(
            renderer_command_queue=renderer_command_queue,
            command=queued_cue.renderer_command,
            dispatch_binding=queued_cue.dispatch_binding,
            emit_protocol_event=queued_cue.emit_protocol_event,
        )

    async def _queue_tts_chunk(
        self,
        tts_request_queue: asyncio.Queue[TTSChunk],
        chunk: TTSChunk,
        emit_protocol_event: bool,
    ) -> None:
        await tts_request_queue.put(chunk)
        if emit_protocol_event:
            await self._emit_protocol_event(TTSChunkQueuedEvent, chunk)

    @classmethod
    def _iter_grapheme_clusters(cls, text: str):
        index = 0
        pending_regional_indicator: str | None = None
        while index < len(text):
            char = text[index]
            cluster = char
            index += 1
            while index < len(text):
                next_char = text[index]
                codepoint = ord(next_char)
                if next_char == "\u200d":
                    cluster += next_char
                    index += 1
                    if index < len(text):
                        cluster += text[index]
                        index += 1
                    continue
                if (
                    unicodedata.combining(next_char) > 0
                    or 0xFE00 <= codepoint <= 0xFE0F
                    or 0x1F3FB <= codepoint <= 0x1F3FF
                ):
                    cluster += next_char
                    index += 1
                    continue
                break

            if cls._is_regional_indicator(cluster):
                if pending_regional_indicator is None:
                    pending_regional_indicator = cluster
                    continue
                yield pending_regional_indicator + cluster
                pending_regional_indicator = None
                continue

            if pending_regional_indicator is not None:
                yield pending_regional_indicator
                pending_regional_indicator = None
            yield cluster

        if pending_regional_indicator is not None:
            yield pending_regional_indicator

    @staticmethod
    def _is_regional_indicator(text: str) -> bool:
        if len(text) != 1:
            return False
        codepoint = ord(text)
        return 0x1F1E6 <= codepoint <= 0x1F1FF

    @staticmethod
    def _is_cjk_grapheme(text: str) -> bool:
        for char in text:
            codepoint = ord(char)
            if (
                0x3400 <= codepoint <= 0x4DBF
                or 0x4E00 <= codepoint <= 0x9FFF
                or 0x3040 <= codepoint <= 0x309F
                or 0x30A0 <= codepoint <= 0x30FF
                or 0xAC00 <= codepoint <= 0xD7AF
            ):
                return True
        return False

    @staticmethod
    def _is_emoji_grapheme(text: str) -> bool:
        for char in text:
            codepoint = ord(char)
            if (
                char == "\u200d"
                or 0x1F1E6 <= codepoint <= 0x1F1FF
                or 0x1F300 <= codepoint <= 0x1FAFF
                or 0x2600 <= codepoint <= 0x27BF
                or 0xFE00 <= codepoint <= 0xFE0F
                or 0x1F3FB <= codepoint <= 0x1F3FF
            ):
                return True
        return False

    @classmethod
    def _is_speakable_word_grapheme(cls, text: str) -> bool:
        if cls._is_cjk_grapheme(text):
            return True
        for char in text:
            if char.isalnum():
                return True
            if unicodedata.category(char).startswith("L"):
                return True
        return False

    @classmethod
    def _normalize_tts_text(cls, text: str) -> str:
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        normalized = cls._TTS_MARKDOWN_IMAGE_RE.sub(r"\1", normalized)
        normalized = cls._TTS_MARKDOWN_LINK_RE.sub(r"\1", normalized)
        normalized = cls._TTS_AUTOLINK_RE.sub("", normalized)
        normalized = cls._TTS_URL_RE.sub("", normalized)
        normalized = cls._TTS_HEADING_RE.sub("", normalized)
        normalized = cls._TTS_BLOCKQUOTE_RE.sub("", normalized)
        normalized = cls._TTS_BULLET_RE.sub("", normalized)
        normalized = cls._TTS_ORDERED_LIST_RE.sub("", normalized)
        normalized = normalized.replace("```", "\n").replace("`", "")
        normalized = normalized.replace("**", "").replace("__", "").replace("~~", "")
        normalized = normalized.replace("*", "").replace("~", "")
        normalized = cls._TTS_SNAKE_CASE_SEPARATOR_RE.sub(" ", normalized)
        return unicodedata.normalize("NFC", normalized)

    @classmethod
    def _sanitize_tts_text(cls, text: str) -> str:
        normalized = cls._normalize_tts_text(text)
        sanitized_parts: list[str] = []
        last_was_space = False

        for grapheme in cls._iter_grapheme_clusters(normalized):
            if grapheme.isspace():
                replacement = "\n" if "\n" in grapheme else " "
                if replacement == "\n":
                    if sanitized_parts and sanitized_parts[-1] != "\n":
                        sanitized_parts.append("\n")
                    last_was_space = True
                    continue
                if not last_was_space and sanitized_parts and sanitized_parts[-1] != "\n":
                    sanitized_parts.append(" ")
                last_was_space = True
                continue

            if cls._is_emoji_grapheme(grapheme):
                continue

            if cls._is_speakable_word_grapheme(grapheme):
                sanitized_parts.append(grapheme)
                last_was_space = False
                continue

            if grapheme in cls._PRIMARY_TTS_HARD_BOUNDARY_GRAPHEMES:
                while sanitized_parts and sanitized_parts[-1] == " ":
                    sanitized_parts.pop()
                sanitized_parts.append(grapheme)
                last_was_space = False
                continue

            if grapheme in cls._PRIMARY_TTS_SOFT_BOUNDARY_GRAPHEMES:
                while sanitized_parts and sanitized_parts[-1] == " ":
                    sanitized_parts.pop()
                sanitized_parts.append(grapheme)
                last_was_space = False
                continue

            category = unicodedata.category(grapheme[0])
            if category.startswith("P"):
                sanitized_parts.append(grapheme)
                last_was_space = False

        sanitized = "".join(sanitized_parts).strip()
        sanitized = re.sub(r"[ \t]{2,}", " ", sanitized)
        sanitized = re.sub(r" *\n+ *", "\n", sanitized)
        return sanitized.strip()

    @classmethod
    def _append_sanitized_tts_text(
        cls,
        pending_text: str,
        new_text: str,
    ) -> str:
        sanitized_new = cls._sanitize_tts_text(new_text)
        if sanitized_new == "":
            return pending_text
        if pending_text == "":
            return sanitized_new
        if pending_text.endswith(("\n", " ")):
            return f"{pending_text}{sanitized_new}"
        if sanitized_new.startswith(
            ("\n", " ", ".", ",", "!", "?", "。", "，", "！", "？", "；", "：", "、")
        ):
            return f"{pending_text}{sanitized_new}"
        pending_tail = pending_text.rstrip()[-1]
        new_head = sanitized_new.lstrip()[0]
        if (
            cls._is_speakable_word_grapheme(pending_tail)
            and cls._is_speakable_word_grapheme(new_head)
            and not cls._is_cjk_grapheme(pending_tail)
            and not cls._is_cjk_grapheme(new_head)
        ):
            return f"{pending_text} {sanitized_new}"
        return f"{pending_text}{sanitized_new}"

    @classmethod
    def _classify_tts_grapheme(cls, grapheme: str) -> str:
        if grapheme == "":
            return "skip"
        if grapheme in cls._PRIMARY_TTS_HARD_BOUNDARY_GRAPHEMES:
            return "hard"
        if grapheme.isspace():
            return "space"
        if grapheme in cls._PRIMARY_TTS_SOFT_BOUNDARY_GRAPHEMES:
            return "soft"
        if cls._is_cjk_grapheme(grapheme):
            return "cjk_word"
        if cls._is_speakable_word_grapheme(grapheme):
            return "latin_word"
        return "skip"

    def _extract_ready_tts_chunks(
        self,
        text: str,
        *,
        emitted_chunk_count: int,
        is_final: bool,
    ) -> tuple[list[str], str]:
        remaining = text
        chunks: list[str] = []

        while remaining:
            maximum_units = (
                self._PRIMARY_TTS_BOOST_MAX_WORD_UNITS
                if emitted_chunk_count < self._PRIMARY_TTS_BOOST_CHUNK_COUNT
                else self._PRIMARY_TTS_MAX_WORD_UNITS
            )
            maximum_cjk_graphemes = (
                self._PRIMARY_TTS_BOOST_MAX_CJK_GRAPHEMES
                if emitted_chunk_count < self._PRIMARY_TTS_BOOST_CHUNK_COUNT
                else self._PRIMARY_TTS_MAX_CJK_GRAPHEMES
            )
            split_index = self._find_tts_chunk_split_index(
                remaining,
                required_units=self._PRIMARY_TTS_MIN_WORD_UNITS,
                maximum_units=maximum_units,
                required_cjk_graphemes=self._PRIMARY_TTS_MIN_CJK_GRAPHEMES,
                maximum_cjk_graphemes=maximum_cjk_graphemes,
                is_final=is_final,
            )
            if split_index is None:
                break

            chunk_text = remaining[:split_index].strip()
            remaining = remaining[split_index:].lstrip()
            if chunk_text == "":
                if is_final:
                    break
                continue
            chunks.append(chunk_text)
            emitted_chunk_count += 1

        return chunks, remaining

    def _find_tts_chunk_split_index(
        self,
        text: str,
        *,
        required_units: int,
        maximum_units: int,
        required_cjk_graphemes: int,
        maximum_cjk_graphemes: int,
        is_final: bool,
    ) -> int | None:
        word_units = 0
        cjk_graphemes = 0
        last_soft_index: int | None = None
        active_latin_word = False
        index = 0

        for grapheme in self._iter_grapheme_clusters(text):
            next_index = index + len(grapheme)
            category = self._classify_tts_grapheme(grapheme)
            index = next_index

            if category == "skip":
                continue
            if category == "space":
                active_latin_word = False
                if word_units > 0:
                    last_soft_index = next_index
                continue
            if category == "hard":
                active_latin_word = False
                if word_units > 0 or cjk_graphemes > 0:
                    return next_index
                continue
            if category == "soft":
                active_latin_word = False
                if word_units > 0 or cjk_graphemes > 0:
                    last_soft_index = next_index
                    if (
                        word_units >= required_units
                        or cjk_graphemes >= required_cjk_graphemes
                    ):
                        return last_soft_index
                continue
            if category == "cjk_word":
                active_latin_word = False
                cjk_graphemes += 1
            elif category == "latin_word":
                if not active_latin_word:
                    word_units += 1
                active_latin_word = True

            if word_units > maximum_units or cjk_graphemes > maximum_cjk_graphemes:
                return last_soft_index or next_index

        if is_final and (word_units > 0 or cjk_graphemes > 0):
            return len(text)
        return None

    async def _queue_primary_tts_chunk(
        self,
        *,
        ctx: TurnContext,
        tts_request_queue: asyncio.Queue[TTSChunk],
        chunk: TTSChunk,
    ) -> None:
        decision = await self.audio_mutex.submit_primary_chunk(
            stream_id=ctx.primary_tts_stream_id,
            chunk=chunk,
        )

        if decision == "play_now":
            await self._queue_tts_chunk(
                tts_request_queue=tts_request_queue,
                chunk=chunk,
                emit_protocol_event=True,
            )
            return

        if decision == "replace_after_chunk":
            ok = await self.audio_mutex.wait_for_safe_handoff(
                self.config.quick_reaction_max_wait_ms
            )
            if not ok:
                signal = await self.audio_mutex.force_replace()
                await self._apply_interrupt_signal(signal)
            await self._queue_tts_chunk(
                tts_request_queue=tts_request_queue,
                chunk=chunk,
                emit_protocol_event=True,
            )
            return

        if decision == "buffer":
            ok = await self.audio_mutex.wait_for_safe_handoff(
                self.config.interrupt_replace_timeout_ms
            )
            if not ok:
                signal = await self.audio_mutex.force_replace()
                await self._apply_interrupt_signal(signal)
            await self._queue_tts_chunk(
                tts_request_queue=tts_request_queue,
                chunk=chunk,
                emit_protocol_event=True,
            )
            return

        raise RuntimeError(
            f"audio mutex returned unsupported primary chunk decision: {decision}"
        )

    async def _mark_interrupt_barrier_unresolved(self) -> None:
        if self._interrupt_barrier_resolved_event is not None:
            self._interrupt_barrier_resolved_event.clear()

    async def _mark_interrupt_barrier_resolved(self) -> None:
        if self._interrupt_barrier_resolved_event is not None:
            self._interrupt_barrier_resolved_event.set()

    async def _run_local_drafter(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        tts_request_queue: asyncio.Queue[TTSChunk],
        drafter_done_event: asyncio.Event,
        quick_reaction_finished_event: asyncio.Event,
        *,
        stage_cue_queue: asyncio.Queue[_QueuedStageCue] | None = None,
        allow_audible_quick_reaction: bool = True,
        quick_reaction_handoff_state: _QuickReactionHandoffState | None = None,
        quick_reaction_resolved_event: asyncio.Event | None = None,
    ) -> None:
        parser = ExpressionParser(self.config.parser_max_tag_buffer_chars)
        claimed_audible_playback = False
        quick_reaction_handoff_state = (
            quick_reaction_handoff_state
            if quick_reaction_handoff_state is not None
            else _QuickReactionHandoffState()
        )
        quick_reaction_resolved_event = (
            quick_reaction_resolved_event
            if quick_reaction_resolved_event is not None
            else asyncio.Event()
        )

        try:
            try:
                quick = await self._generate_quick_reaction(ctx)
            except asyncio.CancelledError:
                raise
            except Exception:
                return
            if quick is None or interrupt_event.is_set():
                return
            await self._emit_protocol_event(QuickReactionReadyEvent, quick)

            parsed = parser.feed(quick.text)
            tail = parser.end_of_stream()
            quick_dispatch_binding = self._resolve_renderer_dispatch_binding(
                AudioOwner.QUICK_REACTION
            )
            await self._emit_stage_cues(
                parsed=parsed,
                renderer_command_queue=renderer_command_queue,
                stage_cue_queue=stage_cue_queue,
                dispatch_binding=quick_dispatch_binding,
                emit_protocol_event=False,
                interrupt_event=interrupt_event,
            )
            await self._emit_stage_cues(
                parsed=tail,
                renderer_command_queue=renderer_command_queue,
                stage_cue_queue=stage_cue_queue,
                dispatch_binding=quick_dispatch_binding,
                emit_protocol_event=False,
                interrupt_event=interrupt_event,
            )

            audible_chunks: list[TTSChunk] = []
            if parsed.clean_text:
                sanitized_text = self._sanitize_tts_text(parsed.clean_text)
                if sanitized_text:
                    audible_chunks.append(
                        TTSChunk(
                            tts_stream_id=ctx.quick_reaction_stream_id,
                            chunk_index=len(audible_chunks),
                            text=sanitized_text,
                            emotion_tags=quick.emotion_tags,
                            is_interruptible=quick.is_interruptible,
                        )
                    )
            if tail.clean_text:
                sanitized_text = self._sanitize_tts_text(tail.clean_text)
                if sanitized_text:
                    audible_chunks.append(
                        TTSChunk(
                            tts_stream_id=ctx.quick_reaction_stream_id,
                            chunk_index=len(audible_chunks),
                            text=sanitized_text,
                            emotion_tags=quick.emotion_tags,
                            is_interruptible=quick.is_interruptible,
                        )
                    )

            if not audible_chunks:
                return

            if allow_audible_quick_reaction:
                materialized_text = ""
                for chunk in audible_chunks:
                    materialized_text = self._append_sanitized_tts_text(
                        materialized_text,
                        chunk.text,
                    )
            else:
                return

            claimed = await self.audio_mutex.claim_for_quick_reaction(
                stream_id=ctx.quick_reaction_stream_id,
                chunks=audible_chunks,
            )
            if not claimed:
                return
            claimed_audible_playback = True

            queued_any_audible_chunk = False
            for chunk in audible_chunks:
                if interrupt_event.is_set():
                    break
                await self._queue_tts_chunk(
                    tts_request_queue=tts_request_queue,
                    chunk=chunk,
                    emit_protocol_event=True,
                )
                queued_any_audible_chunk = True

            if queued_any_audible_chunk:
                quick_reaction_handoff_state.materialized_spoken_text = materialized_text
                quick_reaction_handoff_state.is_audible_local_prefix = True

        finally:
            quick_reaction_resolved_event.set()
            drafter_done_event.set()
            if not claimed_audible_playback:
                quick_reaction_finished_event.set()

    async def _run_primary_reasoning(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        primary_chunk_queue: asyncio.Queue[str | None],
        primary_done_event: asyncio.Event,
        *,
        primary_chunks_consumed_event: asyncio.Event | None = None,
        allow_audible_quick_reaction: bool = False,
        quick_reaction_handoff_state: _QuickReactionHandoffState | None = None,
        quick_reaction_resolved_event: asyncio.Event | None = None,
    ) -> ResponseCompleted | None:
        raw_chunk_count = 0
        try:
            async for raw_chunk in self._stream_primary_response(
                ctx,
                allow_audible_quick_reaction=allow_audible_quick_reaction,
                quick_reaction_handoff_state=quick_reaction_handoff_state,
                quick_reaction_resolved_event=quick_reaction_resolved_event,
            ):
                if interrupt_event.is_set():
                    break
                raw_chunk_count += 1
                await primary_chunk_queue.put(raw_chunk)
        finally:
            await primary_chunk_queue.put(None)
            primary_done_event.set()

        if interrupt_event.is_set():
            return None
        if primary_chunks_consumed_event is not None:
            await primary_chunks_consumed_event.wait()

        completed_payload = ResponseCompleted(
            response_stream_id=ctx.primary_response_stream_id,
            final_chunk_index=max(raw_chunk_count - 1, 0),
            had_output=raw_chunk_count > 0,
        )
        await self._emit_protocol_event(
            AssistantResponseCompletedEvent,
            completed_payload,
        )
        return completed_payload

    def _require_llm_service(self, route_kind: LLMRouteKind) -> LLMService:
        if self._llm_service is None:
            raise RuntimeError(
                "TurnOrchestrator requires llm_service to serve "
                f"route '{route_kind.value}'"
            )
        return self._llm_service

    def _build_llm_request_context(
        self,
        ctx: TurnContext,
        route_kind: LLMRouteKind,
    ) -> LLMRequestContext:
        response_stream_id = None
        if route_kind == LLMRouteKind.QUICK_REACTION:
            response_stream_id = ctx.quick_reaction_stream_id
        elif route_kind == LLMRouteKind.PRIMARY_RESPONSE:
            response_stream_id = ctx.primary_response_stream_id
        return LLMRequestContext(
            session_id=ctx.session_id,
            trace_id=ctx.trace_id,
            turn_id=ctx.turn_id,
            route_kind=route_kind,
            response_stream_id=response_stream_id,
        )

    def _build_llm_messages(
        self,
        ctx: TurnContext,
        route_kind: LLMRouteKind,
        *,
        assistant_prefill_text: str | None = None,
    ) -> tuple[LLMMessage, ...]:
        messages: list[LLMMessage] = []
        if route_kind == LLMRouteKind.PRIMARY_RESPONSE:
            messages.extend(self._build_recent_context_messages(ctx))
        messages.append(
            LLMMessage(
                role=LLMMessageRole.USER,
                content=ctx.utterance_text,
                images=ctx.input_images,
            )
        )
        if (
            route_kind == LLMRouteKind.PRIMARY_RESPONSE
            and assistant_prefill_text is not None
        ):
            messages.append(
                LLMMessage(
                    role=LLMMessageRole.ASSISTANT,
                    content=assistant_prefill_text,
                )
            )
        return tuple(messages)

    def _build_recent_context_messages(
        self,
        ctx: TurnContext,
    ) -> tuple[LLMMessage, ...]:
        max_messages = self.config.recent_context_max_messages
        max_chars = self.config.recent_context_max_chars
        if max_messages <= 0 or max_chars <= 0 or not ctx.recent_context_messages:
            return ()

        collected: list[LLMMessage] = []
        char_count = 0
        for message in reversed(ctx.recent_context_messages):
            if message.role not in (LLMMessageRole.USER, LLMMessageRole.ASSISTANT):
                raise RuntimeError(
                    "TurnOrchestrator recent_context_messages must contain only canonical user/assistant messages"
                )
            if len(collected) >= max_messages:
                break
            next_count = char_count + len(message.content)
            if next_count > max_chars:
                break
            collected.append(message)
            char_count = next_count

        collected.reverse()
        return tuple(collected)

    def _build_intent_routing_generation_config(self) -> LLMGenerationConfig:
        return LLMGenerationConfig(
            max_output_tokens=24,
            timeout_ms=self.config.llm_intent_routing_timeout_ms,
            temperature=0.0,
        )

    def _build_quick_reaction_generation_config(self) -> LLMGenerationConfig:
        return LLMGenerationConfig(
            max_output_tokens=48,
            timeout_ms=300,
            temperature=0.7,
        )

    def _build_primary_response_generation_config(self) -> LLMGenerationConfig:
        return LLMGenerationConfig(
            max_output_tokens=512,
            timeout_ms=5_000,
            temperature=0.6,
        )

    def _build_avatar_expression_prompt_suffix(self) -> str:
        expressions = self.config.avatar_supported_expressions
        motions = self.config.avatar_supported_motions
        if not expressions and not motions:
            return ""
        parts: list[str] = []
        if expressions:
            tags = ", ".join(f"[{e}]" for e in expressions)
            parts.append(f"你的角色拥有以下表情：{tags}。")
        if motions:
            tags = ", ".join(f"<action={m}>" for m in motions)
            parts.append(f"你的角色可执行以下动作：{tags}。")
        parts.append(
            "请在回复中自然地穿插表情和动作标签来丰富角色表演。"
            "每隔约6-12个字应插入一个表情标签或动作标签。"
            "每个完整回复通常至少使用2个标签，并尽量同时包含expression和motion。"
            "不要连续插入两个同类标签（如两个表情标签之间至少隔几个字）。"
            "标签应匹配当前语境情感。"
            "如果可用动作里除了Idle之外还有其它动作，优先选择非Idle动作；只有在明确需要静止、停顿、收尾时才使用<action=Idle>。"
            "优先轮换使用不同的表情和动作，不要连续两轮重复上一轮刚用过的主表情或主动作，除非当前语境强烈要求。"
            "不要总是只用一个表情标签；在语气变化、停顿、转折、强调处积极补充不同标签。"
        )
        return " " + " ".join(parts)

    @property
    def _bilingual_mode(self) -> bool:
        v = self.config.voice_language
        s = self.config.subtitle_language
        return bool(v) and bool(s) and v != s

    def _build_bilingual_prompt_suffix(self) -> str:
        if not self._bilingual_mode:
            return ""
        voice_lang = self.config.voice_language
        subtitle_lang = self.config.subtitle_language
        return (
            f"\n\n【双语输出规则】\n"
            f"你必须同时用两种语言输出回复。语音语言为{voice_lang}，字幕语言为{subtitle_lang}。\n"
            f"格式要求：先用<voice>标签包裹{voice_lang}内容（用于语音合成），"
            f"再用<subtitle>标签包裹{subtitle_lang}内容（用于字幕显示）。\n"
            f"表情标签[...]和动作标签<action=...>只放在<voice>标签内部。\n"
            f"示例：<voice>[smile]こんにちは～今日はどうだった？</voice>"
            f"<subtitle>你好呀~今天过得怎么样呢？</subtitle>\n"
            f"每次回复必须同时包含且只包含一组<voice>和<subtitle>标签。"
            f"禁止输出这两个标签之外的裸文本。"
            f"<voice>内部只能使用{voice_lang}；禁止直接输出{subtitle_lang}。"
            f"<subtitle>内部只能使用{subtitle_lang}；禁止直接复用{voice_lang}原文。"
            f"两个标签的语义内容应一致，但不要求逐字翻译。"
        )

    def _build_bilingual_developer_suffix(self) -> str:
        if not self._bilingual_mode:
            return ""
        voice_lang = self.config.voice_language
        subtitle_lang = self.config.subtitle_language
        return (
            f" Bilingual output is mandatory. Emit exactly one <voice>...</voice> block in {voice_lang} "
            f"and exactly one <subtitle>...</subtitle> block in {subtitle_lang} for every reply. "
            "Do not emit any plain text outside those two blocks. "
            f"Do not use {subtitle_lang} inside <voice>. "
            f"Do not use {voice_lang} inside <subtitle>. "
            "If a draft violates these rules, rewrite it before returning."
        )

    def _build_persona_prompt_prefix(self) -> str:
        persona = self.config.avatar_persona_prompt
        if not persona:
            return ""
        roleplay_rules = (
            "\n\n【角色扮演规则】\n"
            "- 始终保持上述角色身份，不要跳出角色。\n"
            "- 用自然口语回复，禁止分点列举（1. 2. 3.）。\n"
            "- 每次回复简短自然，通常2-4句话，不要长篇大论。\n"
            "- 不要自称AI或助手。"
        )
        return persona + roleplay_rules + "\n\n"

    def _build_quick_reaction_system_instructions(self) -> str:
        return (
            self._build_persona_prompt_prefix()
            + self._QUICK_REACTION_SYSTEM_INSTRUCTIONS
            + self._build_avatar_expression_prompt_suffix()
            + self._build_bilingual_prompt_suffix()
        )

    def _build_quick_reaction_developer_instructions(self) -> str:
        return (
            self._QUICK_REACTION_DEVELOPER_INSTRUCTIONS
            + self._build_bilingual_developer_suffix()
        )

    def _build_primary_response_system_instructions(
        self,
        *,
        assistant_prefill_text: str | None = None,
    ) -> str:
        base = (
            self._build_persona_prompt_prefix()
            + self._PRIMARY_RESPONSE_SYSTEM_INSTRUCTIONS
            + self._build_avatar_expression_prompt_suffix()
            + self._build_bilingual_prompt_suffix()
        )
        if assistant_prefill_text is None:
            return base
        return (
            f"{base} "
            "The latest assistant message is already spoken to the user as the "
            "opening of this same assistant turn. Continue from that exact "
            "spoken prefix instead of restarting, repeating, or greeting again."
        )

    def _build_primary_response_developer_instructions(
        self,
        *,
        assistant_prefill_text: str | None = None,
    ) -> str:
        if assistant_prefill_text is None:
            return (
                self._PRIMARY_RESPONSE_DEVELOPER_INSTRUCTIONS
                + self._build_bilingual_developer_suffix()
            )
        return (
            f"{self._PRIMARY_RESPONSE_DEVELOPER_INSTRUCTIONS} "
            f"{self._build_bilingual_developer_suffix()} "
            "Treat the final assistant message in the prompt as already-spoken "
            "prefix text. Continue that same sentence or turn directly, and do "
            "not restate the prefix."
        )

    def _build_intent_routing_conversation(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
        *,
        provider_profile_key: str | None = None,
    ):
        return llm_service.build_conversation_input(
            route_kind=LLMRouteKind.INTENT_ROUTING,
            context=self._build_llm_request_context(ctx, LLMRouteKind.INTENT_ROUTING),
            messages=self._build_llm_messages(ctx, LLMRouteKind.INTENT_ROUTING),
            generation_config=self._build_intent_routing_generation_config(),
            system_instructions=self._INTENT_ROUTING_SYSTEM_INSTRUCTIONS,
            developer_instructions=self._INTENT_ROUTING_DEVELOPER_INSTRUCTIONS,
            provider_profile_key=provider_profile_key,
        )

    def _build_quick_reaction_conversation(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
        *,
        provider_profile_key: str | None = None,
    ):
        return llm_service.build_conversation_input(
            route_kind=LLMRouteKind.QUICK_REACTION,
            context=self._build_llm_request_context(ctx, LLMRouteKind.QUICK_REACTION),
            messages=self._build_llm_messages(ctx, LLMRouteKind.QUICK_REACTION),
            generation_config=self._build_quick_reaction_generation_config(),
            system_instructions=self._build_quick_reaction_system_instructions(),
            developer_instructions=self._build_quick_reaction_developer_instructions(),
            provider_profile_key=provider_profile_key,
        )

    def _build_primary_response_conversation(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
        *,
        provider_profile_key: str | None = None,
        assistant_prefill_text: str | None = None,
    ):
        return llm_service.build_conversation_input(
            route_kind=LLMRouteKind.PRIMARY_RESPONSE,
            context=self._build_llm_request_context(ctx, LLMRouteKind.PRIMARY_RESPONSE),
            messages=self._build_llm_messages(
                ctx,
                LLMRouteKind.PRIMARY_RESPONSE,
                assistant_prefill_text=assistant_prefill_text,
            ),
            generation_config=self._build_primary_response_generation_config(),
            system_instructions=self._build_primary_response_system_instructions(
                assistant_prefill_text=assistant_prefill_text
            ),
            developer_instructions=self._build_primary_response_developer_instructions(
                assistant_prefill_text=assistant_prefill_text
            ),
            provider_profile_key=provider_profile_key,
        )

    def _can_generate_hidden_intent_routing(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
    ) -> bool:
        try:
            llm_service.get_registry().resolve_for_generate(
                self._build_intent_routing_conversation(
                    ctx,
                    llm_service,
                    provider_profile_key=self.config.llm_intent_routing_profile_key,
                )
            )
        except Exception:
            return False
        return True

    def _can_stream_primary_profile(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
        profile_key: str | None,
    ) -> bool:
        if profile_key is None:
            return False
        try:
            llm_service.get_registry().resolve_for_stream(
                self._build_primary_response_conversation(
                    ctx,
                    llm_service,
                    provider_profile_key=profile_key,
                )
            )
        except Exception:
            return False
        return True

    async def _resolve_hidden_intent_routing(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
    ) -> HiddenIntentRoutingResolution:
        if not self._can_generate_hidden_intent_routing(ctx, llm_service):
            return HiddenIntentRoutingResolution(
                status=HiddenIntentRoutingStatus.SKIPPED,
                detail="hidden intent routing is unavailable for the current llm setup",
            )

        try:
            decision = await asyncio.wait_for(
                llm_service.decide_intent_route(
                    context=self._build_llm_request_context(
                        ctx,
                        LLMRouteKind.INTENT_ROUTING,
                    ),
                    messages=self._build_llm_messages(ctx, LLMRouteKind.INTENT_ROUTING),
                    generation_config=self._build_intent_routing_generation_config(),
                    system_instructions=self._INTENT_ROUTING_SYSTEM_INSTRUCTIONS,
                    developer_instructions=self._INTENT_ROUTING_DEVELOPER_INSTRUCTIONS,
                    provider_profile_key=self.config.llm_intent_routing_profile_key,
                ),
                timeout=self.config.llm_intent_routing_timeout_ms / 1000.0,
            )
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError:
            return HiddenIntentRoutingResolution(
                status=HiddenIntentRoutingStatus.TIMED_OUT,
                detail="hidden intent routing timed out",
            )
        except Exception as exc:
            return HiddenIntentRoutingResolution(
                status=HiddenIntentRoutingStatus.FAILED,
                detail=self._describe_hidden_routing_failure(exc),
            )

        return HiddenIntentRoutingResolution(
            status=HiddenIntentRoutingStatus.DECIDED,
            decision=decision,
        )

    async def _resolve_primary_startup_selection(
        self,
        ctx: TurnContext,
        llm_service: LLMService,
    ) -> PrimaryStartupSelection:
        hidden_routing = await self._resolve_hidden_intent_routing(ctx, llm_service)
        local_primary_profile_key = self.config.llm_local_primary_response_profile_key
        cloud_primary_profile_key = self.config.llm_cloud_primary_response_profile_key
        local_primary_available = self._can_stream_primary_profile(
            ctx,
            llm_service,
            local_primary_profile_key,
        )
        cloud_primary_available = self._can_stream_primary_profile(
            ctx,
            llm_service,
            cloud_primary_profile_key,
        )

        if hidden_routing.status == HiddenIntentRoutingStatus.DECIDED:
            assert hidden_routing.decision is not None
            return self._select_primary_startup_selection_from_decision(
                hidden_routing=hidden_routing,
                local_primary_profile_key=local_primary_profile_key,
                local_primary_available=local_primary_available,
                cloud_primary_profile_key=cloud_primary_profile_key,
                cloud_primary_available=cloud_primary_available,
            )

        if cloud_primary_available:
            return PrimaryStartupSelection(
                hidden_routing=hidden_routing,
                selected_source=PrimaryProfileSelectionSource.CLOUD_PRIMARY,
                selected_profile_key=cloud_primary_profile_key,
                detail="hidden routing fallback selected configured cloud primary profile",
            )

        return PrimaryStartupSelection(
            hidden_routing=hidden_routing,
            selected_source=PrimaryProfileSelectionSource.DEFAULT_ROUTE,
            detail="hidden routing fallback selected the default primary route binding",
        )

    def _select_primary_startup_selection_from_decision(
        self,
        *,
        hidden_routing: HiddenIntentRoutingResolution,
        local_primary_profile_key: str | None,
        local_primary_available: bool,
        cloud_primary_profile_key: str | None,
        cloud_primary_available: bool,
    ) -> PrimaryStartupSelection:
        assert hidden_routing.decision is not None
        decision_kind = hidden_routing.decision.decision_kind

        if decision_kind in {
            LLMIntentDecisionKind.LOCAL_CHAT,
        }:
            if local_primary_available:
                return PrimaryStartupSelection(
                    hidden_routing=hidden_routing,
                    selected_source=PrimaryProfileSelectionSource.LOCAL_PRIMARY,
                    selected_profile_key=local_primary_profile_key,
                    detail="hidden routing selected the configured local primary profile",
                )
            if cloud_primary_available:
                return PrimaryStartupSelection(
                    hidden_routing=hidden_routing,
                    selected_source=PrimaryProfileSelectionSource.CLOUD_PRIMARY,
                    selected_profile_key=cloud_primary_profile_key,
                    detail=(
                        "hidden routing preferred local primary but fell back to the "
                        "configured cloud primary profile"
                    ),
                )
            return PrimaryStartupSelection(
                hidden_routing=hidden_routing,
                selected_source=PrimaryProfileSelectionSource.DEFAULT_ROUTE,
                detail=(
                    "hidden routing preferred local primary but fell back to the "
                    "default primary route binding"
                ),
            )

        if decision_kind == LLMIntentDecisionKind.ACTION_FEEDBACK:
            if local_primary_available:
                return PrimaryStartupSelection(
                    hidden_routing=hidden_routing,
                    selected_source=PrimaryProfileSelectionSource.LOCAL_PRIMARY,
                    selected_profile_key=local_primary_profile_key,
                    short_circuit_with_quick_reaction=True,
                    detail=(
                        "hidden routing selected a local quick-reaction short-circuit "
                        "for trivial action feedback"
                    ),
                )
            if cloud_primary_available:
                return PrimaryStartupSelection(
                    hidden_routing=hidden_routing,
                    selected_source=PrimaryProfileSelectionSource.CLOUD_PRIMARY,
                    selected_profile_key=cloud_primary_profile_key,
                    detail=(
                        "hidden routing preferred local short-circuit feedback but "
                        "fell back to the configured cloud primary profile"
                    ),
                )
            return PrimaryStartupSelection(
                hidden_routing=hidden_routing,
                selected_source=PrimaryProfileSelectionSource.DEFAULT_ROUTE,
                detail=(
                    "hidden routing preferred local short-circuit feedback but "
                    "fell back to the default primary route binding"
                ),
            )

        if decision_kind == LLMIntentDecisionKind.CLOUD_PRIMARY:
            if cloud_primary_available:
                return PrimaryStartupSelection(
                    hidden_routing=hidden_routing,
                    selected_source=PrimaryProfileSelectionSource.CLOUD_PRIMARY,
                    selected_profile_key=cloud_primary_profile_key,
                    detail="hidden routing selected the configured cloud primary profile",
                )
            return PrimaryStartupSelection(
                hidden_routing=hidden_routing,
                selected_source=PrimaryProfileSelectionSource.DEFAULT_ROUTE,
                detail=(
                    "hidden routing requested cloud primary but fell back to the "
                    "default primary route binding"
                ),
            )

        if decision_kind == LLMIntentDecisionKind.CLOUD_TOOL:
            if cloud_primary_available:
                return PrimaryStartupSelection(
                    hidden_routing=hidden_routing,
                    selected_source=PrimaryProfileSelectionSource.CLOUD_PRIMARY,
                    selected_profile_key=cloud_primary_profile_key,
                    degraded_cloud_tool=True,
                    detail=(
                        "hidden routing requested cloud_tool and degraded explicitly "
                        "to the configured cloud primary profile"
                    ),
                )
            return PrimaryStartupSelection(
                hidden_routing=hidden_routing,
                selected_source=PrimaryProfileSelectionSource.DEFAULT_ROUTE,
                degraded_cloud_tool=True,
                detail=(
                    "hidden routing requested cloud_tool and degraded explicitly "
                    "to the default primary route binding"
                ),
            )

        return PrimaryStartupSelection(
            hidden_routing=hidden_routing,
            selected_source=PrimaryProfileSelectionSource.DEFAULT_ROUTE,
            detail="hidden routing produced an unsupported decision and defaulted",
        )

    @staticmethod
    def _describe_hidden_routing_failure(exc: Exception) -> str:
        if isinstance(exc, LLMProviderFailure):
            return str(exc)
        if str(exc):
            return str(exc)
        return type(exc).__name__

    async def _generate_quick_reaction(
        self,
        ctx: TurnContext,
    ) -> QuickReaction | None:
        llm_service = self._llm_service
        if (
            llm_service is None
            or self.config.llm_quick_reaction_profile_key is None
        ):
            return None
        completion = await llm_service.generate_quick_reaction(
            context=self._build_llm_request_context(
                ctx,
                LLMRouteKind.QUICK_REACTION,
            ),
            messages=self._build_llm_messages(ctx, LLMRouteKind.QUICK_REACTION),
            generation_config=self._build_quick_reaction_generation_config(),
            system_instructions=self._build_quick_reaction_system_instructions(),
            developer_instructions=self._build_quick_reaction_developer_instructions(),
            provider_profile_key=self.config.llm_quick_reaction_profile_key,
        )
        quick_text = self._completion_to_optional_text(completion)
        if quick_text is None:
            return None
        return QuickReaction(
            text=quick_text,
            is_interruptible=True,
        )

    async def _stream_primary_response(
        self,
        ctx: TurnContext,
        *,
        allow_audible_quick_reaction: bool = False,
        quick_reaction_handoff_state: _QuickReactionHandoffState | None = None,
        quick_reaction_resolved_event: asyncio.Event | None = None,
    ) -> AsyncIterator[str]:
        llm_service = self._require_llm_service(LLMRouteKind.PRIMARY_RESPONSE)
        startup_selection = await self._resolve_primary_startup_selection(
            ctx,
            llm_service,
        )
        assistant_prefill_text: str | None = None
        if allow_audible_quick_reaction and quick_reaction_resolved_event is not None:
            await quick_reaction_resolved_event.wait()
        if startup_selection.short_circuit_with_quick_reaction:
            if not allow_audible_quick_reaction:
                raise RuntimeError(
                    "local quick-reaction short-circuit requires a genuine local-fast audible route"
                )
            if (
                quick_reaction_handoff_state is None
                or not quick_reaction_handoff_state.is_audible_local_prefix
                or quick_reaction_handoff_state.materialized_spoken_text is None
            ):
                raise RuntimeError(
                    "local quick-reaction short-circuit requires spoken quick-reaction text"
                )
            return
        if (
            allow_audible_quick_reaction
            and quick_reaction_handoff_state is not None
            and quick_reaction_handoff_state.is_audible_local_prefix
        ):
            assistant_prefill_text = quick_reaction_handoff_state.materialized_spoken_text

        async for item in llm_service.stream_primary_response(
            context=self._build_llm_request_context(
                ctx,
                LLMRouteKind.PRIMARY_RESPONSE,
            ),
            messages=self._build_llm_messages(
                ctx,
                LLMRouteKind.PRIMARY_RESPONSE,
                assistant_prefill_text=assistant_prefill_text,
            ),
            generation_config=self._build_primary_response_generation_config(),
            system_instructions=self._build_primary_response_system_instructions(
                assistant_prefill_text=assistant_prefill_text
            ),
            developer_instructions=self._build_primary_response_developer_instructions(
                assistant_prefill_text=assistant_prefill_text
            ),
            provider_profile_key=startup_selection.selected_profile_key,
        ):
            if isinstance(item, LLMTextDelta):
                yield item.text
                continue
            if isinstance(item, LLMCompletion):
                continue
            if isinstance(item, LLMToolCallIntent):
                raise RuntimeError(
                    "TurnOrchestrator received unexpected tool-call intent from "
                    "the 'primary_response' route"
                )

    @staticmethod
    def _completion_to_optional_text(
        completion: LLMCompletion,
    ) -> str | None:
        if completion.output_text.strip() == "":
            return None
        return completion.output_text

    async def _consume_primary_chunks(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        primary_chunk_queue: asyncio.Queue[str | None],
        renderer_command_queue: asyncio.Queue[RendererCommand],
        tts_request_queue: asyncio.Queue[TTSChunk],
        primary_first_chunk_ready_event: asyncio.Event,
        *,
        stage_cue_queue: asyncio.Queue[_QueuedStageCue] | None = None,
        primary_chunks_consumed_event: asyncio.Event | None = None,
    ) -> None:
        parser = ExpressionParser(self.config.parser_max_tag_buffer_chars)
        voice_expression_parser = ExpressionParser(self.config.parser_max_tag_buffer_chars)
        response_chunk_index = 0
        tts_chunk_index = 0
        first_chunk_seen = False
        pending_tts_text = ""
        pending_raw_text = ""
        pending_subtitle_text = ""
        bilingual = self._bilingual_mode
        primary_dispatch_binding = self._resolve_renderer_dispatch_binding(
            AudioOwner.PRIMARY_RESPONSE
        )
        try:
            while True:
                item = await primary_chunk_queue.get()
                if item is None:
                    break
                if interrupt_event.is_set():
                    continue

                pending_raw_text += item
                parsed = parser.feed(item)

                if bilingual:
                    if parsed.voice_text:
                        voice_parsed = voice_expression_parser.feed(parsed.voice_text)
                        await self._emit_stage_cues(
                            parsed=voice_parsed,
                            renderer_command_queue=renderer_command_queue,
                            stage_cue_queue=stage_cue_queue,
                            dispatch_binding=primary_dispatch_binding,
                            emit_protocol_event=True,
                            interrupt_event=interrupt_event,
                        )
                        if voice_parsed.clean_text:
                            pending_tts_text = self._append_sanitized_tts_text(
                                pending_tts_text,
                                voice_parsed.clean_text,
                            )
                            ready_chunks, pending_tts_text = self._extract_ready_tts_chunks(
                                pending_tts_text,
                                emitted_chunk_count=tts_chunk_index,
                                is_final=False,
                            )
                            for ready_chunk in ready_chunks:
                                await self._queue_primary_tts_chunk(
                                    ctx=ctx,
                                    tts_request_queue=tts_request_queue,
                                    chunk=TTSChunk(
                                        tts_stream_id=ctx.primary_tts_stream_id,
                                        chunk_index=tts_chunk_index,
                                        text=ready_chunk,
                                        is_interruptible=True,
                                    ),
                                )
                                tts_chunk_index += 1
                    if parsed.subtitle_text:
                        pending_subtitle_text += parsed.subtitle_text
                    display_text = parsed.subtitle_text or parsed.clean_text
                    if display_text:
                        if not first_chunk_seen:
                            primary_first_chunk_ready_event.set()
                            first_chunk_seen = True
                        response_chunk = ResponseTextChunk(
                            response_stream_id=ctx.primary_response_stream_id,
                            chunk_index=response_chunk_index,
                            text=display_text,
                            raw_text=pending_raw_text,
                            subtitle_text=pending_subtitle_text,
                            is_final=False,
                            is_interruptible=True,
                        )
                        pending_raw_text = ""
                        pending_subtitle_text = ""
                        await self._emit_protocol_event(
                            AssistantResponseChunkEvent,
                            response_chunk,
                        )
                        response_chunk_index += 1
                else:
                    await self._emit_stage_cues(
                        parsed=parsed,
                        renderer_command_queue=renderer_command_queue,
                        stage_cue_queue=stage_cue_queue,
                        dispatch_binding=primary_dispatch_binding,
                        emit_protocol_event=True,
                        interrupt_event=interrupt_event,
                    )
                    if parsed.clean_text:
                        if not first_chunk_seen:
                            primary_first_chunk_ready_event.set()
                            first_chunk_seen = True

                        response_chunk = ResponseTextChunk(
                            response_stream_id=ctx.primary_response_stream_id,
                            chunk_index=response_chunk_index,
                            text=parsed.clean_text,
                            raw_text=pending_raw_text,
                            is_final=False,
                            is_interruptible=True,
                        )
                        pending_raw_text = ""
                        await self._emit_protocol_event(
                            AssistantResponseChunkEvent,
                            response_chunk,
                        )
                        response_chunk_index += 1
                        pending_tts_text = self._append_sanitized_tts_text(
                            pending_tts_text,
                            parsed.clean_text,
                        )
                        ready_chunks, pending_tts_text = self._extract_ready_tts_chunks(
                            pending_tts_text,
                            emitted_chunk_count=tts_chunk_index,
                            is_final=False,
                        )
                        for ready_chunk in ready_chunks:
                            await self._queue_primary_tts_chunk(
                                ctx=ctx,
                                tts_request_queue=tts_request_queue,
                                chunk=TTSChunk(
                                    tts_stream_id=ctx.primary_tts_stream_id,
                                    chunk_index=tts_chunk_index,
                                    text=ready_chunk,
                                    is_interruptible=True,
                                ),
                            )
                            tts_chunk_index += 1

            tail = parser.end_of_stream()

            if bilingual:
                if tail.voice_text:
                    voice_tail = voice_expression_parser.feed(tail.voice_text)
                    await self._emit_stage_cues(
                        parsed=voice_tail,
                        renderer_command_queue=renderer_command_queue,
                        stage_cue_queue=stage_cue_queue,
                        dispatch_binding=primary_dispatch_binding,
                        emit_protocol_event=True,
                        interrupt_event=interrupt_event,
                    )
                    if voice_tail.clean_text:
                        pending_tts_text = self._append_sanitized_tts_text(
                            pending_tts_text,
                            voice_tail.clean_text,
                        )
                voice_eos = voice_expression_parser.end_of_stream()
                await self._emit_stage_cues(
                    parsed=voice_eos,
                    renderer_command_queue=renderer_command_queue,
                    stage_cue_queue=stage_cue_queue,
                    dispatch_binding=primary_dispatch_binding,
                    emit_protocol_event=True,
                    interrupt_event=interrupt_event,
                )
                if voice_eos.clean_text:
                    pending_tts_text = self._append_sanitized_tts_text(
                        pending_tts_text,
                        voice_eos.clean_text,
                    )
                if tail.subtitle_text:
                    pending_subtitle_text += tail.subtitle_text
                display_text = tail.subtitle_text or tail.clean_text
                if display_text and not interrupt_event.is_set():
                    response_chunk = ResponseTextChunk(
                        response_stream_id=ctx.primary_response_stream_id,
                        chunk_index=response_chunk_index,
                        text=display_text,
                        raw_text=pending_raw_text,
                        subtitle_text=pending_subtitle_text,
                        is_final=True,
                        is_interruptible=True,
                    )
                    pending_raw_text = ""
                    pending_subtitle_text = ""
                    await self._emit_protocol_event(
                        AssistantResponseChunkEvent,
                        response_chunk,
                    )
                    response_chunk_index += 1
            else:
                await self._emit_stage_cues(
                    parsed=tail,
                    renderer_command_queue=renderer_command_queue,
                    stage_cue_queue=stage_cue_queue,
                    dispatch_binding=primary_dispatch_binding,
                    emit_protocol_event=True,
                    interrupt_event=interrupt_event,
                )
                if tail.clean_text and not interrupt_event.is_set():
                    response_chunk = ResponseTextChunk(
                        response_stream_id=ctx.primary_response_stream_id,
                        chunk_index=response_chunk_index,
                        text=tail.clean_text,
                        raw_text=pending_raw_text,
                        is_final=True,
                        is_interruptible=True,
                    )
                    pending_raw_text = ""
                    await self._emit_protocol_event(
                        AssistantResponseChunkEvent,
                        response_chunk,
                    )
                    pending_tts_text = self._append_sanitized_tts_text(
                        pending_tts_text,
                        tail.clean_text,
                    )

            if interrupt_event.is_set():
                return

            ready_chunks, pending_tts_text = self._extract_ready_tts_chunks(
                pending_tts_text,
                emitted_chunk_count=tts_chunk_index,
                is_final=True,
            )
            for ready_chunk in ready_chunks:
                await self._queue_primary_tts_chunk(
                    ctx=ctx,
                    tts_request_queue=tts_request_queue,
                    chunk=TTSChunk(
                        tts_stream_id=ctx.primary_tts_stream_id,
                        chunk_index=tts_chunk_index,
                        text=ready_chunk,
                        is_interruptible=True,
                    ),
                )
                tts_chunk_index += 1
        finally:
            if primary_chunks_consumed_event is not None:
                primary_chunks_consumed_event.set()

    async def _dispatch_protocol_events(
        self,
        interrupt_event: asyncio.Event,
        protocol_event_queue: asyncio.Queue[BaseEvent],
    ) -> None:
        while not interrupt_event.is_set():
            event = await protocol_event_queue.get()
            await self._send_protocol_event(event)

    async def _dispatch_renderer_commands(
        self,
        interrupt_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
    ) -> None:
        while not interrupt_event.is_set():
            cmd = await renderer_command_queue.get()
            await self._send_renderer_command(cmd)

    async def _dispatch_stage_cues(
        self,
        *,
        interrupt_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        stage_cue_queue: asyncio.Queue[_QueuedStageCue],
        dispatch_state: _StageCueDispatchState,
    ) -> None:
        while not interrupt_event.is_set():
            queued_cue = await stage_cue_queue.get()
            dispatch_state.is_busy = True
            try:
                await self._process_stage_cue(
                    interrupt_event=interrupt_event,
                    renderer_command_queue=renderer_command_queue,
                    queued_cue=queued_cue,
                )
            finally:
                dispatch_state.is_busy = False
                stage_cue_queue.task_done()

    async def _dispatch_tts_chunks(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        tts_request_queue: asyncio.Queue[TTSChunk],
    ) -> None:
        while not interrupt_event.is_set():
            chunk = await tts_request_queue.get()
            await self._send_tts_chunk(ctx, chunk)

    async def _apply_interrupt_signal(
        self,
        signal: InterruptSignal,
    ) -> None:
        await self._emit_protocol_event(InterruptSignalEvent, signal)
        del signal
        await self._mark_interrupt_barrier_unresolved()
        try:
            if self._active_interrupt_event is not None:
                self._active_interrupt_event.set()
            if self._active_renderer_command_queue is not None:
                self._clear_pending_queue(self._active_renderer_command_queue)
            if self._active_tts_request_queue is not None:
                self._clear_pending_queue(self._active_tts_request_queue)
            if self._active_stage_cue_queue is not None:
                self._clear_pending_queue(self._active_stage_cue_queue)
        finally:
            await self._mark_interrupt_barrier_resolved()
        return

    def _build_local_tts_playback_started_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSPlaybackStartedEvent:
        return TTSPlaybackStartedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="system.orchestrator",
            payload=PlaybackStarted(
                tts_stream_id=chunk.tts_stream_id,
                chunk_index=chunk.chunk_index,
                is_interruptible=chunk.is_interruptible,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "local_tts_reconciliation": True,
            },
        )

    def _build_local_tts_chunk_started_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSChunkStartedEvent:
        return TTSChunkStartedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="system.orchestrator",
            payload=ChunkPlaybackStarted(
                tts_stream_id=chunk.tts_stream_id,
                chunk_index=chunk.chunk_index,
                is_interruptible=chunk.is_interruptible,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "local_tts_reconciliation": True,
            },
        )

    def _build_local_tts_chunk_finished_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSChunkFinishedEvent:
        return TTSChunkFinishedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="system.orchestrator",
            payload=ChunkPlaybackFinished(
                tts_stream_id=chunk.tts_stream_id,
                chunk_index=chunk.chunk_index,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "local_tts_reconciliation": True,
            },
        )

    def _build_local_tts_playback_finished_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
        reason: str,
    ) -> TTSPlaybackFinishedEvent:
        return TTSPlaybackFinishedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="system.orchestrator",
            payload=PlaybackFinished(
                tts_stream_id=chunk.tts_stream_id,
                last_chunk_index=chunk.chunk_index,
                reason=reason,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "local_tts_reconciliation": True,
            },
        )

    def _build_desktop_audio_tts_playback_started_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSPlaybackStartedEvent:
        return TTSPlaybackStartedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="desktop.live2d.audio",
            payload=PlaybackStarted(
                tts_stream_id=chunk.tts_stream_id,
                chunk_index=chunk.chunk_index,
                is_interruptible=chunk.is_interruptible,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "desktop_audio_playback": True,
            },
        )

    def _build_desktop_audio_tts_chunk_started_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSChunkStartedEvent:
        return TTSChunkStartedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="desktop.live2d.audio",
            payload=ChunkPlaybackStarted(
                tts_stream_id=chunk.tts_stream_id,
                chunk_index=chunk.chunk_index,
                is_interruptible=chunk.is_interruptible,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "desktop_audio_playback": True,
            },
        )

    def _build_desktop_audio_tts_chunk_finished_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> TTSChunkFinishedEvent:
        return TTSChunkFinishedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="desktop.live2d.audio",
            payload=ChunkPlaybackFinished(
                tts_stream_id=chunk.tts_stream_id,
                chunk_index=chunk.chunk_index,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "desktop_audio_playback": True,
            },
        )

    def _build_desktop_audio_tts_playback_finished_event(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
        reason: str,
    ) -> TTSPlaybackFinishedEvent:
        return TTSPlaybackFinishedEvent(
            trace_id=ctx.trace_id,
            session_id=ctx.session_id,
            source_type=SourceType.SYSTEM,
            source="desktop.live2d.audio",
            payload=PlaybackFinished(
                tts_stream_id=chunk.tts_stream_id,
                last_chunk_index=chunk.chunk_index,
                reason=reason,
            ),
            metadata={
                "turn_id": ctx.turn_id,
                "desktop_audio_playback": True,
            },
        )

    async def _start_local_tts_reconciliation(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> None:
        await self.handle_tts_playback_started(
            self._build_local_tts_playback_started_event(ctx, chunk)
        )
        await self.handle_tts_chunk_started(
            self._build_local_tts_chunk_started_event(ctx, chunk)
        )

    async def _finish_local_tts_reconciliation(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
        reason: str,
    ) -> None:
        await self.handle_tts_chunk_finished(
            self._build_local_tts_chunk_finished_event(ctx, chunk)
        )
        await self.handle_tts_playback_finished(
            self._build_local_tts_playback_finished_event(ctx, chunk, reason)
        )

    async def _cleanup_preplayback_tts_dispatch_failure(
        self,
        chunk: TTSChunk,
    ) -> None:
        while True:
            snapshot = self.audio_mutex.get_snapshot()
            if (
                snapshot.stream_id != chunk.tts_stream_id
                or snapshot.pending_chunks == 0
            ):
                break
            await self.audio_mutex.notify_chunk_finished(chunk.tts_stream_id)
        await self.audio_mutex.notify_playback_finished(chunk.tts_stream_id)

    async def _apply_desktop_audio_playback_started(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> None:
        await self.handle_tts_playback_started(
            self._build_desktop_audio_tts_playback_started_event(ctx, chunk)
        )
        await self.handle_tts_chunk_started(
            self._build_desktop_audio_tts_chunk_started_event(ctx, chunk)
        )

    async def _apply_desktop_audio_playback_finished(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
        *,
        reason: str,
    ) -> None:
        await self.handle_tts_chunk_finished(
            self._build_desktop_audio_tts_chunk_finished_event(ctx, chunk)
        )
        await self.handle_tts_playback_finished(
            self._build_desktop_audio_tts_playback_finished_event(ctx, chunk, reason)
        )

    async def _consume_tts_audio_sink_result(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
        sink_result: TTSAudioSinkResult,
        *,
        playback_started: bool,
        playback_terminal: bool,
    ) -> tuple[bool, bool]:
        for report in sink_result.reports:
            if report.report_kind == TTSAudioPlaybackReportKind.ACCEPTED:
                continue
            if report.report_kind == TTSAudioPlaybackReportKind.STARTED:
                if not playback_started:
                    await self._apply_desktop_audio_playback_started(ctx, chunk)
                    playback_started = True
                continue
            if report.report_kind == TTSAudioPlaybackReportKind.FINISHED:
                if playback_started and not playback_terminal:
                    await self._apply_desktop_audio_playback_finished(
                        ctx,
                        chunk,
                        reason=report.reason or "desktop_audio_playback_finished",
                    )
                    playback_terminal = True
                continue
            if report.report_kind == TTSAudioPlaybackReportKind.ABORTED:
                if playback_started and not playback_terminal:
                    await self._apply_desktop_audio_playback_finished(
                        ctx,
                        chunk,
                        reason=report.reason or "desktop_audio_playback_aborted",
                    )
                else:
                    await self._cleanup_preplayback_tts_dispatch_failure(chunk)
                playback_terminal = True
                raise RuntimeError(report.message or "desktop audio playback aborted")
            if report.report_kind == TTSAudioPlaybackReportKind.FAILED:
                if playback_started and not playback_terminal:
                    await self._apply_desktop_audio_playback_finished(
                        ctx,
                        chunk,
                        reason=report.reason or "desktop_audio_playback_failed",
                    )
                else:
                    await self._cleanup_preplayback_tts_dispatch_failure(chunk)
                playback_terminal = True
                raise RuntimeError(report.message or "desktop audio playback failed")
        return playback_started, playback_terminal

    async def handle_tts_playback_started(
        self,
        event: TTSPlaybackStartedEvent,
    ) -> None:
        owner = self._resolve_active_turn_stream_owner(event.payload.tts_stream_id)
        if owner is None:
            return
        if (
            owner == AudioOwner.QUICK_REACTION
            and self._active_quick_reaction_finished_event is not None
        ):
            self._active_quick_reaction_finished_event.clear()
        await self.audio_mutex.notify_chunk_started(
            owner=owner,
            stream_id=event.payload.tts_stream_id,
            chunk_index=event.payload.chunk_index,
            is_interruptible=event.payload.is_interruptible,
        )

    async def handle_tts_chunk_started(
        self,
        event: TTSChunkStartedEvent,
    ) -> None:
        owner = self._resolve_active_turn_stream_owner(event.payload.tts_stream_id)
        if owner is None:
            return
        await self.audio_mutex.notify_chunk_started(
            owner=owner,
            stream_id=event.payload.tts_stream_id,
            chunk_index=event.payload.chunk_index,
            is_interruptible=event.payload.is_interruptible,
        )

    async def handle_tts_chunk_finished(
        self,
        event: TTSChunkFinishedEvent,
    ) -> None:
        owner = self._resolve_active_turn_stream_owner(event.payload.tts_stream_id)
        if owner is None:
            return
        await self.audio_mutex.notify_chunk_finished(event.payload.tts_stream_id)

    async def handle_tts_playback_finished(
        self,
        event: TTSPlaybackFinishedEvent,
    ) -> None:
        owner = self._resolve_active_turn_stream_owner(event.payload.tts_stream_id)
        if owner is None:
            return
        await self.audio_mutex.notify_playback_finished(event.payload.tts_stream_id)
        if (
            owner == AudioOwner.QUICK_REACTION
            and self._active_quick_reaction_finished_event is not None
        ):
            self._active_quick_reaction_finished_event.set()

    async def _send_renderer_command(
        self,
        cmd: RendererCommand,
    ) -> None:
        renderer_service = self._require_renderer_service()
        dispatch_binding = self._forget_renderer_dispatch_binding(cmd.command_id)
        await renderer_service.dispatch_command(
            command=cmd,
            adapter_profile_key=dispatch_binding.adapter_profile_key,
        )

    async def _send_tts_chunk(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> None:
        tts_service = self._require_tts_service()
        tts_audio_sink = self._require_tts_audio_sink()
        dispatch_binding = self._resolve_tts_dispatch_binding(ctx, chunk)

        previous_turn_context = self._active_turn_context
        restore_turn_context = False
        if self._active_turn_context is None:
            self._active_turn_context = ctx
            restore_turn_context = True

        local_playback_started = False
        sink_reports_seen = False
        sink_playback_started = False
        sink_playback_terminal = False
        primary_error: BaseException | None = None
        try:
            async for fragment in tts_service.synthesize_chunk(
                tts_chunk=chunk,
                voice_profile_key=dispatch_binding.voice_profile_key,
                provider_profile_key=dispatch_binding.provider_profile_key,
            ):
                try:
                    sink_result = self._coerce_tts_audio_sink_result(
                        await tts_audio_sink.deliver_audio_fragment(
                            TTSAudioSinkDelivery(
                                session_id=ctx.session_id,
                                trace_id=ctx.trace_id,
                                turn_id=ctx.turn_id,
                                owner=dispatch_binding.owner,
                                tts_chunk=chunk,
                                fragment=fragment,
                            )
                        )
                    )
                except BaseException as exc:
                    partial_result = getattr(exc, "partial_result", None)
                    if isinstance(partial_result, TTSAudioSinkResult):
                        sink_reports_seen = sink_reports_seen or bool(
                            partial_result.reports
                        )
                        (
                            sink_playback_started,
                            sink_playback_terminal,
                        ) = await self._consume_tts_audio_sink_result(
                            ctx,
                            chunk,
                            partial_result,
                            playback_started=sink_playback_started,
                            playback_terminal=sink_playback_terminal,
                        )
                    raise
                if sink_result.reports:
                    sink_reports_seen = True
                    (
                        sink_playback_started,
                        sink_playback_terminal,
                    ) = await self._consume_tts_audio_sink_result(
                        ctx,
                        chunk,
                        sink_result,
                        playback_started=sink_playback_started,
                        playback_terminal=sink_playback_terminal,
                    )
                elif not sink_reports_seen and not local_playback_started:
                    await self._start_local_tts_reconciliation(ctx, chunk)
                    local_playback_started = True
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            try:
                if sink_reports_seen:
                    if sink_playback_started and not sink_playback_terminal:
                        completion_reason = "desktop_audio_playback_bridge_incomplete"
                        if primary_error is not None:
                            completion_reason = "desktop_audio_playback_aborted"
                        await self._apply_desktop_audio_playback_finished(
                            ctx,
                            chunk,
                            reason=completion_reason,
                        )
                    elif (
                        not sink_playback_started
                        and not sink_playback_terminal
                    ):
                        await self._cleanup_preplayback_tts_dispatch_failure(chunk)
                        if primary_error is None:
                            raise RuntimeError(
                                "tts audio sink reported delivery without playback lifecycle truth"
                            )
                elif local_playback_started:
                    completion_reason = "local_tts_delivery_completed"
                    if primary_error is not None:
                        completion_reason = "local_tts_delivery_aborted"
                    await self._finish_local_tts_reconciliation(
                        ctx=ctx,
                        chunk=chunk,
                        reason=completion_reason,
                    )
                else:
                    await self._cleanup_preplayback_tts_dispatch_failure(chunk)
            except Exception:
                if primary_error is None:
                    raise
            finally:
                if restore_turn_context:
                    self._active_turn_context = previous_turn_context

    async def _send_protocol_event(
        self,
        event: BaseEvent,
    ) -> None:
        if self._protocol_event_sink is None:
            return
        await self._protocol_event_sink.send_protocol_event(event)
