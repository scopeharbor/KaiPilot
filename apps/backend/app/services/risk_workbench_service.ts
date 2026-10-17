import Risk from '#models/risk'
import RiskResponsePlan from '#models/risk_response_plan'
import RiskHistory from '#models/risk_history'
import { DateTime } from 'luxon'

export interface RiskWorkbenchSummary {
  totalRisks: number
  openRisks: number
  highRiskCount: number
  criticalRiskCount: number
  overdueReviewCount: number
  incompleteResponsePlans: number
  trend30d: { created: number; closed: number }
  healthScore: number | null
  topRisks: Array<{
    id: number
    title: string
    riskLevel: string
    score: number
    status: string
  }>
}

export interface RiskTrendPoint {
  date: string
  created: number
  closed: number
  totalOpen: number
}

export interface RiskReviewItem {
  id: number
  title: string
  riskLevel: string
  score: number
  nextReviewAt: string | null
  lastReviewAt: string | null
  ownerId: number | null
}

/**
 * RiskWorkbenchService — 风险工作台统一数据出口。
 *
 * 输出风险摘要、Top 风险、复查逾期、应对执行率、趋势和矩阵聚合。
 * 所有查询带组织隔离。
 */
export default class RiskWorkbenchService {
  /**
   * 项目风险工作台摘要。
   */
  async getSummary(organizationId: number, projectId: number): Promise<RiskWorkbenchSummary> {
    const risks = await Risk.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .select('id', 'title', 'risk_level', 'score', 'status', 'next_review_at')

    const totalRisks = risks.length
    const openStatuses = ['identified', 'analyzing', 'mitigating']
    const openRisks = risks.filter((r) => openStatuses.includes(r.status))
    const highRiskCount = risks.filter((r) => r.riskLevel === 'high').length
    const criticalRiskCount = risks.filter((r) => r.riskLevel === 'critical').length

    const now = new Date().toISOString().slice(0, 10)
    const overdueReviewCount = risks.filter((r) => {
      if (!r.nextReviewAt) return false
      const nextReviewDate = r.nextReviewAt.toISODate()
      if (!nextReviewDate) return false
      return nextReviewDate < now && openStatuses.includes(r.status)
    }).length

    // 未完成应对计划
    const incompleteCount = await RiskResponsePlan.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotIn('status', ['completed', 'cancelled'])
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    // 近 30 天趋势
    const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toISO()!
    const createdCount = await RiskHistory.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('event_type', 'created')
      .where('occurred_at', '>=', thirtyDaysAgo)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    const closedCount = await RiskHistory.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('event_type', ['closed'])
      .where('occurred_at', '>=', thirtyDaysAgo)
      .count('* as total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    // Top 风险（按 score 排序）
    const topRisks = risks
      .filter((r) => ['high', 'critical'].includes(r.riskLevel))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        title: r.title,
        riskLevel: r.riskLevel,
        score: r.score,
        status: r.status,
      }))

    return {
      totalRisks,
      openRisks: openRisks.length,
      highRiskCount,
      criticalRiskCount,
      overdueReviewCount,
      incompleteResponsePlans: incompleteCount,
      trend30d: { created: createdCount, closed: closedCount },
      healthScore: this.computeHealthScore(
        openRisks.length,
        totalRisks,
        highRiskCount + criticalRiskCount,
      ),
      topRisks,
    }
  }

  /**
   * 风险健康分（0-100）：开放风险少、高风险少、复查不积压 = 健康。
   */
  private computeHealthScore(
    openCount: number,
    totalCount: number,
    highCriticalCount: number,
  ): number | null {
    if (totalCount === 0) return null
    const openRatio = openCount / totalCount
    const highRatio = highCriticalCount / Math.max(openCount, 1)
    const score = Math.round(100 * (1 - 0.4 * openRatio - 0.6 * highRatio))
    return Math.max(0, Math.min(100, score))
  }

  /**
   * 风险复查队列：按 next_review_at 升序排列。
   */
  async getReviewQueue(organizationId: number, projectId: number): Promise<RiskReviewItem[]> {
    const risks = await Risk.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereIn('status', ['identified', 'analyzing', 'mitigating'])
      .orderBy('next_review_at', 'asc')
      .select('id', 'title', 'risk_level', 'score', 'next_review_at', 'last_review_at', 'owner_id')

    return risks.map((r) => ({
      id: r.id,
      title: r.title,
      riskLevel: r.riskLevel,
      score: r.score,
      nextReviewAt: r.nextReviewAt?.toISO() ?? null,
      lastReviewAt: r.lastReviewAt?.toISO() ?? null,
      ownerId: r.ownerId,
    }))
  }

  /**
   * 风险趋势数据：近 N 天的逐日统计。
   */
  async getTrend(organizationId: number, projectId: number, days = 30): Promise<RiskTrendPoint[]> {
    const startDate = DateTime.now().minus({ days }).startOf('day')

    const histories = await RiskHistory.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('occurred_at', '>=', startDate.toSQL()!)
      .whereIn('event_type', ['created', 'closed'])
      .orderBy('occurred_at', 'asc')

    // 构建逐日统计
    const dateMap = new Map<string, { created: number; closed: number }>()
    for (let i = 0; i <= days; i++) {
      const d = startDate.plus({ days: i }).toISODate()!
      dateMap.set(d, { created: 0, closed: 0 })
    }

    for (const h of histories) {
      const d = h.occurredAt.toISODate()!
      const entry = dateMap.get(d)
      if (entry) {
        if (h.eventType === 'created') entry.created++
        else if (h.eventType === 'closed') entry.closed++
      }
    }

    // 计算累计开放数
    let runningTotal = 0
    const points: RiskTrendPoint[] = []
    for (const [date, counts] of dateMap) {
      if (runningTotal === 0) {
        // 初始值：从 histories 之前就已存在的风险数
        const beforeCount = await Risk.query()
          .where('organization_id', organizationId)
          .where('project_id', projectId)
          .whereNull('deleted_at')
          .where('created_at', '<', startDate.toSQL()!)
          .count('* as total')
          .then((r) => Number(r[0]?.$extras?.total ?? 0))
        runningTotal = beforeCount
      }
      runningTotal = runningTotal + counts.created - counts.closed
      points.push({ date, ...counts, totalOpen: Math.max(0, runningTotal) })
    }

    return points
  }
}
