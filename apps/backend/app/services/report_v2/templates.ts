/**
 * report_v2/templates —— V2 内置模板目录。
 *
 * 每个模板声明模板 ID、中文名称、适用范围、必需/可选数据源、
 * 默认时间范围、支持格式和访问权限。
 * 模板定义由服务端白名单管理，禁止客户端提交任意模板代码。
 */
import type { V2ReportTemplateId, V2ReportExportFormat } from '@aiproj/types'

/** 模板定义 */
export interface ReportTemplateDef {
  templateId: V2ReportTemplateId
  name: string
  description: string
  supportedFormats: V2ReportExportFormat[]
  requiredDataSources: string[]
  optionalDataSources: string[]
  defaultDateRange: 'all' | 'week' | 'month' | 'quarter'
  permission: string
  /** AI 是否参与（仅 AI 周期报表模板为 true） */
  aiEnabled?: boolean
  /** 周期类型（仅 AI 周期报表模板设置） */
  periodType?: 'weekly' | 'monthly'
}

/** 内置模板目录（白名单） */
export const BUILTIN_TEMPLATES: ReportTemplateDef[] = [
  // ── V1 等价模板 ──
  {
    templateId: 'progress',
    name: '进度报告',
    description: '项目总体进展、WBS 分布、关键任务与阻塞项',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary'],
    optionalDataSources: ['schedule_summary'],
    defaultDateRange: 'all',
    permission: 'report:view',
  },
  {
    templateId: 'delay',
    name: '延期报告',
    description: '逾期任务、即将到期任务与依赖警告',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary'],
    optionalDataSources: ['schedule_summary'],
    defaultDateRange: 'all',
    permission: 'report:view',
  },
  {
    templateId: 'workload',
    name: '工作量报告',
    description: '成员负载分布与已完成/进行中/未开始任务统计',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary'],
    optionalDataSources: ['resource_summary'],
    defaultDateRange: 'all',
    permission: 'report:view',
  },
  {
    templateId: 'milestone',
    name: '里程碑报告',
    description: '里程碑完成情况、逾期里程碑与风险提示',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary'],
    optionalDataSources: [],
    defaultDateRange: 'all',
    permission: 'report:view',
  },

  // ── V2 新增模板 ──
  {
    templateId: 'project-weekly',
    name: '项目周报',
    description: '本周任务完成情况、新增风险、近期活动和下周计划',
    supportedFormats: ['markdown', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary', 'schedule_summary'],
    optionalDataSources: [
      'risk_summary',
      'resource_summary',
      'timeline_activity_summary',
      'dashboard_metrics',
      'change_impact_summary',
    ],
    defaultDateRange: 'week',
    permission: 'report:view',
  },
  {
    templateId: 'project-monthly',
    name: '项目月报',
    description: '月度总体进展、里程碑达成、风险与资源摘要、AI 趋势分析',
    supportedFormats: ['markdown', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary', 'schedule_summary', 'dashboard_metrics'],
    optionalDataSources: [
      'risk_summary',
      'resource_summary',
      'timeline_activity_summary',
      'compiler_summary',
      'change_impact_summary',
    ],
    defaultDateRange: 'month',
    permission: 'report:view',
  },
  {
    templateId: 'milestone-tracking',
    name: '里程碑跟踪',
    description: '里程碑状态总览、滞后里程碑和关联任务完成度',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary'],
    optionalDataSources: [],
    defaultDateRange: 'all',
    permission: 'report:view',
  },
  {
    templateId: 'resource-summary',
    name: '资源摘要',
    description: '资源分配、负载和利用率概览',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['resource_summary'],
    optionalDataSources: ['task_summary'],
    defaultDateRange: 'all',
    permission: 'resource:view',
  },
  {
    templateId: 'risk-summary',
    name: '风险摘要',
    description: '风险矩阵、等级分布与缓解状态',
    supportedFormats: ['markdown', 'csv', 'pdf', 'xlsx'],
    requiredDataSources: ['risk_summary'],
    optionalDataSources: ['task_summary'],
    defaultDateRange: 'all',
    permission: 'risk:view',
  },
  {
    templateId: 'health-summary',
    name: '健康摘要',
    description: '项目健康状态、进度、延期、里程碑和风险综合摘要',
    supportedFormats: ['markdown', 'pdf'],
    requiredDataSources: ['dashboard_metrics'],
    optionalDataSources: ['task_summary', 'schedule_summary', 'risk_summary'],
    defaultDateRange: 'all',
    permission: 'report:view',
  },
  {
    templateId: 'stakeholder-briefing',
    name: '干系人简报',
    description: '面向干系人的项目要点汇总，含健康状态、关键里程碑和风险提示',
    supportedFormats: ['markdown', 'pdf'],
    requiredDataSources: ['dashboard_metrics', 'task_summary'],
    optionalDataSources: ['schedule_summary', 'risk_summary', 'milestone_summary'],
    defaultDateRange: 'all',
    permission: 'report:view',
  },

  // ── V2 AI 周期报表模板 ──
  {
    templateId: 'weekly-ai-summary',
    name: 'AI 周报摘要',
    description: 'AI 辅助生成的本周项目进展摘要，含任务完成、风险分析和趋势对比',
    supportedFormats: ['markdown', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary', 'schedule_summary', 'dashboard_metrics'],
    optionalDataSources: [
      'risk_summary',
      'resource_summary',
      'timeline_activity_summary',
      'compiler_summary',
      'change_impact_summary',
    ],
    defaultDateRange: 'week',
    permission: 'report:view',
    aiEnabled: true,
    periodType: 'weekly',
  },
  {
    templateId: 'monthly-ai-summary',
    name: 'AI 月报摘要',
    description: 'AI 辅助生成的月度项目全面分析，含里程碑达成、资源负载和风险评估',
    supportedFormats: ['markdown', 'pdf', 'xlsx'],
    requiredDataSources: ['task_summary', 'schedule_summary', 'dashboard_metrics', 'risk_summary'],
    optionalDataSources: [
      'resource_summary',
      'timeline_activity_summary',
      'compiler_summary',
      'change_impact_summary',
    ],
    defaultDateRange: 'month',
    permission: 'report:view',
    aiEnabled: true,
    periodType: 'monthly',
  },
]

/** 模板 ID → 定义查找 */
export const TEMPLATE_MAP = new Map<V2ReportTemplateId, ReportTemplateDef>(
  BUILTIN_TEMPLATES.map((t) => [t.templateId, t]),
)

/** 白名单校验：返回 true 当且仅当 templateId 是内置模板 */
export function isValidTemplateId(id: string): id is V2ReportTemplateId {
  return TEMPLATE_MAP.has(id as V2ReportTemplateId)
}

/** 获取用户权限范围内可用的模板 */
export function getVisibleTemplates(
  canViewReports: boolean,
  canViewResources: boolean,
  canViewRisks: boolean,
): ReportTemplateDef[] {
  return BUILTIN_TEMPLATES.filter((t) => {
    if (t.permission === 'report:view') return canViewReports
    if (t.permission === 'resource:view') return canViewResources
    if (t.permission === 'risk:view') return canViewRisks
    return canViewReports
  })
}
