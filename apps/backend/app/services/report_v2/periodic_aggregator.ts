/**
 * report_v2/periodic_aggregator —— 周期报表输入聚合器。
 *
 * 基于现有报表数据源 adapter 构建当前周期和上一周期快照，
 * 输出确定性对比摘要和 source hash。
 */
import { createHash } from 'node:crypto'
import { createDefaultRegistry } from './index.js'
import type { DataSourceResultMap } from './data_source_registry.js'
import type {
  ReportDataSourceResult,
  ReportWarningV2,
  PeriodComparison,
  ReportGenerateFilters,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 输入/输出类型
// ---------------------------------------------------------------------------

export interface PeriodicAggregationInput {
  organizationId: number
  projectId: number
  userId: number
  templateId: string
  fromDate: string
  toDate: string
  prevFromDate: string
  prevToDate: string
}

export interface PeriodicAggregationResult {
  currentPeriod: DataSourceResultMap
  previousPeriod: DataSourceResultMap
  comparison: PeriodComparison | null
  sourceHash: string
  warnings: ReportWarningV2[]
  blocking: boolean
  generatedAt: string
}

// ---------------------------------------------------------------------------
// 当前/上一周期数据源 key 集合
// ---------------------------------------------------------------------------

const PERIODIC_SOURCE_KEYS = [
  'task_summary',
  'schedule_summary',
  'dashboard_metrics',
  'risk_summary',
  'resource_summary',
  'timeline_activity_summary',
  'compiler_summary',
  'change_impact_summary',
] as const

// ---------------------------------------------------------------------------
// ReportPeriodicInputAggregator
// ---------------------------------------------------------------------------

export class ReportPeriodicInputAggregator {
  private registry: ReturnType<typeof createDefaultRegistry>

  constructor(registry?: ReturnType<typeof createDefaultRegistry>) {
    this.registry = registry ?? createDefaultRegistry()
  }

  /**
   * 聚合当前周期和上一周期数据，输出确定性摘要。
   */
  async aggregate(input: PeriodicAggregationInput): Promise<PeriodicAggregationResult> {
    const now = new Date().toISOString()

    // 构建当前周期和上一周期的 filters
    const currentFilters: ReportGenerateFilters = {
      fromDate: input.fromDate,
      toDate: input.toDate,
    }
    const prevFilters: ReportGenerateFilters = {
      fromDate: input.prevFromDate,
      toDate: input.prevToDate,
    }

    // 并行聚合两个周期
    const [currentPeriod, previousPeriod] = await Promise.all([
      this.registry.aggregateMany(
        [...PERIODIC_SOURCE_KEYS],
        input.organizationId,
        input.projectId,
        input.userId,
        currentFilters,
      ),
      this.registry.aggregateMany(
        [...PERIODIC_SOURCE_KEYS],
        input.organizationId,
        input.projectId,
        input.userId,
        prevFilters,
      ),
    ])

    // 收集 warnings
    const warnings = this.collectWarnings(currentPeriod, previousPeriod)

    // 检测 blocking warning
    const blocking = this.checkBlocking(currentPeriod)

    // 计算周期对比
    const comparison = this.computeComparison(currentPeriod, previousPeriod)

    // 计算 stable source hash
    const sourceHash = this.computeSourceHash(currentPeriod, previousPeriod)

    return {
      currentPeriod,
      previousPeriod,
      comparison,
      sourceHash,
      warnings,
      blocking,
      generatedAt: now,
    }
  }

  /**
   * 收集当前周期和上一周期的所有 warnings。
   */
  private collectWarnings(
    currentPeriod: DataSourceResultMap,
    previousPeriod: DataSourceResultMap,
  ): ReportWarningV2[] {
    const warnings: ReportWarningV2[] = []

    for (const key of PERIODIC_SOURCE_KEYS) {
      const current = currentPeriod[key]
      const previous = previousPeriod[key]

      if (current?.warnings) {
        warnings.push(...current.warnings)
      }
      if (previous?.warnings) {
        warnings.push(...previous.warnings)
      }
    }

    return warnings
  }

  /**
   * 检查 blocking warning：必需数据源不可用。
   */
  private checkBlocking(currentPeriod: DataSourceResultMap): boolean {
    const requiredKeys = ['task_summary', 'schedule_summary', 'dashboard_metrics']
    for (const key of requiredKeys) {
      const ds = currentPeriod[key]
      if (!ds || ds.status !== 'available') {
        return true
      }
    }
    return false
  }

  /**
   * 计算周期对比。
   * 完全基于结构化数据，输出确定性的对比结果。
   */
  private computeComparison(
    currentPeriod: DataSourceResultMap,
    previousPeriod: DataSourceResultMap,
  ): PeriodComparison {
    // 当前周期统计
    const currentTasks = this.extractTaskStats(currentPeriod['task_summary'])
    const prevTasks = this.extractTaskStats(previousPeriod['task_summary'])

    const currentRisks = this.extractRiskCount(currentPeriod['risk_summary'])
    const prevRisks = this.extractRiskCount(previousPeriod['risk_summary'])

    const currentResources = this.extractResourceCount(currentPeriod['resource_summary'])
    const prevResources = this.extractResourceCount(previousPeriod['resource_summary'])

    const currentChanges = this.extractChangeCount(currentPeriod['change_impact_summary'])
    const prevChanges = this.extractChangeCount(previousPeriod['change_impact_summary'])

    const currentActivity = this.extractActivityCount(currentPeriod['timeline_activity_summary'])
    const prevActivity = this.extractActivityCount(previousPeriod['timeline_activity_summary'])

    return {
      completedDelta: currentTasks.completed - prevTasks.completed,
      overdueDelta: currentTasks.overdue - prevTasks.overdue,
      riskDelta: currentRisks - prevRisks,
      resourceDelta: currentResources - prevResources,
      changeDelta: currentChanges - prevChanges,
      activityDelta: currentActivity - prevActivity,
      currentCompletionRate:
        currentTasks.total > 0
          ? Math.round((currentTasks.completed / currentTasks.total) * 100)
          : 0,
      previousCompletionRate:
        prevTasks.total > 0 ? Math.round((prevTasks.completed / prevTasks.total) * 100) : 0,
    }
  }

  /**
   * 从任务摘要中提取完成和延期数量。
   */
  private extractTaskStats(result?: ReportDataSourceResult): {
    completed: number
    overdue: number
    total: number
  } {
    if (!result || result.status !== 'available' || !result.data) {
      return { completed: 0, overdue: 0, total: 0 }
    }
    const data = result.data as Record<string, unknown>
    const summary = data.summary as Record<string, unknown> | undefined

    return {
      completed: typeof summary?.completedTasks === 'number' ? summary.completedTasks : 0,
      overdue: typeof summary?.overdueTasks === 'number' ? summary.overdueTasks : 0,
      total: typeof summary?.totalTasks === 'number' ? summary.totalTasks : 0,
    }
  }

  /**
   * 从风险摘要中提取风险数量。
   */
  private extractRiskCount(result?: ReportDataSourceResult): number {
    if (!result || result.status !== 'available' || !result.data) {
      return 0
    }
    const data = result.data as Record<string, unknown>
    const risks = data.risks as unknown[] | undefined
    return risks?.length ?? 0
  }

  /**
   * 从资源摘要中提取资源数量。
   */
  private extractResourceCount(result?: ReportDataSourceResult): number {
    if (!result || result.status !== 'available' || !result.data) {
      return 0
    }
    const data = result.data as Record<string, unknown>
    const resources = data.resources as unknown[] | undefined
    return resources?.length ?? 0
  }

  /**
   * 从变更摘要中提取变更数量。
   */
  private extractChangeCount(result?: ReportDataSourceResult): number {
    if (!result || result.status !== 'available' || !result.data) {
      return 0
    }
    const data = result.data as Record<string, unknown>
    const changes = data.changes as unknown[] | undefined
    return changes?.length ?? 0
  }

  /**
   * 从活动摘要中提取活动数量。
   */
  private extractActivityCount(result?: ReportDataSourceResult): number {
    if (!result || result.status !== 'available' || !result.data) {
      return 0
    }
    const data = result.data as Record<string, unknown>
    const activities = data.activities as unknown[] | undefined
    return activities?.length ?? 0
  }

  /**
   * 计算确定性 source hash。
   * 相同输入数据必产生相同 hash。
   */
  private computeSourceHash(
    currentPeriod: DataSourceResultMap,
    previousPeriod: DataSourceResultMap,
  ): string {
    const hash = createHash('sha256')

    for (const key of PERIODIC_SOURCE_KEYS) {
      const current = currentPeriod[key]
      const previous = previousPeriod[key]

      if (current) {
        hash.update(key)
        hash.update(current.status)
        hash.update(current.sourceHash)
        if (current.data) {
          hash.update(JSON.stringify(current.data))
        }
      }
      if (previous) {
        hash.update(`prev:${key}`)
        hash.update(previous.status)
        hash.update(previous.sourceHash)
        if (previous.data) {
          hash.update(JSON.stringify(previous.data))
        }
      }
    }

    return hash.digest('hex').slice(0, 32)
  }
}
