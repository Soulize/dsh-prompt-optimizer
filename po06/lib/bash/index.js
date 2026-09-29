/**
 * @dsh-external/dsh-bash-runtime — 把内置 Bash 工具接入模型工具面（无需 WSL）。
 * 说明按注入器性能铁律压短；完整契约与诊断走返回值。
 */
// 0.7.1：并入 po06 后**不再 import 宿主的 defineTool / schemastery** —— 装配包（tgz 解包到
// profile/node_modules）解析不到它们，模块 import 会整体失败，表现是"bash 工具静默消失"。
// 注册改为**裸 tools.register + 对象根 JSON Schema**（与 po06 自己的 posix 工具同一做法）。
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'

export const name = "@dsh-external/dsh-bash-runtime"
export const inject = ['tools']

export const DEFAULT_BASH_CONFIG = Object.freeze({
  // 留空 = 自动解析（env DSH_BASH_PATH → 自带 bundle → Git → MSYS2 → PATH）。
  // 不再硬编码 D:/other/Git/... 这类机器专属路径。
  bashPath: '',
  bundledRuntimeDir: '',
  timeoutMs: 120000,
  // 单次调用的**上限**（安全网）。取值理由：默认 10 分钟足够跑常见的编译/测试，
  // 又能挡住"传个 70 分钟，把已经卡死的命令一直挂着"这种失控（2026-09-25 实测：
  // 一条含 npm i 的命令被传了 timeoutMs=4200000，真的挂满 70 分钟才被终止）。
  // ⚠ 钳制是**安全网**，不是替代模型判断：真实上限会写进工具描述，让模型自己决定该用多少。
  maxTimeoutMs: 600000,
})

/** 配置归一（替代原 schemastery schema）：缺失/非法值一律回落默认，避免 NaN 传进钳制。 */
export function normalizeBashConfig(c) {
  const o = c && typeof c === 'object' ? c : {}
  const num = (v, dv) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : dv)
  return {
    bashPath: typeof o.bashPath === 'string' ? o.bashPath : '',
    bundledRuntimeDir: typeof o.bundledRuntimeDir === 'string' ? o.bundledRuntimeDir : '',
    timeoutMs: num(o.timeoutMs, 120000),
    maxTimeoutMs: num(o.maxTimeoutMs, 600000),
  }
}

const load = (file) => import(new URL('./' + file, import.meta.url).href)

/**
 * 把调用方给的 timeoutMs 收进 [1, max]；非法值回落缺省。**纯函数**。
 * 这是**安全网**，不是决策者：真实上限已写进工具描述，模型可据此自行判断该用多少。
 */
export function clampTimeout(requested, fallback, max) {
  const n = Number(requested)
  const base = Number.isFinite(n) && n > 0 ? n : fallback
  return Math.min(base, max)
}

function bashRootFor(hostRoot) {
  const p = hostRoot.replaceAll('\\', '/')
  return p.replace(/^([A-Za-z]):/, (_m, d) => '/' + d.toLowerCase())
}

/**
 * 长等待 + 少产出的**当场反馈**（2026-09-27，用户实测：这类调用把整轮时间吃光）。
 *
 * 为什么必须写在返回里、而不是只写在工具描述里：描述只在决策时被扫一眼，
 * 而"这次花了 3 分钟只拿回 0 字节"是模型**下一步真正会读到的证据**。工具自己知道耗时与输出量，
 * 把这两个数字交回去，它下一轮就会自己改调用粒度——比任何提示词都直接。
 *
 * 只在**真的浪费**时出声（耗时够长，且输出少或把输出丢了）；短命令一律不打扰。
 */
export function costNote(ms, command, outLen) {
  const secs = Math.round(Number(ms) / 1000) || 0
  const swallowed = />\s*\/dev\/null/.test(String(command || ''))
  const wasteful = secs >= 60 && (Number(outLen) < 400 || swallowed)
  if (!wasteful) return ''
  const lines = [
    '',
    '[本次耗时 ' + secs + 's，交回 ' + Number(outLen) + ' 字节'
      + (swallowed ? '（而且你把 stdout 丢进了 /dev/null）' : '') + ']',
    '这种"等很久、回来没东西"的调用是这类活最贵的失败方式，下次这样处理：',
  ]
  if (swallowed) lines.push('- 别把输出丢掉：这条命令的价值就是它的输出，丢了之后只剩退出码。')
  lines.push('- 一条命令只干一件事：组装、构建、取图分开调用——失败能定位，也不会一次赔进去几分钟。')
  lines.push('- 先用最便宜的办法验证（打印尺寸/统计就够），确认通了再上重武器（puppeteer 这类）。')
  lines.push('- timeoutMs 按"最慢的单步"给，不是按整条链给；预计超过 120s 的单步要拆。')
  return lines.join('\n')
}

/**
 * **链结构识别**（判定机制之一，2026-09-27）：命令被串成多段时，只有短路型连接符（`&&`）会把失败
 * 暴露成非零退出；`;`、`|`、`||` 会**吞掉中间段的失败** —— 任务跑到半路死了，模型从退出码和
 * 输出里都看不出来。这个判据是机械可判的，且与快慢无关。
 *
 * 不追求完整 shell 解析（引号外的分隔符够用了）：目标只是判断"这条链会不会吞错"。
 */
export function splitStages(command) {
  const s = String(command || '')
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (quote) { cur += c; if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    const two = c + (s[i + 1] || '')
    if (two === '&&' || two === '||') { out.push(cur); cur = ''; out.push(two); i += 1; continue }
    if (c === ';' || c === '|') { out.push(cur); cur = ''; out.push(c); continue }
    cur += c
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

/** 吞错型连接符 + 段数 ≥3 ⇒ 中间段失败不可见。（返回空串＝没问题，不打扰。） */
export function chainFinding(command) {
  const parts = splitStages(command)
  const cmds = parts.filter((p) => p !== '&&' && p !== '||' && p !== '|' && p !== ';')
  const swallowers = parts.filter((p) => p === ';' || p === '|' || p === '||')
  if (cmds.length < 3 || swallowers.length === 0) return ''
  const uniq = [...new Set(swallowers)]
  return '这条链有 ' + cmds.length + ' 段，而且用了会**吞掉失败**的连接符（' + uniq.join(' ') + '）：'
    + '中间某段失败了，从退出码和这份输出里都看不出来。判断"是不是跑到半路就死了"，只有分开跑。'
}

/**
 * **重武器识别**（判定机制之二，2026-09-27）：判"这条路本身就不该走"。
 * 工具判不了语义，所以不是替模型决定，而是**把更省的路直接递到手上**——
 * 这条知识写在代码里，不靠模型临场想（与任务类 playbook 同一思路）。
 */
const HEAVY = [
  { re: /puppeteer|playwright|selenium|--headless/i, name: '无头浏览器',
    alt: '更便宜的路（取渲染结果）：先让页面自己把要的东西 dump 成 JSON/文本（canvas 就 toDataURL 或读像素统计），'
      + '不够再考虑起浏览器；必须起浏览器时**只跑一次并把结果落盘**，后面读文件，别每次重跑；'
      + '再不行先花一秒只验证"文件能加载、canvas 有尺寸"，确认通了再取图。' },
  { re: /\bnpx\b|\bnpm (i|install|ci)\b|\bpnpm i\b|\byarn( install)?\b/i, name: '装包/拉依赖',
    alt: '更便宜的路：装包是网络类慢活，**单独跑一次并确认能通**，别并进长链；能复用已有依赖就别重装。' },
  { re: /git clone|\bcurl\s|\bwget\s/i, name: '网络下载',
    alt: '更便宜的路：网络下载同样单独跑；先确认可达，再决定要不要整仓拉取（浅克隆往往够用）。' },
  { re: /docker (build|compose)|msbuild|dotnet build|cargo build|webpack|vite build/i, name: '重构建',
    alt: '更便宜的路：构建拆成"先编译一个小目标"验证工具链，再跑全量；全量构建别和取图/测试串成一条。' },
]

/** 命中的重武器（可能多个）。 */
export function heavyFindings(command) {
  const s = String(command || '')
  return HEAVY.filter((h) => h.re.test(s)).map((h) => '（重武器：' + h.name + '）' + h.alt)
}

/**
 * 组合成"这次调用值不值"的当场反馈。**只在明显不值时出声**：
 * 慢、或几乎没输出、或吞了输出、或失败、或超时 —— 任一成立才附加结论；快且有产出的一次不打扰。
 */
export function usageNote(o) {
  const opt = o || {}
  const c = String(opt.command || '')
  const ms = Number(opt.ms) || 0
  const outLen = Number(opt.outLen) || 0
  const failed = opt.failed === true
  const timedOut = opt.timedOut === true
  const swallowed = />\s*\/dev\/null/.test(c)
  const costly = ms >= 60000 || outLen < 400 || swallowed || failed || timedOut
  if (!costly) return ''
  const lines = []
  const base = costNote(ms, c, outLen)
  if (base) lines.push(base)
  else lines.push('', '[本次耗时 ' + Math.round(ms / 1000) + 's，交回 ' + outLen + ' 字节' + (failed ? '，且**失败**' : '') + ']')
  const chain = chainFinding(c)
  if (chain) lines.push('- ' + chain)
  for (const h of heavyFindings(c)) lines.push('- ' + h)
  return lines.join('\n')
}

/**
 * **崩溃/中止探测器**（2026-09-29，用户实测）。
 *
 * 为什么必须有它：调用被**外层**掐掉时（真机现场 `AbortError: ABORTED` + `tool call aborted`，
 * 正好卡在 timeoutMs 上），工具**根本没机会返回任何东西**——没有输出、没有退出码、没有耗时。
 * 模型看到的就是一句"被中止了"，既不知道白等了多久，也不知道下次该怎么改。
 *
 * 机制：调用前落一个"进行中"标记，正常结束就清掉；被掐死时标记留着 →
 * **下一次调用开头点明**。这是唯一能覆盖那条路径的办法：那一刻工具已经交不出东西了。
 *
 * ⚠ 只在标记**够旧**时才报（默认 2 分钟）：并发调用会有多个标记同时在飞，立刻报会把同批
 *   兄弟调用误报成"上次没回来"。这是已知的粗判——宁可漏报，不要误报。
 */
export const INFLIGHT_MIN_AGE_MS = 120000

function inflightPath() {
  const home = process.env.DSH_HOME || (homedir() + '/.dsh')
  return String(home).replace(/[\\/]+$/, '') + '/po06-bash-inflight.json'
}

export function readInflight() {
  try {
    const t = readFileSync(inflightPath(), 'utf8')
    const j = t ? JSON.parse(t) : null
    return (j && typeof j.startedAt === 'number') ? j : null
  } catch { return null }
}

export function writeInflight(rec) {
  try { writeFileSync(inflightPath(), JSON.stringify(rec)) } catch { /* 落不下就退化成没有这个机制 */ }
}

export function clearInflight() {
  try { rmSync(inflightPath(), { force: true }) } catch { /* best effort */ }
}

/** 上一次没正常收尾时给出提示；否则空串（不打扰）。 */
export function inflightNote(prev) {
  if (!prev || typeof prev.startedAt !== 'number') return ''
  const age = Date.now() - prev.startedAt
  if (age < INFLIGHT_MIN_AGE_MS) return ''
  const mins = Math.round(age / 60000)
  return [
    '',
    '[上一次 bash 调用没有正常收尾：' + String(prev.head || '').slice(0, 70) + '，已过去约 ' + mins + ' 分钟]',
    '它既没返回输出、也没返回退出码（多半是被外层 deadline 中止或进程被杀）——那次等待是纯损失。',
    '这类活换成"落盘 + 稍后读文件"：让脚本把结果写进文件并立刻返回，再用一次调用去读那个文件。',
    '',
  ].join('\n')
}

/** 收尾：清掉标记并给出提示（返回字符串可直接前置到结果）。 */
export function finishInflight(prev) {
  clearInflight()
  return inflightNote(prev)
}

export function apply(ctx, config) {
  config = normalizeBashConfig(config)
  ctx.effect(() => ctx.tools.register({
    name: 'bash',
    description: '执行 bash 命令（GNU bash / MSYS2，不是 PowerShell 也不是 cmd）；命令内用 POSIX 路径（盘符写作 /d/...），workdir 用宿主路径（D:/...）；需原样传参用 args 数组（成为 $1…$n，$0=dsh-bash）；非零退出不会自动重试或换后端。',
    // ⚠ 裸 register 要求**对象根 JSON Schema**：逐属性 required:true 的方言只有 defineTool 的
    // 编译路径才认，裸传会被宿主直接拒（po06 的 posix 就栽过，且失败不冒泡 ⇒ 工具静默缺席）。
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command', 'description'],
      properties: {
      command: { type: 'string', description: 'bash 源文本；含空格或特殊字符的参数用单引号包裹。' },
      // 客户端 dsh-client-ui-tool 的 shellCall() 要求 description：缺失时会退化成
      // "persistent shell" 通用卡片并把结果走 generic 路径（实测表现：UI 显示通用图标与代码块）。
      // host 的 bash/pwsh 工具同样把它声明为必填（"shown in the UI"）。
      description: { type: 'string', description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" → "List files in current directory".' },
      args: { type: 'array', items: { type: 'string' }, description: '原样传给脚本的参数，依次为 $1…$n（不经 shell 解析）。' },
      workdir: { type: 'string', description: '工作目录（宿主路径，须在工作区内）。缺省用会话目录。' },
      // 描述里给出**真实**的缺省值与上限（2026-09-25 修复）：原先只写"到期终止整个进程树"，
      // 模型无从判断该给多少，于是出现"传 4200000ms、把一条卡死的命令挂满 70 分钟"。
      // 钳制仍然生效（安全网），但**先让模型有依据自己决定**——给出上限和判断规则，
      // 比替它决定更可靠（用户 2026-09-25："模型本身应该也要有自主思考来调整的能力"）。
      timeoutMs: {
        type: 'number',
        description: '毫秒截止时间；到期终止**整个进程树**并回收。缺省 ' + config.timeoutMs + 'ms，'
          + '上限 ' + config.maxTimeoutMs + 'ms（超过会被钳制到上限）。判断依据：本地快命令（ls/cat/grep/printf）用缺省；'
          + '编译或测试可适当提高并**拆成多步**；网络操作（npm/pip/curl/git clone）耗时不可预测，**单独跑并确认能通**，不要并入长链。'
          + '若本工具是在 run_code 等外层程序里被调用，外层的 deadline 必须**大于**这里的 timeoutMs，否则外层会先终止整个程序。'
          + '**一条命令只干一件事**：把组装、构建、取图这类阶段分开调用，别串成一条长链——'
          + '串链一旦某步卡住，就是一次赔进去几分钟、还拿不到可比对的信息。'
          + '**不要吞输出**（>/dev/null 这类）：命令的价值就是它的输出。'
          + '跑 Windows 原生程序（node、python、构建工具）时 pwsh 通常更快更稳；bash 更适合 POSIX 管线（grep/sed/awk/shell 脚本）与需要 bash 语义的场景。',
      },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      let gov, jobport, contract, wsmod, provision
      try {
        [gov, jobport, contract, wsmod, provision] = await Promise.all([
          load('process-governance.mjs'), load('pg-jobport.mjs'), load('bash-tool-contract.mjs'), load('workspace-semantics.mjs'), load('runtime-provision.mjs'),
        ])
      } catch (e) {
        // 安装损坏时给出可读诊断，而不是把异常抛给宿主
        return [
          '【发生了什么】插件运行时模块加载失败，命令未执行。',
          '【为什么】' + String((e && e.message) || e),
          '【下一步】1. 重新安装/重打包插件（lib 目录应包含 process-governance.mjs、pg-jobport.mjs、bash-tool-contract.mjs、workspace-semantics.mjs、runtime-provision.mjs、runtime-layout.mjs）。 2. 若为手工放置，确认上述文件齐全后重试。',
        ].join('\n')
      }
      // 自带/指定的运行时必须把它自己的 bin 放进 PATH：
      // 否则 bash 能启动，但 head/grep/sort 等外部命令全部 command not found（实测 rc=127）。
      const withRuntimePath = (exePath) => {
        const sep = exePath.lastIndexOf('\\') >= 0 ? '\\' : '/'
        const bin = exePath.slice(0, exePath.lastIndexOf(sep))
        return { ...process.env, PATH: bin + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH || '') }
      }
      let bashPath = config.bashPath
      if (!bashPath) {
        // 默认从插件自带目录解析。0.7.1 起本文件位于 <plugin>/lib/bash/index.js
        // （以前是 <plugin>/lib/index.js），所以要多退一级才到 <plugin>/runtime。
        const selfBundled = new URL('../../runtime', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replaceAll('/', '\\')
        const resolved = provision.resolveBashRuntime({ env: process.env, platform: process.platform, bundledRuntimeDir: config.bundledRuntimeDir || selfBundled })
        if (!resolved.ok) return resolved.repair.join('\n')
        bashPath = resolved.path
      }
      // 工作区根必须取**会话工作区**，而不是宿主进程 cwd：
      // 实测宿主进程 cwd 通常是 C:\Users\<user>，而会话工作区可能在 D:\...，
      // 用进程 cwd 会把用户真实工作区判成 OUTSIDE_WORKSPACE。
      const session = exec && exec.agent && exec.agent.session ? exec.agent.session : null
      const root = [
        session && session.header ? session.header.cwd : undefined,
        session && session.meta ? session.meta.cwd : undefined,
        exec && exec.cwd,
        process.cwd(),
      ].find((v) => typeof v === 'string' && v.length > 0)
      let workspace
      try { workspace = wsmod.createWorkspace({ hostRoot: root, bashRoot: bashRootFor(root) }) }
      catch (e) { return '工作区初始化失败：' + String(e && e.message || e) }
      const target = args.workdir ? wsmod.toBashPath(workspace, args.workdir) : { ok: true, hostPath: root, bashPath: workspace.bashRoot }
      if (!target.ok) {
        return contract.renderToolError({ category: 'unmapped-path', paths: { errno: target.reason, path: args.workdir }, availableMappings: [root + ' → ' + workspace.bashRoot] }).message
      }
      let tempDir
      try {
        tempDir = wsmod.tempDirFor(workspace, 'tool-' + process.pid)
        mkdirSync(tempDir.hostPath, { recursive: true })
      } catch (e) { return '临时目录不可用：' + String(e && e.message || e) }
      const port = jobport.createJobPort({
        cwd: target.hostPath,
        makePaths: (n) => ({ stdout: tempDir.hostPath + '/out-' + n + '.bin', stderr: tempDir.hostPath + '/err-' + n + '.bin' }),
      })
      const t0 = Date.now()
      // 崩溃/中止探测器：先落"进行中"标记；被外层掐死时它会留到下一次调用。
      const prevInflight = readInflight()
      writeInflight({ startedAt: t0, head: String(args.command || '').slice(0, 80), pid: process.pid })
      let governed
      try {
        governed = await gov.runGoverned({
          command: bashPath,
          args: ['-c', args.command, 'dsh-bash', ...(args.args || [])],
          cwd: target.hostPath,
          env: withRuntimePath(bashPath),
          timeoutMs: clampTimeout(args.timeoutMs, config.timeoutMs, config.maxTimeoutMs),
          stdoutMaxBytes: 65536,
          exitPlatform: 'win32',
        }, port)
      } catch (e) {
        const m = String(e && e.message || e)
        if (m.includes('RUNTIME_INTEGRITY_FAILED')) {
          return contract.renderToolError({ category: 'integrity', integrity: { errno: 'RUNTIME_INTEGRITY_FAILED', problems: e.problems || [], repair: e.repair || [] } }).message
        }
        return contract.renderToolError({ category: 'spawn-error', spawnError: m }).message
      }
      const marker = (code, signal) => (typeof code === 'number' ? '[exit code: ' + code + ']' : signal ? '[killed by signal: ' + signal + ']' : '[exit code: 1]')
      const bad = governed.reason !== 'exit' || governed.outcome.exitCode !== 0 || governed.streams.stderr.truncated
      if (bad) {
        const rendered = contract.renderToolError({
          category: governed.reason === 'exit' ? 'exit' : governed.reason,
          exitCode: governed.outcome.exitCode,
          signal: governed.outcome.signal,
          stderr: governed.streams.stderr.text,
          truncated: governed.streams.stdout.truncated,
          spillPath: governed.streams.stdout.spillPath,
          timeoutMs: governed.timeoutMs,
          maxTimeoutMs: config.maxTimeoutMs,
          spawnError: governed.spawnError || undefined,
        }).message
        // 保留三段式可执行诊断，同时在**末尾**补上客户端可解析的状态标记
        return finishInflight(prevInflight) + rendered + '\n' + marker(governed.outcome.exitCode, governed.outcome.signal)
          + usageNote({
            ms: Date.now() - t0,
            command: args.command,
            outLen: (governed.streams.stdout.text || '').length,
            failed: true,
            // 非 exit 的结束原因（超时/被杀）都算"不是正常跑完"，这是最需要点明的一种。
            timedOut: governed.reason !== 'exit',
          })
      }
      const LIMIT = 16000
      const text = governed.streams.stdout.text
      const tooLong = governed.streams.stdout.truncated || text.length > LIMIT
      const parts = []
      // 截断提示必须前置：否则模型先被海量输出淹没，看不到"完整输出在哪"
      if (tooLong) {
        // spill 路径必须转成 bash 可见形式，否则"用 grep/head 直接读该文件"在 bash 里不可用
        let spillShown = governed.streams.stdout.spillPath || ''
        if (spillShown) {
          const mapped = wsmod.toBashPath(workspace, spillShown)
          spillShown = mapped.ok ? mapped.bashPath : spillShown.replaceAll('\\', '/')
        }
        parts.push('[输出过长：仅显示' + (governed.streams.stdout.truncated ? '截取后的' : '前') + LIMIT + '字符' + (spillShown ? '；完整输出在 ' + spillShown : '') + '。需要细节时用 grep/head 直接读该文件]')
      }
      parts.push(tooLong ? text.slice(-LIMIT) : text)
      if (governed.streams.stderr.text.length > 0) parts.push('[stderr] ' + governed.streams.stderr.text.slice(0, 4000))
      // 客户端 dsh-client-ui-tool 的 parseExitStatus 需要文本以 "\n[exit code: N]" 结尾
      // 才能渲染出 shell 卡片的退出状态；格式不符会退化为通用渲染。
      parts.push('[exit code: 0]')
      return finishInflight(prevInflight) + parts.join('\n') + usageNote({ ms: Date.now() - t0, command: args.command, outLen: text.length, failed: false, timedOut: false })
    },
  }), '@dsh-external/dsh-bash-runtime: bash tool')
}
