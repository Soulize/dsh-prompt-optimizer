// 0.7.8 补 · 切基调后旧包文本必须作废（用户实测：切回普通档，注入文里仍有硬邦邦那段）
//
// 包文本是**按当时政策编译好的一整段字符串**；政策变了它就过期。
// 这个文件钉住"什么算形状变了"，以及"两侧取不到时不许乱作废"。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packetShapeOf, packetShapeChanged } from '../lib/policy.js'

const P = (over) => Object.assign({ assist: 'auto', detail: 'standard', budget: 'standard', framing: 'neutral' }, over)

test('形状含四个字段（含协作基调）', () => {
  assert.equal(packetShapeOf(P()), 'auto|standard|standard|neutral')
  assert.equal(packetShapeOf(null), '')
})

test('协作基调变了 ⇒ 形状变了（这条就是本次实测的现场）', () => {
  assert.equal(packetShapeChanged(P({ framing: 'hard' }), P({ framing: 'neutral' })), true)
  assert.equal(packetShapeChanged(P({ framing: 'neutral' }), P({ framing: 'hard' })), true)
})

test('档位/补充程度/辅助开关变了 ⇒ 形状也变', () => {
  assert.equal(packetShapeChanged(P({ assist: 'off' }), P()), true)
  assert.equal(packetShapeChanged(P({ detail: 'detailed' }), P()), true)
  assert.equal(packetShapeChanged(P({ budget: 'generous' }), P()), true)
})

test('形状没变 ⇒ 不作废（别把好好的包清掉）', () => {
  assert.equal(packetShapeChanged(P(), P()), false)
  assert.equal(packetShapeChanged(P({ framing: 'hard' }), P({ framing: 'hard' })), false)
})

test('两侧取不到 ⇒ 一律不作废（宁可漏作废，不要误清）', () => {
  assert.equal(packetShapeChanged(null, P()), false)
  assert.equal(packetShapeChanged(P(), null), false)
  assert.equal(packetShapeChanged(null, null), false)
})
