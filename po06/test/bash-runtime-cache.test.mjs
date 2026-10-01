import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { resolveBashRuntime, clearBashRuntimeCache } from '../lib/bash/runtime-provision.mjs'
const root=mkdtempSync(join(tmpdir(),'po06-runtime-cache-'))
const bash=join(root,'中文 bash');writeFileSync(bash,'fake')
let calls=0
const probe=async()=>{calls++;return{status:0,stdout:'GNU bash version 5'}}
const opts={env:{DSH_BASH_PATH:bash,PATH:''},platform:'linux',spawn:probe}
test('成功探测缓存，二进制内容/环境改变后重新探测，失败不缓存',async()=>{
  clearBashRuntimeCache();calls=0
  assert.equal((await resolveBashRuntime(opts)).cacheHit,false)
  assert.equal((await resolveBashRuntime(opts)).cacheHit,true)
  assert.equal(calls,1)
  writeFileSync(bash,'fake changed fingerprint')
  assert.equal((await resolveBashRuntime(opts)).cacheHit,false)
  assert.equal(calls,2)
  assert.equal((await resolveBashRuntime({...opts,env:{...opts.env,PATH:'changed'}})).cacheHit,false)
  clearBashRuntimeCache()
  let bad=0
  const failed={...opts,spawn:async()=>{bad++;return{status:1,stdout:''}}}
  assert.equal((await resolveBashRuntime(failed)).ok,false)
  const before=bad;await resolveBashRuntime(failed);assert.ok(bad>before)
})
test('预取消不启动探测，取消进行中的探测等待close且不回落其它候选',async()=>{
  clearBashRuntimeCache();const ctl=new AbortController();ctl.abort();let n=0
  await resolveBashRuntime({...opts,signal:ctl.signal,spawn:async()=>{n++;return{status:0,stdout:'bash'}}});assert.equal(n,0)
  const active=new AbortController();let killed=0,closed=false,entered
  const ready=new Promise(r=>{entered=r})
  const fake=()=>{n++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed++;queueMicrotask(()=>{closed=true;child.emit('close',1)})};entered();return child}
  const pending=resolveBashRuntime({...opts,signal:active.signal,spawn:fake})
  await ready;active.abort();const out=await pending
  assert.equal(out.cancelled,true);assert.equal(killed,1);assert.equal(closed,true);assert.equal(n,1)
})
test('取消后进程不报close时有界返回且不回落候选，不伪称收尾完成',async()=>{
  clearBashRuntimeCache();const ctl=new AbortController();let spawned=0,ready
  const entered=new Promise(resolve=>{ready=resolve})
  const pending=resolveBashRuntime({...opts,signal:ctl.signal,probeReapMs:20,spawn:()=>{
    spawned++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>false;ready();return child
  }})
  await entered;ctl.abort();const out=await pending
  assert.equal(spawned,1);assert.equal(out.cleanupUnconfirmed,true)
  assert.ok(out.repair[0].includes('未确认退出'))
})
test('清理运行时夹具',()=>{rmSync(root,{recursive:true,force:true})})
