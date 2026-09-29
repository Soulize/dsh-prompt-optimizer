// 0.7.8 · bash 崩溃/中止探测器回归
//
// 针对真机现场：调用被**外层**掐掉（AbortError: ABORTED / tool call aborted），
// 工具那一刻交不出任何东西 —— 所以证据必须留到下一次调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'po06-inflight-'))
process.env.DSH_HOME = HOME
const P = join(HOME, 'po06-bash-inflight.json')
const m = await import('../lib/bash/index.js')

test('没有标记 ⇒ 不出声', () => {
  rmSync(P, { force: true })
  assert.equal(m.readInflight(), null)
  assert.equal(m.inflightNote(null), '')
})

test('标记够旧 ⇒ 点明"上次没正常收尾"并给替代做法', () => {
  writeFileSync(P, JSON.stringify({ startedAt: Date.now() - 5 * 60000, head: 'node dbg.mjs 2>&1 | head -40' }))
  const prev = m.readInflight()
  assert.ok(prev, '应读得到标记')
  const note = m.inflightNote(prev)
  assert.ok(/没有正常收尾/.test(note))
  assert.ok(/node dbg.mjs/.test(note), '要点出是哪条命令')
  assert.ok(/约 5 分钟/.test(note), '要给出白等了多久')
  assert.ok(/纯损失/.test(note))
  assert.ok(/落盘/.test(note), '要给出可照做的替代做法，不是安慰话')
})

test('标记是新鲜的 ⇒ 不出声（并发调用不误报）', () => {
  writeFileSync(P, JSON.stringify({ startedAt: Date.now(), head: 'ls' }))
  assert.equal(m.inflightNote(m.readInflight()), '')
})

test('收尾会清掉标记（正常结束不留残留）', () => {
  writeFileSync(P, JSON.stringify({ startedAt: Date.now() - 9 * 60000, head: 'node x.js' }))
  const note = m.finishInflight(m.readInflight())
  assert.ok(/没有正常收尾/.test(note), '先把上一轮的问题说出来')
  assert.equal(existsSync(P), false, '然后必须清掉，否则下一次还会误报')
})

test('标记文件坏了也不抛（退化成没有这个机制）', () => {
  writeFileSync(P, '{ not json')
  assert.equal(m.readInflight(), null)
  assert.equal(m.inflightNote(null), '')
  rmSync(HOME, { recursive: true, force: true })
})
