import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAdvisor} from '../lib/advisor.js'
import {createAdvisorCoverage} from '../lib/advisor-coverage.js'
import {scopePolicy,scopedSnapshot,validateScope,revisionMarker} from '../lib/advisor-scopes.js'
const root=mkdtempSync(join(tmpdir(),'advisor-scopes-'))
writeFileSync(join(root,'code.js'),'REAL CODE')
writeFileSync(join(root,'view.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=','base64'))
const events=[{type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:'制作可预览的模型，只读本次产物'}]}},
 {type:'tool/result',seq:2,data:{message:{toolCallId:'t1',content:[{type:'text',text:'UNRELATED ALL TESTS PASSED'}]}}}]
const exec={callId:'invoke',agent:{session:{id:'scoped-session',snapshotEvents:()=>events}}}
const desc=path=>({path,purpose:'本次检查'})
const raw=ref=>JSON.stringify({verdict:'pass',summary:'本次对象满足',findings:[],checks:[{criterion:'当前对象',status:'satisfied',evidenceRefs:[ref]}],nextStep:'继续其它专项',stopCondition:'对象变化重审'})
test('geometry真正去掉源码/历史、走无工具image流；code同材料只走相关源码',async()=>{
 let visual,code
 const store=createAdvisorCoverage()
 const invoke=createAdvisor({coverage:store,resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,imageSupport:true,cfg:{provider:'p',model:'m'},
 attachments:{saveImage:async()=>({attachmentId:'fake',mediaType:'image/png',bytes:60,width:1,height:1})},
 llm:{stream:opts=>{visual=opts;return(async function*(){yield{type:'text-delta',text:raw('I0')}})()}}}),
 runLoop:async opts=>{code=opts;return{text:raw('F0'),trace:[]}}})
 const materials={files:[desc('code.js')],images:[desc('view.png')]}
 const v=await invoke({mode:'review_result',scope:'geometry',focus:'轮系朝向',question:'只检查装配',...materials},exec)
 assert.equal(v.ok,true);assert.equal(v.reviewScope,'geometry');assert.equal(code,undefined)
 const p=JSON.parse(visual.messages[0].content[0].text)
 assert.equal(p.snapshot.records.length,0);assert.equal(p.artifacts.some(x=>x.kind==='file'),false)
 assert.ok(!visual.messages[0].content[0].text.includes('REAL CODE'))
 assert.ok(!visual.messages[0].content[0].text.includes('ALL TESTS PASSED'))
 assert.equal(visual.messages[0].content.filter(x=>x.type==='image').length,1)
 assert.ok(visual.system.includes('朝向')&&visual.system.includes('重叠与穿插'))
 assert.equal(v.materials.find(x=>x.path==='code.js').status,'excluded')
 const c=await invoke({mode:'review_result',scope:'code',focus:'轮系朝向',question:'核对源码',...materials},exec)
 assert.equal(c.ok,true);assert.ok(code.system.includes('代码正确性'))
 assert.ok(code.messages[0].content[0].text.includes('REAL CODE'))
 assert.equal(code.messages[0].content.filter(x=>x.type==='image').length,0)
 assert.equal(c.materials.find(x=>x.path==='view.png').status,'excluded')
 assert.equal(store.history({sessionId:'scoped-session',requestId:v.requestId}).length,2)
})
test('无图片的geometry不能靠历史全过判通过',async()=>{
 let input
 const invoke=createAdvisor({resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,cfg:{provider:'p',model:'m'},llm:{stream:opts=>{input=opts;return(async function*(){yield{type:'text-delta',text:raw('E2')}})()}}})})
 const out=await invoke({mode:'review_result',scope:'geometry',focus:'轮系',question:'检查'},exec)
 assert.equal(out.ok,false);assert.equal(out.reason,'advisor-invalid-check')
 assert.equal(JSON.parse(input.messages[0].content[0].text).snapshot.records.length,0)
})
test('明确focus与delivery精确清单校验，源码write变更不被截图写入混淆',()=>{
 assert.equal(validateScope({scope:'geometry'}),'review-focus-required')
 assert.equal(validateScope({scope:'code',focus:'a',requiredReviews:[{scope:'code',focus:'a'}]}),'invalid-required-reviews')
 assert.equal(validateScope({scope:'delivery',focus:'交付',requiredReviews:[{scope:'geometry',focus:'轮系'}]}),null)
 const e=[{type:'tool/ptc-dispatch-start',seq:1,data:{subCallId:'x',name:'write',arguments:{file_path:'code.js'}}},{type:'tool/ptc-dispatch',seq:2,data:{subCallId:'x',isError:false}}]
 assert.equal(revisionMarker(e),'write:2')
 e.push({type:'tool/ptc-dispatch-start',seq:3,data:{subCallId:'i',name:'write',arguments:{file_path:'view.png'}}},{type:'tool/ptc-dispatch',seq:4,data:{subCallId:'i'}})
 assert.equal(revisionMarker(e),'write:2')
})
test('delivery精确核对已复核对象；材料变更与缺scope清单不能沿用通过',async()=>{
 const store=createAdvisorCoverage();let state,turn=0
 const invoke=createAdvisor({coverage:store,resolveRuntime:async()=>({ok:true,cwd:root,readTools:true,cfg:{provider:'p',model:'m'},
 llm:{stream:opts=>{state=JSON.parse(opts.messages[0].content[0].text);return(async function*(){yield{type:'text-delta',text:raw(state.coverage.rows[0].id)}})()}}}),
 runLoop:async()=>({text:raw('F0'),trace:[]})})
 await invoke({mode:'review_result',scope:'code',focus:'表单提交',question:'检查提交',files:[desc('code.js')]},exec)
 const final=await invoke({mode:'review_result',scope:'delivery',focus:'交付前覆盖',question:'核对覆盖',requiredReviews:[{scope:'code',focus:'表单提交'}]},exec)
 assert.equal(final.ok,true);assert.equal(final.report.verdict,'pass')
 assert.equal(state.snapshot.records.length,0);assert.equal(state.coverage.rows[0].focus,'表单提交')
 assert.equal(final.reviewScope,'delivery');assert.equal(final.coverage.rows.length,1)
 writeFileSync(join(root,'code.js'),'CHANGED CODE')
 const changed=await invoke({mode:'review_result',scope:'delivery',focus:'交付前覆盖',question:'核对覆盖',requiredReviews:[{scope:'code',focus:'表单提交'}]},exec)
 assert.ok(changed.ok===false||changed.report.verdict!=='pass')
 assert.equal(changed.coverage.rows[0].status,'changed')
 assert.equal(changed.coverage.missingReviews.length,1)
})
test('清理专项夹具',()=>rmSync(root,{recursive:true,force:true}))
