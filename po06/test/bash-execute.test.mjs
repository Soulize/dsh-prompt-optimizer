import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/bash/index.js'
import * as ws from '../lib/bash/workspace-semantics.mjs'
const root=mkdtempSync(join(tmpdir(),'po06-bash-execute-'))
process.env.DSH_HOME=root
const session={id:'test-session',header:{cwd:root}}
let definition
const ctx={effect:f=>f(),tools:{register:d=>{definition=d;return()=>{}}}}
function setup(gov,provision={}){
  apply(ctx,{bashPath:'fake-bash'},{modules:[gov,{createJobPort:o=>o},ws,provision]})
  return definition.execute
}
const outcome=()=>({ok:true,reason:'exit',outcome:{exitCode:0,signal:null},streams:{stdout:{text:'OK'},stderr:{text:''}}})
test('工具描述：按命令性质选 shell、优先 bash，且不再有未实测的 pwsh 偏好',()=>{
  const run=setup({runGoverned:async()=>outcome()})
  const d=definition.description
  // 2026-10-01：原先描述里写着“跑 Windows 原生程序时 pwsh 通常更快更稳”——
  // 那是一条没有实测支撑的断言，结果把模型推离 bash（本会话 pwsh 136 : bash 2）。
  assert.ok(!/pwsh 通常更快更稳/.test(d),'不许再出现未实测的 pwsh 更快断言')
  assert.ok(/按命令性质选/.test(d),'判据要落在命令性质上')
  assert.ok(/POSIX 管线/.test(d),'说明 bash 适用面')
  assert.ok(/优先 bash/.test(d),'把用户口径的经验写进来')
  assert.ok(/不要为同一条命令来回换 shell/.test(d),'避免为同一条命令反复换 shell')
  assert.ok(typeof run==='function')
})

test('并发调用输出路径不同，失败证据保留且状态标记末尾可解析',async()=>{
  const files=[]
  const run=setup({runGoverned:async(req,port)=>{files.push(port.makePaths(1));const g=outcome();g.outcome.exitCode=1;g.streams.stdout.text='failed assertion: expected 1 got 2';g.streams.stderr.text='error detail';return g}})
  const outputs=await Promise.all([run({command:'node test.js'},{agent:{session}}),run({command:'node test.js'},{agent:{session}})])
  assert.notEqual(files[0].stdout,files[1].stdout)
  assert.notEqual(files[0].stderr,files[1].stderr)
  for(const text of outputs){assert.ok(text.includes('failed assertion'));assert.ok(text.includes('error detail'));assert.ok(/\n\[exit code: 1\]$/.test(text))}
})
test('调用取消信号真正到达governor；预取消不执行',async()=>{
  let calls=0,gotSignal
  const run=setup({runGoverned:async(req)=>{calls++;gotSignal=req.signal;return outcome()}})
  const ctl=new AbortController()
  await run({command:'echo test'}, {signal:ctl.signal,agent:{session}})
  ctl.abort();assert.equal(gotSignal.aborted,true)
  const before=calls
  await run({command:'echo forbidden'}, {signal:ctl.signal,agent:{session}})
  assert.equal(calls,before)
})
test('stderr仅截断不把成功当失败且完整路径保留',async()=>{
  const run=setup({runGoverned:async()=>{const g=outcome();g.streams.stderr={text:'warnings',truncated:true,spillPath:join(root,'err.log')};return g}})
  const out=await run({command:'echo test'},{agent:{session}})
  assert.ok(out.includes('err.log'))
  assert.ok(!out.includes('【发生了什么】'))
  assert.ok(/\n\[exit code: 0\]$/.test(out))
})
test('清理夹具目录',()=>{rmSync(root,{recursive:true,force:true})})
