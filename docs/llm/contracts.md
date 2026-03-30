# LLM Contracts

## Purpose

This document defines the llm-local typed contracts that `packages/llm` should
expose to callers and providers.

These are not protocol events.
They are package-local contracts for safe model interaction.

---

## Core Enums

### `LLMRouteKind`

Locked route values for the hybrid v0.1 line:

- `intent_routing`
- `quick_reaction`
- `primary_response`
- `primary_tool_reasoning`
- `ambient_presence`

### `LLMIntentDecisionKind`

Locked hidden routing decision values for the hybrid v0.1 line:

- `action_feedback`
- `local_chat`
- `cloud_primary`
- `cloud_tool`

### `LLMMessageRole`

Locked message roles for v0.1:

- `system`
- `developer`
- `user`
- `assistant`
- `tool`

### `LLMFinishReason`

Locked completion reasons for v0.1:

- `stop`
- `length`
- `cancelled`
- `tool_call`
- `provider_error`

### `LLMProviderErrorCode`

Locked provider error codes for v0.1:

- `validation_error`
- `configuration_error`
- `auth_failed`
- `provider_unavailable`
- `rate_limited`
- `timeout`
- `cancelled`
- `malformed_response`
- `unsupported_capability`

---

## Request-Side Models

### `LLMMessage`

Provider-neutral conversation unit.

Required fields:

- `role`
- `content`

Optional fields:

- `name`
- `tool_call_id`

Rules:

- `content` must be plain text in the current llm line
- provider-specific multipart structures are out of scope until screenshot
  multimodal support is explicitly introduced

### `LLMRequestContext`

Trace-owned request identity.

Required fields:

- `request_id`
- `session_id`
- `trace_id`
- `turn_id`
- `route_kind`

Optional fields:

- `step_index`
- `response_stream_id`

Rules:

- `step_index` is mainly for later `primary_tool_reasoning`
- `response_stream_id` should be present for `primary_response`
- `intent_routing` and `ambient_presence` normally do not require a response
  stream id

### `LLMGenerationConfig`

Provider-neutral sampling and timeout knobs.

Required fields:

- `max_output_tokens`
- `timeout_ms`

Optional fields:

- `temperature`
- `top_p`
- `stop_sequences`
- `seed`

Rules:

- config fields must remain provider-neutral
- provider-specific raw transport options must not leak through this model

### `LLMConversationInput`

Full llm-local generation request.

Required fields:

- `context`
- `messages`
- `generation_config`

Optional fields:

- `system_instructions`
- `developer_instructions`
- `provider_profile_key`
- `provider_key_override`

Rules:

- `messages` must preserve caller-provided order exactly
- `system_instructions` and `developer_instructions` are already-assembled text
  fragments; `packages/llm` must not reinterpret them as rule objects

---

## Output-Side Models

### `LLMTextDelta`

Normalized streaming text unit.

Required fields:

- `delta_index`
- `text`

Rules:

- text must remain raw and ordered
- deltas may contain expression tags
- `packages/llm` must not strip tags that belong to `ExpressionParser`

### `LLMIntentRouteDecision`

Normalized hidden routing output.

Required fields:

- `decision_kind`

Optional fields:

- `confidence`
- `reason_text`

Rules:

- this model is hidden control output, not user-visible assistant text
- it exists so `intent_routing` does not have to overload `LLMCompletion`
- `packages/llm` may normalize structured provider output into this model
- `reason_text` is optional diagnostic text and must not become visible speech by
  default

### `LLMToolCallIntent`

Reserved normalized model-side tool request intent.

Required fields:

- `intent_index`
- `tool_name`
- `arguments_text`

Rules:

- this model exists only so later tool-aware routes have a typed llm-local output
- it is not a replacement for protocol-level `ToolCallRequest`

### `LLMUsageSnapshot`

Optional usage summary.

Fields:

- `input_tokens`
- `output_tokens`
- `cached_input_tokens`

Rules:

- all fields are optional in v0.1 because not every provider reports them

### `LLMCompletion`

Terminal summary for one request.

Required fields:

- `finish_reason`
- `output_text`

Optional fields:

- `usage`
- `provider_response_id`

Rules:

- `output_text` must equal the concatenation of emitted text deltas for text routes
- completion must arrive exactly once for a successful request
- `intent_routing` should eventually prefer `LLMIntentRouteDecision` over plain
  text completion once structured routing is implemented

---

## Error Model

### `LLMProviderError`

Normalized provider failure surface.

Required fields:

- `error_code`
- `message`
- `retryable`

Optional fields:

- `provider_key`
- `profile_key`
- `status_code`
- `raw_error_type`

Rules:

- `packages/llm` must normalize provider-specific failures into this model before
  surfacing them upstream
- callers outside `packages/llm` must not need to understand raw transport exceptions

---

## Contract Rules

All llm-local models should obey:

- Pydantic v2 style
- `extra="forbid"`
- immutability after construction
- explicit enums instead of free strings where the value set is closed
- UTC-aware datetimes if a timestamp field is introduced later

No ad hoc dict payloads may cross the public `packages/llm` boundary.
