/**
 * 回归：内置 Bash 的**让位判据**（2026-09-26）。
 *
 * 事故（用户反馈）：Linux/macOS 用户的系统本就有 bash，宿主的 @deepseek-ai/dsh-tool-bash
 * 在该平台是启用的（官方只在 win32 将它 disabled）。但 po06 无差别注册了同名工具 bash，
 * 把宿主那份顶掉；宿主只在装配时注册一次、被顶后不重试 ⇒ 用户一关内置 bash，
 * 表里就彻底没有 bash（他以为能退回"原来那个更好的 bash"）。
 *
 * 判据：platform !== 'win32' ⇒ 宿主提供 bash ⇒ po06 必须让位（不注册）。
 * 为什么用平台而不是查工具表：表里只看到名字，分不清是谁注册的；
 * po06 自己刚注册完再查会把自己认成宿主，判据失明。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

test('让位判据存在且以平台为准', () => {
  assert.match(SRC, /const hostProvidesBash = process\.platform !== 'win32'/, '必须有平台判据')
  assert.match(SRC, /if \(hostProvidesBash\) want = false/, '非 win32 必须把 want 置为 false（不注册）')
})

test('让位发生在读取设置之后、注册决策之前', () => {
  const iWant = SRC.indexOf('let want = true')
  const iHost = SRC.indexOf('const hostProvidesBash')
  const iCheck = SRC.indexOf('const present = toolPresentInTable')
  assert.ok(iWant > 0 && iHost > iWant, '平台判据必须在读取 want 之后')
  assert.ok(iCheck > iHost, '让位必须在注册决策（现值检测）之前生效')
})

test('让位后仍会走到注销分支（关闭自己那份，而不是留着）', () => {
  // want=false 时 syncBashTool 走 `if (!want) {...}` 分支去注销 —— 这条链路必须还在
  assert.match(SRC, /if \(!want\) \{/, '注销分支必须保留')
  assert.match(SRC, /bashToolDispose/, '注销要靠收集到的内层 disposer')
})
