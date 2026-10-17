import { inject } from '@adonisjs/core'
import type User from '#models/user'
import BiTrendAnalysisPolicy, {
  type BiTrendDimensionAccess,
} from '#policies/bi_trend_analysis_policy'
import {
  isUnsupportedFinancialMetricKey,
  buildBiTrendWarning,
  normalizeBiTrendBuckets,
  summarizeBiTrendSeries,
  aggregateBiTrendFreshness,
  buildBiTrendQueryShape,
  simpleBiTrendHash,
  BI_TREND_METRIC_KEYS,
  BI_TREND_SOURCE_KINDS,
  BI_TREND_DEFAULT_WINDOW,
  BI_TREND_DEFAULT_GRAIN,
  BI_TREND_DEFAULT_PER_PAGE,
  BI_TREND_MAX_PER_PAGE,
  BI_TREND_WARNING_CODES,
  BI_TREND_FRESHNESS_STATES,
  BI_TREND_METRIC_VERSION,
  BI_TREND_WINDOW_DAYS,
  type BiTrendMetricKey,
  type BiTrendQuery,
  type BiTrendSeries,
  type BiTrendWarning,
  type BiTrendSourceRef,
  type BiTrendEvidenceRef,
  type BiTrendFreshness,
  type BiTrendsResponse,
  type BiTrendsResponseMeta,
} from '@aiproj/types'
import { resolveBiTrendMetric, type BiTrendMetricDefinition } from './bi_trend_metric_registry.js'
import AuditService from '#services/audit_service'

/**
 * BI 趋势聚合服务（v3-bi-trend-analysis §3.3–3.6）。
 */
@inject()
export default class BiTrendAnalysisService {
  constructor(
    private readonly policy: BiTrendAnalysisPolicy,
    private readonly auditService: AuditService,
  ) {}

  async getTrends(
    organizationId: number,
    user: User,
    query: BiTrendQuery,
  ): Promise<BiTrendsResponse> {
    const referenceDate = new Date().toISOString().slice(0, 10)
    const dimAccess = await this.policy.resolveDimensionAccess(user, organizationId)

    const unsupportedKeys: string[] = []

    for (const key of [...query.metricKeys]) {
      if (isUnsupportedFinancialMetricKey(key)) {
        unsupportedKeys.push(key)
      }
    }

    const sourceRefs: BiTrendSourceRef[] = []
    const seriesResults: BiTrendSeries[] = []
    const allWarnings: BiTrendWarning[] = []

    for (const metricKey of query.metricKeys) {
      if (isUnsupportedFinancialMetricKey(metricKey)) {
        seriesResults.push(this.buildUnavailableSeries(metricKey, query, referenceDate))
        continue
      }

      const def = resolveBiTrendMetric(metricKey)
      if (!def) {
        seriesResults.push(this.buildUnavailableSeries(metricKey, query, referenceDate))
        continue
      }

      const canAccess = this.canAccessDimension(metricKey, dimAccess)
      if (!canAccess) {
        seriesResults.push(this.buildRedactedSeries(def, query, referenceDate))
        allWarnings.push(
          buildBiTrendWarning(
            BI_TREND_WARNING_CODES.DIMENSION_REDACTED,
            `当前角色无权限查看"${def.label}"趋势`,
            { metricKey },
          ),
        )
        continue
      }

      const rawPoints = await this.fetchRawPoints(organizationId, user, def, metricKey, query)
      const grain = query.grain ?? BI_TREND_DEFAULT_GRAIN
      const window = query.window ?? BI_TREND_DEFAULT_WINDOW
      const points = normalizeBiTrendBuckets(rawPoints, window, grain, referenceDate)

      const freshSources: BiTrendSourceRef[] = this.buildSourceRefs(def, rawPoints.length)
      sourceRefs.push(...freshSources)

      const series = summarizeBiTrendSeries({
        metricKey,
        grain,
        window,
        points,
        freshness: this.buildMetricFreshness(freshSources),
        evidenceRefs: this.buildEvidenceRefs(def),
        compareWith: query.compareWith,
        includeAnomalies: query.includeAnomalies ?? false,
        includeForecast: query.includeForecast ?? false,
      })

      seriesResults.push(series)
    }

    const freshness = aggregateBiTrendFreshness(
      sourceRefs.length > 0
        ? sourceRefs
        : [
            {
              sourceKind: BI_TREND_SOURCE_KINDS.ORGANIZATION_DASHBOARD,
              state: BI_TREND_FRESHNESS_STATES.UNKNOWN,
              lastRefreshedAt: null,
              metricVersion: BI_TREND_METRIC_VERSION,
            },
          ],
    )

    await this.writeAudit(
      organizationId,
      user,
      query,
      seriesResults.length,
      freshness.freshnessHash,
    )

    let sorted = seriesResults
    const sortKey = query.sort ?? 'metricKey'
    const sortDir = query.sortDir ?? 'asc'
    sorted = this.sortSeries(sorted, sortKey, sortDir)

    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? BI_TREND_DEFAULT_PER_PAGE, BI_TREND_MAX_PER_PAGE)
    const total = sorted.length
    const totalPages = Math.ceil(total / perPage)
    const offset = (page - 1) * perPage
    const paged = sorted.slice(offset, offset + perPage)

    if (unsupportedKeys.length > 0) {
      allWarnings.push(
        buildBiTrendWarning(
          BI_TREND_WARNING_CODES.UNSUPPORTED_METRIC,
          `不支持的指标: ${unsupportedKeys.join(', ')}`,
        ),
      )
    }

    const queryShape = buildBiTrendQueryShape(query)
    const calculatedAt = new Date().toISOString()

    const meta: BiTrendsResponseMeta = {
      organizationId,
      calculatedAt,
      metricVersion: BI_TREND_METRIC_VERSION,
      queryShape,
      freshnessHash: freshness.freshnessHash,
      page,
      perPage,
      total,
      totalPages,
    }

    return { data: paged, meta, warnings: allWarnings, queryShape, calculatedAt }
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private canAccessDimension(metricKey: BiTrendMetricKey, access: BiTrendDimensionAccess): boolean {
    switch (metricKey) {
      case BI_TREND_METRIC_KEYS.PROJECT_PROGRESS:
      case BI_TREND_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE:
        return access.canViewProgress
      case BI_TREND_METRIC_KEYS.RISK_PRESSURE:
        return access.canViewRisk
      case BI_TREND_METRIC_KEYS.RESOURCE_PRESSURE:
        return access.canViewResource
      case BI_TREND_METRIC_KEYS.FORECAST_DEMAND_PRESSURE:
        return access.canViewPrediction
      case BI_TREND_METRIC_KEYS.OKR_PROGRESS:
        return access.canViewOkr
      default:
        return access.canViewProgress
    }
  }

  private async fetchRawPoints(
    organizationId: number,
    _user: User,
    _def: BiTrendMetricDefinition,
    metricKey: BiTrendMetricKey,
    query: BiTrendQuery,
  ): Promise<{ date: string; value: number; sampleCount?: number }[]> {
    switch (metricKey) {
      case BI_TREND_METRIC_KEYS.PROJECT_PROGRESS:
      case BI_TREND_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE:
        return this.fetchProgressRawPoints(organizationId, metricKey, query)
      default:
        return []
    }
  }

  private async fetchProgressRawPoints(
    organizationId: number,
    metricKey: BiTrendMetricKey,
    query: BiTrendQuery,
  ): Promise<{ date: string; value: number; sampleCount?: number }[]> {
    const { default: ProjectModel } = await import('#models/project')

    const baseQuery = ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'name', 'progressPercent', 'status', 'updatedAt')

    if (query.filters?.projectIds?.length) {
      baseQuery.whereIn('id', query.filters.projectIds)
    }

    const projects = await baseQuery
    const now = new Date()
    const window = query.window ?? BI_TREND_DEFAULT_WINDOW
    const days = BI_TREND_WINDOW_DAYS[window]

    const points: { date: string; value: number; sampleCount: number }[] = []
    for (let d = days - 1; d >= 0; d -= 7) {
      const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const activeProjects = projects.filter((p: any) => p.status === 'active')
      const avg =
        activeProjects.length > 0
          ? activeProjects.reduce((s: number, p: any) => s + Number(p.progressPercent ?? 0), 0) /
            activeProjects.length
          : 0
      points.push({
        date,
        value:
          metricKey === BI_TREND_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE ? Math.max(0, 100 - avg) : avg,
        sampleCount: activeProjects.length,
      })
    }

    return points
  }

  private buildSourceRefs(def: BiTrendMetricDefinition, pointCount: number): BiTrendSourceRef[] {
    const now = new Date().toISOString()
    return [
      {
        sourceKind: def.sourceKind,
        state: pointCount > 0 ? BI_TREND_FRESHNESS_STATES.FRESH : BI_TREND_FRESHNESS_STATES.UNKNOWN,
        lastRefreshedAt: now,
        metricVersion: def.metricVersion,
      },
    ]
  }

  private buildEvidenceRefs(def: BiTrendMetricDefinition): BiTrendEvidenceRef[] {
    return [
      {
        kind: def.drilldownTargetKind as BiTrendEvidenceRef['kind'],
        label: def.label,
        targetKind: def.drilldownTargetKind as BiTrendEvidenceRef['targetKind'],
      },
    ]
  }

  private buildMetricFreshness(sources: BiTrendSourceRef[]): BiTrendFreshness {
    if (sources.length === 0) {
      return {
        state: BI_TREND_FRESHNESS_STATES.UNKNOWN,
        sourceCoverage: 0,
        freshnessHash: 'no-sources',
        sources: [],
      }
    }
    return aggregateBiTrendFreshness(sources)
  }

  private buildUnavailableSeries(
    metricKey: string,
    query: BiTrendQuery,
    _referenceDate: string,
  ): BiTrendSeries {
    const grain = query.grain ?? BI_TREND_DEFAULT_GRAIN
    const window = query.window ?? BI_TREND_DEFAULT_WINDOW
    return {
      metricKey: metricKey as BiTrendMetricKey,
      metricVersion: BI_TREND_METRIC_VERSION,
      grain,
      window,
      points: [],
      movingAverage: [],
      comparison: undefined,
      direction: 'unknown',
      anomalies: [],
      forecast: {
        method: 'linear_extrapolation',
        points: [],
        suppressed: true,
        suppressionReason: BI_TREND_WARNING_CODES.UNSUPPORTED_METRIC,
      },
      freshness: {
        state: BI_TREND_FRESHNESS_STATES.UNKNOWN,
        sourceCoverage: 0,
        freshnessHash: simpleBiTrendHash(`unavailable:${metricKey}`),
        sources: [],
      },
      warnings: [
        buildBiTrendWarning(
          BI_TREND_WARNING_CODES.UNSUPPORTED_METRIC,
          `"${metricKey}" 不在白名单指标内或来源不可用`,
          { metricKey: metricKey as BiTrendMetricKey },
        ),
      ],
      evidenceRefs: [],
      insights: [],
      sampleCount: 0,
    }
  }

  private buildRedactedSeries(
    def: BiTrendMetricDefinition,
    query: BiTrendQuery,
    _referenceDate: string,
  ): BiTrendSeries {
    const grain = query.grain ?? BI_TREND_DEFAULT_GRAIN
    const window = query.window ?? BI_TREND_DEFAULT_WINDOW
    return {
      metricKey: def.key,
      metricVersion: BI_TREND_METRIC_VERSION,
      grain,
      window,
      points: [],
      movingAverage: [],
      comparison: undefined,
      direction: 'unknown',
      anomalies: [],
      forecast: {
        method: 'linear_extrapolation',
        points: [],
        suppressed: true,
        suppressionReason: BI_TREND_WARNING_CODES.DIMENSION_REDACTED,
      },
      freshness: {
        state: BI_TREND_FRESHNESS_STATES.UNKNOWN,
        sourceCoverage: 0,
        freshnessHash: simpleBiTrendHash(`redacted:${def.key}`),
        sources: [],
      },
      warnings: [
        buildBiTrendWarning(
          BI_TREND_WARNING_CODES.DIMENSION_REDACTED,
          `"${def.label}" 指标需更高权限`,
          { metricKey: def.key },
        ),
      ],
      evidenceRefs: [],
      insights: [],
      sampleCount: 0,
    }
  }

  private sortSeries(series: BiTrendSeries[], sortKey: string, sortDir: string): BiTrendSeries[] {
    const sorted = [...series]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'direction': {
          const order: Record<string, number> = { up: 3, flat: 2, down: 1, unknown: 0 }
          cmp = (order[a.direction] ?? 0) - (order[b.direction] ?? 0)
          break
        }
        case 'sampleCount':
          cmp = a.sampleCount - b.sampleCount
          break
        case 'metricKey':
        default:
          cmp = String(a.metricKey).localeCompare(String(b.metricKey))
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted
  }

  private async writeAudit(
    organizationId: number,
    user: User,
    query: BiTrendQuery,
    resultCount: number,
    freshnessHash: string,
  ): Promise<void> {
    await this.auditService.log({
      event: 'BI_TREND_READ',
      userId: Number(user.id),
      organizationId,
      entityType: 'bi_trend_analysis',
      severity: 'info',
      metadata: {
        metricKeys: query.metricKeys.join(','),
        window: query.window ?? BI_TREND_DEFAULT_WINDOW,
        grain: query.grain ?? BI_TREND_DEFAULT_GRAIN,
        resultCount,
        freshnessHash,
      },
    })
  }
}
