import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAdvisorMaterials, validateMaterialInput, MATERIAL_TEXT_CHARS } from '../lib/advisor-materials.js'
import { createAdvisor, ADVISOR_PARAMETERS } from '../lib/advisor.js'

const root = mkdtempSync(join(tmpdir(), 'po06-materials-'))
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64')
writeFileSync(join(root, 'out.html'), '<html>REAL ARTIFACT</html>')
writeFileSync(join(root, 'shot.png'), image)
writeFileSync(join(root, 'long.txt'), 'x'.repeat(MATERIAL_TEXT_CHARS + 100))
const desc = (path, purpose = '核对成果') => ({ path, purpose })
const prepare = args => prepareAdvisorMaterials({ root, enabled: true, args })
const events = [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '验收当前成果' }] } }]
const exec = { callId: 'c1', agent: { session: { id: 's1', snapshotEvents: () => events } } }
const report = ref => ({ verdict: 'pass', summary: '有证据', findings: [], checks: [{ criterion: '成果', status: 'satisfied', evidenceRefs: [ref] }], nextStep: '交付', stopCondition: '出现反例重审' })

test('文件内容真实附入，用途保留，截断明确，旧artifacts兼容', async () => {
  const out = await prepare({ artifacts: ['out.html'], files: [desc('long.txt')] })
  assert.ok(out.evidence[0].text.includes('REAL ARTIFACT'))
  assert.equal(out.materials[0].status, 'ready')
  assert.equal(out.materials[1].status, 'truncated')
  assert.equal(out.materials[1].sentChars, MATERIAL_TEXT_CHARS)
  assert.equal(out.materials[1].purpose, '核对成果')
  assert.equal(out.limited, true)
  assert.ok(out.resultIds.has('F0'))
})

test('越界/绝对/不存在/关闭读取/二进制材料明确不可用，不能生成验收证据', async () => {
  for (const path of ['../outside.txt', 'C:/outside.txt', 'missing.txt', 'shot.png']) {
    const out = await prepare({ files: [desc(path)] })
    assert.equal(out.materials[0].sent, false)
    assert.equal(out.resultIds.size, 0)
  }
  const off = await prepareAdvisorMaterials({ root, enabled: false, args: { files: [desc('out.html')] } })
  assert.equal(off.materials[0].reason, 'read-tools-disabled-or-no-cwd')
})

test('图片能力未知/不支持时不保存图片、不传块，卡片状态未检查', async () => {
  let calls = 0
  for (const imageSupport of [null, false]) {
    const out = await prepareAdvisorMaterials({ root, enabled: true, imageSupport,
      attachments: { saveImage: async () => { calls++ } }, args: { images: [desc('shot.png', '默认曝光')] } })
    assert.equal(out.materials[0].status, 'not-inspected')
    assert.equal(out.images.length, 0)
    assert.equal(out.resultIds.size, 0)
  }
  assert.equal(calls, 0)
})

test('支持图像时通过正规saveImage引用传递，图片字节不泄漏到工具结果', async () => {
  let saved, opts
  const ref = { attachmentId: 'fake-id', mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }
  const runtime = { ok: true, cwd: root, readTools: true, imageSupport: true, cfg: { provider: 'p', model: 'vision' },
    attachments: { saveImage: async input => { saved = input; return ref } } }
  const invoke = createAdvisor({ resolveRuntime: async () => runtime, runLoop: async o => {
    opts = o
    return { text: JSON.stringify(report('I0')), trace: [], toolCalls: 0 }
  } })
  const out = await invoke({ mode: 'review_result', question: '看默认画面', images: [desc('shot.png', '默认曝光')] }, exec)
  assert.equal(out.ok, true)
  assert.deepEqual(saved.data, image)
  assert.equal(saved.mediaType, 'image/png')
  assert.equal(opts.messages[0].content.find(x => x.type === 'image').attachment, ref)
  assert.ok(opts.messages[0].content.some(x => x.type === 'text' && x.text.includes('默认曝光')))
  assert.equal(out.materials[0].sent, true)
  assert.ok(!JSON.stringify(out).includes(image.toString('base64')))
})

test('关闭只读工具不会偷偷读取图片；缺失图片导致整体通过降级', async () => {
  let opts
  const ref = { attachmentId: 'fake', mediaType: 'image/png', bytes: image.length, width: 1, height: 1 }
  // readTools false must not secretly read explicitly listed images.
  const off = createAdvisor({ resolveRuntime: async () => ({ ok: true, cwd: root, readTools: false, cfg: { provider: 'p', model: 'm' }, llm: { stream: o => {
    opts = o
    return (async function* () { yield { type: 'text-delta', text: JSON.stringify({ ...report('none'), verdict: 'unverified', checks: [] }) } })()
  } } }) })
  const out = await off({ mode: 'review_result', question: '看图', images: [desc('shot.png')] }, exec)
  assert.equal(out.ok, true)
  assert.equal(opts.messages[0].content.filter(x => x.type === 'image').length, 0)
  assert.equal(out.materials[0].sent, false)
  const invoke = createAdvisor({ resolveRuntime: async () => ({ ok: true, cwd: root, readTools: true, imageSupport: false, cfg: {provider:'p',model:'m'} }),
    runLoop: async () => ({ text: JSON.stringify(report('F0')), trace: [] }) })
  const limited = await invoke({ mode: 'review_result', question: '审完整成果', files:[desc('out.html')],images:[desc('shot.png')] }, exec)
  assert.equal(limited.report.verdict, 'unverified')
})

test('schema有文件/图片用途，执行端限制数量，无不兼容maxItems', () => {
  assert.ok(ADVISOR_PARAMETERS.properties.files.items.properties.purpose)
  assert.ok(ADVISOR_PARAMETERS.properties.images.items.properties.purpose)
  assert.equal(ADVISOR_PARAMETERS.properties.images.maxItems, undefined)
  assert.equal(validateMaterialInput({ artifacts:['a','b','c','d'],files:[desc('x')] }), 'invalid-artifacts')
  assert.equal(validateMaterialInput({ images:[desc('a'),desc('b'),desc('c'),desc('d'),desc('e')] }), 'invalid-images')
  assert.equal(validateMaterialInput({ images:[{path:'a'}] }), 'invalid-images')
  assert.equal(validateMaterialInput({}), null)
})

test('模型报错或空产出时仍保留每份材料状态', async () => {
  for (const failed of [false, true]) {
    const invoke = createAdvisor({ resolveRuntime: async () => ({ ok:true,cwd:root,readTools:true,cfg:{provider:'p',model:'m'} }),
      runLoop: async () => { if (failed) throw new Error('provider-failed'); return {text:'',trace:[]} } })
    const out = await invoke({mode:'review_result',question:'审代码',files:[desc('out.html')]},exec)
    assert.equal(out.ok,false)
    assert.equal(out.materials.length,1)
    assert.equal(out.materials[0].status,'ready')
    assert.ok(out.materials[0].excerpt.includes('REAL ARTIFACT'))
  }
})

test('附件服务拒绝假图时只显示不可用，不发送任何图片', async () => {
  const out = await prepareAdvisorMaterials({root,enabled:true,imageSupport:true,args:{images:[desc('shot.png')]},
    attachments:{saveImage:async()=>{throw new Error('IMAGE_INVALID')}}})
  assert.equal(out.images.length,0)
  assert.equal(out.materials[0].sent,false)
  assert.equal(out.materials[0].reason,'IMAGE_INVALID')
})

test('文件被附入的快照与当前预览路径分开，材料有内容指纹', async () => {
  const out = await prepare({ files:[desc('out.html')] })
  assert.equal(out.materials[0].sha256.length, 64)
  assert.equal(out.materials[0].previewAvailable, true)
  assert.ok(out.materials[0].excerpt.includes('REAL ARTIFACT'))
  rmSync(root, { recursive: true, force: true })
})
