import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { acceptanceBanner, registerAdvisorTool } from '../lib/advisor.js'

// Match client-file's minimal React/slot setup, but execute the actual client in a VM.
function loadConsumer() {
  let registration
  const window = { __ModuleLoader__: { load: (entry) => { registration = entry } } }
  const React = {
    createElement: () => null, Fragment: 'Fragment',
    useState: (value) => [value, () => {}], useEffect: () => {},
    useCallback: (fn) => fn, useMemo: (fn) => fn(),
  }
  const require = (name) => name === 'react' ? React : {}
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window })
  assert.equal(registration.id, '@dsh-external/dsh-arbiter-wf')
  const client = registration.factory(require)
  const slots = []
  const dispose = client.apply({ slots: {
    register: (definition) => { slots.push(definition); return () => {} },
    inject: (_slot, callback) => callback(),
  } })
  assert.ok(slots.length > 0)
  assert.equal(typeof client.__debug.advisorValueOf, 'function')
  return { parse: client.__debug.advisorValueOf, dispose }
}

let producer
registerAdvisorTool({ tools: { register: (definition) => { producer = definition; return () => {} } } }, async () => {})
const { parse, dispose } = loadConsumer()
test.after(dispose)
const plain = (value) => JSON.parse(JSON.stringify(value))
const block = (text) => ({ content: [{ type: 'text', text }] })
const report = (status) => ({
  verdict: status === 'satisfied' ? 'pass' : 'gaps', summary: 'bounded review',
  checks: [{ criterion: 'behavior {with braces}', status, evidenceRefs: ['F0'] }],
  findings: [], nextStep: 'Inspect {runtime}', stopCondition: 'Stop after evidence',
})
const cases = [
  ['gaps', { mode: 'review_result', ok: true, invocationSucceeded: true, reviewPassed: false,
    report: report('unverified'), openIssues: [{ criterion: 'behavior {with braces}', status: 'unverified' }],
    evidenceGaps: [{ path: 'runtime.log', status: 'unavailable' }] }],
  ['pass', { mode: 'review_result', ok: true, invocationSucceeded: true, reviewPassed: true,
    report: report('satisfied'), openIssues: [], evidenceGaps: [] }],
  ['call failure', { mode: 'review_result', ok: false, invocationSucceeded: false, reviewPassed: false,
    reason: 'provider {not ready}', openIssues: [], evidenceGaps: [] }],
]

for (const [name, value] of cases) {
  test('actual producer-consumer JSON roundtrip: ' + name, () => {
    const content = producer.output.render({ mode: value.mode }, value)
    assert.equal(content.length, 1)
    assert.equal(content[0].type, 'text')
    const expected = { acceptanceBanner: acceptanceBanner(value), ...value }
    assert.deepEqual(JSON.parse(content[0].text), expected)
    assert.deepEqual(plain(parse({ content })), expected)
    assert.equal(expected.acceptanceBanner.length > 0, name !== 'pass')
    assert.equal(Object.hasOwn(value, 'acceptanceBanner'), false, 'render must not mutate its value')
  })
  test('old pure JSON remains readable: ' + name, () => {
    assert.deepEqual(plain(parse(block(JSON.stringify(value, null, 2)))), value)
  })
  test('legacy actual banner plus JSON remains readable: ' + name, () => {
    assert.deepEqual(plain(parse(block(acceptanceBanner(value) + JSON.stringify(value, null, 2)))), value)
  })
}

test('legacy suffix ignores inline banner braces and supports CRLF, indentation and separate text blocks', () => {
  const value = cases[0][1]
  const banner = 'Advisory {not JSON} and literal {"ok":false} braces\r\nNext: inspect {runtime}\r\n'
  assert.deepEqual(plain(parse(block(banner + '\t  ' + JSON.stringify(value) + '\r\n'))), value)
  assert.deepEqual(plain(parse({ content: [
    { type: 'text', text: banner.trim() }, { type: 'image', data: 'ignored' },
    { type: 'text', text: JSON.stringify(value, null, 2) },
  ] })), value)
})

test('malformed or non-object results are rejected without arbitrary JSON extraction', () => {
  for (const text of [
    '', 'banner only {braces}', 'null', 'true', '42', '"text"', '[]', '[{}]',
    'banner {"ok":true}',
    'banner\n{"ok":true} trailing text',
    'banner\n{"ok":true}\n{"ok":false}',
    'banner\n{"ok":true',
    'banner\n{broken\n{"ok":true}',
    '{broken\n{"ok":true}',
    'banner\n{"report":\n{"ok":true}',
    '[broken\n{"ok":true}',
  ]) assert.equal(parse(block(text)), null, text)
  assert.equal(parse(undefined), null)
  assert.equal(parse({ content: [{ type: 'image' }] }), null)
})

