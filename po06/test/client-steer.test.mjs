import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const client = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
const host = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')
const preStep = readFileSync(fileURLToPath(new URL('../lib/pre-step-intercept.js', import.meta.url)), 'utf8')

test('steer 适配改为“完全不重发”：客户端没有 submit replay 或发送按钮模式推断', () => {
  for (const forbidden of [
    'inputActions.submit',
    'nativeReleaseBypass',
    'dispatchAcceleratedSubmit',
    'sendModeForButton',
    'keyDeliveryMode',
    'steerLabelsNow',
    'queueLabelsNow',
    'stopImmediatePropagation',
  ]) {
    assert.equal(client.includes(forbidden), false, forbidden + ' must stay out of the client')
  }
  assert.equal(client.includes("apiPost('/interpret'"), false, 'browser must not start optimization')
  assert.match(client, /\/pre-step-review\?session=/)
  assert.match(client, /\/pre-step-review\/decision/)
})

test('生产触发只挂 agent/pre-step；session/event 只做观察', () => {
  assert.match(host, /ctx\.on\('agent\/pre-step'/)
  assert.match(host, /role: 'observe-only'/)
  assert.doesNotMatch(host, /model-observed-catchup/)
  assert.doesNotMatch(host, /interceptedText/)
  assert.doesNotMatch(host, /pendingInput/)
})

test('pre-step 控制器只返回 downstream decision，不调用 followup/steer/submit', () => {
  assert.match(preStep, /decision: downstream/)
  assert.doesNotMatch(preStep, /\.followup\(/)
  assert.doesNotMatch(preStep, /\.steer\(/)
  assert.doesNotMatch(preStep, /\.submit\(/)
})

test('取消文案与 Host 语义一致：取消发送，不承诺恢复输入框草稿', () => {
  assert.match(client, /已取消发送/)
  assert.match(client, /不会保留为输入框草稿/)
  assert.doesNotMatch(client, /Cancelled: nothing was sent; your text is still in the box/)
})
