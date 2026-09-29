// 0.7.8 · bash 调用质量判定（1 链结构 + 2 重武器替代路径）回归
//
// 钉住三件事：
//   ① 链结构能判出来（吞错型连接符 + 段数≥3），这是"跑到半路死了而模型不自知"的机械判据；
//   ② 重武器命中的是**这一条命令的形态**，替代做法要能直接照做（不是放之四海皆准的劝告）；
//   ③ 既有行为不回退：快且有产出的调用一律不打扰。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitStages, chainFinding, heavyFindings, usageNote, costNote } from '../lib/bash/index.js'

test('链结构：按 && ; | 分段，引号里的分隔符不算', () => {
  const parts = splitStages('cd a && node x.js && node y.js')
  assert.equal(parts.filter((p) => p !== '&&').length, 3, '三段命令')
  assert.ok(splitStages('echo "a;b"; ls').some((p) => p.includes('"a;b"')), '引号里的 ; 不切')
})

test('吞错型连接符 + 段数≥3 才出声：&& 不算吞错', () => {
  assert.equal(chainFinding('cd a && node x.js && node y.js'), '', '全是 && ⇒ 失败会以非零退出暴露')
  assert.equal(chainFinding('ls; pwd'), '', '两段不出声')
  const f1 = chainFinding('cd x && node a.js; node b.js | tee log')
  assert.ok(f1, '三段 + 吞错连接符 ⇒ 出声')
  assert.ok(/吞掉失败/.test(f1), '要点明失败会被吞')
  assert.ok(/看不出来/.test(f1), '要点明"不自知"')
})

test('重武器：识别这一次的形态，并给出可照做的替代路', () => {
  const h = heavyFindings('node -e "const puppeteer=require(\'puppeteer-core\'); ..."')
  assert.ok(h.length === 1, '命中无头浏览器')
  assert.ok(/无头浏览器/.test(h[0]))
  assert.ok(/更便宜的路/.test(h[0]), '要直接给那条路')
  assert.ok(/JSON|toDataURL|尺寸/.test(h[0]), '替代做法要针对"取渲染结果"这个形态，不是空话')
  assert.ok(/落盘/.test(h[0]), '要说明结果落盘、别重跑')
  assert.ok(heavyFindings('npm i foo').length === 1, '装包也算')
  assert.equal(heavyFindings('ls -la').length, 0, '普通命令不打扰')
})

test('组合反馈：快且有产出不打扰，长/空/失败/超时都出声', () => {
  assert.equal(usageNote({ ms: 5000, command: 'ls', outLen: 900 }), '', '快且有产出 ⇒ 不打扰')
  const slow = usageNote({ ms: 185000, command: 'node a.js', outLen: 10 })
  assert.ok(/本次耗时 185s/.test(slow))
  const failed = usageNote({ ms: 900, command: 'cd x && node a.js; node b.js | tee l', outLen: 0, failed: true })
  assert.ok(/失败/.test(failed), '失败要写明')
  assert.ok(/吞掉失败/.test(failed), '失败时更要给出链判定（哪一段死了看不出来）')
  const to = usageNote({ ms: 600000, command: 'node -e "puppeteer"', outLen: 0, timedOut: true })
  assert.ok(/无头浏览器/.test(to), '超时 + 重武器 ⇒ 两件事一起给')
  assert.ok(/本次耗时 600s/.test(to))
})

test('既有行为不回退：吞输出仍触发，costNote 语义未变', () => {
  assert.ok(usageNote({ ms: 1000, command: 'node a.js >/dev/null', outLen: 5000 }), '吞输出仍出声')
  assert.equal(costNote(5000, 'ls', 120), '')
  assert.ok(costNote(185000, 'node a.js', 0), 'costNote 仍是"慢+少产出"判据')
})
