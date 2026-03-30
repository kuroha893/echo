# Protocol 与 Runtime Guide

## 第一部分：面向用户的直观说明

## 这两个模块分别是做什么的？

如果把 Echo 想成一个会“听懂你、理解你、组织回应、再把回应发出去”的系统，那么：

- `packages/protocol` 是 Echo 的“共同语言”和“规则手册”
- `packages/runtime` 是 Echo 的“会话控制壳”和“状态执行层”

它们分工非常明确：

- Protocol 负责定义“什么是合法的输入、输出、状态和事件”
- Runtime 负责把这些规则真正应用到某一轮具体会话里

这样设计的好处是：Echo 不会因为某个适配器、某个模型、某个前端 UI 的变化，就把整个系统的核心行为搞乱。

---

## Protocol 是什么？

`packages/protocol` 可以理解成 Echo 内部所有模块都必须遵守的统一契约。

它主要回答这些问题：

- 一条事件长什么样？
- 会话有哪些标准状态？
- 什么情况下允许从一个状态切到另一个状态？
- 哪些字段必须存在？
- 哪些对象必须强类型、不能随便传一个临时 `dict`？

### Protocol 当前负责的核心内容

1. 事件模型

- 例如：`user.speech.start`
- 例如：`assistant.response.chunk`
- 例如：`tts.playback.started`
- 例如：`system.interrupt.signal`
- 例如：`session.state.changed`

这些事件不是“随便起的名字”，而是 Echo 内部所有模块共享的正式协议面。

2. 会话状态模型

当前 canonical session state 包括：

- `idle`
- `listening`
- `thinking`
- `speaking`
- `interrupted`
- `error`

3. 状态机规则

状态机负责规定：

- 哪些转移合法
- 哪些转移非法
- 触发转移时需要检查哪些 guard 条件
- 每次成功转移之后，必须发出什么 effect

4. 共享协议对象

例如：

- `SessionState`
- `TransitionContext`
- `StateTransition`
- `TTSChunk`
- `RendererCommand`
- `InterruptSignal`

这些对象的意义是：不管是 runtime、orchestrator，还是未来的 adapter，都必须讲同一种“语言”。

### 对用户来说，Protocol 的价值是什么？

虽然你平时不会直接操作 `packages/protocol`，但它决定了 Echo 是否：

- 行为稳定
- 可调试
- 可回放
- 可扩展
- 不会出现“同一件事在不同模块里说法不一样”的问题

换句话说，Protocol 决定的是 Echo 的“底层一致性”。

---

## Runtime 是什么？

`packages/runtime` 是 Echo 在“单个 session 维度”上的控制层。

它不负责决定角色怎么说话，也不负责设备播放音频，更不负责 UI 动画策略。它负责的是：

- 当前这一个会话现在处于什么状态
- 收到一条正式协议事件之后，状态该不该变化
- 变化后要不要产出 `session.state.changed`
- 为状态机 guard 准备一份当前可用的上下文快照

你可以把 Runtime 理解成：

“把 Protocol 里的抽象规则，真正落实到某一个具体会话上”的那一层。

### Runtime 当前的核心组件

1. `state_driver.py`

它只做一件事：

- 给它一个当前 `SessionState`
- 给它一条 `ProtocolEvent`
- 再给它一份 `TransitionContext`
- 它就去问状态机：这次转移是否合法

如果合法：

- 更新状态
- 生成一个标准的 `session.state.changed`

如果不合法：

- 状态不变
- 不产生额外 effect

2. `session_runtime.py`

它是一个很小的 session shell，负责：

- 持有当前 `SessionState`
- 接收单条协议事件
- 调用 `state_driver`
- 把产生的 `session.state.changed` 放进本地 outbox

这意味着 Runtime 已经具备“逐条摄入事件、维护会话状态”的最小能力。

3. `transition_context_tracker.py`

它负责持续记录状态机 guard 需要的“可观测事实”，例如：

- 用户现在是不是正在说话
- 当前用户发言是不是已经 finalized
- TTS 有没有待播 chunk
- 当前是不是正在播放
- 当前 response stream / TTS stream 是谁
- 有没有 pending interrupt

它不直接修改 `SessionState.status`，而是专门负责生成一份标准 `TransitionContext` 给状态机判断用。

---

## Protocol 和 Runtime 是怎么配合的？

可以把它理解成一条非常克制的链路：

1. 系统收到一条 typed protocol event
2. Runtime 先更新与 guard 有关的上下文事实
3. Runtime 根据当前 `SessionState` 生成 `TransitionContext`
4. `state_driver` 调用状态机判断本次是否允许转移
5. 如果允许，就更新会话状态
6. Runtime 把 resulting `session.state.changed` 放进 outbox
7. 其他外层系统以后再决定要不要转发到日志、总线或适配器

这里最关键的点是：

- Protocol 负责“定义规则”
- Runtime 负责“执行规则”
- Orchestrator 负责“调度与时序”
- Adapter 负责“连真实设备或外部系统”

每层职责都不一样，尽量不混。

---

## 为什么要把 Protocol 和 Runtime 拆开？

因为 Echo 不是一个只跑一次请求的普通问答程序，而是一个要长期稳定运行的实时 companion runtime。

拆开之后有几个明显好处：

### 1. 更容易保证行为一致

只要事件和状态规则都在 Protocol 里先定义清楚，Runtime、Orchestrator、Adapter 就不会各自发明一套说法。

### 2. 更容易做状态安全和中断安全

实时 companion 最怕的是：

- 明明还在播音，系统却以为自己已经 `idle`
- 明明用户打断了，内部状态却没有及时收口
- 明明事件已经发生，状态机却没有看到完整上下文

Runtime 的存在，就是为了减少这种“隐藏状态漂移”。

### 3. 更容易测试和回放

当状态变化是由：

- typed event
- typed context
- canonical transition rules

共同决定时，系统会更容易重现和排查问题。

### 4. 更容易替换外层实现

以后不管接的是哪种 STT、TTS、renderer、桌面前端，只要它们最终都通过 Protocol 和 Runtime 这层边界，Echo 的核心逻辑就更稳。

---

## 目前这两个模块已经能做什么？

从当前文档和实现来看，Protocol + Runtime 已经具备这些基础能力：

- 定义正式协议事件与共享对象
- 定义 canonical session state machine
- 对单条事件做合法转移判定
- 更新某个 session 的当前状态
- 在成功转移后产生标准 `session.state.changed`
- 记录状态机 guard 需要的 session-local observable facts
- 为后续更完整的 runtime ingress / routing 提供基础壳层

---

## 目前它们还刻意“不做什么”？

为了保证边界清晰，这两个模块故意不把所有东西都塞进去。

### Protocol 不做的事

- 不做 adapter 逻辑
- 不做 orchestration 时序控制
- 不做设备播放
- 不做业务策略执行

### Runtime 现在还不做的事

- 不直接实现 orchestrator
- 不直接接 STT / TTS / renderer 设备
- 不做 event bus 集成
- 不做持久化
- 不做 memory / plugin 业务逻辑

这不是缺功能，而是有意保持“核心规则层”和“设备/业务层”分离。

---

## 作为用户，你可以把它理解成什么？

最简单的理解方式是：

- Protocol 决定 Echo “什么叫规范、什么叫合法”
- Runtime 决定 Echo “在一轮会话里到底发生了什么、状态该怎么变”

前者更像交通规则，后者更像真正执行交通规则的路口控制系统。

正因为这两层先被拆清楚，Echo 后面不管是接桌宠前端、Live2D、语音链路、工具调用还是 memory 系统，都会更稳，也更不容易出现“看起来能跑，但内部已经乱了”的问题。

---

## 第二部分：面向协作人类开发者的系统说明

## 这份开发者版说明的定位

上半部分是“帮助理解为什么要有 protocol 和 runtime”。
下半部分面向协作开发者，重点回答这些更实际的问题：

- Echo 当前的系统边界到底怎么切？
- 哪些模块已经落地，哪些是明确预留的架构位？
- 数据、状态、调度、设备控制分别归谁管？
- 后续改动某个模块时，应该先动哪一层？

这部分的目标不是替代正式规范，而是帮助人更快地理解正式规范之间的关系。

---

## 一张图先看全局

如果用一句话概括 Echo 的核心分层：

- `protocol` 定义统一契约
- `runtime` 维护 session 级真相
- `orchestrator` 负责多任务调度、打断和输出协调
- `stt` / `tts` / `renderer` 是设备与模型适配层
- `memory` 负责长期记忆与规则检索/写回
- `plugin-sdk` 负责插件边界与扩展机制

当前仓库里已经实际落地的核心包主要是：

- `packages/protocol`
- `packages/runtime`
- `packages/orchestrator`

其余模块虽然还没有完全落地，但在架构上已经有明确边界，不应该让现有模块提前吞掉它们的职责。

---

## Source of Truth 的优先级

合作开发时一定要先记住这件事：

1. `AGENTS.md`
2. `docs/governance/ai-engineering-constitution.md`
3. `docs/protocol/*.md`
4. 当前任务卡或当前明确工作目标
5. 现有实现

这意味着：

- 代码不是第一真相
- 方便不是第一真相
- “先写再说”在 Echo 里不是默认策略

尤其是共享语义，例如事件、状态、转移、工具调用、反馈规则，必须先通过 protocol 文档和协议对象固定下来。

---

## 全模块职责地图

## 1. `packages/protocol`

这是 Echo 的强约束层。

职责：

- 定义事件 envelope 和 payload
- 定义 canonical session state
- 定义状态机和 guard context
- 定义 feedback rule、tool loop 等共享协议对象

边界：

- 不做 runtime 逻辑
- 不做 orchestrator 时序
- 不做 adapter 调用
- 不做持久化

设计价值：

- 让所有其他模块都依赖同一套 typed contract
- 防止跨模块用 ad-hoc `dict` 传参
- 为 replay、trace、测试和重构提供稳定地基

## 2. `packages/runtime`

这是 Echo 的 session-owned 控制层。

职责：

- 持有每个 session 的当前 `SessionState`
- 接收 typed protocol event
- 维护 session-local guard facts
- 通过 `state_driver` 执行 canonical 状态变更
- 保存 runtime 层的 typed outbox

当前已落地的最小能力：

- `state_driver.py`
- `session_runtime.py`
- `transition_context_tracker.py`

边界：

- 不负责 quick reaction vs primary response 的调度
- 不负责音频互斥策略
- 不负责设备播放
- 不负责插件工具执行

一句话理解：

Runtime 关心“这个 session 现在到底处于什么状态，以及为什么”。

## 3. `packages/orchestrator`

这是 Echo 的时序与调度层。

职责：

- dual-track 并发
- quick reaction 和 primary response 的协同
- expression parsing
- audio mutex
- handoff、interrupt、buffer、replace
- turn-level protocol event outbox

它解决的是：

- 谁先说
- 什么时候切换
- 能不能打断
- 文本流如何变成 TTS 和 renderer 指令

边界：

- 不拥有 canonical session state machine 语义
- 不应直接篡改 runtime 状态真相
- 不应把播放设备逻辑写死在调度层

一句话理解：

Orchestrator 关心“这一轮对话怎么并发推进、怎么协调输出、怎么安全打断”。

## 4. `packages/stt`

这是未来的输入适配层。

职责应包括：

- VAD
- streaming STT
- 把原始语音输入转成 typed protocol event

边界：

- 不决定 session 状态迁移规则
- 不决定 orchestrator 调度策略
- 不直接持有全局业务状态

## 5. `packages/tts`

这是未来的语音输出适配层。

职责应包括：

- 文本 chunking
- TTS provider 适配
- 播放生命周期事件回传

边界：

- 不拥有音频仲裁策略
- 不自己决定 interrupt policy
- 不自己推进 session state

## 6. `packages/renderer`

这是未来的角色表现适配层。

职责应包括：

- Live2D / VTS / Web renderer 抽象
- expression / motion / mouth-open 等命令执行
- renderer 生命周期或错误边界

边界：

- 不直接参与状态机决策
- 不把 renderer transport 细节泄漏回 protocol

## 7. `packages/memory`

这是未来的长期记忆与调教规则层。

职责应包括：

- memory retrieval
- memory writeback
- feedback rule 检索与应用准备
- 用户偏好、规则、摘要等长期信息管理

边界：

- 不阻塞实时主链路
- 不直接接管 runtime 状态
- 不直接侵入 orchestrator 的调度策略

## 8. `packages/plugin-sdk`

这是未来的扩展能力边界层。

职责应包括：

- 插件 manifest
- hook / lifecycle
- 插件能力暴露的统一约束

边界：

- 插件不能绕开 protocol/runtime/orchestrator 核心边界
- 插件不能直接改私有 session 状态

---

## 当前系统里最关键的共享对象

跨模块协作时，建议优先记住以下对象，因为它们是很多边界的“公共词汇”：

- `ProtocolEvent`
- `SessionState`
- `TransitionContext`
- `StateTransition`
- `RecognizedUtterance`
- `ResponseTextChunk`
- `TTSChunk`
- `RendererCommand`
- `InterruptSignal`
- `FeedbackRule`

如果某个新功能跨了多个模块，而你发现它没有落在这些对象或相邻协议对象上，大概率说明边界还没有设计清楚。

---

## 当前推荐的数据与控制流

一个理想化但符合当前设计方向的链路，大致应该是：

1. 输入侧把原始输入归一化为 `ProtocolEvent`
2. Runtime 在 session 维度更新上下文事实并构建 `TransitionContext`
3. `state_driver` 基于状态机决定是否产生状态变化
4. Runtime 把 resulting `session.state.changed` 放入 outbox
5. Orchestrator 根据已接受的 turn 和状态，推进 dual-track 输出
6. Orchestrator 把文本拆成 renderer command 与 TTS chunk
7. TTS / renderer adapter 执行具体外部动作
8. 播放生命周期事件再回到 protocol/runtime/orchestrator 路径中，维持真相闭环

这条链路的关键不是“快”，而是：

- typed
- deterministic
- replay-friendly
- interrupt-safe

---

## Feedback Rule、Tool Loop 和 Runtime 的关系

这三个东西非常容易被混在一起，协作开发时尤其要小心。

### Feedback Rule

它首先是 protocol 问题：

- 规则怎么表示
- scope 怎么匹配
- intensity 怎么编译

真正落地时，它会横跨：

- memory
- runtime context
- orchestrator prompt construction
- TTS / renderer 风格控制

### Tool Loop

它首先也是 protocol 问题：

- tool request/result/failure/cancel 如何协议化
- reasoning step 怎样受控
- tool decision 和 tool execution 如何解耦

真正落地时，它会横跨：

- primary reasoning
- runtime tool boundary
- plugin 或 memory 工具
- outbox / replay / audit

### Runtime 在这里做什么？

Runtime 不应该吞掉 feedback rule 或 tool loop 的核心业务语义。
它更多是：

- 维护 session-owned state truth
- 提供输入事件和状态应用的稳定壳层
- 为后续更复杂的 routing / persistence 做边界准备

---

## 为什么 Echo 要坚持“先协议、再 runtime、再调度、最后适配器”？

因为 Echo 的目标不是“先把一个 demo 跑起来”，而是做一个长期可扩展、可打断、可调试的 companion runtime。

如果顺序反过来，常见后果会是：

- 先写 adapter，最后协议跟着 adapter 走
- 先写 orchestrator，最后 runtime 只能被动兜底
- 先写业务逻辑，最后状态机只能事后补文档

Echo 当前强调的顺序，本质上是在压制这些高概率问题：

- 语义漂移
- 包边界腐烂
- 打断不安全
- 调试和回放困难

---

## 给协作开发者的具体工作建议

### 如果你要改 Protocol

先问：

- 这是不是共享语义？
- 它会不会被 runtime、orchestrator、adapter 同时依赖？

如果答案是“会”，那就应该先改协议文档和协议对象，而不是先改业务代码。

### 如果你要改 Runtime

先问：

- 这是 session-owned truth 吗？
- 这是状态应用或 guard context 的问题吗？
- 这会不会让 runtime 偷偷长成一个 event bus 或 orchestrator？

如果已经开始碰调度策略、播放仲裁或 provider 细节，通常说明这活不该写在 runtime。

### 如果你要改 Orchestrator

先问：

- 这是 dual-track、interrupt、handoff、audio ownership 的问题吗？
- 这是否会绕开 protocol/runtime 的 typed boundary？

如果需要引入新 control event 或 lifecycle event，先回 protocol。

### 如果你要接外部技术

先问：

- 这是 adapter 问题，还是核心架构问题？
- 有没有先完成 reference note？
- 有没有已经存在的 protocol 边界可挂接？

外部项目、外部 SDK、外部 provider 都不应该直接决定 Echo 核心结构。

---

## 当前仓库的现实状态与下一步协作重点

从当前仓库结构看，Echo 的“内核三件套”已经开始成型：

- `protocol`
- `runtime`
- `orchestrator`

这意味着接下来的高价值协作方向通常不是“继续把某一层写胖”，而是：

- 让三层边界继续清晰
- 让 runtime 更少依赖外部手工上下文
- 让 orchestrator 继续通过 typed protocol event 与 runtime 对接
- 在真正进入 adapter / tooling / memory 之前，把参考资料和协议边界补齐

对合作开发者来说，最重要的不是一下子把所有能力都补上，而是：

- 每新增一个能力，都知道它应该住在哪一层
- 每新增一个字段或事件，都知道它是不是共享协议语义
- 每接一个外部系统，都知道它应该接在 adapter 边界，而不是反过来改 Echo 核心

---

## 最后给合作开发者的一句话

如果你把 Echo 看成一个桌宠项目，很容易把很多东西揉成一团。
但如果你把 Echo 看成一个“实时 companion runtime 内核”，它的架构取向就会清楚很多：

- Protocol 保证系统说的是同一种话
- Runtime 保证单个 session 的真相稳定
- Orchestrator 保证实时调度和打断安全
- Adapter / Memory / Plugin 保证系统最终能接入现实世界和扩展能力

只要这四层关系不乱，Echo 后面继续长功能，成本就会低很多。
