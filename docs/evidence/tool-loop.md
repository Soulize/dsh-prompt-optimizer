# 只读工具循环 · 核验

- 项目根：`C:\Users\WestFox\.dsh\plugins\dsh-prompt-optimizer` · 上限轮次：正常 3 / 超限 2 · 总耗时 60602ms
- 越界负例：`read ../../../../etc/hosts` → {"result":"拒绝：路径越出项目范围（只读工具限定在项目根内）"}

## ① 正常查证

- 实际轮次 4 · 工具调用 9 次 · 产出 5014 字 · error=null

| # | 轮 | 工具 | 参数 | 耗时 | 结果行数 |
|---|---|---|---|---|---|
| 1 | 1 | read | `{"path":"package.json"}` | 3ms | 52 |
| 2 | 1 | read | `{"path":"README.md"}` | 3ms | 14 |
| 3 | 1 | grep | `{"pattern":"send|intercept|allow|pass|放行|拦截","path":"src"}` | 1ms | 1 |
| 4 | 1 | glob | `{"pattern":"src/**/*"}` | 1ms | 2 |
| 5 | 2 | read | `{"path":"src/client/index.ts"}` | 1ms | 35 |
| 6 | 2 | read | `{"path":"lib/client.js"}` | 1ms | 98 |
| 7 | 2 | read | `{"path":"lib/index.js"}` | 0ms | 105 |
| 8 | 3 | grep | `{"path":"lib/client.js","pattern":"放行|拦截|allow|blockReason|passthrough|pass"}` | 0ms | 41 |
| 9 | 3 | grep | `{"path":"lib","pattern":"return true|return false|shouldIntercept|decide"}` | 2ms | 16 |

### 产出中的 文件:行号 引用 · 逐条回读核对

| 引用 | 文件存在 | 该行真实内容 |
|---|---|---|
| `lib/index.js` | ✅ | （未给行号） |
| `lib/client.js` | ✅ | （未给行号） |
| `lib/client.js:280` | ✅ | `h("button", { type: "button", className: "dpo-btn primary", "data-dpo": "release", onClick: release }, "放行本条（按原文发出）"),` |
| `src/client/index.ts` | ✅ | （未给行号） |
| `tsdown.config.ts` | ✅ | （未给行号） |
| `tsconfig.json` | ✅ | （未给行号） |
| `package.json` | ✅ | （未给行号） |
| `lib/client.js:141` | ✅ | `/* ══════════ 拦截判定（唯一真源，探针与真实手势共用） ══════════ */` |
| `lib/client.js:100` | ✅ | `const STOP_LABELS = new Set();` |

## ② 超限收敛

- rounds=3 · converged=true · 工具调用 6 次 · 产出 5472 字 · error=null

```markdown
## 优化后的提示词

> 以下内容为交付给下游编码/助手 AI 的执行准则，可直接粘贴使用（方括号内为需你填写的占位符）。

### 角色与任务
你是只读代码审计员。任务：把本仓库内**每一个源文件与构建产物**逐个读一遍，逐个说明「作用」与「风险」，产出审计报告，并据此给出后续修改提示词。
本任务**不修改任何文件**。

### 已确认事实（可直接引用，但执行时须复核）
以下由一次只读枚举 + 4 个文件读取得到，**可直接作为起点**，但不得替代你自己的读取：

- 已枚举文件共 9 个（`**/*` 命中 5 条，顶层 `*` 命中 4 条，**未覆盖隐藏文件与 node_modules，清单可能不全**）：
  - 源码：`src/index.ts`、`src/client/index.ts`
  - 构建产物：`lib/index.js`、`lib/client.js`
  - 脚本：`scripts/build.sh`
  - 配置/文档：`package.json`、`tsconfig.json`、`tsdown.config.ts`、`README.md`
- `package.json`：name `@dsh-external/dsh-prompt-optimizer`，version `0.0.1`，`private: true`，`type: module`，license BSD-3-Clause；description「在 DSH Web 输入框接管发送手势并优化提示词（可拖动迷你视窗、三档优化、可回退）」；`main` = `./lib/index.js`；`types` = `./lib/types/index.d.ts`；`files: ["lib"]`；exports `.`→`lib/index.js`、`./client`→`lib/client.js`；scripts：`build` = `bash scripts/build.sh`、`typecheck` = `tsc -p tsconfig.json --noEmit`、`build:client` = `tsdown`；peerDependencies：`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`、`cordis` ^4、`schemastery` ^3.18、`@deepseek-ai/dsh-client-ui-slots`；`dsh.client.inject` = [`@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-slots`]，`platform: web`。
- `tsconfig.json`：target ES2023、module/moduleResolution NodeNext、`strict: true`、`declaration: true`、`declarationDir: lib/types`、`outDir: lib`、`rootDir: src`、`sourceMap: true`、`include: ["src"]`。
- `tsdown.config.ts`：单入口 `src/client/index.ts` → `lib/client.js`；format cjs、platform browser、`dts: false`、`codeSplitting: false`；输出被 banner/footer 包裹为 `window.__ModuleLoader__.load({ id: "@dsh-external/dsh-prompt-optimizer", factory: (require) => { … } })`；`neverBundle`（外部化）为 react、react/jsx-runtime、react-dom、react-dom/client、cordis、@deepseek-ai/dsh-client-ui-slots、@deepseek-ai/dsh-client-runtime/client；其余 id 一律 `alwaysBundle`。
- `README.md`：构建需 `DSH_CHECKOUT=<checkout> bash scripts/build.sh`；注入需在注入器环境内执行 `dev_inject_plugin <本目录>`；文件由 `dsh-super-injector dev_scaffold_plugin` 生成。
- **尚未读取（禁止对其内容下任何结论）**：`src/index.ts`、`src/client
```