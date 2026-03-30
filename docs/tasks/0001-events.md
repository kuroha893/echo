# Task Card 0001

## Title
实现 `packages/protocol/events.py` v0.1 最小协议骨架

## Role
Implementer

## Goal
根据以下文档，为 `packages/protocol/events.py` 创建第一版实现骨架：

- `docs/protocol/events.md`

要求实现文档中定义的核心协议对象、枚举、事件基类和 v0.1 最小核心事件集，使用 **Python 3.10+ + Pydantic v2**。

本任务**只实现** `docs/protocol/events.md` 中已经定义的最小事件协议面。
本任务**不负责**补齐状态机闭环所需的后续 lifecycle/control 事件；那些事件将在后续任务卡中实现。

---

## Scope Clarification
本卡刻意限制在 `events.md` 的最小范围内：

- 只实现 `docs/protocol/events.md` 第 6、7、8、13 节对应的 v0.1 最小集合
- 不提前实现后续文档中标注为 “next patch” 的新增事件
- 尽量贴近 `events.md` 给出的 copyable Python skeleton
- 只允许为文档一致性、Pydantic v2 正确性、类型安全、校验正确性做最小修正

---

## Allowed Context
你只能读取以下文件：

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`

如果仓库里已存在，也允许读取：

- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

注意：
- 本任务**不允许**为了“顺手补全”去读取 `state-machine.md`、`feedback-rules.md`、`orchestrator-spec.md`
- 跨文档的任务排序与边界已经由架构师在本卡中处理，不需要实现者重新定义

---

## Files To Create Or Modify
只允许创建或修改：

- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

如果目录不存在，可以创建：

- `packages/protocol/`
- `tests/protocol/`

但**不要**创建或修改其他文件。
特别是：

- 不要创建 `__init__.py`
- 不要创建 `state_machine.py`
- 不要创建 `feedback_rules.py`
- 不要创建 orchestrator 相关文件
- 不要修改任何文档

---

## Required Scope
你必须实现 `docs/protocol/events.md` 中定义的以下内容：

### 1. 基础模型配置
- `EchoProtocolModel`

### 2. 核心枚举
- `EventPriority`
- `SourceType`
- `SessionStatus`
- `InterruptionPolicy`
- `RendererCommandType`

### 3. 核心数据模型
- `EmotionTag`
- `RecognizedUtterance`
- `QuickReaction`
- `ResponseTextChunk`
- `TTSChunk`
- `RendererCommand`
- `InterruptSignal`
- `StateTransition`
- `SessionState`

### 4. 事件基类
- `BaseEvent`

### 5. 核心事件类型
- `UserSpeechStartPayload`
- `UserSpeechStartEvent`
- `UserSpeechPartialEvent`
- `UserSpeechEndEvent`
- `QuickReactionReadyEvent`
- `AssistantResponseChunkEvent`
- `TTSChunkQueuedEvent`
- `RendererCommandIssuedEvent`
- `InterruptSignalEvent`
- `SessionStateChangedEvent`

### 6. 事件联合类型
- `ProtocolEvent`

### 7. 最小测试覆盖
在 `tests/protocol/test_events.py` 中补最小单元测试，至少覆盖：

- `source` 格式校验
- naive datetime 被拒绝
- `InterruptSignal(policy=cut_after_chunk)` 缺少 `cut_after_chunk_index` 时校验失败
- `ProtocolEvent` 可按 `event_type` 做 discriminator 解析的基本 smoke case

---

## Hard Requirements
必须满足以下要求：

1. 严格使用 **Pydantic v2**
2. 所有 datetime 字段必须是 **timezone-aware**，并在模型中归一化到 **UTC**
3. 所有协议模型必须：
   - `extra="forbid"`
   - `frozen=True`
4. 所有核心枚举值必须与文档完全一致
5. `BaseEvent` 必须包含：
   - `event_id`
   - `event_type`
   - `timestamp`
   - `trace_id`
   - `session_id`
   - `source_type`
   - `source`
   - `priority`
   - `causation_event_id`
   - `payload`
   - `metadata`
6. `TTSChunk` 和 `ResponseTextChunk` 必须保留：
   - `chunk_index`
   - `is_interruptible`
7. `SessionStatus` 不允许增加额外状态
8. `source` 必须有格式校验
9. 具体事件类的 `payload` 必须使用强类型协议对象；**不要**在具体事件里用 ad-hoc `dict` 代替 payload
10. `metadata` 可以保持文档定义的结构化 `dict[str, Any]`
11. 不允许擅自添加文档里没有定义的新字段或新事件类型
12. 不允许在 protocol model 里编码业务逻辑，除字段/一致性校验外不要扩展行为

---

## Explicitly Out Of Scope
以下内容明确不在本卡范围内：

- `tts.playback.started`
- `tts.playback.finished`
- `assistant.response.completed`
- `system.interrupt.applied`
- `system.error.raised`
- `system.reset.requested`
- `tts.chunk.started`
- `tts.chunk.finished`

这些事件将在后续任务卡里补入 `events.py`，不要提前实现。

---

## Do Not
禁止做以下事情：

- 不要修改任何 protocol 文档
- 不要实现 `state_machine.py`
- 不要实现 `feedback_rules.py`
- 不要实现 orchestrator
- 不要新增依赖
- 不要安装依赖
- 不要重命名文档中的字段
- 不要把事件系统改成 dataclass
- 不要根据外部项目（AIRI / ElizaOS / my-neuro）改写结构
- 不要创建新的 public API 聚合文件
- 不要声称“测试已通过”除非你真的运行了测试

---

## Execution Protocol
开始前必须按 `AGENTS.md` 执行：

1. 先声明你的角色是 `Implementer`
2. 说明你会读取哪些文件
3. 说明你会修改哪些文件
4. 说明你不会修改哪些文件
5. 如果信息不足，明确指出缺失信息；不要猜

---

## Validation Expectations
完成后请尽量做以下验证：

1. 至少做 Python 语法级检查
2. 如果本地环境已有 `pydantic v2`，运行 `tests/protocol/test_events.py`
3. 如果本地缺少 `pydantic` 或测试条件不足：
   - 不要安装依赖
   - 不要伪造测试结论
   - 明确写出“哪些验证未运行，以及原因”

---

## Output Format
完成后必须按这个格式汇报：

1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

---

## Acceptance Criteria
只有满足以下条件，任务才算完成：

- `packages/protocol/events.py` 已创建
- `tests/protocol/test_events.py` 已创建
- 与 `docs/protocol/events.md` 的字段和语义一致
- 使用了强类型和 Pydantic v2 风格
- 代码结构清晰，没有越界实现
- 没有提前实现后续任务的 lifecycle/control 事件
- 没有引入额外架构改动
- 没有发明文档之外的新协议语义