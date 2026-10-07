# 变更记录

## 0.4.0（2026-10-08）

新增 `/m` 手机端面：手机上也能撤回 / 编辑重发 / 恢复用户消息。

- **Host 半部分**：新增两条同源路由 `GET /message-tools/m/state?session=<id>`（按时间倒序返回当前会话可操作消息的行数据：seq、正文、生效中/已撤回、来源、是否含图）与 `POST /message-tools/m/action`（`{action: withdraw|edit|restore, sessionId, targetSeq, text?}`），转发给与 Remote 完全相同的 service 方法，因此手机与桌面落地的替换事件一致，不引入任何新事件类型。两条路由只接受同源请求（带 `Origin` 时必须等于 `Host`，`Sec-Fetch-Site` 非 `same-origin`/`none` 一律 403），POST 限 `application/json` 且 ≤64 KiB，并**刻意不校验 cookie**——/m 常从局域网地址或隧道进入，那里没有 `dsh-auth-*` cookie（dsh-mobile-ui 正因此自行重发 RPC 路径），校验 cookie 会把手机挡在门外。
- **浏览器半部分**：新增 `<包>/lib/mobile/plugin.js`，向 dsh-mobile-ui 注册「消息工具」插件标签页：当前会话的可操作消息列表 + `撤回` / `编辑重发` / `恢复`（含图片的消息标注「含图片」）。构建脚本把仓库里的 `mobile/plugin.js` 复制到 `lib/mobile/`。
- **依赖**：`@deepseek-ai/dsh-host-webserver` 作为**可选** peer（`peerDependenciesMeta.optional`）加入——没有 Web 服务器的 headless/桌面组合不挂这两条路由，服务与工具面完全不变。
- **仓库工具**：`scripts/gen-typert.mts` 的仓库根改用 `fileURLToPath`。`new URL('..', import.meta.url).pathname` 在 Windows 上给出 `/F:/…`，join 之后变成 `F:\F:\…`，于是 Windows 上任何包的构建都会在读取 `package.json` 时 ENOENT。

## 0.3.3（2026-09-30）

无功能变更。加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.3.2（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2）。

- **适配 rc.2 的 `ModelDirectoryState.pending`**：rc.2 起模型目录自己持有在途选择，`pending: ModelSelection | null` 成为必填字段；本包从不渲染的空目录 stub 去掉 `: ModelDirectoryState` 标注、补上 `pending: null`，改按结构受检——同一份字面量在 rc.1（无此字段，新鲜字面量会撞 excess-property 检查）与 rc.2（必填）上都编译通过。双线行为不变

## 0.3.1（2026-09-26）

适配宿主 rc.1 线并实证 0.1.5/0.1.7 双线可用（0.1.5-rc.1 全量 boot 实证，2026-09-25）。

- 会话内消息的 source 改盖 V4 生产者归属 kind（退役的 `plugin` 外壳在 rc.1 持久层写入即抛）；`conversation.chat.node` 的 rc.1 契约复验通过
- 恢复投影（restore）移到 fold 语义门后发布
- 「打开来源」等跳转改走官方浏览器开链；`select` 的 RemoteResult/mainView 推导修正
- 图标自持化：rc.1 图标图样由 `sync-icon-artwork` 生成器摊平进包内 `src/client/icons.tsx`（双线渲染同一份图样）；包自持的补充图标迁名 `icons-local.tsx`
- 插件清单展示元数据（`locale/*.json`）：rc.1 宿主插件页的卡面标题/描述中文化
- 撤回分隔线的展开回放不再丢图：被撤回用户消息的图片现在经官方附件画廊槽位（`renderMessageImages`）随原文一起重放；组合里没有附件 UI 时退化为纯文本回放，不报错
- 纯图片消息从前显示「已撤回 0 条消息」并落到「撤回的内容不在当前已加载的历史中」的空态（内容其实加载着），现在计为 1 条并正常回放；`WithdrawnEntry` 新增 `images`
- 两份 README 补齐记录：回放包含图片、纯图片消息计入 N；同时写明编辑与撤回回填仍只带文本（宿主没有公开的"文本 + 图片一起设置草稿"API，图片只能作为一次新上传重新登记）

## 0.3.0（2026-09-11）

适配宿主 0.1.5 线。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 线（末版 `0.2.0`）
- 撤回/恢复投影适配 0.1.5 的会话格式：`assistant/attempt`（每次模型尝试一条聚合 settlement）取代已退役的 `assistant/chunk`；surfaceOp replace 字段 `start`/`end` 更名 `startSeq`/`endSeq`，撤回与就地编辑写出的替换 op 同步改用新名
- 开发基线随仓内 pin 对齐官方 `0.1.5-rc.1` / cordis `4.0.2`；peer 范围保持宽松

## 0.2.0（2026-09-10）

适配宿主 0.1.2 线。

- **BREAKING**：minHost 前移至 `0.1.2-rc.1`；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 线（末版 `0.1.0`）
- 会话事件读取走 `Session.snapshotEvents()` / `eventAt`（`session.events` 已随宿主移除），事件序号全面品牌化为 `SessionSeq`
- 导入面迁移：client bundle 不再引用宿主已删除的 `dsh-client-runtime`

## 0.1.0（2026-08-22）

首个公开发布；此前在内部迭代至 0.4.x。

- 每条用户消息带复制/编辑/撤回操作行，已吸入轮次的 steering 消息同样支持
- 就地编辑：内联编辑框带模型 chip，保存后从该处重新生成，已编辑的气泡可再次编辑
- 真撤回不是打标记：消息及其后内容彻底离开模型上下文，折叠为可展开的「已撤回 N 条消息」分隔线
- 草稿回填：撤回成功后把原文回填到 composer 草稿，绝不自动发送
- 一键恢复到对话末尾：用户消息逐字重放，助手文本归入「已恢复」组；工具调用永不重放
