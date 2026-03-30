# LLM Routing And Config

## Purpose

This document defines how Echo should choose providers and model profiles for
different llm routes without hardcoding those choices into callers.

---

## Core Idea

Echo should separate:

- provider registration
- model/profile configuration
- route-to-profile mapping

That means callers ask for a route kind, not for raw transport details.

In the hybrid local/cloud line, this also means callers should not hardcode:

- local vs cloud selection
- backend family names
- low-latency vs heavy-reasoning profiles

Those decisions belong in typed llm configuration and routing results.

---

## Core Models

### `LLMProviderDescriptor`

Stable provider identity and capabilities.

Typical fields:

- `provider_key`
- `display_name`
- `supports_streaming`
- `supports_tool_reasoning`
- `allowed_routes`

### `LLMModelProfile`

Echo-owned reusable profile for a route.

Typical fields:

- `profile_key`
- `provider_key`
- `model_name`
- `default_generation_config`

### `LLMRouteBinding`

Route-to-profile mapping.

Required fields:

- `route_kind`
- `profile_key`

Optional fields:

- `fallback_profile_key`

---

## Route Mapping Rules

For the hybrid v0.1 line, route mapping should support at least:

- one profile for `intent_routing`
- one profile for `quick_reaction`
- one local profile for `primary_response`
- one cloud profile for `primary_response`
- one reserved cloud profile for `primary_tool_reasoning`
- one optional local profile for `ambient_presence`

This lets Echo evolve toward:

- cheap fast local router model
- cheap fast local quick-reaction model
- optional lightweight local chat model
- stronger slower cloud primary model
- stronger cloud tool-aware reasoning model

without leaking that choice into orchestrator logic.

---

## Hybrid Local/Cloud Mapping

The default design intent is:

- `intent_routing` -> local fast-path provider
- `quick_reaction` -> local fast-path provider
- `primary_response` -> local lightweight profile or cloud primary profile
- `primary_tool_reasoning` -> cloud-heavy profile
- `ambient_presence` -> local fast-path provider by default

The route binding alone is not enough to choose between local and cloud primary
response. That later choice should be driven by hidden routing output plus
typed profile selection rules at higher layers.

---

## Override Rules

Callers may provide narrow overrides such as:

- explicit `provider_profile_key`
- explicit `provider_key_override`

But the default path should stay:

- route kind -> route binding -> model profile -> provider

This keeps ordinary orchestrator code route-driven rather than provider-driven.

For the hybrid line:

- local/cloud routing policy must not become a raw caller switchboard
- provider overrides must remain narrow and auditable

---

## v0.1 Configuration Scope

These docs intentionally do not define:

- YAML file format
- env-var layout
- hot reload protocol

The next llm tasks should keep config in:

- typed in-memory models
- deterministic test fixtures

Later provider work may add persistent config docs if needed.
