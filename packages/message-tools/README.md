# @khorsheed/dsh-client-message-tools

[English](README.en.md) | 中文

发出去的话还能改、还能撤——撤回是真从模型记忆里删掉，不是打个标记。

话说快了、方向跑偏了，以前只能再发一条往回找补。这个插件给你发出的每条消息配上一排小按钮：复制、编辑、撤回。编辑是原地改完重新发，模型按新内容重新回答；撤回会把这条消息和它后面的所有内容一起请出模型上下文，折叠成一条可以展开的「已撤回 N 条消息」分隔线，原话还会自动回填到输入框草稿（绝不替你发送）。后悔了，点分隔线上的「恢复到对话末尾」就能把内容原样放回去。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions1.png" width="640" alt="用户消息下方的复制、编辑、撤回操作按钮">

## 特性

- **每条用户消息都有操作行**——用户气泡与已吸入轮次的 steering 消息带复制、编辑、撤回操作。
- **就地编辑**——内联编辑框带真实可用的模型 chip；保存后从该处重新生成，已编辑的气泡可再次编辑。
- **真撤回，不是打标记**——消息及其后整个尾部离开模型上下文，折叠为可展开的「已撤回 N 条消息」分隔线；展开即可只读回放被撤回的用户原文、随消息发出的图片与助手文本（纯图片消息同样计入 N）。
- **草稿回填**——撤回成功后把原文回填到 composer 草稿，绝不自动发送。
- **恢复到尾部**——「恢复到对话末尾」把用户消息逐字重放、助手文本重放为「已恢复」组；工具调用永不重放。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions2.png" width="640" alt="原位编辑：消息变成带模型选择的输入框，保存后以新消息重新发送，被编辑消息不再进入模型上下文">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions3.png" width="640" alt="撤回前的确认弹窗：说明这条消息及其后内容将对模型隐藏、原文会回填到输入框">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions4.png" width="640" alt="撤回后的内容折叠为可展开的分隔线，底部有「恢复到对话末尾」按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions5.png" width="640" alt="恢复后消息原样回到对话末尾，归入「已恢复」分组">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
```

重启 web 实例后生效；卸载即精确还原之前的组合。

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-message-tools
```

## 手机端（/m）

`/m`（dsh-mobile-ui 的手机界面）的插件标签页里会多一个 **消息工具**：手机上同样能撤回、编辑重发、恢复。

- 列表按时间倒序给出当前会话里**可操作的消息**——原始消息、编辑替换、恢复重放，正是撤回与编辑会接受的那些目标（撤回占位符、编辑触发消息、助手文本重放不在此列，因为服务端不会接受对它们的操作）。每条显示 seq、状态（生效中 / 已撤回）、来源（已编辑 / 已恢复）与正文；生效中的行有 `撤回` / `编辑重发`，已撤回的行有 `恢复`，含图片的消息会标注「含图片」（编辑器只带文本，与桌面一致）。
- 手机端没有 Remote 客户端，页面走本插件自己的两条**同源**路由：`GET /message-tools/m/state?session=<id>` 读列表，`POST /message-tools/m/action` 执行 `{action: withdraw|edit|restore, sessionId, targetSeq, text?}`。两条路由调用与桌面**同一个** service 方法，所以手机上的操作落地的替换事件与桌面完全一致，不引入任何新的事件类型。
- 两条路由只接受同源请求（带 `Origin` 时必须与 `Host` 同源；`Sec-Fetch-Site` 非 `same-origin`/`none` 直接 403），POST 必须是 `application/json` 且 ≤64 KiB。**刻意不校验 cookie**：/m 常从局域网地址或隧道进入，那里没有 `dsh-auth-*` cookie（dsh-mobile-ui 正因此自己重发 RPC 路径），校验 cookie 会把手机挡在门外。
- 渲染器固定在 `<包>/lib/mobile/plugin.js`，由 dsh-mobile-ui 在启动时从 profile 依赖里发现——**新增或改动渲染器文件需要重启 dsh web**；构建脚本（`pnpm run build`）会把仓库里的 `mobile/plugin.js` 复制到 `lib/mobile/`。
- `@deepseek-ai/dsh-host-webserver` 是**可选** peer：没有 Web 服务器的组合（headless、桌面宿主）不挂这两条路由，服务与工具能力完全不变。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——适配 0.1.5-rc.1 的 format v2/v3（`assistant/attempt` 取代 `assistant/chunk`；surfaceOp replace 字段 `start`/`end` 更名 `startSeq`/`endSeq`），全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。Session V4 的生产者归属 source（kind `message-tools`）在 0.1.5 宿主同样合法落盘：0.1.5 的 `user/message` 准入只要求非空 kind 字符串。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.7-rc.2）——Session V4 适配：写侧改生产者归属 source（kind `message-tools`，V4 原生准入拒绝退役的 `kind: 'plugin'` 包装），读侧兼认新 kind、`plugin:message-tools`（V3→V4 迁移形态）与 V3 包装存量（0.1.5 宿主原位读取）；`conversation.chat.node` rc.1 契约（hookContext/inject 新形状、match 事件 `SessionEventLike` 并集）复验通过；ui-primitives 图标改名（`Icon*Outline14/16` → `Icon*OutlineMedium`）跟进。

**版本线对照**：0.2.0 之后的首个发布起支持宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` 请停留在 `0.2.0`，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 请停留在 0.1.x 发布线（末版 `0.1.0`）。

## 已知限制

- **全区间隐藏依赖一个未文档化的 DOM 属性**——上游若移除它，隐藏退化为仅渲染器层（用户消息仍被隐藏），`console.warn` 一次，绝不报错。
- **编辑与撤回回填只带文本**——原消息的图片附件不会带入重发或回填的输入框草稿；图片仍留在分隔线的展开回放里，可以自行另发（宿主没有"文本 + 图片一起设置草稿"的公开 API，图片只能作为一次新上传重新登记）。
- **恢复是尾部重放，不是原位修复**——助手文本以带框架的用户角色消息重放，工具调用/结果永不重放；撤回区间始终留在模型上下文之外，恢复入口只在撤回分隔线上。
- **context 与排队消息不在范围内**——context 消息沿用官方渲染器（无操作行）；仍在排队的消息由官方队列条带编辑/移除。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** 浏览器半部分以官方用户消息渲染器的视觉克隆（`conversation.chat.node` 槽位、key `user` 与 `steering`、priority -1）替换默认渲染并新增操作行，同时注册四个 `ConversationNodeDefinition`：撤回投影为可展开的「已撤回 N 条消息」分隔线（N = 区间隐藏的用户可见消息数），编辑替换投影为带「已编辑」徽标的原位气泡，恢复条目投影为「已恢复」组里的重放行。Host 半部分是 `messageTools` Typert Remote 服务（`withdraw` / `edit` / `restore`）；客户端经 `ctx.remote.$mount` 自行挂载生成的 Remote contribution，无需改动任何核心包。

**编辑**即原位替换：host 追加一条 `user/message` replacement，其内容就是编辑后的新文本（区间覆盖目标消息及 surface 尾部——编辑旧消息就是放弃其后的一切），随后经 `agent.followup` 投递一条极简生产者来源触发消息启动重新生成。模型上下文里新文本只出现一次；旧内容留在日志里作审计。会话有运行中的轮次时先取消它并等待完全落定——落定指被取消轮次的收尾（工具结果、`turn/end`）全部落盘，而不是 `running` 翻转；等待有界，迟迟不落定的轮次以「编辑失败」拒绝，取消失败则不编辑。支持编辑链：已编辑气泡可再次编辑，目标是上一个 replacement 的 seq。编辑框的模型 chip 与 composer、/model 弹层共享按会话的 `ModelDirectory`（`ctx.get('modelDirectories')`，可选服务）——组合里没有 ui-model-selection 就不渲染 chip——切换经 host 校验后作用于重新生成的轮次。

**撤回**是真撤回，不是打标记：host 追加一条 `user/message` surface replacement（与 compaction 同一机制），区间覆盖目标消息及之后的所有 surface 节点，该区间由此离开 `session.surface`，不再进入模型上下文；与编辑同款的 cancel-and-settle 编排保证流式内容不会落到 replacement 之后。事件为生产者来源（source kind `message-tools`），`sourceEventSeqs` 引用每一个被遮蔽节点，方法返回前经 `SessionStore.flush` 落盘——它本身就是审计轨迹。不引入新事件类型：harness 之外的类型无法携带 `ignorable: true`，持久化的未知类型会让 session-persistence 重载时拒绝整个日志。撤回成功后把目标原文回填到 composer 草稿（空草稿直接填入、非空换行追加、落 info 提示）——绝不自动发送，失败则不回填；编辑路径不触发回填。

**投影与隐藏。** 插件的 Definition 把 replacement 认领为锚定在其 seq 上的分隔线节点。隐藏分两层：被遮蔽的用户渲染器对区间内用户消息渲染为空；一张动态样式表把 `data-chat-flow-key`（`ChatNodeSeat.tsx`）锚点落在区间内的聊天行一律隐藏，覆盖助手步骤、工具调用、turn 尾部。隐藏器在首个非空规则集探测这个未文档化属性，探测落空进入有界重试（MutationObserver 加截止时限），避免聊天区尚未挂载时误停用；只有窗口耗尽仍探不到行才停用——`console.warn` 一次，退化为仅渲染器隐藏——且 observer 在停用后仍存活，行晚到会重新生效，绝不报错。分隔线可就地展开只读回放撤回区间（用户原文与随消息发出的图片、加助手文本，从实时节点存储折叠；图片交给官方附件画廊槽位 `renderMessageImages` 渲染，组合里没有它时退化为纯文本回放而不报错）并提供「恢复到对话末尾」；行已掉出加载窗口的区间显示「撤回的内容不在当前已加载的历史中」。

**恢复**是整个被撤回区间的尾部重放，不是原位修复：surface 折叠是位置性的——被替换区间只接续成一个节点（`applySurfacePlan`）——区间无法回到模型上下文原位，其模型侧隐藏也永不回退。host 沿撤回 replacement 自身划定的日志区间 `[start, seq)` 把可重放内容按原始顺序逐条追加到尾部：用户消息逐字重放（编辑替换的内容就是最后一次编辑的新文本，恢复时即以此为准），每条助手回复的文本以带框架的生产者来源用户消息重放——`assistant/message` 只能携带 model 来源，且轨迹不允许在 step 之外追加助手消息，因此角色保真由框架 `(以下是先前被撤回、现随恢复放回的助手回复)` 承担，UI 上不显示该框架。未落成 `assistant/message` 的中断尝试从其 `assistant/attempt` 事件内嵌的紧凑流合并重放（只有 reasoning 时保留 reasoning）。工具调用/结果永不重放：配对无法重新进入，副作用不可重放。重放行渲染为「已恢复」组——用户气泡带完整操作行，助手文本走官方 `MarkdownText`——分隔线在存在引用该区间的存活恢复行期间显示「已恢复」徽标；再次撤回这些恢复行会清掉徽标并重新启用恢复操作（恢复事件始终留在日志里）。

**为什么投影层做不到（彻底修复所需的上游 seam）。** 组装器对每个事件运行所有已注册 Definition 的 `match`，没有否决机制（`conversation-assembler.ts:370`），且 `match(event)` 只能读当前事件；被遮蔽事件在日志里仍保持 `surfaceOp: 'append'`（区间元数据只存在于 replacement 自身），因此依然命中各内置 Definition——内置 Definition 排除的是 *replacement* 事件，不是被遮蔽事件。节点的 `visibility` 只能由产出它的 Definition 设置，组装器禁止把已物化节点撤回为 null，节点 key 又与其 Definition 的 kind 绑定——插件既无法翻转也无法冒充官方节点。遮蔽其余 `conversation.chat.node` key 同样行不通：官方组件没有导出，`command`/`turn-tail`/`tool-call` 声明了子槽位而遮蔽无法重复声明（`tool-call` 还持有 key 空间无界的按工具名 keyed 的 `tool.call.toolview` 槽位）。官方 compaction 流水线在设计上就做了同样选择——被替换的区间保留在 transcript 里。

**模型体验。**

- *编辑替换*——模型读到编辑后的文本，原消息之后的内容全部消失；其后跟一条短触发消息（`(用户编辑了上一条消息，请按编辑后的内容重新回答)`）。Token 影响：被遮蔽区间的全部 token 离开后续请求，新增编辑后消息与触发消息。KV Cache：prompt 前缀从编辑点失效。
- *撤回替换*——区间被一条占位消息（`(用户撤回了这条消息及其后的所有内容)`）取代。Token 影响：区间的全部 token 离开，只新增一条短消息。KV Cache：前缀从替换点失效——取舍与 compaction 相同；撤回越早的消息，失效的缓存前缀越多。
- *恢复重放*——区间的可重放内容（用户消息逐字、助手文本带框架）按原始顺序追加到尾部，插件标记并引用原事件；工具调用/结果的 token 不进入。KV Cache：不超出普通尾部追加的范围。

**导出。** `/client` 导出插件本体（`apply`/`inject`）与 `MessageToolsRemote` 类型；host 侧导出 `MessageToolsService` 类，`/types` 子路径提供线上类型。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/message-tools`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
