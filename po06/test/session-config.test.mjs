import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureSettingsFile, writeSessionSettings, normalizeSettings, SESSION_KEYS,
} from '../lib/settings.js'
import { effectiveSettings } from '../lib/policy.js'

const dirs = []
const tempConfig = () => {
  const dir = mkdtempSync(join(tmpdir(), 'po06-session-'))
  dirs.push(dir)
  return join(dir, 'po06.json')
}
process.on('exit', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

test('首装自动创建 enabled:true + rollout:all，无需手改 JSON', () => {
  const path = tempConfig()
  const r = ensureSettingsFile({ path, now: 1 })
  assert.equal(r.ok, true)
  assert.equal(r.changed, true)
  const j = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(j.settingsVersion, 1)
  assert.equal(j.enabled, true)
  assert.deepEqual(j.rollout, { mode: 'all' })
})

test('已有显式 gate 决策不会被首装修复逻辑翻转', () => {
  const path = tempConfig()
  writeFileSync(path, JSON.stringify({ settingsVersion: 1, enabled: false, rollout: { mode: 'allowlist', sessions: ['s-a'] } }))
  const r = ensureSettingsFile({ path, now: 2 })
  assert.equal(r.ok, true)
  assert.equal(r.changed, false)
  const j = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(j.enabled, false)
  assert.equal(j.rollout.mode, 'allowlist')
  assert.deepEqual(j.rollout.sessions, ['s-a'])
})

test('bySession 支持完整会话配置，B 会话不继承 A 的覆盖', () => {
  const raw = {
    permission: 'auto', historyMode: 'turns', turns: 6, readTools: false,
    model: { provider: 'global', model: 'default' },
    effortByModel: { 'global/default': 'medium' },
    bySession: {
      A: {
        tier: 'heavy', permission: 'review', historyMode: 'full', turns: 3, readTools: true,
        model: { provider: 'p', model: 'm' }, effortByModel: { 'p/m': 'high' },
      },
    },
  }
  const a = effectiveSettings(raw, 'A')
  const b = effectiveSettings(raw, 'B')
  assert.equal(a.permission, 'review')
  assert.equal(a.historyMode, 'full')
  assert.equal(a.turns, 3)
  assert.equal(a.readTools, true)
  assert.deepEqual(a.model, { provider: 'p', model: 'm' })
  assert.deepEqual(a.effortByModel, { 'p/m': 'high' })
  assert.equal(b.permission, 'auto')
  assert.equal(b.historyMode, 'turns')
  assert.equal(b.turns, 6)
  assert.equal(b.readTools, false)
  assert.deepEqual(b.model, { provider: 'global', model: 'default' })
})

test('服务端按 session 原子合并：A/B 交替写 20 次不覆盖彼此', () => {
  const path = tempConfig()
  ensureSettingsFile({ path, now: 10 })
  for (let i = 0; i < 20; i += 1) {
    const sid = i % 2 === 0 ? 'A' : 'B'
    const patch = sid === 'A'
      ? { historyMode: i % 4 === 0 ? 'full' : 'turns', turns: i % 11, permission: 'review' }
      : { readTools: i % 4 === 1, framing: i % 3 === 0 ? 'hard' : 'neutral', permission: 'auto' }
    const r = writeSessionSettings({ path, sessionId: sid, patch, now: 20 + i })
    assert.equal(r.ok, true, 'write #' + i)
  }
  const j = JSON.parse(readFileSync(path, 'utf8'))
  assert.ok(j.bySession.A)
  assert.ok(j.bySession.B)
  assert.equal(j.bySession.A.permission, 'review')
  assert.equal(j.bySession.B.permission, 'auto')
  assert.ok(Object.hasOwn(j.bySession.A, 'historyMode'))
  assert.ok(Object.hasOwn(j.bySession.B, 'readTools'))
})

test('session reset 只删除当前会话覆盖并恢复全局默认', () => {
  const path = tempConfig()
  ensureSettingsFile({ path, now: 50 })
  writeSessionSettings({ path, sessionId: 'A', patch: { historyMode: 'full', turns: 2 }, now: 51 })
  writeSessionSettings({ path, sessionId: 'B', patch: { permission: 'review' }, now: 52 })
  const r = writeSessionSettings({ path, sessionId: 'A', reset: true, now: 53 })
  assert.equal(r.ok, true)
  const j = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(j.bySession.A, undefined)
  assert.ok(j.bySession.B)
  assert.equal(effectiveSettings(j, 'A').historyMode, normalizeSettings(j).settings.historyMode)
})

test('某 session 档位关闭只关闭该会话，不会把插件总 gate 写成 off', () => {
  const path = tempConfig()
  ensureSettingsFile({ path, now: 60 })
  const r = writeSessionSettings({ path, sessionId: 'A', patch: { tier: 'off' }, now: 61 })
  assert.equal(r.ok, true)
  const j = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(j.enabled, true)
  assert.equal(j.rollout.mode, 'all')
  assert.equal(effectiveSettings(j, 'A').assist, 'off')
  assert.notEqual(effectiveSettings(j, 'B').assist, 'off')
})

test('宿主级 Bash 不允许写入 bySession', () => {
  assert.ok(!SESSION_KEYS.includes('bash'))
  const path = tempConfig()
  ensureSettingsFile({ path, now: 70 })
  const r = writeSessionSettings({ path, sessionId: 'A', patch: { bash: false, readTools: true }, now: 71 })
  assert.equal(r.ok, true)
  const j = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(j.bySession.A.bash, undefined)
  assert.equal(j.bySession.A.readTools, true)
  assert.ok((r.problems || []).some((p) => p.kind === 'not-session-scoped' && /bash/.test(p.key)))
})
