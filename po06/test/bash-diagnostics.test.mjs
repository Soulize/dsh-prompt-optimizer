import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { splitStages, chainFinding, heavyFindings, costNote, usageNote, beginInvocation, endInvocation } from '../lib/bash/bash-diagnostics.mjs'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'bash-diagnostics-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
function update(token, values) {
  const record = JSON.parse(readFileSync(token.path, 'utf8'))
  writeFileSync(token.path, JSON.stringify({ ...record, ...values }))
}
function deadPID() {
  const result = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 })
  assert.equal(result.status, 0)
  assert.ok(result.pid > 0)
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' })
  return result.pid
}

test('splitStages preserves signature and ordinary boundaries', () => {
  assert.deepEqual(splitStages(' a && b; c | d || e '), ['a', '&&', 'b', ';', 'c', '|', 'd', '||', 'e'])
  assert.deepEqual(splitStages('a\nb'), ['a', ';', 'b'])
  assert.deepEqual(splitStages(null), [])
})

test('quotes, escapes, continuations and comments do not invent stages', () => {
  assert.deepEqual(splitStages(String.raw`echo "a; b | c && d"; pwd`), ['echo "a; b | c && d"', ';', 'pwd'])
  assert.deepEqual(splitStages(String.raw`echo "escaped\";still quoted"; pwd`), [String.raw`echo "escaped\";still quoted"`, ';', 'pwd'])
  assert.deepEqual(splitStages(String.raw`echo a\;b\|c\&d; pwd`), [String.raw`echo a\;b\|c\&d`, ';', 'pwd'])
  assert.deepEqual(splitStages('echo a\\\nb && pwd'), ['echo ab', '&&', 'pwd'])
  assert.deepEqual(splitStages('echo a # ; | && ignored\npwd'), ['echo a', ';', 'pwd'])
  assert.deepEqual(splitStages('echo a#b; pwd'), ['echo a#b', ';', 'pwd'])
  assert.deepEqual(splitStages('echo a # ; | && ignored'), ['echo a'])
})

test('nested code, heredocs and incomplete syntax remain opaque', () => {
  assert.deepEqual(splitStages('echo $(a; b | c); pwd'), ['echo $(a; b | c)', ';', 'pwd'])
  assert.deepEqual(splitStages('echo `a; b | c`; pwd'), ['echo `a; b | c`', ';', 'pwd'])
  assert.deepEqual(splitStages('echo ${var:-a;b}; pwd'), ['echo ${var:-a;b}', ';', 'pwd'])
  for (const command of ['a; b; "unterminated', 'a; b; (unterminated', 'a; b; trailing\\', 'cat <<EOF\na;b|c\nEOF', 'case x in x) a;; esac']) {
    assert.deepEqual(splitStages(command), [command])
    assert.equal(chainFinding(command), '')
  }
})

test('chain findings express risk rather than absolute failure claims', () => {
  assert.equal(chainFinding('a && b && c'), '')
  assert.equal(chainFinding('a; b'), '')
  for (const command of ['a; b | c', 'set -e; a; b', 'set -o pipefail; a | b']) {
    const note = chainFinding(command)
    assert.match(note, /风险/)
    assert.match(note, /pipefail、set -e/)
    assert.doesNotMatch(note, /会\*\*吞掉失败|都看不出来|只有分开跑/)
  }
})

test('heavyFindings keeps array return and relevant alternatives', () => {
  assert.equal(heavyFindings('ls').length, 0)
  assert.match(heavyFindings('node -e "require(\'puppeteer\')"')[0], /无头浏览器.*JSON.*落盘/)
  assert.equal(heavyFindings('npm i foo').length, 1)
  assert.equal(heavyFindings('curl https://example.test && vite build').length, 2)
})

test('every quick success stays quiet including empty output and redirection', () => {
  for (const command of ['ls', 'mkdir output', 'test -f file', 'npm i', 'a; b | c', 'node script >/dev/null', 'node script 2>/dev/null']) {
    for (const outLen of [0, 5, 900]) assert.equal(usageNote({ ms: 500, command, outLen }), '')
  }
  assert.equal(usageNote({ ms: 180000, command: 'build', outLen: 400 }), '')
  assert.equal(costNote(59999, 'build', 0), '')
  assert.equal(costNote(60000, 'build', 400), '')
})

test('slow sparse output is observable, not called a failed or worthless run', () => {
  const note = usageNote({ ms: 60000, command: 'build', outLen: 3, stdoutBytes: 0, stderrBytes: 900 })
  assert.match(note, /本次耗时 60s，返回3字符，累计stdout\+stderr 900字节/)
  assert.match(note, /不代表失败或纯损失/)
  assert.doesNotMatch(note, /且.*失败|最贵的失败|白等|浪费/)
  assert.match(costNote(185000, 'build', 0), /返回0字符/)
  assert.doesNotMatch(costNote(185000, 'build', 0), /返回0字节/)
})

test('failure and timeout report actual outcome even for quick or verbose calls', () => {
  assert.match(usageNote({ ms: 10, outLen: 900, failed: true }), /，失败/)
  assert.match(usageNote({ ms: 10, outLen: 900, timedOut: true }), /，超时/)
  assert.match(usageNote({ ms: 10, outLen: 0, failed: true, cancelled: true }), /，已取消/)
  assert.doesNotMatch(usageNote({ ms: 10, outLen: 0, failed: true, cancelled: true }), /，失败/)
})

test('stdout redirection needs unquoted evidence and excludes stderr descriptors', () => {
  const note = command => usageNote({ ms: 60000, outLen: 0, command })
  for (const command of ['echo >/dev/null', 'echo 1>/dev/null', 'echo >>/dev/null', 'echo &>/dev/null', 'echo x>/dev/null']) {
    assert.match(note(command), /检测到 stdout 重定向/, command)
  }
  for (const command of ['echo 2>/dev/null', 'echo 2>>/dev/null', 'echo 21>/dev/null', 'echo ">/dev/null"', "echo '>/dev/null'", String.raw`echo \>/dev/null`, 'echo # >/dev/null', 'echo >"file" /dev/null', 'echo > /dev/nullsuffix', 'echo $(printf ">/dev/null")']) {
    assert.doesNotMatch(note(command), /检测到 stdout 重定向/, command)
  }
})

test('one UUID record per call preserves concurrent active invocations', t => {
  const home = fixture(t)
  const a = beginInvocation({ home, sessionId: 's', command: 'first' })
  update(a, { startedAt: 0 })
  const b = beginInvocation({ home, sessionId: 's', command: 'second' })
  assert.notEqual(a.id, b.id)
  assert.equal(b.note, '')
  assert.deepEqual(b.previous, [])
  assert.equal(readdirSync(join(home, 'po06-bash-invocations')).length, 2)
  assert.equal(endInvocation(a), true)
  assert.equal(existsSync(b.path), true)
  assert.equal(endInvocation(a), false)
  assert.equal(endInvocation(b), true)
})

test('only same-session confirmed-dead unfinished owners are reported once', t => {
  const home = fixture(t), pid = deadPID()
  const same = beginInvocation({ home, sessionId: 's', command: 'lost' })
  const other = beginInvocation({ home, sessionId: 'other', command: 'other lost' })
  const malformed = beginInvocation({ home, sessionId: 's', command: 'broken' })
  update(same, { ownerPID: pid, startedAt: Date.now() })
  update(other, { ownerPID: pid, startedAt: 0 })
  writeFileSync(malformed.path, '{bad json')
  const token = beginInvocation({ home, sessionId: 's', command: 'next' })
  assert.equal(token.previous.length, 1)
  assert.equal(token.previous[0].command, 'lost')
  assert.match(token.note, /ownerPID已确认不存在/)
  assert.match(token.note, /不证明命令失败/)
  assert.equal(existsSync(other.path), true)
  assert.equal(existsSync(malformed.path), true)
  endInvocation(token)
  const next = beginInvocation({ home, sessionId: 's', command: 'again' })
  assert.equal(next.note, '')
  endInvocation(next)
})

test('permission-denied owner probes do not prove death', t => {
  const home = fixture(t), marker = beginInvocation({ home, sessionId: 's', command: 'unknown' })
  update(marker, { ownerPID: 123456, startedAt: 0 })
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
  const token = beginInvocation({ home, sessionId: 's', command: 'next' })
  assert.equal(token.note, '')
  assert.equal(existsSync(marker.path), true)
  endInvocation(token)
})

test('real live child owner remains active regardless of age', async t => {
  const home = fixture(t)
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  await once(child, 'spawn')
  t.after(async () => { const exited = once(child, 'exit'); child.kill(); await exited })
  const marker = beginInvocation({ home, sessionId: 's', command: 'child owned' })
  update(marker, { ownerPID: child.pid, startedAt: 0 })
  const token = beginInvocation({ home, sessionId: 's', command: 'next' })
  assert.equal(token.note, '')
  assert.equal(existsSync(marker.path), true)
  endInvocation(token)
})

test('normal completion, failure, cancellation and closure finally remove only their record', t => {
  const home = fixture(t)
  for (const outcome of ['success', 'failure', 'cancelled', 'closed']) {
    const token = beginInvocation({ home, sessionId: 's', command: outcome })
    const path = token.path
    try { if (outcome !== 'success') throw new Error(outcome) }
    catch { /* Representative integration finally contract. */ }
    finally { endInvocation(token) }
    assert.equal(existsSync(path), false)
  }
  assert.equal(beginInvocation({ home, sessionId: 's', command: 'next' }).note, '')
})

test('missing session, malformed tokens and storage errors fail closed', t => {
  const home = fixture(t)
  const missing = beginInvocation({ home, command: 'x' })
  assert.equal(missing.path, null)
  assert.equal(missing.note, '')
  assert.match(missing.storageError, /sessionId/)
  assert.equal(endInvocation(null), false)
  const file = join(home, 'not-directory')
  writeFileSync(file, 'x')
  const unwritable = beginInvocation({ home: file, sessionId: 's', command: 'x' })
  assert.equal(unwritable.path, null)
  assert.equal(unwritable.note, '')
  assert.ok(unwritable.storageError)
})
