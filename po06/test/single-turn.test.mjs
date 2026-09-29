// 0.7.8 · 单轮提升（完成前自检 + 任务类 playbook）回归
//
// 守住四件事：
//   ① 检查项只按**任务类**触发，且要求"单文件意图"与"可视化/交互意图"同时命中（宁可漏发，不要错发）；
//   ② 检查项是 `acceptance_check` / `project_convention` 来源，**结构上不可能**升格成用户要求；
//   ③ 来源引用合规且可归属到会话（schema 要求 sourceRef.sessionId）；
//   ④ 它走既有编译、预算与审计链路：不写状态、可被预算丢弃、不会被判成 unknown item 而整包拒投。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectTaskClass, playbookItems, CHECKS_BY_DETAIL } from '../lib/playbook.js'
import { compile, compileAudited, SECTIONS, DROP_ORDER } from '../lib/compiler.js'
import { createState, ITEM_KINDS, HUMAN_ONLY_KINDS } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'

const SID = 'session-single-turn'
/** 用户实测用的那条坦克提示词（单文件 3D 类）。 */
const TANK = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型,可以预览,操控,真实,帅气,炫技写真.'
/** 检查项必须归属到会话，统一从这里取。 */
const P = (text, detail) => playbookItems(text, { detail: detail, sessionId: SID })

const human = () => ({ kind: 'human', sessionId: SID, messageId: 'm1' })
const model = () => ({ kind: 'model', sessionId: SID, messageId: 'm1' })

function buildState(extraOps = []) {
  const s = createState({ sessionId: SID, taskId: 'single-turn' })
  const r = reduce(s, {
    causeId: 'c1', baseRevision: 0, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML；可预览、可操控', sourceRefs: [human()] } },
      { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '近距可辨识、比例协调', sourceRefs: [human()] } },
      { op: 'add_item', item: { id: 'fact-1', kind: 'observed_fact', text: '宿主提供 Three.js 缓存', sourceRefs: [model()] } },
      ...extraOps,
    ],
  })
  if (!r.ok) throw new Error('fixture failed: ' + r.reason)
  return r.state
}

test('任务类识别：坦克提示词命中，无关任务不命中', () => {
  const c = detectTaskClass(TANK)
  assert.ok(c, '坦克题应命中某个任务类')
  assert.equal(c.id, 'single-file-3d')
  assert.equal(detectTaskClass('帮我看看这个报错怎么修'), null, '普通排错不该命中')
  assert.equal(detectTaskClass('把这段文字翻译成英文'), null)
  assert.equal(P('帮我看看这个报错怎么修', 'detailed').length, 0)
})

test('单文件意图与可视化意图必须同时命中（宁可漏发，不要错发）', () => {
  assert.equal(detectTaskClass('给我讲讲 3D 渲染管线原理'), null, '只有 3D 不算')
  assert.equal(detectTaskClass('写一个单文件 CLI 脚本'), null, '只有单文件不算')
  assert.ok(detectTaskClass('做一个单文件的可视化页面，能旋转缩放'), '两者都有才算')
})

test('条数随补充程度缩放：minimal 不发，standard 3，detailed 5', () => {
  assert.equal(CHECKS_BY_DETAIL.minimal, 0)
  assert.equal(P(TANK, 'minimal').length, 0, 'minimal 只保必要的节')
  assert.equal(P(TANK, 'standard').length, 3)
  assert.equal(P(TANK, 'detailed').length, 5)
  assert.equal(P(TANK, undefined).length, 3, '缺省按 standard')
})

test('没有会话就不发（不发无主的检查项）', () => {
  assert.equal(playbookItems(TANK, { detail: 'detailed' }).length, 0)
  assert.equal(playbookItems(TANK, { detail: 'detailed', sessionId: '' }).length, 0)
})

test('检查项来源不是 human ⇒ 结构上不可能升格成用户要求', () => {
  const items = P(TANK, 'detailed')
  assert.equal(items.length, 5)
  for (const it of items) {
    assert.equal(it.kind, 'acceptance_check')
    assert.ok(ITEM_KINDS.includes('acceptance_check'), 'kind 必须在白名单里')
    assert.ok(!HUMAN_ONLY_KINDS.includes('acceptance_check'), '绝不能被当成需要人类来源的需求类型')
    assert.ok(it.sourceRefs && it.sourceRefs.length > 0, '必须有来源（审计要求）')
    assert.ok(it.sourceRefs.every((r) => r.kind !== 'human'), '来源不得是 human')
    assert.equal(it.sourceRefs[0].kind, 'project_convention')
    assert.equal(it.sourceRefs[0].sessionId, SID, '来源必须可归属到会话')
    assert.match(String(it.sourceRefs[0].uri), /^playbook:/)
    assert.equal(it.scope, 'turn', '只作用于本轮')
  }
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'id 不重复')
})

test('每条检查项都点名一个失败模式（不是通用正确话）', () => {
  for (const it of P(TANK, 'detailed')) {
    assert.ok(String(it.text).length >= 12, '太短的多半是空话：' + it.text)
    assert.ok(/：/.test(String(it.text)), '应为"检查点：具体做法"的形状：' + it.text)
  }
})

test('编译器渲染出「完成前自检」节，并写明不是新增要求', () => {
  const s = buildState()
  const out = compile(s, { extraItems: P(TANK, 'detailed') })
  assert.ok(out.text.includes('完成前自检'), '应出现自检节')
  assert.ok(/完成前自检（检查项，不是新增要求）/.test(out.text), '标签必须说明它不是新增要求')
  assert.ok(out.text.includes('单文件自足'), '应含具体检查项')
  assert.ok(out.sections.some((x) => x.key === 'checks'), '节清单里应有 checks')
})

test('带外部条目时审计仍通过（否则整包会被拒投）', () => {
  const s = buildState()
  const out = compileAudited(s, { extraItems: P(TANK, 'detailed') })
  assert.deepEqual(out.problems, [], '审计不该有问题：' + JSON.stringify(out.problems))
  assert.equal(out.ok, true)
})

test('向后兼容：不传 extraItems 时行为与改动前一致（无自检节）', () => {
  const s = buildState()
  const out = compileAudited(s)
  assert.ok(!out.text.includes('完成前自检'), '没有检查项就不该凭空出现该节')
  assert.deepEqual(out.problems, [])
  assert.equal(out.ok, true)
})

test('自检项走既有预算机制：可被丢弃，且排在 facts/quality 之前被丢', () => {
  const iChecks = DROP_ORDER.indexOf('checks')
  const iFacts = DROP_ORDER.indexOf('facts')
  const iQuality = DROP_ORDER.indexOf('quality')
  assert.ok(iChecks >= 0, 'checks 必须在丢弃顺序里（不能是不可丢的必保节）')
  assert.ok(iChecks < iFacts, '检查项应先于已查证事实被丢')
  assert.ok(iFacts < iQuality, '已查证事实应先于质量解释被丢')
  const sec = SECTIONS.find((x) => x.key === 'checks')
  assert.ok(sec, 'SECTIONS 里必须有 checks')
  assert.equal(sec.required, undefined, '自检节不是必保节')
})

test('预算吃紧时按固定顺序丢弃，检查项先于事实与质量解释让位', () => {
  // 这条钉的是**不变量**，不是某一档预算下的具体结果：
  // 丢弃必须服从 DROP_ORDER，且检查项（辅助）必须先于事实与质量解释（用户语义）让位。
  const s = buildState()
  const extras = P(TANK, 'detailed')
  const full = compile(s, { extraItems: extras })
  const tight = compile(s, { budget: Math.max(120, full.chars - 200), extraItems: extras })
  assert.ok(tight.dropped.length > 0, '预算吃紧应当发生丢弃（并如实记账）')
  assert.ok(tight.droppedSummary, '丢弃必须写明，不许静默截断')
  const rank = (k) => { const i = DROP_ORDER.indexOf(k); return i < 0 ? 999 : i }
  const ranks = tight.dropped.map((d) => rank(d.kind))
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] >= ranks[i - 1], '丢弃顺序必须服从 DROP_ORDER：' + JSON.stringify(tight.dropped.map((d) => d.kind)))
  }
  const kinds = tight.dropped.map((d) => d.kind)
  const lastCheck = kinds.lastIndexOf('acceptance_check')
  const firstUserSemantic = kinds.findIndex((k) => k === 'observed_fact' || k === 'quality_interpretation')
  if (lastCheck >= 0 && firstUserSemantic >= 0) {
    assert.ok(lastCheck < firstUserSemantic, '检查项必须先于事实/质量解释被丢')
  }
})
