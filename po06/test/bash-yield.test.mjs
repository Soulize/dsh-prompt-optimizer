/**
 * 回归：内置 Bash 的让位判据。
 * 非 Windows 宿主已有官方 Bash，po06 必须让位；Windows 才按用户开关补位。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldProvideBuiltInBash } from '../lib/index.js'

const SRC = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

test('让位判据以平台与用户开关共同决定', () => {
  assert.equal(shouldProvideBuiltInBash({ platform: 'linux', enabled: true }), false)
  assert.equal(shouldProvideBuiltInBash({ platform: 'darwin', enabled: true }), false)
  assert.equal(shouldProvideBuiltInBash({ platform: 'win32', enabled: true }), true)
  assert.equal(shouldProvideBuiltInBash({ platform: 'win32', enabled: false }), false)
})

test('先读用户设置，再算平台所有权，最后才做注册现值判断', () => {
  const iConfigured = SRC.indexOf('let configured = true')
  const iRead = SRC.indexOf('configured = readPolicy', iConfigured)
  const iWant = SRC.indexOf('const want = shouldProvideBuiltInBash', iRead)
  const iCheck = SRC.indexOf('const present = toolPresentInTable', iWant)
  assert.ok(iConfigured > 0 && iRead > iConfigured, '必须先读取用户设置')
  assert.ok(iWant > iRead, '读取设置后才计算是否由 po06 提供 Bash')
  assert.ok(iCheck > iWant, '所有权判据必须在注册现值检测之前生效')
})

test('让位后仍会走到注销分支（关闭自己那份，而不是留着）', () => {
  assert.match(SRC, /if \(!want\) \{/, '注销分支必须保留')
  assert.match(SRC, /bashToolDispose/, '注销要靠收集到的内层 disposer')
})
