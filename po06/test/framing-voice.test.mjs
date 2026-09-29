// 0.7.8 · 硬邦邦模式 = **整份包的写法**（不只是加一段口号）回归
//
// 用户反馈：只加一个块、其余条目仍是正式体，语域被稀释 ⇒ 这一档改成改"写法"。
// 这个文件钉住"改写法但不改内容"那条线，以及两类必须保持严肃的例外。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HARD_NOTE_SYSTEM } from '../lib/interpreter.js'

test('要求整份包都用硬邦邦写，并允许口水话（语域是效果来源）', () => {
  assert.ok(/整份辅助上下文都用这个口气写/.test(HARD_NOTE_SYSTEM))
  assert.ok(/口水话/.test(HARD_NOTE_SYSTEM), '要明确允许口水话')
  assert.ok(/贼拉牛逼|硬邦邦/.test(HARD_NOTE_SYSTEM), '要给出口语样例，否则模型会写回正式体')
  assert.ok(/接地气/.test(HARD_NOTE_SYSTEM))
})

test('两类例外必须保持严肃：未决项 + 防御性限制', () => {
  assert.ok(/未决项[\s\S]{0,80}说清楚说准/.test(HARD_NOTE_SYSTEM), '未决项要清楚')
  assert.ok(/防御性限制/.test(HARD_NOTE_SYSTEM), '防御性限制要单列')
  assert.ok(/照字面写/.test(HARD_NOTE_SYSTEM), '限制类不许修辞')
  assert.ok(/不许替我拍板|不许读其它文件/.test(HARD_NOTE_SYSTEM), '要给出这类要求的例子')
})

test('改写法但不许改内容（这条是安全底线）', () => {
  assert.ok(/条目集合一个字都不许增减/.test(HARD_NOTE_SYSTEM))
  assert.ok(/逐字依据/.test(HARD_NOTE_SYSTEM))
  assert.ok(/不许新增原话里没有的需求/.test(HARD_NOTE_SYSTEM))
})

test('加码字段与长度口径仍在', () => {
  assert.ok(/hardNote/.test(HARD_NOTE_SYSTEM))
  assert.ok(/hardOn/.test(HARD_NOTE_SYSTEM))
  assert.ok(/长度自己定/.test(HARD_NOTE_SYSTEM))
  assert.ok(/定点爆破/.test(HARD_NOTE_SYSTEM))
})
