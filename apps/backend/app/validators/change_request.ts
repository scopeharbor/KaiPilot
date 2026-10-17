import vine from '@vinejs/vine'

/**
 * 变更请求校验器（simple-change-approval）。
 *
 * 字段级校验；组织/项目归属、权限、状态迁移在 Service / Policy 层。
 */

const changeType = () =>
  vine.enum(['scope', 'schedule', 'cost', 'resource', 'quality', 'risk', 'other'] as const)

const priority = () => vine.enum(['low', 'medium', 'high', 'urgent'] as const)

const changeRequestStatus = () =>
  vine.enum([
    'draft',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'implemented',
    'closed',
    'cancelled',
  ] as const)

/** 创建变更请求（草稿） */
export const createChangeRequestValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    changeType: changeType().optional(),
    priority: priority().optional(),
    impactSummary: vine.any().nullable().optional(),
  }),
)

/** 编辑变更请求（部分更新） */
export const updateChangeRequestValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    changeType: changeType().optional(),
    priority: priority().optional(),
    impactSummary: vine.any().nullable().optional(),
  }),
)

/** 审批决策输入 */
export const decisionValidator = vine.compile(
  vine.object({
    decisionReason: vine.string().trim().maxLength(2000).nullable().optional(),
    conditions: vine.string().trim().maxLength(2000).nullable().optional(),
    // V2 审批时可选引用影响分析快照（v2-change-management-impact-analysis §6.4）
    impactAnalysisId: vine.number().withoutDecimals().positive().nullable().optional(),
    confirmStaleReason: vine.string().trim().maxLength(500).nullable().optional(),
  }),
)

/** 列表筛选参数 */
export const listChangeRequestsValidator = vine.compile(
  vine.object({
    status: changeRequestStatus().optional(),
    changeType: changeType().optional(),
    priority: priority().optional(),
    requesterId: vine.number().withoutDecimals().optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
    startDate: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
)
