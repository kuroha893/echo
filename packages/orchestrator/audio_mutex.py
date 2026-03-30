from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from packages.protocol.events import InterruptSignal, InterruptionPolicy, TTSChunk


class OrchestratorModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class AudioOwner(str, Enum):
    NONE = "none"
    QUICK_REACTION = "quick_reaction"
    PRIMARY_RESPONSE = "primary_response"


class OrchestratorConfig(OrchestratorModel):
    quick_reaction_max_wait_ms: int = Field(default=220, ge=0, le=5000)
    interrupt_replace_timeout_ms: int = Field(default=120, ge=0, le=5000)
    turn_resolution_timeout_ms: int = Field(default=60_000, ge=10, le=120_000)
    recent_context_max_messages: int = Field(default=128, ge=0, le=1024)
    recent_context_max_chars: int = Field(default=128_000, ge=0, le=1_000_000)
    allow_crossfade: bool = False
    parser_max_tag_buffer_chars: int = Field(default=128, ge=8, le=4096)
    max_pending_primary_chunks: int = Field(default=64, ge=1, le=4096)
    tts_quick_reaction_voice_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    tts_quick_reaction_provider_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    tts_primary_response_voice_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    tts_primary_response_provider_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    renderer_quick_reaction_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    renderer_primary_response_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    llm_intent_routing_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    llm_quick_reaction_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    llm_local_primary_response_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    llm_cloud_primary_response_profile_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
    )
    llm_intent_routing_timeout_ms: int = Field(default=180, ge=1, le=5000)
    avatar_supported_expressions: tuple[str, ...] = ()
    avatar_supported_motions: tuple[str, ...] = ()
    avatar_persona_prompt: str = ""
    voice_language: str = ""
    subtitle_language: str = ""


@dataclass
class PlaybackSnapshot:
    owner: AudioOwner = AudioOwner.NONE
    stream_id: UUID | None = None
    chunk_index: int | None = None
    playback_active: bool = False
    current_chunk_interruptible: bool = True
    pending_chunks: int = 0


class AudioMutex:
    """
    Single authority for audible playback ownership.
    """

    def __init__(self, config: OrchestratorConfig) -> None:
        self.config = config
        self._lock = asyncio.Lock()
        self._playback_changed = asyncio.Condition()
        self._snapshot = PlaybackSnapshot()

    def get_snapshot(self) -> PlaybackSnapshot:
        return replace(self._snapshot)

    async def claim_for_quick_reaction(
        self,
        stream_id: UUID,
        chunks: list[TTSChunk],
    ) -> bool:
        async with self._lock:
            if self._snapshot.owner == AudioOwner.NONE:
                self._snapshot.owner = AudioOwner.QUICK_REACTION
                self._snapshot.stream_id = stream_id
                self._snapshot.pending_chunks = len(chunks)
                return True
            return False

    async def submit_primary_chunk(
        self,
        stream_id: UUID,
        chunk: TTSChunk,
    ) -> Literal["play_now", "buffer", "replace_after_chunk"]:
        del chunk
        async with self._lock:
            if self._snapshot.owner == AudioOwner.NONE:
                self._snapshot.owner = AudioOwner.PRIMARY_RESPONSE
                self._snapshot.stream_id = stream_id
                self._snapshot.pending_chunks += 1
                return "play_now"

            if self._snapshot.owner == AudioOwner.PRIMARY_RESPONSE:
                self._snapshot.pending_chunks += 1
                return "play_now"

            if not self._snapshot.playback_active:
                self._snapshot.owner = AudioOwner.PRIMARY_RESPONSE
                self._snapshot.stream_id = stream_id
                self._snapshot.pending_chunks += 1
                return "play_now"

            if self._snapshot.current_chunk_interruptible:
                return "replace_after_chunk"

            return "buffer"

    async def notify_chunk_started(
        self,
        owner: AudioOwner,
        stream_id: UUID,
        chunk_index: int,
        is_interruptible: bool,
    ) -> None:
        async with self._playback_changed:
            self._snapshot.owner = owner
            self._snapshot.stream_id = stream_id
            self._snapshot.chunk_index = chunk_index
            self._snapshot.playback_active = True
            self._snapshot.current_chunk_interruptible = is_interruptible
            self._playback_changed.notify_all()

    async def notify_chunk_finished(
        self,
        stream_id: UUID,
    ) -> None:
        async with self._playback_changed:
            if (
                self._snapshot.stream_id == stream_id
                and self._snapshot.pending_chunks > 0
            ):
                self._snapshot.pending_chunks -= 1
            self._snapshot.current_chunk_interruptible = True
            self._playback_changed.notify_all()

    async def notify_playback_finished(
        self,
        stream_id: UUID,
    ) -> None:
        async with self._playback_changed:
            if self._snapshot.stream_id == stream_id:
                self._snapshot.owner = AudioOwner.NONE
                if self._snapshot.pending_chunks == 0:
                    self._snapshot.stream_id = None
                self._snapshot.chunk_index = None
                self._snapshot.playback_active = False
                self._snapshot.current_chunk_interruptible = True
            self._playback_changed.notify_all()

    async def wait_for_safe_handoff(self, timeout_ms: int) -> bool:
        """
        Wait for a safe chunk boundary / playback release.
        Returns True if it is safe to hand off.
        """

        timeout_sec = timeout_ms / 1000.0
        try:
            async with self._playback_changed:
                await asyncio.wait_for(
                    self._playback_changed.wait_for(
                        lambda: (
                            not self._snapshot.playback_active
                            or self._snapshot.current_chunk_interruptible
                        )
                    ),
                    timeout=timeout_sec,
                )
            return True
        except asyncio.TimeoutError:
            return False

    async def force_replace(self) -> InterruptSignal:
        """
        The orchestrator will route this to downstream playback control.
        """

        async with self._lock:
            return InterruptSignal(
                reason="audio mutex forced owner replacement",
                policy=InterruptionPolicy.REPLACE,
                target_tts_stream_id=self._snapshot.stream_id,
                clear_pending_tts=True,
                clear_pending_renderer=False,
            )
