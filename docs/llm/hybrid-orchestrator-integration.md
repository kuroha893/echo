# Hybrid Orchestrator Integration

## Purpose

This document defines the intended startup policy when `TurnOrchestrator`
consumes Echo's hybrid llm topology.

It exists to bridge the gap between:

- llm-side route/provider design
- orchestrator-side turn startup and fallback policy

---

## Core Goal

For the first responsive demo, `TurnOrchestrator` should stop behaving like a
single-route cloud answerer with optional quick reaction.

Instead it should:

1. begin hidden local `intent_routing`
2. begin local `quick_reaction`
3. choose the primary path using the routing decision
4. continue with local lightweight or cloud-heavy primary generation

The purpose is to keep the agent visibly alive while deeper reasoning is still
warming up or streaming.

---

## Required Startup Rules

### Hidden routing is real work

`intent_routing` is not only diagnostic.

Its result should shape which primary path is chosen.

### Hidden routing is not user-visible

The routing decision must not become:

- TTS text
- renderer text
- protocol speech content

### Quick reaction stays local-first

Quick reaction should continue to be:

- short
- low-commitment
- interruptible
- parser-owned after generation

### Primary path remains parser-owned

Even when the primary answer comes from a local lightweight profile, it must
still:

- flow through the same parser path
- emit the same protocol events
- obey the same audio-mutex rules

---

## Decision Mapping

The intended first mapping is:

- `action_feedback` -> keep the local quick reaction, then prefer the local primary-response profile; if no local primary profile is available, fall back to the cloud primary-response profile
- `local_chat` -> use the local primary-response profile; if it is unavailable, fall back to the cloud primary-response profile
- `cloud_primary` -> use the cloud primary-response profile
- `cloud_tool` -> for now degrade safely to the cloud primary-response profile until tool-aware reasoning is implemented

The `cloud_tool` downgrade is temporary and exists only because
`primary_tool_reasoning` is still deferred.

It must be explicit rather than silent guesswork.

---

## Fallback Rules

If hidden routing fails or times out:

- the turn must not stall
- the safe fallback is the cloud primary-response path

If local quick reaction fails:

- the turn may continue without visible filler

If the local primary path is unavailable:

- the turn may escalate to the cloud primary path

These are orchestrator-owned policy decisions that consume llm behavior.

---

## Current Boundary

This document still does not define:

- tool-aware reasoning startup
- standby ambient loop orchestration
- screenshot multimodal orchestration
- TTS or renderer adapter behavior

Those belong to later task lines.
