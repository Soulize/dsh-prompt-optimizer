import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBashOutput } from '../lib/bash/bash-output.mjs'
const base = () => ({ok:true,reason:'exit',outcome:{exitCode:0,signal:null},streams:{stdout:{text:'ready',spillPath:'stdout.log'},stderr:{text:'',spillPath:'stderr.log'}}})
const parsed = out => /\n\[exit code: (-?\d+)\]$/.exec(out)

test('成功/失败的提示必须位于状态标记之前',()=>{
  for(const code of [0,1,127]){
    const g=base();g.outcome.exitCode=code
    const out=renderBashOutput(g,{elapsedMs:3000,prepareMs:50,note:'调用质量提示'})
    assert.equal(Number(parsed(out)[1]),code)
    assert.ok(out.indexOf('调用质量提示')<out.indexOf('[exit code:'))
  }
})
test('失败保留stdout测试详情和stderr，stderr截断不把0变失败',()=>{
  const g=base();g.outcome.exitCode=1;g.streams.stdout.text='FAILED test geometry expected 3 got 4';g.streams.stderr.text='stack trace'
  const out=renderBashOutput(g)
  assert.ok(out.includes('FAILED test geometry'))
  assert.ok(out.includes('stack trace'))
  g.outcome.exitCode=0;g.streams.stderr.truncated=true
  const good=renderBashOutput(g)
  assert.ok(!good.includes('【发生了什么】'))
  assert.ok(good.includes('stderr.log'))
  assert.equal(Number(parsed(good)[1]),0)
})
test('两个流独立截尾并始终有完整文件指针',()=>{
  const g=base();g.streams.stdout.text='HEAD'+ 'x'.repeat(30)+'TAIL';g.streams.stderr.text='ERRORHEAD'+'y'.repeat(30)+'ERRTAIL'
  const out=renderBashOutput(g,{maxChars:10,mapPath:p=>'/mapped/'+p})
  assert.ok(out.includes('/mapped/stdout.log')&&out.includes('/mapped/stderr.log'))
  assert.ok(out.includes('TAIL')&&out.includes('ERRTAIL'))
  assert.ok(!out.includes('HEAD'))
  assert.ok(out.includes('末尾'))
})
test('超时取消不声称独立证明树已清空',()=>{
  for(const reason of ['timeout','cancelled']){
    const g=base();g.reason=reason;g.ok=false;g.outcome={exitCode:null,signal:null}
    const out=renderBashOutput(g)
    assert.ok(out.includes('收尾未确认'))
    assert.ok(!out.includes('进程树已回收'))
  }
})
