import type { ClarificationField, ParsedIntent } from '@aiproj/types'

export const QUESTION_PACK_VERSION = '1.0' as const

export interface QuestionPackDefinition {
  id: string
  fields: readonly ClarificationField[]
  evidenceLabel: string
  matches: (rawInput: string, parsedIntent: ParsedIntent) => boolean
}

const SECURITY_PATTERN = /安全|资安|权限|审计|敏感|隐私|身份|支付|医疗|金融|等保|gdpr/iu
const PERFORMANCE_PATTERN = /性能|并发|延迟|吞吐|峰值|sla|slo|实时|高可用|容灾/iu
const COMPLIANCE_PATTERN = /合规|法规|监管|个资|个人信息|等保|gdpr|审计留痕/iu
const INTEGRATION_PATTERN = /集成|对接|接口|api|旧系统|既有系统|迁移|导入|历史数据/iu
const ROLLOUT_PATTERN = /上线|推广|试点|灰度|培训|切换|采用率|跨团队|全员/iu
const HOSTING_PATTERN = /部署|托管|云服务器|自有服务器|serverless|私有化|内网/iu
const DESIGN_PATTERN = /设计风格|视觉|交互|品牌|界面体验/iu
const ENGINEERING_PATTERN = /技术栈|前端|后端|数据库|框架|架构|移动端|web|app/iu

export const QUESTION_PACKS: readonly QuestionPackDefinition[] = [
  {
    id: `security@${QUESTION_PACK_VERSION}`,
    fields: ['securityControls', 'compliance'],
    evidenceLabel: '输入包含安全、权限或敏感业务证据',
    matches: (rawInput) => SECURITY_PATTERN.test(rawInput),
  },
  {
    id: `performance@${QUESTION_PACK_VERSION}`,
    fields: ['performanceTarget', 'qualityStandard'],
    evidenceLabel: '输入包含性能、服务级别或实时性证据',
    matches: (rawInput) => PERFORMANCE_PATTERN.test(rawInput),
  },
  {
    id: `compliance@${QUESTION_PACK_VERSION}`,
    fields: ['compliance'],
    evidenceLabel: '输入包含法规、隐私或监管证据',
    matches: (rawInput) => COMPLIANCE_PATTERN.test(rawInput),
  },
  {
    id: `integration-migration@${QUESTION_PACK_VERSION}`,
    fields: ['integration', 'migrationScope', 'thirdPartyServices'],
    evidenceLabel: '输入包含既有系统、接口或数据迁移证据',
    matches: (rawInput) => INTEGRATION_PATTERN.test(rawInput),
  },
  {
    id: `rollout-change@${QUESTION_PACK_VERSION}`,
    fields: ['rolloutStrategy', 'communicationFreq'],
    evidenceLabel: '输入包含上线、推广、试点或组织变更证据',
    matches: (rawInput) => ROLLOUT_PATTERN.test(rawInput),
  },
  {
    id: `hosting@${QUESTION_PACK_VERSION}`,
    fields: ['hosting'],
    evidenceLabel: '输入包含部署或运行环境证据',
    matches: (rawInput) => HOSTING_PATTERN.test(rawInput),
  },
  {
    id: `experience@${QUESTION_PACK_VERSION}`,
    fields: ['designPreference'],
    evidenceLabel: '输入包含视觉或交互体验证据',
    matches: (rawInput) => DESIGN_PATTERN.test(rawInput),
  },
  {
    id: `engineering-constraints@${QUESTION_PACK_VERSION}`,
    fields: ['techStack', 'methodology'],
    evidenceLabel: '输入包含工程实现或技术约束证据',
    matches: (rawInput, parsedIntent) =>
      parsedIntent.projectType === 'software' && ENGINEERING_PATTERN.test(rawInput),
  },
]

export interface SelectedQuestionPack {
  id: string
  fields: readonly ClarificationField[]
  evidence: string
}

export function selectQuestionPacks(
  rawInput: string,
  parsedIntent: ParsedIntent,
): SelectedQuestionPack[] {
  return QUESTION_PACKS.filter((pack) => pack.matches(rawInput, parsedIntent)).map((pack) => ({
    id: pack.id,
    fields: pack.fields,
    evidence: pack.evidenceLabel,
  }))
}
