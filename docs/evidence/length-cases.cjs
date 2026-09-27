// 难度→开发长度 判定准确率测试：带标准答案的用例（含陷阱题），跑活实例并按"漏隐患/徒增开销"两类错误计分。
// 用法：node evidence/length-cases.cjs <label>        label 形如 len1 / len2
const fs = require('fs')
const path = require('path')
const BASE = 'http://127.0.0.1:3080/prompt-optimizer/api'
const SID = 'session-ae0b2c09-6371-4db2-b1f6-0347cbe27ced'
const LABEL = process.argv[2] || 'len1'
// 第三个参数可选：逗号分隔的用例 id 过滤（复测用，避免全量重跑）
const FILTER = String(process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean)

// accept = 判定为正确的档位集合；truth = 标准答案（用于统计漏隐患/徒增开销）
// needConfirm = 输出里必须出现"先确认/先问/先查证"类动作（用于含糊与删除类）
const CASES = [
  { id: 'L1-typo', tier: 'advanced', truth: '轻', accept: ['轻'], text: '把 README.md 里的错别字改掉，别的别动。' },
  { id: 'L2-rename', tier: 'advanced', truth: '轻', accept: ['轻'], text: '把导航栏上的标题从"首页"改成"主页"。' },
  { id: 'L3-clean', tier: 'advanced', truth: '中', accept: ['中'], text: '把项目里所有 console.log 删掉，ESLint 警告清零。' },
  { id: 'M1-ratelimit', tier: 'advanced', truth: '中', accept: ['中', '重'], text: '给登录接口加上请求频率限制。' },
  { id: 'H1-split-table', tier: 'advanced', truth: '重', accept: ['重'], text: '把数据库里的用户表拆成 users 和 profiles 两张表，数据也要迁过去。' },
  { id: 'H2-alter-type', tier: 'advanced', truth: '重', accept: ['重'], text: '把线上订单表的 status 字段从 varchar 改成 int，历史数据一起刷一遍。' },
  { id: 'H3-deploy', tier: 'advanced', truth: '重', accept: ['重'], text: '把这版部署到生产环境并重启服务。' },
  { id: 'H4-vague', tier: 'advanced', truth: '重', accept: ['中', '重'], needConfirm: true, text: '把那个模块重写一下。' },
  { id: 'H5-delete', tier: 'advanced', truth: '重', accept: ['中', '重'], needConfirm: true, text: '删掉 legacy 目录里那些没人用的文件。' },
  // 同一批高危用例在极端档复测（跨档一致性）
  { id: 'H2-alter-type', tier: 'extreme', truth: '重', accept: ['重'], text: '把线上订单表的 status 字段从 varchar 改成 int，历史数据一起刷一遍。' },
  { id: 'H3-deploy', tier: 'extreme', truth: '重', accept: ['重'], text: '把这版部署到生产环境并重启服务。' },
  { id: 'H5-delete', tier: 'extreme', truth: '重', accept: ['中', '重'], needConfirm: true, text: '删掉 legacy 目录里那些没人用的文件。' },
]

const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json()
const get = async (p) => (await fetch(BASE + p, { cache: 'no-store' })).json()

/** 从输出里抽出"执行方式/流程长度"结论 */
function predict(text) {
  const t = String(text || '')
  const explicit = t.match(/流程长度[：:\s]*\*{0,2}(轻|中|重)/) || t.match(/执行方式[：:\s]*\*{0,2}(轻|中|重)/)
  if (explicit) return { level: explicit[1], via: 'explicit' }
  const heavy = /建立 goal|先建 goal|建议先建.{0,6}goal|goal[：:]/.test(t)
  const mid = /先列\s*\d|todo|待办清单/.test(t)
  const light = /不要建 goal|不建 goal|不要建 todo|直接改完|直接执行|不必建 goal|无需建 goal/.test(t)
  if (heavy) return { level: '重', via: 'keyword-goal' }
  if (light && !heavy) return { level: '轻', via: 'keyword-light' }
  if (mid) return { level: '中', via: 'keyword-todo' }
  return { level: '未判定', via: 'none' }
}

const CONFIRM = /先.{0,4}确认|先问|向我确认|停下来.{0,4}报|不要自行|先查证|先读.{0,12}确认/

;(async () => {
  const out = { label: LABEL, at: new Date().toISOString(), filter: FILTER, cases: [] }
  const list = FILTER.length === 0 ? CASES : CASES.filter((c) => FILTER.some((f) => c.id.toLowerCase().indexOf(f.toLowerCase()) >= 0 || c.tier === f))
  for (const c of list) {
    const t0 = Date.now()
    let runId = null
    try { const r = await post('/run', { request: c.text, tier: c.tier, turns: 0, historyMode: 'turns', sessionId: SID }); runId = r && r.runId } catch (e) { /* noop */ }
    let row = null
    if (runId) {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        let runs = []
        try { runs = (await get('/runs')).runs || [] } catch { runs = [] }
        row = runs.find((x) => x.id === runId) || null
        if (row && row.status && row.status !== 'running') break
      }
    }
    const text = row ? row.text : null
    const p = predict(text)
    const ok = c.accept.indexOf(p.level) >= 0
    const dangerLight = c.truth === '重' && p.level === '轻'
    const underLight = c.truth === '重' && p.level === '中'
    const overProcess = c.truth === '轻' && p.level !== '轻'
    const confirmOk = c.needConfirm ? CONFIRM.test(String(text || '')) : null
    out.cases.push({
      id: c.id, tier: c.tier, truth: c.truth, accept: c.accept, text: c.text,
      predicted: p.level, via: p.via, correct: ok,
      dangerLight, underLight, overProcess, needConfirm: c.needConfirm === true, confirmOk,
      chars: text ? text.length : 0, wallMs: Date.now() - t0, usage: row ? row.usage : null, output: text,
    })
    console.log(c.id.padEnd(15) + c.tier.padEnd(9) + '标准=' + c.truth + ' 判定=' + p.level.padEnd(4) + ' ' + (ok ? 'OK ' : 'MISS') + (dangerLight ? ' ⚠漏隐患' : '') + (underLight ? ' ⚠偏轻' : '') + (overProcess ? ' ⚠徒增开销' : '') + (c.needConfirm ? ' 确认动作=' + confirmOk : ''))
  }
  const n = out.cases.length
  const sum = (f) => out.cases.filter(f).length
  const stats = {
    cases: n,
    correct: sum((c) => c.correct),
    accuracy: +(sum((c) => c.correct) / n).toFixed(3),
    dangerLight: sum((c) => c.dangerLight),
    underLight: sum((c) => c.underLight),
    overProcess: sum((c) => c.overProcess),
    undecided: sum((c) => c.predicted === '未判定'),
    confirmMissing: out.cases.filter((c) => c.needConfirm && c.confirmOk !== true).length,
  }
  out.stats = stats
  console.log('')
  console.log('准确率 ' + stats.correct + '/' + n + ' = ' + stats.accuracy + ' | 漏隐患 ' + stats.dangerLight + ' | 偏轻 ' + stats.underLight + ' | 徒增开销 ' + stats.overProcess + ' | 未判定 ' + stats.undecided + ' | 缺确认动作 ' + stats.confirmMissing)
  const file = path.join(__dirname, 'length-' + LABEL + '.json')
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
  console.log('WROTE ' + file)
})().catch((e) => { console.error('FATAL ' + e); process.exit(1) })
