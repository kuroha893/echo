from __future__ import annotations

import asyncio

from pydantic import Field, field_validator, model_validator

from packages.renderer.adapter_ports import (
    RendererAdapterPort,
    ensure_descriptor_matches_capabilities,
    validate_request_against_capabilities,
)
from packages.renderer.errors import (
    RendererAdapterExecutionError,
    RendererRegistryError,
    build_renderer_error,
)
from packages.renderer.models import (
    RendererAdapterCapabilities,
    RendererAdapterDescriptor,
    RendererAdapterErrorCode,
    RendererAdapterFailure,
    RendererDispatchOutcome,
    RendererDispatchResult,
    RendererModel,
    RendererResolvedDispatchRequest,
)


class ScriptedRendererAdapterMatch(RendererModel):
    command_type: str | None = None
    command_target: str | None = Field(default=None, min_length=1, max_length=256)
    command_value: str | float | int | bool | None = None
    command_id: str | None = Field(default=None, min_length=1, max_length=64)
    adapter_profile_key: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("command_type")
    @classmethod
    def normalize_command_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("command_type matcher must not be blank")
        return cleaned

    def matches(self, request: RendererResolvedDispatchRequest) -> bool:
        command = request.command
        if self.command_type is not None and self.command_type != command.command_type.value:
            return False
        if self.command_target is not None and self.command_target != command.target:
            return False
        if self.command_value is not None and self.command_value != command.value:
            return False
        if self.command_id is not None and self.command_id != str(command.command_id):
            return False
        if (
            self.adapter_profile_key is not None
            and self.adapter_profile_key != request.adapter_profile_key
        ):
            return False
        return True


class ScriptedRendererDispatchPlan(RendererModel):
    plan_key: str | None = Field(default=None, max_length=128)
    match: ScriptedRendererAdapterMatch = Field(default_factory=ScriptedRendererAdapterMatch)
    outcome: RendererDispatchOutcome = RendererDispatchOutcome.COMPLETED
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    failure: RendererAdapterFailure | None = None

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
    def validate_terminal_outcome(self) -> "ScriptedRendererDispatchPlan":
        if self.failure is not None and self.message is not None:
            raise ValueError("failure plans must not also provide a success message")
        return self


class ScriptedRendererAdapterConfig(RendererModel):
    descriptor: RendererAdapterDescriptor
    capabilities: RendererAdapterCapabilities
    dispatch_plans: tuple[ScriptedRendererDispatchPlan, ...] = ()
    reject_unplanned_commands: bool = False
    default_outcome: RendererDispatchOutcome = RendererDispatchOutcome.COMPLETED
    default_message: str | None = Field(default=None, min_length=1, max_length=4000)

    @field_validator("dispatch_plans", mode="before")
    @classmethod
    def normalize_dispatch_plans(
        cls,
        value: object,
    ) -> tuple[ScriptedRendererDispatchPlan, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return value
        return tuple(value)  # type: ignore[arg-type]

    @model_validator(mode="after")
    def validate_descriptor_alignment(self) -> "ScriptedRendererAdapterConfig":
        ensure_descriptor_matches_capabilities(
            self.descriptor,
            self.capabilities,
        )
        return self


class ScriptedRendererAdapterCallRecord(RendererModel):
    call_index: int = Field(ge=0)
    adapter_key: str = Field(min_length=1, max_length=64)
    adapter_profile_key: str | None = Field(default=None, min_length=1, max_length=64)
    command_id: str = Field(min_length=1, max_length=64)
    command_type: str = Field(min_length=1, max_length=64)
    command_target: str = Field(min_length=1, max_length=256)
    command_value_repr: str = Field(min_length=1, max_length=4000)
    plan_key: str | None = Field(default=None, max_length=128)
    outcome: RendererDispatchOutcome | None = None
    failure_code: RendererAdapterErrorCode | None = None


class ScriptedRendererAdapter(RendererAdapterPort):
    def __init__(self, config: ScriptedRendererAdapterConfig) -> None:
        self._descriptor = config.descriptor
        self._capabilities = config.capabilities
        self._dispatch_plans = list(config.dispatch_plans)
        self._reject_unplanned_commands = config.reject_unplanned_commands
        self._default_outcome = config.default_outcome
        self._default_message = config.default_message
        self._history: list[ScriptedRendererAdapterCallRecord] = []
        self._call_index = 0

    @property
    def adapter_key(self) -> str:
        return self._descriptor.adapter_key

    def get_descriptor(self) -> RendererAdapterDescriptor:
        return self._descriptor

    def get_capabilities(self) -> RendererAdapterCapabilities:
        return self._capabilities

    def get_history(self) -> tuple[ScriptedRendererAdapterCallRecord, ...]:
        return tuple(self._history)

    def reset_history(self) -> None:
        self._history.clear()
        self._call_index = 0

    async def dispatch(
        self,
        request: RendererResolvedDispatchRequest,
    ) -> RendererDispatchResult:
        if request.adapter_key != self.adapter_key:
            failure = build_renderer_error(
                error_code=RendererAdapterErrorCode.CONFIGURATION_ERROR,
                message=(
                    f"scripted renderer adapter '{self.adapter_key}' cannot serve "
                    f"request resolved for adapter '{request.adapter_key}'"
                ),
                retryable=False,
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=request.command_id,
                command_type=request.command_type,
            )
            self._record_failure(request=request, failure=failure, plan_key=None)
            raise RendererRegistryError(failure)

        try:
            validate_request_against_capabilities(request)
        except (RendererAdapterExecutionError, RendererRegistryError) as exc:
            self._record_failure(request=request, failure=exc.error, plan_key=None)
            raise

        plan = self._pop_matching_plan(request)
        if plan is None:
            if self._reject_unplanned_commands:
                failure = build_renderer_error(
                    error_code=RendererAdapterErrorCode.INTERNAL_ADAPTER_ERROR,
                    message=(
                        "scripted renderer adapter has no dispatch plan for the resolved request"
                    ),
                    retryable=False,
                    adapter_key=self.adapter_key,
                    adapter_profile_key=request.adapter_profile_key,
                    command_id=request.command_id,
                    command_type=request.command_type,
                )
                self._record_failure(request=request, failure=failure, plan_key=None)
                raise RendererAdapterExecutionError(failure)
            result = self._build_result(
                request=request,
                outcome=self._default_outcome,
                message=self._default_message,
            )
            self._record_success(request=request, result=result, plan_key=None)
            await asyncio.sleep(0)
            return result

        if plan.failure is not None:
            failure = self._align_failure_to_request(
                failure=plan.failure,
                request=request,
            )
            self._record_failure(
                request=request,
                failure=failure,
                plan_key=plan.plan_key,
            )
            raise RendererAdapterExecutionError(failure)

        result = self._build_result(
            request=request,
            outcome=plan.outcome,
            message=plan.message,
        )
        self._record_success(
            request=request,
            result=result,
            plan_key=plan.plan_key,
        )
        await asyncio.sleep(0)
        return result

    def _build_result(
        self,
        *,
        request: RendererResolvedDispatchRequest,
        outcome: RendererDispatchOutcome,
        message: str | None,
    ) -> RendererDispatchResult:
        return RendererDispatchResult(
            command_id=request.command_id,
            command_type=request.command_type,
            adapter_key=request.adapter_key,
            adapter_profile_key=request.adapter_profile_key,
            outcome=outcome,
            message=message,
        )

    def _align_failure_to_request(
        self,
        *,
        failure: RendererAdapterFailure,
        request: RendererResolvedDispatchRequest,
    ) -> RendererAdapterFailure:
        update: dict[str, object] = {}
        if failure.adapter_key is None:
            update["adapter_key"] = request.adapter_key
        if failure.adapter_profile_key is None:
            update["adapter_profile_key"] = request.adapter_profile_key
        if failure.command_id is None:
            update["command_id"] = request.command_id
        if failure.command_type is None:
            update["command_type"] = request.command_type
        if not update:
            return failure
        return failure.model_copy(update=update)

    def _pop_matching_plan(
        self,
        request: RendererResolvedDispatchRequest,
    ) -> ScriptedRendererDispatchPlan | None:
        for index, plan in enumerate(self._dispatch_plans):
            if plan.match.matches(request):
                return self._dispatch_plans.pop(index)
        return None

    def _record_success(
        self,
        *,
        request: RendererResolvedDispatchRequest,
        result: RendererDispatchResult,
        plan_key: str | None,
    ) -> None:
        self._history.append(
            ScriptedRendererAdapterCallRecord(
                call_index=self._call_index,
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=str(request.command_id),
                command_type=request.command_type.value,
                command_target=request.command.target,
                command_value_repr=repr(request.command.value),
                plan_key=plan_key,
                outcome=result.outcome,
                failure_code=None,
            )
        )
        self._call_index += 1

    def _record_failure(
        self,
        *,
        request: RendererResolvedDispatchRequest,
        failure: RendererAdapterFailure,
        plan_key: str | None,
    ) -> None:
        self._history.append(
            ScriptedRendererAdapterCallRecord(
                call_index=self._call_index,
                adapter_key=request.adapter_key,
                adapter_profile_key=request.adapter_profile_key,
                command_id=str(request.command_id),
                command_type=request.command_type.value,
                command_target=request.command.target,
                command_value_repr=repr(request.command.value),
                plan_key=plan_key,
                outcome=None,
                failure_code=failure.error_code,
            )
        )
        self._call_index += 1


__all__ = [
    "ScriptedRendererAdapter",
    "ScriptedRendererAdapterCallRecord",
    "ScriptedRendererAdapterConfig",
    "ScriptedRendererAdapterMatch",
    "ScriptedRendererDispatchPlan",
]
