# Reference Intake: sglang-local-fast-path

## Scope
- Study only the parts of `sglang-main` that are relevant to Echo's planned local fast-path model line.
- Focus on:
  - local OpenAI-compatible serving
  - low-latency small-model deployment shape
  - streaming text output compatibility
  - structured-output potential for hidden intent routing
  - multimodal/image input potential for later screenshot questions
- Exclude:
  - distributed serving architecture
  - large-scale scheduling internals
  - multimodal generation pipelines
  - training / RL / post-training infrastructure
  - any direct reuse of SGLang internal server or parser code

## What Was Studied
- `docs/reference/sglang-main/README.md`
- `docs/reference/sglang-main/docs/README.md`
- `docs/reference/sglang-main/docs/basic_usage/openai_api.rst`
- `docs/reference/sglang-main/docs/basic_usage/qwen3_5.md`
- `docs/reference/sglang-main/docs/advanced_features/server_arguments.md`
- `docs/reference/sglang-main/python/sglang/srt/entrypoints/http_server.py`
- `docs/reference/sglang-main/python/sglang/srt/entrypoints/openai/serving_responses.py`
- Echo-local comparison inputs:
  - `docs/llm/README.md`
  - `docs/llm/provider-interface.md`
  - `docs/llm/demo-path.md`
  - `docs/llm/openai-responses-provider.md`
  - `docs/protocol/orchestrator-spec.md`
  - `docs/runtime/README.md`

## Potentially Reusable Ideas
- Treating `sglang` as a local inference **backend service**, not as an internal Echo library.
  - This aligns with Echo's `packages/llm` boundary because Echo already owns:
    - route semantics
    - request/response contracts
    - orchestrator policy
  - SGLang can sit behind a concrete provider adapter via explicit `base_url`, model name, and timeout config.
- Using a **small local instruct model** for low-latency front-path behavior.
  - The SGLang docs explicitly recommend small models such as `qwen/qwen2.5-0.5b-instruct` for fast startup and fast local iteration.
  - This is directly compatible with Echo's desired "fast filler / quick reaction / hidden routing" layer.
- Reusing a **long-lived local server** rather than repeatedly launching inference processes.
  - SGLang's docs recommend reusing a launched server to reduce launch overhead.
  - For Echo, this is useful for:
    - standby presence
    - low-latency quick reaction
    - local intent routing
- Using an **OpenAI-compatible endpoint family** as the integration seam.
  - SGLang exposes `POST /v1/chat/completions`.
  - SGLang also exposes `POST /v1/responses`.
  - This suggests Echo should prefer a provider family defined by:
    - explicit OpenAI-compatible text generation
    - explicit base URL injection
    - no direct dependency on SGLang internals
- Using **structured-output capability** conceptually for hidden intent-routing output.
  - SGLang documents structured outputs / JSON-schema-constrained generation.
  - This is potentially useful for a future Echo-local `intent_routing` route that returns:
    - route decision
    - urgency
    - whether to trigger quick reaction only
    - whether to escalate to cloud reasoning / tool path
- Reserving **image input support** for later screenshot questions.
  - SGLang exposes OpenAI-compatible image input patterns such as `image_url`.
  - This is relevant to Echo's planned screenshot-triggered question flow, but only after Echo defines its own multimodal input contracts.

## Reference-Only Ideas
- SGLang's broad server-argument surface.
  - Useful as a menu of deployment knobs:
    - timeout
    - streaming interval
    - deterministic inference
    - concurrency limits
  - Not suitable to mirror directly inside Echo's provider config.
  - Echo should only adopt a narrow subset that is required by its provider boundary.
- SGLang's support for both `/v1/chat/completions` and `/v1/responses`.
  - Useful because it shows the backend can satisfy multiple OpenAI-style API families.
  - For Echo's future hybrid local/cloud topology, this is only a reference point.
  - Echo should not assume that every local backend will support `/v1/responses` equally well.
- Structured-output and tool-calling support in SGLang.
  - Useful as evidence that local small-model serving can eventually support hidden structured control outputs.
  - Not yet aligned with Echo's current llm docs because Echo has not formally introduced:
    - an `intent_routing` route
    - local tool-call execution through `reasoning-tool-loop.md`
- Vision / multimodal support.
  - Useful as a reference that the same serving family can later support screenshot-style image questions.
  - Still only reference-only until Echo defines:
    - screenshot input contracts
    - multimodal llm provider contracts
    - user-consented screenshot flow

## Forbidden To Copy
- Any direct reuse of `sglang` internal server structure, including:
  - `python/sglang/srt/entrypoints/http_server.py`
  - `python/sglang/srt/entrypoints/openai/serving_responses.py`
  - internal parser / scheduler / request-manager code
- Any attempt to embed SGLang's scheduling, batching, disaggregation, or cache-management architecture into Echo runtime or orchestrator.
- Any direct copying of SGLang's tool-calling semantics, parser logic, response handlers, or request envelopes into Echo protocol or llm contracts.
- Any design move that makes Echo depend on SGLang-specific internal modules instead of treating SGLang as an external backend behind Echo-owned provider ports.

## Compatibility With Echo
- aligned:
  - Echo wants a low-latency local fast path and SGLang is explicitly designed for low-latency serving.
  - Echo already isolates model transport under `packages/llm`, which is the correct place to integrate a local SGLang-backed provider.
  - Echo's current route split can naturally map to a hybrid topology:
    - local fast path for quick reaction
    - local hidden routing later
    - cloud path for primary response or heavy reasoning
  - SGLang's OpenAI-compatible serving shape is compatible with Echo's explicit provider config and adapter boundary.
- conflicts:
  - Echo's current llm docs chose the official OpenAI Responses API as the first concrete provider family for the demo path.
  - SGLang's most portable local seam is its OpenAI-compatible serving layer, especially `/v1/chat/completions`; treating SGLang as if it were the same thing as the official OpenAI Responses transport would overfit the local backend.
  - Echo currently has no first-class `intent_routing` route, so the user's intended hidden routing layer is not yet represented in local llm docs.
  - Echo's tool execution is governed by `docs/protocol/reasoning-tool-loop.md`; SGLang's internal tool-call support must not redefine that boundary.
  - Echo has not yet defined multimodal screenshot-input contracts, so SGLang's image-input support cannot be adopted directly yet.

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs plus this note.
- Do not code directly from the `sglang-main` repository structure or source files.
- If Echo adopts SGLang for the local fast path, treat it as:
  - an external local inference server
  - reached through an Echo-owned provider adapter
  - configured through explicit typed config
- Do not import or mirror SGLang internal server classes into Echo.
- Before implementation, Echo should first update local llm docs to add:
  - a hybrid local/cloud topology
  - a first-class hidden `intent_routing` route or an explicitly documented alternative
  - a local OpenAI-compatible provider family distinct from the already implemented official OpenAI Responses provider
- Screenshot-question support should remain a later line:
  - only after Echo defines multimodal screenshot-input contracts
  - and only with explicit user-triggered capture semantics
