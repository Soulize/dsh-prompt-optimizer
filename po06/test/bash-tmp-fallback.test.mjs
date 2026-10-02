import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, ensureMsysTmp } from '../lib/bash/index.js'

// issue #17：MSYS 的 /tmp 没有任何人负责创建（仓库里它是空目录 ⇒ 进不了 git、也进不了包，
// provision 也不建它），于是**非作者机器上每次调用**都往 stderr 打：
//   bash.exe: warning: could not find /tmp, please create!
// 报告者实测它把"断言 stderr 为空"的 8 个测试全弄红——不只是噪音。
//
// 本用例走**真实工具路径**：删掉自带运行时根下的 tmp，再跑一条 echo。
// ⚠ 关键点：运行时候选**探测本身就会 spawn bash**，所以兜底必须发生在加载模块/探测之前；
//   只放在真正执行那一步是不够的（实测：探测那次仍把警告打了出来）。
const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')
const BASH = join(RUNTIME, 'usr', 'bin', 'bash.exe')
const TMP = join(RUNTIME, 'tmp')

test('ensureMsysTmp 在自带运行时里建出 tmp（幂等、不抛）', () => {
  assert.equal(ensureMsysTmp(''), false, '空根目录返回 false，不抛')
  rmSync(TMP, { recursive: true, force: true })
  assert.equal(ensureMsysTmp(RUNTIME), true, '正常根目录要建成功')
  assert.equal(existsSync(TMP), true, 'tmp 要真的存在')
  assert.equal(ensureMsysTmp(RUNTIME), true, '重复调用要幂等')
})

test('bash 工具在任何 bash 启动（含探测）之前补出 /tmp（issue #17）', async (t) => {
  if (!existsSync(BASH)) return t.skip('本平台没有自带 bash 运行时，跳过')
  const workdir = mkdtempSync(join(tmpdir(), 'po06-bashtmp-'))
  let tool = null
  const ctx = { effect: (fn) => fn(), tools: { register: (def) => { tool = def; return () => {} } } }
  // 复现报告者的机器状态：注册之前 tmp 就不存在。
  rmSync(TMP, { recursive: true, force: true })
  assert.equal(existsSync(TMP), false, '前置条件：tmp 不存在')
  apply(ctx, { bashPath: '', bundledRuntimeDir: RUNTIME })
  assert.ok(tool && typeof tool.execute === 'function', 'bash 工具要注册出来')
  assert.equal(existsSync(TMP), true, '注册期就该补上（此后探测不会再报警告）')
  // 再删一次：模拟长驻进程里 tmp 事后丢失——执行入口也必须自己兜住。
  rmSync(TMP, { recursive: true, force: true })
  assert.equal(existsSync(TMP), false, '前置条件②：调用前 tmp 仍不存在')
  try {
    const out = await tool.execute(
      { command: 'echo hi', description: 'smoke', timeoutMs: 30000 },
      { agent: { session: { id: 's-tmp', header: { cwd: workdir } } } },
    )
    const text = String(out)
    assert.equal(existsSync(TMP), true, '工具必须在 spawn 之前把 <runtime>/tmp 建回来')
    assert.ok(!text.includes('could not find /tmp'), 'stderr 不得再出现 /tmp 警告：' + text.slice(0, 300))
    assert.ok(text.includes('hi'), '命令本身仍要正常执行：' + text.slice(0, 300))
  } finally {
    // 兜底：即便断言失败（修复被改坏），也不把用户的运行时留在缺 tmp 的状态。
    mkdirSync(TMP, { recursive: true })
    rmSync(workdir, { recursive: true, force: true })
  }
})
