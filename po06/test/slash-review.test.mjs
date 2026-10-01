// 0.8 · 斜杠命令允许列表：设置归一 + /status.slashReview 的 fail-closed 判定。
// 用假 req/res 直接调 handler（不起服务器、不联网、不碰真实 home）。
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeSettings,SETTINGS_KEYS,DEFAULT_SETTINGS,SLASH_REVIEW_MAX} from '../lib/settings.js'
import {createControlHandler} from '../lib/control-api.js'
const DIRS=[]
process.on('exit',()=>{for(const d of DIRS){try{rmSync(d,{recursive:true,force:true})}catch{}}})
function fakeReq(url){const req=new EventEmitter();req.method='GET';req.url=url;req.headers={host:'127.0.0.1:3080'};req.destroy=()=>{};setImmediate(()=>req.emit('end'));return req}
function fakeRes(){return{status:null,body:null,writeHead(c){this.status=c},end(b){try{this.body=JSON.parse(String(b))}catch{this.body=null}}}}

test('设置：默认空名单，斜杠与大小写归一，坏条目单条丢弃并上报',()=>{
  assert.deepEqual(DEFAULT_SETTINGS.slashReview,[])
  assert.ok(SETTINGS_KEYS.includes('slashReview'))
  assert.deepEqual(normalizeSettings({}).settings.slashReview,[],'缺省=空名单，不改变旧行为')
  assert.deepEqual(normalizeSettings({slashReview:['/vmake','VMAKE','other_cmd','a']}).settings.slashReview,['vmake','other_cmd','a'])
  const bad=normalizeSettings({slashReview:['bad name','ok','',42,'x'.repeat(40),'/']})
  assert.deepEqual(bad.settings.slashReview,['ok'],'非法名丢弃，合法名保留')
  assert.ok(bad.problems.some(p=>String(p.key).startsWith('slashReview[')),'坏条目要如实上报')
  const wrong=normalizeSettings({slashReview:'vmake'})
  assert.deepEqual(wrong.settings.slashReview,[])
  assert.ok(wrong.problems.some(p=>p.key==='slashReview'&&p.kind==='wrong-type'))
  assert.equal(normalizeSettings({slashReview:Array.from({length:30},(_,i)=>'c'+i)}).settings.slashReview.length,SLASH_REVIEW_MAX)
})

async function status(slashReview,registered,{session='session-x'}={}){
  const home=mkdtempSync(join(tmpdir(),'po06-slash-'));DIRS.push(home)
  writeFileSync(join(home,'po06.json'),JSON.stringify({settingsVersion:1,enabled:true,rollout:{mode:'all'},...(slashReview===undefined?{}:{slashReview})}),'utf8')
  const handler=createControlHandler({home,stateDir:home,ledgerPath:join(home,'l.jsonl'),version:'test',registeredCommands:registered})
  const res=fakeRes()
  await handler(fakeReq('/po06/api/status'+(session?('?session='+session):'')),res)
  return res.body
}

test('名单里写了但当前没注册的指令：不拦截、不报错，/status 照常 200',async()=>{
  const body=await status(['/vmake'],()=>({ok:true,names:['clear','model']}))
  assert.equal(body.ok,true)
  assert.deepEqual(body.slashReview.names,['vmake'])
  assert.deepEqual(body.slashReview.active,[],'问到了命令表且未注册 ⇒ 不进 active ⇒ 不拦截')
  assert.equal(body.slashReview.verified,true,'问到了就要标成已核对')
  assert.equal(body.slashReview.reason,null,'命令表查得到，只是名单项不在其中')
})

test('只有已注册的名单项才放行；官方命令不在名单里也不放行',async()=>{
  assert.deepEqual((await status(['/vmake'],()=>({ok:true,names:['vmake','clear','model']}))).slashReview.active,['vmake'])
  assert.deepEqual((await status(['/vmake'],()=>({ok:true,names:['clear','model','compact']}))).slashReview.active,[])
  assert.deepEqual((await status(['/vmake','/other'],()=>({ok:true,names:['other']}))).slashReview.active,['other'])
})

test('问不到命令表时退回名单本身（verified:false 如实标注），不把异常抛给 /status',async()=>{
  // 真机教训（2026-10-01）：早先这里 fail-closed ⇒ 名单被静默架空，用户看到“配了也不生效”。
  // 现在改为“问不到就按名单放行，并如实标注未核对注册状态”。
  const missing=await status(['/vmake'],undefined)
  assert.equal(missing.ok,true)
  assert.deepEqual(missing.slashReview.active,['vmake'],'问不到命令表 ⇒ 按名单放行')
  assert.equal(missing.slashReview.verified,false)
  assert.match(missing.slashReview.reason,/^unverified:resolver-missing$/)
  const threw=await status(['/vmake'],()=>{throw new Error('boom')})
  assert.equal(threw.ok,true)
  assert.deepEqual(threw.slashReview.active,['vmake'])
  assert.match(threw.slashReview.reason,/^unverified:threw:boom$/)
  const noAgent=await status(['/vmake'],()=>({ok:false,reason:'no-live-agent',names:[],diagnostics:{agents:'ok:get',liveAgents:0}}))
  assert.deepEqual(noAgent.slashReview.active,['vmake'])
  assert.equal(noAgent.slashReview.verified,false)
  assert.equal(noAgent.slashReview.diagnostics.liveAgents,0,'诊断要能看出当时有几个 live agent')
  const noSession=await status(['/vmake'],()=>({ok:true,names:['vmake']}),{session:''})
  assert.deepEqual(noSession.slashReview.active,[],'连会话都没有 ⇒ 不拦')
  assert.equal(noSession.slashReview.reason,'session-required')
})

test('没有名单时保持旧行为：明确 reason，且不去查命令表',async()=>{
  let called=0
  const body=await status(undefined,()=>{called+=1;return{ok:true,names:['vmake']}})
  assert.deepEqual(body.slashReview,{names:[],active:[],reason:'no-allowlist'})
  assert.equal(called,0,'没名单就不该问命令表')
})
