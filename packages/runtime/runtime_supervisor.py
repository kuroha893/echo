from __future__ import annotations

from datetime import datetime
from typing import Iterable
from uuid import UUID

from packages.protocol.events import EchoProtocolModel, ProtocolEvent, SessionState
from packages.runtime.effect_forwarder import RuntimeEffectForwarder
from packages.runtime.runtime_persistence import PersistedRuntimeSnapshotEnvelope
from packages.runtime.recovery_snapshot import SessionRecoverySnapshot
from packages.runtime.runtime_snapshot import RuntimeRegistrySnapshot
from packages.runtime.runtime_registry import RuntimeRegistry, SessionEffectBatch
from packages.runtime.session_runtime import SessionRuntime
from packages.runtime.state_driver import ApplyEventResult


class RuntimeProcessResult(EchoProtocolModel):
    """Typed post-processing view for one supervisor-owned event application."""

    apply_result: ApplyEventResult
    forwarded_batches: tuple[SessionEffectBatch, ...] = ()
    recovery_snapshot: SessionRecoverySnapshot


class RuntimeSupervisor:
    """Bounded in-process runtime outer shell.

    The supervisor composes existing runtime primitives without absorbing their
    responsibilities:

    - `RuntimeRegistry` keeps session registration and event routing ownership
    - `RuntimeEffectForwarder` keeps batch forwarding ownership
    - `SessionRuntime` keeps session-local state, tracker, and retained-error ownership

    This shell only provides one explicit runtime-facing entrypoint on top of those
    already-implemented pieces.
    """

    def __init__(
        self,
        *,
        registry: RuntimeRegistry | None = None,
        effect_forwarder: RuntimeEffectForwarder | None = None,
    ) -> None:
        self._registry = registry if registry is not None else RuntimeRegistry()
        self._effect_forwarder = (
            effect_forwarder
            if effect_forwarder is not None
            else RuntimeEffectForwarder()
        )

    def register_session(self, initial_state: SessionState) -> SessionRuntime:
        """Explicitly register one session runtime.

        Session creation remains explicit at the supervisor boundary. This method
        intentionally delegates duplicate-registration behavior to the registry.
        """

        return self._registry.register_session(initial_state)

    def get_session(self, session_id: UUID) -> SessionRuntime | None:
        """Return the session-owned runtime shell if it has been registered."""

        return self._registry.get_session(session_id)

    def get_effect_forwarder(self) -> RuntimeEffectForwarder:
        """Expose the owned effect forwarder without transferring ownership."""

        return self._effect_forwarder

    def build_snapshot(self) -> RuntimeRegistrySnapshot:
        """Delegate runtime snapshot export to the owned registry."""

        return self._registry.build_snapshot()

    def build_persisted_snapshot(
        self,
        *,
        saved_at: datetime | None = None,
    ) -> PersistedRuntimeSnapshotEnvelope:
        """Wrap the current runtime snapshot in a typed persisted envelope."""

        if saved_at is None:
            return PersistedRuntimeSnapshotEnvelope(
                runtime_snapshot=self.build_snapshot()
            )

        return PersistedRuntimeSnapshotEnvelope(
            saved_at=saved_at,
            runtime_snapshot=self.build_snapshot(),
        )

    @classmethod
    def from_snapshot(
        cls,
        snapshot: RuntimeRegistrySnapshot,
        *,
        effect_forwarder: RuntimeEffectForwarder | None = None,
    ) -> "RuntimeSupervisor":
        """Restore a supervisor around a registry snapshot foundation."""

        return cls(
            registry=RuntimeRegistry.from_snapshot(snapshot),
            effect_forwarder=effect_forwarder,
        )

    @classmethod
    def from_persisted_snapshot(
        cls,
        envelope: PersistedRuntimeSnapshotEnvelope,
        *,
        effect_forwarder: RuntimeEffectForwarder | None = None,
    ) -> "RuntimeSupervisor":
        """Restore the supervisor through the existing snapshot entrypoint."""

        return cls.from_snapshot(
            envelope.runtime_snapshot,
            effect_forwarder=effect_forwarder,
        )

    def get_recovery_snapshot(self, session_id: UUID) -> SessionRecoverySnapshot:
        """Delegate single-session recovery inspection to the registry."""

        return self._registry.get_recovery_snapshot(session_id)

    def peek_recovery_snapshots(self) -> tuple[SessionRecoverySnapshot, ...]:
        """Delegate stable multi-session recovery inspection to the registry."""

        return self._registry.peek_recovery_snapshots()

    def process_event(self, event: ProtocolEvent) -> RuntimeProcessResult:
        """Process one typed protocol event through the runtime shell.

        The ordering is intentionally fixed and conservative:

        1. route and apply the event through the registry
        2. forward pending runtime effect batches through the forwarder
        3. inspect the touched session's recovery snapshot
        4. return one typed local result object

        Failure behavior remains explicit and non-transactional:

        - registry/application errors surface directly
        - forwarding errors surface directly
        - state is not rolled back if forwarding later fails
        """

        touched_session_id = self._get_touched_session_id(event)
        apply_result = self._route_and_apply_event(event)
        forwarded_batches = self._forward_pending_effect_batches()
        recovery_snapshot = self._inspect_touched_session_recovery(touched_session_id)
        return self._build_process_result(
            apply_result=apply_result,
            forwarded_batches=forwarded_batches,
            recovery_snapshot=recovery_snapshot,
        )

    def process_events(
        self,
        events: Iterable[ProtocolEvent],
    ) -> tuple[RuntimeProcessResult, ...]:
        """Process a caller-ordered batch sequentially through `process_event()`.

        This helper intentionally keeps the same conservative semantics as the
        single-event entrypoint:

        - input order is preserved exactly as provided by the caller
        - each event is processed through `process_event()`
        - the first exception stops the batch immediately
        - no rollback or retry behavior is invented here
        """

        results: list[RuntimeProcessResult] = []

        for event in events:
            results.append(self.process_event(event))

        return tuple(results)

    @staticmethod
    def _get_touched_session_id(event: ProtocolEvent) -> UUID:
        return event.session_id

    def _route_and_apply_event(self, event: ProtocolEvent) -> ApplyEventResult:
        """Route the event through the existing runtime registry.

        This method intentionally does not catch or wrap routing/application errors.
        """

        return self._registry.ingest_event(event)

    def _forward_pending_effect_batches(
        self,
    ) -> tuple[SessionEffectBatch, ...]:
        """Forward pending runtime effect batches through the owned forwarder.

        The supervisor does not flatten, pre-drain, or retry batches on its own.
        Those semantics remain owned by the forwarder and registry layers.
        """

        return self._effect_forwarder.forward_pending_batches(self._registry)

    def _inspect_touched_session_recovery(
        self,
        touched_session_id: UUID,
    ) -> SessionRecoverySnapshot:
        """Inspect post-processing recovery state for the touched session only."""

        return self._registry.get_recovery_snapshot(touched_session_id)

    @staticmethod
    def _build_process_result(
        *,
        apply_result: ApplyEventResult,
        forwarded_batches: tuple[SessionEffectBatch, ...],
        recovery_snapshot: SessionRecoverySnapshot,
    ) -> RuntimeProcessResult:
        return RuntimeProcessResult(
            apply_result=apply_result,
            forwarded_batches=forwarded_batches,
            recovery_snapshot=recovery_snapshot,
        )
