import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
function load() {
  const regs = []
  const listeners = new Map()
  const win = {
    __ModuleLoader__: { load: (r) => regs.push(r) },
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    removeEventListener: (name, fn) => { const s = listeners.get(name); if (s) s.delete(fn) },
    dispatchEvent: (ev) => { const s = listeners.get(ev.type); if (s) for (const fn of [...s]) fn(ev); return true },
  }
  const React = { createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c }), Fragment: 'F', useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f() }
  const req = (n) => (n === 'react' ? React : {})
  new Function('window', 'require', 'CustomEvent', source)(win, req, globalThis.CustomEvent)
  const mod = regs[0].factory(req)
  mod.apply({ slots: { register: () => () => {}, inject: (s, cb) => cb() }, locale: 'en' })
  return { d: mod.__debug, win }
}

// issue #19：优化期间切到别的会话，控件栏会**重挂**（hold 归零）。
// 原实现把 hold 顺手写一份到 window 桥，但只在**挂载时读一次** ⇒
// "切走 → 解释在后台跑完 → 切回"这条路径上，完成结果写进了桥却没人再读它，
// 用户看到的就是"这一轮没有继续，也没有产出"。
// 本用例钉住修好后的语义：**写入即广播，留在该会话的界面能认领到后台完成的结果**。
test('后台跑完的拦截结果能被重新挂载的界面认领（issue #19）', () => {
  const { d } = load()
  const seen = []
  // ① 用户切回会话：新挂载先订阅（这正是组件 effect 做的事）
  const off = d.holdBridgeOn('s-1', (v) => seen.push(v))
  // ② 切走期间那一轮跑完了：老闭包把结果写进桥
  const done = { phase: 'review', packet: '【本轮要求】…', chars: 12 }
  d.holdBridgeWrite('s-1', done)
  assert.equal(seen.length, 1, '订阅者必须收到一次通知')
  assert.equal(seen[0], done, '收到的就是那份结果（内容不丢）')
  assert.equal(d.holdBridgeRead('s-1'), done, '桥里读得到的也是它')
  // ③ 别的会话的写入绝不能串台
  d.holdBridgeWrite('s-2', { phase: 'review', packet: 'other' })
  assert.equal(seen.length, 1, 'B 会话的写入不该通知 A 会话的订阅者')
  // ④ 取消/失败（写 null）也要广播，界面据此收掉残留
  d.holdBridgeWrite('s-1', null)
  assert.equal(seen.length, 2, '清空也要通知')
  assert.equal(seen[1], null, '通知的值是 null')
  assert.equal(d.holdBridgeRead('s-1'), null, '桥里也清掉了')
  // ⑤ 卸载必须退订（否则重挂多次会累积监听）
  off()
  d.holdBridgeWrite('s-1', done)
  assert.equal(seen.length, 2, '退订之后不再收到通知')
})

test('桥不可用时静默降级，不影响本轮（不抛）', () => {
  const { d, win } = load()
  const backup = win.dispatchEvent
  win.dispatchEvent = () => { throw new Error('dispatch 坏了') }
  assert.doesNotThrow(() => d.holdBridgeWrite('s-9', { phase: 'optimizing' }), '广播失败不许把本轮带下水')
  win.dispatchEvent = backup
  assert.doesNotThrow(() => d.holdBridgeWrite('', { phase: 'review' }), '空 sessionId 直接返回')
})

test('切换会话不再中止宿主的解释请求（issue #19 的原始成因已被移除）', () => {
  // 0.7.8 的成因是**组件卸载的 cleanup 里 abort**；现在 abort 只应出现在三处用户/去重动作里：
  //   beginHold（新一轮先断上一轮）、cancelHold（用户点取消）、skipHold（用户点跳过）。
  const aborts = source.match(/abortRef\.current\.abort\(\)/g) || []
  assert.equal(aborts.length, 3, 'abort 应恰好 3 处（去重/取消/跳过）；多出来很可能又是在卸载里中止：' + aborts.length)
  const clears = source.match(/abortRef\.current = null/g) || []
  assert.equal(clears.length, 2, 'abortRef 置空应恰好 2 处（取消/跳过）')
  assert.ok(!/return \(\) => \{[^}]*abortRef/.test(source), 'effect cleanup 里不该出现 abortRef（那正是切会话被取消的成因）')
})
