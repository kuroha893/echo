from __future__ import annotations

import asyncio
import io
import json
import os
import sys
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from packages.llm.models import LLMImageAttachment  # noqa: E402
from packages.renderer.desktop_live2d_bridge import (  # noqa: E402
    DesktopLive2DBridgeConfig,
    DesktopLive2DBridgeResponse,
    DesktopLive2DBridgeTransportPort,
    build_default_desktop_live2d_bridge_config,
    decode_desktop_live2d_bridge_response_json,
)
from packages.runtime.desktop_companion_session_service import (  # noqa: E402
    DesktopCompanionSessionService,
    DesktopCompanionSessionDesktopSnapshot,
    DesktopCompanionSessionServiceHaltedError,
)
from packages.runtime.session_catalog import (  # noqa: E402
    DIRECT_SESSION_KIND,
    SessionCatalogStore,
    SessionKind,
    SessionRecord,
    STORY_CAST_SESSION_KIND,
    STORY_NARRATOR_SESSION_KIND,
    TranscriptEntry,
)

try:  # pragma: no cover - import fallback for script-mode host execution
    from .provider_host_assembly import (  # noqa: E402
        DesktopCompanionHostAssembler,
        DesktopCompanionHostAssemblyError,
        DesktopCompanionHostProviderTransports,
    )
    from .provider_settings import (  # noqa: E402
        DesktopProviderReadinessSnapshot,
        DesktopProviderSettingsLoadResult,
        DesktopProviderSettingsSaveRequest,
        DesktopProviderSettingsSaveResult,
        DesktopProviderSettingsStore,
        DesktopProviderSettingsValidationResult,
        DesktopTTSVoiceEnrollmentOperationResult,
        DesktopTTSVoiceEnrollmentRequest,
    )
    from .voice_catalog import ClonedVoiceCatalogStore  # noqa: E402
except ImportError:  # pragma: no cover - script fallback
    from provider_host_assembly import (  # noqa: E402
        DesktopCompanionHostAssembler,
        DesktopCompanionHostAssemblyError,
        DesktopCompanionHostProviderTransports,
    )
    from provider_settings import (  # noqa: E402
        DesktopProviderReadinessSnapshot,
        DesktopProviderSettingsLoadResult,
        DesktopProviderSettingsSaveRequest,
        DesktopProviderSettingsSaveResult,
        DesktopProviderSettingsStore,
        DesktopProviderSettingsValidationResult,
        DesktopTTSVoiceEnrollmentOperationResult,
        DesktopTTSVoiceEnrollmentRequest,
    )
    from voice_catalog import ClonedVoiceCatalogStore  # noqa: E402


HostMessageKind = Literal[
    "service_operation_request",
    "service_operation_response",
    "desktop_bridge_request",
    "desktop_bridge_response",
]
HostOperationKind = Literal[
    "load_provider_settings",
    "save_provider_settings",
    "validate_provider_settings",
    "get_provider_readiness",
    "run_tts_voice_enrollment",
    "list_cloned_voices",
    "snapshot_desktop_state",
    "submit_desktop_input",
    "list_sessions",
    "create_session",
    "switch_session",
    "delete_session",
    "fork_session",
    "get_active_session",
    "get_session_detail",
    "shutdown",
]


class HostModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class HostServiceOperationRequest(HostModel):
    message_kind: Literal["service_operation_request"]
    request_id: UUID
    operation: HostOperationKind
    payload: dict[str, Any] = Field(default_factory=dict)


class HostServiceOperationResponse(HostModel):
    message_kind: Literal["service_operation_response"] = "service_operation_response"
    request_id: UUID
    operation: HostOperationKind
    status: Literal["ok", "error"]
    payload: dict[str, Any] | None = None
    error_type: str | None = None
    error_message: str | None = None
    failure: dict[str, Any] | None = None


class HostDesktopBridgeRequest(HostModel):
    message_kind: Literal["desktop_bridge_request"] = "desktop_bridge_request"
    request_id: UUID
    bridge_request: dict[str, Any]


class HostDesktopBridgeResponse(HostModel):
    message_kind: Literal["desktop_bridge_response"]
    request_id: UUID
    bridge_response: dict[str, Any]


def parse_host_message(
    raw_line: str,
) -> HostServiceOperationRequest | HostDesktopBridgeResponse:
    raw = json.loads(raw_line)
    if not isinstance(raw, dict):
        raise ValueError("companion service host message must be a JSON object")
    message_kind = raw.get("message_kind")
    if message_kind == "service_operation_request":
        return HostServiceOperationRequest.model_validate(raw)
    if message_kind == "desktop_bridge_response":
        return HostDesktopBridgeResponse.model_validate(raw)
    raise ValueError(f"unsupported companion service host message_kind '{message_kind}'")


def _reconfigure_text_stream_utf8(
    stream: io.TextIOBase,
    *,
    stream_name: str,
    write_through: bool,
) -> io.TextIOBase:
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(
            encoding="utf-8",
            errors="strict",
            newline=None,
            write_through=write_through,
        )
        return stream
    buffer = getattr(stream, "buffer", None)
    if buffer is None:
        raise RuntimeError(
            f"{stream_name} must expose reconfigure() or buffer for UTF-8 host I/O"
        )
    return io.TextIOWrapper(
        buffer,
        encoding="utf-8",
        errors="strict",
        newline=None,
        write_through=write_through,
    )


def configure_process_stdio_utf8() -> None:
    sys.stdin = _reconfigure_text_stream_utf8(
        sys.stdin,
        stream_name="stdin",
        write_through=False,
    )
    sys.stdout = _reconfigure_text_stream_utf8(
        sys.stdout,
        stream_name="stdout",
        write_through=True,
    )
    sys.stderr = _reconfigure_text_stream_utf8(
        sys.stderr,
        stream_name="stderr",
        write_through=True,
    )


class HostDesktopBridgeTransport(DesktopLive2DBridgeTransportPort):
    def __init__(self, host: "DesktopCompanionServiceHost") -> None:
        self._host = host
        self._running = False

    async def start(self) -> None:
        self._running = True

    async def send_request(
        self,
        request,
        *,
        timeout_ms: int,
    ) -> DesktopLive2DBridgeResponse:
        await self.start()
        response = await self._host.request_desktop_bridge(
            request_id=request.request_id,
            bridge_request=request.model_dump(mode="json"),
            timeout_ms=timeout_ms,
        )
        return decode_desktop_live2d_bridge_response_json(json.dumps(response))

    async def close(self) -> None:
        self._running = False

    def is_running(self) -> bool:
        return self._running

    def get_stderr_lines(self) -> tuple[str, ...]:
        return ()


class DesktopCompanionServiceHost:
    def __init__(
        self,
        *,
        workspace_root: Path,
        user_data_dir: Path,
        provider_transports: DesktopCompanionHostProviderTransports | None = None,
    ) -> None:
        self._workspace_root = workspace_root
        self._user_data_dir = user_data_dir
        self._write_lock = asyncio.Lock()
        self._bridge_waiters: dict[UUID, asyncio.Future[dict[str, Any]]] = {}
        self._bridge_config = build_default_desktop_live2d_bridge_config(
            workspace_root=workspace_root
        )
        self._desktop_transport = HostDesktopBridgeTransport(self)
        self._settings_store = DesktopProviderSettingsStore(user_data_dir=user_data_dir)
        self._voice_catalog = ClonedVoiceCatalogStore(user_data_dir=user_data_dir)
        self._catalog = SessionCatalogStore(
            base_dir=user_data_dir / "session-store",
        )
        self._voice_catalog.load()
        self._catalog.load()
        self._sanitize_active_session_on_startup()
        self._provider_transports = provider_transports
        self._services: dict[UUID, DesktopCompanionSessionService] = {}
        self._service_model_keys: dict[UUID, str | None] = {}
        self._session_voice_profile_keys: dict[UUID, str | None] = {}
        self._operation_lock = asyncio.Lock()
        self._stopped = False

    def _sanitize_active_session_on_startup(self) -> None:
        active_id = self._catalog.get_active_session_id()
        if active_id is None:
            return
        active_record = self._catalog.get_session(active_id)
        if active_record is not None and active_record.session_kind != DIRECT_SESSION_KIND:
            self._catalog.set_active_session_id(None)

    def _normalize_model_key(self, model_key: Any) -> str | None:
        if not isinstance(model_key, str):
            return None
        normalized = model_key.strip()
        return normalized or None

    async def run(self) -> None:
        while not self._stopped:
            raw_line = await asyncio.to_thread(sys.stdin.readline)
            if raw_line == "":
                break
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            message = parse_host_message(raw_line)
            if isinstance(message, HostDesktopBridgeResponse):
                waiter = self._bridge_waiters.pop(message.request_id, None)
                if waiter is not None and not waiter.done():
                    waiter.set_result(message.bridge_response)
                continue
            asyncio.create_task(self._handle_service_operation(message))

    async def load_provider_settings(self) -> DesktopProviderSettingsLoadResult:
        document = self._settings_store.load_or_create_document()
        readiness = self._build_assembler().build_readiness(document)
        return DesktopProviderSettingsLoadResult(
            settings_path=str(self._settings_store.get_settings_path()),
            settings_snapshot=document.masked_snapshot(),
            readiness=readiness,
        )

    async def save_provider_settings(
        self,
        request: DesktopProviderSettingsSaveRequest,
    ) -> DesktopProviderSettingsSaveResult:
        document = self._settings_store.save(request)
        readiness = self._build_assembler().build_readiness(document)
        await self._reset_all_session_services()
        return DesktopProviderSettingsSaveResult(
            settings_path=str(self._settings_store.get_settings_path()),
            settings_snapshot=document.masked_snapshot(),
            readiness=readiness,
        )

    async def validate_provider_settings(self) -> DesktopProviderSettingsValidationResult:
        document = self._settings_store.load_or_create_document()
        assembler = self._build_assembler()
        readiness = assembler.build_readiness(document)
        if readiness.runtime_ready:
            service = assembler.build_session_service(
                settings=document,
                transport=self._desktop_transport,
            )
            await service.close()
        return DesktopProviderSettingsValidationResult(
            settings_path=str(self._settings_store.get_settings_path()),
            settings_snapshot=document.masked_snapshot(),
            readiness=readiness,
        )

    async def get_provider_readiness(self) -> DesktopProviderReadinessSnapshot:
        document = self._settings_store.load_or_create_document()
        return self._build_assembler().build_readiness(document)

    async def run_tts_voice_enrollment(
        self,
        request: DesktopTTSVoiceEnrollmentRequest,
    ) -> DesktopTTSVoiceEnrollmentOperationResult:
        document = self._settings_store.load_or_create_document()
        assembler = self._build_assembler()
        enrollment_result = await assembler.run_tts_voice_enrollment(
            settings=document,
            request=request,
        )
        self._voice_catalog.record_enrollment(enrollment_result)
        updated_document = (
            self._settings_store.persist_enrolled_voice(enrollment_result)
            if request.replace_active_voice
            else document
        )
        readiness = assembler.build_readiness(updated_document)
        if request.replace_active_voice:
            await self._reset_all_session_services()
        return DesktopTTSVoiceEnrollmentOperationResult(
            settings_path=str(self._settings_store.get_settings_path()),
            settings_snapshot=updated_document.masked_snapshot(),
            readiness=readiness,
            enrollment_result=enrollment_result,
        )

    async def list_cloned_voices(self) -> dict[str, Any]:
        document = self._settings_store.load_or_create_document()
        entries = self._voice_catalog.list_voices()
        active_voice_profile_key = document.qwen_tts.voice_profile_key
        return {
            "active_voice_profile_key": active_voice_profile_key,
            "voices": [
                {
                    "voice_profile_key": entry.voice_profile_key,
                    "provider_key": entry.provider_key,
                    "display_name": entry.display_name,
                    "provider_voice_id": entry.provider_voice_id,
                    "provider_realtime_voice_id": entry.provider_realtime_voice_id,
                    "reference_audio_path": entry.reference_audio_path,
                    "prompt_text": entry.prompt_text,
                    "prompt_language": entry.prompt_language,
                    "created_at": entry.created_at.isoformat(),
                    "is_active": entry.voice_profile_key == active_voice_profile_key,
                }
                for entry in entries
            ],
        }

    async def snapshot_desktop_state(self) -> DesktopCompanionSessionDesktopSnapshot:
        service = await self._get_or_create_active_session_service()
        return await service.snapshot_desktop_state()

    async def snapshot_visible_session_state(
        self,
        *,
        session_kind: SessionKind = DIRECT_SESSION_KIND,
        model_key: str | None = None,
    ) -> DesktopCompanionSessionDesktopSnapshot:
        service, _record = await self._get_or_create_visible_session_service(
            model_key=model_key,
            session_kind=session_kind,
            create_if_missing=True,
        )
        return await service.snapshot_desktop_state()

    async def submit_desktop_input(
        self,
        text: str,
        *,
        images: tuple[LLMImageAttachment, ...] = (),
        visible_in_transcript: bool = True,
        model_key: str | None = None,
        target_session_kind: SessionKind | None = None,
    ) -> dict[str, Any]:
        normalized_model_key = self._normalize_model_key(model_key)
        if target_session_kind is None:
            service = await self._get_or_create_active_session_service(
                model_key=normalized_model_key
            )
            active_id = self._catalog.get_active_session_id()
            if active_id is None:
                raise RuntimeError("no active session for submit_desktop_input")
            target_session_id = active_id
            generation_at_start = self._catalog.get_generation(active_id)
        else:
            service, record = await self._get_or_create_visible_session_service(
                model_key=normalized_model_key,
                session_kind=target_session_kind,
                create_if_missing=True,
            )
            target_session_id = record.session_id
            generation_at_start = self._catalog.get_generation(target_session_id)
        result = await service.submit_desktop_input(
            text,
            images=images,
            visible_in_transcript=visible_in_transcript,
        )
        if target_session_kind is None and self._catalog.get_active_session_id() != target_session_id:
            raise RuntimeError(
                "active session changed during submit_desktop_input; result discarded"
            )
        if self._catalog.get_generation(target_session_id) != generation_at_start:
            raise RuntimeError(
                "session generation changed during submit_desktop_input; result discarded"
            )
        self._sync_transcript_from_result(target_session_id, result)
        return result.model_dump(mode="json")

    async def close(self) -> None:
        self._stopped = True
        for service in list(self._services.values()):
            await service.close()
        self._services.clear()
        self._service_model_keys.clear()

    async def list_sessions(self) -> dict[str, Any]:
        model_key, _active_record = await self._ensure_model_scoped_active_session(
            create_if_missing=False
        )
        entries = self._catalog.list_sessions_for_model(
            model_key,
            session_kind=DIRECT_SESSION_KIND,
        )
        active_record = self._get_visible_session_record(
            model_key,
            session_kind=DIRECT_SESSION_KIND,
        )
        return {
            "model_key": model_key,
            "active_session_id": str(active_record.session_id)
            if active_record is not None
            else None,
            "sessions": [
                {
                    "session_id": str(e.session_id),
                    "title": e.title,
                    "model_key": e.model_key,
                    "session_kind": e.session_kind,
                    "created_at": e.created_at.isoformat(),
                    "updated_at": e.updated_at.isoformat(),
                }
                for e in entries
            ],
        }

    async def create_session(
        self,
        *,
        title: str = "",
        make_active: bool = True,
        model_key: str | None = None,
        session_kind: SessionKind = DIRECT_SESSION_KIND,
        voice_profile_key: str | None = None,
    ) -> dict[str, Any]:
        model_key = self._resolve_active_model_key(model_key=model_key)
        if make_active:
            await self._close_active_service_if_busy()
        record = self._catalog.create_session(
            title=title,
            model_key=model_key,
            session_kind=session_kind,
            make_active=make_active,
        )
        self._session_voice_profile_keys[record.session_id] = (
            voice_profile_key.strip()
            if isinstance(voice_profile_key, str) and voice_profile_key.strip()
            else None
        )
        return {
            "session_id": str(record.session_id),
            "title": record.title,
            "model_key": record.model_key,
            "session_kind": record.session_kind,
            "voice_profile_key": self._session_voice_profile_keys[record.session_id],
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
            "active": make_active,
        }

    async def switch_session(
        self,
        session_id: UUID,
        *,
        model_key: str | None = None,
    ) -> dict[str, Any]:
        model_key = self._resolve_active_model_key(model_key=model_key)
        record = self._get_session_for_model(session_id, model_key)
        current_active = self._catalog.get_active_session_id()
        if current_active == session_id:
            return {
                "session_id": str(session_id),
                "switched": False,
                "reason": "already active",
            }
        await self._close_active_service_if_busy()
        self._catalog.set_active_session_id(session_id)
        self._catalog.bump_generation(session_id)
        return {
            "session_id": str(session_id),
            "model_key": record.model_key,
            "session_kind": record.session_kind,
            "switched": True,
        }

    async def delete_session(self, session_id: UUID) -> dict[str, Any]:
        model_key = self._resolve_active_model_key()
        self._get_session_for_model(session_id, model_key)
        service = self._services.pop(session_id, None)
        self._service_model_keys.pop(session_id, None)
        self._session_voice_profile_keys.pop(session_id, None)
        if service is not None:
            await service.close()
        self._catalog.delete_session(session_id)
        return {"deleted": str(session_id)}

    async def fork_session(
        self,
        source_session_id: UUID,
        *,
        cut_after_index: int | None = None,
        title: str = "",
        make_active: bool = True,
    ) -> dict[str, Any]:
        model_key = self._resolve_active_model_key()
        self._get_session_for_model(source_session_id, model_key)
        if make_active:
            await self._close_active_service_if_busy()
        record = self._catalog.fork_session(
            source_session_id,
            cut_after_index=cut_after_index,
            title=title,
            make_active=make_active,
        )
        return {
            "session_id": str(record.session_id),
            "title": record.title,
            "model_key": record.model_key,
            "session_kind": record.session_kind,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
            "forked_from": str(source_session_id),
        }

    async def get_active_session(self) -> dict[str, Any]:
        model_key, _record = await self._ensure_model_scoped_active_session(
            create_if_missing=False
        )
        record = self._get_visible_session_record(
            model_key,
            session_kind=DIRECT_SESSION_KIND,
        )
        if record is None:
            return {"active_session_id": None}
        return {
            "session_id": str(record.session_id),
            "title": record.title,
            "model_key": model_key,
            "session_kind": record.session_kind,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
            "generation": record.generation,
        }

    async def get_session_detail(self, session_id: UUID) -> dict[str, Any]:
        model_key = self._resolve_active_model_key()
        record = self._get_session_for_model(session_id, model_key)
        entries = self._catalog.get_transcript(session_id)
        return {
            "session_id": str(record.session_id),
            "title": record.title,
            "model_key": record.model_key,
            "session_kind": record.session_kind,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
            "generation": record.generation,
            "transcript": [
                {
                    "entry_id": str(e.entry_id),
                    "turn_id": str(e.turn_id),
                    "role": e.role,
                    "text": e.text,
                    "raw_text": e.raw_text,
                    "is_streaming": e.is_streaming,
                    "sequence_index": e.sequence_index,
                }
                for e in entries
            ],
        }

    async def request_desktop_bridge(
        self,
        *,
        request_id: UUID,
        bridge_request: dict[str, Any],
        timeout_ms: int,
    ) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        waiter: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._bridge_waiters[request_id] = waiter
        await self._write_message(
            HostDesktopBridgeRequest(
                request_id=request_id,
                bridge_request=bridge_request,
            ).model_dump(mode="json")
        )
        try:
            return await asyncio.wait_for(waiter, timeout_ms / 1000)
        finally:
            self._bridge_waiters.pop(request_id, None)

    async def _handle_service_operation(
        self,
        message: HostServiceOperationRequest,
    ) -> None:
        async with self._operation_lock:
            try:
                payload = await self._dispatch_operation(message)
                response = HostServiceOperationResponse(
                    request_id=message.request_id,
                    operation=message.operation,
                    status="ok",
                    payload=payload,
                )
            except DesktopCompanionSessionServiceHaltedError as exc:
                response = HostServiceOperationResponse(
                    request_id=message.request_id,
                    operation=message.operation,
                    status="error",
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    failure=exc.failure.model_dump(mode="json"),
                )
            except Exception as exc:
                response = HostServiceOperationResponse(
                    request_id=message.request_id,
                    operation=message.operation,
                    status="error",
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                )
            await self._write_message(response.model_dump(mode="json"))

    async def _dispatch_operation(
        self,
        message: HostServiceOperationRequest,
    ) -> dict[str, Any]:
        if message.operation == "load_provider_settings":
            return (await self.load_provider_settings()).model_dump(mode="json")
        if message.operation == "save_provider_settings":
            return (
                await self.save_provider_settings(
                    DesktopProviderSettingsSaveRequest.model_validate(message.payload)
                )
            ).model_dump(mode="json")
        if message.operation == "validate_provider_settings":
            return (await self.validate_provider_settings()).model_dump(mode="json")
        if message.operation == "get_provider_readiness":
            return (await self.get_provider_readiness()).model_dump(mode="json")
        if message.operation == "run_tts_voice_enrollment":
            return (
                await self.run_tts_voice_enrollment(
                    DesktopTTSVoiceEnrollmentRequest.model_validate(message.payload)
                )
            ).model_dump(mode="json")
        if message.operation == "list_cloned_voices":
            return await self.list_cloned_voices()
        if message.operation == "snapshot_desktop_state":
            model_key = self._normalize_model_key(message.payload.get("model_key"))
            target_session_kind = message.payload.get("target_session_kind")
            if target_session_kind is None:
                return (await self.snapshot_desktop_state()).model_dump(mode="json")
            if target_session_kind not in (
                DIRECT_SESSION_KIND,
                STORY_CAST_SESSION_KIND,
                STORY_NARRATOR_SESSION_KIND,
            ):
                raise ValueError(
                    "snapshot_desktop_state target_session_kind must be 'direct', 'story_cast', or 'story_narrator'"
                )
            return (
                await self.snapshot_visible_session_state(
                    session_kind=target_session_kind,
                    model_key=model_key,
                )
            ).model_dump(mode="json")
        if message.operation == "submit_desktop_input":
            text = message.payload.get("text")
            if not isinstance(text, str):
                raise ValueError("submit_desktop_input requires a text payload")
            raw_images = message.payload.get("images") or []
            visible_in_transcript = message.payload.get("visible_in_transcript", True)
            model_key = self._normalize_model_key(message.payload.get("model_key"))
            target_session_kind = message.payload.get("target_session_kind")
            if not isinstance(visible_in_transcript, bool):
                raise ValueError("submit_desktop_input visible_in_transcript must be a boolean")
            if target_session_kind not in (
                None,
                DIRECT_SESSION_KIND,
                STORY_CAST_SESSION_KIND,
                STORY_NARRATOR_SESSION_KIND,
            ):
                raise ValueError(
                    "submit_desktop_input target_session_kind must be 'direct', 'story_cast', 'story_narrator', or omitted"
                )
            images = tuple(
                LLMImageAttachment.model_validate(img) for img in raw_images
            )
            return await self.submit_desktop_input(
                text,
                images=images,
                visible_in_transcript=visible_in_transcript,
                model_key=model_key,
                target_session_kind=target_session_kind,
            )
        if message.operation == "list_sessions":
            return await self.list_sessions()
        if message.operation == "create_session":
            title = message.payload.get("title", "")
            make_active = message.payload.get("make_active", True)
            model_key = self._normalize_model_key(message.payload.get("model_key"))
            voice_profile_key = self._normalize_model_key(
                message.payload.get("voice_profile_key")
            )
            session_kind = message.payload.get("session_kind", DIRECT_SESSION_KIND)
            if session_kind not in (DIRECT_SESSION_KIND, STORY_CAST_SESSION_KIND, STORY_NARRATOR_SESSION_KIND):
                raise ValueError("create_session session_kind must be 'direct', 'story_cast', or 'story_narrator'")
            return await self.create_session(
                title=title,
                make_active=make_active,
                model_key=model_key,
                session_kind=session_kind,
                voice_profile_key=voice_profile_key,
            )
        if message.operation == "switch_session":
            raw_id = message.payload.get("session_id")
            if not isinstance(raw_id, str):
                raise ValueError("switch_session requires a session_id string")
            model_key = self._normalize_model_key(message.payload.get("model_key"))
            return await self.switch_session(UUID(raw_id), model_key=model_key)
        if message.operation == "delete_session":
            raw_id = message.payload.get("session_id")
            if not isinstance(raw_id, str):
                raise ValueError("delete_session requires a session_id string")
            return await self.delete_session(UUID(raw_id))
        if message.operation == "fork_session":
            raw_id = message.payload.get("source_session_id")
            if not isinstance(raw_id, str):
                raise ValueError("fork_session requires a source_session_id string")
            cut_after = message.payload.get("cut_after_index")
            title = message.payload.get("title", "")
            make_active = message.payload.get("make_active", True)
            return await self.fork_session(
                UUID(raw_id),
                cut_after_index=cut_after,
                title=title,
                make_active=make_active,
            )
        if message.operation == "get_active_session":
            return await self.get_active_session()
        if message.operation == "get_session_detail":
            raw_id = message.payload.get("session_id")
            if not isinstance(raw_id, str):
                raise ValueError("get_session_detail requires a session_id string")
            return await self.get_session_detail(UUID(raw_id))
        if message.operation == "shutdown":
            await self.close()
            return {"closed": True}
        raise ValueError(f"unsupported operation '{message.operation}'")

    async def _get_or_create_active_session_service(
        self,
        *,
        model_key: str | None = None,
    ) -> DesktopCompanionSessionService:
        resolved_model_key = self._resolve_active_model_key(model_key=model_key)
        active_model_key, active_record = await self._ensure_model_scoped_active_session(
            create_if_missing=True,
            model_key=resolved_model_key,
        )
        if active_record is None:
            raise RuntimeError("failed to resolve active session for current model")
        return await self._get_or_create_session_service(active_record)

    async def _get_or_create_visible_session_service(
        self,
        *,
        model_key: str | None = None,
        session_kind: SessionKind,
        create_if_missing: bool,
    ) -> tuple[DesktopCompanionSessionService, SessionRecord]:
        resolved_model_key = self._resolve_active_model_key(model_key=model_key)
        if (
            resolved_model_key is not None
            and not self._catalog.list_sessions_for_model(resolved_model_key)
        ):
            self._catalog.assign_unscoped_sessions_to_model(resolved_model_key)

        record = self._get_visible_session_record(
            resolved_model_key,
            session_kind=session_kind,
        )
        if record is None:
            if not create_if_missing:
                raise RuntimeError(
                    f"no visible session available for session_kind '{session_kind}'"
                )
            if session_kind != DIRECT_SESSION_KIND:
                raise RuntimeError(
                    f"cannot auto-create non-direct visible session kind '{session_kind}'"
                )
            created = await self.create_session(
                title="",
                make_active=False,
                model_key=resolved_model_key,
                session_kind=session_kind,
            )
            created_id = UUID(created["session_id"])
            record = self._catalog.get_session(created_id)
            if record is None:
                raise RuntimeError("failed to resolve newly created visible session")

        service = await self._get_or_create_session_service(record)
        return service, record

    async def _get_or_create_session_service(
        self,
        record: SessionRecord,
    ) -> DesktopCompanionSessionService:
        active_id = record.session_id
        document = self._settings_store.load_or_create_document()
        assembler = self._build_assembler(active_id, active_model_key=record.model_key)
        cached_service = self._services.get(active_id)
        if cached_service is not None:
            if self._service_model_keys.get(active_id) == record.model_key:
                return cached_service
            await cached_service.close()
            self._services.pop(active_id, None)
            self._service_model_keys.pop(active_id, None)
        readiness = assembler.build_readiness(document)
        if not readiness.runtime_ready:
            raise DesktopCompanionHostAssemblyError(readiness.runtime_message)
        service = assembler.build_session_service(
            settings=document,
            transport=self._desktop_transport,
            transcript_source=lambda sid: self._catalog.get_transcript(sid),
        )
        self._services[active_id] = service
        self._service_model_keys[active_id] = record.model_key
        return service

    def _resolve_active_model_key(self, *, model_key: str | None = None) -> str | None:
        normalized = self._normalize_model_key(model_key)
        if normalized is not None:
            return normalized
        return self._build_assembler().resolve_active_model_key()

    async def _ensure_model_scoped_active_session(
        self,
        *,
        create_if_missing: bool,
        model_key: str | None = None,
    ) -> tuple[str | None, SessionRecord | None]:
        model_key = self._resolve_active_model_key(model_key=model_key)
        if model_key is not None and not self._catalog.list_sessions_for_model(model_key):
            self._catalog.assign_unscoped_sessions_to_model(model_key)
        active_id = self._catalog.get_active_session_id()
        active_record = self._catalog.get_session(active_id) if active_id is not None else None
        if active_record is not None and active_record.model_key == model_key:
            return model_key, active_record

        candidate = self._catalog.get_latest_session_for_model(
            model_key,
            session_kind=DIRECT_SESSION_KIND,
        )
        if candidate is None:
            if not create_if_missing:
                return model_key, None
            await self._close_active_service_if_busy()
            candidate = self._catalog.create_session(
                title="",
                model_key=model_key,
                make_active=True,
            )
            return model_key, candidate

        if active_id != candidate.session_id:
            await self._close_active_service_if_busy()
            self._catalog.set_active_session_id(candidate.session_id)
            self._catalog.bump_generation(candidate.session_id)
        resolved = self._catalog.get_session(candidate.session_id)
        return model_key, resolved

    def _get_visible_session_record(
        self,
        model_key: str | None,
        *,
        session_kind: SessionKind,
    ) -> SessionRecord | None:
        active_id = self._catalog.get_active_session_id()
        if active_id is not None:
            active_record = self._catalog.get_session(active_id)
            if (
                active_record is not None
                and active_record.model_key == model_key
                and active_record.session_kind == session_kind
            ):
                return active_record
        return self._catalog.get_latest_session_for_model(
            model_key,
            session_kind=session_kind,
        )

    def _get_session_for_model(
        self,
        session_id: UUID,
        model_key: str | None,
    ) -> SessionRecord:
        record = self._catalog.get_session(session_id)
        if record is None or record.model_key != model_key:
            raise ValueError(
                f"session '{session_id}' does not exist in current model scope"
            )
        return record

    async def _close_active_service_if_busy(self) -> None:
        active_id = self._catalog.get_active_session_id()
        if active_id is None:
            return
        service = self._services.pop(active_id, None)
        self._service_model_keys.pop(active_id, None)
        if service is not None:
            await service.close()

    async def _reset_all_session_services(self) -> None:
        for service in list(self._services.values()):
            await service.close()
        self._services.clear()
        self._service_model_keys.clear()

    def _get_session_voice_profile_key(self, session_id: UUID) -> str | None:
        return self._session_voice_profile_keys.get(session_id)

    def _sync_transcript_from_result(
        self,
        session_id: UUID,
        result,
    ) -> None:
        snapshot = self._get_transcript_snapshot_from_result(result)
        if snapshot is None:
            return
        for entry in sorted(
            snapshot.transcript_entries,
            key=lambda e: e.sequence_index,
        ):
            self._catalog.upsert_transcript_entry(
                session_id,
                turn_id=UUID(entry.turn_id) if isinstance(entry.turn_id, str) else entry.turn_id,
                role=entry.role,
                text=entry.text,
                raw_text=entry.raw_text or "",
                is_streaming=entry.is_streaming,
            )
        if not snapshot.transcript_entries:
            return
        first_user = next(
            (e for e in snapshot.transcript_entries if e.role == "user"),
            None,
        )
        record = self._catalog.get_session(session_id)
        if record is not None and not record.title and first_user is not None:
            title_text = first_user.text[:60].strip()
            if title_text:
                self._catalog.update_session_title(session_id, title_text)

    def _get_transcript_snapshot_from_result(self, result) -> Any | None:
        run_results = getattr(result, "run_results", None)
        if run_results:
            latest_run_result = run_results[-1]
            snapshot = getattr(
                latest_run_result,
                "final_companion_session_snapshot",
                None,
            )
            if snapshot is not None:
                return snapshot
            response = getattr(latest_run_result, "companion_session_response", None)
            response_snapshot = getattr(response, "companion_session_snapshot", None)
            if response_snapshot is not None:
                return response_snapshot

        final_desktop_snapshot = getattr(result, "final_desktop_snapshot", None)
        if final_desktop_snapshot is None:
            return None
        return getattr(final_desktop_snapshot, "companion_session_snapshot", None)

    def _build_assembler(
        self,
        session_id: UUID | None = None,
        active_model_key: str | None = None,
    ) -> DesktopCompanionHostAssembler:
        sid = session_id or self._catalog.get_active_session_id() or uuid4()
        record = self._catalog.get_session(sid)
        return DesktopCompanionHostAssembler(
            workspace_root=self._workspace_root,
            user_data_dir=self._user_data_dir,
            desktop_bridge_config=self._bridge_config,
            session_id=sid,
            active_model_key=active_model_key,
            tts_voice_profile_key_override=self._get_session_voice_profile_key(sid),
            provider_transports=self._provider_transports,
            session_kind=(
                record.session_kind if record is not None else DIRECT_SESSION_KIND
            ),
            suppress_bubble_and_expression=(
                record is not None and record.session_kind != DIRECT_SESSION_KIND
            ),
        )

    async def _write_message(self, payload: dict[str, Any]) -> None:
        async with self._write_lock:
            sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def _resolve_workspace_root() -> Path:
    raw = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT", str(REPO_ROOT))
    )
    return Path(raw).resolve()


def _resolve_user_data_dir(workspace_root: Path) -> Path:
    raw = os.environ.get("ECHO_DESKTOP_LIVE2D_USER_DATA_DIR")
    if raw is not None and raw.strip():
        return Path(raw).resolve()
    return (workspace_root / ".desktop-live2d-userdata").resolve()


async def main() -> None:
    workspace_root = _resolve_workspace_root()
    user_data_dir = _resolve_user_data_dir(workspace_root)
    host = DesktopCompanionServiceHost(
        workspace_root=workspace_root,
        user_data_dir=user_data_dir,
    )
    try:
        await host.run()
    finally:
        await host.close()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    configure_process_stdio_utf8()
    asyncio.run(main())
