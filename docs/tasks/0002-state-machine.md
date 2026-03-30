# Task Card 0002

## Title
实现 `packages/protocol/state_machine.py`

## Role
Implementer

## Goal
根据以下文档，创建 `packages/protocol/state_machine.py` 的第一版实现：

- `docs/protocol/state-machine.md`

要求实现文档中定义的 canonical session state machine 骨架，包括：

- 状态机上下文模型
- 转移规格模型
- 守卫函数
- canonical transition table
- 转移解析辅助函数
- 最小测试覆盖

使用 **Python 3.10+ + Pydantic v2**。

本任务的目标是把状态机的**纯协议/纯判定层**落地为可测试代码；
本任务**不负责** runtime 接线、事件总线、状态持久化、orchestrator 协调或副作用执行。

---

## Scope Clarification
本卡刻意限制在 `state-machine.md` 已明确给出的内容：

- 只实现 `docs/protocol/state-machine.md` 第 6、8、10、11、12、13、14、15 节对应的状态机判定逻辑
- 允许在本文件中定义 `EventType` 字符串常量，且必须与文档 skeleton 完全一致
- 必须从现有 `packages/protocol/events.py` 导入并复用 `SessionStatus`
- 不要修改 `packages/protocol/events.py`
- 不要试图在本卡中补齐 `events.py` 里尚未定义 payload schema 的新增事件对象
- 不要实现状态应用器、事件发射器、runtime session 对象、orchestrator side effects

换句话说：
这张卡只做“**如何判定一个 transition 合法且该落到哪里**”，
不做“**系统如何真正执行这个 transition**”。

---

## Allowed Context
你只能读取以下文件：

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `packages/protocol/events.py`

如果仓库里已存在，也允许读取：

- `packages/protocol/state_machine.py`
- `tests/protocol/test_state_machine.py`

注意：
- 本任务**不允许**读取 `feedback-rules.md`、`orchestrator-spec.md`
- 本任务**不允许**以“顺手补全”为理由扩大到 runtime / orchestrator / renderer / memory

---

## Files To Create Or Modify
只允许创建或修改：

- `packages/protocol/state_machine.py`
- `tests/protocol/test_state_machine.py`

如果目录不存在，可以创建：

- `packages/protocol/`
- `tests/protocol/`

但**不要**创建或修改其他文件。
特别是：

- 不要修改 `packages/protocol/events.py`
- 不要创建 `__init__.py`
- 不要修改任何文档
- 不要创建 runtime / orchestrator / renderer / memory 相关文件

---

## Required Scope
你必须实现 `docs/protocol/state-machine.md` 中定义的以下内容：

### 1. 基础模型配置
- `EchoProtocolModel`

### 2. 事件类型常量
- `EventType`

常量值必须至少包含文档 skeleton 中列出的全部 event type：

- `USER_SPEECH_START`
- `USER_SPEECH_PARTIAL`
- `USER_SPEECH_END`
- `ASSISTANT_QUICK_REACTION_READY`
- `ASSISTANT_RESPONSE_CHUNK`
- `ASSISTANT_RESPONSE_COMPLETED`
- `TTS_CHUNK_QUEUED`
- `TTS_PLAYBACK_STARTED`
- `TTS_PLAYBACK_FINISHED`
- `RENDERER_COMMAND_ISSUED`
- `SYSTEM_INTERRUPT_SIGNAL`
- `SYSTEM_INTERRUPT_APPLIED`
- `SYSTEM_ERROR_RAISED`
- `SYSTEM_RESET_REQUESTED`
- `SESSION_STATE_CHANGED`

### 3. 守卫上下文模型
- `TransitionContext`

### 4. 转移规格模型
- `TransitionSpec`

### 5. 守卫函数
必须实现文档 skeleton 中给出的全部守卫函数：

- `guard_true`
- `guard_no_active_error`
- `guard_finalized_user_turn`
- `guard_playback_started`
- `guard_interrupt_targetable`
- `guard_response_completed_without_playback`
- `guard_playback_finished_clean`
- `guard_interrupt_resolves_to_listening`
- `guard_interrupt_resolves_to_thinking`
- `guard_interrupt_resolves_to_idle`

### 6. 守卫注册表
- `GUARDS`

### 7. Canonical transition table
- `VALID_TRANSITIONS`

必须按文档定义覆盖：

- `idle`
- `listening`
- `thinking`
- `speaking`
- `interrupted`
- `error`

的全部合法转移。

### 8. 转移解析辅助函数
- `get_candidate_transitions`
- `resolve_transition`

---

## Test Scope
在 `tests/protocol/test_state_machine.py` 中补最小单元测试，至少覆盖 `state-machine.md` 第 14 节列出的以下内容：

### 1. Legal transition tests
- `idle + user.speech.start -> listening`
- `listening + user.speech.end -> thinking`
- `thinking + tts.playback.started -> speaking`
- `speaking + user.speech.start -> interrupted`
- `interrupted + system.interrupt.applied (user input active) -> listening`
- `interrupted + system.interrupt.applied (reasoning active, no playback) -> thinking`
- `interrupted + system.interrupt.applied (all clear) -> idle`
- `error + system.reset.requested -> idle`

### 2. Forbidden transition tests
- `idle + tts.playback.started` 不能进入 `speaking`
- `listening + tts.playback.started` 不能进入 `speaking`
- `error + user.speech.start` 不能进入 `listening`
- `speaking + assistant.response.completed` 不能直接进入 `thinking`

### 3. Guard correctness tests
- `thinking + assistant.response.completed` 只有在没有 playback 时才能回到 `idle`
- `speaking + tts.playback.finished` 只有在没有 pending interrupt 时才能回到 `idle`
- `interrupted + system.interrupt.applied` 必须按 guard 顺序解析

---

## Hard Requirements
必须满足以下要求：

1. 严格使用 **Pydantic v2**
2. 本文件中的协议模型必须：
   - `extra="forbid"`
   - `frozen=True`
3. 必须从 `packages.protocol.events` 复用 `SessionStatus`，不允许重新定义状态枚举
4. `EventType` 中的字符串值必须与 `state-machine.md` skeleton 完全一致
5. `TransitionContext` 和 `TransitionSpec` 的字段语义必须与文档一致
6. `VALID_TRANSITIONS` 必须覆盖文档中的全部合法转移，不允许擅自增加 undocumented transition
7. `resolve_transition()` 必须同时基于：
   - 当前状态
   - `trigger_event_type`
   - guard context
   来决策
8. 如果没有合法候选或 guard 全部失败，`resolve_transition()` 必须返回 `None`
9. 不允许把 `session.state.changed` 当作触发器使用；它只能是 effect，不是 transition cause
10. 不允许把内容事件自动等同于状态变化；只有文档转移表明确列出的 event type 才能驱动状态变化
11. 不允许引入新依赖
12. 不允许实现任何副作用逻辑，除纯判定外不要扩展行为

---

## Explicitly Out Of Scope
以下内容明确不在本卡范围内：

- 修改 `packages/protocol/events.py`
- 为 `tts.playback.started`、`assistant.response.completed`、`system.error.raised` 等新增 concrete event class
- 为这些新增 event type 发明 payload schema
- 实现 runtime 中的 session 对象
- 实现真正的状态应用器
- 实现 `session.state.changed` 的发射逻辑
- 实现 orchestrator / interrupt controller / audio mutex
- 实现任何 async 运行时接线

---

## Do Not
禁止做以下事情：

- 不要修改任何 protocol 文档
- 不要修改 `packages/protocol/events.py`
- 不要实现 runtime / orchestrator / renderer / memory
- 不要新增依赖
- 不要安装依赖
- 不要创建 `__init__.py`
- 不要把状态机改成隐式 if/else 散落在业务代码里的模式
- 不要根据外部项目（AIRI / ElizaOS / my-neuro）改写结构
- 不要声称“测试已通过”除非你真的运行了测试

---

## Execution Protocol
开始前必须按 `AGENTS.md` 执行：

1. 先声明你的角色是 `Implementer`
2. 说明你会读取哪些文件
3. 说明你会修改哪些文件
4. 说明你不会修改哪些文件
5. 如果信息不足，明确指出缺失信息；不要猜

特别提醒：
当前文档已经足够定义 `state_machine.py` 的纯判定层；
但**不足以安全定义新增 protocol event 的 payload schema**。
因此本任务内不要越界去“补协议对象”。

---

## Validation Expectations
完成后请尽量做以下验证：

1. 至少做 Python 语法级检查
2. 如果本地环境已有 `pydantic v2`，运行 `tests/protocol/test_state_machine.py`
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

- `packages/protocol/state_machine.py` 已创建
- `tests/protocol/test_state_machine.py` 已创建
- 与 `docs/protocol/state-machine.md` 的字段、转移和 guard 语义一致
- 使用了强类型和 Pydantic v2 风格
- `VALID_TRANSITIONS` 覆盖文档中的全部合法转移
- forbidden transitions 不会被静默接受
- `resolve_transition()` 只做纯判定，不夹带 runtime/orchestrator 副作用
- 没有修改 `packages/protocol/events.py`
- 没有发明文档之外的新 payload schema 或新协议语义