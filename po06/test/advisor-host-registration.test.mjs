import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('actual plugin apply registers both adviser tools and disposes them without extra host services',async()=>{
 const home=mkdtempSync(join(tmpdir(),'arbiter-host-')),old=process.env.DSH_HOME
 process.env.DSH_HOME=home
 writeFileSync(join(home,'po06.json'),JSON.stringify({settingsVersion:1,enabled:true,rollout:{mode:'all'},bash:false}))
 const effects=[],defs=new Map(),live=new Set()
 const effect=fn=>{const d=fn();if(typeof d==='function')effects.push(d);return d}
 const tools={schemas:()=>[...defs.values()],register:def=>{defs.set(def.name,def);live.add(def.name);return ()=>live.delete(def.name)}}
 const ctx={effect,inject:(names,cb)=>{if(names.every(n=>n==='tools'||n==='llm'))return effect(()=>cb({tools,llm:{},effect}));return ()=>{}},get:name=>name==='tools'?tools:null}
 try{
  const mod=await import('../lib/index.js?stage-registration')
  mod.apply(ctx,{})
  assert.ok(defs.has('consult_task'));assert.ok(defs.has('advisor_stage'))
  assert.ok(typeof mod.adapter.reviewFeedback==='function')
  assert.ok(defs.get('advisor_stage').parameters.properties.subjectPaths)
  assert.ok(defs.get('consult_task').parameters.properties.taskId)
  assert.equal(defs.get('advisor_stage').presentCall({action:'status'}).card,'generic')
  assert.equal(defs.get('advisor_stage').presentCall({action:'status'}).kind,'other')
  for(const dispose of effects.reverse())dispose()
  assert.ok(!live.has('advisor_stage'));assert.ok(!live.has('consult_task'))
  assert.equal(mod.adapter.reviewFeedback,null)
 }finally{process.env.DSH_HOME=old;rmSync(home,{recursive:true,force:true})}
})
