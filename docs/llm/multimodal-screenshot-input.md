# Multimodal Screenshot Input

## Purpose

This document defines the boundary for screenshot-based multimodal input in
Echo, covering both user-triggered screenshot questions and ambient perception
captures.

---

## User-Triggered Screenshots

### User Flow

1. the user triggers a screenshot hotkey or attaches an image in the chat
   composer
2. the screenshot is attached to an ordinary user question turn
3. llm sees that screenshot only because the user explicitly attached it

User-triggered screenshots are always allowed and have no cooldown.

---

## Ambient Perception Screenshots

### Governed By

Ambient perception captures are governed by the ambient perception
architecture: `docs/llm/ambient-perception.md`.

### Rules

Ambient perception screenshots:

- are event-driven, not timer-driven
- are mode-aware (entertainment mode captures freely, work mode is restrained)
- are session-state guarded (only during `idle` state)
- are throttled with cooldowns and repetition suppression
- are always user-suppressible via tray menu toggle
- prefer structured desktop context over raw screenshots when sufficient

Ambient perception screenshots must not become:

- continuous screen monitoring at high frequency
- implicit desktop scraping without user awareness
- background image collection that persists beyond the current turn

### Privacy Safeguards

- The tray menu toggle clearly indicates when ambient perception is active
- Images are consumed per-turn and not stored beyond the session
- Work mode defaults to structured context only (no screenshot unless the LLM
  explicitly requests one)
- The user can disable the feature at any time with immediate effect

---

## Ownership Boundary

`packages/llm` owns:

- multimodal request-side contracts (`LLMImageAttachment`, `LLMMessage.images`)
- provider-side normalization for vision requests

`packages/llm` does not own:

- capture mechanics, hotkeys, or region selection UI
- mode classification or perception orchestration
- permission prompts or tray menu integration

Those belong to the Electron app layer.

---

## Current Status

- User-triggered screenshots: **implemented** (chat composer image attach)
- Ambient perception captures: **implemented** (event-driven via ambient
  perception controller)
- LLM vision support: **implemented** (`LLMImageAttachment` on `LLMMessage`)
