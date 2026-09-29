// 0.7.8 · 硬邦邦加码（模型生成部分）回归
//
// B 方案的分工：**骨架归代码**（标签/语域/越权反制）、**加码归模型**（任务相关的定点爆破）。
// 这个文件钉住四件事：
//   ① 加码插在中间，**边界行永远在最后**（模型内容挤不掉、改不了它）；
//   ② 空/超长加码 → 退回纯骨架（超长是**整段不采用**，绝不截断）；
//   ③ neutral 档下即使给了加码也一个字都不注入；
//   ④ 生成规则里必须明确"不许发明新要求"与"要带引用"，否则这道防线就是纸的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { framingBlock, normalizeHardNote, HARD_NOTE_MAX } from '../lib/framing.js'
import { compile, compileAudited } from '../lib/compiler.js'
import { HARD_NOTE_SYSTEM } from '../lib/interpreter.js'
import { createState } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'

const SID = 'session-note'
const human = () => ({ kind: 'human', sessionId: SID, messageId: 'm1' })
const NOTE = '坦克这单别搞成方块拼的，也别白屏——打开就得像那么回事。'

function oneItemState() {
  const r = reduce(createState({ sessionId: SID, taskId: 't' }), {
    causeId: 'c1', baseRevision: 0, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML；可预览、可操控', sourceRefs: [human()] } }],
  })
  if (!r.ok) throw new Error('fixture failed: ' + r.reason)
  return r.state
}

test('加码插在中间，边界行仍在最后', () => {
  const withNote = framingBlock('hard', NOTE)
  assert.ok(withNote.includes(NOTE), '加码应在块里')
  assert.ok(withNote.trim().endsWith('不准替他定。'), '越权反制行必须仍在最后')
  assert.ok(withNote.indexOf('兄弟') < withNote.indexOf(NOTE), '语域行在加码之前')
})

test('空/空白加码等于没有加码（退回纯骨架）', () => {
  const skeleton = framingBlock('hard')
  assert.equal(framingBlock('hard', ''), skeleton)
  assert.equal(framingBlock('hard', '   \n  '), skeleton)
  assert.equal(framingBlock('hard', null), skeleton)
})

test('超长加码整段不采用（不截断）', () => {
  const long = '猛'.repeat(HARD_NOTE_MAX + 1)
  const out = framingBlock('hard', long)
  assert.equal(out, framingBlock('hard'), '超限应整段丢弃')
  assert.ok(!out.includes('猛猛'), '绝不能留半句话')
})

test('归一化：折叠连续空行、去首尾空白', () => {
  assert.equal(normalizeHardNote('  a\n\n\n\nb  '), 'a\n\nb')
  assert.equal(normalizeHardNote('\n\n'), '')
})

test('neutral 档下给了加码也不注入任何东西', () => {
  assert.equal(framingBlock('neutral', NOTE), '')
  assert.equal(framingBlock(undefined, NOTE), '')
})

test('编译器把加码带进包；neutral 时连加码都不许出现', () => {
  const s = oneItemState()
  const on = compile(s, { framing: 'hard', framingNote: NOTE })
  assert.ok(on.text.includes(NOTE), 'hard 档应带加码')
  assert.ok(on.text.trim().includes('不准替他定。'), '边界行仍在')
  const off = compile(s, { framing: 'neutral', framingNote: NOTE })
  assert.ok(!off.text.includes(NOTE), 'neutral 下加码不得出现')
  assert.ok(!off.text.includes('协作基调'), 'neutral 下连块都不该有')
})

test('带加码时审计仍通过（加码不是条目，不进任何节）', () => {
  const s = oneItemState()
  const out = compileAudited(s, { framing: 'hard', framingNote: NOTE })
  assert.deepEqual(out.problems, [], JSON.stringify(out.problems))
  assert.ok(out.sections.every((x) => !x.itemIds.some((id) => /note/i.test(id))), '加码不得混进条目节')
})

test('生成规则必须写明三条防线（语域/定点/不许发明新要求+带引用）', () => {
  assert.ok(/hardNote/.test(HARD_NOTE_SYSTEM), '规则要给出字段名')
  assert.ok(/hardOn/.test(HARD_NOTE_SYSTEM), '规则要要求引用')
  assert.ok(/不许新增原话里没有的需求/.test(HARD_NOTE_SYSTEM))
  assert.ok(/语域/.test(HARD_NOTE_SYSTEM))
  assert.ok(/定点爆破/.test(HARD_NOTE_SYSTEM))
  assert.ok(/长度自己定/.test(HARD_NOTE_SYSTEM), '长度由模型定（用户要求）')
})

test('引用校验必须在管道里做（静态守卫：不能只写在注释里）', () => {
  const src = readFileSync(new URL('../lib/pipeline.js', import.meta.url), 'utf8')
  assert.ok(/adapter\.framingNoteRaw/.test(src), '管道要接住解析出来的加码')
  assert.ok(/cited\.length > 0/.test(src), '必须要求至少一条真实引用')
  assert.ok(/adapter\.framingNote = /.test(src), '校验结果要写回 adapter')
})
