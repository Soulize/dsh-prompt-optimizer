# 方向化重跑 · 核验

- 档位 `advanced` · 需求：把那个页面弄好看点，动画也加上，顺手把数据那块也修一下
- 基线 A：1981 字 / 18823ms · 基线 B（独立会话）：2444 字

| 版本 | 方向 | 字数 | Δ字数 | 方向度量 | 耗时 |
|---|---|---|---|---|---|
| v1 | （基线） | 1981 | - | - | 18823ms |
| v2 | 预设·更简洁 | 1687 | -294 | {"kind":"concise","chars":1687} | 9388ms |
| v3 | 预设·更具体 | 3205 | +1518 | {"kind":"concrete","criteriaWords":33} | 24765ms |
| v4 | 自由输入·最小改动 | 4045 | +840 | {"kind":"minimal","hasUndoneList":true} | 20993ms |

- 版本不变性：v1 哈希前后一致 = true（hpvdapw-len1981）
- 会话隔离：A 版本数 4 / B 版本数 1 · B 哈希不变 = true
- 回退：{"requested":true,"before":{"versions":4,"inFlight":1,"status":"running","current":4},"after":{"versions":4,"inFlight":0,"status":"rolled-back","current":4},"abortedEntry":{"n":5,"aborted":true,"ms":3232,"chars":0,"error":"llm-aborted: {\"message\":\"DeepSeek request aborted by caller\",\"code\":\"ABORTED\"}"}}

## 各版本产出（首段，供肉眼对照方向是否生效）

### v2 · 预设·更简洁

```markdown
## 优化后的提示词

**任务**（cwd：`C:\Users\WestFox\.dsh\plugins\dsh-prompt-optimizer`，仅此三项）
1. 视觉：把"那个页面"弄好看点。
2. 动画：加上动画。
3. 数据：修复"数据那块"。

**先定位，再动手**
- "那个页面"：最小推断为 `src/client/`（仓库唯一的客户端 UI 位置，`lib/client.js` 为其产物）。动手前先读 `README.md`、`package.json`
```

### v3 · 预设·更具体

```markdown
## 优化后的提示词

**任务**（cwd：`C:\Users\WestFox\.dsh\plugins\dsh-prompt-optimizer`；仅此三项）
1. 视觉：把"那个页面"弄好看点。
2. 动画：给该页面加动画。
3. 数据：修"数据那块"。

**第 0 步：定位**（完成判据：能写出确定的文件路径，且路径在仓库中存在）
- 读 `README.md`、`package.json`、`src/client/`、`src/index.ts`、`scripts
```

### v4 · 自由输入·最小改动

```markdown
## 优化后的提示词

**任务**（cwd：`C:\Users\WestFox\.dsh\plugins\dsh-prompt-optimizer`；就这三项）
1. 视觉：把"那个页面"弄好看点。
2. 动画：给该页面加动画。
3. 数据：修"数据那块"。

**总原则：最小改动优先**（贯穿下面每一项）
- 能改 1 行就不改 10 行；能改现有属性的值，就不新增规则/文件；能只碰 1 个文件就不碰第 2 个。
- 顺序执行 ①→②→③，每项做完先自检再进下一项；三项各
```
