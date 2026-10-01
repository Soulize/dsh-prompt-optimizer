import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {beginInvocation,endInvocation} from '../lib/bash/bash-diagnostics.mjs'
test('同时进行的调用互不覆盖，结束只删除自身',()=>{
  const home=mkdtempSync(join(tmpdir(),'bash-inflight-'))
  try{
    const a=beginInvocation({home,sessionId:'same',command:'first'})
    const b=beginInvocation({home,sessionId:'same',command:'second'})
    const c=beginInvocation({home,sessionId:'other',command:'third'})
    assert.notEqual(a.path,b.path)
    assert.equal(JSON.parse(readFileSync(a.path)).command,'first')
    assert.equal(b.note,'')
    assert.equal(endInvocation(a),true)
    assert.ok(existsSync(b.path)&&existsSync(c.path))
    assert.equal(endInvocation(b),true);assert.equal(endInvocation(c),true)
  }finally{rmSync(home,{recursive:true,force:true})}
})
