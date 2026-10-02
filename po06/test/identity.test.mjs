import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(readFileSync(join(ROOT, '..', 'package.json'), 'utf8'))
const CLIENT = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const HOST = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const PATCH = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

// issue #20 / #21：包名从 `@dsh-external/dsh-po06` 改成 `@dsh-external/dsh-arbiter-wf` 时，
// **包内有三处身份标识漏改**，后果是 0.8.0-preview 装上去 app 直接起不来：
//   client-modules: loaded without registering "@dsh-external/dsh-arbiter-wf"
// 报告者实测：改掉这三处就恢复正常，并明确建议"补一条发版门"。
// ⚠ 门禁必须**从 package.json 动态取名字**：写死成新名字的话，下次再改名它照样放过（真发生过）。
test('包内三处身份标识必须与 package.json 的 name 一致（issue #20/#21）', () => {
  const name = PKG.name
  assert.ok(typeof name === 'string' && name, 'package.json 要有 name')
  // ① client：__ModuleLoader__.load 的注册 id（宿主按包名找它，错一个字符就 import failed）
  const loadId = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(CLIENT)
  assert.ok(loadId, 'client.js 里要能找到 __ModuleLoader__.load 的 id')
  assert.equal(loadId[1], name, 'client 注册 id 必须等于包名（否则 loaded without registering）')
  // ② host：模块导出的 name（entry 的 activate 判定读它）
  const hostName = /export const name = '([^']+)'/.exec(HOST)
  assert.ok(hostName, 'index.js 里要能找到 export const name')
  assert.equal(hostName[1], name, 'host 导出 name 必须等于包名')
  // ③ host：写入会话事件的 producer kind（ADR-0087 规定是 plugin:<包名>）
  const kind = /const PRODUCER_KIND = '([^']+)'/.exec(HOST)
  assert.ok(kind, 'index.js 里要能找到 PRODUCER_KIND')
  assert.equal(kind[1], 'plugin:' + name, 'PRODUCER_KIND 必须是 plugin:<包名>')
  // ④ 装配 patch 的 entry 名同样要与包名一致
  assert.ok(PATCH.includes("name: '" + name + "'"), 'cordis.patch.yml 的 entry name 也要等于包名')
})

test('DOM/CSS 命名空间与配置路径**不跟着改名**（它们不是身份标识，改了反而破坏兼容）', () => {
  assert.ok(CLIENT.includes("const NS = 'dsh-po06'"), 'DOM 命名空间保持 dsh-po06（报告者实测不影响装配）')
  assert.ok(CLIENT.includes("const API = '/po06/api'"), '控制 API 前缀保持 /po06/api（配置与脚本都依赖它）')
  assert.ok(HOST.includes("join(DSH_HOME, 'po06-wire.jsonl')"), '台账路径保持 po06-wire.jsonl')
})
