/**
 * RTM 需求追踪矩阵数据适配器（v3-chart-gallery-tier2-governance-matrices W1 · task 1.3）。
 *
 * 职责：
 * 1. 纯函数解析后端 `RtmMatrixResult` 信封；
 * 2. 平铺展开「需求 → 承接任务 → 验收准则」三段追溯链路；
 * 3. 识别 `linkedTasks.length === 0` 的断链需求并标记为中性「待关联任务」；
 * 4. 计算并装配需求总数、任务承接覆盖率（`coveragePercent`）与平均验收通过率指标；
 * 5. 恪守 DOM 中性规范，零惊恐词汇；
 * 6. 处理无需求数据时的空态安全回退。
 */
import type {
  AcceptanceCriterion,
  RtmLinkedTask,
  RtmMatrixEntry,
  RtmMatrixResult,
} from '@/lib/api/requirements'
import { TASK_STATUS_LABELS } from '@/lib/task-status'

export interface RtmLinkedTaskViewModel extends RtmLinkedTask {
  statusLabel: string
}

export interface RtmMatrixRowViewModel {
  requirementId: number
  code: string
  title: string
  category: string
  priority: string
  priorityLabel: string
  status: string
  statusLabel: string
  linkedTasks: RtmLinkedTaskViewModel[]
  isBrokenLink: boolean
  brokenLinkHint: string
  acceptanceCriteria: AcceptanceCriterion[]
  criteriaPassRate: number
  criteriaTotalCount: number
  criteriaPassedCount: number
}

export interface RtmOverviewMetrics {
  totalRequirements: number
  coveredRequirements: number
  brokenRequirements: number
  coveragePercent: number
  avgCriteriaPassRate: number
}

export interface RtmViewModel {
  metrics: RtmOverviewMetrics
  rows: RtmMatrixRowViewModel[]
  isEmpty: boolean
}

export const REQUIREMENT_PRIORITY_LABELS: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
}

export const REQUIREMENT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  under_review: '评审中',
  approved: '已批准',
  in_progress: '开发中',
  completed: '已完成',
  verified: '已验证',
  rejected: '已拒绝',
  deferred: '已延期',
}

export const CRITERIA_STATUS_LABELS: Record<AcceptanceCriterion['status'], string> = {
  pending: '待验证',
  passed: '已通过',
  failed: '未通过',
}

export function formatRequirementPriority(priority: string): string {
  return REQUIREMENT_PRIORITY_LABELS[priority] || priority || '中'
}

export function formatRequirementStatus(status: string): string {
  return REQUIREMENT_STATUS_LABELS[status] || status || '草稿'
}

/**
 * 构建 RTM 视图模型纯函数。
 */
export function buildRtmViewModel(data: RtmMatrixResult | null | undefined): RtmViewModel {
  if (!data || !data.matrix || data.matrix.length === 0) {
    return {
      metrics: {
        totalRequirements: 0,
        coveredRequirements: 0,
        brokenRequirements: 0,
        coveragePercent: 0,
        avgCriteriaPassRate: 0,
      },
      rows: [],
      isEmpty: true,
    }
  }

  let coveredCount = 0
  let brokenCount = 0
  let totalPassRateSum = 0

  const rows: RtmMatrixRowViewModel[] = data.matrix.map((entry: RtmMatrixEntry) => {
    const isBroken = !entry.linkedTasks || entry.linkedTasks.length === 0
    if (isBroken) {
      brokenCount++
    } else {
      coveredCount++
    }

    const tasks: RtmLinkedTaskViewModel[] = (entry.linkedTasks || []).map((t) => ({
      ...t,
      statusLabel: (TASK_STATUS_LABELS as Record<string, string>)[t.status] || t.status,
    }))

    const criteria = entry.acceptanceCriteria || []
    const passedCount = criteria.filter((c) => c.status === 'passed').length
    const passRate =
      typeof entry.criteriaPassRate === 'number'
        ? entry.criteriaPassRate
        : criteria.length > 0
          ? Math.round((passedCount / criteria.length) * 100)
          : 0

    totalPassRateSum += passRate

    return {
      requirementId: entry.requirementId,
      code: entry.code,
      title: entry.title,
      category: entry.category || '功能需求',
      priority: entry.priority,
      priorityLabel: formatRequirementPriority(entry.priority),
      status: entry.status,
      statusLabel: formatRequirementStatus(entry.status),
      linkedTasks: tasks,
      isBrokenLink: isBroken,
      brokenLinkHint: isBroken ? '待关联任务' : '',
      acceptanceCriteria: criteria,
      criteriaPassRate: passRate,
      criteriaTotalCount: criteria.length,
      criteriaPassedCount: passedCount,
    }
  })

  const totalRequirements = rows.length
  const coveragePercent =
    totalRequirements === 0 ? 0 : Math.round((coveredCount / totalRequirements) * 100)
  const avgPassRate = totalRequirements === 0 ? 0 : Math.round(totalPassRateSum / totalRequirements)

  return {
    metrics: {
      totalRequirements,
      coveredRequirements: coveredCount,
      brokenRequirements: brokenCount,
      coveragePercent,
      avgCriteriaPassRate: avgPassRate,
    },
    rows,
    isEmpty: totalRequirements === 0,
  }
}
