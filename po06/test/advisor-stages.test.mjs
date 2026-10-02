import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createAdvisorStages} from '../lib/advisor-stages.js'
const hash=x=>createHash('sha256').update(x).digest('hex')
const setup=()=>{
 const root=mkdtempSync(join(tmpdir(),'arbiter-stages-'))
 writeFileSync(join(root,'artifact.txt'),'original')
 const store=createAdvisorStages({home:root}),ctx={sessionId:'s',root,readEnabled:true}
 const task=store.startTask({...ctx,title:'generic task',sourceRequestId:'human:1',sourceText:'produce usable artifact'})
 const stage=store.defineStage({...ctx,taskId:task.taskId,scope:'code',focus:'object behavior',criteria:['observable behavior','error handling']})
 const target={...ctx,taskId:task.taskId,stageId:stage.stage.id}
 const material={path:'artifact.txt',kind:'file',status:'ready',sha256:hash('original')}
 const report=(statuses=['satisfied','satisfied'],wording='different wording')=>({verdict:statuses.every(s=>s==='satisfied')?'pass':'gaps',checks:stage.stage.checks.map((c,i)=>({checkId:c.id,criterion:wording,status:statuses[i],evidenceRefs:['F0']}))})
 return {root,store,ctx,task,stage,target,material,report,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
test('declared checkpoints block advance, failed review derives repair and cannot define next stage',()=>{
 const x=setup();try{
  assert.equal(x.store.advance(x.target).ok,false)
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(['failed','unverified']),materials:[x.material]})
  assert.equal(x.store.status(x.ctx).action,'repair')
  assert.equal(x.store.defineStage({...x.ctx,scope:'interaction',focus:'next object',criteria:['input works']}).reason,'previous-stage-unresolved')
  assert.equal(x.store.advance(x.target).ok,false)
 }finally{x.cleanup()}
})
test('plugin-owned check IDs survive wording changes and restart; satisfied evidence advances',()=>{
 const x=setup();try{
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(),materials:[x.material]})
  assert.deepEqual(x.store.status(x.ctx).stage.checks.map(c=>c.criterion),['observable behavior','error handling'])
  const reloaded=createAdvisorStages({home:x.root})
  assert.deepEqual(reloaded.status(x.ctx).stage.checks.map(c=>c.id),x.stage.stage.checks.map(c=>c.id))
  assert.equal(reloaded.advance(x.target).ok,true)
  assert.equal(reloaded.defineStage({...x.ctx,scope:'interaction',focus:'input feedback',criteria:['click changes state']}).ok,true)
 }finally{x.cleanup()}
})
test('local tests or changed/unavailable evidence do not close a review',()=>{
 const x=setup();try{
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(),materials:[x.material]})
  writeFileSync(join(x.root,'artifact.txt'),'changed')
  assert.equal(x.store.advance(x.target).ok,false)
  assert.ok(x.store.status(x.ctx).stage.checks.every(c=>c.status==='stale'))
  assert.equal(x.store.status({...x.ctx,readEnabled:false}).action,'ask-user')
  const no=x.store.recordReview({...x.target,reviewId:'r2',report:x.report(),materials:[]})
  assert.equal(no.ok,true);assert.equal(x.store.advance(x.target).ok,false)
 }finally{x.cleanup()}
})
test('partial reports and unknown/missing checkpoint IDs never advance',()=>{
 const x=setup();try{
  const wrong=x.report();wrong.checks[0].checkId='unknown'
  assert.equal(x.store.recordReview({...x.target,reviewId:'r1',report:wrong,materials:[x.material]}).ok,false)
  const missing=x.report();missing.checks.pop()
  x.store.recordReview({...x.target,reviewId:'r2',report:missing,materials:[x.material]})
  assert.equal(x.store.advance(x.target).ok,false)
  x.store.recordReview({...x.target,reviewId:'r3',report:x.report(),materials:[x.material],partial:true})
  assert.equal(x.store.advance(x.target).ok,false)
 }finally{x.cleanup()}
})
test('explicit task switch removes old failures from summary without erasing archive; session isolated',()=>{
 const x=setup();try{
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(['failed','failed']),materials:[x.material]})
  const next=x.store.startTask({...x.ctx,title:'different task',sourceRequestId:'human:2',sourceText:'write document'})
  const sum=x.store.summary(x.ctx)
  assert.ok(!sum.includes('observable behavior'));assert.ok(sum.includes(next.taskId))
  assert.equal(x.store.archive(x.ctx).tasks.length,2)
  assert.equal(x.store.recordReview({...x.target,reviewId:'r2',report:x.report(),materials:[x.material]}).reason,'inactive-review-stage')
  assert.equal(x.store.summary({...x.ctx,sessionId:'other'}),'')
 }finally{x.cleanup()}
})
test('generic code/document/interaction stages have no task-specific policy, summary is bounded',()=>{
 for(const scope of ['code','custom','interaction']){
  const x=setup();try{
   const next=x.store.startTask({...x.ctx,title:'task',sourceRequestId:'human:2',sourceText:'generic request'})
   const s=x.store.defineStage({...x.ctx,taskId:next.taskId,scope,focus:'object',criteria:Array(8).fill('x'.repeat(500))})
   assert.equal(s.ok,true);assert.ok(x.store.summary(x.ctx).length<2300)
  }finally{x.cleanup()}
 }
})
test('invalid session IDs and corrupt persisted state are explicit errors',()=>{
 const x=setup();try{
  assert.equal(x.store.status({sessionId:'../escape'}).ok,false)
  writeFileSync(join(x.root,'po06-advisor-stages','broken.json'),'{bad')
  const reloaded=createAdvisorStages({home:x.root})
  assert.equal(reloaded.status({sessionId:'broken'}).reason,'stage-store-invalid')
 }finally{x.cleanup()}
})

test('changed dependency can be re-reviewed then resume the later stage without erasing it',()=>{
 const x=setup();try{
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(),materials:[x.material]})
  const second=x.store.defineStage({...x.ctx,scope:'interaction',focus:'input effect',criteria:['click updates output']})
  const target2={...x.ctx,taskId:x.task.taskId,stageId:second.stage.id}
  writeFileSync(join(x.root,'second.txt'),'input effect')
  const mat2={path:'second.txt',kind:'file',status:'ready',sha256:hash('input effect')}
  const report2={verdict:'pass',checks:[{checkId:second.stage.checks[0].id,criterion:'reworded',status:'satisfied',evidenceRefs:['F0']}]}
  x.store.recordReview({...target2,reviewId:'r2',report:report2,materials:[mat2]})
  writeFileSync(join(x.root,'artifact.txt'),'updated')
  assert.equal(x.store.advance(target2).reason,'dependency-stage-unresolved')
  assert.equal(x.store.activateStage(x.target).ok,true)
  x.store.recordReview({...x.target,reviewId:'r3',report:x.report(),materials:[{...x.material,sha256:hash('updated')}]})
  assert.equal(x.store.activateStage(target2).ok,true)
  assert.equal(x.store.advance(target2).ok,true)
  assert.equal(x.store.status(x.ctx).stage.checks[0].id,second.stage.checks[0].id)
 }finally{x.cleanup()}
})
test('dangling persisted active task and stage pointers are rejected',()=>{
 for(const field of ['activeTaskId','activeStageId']) {
  const x=setup();try{
   const state=x.store.archive(x.ctx)
   if(field==='activeTaskId')state.activeTaskId='missing'
   else state.tasks[0].activeStageId='missing'
   writeFileSync(join(x.root,'po06-advisor-stages','s.json'),JSON.stringify(state))
   const reloaded=createAdvisorStages({home:x.root})
   assert.equal(reloaded.status(x.ctx).reason,'stage-store-invalid')
  }finally{x.cleanup()}
 }
})

test('image-only evidence is bound to the actual source artifact, not just unchanged image bytes',()=>{
 const x=setup();try{
  const task=x.store.startTask({...x.ctx,title:'visual task',sourceRequestId:'human:2',sourceText:'inspect object appearance'})
  const stage=x.store.defineStage({...x.ctx,taskId:task.taskId,scope:'appearance',focus:'current visual result',criteria:['visible defect absent'],subjectPaths:['artifact.txt']})
  writeFileSync(join(x.root,'runtime.png'),'image bytes')
  const image={path:'runtime.png',kind:'image',status:'ready',sha256:hash('image bytes')}
  const ref={...x.ctx,taskId:task.taskId,stageId:stage.stage.id}
  const prepared=x.store.prepareReview({...ref,materials:[image]})
  assert.equal(prepared.ok,true)
  const report={verdict:'pass',checks:[{checkId:stage.stage.checks[0].id,criterion:'visual check',status:'satisfied',evidenceRefs:['I0']}]}
  x.store.recordReview({...ref,reviewId:'r1',report,materials:[image],subjects:prepared.subjects,attemptId:prepared.attemptId})
  assert.equal(x.store.advance(ref).ok,true)
  writeFileSync(join(x.root,'artifact.txt'),'source changed but image unchanged')
  assert.equal(x.store.advance(ref).ok,false)
  assert.ok(x.store.status(x.ctx).stage.limitations.includes('evidence-changed'))
  assert.equal(x.store.prepareReview({...ref,materials:[image]}).subjectProblem,'visual-evidence-stale-after-subject-change')
  assert.equal(x.store.defineStage({...x.ctx,scope:'geometry',focus:'shape',criteria:['shape correct']}).reason,'stage-subject-required')
 }finally{x.cleanup()}
})
test('starting a new review invalidates older pass and failure cannot revive it',()=>{
 const x=setup();try{
  const first=x.store.prepareReview({...x.target,materials:[x.material]})
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(),materials:[x.material],subjects:first.subjects,attemptId:first.attemptId})
  assert.equal(x.store.advance(x.target).ok,true)
  const second=x.store.prepareReview({...x.target,materials:[x.material]})
  assert.equal(x.store.advance(x.target).ok,false)
  assert.equal(x.store.recordReview({...x.target,reviewId:'late',report:x.report(),materials:[x.material],subjects:first.subjects,attemptId:first.attemptId}).reason,'stale-review-attempt')
  x.store.reviewFailed({...x.target,attemptId:second.attemptId,reason:'timeout'})
  assert.equal(x.store.recordReview({...x.target,reviewId:'late-after-timeout',report:x.report(),materials:[x.material],subjects:second.subjects,attemptId:second.attemptId}).reason,'stale-review-attempt')
  assert.equal(x.store.advance(x.target).ok,false)
  assert.ok(x.store.status(x.ctx).stage.limitations.includes('timeout'))
 }finally{x.cleanup()}
})
test('malformed persisted snapshots cannot become a passed task',()=>{
 const x=setup();try{
  const state=x.store.archive(x.ctx)
  state.tasks[0].stages[0].checks[0].id='invented'
  writeFileSync(join(x.root,'po06-advisor-stages','s.json'),JSON.stringify(state))
  assert.equal(createAdvisorStages({home:x.root}).status(x.ctx).reason,'stage-store-invalid')
 }finally{x.cleanup()}
})

test('correcting a missing subject path preserves failed IDs and requires a fresh review',()=>{
 const x=setup();try{
  x.store.recordReview({...x.target,reviewId:'r1',report:x.report(['failed','unverified']),materials:[x.material]})
  x.store.setSubjects({...x.target,subjectPaths:['missing.txt']})
  assert.equal(x.store.prepareReview({...x.target,materials:[x.material]}).subjectProblem,'subject-unavailable')
  x.store.setSubjects({...x.target,subjectPaths:['artifact.txt']})
  assert.deepEqual(x.store.status(x.ctx).stage.checks.map(c=>c.id),x.stage.stage.checks.map(c=>c.id))
  assert.equal(x.store.status(x.ctx).stage.checks[0].status,'failed')
  assert.equal(x.store.advance(x.target).ok,false)
  const fresh=x.store.prepareReview({...x.target,materials:[x.material]})
  x.store.recordReview({...x.target,reviewId:'r2',report:x.report(),materials:[x.material],subjects:fresh.subjects,attemptId:fresh.attemptId})
  assert.equal(x.store.advance(x.target).ok,true)
 }finally{x.cleanup()}
})

test('set_subjects and mixed new images cannot erase stale visual evidence baseline',()=>{
 const x=setup();try{
  const task=x.store.startTask({...x.ctx,title:'visual',sourceRequestId:'human:2',sourceText:'review appearance'})
  const stage=x.store.defineStage({...x.ctx,taskId:task.taskId,scope:'appearance',focus:'surface',criteria:['surface correct'],subjectPaths:['artifact.txt']})
  writeFileSync(join(x.root,'old.png'),'old image');writeFileSync(join(x.root,'new.png'),'new image')
  const old={path:'old.png',kind:'image',status:'ready',sha256:hash('old image'),evidenceType:'runtime-capture'}
  const ref={...x.ctx,taskId:task.taskId,stageId:stage.stage.id}
  const report={verdict:'pass',checks:[{checkId:stage.stage.checks[0].id,criterion:'surface',status:'satisfied',evidenceRefs:['I0']}]}
  const first=x.store.prepareReview({...ref,materials:[old]})
  x.store.recordReview({...ref,reviewId:'r1',report,materials:[old],subjects:first.subjects,attemptId:first.attemptId})
  x.store.setSubjects({...ref,subjectPaths:['artifact.txt']})
  assert.equal(x.store.recordReview({...ref,reviewId:'replay',report,materials:[old],subjects:first.subjects,attemptId:first.attemptId}).reason,'stale-review-attempt')
  writeFileSync(join(x.root,'artifact.txt'),'changed')
  assert.equal(x.store.prepareReview({...ref,materials:[old]}).subjectProblem,'visual-evidence-stale-after-subject-change')
  const newer={path:'new.png',kind:'image',status:'ready',sha256:hash('new image'),evidenceType:'runtime-capture'}
  assert.equal(x.store.prepareReview({...ref,materials:[old,newer]}).subjectProblem,'visual-evidence-stale-after-subject-change')
  writeFileSync(join(x.root,'second-source.txt'),'second')
  x.store.setSubjects({...ref,subjectPaths:['artifact.txt','second-source.txt']})
  assert.equal(x.store.prepareReview({...ref,materials:[old]}).subjectProblem,'visual-evidence-stale-after-subject-change')
  const good=x.store.prepareReview({...ref,materials:[newer]})
  assert.equal(good.subjectProblem,null)
  assert.equal(x.store.recordReview({...ref,reviewId:'r2',report,materials:[newer],subjects:good.subjects,attemptId:good.attemptId}).ok,true)
  assert.equal(x.store.recordReview({...ref,reviewId:'replayed-success',report,materials:[newer],subjects:good.subjects,attemptId:good.attemptId}).reason,'stale-review-attempt')
  assert.equal(x.store.advance(ref).ok,true)
 }finally{x.cleanup()}
})
