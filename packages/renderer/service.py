from __future__ import annotations

import asyncio

from packages.protocol.events import RendererCommand
from packages.renderer.errors import (
    RendererAdapterExecutionError,
    RendererRegistryError,
    RendererServiceError,
    build_malformed_response_error,
    build_no_result_error,
    raise_service_error,
    wrap_service_exception,
)
from packages.renderer.models import (
    RendererDispatchRequest,
    RendererDispatchResult,
    RendererModel,
    RendererResolvedDispatchRequest,
)
from packages.renderer.registry import RendererRegistry, ResolvedRendererBinding


class RendererServiceConfig(RendererModel):
    validate_result_identity: bool = True
    require_dispatch_result: bool = True


class RendererService:
    def __init__(
        self,
        registry: RendererRegistry | None = None,
        *,
        config: RendererServiceConfig | None = None,
    ) -> None:
        self._registry = registry or RendererRegistry()
        self._config = config or RendererServiceConfig()

    def get_registry(self) -> RendererRegistry:
        return self._registry

    def get_config(self) -> RendererServiceConfig:
        return self._config

    def build_request(
        self,
        *,
        command: RendererCommand,
        adapter_profile_key: str | None = None,
        adapter_key_override: str | None = None,
        dispatch_timeout_ms: int | None = None,
    ) -> RendererDispatchRequest:
        return self._registry.build_request(
            command=command,
            adapter_profile_key=adapter_profile_key,
            adapter_key_override=adapter_key_override,
            dispatch_timeout_ms=dispatch_timeout_ms,
        )

    def inspect_resolution(
        self,
        request: RendererDispatchRequest,
    ) -> RendererResolvedDispatchRequest:
        return self._resolve_binding(request).resolved_request

    async def dispatch(
        self,
        request: RendererDispatchRequest,
    ) -> RendererDispatchResult:
        binding = self._resolve_binding(request)
        return await self._dispatch_binding(binding)

    async def dispatch_command(
        self,
        command: RendererCommand,
        *,
        adapter_profile_key: str | None = None,
        adapter_key_override: str | None = None,
        dispatch_timeout_ms: int | None = None,
    ) -> RendererDispatchResult:
        request = self.build_request(
            command=command,
            adapter_profile_key=adapter_profile_key,
            adapter_key_override=adapter_key_override,
            dispatch_timeout_ms=dispatch_timeout_ms,
        )
        return await self.dispatch(request)

    def _resolve_binding(
        self,
        request: RendererDispatchRequest,
    ) -> ResolvedRendererBinding:
        try:
            return self._registry.resolve_request(request)
        except (RendererRegistryError, RendererAdapterExecutionError, RendererServiceError):
            raise
        except Exception as exc:  # pragma: no cover - safety net
            raise wrap_service_exception(
                exc,
                adapter_key=request.adapter_key_override,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
            ) from exc

    async def _dispatch_binding(
        self,
        binding: ResolvedRendererBinding,
    ) -> RendererDispatchResult:
        request = binding.resolved_request
        try:
            result = await binding.adapter.dispatch(request)
        except (RendererRegistryError, RendererAdapterExecutionError, RendererServiceError):
            raise
        except asyncio.CancelledError as exc:
            raise wrap_service_exception(
                exc,
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
            ) from exc
        except Exception as exc:
            raise wrap_service_exception(
                exc,
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
            ) from exc

        if self._config.require_dispatch_result and result is None:
            failure = build_no_result_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
            )
            raise_service_error(
                error_code=failure.error_code,
                message=failure.message,
                retryable=failure.retryable,
                adapter_key=failure.adapter_key,
                adapter_profile_key=failure.adapter_profile_key,
                command_id=failure.command_id,
                command_type=failure.command_type,
            )

        if not isinstance(result, RendererDispatchResult):
            failure = build_malformed_response_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
                message="renderer adapter dispatch() did not return a RendererDispatchResult",
            )
            raise_service_error(
                error_code=failure.error_code,
                message=failure.message,
                retryable=failure.retryable,
                adapter_key=failure.adapter_key,
                adapter_profile_key=failure.adapter_profile_key,
                command_id=failure.command_id,
                command_type=failure.command_type,
            )

        if self._config.validate_result_identity:
            self._validate_result_identity(
                request=request,
                result=result,
            )
        return result

    def _validate_result_identity(
        self,
        *,
        request: RendererResolvedDispatchRequest,
        result: RendererDispatchResult,
    ) -> None:
        if result.command_id != request.command_id:
            malformed = build_malformed_response_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
                message="renderer adapter returned a result with the wrong command_id",
            )
            raise_service_error(
                error_code=malformed.error_code,
                message=malformed.message,
                retryable=malformed.retryable,
                adapter_key=malformed.adapter_key,
                adapter_profile_key=malformed.adapter_profile_key,
                command_id=malformed.command_id,
                command_type=malformed.command_type,
            )

        if result.command_type != request.command_type:
            malformed = build_malformed_response_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
                message="renderer adapter returned a result with the wrong command_type",
            )
            raise_service_error(
                error_code=malformed.error_code,
                message=malformed.message,
                retryable=malformed.retryable,
                adapter_key=malformed.adapter_key,
                adapter_profile_key=malformed.adapter_profile_key,
                command_id=malformed.command_id,
                command_type=malformed.command_type,
            )

        if result.adapter_key != request.adapter_key:
            malformed = build_malformed_response_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
                message="renderer adapter returned a result for the wrong adapter_key",
            )
            raise_service_error(
                error_code=malformed.error_code,
                message=malformed.message,
                retryable=malformed.retryable,
                adapter_key=malformed.adapter_key,
                adapter_profile_key=malformed.adapter_profile_key,
                command_id=malformed.command_id,
                command_type=malformed.command_type,
            )

        if result.adapter_profile_key != request.adapter_profile_key:
            malformed = build_malformed_response_error(
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
                message="renderer adapter returned a result for the wrong adapter_profile_key",
            )
            raise_service_error(
                error_code=malformed.error_code,
                message=malformed.message,
                retryable=malformed.retryable,
                adapter_key=malformed.adapter_key,
                adapter_profile_key=malformed.adapter_profile_key,
                command_id=malformed.command_id,
                command_type=malformed.command_type,
            )


__all__ = [
    "RendererService",
    "RendererServiceConfig",
]
