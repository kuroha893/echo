# Echo AI 开发规范与工程宪法

> 用途：本文件是 **Project Echo** 的最高优先级工程规范，用于约束人类开发者与 AI 编程助手（如 ChatGPT、Codex、Copilot、Claude、Cursor、Cline、Continue 等）在本项目中的行为。
> 目标：最大限度降低 AI 幻觉、擅自猜测、越权设计、接口漂移、重复造轮子、无测试提交等问题。
> 适用范围：本仓库内所有代码、文档、配置、测试、脚本、接口协议、插件与角色配置。

------

# 0. 项目一句话定义

**Echo 是一个面向实时陪伴场景的开源低延迟 Agent Runtime。**

它不是普通问答机器人，不是单一桌宠应用，不是单一模型壳子，而是一个可扩展运行时：

- 核心目标：低延迟、可中断、可表达、可记忆、可调教
- 主能力：Live2D、STT、TTS、长期记忆、用户反馈调教
- 次能力：麻将陪玩、代码陪写、网页吐槽、屏幕理解等插件能力

------

# 1. 最高优先级行为规则（Non-Negotiable Rules）

以下规则高于一切实现偏好。任何 AI 或开发者都不得违反。

## 1.1 不得猜测

AI **不得**在没有证据的情况下擅自：

- 假设文件存在
- 假设函数签名
- 假设第三方库 API
- 假设配置字段
- 假设目录结构
- 假设测试结果
- 假设运行环境
- 假设用户意图之外的需求

若信息不足，只允许做以下三件事之一：

1. 从现有仓库文件中查证
2. 在同一任务中明确标注“待确认假设”
3. 先实现最小、可替换、低耦合的占位接口，并明确写入 `TODO` 与文档

**禁止行为示例：**

- “我猜你应该想用 FastAPI，所以我已经改成 FastAPI”
- “我假设 `EventBus.publish()` 返回布尔值”
- “我认为 memory 模块后面会需要 Redis，所以先接进去”

## 1.2 不得擅自改架构

AI **不得**未经明确批准就：

- 改动 monorepo 顶层布局
- 合并或拆分核心包
- 替换核心技术路线
- 引入大型新依赖
- 修改协议层数据结构
- 改变事件流方向
- 改变状态机语义

允许的改动仅限：

- 当前任务直接要求的局部实现
- 明确标注为“局部重构”的小范围整理
- 不影响公共接口的内部优化

## 1.3 不得假装完成

AI **不得**声称以下内容已经完成，除非确实完成并可验证：

- “已经支持流式 TTS”
- “已经完成插件系统”
- “测试全部通过”
- “项目可以运行”
- “已兼容某模型/某平台”

任何“完成”声明都必须伴随：

- 实际变更文件
- 验证方法
- 已知限制

## 1.4 不得越权扩展需求

AI **不得**主动把当前任务扩展成额外大任务，例如：

- 用户要求写 protocol，AI 却重写整个 runtime
- 用户要求修一个 bug，AI 顺便重构全部目录
- 用户要求加一个字段，AI 额外引入数据库迁移系统

默认原则：**只做被要求的，除非额外改动是完成该任务的必要条件。**

## 1.5 不得隐藏风险

AI 在输出代码、方案、重构、文档时，必须显式指出：

- 哪些地方已确定
- 哪些地方是占位设计
- 哪些地方需要后续接真实后端
- 哪些地方未测试
- 哪些地方有技术债

------

# 2. 信息源优先级（Source of Truth Hierarchy）

当信息冲突时，严格按以下优先级处理：

1. 本文件 `AI 开发规范与工程宪法`
2. 仓库中的接口协议文档与 RFC
3. 当前任务中用户的最新明确要求
4. 现有代码实现
5. 测试代码中的预期行为
6. README / 注释 / issue 文案
7. AI 自身经验与常识

若低优先级内容与高优先级冲突，必须服从高优先级。

------

# 3. 项目边界（What Echo Is / Is Not）

## 3.1 Echo 是什么

Echo 是：

- 一个 **runtime-first** 的工程
- 一个实时陪伴 Agent 的运行时基座
- 一个以事件驱动为核心的多循环系统
- 一个可扩展插件平台
- 一个强调低延迟首反应的系统

## 3.2 Echo 不是什么

Echo 不是：

- 单一前端应用
- 单一模型封装器
- 单一 TTS 或 STT 工具
- 单一桌宠皮肤项目
- 面向作弊或未授权自动化的工具
- 默认与任何商业 API 深度绑定的系统

------

# 4. 总体架构原则

## 4.1 四循环模型

Echo 的核心由四个逻辑循环构成：

### A. Realtime Loop

负责低延迟主链路：

- VAD
- Streaming STT
- 本地 drafter / quick reaction
- 打断控制
- TTS chunk 推送
- renderer 的快速状态切换

### B. Reasoning Loop

负责复杂推理：

- 主 LLM 回复
- 工具调用
- RAG 检索
- 代码分析
- 麻将分析
- 屏幕理解后解释

### C. Expression Loop

负责表达：

- 文本切块
- 情绪标签提取
- TTS 请求
- 口型与表情映射
- 动作指令

### D. Memory Loop

负责异步记忆：

- 会话摘要
- 用户事实提炼
- 规则提炼
- 调教烈度规则写入
- 检索与注入

## 4.2 低延迟原则

系统优先追求：

1. 首个可感知反应快
2. 主回答可以稍慢但必须流式
3. 慢任务绝不阻塞实时任务

## 4.3 插件原则

麻将、代码陪写、网页吐槽、屏幕理解都属于插件，不允许写死在核心流程中。

------

# 5. Monorepo 固定布局

除非有明确批准，不得擅自更改以下顶层结构：

```text
/apps
/packages
/plugins
/docs
/scripts
/tests
/models
```

## 5.1 apps

- `apps/desktop`：桌面端壳层
- `apps/web-ui`：Web 控制台与调试界面
- `apps/devtools`：事件观察、音频调试、trace 可视化等

## 5.2 packages

- `packages/protocol`：协议层，定义所有共享类型
- `packages/runtime`：核心运行时与状态驱动
- `packages/orchestrator`：四循环调度与抢占策略
- `packages/stt`：STT/VAD 适配层
- `packages/tts`：TTS 适配层与音频队列
- `packages/llm`：LLM 适配层
- `packages/memory`：长期记忆与规则系统
- `packages/renderer`：Live2D/VTS/Web 渲染器适配层
- `packages/perception`：OS observer / browser bridge / screen capture
- `packages/plugin-sdk`：插件开发 SDK
- `packages/prompts`：提示词模板与规则编译
- `packages/utils`：日志、配置、trace、通用工具

## 5.3 plugins

- `plugins/plugin-mahjong`
- `plugins/plugin-coding`
- `plugins/plugin-web-commentary`
- `plugins/plugin-screen`
- `plugins/plugin-memory-tuner`

## 5.4 docs

架构、RFC、协议规范、插件规范、内存设计、状态机文档等。

------

# 6. 包职责边界（Package Responsibilities）

这是本项目最重要的边界文档之一。AI 必须严格遵守。

## 6.1 `packages/protocol`

只能放：

- 数据类 / schema / enum / typed contract
- 共享常量
- 不依赖具体后端的协议定义

不能放：

- 网络请求
- 文件 I/O
- 第三方模型调用
- 业务逻辑

## 6.2 `packages/runtime`

只能负责：

- 生命周期
- session 管理
- 事件接入与转发
- 状态切换
- loop 调用入口

不能负责：

- 直接写具体 STT/TTS 模型逻辑
- 具体记忆算法
- 复杂插件业务

## 6.3 `packages/orchestrator`

负责：

- 优先级调度
- 首反应/完整回答拼接策略
- 抢占与中断
- 音频队列协调
- 各 loop 协作时序

这是 Echo 的关键创新层。

## 6.4 `packages/stt`

负责：

- VAD 抽象
- streaming STT 抽象
- 语音输入事件转化

## 6.5 `packages/tts`

负责：

- 文本 chunking
- TTS backend 抽象
- 音频队列管理
- 情绪/语气参数映射

## 6.6 `packages/memory`

负责：

- 记忆数据结构
- 写入策略
- 检索策略
- 用户反馈规则提炼
- 烈度规则注入

## 6.7 `packages/renderer`

负责：

- renderer 抽象
- 表情/动作/口型映射
- Live2D/VTS/Web renderer 适配

## 6.8 `packages/plugin-sdk`

负责：

- 插件注册协议
- hook 抽象
- 生命周期规范
- 事件订阅接口

------

# 7. 协议层强制规范（Protocol Rules）

所有模块共用的数据结构必须先在 `packages/protocol` 定义。

## 7.1 绝不允许跨包私有 dict 乱传

禁止在核心模块之间传递“临时 dict 拼凑结构”。

必须使用：

- dataclass
- pydantic model
- TypedDict
- enum
- 明确定义的 protocol object

## 7.2 事件必须标准化

每个事件至少包含：

- `event_id`
- `event_type`
- `timestamp`
- `source`
- `session_id`
- `priority`
- `payload`

示例：

```python
class EventPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"
```

## 7.3 所有公共枚举不可随意改名

任何 enum 值一旦被多个模块引用，修改前必须：

## 7.4 Tool Calling 必须先协议化

在任何 runtime / orchestrator / plugin 代码开始暴露“模型可调用工具”之前，
必须先补齐对应的 protocol/design 文档，并把跨包共享的 tool contract 定义在
`packages/protocol`。

至少应覆盖：

- tool request
- tool result
- tool error / failure outcome
- cancellation / interruption boundary（如适用）

硬性要求：

- 不允许在核心包之间用 ad-hoc `dict` 私下传递 tool payload
- tool contract 必须可关联 session / trace / call 级别的相关性信息
- 未协议化的 tool 语义不得先进入 runtime 实现

## 7.5 Tool 决策与 Tool 执行必须解耦

Reasoning Loop 可以决定“是否需要调用工具”，但不得直接执行具体工具实现。

具体工具执行必须经过受约束的执行边界，以便统一处理：

- policy / permission
- timeout / failure settlement
- audit / replay
- testing / mocking

宪法在此处只强制“必须有受约束边界”，
不预设具体机制必须是 EventBus / Queue / RPC 中的哪一种。

## 7.6 高风险 Tool 不得先实现后补治理

对于任何具有副作用或特权能力的 tool，例如：

- 文件写入
- shell / command 执行
- 浏览器 / OS 控制
- durable memory write
- 外部副作用 API 调用

在实现前必须先定义：

- permission / approval scope
- timeout / cancellation behavior
- failure classification and settlement
- audit visibility

如果上述边界尚未定义，AI 不得擅自把这类 tool 暴露给模型。

- 更新协议文档
- 更新测试
- 更新所有使用方

------

# 8. Session 与状态机规范

Echo 的实时体验强依赖状态机。AI 不得绕开状态机直接拼行为。

## 8.1 基础状态

推荐最小状态集合：

- `idle`
- `listening`
- `thinking`
- `speaking`
- `interrupted`
- `error`

## 8.2 状态切换必须可追踪

每次状态切换必须记录：

- from
- to
- reason
- trigger event
- timestamp

## 8.3 不允许隐式状态漂移

例如：

- 直接从 `idle` 跳到 `speaking`，但没有经过输入事件
- 在 TTS 播放时仍认为系统是 `idle`

任何状态切换都必须能在 trace 中复盘。

------

# 9. 首反应与完整回答策略

这是 Echo 的核心产品特征。

## 9.1 两阶段输出

每轮交互默认分为：

### 阶段一：Quick Reaction

目标：极低延迟给出“活着的反应”
可能形式：

- 表情变化
- 短语气词
- 简短吐槽
- “等下我看看”这类垫音

### 阶段二：Primary Response

目标：给出完整、高质量、上下文感知的回答

## 9.2 强制原则

- Quick Reaction 不应承诺具体答案
- Quick Reaction 不应包含高风险事实判断
- Primary Response 才负责复杂内容

## 9.3 AI 不得把两阶段混成一个阻塞式流程

任何实现都必须保证：

- 即使主 LLM 慢，Quick Reaction 仍可独立触发
- 慢推理失败时，系统也不应完全沉默

------

# 10. 用户反馈调教系统规范

这是核心能力之一。

## 10.1 基本概念

用户可以显式提供反馈规则，例如：

- “以后这样说”
- “这种时候别安慰我，要吐槽”
- “代码报错时先给思路，再给答案”

系统需要把自然语言反馈转化为结构化规则。

## 10.2 规则最小结构

每条规则至少包含：

- `rule_id`
- `trigger`
- `behavior`
- `intensity`
- `scope`
- `enabled`
- `created_at`
- `updated_at`

推荐结构：

```python
@dataclass
class FeedbackRule:
    rule_id: str
    trigger: str
    behavior: str
    intensity: float
    scope: str
    enabled: bool
    created_at: datetime
    updated_at: datetime
```

## 10.3 烈度系数（Intensity）

每条反馈规则带有 `0.0 ~ 1.0` 的烈度系数。

含义：

- `0.0`：几乎不体现
- `0.1 ~ 0.3`：极度克制
- `0.4 ~ 0.7`：中度展现
- `0.8 ~ 1.0`：极度释放

## 10.4 烈度不是单纯 prompt 参数

烈度必须至少联动三层：

1. 文本风格强度
2. TTS 表演强度
3. Live2D 动作/表情幅度

## 10.5 烈度映射原则

### 低强度

- 只做轻微表达
- 不破坏自然对话
- 不持续输出同类语气

### 中强度

- 用户能明显感知规则生效
- 可以出现在开头或结尾
- 语气鲜明但仍保留可读性

### 高强度

- 角色风格显著加强
- 可以夸张、戏剧化
- 但仍必须遵守安全边界与用户显式授权

## 10.6 规则生效范围

规则必须支持最小作用域：

- `global`
- `coding`
- `mahjong`
- `chat`
- `web`
- `screen`
- 其他插件局部作用域

## 10.7 AI 禁止擅自放大烈度

如果用户设置 `0.3`，AI 不得为了“更有趣”而按 `0.8` 执行。

## 10.8 AI 禁止丢失烈度语义

任何对规则的保存、序列化、检索、注入都必须保留 `intensity`。

------

# 11. Memory 系统规范

## 11.1 记忆分类

最少分为：

- `session memory`
- `user memory`
- `rule memory`
- `preference memory`

## 11.2 不允许把所有东西都塞向量库

向量库不是垃圾桶。必须先区分：

- 结构化事实
- 非结构化语义片段
- 显式规则
- 临时上下文

## 11.3 记忆写入应异步

不得阻塞实时对话主链路。

## 11.4 记忆检索必须可解释

当系统注入某条规则或记忆时，内部日志至少应能追踪：

- 检索来源
- 匹配原因
- 注入位置

------

# 12. Renderer / Live2D 规范

## 12.1 渲染器必须抽象化

核心层不得直接写死单一 VTube Studio 细节。

必须保留统一接口，例如：

- `set_expression()`
- `set_motion()`
- `set_mouth_open()`
- `set_state()`

## 12.2 动作映射表必须数据化

情绪到动作的映射应尽量放在配置层，而不是硬编码在逻辑里。

## 12.3 表达层与推理层解耦

LLM 只输出语义标签或状态，renderer 决定如何表现。

------

# 13. STT / TTS 规范

## 13.1 STT

必须支持抽象接口，不能把单一引擎写死。

推荐抽象：

- `start_stream()`
- `push_audio_chunk()`
- `get_partial_result()`
- `get_final_result()`

## 13.2 TTS

必须支持：

- 文本 chunking
- 排队
- 中断
- 清空队列
- 情绪参数

## 13.3 中断优先级

当用户再次开口，系统必须能：

- 暂停/终止当前 TTS
- 切换到 listening / interrupted
- 决定保留或丢弃后续未播报 chunk

------

# 14. 插件系统规范

## 14.1 插件必须通过 SDK 接入

禁止插件直接依赖 runtime 私有内部实现。

## 14.2 插件最小能力

插件可以：

- 监听事件
- 发出事件
- 注册工具
- 提供上下文
- 提供作用域规则

## 14.3 插件禁止行为

插件不得：

- 修改核心状态机定义
- 直接访问其他插件私有状态
- 绕过事件总线直接注入动作
- 擅自修改全局配置

## 14.4 插件隔离原则

任何插件失效，不应拖垮整个 runtime。

------

# 15. 错误处理规范

## 15.1 所有核心链路必须有显式错误处理

尤其是：

- 音频流
- 模型调用
- WebSocket 连接
- 插件加载
- memory 写入
- renderer 输出

## 15.2 不得吞错

除非明确是可忽略错误，否则必须：

- 写日志
- 标记上下文
- 返回明确错误状态

## 15.3 用户可见错误与内部错误分离

用户界面不应直接暴露堆栈，但内部日志必须保留完整堆栈。

------

# 16. 日志、追踪与可观测性规范

## 16.1 必须有 trace_id

一次完整交互从输入到输出必须可串联。

## 16.2 关键事件必须记录耗时

至少记录：

- VAD 检测时延
- STT 首 partial 时延
- Quick Reaction 触发时延
- LLM 首 token 时延
- TTS 首音频时延
- renderer 首动作时延

## 16.3 AI 不得删除有价值日志

除非日志过度噪音且有替代方案。

------

# 17. 配置系统规范

## 17.1 配置来源

配置必须支持清晰分层：

- 默认配置
- 环境变量
- 本地开发配置
- 角色配置
- 插件配置
- 用户配置

## 17.2 禁止魔法常量散落代码

任何影响行为的重要阈值都应配置化，例如：

- 中断阈值
- quick reaction 超时时间
- memory 注入条数
- renderer 表情持续时间

------

# 18. 依赖管理规范

## 18.1 不得随意引入大依赖

新增依赖前必须回答：

- 为什么必须引入？
- 是否已有现有依赖可满足？
- 是否会加重安装复杂度？
- 是否会破坏跨平台能力？

## 18.2 每次新增依赖必须记录

至少记录在：

- 变更说明
- 安装文档
- 必要时的架构文档

------

# 19. 代码风格规范

## 19.1 优先可读性

Echo 是一个会由 AI 频繁协作开发的项目，代码必须：

- 小函数
- 明确命名
- 低嵌套
- 少隐式副作用
- 强类型

## 19.2 命名要求

- 名字必须表达语义，不允许 `data`, `obj`, `tmp2`, `handler_new` 这类模糊命名
- 同一概念全仓统一用词，例如：`event`, `session`, `rule`, `chunk`, `renderer`

## 19.3 注释要求

注释解释“为什么”，而不是复述“做了什么”。

------

# 20. 测试规范

AI 在提交任何非纯文档改动时，必须同时考虑测试。

## 20.1 测试层级

- unit tests：纯逻辑
- integration tests：模块间交互
- e2e tests：关键链路验证

## 20.2 必测内容

以下改动必须补测试：

- protocol 结构变更
- 状态机变更
- 调度逻辑变更
- memory 规则系统变更
- renderer 映射变更
- 插件注册与事件钩子变更

## 20.3 AI 不得伪造测试结论

不能写“测试应该能过”。
必须明确：

- 已运行哪些测试
- 未运行哪些测试
- 原因是什么

------

# 21. 文档规范

## 21.1 先有边界文档，再有大实现

对于以下内容，必须先有文档或协议再大规模编码：

- 新公共接口
- 新插件协议
- 新状态机
- 新事件类型
- 新 memory 结构

## 21.2 文档必须和代码同步更新

若改动影响：

- README
- RFC
- protocol spec
- plugin spec
- config spec
  则必须一起更新。

------

# 22. 提交与变更说明规范

每次变更说明至少要包含：

1. 改了什么
2. 为什么改
3. 影响范围
4. 风险点
5. 是否兼容旧接口
6. 是否补了测试
7. 还有哪些未完成

------

# 23. AI 编程助手专用执行规范

本节专门用于约束 ChatGPT、Codex、Copilot 等助手。

## 23.1 在开始编码前必须先做的事

AI 必须先：

1. 阅读相关目录与已有文件
2. 确认当前任务边界
3. 列出会影响的模块
4. 标出可能缺失的信息
5. 仅在必要范围内修改

## 23.2 输出代码前必须检查

AI 必须自检：

- 是否新增了未讨论的大依赖
- 是否改动了公共接口
- 是否违反包职责边界
- 是否写死了后端实现
- 是否跳过了错误处理
- 是否遗漏了类型标注
- 是否遗漏了测试或验证说明

## 23.3 AI 的标准输出格式

建议 AI 在完成任务时按以下结构输出：

1. 任务完成概述
2. 修改文件列表
3. 关键设计说明
4. 风险与限制
5. 测试/验证情况
6. 下一步建议（可选）

## 23.4 AI 不得把“建议”伪装成“事实”

例如：

- 可以说“建议后续加入缓存层”
- 不能说“系统现在已经具备缓存层”

------

# 24. 最小 MVP 范围

在早期阶段，任何实现都应优先服务于最小闭环：

1. 用户说话
2. STT 得到结果
3. 系统产生 quick reaction
4. LLM 生成完整回答
5. TTS 播放
6. renderer 做出表情/口型
7. 会话结束后写入基本记忆

如果某改动与这个闭环无关，优先级默认较低。

------

# 25. 禁止事项清单

以下行为默认禁止：

- 未经批准替换核心框架
- 引入重型数据库作为默认依赖
- 让插件直连 runtime 私有状态
- 让 renderer 依赖 LLM 具体实现
- 让 memory 阻塞实时对话
- 把所有规则写死在 prompt 字符串里
- 用未经定义的 dict 在核心模块间传参
- 删除测试而不补替代验证
- 用“大重构”掩盖小任务

------

# 26. 开发优先级顺序

单人 + AI 协作开发时，必须严格按优先级推进：

## P0

- protocol
- runtime 基本状态机
- orchestrator 的最小双阶段流程
- STT/TTS/renderer 抽象层

## P1

- 基本 memory
- feedback rule + intensity
- 基础桌面壳与调试面板

## P2

- Live2D / VTS 深度适配
- OS observer
- browser bridge
- screen capture

## P3

- mahjong plugin
- coding plugin
- web commentary plugin

------

# 27. 单人 + 多 AI 窗口协作工作流建议

考虑到开发者可能在多个 IDE / 多个 AI 对话窗口中并行开发，必须建立统一约束。

## 27.1 一个窗口只做一个明确任务

禁止让多个 AI 同时修改同一组核心文件。

## 27.2 任务粒度建议

每个任务最好只属于以下类型之一：

- 新增协议类型
- 实现一个 adapter
- 写一个测试模块
- 改一个 bug
- 补一段文档
- 重构一个边界明确的包

## 27.3 所有 AI 窗口都必须共享本文件

这是统一工程语义的关键。

## 27.4 合并前必须人工审查

人类开发者必须亲自检查：

- 是否越界
- 是否幻觉
- 是否引入不一致命名
- 是否破坏架构边界

------

# 28. 推荐的 AI 任务模板

以下模板可直接复制给 AI 使用。

## 28.1 编码任务模板

你正在参与 Echo 项目开发。必须严格遵守仓库中的《AI 开发规范与工程宪法》。
你的任务边界如下：

- 只完成我指定的任务
- 不得猜测不存在的文件、接口或配置
- 不得擅自改架构
- 若信息不足，明确指出缺失点
- 输出必须包含：修改内容、影响范围、风险点、测试情况
  当前任务：
  [在这里填写]

## 28.2 重构任务模板

你只能做边界内重构：

- 不改公共行为
- 不改协议层字段
- 不引入新依赖
- 不改变目录结构
- 必须说明重构前后等价性
  当前目标：
  [在这里填写]

## 28.3 文档任务模板

请为 Echo 项目的 [模块名] 编写文档。
要求：

- 与现有架构一致
- 不虚构未实现能力
- 明确已实现 / 计划中 / 占位设计
- 使用项目统一术语

------

# 29. 第一批必须优先写出来的文档

- 在正式大规模编码前，当前最低必需文档为：

  - `docs/protocol/events.md`
  - `docs/protocol/state-machine.md`
  - `docs/protocol/feedback-rules.md`
  - `docs/protocol/orchestrator-spec.md`

  在进入对应模块开发前，必须补齐：

  - `docs/protocol/reasoning-tool-loop.md`
  - `docs/plugins/plugin-spec.md`
  - `docs/memory/design.md`
  - `docs/renderer/adapter-spec.md`

------

# 30. 最终原则

Echo 的第一价值不是“功能堆得多”，而是：

- 架构清晰
- 实时链路可靠
- 表达层自然
- 规则系统可控
- AI 协作时不失真

对这个项目来说，**约束比灵感更重要，边界比炫技更重要，可验证比看起来聪明更重要。**

如果 AI 无法确定，就不要猜。
如果任务范围很小，就不要大改。
如果接口还没定，就先写协议。
如果功能还没验证，就不要宣称完成。

------

# 31. 核心业务机制标准实现蓝图（Core Mechanisms Blueprint）

> 用途：本节定义 Echo 最核心机制的强制实现逻辑。AI 在实现这些功能时，必须严格遵循这里的 pipeline 与约束，禁止自行发明替代算法、擅自简化关键链路，或将其改写为不具备实时性与可中断性的普通串行流程。

## 31.1 双轨制并发与打断机制（Dual-Track Async Orchestration）

### 目标

确保 Echo 的“首反应”和“主回答”并发启动、分层输出、互不阻塞，并且在用户打断时可以快速收束。

### 严禁行为

- 禁止将 Drafter 与 Primary LLM 写成串行阻塞流程
- 禁止等待 Quick Reaction 播放完毕后才启动主推理
- 禁止主回答流与垫音流无协调地并发外放
- 禁止把打断实现成仅修改 UI 状态而不真正停止 TTS / renderer 队列

### 标准 pipeline 约束

1. 当 `STT` 产出用户一句话的最终结束事件（如 `UserSpeechEndEvent`）后，`Orchestrator` 必须立即并发创建至少两个任务：
   - `LocalDrafterTask`
   - `PrimaryReasoningTask`
2. `LocalDrafterTask` 的职责仅限于生成：
   - Quick Reaction 文本
   - 初始情绪标签
   - 短时 renderer 反应
3. `PrimaryReasoningTask` 的职责是生成：
   - 完整流式回答
   - 工具调用结果整合
   - 后续情绪/动作标签
   - 它可以决定是否需要调用工具，但不得直接执行具体工具实现；必须通过受约束的 tool execution boundary 提交结构化请求并等待结果回流
4. `LocalDrafterTask` 必须尽早返回结果，并优先压入：
   - `TTS Queue`
   - `Renderer Queue`
5. `PrimaryReasoningTask` 一旦有首个可播报 chunk，不得直接绕过音频协调器；必须先经过：
   - 播放状态检查
   - 与 Quick Reaction 的冲突判断
   - 进入 `audio buffer` 或触发策略性切换
6. 当用户再次开口或系统收到高优先级打断事件时，必须由统一的 `InterruptController` 执行：
   - 停止当前 TTS 输出
   - 清空未播报音频 chunk
   - 将 renderer 从 speaking/thinking 切换到 listening/interrupted
   - 为旧任务打上取消标记或显式 cancel

### 音频防重叠控制（Audio Mutex）

必须存在统一的音频互斥机制。其职责至少包括：

- 防止两个语音流同时外放
- 决定主回答是等待、覆盖还是 crossfade 进入
- 在中断发生时保证队列一致性

### 大断小机制

主推理链路在检测到更高优先级意图时，有权发出 `InterruptSignal`，强制覆盖当前短垫音或低优先级输出。

------

## 31.2 情绪标签解耦与流式分离（Emotion Tag Stripping）

### 目标

确保情绪标签、动作标签与可播报文本在流式阶段即被分离，避免标签泄漏进 TTS，也避免表情只能在整句结束后才触发。

### 严禁行为

- 禁止让 TTS 读出 `[Smile]`、`<action=nod>` 等标签
- 禁止等整句生成完再统一解析表情
- 禁止用一次性字符串替换处理 streaming chunk，导致截断标签漏出

### 标准 pipeline 约束

1. 所有来自 Drafter 或 Primary LLM 的文本流，在进入 `packages/tts` 之前，必须先经过 `ExpressionParser`
2. `ExpressionParser` 必须支持：
   - 流式处理
   - 不完整标签缓冲
   - 多类标签识别
3. 解析结果必须分成两路：
   - `Clean Text` -> `TTS`
   - `Expression/Action Tags` -> `RendererCommand`
4. 情绪标签分发不得等待完整句；一旦形成完整合法标签，即应尽快下发到 renderer

### 防截断机制

如果 chunk 中出现未闭合标签，例如：

- chunk1: `[Smi`
- chunk2: `le] 你好`

解析器必须缓存未闭合片段，直到标签闭合后再决定：

- 标签部分送 renderer
- 纯文本部分送 TTS

### 推荐支持的标签类别

- 情绪标签：`[Smile]` `[Angry]` `[Thinking]`
- 动作标签：`<action=nod>` `<action=shake_head>`
- 语气标签：`<tone=teasing>` `<tone=soft>`

------

## 31.3 烈度滑块的动态编译（Intensity Dynamic Compilation）

### 目标

将反馈规则中的 `intensity` 变成模型、语音、动作三层都能理解与执行的离散语义约束，而不是把浮点数原样交给模型。

### 严禁行为

- 禁止直接把 `0.8` 之类数字拼进 prompt 期待模型自然理解
- 禁止只在文本层使用 intensity，而忽略 TTS 与 renderer
- 禁止在规则检索后丢失 intensity 信息

### 标准 pipeline 约束

1. 当 `memory` 层召回 `FeedbackRule` 时，必须进入 `PromptCompiler`
2. `PromptCompiler` 必须将数值烈度编译成语义级约束文本
3. 编译结果必须至少作用于三层：
   - LLM system/policy 注入
   - TTS style/emotion 参数
   - renderer 动作与表情幅度

### 分级翻译模板

- `intensity < 0.3`
  - 编译语义：极弱约束
  - 示例语义：非常隐晦、偶尔地体现该特征，不破坏自然对话
- `0.3 <= intensity < 0.7`
  - 编译语义：中等约束
  - 示例语义：明显且自然地展现该特征
- `intensity >= 0.7`
  - 编译语义：极强约束
  - 示例语义：强烈、夸张、持续地贯彻该特征，但仍受系统安全边界约束

### 尾部注入原则

编译后的规则字符串默认应注入到给 LLM 的 system/policy prompt 末尾区域，保持高优先级但不覆盖全局系统边界。

### TTS / Renderer 联动原则

- 低烈度：轻微语气、轻动作
- 中烈度：明显语气、稳定动作
- 高烈度：强语气、夸张动作、显著表情切换

------

## 31.4 三级感知引擎的非阻塞约束（Non-Blocking Perception）

### 目标

让 Echo 具备环境感知能力，同时绝不破坏实时语音主链路。

### 严禁行为

- 禁止在 `Realtime Loop` 中高频截图
- 禁止在主事件循环里执行阻塞式 OCR / VLM 推理
- 禁止网页桥接每收到一点文本就直接唤醒主 LLM

### Tier 1：OS Observer

要求：

- 运行在独立异步任务或系统监听循环中
- 只在活动窗口发生真实变化时抛出事件
- 必须有去重与防抖

允许派发事件：

- `WindowChangedEvent`
- `ForegroundAppChangedEvent`

### Tier 2：Web Bridge

要求：

- 通过 WebSocket 或浏览器桥接接收页面信息
- 默认只作为上下文缓存进 `SessionState`
- 只有在用户主动询问或规则触发时，才交给推理链读取

禁止行为：

- 每条弹幕、每行字幕都强制触发 LLM

### Tier 3：On-Demand Screen

要求：

- 截图只能由明确事件触发，如：
  - 用户说“你看这个”
  - 屏幕插件发出求助事件
  - 某插件请求视觉确认
- 截图本身必须放到线程池或独立阻塞隔离中执行
- VLM/OCR 必须运行在 `Reasoning Loop`，不能侵入 `Realtime Loop`

------

## 31.5 这部分蓝图的约束级别

本节属于 Echo 的强制性业务蓝图。任何 AI 在实现以下能力时，都必须优先服从本节定义：

- 双轨制并发调度
- 流式标签分离
- 烈度规则编译
- 多层感知接入

若某实现与本节冲突，则默认该实现不合格，除非有新的 RFC 明确替代本节。

------

# 附录 A：建议的首批协议对象

建议优先定义以下协议对象：

- `Event`
- `SessionState`
- `Utterance`
- `QuickReaction`
- `PrimaryResponse`
- `TTSChunk`
- `RendererCommand`
- `FeedbackRule`
- `MemoryEntry`
- `PluginManifest`

------

# 附录 B：建议的首批工程检查清单

每次提交前检查：

-  是否只改了当前任务范围内的内容
-  是否使用了统一协议对象
-  是否破坏包职责边界
-  是否补充必要测试
-  是否写清验证方式
-  是否保留错误处理
-  是否没有虚构已完成能力
-  是否更新相关文档

------

# 附录 C：本文件的使用方式

本文件建议：

1. 放在仓库根目录或 `docs/governance/ai-engineering-constitution.md`
2. 在 README 中链接
3. 在每个 AI coding 会话开头明确引用
4. 在 PR 模板中要求勾选遵守情况
5. 在关键 RFC 中作为约束性引用文档

------

**本文件是 Echo 项目的工程底线。**
任何实现都应以降低幻觉、减少猜测、稳固边界、保持可维护性为目标。
# UI Fidelity Exception

This document still forbids directly implementing Echo core logic from
external repositories. However, Echo now permits a controlled exception for
high-fidelity UI reproduction.

Default rule:

- protocol, runtime, orchestrator, host, preload, bridge, provider, and
  state-machine logic must not be copied or translated from external
  repositories

Controlled exception:

- UI surfaces may be directly inspected and closely reproduced from local
  reference source under `docs/reference/*` when the task explicitly requires
  high-fidelity reproduction

For this exception, UI surface includes:

- browser-served web console pages
- Electron desktop windows
- chat, bubble, onboarding, and config pages
- Live2D avatar shell presentation and interaction behavior
- visual tokens, layout, spacing, motion, window geometry, and transparency

Allowed direct-reference scope includes:

- CSS rules and style tokens
- colors, gradients, blur, opacity, borders, and shadows
- window dimensions, floating behavior, always-on-top behavior, and positioning
- DOM structure, spacing, typography, and animation timing
- interaction presentation details such as hover/focus timing and easing

Still forbidden under this exception:

- protocol and event semantics
- runtime/orchestrator/renderer/memory/TTS core logic
- preload, IPC, host, provider, or state-machine semantics
- tool contracts, permission logic, or Echo package-boundary decisions

Tasks using this exception must explicitly state:

1. which local reference directories may be directly inspected
2. which UI surfaces must be reproduced at high fidelity
3. which non-UI logic remains forbidden to copy

# Local Mirrored-Source Adaptation Exception

This constitution still forbids directly implementing Echo core logic from
external repositories as a default rule.

However, Echo now permits one narrow local mirrored-source adaptation exception
to reduce hallucination when adapting already-validated designs from:

- `C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main`
- `C:\Users\123\Desktop\echo\docs\reference\airi-main`

This is not a general "external code is allowed" policy.

It applies only when all of the following are true:

1. the task card explicitly names the allowed mirrored repo and subdirectories
2. the work is limited to one or more of these subsystems:
   - same-session context assembly
   - TTS chunking and TTS-only sanitization
   - desktop realtime voice playback
   - lipsync and expression queueing/mixing
3. the task card explains:
   - which repo is the primary model
   - which repo is supplementary
   - what Echo should adapt
   - what Echo must not copy directly

This exception allows:

- direct inspection of the local mirrored source
- short, focused quotations inside task cards
- high-fidelity behavioral adaptation within Echo's own architecture

This exception does not allow:

- copying or translating protocol semantics
- copying or translating state-machine or runtime-flow semantics
- copying host assembly, preload, IPC, or bridge semantics
- copying package-boundary decisions
- transplanting whole files or large code blocks into Echo

Implementers using this exception must still obey:

- this constitution
- Echo protocol docs
- Echo package boundaries
- the current task card

# Direct-Adaptation Task Card Standard

Task cards using the local mirrored-source adaptation exception must be more
explicit than a normal bounded task card.

They must include:

1. the exact allowed mirrored repo paths
2. which repo is the primary model and which is supplementary
3. a plain-language explanation of the user-visible problem
4. a section titled `How open-yachiyo solves this`
5. a section titled `How AIRI solves this`
6. a section titled `What Echo should adopt`
7. a section titled `What Echo must not copy directly`
8. concrete Echo implementation boundaries
9. user-facing acceptance scenarios

These task cards may embed short, focused snippets from the two local mirrored
repos above when doing so materially reduces ambiguity.

Snippet requirements:

- each snippet must be labeled with its absolute local source path
- each snippet must be short and tightly tied to the task
- the card must explain why the snippet is relevant
- the card must explain what still needs adaptation inside Echo
- snippets are guidance, not blanket permission to transplant repository code

# Fail-Fast Requirement

Echo prefers fail-fast behavior over degraded-mode execution.

Default rule:

- do not add placeholder UI, shell renderer fallback, silent degraded mode, or
  "best effort" continuation paths unless a task explicitly requires them
- if required dependencies, model assets, renderer prerequisites, or control
  contracts are missing, the implementation should raise an explicit error and
  stop

This applies especially to:

- desktop renderer/model boot
- provider/runtime wiring
- browser/Electron control-plane boot
- task-card acceptance paths for UI fidelity work
