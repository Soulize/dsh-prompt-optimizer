// 提示词基线/对照采集器：对活实例逐个跑代表用例，落盘原始输出（供新旧逐字对照）。
// 用法：node evidence/prompt-cases.cjs <label>        label 形如 baseline / optimized
// 依赖：活实例 HTTP 通道（/prompt-optimizer/api/run + /runs）
const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')

const LABEL = process.argv[2] || 'run'
const BASE = 'http://127.0.0.1:3080/prompt-optimizer/api'
const SID = 'session-ae0b2c09-6371-4db2-b1f6-0347cbe27ced'
const LIVE_LIB = 'C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer-0.1.1-beta.1/package/lib/index.js'
const OUT_DIR = path.join(__dirname)

// 代表用例：简单 / 硬约束 / 含糊需查证 / 复杂高风险 / 带历史上下文
const CASES = [
  { id: 'C1-simple', tier: 'basic', turns: 0, historyMode: 'turns', request: '把 README.md 里的错别字改一下，别的别动。' },
  { id: 'C2-hard', tier: 'basic', turns: 0, historyMode: 'turns', request: '重构 auth 模块：必须保持现有 API 兼容，改完必须跑通现有测试，绝对不要动数据库 schema。' },
  { id: 'C3-ambiguous', tier: 'advanced', turns: 0, historyMode: 'turns', request: '把那个页面弄好看点，动画也加上，顺手把数据那块也修一下' },
  { id: 'C4-complex', tier: 'extreme', turns: 0, historyMode: 'turns', request: '把项目从 webpack 迁到 vite，同时把 React 17 升到 19，本周五要上线，出问题你能自己搞定吧？' },
  { id: 'C5-history', tier: 'advanced', turns: 2, historyMode: 'turns', request: '接着刚才那个思路继续往下做。' },
]

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}
const get = async (p) => {
  const r = await fetch(BASE + p, { cache: 'no-store' })
  return r.json()
}
const sha = (s) => createHash('sha256').update(s).digest('hex')

;(async () => {
  const libSrc = fs.readFileSync(LIVE_LIB, 'utf8')
  const out = {
    label: LABEL,
    at: new Date().toISOString(),
    liveLib: LIVE_LIB,
    liveLibSha256: sha(libSrc),
    liveLibBytes: Buffer.byteLength(libSrc),
    cases: [],
  }
  for (const c of CASES) {
    const t0 = Date.now()
    let runId = null
    let err = null
    try {
      const r = await post('/run', { request: c.request, tier: c.tier, turns: c.turns, historyMode: c.historyMode, sessionId: SID })
      runId = r && r.runId
    } catch (e) { err = String(e) }
    let row = null
    if (runId) {
      // 轮询到终态（最长 150s）
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        let runs = []
        try { runs = (await get('/runs')).runs || [] } catch { runs = [] }
        row = runs.find((x) => x.id === runId) || null
        if (row && row.status && row.status !== 'running') break
      }
    }
    out.cases.push({
      id: c.id, tier: c.tier, turns: c.turns, historyMode: c.historyMode, request: c.request,
      runId, wallMs: Date.now() - t0, error: err,
      status: row ? row.status : null,
      runError: row ? row.error : null,
      history: row ? row.history : null,
      usage: row ? row.usage : null,
      textChars: row && row.text ? row.text.length : 0,
      text: row ? row.text : null,
    })
    console.log(c.id + '  status=' + (row ? row.status : 'n/a') + '  chars=' + (row && row.text ? row.text.length : 0) + '  ' + (Date.now() - t0) + 'ms')
  }
  const file = path.join(OUT_DIR, 'prompt-' + LABEL + '.json')
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
  console.log('WROTE ' + file + '  (lib sha ' + out.liveLibSha256.slice(0, 12) + ')')
})().catch((e) => { console.error('FATAL ' + e); process.exit(1) })
