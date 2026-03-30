from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict

from packages.protocol.events import (
    ProtocolEvent,
    SessionState,
    SessionStateChangedEvent,
    SourceType,
    StateTransition,
)
from packages.protocol.state_machine import EventType, TransitionContext, resolve_transition


STATE_DRIVER_SOURCE = "system.state_driver"


class RuntimeModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class ApplyEventResult(RuntimeModel):
    next_state: SessionState
    emitted_event: SessionStateChangedEvent | None = None


def apply_event(
    current_state: SessionState,
    event: ProtocolEvent,
    context: TransitionContext,
) -> ApplyEventResult:
    if event.event_type == EventType.SESSION_STATE_CHANGED:
        return ApplyEventResult(next_state=current_state, emitted_event=None)

    transition = resolve_transition(current_state.status, event.event_type, context)
    if transition is None:
        return ApplyEventResult(next_state=current_state, emitted_event=None)

    transition_time = datetime.now(timezone.utc)
    next_state_data = current_state.model_dump()
    next_state_data.update(
        status=transition.to_status,
        last_event_id=event.event_id,
        updated_at=transition_time,
    )
    next_state = SessionState(**next_state_data)
    state_transition = StateTransition(
        from_status=current_state.status,
        to_status=transition.to_status,
        reason=transition.reason_template,
        trigger_event_id=event.event_id,
    )
    emitted_event = SessionStateChangedEvent(
        timestamp=transition_time,
        trace_id=event.trace_id,
        session_id=event.session_id,
        source_type=SourceType.SYSTEM,
        source=STATE_DRIVER_SOURCE,
        causation_event_id=event.event_id,
        payload=state_transition,
        metadata=event.metadata.copy(),
    )
    return ApplyEventResult(next_state=next_state, emitted_event=emitted_event)
