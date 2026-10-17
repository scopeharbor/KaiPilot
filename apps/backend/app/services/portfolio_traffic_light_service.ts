/**
 * v3-pmo-portfolio-traffic-light —— PortfolioTrafficLightService（D1）。
 *
 * 组织级 PMO 组合交通灯聚合服务。消费既有项目级 Dashboard、健康诊断、
 * 预测、风险、资源、任务、里程碑、变更影响等信号，输出确定性红/黄/绿/灰
 * 交通灯摘要。不调用 AI、不启动 Compiler、不修改项目事实。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import PortfolioTrafficLightReviewMarker from '#models/portfolio_traffic_light_review_marker'
import db from '@adonisjs/lucid/services/db'
import type {
  TrafficLightScoringInput,
  TrafficLightSeverity,
  PortfolioTrafficLightItem,
  PortfolioTrafficLightListQuery,
  PortfolioTrafficLightCounts,
  TrafficLightReviewState,
  TrafficLightReviewStateSummary,
  TrafficLightSourceType,
} from '@aiproj/types'
import {
  scoreTrafficLight,
  TRAFFIC_LIGHT_RULE_VERSION,
  PORTFOLIO_TRAFFIC_LIGHT_MAX_PER_PAGE,
  PORTFOLIO_TRAFFIC_LIGHT_DEFAULT_PER_PAGE,
  PORTFOLIO_TRAFFIC_LIGHT_STALE_THRESHOLD_MINUTES,
} from '@aiproj/types'

const STALE_MS = PORTFOLIO_TRAFFIC_LIGHT_STALE_THRESHOLD_MINUTES * 60 * 1000

@inject()
export default class PortfolioTrafficLightService {
  /**
   * 获取用户可见项目的交通灯列表。
   * 只返回该用户有 portfolio:view 权限且该组织下能看到的项目。
   */
  async list(
    user: User,
    organizationId: number,
    query: PortfolioTrafficLightListQuery = {},
  ): Promise<{
    data: PortfolioTrafficLightItem[]
    meta: { page: number; perPage: number; total: number; totalPages: number; calculatedAt: string }
  }> {
    const perPage = Math.min(
      query.perPage ?? PORTFOLIO_TRAFFIC_LIGHT_DEFAULT_PER_PAGE,
      PORTFOLIO_TRAFFIC_LIGHT_MAX_PER_PAGE,
    )
    const page = Math.max(query.page ?? 1, 1)

    // 获取用户可见的项目 ID 列表
    const visibleProjectIds = await this.getVisibleProjectIds(user, organizationId)
    if (visibleProjectIds.length === 0) {
      return {
        data: [],
        meta: { page, perPage, total: 0, totalPages: 0, calculatedAt: new Date().toISOString() },
      }
    }

    // 批量加载项目信号
    const projects = await Project.query()
      .whereIn('id', visibleProjectIds)
      .where('organizationId', organizationId)
      .preload('members')
    const now = new Date().toISOString()

    // 构建每个项目的交通灯摘要
    const items: PortfolioTrafficLightItem[] = []
    for (const project of projects) {
      const item = await this.buildTrafficLightItem(user, organizationId, project, now)
      items.push(item)
    }

    // 排序
    this.sortItems(items, query.sort ?? 'traffic_light', query.order ?? 'desc')
    if (query.filterStatus) {
      const filters = Array.isArray(query.filterStatus) ? query.filterStatus : [query.filterStatus]
      const filtered = items.filter((i) => filters.includes(i.trafficLight))
      const totalFiltered = filtered.length
      const totalPages = Math.ceil(totalFiltered / perPage)
      const start = (page - 1) * perPage
      return {
        data: filtered.slice(start, start + perPage),
        meta: { page, perPage, total: totalFiltered, totalPages, calculatedAt: now },
      }
    }

    const total = items.length
    const totalPages = Math.ceil(total / perPage)
    const start = (page - 1) * perPage
    return {
      data: items.slice(start, start + perPage),
      meta: { page, perPage, total, totalPages, calculatedAt: now },
    }
  }

  /**
   * 获取交通灯计数摘要。
   */
  async counts(user: User, organizationId: number): Promise<PortfolioTrafficLightCounts> {
    const result = await this.list(user, organizationId, {
      perPage: PORTFOLIO_TRAFFIC_LIGHT_MAX_PER_PAGE,
    })
    const counts: PortfolioTrafficLightCounts = {
      red: 0,
      yellow: 0,
      green: 0,
      gray: 0,
      total: result.meta.total,
      calculatedAt: new Date().toISOString(),
    }
    for (const item of result.data) {
      counts[item.trafficLight]++
    }
    return counts
  }

  /**
   * 获取单个项目的交通灯详情。
   */
  async detail(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<PortfolioTrafficLightItem | null> {
    const visibleProjectIds = await this.getVisibleProjectIds(user, organizationId)
    if (!visibleProjectIds.includes(projectId)) return null

    const project = await Project.query()
      .where('id', projectId)
      .where('organizationId', organizationId)
      .preload('members')
      .first()
    if (!project) return null

    return this.buildTrafficLightItem(user, organizationId, project, new Date().toISOString())
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────────

  private async getVisibleProjectIds(user: User, organizationId: number): Promise<number[]> {
    const membershipRows = await ProjectMember.query()
      .where('user_id', user.id)
      .select('project_id')
    const memberProjectIds = membershipRows.map((r) => Number(r.projectId))

    // 组织管理员可见所有项目
    const isOrgAdmin = user.organizationMembers?.some(
      (m) => m.organizationId === organizationId && ['owner', 'admin'].includes(m.role),
    )
    if (isOrgAdmin) {
      const allProjects = await Project.query()
        .where('organization_id', organizationId)
        .select('id')
      return allProjects.map((p) => Number(p.id))
    }

    // 一般用户只可见自己是成员的项目
    return memberProjectIds
  }

  private async buildTrafficLightItem(
    _user: User,
    organizationId: number,
    project: Project,
    now: string,
  ): Promise<PortfolioTrafficLightItem> {
    const projectId = project.id

    // 聚合各来源信号
    const [healthDiag, prediction, risks, resources, tasks, milestones, changes] =
      await Promise.all([
        this.getHealthSignal(projectId),
        this.getPredictionSignal(projectId),
        this.getRiskSignal(projectId),
        this.getResourceSignal(projectId),
        this.getTaskSignal(projectId),
        this.getMilestoneSignal(projectId),
        this.getChangeSignal(projectId),
      ])

    const sources: Array<{
      type: TrafficLightSourceType
      available: boolean
      forbidden: boolean
      stale: boolean
      updatedAt: string | null
    }> = [
      {
        type: 'health_diagnosis',
        available: healthDiag.available,
        forbidden: healthDiag.forbidden,
        stale: this.isStale(healthDiag.updatedAt),
        updatedAt: healthDiag.updatedAt,
      },
      {
        type: 'prediction',
        available: prediction.available,
        forbidden: prediction.forbidden,
        stale: this.isStale(prediction.updatedAt),
        updatedAt: prediction.updatedAt,
      },
      {
        type: 'risk',
        available: risks.available,
        forbidden: risks.forbidden,
        stale: this.isStale(risks.updatedAt),
        updatedAt: risks.updatedAt,
      },
      {
        type: 'resource',
        available: resources.available,
        forbidden: resources.forbidden,
        stale: this.isStale(resources.updatedAt),
        updatedAt: resources.updatedAt,
      },
      {
        type: 'task',
        available: tasks.available,
        forbidden: tasks.forbidden,
        stale: this.isStale(tasks.updatedAt),
        updatedAt: tasks.updatedAt,
      },
      {
        type: 'milestone',
        available: milestones.available,
        forbidden: milestones.forbidden,
        stale: this.isStale(milestones.updatedAt),
        updatedAt: milestones.updatedAt,
      },
      {
        type: 'change_impact',
        available: changes.available,
        forbidden: changes.forbidden,
        stale: this.isStale(changes.updatedAt),
        updatedAt: changes.updatedAt,
      },
    ]

    const input: TrafficLightScoringInput = {
      healthDiagnosis: healthDiag,
      prediction,
      risk: risks,
      resource: resources,
      task: tasks,
      milestone: milestones,
      changeImpact: changes,
      sources,
    }

    const scoringResult = scoreTrafficLight(input)

    // 获取复核标记
    const reviewState = await this.getReviewState(organizationId, projectId)

    const overallStale = sources.some((s) => s.stale && s.available)
    const staleSources = sources.filter((s) => s.stale && s.available).map((s) => s.type)

    return {
      projectId,
      projectName: project.name,
      projectStatus: project.status ?? 'active',
      trafficLight: scoringResult.status,
      severityCounts: scoringResult.severities,
      sourceFreshness: {
        overallStale,
        staleSources,
        lastUpdatedAt: sources.reduce(
          (latest, s) => {
            if (!s.updatedAt) return latest
            if (!latest) return s.updatedAt
            return s.updatedAt > latest ? s.updatedAt : latest
          },
          null as string | null,
        ),
      },
      evidence: scoringResult.evidence,
      warnings: scoringResult.warnings,
      reviewState,
      ruleVersion: TRAFFIC_LIGHT_RULE_VERSION,
      calculatedAt: now,
      allowedActions: {
        canReview: true, // 由 Policy 最终判定
        canViewDetail: true,
      },
    }
  }

  // ─── Signal Gatherers ───────────────────────────────────────────────────────────

  private async getHealthSignal(projectId: number) {
    try {
      const diag = await ProjectHealthDiagnosis.query()
        .where('projectId', projectId)
        .whereIn('status', ['confirmed', 'pending', 'ai_ready'])
        .orderBy('createdAt', 'desc')
        .first()
      if (!diag)
        return {
          available: false,
          forbidden: false,
          overallLabel: null,
          overallScore: null,
          updatedAt: null,
        }
      return {
        available: true,
        forbidden: false,
        overallLabel: diag.summary?.overallLabel ?? null,
        overallScore: diag.summary?.overallScore ?? null,
        updatedAt: diag.createdAt?.toISO() ?? null,
      }
    } catch {
      return {
        available: false,
        forbidden: false,
        overallLabel: null,
        overallScore: null,
        updatedAt: null,
      }
    }
  }

  private async getPredictionSignal(projectId: number) {
    try {
      const pred = await ProjectPredictionSnapshot.query()
        .where('projectId', projectId)
        .whereIn('status', ['confirmed', 'pending'])
        .orderBy('createdAt', 'desc')
        .first()
      if (!pred)
        return { available: false, forbidden: false, highestSeverity: null, updatedAt: null }

      // 从关联的 signals 中找出 highest severity
      const signals = await pred.related('signals').query()
      const severities = signals.map((s: any) => s.severity)
      const severityOrder = ['critical', 'high', 'medium', 'low']
      let highest: TrafficLightSeverity | null = null
      for (const sev of severityOrder) {
        if (severities.includes(sev)) {
          highest = sev as TrafficLightSeverity
          break
        }
      }
      return {
        available: true,
        forbidden: false,
        highestSeverity: highest ?? ('low' as TrafficLightSeverity),
        updatedAt: pred.createdAt?.toISO() ?? null,
      }
    } catch {
      return { available: false, forbidden: false, highestSeverity: null, updatedAt: null }
    }
  }

  private async getRiskSignal(projectId: number) {
    try {
      // risks 表无 severity 列；风险级别由 risk_level 表达（low/medium/high/critical）
      const rows = await db.rawQuery(
        `SELECT risk_level, COUNT(*) as cnt FROM risks WHERE project_id = ? AND deleted_at IS NULL GROUP BY risk_level`,
        [projectId],
      )
      let highRiskCount = 0
      let criticalRiskCount = 0
      let totalRiskCount = 0
      for (const row of rows as any[]) {
        totalRiskCount += row.cnt
        if (row.risk_level === 'critical') criticalRiskCount = row.cnt
        if (row.risk_level === 'high') highRiskCount += row.cnt
      }
      const updatedAt = await db.rawQuery(
        `SELECT MAX(updated_at) as max_updated FROM risks WHERE project_id = ? AND deleted_at IS NULL`,
        [projectId],
      )
      const maxUpdated = (updatedAt as any[])[0]?.max_updated ?? null
      return {
        // available 以「确有风险行」为准：空集合不算可用，避免无数据被误判为 stale
        available: totalRiskCount > 0,
        forbidden: false,
        highRiskCount,
        criticalRiskCount,
        updatedAt: maxUpdated,
      }
    } catch {
      return {
        available: false,
        forbidden: false,
        highRiskCount: 0,
        criticalRiskCount: 0,
        updatedAt: null,
      }
    }
  }

  private async getResourceSignal(projectId: number) {
    try {
      // resources 表无 utilization_percent 列；负载由 resource_allocations
      // 按资源聚合 allocation_percent 得出（>100 视为过载）。
      const rows = await db.rawQuery(
        `SELECT r.id, COALESCE(SUM(a.allocation_percent), 0) AS total_percent
           FROM resources r
           LEFT JOIN resource_allocations a ON a.resource_id = r.id
          WHERE r.project_id = ? AND r.deleted_at IS NULL
          GROUP BY r.id`,
        [projectId],
      )
      let overloadCount = 0
      let maxUtilization: number | null = null
      for (const row of rows as any[]) {
        const util = Number(row.total_percent)
        if (!Number.isFinite(util)) continue
        if (maxUtilization === null || util > maxUtilization) maxUtilization = util
        if (util > 100) overloadCount++
      }
      const updatedAt = await db.rawQuery(
        `SELECT MAX(updated_at) as max_updated FROM resources WHERE project_id = ? AND deleted_at IS NULL`,
        [projectId],
      )
      const maxUpdated = (updatedAt as any[])[0]?.max_updated ?? null
      return {
        // available 以「确有资源行」为准：空集合不算可用，避免无数据被误判为 stale
        available: rows.length > 0,
        forbidden: false,
        overloadCount,
        maxUtilization,
        updatedAt: maxUpdated,
      }
    } catch {
      return {
        available: false,
        forbidden: false,
        overloadCount: 0,
        maxUtilization: null,
        updatedAt: null,
      }
    }
  }

  private async getTaskSignal(projectId: number) {
    try {
      const rows = await db.rawQuery(
        `SELECT status, COUNT(*) as cnt FROM tasks WHERE project_id = ? AND deleted_at IS NULL GROUP BY status`,
        [projectId],
      )
      let overdueCount = 0
      let soonDueCount = 0
      let totalCount = 0
      for (const row of rows as any[]) {
        totalCount += row.cnt
      }
      const overdueRows = await db.rawQuery(
        `SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ? AND end_date < date('now') AND status NOT IN ('completed','cancelled') AND deleted_at IS NULL`,
        [projectId],
      )
      overdueCount = (overdueRows as any[])[0]?.cnt ?? 0
      const soonDueRows = await db.rawQuery(
        `SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ? AND end_date BETWEEN date('now') AND date('now', '+7 days') AND status NOT IN ('completed','cancelled') AND deleted_at IS NULL`,
        [projectId],
      )
      soonDueCount = (soonDueRows as any[])[0]?.cnt ?? 0

      const updatedAt = await db.rawQuery(
        `SELECT MAX(updated_at) as max_updated FROM tasks WHERE project_id = ? AND deleted_at IS NULL`,
        [projectId],
      )
      const maxUpdated = (updatedAt as any[])[0]?.max_updated ?? null
      return {
        available: totalCount > 0,
        forbidden: false,
        overdueCount,
        soonDueCount,
        totalCount,
        updatedAt: maxUpdated,
      }
    } catch {
      return {
        available: false,
        forbidden: false,
        overdueCount: 0,
        soonDueCount: 0,
        totalCount: 0,
        updatedAt: null,
      }
    }
  }

  private async getMilestoneSignal(projectId: number) {
    try {
      // milestones 表无 deleted_at 列（软删除不适用）
      const rows = await db.rawQuery(
        `SELECT status, COUNT(*) as cnt FROM milestones WHERE project_id = ? GROUP BY status`,
        [projectId],
      )
      let atRiskCount = 0
      let missedCount = 0
      for (const row of rows as any[]) {
        if (row.status === 'at_risk') atRiskCount = row.cnt
        if (row.status === 'missed') missedCount = row.cnt
      }
      const updatedAt = await db.rawQuery(
        `SELECT MAX(updated_at) as max_updated FROM milestones WHERE project_id = ?`,
        [projectId],
      )
      const maxUpdated = (updatedAt as any[])[0]?.max_updated ?? null
      return {
        // available 以「确有里程碑行」为准：空集合不算可用，避免无数据被误判为 stale
        available: rows.length > 0,
        forbidden: false,
        atRiskCount,
        missedCount,
        updatedAt: maxUpdated,
      }
    } catch {
      return { available: false, forbidden: false, atRiskCount: 0, missedCount: 0, updatedAt: null }
    }
  }

  private async getChangeSignal(projectId: number) {
    try {
      // 状态枚举为 draft/submitted/under_review/...（无 in_review）；
      // change_requests 无 impact_level 列（影响度存于 impact_analysis JSON），
      // 高影响计数暂不单列，避免整段信号因列不存在而不可用。
      const rows = await db.rawQuery(
        `SELECT COUNT(*) as cnt FROM change_requests WHERE project_id = ? AND status IN ('draft','submitted','under_review') AND deleted_at IS NULL`,
        [projectId],
      )
      const openCount = (rows as any[])[0]?.cnt ?? 0
      const updatedAt = await db.rawQuery(
        `SELECT MAX(updated_at) as max_updated FROM change_requests WHERE project_id = ? AND deleted_at IS NULL`,
        [projectId],
      )
      const maxUpdated = (updatedAt as any[])[0]?.max_updated ?? null
      return {
        // available 以「确有未关闭变更请求」为准：空集合不算可用，避免无数据被误判为 stale
        available: openCount > 0,
        forbidden: false,
        openCount,
        highImpactCount: 0,
        updatedAt: maxUpdated,
      }
    } catch {
      return {
        available: false,
        forbidden: false,
        openCount: 0,
        highImpactCount: 0,
        updatedAt: null,
      }
    }
  }

  // ─── Review Marker ──────────────────────────────────────────────────────────────

  private async getReviewState(
    organizationId: number,
    projectId: number,
  ): Promise<TrafficLightReviewStateSummary> {
    try {
      const marker = await PortfolioTrafficLightReviewMarker.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .orderBy('created_at', 'desc')
        .first()

      if (!marker) {
        return {
          reviewState: 'acknowledged' as TrafficLightReviewState,
          reviewedAt: null,
          reviewedBy: null,
          stale: false,
        }
      }

      // Check stale
      const stale = marker.stale

      return {
        reviewState: marker.review_state as TrafficLightReviewState,
        reviewedAt: marker.created_at?.toISO() ?? null,
        reviewedBy: marker.actor_id,
        stale,
      }
    } catch {
      return {
        reviewState: 'acknowledged' as TrafficLightReviewState,
        reviewedAt: null,
        reviewedBy: null,
        stale: false,
      }
    }
  }

  /**
   * 创建或更新复核标记。只存储复核元数据，不修改项目事实。
   */
  async upsertReview(
    organizationId: number,
    projectId: number,
    actorId: number,
    reviewState: TrafficLightReviewState,
    note: string | null,
    inputSignatureHash: string,
  ): Promise<PortfolioTrafficLightReviewMarker> {
    // 查找已有标记
    const existing = await PortfolioTrafficLightReviewMarker.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')
      .first()

    if (existing) {
      existing.previous_review_state = existing.review_state
      existing.review_state = reviewState
      existing.note = note ?? existing.note
      existing.input_signature_hash = inputSignatureHash
      existing.actor_id = actorId
      existing.stale = false
      existing.rule_version = TRAFFIC_LIGHT_RULE_VERSION
      await existing.save()
      return existing
    }

    const marker = await PortfolioTrafficLightReviewMarker.create({
      organization_id: organizationId,
      project_id: projectId,
      actor_id: actorId,
      review_state: reviewState,
      note,
      rule_version: TRAFFIC_LIGHT_RULE_VERSION,
      input_signature_hash: inputSignatureHash,
      stale: false,
    })
    return marker
  }

  // ─── Sorting ────────────────────────────────────────────────────────────────────

  private sortItems(items: PortfolioTrafficLightItem[], sort: string, order: 'asc' | 'desc') {
    const multiplier = order === 'desc' ? -1 : 1
    items.sort((a, b) => {
      switch (sort) {
        case 'project_name':
          return multiplier * a.projectName.localeCompare(b.projectName, 'zh-CN')
        case 'severity_critical':
          return multiplier * (a.severityCounts.critical - b.severityCounts.critical)
        case 'severity_high':
          return multiplier * (a.severityCounts.high - b.severityCounts.high)
        case 'updated_at':
          return multiplier * a.calculatedAt.localeCompare(b.calculatedAt)
        case 'traffic_light':
        default:
          const severityOrder = ['red', 'yellow', 'green', 'gray']
          return (
            multiplier *
            (severityOrder.indexOf(a.trafficLight) - severityOrder.indexOf(b.trafficLight))
          )
      }
    })
  }

  // ─── Freshness ──────────────────────────────────────────────────────────────────

  private isStale(updatedAt: string | null): boolean {
    if (!updatedAt) return true
    const last = new Date(updatedAt).getTime()
    return Date.now() - last > STALE_MS
  }
}
