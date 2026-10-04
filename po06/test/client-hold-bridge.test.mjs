import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const client = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
const control = readFileSync(fileURLToPath(new URL('../lib/control-api.js', import.meta.url)), 'utf8')

test('跨会话恢复改由 Host 状态完成，不再依赖 window hold bridge', () => {
  assert.equal(client.includes('__PO06_HOLD__'), false)
  assert.equal(client.includes('holdBridgeRead'), false)
  assert.equal(client.includes('holdBridgeWrite'), false)
  assert.equal(client.includes('holdBridgeOn'), false)
  assert.match(client, /usePreStepReview/)
  assert.match(client, /\/pre-step-review\?session=/)
})

test('Host pre-step 状态按 sessionId 查询，不会把 A 会话状态串给 B', () => {
  assert.match(control, /query\.get\('session'\)/)
  assert.match(control, /preStepState\(sid\)/)
  assert.match(client, /\[reviewStatus, refreshReview\] = usePreStepReview\(sessionId\)/)
})

test('切会话不会 abort 优化：取消只通过显式 Host decision', () => {
  // 顾问进度轮询仍可独立使用 AbortController；这里禁的是旧提示词拦截自己的 abortRef/世代取消链。
  assert.equal(client.includes('abortRef'), false)
  assert.equal(client.includes('holdSeq'), false)
  assert.equal(client.includes("apiPost('/interpret'"), false)
  assert.match(client, /hostDecision\('cancel'\)/)
  assert.match(client, /hostDecision\('skip'\)/)
  assert.match(client, /hostDecision\('original'\)/)
})

test('审查中的本地编辑在同一 Host run 轮询时保留', () => {
  assert.match(client, /cur\.id === row\.id/)
  assert.match(client, /keepEdit/)
  assert.match(client, /edited: keepEdit \? cur\.edited : row\.edited/)
})
