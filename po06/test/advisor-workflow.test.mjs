import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADVISOR_PARAMETERS, ADVISOR_TIMEOUT_MS, ADVISOR_TIMEOUT_MIN_MS, ADVISOR_TIMEOUT_MAX_MS, resolveAdvisorTimeoutMs, ADVISOR_SYSTEM } from '../lib/advisor.js'
import { ADVISOR_WORKFLOW, withAdvisorWorkflow } from '../lib/advisor-workflow.js'

test('工作模型的协议给出风险阶段实际调用、失败诊断与PTC示例，不扩大用户授权',()=>{
  assert.ok(ADVISOR_WORKFLOW.includes('按风险阶段实际调用'))
  assert.ok(!ADVISOR_WORKFLOW.includes('必须实际调用一次'))
  assert.ok(ADVISOR_WORKFLOW.includes('mode="review_result"'))
  assert.ok(ADVISOR_WORKFLOW.includes('mode="diagnose_failure"'))
  assert.ok(ADVISOR_WORKFLOW.includes('await tools.consult_task'))
  assert.ok(ADVISOR_WORKFLOW.includes('不读取其它文件'))
  assert.ok(ADVISOR_WORKFLOW.includes('不为了凑次数调用'))
  assert.ok(ADVISOR_WORKFLOW.includes('360000'), '外层预算要按新的限时给（5 分钟 + 60 秒）')
  assert.ok(ADVISOR_WORKFLOW.includes('DSH_PO06_ADVISOR_TIMEOUT_MS'), '要告诉模型限时可调')
})
test('专项范围指向具体对象与检查点，delivery 只列任务所需维度',()=>{
  assert.ok(ADVISOR_WORKFLOW.includes('general（兼容旧调用默认）/geometry/appearance/code/interaction/performance/delivery/custom'))
  assert.ok(ADVISOR_WORKFLOW.includes('focus 指明具体对象+检查点'))
  assert.ok(ADVISOR_WORKFLOW.includes('requiredScopes 是数组，仅用于 delivery 所需专项列表'))
  assert.ok(ADVISOR_WORKFLOW.includes('不强制所有枚举'))
  assert.ok(ADVISOR_WORKFLOW.includes('scope: "code", focus:'))
})
test('几何与外观先独立看图，有疑点再同 focus 追源码，不强制新截图',()=>{
  assert.ok(ADVISOR_WORKFLOW.includes('geometry/appearance 先图片独立审'))
  assert.ok(ADVISOR_WORKFLOW.includes('不混代码或“全过”历史'))
  assert.ok(ADVISOR_WORKFLOW.includes('有疑点再调用 scope="code"，以同一 focus 追源码'))
  assert.ok(ADVISOR_WORKFLOW.includes('不强制启动新截图'))
  assert.ok(ADVISOR_WORKFLOW.includes('没有可用图片或没有图像能力则相关项标未验证'))
  assert.ok(ADVISOR_WORKFLOW.includes('交互/帧率不能只靠截图证明'))
})
test('风险节点而非次数触发审查，小任务仅 general 仍可交付',()=>{
  for (const trigger of ['高风险阶段成形', '返工成本将升', '用户反馈指出偏差', '关键改动']) {
    assert.ok(ADVISOR_WORKFLOW.includes(trigger), trigger)
  }
  assert.ok(ADVISOR_WORKFLOW.includes('不固定堆次数'))
  assert.ok(ADVISOR_WORKFLOW.includes('小任务可仅一次 scope="general"，不另凑 delivery'))
})
test('交付核对本轮覆盖与版本，局部通过不冒充整体通过',()=>{
  assert.ok(ADVISOR_WORKFLOW.includes('核对本轮覆盖、未解决项、版本变更，不从头全量验收'))
  assert.ok(ADVISOR_WORKFLOW.includes('局部 pass 不是整体 pass'))
  assert.ok(ADVISOR_WORKFLOW.includes('本轮ID/材料指纹自动记录'))
  assert.ok(ADVISOR_WORKFLOW.includes('材料版本变化重审相关项，保留无关项覆盖'))
  assert.ok(ADVISOR_WORKFLOW.includes('不把旧版本 pass 直接用于新材料'))
  assert.ok(ADVISOR_WORKFLOW.includes('缺失、未验证或未解决项必须明确保留'))
})
test('权限与证据边界和预算保留，不以文案冒充调用记录',()=>{
  for (const boundary of ['不准扩大任务、权限或联网范围', '只带已存在的本次成果与用户允许的材料', '不为凑材料额外联网或启动重型截图任务', '文件截断部分不得算完整验收', '与files合计最多4份；images最多4张', '外层 timeoutMs 至少比它多 60 秒', '没有调用记录时，不得声称“顾问已验收”']) {
    assert.ok(ADVISOR_WORKFLOW.includes(boundary), boundary)
  }
})
test('开启时无意图包也保留协议；关闭时不添加协议',()=>{
  assert.equal(withAdvisorWorkflow('',{injectPacket:true}),ADVISOR_WORKFLOW)
  assert.ok(withAdvisorWorkflow('原包',{injectPacket:true}).endsWith('原包'))
  assert.equal(withAdvisorWorkflow('',{injectPacket:false}),'')
  assert.equal(withAdvisorWorkflow('原包',{injectPacket:false}),'原包')
  assert.equal(withAdvisorWorkflow('原包',undefined),'原包')
  assert.equal(withAdvisorWorkflow('原包',{injectPacket:1}),'原包')
})
test('顾问限时：默认 5 分钟；环境变量可调并钳制；报告长度设上限',()=>{
  assert.equal(ADVISOR_TIMEOUT_MS, 300000, '默认 5 分钟（150s 真机超时过，太短）')
  assert.equal(resolveAdvisorTimeoutMs({}), ADVISOR_TIMEOUT_MS, '没设环境变量就用默认')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '600000' }), 600000, '合法值原样采纳')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '1' }), ADVISOR_TIMEOUT_MIN_MS, '过小钳到下限')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '99999999' }), ADVISOR_TIMEOUT_MAX_MS, '过大钳到上限')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: 'abc' }), ADVISOR_TIMEOUT_MS, '非法值回落默认，不静默变 0')
  assert.equal(resolveAdvisorTimeoutMs({ DSH_PO06_ADVISOR_TIMEOUT_MS: '-5' }), ADVISOR_TIMEOUT_MS, '负数也是非法值')
  // 长输出是超时主因之一：提示词里必须有长度纪律，否则放宽限时只是把超时往后推
  assert.ok(/findings 最多 6 条/.test(ADVISOR_SYSTEM))
  assert.ok(/checks 最多 8 条/.test(ADVISOR_SYSTEM))
})

test('顾问schema不含宿主已确认不支持的maxItems，必填字段和模式保留',()=>{
  // The host renderer was directly checked during diagnosis: maxItems => unknown.
  // Keep this test portable; a standalone node test is not a running DSH host.

  assert.equal(ADVISOR_PARAMETERS.properties.artifacts.maxItems,undefined)
  assert.deepEqual(ADVISOR_PARAMETERS.required,['mode','question'])
  assert.deepEqual(ADVISOR_PARAMETERS.properties.mode.enum,['diagnose_failure','review_result'])
})
