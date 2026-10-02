import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

function load() {
  const regs = []
  const win = { __ModuleLoader__: { load: r => regs.push(r) } }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: v => [v, () => {}],
    useRef: v => ({ current: v }),
    useEffect: () => {},
    useCallback: f => f,
    useMemo: f => f(),
  }
  const req = name => name === 'react' ? React : {}
  new Function('window', 'require', SRC)(win, req)
  const mod = regs[0].factory(req)
  mod.apply({ slots: { register: () => () => {}, inject: (slot, cb) => cb() }, locale: 'en' })
  return mod
}

function render(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(render).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') return render(node.type(node.props))
  return render(node.children)
}
function find(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const x of node) find(x, predicate, out); return out }
  if (typeof node.type === 'function') return find(node.type(node.props), predicate, out)
  if (predicate(node)) out.push(node)
  if (typeof node !== 'string' && typeof node !== 'number') find(node.children, predicate, out)
  return out
}
function row(mod, value, args = {}) {
  return mod.__debug.AdvisorToolRow({ phase: 'result', sessionId: '', callId: 'call-1', block: { call: { argsRaw: args }, content: [{ type: 'text', text: JSON.stringify(value) }] } })
}
const base = (stageState, report = { verdict: 'gaps', summary: 'legacy summary', checks: [], findings: [], nextStep: 'next', stopCondition: 'stop' }) => ({
  ok: true, report: { findings: [], nextStep: 'next', stopCondition: 'stop', ...report }, presentationMeta: stageState === undefined ? undefined : { stageState },
  reviewPassed: false,
})

test('staged pass renders identity, checkpoints, dependencies, limitations, and current-stage gate', () => {
  const mod = load()
  const state = { ok: true, advanceAllowed: true, taskId: 'task-A', action: 'advance', dependencyStages: [], stage: { id: 'stage-current', advanceAllowed: true, checks: [{ id: 'check-1', status: 'satisfied', criterion: 'observable result' }], limitations: ['subject-binding-unspecified'] } }
  const tree = row(mod, base(state))
  const text = render(tree)
  assert.match(text, /taskId: task-A/); assert.match(text, /stageId: stage-current/); assert.match(text, /action: advance/)
  assert.match(text, /check-1/); assert.match(text, /satisfied/); assert.match(text, /observable result/)
  assert.match(text, /dependencyStages:/); assert.match(text, /subject-binding-unspecified/); assert.match(text, /not task completion/i)
  assert.equal(find(tree, n => n.props['data-po06-advisor-stage-state']).length, 1)
  const checks = find(tree, n => n.props['data-po06-advisor-stage-check'] !== undefined)
  assert.equal(checks.length, 1)
  assert.equal(checks[0].props['data-po06-advisor-stage-check'], state.stage.checks[0].id)
  assert.equal(render(checks[0]), 'id: check-1status: satisfiedcriterion: observable result')
})

test('staged fail preserves failed checkpoint and repair action', () => {
  const mod = load()
  const state = { taskId: 'task-B', action: 'repair', dependencyStages: [], stage: { id: 'stage-B', advanceAllowed: false, checks: [{ id: 'bad', status: 'failed', criterion: 'failure criterion' }], limitations: [] } }
  const text = render(row(mod, base(state)))
  assert.match(text, /action: repair/); assert.match(text, /bad/); assert.match(text, /failed/); assert.match(text, /failure criterion/)
})

test('stale and unverified state uses collect-evidence, distinct from ask-user', () => {
  const mod = load()
  for (const status of ['stale', 'unverified']) {
    const state = { taskId: 'task-C', action: 'collect-evidence', stage: { id: 'stage-C', advanceAllowed: false, checks: [{ id: 'pending', status, criterion: 'evidence criterion' }], limitations: ['evidence-unavailable'] } }
    const text = render(row(mod, base(state)))
    assert.match(text, /action: collect-evidence/); assert.match(text, new RegExp(status)); assert.doesNotMatch(text, /action: ask-user/)
  }
  const ask = { taskId: 'task-C', action: 'ask-user', stage: { id: 'stage-C', advanceAllowed: false, checks: [{ id: 'pending', status: 'unverified', criterion: 'evidence criterion' }], limitations: ['evidence-unavailable'] } }
  assert.match(render(row(mod, base(ask))), /action: ask-user/)
})

test('missing stageState retains legacy and missing current stage cannot pass', () => {
  const mod = load()
  const legacy = base(undefined, { verdict: 'pass', summary: 'legacy answer', checks: [{ status: 'satisfied', criterion: 'legacy criterion' }] })
  const missing = base({ taskId: 'task-D', action: 'define-stage', stage: null }, { verdict: 'pass', summary: 'legacy answer', checks: [{ status: 'satisfied', criterion: 'legacy criterion' }] })
  for (const value of [legacy, missing]) {
    const tree = row(mod, value); const text = render(tree)
    assert.match(text, /legacy answer/)
    if (value.presentationMeta) assert.match(text, /Current declared stage state is missing/)
    else assert.equal(find(tree, n => n.props['data-po06-advisor-stage-state']).length, 0)
  }
})

test('declared stage call without state does not inherit legacy pass', () => {
  const mod = load()
  const tree = row(mod, base(undefined, { verdict: 'pass', summary: 'answer', checks: [] }), { taskId: 'task-missing', stageId: 'stage-missing' })
  const text = render(tree)
  assert.match(text, /Current declared stage state is missing/)
  assert.match(text, /Current stage cannot advance/)
  assert.doesNotMatch(text, /Current stage may advance/)
  assert.equal(find(tree, n => n.props['data-po06-advisor-stage-check'] !== undefined).length, 0)
})

test('canonical top-level stageState is accepted without recreating its actions', () => {
  const mod = load()
  const state = { ok: true, advanceAllowed: false, taskId: 'task-top', action: 'review-dependency', dependencyStages: ['stage-dependency'], stage: { id: 'stage-top', advanceAllowed: true, checks: [{ id: 'canonical', status: 'satisfied', criterion: 'canonical criterion' }], limitations: [] } }
  const value = base(undefined)
  value.stageState = state
  const text = render(row(mod, value))
  assert.match(text, /action: review-dependency/)
  assert.match(text, /dependencyStages: stage-dependency/)
  assert.match(text, /Current stage cannot advance/)
  assert.doesNotMatch(text, /may advance/)
  assert.doesNotMatch(text, /task completed/i)
})

test('satisfied current stage cannot advance with a stale dependency or rejected output', () => {
  const mod = load()
  const ready = { ok: true, advanceAllowed: true, taskId: 'task-guard', action: 'advance', dependencyStages: [], stage: { id: 'stage-guard', advanceAllowed: true, checks: [{ id: 'check-ready', status: 'satisfied', criterion: 'declared criterion' }], limitations: [] } }
  const variants = [
    base({ ...ready, advanceAllowed: false, action: 'review-dependency', dependencyStages: ['stage-stale'] }),
    base({ ...ready, dependencyStages: ['stage-stale'] }),
    base({ ...ready, ok: false }),
    base({ ...ready, advanceAllowed: false }),
    { ...base(ready), partial: true },
    { ...base(ready), stageRecording: { ok: false } },
  ]
  for (const value of variants) {
    const tree = row(mod, value)
    const text = render(tree)
    assert.match(text, /Current stage cannot advance/)
    assert.match(text, /Current declared stage cannot advance/)
    assert.doesNotMatch(text, /may advance/)
    const checks = find(tree, n => n.props['data-po06-advisor-stage-check'] !== undefined)
    assert.equal(render(checks[0]), 'id: check-readystatus: satisfiedcriterion: declared criterion')
  }
  assert.match(render(row(mod, variants[0])), /action: review-dependency/)
  assert.match(render(row(mod, variants[0])), /dependencyStages: stage-stale/)
})

test('legacy parser and loader id remain intact', () => {
  const mod = load()
  const valid = { ok: true, nested: { label: 'legacy' } }
  assert.equal(mod.__debug.advisorValueOf({ content: [{ type: 'text', text: 'Legacy banner\n' + JSON.stringify(valid) }] }).nested.label, 'legacy')
  assert.equal(mod.__debug.advisorValueOf({ content: [{ type: 'text', text: '[{\"ok\":true}]' }] }), null)
  assert.equal(mod.__debug.advisorValueOf({ content: [{ type: 'text', text: '{\"broken\": {\"ok\":true}' }] }), null)
  assert.match(SRC, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(SRC, /id:\s*'@dsh-external\/dsh-arbiter-wf'/)
  assert.match(SRC, /function advisorValueOf\(block\)/)
})

test('presentationMeta-only failed recording or partial never shows advancement',()=>{
 const mod=load()
 const state={ok:true,advanceAllowed:true,taskId:'T1',action:'advance',dependencyStages:[],stage:{id:'S1',advanceAllowed:true,checks:[{id:'S1.K1',status:'satisfied',criterion:'check'}],limitations:[]}}
 for(const flags of [{stageRecording:{ok:false}},{partial:true}]) {
  const value={...base(state),presentationMeta:{stageState:state,...flags}}
  const text=render(row(mod,value))
  assert.match(text,/当前阶段未放行|Current stage cannot advance/)
  assert.doesNotMatch(text,/当前阶段可放行|Current stage may advance/)
 }
})
