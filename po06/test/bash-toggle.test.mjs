// 内置 Bash 所有权与开关回归。
// 非 Windows：宿主本来提供 Bash，po06 必须让位；Windows：宿主官方禁用 Bash，po06 才补位。
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name) } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message || e)) } }
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)) }

function fakeTools() {
  const table = new Map()
  return {
    table,
    register: (def) => { table.set(def.name, def); return () => { table.delete(def.name) } },
    schemas: () => [...table.values()],
    has: (n) => table.has(n),
  }
}
function fakeCtx(tools) {
  const ctx = {
    get: (n) => (n === 'tools' ? tools : null),
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
    inject: (_list, cb) => { cb({ tools, effect: ctx.effect }) },
  }
  return ctx
}

const home = mkdtempSync(join(tmpdir(), 'po06-bash-toggle-'))
process.env.DSH_HOME = home
const cfg = join(home, 'po06.json')
const write = (bash) => writeFileSync(cfg, JSON.stringify({
  settingsVersion: 1,
  enabled: true,
  rollout: { mode: 'all' },
  bash,
}, null, 2) + '\n', 'utf8')

const mod = await import('../lib/index.js')
const tools = fakeTools()
const ctx = fakeCtx(tools)

t('所有权策略：只在 Windows 且用户启用时提供内置 Bash', () => {
  eq(mod.shouldProvideBuiltInBash({ platform: 'win32', enabled: true }), true, 'Windows 补位')
  eq(mod.shouldProvideBuiltInBash({ platform: 'win32', enabled: false }), false, 'Windows 也尊重关闭')
  eq(mod.shouldProvideBuiltInBash({ platform: 'linux', enabled: true }), false, 'Linux 让位宿主')
  eq(mod.shouldProvideBuiltInBash({ platform: 'darwin', enabled: true }), false, 'macOS 让位宿主')
})

t('当前平台：设置 true 后工具表符合所有权策略', () => {
  write(true)
  const r = mod.syncBashTool(ctx)
  const expected = process.platform === 'win32'
  eq(r.ok, true, '同步应成功')
  eq(tools.has('bash'), expected, '工具表必须符合平台所有权')
  if (expected) ok(r.disposers >= 1, 'Windows 补位必须拿到真实注销器')
})

t('设置 false：任何平台都不得留下 po06 内置 Bash', () => {
  write(false)
  const r = mod.syncBashTool(ctx)
  eq(tools.has('bash'), false, '关闭后工具表不得有 po06 Bash')
  eq(r.ok, true, '同步应成功')
})

t('开关往返：Windows 真注册/注销；其它平台始终让位宿主', () => {
  const got = []
  for (const v of [true, false, true, false]) {
    write(v)
    mod.syncBashTool(ctx)
    got.push(tools.has('bash'))
  }
  const expected = process.platform === 'win32'
    ? 'true,false,true,false'
    : 'false,false,false,false'
  eq(got.join(','), expected, '工具表必须同时反映设置与平台所有权')
})

rmSync(home, { recursive: true, force: true })
console.log(JSON.stringify({ suite: 'po06-bash-toggle', total: pass + fail, pass, fail }, null, 1))
if (fail > 0) process.exit(1)
