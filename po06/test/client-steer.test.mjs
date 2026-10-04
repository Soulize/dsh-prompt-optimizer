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

test('accelerated steer 可重放 DSH 原生 Ctrl+Enter', () => {
  const OldKeyboardEvent = globalThis.KeyboardEvent
  let seen = null
  globalThis.KeyboardEvent = class {
    constructor(type, init) { this.type = type; Object.assign(this, init) }
  }
  try {
    const d = load()
    const editor = { dispatchEvent: (e) => { seen = e; return false } }
    const card = { querySelector: () => editor }
    assert.equal(d.dispatchAcceleratedSubmit(card), true)
    assert.equal(seen.type, 'keydown')
    assert.equal(seen.key, 'Enter')
    assert.equal(seen.ctrlKey, true)
    assert.equal(seen.bubbles, true)
  } finally {
    if (OldKeyboardEvent === undefined) delete globalThis.KeyboardEvent
    else globalThis.KeyboardEvent = OldKeyboardEvent
  }
})

test('steer 放行覆盖主按钮 Steer、互补 Steer 与运行结束三条路径', () => {
  assert.match(source, /deliveryMode === 'steer'/)
  assert.match(source, /currentSteerButton\(card\)/)
  assert.match(source, /currentQueueButton\(card\)/)
  assert.match(source, /nativeReleaseBypass\.current \+= 1/)
  const start = source.indexOf("if (deliveryMode === 'steer')")
  const end = source.indexOf("setHold({ ...(h || {}), phase:", start)
  const steerBlock = source.slice(start, end)
  assert.ok(steerBlock.includes('steerBtn.click()'), '主按钮就是 Steer 时必须点击 DSH 原生 Steer')
  assert.ok(steerBlock.includes('dispatchAcceleratedSubmit(card)'), '主按钮是 Queue 时必须重放互补 Ctrl+Enter')
  assert.ok(steerBlock.includes('inputActions.submit()'), '运行已结束时保留普通 queue fallback')
  assert.match(source, /markSeen\('key:native-release'\)/, '合成 Ctrl+Enter 必须一次性绕过插件自身拦截')
})
