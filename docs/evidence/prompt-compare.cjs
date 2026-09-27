// 新旧输出对照：机械指标（可复核）+ 逐用例原文并排落盘。
// 用法：node evidence/prompt-compare.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const A = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-baseline.json'), 'utf8'))
const B = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-optimized.json'), 'utf8'))

const META = ['优化后的提示词', '改写后', '改动说明', '以下是', '推理补充', '关键判断']
const ASK_USER = ['是否需要我', '需要我帮', '希望对你有帮助', '还需要我做什么', '你可以考虑', '建议你']
const SOFT = ['尽量', '最好', '建议', '如果可以', '争取', '有空的话']
const HEAD1 = /^#\s/m
const PROCESS_LIGHT = ['不要建 goal', '不要建goal', '无需建立 goal', '不用建 goal', '直接改完', '直接执行', '不需要 goal']
const PROCESS_HEAVY = ['建立 goal', '建立goal', 'goal：', '阶段推进', '分阶段']

const metrics = (t) => {
  const s = String(t || '')
  const hit = (arr) => arr.filter((k) => s.indexOf(k) >= 0)
  return {
    chars: s.length,
    metaHits: hit(META),
    askUserHits: hit(ASK_USER),
    softHits: hit(SOFT),
    hasH1: HEAD1.test(s),
    processLightHits: hit(PROCESS_LIGHT),
    processHeavyHits: hit(PROCESS_HEAVY),
    startsWithMeta: /^(好的|明白|收到|没问题|以下是|优化后)/.test(s.trim()),
  }
}

const rows = []
for (const a of A.cases) {
  const b = B.cases.find((x) => x.id === a.id) || {}
  const ma = metrics(a.text)
  const mb = metrics(b.text)
  rows.push({
    id: a.id, tier: a.tier, request: a.request,
    old: { ...ma, text: a.text, runError: a.runError, usage: a.usage, ratio: a.request ? +(ma.chars / a.request.length).toFixed(2) : null },
    new: { ...mb, text: b.text, runError: b.runError, usage: b.usage, ratio: b.request ? +(mb.chars / b.request.length).toFixed(2) : null, libStatus: b.status },
  })
}

const line = (s, n) => String(s).padEnd(n)
console.log('lib sha  改前=' + A.liveLibSha256.slice(0, 12) + '  改后=' + B.liveLibSha256.slice(0, 12))
console.log('')
console.log(line('用例', 14) + line('档位', 9) + line('旧输出', 8) + line('新输出', 8) + line('旧长度比', 9) + line('新长度比', 9) + line('旧元话语', 9) + line('新元话语', 9) + line('旧提问', 8) + line('新提问', 8) + line('旧软措辞', 9) + line('新软措辞', 9) + '新流程结论')
for (const r of rows) {
  console.log(
    line(r.id, 14) + line(r.tier, 9) +
    line(r.old.chars, 8) + line(r.new.chars, 8) +
    line(r.old.ratio, 9) + line(r.new.ratio, 9) +
    line(r.old.metaHits.length, 9) + line(r.new.metaHits.length, 9) +
    line(r.old.askUserHits.length, 8) + line(r.new.askUserHits.length, 8) +
    line(r.old.softHits.length, 9) + line(r.new.softHits.length, 9) +
    (r.new.processHeavyHits.length > 0 ? '重(' + r.new.processHeavyHits.slice(0, 2).join(',') + ')' : (r.new.processLightHits.length > 0 ? '轻(' + r.new.processLightHits.slice(0, 2).join(',') + ')' : '—'))
  )
}
console.log('')
const sum = (k, f) => rows.reduce((s, r) => s + r[k][f], 0)
console.log('合计：输出字符 旧 ' + sum('old', 'chars') + ' → 新 ' + sum('new', 'chars'))
console.log('合计：元话语命中 旧 ' + sum('old', 'metaHits') + ' → 新 ' + sum('new', 'metaHits') + '（数组相加=命中项数）')
const tok = (k, f) => rows.reduce((s, r) => s + ((r[k].usage && (r[k].usage[f] || 0)) || 0), 0)
console.log('合计：inputTokens 旧 ' + tok('old', 'inputTokens') + ' → 新 ' + tok('new', 'inputTokens'))
console.log('合计：outputTokens 旧 ' + tok('old', 'outputTokens') + ' → 新 ' + tok('new', 'outputTokens'))
console.log('合计：totalTokens 旧 ' + tok('old', 'totalTokens') + ' → 新 ' + tok('new', 'totalTokens'))
console.log('合计：cacheReadTokens 旧 ' + tok('old', 'cacheReadTokens') + ' → 新 ' + tok('new', 'cacheReadTokens'))

const md = []
md.push('# 提示词优化 · 新旧输出对照（原始样本）')
md.push('')
md.push('- 改前 lib sha256: `' + A.liveLibSha256 + '`（采集时间 ' + A.at + '）')
md.push('- 改后 lib sha256: `' + B.liveLibSha256 + '`（采集时间 ' + B.at + '）')
md.push('- 同一批用例、同一会话、同一默认模型；每条用例的 tier/回合数一致。')
md.push('')
md.push('## 机械指标')
md.push('')
md.push('| 用例 | 档位 | 旧字符 | 新字符 | 旧长度比 | 新长度比 | 旧元话语 | 新元话语 | 旧提问用户 | 新提问用户 | 旧软措辞 | 新软措辞 |')
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  md.push('| ' + r.id + ' | ' + r.tier + ' | ' + r.old.chars + ' | ' + r.new.chars + ' | ' + r.old.ratio + ' | ' + r.new.ratio + ' | ' + r.old.metaHits.length + ' | ' + r.new.metaHits.length + ' | ' + r.old.askUserHits.length + ' | ' + r.new.askUserHits.length + ' | ' + r.old.softHits.length + ' | ' + r.new.softHits.length + ' |')
}
md.push('')
md.push('## 逐用例原文')
for (const r of rows) {
  md.push('')
  md.push('### ' + r.id + '（tier=' + r.tier + '）')
  md.push('')
  md.push('输入原话：`' + r.request + '`')
  md.push('')
  md.push('**改前输出**（' + r.old.chars + ' 字符，usage=' + JSON.stringify(r.old.usage) + '）')
  md.push('')
  md.push('```text')
  md.push(String(r.old.text || '(无)'))
  md.push('```')
  md.push('')
  md.push('**改后输出**（' + r.new.chars + ' 字符，usage=' + JSON.stringify(r.new.usage) + '）')
  md.push('')
  md.push('```text')
  md.push(String(r.new.text || '(无)'))
  md.push('```')
}
const outFile = path.join(ev, 'prompt-compare.md')
fs.writeFileSync(outFile, md.join('\n'), 'utf8')
console.log('')
console.log('WROTE ' + outFile)
