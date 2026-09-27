/**
 * 产出形态回归（零污染）：读 evidence/output-shape.json（三档真实产出），
 * 断言"可直接发给工作 AI"的三条硬性质：
 *   ① 不含任何元话语（优化后的提示词/改动说明/边界/推理补充/关键判断/以下是/说明：）
 *   ② 不以"包裹整篇的元标题"开头（# / ## 优化类标题）
 *   ③ 是对工作 AI 的祈使指令（含祈使/要求词，且不出现"用户"称呼读者）
 * 用法：node evidence/output-shape-check.cjs
 */
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, 'output-shape.json')
const rows = JSON.parse(fs.readFileSync(file, 'utf8'))

// 元话语只在"行首/标题级"才算违规：合法的指令里可以出现"给我一份简短说明：…"这种句子
const META_LINE = [
  /^#{1,6}\s*(优化后的?提示词|改写后的?提示词|改动说明|推理补充|关键判断|边界|说明)\s*$/,
  /^(优化后的?提示词|改写后的?提示词|改动说明|推理补充|关键判断|边界)\s*[:：]/,
  /^(以下是|下面是|说明[:：]|注[:：]|备注[:：])/,
  /^\s*[-*]\s*(改动说明|推理补充|关键判断)\s*[:：]/,
]
const READER_WORDS = ['用户原话', '用户的原话', '原文中', '你可以在提示词里', '我为你', '为你优化', '优化了你的']
const IMPERATIVE = ['请', '不要', '先', '必须', '确保', '按', '执行', '确认', '做完', '给出', '验收', '如果']
// 传话检查：优化 AI 不该"和用户对话"（回应/讨好/反问），它只把意思转达给工作 AI
const CHAT_PATTERNS = [
  { re: /^(好的|收到|明白|明白了|没问题|当然)[，,。!！]/, why: '对话开场白' },
  { re: /我(可以|来|会)帮(你|您)/, why: '助手口吻' },
  { re: /需要我(再|帮你|为您|做|补充)/, why: '反问用户' },
  { re: /希望(对你有帮助|能帮到你)/, why: '对话收尾语' },
  { re: /^(请问|想问一下)/m, why: '向用户发问' },
  { re: /(你|您)(想|要|希望)我(怎么|如何|做)/, why: '向用户征询' },
  { re: /(还需要|要不要)(我|再)/, why: '反问用户' },
]

const cases = rows.map((r) => {
  const text = String(r.text || '')
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const hitMeta = lines.filter((l) => META_LINE.some((re) => re.test(l))).slice(0, 4)
  const hitReader = READER_WORDS.filter((m) => text.indexOf(m) >= 0)
  const hitChat = CHAT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.why)
  const firstLine = (lines[0] || '').trim()
  const metaTitleHead = /^#{1,2}\s*(优化|改写|改动|说明|推理|关键判断|边界)/.test(firstLine)
  const imperative = IMPERATIVE.filter((w) => text.indexOf(w) >= 0).length
  return {
    tier: r.tier, status: r.status, chars: text.length, ms: r.ms,
    metaHits: hitMeta, readerHits: hitReader, chatHits: hitChat, firstLine: firstLine.slice(0, 50),
    metaTitleHead, imperativeKinds: imperative,
    reasoningTokens: r.usage ? (r.usage.reasoningTokens || null) : null,
    totalTokens: r.usage ? (r.usage.totalTokens || null) : null,
    pass: r.status === 'done' && text.length > 0 && hitMeta.length === 0 && hitReader.length === 0
      && hitChat.length === 0 && metaTitleHead === false && imperative >= 3,
  }
})

const passed = cases.filter((c) => c.pass).length
const out = { checkedAt: new Date().toISOString(), source: file, passed, total: cases.length, cases }
fs.writeFileSync(path.join(__dirname, 'output-shape-check.json'), JSON.stringify(out, null, 2))
for (const c of cases) {
  console.log((c.pass ? 'PASS ' : 'FAIL ') + c.tier + '  ' + c.chars + '字 ' + c.ms + 'ms  tok(思考/总)=' + c.reasoningTokens + '/' + c.totalTokens
    + '  首行="' + c.firstLine + '"  元话语=' + JSON.stringify(c.metaHits) + ' 对读者称呼=' + JSON.stringify(c.readerHits) + ' 对话话术=' + JSON.stringify(c.chatHits) + ' 指令词=' + c.imperativeKinds)
}
console.log('---- ' + passed + '/' + cases.length + ' ----')
process.exit(passed === cases.length ? 0 : 1)
