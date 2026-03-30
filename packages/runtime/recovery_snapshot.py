from __future__ import annotations

from uuid import UUID

from packages.protocol.events import (
    EchoProtocolModel,
    SessionStatus,
    SystemErrorRaisedEvent,
)


class SessionRecoverySnapshot(EchoProtocolModel):
    session_id: UUID
    status: SessionStatus
    retained_error: SystemErrorRaisedEvent | None = None
