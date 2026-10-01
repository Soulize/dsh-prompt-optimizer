import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advisorSnapshot, parseAdvisorReport, createAdvisor, registerAdvisorTool } from '../lib/advisor.js'

const human = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const call = (id, name='bash') => ({ type: 'tool/call', data: { callId: id, name, arguments: '{"command":"test"}' } })
const result = (id, text) => ({ type: 'tool/result', data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })
const assistant = text => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
const events = [human('单文件，能运行。'), call('a'), result('a','tests passed'), assistant('我认为完美通过')]
const session = { id: 's1', snapshotEvents: () => events }
const exec = { agent: { session } }
const report = (over={}) => ({ verdict: 'pass', summary: '验证运行条件', findings: [], checks: [{ criterion: '能运行', status: 'satisfied', evidenceRefs: ['E2'] }], nextStep: '可交付', stopCondition: '用户发现偏差时重审', ...over })
const streamOf = (text) => (async function* () { yield { type: 'text-delta', text } })()
const runtime = { ok: true, cfg: { provider: 'p', model: 'optimizer', reasoningEffort: 'high' }, readTools: false, llm: { stream: () => streamOf(JSON.stringify(report())) } }

test('复核排除主模型结论、旧顾问与上轮记录；诊断可看到执行者过程', () => {
  const rows = [human('旧目标'), result('old','旧证据'), ...events, call('c','consult_task'), result('c','顾问结论')]
  const review = advisorSnapshot(rows,'review_result')
  assert.equal(review.userText,'单文件，能运行。')
  assert.equal(review.records.length,2)
  assert.ok(!JSON.stringify(review).includes('完美通过'))
  assert.ok(!JSON.stringify(review).includes('顾问结论'))
  assert.ok(advisorSnapshot(rows,'diagnose_failure').records.some(r => r.text.includes('完美通过')))
  assert.equal(advisorSnapshot([], 'review_result').ok, false)
})

test('伪引用、空验收、未验证通过、矛盾结论必须拒绝', () => {
  const ids = new Set(['E2'])
  assert.equal(parseAdvisorReport(JSON.stringify(report()),ids,'review_result').ok,true)
  for (const over of [ { checks: [] }, { checks: [{ criterion:'运行',status:'unverified',evidenceRefs:[] }] }, { checks: [{criterion:'运行',status:'satisfied',evidenceRefs:['fake']}] }, { checks: [{criterion:'运行',status:'failed',evidenceRefs:['E2']}] } ]) {
    // 最后一条：判通过却有 failed 的验收项 ⇒ 仍然必须拒（真相撞车）
    assert.equal(parseAdvisorReport(JSON.stringify(report(over)),ids,'review_result').ok,false)
  }
  assert.equal(parseAdvisorReport('not json',ids,'review_result').ok,false)
  // 判通过 + 只有观察性 findings（无 failed 验收项）⇒ **应当接受**（2026-09-30 真机：这类报告被误拒过）
  assert.equal(parseAdvisorReport(JSON.stringify(report({ findings:[{ text:'文案口径不一致，不影响该事实', evidenceRefs:['E2'] }] })),ids,'review_result').ok,true)
})

test('调用记录不能单独支持成果通过，材料截断不能整体通过', async () => {
  assert.equal(parseAdvisorReport(JSON.stringify(report({checks:[{criterion:'运行',status:'satisfied',evidenceRefs:['E1']}]})),new Set(['E1']),'review_result',new Set()).ok,false)
  const longSession = { id:'long', snapshotEvents:()=>[human('目标'.repeat(10000)),call('a'),result('a','passed')] }
  const invoke=createAdvisor({resolveRuntime:async()=>runtime})
  const out=await invoke({mode:'review_result',question:'复核'},{agent:{session:longSession}})
  assert.equal(out.ok,true)
  assert.equal(out.report.verdict,'unverified')
  assert.equal(out.truncated,true)
})

test('failed/unverified 可用调用类证据；只有 satisfied 必须有结果类证据（真机现场）', () => {
  // 2026-09-30 真机：顾问给出 checks=[unverified(E17246), failed(E17246), unverified(read:AGENTS.md)]，
  // 其中 E17246 是**本次咨询的 tool/call 事件**（不是 tool/result）⇒ 旧规则整份否掉、返回 advisor-invalid-check。
  const ids = new Set(['E17246', 'read:AGENTS.md'])
  const resultIds = new Set(['read:AGENTS.md'])
  const mk = (checks) => JSON.stringify({ verdict: 'narrow', summary: 's', nextStep: 'n', stopCondition: 'x', findings: [], checks })
  const live = mk([
    { criterion: '连通', status: 'unverified', evidenceRefs: ['E17246'] },
    { criterion: '能区分工作与敷衍', status: 'failed', evidenceRefs: ['E17246'] },
    { criterion: '有效性结论', status: 'unverified', evidenceRefs: ['read:AGENTS.md'] },
  ])
  assert.equal(parseAdvisorReport(live, ids, 'diagnose_failure', resultIds).ok, true, '这次的现场必须被接受')
  // 反过来：声称 “满足” 却只有调用类证据 ⇒ 仍然拒绝（这条防线不许松）
  const bad = mk([{ criterion: '跑通了', status: 'satisfied', evidenceRefs: ['E17246'] }])
  assert.equal(parseAdvisorReport(bad, ids, 'diagnose_failure', resultIds).reason, 'advisor-invalid-check')
  // 有结果类证据的 satisfied 照常通过
  const good = mk([{ criterion: '真的读到了', status: 'satisfied', evidenceRefs: ['read:AGENTS.md'] }])
  assert.equal(parseAdvisorReport(good, ids, 'diagnose_failure', resultIds).ok, true)
})

test('顾问必须知道工作目录；读不到的路径可引用但不支持「满足」（真机现场）', async () => {
  // 2026-09-30 真机：顾问的根是会话目录而不是插件仓库根，提示里没给 workspace ⇒ 它猜成
  // po06/package.json、读到「文件不存在」，如实报告却因引用不存在而被整份拒掉。
  let payload = null
  const invoke = createAdvisor({ resolveRuntime: async () => ({ ...runtime, readTools: true, cwd: '/ws' }), runLoop: async (o) => {
    payload = JSON.parse(o.messages[0].content[0].text)
    o.onEvent({ kind: 'tool', tool: 'read', target: 'missing.json', round: 1, ok: true })
    return { text: JSON.stringify({ verdict: 'unverified', summary: '没读到', nextStep: '换路径', stopCondition: '别重试',
      findings: [{ text: '该路径读不到', evidenceRefs: ['read:missing.json'] }],
      checks: [{ criterion: '读到了', status: 'unverified', evidenceRefs: ['read:missing.json'] }] }),
      // 真实循环会登记 trace；「读不到」的行 ok=true、resultAvailable=false
      trace: [{ tool: 'read', args: { path: 'missing.json' }, ok: true, rejected: false, resultAvailable: false }],
      toolCalls: 1 }
  } })
  const out = await invoke({ mode: 'review_result', question: '读文件' }, exec)
  assert.equal(payload.workspace, '/ws', '提示里必须告诉顾问工作目录')
  assert.ok(/相对 workspace/.test(payload.warning), '还要说明路径相对它')
  // read:missing.json 只被「调用过」而没读到内容 ⇒ 可以支持 findings；但不能支持「满足」
  assert.equal(out.ok, true, '只被调用过的 read 路径应当可引用')
  assert.equal(out.report.verdict, 'unverified')
})

test('卡片声明必须合宿主契约（缺 card 或非法 kind 会让它只在轨迹里可见）', () => {
  // 宿主：ToolCallView = Generic{card:'generic'} | Terminal{card:'terminal'} | Diff{card:'diff'}，card 必填；
  // ToolCallKind = read|edit|delete|move|search|execute|fetch|other。
  // 踩过的坑（2026-09-30，用户实测）：写成 { title, description, kind:'inspect' } ⇒ 缺 card、kind 非法
  // ⇒ 宿主认不出卡片，顾问只能退到轨迹层显示。
  const KINDS = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch', 'other']
  let definition
  registerAdvisorTool({ tools: { register: (d) => { definition = d; return () => {} } } }, () => {})
  const call = definition.presentCall({ mode: 'review_result', question: '审运行条件' })
  assert.equal(call.card, 'generic', 'card 是必填字段')
  assert.ok(KINDS.includes(call.kind), 'kind 必须在宿主枚举里，实际=' + call.kind)
  assert.equal(definition.presentCall({ mode: 'diagnose_failure', question: 'q' }).title.includes('失败诊断'), true)
  // 用量必须随投影带给卡片（走 A：页脚显示这次咨询的 token）
  const um = definition.output.presentationMeta({}, { ok: true, usage: { inputTokens: 12450, outputTokens: 3676, cacheReadTokens: 25344, totalTokens: 41470 } })
  assert.deepEqual(um.usage, { in: 12450, out: 3676, cache: 25344, total: 41470 }, 'usage 必须被投影（含合计）')
  assert.equal(definition.output.presentationMeta({}, { ok: true }).usage, null, '没有用量就如实回 null，不估算')
  // 结果卡：走 presentationMeta 投影，不去解析自己渲染的文本
  const meta = definition.output.presentationMeta({}, {
    ok: true, model: 'p/m', ms: 4200, toolCalls: 2,
    report: { verdict: 'gaps', summary: '有缺口', nextStep: '补证据', stopCondition: '三次无新增就停',
      findings: [{ text: '未验证项被当成通过', evidenceRefs: ['E3'] }],
      checks: [{ criterion: '能运行', status: 'unverified', evidenceRefs: [] }] },
  })
  const okCard = definition.presentResult({}, { meta })
  assert.equal(okCard.card, 'generic')
  assert.ok(okCard.content[0].text.includes('有缺口'), '结论要出现在卡上')
  assert.ok(okCard.content[0].text.includes('unverified'), '验收状态要逐条列出')
  assert.ok(okCard.content[0].text.includes('E3'), '证据编号要带上，可核')
  const badCard = definition.presentResult({}, { meta: definition.output.presentationMeta({}, { ok: false, reason: 'assist-off' }) })
  assert.ok(badCard.content[0].text.includes('assist-off'), '被拒的原因也要看得见')
})

test('注册入口、实际调用沿用模型档位、且不把假设交给成果复核', async () => {
  let definition, opts
  registerAdvisorTool({tools:{register:d=>{definition=d; return ()=>{}}}},()=>{})
  assert.equal(definition.name,'consult_task')
  assert.equal(definition.parameters.type,'object')
  assert.deepEqual(definition.parameters.required,['mode','question'])
  const invoke = createAdvisor({resolveRuntime:async()=>({...runtime,llm:{stream:o=>{opts=o;return streamOf(JSON.stringify(report()))}}})})
  const out = await invoke({mode:'review_result',question:'审运行条件',hypothesis:'绝对完美'},exec)
  assert.equal(out.ok,true)
  assert.equal(opts.model,'optimizer')
  assert.equal(opts.reasoningEffort,'high')
  assert.ok(!JSON.stringify(opts.messages).includes('绝对完美'))
  assert.ok(!JSON.stringify(opts.messages).includes('我认为完美通过'))
  assert.ok(opts.signal)
})

test('失败诊断接收到假设，但不是事实；错误路由不调用模型', async () => {
  let prompt
  const invoke = createAdvisor({resolveRuntime:async()=>({...runtime,llm:{stream:o=>{prompt=JSON.stringify(o.messages);return streamOf(JSON.stringify(report({verdict:'narrow',checks:[]})))}}})})
  assert.equal((await invoke({mode:'diagnose_failure',question:'为何失败',hypothesis:'怀疑路径错误'},exec)).ok,true)
  assert.ok(prompt.includes('executorHypothesis'))
  const off = createAdvisor({resolveRuntime:async()=>({ok:false,reason:'assist-off'})})
  assert.equal((await off({mode:'review_result',question:'审查'},exec)).reason,'assist-off')
})

test('只读成果限项目根；读不到的文件不能产生可引用编号', async () => {
  const root=mkdtempSync(join(tmpdir(),'po06-advisor-'))
  writeFileSync(join(root,'out.txt'),'actual artifact')
  let payload
  const invoke=createAdvisor({resolveRuntime:async()=>({...runtime,readTools:true,cwd:root}),runLoop:async o=>{
    payload=JSON.parse(o.messages[0].content[0].text)
    return {text:JSON.stringify(report({checks:[{criterion:'文件内容',status:'satisfied',evidenceRefs:['F0']}]})),trace:[]}
  }})
  try {
    assert.equal((await invoke({mode:'review_result',question:'审文件',artifacts:['out.txt']},exec)).ok,true)
    assert.ok(payload.artifacts[0].text.includes('actual artifact'))
    assert.equal((await invoke({mode:'review_result',question:'审文件',artifacts:['missing.txt']},exec)).ok,false)
    assert.equal((await invoke({mode:'review_result',question:'审文件',artifacts:['../outside']},exec)).ok,false)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('同会话并发拒绝，超时取消模型并等待收尾', async () => {
  let entered, settled=false
  const started = new Promise(r=>{entered=r})
  const invoke=createAdvisor({timeoutMs:20,resolveRuntime:async()=>({...runtime,llm:{stream:o=>(async function*(){
    entered();await new Promise(r=>o.signal.addEventListener('abort',r,{once:true}));settled=true
  })()}})})
  const first=invoke({mode:'review_result',question:'复核'},exec)
  await started
  assert.equal((await invoke({mode:'review_result',question:'重复'},exec)).reason,'advisor-already-running')
  assert.equal((await first).reason,'advisor-timeout')
  assert.equal(settled,true)
})

test('预先取消不调用模型，卸载会取消在途顾问', async () => {
  const controller=new AbortController();controller.abort()
  let calls=0
  const invoke=createAdvisor({resolveRuntime:async()=>{calls++;return runtime}})
  assert.equal((await invoke({mode:'review_result',question:'审查'},{...exec,signal:controller.signal})).reason,'advisor-cancelled')
  assert.equal(calls,0)
  let entered
  const started=new Promise(r=>{entered=r})
  const active=createAdvisor({resolveRuntime:async()=>({...runtime,llm:{stream:o=>(async function*(){entered();await new Promise(r=>o.signal.addEventListener('abort',r,{once:true}))})()}})})
  const pending=active({mode:'review_result',question:'审查'},exec)
  await started;active.dispose()
  assert.equal((await pending).reason,'advisor-cancelled')
})
