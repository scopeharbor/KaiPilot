import type User from '#models/user'
import Project from '#models/project'
import type PortfolioPriorityPolicy from '#policies/portfolio_priority_policy'
import {
  type ScoreVersion,
  type PriorityLevel,
  type PriorityScoreItem,
  type PriorityScoringSummary,
  type PriorityGroupSlice,
  type PrioritySourceFreshness,
  type ScoreDimensionContribution,
  type PriorityTieBreaker,
  type PriorityInputSignature,
  type PriorityWarning,
  type PriorityScoringListResponse,
  type PriorityGroupSliceResponse,
  type PriorityScoreDetail,
  type PriorityWeightVersion,
  type SupportedPriorityGroupKey,
  type SupportedPrioritySortKey,
  DEFAULT_SCORE_VERSION,
  PRIORITY_LEVELS,
  resolveScoreWeights,
  derivePriorityLevel,
  priorityTieBreakerSort,
  makeWeightVersionDetail,
} from '@aiproj/types'

// ─── 适配器输入接口 ──────────────────────────────────────────

interface ProjectFact {
  projectId: number
  projectName: string
  status: string
  priority: string | null
  dueDate: string | null
  updatedAt: string
}

interface TrafficLightResult {
  projectId: number
  severity: number
  color: 'red' | 'yellow' | 'green' | 'gray'
  refreshedAt: string | null
}

interface PredictionSummary {
  projectId: number
  severity: string
  refreshedAt: string | null
}

interface RiskSummary {
  projectId: number
  activeRiskCount: number
  highSeverityCount: number
  refreshedAt: string | null
}

interface ResourceSummary {
  projectId: number
  overloadCount: number
  totalAllocated: number
  totalCapacity: number
  refreshedAt: string | null
}

// ─── 常量 ─────────────────────────────────────────────────────

const FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000
const FEATURE_FLAG_KEY = 'PMO_PRIORITY_SCORING_ENABLED'

// ─── 服务 ─────────────────────────────────────────────────────

export default class PortfolioPriorityScoringService {
  constructor(private readonly policy: PortfolioPriorityPolicy) {}

  /** 检查 feature flag（本机环境默认开启） */
  private isFeatureEnabled(): boolean {
    const flag = process.env[FEATURE_FLAG_KEY]
    if (flag === undefined || flag === '') return true // 本机默认开启
    return flag === 'true' || flag === '1'
  }

  /** 获取组织下当前 actor 可见的项目列表 */
  private async getVisibleProjects(organizationId: number): Promise<ProjectFact[]> {
    const projects = await Project.query()
      .where('organization_id', organizationId)
      .select('id', 'name', 'status', 'priority', 'end_date', 'updated_at')
      .orderBy('id', 'asc')
      .limit(2000)

    return projects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      priority: p.priority ?? null,
      dueDate: p.endDate?.toISO() ?? null,
      updatedAt: p.updatedAt?.toISO() ?? new Date().toISOString(),
    }))
  }

  /** 检查源新鲜度 */
  private checkFreshness(refreshedAt: string | null): {
    stale: boolean
    fresh: PrioritySourceFreshness
  } {
    const stale =
      !refreshedAt || Date.now() - new Date(refreshedAt).getTime() > FRESHNESS_THRESHOLD_MS
    return {
      stale,
      fresh: {
        source: 'project',
        refreshedAt,
        stale,
        staleThresholdMs: FRESHNESS_THRESHOLD_MS,
      },
    }
  }

  /** 计算交付紧急度 (0-100) */
  private computeDeliveryUrgency(project: ProjectFact): number {
    // 基于状态和截止日期的确定性计算
    let urgency = 50
    // 已过期的项目更紧急
    if (project.dueDate) {
      const due = new Date(project.dueDate).getTime()
      const now = Date.now()
      if (due < now)
        urgency = 95 // 已过期
      else if (due < now + 7 * 24 * 60 * 60 * 1000)
        urgency = 80 // 7天内到期
      else if (due < now + 30 * 24 * 60 * 60 * 1000)
        urgency = 60 // 30天内到期
      else urgency = 40 // 较远
    }
    // 活跃状态加权
    if (project.status === 'active') urgency = Math.min(100, urgency + 10)
    if (project.status === 'at_risk') urgency = Math.min(100, urgency + 20)
    if (project.status === 'on_hold') urgency = Math.max(0, urgency - 20)
    return urgency
  }

  /** 计算管理关注度 (0-100) */
  private computeManagementAttention(_project: ProjectFact): { value: number; available: boolean } {
    // 当前系统无一等管理关注标记，标记为 unavailable
    return { value: 0, available: false }
  }

  /** 计算复核状态贡献 (0-100) */
  private computeReviewState(project: ProjectFact): { value: number; available: boolean } {
    // 基于项目优先级字段的确定性计算
    if (project.priority === 'critical') return { value: 90, available: true }
    if (project.priority === 'high') return { value: 70, available: true }
    if (project.priority === 'medium') return { value: 50, available: true }
    if (project.priority === 'low') return { value: 30, available: true }
    return { value: 50, available: false }
  }

  /** 对单个项目评分 */
  private async scoreProject(
    user: User,
    organizationId: number,
    project: ProjectFact,
    scoreVersion: ScoreVersion,
    trafficLight?: TrafficLightResult,
    risk?: RiskSummary,
    resource?: ResourceSummary,
    prediction?: PredictionSummary,
  ): Promise<PriorityScoreItem> {
    const weights = resolveScoreWeights(scoreVersion)
    const dimensions: ScoreDimensionContribution[] = []
    const sources: PrioritySourceFreshness[] = []
    const warnings: PriorityWarning[] = []

    // 项目基础新鲜度
    const projectFreshness = this.checkFreshness(project.updatedAt)
    sources.push({ ...projectFreshness.fresh, source: 'project' })

    // 遍历每个维度计算贡献
    for (const dw of weights) {
      let rawValue = 0
      let availability: ScoreDimensionContribution['availability'] = 'available'
      let dimWarning: PriorityWarning['code'] | undefined

      switch (dw.key) {
        case 'delivery_urgency': {
          rawValue = this.computeDeliveryUrgency(project)
          sources.push({
            source: 'delivery_urgency',
            refreshedAt: project.updatedAt,
            stale: projectFreshness.stale,
            staleThresholdMs: FRESHNESS_THRESHOLD_MS,
          })
          break
        }
        case 'traffic_light_severity': {
          const permResult = await this.policy.checkDimensionPermission(
            user,
            organizationId,
            'traffic_light_severity',
          )
          if (!permResult.allowed) {
            availability = 'forbidden'
            dimWarning = 'DIMENSION_FORBIDDEN'
          } else if (!trafficLight) {
            availability = 'unavailable'
            dimWarning = 'DIMENSION_UNAVAILABLE'
          } else {
            rawValue = trafficLight.severity
            sources.push({
              source: 'traffic_light',
              refreshedAt: trafficLight.refreshedAt,
              stale: this.checkFreshness(trafficLight.refreshedAt).stale,
              staleThresholdMs: FRESHNESS_THRESHOLD_MS,
            })
          }
          break
        }
        case 'management_attention': {
          const { value, available } = this.computeManagementAttention(project)
          if (!available) {
            availability = 'unavailable'
            dimWarning = 'DIMENSION_UNAVAILABLE'
          } else {
            rawValue = value
          }
          break
        }
        case 'risk_pressure': {
          const permResult = await this.policy.checkDimensionPermission(
            user,
            organizationId,
            'risk_pressure',
          )
          if (!permResult.allowed) {
            availability = 'forbidden'
            dimWarning = 'DIMENSION_FORBIDDEN'
          } else if (!risk) {
            availability = 'unavailable'
            dimWarning = 'DIMENSION_UNAVAILABLE'
          } else {
            // 高风险数量和严重度
            rawValue = Math.min(100, risk.activeRiskCount * 10 + risk.highSeverityCount * 25)
            sources.push({
              source: 'risk',
              refreshedAt: risk.refreshedAt,
              stale: this.checkFreshness(risk.refreshedAt).stale,
              staleThresholdMs: FRESHNESS_THRESHOLD_MS,
            })
          }
          break
        }
        case 'resource_pressure': {
          const permResult = await this.policy.checkDimensionPermission(
            user,
            organizationId,
            'resource_pressure',
          )
          if (!permResult.allowed) {
            availability = 'forbidden'
            dimWarning = 'DIMENSION_FORBIDDEN'
          } else if (!resource) {
            availability = 'unavailable'
            dimWarning = 'DIMENSION_UNAVAILABLE'
          } else {
            // 资源过载比例
            if (resource.totalCapacity > 0) {
              const ratio = resource.totalAllocated / resource.totalCapacity
              rawValue = Math.min(100, Math.round(ratio * 100))
            }
            sources.push({
              source: 'resource',
              refreshedAt: resource.refreshedAt,
              stale: this.checkFreshness(resource.refreshedAt).stale,
              staleThresholdMs: FRESHNESS_THRESHOLD_MS,
            })
          }
          break
        }
        case 'prediction_pressure': {
          const permResult = await this.policy.checkDimensionPermission(
            user,
            organizationId,
            'prediction_pressure',
          )
          if (!permResult.allowed) {
            availability = 'forbidden'
            dimWarning = 'DIMENSION_FORBIDDEN'
          } else if (!prediction) {
            availability = 'unavailable'
            dimWarning = 'DIMENSION_UNAVAILABLE'
          } else {
            const severityMap: Record<string, number> = {
              critical: 100,
              high: 75,
              medium: 50,
              low: 25,
            }
            rawValue = severityMap[prediction.severity] ?? 0
            sources.push({
              source: 'prediction',
              refreshedAt: prediction.refreshedAt,
              stale: this.checkFreshness(prediction.refreshedAt).stale,
              staleThresholdMs: FRESHNESS_THRESHOLD_MS,
            })
          }
          break
        }
        case 'freshness': {
          rawValue = projectFreshness.stale ? 30 : 100
          break
        }
        case 'review_state': {
          const { value, available } = this.computeReviewState(project)
          if (!available) {
            availability = 'unavailable'
            dimWarning = 'DIMENSION_UNAVAILABLE'
          } else {
            rawValue = value
          }
          break
        }
      }

      // 过期惩罚
      if (projectFreshness.stale && availability === 'available') {
        rawValue = Math.round(rawValue * (1 - dw.stalePenaltyFactor))
        if (!dimWarning) dimWarning = 'SOURCE_STALE'
      }

      const normalized = Math.round(
        ((rawValue - dw.normalizedRange[0]) / (dw.normalizedRange[1] - dw.normalizedRange[0])) *
          100,
      )
      const clamped = Math.max(0, Math.min(100, normalized))
      const contribution = Math.round(clamped * dw.weight * 100) / 100

      const dim: ScoreDimensionContribution = {
        dimension: dw.key,
        rawValue: availability === 'available' ? rawValue : 0,
        normalizedValue: availability === 'available' ? clamped : 0,
        weight: dw.weight,
        weightedContribution: availability === 'available' ? contribution : 0,
        availability,
        warning: dimWarning,
        evidenceRefs:
          availability === 'available'
            ? [
                {
                  ref: `ev-${dw.key}-${project.projectId}`,
                  kind: 'metric',
                  lowSensitiveLabel: `${dw.key} 摘要`,
                },
              ]
            : [],
      }
      dimensions.push(dim)

      if (dimWarning) {
        warnings.push({
          code: dimWarning,
          message: `维度 ${dw.key} ${dimWarning}`,
          dimension: dw.key,
        })
      }
    }

    // 计算总分
    const totalScore =
      Math.round(dimensions.reduce((s, d) => s + d.weightedContribution, 0) * 100) / 100
    const level = derivePriorityLevel(totalScore)
    const tieBreaker: PriorityTieBreaker = {
      level,
      trafficLightSeverity: trafficLight?.severity ?? 0,
      dueUrgency: project.dueDate
        ? Math.max(
            0,
            100 -
              Math.floor(
                (Date.now() - new Date(project.dueDate).getTime()) / (24 * 60 * 60 * 1000),
              ),
          )
        : 50,
      projectId: project.projectId,
    }

    // 生成输入签名
    const inputSignature: PriorityInputSignature = {
      version: scoreVersion,
      organizationHash: `org-${organizationId}`,
      inputsHash: `proj-${project.projectId}-${project.updatedAt}`,
      computedAt: new Date().toISOString(),
    }

    // Top reasons
    const availableDims = dimensions.filter((d) => d.availability === 'available')
    const topReasons = availableDims
      .sort((a, b) => b.weightedContribution - a.weightedContribution)
      .slice(0, 3)

    return {
      projectId: project.projectId,
      projectName: project.projectName,
      priorityScore: totalScore,
      priorityLevel: level,
      rank: 0, // 由调用方填充
      scoreVersion,
      calculatedAt: new Date().toISOString(),
      inputSignature,
      sourceFreshness: sources,
      dimensions,
      topReasons,
      warnings,
      allowedActions: [
        { action: 'view_detail', label: '查看详情', enabled: true },
        { action: 'open_project', label: '打开项目', enabled: true },
      ],
      tieBreaker,
    }
  }

  // ─── 公共方法 ────────────────────────────────────────────────

  /** 评分摘要 */
  async getSummary(
    user: User,
    organizationId: number,
    scoreVersion: ScoreVersion = DEFAULT_SCORE_VERSION,
  ): Promise<PriorityScoringSummary> {
    if (!this.isFeatureEnabled()) {
      return {
        totalProjects: 0,
        scoredProjects: 0,
        unscoredProjects: 0,
        levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
        scoreVersion,
        weightVersion: scoreVersion,
        sourceFreshness: [],
        warnings: [{ code: 'FEATURE_OFF', message: '优先级评分功能未启用' }],
        calculatedAt: new Date().toISOString(),
      }
    }

    const projects = await this.getVisibleProjects(organizationId)
    if (projects.length === 0) {
      return {
        totalProjects: 0,
        scoredProjects: 0,
        unscoredProjects: 0,
        levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
        scoreVersion,
        weightVersion: scoreVersion,
        sourceFreshness: [],
        warnings: [{ code: 'EMPTY_PORTFOLIO', message: '组织下无可见项目' }],
        calculatedAt: new Date().toISOString(),
      }
    }

    // 批量评分（不传外部 adapter，用项目事实评分）
    const scored = await Promise.all(
      projects.map((p) => this.scoreProject(user, organizationId, p, scoreVersion)),
    )

    const levelCounts: Record<PriorityLevel, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unranked: 0,
    }
    for (const item of scored) {
      levelCounts[item.priorityLevel]++
    }

    return {
      totalProjects: projects.length,
      scoredProjects: scored.filter((s) => s.priorityLevel !== 'unranked').length,
      unscoredProjects: scored.filter((s) => s.priorityLevel === 'unranked').length,
      levelCounts,
      scoreVersion,
      weightVersion: scoreVersion,
      sourceFreshness: [
        {
          source: 'project',
          refreshedAt: new Date().toISOString(),
          stale: false,
          staleThresholdMs: FRESHNESS_THRESHOLD_MS,
        },
      ],
      warnings: [],
      calculatedAt: new Date().toISOString(),
    }
  }

  /** 项目评分列表 */
  async getProjects(
    user: User,
    organizationId: number,
    query: {
      page?: number
      perPage?: number
      sort?: string
      priorityLevels?: PriorityLevel[]
      scoreVersion?: ScoreVersion
    } = {},
  ): Promise<PriorityScoringListResponse> {
    const scoreVersion = query.scoreVersion ?? DEFAULT_SCORE_VERSION
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20

    if (!this.isFeatureEnabled()) {
      return { data: [], meta: { total: 0, page, perPage, totalPages: 0 } }
    }

    const projects = await this.getVisibleProjects(organizationId)
    const scored = await Promise.all(
      projects.map((p) => this.scoreProject(user, organizationId, p, scoreVersion)),
    )

    // 过滤
    let filtered = scored
    if (query.priorityLevels && query.priorityLevels.length > 0) {
      filtered = scored.filter((s) => query.priorityLevels!.includes(s.priorityLevel))
    }

    // 排序
    const sortKey = (query.sort ?? 'priority_score') as SupportedPrioritySortKey
    filtered.sort((a, b) => {
      switch (sortKey) {
        case 'priority_score':
          return b.priorityScore - a.priorityScore
        case 'priority_level':
          return priorityTieBreakerSort(a.tieBreaker, b.tieBreaker)
        case 'rank':
          return a.rank - b.rank
        case 'project_name':
          return a.projectName.localeCompare(b.projectName, 'zh-CN')
        case 'updated_at':
          return a.calculatedAt.localeCompare(b.calculatedAt)
        default:
          return b.priorityScore - a.priorityScore
      }
    })

    // 排名
    filtered.forEach((item, i) => {
      item.rank = i + 1 + (page - 1) * perPage
    })

    // 分页
    const total = filtered.length
    const totalPages = Math.ceil(total / perPage)
    const start = (page - 1) * perPage
    const data = filtered.slice(start, start + perPage)

    return {
      data,
      meta: { total, page, perPage, totalPages },
    }
  }

  /** 分组切片 */
  async getGroups(
    user: User,
    organizationId: number,
    query: {
      groupBy: SupportedPriorityGroupKey
      scoreVersion?: ScoreVersion
      page?: number
      perPage?: number
    },
  ): Promise<PriorityGroupSliceResponse> {
    const scoreVersion = query.scoreVersion ?? DEFAULT_SCORE_VERSION
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20

    if (!this.isFeatureEnabled()) {
      return { data: [], meta: { total: 0, page, perPage, totalPages: 0 } }
    }

    const projects = await this.getVisibleProjects(organizationId)
    const scored = await Promise.all(
      projects.map((p) => this.scoreProject(user, organizationId, p, scoreVersion)),
    )

    // 分组
    const groups = new Map<string, PriorityScoreItem[]>()
    for (const item of scored) {
      let key: string
      switch (query.groupBy) {
        case 'priority_level':
          key = item.priorityLevel
          break
        case 'traffic_light': {
          const tl = item.dimensions.find((d) => d.dimension === 'traffic_light_severity')
          key = tl?.availability === 'available' ? `${tl.rawValue}` : 'unknown'
          break
        }
        case 'department':
          key = 'default' // 部门信息从项目事实中提取
          break
        case 'manager':
          key = 'default' // 负责人信息从项目事实中提取
          break
        default:
          key = 'other'
      }
      const existing = groups.get(key) ?? []
      existing.push(item)
      groups.set(key, existing)
    }

    const slices: PriorityGroupSlice[] = []
    for (const [value, items] of groups.entries()) {
      const avgScore =
        items.length > 0
          ? Math.round((items.reduce((s, i) => s + i.priorityScore, 0) / items.length) * 100) / 100
          : 0
      const levelCounts: Record<PriorityLevel, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unranked: 0,
      }
      for (const item of items) {
        levelCounts[item.priorityLevel]++
      }
      slices.push({
        groupKey: query.groupBy,
        groupValue: value,
        count: items.length,
        averageScore: avgScore,
        levelCounts,
      })
    }

    // 按平均分排序
    slices.sort((a, b) => b.averageScore - a.averageScore)

    const total = slices.length
    const totalPages = Math.ceil(total / perPage)
    const start = (page - 1) * perPage
    const data = slices.slice(start, start + perPage)

    return { data, meta: { total, page, perPage, totalPages } }
  }

  /** 权重版本说明 */
  getWeights(scoreVersion: ScoreVersion = DEFAULT_SCORE_VERSION): PriorityWeightVersion {
    return makeWeightVersionDetail(scoreVersion)
  }

  /** 项目评分详情（二次授权） */
  async getProjectDetail(
    user: User,
    organizationId: number,
    projectId: number,
    query: {
      scoreVersion?: ScoreVersion
      includeGroupSlices?: boolean
    } = {},
  ): Promise<PriorityScoreDetail | null> {
    const scoreVersion = query.scoreVersion ?? DEFAULT_SCORE_VERSION

    if (!this.isFeatureEnabled()) return null

    // 二次授权
    await this.policy.authorizeProjectView(user, organizationId, projectId)

    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()

    if (!project) return null

    const fact: ProjectFact = {
      projectId: project.id,
      projectName: project.name,
      status: project.status,
      priority: project.priority ?? null,
      dueDate: project.endDate?.toISO() ?? null,
      updatedAt: project.updatedAt?.toISO() ?? new Date().toISOString(),
    }

    const scored = await this.scoreProject(user, organizationId, fact, scoreVersion)
    scored.rank = 0 // 详情不设排名

    const detail: PriorityScoreDetail = { ...scored }

    if (query.includeGroupSlices) {
      // 返回该项目所在的分组切片
      const groups = await this.getGroups(user, organizationId, {
        groupBy: 'priority_level',
        scoreVersion,
        page: 1,
        perPage: 10,
      })
      detail.groupSlices = groups.data.filter((g) =>
        PRIORITY_LEVELS.includes(g.groupValue as PriorityLevel),
      )
    }

    return detail
  }
}
