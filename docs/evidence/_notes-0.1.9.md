作者：啃轮胎的西狐

**修复：放行/回退后仍被自动发出第二条（表现为「排队发送」）**
- 根因：`releaseOriginal()` / `rollbackYes()` 只清了 `store.run`，但 SSE 事件闭包里持有的那份 run 对象依旧存活；`done` 事件只看 `store.permission === "auto"` 就调用 `autoSend()` → 用户已经放行或回退之后，又自动提交了一次（第二次撞上正在处理的会话，于是变成「排队发送」）。回退路径更严重：面板明确承诺「不发送任何消息」。
- 修法：给运行加"已被用户终结"标记（`run.settled = released / rolled-back`），`autoSend()` 与 `done` 分支都先看这个标记；`autoSend` 自身置 `settled = auto-sent` 保证同一次运行只自动发送一次；放行时同时关流并向后端 `/run/abort`（不再白烧 token）。
- 回归测试 `release-race-demo`（客户端自检，提交用计数桩、不真发消息）：放行后 `submit` 增量必须是 1、回退必须是 0、以及"流仍活着且 `done` 真的到达"时必须是 0（该场景打出 `done-after-settle` 证据）。
- 负对照（保留同一份自检、只拆掉守卫）实测 `PASS=false`：放行用例 `submitDelta=2`、`sentFlag=true`，第二次发出的正是优化后的文本；守卫用例漏发 1 次 —— 证明该缺陷真实存在且此测试抓得住它。
- 修复版复验：`PASS=true`，`submitDelta` 分别 1 / 0 / 0，客户端报错 0 行。

**同批一并发布：传话 AI 提示词的提效与硬化（详见 PROMPT-OPTIMIZATION.md）**
- 三档 system 改为共用部件 + `buildSystem(tier, { historyMode })` 组装；重复表述三处合一，普通档 1445 → 1319 字符（−8.7%）。
- 约束力硬化：长度上限、逐句回溯删除、软措辞禁令（尽量/最好/建议… → 必须/不得/判据）、硬约束三分类 + 每条违反时的处置 + 不得替用户承诺、事实纪律白名单化。
- 新增**难度 → 开发长度**判定：轻（默认，禁止建 goal/todo/计划）/ 中（3~6 条 todo）/ 重（建 goal + 分阶段 + 每阶段验证）；高危信号命中即不得停留在轻档；未命中不得升档、不得因字数多升档。带标准答案的判定用例终测 12/12，漏隐患 0、徒增开销 0。
- 修复全文模式下的提示词谎报（旧文案称"工作 AI 回复只留长度"，而全文模式恰恰发送全文）——拆成回合/全文两份纪律，按 `run.historyMode` 注入。

---

本版本安装包见下方 Assets（`npm pack` 产物）。完整提示词改动与依据：`PROMPT-OPTIMIZATION.md`。
