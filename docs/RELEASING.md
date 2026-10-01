# 发布与更新工作流（RELEASING）

> 本文是**唯一**的发布操作规程。每次推送新版本，按本文从上到下逐项执行，不要跳步。
> 每一步都写了「怎么核对」——**做没做以核对结果为准，不以印象为准**。

## 一、仓库结构与规矩（先讲清楚，避免下次又乱）

```
dsh-prompt-optimizer/
├── README.md           ← 面向使用者的唯一入口：安装方法、当前版本号
├── RELEASING.md        ← 本文件（发布规程）
├── PACKAGING-NOTICE.md ← 打包避坑记录（根 package.json 为什么是薄壳）
├── package.json        ← 薄壳，自动从 po06/ 派生，不手工编辑
├── po06/               ← 当前版本的全部源码与包定义（唯一真源）
├── old/                ← 0.1~0.6 历史归档（含各代 tgz 与下载说明）
└── evidence/           ← 开发期证据留档
```

**四条不变量**（改结构时守住，违反任意一条就会重演「装到 0.5」那种事故）：

1. **版本号只有一个真源**：`po06/package.json` 的 `version`。根 `package.json` 由脚本派生，**手改无效**；
2. **根 `package.json` 必须等于 po06 的薄壳**：同名、同版本、所有路径带 `po06/` 前缀、`files` 含 `po06/runtime`；
3. **历史版本只进 `old/`**，仓库根不放任何 `.tgz`、不放旧源码；
4. **README 里的安装指向 = Release 的最新版**，两者必须同一版本号。

### 本机运行侧：始终跟随开发目录（**不要**为了"干净"去装 tgz）

本机的 `profiles/web` 用 **link 装配**开发目录，而不是装发布包：

- `profiles/web/package.json` → `"@dsh-external/dsh-arbiter-wf": "link:C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer"`（2026-10-01 由 `dsh-po06` 改名）
- `profiles/web/node_modules/@dsh-external/dsh-arbiter-wf` 是指向开发目录的 junction（`isSymlink=true`）
- 于是**改完开发目录 + 重启（或 `dev_reload_package` 热重载），运行的就是最新那一份**，不需要每次重装。

⚠ **实测踩过的坑（2026-09-30）**：这条依赖曾被钉在 `file:...dsh-external-dsh-po06-0.7.4.tgz`，于是出现
"界面上没有 0.7.8 才加的「协作基调」，而开发目录的代码明明是新的" —— **跑的是老版本，改动一次都没生效**。
唯一的判断办法：读运行侧那份的 `po06/package.json` 的 `version`，与开发目录比对。
备份见 `profiles/web/package.json.bak-po06-0.7.4`。

发布（下面第 5~9 步）只决定**访客的下载入口**，与本机运行侧无关；发布后**不要**顺手把本机也装成 tgz —— 那会把链接顶掉，再次跑回老版本。

## 二、日常开发（不发布）

```bash
cd po06
node --test test/            # 或逐套跑：node test/xxx.test.mjs
```

**核对**：全部用例通过（当前基线 **71 套 / 209 项**，`node --test po06/test/*.test.mjs`；bash 与 pwsh 两种 shell 下均需全绿）。有任何一套红，先修再谈发布。

改源码只改 `po06/` 下的东西。`old/` 只读，不修历史版本。

## 三、发布流程（逐项执行）

### 步骤 1 · 定版本号

编辑 `po06/package.json` 的 `version`，例如 `0.7.5`。

- 有后缀（`-beta.1`）⇒ 脚本会自动把 Release 标为 prerelease；
- 无后缀 ⇒ 正式版。

**核对**：`node -e "console.log(require('./po06/package.json').version)"` 打出的是你要发的号。

### 步骤 2 · 更新 CHANGELOG

在 `CHANGELOG.md` 顶部按既有格式加一节，写清：这一版**改了什么**、**为什么**、**影响谁**。

**核对**：最新一节的版本号与步骤 1 一致。

### 步骤 3 · 更新 README 的版本与安装指向

`README.md` 里凡是出现版本号、安装命令、Release 链接的地方，全部指向**本次要发的版本**。

**同时核对所有相对链接**（2026-09-26 补：整理 `docs/` 时发现 README 指向 `README-0.5.md`，
而该文件早已随 0.5 源码移入 `old/0.5/`——**链接坏了一轮都没人发现**）。
移动/重命名任何文件之后，必须扫一遍引用它的人：

```bash
# 列出 README 里的全部相对链接，逐个确认文件还在
grep -o ']([^)]*\.\(md\|json\|yml\)[^)]*)' README.md docs/*.md
```

**核对**：上面命令列出的每一个路径都能在仓库里找到（不存在就是断链，当场修）。

**核对**：在 README 里搜旧版本号，应当**搜不到**（除历史说明章节外）。

### 步骤 4 · 跑全量回归

```bash
cd po06 && for f in test/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```

**核对**：无任何 FAIL 输出。

### 步骤 5 · 本地安装验证（真机，不可省）

发布前先在本机把它装上跑一次，确认**装得上、跑得起来**：

```bash
cd /path/to/dsh-prompt-optimizer
npm pack --pack-destination /tmp
```

然后检查产物（这一步防的是「包发出去了但内容不对」）：

ⓐ 解包看 `package.json` 的 `name` / `version` / `main` 是否指向本次版本；
ⓑ 确认 `po06/runtime/usr/bin/bash.exe` 与 `po06/cordis.patch.yml` **都在包内**（漏了 runtime 会出现「装上但跑不了命令」）。

### 步骤 6 · 提交并推送

```bash
git add -A
git commit -m "release: v0.7.5 —— <一句话说清这版做了什么>"
git push origin HEAD:main        # 一律推 main，不用 dev 分支承载最新版
```

**核对**：`git log --oneline -1` 是本次提交；`git status --porcelain` 为空。

> ⚠️ **当前仓库可能还在 `dev/0.6` 分支上**。发布前先确认：`git branch --show-current`。
> 若不是 `main`，先 `git checkout main && git merge dev/0.6`（或按需 cherry-pick）再推。

### 步骤 7 · 打 tag 并推

```bash
git tag v0.7.5
git push origin v0.7.5
```

**核对**：`git tag --list "v0.7.5"` 有输出；`git ls-remote --tags origin | grep v0.7.5` 远程也有。

### 步骤 8 · 生成 Release 并上传附件

用仓库里的发布脚本一步完成（它会：同步根包 → 校验 tag → 推送 → `npm pack` → 算 sha256 → 建 Release → 传附件 → 复查）：

```bash
node po06-beta/make-release.mjs
```

**核对（三项都要看）**：

- `releases/latest` 指向本次版本；
- **Release 的附件非空**（曾经出现过附件为空的 Release，肉眼不看就发不出去）；
- 附件的 sha256 与本地算出来的一致。

### 步骤 9 · 事后核对「访客路径」

**这一步是最后的防线**：模拟一个陌生访客，用**仓库地址**安装，确认拿到的是本次版本。

**核对**：从 GitHub 页面按 README 的方法走一遍，看到的版本号 = 步骤 1 定的号。

## 四、发布前检查清单（可直接照抄执行）

```
[ ] 1  po06/package.json 的 version 已改
[ ] 2  CHANGELOG.md 顶部有对应一节
[ ] 3  README 里旧版本号已全部替换（搜过）
[ ] 3b README / docs 里的**相对链接逐个确认文件存在**（移动过文件时尤其重要）
[ ] 4  71 套测试全绿（209 项；bash 与 pwsh 都跑过）
[ ] 5  npm pack 产物里 name/version/main 正确、runtime 与 patch 都在
[ ] 6  已提交，工作树干净，且**推的是 main**
[ ] 7  tag 已打并推到远程
[ ] 8  Release 已建、**附件非空**、sha256 一致
[ ] 9  用仓库地址走一遍访客路径，拿到的是本次版本
```

## 五、出问题时的排查顺序

| 症状 | 先看这里 |
|---|---|
| 访客装到的是旧版本 | 根 `package.json` 是否还是薄壳（`name`/`version`/`main` 是否指向 po06） |
| 装上了但命令跑不了 | 包里有没有 `po06/runtime/` |
| Release 没有附件 | 重跑步骤 8；脚本会重建 Release |
| 推送被拒 | 当前分支是否是 main；先 `git pull --rebase origin main` |
| 测试红了 | 先修测试再发布；**不要**为了发版跳过红用例 |
| **切分支后工作区内容突然变旧**（README 回到旧版本、`lib/` 又冒出来、`old/` 不见了） | **本地分支落后于远程，你切到了一个过期的 main**。切入前先核对：`git rev-list --left-right --count origin/main...main`（左=落后、右=领先）；若落后 > 0，`git fetch && git reset --hard origin/main` 即可对齐 |

### 5.1 一条真实踩过的坑（2026-09-26）

发布 v0.7.6 之后，为了删分支而执行了 `git checkout main`。**那条本地 main 落后远程 322 个提交**
（全部工作都在 `dev/0.6` 上，推送时用的是 `git push origin HEAD:main`，所以远程一直是对的）——
于是工作区**瞬间回到 0.5 时代**：README 变成 `v0.5.1-beta.1`、`lib/` 重新出现、`old/` 消失。
而当时正在改 README，**改的其实是那份旧 README**，与用户在 GitHub 上看到的完全不是同一份。

**根因**：切分支前没核对本地与远程的关系。
**代价**：差点在错误的分支上提交，也差点误判成仓库出问题。
**规矩**：**任何切分支前，先跑一次 `git rev-list --left-right --count origin/main...main`**；
看到落后不为零，就先 `git fetch` + `git reset --hard origin/main` 再动手。

## 六、为什么这样设计（一句话版）

- **真源唯一**（`po06/`）：避免"两个 package.json 各说各话"——那正是外部用户装到 0.5 的原因；
- **历史进 `old/`**：主线永远只有最新版，读者不需要猜哪个是最新；
- **访客路径必须复核**：作者本机的成功不代表访客的成功，两者读的可能是不同的文件。
