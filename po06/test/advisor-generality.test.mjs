import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ADVISOR_SYSTEM,ADVISOR_PARAMETERS} from '../lib/advisor.js'
import {ADVISOR_SCOPES,SCOPE_LABELS,scopeInstructions,scopePolicy} from '../lib/advisor-scopes.js'
import {ADVISOR_WORKFLOW} from '../lib/advisor-workflow.js'
// Scope is a review dimension, not an industry. A shipped prompt must not teach one domain's vocabulary,
// or the advisor starts checking "the tank example" instead of whatever the current task is.
const DOMAIN_TERMS=/(坦克|炮塔|履带|负重轮|轮系|主炮|装甲|武器站|车体|游戏角色|贴图烘焙)/
const promptText=[
  ...ADVISOR_SYSTEM,ADVISOR_WORKFLOW,
  ...ADVISOR_SCOPES.map(scope=>scopeInstructions(scopePolicy({scope,focus:'对象与检查点'}))),
  ...Object.values(ADVISOR_PARAMETERS.properties).map(p=>String(p.description||'')),
  JSON.stringify(ADVISOR_PARAMETERS.properties.files),
  JSON.stringify(ADVISOR_PARAMETERS.properties.images),
].join('\n')
test('提示词与参数说明不含某个行业的专用词汇，避免把专项做成定向检查',()=>{
  const hit=DOMAIN_TERMS.exec(promptText)
  assert.equal(hit,null,'提示词里出现了具体行业词汇：'+String(hit&&hit[1]))
})
test('prompt示例覆盖多个不同形态的任务，而不是单一案例',()=>{
  const examples=[ADVISOR_PARAMETERS.properties.focus.description,ADVISOR_WORKFLOW].join('\n')
  assert.ok(/列表|空状态/.test(examples),'给界面/数据类任务的示例')
  assert.ok(/解析|输入/.test(examples),'给逻辑类任务的示例')
  assert.ok(/窗口|裁切|控件/.test(examples),'给布局类任务的示例')
})
test('维度按任务实际需要选择，没有专项时不逼调用方凑维度',()=>{
  assert.ok(scopeInstructions(scopePolicy({scope:'geometry',focus:'x'})).includes('形体'))
  assert.ok(scopeInstructions(scopePolicy({scope:'code',focus:'x'})).includes('实际实现文件'))
  assert.ok(ADVISOR_WORKFLOW.includes('小任务可仅一次'))
  assert.equal(Object.keys(SCOPE_LABELS).length,ADVISOR_SCOPES.length)
})
