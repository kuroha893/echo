from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Final, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SESSION_CATALOG_FORMAT_VERSION: Final[str] = "echo.session_catalog.v1"
SESSION_TRANSCRIPT_FORMAT_VERSION: Final[str] = "echo.session_transcript.v1"

DEFAULT_CATALOG_FILENAME: Final[str] = "session-catalog.json"
DEFAULT_SESSIONS_DIRNAME: Final[str] = "sessions"
DIRECT_SESSION_KIND: Final[str] = "direct"
STORY_CAST_SESSION_KIND: Final[str] = "story_cast"
STORY_NARRATOR_SESSION_KIND: Final[str] = "story_narrator"
STORY_PLANNER_SESSION_KIND: Final[str] = "story_planner"


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


class SessionCatalogModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


SessionKind = Literal["direct", "story_cast", "story_narrator", "story_planner"]


def _infer_session_kind_from_title(title: str) -> SessionKind:
    if title == "story-planner":
        return STORY_PLANNER_SESSION_KIND
    if title == "story-narrator":
        return STORY_NARRATOR_SESSION_KIND
    if title.startswith("story-cast:"):
        return STORY_CAST_SESSION_KIND
    return DIRECT_SESSION_KIND


class TranscriptEntry(SessionCatalogModel):
    entry_id: UUID = Field(default_factory=uuid4)
    turn_id: UUID
    role: str = Field(min_length=1, max_length=32)
    text: str
    raw_text: str = ""
    is_streaming: bool = False
    sequence_index: int = Field(ge=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("created_at")
    @classmethod
    def ensure_created_at_utc(cls, value: datetime) -> datetime:
        return _normalize_utc_datetime(value, "created_at")


class SessionRecord(SessionCatalogModel):
    session_id: UUID = Field(default_factory=uuid4)
    title: str = ""
    model_key: str | None = None
    session_kind: SessionKind = DIRECT_SESSION_KIND
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    latest_turn_id: UUID | None = None
    generation: int = Field(default=0, ge=0)

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_utc(cls, value: datetime, info) -> datetime:
        return _normalize_utc_datetime(value, info.field_name)


class SessionTranscriptEnvelope(SessionCatalogModel):
    format_version: str = SESSION_TRANSCRIPT_FORMAT_VERSION
    session_id: UUID
    entries: tuple[TranscriptEntry, ...] = ()

    @field_validator("format_version")
    @classmethod
    def validate_format_version(cls, value: str) -> str:
        if value != SESSION_TRANSCRIPT_FORMAT_VERSION:
            raise ValueError(
                f"unsupported session transcript format_version: "
                f"expected '{SESSION_TRANSCRIPT_FORMAT_VERSION}', got '{value}'"
            )
        return value

    @model_validator(mode="after")
    def validate_entry_order(self) -> SessionTranscriptEnvelope:
        for idx, entry in enumerate(self.entries):
            if entry.sequence_index != idx:
                raise ValueError(
                    "transcript entries must have contiguous zero-based sequence_index"
                )
        return self


class SessionCatalogEntry(SessionCatalogModel):
    session_id: UUID
    title: str = ""
    model_key: str | None = None
    session_kind: SessionKind = DIRECT_SESSION_KIND
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_utc(cls, value: datetime, info) -> datetime:
        return _normalize_utc_datetime(value, info.field_name)


class SessionCatalogEnvelope(SessionCatalogModel):
    format_version: str = SESSION_CATALOG_FORMAT_VERSION
    active_session_id: UUID | None = None
    sessions: tuple[SessionCatalogEntry, ...] = ()

    @field_validator("format_version")
    @classmethod
    def validate_format_version(cls, value: str) -> str:
        if value != SESSION_CATALOG_FORMAT_VERSION:
            raise ValueError(
                f"unsupported session catalog format_version: "
                f"expected '{SESSION_CATALOG_FORMAT_VERSION}', got '{value}'"
            )
        return value


class SessionCatalogStore:
    def __init__(
        self,
        *,
        base_dir: Path,
        catalog_filename: str = DEFAULT_CATALOG_FILENAME,
        sessions_dirname: str = DEFAULT_SESSIONS_DIRNAME,
    ) -> None:
        self._base_dir = base_dir
        self._catalog_path = base_dir / catalog_filename
        self._sessions_dir = base_dir / sessions_dirname
        self._records: dict[UUID, SessionRecord] = {}
        self._transcripts: dict[UUID, list[TranscriptEntry]] = {}
        self._active_session_id: UUID | None = None
        self._loaded = False

    def get_base_dir(self) -> Path:
        return self._base_dir

    def get_active_session_id(self) -> UUID | None:
        self._ensure_loaded()
        return self._active_session_id

    def set_active_session_id(self, session_id: UUID | None) -> None:
        self._ensure_loaded()
        if session_id is not None and session_id not in self._records:
            raise ValueError(f"session '{session_id}' does not exist in catalog")
        self._active_session_id = session_id
        self._persist_catalog()

    def list_sessions(
        self,
        *,
        session_kind: SessionKind | None = None,
    ) -> list[SessionCatalogEntry]:
        self._ensure_loaded()
        entries = [
            SessionCatalogEntry(
                session_id=record.session_id,
                title=record.title,
                model_key=record.model_key,
                session_kind=record.session_kind,
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
            for record in self._records.values()
            if session_kind is None or record.session_kind == session_kind
        ]
        entries.sort(key=lambda e: e.updated_at, reverse=True)
        return entries

    def list_sessions_for_model(
        self,
        model_key: str | None,
        *,
        session_kind: SessionKind | None = None,
    ) -> list[SessionCatalogEntry]:
        self._ensure_loaded()
        entries = [
            SessionCatalogEntry(
                session_id=record.session_id,
                title=record.title,
                model_key=record.model_key,
                session_kind=record.session_kind,
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
            for record in self._records.values()
            if record.model_key == model_key
            and (session_kind is None or record.session_kind == session_kind)
        ]
        entries.sort(key=lambda e: e.updated_at, reverse=True)
        return entries

    def get_latest_session_for_model(
        self,
        model_key: str | None,
        *,
        session_kind: SessionKind | None = None,
    ) -> SessionRecord | None:
        self._ensure_loaded()
        matches = [
            record
            for record in self._records.values()
            if record.model_key == model_key
            and (session_kind is None or record.session_kind == session_kind)
        ]
        if not matches:
            return None
        matches.sort(key=lambda record: record.updated_at, reverse=True)
        return matches[0]

    def assign_unscoped_sessions_to_model(self, model_key: str) -> int:
        self._ensure_loaded()
        updated_count = 0
        for session_id, record in tuple(self._records.items()):
            if record.model_key is not None:
                continue
            self._records[session_id] = record.model_copy(update={"model_key": model_key})
            updated_count += 1
        if updated_count > 0:
            self._persist_catalog()
        return updated_count

    def get_session(self, session_id: UUID) -> SessionRecord | None:
        self._ensure_loaded()
        return self._records.get(session_id)

    def create_session(
        self,
        *,
        title: str = "",
        model_key: str | None = None,
        session_kind: SessionKind = DIRECT_SESSION_KIND,
        session_id: UUID | None = None,
        make_active: bool = True,
    ) -> SessionRecord:
        self._ensure_loaded()
        sid = session_id or uuid4()
        if sid in self._records:
            raise ValueError(f"session '{sid}' already exists")
        now = datetime.now(timezone.utc)
        record = SessionRecord(
            session_id=sid,
            title=title,
            model_key=model_key,
            session_kind=session_kind,
            created_at=now,
            updated_at=now,
        )
        self._records[sid] = record
        self._transcripts[sid] = []
        if make_active:
            self._active_session_id = sid
        self._persist_catalog()
        self._persist_transcript(sid)
        return record

    def delete_session(self, session_id: UUID) -> None:
        self._ensure_loaded()
        if session_id not in self._records:
            raise ValueError(f"session '{session_id}' does not exist")
        del self._records[session_id]
        self._transcripts.pop(session_id, None)
        if self._active_session_id == session_id:
            self._active_session_id = None
        self._persist_catalog()
        transcript_path = self._transcript_path(session_id)
        if transcript_path.exists():
            transcript_path.unlink()

    def fork_session(
        self,
        source_session_id: UUID,
        *,
        cut_after_index: int | None = None,
        title: str = "",
        make_active: bool = True,
    ) -> SessionRecord:
        self._ensure_loaded()
        source = self._records.get(source_session_id)
        if source is None:
            raise ValueError(f"source session '{source_session_id}' does not exist")
        source_entries = self._transcripts.get(source_session_id, [])
        if cut_after_index is not None:
            forked_entries = [e for e in source_entries if e.sequence_index <= cut_after_index]
        else:
            forked_entries = list(source_entries)
        new_sid = uuid4()
        now = datetime.now(timezone.utc)
        fork_title = title or f"Fork of {source.title or str(source.session_id)[:8]}"
        record = SessionRecord(
            session_id=new_sid,
            title=fork_title,
            model_key=source.model_key,
            session_kind=source.session_kind,
            created_at=now,
            updated_at=now,
            latest_turn_id=forked_entries[-1].turn_id if forked_entries else None,
        )
        reindexed = []
        for idx, entry in enumerate(forked_entries):
            reindexed.append(entry.model_copy(update={
                "entry_id": uuid4(),
                "sequence_index": idx,
            }))
        self._records[new_sid] = record
        self._transcripts[new_sid] = reindexed
        if make_active:
            self._active_session_id = new_sid
        self._persist_catalog()
        self._persist_transcript(new_sid)
        return record

    def get_transcript(self, session_id: UUID) -> tuple[TranscriptEntry, ...]:
        self._ensure_loaded()
        entries = self._transcripts.get(session_id)
        if entries is None:
            raise ValueError(f"session '{session_id}' does not exist")
        return tuple(entries)

    def append_transcript_entry(
        self,
        session_id: UUID,
        *,
        turn_id: UUID,
        role: str,
        text: str,
        raw_text: str = "",
        is_streaming: bool = False,
    ) -> TranscriptEntry:
        self._ensure_loaded()
        if session_id not in self._records:
            raise ValueError(f"session '{session_id}' does not exist")
        entries = self._transcripts.setdefault(session_id, [])
        entry = TranscriptEntry(
            turn_id=turn_id,
            role=role,
            text=text,
            raw_text=raw_text,
            is_streaming=is_streaming,
            sequence_index=len(entries),
        )
        entries.append(entry)
        record = self._records[session_id]
        self._records[session_id] = record.model_copy(update={
            "updated_at": datetime.now(timezone.utc),
            "latest_turn_id": turn_id,
        })
        self._persist_transcript(session_id)
        self._persist_catalog()
        return entry

    def upsert_transcript_entry(
        self,
        session_id: UUID,
        *,
        turn_id: UUID,
        role: str,
        text: str,
        raw_text: str = "",
        is_streaming: bool = False,
    ) -> TranscriptEntry:
        self._ensure_loaded()
        if session_id not in self._records:
            raise ValueError(f"session '{session_id}' does not exist")
        entries = self._transcripts.setdefault(session_id, [])
        for idx, existing in enumerate(entries):
            if existing.turn_id == turn_id and existing.role == role:
                updated = existing.model_copy(update={
                    "text": text,
                    "raw_text": raw_text,
                    "is_streaming": is_streaming,
                })
                entries[idx] = updated
                record = self._records[session_id]
                self._records[session_id] = record.model_copy(update={
                    "updated_at": datetime.now(timezone.utc),
                    "latest_turn_id": turn_id,
                })
                if not is_streaming:
                    self._persist_transcript(session_id)
                    self._persist_catalog()
                return updated
        return self.append_transcript_entry(
            session_id,
            turn_id=turn_id,
            role=role,
            text=text,
            raw_text=raw_text,
            is_streaming=is_streaming,
        )

    def update_session_title(self, session_id: UUID, title: str) -> SessionRecord:
        self._ensure_loaded()
        record = self._records.get(session_id)
        if record is None:
            raise ValueError(f"session '{session_id}' does not exist")
        updated = record.model_copy(update={
            "title": title,
            "updated_at": datetime.now(timezone.utc),
        })
        self._records[session_id] = updated
        self._persist_catalog()
        return updated

    def bump_generation(self, session_id: UUID) -> int:
        self._ensure_loaded()
        record = self._records.get(session_id)
        if record is None:
            raise ValueError(f"session '{session_id}' does not exist")
        new_gen = record.generation + 1
        updated = record.model_copy(update={"generation": new_gen})
        self._records[session_id] = updated
        return new_gen

    def get_generation(self, session_id: UUID) -> int:
        self._ensure_loaded()
        record = self._records.get(session_id)
        if record is None:
            raise ValueError(f"session '{session_id}' does not exist")
        return record.generation

    def load(self) -> None:
        self._records.clear()
        self._transcripts.clear()
        self._active_session_id = None
        if self._catalog_path.is_file():
            raw = json.loads(self._catalog_path.read_text("utf-8"))
            envelope = SessionCatalogEnvelope.model_validate(raw)
            self._active_session_id = envelope.active_session_id
            for catalog_entry in envelope.sessions:
                record = SessionRecord(
                    session_id=catalog_entry.session_id,
                    title=catalog_entry.title,
                    model_key=catalog_entry.model_key,
                    session_kind=_infer_session_kind_from_title(catalog_entry.title)
                    if catalog_entry.session_kind == DIRECT_SESSION_KIND
                    else catalog_entry.session_kind,
                    created_at=catalog_entry.created_at,
                    updated_at=catalog_entry.updated_at,
                )
                self._records[catalog_entry.session_id] = record
                transcript_path = self._transcript_path(catalog_entry.session_id)
                if transcript_path.is_file():
                    raw_t = json.loads(transcript_path.read_text("utf-8"))
                    t_envelope = SessionTranscriptEnvelope.model_validate(raw_t)
                    entries = list(t_envelope.entries)
                    if entries:
                        latest_turn = entries[-1].turn_id
                        self._records[catalog_entry.session_id] = record.model_copy(
                            update={"latest_turn_id": latest_turn}
                        )
                    self._transcripts[catalog_entry.session_id] = entries
                else:
                    self._transcripts[catalog_entry.session_id] = []
        self._loaded = True

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def _transcript_path(self, session_id: UUID) -> Path:
        return self._sessions_dir / f"{session_id}.json"

    def _persist_catalog(self) -> None:
        self._base_dir.mkdir(parents=True, exist_ok=True)
        entries = []
        for record in self._records.values():
            entries.append(SessionCatalogEntry(
                session_id=record.session_id,
                title=record.title,
                model_key=record.model_key,
                session_kind=record.session_kind,
                created_at=record.created_at,
                updated_at=record.updated_at,
            ))
        entries.sort(key=lambda e: e.updated_at, reverse=True)
        envelope = SessionCatalogEnvelope(
            active_session_id=self._active_session_id,
            sessions=tuple(entries),
        )
        tmp_path = self._catalog_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(envelope.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        shutil.move(str(tmp_path), str(self._catalog_path))

    def _persist_transcript(self, session_id: UUID) -> None:
        self._sessions_dir.mkdir(parents=True, exist_ok=True)
        entries = self._transcripts.get(session_id, [])
        non_streaming = [e for e in entries if not e.is_streaming]
        envelope = SessionTranscriptEnvelope(
            session_id=session_id,
            entries=tuple(
                entry.model_copy(update={"sequence_index": idx})
                for idx, entry in enumerate(non_streaming)
            ),
        )
        path = self._transcript_path(session_id)
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(envelope.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        shutil.move(str(tmp_path), str(path))


__all__ = [
    "DEFAULT_CATALOG_FILENAME",
    "DEFAULT_SESSIONS_DIRNAME",
    "DIRECT_SESSION_KIND",
    "SESSION_CATALOG_FORMAT_VERSION",
    "SESSION_TRANSCRIPT_FORMAT_VERSION",
    "SessionCatalogEntry",
    "SessionCatalogEnvelope",
    "SessionKind",
    "SessionCatalogModel",
    "SessionCatalogStore",
    "SessionRecord",
    "SessionTranscriptEnvelope",
    "STORY_CAST_SESSION_KIND",
    "STORY_NARRATOR_SESSION_KIND",
    "STORY_PLANNER_SESSION_KIND",
    "TranscriptEntry",
]
