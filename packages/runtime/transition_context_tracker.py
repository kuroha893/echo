from __future__ import annotations

from uuid import UUID

from packages.protocol.events import (
    AssistantResponseChunkEvent,
    AssistantResponseCompletedEvent,
    InterruptAppliedEvent,
    InterruptSignalEvent,
    ProtocolEvent,
    SessionState,
    SessionStateChangedEvent,
    SystemResetRequestedEvent,
    TTSChunkFinishedEvent,
    TTSChunkQueuedEvent,
    TTSPlaybackFinishedEvent,
    TTSPlaybackStartedEvent,
    UserSpeechEndEvent,
    UserSpeechPartialEvent,
    UserSpeechStartEvent,
)
from packages.protocol.state_machine import TransitionContext
from packages.runtime.runtime_snapshot import TransitionContextTrackerSnapshot


class TransitionContextTracker:
    def __init__(self, session_id: UUID) -> None:
        self._session_id = session_id
        self._has_active_user_input = False
        self._has_finalized_user_utterance = False
        self._has_active_tts_playback = False
        self._has_active_reasoning_task = False
        self._has_pending_interrupt = False
        self._current_tts_stream_id: UUID | None = None
        self._current_response_stream_id: UUID | None = None
        self._pending_tts_counts_by_stream: dict[UUID, int] = {}

    def apply_event(self, event: ProtocolEvent) -> None:
        self._require_event_session_match(event)

        if isinstance(event, (UserSpeechStartEvent, UserSpeechPartialEvent)):
            self._has_active_user_input = True
            self._has_finalized_user_utterance = False
            return

        if isinstance(event, UserSpeechEndEvent):
            self._has_active_user_input = False
            self._has_finalized_user_utterance = True
            self._has_active_reasoning_task = True
            return

        if isinstance(event, AssistantResponseChunkEvent):
            self._has_active_reasoning_task = True
            self._current_response_stream_id = event.payload.response_stream_id
            return

        if isinstance(event, AssistantResponseCompletedEvent):
            self._has_active_reasoning_task = False
            self._current_response_stream_id = event.payload.response_stream_id
            self._has_finalized_user_utterance = False
            return

        if isinstance(event, TTSChunkQueuedEvent):
            stream_id = event.payload.tts_stream_id
            self._pending_tts_counts_by_stream[stream_id] = (
                self._pending_tts_counts_by_stream.get(stream_id, 0) + 1
            )
            self._current_tts_stream_id = stream_id
            return

        if isinstance(event, TTSPlaybackStartedEvent):
            self._has_active_tts_playback = True
            self._current_tts_stream_id = event.payload.tts_stream_id
            return

        if isinstance(event, TTSChunkFinishedEvent):
            self._decrement_pending_tts_count(event.payload.tts_stream_id)
            return

        if isinstance(event, TTSPlaybackFinishedEvent):
            self._has_active_tts_playback = False
            self._pending_tts_counts_by_stream.pop(event.payload.tts_stream_id, None)
            self._current_tts_stream_id = None
            return

        if isinstance(event, InterruptSignalEvent):
            self._has_pending_interrupt = True
            return

        if isinstance(event, InterruptAppliedEvent):
            self._has_pending_interrupt = False
            if event.payload.playback_stopped:
                self._has_active_tts_playback = False
                self._current_tts_stream_id = None
            if event.payload.pending_tts_cleared:
                self._pending_tts_counts_by_stream.clear()
            if event.payload.reasoning_cancelled:
                self._has_active_reasoning_task = False
            if event.payload.new_user_input_active:
                self._has_active_user_input = True
                self._has_finalized_user_utterance = False
            return

        if isinstance(event, SystemResetRequestedEvent):
            self._has_pending_interrupt = False
            if event.payload.drop_pending_output:
                self._has_active_tts_playback = False
                self._pending_tts_counts_by_stream.clear()
                self._current_tts_stream_id = None
                self._has_active_reasoning_task = False
                self._current_response_stream_id = None
            if event.payload.drop_pending_input:
                self._has_active_user_input = False
                self._has_finalized_user_utterance = False
            return

        if isinstance(event, SessionStateChangedEvent):
            return

    def build_snapshot(self) -> TransitionContextTrackerSnapshot:
        return TransitionContextTrackerSnapshot(
            session_id=self._session_id,
            has_active_user_input=self._has_active_user_input,
            has_finalized_user_utterance=self._has_finalized_user_utterance,
            has_active_tts_playback=self._has_active_tts_playback,
            has_active_reasoning_task=self._has_active_reasoning_task,
            has_pending_interrupt=self._has_pending_interrupt,
            current_tts_stream_id=self._current_tts_stream_id,
            current_response_stream_id=self._current_response_stream_id,
            pending_tts_counts_by_stream=self._build_pending_tts_counts_snapshot(),
        )

    @classmethod
    def from_snapshot(
        cls,
        snapshot: TransitionContextTrackerSnapshot,
    ) -> "TransitionContextTracker":
        tracker = cls(snapshot.session_id)
        tracker._has_active_user_input = snapshot.has_active_user_input
        tracker._has_finalized_user_utterance = snapshot.has_finalized_user_utterance
        tracker._has_active_tts_playback = snapshot.has_active_tts_playback
        tracker._has_active_reasoning_task = snapshot.has_active_reasoning_task
        tracker._has_pending_interrupt = snapshot.has_pending_interrupt
        tracker._current_tts_stream_id = snapshot.current_tts_stream_id
        tracker._current_response_stream_id = snapshot.current_response_stream_id
        tracker._pending_tts_counts_by_stream = {
            stream_id: count
            for stream_id, count in snapshot.pending_tts_counts_by_stream.items()
            if count > 0
        }
        return tracker

    def build_context(self, session_state: SessionState) -> TransitionContext:
        self._require_state_session_match(session_state)
        return TransitionContext(
            session_id=self._session_id,
            current_status=session_state.status,
            active_trace_id=session_state.current_trace_id,
            has_active_user_input=self._has_active_user_input,
            has_finalized_user_utterance=self._has_finalized_user_utterance,
            has_active_tts_playback=self._has_active_tts_playback,
            has_pending_tts_chunks=any(
                count > 0 for count in self._pending_tts_counts_by_stream.values()
            ),
            has_active_reasoning_task=self._has_active_reasoning_task,
            has_pending_interrupt=self._has_pending_interrupt,
            current_tts_stream_id=self._current_tts_stream_id,
            current_response_stream_id=self._current_response_stream_id,
        )

    def _build_pending_tts_counts_snapshot(self) -> dict[UUID, int]:
        return {
            stream_id: count
            for stream_id, count in sorted(
                self._pending_tts_counts_by_stream.items(),
                key=lambda item: item[0].hex,
            )
            if count >= 0
        }

    def _decrement_pending_tts_count(self, stream_id: UUID) -> None:
        current_count = self._pending_tts_counts_by_stream.get(stream_id, 0)
        if current_count <= 1:
            self._pending_tts_counts_by_stream.pop(stream_id, None)
            return
        self._pending_tts_counts_by_stream[stream_id] = current_count - 1

    def _require_event_session_match(self, event: ProtocolEvent) -> None:
        if event.session_id != self._session_id:
            raise ValueError(
                "event session_id does not match transition context tracker session_id"
            )

    def _require_state_session_match(self, session_state: SessionState) -> None:
        if session_state.session_id != self._session_id:
            raise ValueError(
                "session state session_id does not match transition context tracker session_id"
            )
