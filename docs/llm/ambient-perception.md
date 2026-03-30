# Ambient Perception

## Purpose

This document defines the architecture for Echo's intelligent ambient
perception system — the subsystem that observes the user's desktop environment
and generates contextually appropriate proactive commentary.

It replaces the previous timer-based screenshot approach with an event-driven,
always-on high-frequency perception pipeline.

---

## Design Principles

1. **Event-driven, not timer-driven.** Captures are triggered by meaningful
   desktop events (app switch, window title change, user idle threshold), not
   fixed intervals.
2. **Single interaction style.** If screen perception is enabled, Echo stays
  proactively talkative instead of splitting work vs. entertainment behavior.
3. **Structured context over raw pixels.** Prefer lightweight structured
   desktop context (app name, window title, URL) over full screenshots when
   sufficient.
4. **Proactive but bounded.** Commentary is throttled with cooldowns and
   repetition suppression. The system can decide to say nothing.
5. **Session-state aware.** Perception pauses when the user is speaking,
   the assistant is thinking, or TTS is playing back.

---

## Foreground Context Rules

Ambient perception uses the current foreground desktop context, but it must
discard Echo's own windows and other low-confidence shell-like contexts.

The collector should:

- treat `Echo Avatar`, `Echo Chat`, `Echo Bubble`, `Echo Avatar Window`,
  `Echo Bubble Window`, and `Current Session` as self-owned UI
- never treat Echo's own windows as the user's active task
- reuse the last reliable external context for a short period when a self
  window or generic shell briefly becomes foreground
- prefer real external app/window titles over internal overlay windows

---

## Perception Pipeline

### Event Sources

The following desktop events trigger a perception cycle:

| Event                    | Source                           | Debounce |
|--------------------------|----------------------------------|----------|
| Foreground app change    | Electron `powerMonitor` / polling | 2s       |
| Window title change      | Polling active window title       | 3s       |
| User returns from idle   | `powerMonitor` / input detection  | 1s       |
| Periodic heartbeat       | Fallback timer                    | 60s      |
| User-initiated capture   | Tray menu / hotkey                | none     |

### Capture Decision Flow

```
Event fires
  → Collect structured desktop context
    → Validate foreground context (must not be Echo-owned UI)
  → Check session state (must be idle)
  → Check cooldown (last commentary timestamp + minimum gap)
  → Check repetition (same app + similar title → skip)
    → Capture screenshot (low detail)
    → Submit with proactive prompt
```

### Structured Desktop Context

Before any screenshot, the system collects a lightweight context object:

```json
{
  "foreground_app": "Google Chrome",
  "window_title": "Echo Runtime - GitHub",
  "url": "https://live.bilibili.com/example",
  "idle_seconds": 15,
  "timestamp_utc": "2025-01-01T12:00:00Z"
}
```

This context is always available to the LLM, even when no screenshot is taken.

---

## Prompt Templates

### Unified Ambient Prompt

```
[环境感知]
用户正在使用: {app_name}
窗口标题: {window_title}
{url_line}

请根据你看到的屏幕内容，自然地主动发表评论、吐槽、提问、联想或接梗。
但你必须先判断相对上一次环境感知是否真的出现了新的可聊信息。
如果只是同一直播、同一视频、同一网页、同一对局继续播放，且没有新的明显变化、
新的笑点、槽点、信息点或剧情推进，直接回复 [沉默]。
默认保持轻松直接、朋友式互动。
如果当前画面没有明显可聊点，回复 [沉默] 即可。
```

This prompt is an internal control input for the ambient perception route. It
must not be shown in the user-visible chat transcript as if the user had typed
it manually.

### Silence Detection

If the LLM response is exactly `[沉默]` or `[silence]`, the runtime discards
the response and does not write a transcript entry or bubble update.

If the LLM response is lexically too similar to the previous ambient comment,
the runtime performs a final hard dedupe after generation completes. In that
case the response is swallowed before it becomes visible to the user.

---

## Throttling and Cooldown

| Parameter                     | Value         |
|-------------------------------|---------------|
| Minimum gap between comments  | 12s           |
| Same-app repetition cooldown  | 12s           |
| Same-scene static cooldown    | 90s           |
| Heartbeat static cooldown     | 180s          |
| Max comments per 10 minutes   | 40            |
| Silence after user speaks     | 6s            |
| Heartbeat interval            | 15s           |

In addition, Echo-owned windows and low-confidence generic shell contexts such
as `powershell` / `cmd` / `Windows Terminal` are suppressed for up to 90
seconds when Echo has a recent reliable external context.

The controller suppresses repeated submissions only when the scene key
(normalized app + title + URL) is unchanged and the screenshot signatures do
not show meaningful visual change. The current local signals are:

- coarse binary fingerprint
- local luma profile
- 8x8 grayscale grid delta

If the same livestream / video / page continues but the visible content
changes enough, the controller allows a new comment even before the static
cooldown expires.

---

## Session State Guard

Ambient perception is suppressed when session state is any of:

- `listening` — user is speaking
- `thinking` — assistant is generating
- `speaking` — TTS is playing back
- `interrupted` — interrupt barrier active

Perception only fires when session state is `idle`.

---

## Ownership Boundaries

| Component                       | Owner Layer                |
|---------------------------------|----------------------------|
| Screen capture                  | Electron (`screen_capture_service.mjs`) |
| Desktop context collection      | Electron (`desktop_context_service.mjs`) |
| Perception orchestration        | Electron (`ambient_perception_controller.mjs`) |
| Prompt template selection       | Electron (controller)      |
| LLM invocation                  | Python runtime via bridge  |
| Silence detection               | Python runtime (session service) |
| Final ambient hard dedupe       | Python runtime (session service) |
| Cooldown/throttle state         | Electron (controller)      |
| Tray menu integration           | Electron (`main.mjs`)      |

---

## Current Status

- Screen capture service: **implemented**
- Desktop context collection with self-window filtering: **implemented**
- Ambient perception controller: **implemented**
- Session state guard: **implemented**
- Unified prompt template: **implemented**
- High-frequency throttling/cooldown: **implemented**
- Runtime-level ambient hard dedupe: **implemented**

This document serves as the specification for implementing these components.
