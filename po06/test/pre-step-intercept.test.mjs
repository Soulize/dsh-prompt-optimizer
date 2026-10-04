import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPreStepInterceptController,
  humanMessageText,
  lastHumanMessage,
} from '../lib/pre-step-intercept.js'

const user = (text, id = 'm1', kind = 'user') => ({
  id,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind },
})
const plugin = (text) => ({
  id: 'plugin',
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'runtime-context' },
})
const payload = (id = 's1') => ({
  agent: { id, session: { id }, options: { provider: 'p', model: 'm' } },
  turn: 1,
  step: 1,
  signal: new AbortController().signal,
})
const waitFor = async (fn, label = 'condition') => {
  for (let i = 0; i < 80; i += 1) {
    const value = fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for ' + label)
}

test('只把真正的人类 user/user-rpc 消息作为优化输入', () => {
  assert.equal(humanMessageText(user('hello')), 'hello')
  assert.equal(humanMessageText(user('rpc', 'm2', 'user-rpc')), 'rpc')
  assert.equal(humanMessageText(plugin('hidden')), '')
  assert.equal(lastHumanMessage([user('first'), plugin('ctx'), user('last')]).text, 'last')
  assert.equal(lastHumanMessage([plugin('ctx')]), null)
})

test('auto 模式 await 优化，但把 downstream decision 原样交回', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let packet = ''
  const controller = createPreStepInterceptController({
    readPolicy: () => ({ injectPacket: true, permission: 'auto' }),
    optimize: async () => {
      await gate
      packet = 'PACK'
      return { ok: true, packet, chars: 4 }
    },
    getPacket: () => packet,
    clearPacket: () => { packet = '' },
    terminalTtlMs: 10,
  })
  const decision = { kind: 'enter', messages: [user('hello')] }
  const pending = controller.handle(payload(), async () => decision)
  await waitFor(() => controller.state('s1').run?.phase === 'optimizing', 'optimizing')
  release()
  const result = await pending
  assert.strictEqual(result, decision, 'pre-step must not re-create or replace the DSH delivery decision')
  assert.equal(packet, 'PACK')
  controller.dispose()
})

test('review 模式确认后才放行，并把用户编辑的包写回', async () => {
  let packet = ''
  const writes = []
  const controller = createPreStepInterceptController({
    readPolicy: () => ({ injectPacket: true, permission: 'review' }),
    optimize: async () => {
      packet = 'PACK'
      return { ok: true, packet, chars: 4 }
    },
    getPacket: () => packet,
    setPacket: async (_sid, text) => {
      packet = text
      writes.push(text)
      return { ok: true, chars: text.length }
    },
    clearPacket: () => { packet = '' },
  })
  const decision = { kind: 'enter', messages: [user('review me')] }
  const pending = controller.handle(payload(), async () => decision)
  const run = await waitFor(() => {
    const r = controller.state('s1').run
    return r?.phase === 'review' ? r : null
  }, 'review')
  assert.equal(controller.decide({ sessionId: 's1', id: run.id, action: 'confirm', text: 'EDITED' }).ok, true)
  assert.strictEqual(await pending, decision)
  assert.deepEqual(writes, ['EDITED'])
  assert.equal(packet, 'EDITED')
  controller.dispose()
})

test('按原文/跳过不会重发，只清包后返回原 downstream decision', async () => {
  for (const action of ['original', 'skip']) {
    let packet = ''
    const cleared = []
    const controller = createPreStepInterceptController({
      readPolicy: () => ({ injectPacket: true, permission: 'review' }),
      optimize: async () => {
        packet = 'PACK'
        return { ok: true, packet, chars: 4 }
      },
      getPacket: () => packet,
      clearPacket: (_sid, why) => { packet = ''; cleared.push(why) },
    })
    const decision = { kind: 'enter', messages: [user('same DSH message')] }
    const pending = controller.handle(payload(), async () => decision)
    const run = await waitFor(() => {
      const r = controller.state('s1').run
      return r?.phase === 'review' ? r : null
    }, action + ' review')
    controller.decide({ sessionId: 's1', id: run.id, action })
    assert.strictEqual(await pending, decision)
    assert.equal(packet, '')
    assert.ok(cleared.some(x => String(x).includes(action)))
    controller.dispose()
  }
})

test('取消明确 reject 已领取的消息，不伪装成“草稿还在输入框”', async () => {
  let packet = ''
  const controller = createPreStepInterceptController({
    readPolicy: () => ({ injectPacket: true, permission: 'review' }),
    optimize: async () => {
      packet = 'PACK'
      return { ok: true, packet, chars: 4 }
    },
    getPacket: () => packet,
    clearPacket: () => { packet = '' },
  })
  const pending = controller.handle(payload(), async () => ({ kind: 'enter', messages: [user('cancel me')] }))
  const run = await waitFor(() => {
    const r = controller.state('s1').run
    return r?.phase === 'review' ? r : null
  }, 'cancel review')
  controller.decide({ sessionId: 's1', id: run.id, action: 'cancel' })
  assert.deepEqual(await pending, { kind: 'reject' })
  assert.equal(packet, '')
  controller.dispose()
})

test('重新生成停留在同一个已领取消息上，不创建第二次 submit', async () => {
  let calls = 0
  let packet = ''
  const controller = createPreStepInterceptController({
    readPolicy: () => ({ injectPacket: true, permission: 'review' }),
    optimize: async () => {
      calls += 1
      packet = 'PACK-' + calls
      return { ok: true, packet, chars: packet.length }
    },
    getPacket: () => packet,
    setPacket: async (_sid, text) => { packet = text; return { ok: true, chars: text.length } },
    clearPacket: () => { packet = '' },
  })
  const decision = { kind: 'enter', messages: [user('regen')] }
  const pending = controller.handle(payload(), async () => decision)
  const first = await waitFor(() => {
    const r = controller.state('s1').run
    return r?.phase === 'review' ? r : null
  }, 'first review')
  controller.decide({ sessionId: 's1', id: first.id, action: 'regen' })
  const second = await waitFor(() => {
    const r = controller.state('s1').run
    return r?.phase === 'review' && r.id !== first.id ? r : null
  }, 'second review')
  assert.equal(calls, 2)
  controller.decide({ sessionId: 's1', id: second.id, action: 'confirm', text: second.packet })
  assert.strictEqual(await pending, decision)
  controller.dispose()
})

test('外部设置变化会按原文释放正在等待的 review，不悬挂 Host step', async () => {
  let packet = ''
  const controller = createPreStepInterceptController({
    readPolicy: () => ({ injectPacket: true, permission: 'review' }),
    optimize: async () => {
      packet = 'PACK'
      return { ok: true, packet, chars: 4 }
    },
    getPacket: () => packet,
    clearPacket: () => { packet = '' },
  })
  const decision = { kind: 'enter', messages: [user('settings change')] }
  const pending = controller.handle(payload(), async () => decision)
  await waitFor(() => controller.state('s1').run?.phase === 'review', 'settings review')
  assert.equal(controller.release('s1', 'original', 'settings:session-changed'), true)
  assert.strictEqual(await pending, decision)
  assert.equal(packet, '')
  controller.dispose()
})

test('downstream reject、插件上下文和 slash 普通消息都不启动优化', async () => {
  let calls = 0
  const controller = createPreStepInterceptController({
    readPolicy: () => ({ injectPacket: true, permission: 'auto' }),
    optimize: async () => { calls += 1; return { ok: true, packet: 'x', chars: 1 } },
  })
  const reject = { kind: 'reject' }
  assert.strictEqual(await controller.handle(payload(), async () => reject), reject)
  const pluginOnly = { kind: 'enter', messages: [plugin('ctx')] }
  assert.strictEqual(await controller.handle(payload(), async () => pluginOnly), pluginOnly)
  const slash = { kind: 'enter', messages: [user('/unknown arg')] }
  assert.strictEqual(await controller.handle(payload(), async () => slash), slash)
  assert.equal(calls, 0)
  controller.dispose()
})
