import type User from '#models/user'
import { inject } from '@adonisjs/core'
import RbacService from '#services/rbac_service'
import { PROJECT_VIEW } from '#start/rbac/permissions'
import {
  COCKPIT_DEFAULT_FRESHNESS_MINUTES,
  COCKPIT_MAPPING_KINDS,
  COCKPIT_METRIC_KEYS,
  COCKPIT_OVERALL_STATUSES,
  COCKPIT_SOURCE_STATUSES,
  COCKPIT_SOURCES,
  COCKPIT_TARGET_KINDS,
  COCKPIT_WARNING_CODES,
  STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION,
  cockpitAttentionTruncatedWarning,
  cockpitEmptyStrategyWarning,
  cockpitSourceForbiddenWarning,
  cockpitSourcePartialWarning,
  cockpitSourceStaleWarning,
  cockpitSourceUnavailableWarning,
  cockpitStableHash,
  deriveCockpitOverallStatus,
  detectCockpitForbiddenFields,
  evaluateCockpitAttentionRules,
  isCockpitSourceStale,
  makeCockpitSourceFreshness,
  mergeCockpitWarnings,
  normalizeCockpitQuery,
  projectExplicitCockpitMappings,
  type CockpitAttentionItem,
  type CockpitBackflowFact,
  type CockpitCycleContext,
  type CockpitInvestmentFact,
  type CockpitKeyResultFact,
  type CockpitMappingFact,
  type CockpitMetric,
  type CockpitObjectiveFact,
  type CockpitObjectiveRow,
  type CockpitPortfolioTrafficLightFact,
  type CockpitPriorityFact,
  type CockpitQuery,
  type CockpitResourceRiskFact,
  type CockpitSource,
  type CockpitSummary,
  type CockpitWarning,
  type NormalizedCockpitQuery,
} from '@aiproj/types'

const FEATURE_FLAG_KEY = 'STRATEGY_EXECUTION_COCKPIT_ENABLED'

export interface CockpitAccess {
  canViewPmo?: boolean
  canViewPriority?: boolean
  canViewInvestment?: boolean
  canViewResource?: boolean
  canViewRisk?: boolean
  canViewBackflow?: boolean
}

export interface CockpitFacts {
  organizationId: number
  actorId: number
  cycle: CockpitCycleContext
  objectives: CockpitObjectiveFact[]
  keyResults: CockpitKeyResultFact[]
  mappings: CockpitMappingFact[]
  visibleProjectIds: Set<number>
  portfolioTrafficLight: CockpitPortfolioTrafficLightFact | null
  priority: CockpitPriorityFact | null
  investment: CockpitInvestmentFact | null
  resourceRisk: CockpitResourceRiskFact | null
  backflow: CockpitBackflowFact | null
  restrictedObjectiveCount: number
  restrictedMappingCount: number
  now: number
}

export type CockpitFactReader = (ctx: {
  user: User
  organizationId: number
  query: NormalizedCockpitQuery
  access: CockpitAccess
}) => Promise<CockpitFacts>

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function krProgress(value: number, baseline: number, target: number): number {
  const range = target - baseline
  if (range === 0) return clampPercent(value >= target ? 100 : 0)
  return clampPercent(((value - baseline) / range) * 100)
}

function latest(values: Array<string | null>): string | null {
  return (
    values
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null
  )
}

function metric(
  key: CockpitMetric['key'],
  value: number,
  unit: CockpitMetric['unit'],
  source: CockpitSource,
): CockpitMetric {
  return { key, value, unit, source, status: COCKPIT_SOURCE_STATUSES.AVAILABLE }
}

/**
 * 输出 allowlist fail-closed guard（v3-strategy-execution-cockpit §3.6）。
 * 命中 prompt/modelOutput/evidence/secret/token/apiKey/authorization 等 forbidden 键即拒绝。
 */
export function assertCockpitPayloadSafe(payload: unknown): void {
  const findings = detectCockpitForbiddenFields(payload)
  if (findings.length > 0) {
    throw new Error('cockpit payload contains forbidden field: ' + findings[0]!.path)
  }
}

@inject()
export default class StrategyExecutionCockpitService {
  private readFacts: CockpitFactReader | null = null

  constructor(private readonly rbac: RbacService) {}

  setReader(reader: CockpitFactReader): void {
    this.readFacts = reader
  }

  isFeatureEnabled(): boolean {
    const flag = process.env[FEATURE_FLAG_KEY]
    return flag === undefined || flag === '' || flag === 'true' || flag === '1'
  }

  async getSummary(
    user: User,
    organizationId: number,
    query: CockpitQuery = {},
    access: CockpitAccess = {},
  ): Promise<CockpitSummary> {
    const normalized = normalizeCockpitQuery(query)
    const reader = this.readFacts ?? ((ctx) => defaultReadCockpitFacts(ctx, this.rbac))
    const facts = await reader({ user, organizationId, query: normalized, access })
    const rows = this.buildObjectiveRows(facts)
    const attention = this.buildAttention(rows, normalized)
    const kpis = this.buildKpis(facts, rows, attention)
    const freshness = this.buildSourceFreshness(facts, normalized, access)
    const warnings = this.buildWarnings(facts, rows, freshness, normalized)
    const overallStatus =
      facts.objectives.length === 0
        ? COCKPIT_OVERALL_STATUSES.EMPTY
        : deriveCockpitOverallStatus({
            sourceStatuses: freshness.map((item) => item.status),
            mandatorySources: [
              COCKPIT_SOURCES.OKR_CYCLE,
              COCKPIT_SOURCES.OKR_OBJECTIVE,
              COCKPIT_SOURCES.OKR_MAPPING,
            ],
          })

    const summary: CockpitSummary = {
      meta: {
        calculatedAt: new Date().toISOString(),
        metricVersion: STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION,
        organizationId,
        actorId: Number(user.id),
        cycleId: facts.cycle.cycleId,
        overallStatus,
        visibleObjectiveCount: facts.objectives.length,
        visibleKeyResultCount: facts.keyResults.length,
        mappedProjectCount: facts.visibleProjectIds.size,
        restrictedObjectiveCount: facts.restrictedObjectiveCount,
        restrictedMappingCount: facts.restrictedMappingCount,
        includes: normalized.includes,
        attentionLimit: normalized.attentionLimit,
        freshnessWindowMinutes: normalized.freshnessWindowMinutes,
        inputSignatureHash: cockpitStableHash(
          [
            organizationId,
            user.id,
            facts.objectives.length,
            facts.keyResults.length,
            normalized.includes.join('|'),
            normalized.sort,
            normalized.order,
          ].join(':'),
        ),
      },
      cycleContext: facts.cycle,
      kpis,
      objectiveRows: rows,
      attention,
      portfolioTrafficLight: this.buildTrafficLightBlock(facts),
      priorityInvestment: this.buildPriorityInvestmentBlock(facts),
      resourceRisk: this.buildResourceRiskBlock(facts),
      sourceFreshness: freshness,
      warnings,
    }
    assertCockpitPayloadSafe(summary)
    return summary
  }

  private buildObjectiveRows(facts: CockpitFacts): CockpitObjectiveRow[] {
    const krsByObjective = new Map<number, CockpitKeyResultFact[]>()
    for (const kr of facts.keyResults) {
      const list = krsByObjective.get(kr.objectiveId) ?? []
      list.push(kr)
      krsByObjective.set(kr.objectiveId, list)
    }
    const projected = projectExplicitCockpitMappings({
      mappings: facts.mappings,
      organizationId: facts.organizationId,
      cycleId: facts.cycle.cycleId,
      visibleProjectIds: facts.visibleProjectIds,
    })
    return facts.objectives.map((objective) => {
      const krs = krsByObjective.get(objective.id) ?? []
      const mapped = projected.valid.filter((m) =>
        facts.mappings.some(
          (fact) =>
            fact.objectiveId === objective.id &&
            fact.projectId === m.projectId &&
            fact.kind === m.kind,
        ),
      )
      const coveragePercent =
        mapped.length === 0
          ? null
          : clampPercent(
              (mapped.reduce((s, m) => s + (m.contributionPercent ?? 10), 0) /
                Math.max(1, mapped.length)) *
                100,
            )
      const investmentMismatch = (facts.investment?.mismatchCount ?? 0) > 0
      const attention = evaluateCockpitAttentionRules({
        objective,
        mappedCount: mapped.length,
        coveragePercent,
        projectHealth: [],
        investmentMismatch,
        staleSources: this.staleSources(facts),
        now: facts.now,
        elapsedPercent: facts.cycle.elapsedPercent ?? undefined,
      })
      return {
        objectiveId: objective.id,
        objectiveTitle: objective.title,
        scope: objective.scope,
        status: objective.status,
        progress: objective.progress,
        confidence: objective.confidence,
        keyResultCount: krs.length,
        behindKeyResultCount: krs.filter((kr) => kr.progress < 50).length,
        mappedProjects: mapped,
        coveragePercent,
        executionHealth: mapped.length === 0 ? 'unavailable' : 'on_track',
        priorityBand: objective.priorityBand ?? 'unknown',
        investmentAlignment: investmentMismatch
          ? 'mismatch'
          : facts.investment
            ? 'aligned'
            : 'unknown',
        resourceRiskPressure: facts.resourceRisk?.pressureCount ?? null,
        attentionReasons: attention.map((item) => item.reason),
        warnings: [],
        target: {
          kind: COCKPIT_TARGET_KINDS.OKR_OBJECTIVE,
          href: '/organizations/' + facts.organizationId + '/okrs?objective=' + objective.id,
          authorized: true,
        },
      }
    })
  }

  private buildAttention(
    rows: CockpitObjectiveRow[],
    normalized: NormalizedCockpitQuery,
  ): CockpitAttentionItem[] {
    const candidates: CockpitAttentionItem[] = []
    for (const row of rows) {
      for (const reason of row.attentionReasons) {
        candidates.push({
          id: String(row.objectiveId) + ':' + reason,
          severity:
            reason === 'STRATEGY_PROGRESS_AT_RISK'
              ? 'critical'
              : reason === 'EXECUTION_SOURCE_STALE'
                ? 'info'
                : 'warning',
          reasonCode: reason,
          message: reason,
          basis: 'cockpit attention rule',
          ruleVersion: 'cockpit-attention-rules.v1',
          objectiveId: row.objectiveId,
          projectIds: row.mappedProjects.map((m) => m.projectId),
          sourceFreshness: [],
          target: row.target,
          warnings: [],
        })
      }
    }
    const sorted = [...candidates].sort((a, b) => {
      const rank = (s: CockpitAttentionItem['severity']) =>
        s === 'critical' ? 2 : s === 'warning' ? 1 : 0
      const diff = rank(b.severity) - rank(a.severity)
      if (diff !== 0) return diff
      return a.reasonCode.localeCompare(b.reasonCode)
    })
    return sorted.slice(0, normalized.attentionLimit)
  }

  private buildKpis(
    facts: CockpitFacts,
    rows: CockpitObjectiveRow[],
    attention: CockpitAttentionItem[],
  ): CockpitMetric[] {
    const mappedCount = rows.reduce((s, row) => s + row.mappedProjects.length, 0)
    const covered = rows.filter((row) => row.mappedProjects.length > 0).length
    const coveragePercent = rows.length === 0 ? 0 : Math.round((covered / rows.length) * 100)
    const metrics: CockpitMetric[] = [
      metric(
        COCKPIT_METRIC_KEYS.TOTAL_OBJECTIVES,
        rows.length,
        'count',
        COCKPIT_SOURCES.OKR_OBJECTIVE,
      ),
      metric(
        COCKPIT_METRIC_KEYS.TOTAL_KEY_RESULTS,
        facts.keyResults.length,
        'count',
        COCKPIT_SOURCES.OKR_KEY_RESULT,
      ),
      metric(
        COCKPIT_METRIC_KEYS.TOTAL_MAPPED_PROJECTS,
        mappedCount,
        'count',
        COCKPIT_SOURCES.OKR_MAPPING,
      ),
      metric(
        COCKPIT_METRIC_KEYS.MAPPING_COVERAGE_PERCENT,
        coveragePercent,
        'percent',
        COCKPIT_SOURCES.OKR_MAPPING,
      ),
      metric(
        COCKPIT_METRIC_KEYS.ATTENTION_COUNT,
        attention.length,
        'count',
        COCKPIT_SOURCES.COMPUTED,
      ),
      metric(
        COCKPIT_METRIC_KEYS.SOURCE_STALE_COUNT,
        this.staleSources(facts).length,
        'count',
        COCKPIT_SOURCES.COMPUTED,
      ),
    ]
    if (facts.portfolioTrafficLight?.available) {
      metrics.push(
        metric(
          COCKPIT_METRIC_KEYS.PORTFOLIO_TRAFFIC_LIGHT_RED,
          facts.portfolioTrafficLight.redCount ?? 0,
          'count',
          COCKPIT_SOURCES.PORTFOLIO_TRAFFIC_LIGHT,
        ),
      )
      metrics.push(
        metric(
          COCKPIT_METRIC_KEYS.PORTFOLIO_TRAFFIC_LIGHT_GREEN,
          facts.portfolioTrafficLight.greenCount ?? 0,
          'count',
          COCKPIT_SOURCES.PORTFOLIO_TRAFFIC_LIGHT,
        ),
      )
    }
    if (facts.priority)
      metrics.push(
        metric(
          COCKPIT_METRIC_KEYS.PRIORITY_MISMATCH_COUNT,
          facts.priority.mismatchCount ?? 0,
          'count',
          COCKPIT_SOURCES.PORTFOLIO_PRIORITY,
        ),
      )
    if (facts.investment)
      metrics.push(
        metric(
          COCKPIT_METRIC_KEYS.INVESTMENT_MISMATCH_COUNT,
          facts.investment.mismatchCount ?? 0,
          'count',
          COCKPIT_SOURCES.INVESTMENT_DISTRIBUTION,
        ),
      )
    if (facts.resourceRisk)
      metrics.push(
        metric(
          COCKPIT_METRIC_KEYS.RESOURCE_RISK_PRESSURE_COUNT,
          facts.resourceRisk.pressureCount ?? 0,
          'count',
          COCKPIT_SOURCES.RESOURCE_RISK,
        ),
      )
    return metrics
  }

  private buildSourceFreshness(
    facts: CockpitFacts,
    normalized: NormalizedCockpitQuery,
    access: CockpitAccess,
  ): Array<ReturnType<typeof makeCockpitSourceFreshness>> {
    const threshold = normalized.freshnessWindowMinutes
    const freshness = [
      makeCockpitSourceFreshness({
        source: COCKPIT_SOURCES.OKR_CYCLE,
        lastUpdatedAt: facts.cycle.cycleId ? new Date().toISOString() : null,
        staleThresholdMinutes: threshold,
        now: facts.now,
      }),
      makeCockpitSourceFreshness({
        source: COCKPIT_SOURCES.OKR_OBJECTIVE,
        lastUpdatedAt: latest(facts.objectives.map((o) => o.updatedAt)),
        staleThresholdMinutes: threshold,
        now: facts.now,
      }),
      makeCockpitSourceFreshness({
        source: COCKPIT_SOURCES.OKR_KEY_RESULT,
        lastUpdatedAt: latest(facts.keyResults.map((kr) => kr.updatedAt)),
        staleThresholdMinutes: threshold,
        now: facts.now,
      }),
      makeCockpitSourceFreshness({
        source: COCKPIT_SOURCES.OKR_MAPPING,
        lastUpdatedAt: latest(facts.mappings.map((m) => m.deletedAt)),
        staleThresholdMinutes: threshold,
        now: facts.now,
      }),
    ]
    if (facts.portfolioTrafficLight)
      freshness.push(
        makeCockpitSourceFreshness({
          source: COCKPIT_SOURCES.PORTFOLIO_TRAFFIC_LIGHT,
          lastUpdatedAt: facts.portfolioTrafficLight.lastUpdatedAt,
          staleThresholdMinutes: threshold,
          now: facts.now,
          forbidden: access.canViewPmo === false,
        }),
      )
    if (facts.priority)
      freshness.push(
        makeCockpitSourceFreshness({
          source: COCKPIT_SOURCES.PORTFOLIO_PRIORITY,
          lastUpdatedAt: facts.priority.lastUpdatedAt,
          staleThresholdMinutes: threshold,
          now: facts.now,
          forbidden: access.canViewPriority === false,
        }),
      )
    if (facts.investment)
      freshness.push(
        makeCockpitSourceFreshness({
          source: COCKPIT_SOURCES.INVESTMENT_DISTRIBUTION,
          lastUpdatedAt: facts.investment.lastUpdatedAt,
          staleThresholdMinutes: threshold,
          now: facts.now,
          forbidden: access.canViewInvestment === false,
        }),
      )
    if (facts.resourceRisk)
      freshness.push(
        makeCockpitSourceFreshness({
          source: COCKPIT_SOURCES.RESOURCE_RISK,
          lastUpdatedAt: facts.resourceRisk.lastUpdatedAt,
          staleThresholdMinutes: threshold,
          now: facts.now,
          forbidden: access.canViewResource === false || access.canViewRisk === false,
        }),
      )
    if (facts.backflow)
      freshness.push(
        makeCockpitSourceFreshness({
          source: COCKPIT_SOURCES.BACKFLOW,
          lastUpdatedAt: facts.backflow.lastUpdatedAt,
          staleThresholdMinutes: threshold,
          now: facts.now,
          forbidden: access.canViewBackflow === false,
        }),
      )
    return freshness
  }

  private buildWarnings(
    facts: CockpitFacts,
    rows: CockpitObjectiveRow[],
    freshness: Array<ReturnType<typeof makeCockpitSourceFreshness>>,
    normalized: NormalizedCockpitQuery,
  ): CockpitWarning[] {
    const warnings: CockpitWarning[] = []
    if (facts.objectives.length === 0) warnings.push(cockpitEmptyStrategyWarning())
    if (rows.some((row) => row.mappedProjects.length === 0) && facts.objectives.length > 0) {
      warnings.push({
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_MISSING,
        message: '部分目标缺少显式执行映射',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      })
    }
    for (const item of freshness) {
      if (item.status === COCKPIT_SOURCE_STATUSES.STALE)
        warnings.push(cockpitSourceStaleWarning(item.source))
      if (item.status === COCKPIT_SOURCE_STATUSES.PARTIAL)
        warnings.push(cockpitSourcePartialWarning(item.source))
      if (item.status === COCKPIT_SOURCE_STATUSES.UNAVAILABLE)
        warnings.push(cockpitSourceUnavailableWarning(item.source))
      if (item.status === COCKPIT_SOURCE_STATUSES.FORBIDDEN)
        warnings.push(cockpitSourceForbiddenWarning(item.source))
    }
    const candidateCount = rows.reduce((n, row) => n + row.attentionReasons.length, 0)
    if (candidateCount > normalized.attentionLimit)
      warnings.push(cockpitAttentionTruncatedWarning())
    return mergeCockpitWarnings(warnings)
  }

  private buildTrafficLightBlock(facts: CockpitFacts) {
    const t = facts.portfolioTrafficLight
    return {
      available: t?.available ?? false,
      forbidden: t?.forbidden ?? false,
      redCount: t?.redCount ?? 0,
      yellowCount: t?.yellowCount ?? 0,
      greenCount: t?.greenCount ?? 0,
      grayCount: t?.grayCount ?? 0,
      freshness: t
        ? makeCockpitSourceFreshness({
            source: COCKPIT_SOURCES.PORTFOLIO_TRAFFIC_LIGHT,
            lastUpdatedAt: t.lastUpdatedAt,
            staleThresholdMinutes: COCKPIT_DEFAULT_FRESHNESS_MINUTES,
            now: facts.now,
            forbidden: t.forbidden,
          })
        : null,
      warnings: t ? [] : [cockpitSourceUnavailableWarning(COCKPIT_SOURCES.PORTFOLIO_TRAFFIC_LIGHT)],
    }
  }

  private buildPriorityInvestmentBlock(facts: CockpitFacts) {
    const p = facts.priority
    const i = facts.investment
    const available = Boolean(p?.available || i?.available)
    return {
      available,
      forbidden: p?.forbidden === true || i?.forbidden === true,
      unsupportedFinancial: p?.unsupportedFinancial === true || i?.unsupportedFinancial === true,
      priorityMismatchCount: p?.mismatchCount ?? null,
      investmentMismatchCount: i?.mismatchCount ?? null,
      basis: [p?.basis, i?.basis].filter(Boolean).join(' | ') || 'unavailable',
      freshness: p
        ? makeCockpitSourceFreshness({
            source: COCKPIT_SOURCES.PORTFOLIO_PRIORITY,
            lastUpdatedAt: p.lastUpdatedAt,
            staleThresholdMinutes: COCKPIT_DEFAULT_FRESHNESS_MINUTES,
            now: facts.now,
          })
        : i
          ? makeCockpitSourceFreshness({
              source: COCKPIT_SOURCES.INVESTMENT_DISTRIBUTION,
              lastUpdatedAt: i.lastUpdatedAt,
              staleThresholdMinutes: COCKPIT_DEFAULT_FRESHNESS_MINUTES,
              now: facts.now,
            })
          : null,
      warnings: available
        ? []
        : [cockpitSourceUnavailableWarning(COCKPIT_SOURCES.INVESTMENT_DISTRIBUTION)],
    }
  }

  private buildResourceRiskBlock(facts: CockpitFacts) {
    const r = facts.resourceRisk
    return {
      available: r?.available ?? false,
      forbidden: r?.forbidden ?? false,
      pressureCount: r?.pressureCount ?? null,
      freshness: r
        ? makeCockpitSourceFreshness({
            source: COCKPIT_SOURCES.RESOURCE_RISK,
            lastUpdatedAt: r.lastUpdatedAt,
            staleThresholdMinutes: COCKPIT_DEFAULT_FRESHNESS_MINUTES,
            now: facts.now,
            forbidden: r.forbidden,
          })
        : null,
      warnings: r ? [] : [cockpitSourceUnavailableWarning(COCKPIT_SOURCES.RESOURCE_RISK)],
    }
  }

  private staleSources(facts: CockpitFacts): CockpitSource[] {
    const sources: CockpitSource[] = []
    const threshold = COCKPIT_DEFAULT_FRESHNESS_MINUTES
    if (
      isCockpitSourceStale(latest(facts.objectives.map((o) => o.updatedAt)), threshold, facts.now)
    )
      sources.push(COCKPIT_SOURCES.OKR_OBJECTIVE)
    if (
      isCockpitSourceStale(latest(facts.keyResults.map((kr) => kr.updatedAt)), threshold, facts.now)
    )
      sources.push(COCKPIT_SOURCES.OKR_KEY_RESULT)
    if (
      facts.portfolioTrafficLight &&
      isCockpitSourceStale(facts.portfolioTrafficLight.lastUpdatedAt, threshold, facts.now)
    )
      sources.push(COCKPIT_SOURCES.PORTFOLIO_TRAFFIC_LIGHT)
    return sources
  }
}

async function defaultReadCockpitFacts(
  ctx: { user: User; organizationId: number; query: NormalizedCockpitQuery; access: CockpitAccess },
  rbac: RbacService,
): Promise<CockpitFacts> {
  const { user, organizationId, query, access } = ctx
  const now = Date.now()

  const { default: OkrCycleModel } = await import('#models/okr_cycle')
  const { default: OkrObjectiveModel } = await import('#models/okr_objective')
  const { default: OkrKeyResultModel } = await import('#models/okr_key_result')
  const { default: ProjectModel } = await import('#models/project')

  let cycleQuery = OkrCycleModel.query()
    .where('organization_id', organizationId)
    .whereNull('deleted_at')
  if (query.cycleId) cycleQuery = cycleQuery.where('id', query.cycleId)
  const cycleRow = await cycleQuery.orderBy('start_date', 'desc').first()
  const cycle: CockpitCycleContext = cycleRow
    ? {
        cycleId: Number(cycleRow.id),
        title: String(cycleRow.title ?? ''),
        status: String(cycleRow.status ?? '') as CockpitCycleContext['status'],
        startDate: cycleRow.startDate ? new Date(String(cycleRow.startDate)).toISOString() : null,
        endDate: cycleRow.endDate ? new Date(String(cycleRow.endDate)).toISOString() : null,
        elapsedPercent: null,
        daysRemaining: null,
      }
    : {
        cycleId: null,
        title: null,
        status: null,
        startDate: null,
        endDate: null,
        elapsedPercent: null,
        daysRemaining: null,
      }

  const projectRows = await ProjectModel.query()
    .where('organization_id', organizationId)
    .whereNull('deleted_at')
    .select('id')
  const visibleProjectIds = new Set<number>()
  for (const project of projectRows) {
    const { allowed } = await rbac.check(user, PROJECT_VIEW, organizationId, Number(project.id))
    if (allowed) visibleProjectIds.add(Number(project.id))
  }

  let objQuery = OkrObjectiveModel.query()
    .where('organization_id', organizationId)
    .whereNull('deleted_at')
  if (cycle.cycleId != null) objQuery = objQuery.where('cycle_id', cycle.cycleId)
  if (query.scopes.length > 0) objQuery = objQuery.whereIn('scope', query.scopes)
  if (query.statuses.length > 0) objQuery = objQuery.whereIn('status', query.statuses)
  if (query.ownerIds.length > 0) objQuery = objQuery.whereIn('owner_id', query.ownerIds)
  const objRows = await objQuery.orderBy('updated_at', 'desc').limit(5000)
  const objectives: CockpitObjectiveFact[] = objRows.map((o) => ({
    id: Number(o.id),
    organizationId: Number(o.organizationId),
    cycleId: o.cycleId ? Number(o.cycleId) : null,
    projectId: o.projectId ? Number(o.projectId) : null,
    scope: (String(o.scope ?? '') || null) as CockpitObjectiveFact['scope'],
    title: o.title,
    status: String(o.status ?? '') as CockpitObjectiveFact['status'],
    progress: Number(o.progress ?? 0),
    confidence: String(o.confidence ?? 'medium') as CockpitObjectiveFact['confidence'],
    priorityBand: null,
    updatedAt: o.updatedAt ? (o.updatedAt.toISO() ?? null) : null,
  }))
  const objectiveIds = objectives.map((o) => o.id)
  const krRows =
    objectiveIds.length > 0
      ? await OkrKeyResultModel.query()
          .where('organization_id', organizationId)
          .whereNull('deleted_at')
          .whereIn('objective_id', objectiveIds)
      : []
  const keyResults: CockpitKeyResultFact[] = krRows.map((kr) => ({
    id: Number(kr.id),
    organizationId: Number(kr.organizationId),
    objectiveId: Number(kr.objectiveId),
    status: String(kr.status ?? '') as CockpitKeyResultFact['status'],
    progress: krProgress(
      Number(kr.currentValue ?? 0),
      Number(kr.baselineValue ?? 0),
      Number(kr.targetValue ?? 0),
    ),
    updatedAt: kr.lastUpdatedAt ? (kr.lastUpdatedAt.toISO() ?? null) : null,
  }))

  const mappings: CockpitMappingFact[] = []
  for (const objective of objectives) {
    if (objective.cycleId == null || objective.cycleId !== cycle.cycleId) continue
    if (objective.projectId != null && visibleProjectIds.has(objective.projectId)) {
      mappings.push({
        id: -(objective.id * 1000 + objective.projectId),
        organizationId,
        objectiveId: objective.id,
        keyResultId: null,
        projectId: objective.projectId,
        kind: COCKPIT_MAPPING_KINDS.DIRECT_PROJECT_CONTRIBUTION,
        weight: 1,
        contributionPercent: null,
        active: true,
        deletedAt: null,
        sourceVersion: 'okr-objective.v1',
        targetVisible: true,
      })
    }
  }

  let portfolioTrafficLight: CockpitPortfolioTrafficLightFact | null = null
  const canViewTrafficLight = access.canViewPmo === undefined || access.canViewPmo === true
  if (canViewTrafficLight) {
    try {
      const { default: PortfolioDashboardService } =
        await import('#services/portfolio_dashboard_service')
      const portfolio = new PortfolioDashboardService()
      const portfolioSummary = await portfolio.getSummary(
        organizationId,
        user,
        access.canViewPmo !== false,
        access.canViewRisk !== false,
        access.canViewResource !== false,
        false,
        false,
      )
      const tl = portfolioSummary?.trafficLight ?? null
      if (tl?.available) {
        portfolioTrafficLight = {
          available: true,
          forbidden: false,
          redCount: tl.redCount,
          yellowCount: tl.yellowCount,
          greenCount: tl.greenCount,
          grayCount: tl.grayCount,
          lastUpdatedAt: new Date().toISOString(),
          sourceVersion: 'portfolio-dashboard.v1',
        }
      } else if (tl?.forbidden) {
        portfolioTrafficLight = {
          available: false,
          forbidden: true,
          redCount: 0,
          yellowCount: 0,
          greenCount: 0,
          grayCount: 0,
          lastUpdatedAt: null,
          sourceVersion: 'portfolio-dashboard.v1',
        }
      }
    } catch {
      portfolioTrafficLight = null
    }
  }

  return {
    organizationId,
    actorId: Number(user.id),
    cycle,
    objectives,
    keyResults,
    mappings,
    visibleProjectIds,
    portfolioTrafficLight,
    priority: null,
    investment: null,
    resourceRisk: null,
    backflow: null,
    restrictedObjectiveCount: 0,
    restrictedMappingCount: 0,
    now,
  }
}
