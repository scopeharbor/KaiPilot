import { inject } from '@adonisjs/core'
import type User from '#models/user'
import BiRiskHeatmapPolicy, {
  type BiRiskHeatmapDimensionAccess,
} from '#policies/bi_risk_heatmap_policy'
import {
  isUnsupportedFinancialRiskMetricKey,
  isBiRiskHeatmapDimensionPairUnsafe,
  isBiRiskHeatmapCellCountWithinLimit,
  buildBiRiskHeatmapWarning,
  computeBiRiskHeatmapCellScore,
  classifyBiRiskHeatmapCellLevel,
  computeBiRiskHeatmapConfidence,
  truncateBiRiskHeatmapContributors,
  aggregateBiRiskHeatmapFreshness,
  buildBiRiskHeatmapQueryShape,
  redactBiRiskHeatmapEvidence,
  normalizeBiRiskHeatmapCellKey,
  normalizeBiRiskHeatmapDimensionValue,
  BI_RISK_HEATMAP_SOURCE_KINDS,
  BI_RISK_HEATMAP_DEFAULT_WINDOW,
  BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
  BI_RISK_HEATMAP_MAX_PER_PAGE,
  BI_RISK_HEATMAP_METRIC_VERSION,
  BI_RISK_HEATMAP_MIN_SAMPLE_COUNT,
  BI_RISK_HEATMAP_WARNING_CODES,
  BI_RISK_HEATMAP_FRESHNESS_STATES,
  BI_RISK_HEATMAP_SORT_KEYS,
  BI_RISK_HEATMAP_WINDOW_DAYS,
  type BiRiskHeatmapDimensionKey,
  type BiRiskHeatmapQuery,
  type BiRiskHeatmapCell,
  type BiRiskHeatmapWarning,
  type BiRiskHeatmapSourceRef,
  type BiRiskHeatmapEvidenceRef,
  type BiRiskHeatmapContributor,
  type BiRiskHeatmapDrilldownTarget,
  type BiRiskHeatmapFreshness,
  type BiRiskHeatmapResponse,
  type BiRiskHeatmapResponseMeta,
  type BiRiskHeatmapRedactionState,
} from '@aiproj/types'
import type { HealthDiagnosisSummary } from '@aiproj/types'
import {
  resolveBiRiskHeatmapMetric,
  type BiRiskHeatmapMetricDefinition,
} from './bi_risk_heatmap_metric_registry.js'
import AuditService from '#services/audit_service'

/**
 * BI 风险热力图聚合服务（v3-bi-risk-heatmap §3.4–3.6）。
 *
 * 只读有界组织级聚合服务：
 * - 从授权可见的事实来源读取风险数据
 * - 使用确定性评分算法生成热力 cells
 * - 永不修改业务事实
 */
@inject()
export default class BiRiskHeatmapService {
  constructor(
    private readonly policy: BiRiskHeatmapPolicy,
    private readonly auditService: AuditService,
  ) {}

  async getHeatmap(
    organizationId: number,
    user: User,
    query: BiRiskHeatmapQuery,
  ): Promise<BiRiskHeatmapResponse> {
    const referenceDate = new Date().toISOString().slice(0, 10)
    const dimAccess = await this.policy.resolveDimensionAccess(user, organizationId)

    const allWarnings: BiRiskHeatmapWarning[] = []
    const sourceRefs: BiRiskHeatmapSourceRef[] = []

    // 1. 财务指标检测
    if (isUnsupportedFinancialRiskMetricKey(query.metricKey)) {
      return this.buildUnavailableResponse(organizationId, query, referenceDate, [
        buildBiRiskHeatmapWarning(
          BI_RISK_HEATMAP_WARNING_CODES.UNSUPPORTED_FINANCIAL_METRIC,
          `不支持的财务风险指标: ${query.metricKey}`,
          { metricKey: query.metricKey },
        ),
      ])
    }

    // 2. 指标注册表检测
    const def = resolveBiRiskHeatmapMetric(query.metricKey)
    if (!def) {
      return this.buildUnavailableResponse(organizationId, query, referenceDate, [
        buildBiRiskHeatmapWarning(
          BI_RISK_HEATMAP_WARNING_CODES.UNSUPPORTED_METRIC,
          `指标 "${query.metricKey}" 不在白名单内`,
          { metricKey: query.metricKey },
        ),
      ])
    }

    // 3. 维度安全检测
    if (isBiRiskHeatmapDimensionPairUnsafe(query.rowDimension, query.columnDimension)) {
      return this.buildUnavailableResponse(organizationId, query, referenceDate, [
        buildBiRiskHeatmapWarning(
          BI_RISK_HEATMAP_WARNING_CODES.UNSUPPORTED_QUERY_COMBINATION,
          '行维度和列维度不能相同',
          { rowDimension: query.rowDimension, columnDimension: query.columnDimension },
        ),
      ])
    }

    // 4. 指标权限检测
    if (this.policy.needsMetricRedaction(query.metricKey, dimAccess)) {
      return this.buildRedactedResponse(organizationId, query, def, referenceDate, dimAccess)
    }

    // 5. 维度权限检测
    const rowRedacted = this.policy.needsRedaction(query.rowDimension, dimAccess)
    const colRedacted = this.policy.needsRedaction(query.columnDimension, dimAccess)
    const redactionState: BiRiskHeatmapRedactionState =
      rowRedacted && colRedacted ? 'full' : rowRedacted || colRedacted ? 'partial' : 'none'

    if (redactionState === 'full') {
      return this.buildRedactedResponse(organizationId, query, def, referenceDate, dimAccess)
    }

    // 6. 来源收集
    const rawRiskData = await this.collectRiskData(organizationId, def, query, dimAccess)

    sourceRefs.push({
      sourceKind: def.sourceKind,
      state:
        rawRiskData.length > 0
          ? BI_RISK_HEATMAP_FRESHNESS_STATES.FRESH
          : BI_RISK_HEATMAP_FRESHNESS_STATES.UNKNOWN,
      lastRefreshedAt: new Date().toISOString(),
      metricVersion: def.metricVersion,
    })

    // 7. 构建热力 cells
    const cells = this.buildHeatmapCells(rawRiskData, def, query, redactionState, dimAccess)

    // 8. Cell 数量检测
    if (!isBiRiskHeatmapCellCountWithinLimit(cells.length)) {
      allWarnings.push(
        buildBiRiskHeatmapWarning(
          BI_RISK_HEATMAP_WARNING_CODES.THRESHOLD_BREACHED,
          `热力 cell 数量超过上限，仅返回前 500 个`,
          { cellCount: cells.length },
        ),
      )
    }

    // 9. 排序
    const sorted = this.sortCells(
      cells.slice(0, 500),
      query.sort ?? BI_RISK_HEATMAP_SORT_KEYS.SCORE,
      query.sortDir ?? 'desc',
    )

    // 10. 分页
    const page = query.page ?? 1
    const perPage = Math.min(
      query.perPage ?? BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
      BI_RISK_HEATMAP_MAX_PER_PAGE,
    )
    const total = sorted.length
    const totalPages = Math.ceil(total / perPage)
    const offset = (page - 1) * perPage
    const paged = sorted.slice(offset, offset + perPage)

    // 11. Freshness
    const freshness = aggregateBiRiskHeatmapFreshness(
      sourceRefs.length > 0
        ? sourceRefs
        : [
            {
              sourceKind: BI_RISK_HEATMAP_SOURCE_KINDS.RISK_REGISTER,
              state: BI_RISK_HEATMAP_FRESHNESS_STATES.UNKNOWN,
              lastRefreshedAt: null,
              metricVersion: BI_RISK_HEATMAP_METRIC_VERSION,
            },
          ],
    )

    // 12. 审计
    await this.writeAudit(organizationId, user, query, paged.length, freshness.freshnessHash)

    const queryShape = buildBiRiskHeatmapQueryShape(query)
    const calculatedAt = new Date().toISOString()

    const meta: BiRiskHeatmapResponseMeta = {
      organizationId,
      calculatedAt,
      metricVersion: BI_RISK_HEATMAP_METRIC_VERSION,
      queryShape,
      freshness,
      page,
      perPage,
      total,
      totalPages,
    }

    return { data: paged, meta, warnings: allWarnings, queryShape, calculatedAt }
  }

  // ── 数据收集 ──────────────────────────────────────────────────────────────

  private async collectRiskData(
    organizationId: number,
    def: BiRiskHeatmapMetricDefinition,
    query: BiRiskHeatmapQuery,
    _dimAccess: BiRiskHeatmapDimensionAccess,
  ): Promise<RawRiskEntry[]> {
    const entries: RawRiskEntry[] = []

    // 从风险登记表收集
    if (
      def.sourceKind === BI_RISK_HEATMAP_SOURCE_KINDS.RISK_REGISTER ||
      def.sourceKind === BI_RISK_HEATMAP_SOURCE_KINDS.RISK_MATRIX ||
      def.sourceKind === BI_RISK_HEATMAP_SOURCE_KINDS.ORGANIZATION_DASHBOARD_RISK
    ) {
      const riskEntries = await this.collectFromRiskRegister(organizationId, query)
      entries.push(...riskEntries)
    }

    // 从 PMO 交通灯收集
    if (def.sourceKind === BI_RISK_HEATMAP_SOURCE_KINDS.PMO_TRAFFIC_LIGHT) {
      const tlEntries = await this.collectFromTrafficLight(organizationId, query)
      entries.push(...tlEntries)
    }

    // 从项目健康诊断收集
    if (def.sourceKind === BI_RISK_HEATMAP_SOURCE_KINDS.PROJECT_HEALTH_DIAGNOSIS) {
      const healthEntries = await this.collectFromHealthDiagnosis(organizationId, query)
      entries.push(...healthEntries)
    }

    return entries
  }

  private async collectFromRiskRegister(
    organizationId: number,
    query: BiRiskHeatmapQuery,
  ): Promise<RawRiskEntry[]> {
    const { default: RiskModel } = await import('#models/risk')

    const baseQuery = RiskModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .preload('project', (pq) => {
        pq.whereNull('deleted_at').select('id', 'name', 'organization_id')
      })

    // 时间窗口过滤
    const window = query.window ?? BI_RISK_HEATMAP_DEFAULT_WINDOW
    const windowDays = BI_RISK_HEATMAP_WINDOW_DAYS[window]
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - windowDays)
    baseQuery.where('created_at', '>=', cutoff.toISOString().slice(0, 10))

    // 筛选
    if (query.filters?.projectIds?.length) {
      baseQuery.whereIn('project_id', query.filters.projectIds.map(Number))
    }
    if (query.filters?.riskCategories?.length) {
      baseQuery.whereIn('category', query.filters.riskCategories)
    }
    if (query.filters?.riskLevels?.length) {
      baseQuery.whereIn('risk_level', query.filters.riskLevels)
    }
    if (query.filters?.riskStatuses?.length) {
      baseQuery.whereIn('status', query.filters.riskStatuses)
    }

    const risks = await baseQuery

    const projectMap = new Map<number, string>()
    for (const risk of risks as any[]) {
      if (risk.project && !projectMap.has(risk.project.id)) {
        projectMap.set(risk.project.id, risk.project.name)
      }
    }

    return (risks as any[]).map((r) => ({
      projectId: r.projectId ?? 0,
      projectName: projectMap.get(r.projectId) ?? `项目${r.projectId}`,
      category: r.category ?? '未分类',
      // Risk 模型的实际列是 risk_level（见 app/models/risk.ts），旧代码读 r.level
      // 恒为 undefined → 全部落 'medium' 兜底，导致「风险等级」列维度永远只有一列。
      level: r.riskLevel ?? 'medium',
      status: r.status ?? 'open',
      probability: r.probability ?? 0.5,
      impact: r.impact ?? 0.5,
      createdAt: r.createdAt?.toString() ?? new Date().toISOString(),
      assigneeId: r.ownerId ?? 0,
    }))
  }

  private async collectFromTrafficLight(
    organizationId: number,
    _query: BiRiskHeatmapQuery,
  ): Promise<RawRiskEntry[]> {
    const { default: ProjectModel } = await import('#models/project')

    const projects = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id', 'name', 'status')

    // 从项目状态构建交通灯风险条目
    return (projects as any[]).map((p) => ({
      projectId: Number(p.id),
      projectName: p.name ?? `项目${p.id}`,
      category: 'traffic_light',
      level: p.status === 'at_risk' ? 'high' : p.status === 'active' ? 'medium' : 'low',
      status: p.status ?? 'unknown',
      probability: p.status === 'at_risk' ? 0.7 : p.status === 'active' ? 0.4 : 0.2,
      impact: p.status === 'at_risk' ? 0.7 : 0.3,
      createdAt: new Date().toISOString(),
      assigneeId: 0,
    }))
  }

  private async collectFromHealthDiagnosis(
    organizationId: number,
    _query: BiRiskHeatmapQuery,
  ): Promise<RawRiskEntry[]> {
    // 项目健康诊断数据 —— 使用诊断快照（summary JSON 内的 overallLabel 定级）。
    // 注意：project_health_diagnoses 无 deleted_at 列，且列名是 project_id /
    // status / summary（旧代码 select 'projectId'/'overallSeverity' 会直接 SQL 报错）。
    const { default: HealthDiagnosisModel } = await import('#models/project_health_diagnosis')

    const diagnoses = await HealthDiagnosisModel.query()
      .where('organization_id', organizationId)
      .select('id', 'project_id', 'status', 'summary')
      .orderBy('created_at', 'desc')
      .limit(1000)

    const { default: ProjectModel } = await import('#models/project')
    const projectIds = [...new Set((diagnoses as any[]).map((d) => d.projectId))]
    const projects =
      projectIds.length > 0
        ? await ProjectModel.query().whereIn('id', projectIds).select('id', 'name')
        : []

    const projectMap = new Map<number, string>()
    for (const p of projects as any[]) {
      projectMap.set(Number(p.id), p.name ?? `项目${p.id}`)
    }

    return (diagnoses as any[]).map((d) => {
      const level = this.diagnosisSummaryToRiskLevel(d.summary)
      return {
        projectId: d.projectId ?? 0,
        projectName: projectMap.get(d.projectId) ?? `项目${d.projectId}`,
        category: 'health_diagnosis',
        level,
        status: d.status ?? 'unknown',
        probability:
          level === 'critical' ? 0.9 : level === 'high' ? 0.6 : level === 'medium' ? 0.35 : 0.15,
        impact: 0.5,
        createdAt: new Date().toISOString(),
        assigneeId: 0,
      }
    })
  }

  // ── Cell 构建 ─────────────────────────────────────────────────────────────

  private buildHeatmapCells(
    raw: RawRiskEntry[],
    def: BiRiskHeatmapMetricDefinition,
    query: BiRiskHeatmapQuery,
    redactionState: BiRiskHeatmapRedactionState,
    _dimAccess: BiRiskHeatmapDimensionAccess,
  ): BiRiskHeatmapCell[] {
    // 按行列分组
    const groups = new Map<string, RawRiskEntry[]>()
    for (const entry of raw) {
      const rowVal = this.resolveDimensionValue(entry, query.rowDimension, redactionState)
      const colVal = this.resolveDimensionValue(entry, query.columnDimension, redactionState)
      const key = normalizeBiRiskHeatmapCellKey(rowVal, colVal)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(entry)
    }

    const cells: BiRiskHeatmapCell[] = []
    for (const [key, entries] of groups) {
      const [rowKey, colKey] = key.split('::')
      const sampleCount = entries.length

      // 概率和影响的加权均值
      const avgProb = entries.reduce((s, e) => s + e.probability, 0) / sampleCount
      const avgImpact = entries.reduce((s, e) => s + e.impact, 0) / sampleCount
      const severityWeight = this.computeSeverityWeight(entries)
      const statusWeight = this.computeStatusWeight(entries)

      const score = computeBiRiskHeatmapCellScore({
        probability: avgProb,
        impact: avgImpact,
        severityWeight,
        statusWeight,
      })

      const riskLevel = classifyBiRiskHeatmapCellLevel(score, sampleCount)

      // Delta：目前无上期数据，返回 null
      const delta: number | null = null

      const sourceCoverage = this.computeSourceCoverage(def)
      const confidence = computeBiRiskHeatmapConfidence({ sampleCount, sourceCoverage })

      // Contributors
      const contributors = truncateBiRiskHeatmapContributors(this.buildContributors(entries, def))

      const warnings: BiRiskHeatmapWarning[] = []
      if (sampleCount < BI_RISK_HEATMAP_MIN_SAMPLE_COUNT) {
        warnings.push(
          buildBiRiskHeatmapWarning(
            BI_RISK_HEATMAP_WARNING_CODES.INSUFFICIENT_SAMPLE,
            `样本数 ${sampleCount} 低于最小要求 ${BI_RISK_HEATMAP_MIN_SAMPLE_COUNT}`,
            { sampleCount },
          ),
        )
      }

      const evidenceRefs = this.buildEvidenceRefs(def, redactionState)
      const drilldownTargets = this.buildDrilldownTargets(entries, def, redactionState)

      cells.push({
        rowKey: normalizeBiRiskHeatmapDimensionValue(rowKey),
        rowLabel: rowKey,
        columnKey: normalizeBiRiskHeatmapDimensionValue(colKey),
        columnLabel: colKey,
        score,
        riskLevel,
        count: sampleCount,
        delta,
        confidence,
        contributors,
        redactionState,
        warnings,
        evidenceRefs,
        sampleCount,
        drilldownTargets,
      })
    }

    return cells
  }

  private resolveDimensionValue(
    entry: RawRiskEntry,
    dimension: BiRiskHeatmapDimensionKey,
    redactionState: BiRiskHeatmapRedactionState,
  ): string {
    if (redactionState === 'full') return '[已脱敏]'
    switch (dimension) {
      case 'project':
        return entry.projectName
      case 'risk_category':
        return entry.category
      case 'risk_level':
        return entry.level
      case 'risk_status':
        return entry.status
      case 'assignee':
        return redactionState === 'partial' ? '[已脱敏]' : `负责人${entry.assigneeId}`
      case 'portfolio_group':
        return '默认分组'
      case 'time_bucket':
        return entry.createdAt.slice(0, 7)
      case 'department':
        return redactionState === 'partial' ? '[已脱敏]' : '默认部门'
      default:
        return '未知'
    }
  }

  private computeSeverityWeight(entries: RawRiskEntry[]): number {
    const levelWeights: Record<string, number> = {
      critical: 1.0,
      high: 0.8,
      medium: 0.5,
      low: 0.2,
      none: 0.05,
    }
    const avg = entries.reduce((s, e) => s + (levelWeights[e.level] ?? 0.5), 0) / entries.length
    return avg
  }

  private computeStatusWeight(entries: RawRiskEntry[]): number {
    // 键必须是 risks.status 的真实枚举（identified/analyzing/mitigating/resolved/
    // accepted/closed，见 app/models/risk.ts 与 risks 表 CHECK 约束）。旧代码用
    // open/in_progress/monitoring —— 该枚举在本系统中不存在，导致所有真实风险
    // 落入 0.5 兜底、分数被腰斩，critical 单元永不达到 high/critical。
    // 数值沿用原意图：活跃处置中 ≈1.0，评审/接受 ≈0.7，监控 ≈0.4，已解决 0.1，关闭 0。
    const statusWeights: Record<string, number> = {
      identified: 1.0,
      analyzing: 0.7,
      mitigating: 0.7,
      accepted: 0.4,
      resolved: 0.1,
      closed: 0.0,
    }
    const avg = entries.reduce((s, e) => s + (statusWeights[e.status] ?? 0.5), 0) / entries.length
    return avg
  }

  private computeSourceCoverage(_def: BiRiskHeatmapMetricDefinition): number {
    return 1.0
  }

  private buildContributors(
    entries: RawRiskEntry[],
    def: BiRiskHeatmapMetricDefinition,
  ): BiRiskHeatmapContributor[] {
    const projectCounts = new Map<number, number>()
    for (const e of entries) {
      projectCounts.set(e.projectId, (projectCounts.get(e.projectId) ?? 0) + 1)
    }

    const total = entries.length
    const contributors: BiRiskHeatmapContributor[] = []
    for (const [projectId, count] of projectCounts) {
      const entry = entries.find((e) => e.projectId === projectId)
      contributors.push({
        id: String(projectId),
        label: entry?.projectName ?? `项目${projectId}`,
        kind: def.drilldownTargetKind,
        contributionWeight: count / total,
        rank: 0,
      })
    }

    return contributors.sort((a, b) => b.contributionWeight - a.contributionWeight)
  }

  private buildEvidenceRefs(
    def: BiRiskHeatmapMetricDefinition,
    redactionState: BiRiskHeatmapRedactionState,
  ): BiRiskHeatmapEvidenceRef[] {
    const refs: BiRiskHeatmapEvidenceRef[] = [
      {
        kind: def.sourceKind,
        label: def.label,
        targetKind: def.drilldownTargetKind,
        sourceKind: def.sourceKind,
      },
    ]
    return redactBiRiskHeatmapEvidence(refs, redactionState)
  }

  private buildDrilldownTargets(
    entries: RawRiskEntry[],
    def: BiRiskHeatmapMetricDefinition,
    redactionState: BiRiskHeatmapRedactionState,
  ): BiRiskHeatmapDrilldownTarget[] {
    if (redactionState !== 'none') return []

    const projectIds = [...new Set(entries.map((e) => e.projectId))]
    return projectIds.slice(0, 5).map((pid) => ({
      kind: def.drilldownTargetKind,
      targetId: pid,
      label: entries.find((e) => e.projectId === pid)?.projectName ?? `项目${pid}`,
      route: `/projects/${pid}/risks`,
      requiresPermission: def.requiredPermission,
    }))
  }

  // ── 排序 ──────────────────────────────────────────────────────────────────

  private sortCells(
    cells: BiRiskHeatmapCell[],
    sortKey: string,
    sortDir: string,
  ): BiRiskHeatmapCell[] {
    const sorted = [...cells]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'count':
          cmp = a.count - b.count
          break
        case 'delta':
          cmp = (a.delta ?? 0) - (b.delta ?? 0)
          break
        case 'rowDimension':
          cmp = a.rowLabel.localeCompare(b.rowLabel)
          break
        case 'columnDimension':
          cmp = a.columnLabel.localeCompare(b.columnLabel)
          break
        case 'score':
        default:
          cmp = a.score - b.score
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted
  }

  // ── 降级响应 ──────────────────────────────────────────────────────────────

  private buildUnavailableResponse(
    organizationId: number,
    query: BiRiskHeatmapQuery,
    _referenceDate: string,
    warnings: BiRiskHeatmapWarning[],
  ): BiRiskHeatmapResponse {
    const freshness: BiRiskHeatmapFreshness = {
      state: BI_RISK_HEATMAP_FRESHNESS_STATES.UNKNOWN,
      sourceCoverage: 0,
      freshnessHash: 'no-sources',
      sources: [],
    }
    const queryShape = buildBiRiskHeatmapQueryShape(query)
    const calculatedAt = new Date().toISOString()
    const meta: BiRiskHeatmapResponseMeta = {
      organizationId,
      calculatedAt,
      metricVersion: BI_RISK_HEATMAP_METRIC_VERSION,
      queryShape,
      freshness,
      page: 1,
      perPage: query.perPage ?? BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
      total: 0,
      totalPages: 0,
    }
    return { data: [], meta, warnings, queryShape, calculatedAt }
  }

  private buildRedactedResponse(
    organizationId: number,
    query: BiRiskHeatmapQuery,
    def: BiRiskHeatmapMetricDefinition,
    _referenceDate: string,
    _dimAccess: BiRiskHeatmapDimensionAccess,
  ): BiRiskHeatmapResponse {
    const warnings: BiRiskHeatmapWarning[] = [
      buildBiRiskHeatmapWarning(
        BI_RISK_HEATMAP_WARNING_CODES.DIMENSION_REDACTED,
        `当前角色无权限查看"${def.label}"热力图数据`,
        { metricKey: query.metricKey },
      ),
    ]
    return this.buildUnavailableResponse(organizationId, query, '', warnings)
  }

  /**
   * 健康诊断 summary（HealthDiagnosisSummary.overallLabel）→ 风险等级。
   * overallLabel 语义见 health_diagnosis/ruleset.ts 的 deriveOverallLabel：
   * healthy 最健康，critical 最差；健康诊断分数越低越危险。
   */
  private diagnosisSummaryToRiskLevel(summary: HealthDiagnosisSummary | null): string {
    switch (summary?.overallLabel) {
      case 'critical':
        return 'critical'
      case 'warning':
        return 'high'
      case 'attention':
        return 'medium'
      case 'healthy':
      default:
        return 'low'
    }
  }

  // ── 审计 ──────────────────────────────────────────────────────────────────

  private async writeAudit(
    organizationId: number,
    user: User,
    query: BiRiskHeatmapQuery,
    resultCount: number,
    freshnessHash: string,
  ): Promise<void> {
    await this.auditService.log({
      event: 'BI_RISK_HEATMAP_READ',
      userId: Number(user.id),
      organizationId,
      entityType: 'bi_risk_heatmap',
      severity: 'info',
      metadata: {
        metricKey: query.metricKey,
        window: query.window ?? BI_RISK_HEATMAP_DEFAULT_WINDOW,
        rowDimension: query.rowDimension,
        columnDimension: query.columnDimension,
        resultCount,
        freshnessHash,
      },
    })
  }
}

// ── 内部类型 ─────────────────────────────────────────────────────────────────

interface RawRiskEntry {
  projectId: number
  projectName: string
  category: string
  level: string
  status: string
  probability: number
  impact: number
  createdAt: string
  assigneeId: number
}
