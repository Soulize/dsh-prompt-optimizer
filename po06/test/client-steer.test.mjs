import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

function load() {
  const regs = []
  const win = {
    __ModuleLoader__: { load: (r) => regs.push(r) },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }
  const React = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c }),
    Fragment: 'F',
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: (f) => f,
    useMemo: (f) => f(),
  }
  const req = (n) => (n === 'react' ? React : {})
  new Function('window', 'require', 'CustomEvent', source)(win, req, globalThis.CustomEvent)
  const mod = regs[0].factory(req)
  mod.apply({ slots: { register: () => () => {}, inject: (_s, cb) => cb() }, locale: 'en' })
  return mod.__debug
}
const button = (label, disabled = false) => ({ disabled, getAttribute: (k) => k === 'aria-label' ? label : null })

test('steer 与 queue 的发送模式不会混淆', () => {
  const d = load()
  const labels = d.steerLabelsNow()
  assert.equal(d.sendModeForButton(button('Steer message'), labels), 'steer')
  assert.equal(d.sendModeForButton(button('插话发送'), labels), 'steer')
  assert.equal(d.sendModeForButton(button('Queue message'), labels), 'queue')
  assert.equal(d.sendModeForButton(button('Send message'), labels), 'queue')
})

test('当前可用的 steer 主按钮优先决定 Enter 的发送模式', () => {
  const d = load()
  const labels = d.steerLabelsNow()
  const card = { querySelectorAll: () => [button('Queue message'), button('Steer message')] }
  assert.equal(d.currentSendMode(card, labels), 'steer')
  const ended = { querySelectorAll: () => [button('Steer message', true), button('Send message')] }
  assert.equal(d.currentSendMode(ended, labels), 'queue')
})


test('Ctrl/Cmd+Enter 使用 DSH 官方互补 Queue/Steer 语义', () => {
  const d = load()
  const steer = d.steerLabelsNow()
  const queue = d.queueLabelsNow()
  const queuePrimary = { querySelectorAll: () => [button('Queue message')] }
  const steerPrimary = { querySelectorAll: () => [button('Steer message')] }
  const idlePrimary = { querySelectorAll: () => [button('Send message')] }
  assert.equal(d.keyDeliveryMode(queuePrimary, steer, queue, false), 'queue')
  assert.equal(d.keyDeliveryMode(queuePrimary, steer, queue, true), 'steer')
  assert.equal(d.keyDeliveryMode(steerPrimary, steer, queue, false), 'steer')
  assert.equal(d.keyDeliveryMode(steerPrimary, steer, queue, true), 'queue')
  assert.equal(d.keyDeliveryMode(idlePrimary, steer, queue, true), 'queue', '非运行态 accelerated 仍是 queue')
})

test('steer 放行必须走 DSH 原生按钮，而不是公开 inputActions.submit(queue)', () => {
  assert.match(source, /deliveryMode === 'steer'/)
  assert.match(source, /currentSteerButton\(card\)/)
  assert.match(source, /nativeReleaseBypass\.current \+= 1/)
  assert.match(source, /btn\.click\(\)/)
  assert.match(source, /inputActions\.submit\(\)/)
  const steerBlock = source.slice(source.indexOf("if (deliveryMode === 'steer')"), source.indexOf("setHold({ ...(h || {}), phase:", source.indexOf("if (deliveryMode === 'steer')")))
  assert.ok(steerBlock.indexOf('btn.click()') >= 0, 'steer block must call native DSH button')
  assert.ok(steerBlock.indexOf('inputActions.submit()') >= 0, 'queue fallback remains when the running turn already ended')
})
