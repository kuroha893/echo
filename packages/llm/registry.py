from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from pydantic import Field, field_validator, model_validator

from packages.llm.errors import build_registry_failure
from packages.llm.models import (
    LLMConversationInput,
    LLMGenerationConfig,
    LLMMessage,
    LLMMessageRole,
    LLMModel,
    LLMModelProfile,
    LLMProviderDescriptor,
    LLMProviderRequest,
    LLMRequestContext,
    LLMResolvedRoute,
    LLMRouteBinding,
    LLMRouteKind,
)
from packages.llm.provider_ports import (
    LLMProviderPort,
    ensure_provider_can_serve_route,
    ensure_provider_supports_one_shot,
    ensure_provider_supports_streaming,
    ensure_provider_supports_structured_intent_routing,
    ensure_provider_supports_tool_reasoning,
)


@dataclass(frozen=True)
class LLMRegistryResolution:
    """
    Concrete route/profile/provider resolution for a single provider call.
    """

    descriptor: LLMProviderDescriptor
    profile: LLMModelProfile
    binding: LLMRouteBinding | None
    provider: LLMProviderPort
    provider_request: LLMProviderRequest
    resolved_route: LLMResolvedRoute


class LLMProviderRegistryConfig(LLMModel):
    """
    Deterministic in-memory config for the first llm foundation layer.

    This is intentionally not a YAML or env-var schema. It simply lets tests and
    local wiring create explicit registry state without hidden globals.
    """

    providers: tuple[LLMProviderDescriptor, ...] = ()
    profiles: tuple[LLMModelProfile, ...] = ()
    route_bindings: tuple[LLMRouteBinding, ...] = ()

    @field_validator("providers", mode="before")
    @classmethod
    def normalize_providers(cls, value: object) -> tuple[LLMProviderDescriptor, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("profiles", mode="before")
    @classmethod
    def normalize_profiles(cls, value: object) -> tuple[LLMModelProfile, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("route_bindings", mode="before")
    @classmethod
    def normalize_route_bindings(cls, value: object) -> tuple[LLMRouteBinding, ...]:
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @model_validator(mode="after")
    def validate_unique_keys(self) -> "LLMProviderRegistryConfig":
        provider_keys = [provider.provider_key for provider in self.providers]
        if len(provider_keys) != len(set(provider_keys)):
            raise ValueError("providers must have unique provider_key values")

        profile_keys = [profile.profile_key for profile in self.profiles]
        if len(profile_keys) != len(set(profile_keys)):
            raise ValueError("profiles must have unique profile_key values")

        route_kinds = [binding.route_kind for binding in self.route_bindings]
        if len(route_kinds) != len(set(route_kinds)):
            raise ValueError("route_bindings must have unique route_kind values")

        known_provider_keys = set(provider_keys)
        for profile in self.profiles:
            if profile.provider_key not in known_provider_keys:
                raise ValueError(
                    f"profile '{profile.profile_key}' references unknown provider "
                    f"'{profile.provider_key}'"
                )

        known_profile_keys = set(profile_keys)
        for binding in self.route_bindings:
            if binding.profile_key not in known_profile_keys:
                raise ValueError(
                    f"route binding for '{binding.route_kind.value}' references "
                    f"unknown profile '{binding.profile_key}'"
                )
        return self


class LLMProviderRegistry:
    """
    Explicit provider/profile/route registry.

    Resolution rules stay conservative:
    - no hidden globals
    - no implicit provider creation
    - no silent provider override remapping
    - no fallback chains in v0.1
    """

    def __init__(self, config: LLMProviderRegistryConfig | None = None) -> None:
        self._provider_descriptors: dict[str, LLMProviderDescriptor] = {}
        self._providers: dict[str, LLMProviderPort] = {}
        self._profiles: dict[str, LLMModelProfile] = {}
        self._route_bindings: dict[LLMRouteKind, LLMRouteBinding] = {}

        if config is not None:
            self.apply_config(config)

    def apply_config(self, config: LLMProviderRegistryConfig) -> None:
        for descriptor in config.providers:
            self._provider_descriptors[descriptor.provider_key] = descriptor
        for profile in config.profiles:
            self._profiles[profile.profile_key] = profile
        for binding in config.route_bindings:
            self._route_bindings[binding.route_kind] = binding

    def register_provider(
        self,
        descriptor: LLMProviderDescriptor,
        provider: LLMProviderPort,
    ) -> None:
        if descriptor.provider_key in self._providers:
            raise build_registry_failure(
                message=f"provider '{descriptor.provider_key}' is already registered",
                provider_key=descriptor.provider_key,
            )
        if not isinstance(provider, LLMProviderPort):
            raise build_registry_failure(
                message=(
                    f"provider '{descriptor.provider_key}' does not satisfy "
                    "LLMProviderPort"
                ),
                provider_key=descriptor.provider_key,
            )
        self._provider_descriptors[descriptor.provider_key] = descriptor
        self._providers[descriptor.provider_key] = provider

    def register_profile(self, profile: LLMModelProfile) -> None:
        if profile.profile_key in self._profiles:
            raise build_registry_failure(
                message=f"profile '{profile.profile_key}' is already registered",
                provider_key=profile.provider_key,
                profile_key=profile.profile_key,
            )
        self._profiles[profile.profile_key] = profile

    def bind_route(self, binding: LLMRouteBinding) -> None:
        if binding.route_kind in self._route_bindings:
            raise build_registry_failure(
                message=(
                    f"route '{binding.route_kind.value}' is already bound to profile "
                    f"'{self._route_bindings[binding.route_kind].profile_key}'"
                ),
                profile_key=binding.profile_key,
            )
        self._route_bindings[binding.route_kind] = binding

    def has_provider(self, provider_key: str) -> bool:
        return provider_key in self._providers

    def has_profile(self, profile_key: str) -> bool:
        return profile_key in self._profiles

    def has_route_binding(self, route_kind: LLMRouteKind) -> bool:
        return route_kind in self._route_bindings

    def list_provider_descriptors(self) -> tuple[LLMProviderDescriptor, ...]:
        return tuple(self._provider_descriptors[key] for key in sorted(self._provider_descriptors))

    def list_profiles(self) -> tuple[LLMModelProfile, ...]:
        return tuple(self._profiles[key] for key in sorted(self._profiles))

    def list_route_bindings(self) -> tuple[LLMRouteBinding, ...]:
        return tuple(
            self._route_bindings[route]
            for route in sorted(self._route_bindings, key=lambda item: item.value)
        )

    def get_provider_descriptor(self, provider_key: str) -> LLMProviderDescriptor:
        try:
            return self._provider_descriptors[provider_key]
        except KeyError as exc:
            raise build_registry_failure(
                message=f"unknown provider '{provider_key}'",
                provider_key=provider_key,
            ) from exc

    def get_provider(self, provider_key: str) -> LLMProviderPort:
        try:
            return self._providers[provider_key]
        except KeyError as exc:
            raise build_registry_failure(
                message=f"provider '{provider_key}' is not registered",
                provider_key=provider_key,
            ) from exc

    def get_profile(self, profile_key: str) -> LLMModelProfile:
        try:
            return self._profiles[profile_key]
        except KeyError as exc:
            raise build_registry_failure(
                message=f"unknown profile '{profile_key}'",
                profile_key=profile_key,
            ) from exc

    def get_route_binding(self, route_kind: LLMRouteKind) -> LLMRouteBinding:
        try:
            return self._route_bindings[route_kind]
        except KeyError as exc:
            raise build_registry_failure(
                message=f"route '{route_kind.value}' has no bound profile",
            ) from exc

    def resolve_for_generate(self, conversation: LLMConversationInput) -> LLMRegistryResolution:
        resolution = self.resolve(conversation)
        ensure_provider_supports_one_shot(
            resolution.descriptor,
            provider_key=resolution.resolved_route.provider_key,
            profile_key=resolution.resolved_route.profile_key,
        )
        if conversation.context.route_kind == LLMRouteKind.INTENT_ROUTING:
            ensure_provider_supports_structured_intent_routing(
                resolution.descriptor,
                provider_key=resolution.resolved_route.provider_key,
                profile_key=resolution.resolved_route.profile_key,
            )
        return resolution

    def resolve_for_stream(self, conversation: LLMConversationInput) -> LLMRegistryResolution:
        resolution = self.resolve(conversation)
        ensure_provider_supports_streaming(
            resolution.descriptor,
            provider_key=resolution.resolved_route.provider_key,
            profile_key=resolution.resolved_route.profile_key,
        )
        return resolution

    def resolve(self, conversation: LLMConversationInput) -> LLMRegistryResolution:
        route_kind = conversation.context.route_kind
        binding = None
        profile_override_applied = conversation.provider_profile_key is not None
        provider_override_applied = conversation.provider_key_override is not None

        if conversation.provider_profile_key is not None:
            profile = self.get_profile(conversation.provider_profile_key)
        else:
            binding = self.get_route_binding(route_kind)
            profile = self.get_profile(binding.profile_key)

        provider_key = profile.provider_key
        if conversation.provider_key_override is not None:
            if conversation.provider_key_override != profile.provider_key:
                raise build_registry_failure(
                    message=(
                        "provider_key_override must match the selected profile's "
                        f"provider in v0.1; got override '{conversation.provider_key_override}' "
                        f"for profile '{profile.profile_key}' bound to '{profile.provider_key}'"
                    ),
                    provider_key=conversation.provider_key_override,
                    profile_key=profile.profile_key,
                )
            provider_key = conversation.provider_key_override

        descriptor = self.get_provider_descriptor(provider_key)
        provider = self.get_provider(provider_key)

        ensure_provider_can_serve_route(
            descriptor,
            route_kind,
            provider_key=provider_key,
            profile_key=profile.profile_key,
        )
        if route_kind == LLMRouteKind.PRIMARY_TOOL_REASONING:
            ensure_provider_supports_tool_reasoning(
                descriptor,
                provider_key=provider_key,
                profile_key=profile.profile_key,
            )

        effective_generation_config = self._resolve_effective_generation_config(
            request_config=conversation.generation_config,
            profile_default_config=profile.default_generation_config,
        )

        provider_request = LLMProviderRequest(
            provider_key=provider_key,
            profile_key=profile.profile_key,
            model_name=profile.model_name,
            conversation=conversation,
            effective_generation_config=effective_generation_config,
        )
        resolved_route = LLMResolvedRoute(
            route_kind=route_kind,
            provider_key=provider_key,
            profile_key=profile.profile_key,
            model_name=profile.model_name,
            effective_generation_config=effective_generation_config,
            profile_override_applied=profile_override_applied,
            provider_override_applied=provider_override_applied,
        )
        return LLMRegistryResolution(
            descriptor=descriptor,
            profile=profile,
            binding=binding,
            provider=provider,
            provider_request=provider_request,
            resolved_route=resolved_route,
        )

    def describe_route(
        self,
        route_kind: LLMRouteKind,
        *,
        profile_key: str | None = None,
        provider_key_override: str | None = None,
        generation_config: LLMGenerationConfig | None = None,
        context: LLMRequestContext | None = None,
    ) -> LLMResolvedRoute:
        """
        Caller-facing inspection helper for debugging route selection without
        invoking a provider.
        """

        if context is None:
            dummy_context = LLMRequestContext(
                session_id=uuid4(),
                trace_id=uuid4(),
                turn_id=uuid4(),
                route_kind=route_kind,
            )
        else:
            dummy_context = context.with_route_kind(route_kind)
        dummy_input = LLMConversationInput(
            context=dummy_context,
            messages=(LLMMessage(role=LLMMessageRole.USER, content="route inspection"),),
            generation_config=generation_config or LLMGenerationConfig(max_output_tokens=1, timeout_ms=1),
            provider_profile_key=profile_key,
            provider_key_override=provider_key_override,
        )
        return self.resolve(dummy_input).resolved_route

    @staticmethod
    def _resolve_effective_generation_config(
        *,
        request_config: LLMGenerationConfig,
        profile_default_config: LLMGenerationConfig,
    ) -> LLMGenerationConfig:
        return request_config.overlay_defaults(profile_default_config)


__all__ = [
    "LLMProviderRegistry",
    "LLMProviderRegistryConfig",
    "LLMRegistryResolution",
]
