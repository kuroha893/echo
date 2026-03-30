~~~md
# Echo Protocol Specification: Feedback Rules

> Status: Draft v0.1  
> Scope: User feedback tuning rules, scope matching, intensity compilation, and prompt-facing rule translation  
> Authority: This document is constrained by **《Echo AI 开发规范与工程宪法》**, must remain consistent with `docs/protocol/events.md` and `docs/protocol/state-machine.md`, and is the source of truth for `packages/protocol/feedback_rules.py`.

---

## 1. Purpose

This document defines the canonical protocol for **user feedback tuning** in Echo.

Its goals are:

- define a strongly-typed structure for user feedback rules
- preserve the semantic meaning of `intensity`
- make rule triggering scope-aware and replayable
- prevent rules from degenerating into ad-hoc prompt strings
- define how rules are translated into **LLM prompt fragments**
- define how a rule influences not only text, but also **TTS** and **renderer** layers
- provide a copyable Python skeleton for `packages/protocol/feedback_rules.py`

This document covers:

- `FeedbackRule`
- `RuleScope`
- rule applicability
- intensity semantics
- compiled prompt fragments
- `PromptCompiler` skeleton

This document does **not** define:

- memory storage backend internals
- database schema migration rules
- the final UI for editing rules
- model-specific prompt templates for every provider

Those belong elsewhere.

---

## 2. Mandatory design decisions

### 2.1 Pydantic baseline
All protocol objects in this document use **Python 3.10+** and **Pydantic v2 `BaseModel`** as the canonical representation.

Reasons:

- strict validation
- safer nested serialization
- easier transport across runtime/memory/UI boundaries
- better protection against AI-generated schema drift

---

### 2.2 Necessary correction: `RuleScope` cannot be only a closed business list
The user requirement to define `RuleScope` as enums such as `global`, `coding`, `mahjong` is correct, but **insufficient by itself** for a plugin-native system.

Reason:

Future plugins are an open set.

Therefore this spec uses:

- `scope: RuleScope` → canonical closed enum for core scopes
- `scope_target: str | None` → concrete plugin or sub-scope identifier when needed

Examples:

- `scope=global`, `scope_target=None`
- `scope=coding`, `scope_target=None`
- `scope=plugin`, `scope_target="plugin.web-commentary"`
- `scope=plugin`, `scope_target="plugin.custom-game"`

This preserves strong typing and extensibility.

---

### 2.3 Necessary correction: one free-form trigger string is not enough
A single natural-language trigger like:

- “打错代码时”
- “麻将打烂时”
- “平时聊天时”

is useful for humans, but **not sufficient** for deterministic runtime matching.

Therefore `FeedbackRule` must separate:

- `trigger_description` → human-readable source description
- `trigger_tags` → machine-usable tags
- `event_types` → optional concrete protocol event filters

This is mandatory.

---

### 2.4 `intensity` is a semantic control parameter, not a raw numeric prompt token
`intensity` must be stored numerically in `[0.0, 1.0]`, but must **not** be injected directly into LLM prompts as an uninterpreted float.

Instead, it must be compiled into a discrete semantic strength bucket and then translated into:

1. LLM instruction fragment
2. TTS style hint
3. renderer expression/motion amplitude hint

This rule is non-negotiable.

---

### 2.5 Rules are immutable protocol records
`FeedbackRule` objects are immutable snapshots.

Editing a rule should create a logically updated version, not mutate arbitrary fields in-place inside random business code.

---

### 2.6 Unknown fields are forbidden
All protocol models must reject undeclared fields.

---

## 3. Canonical enums

---

### 3.1 `RuleScope`

Closed enum for canonical rule scope.

Values:

- `global`
- `chat`
- `coding`
- `mahjong`
- `web`
- `screen`
- `plugin`

Semantics:

- `global` → may apply across all contexts
- `chat` → ordinary conversation
- `coding` → code assistant / error explanation / programming workflows
- `mahjong` → Mahjong-specific interaction
- `web` → browser content commentary / subtitles / DOM-driven reactions
- `screen` → explicit screen understanding or UI analysis contexts
- `plugin` → external or custom plugin-specific scope; requires `scope_target`

---

### 3.2 `RuleOrigin`

Indicates where the rule came from.

Values:

- `user`
- `system`
- `imported`
- `test`

Semantics:

- `user` → explicit user instruction or user tuning input
- `system` → built-in default rule or product-level seeded rule
- `imported` → loaded from profile/template/import
- `test` → synthetic rule for testing

---

### 3.3 `RuleLifecycleStatus`

Indicates rule lifecycle status.

Values:

- `active`
- `disabled`
- `archived`

Semantics:

- `active` → eligible for matching and compilation
- `disabled` → preserved but ignored at runtime
- `archived` → historical only, not for runtime application

---

### 3.4 `IntensityBucket`

Discrete semantic bucket derived from `intensity`.

Values:

- `weak`
- `medium`
- `strong`

Range mapping:

- `weak` → `intensity < 0.3`
- `medium` → `0.3 <= intensity < 0.7`
- `strong` → `intensity >= 0.7`

These thresholds are locked for v0.1.

---

## 4. Canonical semantics of `intensity`

`intensity` is a normalized scalar in `[0.0, 1.0]`.

It answers:

> “How strongly should this rule be expressed when it is applicable?”

It does **not** answer:

- whether the rule exists
- whether the rule is safe
- whether it overrides system policy
- whether it should apply outside its scope

### 4.1 Weak range `< 0.3`
Semantic meaning:

- subtle
- occasional
- non-disruptive
- low surface area

Typical effect:

- only mild wording shifts
- small TTS attitude adjustments
- light renderer emphasis

---

### 4.2 Medium range `0.3 <= x < 0.7`
Semantic meaning:

- noticeable
- stable
- clearly intentional
- still readable and conversational

Typical effect:

- explicit stylistic wording
- clear TTS attitude
- visible renderer expression/motion strengthening

---

### 4.3 Strong range `>= 0.7`
Semantic meaning:

- forceful
- highly characteristic
- stylistically dominant
- dramatic if context allows

Typical effect:

- strong personality expression
- amplified TTS performance
- larger renderer intensity

### 4.4 Safety boundary
Even at strong intensity, compiled output remains subordinate to:

- system safety constraints
- explicit product limits
- platform boundaries
- higher-priority runtime constraints

A strong rule is **not** permission to violate system boundaries.

---

## 5. Core data structures

---

### 5.1 `FeedbackRule`

Canonical protocol object for a user feedback tuning rule.

Minimum required semantics:

- unique identity
- human-readable trigger description
- machine-readable tags / filters
- desired behavior
- `intensity`
- scope
- lifecycle status
- traceable timestamps

---

### 5.2 `RuleActivationContext`

Represents the current runtime context used to decide whether a rule applies.

This is not persisted as the rule itself.  
It is a per-turn matching snapshot.

It should include:

- current scope
- current scope target
- current event type
- active context tags
- recent text (optional)
- whether the turn is user-initiated or plugin-driven

---

### 5.3 `CompiledRuleDirective`

Represents the compiled result of a `FeedbackRule`.

It contains three channels:

1. `llm_prompt_fragment`
2. `tts_style_hint`
3. `renderer_intensity_scale`

This structure exists because Echo’s rule system must affect more than prompt text.

---

## 6. Rule applicability rules

A rule is applicable only if **all** of the following pass:

1. rule status is `active`
2. rule is enabled
3. scope matches current runtime scope
4. if `scope == plugin`, `scope_target` matches
5. required event type filter, if present, matches
6. required trigger tags, if present, intersect current active tags
7. optional text filter, if configured, matches current text/context

If any condition fails, the rule must not be compiled for the current turn.

---

## 7. Scope matching rules

### 7.1 Global rules
A `global` rule may apply in any scope, subject to its other filters.

---

### 7.2 Non-global core rules
A `coding` rule must not apply in `mahjong` scope.  
A `mahjong` rule must not apply in `chat` scope.  
And so on.

---

### 7.3 Plugin scope
If `scope == plugin`, `scope_target` is required.

Matching rule:

- current runtime scope must be `plugin`
- current runtime `scope_target` must equal the rule’s `scope_target`

No fuzzy plugin matching is allowed in v0.1.

---

## 8. Conflict resolution and precedence

Multiple rules may match the same turn.  
Therefore precedence must be deterministic.

### 8.1 Ordering rules
Applicable rules should be ordered by:

1. specificity
   - plugin-specific > concrete core scope > global
2. explicit `priority`
   - higher priority first
3. stronger intensity
   - higher intensity first when priority ties
4. newer update time
   - more recent rule first when all else ties

This ordering is recommended for compilation.

---

### 8.2 Injection cap
To avoid prompt bloat, the compiler should cap the number of injected rules per turn.

Recommended default:

- max `4` compiled rules per turn

This cap is a runtime policy, not part of the core rule schema.

---

### 8.3 Contradictory rules
If two active rules conflict semantically, the more specific rule wins.

Examples:

- `global`: “平时温柔一点”
- `coding`: “代码写错时嘲讽我”

When coding scope is active, the `coding` rule wins.

If two equally specific rules conflict, the higher-priority rule wins.

---

## 9. Tail-injection principle

Compiled LLM prompt fragments from feedback rules should be injected into the **tail section** of the effective system/policy prompt.

Reason:

- preserves global system boundaries
- gives local rule expression high recency
- matches the constitution’s dynamic compilation intent

This is the default policy for v0.1.

---

## 10. Copyable Python skeleton for `packages/protocol/feedback_rules.py`

> This code is intentionally close to production skeleton quality.  
> It may be copied into `packages/protocol/feedback_rules.py` and refined with tests/import cleanup.  
> Any semantic change must be reflected back into this document.

```python
from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ============================================================
# Base protocol model
# ============================================================

SCOPE_TARGET_PATTERN = re.compile(r"^[a-z0-9]+([._-][a-z0-9]+)*$")


class EchoProtocolModel(BaseModel):
    """
    Base class for protocol-layer feedback rule models.

    Rules:
    - extra fields forbidden
    - immutable after creation
    - strings trimmed
    """
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


# ============================================================
# Enums
# ============================================================

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


# ============================================================
# Core protocol models
# ============================================================

class FeedbackRule(EchoProtocolModel):
    """
    Canonical persisted rule record for user feedback tuning.
    """
    rule_id: UUID = Field(default_factory=uuid4)

    # Human-readable rule semantics
    trigger_description: str = Field(min_length=1, max_length=256)
    behavior: str = Field(min_length=1, max_length=256)

    # Machine-usable matching hints
    trigger_tags: list[str] = Field(default_factory=list, max_length=32)
    event_types: list[str] = Field(default_factory=list, max_length=16)

    # Scope and applicability
    scope: RuleScope = RuleScope.GLOBAL
    scope_target: str | None = Field(default=None, max_length=128)

    # Expression strength
    intensity: float = Field(ge=0.0, le=1.0)

    # Lifecycle and ordering
    enabled: bool = True
    status: RuleLifecycleStatus = RuleLifecycleStatus.ACTIVE
    priority: int = Field(default=100, ge=0, le=100000)

    # Traceability
    origin: RuleOrigin = RuleOrigin.USER
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Optional notes for UI / debugging / future tooling
    notes: str | None = Field(default=None, max_length=512)

    @field_validator("created_at", "updated_at")
    @classmethod
    def ensure_utc_datetime(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime fields must be timezone-aware")
        return value.astimezone(timezone.utc)

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

    @field_validator("event_types")
    @classmethod
    def validate_event_types(cls, values: list[str]) -> list[str]:
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
    """
    Runtime snapshot used to determine whether a FeedbackRule applies.
    """
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

    @field_validator("active_tags")
    @classmethod
    def normalize_active_tags(cls, values: list[str]) -> list[str]:
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


class CompiledRuleDirective(EchoProtocolModel):
    """
    Compiled multi-channel output of a FeedbackRule.
    """
    rule_id: UUID
    bucket: IntensityBucket

    # LLM channel
    llm_prompt_fragment: str = Field(min_length=1)

    # TTS channel
    tts_style_hint: str = Field(min_length=1, max_length=128)

    # Renderer channel
    renderer_intensity_scale: float = Field(ge=0.0, le=1.0)

    # Traceability
    source_scope: RuleScope
    source_scope_target: str | None = None
    original_intensity: float = Field(ge=0.0, le=1.0)


# ============================================================
# Matching helpers
# ============================================================

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


# ============================================================
# Prompt compiler
# ============================================================

class PromptCompiler:
    """
    Compiles FeedbackRule objects into prompt-facing rule directives.

    Non-negotiable principles:
    - never inject raw float intensity as if the model will understand it
    - always compile intensity into a semantic bucket
    - produce outputs for LLM + TTS + renderer
    - output is appended near the tail of the effective system/policy prompt
    """

    WEAK_PREFIX = (
        "【极弱约束】非常隐晦、偶尔地体现以下特征，不要破坏自然对话氛围："
    )
    MEDIUM_PREFIX = (
        "【中等约束】明显且自然地展现以下特征，使用户能够感知到其存在："
    )
    STRONG_PREFIX = (
        "【极强约束】强烈、夸张且持续地贯彻以下特征，但仍必须遵守系统安全边界："
    )

    def bucket_for_rule(self, rule: FeedbackRule) -> IntensityBucket:
        return intensity_to_bucket(rule.intensity)

    def compile_rule(self, rule: FeedbackRule) -> CompiledRuleDirective:
        """
        Compile a single FeedbackRule into:
        - LLM prompt fragment
        - TTS style hint
        - renderer intensity hint
        """
        bucket = self.bucket_for_rule(rule)

        llm_prompt_fragment = self._compile_llm_prompt(rule, bucket)
        tts_style_hint = self._compile_tts_hint(rule, bucket)
        renderer_scale = self._compile_renderer_scale(rule, bucket)

        return CompiledRuleDirective(
            rule_id=rule.rule_id,
            bucket=bucket,
            llm_prompt_fragment=llm_prompt_fragment,
            tts_style_hint=tts_style_hint,
            renderer_intensity_scale=renderer_scale,
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
        """
        Filter + order + compile all applicable rules.

        Recommended ordering:
        1. scope specificity
        2. higher priority first
        3. stronger intensity first
        4. newer updated_at first
        """
        applicable = [rule for rule in rules if is_rule_applicable(rule, ctx)]
        applicable.sort(
            key=self._sort_key,
            reverse=True,
        )
        return [self.compile_rule(rule) for rule in applicable[:max_rules]]

    def build_prompt_tail(
        self,
        compiled_rules: list[CompiledRuleDirective],
    ) -> str:
        """
        Build the final prompt tail fragment that can be appended to the
        effective system/policy prompt.

        This method intentionally returns plain text, not provider-specific JSON.
        """
        if not compiled_rules:
            return ""

        lines = [
            "以下为当前回合生效的用户反馈调教规则，请严格遵守："
        ]
        for idx, item in enumerate(compiled_rules, start=1):
            lines.append(f"{idx}. {item.llm_prompt_fragment}")
        return "\n".join(lines)

    def _compile_llm_prompt(
        self,
        rule: FeedbackRule,
        bucket: IntensityBucket,
    ) -> str:
        prefix = self._bucket_prefix(bucket)
        return (
            f"{prefix} "
            f"触发语境：{rule.trigger_description}；"
            f"行为要求：{rule.behavior}。"
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
~~~

------

## 11. Example rule instances

### 11.1 Coding taunt rule

```python
rule = FeedbackRule(
    trigger_description="用户在 coding 场景里写错基础代码或犯低级错误时",
    behavior="优先吐槽我，而不是先安慰我",
    trigger_tags=["coding.error", "coding.beginner-mistake"],
    event_types=["user.speech.end"],
    scope=RuleScope.CODING,
    intensity=0.8,
    enabled=True,
    status=RuleLifecycleStatus.ACTIVE,
    priority=300,
    origin=RuleOrigin.USER,
)
```

------

### 11.2 Global mild teasing rule

```python
rule = FeedbackRule(
    trigger_description="日常聊天时",
    behavior="偶尔轻微地嘴硬和吐槽我",
    trigger_tags=["chat.casual"],
    scope=RuleScope.GLOBAL,
    intensity=0.25,
    enabled=True,
    status=RuleLifecycleStatus.ACTIVE,
    priority=100,
    origin=RuleOrigin.USER,
)
```

------

### 11.3 Plugin-specific rule

```python
rule = FeedbackRule(
    trigger_description="在自定义网页吐槽插件里遇到离谱内容时",
    behavior="更尖锐地吐槽并提高表情幅度",
    trigger_tags=["web.absurd", "commentary.hot"],
    scope=RuleScope.PLUGIN,
    scope_target="plugin.web-commentary",
    intensity=0.72,
    enabled=True,
    status=RuleLifecycleStatus.ACTIVE,
    priority=250,
    origin=RuleOrigin.USER,
)
```

------

## 12. Compiled output examples

### 12.1 Weak example (`intensity = 0.2`)

Compiled LLM fragment:

> 【极弱约束】非常隐晦、偶尔地体现以下特征，不要破坏自然对话氛围： 触发语境：用户在 coding 场景里写错基础代码或犯低级错误时；行为要求：优先吐槽我，而不是先安慰我。

Expected effect:

- LLM: only mild taunting cues
- TTS: subtle teasing tone
- renderer: light expression emphasis

------

### 12.2 Medium example (`intensity = 0.55`)

Compiled LLM fragment:

> 【中等约束】明显且自然地展现以下特征，使用户能够感知到其存在： 触发语境：用户在 coding 场景里写错基础代码或犯低级错误时；行为要求：优先吐槽我，而不是先安慰我。

Expected effect:

- LLM: visible, consistent teasing
- TTS: clearly performative
- renderer: obvious but not exaggerated reaction

------

### 12.3 Strong example (`intensity = 0.9`)

Compiled LLM fragment:

> 【极强约束】强烈、夸张且持续地贯彻以下特征，但仍必须遵守系统安全边界： 触发语境：用户在 coding 场景里写错基础代码或犯低级错误时；行为要求：优先吐槽我，而不是先安慰我。

Expected effect:

- LLM: strongly stylized response
- TTS: dramatic performance
- renderer: large-amplitude expression/motion

------

## 13. Required implementation rules

### 13.1 Never store compiled prompt strings as the rule itself

Persist the canonical structured rule, not the transient compiled prompt fragment.

Reason:

- compiler templates may evolve
- prompt styles may vary by backend
- raw compiled prompt text is a derived artifact

------

### 13.2 Never inject raw numeric intensity into the model prompt

Forbidden example:

```python
system_prompt += f"Intensity: {rule.intensity}"
```

This is invalid.

------

### 13.3 Compiler output must remain structured

The compiler must output at least:

- prompt fragment
- TTS hint
- renderer hint

It must not collapse everything into a single unstructured string.

------

### 13.4 Rule matching must happen before compilation

Do not compile inactive or non-applicable rules.

------

### 13.5 Scope safety

A `coding` rule must not leak into `mahjong` turns.
A plugin rule for `plugin.web-commentary` must not leak into other plugins.

------

## 14. Suggested tests

The following tests are mandatory for acceptance.

### 14.1 Validation tests

- `intensity < 0.0` must fail
- `intensity > 1.0` must fail
- plugin scope without `scope_target` must fail
- non-plugin scope with `scope_target` must fail
- naive datetimes must fail

------

### 14.2 Bucket tests

- `0.0`, `0.1`, `0.29` -> `weak`
- `0.3`, `0.5`, `0.69` -> `medium`
- `0.7`, `0.9`, `1.0` -> `strong`

------

### 14.3 Matching tests

- global rule matches all scopes
- coding rule matches coding scope only
- plugin rule matches only exact `scope_target`
- disabled rule never matches
- archived rule never matches

------

### 14.4 Compiler tests

- weak intensity yields weak prefix
- medium intensity yields medium prefix
- strong intensity yields strong prefix
- compiled output includes LLM + TTS + renderer channels
- rule sorting prefers specific scope over global
- rule sorting prefers higher priority over lower priority

------

## 15. Acceptance checklist

This document is considered implemented correctly only if:

-  `FeedbackRule` is defined as a Pydantic v2 model
-  `intensity` is validated in `[0.0, 1.0]`
-  `RuleScope` exists and is locked
-  plugin-specific scope requires `scope_target`
-  rule applicability is deterministic
-  `PromptCompiler` compiles intensity into semantic buckets, not raw floats
-  compiler emits multi-channel directives for LLM/TTS/renderer
-  tests cover validation, matching, bucketing, and compilation

