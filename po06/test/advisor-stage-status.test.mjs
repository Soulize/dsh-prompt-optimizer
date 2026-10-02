import test from 'node:test'
import assert from 'node:assert/strict'
import {createControlHandler} from '../lib/control-api.js'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('status exposes new collaboration protocol diagnostics for the requested session',async()=>{
 const home=mkdtempSync(join(tmpdir(),'stage-status-'))
 try{
  let sid
  const handler=createControlHandler({home,advisorStageStatus:s=>{sid=s;return {ok:true,protocolVersion:2,stage:{taskId:'T1',action:'repair'},verification:'diagnostic-only'}}})
  const response={writeHead(code){this.code=code},end(text){this.data=JSON.parse(text)}}
  await handler({method:'GET',url:'/po06/api/status?session=s',headers:{host:'127.0.0.1:3080'}},response)
  assert.equal(response.code,200);assert.equal(sid,'s');assert.equal(response.data.advisorCollaboration.protocolVersion,2)
  assert.equal(response.data.advisorCollaboration.stage.action,'repair')
 }finally{rmSync(home,{recursive:true,force:true})}
})
