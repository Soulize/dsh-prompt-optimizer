// 约束不丢失闸门：把"不可削弱/必须保留"的约束写成关键词断言，逐档位（含两种历史模式）检查。
// 用法：node evidence/prompt-invariants.cjs <optimized snapshot json>
const fs = require('fs')
const snap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))

// [名称, 关键词（全部命中才算通过）, 适用档位]
const INVARIANTS = [
  ['中间领导身份', ['传话的中间领导'], ['basic', 'advanced', 'extreme']],
  ['不改用户需求/不代拍板', ['不改需求、不加戏、不代拍板'], ['basic', 'advanced', 'extreme']],
  ['输出原样发出·读者只有工作 AI', ['原样发出', '读者只有工作 AI'], ['basic', 'advanced', 'extreme']],
  ['禁止元话语/元标题', ['优化后/改写后/改动说明/以下是'], ['basic', 'advanced', 'extreme']],
  ['禁止对用户说话', ['对"用户/原文/上一版"说话'], ['basic', 'advanced', 'extreme']],
  ['禁止向用户提问', ['向用户提问'], ['basic', 'advanced', 'extreme']],
  ['禁止一级标题', ['一级标题'], ['basic', 'advanced', 'extreme']],
  ['输出语言跟随用户原话（v0.2.2 新增，受保护）', ['输出语言＝用户原话的语言'], ['basic', 'advanced', 'extreme']],
  // v0.3 复杂任务能力包：四个必须同时在场（大局/几何/不降级/停手与证据）
  ['复杂任务能力包·触发与大局', ['复杂任务：先定大局', '全局验收场景'], ['advanced', 'extreme']],
  ['复杂任务能力包·几何法线', ['法线朝向必须一致且外观面朝外'], ['advanced', 'extreme']],
  ['复杂任务能力包·不得降级', ['不得降级清单'], ['advanced', 'extreme']],
  ['复杂任务能力包·停手条件与证据', ['停手条件', '没有证据不算完成'], ['advanced', 'extreme']],
  ['软措辞硬化', ['尽量/最好/建议/如果可以/争取', '必须/不得'], ['basic', 'advanced', 'extreme']],
  ['不虚构项目事实', ['不得写出你没见过的路径', '不得编造'], ['basic', 'advanced', 'extreme']],
  ['缺事实→查证动作', ['先读 X 确认 Y'], ['basic', 'advanced', 'extreme']],
  ['硬约束带违反处置', ['违反时的处置'], ['basic', 'advanced', 'extreme']],
  ['不替用户承诺', ['不得替用户承诺'], ['basic', 'advanced', 'extreme']],
  ['普通档不新增需求', ['新增需求、功能、约束、技术选型、交付物一律禁止'], ['basic']],
  ['普通档长度上限', ['不超过原话的 1.4 倍'], ['basic']],
  ['高级档补充可回溯', ['回溯不到'], ['advanced']],
  ['极端档四块结构', ['要做什么 / 做完的标志', '硬约束 / 不许做什么'], ['extreme']],
  ['极端档预案', ['多情况预案'], ['extreme']],
  ['流程长度决策', ['流程长度'], ['advanced', 'extreme']],
  ['轻档禁止建 goal/todo', ['不要建 goal/todo'], ['advanced']],
  ['防过度流程', ['不得'], ['advanced']],
  ['完成判据与验证方式必备', ['完成判据与验证方式'], ['advanced', 'extreme']],
  // 历史纪律：回合模式
  ['[回合]反污染·不得沿用方案', ['不得沿用它的方案'], ['basic', 'advanced', 'extreme'], 'turns'],
  ['[回合]回复只有长度没有内容', ['只留长度、不留内容'], ['basic', 'advanced', 'extreme'], 'turns'],
  ['[回合]不得提历史/工作 AI', ['不得在输出里提"历史/上一轮/工作 AI"'], ['basic', 'advanced', 'extreme'], 'turns'],
  ['[回合]冲突以用户原话为准', ['以用户原话为准'], ['basic', 'advanced', 'extreme'], 'turns'],
  // 历史纪律：全文模式
  ['[全文]回复不是用户要求', ['不是用户的要求'], ['basic', 'advanced', 'extreme'], 'full'],
  ['[全文]不得替用户拍板', ['替用户拍板'], ['basic', 'advanced', 'extreme'], 'full'],
  ['[全文]只有原文算需求', ['只有 <原文> 里的内容才算需求'], ['basic', 'advanced', 'extreme'], 'full'],
  ['[全文]不得复述工作 AI 的话', ['不得复述、引用或评价'], ['basic', 'advanced', 'extreme'], 'full'],
]

let fail = 0
// 反向断言：某些档位必须"不出现"这些措辞（回退项的可复核证据）
const ABSENT = [
  ['普通档不索取 goal/todo/计划', ['建立 goal', 'goal：', 'todo', '阶段文档'], ['basic']],
  ['普通档不出现流程长度部件', ['流程长度'], ['basic']],
  // 复杂能力包只给高级/极端：普通档必须保持"只做语言层修复"的简洁（防简单任务被撑长）
  ['普通档不得出现复杂任务能力包', ['复杂任务：先定大局', '法线朝向', '不得降级清单'], ['basic']],
]
for (const [name, keys, tiers] of ABSENT) {
  for (const t of tiers) {
    for (const mode of [null, 'full']) {
      const sys = mode === 'full' ? snap.tiers[t].fullModeSystem : snap.tiers[t].system
      const found = keys.filter((k) => sys.indexOf(k) >= 0)
      const ok = found.length === 0
      if (!ok) fail += 1
      console.log((ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(26) + ' [' + t + (mode ? '/' + mode : '') + ']' + (ok ? '' : '  不该出现: ' + JSON.stringify(found)))
    }
  }
}
for (const [name, keys, tiers, mode] of INVARIANTS) {
  for (const t of tiers) {
    const sys = mode === 'full' ? snap.tiers[t].fullModeSystem : snap.tiers[t].system
    const missing = keys.filter((k) => sys.indexOf(k) < 0)
    const ok = missing.length === 0
    if (!ok) fail += 1
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(26) + ' [' + t + (mode ? '/' + mode : '') + ']' + (ok ? '' : '  缺失: ' + JSON.stringify(missing)))
  }
}
console.log('')
console.log(fail === 0 ? 'INVARIANTS OK — 旧约束全部保留（' + INVARIANTS.length + ' 项断言）' : 'INVARIANTS FAILED — ' + fail + ' 项缺失')
process.exit(fail === 0 ? 0 : 1)
