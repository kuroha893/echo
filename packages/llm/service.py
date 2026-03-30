from __future__ import annotations
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field

from packages.llm.errors import (
    LLMProviderFailure,
    build_malformed_response_failure,
    normalize_provider_exception,
)
from packages.llm.models import (
    LLMCompletion,
    LLMConversationInput,
    LLMGenerationConfig,
    LLMIntentRouteDecision,
    LLMMessage,
    LLMModel,
    LLMOneShotOutput,
    LLMRequestContext,
    LLMResolvedRoute,
    LLMRouteKind,
    LLMStreamOutput,
    LLMTextDelta,
    LLMToolCallIntent,
)
from packages.llm.registry import LLMProviderRegistry, LLMRegistryResolution


@dataclass
class _ValidatedStreamState:
    route_kind: LLMRouteKind
    provider_key: str
    profile_key: str
    next_delta_index: int = 0
    text_parts: list[str] = field(default_factory=list)
    completion_seen: bool = False


class LLMServiceConfig(LLMModel):
    """
    Small service-local validation policy.

    This is intentionally not a provider transport config surface. Its purpose
    is only to lock deterministic llm-local behavior.
    """

    validate_stream_delta_indexes: bool = True
    require_terminal_completion: bool = True
    validate_stream_text_concatenation: bool = True
    reject_tool_intents_outside_tool_route: bool = True


class LLMService:
    """
    Caller-facing llm service facade.

    The service is route-driven: callers ask for quick reaction or primary
    response behavior, and the service delegates provider/profile selection to
    the explicit registry.
    """

    def __init__(
        self,
        registry: LLMProviderRegistry,
        config: LLMServiceConfig | None = None,
    ) -> None:
        self._registry = registry
        self._config = config or LLMServiceConfig()

    def get_registry(self) -> LLMProviderRegistry:
        return self._registry

    def inspect_route(self, request: LLMConversationInput) -> LLMResolvedRoute:
        return self._registry.resolve(request).resolved_route

    def build_conversation_input(
        self,
        *,
        route_kind: LLMRouteKind,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> LLMConversationInput:
        return LLMConversationInput(
            context=context.with_route_kind(route_kind),
            messages=tuple(messages),
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )

    async def generate(self, request: LLMConversationInput) -> LLMOneShotOutput:
        resolution = self._registry.resolve_for_generate(request)
        return await self._generate_resolved(resolution)

    async def stream(self, request: LLMConversationInput) -> AsyncIterator[LLMStreamOutput]:
        resolution = self._registry.resolve_for_stream(request)
        async for item in self._stream_resolved(resolution):
            yield item

    async def generate_for_route(
        self,
        route_kind: LLMRouteKind,
        *,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> LLMOneShotOutput:
        request = self.build_conversation_input(
            route_kind=route_kind,
            context=context,
            messages=messages,
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )
        return await self.generate(request)

    async def stream_for_route(
        self,
        route_kind: LLMRouteKind,
        *,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> AsyncIterator[LLMStreamOutput]:
        request = self.build_conversation_input(
            route_kind=route_kind,
            context=context,
            messages=messages,
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )
        async for item in self.stream(request):
            yield item

    async def generate_quick_reaction(
        self,
        *,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> LLMCompletion:
        output = await self.generate_for_route(
            LLMRouteKind.QUICK_REACTION,
            context=context,
            messages=messages,
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )
        if not isinstance(output, LLMCompletion):
            raise build_malformed_response_failure(
                message="llm service expected LLMCompletion for 'quick_reaction'",
            )
        return output

    async def decide_intent_route(
        self,
        *,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> LLMIntentRouteDecision:
        output = await self.generate_for_route(
            LLMRouteKind.INTENT_ROUTING,
            context=context,
            messages=messages,
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )
        if not isinstance(output, LLMIntentRouteDecision):
            raise build_malformed_response_failure(
                message=(
                    "llm service expected LLMIntentRouteDecision for "
                    "'intent_routing'"
                ),
            )
        return output

    async def generate_ambient_presence(
        self,
        *,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> LLMCompletion:
        output = await self.generate_for_route(
            LLMRouteKind.AMBIENT_PRESENCE,
            context=context,
            messages=messages,
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        )
        if not isinstance(output, LLMCompletion):
            raise build_malformed_response_failure(
                message=(
                    "llm service expected LLMCompletion for 'ambient_presence'"
                ),
            )
        return output

    async def stream_primary_response(
        self,
        *,
        context: LLMRequestContext,
        messages: Sequence[LLMMessage],
        generation_config: LLMGenerationConfig,
        system_instructions: str | None = None,
        developer_instructions: str | None = None,
        provider_profile_key: str | None = None,
        provider_key_override: str | None = None,
    ) -> AsyncIterator[LLMStreamOutput]:
        async for item in self.stream_for_route(
            LLMRouteKind.PRIMARY_RESPONSE,
            context=context,
            messages=messages,
            generation_config=generation_config,
            system_instructions=system_instructions,
            developer_instructions=developer_instructions,
            provider_profile_key=provider_profile_key,
            provider_key_override=provider_key_override,
        ):
            yield item

    async def _generate_resolved(
        self,
        resolution: LLMRegistryResolution,
    ) -> LLMOneShotOutput:
        try:
            output = await resolution.provider.generate(resolution.provider_request)
        except BaseException as exc:
            raise normalize_provider_exception(
                exc,
                provider_key=resolution.resolved_route.provider_key,
                profile_key=resolution.resolved_route.profile_key,
            ) from exc
        self._validate_one_shot_output_object(
            output,
            route_kind=resolution.provider_request.route_kind,
            provider_key=resolution.resolved_route.provider_key,
            profile_key=resolution.resolved_route.profile_key,
        )
        return output

    async def _stream_resolved(
        self,
        resolution: LLMRegistryResolution,
    ) -> AsyncIterator[LLMStreamOutput]:
        provider_key = resolution.resolved_route.provider_key
        profile_key = resolution.resolved_route.profile_key
        state = _ValidatedStreamState(
            route_kind=resolution.provider_request.route_kind,
            provider_key=provider_key,
            profile_key=profile_key,
        )

        try:
            async for item in resolution.provider.stream(resolution.provider_request):
                if isinstance(item, LLMTextDelta):
                    self._validate_text_delta(item, state)
                    state.text_parts.append(item.text)
                    state.next_delta_index += 1
                    yield item
                    continue

                if isinstance(item, LLMToolCallIntent):
                    self._validate_tool_call_intent(item, state)
                    yield item
                    continue

                if isinstance(item, LLMCompletion):
                    if state.completion_seen:
                        raise build_malformed_response_failure(
                            message="provider stream emitted more than one terminal completion",
                            provider_key=provider_key,
                            profile_key=profile_key,
                            raw_error_type="DuplicateStreamCompletion",
                        )
                    self._validate_stream_completion(item, state)
                    state.completion_seen = True
                    yield item
                    continue

                raise build_malformed_response_failure(
                    message="provider stream yielded an unknown output item",
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type=type(item).__name__,
                )

            if self._config.require_terminal_completion and not state.completion_seen:
                raise build_malformed_response_failure(
                    message="provider stream ended without a terminal completion",
                    provider_key=provider_key,
                    profile_key=profile_key,
                    raw_error_type="MissingStreamCompletion",
                )
        except BaseException as exc:
            if isinstance(exc, LLMProviderFailure):
                raise
            raise normalize_provider_exception(
                exc,
                provider_key=provider_key,
                profile_key=profile_key,
            ) from exc

    def _validate_one_shot_output_object(
        self,
        output: object,
        *,
        route_kind: LLMRouteKind,
        provider_key: str,
        profile_key: str,
    ) -> None:
        if route_kind == LLMRouteKind.INTENT_ROUTING:
            self._validate_intent_routing_output(
                output,
                provider_key=provider_key,
                profile_key=profile_key,
            )
            return
        self._validate_visible_one_shot_output(
            output,
            route_kind=route_kind,
            provider_key=provider_key,
            profile_key=profile_key,
        )

    def _validate_intent_routing_output(
        self,
        output: object,
        *,
        provider_key: str,
        profile_key: str,
    ) -> None:
        if isinstance(output, LLMIntentRouteDecision):
            return
        raise build_malformed_response_failure(
            message=(
                "provider one-shot generation for 'intent_routing' did not return "
                "LLMIntentRouteDecision"
            ),
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=type(output).__name__,
        )

    def _validate_visible_one_shot_output(
        self,
        output: object,
        *,
        route_kind: LLMRouteKind,
        provider_key: str,
        profile_key: str,
    ) -> None:
        if isinstance(output, LLMCompletion):
            return
        expected = "LLMCompletion"
        if route_kind == LLMRouteKind.AMBIENT_PRESENCE:
            message = (
                "provider one-shot generation for 'ambient_presence' did not return "
                f"{expected}"
            )
        else:
            message = (
                f"provider one-shot generation for '{route_kind.value}' did not return "
                f"{expected}"
            )
        raise build_malformed_response_failure(
            message=message,
            provider_key=provider_key,
            profile_key=profile_key,
            raw_error_type=type(output).__name__,
        )

    def _validate_text_delta(
        self,
        item: LLMTextDelta,
        state: _ValidatedStreamState,
    ) -> None:
        if state.completion_seen:
            raise build_malformed_response_failure(
                message="provider stream yielded text after terminal completion",
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="LateTextDelta",
            )
        if not self._config.validate_stream_delta_indexes:
            return
        if item.delta_index != state.next_delta_index:
            raise build_malformed_response_failure(
                message=(
                    f"provider stream delta_index {item.delta_index} did not match "
                    f"expected index {state.next_delta_index}"
                ),
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="DeltaOrderingError",
            )

    def _validate_tool_call_intent(
        self,
        item: LLMToolCallIntent,
        state: _ValidatedStreamState,
    ) -> None:
        del item
        if state.completion_seen:
            raise build_malformed_response_failure(
                message="provider stream yielded a tool intent after terminal completion",
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="LateToolIntent",
            )
        if (
            self._config.reject_tool_intents_outside_tool_route
            and state.route_kind != LLMRouteKind.PRIMARY_TOOL_REASONING
        ):
            raise build_malformed_response_failure(
                message=(
                    "tool-call intents are reserved for the "
                    "'primary_tool_reasoning' route"
                ),
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="UnexpectedToolIntent",
            )

    def _validate_stream_completion(
        self,
        completion: LLMCompletion,
        state: _ValidatedStreamState,
    ) -> None:
        if state.completion_seen:
            raise build_malformed_response_failure(
                message="provider stream yielded a duplicate terminal completion",
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="DuplicateStreamCompletion",
            )
        if not self._config.validate_stream_text_concatenation:
            return
        expected_output = "".join(state.text_parts)
        if completion.output_text != expected_output:
            raise build_malformed_response_failure(
                message=(
                    "provider completion output_text did not equal the exact "
                    "concatenation of streamed text deltas"
                ),
                provider_key=state.provider_key,
                profile_key=state.profile_key,
                raw_error_type="CompletionTextMismatch",
            )


__all__ = [
    "LLMService",
    "LLMServiceConfig",
]
