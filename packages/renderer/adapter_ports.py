from __future__ import annotations

from typing import Protocol, runtime_checkable

from packages.renderer.errors import (
    build_unsupported_command_error,
    build_unsupported_target_error,
    raise_adapter_error,
)
from packages.renderer.models import (
    RendererAdapterCapabilities,
    RendererAdapterDescriptor,
    RendererAdapterErrorCode,
    RendererAdapterProfile,
    RendererDispatchResult,
    RendererResolvedDispatchRequest,
)


@runtime_checkable
class RendererAdapterPort(Protocol):
    @property
    def adapter_key(self) -> str: ...

    def get_descriptor(self) -> RendererAdapterDescriptor: ...

    def get_capabilities(self) -> RendererAdapterCapabilities: ...

    async def dispatch(
        self,
        request: RendererResolvedDispatchRequest,
    ) -> RendererDispatchResult: ...


def ensure_descriptor_matches_capabilities(
    descriptor: RendererAdapterDescriptor,
    capabilities: RendererAdapterCapabilities,
) -> None:
    if descriptor.adapter_key != capabilities.adapter_key:
        raise_adapter_error(
            error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
            message=(
                "renderer adapter capabilities adapter_key does not match the descriptor"
            ),
            retryable=False,
            adapter_key=descriptor.adapter_key,
        )


def ensure_profile_matches_adapter(
    *,
    adapter_key: str,
    profile: RendererAdapterProfile | None,
) -> None:
    if profile is None:
        return
    if profile.adapter_key != adapter_key:
        raise_adapter_error(
            error_code=RendererAdapterErrorCode.ADAPTER_PROFILE_MISMATCH,
            message="renderer adapter profile does not belong to the resolved adapter",
            retryable=False,
            adapter_key=adapter_key,
            adapter_profile_key=profile.adapter_profile_key,
        )


def validate_request_against_capabilities(
    request: RendererResolvedDispatchRequest,
) -> None:
    command = request.command
    capabilities = request.adapter_capabilities
    profile = request.adapter_profile

    ensure_descriptor_matches_capabilities(
        request.adapter_descriptor,
        capabilities,
    )
    ensure_profile_matches_adapter(
        adapter_key=request.adapter_key,
        profile=profile,
    )

    if not capabilities.supports_command_type(command.command_type):
        unsupported_command = build_unsupported_command_error(
            adapter_key=request.adapter_key,
            adapter_profile_key=request.adapter_profile_key,
            command_id=command.command_id,
            command_type=command.command_type,
        )
        raise_adapter_error(
            error_code=unsupported_command.error_code,
            message=unsupported_command.message,
            retryable=False,
            adapter_key=unsupported_command.adapter_key,
            adapter_profile_key=unsupported_command.adapter_profile_key,
            command_id=unsupported_command.command_id,
            command_type=unsupported_command.command_type,
        )

    if profile is not None and not profile.supports_command_type(command.command_type):
        raise_adapter_error(
            error_code=RendererAdapterErrorCode.UNSUPPORTED_COMMAND,
            message=(
                f"renderer adapter profile '{profile.adapter_profile_key}' does not "
                f"allow command '{command.command_type.value}'"
            ),
            retryable=False,
            adapter_key=request.adapter_key,
            adapter_profile_key=profile.adapter_profile_key,
            command_id=command.command_id,
            command_type=command.command_type,
        )

    if not capabilities.allows_target(command.target):
        unsupported_target = build_unsupported_target_error(
            adapter_key=request.adapter_key,
            adapter_profile_key=request.adapter_profile_key,
            command_id=command.command_id,
            command_type=command.command_type,
            message=(
                f"renderer adapter '{request.adapter_key}' does not allow target "
                f"'{command.target}'"
            ),
        )
        raise_adapter_error(
            error_code=unsupported_target.error_code,
            message=unsupported_target.message,
            retryable=False,
            adapter_key=unsupported_target.adapter_key,
            adapter_profile_key=unsupported_target.adapter_profile_key,
            command_id=unsupported_target.command_id,
            command_type=unsupported_target.command_type,
        )

    if profile is not None and not profile.allows_target(command.target):
        unsupported_target = build_unsupported_target_error(
            adapter_key=request.adapter_key,
            adapter_profile_key=profile.adapter_profile_key,
            command_id=command.command_id,
            command_type=command.command_type,
            message=(
                f"renderer adapter profile '{profile.adapter_profile_key}' does not "
                f"allow target '{command.target}'"
            ),
        )
        raise_adapter_error(
            error_code=unsupported_target.error_code,
            message=unsupported_target.message,
            retryable=False,
            adapter_key=unsupported_target.adapter_key,
            adapter_profile_key=unsupported_target.adapter_profile_key,
            command_id=unsupported_target.command_id,
            command_type=unsupported_target.command_type,
        )


__all__ = [
    "RendererAdapterPort",
    "ensure_descriptor_matches_capabilities",
    "ensure_profile_matches_adapter",
    "validate_request_against_capabilities",
]
