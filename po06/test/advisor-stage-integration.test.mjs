import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAdvisorStages} from '../lib/advisor-stages.js'
import {registerAdvisorStageTool} from '../lib/advisor-stage-tool.js'
import {createAdvisor} from '../lib/advisor.js'
import {reviewOutcome} from '../lib/advisor-outcome.js'
import {toolRead,runReadOnlyToolLoop} from '../lib/read-tools.js'

const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'advisor-stage-integration-'))
 writeFileSync(join(root,'app.js'),'return true')
 const stages=createAdvisorStages({home:root})
 const session={id:'s',header:{cwd:root},snapshotEvents:()=>[{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'make an interactive result'}]}}]}
 const exec={agent:{id:'a',session}};let def
 registerAdvisorStageTool({tools:{register:d=>{def=d;return ()=>{}}}},stages,{resolveAccess:async()=>({ok:true,readTools:true})})
 return {root,stages,session,exec,tool:args=>def.execute(args,exec),cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
test('stage tool binds original request and refuses advance until actual advisor IDs all satisfy',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'interaction task'})
  const defined=await x.tool({action:'define_stage',taskId:task.taskId,scope:'code',focus:'state transition',criteria:['event updates state','invalid event rejected']})
  const ref={taskId:task.taskId,stageId:defined.stage.id}
  assert.equal((await x.tool({action:'advance',...ref})).ok,false)
  let status='failed',payload
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async opts=>{
   payload=JSON.parse(opts.messages[0].content[0].text)
   return {text:JSON.stringify({verdict:status==='satisfied'?'pass':'gaps',summary:'result',findings:[],checks:payload.stageContract.checks.map(c=>({checkId:c.checkId,criterion:'reworded but same id',status,evidenceRefs:['F0']})),nextStep:'repair state transition',stopCondition:'stop after evidenced pass'}),trace:[]}
  }})
  const args={mode:'review_result',...ref,scope:'performance',focus:'ignored attempt to widen scope',question:'verify transition',files:[{path:'app.js',purpose:'state source'}]}
  const failed=await invoke(args,x.exec)
  assert.equal(failed.reviewScope,'code');assert.equal(payload.stageContract.sourceText,'make an interactive result')
  assert.equal(failed.reviewPassed,false);assert.equal(failed.nextActions[0].action,'repair')
  assert.equal((await x.tool({action:'advance',...ref})).ok,false)
  status='satisfied'
  const passed=await invoke(args,x.exec)
  assert.equal(passed.reviewPassed,true);assert.equal(passed.completionClaimAllowed,false)
  assert.equal((await x.tool({action:'advance',...ref})).ok,true)
 }finally{x.cleanup()}
})
test('unmatched review IDs cannot overwrite declared checkpoints',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'document task'})
  const d=await x.tool({action:'define_stage',scope:'custom',focus:'document facts',criteria:['facts supported']})
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async()=>({text:JSON.stringify({verdict:'pass',summary:'result',findings:[],checks:[{checkId:'made-up',criterion:'facts',status:'satisfied',evidenceRefs:['F0']}],nextStep:'next',stopCondition:'stop'}),trace:[]})})
  const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:d.stage.id,question:'verify',files:[{path:'app.js',purpose:'source'}]},x.exec)
  assert.equal(out.reviewPassed,false);assert.equal(out.stageRecording.reason,'stage-check-id-mismatch')
  assert.equal(out.report.verdict,'unverified')
  assert.equal((await x.tool({action:'advance',taskId:task.taskId,stageId:d.stage.id})).ok,false)
 }finally{x.cleanup()}
})
test('stage commands enforce access gate without any model call; excluded scope material is not a gap',async()=>{
 const x=fixture();try{
  let def
  registerAdvisorStageTool({tools:{register:d=>{def=d}}},x.stages,{resolveAccess:async()=>({ok:false,reason:'assist-off'})})
  assert.equal((await def.execute({action:'start_task',title:'blocked'},x.exec)).reason,'assist-off')
  const outcome=reviewOutcome({ok:true,report:{verdict:'pass',checks:[{status:'satisfied'}]},materials:[{status:'excluded',path:'unrelated.js'},{status:'ready',path:'runtime.png'}]})
  assert.equal(outcome.evidenceGaps.length,0);assert.equal(outcome.reviewPassed,true)
 }finally{x.cleanup()}
})

test('artifact changed during model review is not accepted as the latest version',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'version check'})
  const stage=await x.tool({action:'define_stage',scope:'code',focus:'artifact behavior',criteria:['behavior correct'],subjectPaths:['app.js']})
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async opts=>{
   const payload=JSON.parse(opts.messages[0].content[0].text)
   writeFileSync(join(x.root,'app.js'),'changed while waiting')
   return {text:JSON.stringify({verdict:'pass',summary:'checked old source',findings:[],checks:payload.stageContract.checks.map(c=>({checkId:c.checkId,criterion:c.criterion,status:'satisfied',evidenceRefs:['F0']})),nextStep:'next',stopCondition:'stop'}),trace:[]}
  }})
  const ref={taskId:task.taskId,stageId:stage.stage.id}
  const out=await invoke({mode:'review_result',...ref,question:'check source',files:[{path:'app.js',purpose:'source'}]},x.exec)
  assert.equal(out.reviewPassed,false);assert.equal(out.report.verdict,'unverified')
  assert.equal((await x.tool({action:'advance',...ref})).ok,false)
  assert.ok(out.stageState.stage.checks.every(c=>c.status==='stale'))
 }finally{x.cleanup()}
})
test('review exceptions revoke prior pass without poisoning unrelated legacy ledger',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'failure check'})
  const stage=await x.tool({action:'define_stage',scope:'code',focus:'artifact behavior',criteria:['correct']})
  let bad=false
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async opts=>{
   if(bad)throw new Error('model unavailable')
   const payload=JSON.parse(opts.messages[0].content[0].text)
   return {text:JSON.stringify({verdict:'pass',summary:'checked',findings:[],checks:payload.stageContract.checks.map(c=>({checkId:c.checkId,criterion:c.criterion,status:'satisfied',evidenceRefs:['F0']})),nextStep:'next',stopCondition:'stop'}),trace:[]}
  }})
  const ref={taskId:task.taskId,stageId:stage.stage.id},args={mode:'review_result',...ref,question:'check',files:[{path:'app.js',purpose:'source'}]}
  assert.equal((await invoke(args,x.exec)).reviewPassed,true)
  bad=true
  const failed=await invoke(args,x.exec)
  assert.equal(failed.invocationSucceeded,false);assert.equal(failed.reviewPassed,false)
  assert.equal((await x.tool({action:'advance',...ref})).ok,false)
  assert.ok(failed.stageState.stage.limitations.includes('model unavailable'))
 }finally{x.cleanup()}
})

test('stage review excludes large irrelevant history and still accepts fresh declared evidence',async()=>{
 const x=fixture();try{
  const original=x.session.snapshotEvents()[0]
  x.session.snapshotEvents=()=>[original,...Array.from({length:30},(_,i)=>({seq:i+2,type:'tool/call',data:{name:'write',callId:'old'+i,arguments:JSON.stringify({file_path:'app.js',content:'x'.repeat(18000)})}}))]
  const task=await x.tool({action:'start_task',title:'bounded history'})
  const stage=await x.tool({action:'define_stage',scope:'code',focus:'one result',criteria:['result correct']})
  let payload
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async opts=>{
   payload=JSON.parse(opts.messages[0].content[0].text)
   return {text:JSON.stringify({verdict:'pass',summary:'checked',findings:[],checks:payload.stageContract.checks.map(c=>({checkId:c.checkId,criterion:c.criterion,status:'satisfied',evidenceRefs:['F0']})),nextStep:'next',stopCondition:'stop'}),trace:[]}
  }})
  const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:stage.stage.id,question:'check one result',files:[{path:'app.js',purpose:'actual source'}]},x.exec)
  assert.equal(payload.snapshot.records.length,0)
  assert.equal(payload.snapshot.historyPolicy,'stage-explicit-evidence-only')
  assert.equal(out.reviewPassed,true)
 }finally{x.cleanup()}
})

test('complete missing-ID report is deterministically bound to declared checkpoint order',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'id recovery'})
  const stage=await x.tool({action:'define_stage',scope:'code',focus:'runtime checks',criteria:['one','two']})
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async()=>({text:JSON.stringify({verdict:'pass',summary:'checked',findings:[],checks:[{criterion:'one',status:'satisfied',evidenceRefs:['F0']},{criterion:'two',status:'satisfied',evidenceRefs:['F0']}],nextStep:'done',stopCondition:'stop'}),trace:[]})})
  const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:stage.stage.id,question:'check',files:[{path:'app.js',purpose:'source'}]},x.exec)
  assert.deepEqual(out.report.checks.map(c=>c.checkId),stage.stage.checks.map(c=>c.id))
  assert.equal(out.stageRecording.ok,true)
 }finally{x.cleanup()}
})
test('advisor read trace becomes stage material without explicit files',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'self-read evidence'})
  const stage=await x.tool({action:'define_stage',scope:'code',focus:'runtime source',criteria:['source is usable']})
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async opts=>({text:JSON.stringify({verdict:'pass',summary:'read source',findings:[],checks:[{checkId:stage.stage.checks[0].id,criterion:'source',status:'satisfied',evidenceRefs:['read:app.js']}],nextStep:'done',stopCondition:'stop'}),trace:[{tool:'read',args:{path:'app.js'},ok:true,rejected:false,resultAvailable:true,evidence:toolRead(x.root,{path:'app.js'}).evidence}]} )})
  const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:stage.stage.id,question:'check',files:[],evidenceRefs:[]},x.exec)
  assert.equal(out.stageRecording.ok,true,JSON.stringify(out));assert.equal(out.reviewPassed,true,JSON.stringify(out));assert.ok(out.materials.some(m=>m.path==='app.js'&&m.source==='advisor-read'));assert.ok(x.stages.status({sessionId:'s',root:x.root,readEnabled:true}).stage.materials.length>0)
 }finally{x.cleanup()}
})

test('actual read loop runs S1 and S2 with empty files, manifests and fingerprints',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'three reported issues'})
  for(const name of ['S1','S2']) {
   const stage=await x.tool({action:'define_stage',scope:'code',focus:name+' source',criteria:['alpha','beta','gamma']})
   let turn=0
   const llm={stream:opts=>(async function*(){
    turn++
    if(turn===1)yield {type:'block-end',block:{type:'tool-call',id:'r',name:'read',arguments:JSON.stringify({path:'app.js'})}}
    else {
     const manifest=JSON.parse(opts.messages.filter(m=>m.role==='user'&&m.content?.[0]?.text?.startsWith('{"allowedEvidenceRefs"')).at(-1).content[0].text)
     assert.ok(manifest.allowedEvidenceRefs.includes('read:app.js'));assert.ok(!manifest.allowedEvidenceRefs.includes('read:invented.js'))
     assert.deepEqual(manifest.requiredCheckIds,stage.stage.checks.map(c=>c.id))
     const report={...manifest.reportTemplate,verdict:'pass',summary:'read real source',nextStep:'done',stopCondition:'stop',checks:manifest.reportTemplate.checks.map(c=>({...c,status:'satisfied',evidenceRefs:['read:app.js']}))}
     yield {type:'text-delta',text:JSON.stringify(report)}
    }
   })()}
   const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm}),runLoop:opts=>runReadOnlyToolLoop({...opts,shape:{make:({callId,content,isError})=>({role:'tool',toolCallId:callId,content,isError})}})})
   const ref={taskId:task.taskId,stageId:stage.stage.id}
   const out=await invoke({mode:'review_result',...ref,question:'review source',files:[],evidenceRefs:[]},x.exec)
   assert.equal(out.stageRecording.ok,true,JSON.stringify(out));assert.equal(out.reviewPassed,true,JSON.stringify(out))
   assert.equal(out.stageState.stage.materials.length,1)
   assert.equal(out.stageState.stage.materials[0].sha256,toolRead(x.root,{path:'app.js'}).evidence.sha256)
   assert.ok(out.report.checks.every(c=>out.trace.some(r=>'read:'+r.args.path===c.evidenceRefs[0])))
   assert.equal((await x.tool({action:'advance',...ref})).ok,true)
  }
 }finally{x.cleanup()}
})
test('missing-file read cannot support satisfied and fabricated read citation stays rejected',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'citation guards'}),stage=await x.tool({action:'define_stage',scope:'code',focus:'source',criteria:['source usable']})
  for(const ref of ['read:missing.js','read:invented.js']) {
   const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async()=>({text:JSON.stringify({verdict:'pass',summary:'bad',findings:[],checks:[{checkId:stage.stage.checks[0].id,criterion:'source',status:'satisfied',evidenceRefs:[ref]}],nextStep:'done',stopCondition:'stop'}),trace:[{tool:'read',args:{path:'missing.js'},ok:true,resultAvailable:false}]})})
   const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:stage.stage.id,question:'check',files:[]},x.exec)
   assert.equal(out.reason,'advisor-invalid-check');assert.equal(out.reviewPassed,false)
  }
 }finally{x.cleanup()}
})

test('ID recovery refuses mixed, missing, ambiguous and reworded checkpoints; captured read hashes go stale after edit',async()=>{
 const x=fixture();try{
  const task=await x.tool({action:'start_task',title:'strict recovery'}),stage=await x.tool({action:'define_stage',scope:'code',focus:'source',criteria:['one','two']})
  let checks,mutate=false
  const invoke=createAdvisor({stages:x.stages,resolveRuntime:async()=>({ok:true,cwd:x.root,readTools:true,cfg:{provider:'p',model:'m'},llm:{}}),runLoop:async()=>{
   const evidence=toolRead(x.root,{path:'app.js'}).evidence
   if(mutate)writeFileSync(join(x.root,'app.js'),'changed after read')
   return {text:JSON.stringify({verdict:'pass',summary:'checked',findings:[],checks,nextStep:'done',stopCondition:'stop'}),trace:[{tool:'read',args:{path:'app.js'},ok:true,resultAvailable:true,evidence}]}
  }})
  const c=criterion=>({criterion,status:'satisfied',evidenceRefs:['read:app.js']})
  for(const invalid of [[c('one')],[{...c('one'),checkId:stage.stage.checks[0].id},c('two')],[c('rewritten one'),c('two')],[c('one'),c('one')]]) {
   checks=invalid
   const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:stage.stage.id,question:'check',files:[]},x.exec)
   assert.equal(out.stageRecording.ok,false);assert.equal(out.stageRecording.reason,'stage-check-id-mismatch')
  }
  mutate=true;checks=stage.stage.checks.map(c=>({checkId:c.id,criterion:c.criterion,status:'satisfied',evidenceRefs:['read:app.js']}))
  const out=await invoke({mode:'review_result',taskId:task.taskId,stageId:stage.stage.id,question:'check',files:[]},x.exec)
  assert.equal(out.reviewPassed,false);assert.ok(out.stageState.stage.limitations.includes('evidence-changed'))
 }finally{x.cleanup()}
})
