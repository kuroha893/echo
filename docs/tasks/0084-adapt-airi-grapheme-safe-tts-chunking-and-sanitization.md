# Task Card 0084

## Title
Adapt AIRI's grapheme-safe TTS chunking and TTS-only sanitization for Echo

## Role
Implementer

## Goal
Replace Echo's current heuristic TTS text shaping with a more language-aware,
grapheme-safe, symbol-safe pipeline modeled primarily on AIRI.

The user-visible problems are:

- emoji and special symbols can make TTS fail or produce nonsense sounds
- markdown-like reply text is not always suitable for direct speech synthesis
- Chinese, Japanese, and mixed-language replies need stable chunk boundaries
- short speech chunks should sound like short natural clauses, not arbitrary
  character buckets

This task is only about the text that goes into TTS. It must not rewrite the
canonical transcript text shown to the user.

## Scope Clarification
Echo should keep one canonical visible assistant text stream for transcript,
chat, and bubble surfaces.

This task introduces a separate **TTS-only speakable text pipeline** derived
from that canonical text. The visible text remains lossless; only the
TTS-facing copy may be sanitized and chunked.

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [events.md](/C:/Users/123/Desktop/echo/docs/protocol/events.md)
- [orchestrator-spec.md](/C:/Users/123/Desktop/echo/docs/protocol/orchestrator-spec.md)
- Primary mirrored reference repo:
  - [tts.ts](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/utils/tts.ts)
- Supplementary mirrored reference repo:
  - [qwen_voice_reply.py](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/scripts/qwen_voice_reply.py)

## How open-yachiyo solves this
open-yachiyo is not the primary model for chunking, but it does keep a clean
"normalized text in, synthesize once" philosophy in its Qwen voice reply path.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\scripts\qwen_voice_reply.py`

```python
normalized_text = normalize_tts_input_text(args.text, args.voice_tag)
resp = dashscope.MultiModalConversation.call(**payload)
```

This matters because open-yachiyo clearly separates "visible text exists" from
"normalized TTS input exists". Echo should keep that separation, but with a
more advanced chunking pipeline than open-yachiyo currently exposes.

## How AIRI solves this
AIRI already treats TTS input as a streaming text-processing problem rather than
a dumb string append.

It uses grapheme-safe reading and word-aware segmentation:

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\utils\tts.ts`

```typescript
const iterator = readGraphemeClusters(...)
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
```

It also exposes chunk-size tuning:

```typescript
const {
  boost = 2,
  minimumWords = 4,
  maximumWords = 12,
} = options ?? {}
```

And it sanitizes control tokens before TTS:

```typescript
const sanitizeChunk = (text: string) =>
  text
    .replaceAll(TTS_SPECIAL_TOKEN, '')
    .replaceAll(TTS_FLUSH_INSTRUCTION, '')
    .trim()
```

This is useful for Echo because it gives a concrete, proven shape for:

- Unicode-safe chunking
- better first-chunk latency
- keeping control tokens out of raw speech

## What Echo should adopt
- Adopt AIRI's core text-shaping philosophy:
  - grapheme-safe reading
  - word-aware segmentation via `Intl.Segmenter`
  - explicit minimum/maximum chunk sizing
  - early `boost` behavior for the first chunk
- Add a **TTS-only sanitization layer** in Echo that can:
  - remove or map non-speakable symbols
  - strip markdown control syntax while preserving readable text
  - handle emoji in a controlled way
  - preserve Chinese/Japanese/English text content
- Keep visible transcript text untouched.

## What Echo must not copy directly
- Do not transplant AIRI's whole `tts.ts` file or its pipeline framework.
- Do not introduce AIRI-specific control tokens into Echo protocol semantics.
- Do not mutate canonical transcript text just because TTS needs a cleaner
  version.
- Do not silently drop meaningful readable text while sanitizing TTS input.

## Files To Create Or Modify
- [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
- [qwen3_voice_clone_provider.py](/C:/Users/123/Desktop/echo/packages/tts/qwen3_voice_clone_provider.py)
- relevant protocol-safe helpers if needed under existing Echo boundaries
- relevant tests under:
  - [tests/orchestrator](/C:/Users/123/Desktop/echo/tests/orchestrator)
  - [tests/tts](/C:/Users/123/Desktop/echo/tests/tts)

## Hard Requirements
1. Transcript/chat/bubble text must remain canonical and lossless.
2. TTS-facing text may be sanitized only in a dedicated, explicit pipeline.
3. Emoji, markdown markers, and non-speakable symbols must no longer crash TTS
   or produce uncontrolled noise.
4. The chunking strategy must be more language-aware than the current
   character-count heuristic.
5. The implementation must preserve Unicode correctness for Chinese, Japanese,
   English, and mixed text.
6. Do not add fallback "best effort" transcript rewriting.

## Out Of Scope
- desktop realtime playback transport
- audible/visible response source unification
- quick reaction policy changes
- lipsync and face mixing
- same-session context replay

## Validation Expectations
1. Add tests proving canonical transcript text is unchanged while TTS-facing
   text is sanitized separately.
2. Add mixed-language tests including Chinese plus emoji and punctuation.
3. Add tests showing markdown/bullet-heavy text becomes safe TTS input without
   losing readable content.
4. Add tests covering early chunk emission and bounded chunk sizing.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- A reply containing emoji displays normally in chat and no longer crashes or
  produces nonsense speech.
- Chinese and mixed-language responses remain valid Unicode end to end.
- TTS chunks sound like short natural clauses rather than arbitrary text
  buckets.
- Visible assistant text is not silently rewritten just to satisfy TTS.
