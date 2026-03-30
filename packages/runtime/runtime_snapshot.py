from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from packages.protocol.events import (
    SessionState,
    SessionStateChangedEvent,
    SystemErrorRaisedEvent,
)


class RuntimeSnapshotModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


NonNegativeInt = Annotated[int, Field(ge=0)]


class TransitionContextTrackerSnapshot(RuntimeSnapshotModel):
    session_id: UUID

    has_active_user_input: bool = False
    has_finalized_user_utterance: bool = False
    has_active_tts_playback: bool = False
    has_active_reasoning_task: bool = False
    has_pending_interrupt: bool = False

    current_tts_stream_id: UUID | None = None
    current_response_stream_id: UUID | None = None
    pending_tts_counts_by_stream: dict[UUID, NonNegativeInt] = Field(
        default_factory=dict
    )

    @field_validator("pending_tts_counts_by_stream")
    @classmethod
    def normalize_pending_tts_counts(
        cls,
        value: dict[UUID, int],
    ) -> dict[UUID, int]:
        return {
            stream_id: count
            for stream_id, count in sorted(
                value.items(),
                key=lambda item: item[0].hex,
            )
            if count >= 0
        }


class SessionRuntimeSnapshot(RuntimeSnapshotModel):
    session_id: UUID
    session_state: SessionState
    tracker_snapshot: TransitionContextTrackerSnapshot
    retained_error: SystemErrorRaisedEvent | None = None
    pending_outbox_effects: tuple[SessionStateChangedEvent, ...] = ()

    @model_validator(mode="after")
    def validate_nested_session_ids(self) -> "SessionRuntimeSnapshot":
        if self.session_state.session_id != self.session_id:
            raise ValueError(
                "session snapshot session_id must match nested session_state.session_id"
            )

        if self.tracker_snapshot.session_id != self.session_id:
            raise ValueError(
                "session snapshot session_id must match nested tracker_snapshot.session_id"
            )

        if self.retained_error is not None and self.retained_error.session_id != self.session_id:
            raise ValueError(
                "session snapshot session_id must match nested retained_error.session_id"
            )

        for effect in self.pending_outbox_effects:
            if effect.session_id != self.session_id:
                raise ValueError(
                    "session snapshot session_id must match nested pending_outbox_effects session_id"
                )

        return self


class RuntimeRegistrySnapshot(RuntimeSnapshotModel):
    session_snapshots: tuple[SessionRuntimeSnapshot, ...] = ()
