# Ambient Presence

## Purpose

This document defines the planned llm boundary for Echo's standby and proactive
presence behavior.

It exists so "agent does something cute or helpful while idle" is modeled as a
bounded subsystem rather than an unbounded background chat loop.

---

## Intended Behavior

Ambient presence may include:

- small idle chatter
- short reminders
- lightweight topic nudges
- playful live2d-facing lines or cues

It should be capable of:

- saying nothing
- producing only a very short line
- remaining low-priority relative to normal user turns

---

## Intended Inputs

This route is expected to consume caller-assembled context such as:

- idle duration
- recent user interaction silence
- time-of-day or cooldown state
- bounded local system facts such as weather or long work duration

The llm package does not own how those facts are gathered.

It only owns how a provider is invoked once those facts are already assembled.

---

## Safety And Anti-Intrusion Rules

Ambient presence must remain bounded:

- it must be suppressible
- it must respect cooldowns
- it must not interrupt active user speaking or active primary playback
- it must degrade safely to no-op

It must not become:

- autonomous surveillance
- unrestricted notification spam
- a hidden background reasoning loop

---

## Local-First Rule

Ambient presence should be local-first by default because:

- it is low-stakes
- it benefits from very low latency
- it should continue working even if the cloud-heavy path is not chosen

Cloud escalation may be considered later, but it is not the intended first line.

---

## Current Status

Ambient presence is now partially implemented through the ambient perception
system. See `docs/llm/ambient-perception.md` for the full architecture.

Implemented:

- Screen capture and image delivery to LLM
- Unified proactive prompt selection
- Session state guard (idle-only perception)
- Cooldown and throttle logic
- Self-window filtering for Echo overlay/chat/bubble windows
- Tray menu toggle

Not yet implemented:

- Local-first LLM routing (currently uses the same provider as user turns)
- Explicit reminder and time-of-day integrations
- Weather or long work duration context signals
