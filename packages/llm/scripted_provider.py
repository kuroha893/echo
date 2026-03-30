from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from enum import Enum

from pydantic import Field, field_validator, model_validator

from packages.llm.errors import build_registry_failure, provider_failure_from_error
from packages.llm.models import (
    LLMCompletion,
    LLMIntentRouteDecision,
    LLMModel,
    LLMOneShotOutput,
    LLMProviderDescriptor,
    LLMProviderError,
    LLMProviderRequest,
    LLMRouteKind,
    LLMStreamOutput,
    LLMTextDelta,
    LLMToolCallIntent,
)
from packages.llm.provider_ports import LLMProviderPort


class ScriptedProviderCallMode(str, Enum):
    ONE_SHOT = "one_shot"
    STREAM = "stream"


class ScriptedProviderMatch(LLMModel):
    """
    Narrow request matcher for deterministic plan selection.

    Matching remains intentionally simple and explicit. This is a local dev/test
    provider, not a hidden prompt interpreter.
    """

    route_kind: LLMRouteKind | None = None
    request_id: str | None = Field(default=None, max_length=64)
    profile_key: str | None = Field(default=None, max_length=128)
    provider_key: str | None = Field(default=None, max_length=128)

    @field_validator("request_id")
    @classmethod
    def normalize_request_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("request_id matcher must not be blank")
        return cleaned

    @field_validator("profile_key")
    @classmethod
    def normalize_profile_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower()

    @field_validator("provider_key")
    @classmethod
    def normalize_provider_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower()

    def matches(self, request: LLMProviderRequest) -> bool:
        if self.route_kind is not None and self.route_kind != request.route_kind:
            return False
        if self.request_id is not None and self.request_id != str(request.request_id):
            return False
        if self.profile_key is not None and self.profile_key != request.profile_key:
            return False
        if self.provider_key is not None and self.provider_key != request.provider_key:
            return False
        return True


class ScriptedOneShotPlan(LLMModel):
    plan_key: str | None = Field(default=None, max_length=128)
    match: ScriptedProviderMatch = Field(default_factory=ScriptedProviderMatch)
    completion: LLMCompletion | None = None
    intent_route_decision: LLMIntentRouteDecision | None = None
    error: LLMProviderError | None = None

    @field_validator("plan_key")
    @classmethod
    def normalize_plan_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("plan_key must not be blank")
        return cleaned

    @model_validator(mode="after")
    def validate_terminal_outcome(self) -> "ScriptedOneShotPlan":
        populated_outcomes = sum(
            candidate is not None
            for candidate in (
                self.completion,
                self.intent_route_decision,
                self.error,
            )
        )
        if populated_outcomes != 1:
            raise ValueError(
                "one-shot plan requires exactly one of completion, "
                "intent_route_decision, or error"
            )
        return self


class ScriptedStreamPlan(LLMModel):
    plan_key: str | None = Field(default=None, max_length=128)
    match: ScriptedProviderMatch = Field(default_factory=ScriptedProviderMatch)
    outputs: tuple[LLMTextDelta | LLMToolCallIntent, ...] = ()
    completion: LLMCompletion | None = None
    error: LLMProviderError | None = None

    @field_validator("plan_key")
    @classmethod
    def normalize_plan_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("plan_key must not be blank")
        return cleaned

    @field_validator("outputs", mode="before")
    @classmethod
    def normalize_outputs(
        cls,
        value: object,
    ) -> tuple[LLMTextDelta | LLMToolCallIntent, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @model_validator(mode="after")
    def validate_terminal_outcome(self) -> "ScriptedStreamPlan":
        if (self.completion is None) == (self.error is None):
            raise ValueError("stream plan requires exactly one of completion or error")
        return self


class ScriptedProviderConfig(LLMModel):
    """
    Deterministic scripted provider configuration.
    """

    descriptor: LLMProviderDescriptor
    one_shot_plans: tuple[ScriptedOneShotPlan, ...] = ()
    stream_plans: tuple[ScriptedStreamPlan, ...] = ()

    @field_validator("one_shot_plans", mode="before")
    @classmethod
    def normalize_one_shot_plans(cls, value: object) -> tuple[ScriptedOneShotPlan, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @field_validator("stream_plans", mode="before")
    @classmethod
    def normalize_stream_plans(cls, value: object) -> tuple[ScriptedStreamPlan, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]


class ScriptedProviderCallRecord(LLMModel):
    call_index: int = Field(ge=0)
    mode: ScriptedProviderCallMode
    provider_key: str = Field(min_length=1, max_length=128)
    profile_key: str = Field(min_length=1, max_length=128)
    model_name: str = Field(min_length=1, max_length=128)
    route_kind: LLMRouteKind
    request_id: str = Field(min_length=1, max_length=64)
    message_count: int = Field(ge=0)
    emitted_items: int = Field(ge=0)


class ScriptedProvider(LLMProviderPort):
    """
    Deterministic provider implementation for tests and local development.

    It never performs network I/O. Every request is served only from explicit,
    preconfigured plans. This keeps test behavior honest and replayable.
    """

    def __init__(self, config: ScriptedProviderConfig) -> None:
        self._descriptor = config.descriptor
        self._one_shot_plans = list(config.one_shot_plans)
        self._stream_plans = list(config.stream_plans)
        self._history: list[ScriptedProviderCallRecord] = []
        self._call_index = 0

    async def inspect_capabilities(self) -> LLMProviderDescriptor:
        return self._descriptor

    def get_history(self) -> tuple[ScriptedProviderCallRecord, ...]:
        return tuple(self._history)

    def reset_history(self) -> None:
        self._history.clear()
        self._call_index = 0

    def remaining_one_shot_plans(self) -> int:
        return len(self._one_shot_plans)

    def remaining_stream_plans(self) -> int:
        return len(self._stream_plans)

    async def generate(self, request: LLMProviderRequest) -> LLMOneShotOutput:
        self._ensure_provider_key(request)
        plan = self._pop_matching_one_shot_plan(request)
        self._record_call(
            mode=ScriptedProviderCallMode.ONE_SHOT,
            request=request,
            emitted_items=1 if plan.error is None else 0,
        )
        if plan.error is not None:
            raise provider_failure_from_error(plan.error)
        if plan.intent_route_decision is not None:
            return plan.intent_route_decision
        assert plan.completion is not None
        return plan.completion

    async def stream(self, request: LLMProviderRequest) -> AsyncIterator[LLMStreamOutput]:
        self._ensure_provider_key(request)
        plan = self._pop_matching_stream_plan(request)
        self._record_call(
            mode=ScriptedProviderCallMode.STREAM,
            request=request,
            emitted_items=len(plan.outputs) + (1 if plan.completion is not None else 0),
        )

        for item in plan.outputs:
            yield item
            await asyncio.sleep(0)

        if plan.error is not None:
            raise provider_failure_from_error(plan.error)

        assert plan.completion is not None
        yield plan.completion

    def _ensure_provider_key(self, request: LLMProviderRequest) -> None:
        if request.provider_key != self._descriptor.provider_key:
            raise build_registry_failure(
                message=(
                    f"scripted provider '{self._descriptor.provider_key}' cannot serve "
                    f"request resolved for provider '{request.provider_key}'"
                ),
                provider_key=request.provider_key,
                profile_key=request.profile_key,
            )

    def _pop_matching_one_shot_plan(self, request: LLMProviderRequest) -> ScriptedOneShotPlan:
        for index, plan in enumerate(self._one_shot_plans):
            if plan.match.matches(request):
                return self._one_shot_plans.pop(index)
        raise build_registry_failure(
            message=(
                "no scripted one-shot plan matched request "
                f"{request.request_id} for route '{request.route_kind.value}'"
            ),
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )

    def _pop_matching_stream_plan(self, request: LLMProviderRequest) -> ScriptedStreamPlan:
        for index, plan in enumerate(self._stream_plans):
            if plan.match.matches(request):
                return self._stream_plans.pop(index)
        raise build_registry_failure(
            message=(
                "no scripted stream plan matched request "
                f"{request.request_id} for route '{request.route_kind.value}'"
            ),
            provider_key=request.provider_key,
            profile_key=request.profile_key,
        )

    def _record_call(
        self,
        *,
        mode: ScriptedProviderCallMode,
        request: LLMProviderRequest,
        emitted_items: int,
    ) -> None:
        record = ScriptedProviderCallRecord(
            call_index=self._call_index,
            mode=mode,
            provider_key=request.provider_key,
            profile_key=request.profile_key,
            model_name=request.model_name,
            route_kind=request.route_kind,
            request_id=str(request.request_id),
            message_count=len(request.conversation.messages),
            emitted_items=emitted_items,
        )
        self._history.append(record)
        self._call_index += 1


__all__ = [
    "ScriptedOneShotPlan",
    "ScriptedProvider",
    "ScriptedProviderCallMode",
    "ScriptedProviderCallRecord",
    "ScriptedProviderConfig",
    "ScriptedProviderMatch",
    "ScriptedStreamPlan",
]
