import vine from '@vinejs/vine'
import {
  PROJECT_SIGNAL_STATUSES,
  PROJECT_SIGNAL_TIERS,
  PROJECT_SIGNAL_TYPES,
} from '#services/project_signal/signal_contracts'

/**
 * v3-triz-contradiction-copilot W3 任务 3.4 —— 被动雷达信号端点校验器。
 *
 * 只校验形状与闭集（信号类型四类闭集、状态机闭集、分层闭集、分页边界）；
 * 存在性 / 权限 / 组织隔离由 Controller + `ProjectSignalPolicy` + 服务层判定
 * （跨组织统一 404，不泄露存在性）。
 */
const listValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    /** 缺省 `open`；历史查询显式传 `all` 或具体状态（服务层兜底默认值）。 */
    status: vine.enum([...PROJECT_SIGNAL_STATUSES, 'all'] as const).optional(),
    confidenceTier: vine.enum(PROJECT_SIGNAL_TIERS).optional(),
    signalType: vine.enum(PROJECT_SIGNAL_TYPES).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

const dismissValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    signalId: vine.number().positive(),
    /** 忽略原因：只入审计哈希，不落正文（RL-12）。 */
    note: vine.string().trim().maxLength(500).optional().nullable(),
  }),
)

const adoptValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    signalId: vine.number().positive(),
    /** 关联既有分析记录（`triz_copilot_analyses.id`）；缺省表示先标记采纳、后补关联。 */
    analysisId: vine.number().positive().optional().nullable(),
    note: vine.string().trim().maxLength(500).optional().nullable(),
  }),
)

const detectValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    asOfDate: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    windowDays: vine.number().positive().min(7).max(90).optional(),
  }),
)

/**
 * v3-triz-copilot-followups 任务 4.1 —— 组织级信号列表入参校验。
 */
const organizationSignalsValidator = vine.compile(
  vine.object({
    status: vine.enum([...PROJECT_SIGNAL_STATUSES, 'all'] as const).optional(),
    confidenceTier: vine.enum(PROJECT_SIGNAL_TIERS).optional(),
    signalType: vine.enum(PROJECT_SIGNAL_TYPES).optional(),
    signalId: vine.number().positive().withoutDecimals().optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

export {
  listValidator,
  dismissValidator,
  adoptValidator,
  detectValidator,
  organizationSignalsValidator,
}
