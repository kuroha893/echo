from __future__ import annotations

import asyncio
from typing import NoReturn

from packages.llm.models import LLMProviderError, LLMProviderErrorCode


class LLMError(Exception):
    """Base exception for llm-local failures."""


class LLMProviderFailure(LLMError):
    """
    Exception wrapper around the normalized provider failure model.

    Callers outside `packages/llm` should only need the typed `error` payload.
    """

    def __init__(self, error: LLMProviderError) -> None:
        super().__init__(error.message)
        self.error = error

    def __str__(self) -> str:
        return self.error.message


class LLMValidationFailure(LLMProviderFailure):
    pass


class LLMConfigurationFailure(LLMProviderFailure):
    pass


class LLMAuthenticationFailure(LLMProviderFailure):
    pass


class LLMProviderUnavailableFailure(LLMProviderFailure):
    pass


class LLMRateLimitedFailure(LLMProviderFailure):
    pass


class LLMTimeoutFailure(LLMProviderFailure):
    pass


class LLMCancelledFailure(LLMProviderFailure):
    pass


class LLMMalformedResponseFailure(LLMProviderFailure):
    pass


class LLMUnsupportedCapabilityFailure(LLMProviderFailure):
    pass


class LLMRegistryFailure(LLMConfigurationFailure):
    """
    Registry lookup/configuration failures stay configuration-scoped rather than
    pretending to be transport errors.
    """


_ERROR_CLASS_BY_CODE: dict[LLMProviderErrorCode, type[LLMProviderFailure]] = {
    LLMProviderErrorCode.VALIDATION_ERROR: LLMValidationFailure,
    LLMProviderErrorCode.CONFIGURATION_ERROR: LLMConfigurationFailure,
    LLMProviderErrorCode.AUTH_FAILED: LLMAuthenticationFailure,
    LLMProviderErrorCode.PROVIDER_UNAVAILABLE: LLMProviderUnavailableFailure,
    LLMProviderErrorCode.RATE_LIMITED: LLMRateLimitedFailure,
    LLMProviderErrorCode.TIMEOUT: LLMTimeoutFailure,
    LLMProviderErrorCode.CANCELLED: LLMCancelledFailure,
    LLMProviderErrorCode.MALFORMED_RESPONSE: LLMMalformedResponseFailure,
    LLMProviderErrorCode.UNSUPPORTED_CAPABILITY: LLMUnsupportedCapabilityFailure,
}


def build_provider_error(
    *,
    error_code: LLMProviderErrorCode,
    message: str,
    retryable: bool,
    provider_key: str | None = None,
    profile_key: str | None = None,
    status_code: int | None = None,
    raw_error_type: str | None = None,
) -> LLMProviderError:
    return LLMProviderError(
        error_code=error_code,
        message=message,
        retryable=retryable,
        provider_key=provider_key,
        profile_key=profile_key,
        status_code=status_code,
        raw_error_type=raw_error_type,
    )


def provider_failure_from_error(error: LLMProviderError) -> LLMProviderFailure:
    failure_type = _ERROR_CLASS_BY_CODE[error.error_code]
    return failure_type(error)


def raise_provider_failure(
    *,
    error_code: LLMProviderErrorCode,
    message: str,
    retryable: bool,
    provider_key: str | None = None,
    profile_key: str | None = None,
    status_code: int | None = None,
    raw_error_type: str | None = None,
) -> NoReturn:
    raise provider_failure_from_error(
        build_provider_error(
            error_code=error_code,
            message=message,
            retryable=retryable,
            provider_key=provider_key,
            profile_key=profile_key,
            status_code=status_code,
            raw_error_type=raw_error_type,
        )
    )


def build_registry_failure(
    *,
    message: str,
    provider_key: str | None = None,
    profile_key: str | None = None,
) -> LLMRegistryFailure:
    return LLMRegistryFailure(
        build_provider_error(
            error_code=LLMProviderErrorCode.CONFIGURATION_ERROR,
            message=message,
            retryable=False,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type="RegistryResolutionError",
        )
    )


def build_unsupported_capability_failure(
    *,
    message: str,
    provider_key: str | None = None,
    profile_key: str | None = None,
) -> LLMUnsupportedCapabilityFailure:
    return LLMUnsupportedCapabilityFailure(
        build_provider_error(
            error_code=LLMProviderErrorCode.UNSUPPORTED_CAPABILITY,
            message=message,
            retryable=False,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type="UnsupportedCapabilityError",
        )
    )


def build_malformed_response_failure(
    *,
    message: str,
    provider_key: str | None = None,
    profile_key: str | None = None,
    raw_error_type: str | None = None,
) -> LLMMalformedResponseFailure:
    return LLMMalformedResponseFailure(
        build_provider_error(
            error_code=LLMProviderErrorCode.MALFORMED_RESPONSE,
            message=message,
            retryable=False,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=raw_error_type or "MalformedProviderResponse",
        )
    )


def normalize_provider_exception(
    exc: BaseException,
    *,
    provider_key: str | None = None,
    profile_key: str | None = None,
) -> LLMProviderFailure:
    """
    Convert arbitrary provider-side exceptions into the llm-local failure surface.

    Concrete providers should raise typed failures directly whenever possible. This
    helper exists as a conservative normalization guard.
    """

    if isinstance(exc, LLMProviderFailure):
        return exc

    if isinstance(exc, asyncio.CancelledError):
        return LLMCancelledFailure(
            build_provider_error(
                error_code=LLMProviderErrorCode.CANCELLED,
                message="llm request was cancelled",
                retryable=False,
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            )
        )

    if isinstance(exc, TimeoutError):
        return LLMTimeoutFailure(
            build_provider_error(
                error_code=LLMProviderErrorCode.TIMEOUT,
                message="llm request timed out",
                retryable=True,
                provider_key=provider_key,
                profile_key=profile_key,
                raw_error_type=type(exc).__name__,
            )
        )

    return LLMProviderUnavailableFailure(
        build_provider_error(
            error_code=LLMProviderErrorCode.PROVIDER_UNAVAILABLE,
            message=str(exc) or "llm provider became unavailable",
            retryable=True,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=type(exc).__name__,
        )
    )


__all__ = [
    "LLMAuthenticationFailure",
    "LLMCancelledFailure",
    "LLMConfigurationFailure",
    "LLMError",
    "LLMMalformedResponseFailure",
    "LLMProviderFailure",
    "LLMProviderUnavailableFailure",
    "LLMRateLimitedFailure",
    "LLMRegistryFailure",
    "LLMTimeoutFailure",
    "LLMUnsupportedCapabilityFailure",
    "LLMValidationFailure",
    "build_malformed_response_failure",
    "build_provider_error",
    "build_registry_failure",
    "build_unsupported_capability_failure",
    "normalize_provider_exception",
    "provider_failure_from_error",
    "raise_provider_failure",
]
