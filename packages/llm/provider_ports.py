from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from packages.llm.errors import build_unsupported_capability_failure
from packages.llm.models import (
    LLMOneShotOutput,
    LLMProviderDescriptor,
    LLMProviderRequest,
    LLMRouteKind,
    LLMStreamOutput,
)


@runtime_checkable
class LLMProviderPort(Protocol):
    """
    Unified provider boundary for one-shot, streaming, and capability inspection.
    """

    async def inspect_capabilities(self) -> LLMProviderDescriptor:
        ...

    async def generate(self, request: LLMProviderRequest) -> LLMOneShotOutput:
        ...

    async def stream(self, request: LLMProviderRequest) -> AsyncIterator[LLMStreamOutput]:
        ...


def provider_supports_route(
    descriptor: LLMProviderDescriptor,
    route_kind: LLMRouteKind,
) -> bool:
    return route_kind in descriptor.allowed_routes


def provider_supports_one_shot(descriptor: LLMProviderDescriptor) -> bool:
    return descriptor.supports_one_shot


def provider_supports_streaming(descriptor: LLMProviderDescriptor) -> bool:
    return descriptor.supports_streaming


def provider_supports_tool_reasoning(descriptor: LLMProviderDescriptor) -> bool:
    return descriptor.supports_tool_reasoning


def provider_supports_structured_intent_routing(
    descriptor: LLMProviderDescriptor,
) -> bool:
    return descriptor.supports_structured_intent_routing


def ensure_provider_can_serve_route(
    descriptor: LLMProviderDescriptor,
    route_kind: LLMRouteKind,
    *,
    provider_key: str,
    profile_key: str,
) -> None:
    if provider_supports_route(descriptor, route_kind):
        return
    raise build_unsupported_capability_failure(
        message=(
            f"provider '{provider_key}' is not allowed to serve route "
            f"'{route_kind.value}'"
        ),
        provider_key=provider_key,
        profile_key=profile_key,
    )


def ensure_provider_supports_one_shot(
    descriptor: LLMProviderDescriptor,
    *,
    provider_key: str,
    profile_key: str,
) -> None:
    if provider_supports_one_shot(descriptor):
        return
    raise build_unsupported_capability_failure(
        message=f"provider '{provider_key}' does not support one-shot generation",
        provider_key=provider_key,
        profile_key=profile_key,
    )


def ensure_provider_supports_streaming(
    descriptor: LLMProviderDescriptor,
    *,
    provider_key: str,
    profile_key: str,
) -> None:
    if provider_supports_streaming(descriptor):
        return
    raise build_unsupported_capability_failure(
        message=f"provider '{provider_key}' does not support streaming generation",
        provider_key=provider_key,
        profile_key=profile_key,
    )


def ensure_provider_supports_tool_reasoning(
    descriptor: LLMProviderDescriptor,
    *,
    provider_key: str,
    profile_key: str,
) -> None:
    if provider_supports_tool_reasoning(descriptor):
        return
    raise build_unsupported_capability_failure(
        message=f"provider '{provider_key}' does not support tool-aware reasoning",
        provider_key=provider_key,
        profile_key=profile_key,
    )


def ensure_provider_supports_structured_intent_routing(
    descriptor: LLMProviderDescriptor,
    *,
    provider_key: str,
    profile_key: str,
) -> None:
    if provider_supports_structured_intent_routing(descriptor):
        return
    raise build_unsupported_capability_failure(
        message=(
            f"provider '{provider_key}' does not support structured hidden intent "
            "routing output"
        ),
        provider_key=provider_key,
        profile_key=profile_key,
    )


__all__ = [
    "LLMProviderPort",
    "ensure_provider_can_serve_route",
    "ensure_provider_supports_one_shot",
    "ensure_provider_supports_streaming",
    "ensure_provider_supports_structured_intent_routing",
    "ensure_provider_supports_tool_reasoning",
    "provider_supports_one_shot",
    "provider_supports_route",
    "provider_supports_streaming",
    "provider_supports_structured_intent_routing",
    "provider_supports_tool_reasoning",
]
