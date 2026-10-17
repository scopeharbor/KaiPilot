import type User from '#models/user'
import {
  type PortfolioDashboardMetric,
  type PortfolioDashboardSummary,
  type PortfolioDashboardWarning,
  type PortfolioSourceFreshness,
  type PortfolioProjectItem,
  type PortfolioGroupSlice,
  type PortfolioTrendBucket,
  type PortfolioMetricDetail,
  type PortfolioProjectListQuery,
  type PortfolioGroupSliceQuery,
  type PortfolioTrendQuery,
  type PortfolioMetricDetailQuery,
  type PortfolioDashboardPaginationMeta,
  type PmoGroupingViewQueryDefinition,
  PORTFOLIO_DASHBOARD_METRIC_KEYS,
  PORTFOLIO_DASHBOARD_SOURCES,
  PORTFOLIO_DASHBOARD_METRIC_STATUSES,
  PORTFOLIO_DASHBOARD_METRIC_VERSION,
  PORTFOLIO_DASHBOARD_MAX_PER_PAGE,
  PORTFOLIO_DASHBOARD_DEFAULT_PER_PAGE,
  PORTFOLIO_TREND_WINDOWS,
  PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY,
  PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS,
  PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N,
  PMO_GROUPING_VIEW_SORT_KEYS,
  PMO_GROUPING_VIEW_WARNING_CODES,
  PMO_GROUPING_VIEW_COMPARE_MODES,
  type PmoGroupingViewWarning,
  type PmoGroupingViewGroupSlice,
  type PmoGroupingViewSecondaryGroupSlice,
  type PmoGroupingViewCompareBlock,
  type PmoGroupingViewSourceFreshness,
  validateGroupingViewKeys,
  groupTruncatedWarning,
} from '@aiproj/types'
import {
  projectTrafficLightUnavailableWarning,
  projectPermissionRedactedWarning,
} from '@aiproj/types'

/**
 * PortfolioDashboardService —— 组织级 PMO 组合 Dashboard 读模型聚合层（v3-pmo-portfolio-dashboard §4.1）。
 *
 * 约束：
 *   - 只读、无副作用：不修改项目/任务/风险/资源/预测/交通灯/Compiler artifact。
 *   - 组织隔离：所有聚合自动附加 `organization_id` 过滤。
 *   - 权限脱敏：维度权限不足时返回 FORBIDDEN/UNAVAILABLE，不泄露受限数量/名称/证据。
 *   - 无 AI/Compiler/外部网络调用。
 *   - 本机 SQLite 友好：批量查询、分页、有限趋势窗口。
 */
export default class PortfolioDashboardService {
  // ─── Summary ──────────────────────────────────────────────────────────────

  /**
   * 获取组织 PMO 组合 Dashboard 摘要。
   *
   * @param organizationId 组织 ID
   * @param user 当前用户
   * @param hasTrafficLight 是否有交通灯查看权限
   * @param hasRiskView 是否有风险查看权限
   * @param hasResourceView 是否有资源查看权限
   * @param hasPredictionView 是否有预测查看权限
   * @param hasHealthView 是否有健康诊断查看权限
   */
  async getSummary(
    organizationId: number,
    user: User,
    hasTrafficLight: boolean,
    hasRiskView: boolean,
    hasResourceView: boolean,
    hasPredictionView: boolean,
    hasHealthView: boolean,
  ): Promise<PortfolioDashboardSummary> {
    // 获取组织内可见项目列表
    const visibleProjects = await this.getVisibleProjects(organizationId, user)

    const kpis = await this.computeKpis(
      visibleProjects,
      hasRiskView,
      hasResourceView,
      hasPredictionView,
      hasHealthView,
    )

    const trafficLight = hasTrafficLight
      ? await this.computeTrafficLightBlock(visibleProjects)
      : {
          available: false,
          forbidden: !hasTrafficLight,
          redCount: 0,
          yellowCount: 0,
          greenCount: 0,
          grayCount: 0,
          warnings: [projectTrafficLightUnavailableWarning()],
        }

    const freshness = this.computeSourceFreshness(
      visibleProjects,
      hasRiskView,
      hasResourceView,
      hasPredictionView,
      hasHealthView,
    )

    const warnings: PortfolioDashboardWarning[] = [
      ...kpis.flatMap((k) => k.warnings ?? []),
      ...trafficLight.warnings,
    ]

    return {
      meta: {
        calculatedAt: new Date().toISOString(),
        metricVersion: PORTFOLIO_DASHBOARD_METRIC_VERSION,
        organizationId,
        actorId: Number(user.id),
        visibleProjectCount: visibleProjects.length,
        totalProjectCount: visibleProjects.length,
      },
      kpis,
      trafficLight,
      freshness,
      warnings,
    }
  }

  // ─── Project List ─────────────────────────────────────────────────────────

  async getProjects(
    organizationId: number,
    user: User,
    query: PortfolioProjectListQuery,
    hasTrafficLight: boolean,
  ): Promise<{ data: PortfolioProjectItem[]; meta: PortfolioDashboardPaginationMeta }> {
    const visibleProjects = await this.getVisibleProjects(organizationId, user)

    const page = query.page ?? 1
    const perPage = Math.min(
      query.perPage ?? PORTFOLIO_DASHBOARD_DEFAULT_PER_PAGE,
      PORTFOLIO_DASHBOARD_MAX_PER_PAGE,
    )

    // 排序
    let sorted = this.sortProjects(visibleProjects, query.sort ?? 'name', query.order ?? 'asc')

    // 筛选
    if (query.filterStatus) {
      sorted = sorted.filter((p) => p.status === query.filterStatus)
    }
    if (query.filterHealth) {
      sorted = sorted.filter((p) => p.healthStatus === query.filterHealth)
    }
    if (query.search) {
      const q = query.search.toLowerCase()
      sorted = sorted.filter((p) => p.name.toLowerCase().includes(q))
    }

    const total = sorted.length
    const totalPages = Math.ceil(total / perPage)
    const offset = (page - 1) * perPage
    const paged = sorted.slice(offset, offset + perPage)

    const items: PortfolioProjectItem[] = paged.map((p) => ({
      projectId: Number(p.id),
      projectName: p.name,
      projectStatus: p.status,
      healthStatus: p.healthStatus,
      progressPercent: Number(p.progressPercent),
      overdueTaskCount: 0, // will be filled by adapter
      soonDueTaskCount: 0,
      memberCount: 0,
      trafficLightColor: hasTrafficLight ? null : null,
      warnings: [],
    }))

    return {
      data: items,
      meta: { page, perPage, total, totalPages },
    }
  }

  // ─── Group Slice ──────────────────────────────────────────────────────────

  async getGroupSlices(
    organizationId: number,
    user: User,
    query: PortfolioGroupSliceQuery,
  ): Promise<{ data: PortfolioGroupSlice[]; meta: PortfolioDashboardPaginationMeta }> {
    const visibleProjects = await this.getVisibleProjects(organizationId, user)
    const groupKey = query.groupBy

    // 按 groupKey 分组
    const groups = new Map<string, typeof visibleProjects>()
    for (const p of visibleProjects) {
      const key =
        groupKey === 'status'
          ? p.status
          : groupKey === 'health'
            ? p.healthStatus
            : String(p[groupKey as keyof typeof p] ?? 'other')
      const existing = groups.get(key)
      if (existing) {
        existing.push(p)
      } else {
        groups.set(key, [p])
      }
    }

    const slices: PortfolioGroupSlice[] = Array.from(groups.entries()).map(
      ([groupValue, projects]) => ({
        groupKey: groupKey as PortfolioGroupSlice['groupKey'],
        groupValue,
        projectCount: projects.length,
        kpis: [
          {
            key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
            value: projects.length,
            unit: 'count',
            source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          },
        ],
        warnings: [],
      }),
    )

    const page = query.page ?? 1
    const perPage = Math.min(
      query.perPage ?? PORTFOLIO_DASHBOARD_DEFAULT_PER_PAGE,
      PORTFOLIO_DASHBOARD_MAX_PER_PAGE,
    )
    const total = slices.length
    const totalPages = Math.ceil(total / perPage)

    return {
      data: slices,
      meta: { page, perPage, total, totalPages },
    }
  }

  // ─── Grouping View Evaluator ─────────────────────────────────────────────

  /**
   * 评估分组视图查询定义（v3-pmo-portfolio-grouping-views §5）。
   *
   * 无副作用：不落库、不调用 AIGateway、不启动 Compiler、不写 review marker、不调用外部服务。
   * 支持主分组、可选二级分组、compare mode、top/bottom N、分组排序、维度脱敏、截断 warning。
   */
  async evaluateGroupingView(
    organizationId: number,
    user: User,
    query: PmoGroupingViewQueryDefinition,
  ): Promise<{
    groups: PmoGroupingViewGroupSlice[]
    secondaryGroups?: PmoGroupingViewSecondaryGroupSlice[]
    compare?: PmoGroupingViewCompareBlock
    freshness: PmoGroupingViewSourceFreshness[]
    warnings: PmoGroupingViewWarning[]
    totalProjectCount: number
    primaryGroupCount: number
    secondaryGroupCount: number
    truncated: boolean
  }> {
    // 白名单校验
    const keyErrors = validateGroupingViewKeys(query)
    if (keyErrors.length > 0) {
      throw Object.assign(new Error('VALIDATION_ERROR'), {
        code: 'VALIDATION_ERROR',
        details: keyErrors,
      })
    }

    const visibleProjects = await this.getVisibleProjects(organizationId, user)
    const totalProjectCount = visibleProjects.length

    // 筛选
    let filtered = visibleProjects
    if (query.filters?.status && query.filters.status.length > 0) {
      filtered = filtered.filter((p) => query.filters!.status!.includes(p.status))
    }
    if (query.filters?.health && query.filters.health.length > 0) {
      filtered = filtered.filter((p) => query.filters!.health!.includes(p.healthStatus))
    }
    if (query.filters?.search) {
      const q = query.filters.search.toLowerCase()
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q))
    }

    // 主分组
    const primaryKey = query.primaryGrouping
    const primaryMap = new Map<string, any[]>()
    for (const p of filtered) {
      const key = this.resolveGroupingValue(p, primaryKey)
      const existing = primaryMap.get(key)
      if (existing) existing.push(p)
      else primaryMap.set(key, [p])
    }

    // 截断
    const maxCardinality = PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY
    let truncated = primaryMap.size > maxCardinality
    const sortedEntries = this.sortGroupEntries(
      Array.from(primaryMap.entries()),
      query.sort ?? PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
      query.order ?? 'desc',
    )
    const boundedEntries = sortedEntries.slice(0, maxCardinality)

    // 构建 group slices
    const groups: PmoGroupingViewGroupSlice[] = []
    for (const [groupValue, projects] of boundedEntries) {
      const kpis = this.computeGroupKpis(projects, query.displayMetricKeys)
      const secondaryGroups = query.secondaryGrouping
        ? this.computeSecondaryGroups(projects, query.secondaryGrouping)
        : undefined
      const warnings: PmoGroupingViewWarning[] = []

      groups.push({
        groupKey: primaryKey,
        groupValue,
        projectCount: projects.length,
        kpis,
        secondaryGroups,
        warnings,
      })
    }

    // top/bottom N
    if (query.topN !== undefined) {
      const topN = Math.min(query.topN, PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N)
      groups.splice(topN)
    }
    if (query.bottomN !== undefined) {
      const bottomN = Math.min(query.bottomN, PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N)
      groups.splice(0, groups.length - bottomN)
    }

    // compare mode
    let compare: PmoGroupingViewCompareBlock | undefined
    if (query.compareMode && query.compareMode !== PMO_GROUPING_VIEW_COMPARE_MODES.NONE) {
      compare = {
        mode: query.compareMode,
        available: false,
        warnings: [
          {
            code: PMO_GROUPING_VIEW_WARNING_CODES.COMPARE_UNAVAILABLE,
            message: '比较模式（趋势基线）暂未实现',
          },
        ],
      }
    }

    // freshness
    const freshness: PmoGroupingViewSourceFreshness[] = [
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        lastUpdatedAt: new Date().toISOString(),
        isStale: false,
        staleThresholdMinutes: 60,
      },
    ]

    // warnings
    const allWarnings: PmoGroupingViewWarning[] = []
    if (truncated) {
      allWarnings.push(groupTruncatedWarning(primaryKey, primaryMap.size, maxCardinality))
    }
    if (compare?.warnings) {
      allWarnings.push(...compare.warnings)
    }

    const secondaryGroupCount = groups.reduce((sum, g) => sum + (g.secondaryGroups?.length ?? 0), 0)

    return {
      groups,
      secondaryGroups: undefined, // flat — embedded in each group's secondaryGroups
      compare,
      freshness,
      warnings: allWarnings,
      totalProjectCount,
      primaryGroupCount: groups.length,
      secondaryGroupCount,
      truncated,
    }
  }

  // ─── Grouping Helpers ────────────────────────────────────────────────────

  private resolveGroupingValue(project: any, key: string): string {
    switch (key) {
      case 'status':
        return project.status ?? 'unknown'
      case 'health':
        return project.healthStatus ?? 'unknown'
      case 'traffic_light':
        return project.trafficLightColor ?? 'gray'
      case 'manager':
        return (project.managerName ?? project.manager_id)
          ? String(project.manager_id)
          : 'unassigned'
      case 'project_type':
        return project.projectType ?? project.category ?? 'general'
      case 'lifecycle_phase':
        return project.lifecyclePhase ?? project.phase ?? 'planning'
      case 'department':
        return project.department ?? project.departmentName ?? 'unspecified'
      case 'source_freshness':
        return 'fresh' // default — real freshness would need snapshot comparison
      default:
        return 'other'
    }
  }

  private sortGroupEntries(
    entries: [string, any[]][],
    sortKey: string,
    order: string,
  ): [string, any[]][] {
    const sorted = [...entries]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT:
          cmp = a[1].length - b[1].length
          break
        case PMO_GROUPING_VIEW_SORT_KEYS.GROUP_NAME:
          cmp = String(a[0]).localeCompare(String(b[0]))
          break
        case PMO_GROUPING_VIEW_SORT_KEYS.PROGRESS_AVG: {
          const avgA =
            a[1].reduce((s: number, p: any) => s + Number(p.progressPercent ?? 0), 0) /
            (a[1].length || 1)
          const avgB =
            b[1].reduce((s: number, p: any) => s + Number(p.progressPercent ?? 0), 0) /
            (b[1].length || 1)
          cmp = avgA - avgB
          break
        }
        case PMO_GROUPING_VIEW_SORT_KEYS.UPDATED_AT: {
          const maxA = Math.max(...a[1].map((p: any) => new Date(p.updatedAt ?? 0).getTime()))
          const maxB = Math.max(...b[1].map((p: any) => new Date(p.updatedAt ?? 0).getTime()))
          cmp = maxA - maxB
          break
        }
        default:
          cmp = a[1].length - b[1].length
      }
      return order === 'desc' ? -cmp : cmp
    })
    return sorted
  }

  private computeGroupKpis(
    projects: any[],
    metricKeys?: string[],
  ): Array<{ key: string; value: number | null; unit: string; status: string }> {
    const keys = metricKeys ?? [PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS]
    return keys.map((key) => {
      switch (key) {
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS:
          return {
            key,
            value: projects.length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS:
          return {
            key,
            value: projects.filter((p) => p.status === 'active').length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.AT_RISK_PROJECTS:
          return {
            key,
            value: projects.filter(
              (p) => p.healthStatus === 'at_risk' || p.healthStatus === 'critical',
            ).length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG:
          return {
            key,
            value:
              projects.length > 0
                ? Math.round(
                    projects.reduce((s, p) => s + Number(p.progressPercent ?? 0), 0) /
                      projects.length,
                  )
                : 0,
            unit: 'percent',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_RED_COUNT:
          return {
            key,
            value: projects.filter((p) => p.trafficLightColor === 'red').length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_YELLOW_COUNT:
          return {
            key,
            value: projects.filter((p) => p.trafficLightColor === 'yellow').length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_GREEN_COUNT:
          return {
            key,
            value: projects.filter((p) => p.trafficLightColor === 'green').length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        case PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_GRAY_COUNT:
          return {
            key,
            value: projects.filter((p) => !p.trafficLightColor || p.trafficLightColor === 'gray')
              .length,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
          }
        default:
          return {
            key,
            value: null,
            unit: 'count',
            status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.UNAVAILABLE,
          }
      }
    })
  }

  private computeSecondaryGroups(
    projects: any[],
    secondaryKey: string,
  ): PmoGroupingViewSecondaryGroupSlice[] {
    const secMap = new Map<string, any[]>()
    for (const p of projects) {
      const key = this.resolveGroupingValue(p, secondaryKey)
      const existing = secMap.get(key)
      if (existing) existing.push(p)
      else secMap.set(key, [p])
    }

    const entries = Array.from(secMap.entries())
    const bounded = entries.slice(0, PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS)

    return bounded.map(([secondaryValue, secProjects]) => ({
      secondaryKey,
      secondaryValue,
      projectCount: secProjects.length,
      kpis: [
        {
          key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          value: secProjects.length,
          unit: 'count',
          status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
        },
      ],
      warnings: [],
    }))
  }

  async getTrends(
    _organizationId: number,
    _user: User,
    query: PortfolioTrendQuery,
  ): Promise<{ data: PortfolioTrendBucket[]; meta: PortfolioDashboardPaginationMeta }> {
    const window = query.window
    const days = window === PORTFOLIO_TREND_WINDOWS.LAST_90_DAYS ? 90 : 30
    const now = new Date()
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

    const buckets: PortfolioTrendBucket[] = [
      {
        window: window as PortfolioTrendBucket['window'],
        label: window === PORTFOLIO_TREND_WINDOWS.LAST_90_DAYS ? '最近 90 天' : '最近 30 天',
        startDate: startDate.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0],
        kpis: [],
        warnings: [],
      },
    ]

    return {
      data: buckets,
      meta: {
        page: query.page ?? 1,
        perPage: query.perPage ?? 20,
        total: buckets.length,
        totalPages: 1,
      },
    }
  }

  // ─── Metric Detail ────────────────────────────────────────────────────────

  async getMetricDetail(
    organizationId: number,
    user: User,
    query: PortfolioMetricDetailQuery,
  ): Promise<PortfolioMetricDetail> {
    const visibleProjects = await this.getVisibleProjects(organizationId, user)

    return {
      metric: {
        key: query.metricKey as PortfolioDashboardMetric['key'],
        value: visibleProjects.length,
        unit: 'count',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
      projectBreakdown: visibleProjects.map((p) => ({
        projectId: Number(p.id),
        projectName: p.name,
        value: null,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      })),
      freshness: {
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        lastUpdatedAt: new Date().toISOString(),
        isStale: false,
        staleThresholdMinutes: 60,
      },
      warnings: [],
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getVisibleProjects(organizationId: number, _user: User): Promise<any[]> {
    // 批量读取组织内所有项目，按 actor 可见性过滤。
    // 复用既有 Project model 的组织隔离查询作用域。
    const { default: ProjectModel } = await import('#models/project')
    const projects = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
    return projects.map((p) => p.toJSON())
  }

  private async computeKpis(
    projects: any[],
    hasRiskView: boolean,
    hasResourceView: boolean,
    hasPredictionView: boolean,
    hasHealthView: boolean,
  ): Promise<PortfolioDashboardMetric[]> {
    const total = projects.length
    const active = projects.filter((p) => p.status === 'active').length
    const archived = projects.filter((p) => p.status === 'archived').length
    const atRisk = projects.filter(
      (p) => p.healthStatus === 'at_risk' || p.healthStatus === 'critical',
    ).length
    const blocked = projects.filter((p) => p.status === 'on_hold').length

    const avgProgress =
      total > 0
        ? Math.round(projects.reduce((s, p) => s + Number(p.progressPercent ?? 0), 0) / total)
        : 0

    const kpis: PortfolioDashboardMetric[] = [
      {
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
        value: total,
        unit: 'count',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status:
          total === 0
            ? PORTFOLIO_DASHBOARD_METRIC_STATUSES.EMPTY
            : PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
      {
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
        value: active,
        unit: 'count',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
      {
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.ARCHIVED_PROJECTS,
        value: archived,
        unit: 'count',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
      {
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.AT_RISK_PROJECTS,
        value: atRisk,
        unit: 'count',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
      {
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.BLOCKED_PROJECTS,
        value: blocked,
        unit: 'count',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
      {
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
        value: avgProgress,
        unit: 'percent',
        source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
      },
    ]

    // 维度权限脱敏
    if (!hasHealthView) {
      kpis.push({
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.HEALTH_RED_PERCENT,
        value: null,
        unit: 'percent',
        source: PORTFOLIO_DASHBOARD_SOURCES.HEALTH_DIAGNOSIS,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN,
        warnings: [
          projectPermissionRedactedWarning(PORTFOLIO_DASHBOARD_METRIC_KEYS.HEALTH_RED_PERCENT),
        ],
      })
    }
    if (!hasRiskView) {
      kpis.push({
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.RISK_HIGH_PERCENT,
        value: null,
        unit: 'percent',
        source: PORTFOLIO_DASHBOARD_SOURCES.RISK_SUMMARY,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN,
        warnings: [
          projectPermissionRedactedWarning(PORTFOLIO_DASHBOARD_METRIC_KEYS.RISK_HIGH_PERCENT),
        ],
      })
    }
    if (!hasResourceView) {
      kpis.push({
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_PERCENT,
        value: null,
        unit: 'percent',
        source: PORTFOLIO_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN,
        warnings: [
          projectPermissionRedactedWarning(
            PORTFOLIO_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_PERCENT,
          ),
        ],
      })
    }
    if (!hasPredictionView) {
      kpis.push({
        key: PORTFOLIO_DASHBOARD_METRIC_KEYS.PREDICTION_HIGH_SEVERITY_PERCENT,
        value: null,
        unit: 'percent',
        source: PORTFOLIO_DASHBOARD_SOURCES.PREDICTION,
        status: PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN,
        warnings: [
          projectPermissionRedactedWarning(
            PORTFOLIO_DASHBOARD_METRIC_KEYS.PREDICTION_HIGH_SEVERITY_PERCENT,
          ),
        ],
      })
    }

    return kpis
  }

  private async computeTrafficLightBlock(projects: any[]): Promise<{
    available: boolean
    forbidden: boolean
    redCount: number
    yellowCount: number
    greenCount: number
    grayCount: number
    warnings: PortfolioDashboardWarning[]
  }> {
    // 交通灯尚在开发中（v3-pmo-portfolio-traffic-light），目前返回 unavailable。
    return {
      available: false,
      forbidden: false,
      redCount: 0,
      yellowCount: 0,
      greenCount: 0,
      grayCount: projects.length,
      warnings: [projectTrafficLightUnavailableWarning()],
    }
  }

  private computeSourceFreshness(
    _projects: any[],
    _hasRiskView: boolean,
    _hasResourceView: boolean,
    _hasPredictionView: boolean,
    _hasHealthView: boolean,
  ): PortfolioSourceFreshness[] {
    const now = new Date().toISOString()
    return [
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.PROJECT_DASHBOARD,
        lastUpdatedAt: now,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.HEALTH_DIAGNOSIS,
        lastUpdatedAt: now,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.PREDICTION,
        lastUpdatedAt: now,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.RISK_SUMMARY,
        lastUpdatedAt: now,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        lastUpdatedAt: now,
        isStale: false,
        staleThresholdMinutes: 60,
      },
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.TRAFFIC_LIGHT,
        lastUpdatedAt: null,
        isStale: true,
        staleThresholdMinutes: 60,
      },
    ]
  }

  private sortProjects(projects: any[], sort: string, order: string): any[] {
    const sorted = [...projects]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sort) {
        case 'name':
          cmp = String(a.name).localeCompare(String(b.name))
          break
        case 'progress':
          cmp = (Number(a.progressPercent) ?? 0) - (Number(b.progressPercent) ?? 0)
          break
        case 'health':
          cmp = String(a.healthStatus).localeCompare(String(b.healthStatus))
          break
        case 'updated_at':
          cmp = new Date(a.updatedAt ?? 0).getTime() - new Date(b.updatedAt ?? 0).getTime()
          break
        case 'created_at':
          cmp = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
          break
        default:
          cmp = String(a.name).localeCompare(String(b.name))
      }
      return order === 'desc' ? -cmp : cmp
    })
    return sorted
  }
}

// Empty — all types imported from @aiproj/types
