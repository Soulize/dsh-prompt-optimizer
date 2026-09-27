/**
 * 几何夹紧回归（零污染）：直接从交付文件 lib/client.js 抽出 clampPos / clampSize 源码求值，
 * 用假 store / 假 window / 假面板验证：
 *   ① 上一次在更大窗口里留下的越界坐标，重新开窗时必须被夹回可见区
 *   ② 自定义尺寸夹紧：不小于最小值、不超出当前视口
 * 用法：node evidence/geometry-check.js  → 写 evidence/geometry-check.json 并打印 PASS/FAIL
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'lib', 'client.js')
const code = fs.readFileSync(SRC, 'utf8')

/** 从源码里按大括号配对抽出一个具名函数（保证测的是交付代码本体，不是复写） */
function extract(name) {
  const at = code.indexOf('function ' + name + '(')
  if (at < 0) throw new Error('not found: ' + name)
  let i = code.indexOf('{', at)
  let depth = 0
  for (let j = i; j < code.length; j += 1) {
    const c = code[j]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return code.slice(at, j + 1)
    }
  }
  throw new Error('unbalanced: ' + name)
}

const srcs = [extract('clampPos'), extract('clampSize')].join('\n')
const make = (store, win) => new Function('store', 'window', 'PANEL_MIN_W', 'PANEL_MIN_H', srcs + '\nreturn { clampPos, clampSize }')(store, win, 360, 240)

const cases = []
const push = (name, pass, observed, expect) => cases.push({ name, pass, observed, expect })

// ① 大窗口 → 小窗口：旧坐标必须夹回
{
  const win = { innerWidth: 1000, innerHeight: 700 }
  const api = make({ overlaySize: null }, win)
  const panel = { offsetWidth: 460, offsetHeight: 520 }
  const out = api.clampPos(5000, 4000, panel)
  push('越界坐标(5000,4000) @1000×700 + 面板460×520', out.x === 1000 - 460 - 8 && out.y === 700 - 520 - 8 && out.x >= 8 && out.y >= 8, out, { x: 532, y: 172 })

  const out2 = api.clampPos(-999, -999, panel)
  push('负坐标(-999,-999) 夹到最小边距 8', out2.x === 8 && out2.y === 8, out2, { x: 8, y: 8 })
}
// ② 面板比视口还大时，位置退化为 8（不出现负值导致左/上溢出）
{
  const win = { innerWidth: 400, innerHeight: 300 }
  const api = make({ overlaySize: { w: 900, h: 800 } }, win)
  const panel = { offsetWidth: 900, offsetHeight: 800 }
  const out = api.clampPos(100, 100, panel)
  push('面板大于视口时位置退化为(8,8)', out.x === 8 && out.y === 8, out, { x: 8, y: 8 })
}
// ③ 尺寸夹紧：太大 → 收到视口内；太小 → 抬到最小值
{
  const win = { innerWidth: 1280, innerHeight: 800 }
  const api = make({ overlaySize: null }, win)
  const big = api.clampSize(4000, 3000)
  push('尺寸(4000,3000) @1280×800', big.w === 1280 - 16 && big.h === 800 - 16, big, { w: 1264, h: 784 })
  const small = api.clampSize(10, 10)
  push('尺寸(10,10) 抬到最小值', small.w === 360 && small.h === 240, small, { w: 360, h: 240 })
  const mixed = api.clampSize(700, null)
  push('只给宽度(700)时不动高度', mixed.w === 700 && mixed.h === undefined, mixed, { w: 700, h: undefined })
  const narrow = make({ overlaySize: null }, { innerWidth: 300, innerHeight: 200 }).clampSize(900, 900)
  push('视口(300×200)比最小值还小时取最小值', narrow.w === 360 && narrow.h === 240, narrow, { w: 360, h: 240 })
}
// ④ 真实链条：默认落位（右上）在窄窗口里也必须可见
{
  const win = { innerWidth: 620, innerHeight: 520 }
  const api = make({ overlaySize: null }, win)
  const base = { x: Math.max(8, win.innerWidth - 480), y: 96 }
  const pos = api.clampPos(base.x, base.y, null) // 首次渲染无面板 → 用默认宽 460
  const visible = pos.x >= 8 && pos.x + 460 <= win.innerWidth - 8 + 0.001
  push('窄窗口(620×520)首次落位可见', visible, pos, { x: 8, xMax: win.innerWidth - 468 })
}

const passed = cases.filter((c) => c.pass).length
const out = { checkedAt: new Date().toISOString(), source: SRC, passed, total: cases.length, cases }
fs.writeFileSync(path.join(__dirname, 'geometry-check.json'), JSON.stringify(out, null, 2))
for (const c of cases) console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + '  observed=' + JSON.stringify(c.observed) + ' expect=' + JSON.stringify(c.expect))
console.log('---- ' + passed + '/' + cases.length + ' ----')
process.exit(passed === cases.length ? 0 : 1)
