import type { ClarificationField, ProjectType } from '@aiproj/types'

export interface AiIntentEvaluationCase {
  id: string
  rawInput: string
  expectedType: ProjectType
  expectedCritical: ClarificationField[]
}

export const AI_INTENT_EVALUATION_CASES: readonly AiIntentEvaluationCase[] = [
  {
    id: 'software-complete-core',
    rawInput:
      '开发面向项目经理使用的 Web 项目管理系统，目标是缩短项目启动时间，包括看板、任务列表和报表，使用 Next.js 和 AdonisJS，2026-08-01 开始，10 人参与，12 周完成。',
    expectedType: 'software',
    expectedCritical: [],
  },
  {
    id: 'event-missing-goal',
    rawInput:
      '举办一场开发者峰会，包括主论坛、三场分论坛、展台和晚宴，6 人参与，2026年10月20日截止。',
    expectedType: 'event',
    expectedCritical: ['projectGoal', 'startDate'],
  },
  {
    id: 'research-missing-goal',
    rawInput: '研究远程办公对团队协作的影响，交付文献综述、问卷数据和分析报告，工期8周。',
    expectedType: 'research',
    expectedCritical: ['projectGoal', 'startDate'],
  },
  {
    id: 'product-missing-user',
    rawInput:
      '推出智能水杯产品，目标是验证饮水提醒需求，包括工业设计、功能原型、用户测试和上市方案。',
    expectedType: 'product',
    expectedCritical: ['targetUser', 'teamSize'],
  },
  {
    id: 'general-low-evidence',
    rawInput: '帮我安排一下这个事情',
    expectedType: 'general',
    expectedCritical: ['projectGoal'],
  },
] as const

export const COMPLETE_INTENT_INPUT =
  '开发面向企业项目经理使用的 Web 系统，目标是把项目启动缩短到十分钟，包括需求澄清、任务拆分和审查面板；2026-08-01 开始，8 人参与，使用 Next.js，采用 Scrum，每周同步，以负责人验收为质量标准，需要 API 集成、隐私合规、现代设计风格、云服务器部署和第三方邮件服务。'
