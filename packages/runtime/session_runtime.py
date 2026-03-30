from __future__ import annotations

from collections import deque
from uuid import UUID

from packages.protocol.events import (
    ProtocolEvent,
    SessionState,
    SessionStateChangedEvent,
    SystemErrorRaisedEvent,
    SystemResetRequestedEvent,
)
from packages.runtime.recovery_snapshot import SessionRecoverySnapshot
from packages.protocol.state_machine import TransitionContext
from packages.runtime.runtime_snapshot import SessionRuntimeSnapshot
from packages.runtime.state_driver import ApplyEventResult, apply_event
from packages.runtime.transition_context_tracker import TransitionContextTracker


class SessionRuntime:
    def __init__(self, initial_state: SessionState) -> None:
        self._session_id: UUID = initial_state.session_id
        self._current_state = initial_state
        self._tracker = TransitionContextTracker(self._session_id)
        self._outbox: deque[SessionStateChangedEvent] = deque()
        self._retained_error: SystemErrorRaisedEvent | None = None

    def get_state(self) -> SessionState:
        return self._current_state

    def get_retained_error(self) -> SystemErrorRaisedEvent | None:
        return self._retained_error

    def build_context(self) -> TransitionContext:
        return self._tracker.build_context(self._current_state)

    def build_snapshot(self) -> SessionRuntimeSnapshot:
        return SessionRuntimeSnapshot(
            session_id=self._session_id,
            session_state=self._current_state,
            tracker_snapshot=self._tracker.build_snapshot(),
            retained_error=self.get_retained_error(),
            pending_outbox_effects=self.peek_outbox(),
        )

    @classmethod
    def from_snapshot(cls, snapshot: SessionRuntimeSnapshot) -> "SessionRuntime":
        runtime = cls(snapshot.session_state)
        runtime._tracker = TransitionContextTracker.from_snapshot(
            snapshot.tracker_snapshot
        )
        runtime._retained_error = snapshot.retained_error
        runtime._outbox = deque(
            runtime._validate_outbox_events(snapshot.pending_outbox_effects)
        )
        runtime._require_snapshot_session_consistency(snapshot)
        return runtime

    def build_recovery_snapshot(self) -> SessionRecoverySnapshot:
        return SessionRecoverySnapshot(
            session_id=self._session_id,
            status=self._current_state.status,
            retained_error=self.get_retained_error(),
        )

    def peek_outbox(self) -> tuple[SessionStateChangedEvent, ...]:
        return tuple(self._outbox)

    def drain_outbox(self) -> list[SessionStateChangedEvent]:
        drained_events = list(self._outbox)
        self._outbox.clear()
        return drained_events

    def observe_event(self, event: ProtocolEvent) -> None:
        self._require_event_session_match(event)
        self._tracker.apply_event(event)
        self._update_retained_error_context(event)

    def ingest_observed_event(self, event: ProtocolEvent) -> ApplyEventResult:
        self.observe_event(event)
        context = self.build_context()
        return self.ingest_event(event, context)

    def ingest_event(
        self,
        event: ProtocolEvent,
        context: TransitionContext,
    ) -> ApplyEventResult:
        self._require_event_session_match(event)
        self._require_context_session_match(context)

        result = apply_event(self._current_state, event, context)
        emitted_event = self._validate_outbox_event(result.emitted_event)
        self._update_retained_error_context(event)

        self._current_state = result.next_state
        if emitted_event is not None:
            self._outbox.append(emitted_event)
        return result

    def _require_event_session_match(self, event: ProtocolEvent) -> None:
        if event.session_id != self._session_id:
            raise ValueError(
                "event session_id does not match session runtime session_id"
            )

    def _require_context_session_match(self, context: TransitionContext) -> None:
        if context.session_id != self._session_id:
            raise ValueError(
                "transition context session_id does not match session runtime session_id"
            )

    @staticmethod
    def _validate_outbox_event(
        event: SessionStateChangedEvent | None,
    ) -> SessionStateChangedEvent | None:
        if event is None:
            return None
        if not isinstance(event, SessionStateChangedEvent):
            raise TypeError(
                "runtime outbox accepts only typed SessionStateChangedEvent instances"
            )
        return event

    @classmethod
    def _validate_outbox_events(
        cls,
        events: tuple[SessionStateChangedEvent, ...],
    ) -> tuple[SessionStateChangedEvent, ...]:
        return tuple(cls._validate_outbox_event(event) for event in events)

    def _require_snapshot_session_consistency(
        self,
        snapshot: SessionRuntimeSnapshot,
    ) -> None:
        if snapshot.session_id != self._session_id:
            raise ValueError(
                "session snapshot session_id does not match restored session runtime session_id"
            )

        if snapshot.session_state.session_id != self._session_id:
            raise ValueError(
                "session snapshot session_state.session_id does not match restored session runtime session_id"
            )

        if snapshot.tracker_snapshot.session_id != self._session_id:
            raise ValueError(
                "session snapshot tracker_snapshot.session_id does not match restored session runtime session_id"
            )

        retained_error = snapshot.retained_error
        if retained_error is not None and retained_error.session_id != self._session_id:
            raise ValueError(
                "session snapshot retained_error.session_id does not match restored session runtime session_id"
            )

        for effect in snapshot.pending_outbox_effects:
            if effect.session_id != self._session_id:
                raise ValueError(
                    "session snapshot pending_outbox_effects session_id does not match restored session runtime session_id"
                )

    def _update_retained_error_context(self, event: ProtocolEvent) -> None:
        if isinstance(event, SystemErrorRaisedEvent):
            if event.payload.is_session_blocking:
                self._retained_error = event
            return

        if isinstance(event, SystemResetRequestedEvent):
            self._retained_error = None
