// 生成"同口径"逐字对照：只取回合模式 system（基线没有全文模式变体，混在一起会虚增 diff 行数）。
// 用法：node evidence/prompt-diff.cjs
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ev = __dirname
const A = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-baseline.json'), 'utf8'))
const B = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-optimized.json'), 'utf8'))

const render = (snap) => {
  const out = []
  for (const id of Object.keys(snap.tiers)) {
    out.push('════════ tier=' + id + ' (' + snap.tiers[id].label + ') ════════')
    out.push(snap.tiers[id].system)
    out.push('')
  }
  out.push('════════ relayMessage（用户消息模板）════════')
  out.push(snap.relayMessage || '(none)')
  return out.join('\n')
}
const fa = path.join(ev, 'prompt-turns-baseline.txt')
const fb = path.join(ev, 'prompt-turns-optimized.txt')
fs.writeFileSync(fa, render(A), 'utf8')
fs.writeFileSync(fb, render(B), 'utf8')

// git diff --no-index 在"有差异"时退出码为 1，属正常，需容错取 stdout
const runDiff = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).toString()
  } catch (e) {
    if (e && typeof e.stdout === 'string') return e.stdout
    throw e
  }
}
const stat = runDiff(['diff', '--no-index', '--stat', fa, fb])
const unified = runDiff(['diff', '--no-index', '--unified=1', fa, fb])
const diffFile = path.join(ev, 'prompt-diff.txt')
fs.writeFileSync(diffFile, unified, 'utf8')

const la = fs.readFileSync(fa, 'utf8').split('\n')
const lb = fs.readFileSync(fb, 'utf8').split('\n')
const statLines = stat.trim().split('\n')
const nums = statLines[statLines.length - 1]
const plus = unified.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
const minus = unified.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length
console.log('turns-only 行数: 改前 ' + la.length + ' → 改后 ' + lb.length)
console.log('diff: +' + plus + ' 行 / -' + minus + ' 行')
console.log('stat: ' + nums)
console.log('WROTE ' + diffFile)
console.log('WROTE ' + fa)
console.log('WROTE ' + fb)
