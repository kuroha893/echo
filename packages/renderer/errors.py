from __future__ import annotations

import asyncio
from typing import NoReturn
from uuid import UUID

from packages.protocol.events import RendererCommandType
from packages.renderer.models import (
    RendererAdapterErrorCode,
    RendererAdapterFailure,
)


class RendererException(Exception):
    def __init__(self, error: RendererAdapterFailure):
        super().__init__(error.message)
        self.error = error

    def __str__(self) -> str:
        return self.error.message


class RendererRegistryError(RendererException):
    pass


class RendererAdapterExecutionError(RendererException):
    pass


class RendererServiceError(RendererException):
    pass


def build_renderer_error(
    *,
    error_code: RendererAdapterErrorCode,
    message: str,
    retryable: bool,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
    raw_error_type: str | None = None,
) -> RendererAdapterFailure:
    return RendererAdapterFailure(
        error_code=error_code,
        message=message,
        retryable=retryable,
        adapter_key=adapter_key,
        adapter_profile_key=adapter_profile_key,
        command_id=command_id,
        command_type=command_type,
        raw_error_type=raw_error_type,
    )


def build_unsupported_command_error(
    *,
    adapter_key: str,
    adapter_profile_key: str | None,
    command_id: UUID,
    command_type: RendererCommandType,
    message: str | None = None,
) -> RendererAdapterFailure:
    return build_renderer_error(
        error_code=RendererAdapterErrorCode.UNSUPPORTED_COMMAND,
        message=message
        or f"renderer adapter '{adapter_key}' does not support command '{command_type.value}'",
        retryable=False,
        adapter_key=adapter_key,
        adapter_profile_key=adapter_profile_key,
        command_id=command_id,
        command_type=command_type,
    )


def build_unsupported_target_error(
    *,
    adapter_key: str,
    adapter_profile_key: str | None,
    command_id: UUID,
    command_type: RendererCommandType,
    message: str,
) -> RendererAdapterFailure:
    return build_renderer_error(
        error_code=RendererAdapterErrorCode.UNSUPPORTED_TARGET,
        message=message,
        retryable=False,
        adapter_key=adapter_key,
        adapter_profile_key=adapter_profile_key,
        command_id=command_id,
        command_type=command_type,
    )


def build_no_result_error(
    *,
    adapter_key: str,
    adapter_profile_key: str | None,
    command_id: UUID,
    command_type: RendererCommandType,
) -> RendererAdapterFailure:
    return build_renderer_error(
        error_code=RendererAdapterErrorCode.NO_RESULT,
        message="renderer adapter returned no dispatch result",
        retryable=True,
        adapter_key=adapter_key,
        adapter_profile_key=adapter_profile_key,
        command_id=command_id,
        command_type=command_type,
    )


def build_malformed_response_error(
    *,
    adapter_key: str,
    adapter_profile_key: str | None,
    command_id: UUID,
    command_type: RendererCommandType,
    message: str,
) -> RendererAdapterFailure:
    return build_renderer_error(
        error_code=RendererAdapterErrorCode.MALFORMED_RESPONSE,
        message=message,
        retryable=False,
        adapter_key=adapter_key,
        adapter_profile_key=adapter_profile_key,
        command_id=command_id,
        command_type=command_type,
    )


def raise_registry_error(
    *,
    error_code: RendererAdapterErrorCode,
    message: str,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
) -> NoReturn:
    raise RendererRegistryError(
        build_renderer_error(
            error_code=error_code,
            message=message,
            retryable=False,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
        )
    )


def raise_adapter_error(
    *,
    error_code: RendererAdapterErrorCode,
    message: str,
    retryable: bool,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
    raw_error_type: str | None = None,
) -> NoReturn:
    raise RendererAdapterExecutionError(
        build_renderer_error(
            error_code=error_code,
            message=message,
            retryable=retryable,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
            raw_error_type=raw_error_type,
        )
    )


def raise_service_error(
    *,
    error_code: RendererAdapterErrorCode,
    message: str,
    retryable: bool,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
    raw_error_type: str | None = None,
) -> NoReturn:
    raise RendererServiceError(
        build_renderer_error(
            error_code=error_code,
            message=message,
            retryable=retryable,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
            raw_error_type=raw_error_type,
        )
    )


def renderer_error_from_exception(
    exc: BaseException,
    *,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
) -> RendererAdapterFailure:
    if isinstance(exc, RendererException):
        return exc.error
    if isinstance(exc, asyncio.TimeoutError):
        return build_renderer_error(
            error_code=RendererAdapterErrorCode.TIMEOUT,
            message="renderer dispatch timed out",
            retryable=True,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
            raw_error_type=type(exc).__name__,
        )
    if isinstance(exc, asyncio.CancelledError):
        return build_renderer_error(
            error_code=RendererAdapterErrorCode.CANCELLED,
            message="renderer dispatch was cancelled",
            retryable=False,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
            raw_error_type=type(exc).__name__,
        )
    if isinstance(exc, (ConnectionError, OSError)):
        return build_renderer_error(
            error_code=RendererAdapterErrorCode.ADAPTER_UNAVAILABLE,
            message=str(exc) or "renderer adapter is unavailable",
            retryable=True,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
            raw_error_type=type(exc).__name__,
        )
    return build_renderer_error(
        error_code=RendererAdapterErrorCode.INTERNAL_ADAPTER_ERROR,
        message=str(exc) or "renderer adapter failed",
        retryable=False,
        adapter_key=adapter_key,
        adapter_profile_key=adapter_profile_key,
        command_id=command_id,
        command_type=command_type,
        raw_error_type=type(exc).__name__,
    )


def wrap_adapter_exception(
    exc: BaseException,
    *,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
) -> RendererAdapterExecutionError:
    if isinstance(exc, RendererAdapterExecutionError):
        return exc
    return RendererAdapterExecutionError(
        renderer_error_from_exception(
            exc,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
        )
    )


def wrap_service_exception(
    exc: BaseException,
    *,
    adapter_key: str | None = None,
    adapter_profile_key: str | None = None,
    command_id: UUID | None = None,
    command_type: RendererCommandType | None = None,
) -> RendererServiceError:
    if isinstance(exc, RendererServiceError):
        return exc
    if isinstance(exc, RendererRegistryError):
        return RendererServiceError(exc.error)
    if isinstance(exc, RendererAdapterExecutionError):
        return RendererServiceError(exc.error)
    return RendererServiceError(
        renderer_error_from_exception(
            exc,
            adapter_key=adapter_key,
            adapter_profile_key=adapter_profile_key,
            command_id=command_id,
            command_type=command_type,
        )
    )


__all__ = [
    "RendererAdapterExecutionError",
    "RendererException",
    "RendererRegistryError",
    "RendererServiceError",
    "build_malformed_response_error",
    "build_no_result_error",
    "build_renderer_error",
    "build_unsupported_command_error",
    "build_unsupported_target_error",
    "raise_adapter_error",
    "raise_registry_error",
    "raise_service_error",
    "renderer_error_from_exception",
    "wrap_adapter_exception",
    "wrap_service_exception",
]
