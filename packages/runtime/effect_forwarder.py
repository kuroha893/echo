from __future__ import annotations

from packages.runtime.runtime_registry import RuntimeRegistry, SessionEffectBatch


class RuntimeEffectForwarder:
    def forward_pending_batches(
        self,
        registry: RuntimeRegistry,
    ) -> tuple[SessionEffectBatch, ...]:
        successful_batches: list[SessionEffectBatch] = []

        for batch in registry.peek_effect_batches():
            self._forward_batch(batch)
            registry.drain_session_outbox(batch.session_id)
            successful_batches.append(batch)

        return tuple(successful_batches)

    def _forward_batch(self, batch: SessionEffectBatch) -> None:
        return None
