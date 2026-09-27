// 提示词快照：从源码里"求值"取出各档位实际组装出的 system 原文 + relayMessage 模板原文，
// 落盘成 JSON（机器对照）与 TXT（逐字 diff）。不重新实现组装逻辑，直接跑文件里的 buildSystem/TIER_SPECS。
// 用法：node evidence/prompt-snapshot.cjs <lib/index.js> <label>
const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')

const [srcFile, label] = process.argv.slice(2)
if (!srcFile || !label) { console.error('usage: prompt-snapshot.cjs <index.js> <label>'); process.exit(2) }
const src = fs.readFileSync(srcFile, 'utf8')

const start = src.search(/const RELAY_[A-Z]+ = \[/)
const userMsgAt = src.indexOf('function userMessageFor(')
if (start < 0 || userMsgAt < 0) { console.error('failed to locate constant region'); process.exit(1) }
const region = src.slice(start, userMsgAt)

let TIER_SPECS = null
let buildSystem = null
try {
  const fn = new Function(region + '\n; return { TIER_SPECS: typeof TIER_SPECS !== "undefined" ? TIER_SPECS : null, buildSystem: typeof buildSystem !== "undefined" ? buildSystem : null }')
  const out = fn()
  TIER_SPECS = out.TIER_SPECS
  buildSystem = out.buildSystem
} catch (e) {
  console.error('eval failed: ' + e.message)
  process.exit(1)
}
if (!TIER_SPECS) { console.error('TIER_SPECS not found'); process.exit(1) }

const relayAt = src.indexOf('function relayMessage(')
const headingsAt = src.indexOf('function headingsOf(')
const relaySource = relayAt >= 0 && headingsAt > relayAt ? src.slice(relayAt, headingsAt).trimEnd() : null

const tiers = {}
for (const id of Object.keys(TIER_SPECS)) {
  const spec = TIER_SPECS[id]
  const fullVariant = typeof buildSystem === 'function' ? buildSystem(id, { historyMode: 'full' }) : null
  tiers[id] = {
    label: spec.label,
    temperature: spec.temperature,
    chars: spec.system.length,
    lines: spec.system.split('\n').length,
    system: spec.system,
    fullModeChars: fullVariant ? fullVariant.length : null,
    fullModeSystem: fullVariant,
  }
}

const snapshot = {
  label,
  source: srcFile,
  sourceBytes: Buffer.byteLength(src),
  sourceSha256: createHash('sha256').update(src).digest('hex'),
  constantsRegion: region,
  relayMessage: relaySource,
  tiers,
}
const outJson = path.join(__dirname, 'prompt-snapshot-' + label + '.json')
fs.writeFileSync(outJson, JSON.stringify(snapshot, null, 2), 'utf8')

const txt = []
for (const id of Object.keys(tiers)) {
  txt.push('════════ 档位 ' + id + '（' + tiers[id].label + '）· 回合模式 · ' + tiers[id].chars + ' 字 / ' + tiers[id].lines + ' 行 ════════')
  txt.push(tiers[id].system)
  txt.push('')
  if (tiers[id].fullModeSystem) {
    txt.push('──────── 档位 ' + id + ' · 全文模式 · ' + tiers[id].fullModeChars + ' 字 ────────')
    txt.push(tiers[id].fullModeSystem)
    txt.push('')
  }
}
txt.push('════════ relayMessage（用户消息模板）════════')
txt.push(relaySource || '(not found)')
const outTxt = path.join(__dirname, 'prompt-' + label + '.txt')
fs.writeFileSync(outTxt, txt.join('\n'), 'utf8')

console.log('label=' + label + '  srcSha=' + snapshot.sourceSha256.slice(0, 12) + '  srcBytes=' + snapshot.sourceBytes)
for (const id of Object.keys(tiers)) console.log('  ' + id.padEnd(9) + ' system=' + tiers[id].chars + ' chars / ' + tiers[id].lines + ' lines   fullMode=' + tiers[id].fullModeChars)
console.log('WROTE ' + outJson)
console.log('WROTE ' + outTxt)
