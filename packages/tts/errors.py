from __future__ import annotations

import asyncio
from typing import NoReturn

from packages.tts.models import TTSProviderError, TTSProviderErrorCode


class TTSException(Exception):
    def __init__(self, error: TTSProviderError):
        super().__init__(error.message)
        self.error = error

    def __str__(self) -> str:
        return self.error.message


class TTSRegistryError(TTSException):
    pass


class TTSProviderExecutionError(TTSException):
    pass


class TTSServiceError(TTSException):
    pass


def build_tts_error(
    *,
    error_code: TTSProviderErrorCode,
    message: str,
    retryable: bool,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
    http_status: int | None = None,
) -> TTSProviderError:
    return TTSProviderError(
        error_code=error_code,
        message=message,
        retryable=retryable,
        provider_key=provider_key,
        provider_profile_key=provider_profile_key,
        voice_profile_key=voice_profile_key,
        http_status=http_status,
    )


def raise_registry_error(
    *,
    error_code: TTSProviderErrorCode,
    message: str,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
) -> NoReturn:
    raise TTSRegistryError(
        build_tts_error(
            error_code=error_code,
            message=message,
            retryable=False,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
    )


def raise_service_error(
    *,
    error_code: TTSProviderErrorCode,
    message: str,
    retryable: bool,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
) -> NoReturn:
    raise TTSServiceError(
        build_tts_error(
            error_code=error_code,
            message=message,
            retryable=retryable,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
    )


def raise_provider_error(
    *,
    error_code: TTSProviderErrorCode,
    message: str,
    retryable: bool,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
    http_status: int | None = None,
) -> NoReturn:
    raise TTSProviderExecutionError(
        build_tts_error(
            error_code=error_code,
            message=message,
            retryable=retryable,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
            http_status=http_status,
        )
    )


def provider_error_from_exception(
    exc: BaseException,
    *,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
) -> TTSProviderError:
    if isinstance(exc, TTSException):
        return exc.error
    if isinstance(exc, asyncio.TimeoutError):
        return build_tts_error(
            error_code=TTSProviderErrorCode.TIMEOUT,
            message="TTS synthesis timed out",
            retryable=True,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
    if isinstance(exc, asyncio.CancelledError):
        return build_tts_error(
            error_code=TTSProviderErrorCode.CANCELLED,
            message="TTS synthesis was cancelled",
            retryable=False,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
    return build_tts_error(
        error_code=TTSProviderErrorCode.PROVIDER_UNAVAILABLE,
        message=str(exc) or "TTS provider failed",
        retryable=True,
        provider_key=provider_key,
        provider_profile_key=provider_profile_key,
        voice_profile_key=voice_profile_key,
    )


def wrap_provider_exception(
    exc: BaseException,
    *,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
) -> TTSProviderExecutionError:
    return TTSProviderExecutionError(
        provider_error_from_exception(
            exc,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
    )


def wrap_service_exception(
    exc: BaseException,
    *,
    provider_key: str | None = None,
    provider_profile_key: str | None = None,
    voice_profile_key: str | None = None,
) -> TTSServiceError:
    if isinstance(exc, TTSServiceError):
        return exc
    if isinstance(exc, TTSRegistryError):
        return TTSServiceError(exc.error)
    if isinstance(exc, TTSProviderExecutionError):
        return TTSServiceError(exc.error)
    return TTSServiceError(
        provider_error_from_exception(
            exc,
            provider_key=provider_key,
            provider_profile_key=provider_profile_key,
            voice_profile_key=voice_profile_key,
        )
    )
