from __future__ import annotations

from dataclasses import dataclass

from packages.protocol.events import RendererCommand
from packages.renderer.adapter_ports import RendererAdapterPort, validate_request_against_capabilities
from packages.renderer.errors import raise_registry_error
from packages.renderer.models import (
    RendererAdapterCapabilities,
    RendererAdapterDescriptor,
    RendererAdapterErrorCode,
    RendererAdapterProfile,
    RendererDispatchRequest,
    RendererResolvedDispatchRequest,
)


@dataclass(frozen=True, slots=True)
class ResolvedRendererBinding:
    adapter: RendererAdapterPort
    resolved_request: RendererResolvedDispatchRequest

    @property
    def adapter_descriptor(self) -> RendererAdapterDescriptor:
        return self.resolved_request.adapter_descriptor

    @property
    def adapter_capabilities(self) -> RendererAdapterCapabilities:
        return self.resolved_request.adapter_capabilities

    @property
    def adapter_profile(self) -> RendererAdapterProfile | None:
        return self.resolved_request.adapter_profile


class RendererRegistry:
    def __init__(
        self,
        *,
        adapters: tuple[RendererAdapterPort, ...] = (),
        adapter_profiles: tuple[RendererAdapterProfile, ...] = (),
    ) -> None:
        self._adapters: dict[str, RendererAdapterPort] = {}
        self._descriptors: dict[str, RendererAdapterDescriptor] = {}
        self._capabilities: dict[str, RendererAdapterCapabilities] = {}
        self._adapter_profiles: dict[str, RendererAdapterProfile] = {}

        for adapter in adapters:
            self.register_adapter(adapter)
        for adapter_profile in adapter_profiles:
            self.register_adapter_profile(adapter_profile)

    def register_adapter(self, adapter: RendererAdapterPort) -> None:
        if not isinstance(adapter, RendererAdapterPort):
            raise TypeError("adapter must implement RendererAdapterPort")

        descriptor = adapter.get_descriptor()
        capabilities = adapter.get_capabilities()
        adapter_key = descriptor.adapter_key

        if adapter_key in self._adapters:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.DUPLICATE_ADAPTER,
                message=f"renderer adapter '{adapter_key}' is already registered",
                adapter_key=adapter_key,
            )
        if capabilities.adapter_key != adapter_key or adapter.adapter_key != adapter_key:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
                message="renderer adapter descriptor/capabilities/adapter_key are misaligned",
                adapter_key=adapter_key,
            )

        self._adapters[adapter_key] = adapter
        self._descriptors[adapter_key] = descriptor
        self._capabilities[adapter_key] = capabilities

    def register_adapter_profile(self, adapter_profile: RendererAdapterProfile) -> None:
        key = adapter_profile.adapter_profile_key
        if key in self._adapter_profiles:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.DUPLICATE_ADAPTER_PROFILE,
                message=f"renderer adapter profile '{key}' is already registered",
                adapter_key=adapter_profile.adapter_key,
                adapter_profile_key=key,
            )
        self._adapter_profiles[key] = adapter_profile

    def get_adapter(self, adapter_key: str) -> RendererAdapterPort:
        adapter = self._adapters.get(adapter_key)
        if adapter is None:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.UNKNOWN_ADAPTER,
                message=f"renderer adapter '{adapter_key}' is not registered",
                adapter_key=adapter_key,
            )
        return adapter

    def get_adapter_descriptor(self, adapter_key: str) -> RendererAdapterDescriptor:
        self.get_adapter(adapter_key)
        return self._descriptors[adapter_key]

    def get_adapter_capabilities(self, adapter_key: str) -> RendererAdapterCapabilities:
        self.get_adapter(adapter_key)
        return self._capabilities[adapter_key]

    def get_adapter_profile(self, adapter_profile_key: str) -> RendererAdapterProfile:
        adapter_profile = self._adapter_profiles.get(adapter_profile_key)
        if adapter_profile is None:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.UNKNOWN_ADAPTER_PROFILE,
                message=f"renderer adapter profile '{adapter_profile_key}' is not registered",
                adapter_profile_key=adapter_profile_key,
            )
        return adapter_profile

    def list_adapter_keys(self) -> tuple[str, ...]:
        return tuple(sorted(self._adapters))

    def list_adapter_profile_keys(self) -> tuple[str, ...]:
        return tuple(sorted(self._adapter_profiles))

    def build_request(
        self,
        *,
        command: RendererCommand,
        adapter_profile_key: str | None = None,
        adapter_key_override: str | None = None,
        dispatch_timeout_ms: int | None = None,
    ) -> RendererDispatchRequest:
        return RendererDispatchRequest(
            command=command,
            adapter_profile_key=adapter_profile_key,
            adapter_key_override=adapter_key_override,
            dispatch_timeout_ms=dispatch_timeout_ms,
        )

    def resolve_request(
        self,
        request: RendererDispatchRequest,
    ) -> ResolvedRendererBinding:
        adapter_profile = None
        adapter_key: str | None = None

        if request.adapter_profile_key is not None:
            adapter_profile = self.get_adapter_profile(request.adapter_profile_key)
            adapter_key = adapter_profile.adapter_key

        if request.adapter_key_override is not None:
            if adapter_key is not None and request.adapter_key_override != adapter_key:
                raise_registry_error(
                    error_code=RendererAdapterErrorCode.ADAPTER_PROFILE_MISMATCH,
                    message="adapter_profile_key does not belong to adapter_key_override",
                    adapter_key=request.adapter_key_override,
                    adapter_profile_key=request.adapter_profile_key,
                    command_id=request.command_id,
                    command_type=request.command_type,
                )
            adapter_key = request.adapter_key_override

        if adapter_key is None:
            adapter_key, adapter_profile = self._resolve_implicit_binding()
        else:
            adapter_profile = adapter_profile or self._resolve_default_profile_for_adapter(
                adapter_key
            )

        adapter = self.get_adapter(adapter_key)
        descriptor = self.get_adapter_descriptor(adapter_key)
        capabilities = self.get_adapter_capabilities(adapter_key)
        effective_timeout_ms = request.dispatch_timeout_ms
        if effective_timeout_ms is None and adapter_profile is not None:
            effective_timeout_ms = adapter_profile.default_dispatch_timeout_ms

        resolved_request = RendererResolvedDispatchRequest(
            dispatch_request=request,
            adapter_descriptor=descriptor,
            adapter_capabilities=capabilities,
            adapter_profile=adapter_profile,
            effective_dispatch_timeout_ms=effective_timeout_ms,
        )
        validate_request_against_capabilities(resolved_request)
        return ResolvedRendererBinding(
            adapter=adapter,
            resolved_request=resolved_request,
        )

    def _resolve_implicit_binding(self) -> tuple[str, RendererAdapterProfile | None]:
        global_default_profiles = [
            profile
            for profile in self._adapter_profiles.values()
            if profile.is_default
        ]
        if len(global_default_profiles) > 1:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
                message="multiple default renderer adapter profiles are registered",
            )
        if len(global_default_profiles) == 1:
            profile = global_default_profiles[0]
            return profile.adapter_key, profile

        if len(self._adapter_profiles) == 1:
            profile = next(iter(self._adapter_profiles.values()))
            return profile.adapter_key, profile

        if len(self._adapters) == 1:
            adapter_key = next(iter(self._adapters))
            return adapter_key, self._resolve_default_profile_for_adapter(adapter_key)

        raise_registry_error(
            error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
            message=(
                "renderer dispatch requires an explicit adapter_profile_key or "
                "adapter_key_override when the registry has multiple choices"
            ),
        )

    def _resolve_default_profile_for_adapter(
        self,
        adapter_key: str,
    ) -> RendererAdapterProfile | None:
        profiles_for_adapter = [
            profile
            for profile in self._adapter_profiles.values()
            if profile.adapter_key == adapter_key
        ]
        default_profiles = [profile for profile in profiles_for_adapter if profile.is_default]
        if len(default_profiles) > 1:
            raise_registry_error(
                error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
                message=f"renderer adapter '{adapter_key}' has multiple default profiles",
                adapter_key=adapter_key,
            )
        if len(default_profiles) == 1:
            return default_profiles[0]
        if len(profiles_for_adapter) == 1:
            return profiles_for_adapter[0]
        return None


__all__ = [
    "RendererRegistry",
    "ResolvedRendererBinding",
]
