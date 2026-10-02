# DSH 0.2 Compatibility Check (read-only, no upgrade performed)

Date: 2026-10-03. Local install: `@deepseek-ai/dsh@0.1.7-rc.2` (global npm). Remote latest: `dsh-v0.2.0-rc.2` (prerelease, published 2026-09-29) — https://github.com/deepseek-ai/deepseek-harness/releases

## Answers To The Four Questions

1. **Is it 0.2.0?** Yes as a prerelease: latest tag/Release is `dsh-v0.2.0-rc.2`; there is no GA 0.2.0 yet. This machine still runs 0.1.7-rc.2.
2. **Is it desktop-only now?** No. The 0.2.0-rc.2 notes add a macOS/Windows **Desktop** app that can install the `dsh` command and manage plugins without Node/pnpm — that is an *additional* distribution. The same tag README still opens with `npx @deepseek-ai/dsh web`, documents the Web UI at `http://127.0.0.1:3080`, `--no-open`, and the SSH-launch behaviour.
3. **Can the web side move to 0.2?** Yes. `@deepseek-ai/dsh@0.2.0-rc.2` still depends on `@deepseek-ai/dsh-web-app`, and the 0.2 tree still carries `packages/client/*`, `packages/host/webserver`, `packages/web/web`. Diffing the dependency sets: 0.2 adds exactly one package (`dsh-experimental-schedule-bundle`) and removes none.
4. **Must we migrate to another form?** No. Same install and same `dsh web` entry point. Desktop is optional.

## Compatibility Of This Plugin (dsh-arbiter-wf / po06) With 0.2

Method: downloaded the 0.2.0-rc.2 tarballs of every package this plugin touches into `tmp-pack/dsh020` and compared contract strings against the locally installed 0.1.7 packages. Nothing was installed, upgraded, or republished.

| Contact point | How we use it | 0.2 evidence | Verdict |
|---|---|---|---|
| Client module registration | `window.__ModuleLoader__.load({id, factory})` (client.js:21) | 0.2 `dsh-client-modules` still documents/tests the identical call, including the same "loaded without registering" failure text | Works |
| `dsh.client` manifest | `platform: "web"`, `inject`, `external`, `immediately` | 0.2 still validates `platform` as a string and gates the client half on `platform !== "web"`; `immediately` is validated as boolean; `external` as a string array | Works |
| Slots | `conversation.input.left`, `shell.overlay`, `settings.plugins.tab`, `tool.call.toolview` | All four present in 0.2: ui-conversation, ui-layout, ui-settings-plugins, ui-tool | Works |
| Tool and card contract | `tools.register({parameters, output:{schema, render, presentationMeta, presentCall, presentResult}})` | `presentationMeta`, `presentCall`, `presentResult` all present in 0.2 `dsh-tools` and `dsh-client-ui-tool` | Works |
| Host services | `tools, llm, systemPrompt, clientModules, commands, agents, attachments, sessionController, sessionProjections, webServer` | Every one has a 0.2 provider (verified `sessionController` in `dsh-api-session-controller`, `sessionProjections` in `dsh-session-projection`) | Works |
| Control API | our own `/po06/api/*` routes registered on `webServer` | independent of host version | Unaffected |
| State on disk | our own `~/.dsh/po06-*.json` / `po06-wire.jsonl` | our own formats, not host session format | Unaffected |

## Points To Watch (not blockers)

- 0.2 ships session-format migrators (`dsh-session-format-v0-to-v1` … `v3-to-v4`). Our own ledger is unaffected, but the parts that **read host session events** (context rendering, advisor snapshot) can only be confirmed by running the plugin on 0.2. Static inspection cannot prove event shapes are unchanged.
- 0.2 updated the third-party model catalogue to pi-ai 0.87.1 and removed some old model IDs; saved per-model reasoning-effort keys may need reselecting.
- 0.2 reworked plugin install/upgrade guidance (installed vs incompatible vs bundled) — UI only.
- The already-published `0.8.0-preview` tgz still carries the pre-rename client id (issues #20/#21). That is independent of DSH version, but it should be re-released before anyone installs it on 0.2.
- vmake is studying 0.2 adaptation in parallel. Upgrading DSH is a **host-level** action that affects both plugins at once; it cannot be decided per plugin, so the two conclusions should be combined before any upgrade is attempted.

## Not Done In This Round

No DSH install/upgrade, no `npx` run, no plugin code change, no repack or release, no GitHub-side action. Only tarballs were downloaded into `tmp-pack/dsh020` and `tmp-pack/pub` for reading.

---

# 用户反馈「0.2 上用不了」的改动点确认（2026-10-03）

## 主因不是 0.2 的 API 改动，而是 0.8.0-preview 那份发布产物本身

用户装的是 Release 里的 `dsh-external-dsh-arbiter-wf-0.8.0-preview.tgz`（2026-10-01）。下载解包实测：

```
package/package.json   name = "@dsh-external/dsh-arbiter-wf"
package/lib/client.js  id   = "@dsh-external/dsh-po06"   <-- 旧名
package/lib/index.js   export const name = "@dsh-external/dsh-po06"
package/lib/index.js   PRODUCER_KIND = "plugin:@dsh-external/dsh-po06"
```

宿主按 `package.json` 的 name 生成 boot row id，并在该 id 下找注册；不一致时 0.2 的 client-modules 报 `loaded without registering "@dsh-external/dsh-arbiter-wf"`，**client 半侧整个不激活**（面板、卡片、设置页全没有）。这就是「装上但用不了」。

本地 git 标签对照（离线核实）解释了为什么是**部分**用户：

| 发布标签 | package.json name | client 注册 id | 结果 |
|---|---|---|---|
| v0.7.8 | `@dsh-external/dsh-po06` | `@dsh-external/dsh-po06` | 一致，能注册 |
| v0.8.0-preview | `@dsh-external/dsh-arbiter-wf` | `@dsh-external/dsh-po06` | 不一致，client 半侧必死 |

这条与 DSH 版本无关：同一个包在 0.1.7 上也注册不上。issue #21 正是在 dsh 0.2.0-rc.2 上复现的同一现象。源码已修（`identity.test.mjs` 从 package.json 动态读名字做门禁，改回旧名会被测出来），但**尚未重新发版**，用户拿到的仍是坏的那一份。

## 逐成员契约对照（0.2.0-rc.2 实际产物 vs 本机 0.1.7）

方法：`npm pack` 下载 0.2.0-rc.2 的 19 个相关包到 `tmp-pack/dsh020` 解包，对每个调用点逐成员比对类型声明，不安装。

| 接触点 | 我们的位置 | 0.2 实测 | 判定 |
|---|---|---|---|
| `__ModuleLoader__.load({id,factory})` | client.js:21 | 契约相同 | 不用改 |
| `dsh.client.platform/immediately/external/inject` | package.json:42 | 仍校验 string / boolean / 字符串数组 | 不用改 |
| 4 个插槽 | client.js:3292-3450 | 四个都在 | 不用改 |
| `tools.register` 与 `output.schema/render` | index.js、advisor-stage-tool.js | 在 | 不用改 |
| `presentationMeta/presentCall/presentResult` | advisor.js | 三个都在 | 不用改 |
| `clientModules.pkgMeta/dirty/flush/rebuilt` | index.js:1816-1822 | 四个都在 | 不用改 |
| `systemPrompt.context(...)` | index.js:1669 | 与 0.1.7 的 .d.ts 逐字相同 | 不用改 |
| `sessionProjections.register/snapshot` | index.js:1968 | 都在 | 不用改 |
| `webServer.register` | index.js:2001 | 在 | 不用改 |
| `agents.get/list` | index.js:1729/2050 | 都在 | 不用改 |
| `llm.stream/listProviders/listModels/resolveModelInfo` | index.js:832/1204/1207/1871 | 四个都在 | 不用改 |
| `attachments.saveImage` | advisor-materials.js:106 | 在 | 不用改 |
| `commands.list(agent)` | index.js:2144 | 与 0.1.7 签名逐字相同 | 不用改 |

## 只能实机确认的（本次确认不了，不能算通过）

1. **宿主会话事件形状**：我们读 `session/event` 的 `user/message`、`tool/result`、`source.kind` 等做上下文与顾问快照。0.2 带了 `dsh-session-format-v0-to-v1 … v3-to-v4` 迁移链，静态只能确认迁移器存在，证不了事件字段未变。
2. **0.2 的插件装配路径**：0.2 改过插件安装/升级引导（区分已安装、不兼容、内置）；我们的 `dsh.bundle.patch` + profile junction 形态是否仍被接受，需实机。
3. **桌面端**：0.2 新增桌面端；`platform:"web"` 是否在桌面端也加载，取决于桌面是否复用 web 客户端。
4. 核对中途网络中断，0.7.8 的 tgz 未能下载复核；上表 v0.7.8 一行来自**本地 git 标签**，不是发布产物实测。

## 判定汇总

- **必须改（已改，待重发）**：发布产物的三处身份标识 —— 当前「装上用不了」的直接原因。
- **不用改**：上表 13 个契约接触点在 0.2 静态对照下全部兼容。
- **待实机**：会话事件形状、装配路径、桌面端平台判定。

本轮未升级 DSH、未改插件代码、未发版。

---

# 双版本兼容的静态核对（2026-10-03，第二轮）

问题：同一份代码能不能既跑 0.1.7 又跑 0.2？

方法：对 19 个接触包做 `diff -rq`（本机 0.1.7 的 `lib/types` vs 0.2.0-rc.2 解包后的 `lib/types`），再对**有差异的**文件逐个看 diff 正文。

## 结果：14 个包的声明文件与 0.1.7 **逐字节相同**

agent、agent-tool-presentation、attachment、client-modules、client-ui-layout、client-ui-settings-plugins、**client-ui-slots**、commands、host-webserver、llm、session-projection、settings、system-prompt、tools。

其中包括我们最关键的几处：模块加载契约、插槽类型、工具与卡片注册、`systemPrompt`、`sessionProjections`、`webServer`、`llm`、`commands`、`attachments`。

## 5 个包有差异，逐一看过：全是追加或可选参数

| 包 | 差异内容 | 是否触我们的调用 |
|---|---|---|
| client-ui-tool | 新增 `UserQuestionRecord` / `UserQuestionPanels` 等在 `slots.d.ts` 尾部；`ToolCallViewProps` 本身未改 | 不触（我们用 `tool.call.toolview` 的既有 props） |
| api-session-controller | `forkSession` 新增可选 `onCreated?` | 不触（可选参数） |
| client-ui-conversation | `submit(mode?, source?)` 新增可选 `source`；`submission?` 等新可选字段 | 不触（我们调 `submit()` 不传参；`setDraft` 另有 `typeof` 守卫） |
| session | `index.d.ts` 仅一行：导出里多一个类型 `ToolCallRecovery` | 不触（纯新增导出） |
| client-ui-primitives | `Input`/`Tooltip`/`DisclosureRow`/`TextShimmer`/`index` 等有改动 | 不触（我们只用它取图标，且有 try/catch 兜底） |

另有一处**行为差异**（非接口差异）：`session` 的 `repair.d.ts`/`repair.js` 改了，涉及被中断工具调用的修复（新增 `ToolCallRecovery`）。我们的 `tool/result` 读取路径在「中断回合」这种边界上可能会有不同表现 —— 这属于运行时行为，静态判不了，需实机。

## 结论

- 身份三处（client 注册 id、host `export const name`、`PRODUCER_KIND`）与 patch entry **已在源码中改为包名**，`identity.test.mjs` 从 package.json 动态取名字做门禁（改回旧名会被测出来）。这三处与 DSH 版本无关：任何版本都要求 id 等于包名。
- 除身份修复外，**不需要为 0.2 再改代码**：14 个包逐字节相同，5 个包的差异全是追加/可选。
- 仍未验证（静态判不了）：0.2 的插件装配路径是否仍接受 `dsh.bundle.patch` + junction；桌面端是否复用 `platform:"web"` 客户端；中断回合修复带来的运行时行为差异。
- 未发版。
