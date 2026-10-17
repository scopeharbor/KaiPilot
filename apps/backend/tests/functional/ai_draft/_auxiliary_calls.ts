/**
 * 生成管线的「辅助调用」测试桩：理解层（draft.understanding*）与质量闭环（draft.quality.*）。
 *
 * 五个阶段之外，管线会先梳理项目理解、最后按分支批判与单点修复。多数用例只关心五阶段的行为，
 * 用 withAuxiliary 包住桩：辅助调用返回固定的合法产物（理解一份、批判无意见、修复无补丁），
 * 其余调用原样交给被包住的桩，调用计数与阶段断言保持原意。
 */

import type { DraftRawTextProvider } from '#services/ai_draft/generation_service'

export const AUXILIARY_UNDERSTANDING = {
  problemStatement: '运营人员在多个系统间重复录入审批资料，效率低且易出错。',
  successPicture: '审批资料一次录入、全流程复用，运营处理时长明显下降。',
  currentState: '现有审批依赖邮件与表格，无统一系统。',
  stakeholders: ['运营团队', '审批人'],
  businessFlows: [{ id: 'flow-1', name: '审批申请', steps: ['提交申请', '审批', '归档'] }],
  capabilities: [
    {
      id: 'cap-1',
      name: '审批流转',
      purpose: '让申请在线流转',
      deliverables: ['审批流程配置'],
      dependsOn: [],
    },
  ],
  constraints: [],
  assumptions: [],
  openQuestions: [],
}

export function isAuxiliaryCall(promptName: string | undefined): boolean {
  return (
    promptName?.startsWith('draft.understanding') === true ||
    promptName?.startsWith('draft.quality.') === true
  )
}

export function auxiliaryResponse(promptName: string | undefined): string {
  if (promptName?.startsWith('draft.understanding')) return JSON.stringify(AUXILIARY_UNDERSTANDING)
  if (promptName === 'draft.quality.critic') return JSON.stringify({ findings: [] })
  return JSON.stringify({ ops: [], unresolved: [] })
}

export function withAuxiliary(provider: DraftRawTextProvider): DraftRawTextProvider {
  // 自己应答辅助调用的桩（专测理解层 / 质量闭环的用例）不再包一层。
  if ((provider as { handlesAuxiliary?: boolean }).handlesAuxiliary) return provider
  return async (args) => {
    if (isAuxiliaryCall(args.promptName)) return auxiliaryResponse(args.promptName)
    return provider(args)
  }
}
