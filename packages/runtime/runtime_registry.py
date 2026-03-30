from __future__ import annotations

from uuid import UUID

from pydantic import Field

from packages.protocol.events import (
    EchoProtocolModel,
    ProtocolEvent,
    SessionState,
    SessionStateChangedEvent,
)
from packages.runtime.recovery_snapshot import SessionRecoverySnapshot
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot
from packages.runtime.session_runtime import SessionRuntime
from packages.runtime.state_driver import ApplyEventResult


class SessionEffectBatch(EchoProtocolModel):
    session_id: UUID
    effects: tuple[SessionStateChangedEvent, ...] = Field(min_length=1)


class RuntimeRegistry:
    def __init__(self) -> None:
        self._sessions: dict[UUID, SessionRuntime] = {}

    def register_session(self, initial_state: SessionState) -> SessionRuntime:
        session_id = initial_state.session_id
        if session_id in self._sessions:
            raise ValueError("session runtime already registered for session_id")

        session_runtime = SessionRuntime(initial_state)
        self._sessions[session_id] = session_runtime
        return session_runtime

    def get_session(self, session_id: UUID) -> SessionRuntime | None:
        return self._sessions.get(session_id)

    def build_snapshot(self) -> RuntimeRegistrySnapshot:
        return RuntimeRegistrySnapshot(
            session_snapshots=tuple(
                self._sessions[session_id].build_snapshot()
                for session_id in sorted(
                    self._sessions,
                    key=lambda candidate: candidate.hex,
                )
            )
        )

    @classmethod
    def from_snapshot(cls, snapshot: RuntimeRegistrySnapshot) -> "RuntimeRegistry":
        registry = cls()
        seen_session_ids: set[UUID] = set()

        for session_snapshot in snapshot.session_snapshots:
            session_id = session_snapshot.session_id
            if session_id in seen_session_ids:
                raise ValueError(
                    "runtime registry snapshot contains duplicate session_id"
                )

            registry._sessions[session_id] = SessionRuntime.from_snapshot(
                session_snapshot
            )
            seen_session_ids.add(session_id)

        return registry

    def peek_session_outbox(
        self,
        session_id: UUID,
    ) -> tuple[SessionStateChangedEvent, ...]:
        return self._require_registered_session(
            session_id,
            error_message="no registered session runtime for session_id",
        ).peek_outbox()

    def drain_session_outbox(self, session_id: UUID) -> list[SessionStateChangedEvent]:
        return self._require_registered_session(
            session_id,
            error_message="no registered session runtime for session_id",
        ).drain_outbox()

    def get_recovery_snapshot(self, session_id: UUID) -> SessionRecoverySnapshot:
        return self._require_registered_session(
            session_id,
            error_message="no registered session runtime for session_id",
        ).build_recovery_snapshot()

    def peek_recovery_snapshots(self) -> tuple[SessionRecoverySnapshot, ...]:
        return tuple(
            self._sessions[session_id].build_recovery_snapshot()
            for session_id in sorted(self._sessions, key=lambda candidate: candidate.hex)
        )

    def peek_effect_batches(self) -> tuple[SessionEffectBatch, ...]:
        return self._collect_effect_batches(drain=False)

    def drain_effect_batches(self) -> tuple[SessionEffectBatch, ...]:
        return self._collect_effect_batches(drain=True)

    def ingest_event(self, event: ProtocolEvent) -> ApplyEventResult:
        return self._require_registered_session(
            event.session_id,
            error_message="no registered session runtime for event session_id",
        ).ingest_observed_event(event)

    def _require_registered_session(
        self,
        session_id: UUID,
        *,
        error_message: str,
    ) -> SessionRuntime:
        session_runtime = self.get_session(session_id)
        if session_runtime is None:
            raise ValueError(error_message)
        return session_runtime

    def _collect_effect_batches(
        self,
        *,
        drain: bool,
    ) -> tuple[SessionEffectBatch, ...]:
        effect_batches: list[SessionEffectBatch] = []

        for session_id in sorted(self._sessions, key=lambda candidate: candidate.hex):
            session_runtime = self._sessions[session_id]
            peeked_effects = session_runtime.peek_outbox()
            if not peeked_effects:
                continue

            effects = (
                tuple(session_runtime.drain_outbox()) if drain else peeked_effects
            )
            effect_batches.append(
                SessionEffectBatch(session_id=session_id, effects=effects)
            )

        return tuple(effect_batches)
