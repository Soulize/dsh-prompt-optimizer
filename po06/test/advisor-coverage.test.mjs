import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createAdvisorCoverage, coverageFor } from '../lib/advisor-coverage.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const report = (verdict='pass') => ({ verdict, summary:'bounded', nextStep:'next', stopCondition:'stop', findings:[], checks:[{criterion:'criterion',status:'satisfied',evidenceRefs:['F0']}] })

test('records bounded reports and persists atomically', async () => {
  const home=await mkdtemp(join(tmpdir(),'po06-cov-')); try {
    const store=createAdvisorCoverage({home,limit:2}); const huge='x'.repeat(100000)
    assert.equal(store.record({sessionId:'s1',requestId:'q1',runId:'r1',scope:'build',focus:'tests',materials:[{id:'F0',path:'a.txt',sha256:hash('a'),purpose:'p'}],report:{...report(),reasoning:huge,raw:huge},ok:true,partial:false}).ok,true)
    await writeFile(join(home,'a.txt'),'a')
    const saved=JSON.parse(await readFile(join(home,'po06-advisor-coverage.json'),'utf8'))
    assert.equal(saved.length,1); assert.equal(JSON.stringify(saved).includes(huge),false); assert.equal(JSON.stringify(saved).includes('reasoning'),false)
  } finally { await rm(home,{recursive:true,force:true}) }
})

test('filters session/request, rereads hashes, and blocks changed or partial pass', async () => {
  const root=await mkdtemp(join(tmpdir(),'po06-cov-')); const home=await mkdtemp(join(tmpdir(),'po06-cov-home-')); try {
    await writeFile(join(root,'a.txt'),'a'); const store=createAdvisorCoverage({home})
    store.record({sessionId:'s1',requestId:'q1',runId:'r1',scope:'build',focus:'tests',materials:[{id:'F0',path:'a.txt',sha256:hash('a'),purpose:'p'}],report:report(),ok:true,partial:false})
    store.record({sessionId:'s1',requestId:'q2',runId:'r2',scope:'build',focus:'other',materials:[],report:report(),ok:true,partial:true})
    await writeFile(join(root,'a.txt'),'changed'); const got=await coverageFor(store,{sessionId:'s1',requestId:'q1',root,requiredScopes:['build']})
    assert.equal(got.rows.length,1); assert.equal(got.rows[0].materials[0].verification,'changed'); assert.equal(got.rows[0].verdict,'unverified'); assert.deepEqual(got.missingScopes,['build'])
    const other=await coverageFor(store,{sessionId:'s1',requestId:'q2',root,readEnabled:false}); assert.equal(other.rows[0].status,'unverified'); assert.equal(other.rows[0].materials.length,0)
    assert.equal((await coverageFor(store,{sessionId:'s2',requestId:'q1',root})).rows.length,0)
  } finally { await rm(root,{recursive:true,force:true}); await rm(home,{recursive:true,force:true}) }
})

test('caps history at twenty rows and store at configured limit', async () => {
  const home=await mkdtemp(join(tmpdir(),'po06-cov-')); try { const store=createAdvisorCoverage({home,limit:3}); for(let i=0;i<25;i++) store.record({sessionId:'s',requestId:'q',runId:'r'+i,scope:'s'+i,focus:'f',materials:[],report:report(),ok:true,partial:false}); const got=await coverageFor(store,{sessionId:'s',requestId:'q',root:home}); assert.equal(store.history({sessionId:'s',requestId:'q'}).length,3); assert.equal(got.rows.length,3) } finally { await rm(home,{recursive:true,force:true}) }
})

test('current is local to focus and becomes missing, unverified, or changed', async () => {
 const root=await mkdtemp(join(tmpdir(),'cov-state-')); try {
 await writeFile(join(root,'a.txt'),'a'); const store=createAdvisorCoverage({home:join(root,'store')}); const base={sessionId:'s',requestId:'q',scope:'code',materials:[{id:'F0',path:'a.txt',sha256:hash('a'),status:'ready'}],report:report(),ok:true};
 store.record({...base,runId:'r1',focus:'syntax'}); store.record({...base,runId:'r2',focus:'behavior'});
 const a=await coverageFor(store,{sessionId:'s',requestId:'q',root}); assert.equal(a.rows.length,2); assert.ok(a.rows.every(r=>r.status==='current')); assert.ok(a.limitations.includes('scope-pass-is-focus-only'));
 const disabled=await coverageFor(store,{sessionId:'s',requestId:'q',root,readEnabled:false}); assert.ok(disabled.rows.every(r=>r.verdict==='unverified'));
 await rm(join(root,'a.txt')); const b=await coverageFor(store,{sessionId:'s',requestId:'q',root}); assert.ok(b.rows.every(r=>r.status==='missing'));
 assert.deepEqual(store.history({sessionId:'other',requestId:'q'}),[]);
 } finally {await rm(root,{recursive:true,force:true})}
})

test('corrupt and unavailable stores report limitations; invalid reports do not pass', async () => {
 const root=await mkdtemp(join(tmpdir(),'cov-bad-')); try { await writeFile(join(root,'po06-advisor-coverage.json'),'{broken'); const store=createAdvisorCoverage({home:root}); const a=await coverageFor(store,{sessionId:'s',requestId:'q',root}); assert.ok(a.limitations.includes('coverage-store-invalid')); const b=await coverageFor(null,{sessionId:'s',requestId:'q',root}); assert.ok(b.limitations.includes('coverage-store-unavailable'));
 await writeFile(join(root,'a.txt'),'a'); store.record({sessionId:'s',requestId:'q',runId:'r',scope:'code',focus:'f',materials:[{path:'a.txt',sha256:hash('a')}],report:{verdict:'pass',checks:[{criterion:'x',status:'satisfied'}]},ok:true}); assert.equal((await coverageFor(store,{sessionId:'s',requestId:'q',root})).rows[0].verdict,'unverified');
 } finally {await rm(root,{recursive:true,force:true})}
})

test('revision marker and question survive restart and marker mismatch blocks current', async () => {
 const root=await mkdtemp(join(tmpdir(),'cov-rev-')); try { await writeFile(join(root,'a.txt'),'a'); const store=createAdvisorCoverage({home:join(root,'store')}); store.record({sessionId:'s',requestId:'q',runId:'r',scope:'code',focus:'f',question:'what changed',revisionMarker:'v1',materials:[{path:'a.txt',sha256:hash('a')}],report:report(),ok:true}); const reloaded=createAdvisorCoverage({home:join(root,'store')}); const a=await coverageFor(reloaded,{sessionId:'s',requestId:'q',root,revisionMarker:'v1'}); assert.equal(a.rows[0].status,'current'); assert.equal(a.rows[0].question,'what changed'); assert.equal((await coverageFor(reloaded,{sessionId:'s',requestId:'q',root,revisionMarker:'v2'})).rows[0].verdict,'unverified') } finally {await rm(root,{recursive:true,force:true})}
})

test('oversized materials and outside-workspace paths never count current', async () => {
 const root=await mkdtemp(join(tmpdir(),'cov-bounds-')); try {const text=Buffer.alloc(2*1024*1024+1,65), image=Buffer.alloc(5*1024*1024+1,65); await writeFile(join(root,'large.txt'),text); await writeFile(join(root,'large.png'),image); const store=createAdvisorCoverage({home:join(root,'store')}); for(const [i,path,body] of [[0,'large.txt',text],[1,'large.png',image],[2,'../escape.txt',Buffer.from('x')]]) store.record({sessionId:'s',requestId:'q',runId:'r'+i,scope:'code',focus:'f'+i,materials:[{path,kind:path.endsWith('.png')?'image':'file',sha256:hash(body)}],report:report(),ok:true}); const result=await coverageFor(store,{sessionId:'s',requestId:'q',root}); assert.ok(result.rows.every(x=>x.verdict==='unverified')); assert.equal(result.rows[2].materials[0].verification,'unverified') }finally{await rm(root,{recursive:true,force:true})}
})

test('global eighty record bound and latest twenty distinct scope/focus rows', async () => {
 const store=createAdvisorCoverage({limit:1000}); for(let i=0;i<100;i++) store.record({sessionId:'s',requestId:'q',runId:'r'+i,scope:'code',focus:'f'+i,materials:[],report:report(),ok:true}); assert.equal(store.history({sessionId:'s',requestId:'q'}).length,80); const a=await coverageFor(store,{sessionId:'s',requestId:'q',root:tmpdir()}); assert.equal(a.rows.length,20); const copy=store.history({sessionId:'s',requestId:'q'}); copy[0].scope='tampered'; assert.equal(store.history({sessionId:'s',requestId:'q'})[0].scope,'code')
})

test('required reviews use exact focus and category alone never erases missing scope', async () => {
 const root=await mkdtemp(join(tmpdir(),'cov-focus-')); try { await writeFile(join(root,'a.txt'),'a'); const store=createAdvisorCoverage({home:join(root,'store')}); store.record({sessionId:'s',requestId:'q',runId:'r',scope:'code',focus:'syntax',materials:[{path:'a.txt',sha256:hash('a')}],report:report(),ok:true}); const opts={sessionId:'s',requestId:'q',root}; const broad=await coverageFor(store,{...opts,requiredScopes:['code']}); assert.deepEqual(broad.missingScopes,['code']); assert.ok(broad.limitations.includes('required-focus-unspecified:code')); const exact=await coverageFor(store,{...opts,requiredScopes:['code'],requiredReviews:[{scope:'code',focus:'syntax'}]}); assert.deepEqual(exact.missingReviews,[]); assert.deepEqual(exact.missingScopes,[]); const other=await coverageFor(store,{...opts,requiredReviews:[{scope:'code',focus:'behavior'}]}); assert.deepEqual(other.missingReviews,[{scope:'code',focus:'behavior'}]); assert.ok(other.limitations.includes('review-missing:code:behavior')) } finally{await rm(root,{recursive:true,force:true})}
})
