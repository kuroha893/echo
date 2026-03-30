# LLM Prompt Boundary

## Purpose

This document defines what `packages/llm` may consume from prompt compilation
and what it must not absorb.

This is necessary because the constitution already reserves:

- `packages/prompts` for prompt templates and rule compilation
- `docs/protocol/feedback-rules.md` for `PromptCompiler` semantics

---

## What LLM May Receive

`packages/llm` may receive already-assembled prompt materials such as:

- `system_instructions`
- `developer_instructions`
- ordered `LLMMessage` conversation items
- already-compiled feedback-rule tail text

These are treated as inputs, not as things the llm package owns.

---

## What LLM Must Not Own

`packages/llm` must not own:

- raw `FeedbackRule` retrieval
- rule scope matching
- intensity bucketing
- `PromptCompiler`
- provider-specific prompt JSON templates
- long-lived prompt storage

Those belong to:

- `packages/memory`
- later `packages/prompts`
- `docs/protocol/feedback-rules.md`

---

## v0.1 Practical Rule

Until `packages/prompts` exists, the llm package may still accept:

- caller-assembled instruction strings
- caller-assembled ordered messages

But that does not mean the llm package is now the prompt compiler.

The boundary stays:

- caller assembles
- llm transports

---

## Feedback Rule Integration

`docs/protocol/feedback-rules.md` already defines that:

- intensity is compiled semantically
- compiled prompt fragments are plain text
- the compiled tail is appended near the end of the effective system/policy prompt

Therefore llm work must assume:

- compiled rule text may be passed into `system_instructions`
- llm transport should preserve it exactly
- llm transport must not reinterpret it into provider-specific schema at the core boundary

---

## First Demo Rule

For the first demo path:

- prompt assembly may stay simple
- the llm package must still keep the prompt boundary clean

That means demo-driven llm tasks may use:

- a small caller-assembled system prompt
- a small ordered message list

but must not quietly turn `packages/llm` into a dumping ground for prompt
compilation logic.
