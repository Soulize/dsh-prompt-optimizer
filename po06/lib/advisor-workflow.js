// Working-model workflow, not an instruction to the optimizer or advisor itself.
export const ADVISOR_WORKFLOW = [
  '【顾问调用协议 · 插件工作流程，不是用户新增要求】',
  'consult_task 是独立只读顾问，已可调用。自验不能替代独立复核。',
  '编写、修改或交付程序/文件时，先取得原始证据并自验，再按风险阶段实际调用 consult_task，mode="review_result"：高风险阶段成形、返工成本将升、用户反馈指出偏差或关键改动时，复核相关对象与检查点。不固定堆次数；小任务可仅一次 scope="general"，不另凑 delivery。',
  '用户只要求解释、讨论、翻译或寒暄时，不为了凑次数调用。普通小测试也不重复咨询。',
  '同一路线反复失败，且下一次尝试没有新的假设或信息增量时，继续重试或延长超时之前调用 mode="diagnose_failure"。',
  '不得把自己的验收结论、软件桩通过或用户尚未手测，当作“已经咨询”。咨询异常或未验证时如实交代，不宣称独立验收通过，也不无限重试。',
  '参数：mode/question必填；scope 枚举 general（兼容旧调用默认）/geometry/appearance/code/interaction/performance/delivery/custom；focus 指明具体对象+检查点，不能只写“整体检查”。requiredScopes 是数组，仅用于 delivery 所需专项列表；实际涉及维度由任务决定，不强制所有枚举。hypothesis仅诊断可选；files:[{path,purpose}]工程文本与日志；images:[{path,purpose}]真实效果截图。路径相对本会话工作目录，purpose说明要检查什么。旧artifacts字符串数组仍兼容，与files合计最多4份；images最多4张。',
  'geometry/appearance 先图片独立审：以真实图片和具体 focus 检查几何/外观，不混代码或“全过”历史，避免源码意图与旧结论影响观察；有疑点再调用 scope="code"，以同一 focus 追源码。已有图片足以检查时复用，不强制启动新截图；没有可用图片或没有图像能力则相关项标未验证。',
  '选材规则：scope="code" 带本次成果、关键改动源码与原始测试日志；geometry/appearance 带已有默认画面或相关近景，注明视角、检查点，不为凑材料要求每次同时提供两者。交互/帧率不能只靠截图证明，需相应操作记录、测试或性能原始证据。失败诊断带最小相关源码、错误原文和已尝试变更，不把整个工程全塞进去。',
  '交付前需要汇总专项时调用 scope="delivery"，focus 指明本次交付对象与核对点，requiredScopes 只列本任务所需专项；核对本轮覆盖、未解决项、版本变更，不从头全量验收。局部 pass 不是整体 pass；缺失、未验证或未解决项必须明确保留，不能用某一专项通过替代整体结论。',
  '本轮ID/材料指纹自动记录，用来绑定本轮审查记录与材料版本；材料版本变化重审相关项，保留无关项覆盖，不把旧版本 pass 直接用于新材料。delivery 对照本轮记录核对版本与覆盖，不依据“全过”历史推定通过。',
  '顾问沿用优化AI模型；没有明确图像能力时图片会标未检查，不能声称看过。文件截断部分不得算完整验收。只带已存在的本次成果与用户允许的材料，不绕过不读其它文件等限制；不为凑材料额外联网或启动重型截图任务。',
  '遵守用户不读取其它文件等限制，只审本次产物和允许的证据。不准扩大任务、权限或联网范围。',
  'PTC 模式必须在 run_code 内调用；在工具描述里看见名字不等于它已运行。示例：',
  'const review = await tools.consult_task({ mode: "review_result", scope: "code", focus: "本次表单提交：校验、失败状态与回归测试", question: "检查该对象与检查点，缺证据的项标为未验证", files: [{ path: "本次成果.html", purpose: "核对表单提交实现与原始测试证据" }] });',
  'console.log(review);',
  'delivery 用 requiredReviews:[{scope,focus}] 精确列出必须覆盖的对象和检查点，focus沿用已完成专项的同一描述；requiredScopes只是类别提示，没有具体对象清单不能判类别全部通过。',
  '如果已有真实截图，可额外传 images: [{ path: "evidence/default.png", purpose: "默认机位构图与曝光" }]；没有截图就省略，不传虚构路径，不为了调用顾问强行生成截图。',
  '用 run_code 调用时留够工具预算：顾问最长约5分钟（可用 DSH_PO06_ADVISOR_TIMEOUT_MS 调整），外层 timeoutMs 至少比它多 60 秒，默认建议 360000。',
  '工具返回后逐项处理缺口；真实GPU画面与手感仍交用户测试。没有调用记录时，不得声称“顾问已验收”。',
].join('\n')

export function withAdvisorWorkflow(packet, policy) {
  const text = String(packet || '')
  if (policy?.injectPacket !== true) return text
  return ADVISOR_WORKFLOW + (text ? '\n\n' + text : '')
}
