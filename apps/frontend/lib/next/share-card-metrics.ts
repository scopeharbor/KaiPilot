/**
 * 1200×630 分享卡度量指标提取纯函数（v3-ui-next-chart-export design §5）。
 *
 * - `extractKanbanMetrics`：从看板四列/全量任务列表派生 5 大核心指标
 *   （任务总数 / 进行中 / 已完成 / 逾期预警 / 完成率），数据严格来源于
 *   TanStack Query 缓存中的权威 Task 实体（RL-04）；
 * - `extractValidationMetrics`：从服务端权威 `DraftValidationReport` 提取
 *   五维能量得分、综合置信度与 Blocking / Warning 违规项统计，严禁前端裁剪。
 *
 * 纯函数、零网络、零副作用；`import type` 仅作类型擦除，运行时零依赖。
 */
import {
  DRAFT_VALIDATION_DIMENSION_WEIGHTS,
  type DraftOverallRiskLevel,
  type DraftValidationDimension,
  type DraftValidationReport,
} from '@aiproj/types'
import type { Task } from '@/lib/api/tasks'

/** 看板四列任务数据源（缺省任意列，未提供时按状态过滤 allTasks 兜底）。 */
export interface KanbanBoardData {
  pendingTasks?: Task[]
  inProgressTasks?: Task[]
  completedTasks?: Task[]
  otherTasks?: Task[]
  allTasks?: Task[]
}

export interface KanbanMetrics {
  totalTasks: number
  inProgressTasks: number
  completedTasks: number
  overdueTasks: number
  progressRate: number
}

/**
 * 看板 5 大核心指标派生（design §5 契约）：
 * - 逾期 = 计划截止日早于今日且未完成的任务（JPG/PNG、SVG 语义一致）；
 * - 完成率 = 已完成 / 总数 × 100 四舍五入。
 */
export function extractKanbanMetrics(boardData: KanbanBoardData): KanbanMetrics {
  const all = boardData.allTasks ?? [
    ...(boardData.pendingTasks ?? []),
    ...(boardData.inProgressTasks ?? []),
    ...(boardData.completedTasks ?? []),
    ...(boardData.otherTasks ?? []),
  ]
  const total = all.length
  const inProgress =
    boardData.inProgressTasks?.length ?? all.filter((t) => t.status === 'in_progress').length
  const completed =
    boardData.completedTasks?.length ?? all.filter((t) => t.status === 'completed').length
  const todayStr = new Date().toISOString().slice(0, 10)
  const overdue = all.filter(
    (t) => t.status !== 'completed' && Boolean(t.endDate) && (t.endDate as string) < todayStr,
  ).length
  const progressRate = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    totalTasks: total,
    inProgressTasks: inProgress,
    completedTasks: completed,
    overdueTasks: overdue,
    progressRate,
  }
}

export interface ValidationMetrics {
  /** 综合置信度（0-100，四舍五入）。 */
  confidenceScore: number
  overallRiskLevel: DraftOverallRiskLevel
  /** 五维分项得分（0-100，原始值）。 */
  dimensionScores: Record<DraftValidationDimension, number>
  /** 五维加权系数（事实 0.30 / 逻辑 0.25 / 假设 0.20 / 完整 0.10 / 数值 0.15）。 */
  dimensionWeights: Readonly<Record<DraftValidationDimension, number>>
  blockingCount: number
  warningCount: number
  infoCount: number
  /** 违规规则编号（按报告顺序）。 */
  blockingRuleIds: string[]
  warningRuleIds: string[]
}

/** 反幻觉自检报告度量映射：权威五维得分、置信度与 Blocking/Warning 违规计数。 */
export function extractValidationMetrics(validation: DraftValidationReport): ValidationMetrics {
  return {
    confidenceScore: Math.round(validation.confidenceScore),
    overallRiskLevel: validation.overallRiskLevel,
    dimensionScores: validation.dimensionScores,
    dimensionWeights: DRAFT_VALIDATION_DIMENSION_WEIGHTS,
    blockingCount: validation.blocking.length,
    warningCount: validation.warning.length,
    infoCount: validation.info.length,
    blockingRuleIds: validation.blocking.map((issue) => issue.ruleId),
    warningRuleIds: validation.warning.map((issue) => issue.ruleId),
  }
}
