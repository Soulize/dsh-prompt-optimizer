// 0.7.8 · 会话级档位与界面作用域回归
//
// 这个文件是为**真实踩到的缺陷**立的守卫：
//   ① 会话覆盖写了 `tier` 却不展开成三项 ⇒ 选择器点了没反应（看起来生效，实际没变）；
//   ② `/status` 的会话档位显示了覆盖里的原始字段而不是**推导值** ⇒ 界面显示与实际行为不一致；
//   ③ 控件引用了**另一个组件**（或漏了形参）里的标识符 ⇒ 渲染期 ReferenceError ⇒ 整块界面调不动。
////   ③ 这类错误语法检查抓不到（JS 标识符是运行时解析），所以这里按组件区间做静态核对。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeSettings, tierOf, TIER_PRESETS } from '../lib/settings.js'
import { effectiveSettings, policyFor } from '../lib/policy.js'

const A = 'session-aaa'
const B = 'session-bbb'

test('会话覆盖只存意图：写了 tier 就只存 tier，不预展开', () => {
  const raw = { bySession: { [A]: { tier: 'heavy' } } }
  assert.deepEqual(normalizeSettings(raw).settings.bySession[A], { tier: 'heavy' },
    '存储里只应有意图本身——存展开值会在下一次点击时盖过新预设')
  // 但**生效值**必须展开：tierOf 是从三项反推的，不展开等于没设置。
  const eff = effectiveSettings(raw, A)
  assert.equal(tierOf(eff), 'heavy')
  assert.equal(eff.detail, TIER_PRESETS.heavy.detail)
})

test('会话档位真的改变生效行为，且不影响其它会话与全局', () => {
  const raw = { bySession: { [A]: { tier: 'heavy' } } }
  const a = effectiveSettings(raw, A)
  assert.equal(tierOf(a), 'heavy', 'A 的推导档位应是 heavy')
  assert.equal(a.detail, 'detailed')
  assert.equal(tierOf(effectiveSettings(raw, B)), 'standard', 'B 不该被 A 的覆盖影响')
  assert.ok(policyFor(raw, A).packetBudgetChars > policyFor(raw, B).packetBudgetChars,
    '档位必须体现到产出预算上，而不只是显示')
})

test('连续点两次档位：第二次必须生效（本轮缺陷回归）', () => {
  // 界面点档位 = **整份替换**该会话的覆盖（不是合并），所以每次只剩一个 tier。
  const click = (t) => ({ bySession: { [A]: { tier: t } } })
  assert.equal(tierOf(effectiveSettings(click('heavy'), A)), 'heavy')
  assert.equal(tierOf(effectiveSettings(click('standard'), A)), 'standard', '第二次点击必须切过去')
  assert.equal(tierOf(effectiveSettings(click('off'), A)), 'off')
})

test('缺陷机理：陈旧的展开残留会盖过新预设（钉住它别回来）', () => {
  // 旧写法把上一次的展开值一并存进覆盖；读取时它们参与合并并盖过新预设 ⇒ 档位看起来没变。
  const stale = { bySession: { [A]: { tier: 'standard', assist: 'auto', detail: 'detailed', budget: 'generous' } } }
  assert.equal(tierOf(effectiveSettings(stale, A)), 'heavy',
    '残留确实会盖过新预设——所以存储里绝不能留展开值')
})

test('显式写的项优先于档位预设（读取时合并）', () => {
  const eff = effectiveSettings({ bySession: { [A]: { tier: 'heavy', detail: 'minimal' } } }, A)
  assert.equal(eff.detail, 'minimal', '显式 detail 应覆盖预设')
  assert.equal(eff.budget, TIER_PRESETS.heavy.budget, '未显式写的仍来自预设')
})

test('越界键与非法的会话档位被丢弃并记账，不静默采纳', () => {
  assert.deepEqual(normalizeSettings({ bySession: { [A]: { tier: 'nope' } } }).problems.map((p) => p.kind),
    ['not-in-domain'])
  assert.equal(normalizeSettings({ bySession: { [A]: { bash: false } } }).settings.bySession[A], undefined,
    '机器级键不该被写进会话覆盖')
  assert.deepEqual(normalizeSettings({ bySession: { [A]: { bash: false } } }).problems.map((p) => p.kind),
    ['not-session-scoped'])
})

// ── 界面作用域静态核对 ──────────────────────────────────────────────
//
// 判据要点（这一版是踩过两次之后收敛的，别退回窄判据）：
//   · “使用”必须把**裸引用**也算进来——`useStatus(sessionId)` 这种实参既不是 `id.` 也不是 `id(`，
//     只认那两种写法会漏判，守卫就退化成装饰品（它第一次正是因此没抓到 SettingsTab）。
//   · “定义”必须认四种形态：签名形参 / `const x =` / 解构 `const { x } =` / 函数与箭头函数的形参。
//   · 区间起点匹配串以换行开头，取“签名行”时要先去掉这个换行，否则取到空串 → 全量误报。
const GUARDED = ['eff', 'withSession', 'saveTier', 'sessionId']

function scanScope(src) {
  const code = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  const marks = [...code.matchAll(/\n {4}function ([A-Za-z_$][\w$]*)\(/g)].map((m) => ({ name: m[1], at: m.index }))
  const problems = []
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].at
    const to = i + 1 < marks.length ? marks[i + 1].at : code.length
    const body = code.slice(from, to)
    const first = body.replace(/^\n/, '').split('\n')[0]
    const sig = first.replace(/^\s*function\s+\w+/, '')
    for (const id of GUARDED) {
      if (!new RegExp('\\b' + id + '\\b').test(body)) continue
      const defined = new RegExp('\\b' + id + '\\b').test(sig)
        || new RegExp('(const|let|var)\\s+' + id + '\\s*=').test(body)
        || new RegExp('(const|let|var)\\s*\\{[^}]*\\b' + id + '\\b[^}]*\\}').test(body)
        // ⚠ 形参判据必须收紧成“**只允许标识符列表**”。用 `\([^)]*id[^)]*\)` 这种松写法会误命中
        //   跨行文本：`h(Options, { value: eff.assist, … onChange: (v) =>` 里，从 `h(` 到 `(v)` 的
        //   那一大段同样满足“括号里含 eff 且后面跟着 =>”——于是真缺陷被掩盖（实测踩过）。
        || new RegExp('function\\s+\\w+\\s*\\(\\s*(?:[A-Za-z_$][\\w$]*\\s*,\\s*)*\\b' + id + '\\b').test(body)
        || new RegExp('\\(\\s*(?:[A-Za-z_$][\\w$]*\\s*,\\s*)*\\b' + id + '\\b\\s*(?:,\\s*[A-Za-z_$][\\w$]*)*\\s*\\)\\s*=>').test(body)
      if (!defined) problems.push(marks[i].name + ' 用到 ' + id + ' 但没在自己作用域里定义')
    }
  }
  return problems
}

const CLIENT = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('界面：组件引用的标识符必须在**它自己的作用域里**定义', () => {
  const problems = scanScope(CLIENT)
  assert.deepEqual(problems, [], problems.join('；'))
})

test('守卫本身必须有效：删掉定义时它要能报出来（否则就是装饰品）', () => {
  // 用**内存里模拟的真实缺陷**证明敏感度——这两条正是把用户界面搞挂的两种写法。
  const noEff = CLIENT.replace('      const eff = (status && status.sessionEffective) || s\n', '')
  assert.ok(scanScope(noEff).some((p) => /ControlForm/.test(p)), '删掉 ControlForm 的 eff 定义应被报出')
  const settingsAt = CLIENT.indexOf('    function SettingsTab(props)')
  assert.ok(settingsAt >= 0, '要能定位 SettingsTab')
  const sidAt = CLIENT.indexOf('      const { sessionId } = props || {}\n', settingsAt)
  assert.ok(sidAt > settingsAt, '要能定位 SettingsTab 自己的 sessionId 定义')
  const noSid = CLIENT.slice(0, sidAt) + CLIENT.slice(sidAt + '      const { sessionId } = props || {}\n'.length)
  assert.ok(scanScope(noSid).some((p) => /SettingsTab/.test(p)), '删掉 SettingsTab 的 sessionId 定义应被报出')
})