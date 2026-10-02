import test from 'node:test'
import assert from 'node:assert/strict'
import {createAdvisorFeedback,renderStageSummary} from '../lib/advisor-context.js'
import {ADVISOR_WORKFLOW} from '../lib/advisor-workflow.js'

test('production callback computes status exactly once, hides archived legacy reviews for active tasks',()=>{
 let statusCalls=0,historyCalls=0
 const stages={status:opts=>{statusCalls++;assert.equal(opts.sessionId,'session');assert.equal(opts.readEnabled,false);return {ok:true,taskId:'T1',stage:{id:'S1',scope:'code',checks:[{id:'S1.K1',status:'failed',criterion:'runtime'}],limitations:[]},action:'repair',dependencyStages:[]}}}
 const coverage={history:()=>{historyCalls++;throw new Error('must not read archive')}}
 const f=createAdvisorFeedback({stages,coverage})
 const text=f({id:'different-agent',session:{id:'session',header:{cwd:'root'},snapshotEvents:()=>[]}},{injectPacket:true,readTools:false})
 assert.equal(statusCalls,1);assert.equal(historyCalls,0)
 assert.ok(text.includes('S1.K1'));assert.ok(text.includes('repair'))
 assert.equal(f({},{injectPacket:false}),'');assert.equal(statusCalls,1)
})
test('legacy fallback filters to current real human request and cannot expand historical corpus',()=>{
 let query
 const f=createAdvisorFeedback({stages:{status:()=>({ok:true,taskId:null})},coverage:{history:opts=>{query=opts;return [{report:{verdict:'gaps',checks:[{criterion:'current check',status:'failed'}]}}]}}})
 const events=[{type:'user/message',seq:8,data:{source:{kind:'user'},content:[{type:'text',text:'current task'}]}},{type:'user/message',seq:9,data:{source:{kind:'runtime-context'},content:[{type:'text',text:'not human'}]}}]
 const text=f({session:{id:'session',header:{cwd:'root'},snapshotEvents:()=>events}},{injectPacket:true})
 assert.equal(query.requestId,'human:8');assert.ok(text.length<700)
 assert.ok(text.includes('current check'));assert.ok(!text.includes('nextStep'))
})
test('eight long checkpoints remain valid bounded JSON even if individual IDs are long',()=>{
 const state={ok:true,taskId:'T'.repeat(240),action:'repair',stage:{id:'S1',scope:'custom',checks:Array.from({length:8},(_,i)=>({id:'K'.repeat(230)+i,status:'failed',criterion:'x'.repeat(500)})),limitations:[]},dependencyStages:[]}
 const text=renderStageSummary(state);assert.ok(text.length<2300)
 const json=JSON.parse(text.slice(text.indexOf('\n')+1));assert.ok(json.omittedChecks>0);assert.equal(json.checks.length+json.omittedChecks,8)
})
test('fixed workflow contribution is bounded and has no domain-specific vocabulary',()=>{
 assert.ok(ADVISOR_WORKFLOW.length<1700)
 assert.ok(!/坦克|炮塔|履带|主炮|装甲|武器站/.test(ADVISOR_WORKFLOW))
})
