from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SCOPE_TARGET_PATTERN = re.compile(r"^[a-z0-9]+([._-][a-z0-9]+)*$")


def _normalize_utc_datetime(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _normalize_string_list(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip().lower()
        if not normalized:
            continue
        if normalized not in seen:
            cleaned.append(normalized)
            seen.add(normalized)
    return cleaned


class EchoProtocolModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class RuleScope(str, Enum):
    GLOBAL = "global"
    CHAT = "chat"
    CODING = "coding"
    MAHJONG = "mahjong"
    WEB = "web"
    SCREEN = "screen"
    PLUGIN = "plugin"


class RuleOrigin(str, Enum):
    USER = "user"
    SYSTEM = "system"
    IMPORTED = "imported"
    TEST = "test"


class RuleLifecycleStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    ARCHIVED = "archived"


class IntensityBucket(str, Enum):
    WEAK = "weak"
    MEDIUM = "medium"
    STRONG = "strong"


class FeedbackRule(EchoProtocolModel):
    rule_id: UUID = Field(default_factory=uuid4)
    trigger_description: str = Field(min_length=1, max_length=256)
    behavior: str = Field(min_length=1, max_length=256)
    trigger_tags: list[str] = Field(default_factory=list, max_length=32)
    event_types: list[str] = Field(default_factory=list, max_length=16)
    scope: RuleScope = RuleScope.GLOBAL
    scope_target: str | None = Field(default=None, max_length=128)
    intensity: float = Field(ge=0.0, le=1.0)
    enabled: bool = True
    status: RuleLifecycleStatus = RuleLifecycleStatus.ACTIVE
    priority: int = Field(default=100, ge=0, le=100000)
    origin: RuleOrigin = RuleOrigin.USER
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    notes: str | None = Field(default=None, max_length=512)

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_utc_datetime(cls, value: datetime, info) -> datetime:
        return _normalize_utc_datetime(value, info.field_name)

    @field_validator("scope_target")
    @classmethod
    def validate_scope_target_format(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not SCOPE_TARGET_PATTERN.match(value):
            raise ValueError(
                "scope_target must be a lowercase machine-readable identifier, "
                "e.g. 'plugin.coding' or 'plugin.web-commentary'"
            )
        return value

    @field_validator("trigger_tags")
    @classmethod
    def validate_trigger_tags(cls, values: list[str]) -> list[str]:
        return _normalize_string_list(values)

    @field_validator("event_types")
    @classmethod
    def validate_event_types(cls, values: list[str]) -> list[str]:
        return _normalize_string_list(values)

    @model_validator(mode="after")
    def validate_scope_requirements(self) -> "FeedbackRule":
        if self.scope == RuleScope.PLUGIN and not self.scope_target:
            raise ValueError("scope_target is required when scope='plugin'")
        if self.scope != RuleScope.PLUGIN and self.scope_target is not None:
            raise ValueError("scope_target must be None unless scope='plugin'")
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must be >= created_at")
        return self


class RuleActivationContext(EchoProtocolModel):
    scope: RuleScope
    scope_target: str | None = Field(default=None, max_length=128)
    current_event_type: str | None = Field(default=None, max_length=128)
    active_tags: list[str] = Field(default_factory=list, max_length=64)
    recent_text: str | None = Field(default=None, max_length=2000)

    @field_validator("scope_target")
    @classmethod
    def validate_scope_target_format(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not SCOPE_TARGET_PATTERN.match(value):
            raise ValueError(
                "scope_target must be a lowercase machine-readable identifier"
            )
        return value

    @field_validator("current_event_type")
    @classmethod
    def normalize_event_type(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().lower()
        return normalized or None

    @field_validator("active_tags")
    @classmethod
    def normalize_active_tags(cls, values: list[str]) -> list[str]:
        return _normalize_string_list(values)


class CompiledRuleDirective(EchoProtocolModel):
    rule_id: UUID
    bucket: IntensityBucket
    llm_prompt_fragment: str = Field(min_length=1)
    tts_style_hint: str = Field(min_length=1, max_length=128)
    renderer_intensity_scale: float = Field(ge=0.0, le=1.0)
    source_scope: RuleScope
    source_scope_target: str | None = Field(default=None, max_length=128)
    original_intensity: float = Field(ge=0.0, le=1.0)


def intensity_to_bucket(intensity: float) -> IntensityBucket:
    if intensity < 0.3:
        return IntensityBucket.WEAK
    if intensity < 0.7:
        return IntensityBucket.MEDIUM
    return IntensityBucket.STRONG


def rule_matches_scope(rule: FeedbackRule, ctx: RuleActivationContext) -> bool:
    if rule.scope == RuleScope.GLOBAL:
        return True
    if rule.scope != ctx.scope:
        return False
    if rule.scope == RuleScope.PLUGIN:
        return rule.scope_target == ctx.scope_target
    return True


def rule_matches_event_type(rule: FeedbackRule, ctx: RuleActivationContext) -> bool:
    if not rule.event_types:
        return True
    if not ctx.current_event_type:
        return False
    return ctx.current_event_type in rule.event_types


def rule_matches_tags(rule: FeedbackRule, ctx: RuleActivationContext) -> bool:
    if not rule.trigger_tags:
        return True
    active = set(ctx.active_tags)
    return any(tag in active for tag in rule.trigger_tags)


def is_rule_applicable(rule: FeedbackRule, ctx: RuleActivationContext) -> bool:
    if not rule.enabled:
        return False
    if rule.status != RuleLifecycleStatus.ACTIVE:
        return False
    if not rule_matches_scope(rule, ctx):
        return False
    if not rule_matches_event_type(rule, ctx):
        return False
    if not rule_matches_tags(rule, ctx):
        return False
    return True


class PromptCompiler:
    WEAK_PREFIX = (
        "[Weak directive] Express this trait subtly and occasionally without "
        "disrupting the natural flow:"
    )
    MEDIUM_PREFIX = (
        "[Medium directive] Express this trait clearly and consistently while "
        "keeping it natural and readable:"
    )
    STRONG_PREFIX = (
        "[Strong directive] Express this trait forcefully and prominently, while "
        "still respecting system safety boundaries:"
    )

    def bucket_for_rule(self, rule: FeedbackRule) -> IntensityBucket:
        return intensity_to_bucket(rule.intensity)

    def compile_rule(self, rule: FeedbackRule) -> CompiledRuleDirective:
        bucket = self.bucket_for_rule(rule)
        return CompiledRuleDirective(
            rule_id=rule.rule_id,
            bucket=bucket,
            llm_prompt_fragment=self._compile_llm_prompt(rule, bucket),
            tts_style_hint=self._compile_tts_hint(rule, bucket),
            renderer_intensity_scale=self._compile_renderer_scale(rule, bucket),
            source_scope=rule.scope,
            source_scope_target=rule.scope_target,
            original_intensity=rule.intensity,
        )

    def compile_rules(
        self,
        rules: list[FeedbackRule],
        ctx: RuleActivationContext,
        max_rules: int = 4,
    ) -> list[CompiledRuleDirective]:
        applicable = [rule for rule in rules if is_rule_applicable(rule, ctx)]
        applicable.sort(key=self._sort_key, reverse=True)
        return [self.compile_rule(rule) for rule in applicable[:max_rules]]

    def build_prompt_tail(
        self,
        compiled_rules: list[CompiledRuleDirective],
    ) -> str:
        if not compiled_rules:
            return ""

        lines = [
            "Apply the following active user feedback directives at the tail of the policy prompt:"
        ]
        for index, item in enumerate(compiled_rules, start=1):
            lines.append(f"{index}. {item.llm_prompt_fragment}")
        return "\n".join(lines)

    def _compile_llm_prompt(
        self,
        rule: FeedbackRule,
        bucket: IntensityBucket,
    ) -> str:
        prefix = self._bucket_prefix(bucket)
        return (
            f"{prefix} Trigger context: {rule.trigger_description}; "
            f"Behavior requirement: {rule.behavior}."
        )

    def _compile_tts_hint(
        self,
        rule: FeedbackRule,
        bucket: IntensityBucket,
    ) -> str:
        if bucket == IntensityBucket.WEAK:
            return f"subtle:{rule.behavior}"
        if bucket == IntensityBucket.MEDIUM:
            return f"clear:{rule.behavior}"
        return f"dramatic:{rule.behavior}"

    def _compile_renderer_scale(
        self,
        rule: FeedbackRule,
        bucket: IntensityBucket,
    ) -> float:
        if bucket == IntensityBucket.WEAK:
            return min(0.35, max(0.10, rule.intensity))
        if bucket == IntensityBucket.MEDIUM:
            return min(0.70, max(0.40, rule.intensity))
        return min(1.0, max(0.75, rule.intensity))

    def _bucket_prefix(self, bucket: IntensityBucket) -> str:
        if bucket == IntensityBucket.WEAK:
            return self.WEAK_PREFIX
        if bucket == IntensityBucket.MEDIUM:
            return self.MEDIUM_PREFIX
        return self.STRONG_PREFIX

    def _scope_specificity(self, rule: FeedbackRule) -> int:
        if rule.scope == RuleScope.PLUGIN:
            return 3
        if rule.scope == RuleScope.GLOBAL:
            return 1
        return 2

    def _sort_key(self, rule: FeedbackRule) -> tuple[int, int, float, datetime]:
        return (
            self._scope_specificity(rule),
            rule.priority,
            rule.intensity,
            rule.updated_at,
        )
