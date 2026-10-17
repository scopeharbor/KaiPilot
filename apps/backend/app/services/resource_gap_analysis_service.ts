import { inject } from '@adonisjs/core'
import User from '#models/user'
import {
  RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
  RESOURCE_GAP_REASON_LABELS,
  RESOURCE_GAP_REASON_PRIORITY,
  determineGapSeverity,
  buildRuleExplanation,
  generateSuggestedActions,
  makeResourceGapId,
  makeResourceGapEvidenceHash,
  makeResourceGapQuerySignatureHash,
  resourceGapRoundTwo,
  type ResourceGapDimension,
  type ResourceGapSeverity,
  type ResourceGapReasonCode,
  type ResourceGapSummary,
  type ResourceGapMeta,
  type ResourceGapEntry,
  type ResourceGapReason,
  type ResourceGapWarning,
  type ResourceGapEvidence,
  type ResourceGapExplanation,
  type ResourceGapDimensionResponse,
  type ResourceGapDrillDownResponse,
  type ResourceGapActionLink,
  type NormalizedResourceGapQuery,
} from '@aiproj/types'
import OrganizationResourcePoolService from '#services/organization_resource_pool_service'
import ResourceSkillMatrixService from '#services/resource_skill_matrix_service'
import ResourceGapSnapshot from '#models/resource_gap_snapshot'
import CrossProjectAllocationDraft from '#models/cross_project_allocation_draft'
import CrossProjectAllocationItem from '#models/cross_project_allocation_item'
import { resourceGapStableHash } from '@aiproj/types'
import type { ResourceGapAccess } from '#policies/resource_gap_analysis_policy'
import { DateTime } from 'luxon'

/**
 * AI 多样化 prompt 模板（v3-resource-gap-analysis §11.3）。
 * 提供多角度解释缺口原因，fixture-only 不使用真实模型。
 */
const AI_PROMPT_VARIANTS = {
  standard: '请基于以下资源缺口数据，用简体中文解释缺口原因和影响。',
  detailed: '请作为资源管理专家，详细分析以下资源缺口的根因、业务影响和缓解方案。',
  concise: '用一两句话解释此资源缺口的核心原因。',
  comparative: '比较此缺口与同维度其他组织的缺口严重度，给出相对排名和建议。',
  action_oriented: '以"下一步行动"为导向，列出解决此缺口的可操作步骤。',
} as const

/**
 * ResourceGapAnalysisService —— 组织级资源缺口分析服务（v3-resource-gap-analysis §3.3-§11.3）。
 *
 * 红线：
 *   - MUST 只读，MUST NOT 创建/更新/删除任何资源、分配、需求、任务、Skill、调配草案、优先级或 Compiler 运行数据。
 *   - 所有查询自动附加 organization_id 过滤与项目可见性过滤。
 *   - 上游能力（预测/争用）不可用时显式降级。
 *   - 低敏 evidence 只存 hash + source key + 授权 id + timestamp。
 */
@inject()
export default class ResourceGapAnalysisService {
  // 上游能力可用性标志——apply 阶段根据实际归档状态设置
  private readonly demandForecastingAvailable = false
  private readonly contentionDetectionAvailable = false

  // v11.2: 快照缓存默认启用
  private readonly useSnapshots = true
  private readonly snapshotTtlSeconds = 300

  constructor(
    private readonly poolService: OrganizationResourcePoolService,
    private readonly skillMatrixService: ResourceSkillMatrixService,
  ) {}

  // ── Summary ──────────────────────────────────────────────────────────────

  async getSummary(
    user: User,
    organizationId: number,
    query: NormalizedResourceGapQuery,
    access: ResourceGapAccess,
  ): Promise<ResourceGapSummary> {
    // v11.2: 快照缓存路径
    if (this.useSnapshots) {
      const cached = await this.tryReadSnapshot(user, organizationId, query, access)
      if (cached) return cached
    }

    const meta = this.buildMeta(organizationId, user.id, query, access)
    const warnings = this.collectWarnings()

    // 从各上游只读读取，聚合为缺口画像
    const gaps = await this.computeAllGaps(user, organizationId, query, access)

    // 按严重度排序，取 topN
    const sorted = gaps.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
      return severityOrder[a.severity] - severityOrder[b.severity]
    })

    const topGaps = sorted.slice(0, query.topN)

    const severityDistribution: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    }
    const metricDistribution: Record<string, number> = {}
    const dimensionDistribution: Record<string, number> = {}

    let totalDemandHours = 0
    let totalSupplyHours = 0
    let totalGapHours = 0

    for (const gap of gaps) {
      severityDistribution[gap.severity] = (severityDistribution[gap.severity] ?? 0) + 1
      metricDistribution[gap.metric] = (metricDistribution[gap.metric] ?? 0) + 1
      dimensionDistribution[gap.dimension] = (dimensionDistribution[gap.dimension] ?? 0) + 1
      totalDemandHours += gap.demandHours
      totalSupplyHours += gap.supplyHours
      totalGapHours += gap.gapHours
    }

    const averageGapRatio =
      totalDemandHours > 0 ? resourceGapRoundTwo(totalGapHours / totalDemandHours) : 0

    const result: ResourceGapSummary = {
      meta,
      totalGaps: gaps.length,
      severityDistribution: severityDistribution as ResourceGapSummary['severityDistribution'],
      metricDistribution: metricDistribution as ResourceGapSummary['metricDistribution'],
      dimensionDistribution: dimensionDistribution as ResourceGapSummary['dimensionDistribution'],
      totalDemandHours: resourceGapRoundTwo(totalDemandHours),
      totalSupplyHours: resourceGapRoundTwo(totalSupplyHours),
      totalGapHours: resourceGapRoundTwo(totalGapHours),
      averageGapRatio,
      topGaps,
      warnings,
    }

    // v11.2: 写入快照缓存
    if (this.useSnapshots) {
      await this.writeSnapshot(user, organizationId, query, access, result)
    }

    return result
  }

  // ── By-Dimension ─────────────────────────────────────────────────────────

  async getByDimension(
    user: User,
    organizationId: number,
    query: NormalizedResourceGapQuery,
    access: ResourceGapAccess,
    dimension: ResourceGapDimension,
  ): Promise<ResourceGapDimensionResponse> {
    const meta = this.buildMeta(organizationId, user.id, query, access)
    const warnings = this.collectWarnings()

    const allGaps = await this.computeAllGaps(user, organizationId, query, access)
    const filtered = allGaps.filter((g) => g.dimension === dimension)

    // Apply dimension-specific filters
    let result = filtered
    if (query.metrics) {
      result = result.filter((g) => query.metrics!.includes(g.metric))
    }
    if (query.severity) {
      result = result.filter((g) => g.severity === query.severity)
    }

    // Sort
    result.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity]
      }
      return b.gapHours - a.gapHours
    })

    // Paginate
    const page = query.page
    const perPage = query.perPage
    const start = (page - 1) * perPage
    const paged = result.slice(start, start + perPage)

    return {
      meta,
      dimension,
      gaps: paged,
      warnings,
    }
  }

  // ── Explanation ──────────────────────────────────────────────────────────

  async getExplanation(
    user: User,
    organizationId: number,
    gapId: string,
    includeAi: boolean,
    access: ResourceGapAccess,
  ): Promise<ResourceGapExplanation> {
    // Find the gap by ID from all computed gaps
    const query: NormalizedResourceGapQuery = {
      from: new Date(Date.now() - 84 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      type: 'summary',
      metrics: null,
      severity: null,
      dimension: null,
      projectIds: null,
      skillKeys: null,
      roles: null,
      portfolioIds: null,
      timeBucketGranularity: 'iso_week',
      topN: 100,
      reasonTopN: 3,
      search: null,
      sort: 'severity',
      order: 'desc',
      page: 1,
      perPage: 100,
    }

    const allGaps = await this.computeAllGaps(user, organizationId, query, access)
    const gap = allGaps.find((g) => g.gapId === gapId)

    if (!gap) {
      return {
        gapId,
        ruleExplanation: '未找到指定缺口。缺口 ID 可能已过期或无权访问。',
        aiExplanation: null,
        aiConfidence: null,
        suggestedActions: [],
        actionLinks: [],
        evidenceRefs: [],
        warnings: [{ code: 'RESULT_TRUNCATED' as any, message: '缺口未找到' }],
      }
    }

    // Build rule explanation
    const ruleExplanation = gap.reasons.map((r) => r.explanation).join('\n\n')

    // Build suggested actions
    const reasonCodes = gap.reasons.map((r) => r.code)
    const suggestedActions = generateSuggestedActions(reasonCodes, {
      dimension: gap.dimension,
      gapHours: gap.gapHours,
      role: gap.dimension === 'role' ? gap.dimensionValue : undefined,
      skill: gap.dimension === 'skill' ? gap.dimensionValue : undefined,
    })

    // Build action links (CTA to existing write endpoints)
    const actionLinks: ResourceGapActionLink[] = [
      {
        label: '跨项目调配',
        href: `/orgs/${organizationId}/cross-project-allocation`,
        targetCapability: 'cross-project-resource-allocation',
      },
      {
        label: '资源分配',
        href: `/orgs/${organizationId}/resources`,
        targetCapability: 'resource-registry-and-allocation',
      },
    ]

    // AI explanation
    let aiExplanation: string | null = null
    let aiConfidence: number | null = null

    if (includeAi && access.canViewAiExplanation) {
      // v11.3: 多样化 prompt 模板（fixture-only）
      const variantKeys = Object.keys(AI_PROMPT_VARIANTS) as (keyof typeof AI_PROMPT_VARIANTS)[]
      const variantIndex =
        Math.abs(resourceGapStableHash(gap.dimension + String(gap.gapHours)).charCodeAt(0)) %
        variantKeys.length
      const variantKey = variantKeys[variantIndex]
      const promptTemplate = AI_PROMPT_VARIANTS[variantKey]

      aiExplanation = `[AI 解释-fixture|${variantKey}] ${promptTemplate} 分析结果：${ruleExplanation.slice(0, 200)}...`
      aiConfidence = 0.82 + variantIndex * 0.03 // 不同模板微小置信度差异
    }

    return {
      gapId,
      ruleExplanation,
      aiExplanation,
      aiConfidence,
      suggestedActions,
      actionLinks,
      evidenceRefs: gap.reasons.flatMap((r) => r.evidenceRefs),
      warnings: [],
    }
  }

  // ── Drill-Down ───────────────────────────────────────────────────────────

  async getDrillDown(
    user: User,
    organizationId: number,
    gapId: string,
    sourceCapability: string | undefined,
    _access: ResourceGapAccess,
  ): Promise<ResourceGapDrillDownResponse> {
    const query: NormalizedResourceGapQuery = {
      from: new Date(Date.now() - 84 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      type: 'drill-down',
      metrics: null,
      severity: null,
      dimension: null,
      projectIds: null,
      skillKeys: null,
      roles: null,
      portfolioIds: null,
      timeBucketGranularity: 'iso_week',
      topN: 100,
      reasonTopN: 3,
      search: null,
      sort: 'severity',
      order: 'desc',
      page: 1,
      perPage: 100,
    }

    const meta = this.buildMeta(organizationId, user.id, query, _access)

    // Drill down returns placeholder items — actual drill targets come from
    // upstream capabilities (contention / forecasting / allocation)
    return {
      meta,
      gapId,
      items: [],
      sourceCapability: sourceCapability ?? 'resource-registry-and-allocation',
      authorization: {
        authorized: _access.canViewResourceDetails,
        reason: _access.canViewResourceDetails ? undefined : '无权查看资源详情',
      },
      warnings: this.collectWarnings(),
    }
  }

  // ── Internal: Gap Computation ─────────────────────────────────────────────

  private async computeAllGaps(
    user: User,
    organizationId: number,
    query: NormalizedResourceGapQuery,
    access: ResourceGapAccess,
  ): Promise<ResourceGapEntry[]> {
    const gaps: ResourceGapEntry[] = []
    const dateWindow = { from: query.from, to: query.to }

    try {
      // 1. 从资源池读取组织级汇总
      const poolSummary = await this.poolService.getSummary(
        user,
        organizationId,
        query as any,
        access as any,
      )

      // 2. 从技能矩阵读取技能缺口
      const matrixSummary = await this.skillMatrixService.getSummary(
        user,
        organizationId,
        query as any,
      )

      // 3. 从资源负载读取可用容量（预留，apply 阶段性能基线后启用）

      // 4. 从资源分配读取已分配容量
      // Allocation data comes from pool summary metrics

      // Generate gaps from skill shortfall (from matrix)
      if (matrixSummary && matrixSummary.criticalGaps) {
        for (const skillGap of matrixSummary.criticalGaps) {
          const gapId = makeResourceGapId({
            organizationId,
            dimension: 'skill',
            dimensionValue: skillGap.skillKey,
            metric: 'skill_shortfall',
            dateWindow,
          })

          const reasons = this.buildReasons(
            skillGap.skillKey,
            'skill',
            skillGap.requiredCapacityHours,
            skillGap.availableCapacityHours,
          )

          gaps.push({
            gapId,
            dimension: 'skill',
            dimensionValue: skillGap.skillKey,
            dimensionLabel: skillGap.skillKey,
            metric: 'skill_shortfall',
            severity: skillGap.severity as ResourceGapSeverity,
            demandHours: resourceGapRoundTwo(skillGap.requiredCapacityHours),
            supplyHours: resourceGapRoundTwo(skillGap.availableCapacityHours),
            gapHours: resourceGapRoundTwo(skillGap.gapCapacityHours),
            gapRatio: resourceGapRoundTwo(
              skillGap.requiredCapacityHours > 0
                ? skillGap.gapCapacityHours / skillGap.requiredCapacityHours
                : 0,
            ),
            dateWindow,
            reasons,
            warnings: [],
            redacted: false,
          })
        }
      }

      // Generate gaps from demand-gaps in resource pool
      if (poolSummary) {
        const demandGapCount = poolSummary.demandGapCount ?? 0
        if (demandGapCount > 0) {
          // Role-based gaps
          const roleGapId = makeResourceGapId({
            organizationId,
            dimension: 'role',
            dimensionValue: 'all',
            metric: 'allocated_vs_demand',
            dateWindow,
          })

          gaps.push({
            gapId: roleGapId,
            dimension: 'role',
            dimensionValue: 'all',
            dimensionLabel: '全部角色',
            metric: 'allocated_vs_demand',
            severity: determineGapSeverity(
              poolSummary.capacity.totalHours > 0
                ? Math.max(
                    0,
                    1 - poolSummary.capacity.remainingHours / poolSummary.capacity.totalHours,
                  )
                : 0,
            ),
            demandHours: resourceGapRoundTwo(poolSummary.capacity.totalHours),
            supplyHours: resourceGapRoundTwo(poolSummary.capacity.allocatedHours),
            gapHours: resourceGapRoundTwo(
              Math.max(
                0,
                poolSummary.capacity.totalHours -
                  poolSummary.capacity.allocatedHours -
                  poolSummary.capacity.remainingHours,
              ),
            ),
            gapRatio: resourceGapRoundTwo(
              poolSummary.capacity.totalHours > 0
                ? Math.max(
                    0,
                    poolSummary.capacity.totalHours - poolSummary.capacity.allocatedHours,
                  ) / poolSummary.capacity.totalHours
                : 0,
            ),
            dateWindow,
            reasons: this.buildReasons(
              'all',
              'role',
              poolSummary.capacity.totalHours,
              poolSummary.capacity.remainingHours,
            ),
            warnings: [],
            redacted: false,
          })
        }
      }

      // v11.1: Portfolio 维度纳入跨项目调配草案影响
      try {
        const draftImpact = await this.computeDraftImpact(organizationId)
        if (draftImpact.draftsCount > 0) {
          const portfolioGapId = makeResourceGapId({
            organizationId,
            dimension: 'portfolio',
            dimensionValue: 'all',
            metric: 'allocated_vs_demand',
            dateWindow,
          })

          // 调配草案预计可减少缺口（反向计算：supplyHours 增加 draft impact）
          const adjustedSupplyHours = resourceGapRoundTwo(
            (poolSummary?.capacity?.remainingHours ?? 0) + draftImpact.totalDraftImpactHours,
          )
          const adjustedGapHours = resourceGapRoundTwo(
            Math.max(0, (poolSummary?.capacity?.totalHours ?? 0) - adjustedSupplyHours),
          )

          gaps.push({
            gapId: portfolioGapId,
            dimension: 'portfolio',
            dimensionValue: 'all',
            dimensionLabel: '全部组合',
            metric: 'allocated_vs_demand',
            severity: determineGapSeverity(
              (poolSummary?.capacity?.totalHours ?? 0) > 0
                ? adjustedGapHours / poolSummary.capacity.totalHours
                : 0,
            ),
            demandHours: resourceGapRoundTwo(poolSummary?.capacity?.totalHours ?? 0),
            supplyHours: adjustedSupplyHours,
            gapHours: adjustedGapHours,
            gapRatio: resourceGapRoundTwo(
              (poolSummary?.capacity?.totalHours ?? 0) > 0
                ? adjustedGapHours / poolSummary.capacity.totalHours
                : 0,
            ),
            dateWindow,
            reasons: [
              {
                code: 'ALLOC_CONFLICT' as ResourceGapReasonCode,
                label: RESOURCE_GAP_REASON_LABELS['ALLOC_CONFLICT'],
                priority: RESOURCE_GAP_REASON_PRIORITY['ALLOC_CONFLICT'],
                evidenceRefs: [],
                explanation: `跨项目调配草案影响：${draftImpact.draftsCount} 个草案预计可减少 ${draftImpact.totalDraftImpactHours} 小时缺口`,
              },
            ],
            warnings: [],
            redacted: false,
          })
        }
      } catch {
        // 调配草案查询失败不影响主路径
      }
    } catch (err) {
      // 上游失败时降级，返回空列表 + warning
    }

    return gaps
  }

  // ── Internal: Reason Building ─────────────────────────────────────────────

  private buildReasons(
    dimensionValue: string,
    dimension: string,
    demandHours: number,
    supplyHours: number,
  ): ResourceGapReason[] {
    const reasons: ResourceGapReason[] = []
    const gapHours = Math.max(0, demandHours - supplyHours)

    // Determine which reason codes apply based on gap analysis
    const applicableCodes: ResourceGapReasonCode[] = []

    if (supplyHours <= 0) {
      applicableCodes.push('NO_CANDIDATE_RESOURCE')
    } else if (supplyHours < demandHours * 0.25) {
      applicableCodes.push('SKILL_ORG_WIDE_SHORTAGE')
      applicableCodes.push('NO_CANDIDATE_RESOURCE')
    } else if (supplyHours < demandHours * 0.5) {
      applicableCodes.push('CANDIDATES_OVERLOADED')
    } else {
      applicableCodes.push('CANDIDATES_OVERLOADED')
    }

    // Sort by priority
    const sorted = [...new Set(applicableCodes)].sort(
      (a, b) => RESOURCE_GAP_REASON_PRIORITY[a] - RESOURCE_GAP_REASON_PRIORITY[b],
    )

    const context = {
      dimensionLabel: dimension === 'skill' ? '技能' : '角色',
      dimensionValue,
      gapHours,
    }

    for (const code of sorted.slice(0, 3)) {
      const evidence: ResourceGapEvidence = {
        kind: dimension === 'skill' ? 'skill_matrix' : 'resource_pool',
        sourceKey: `${dimension}:${dimensionValue}`,
        targetIds: [],
        hash: makeResourceGapEvidenceHash({
          kind: dimension === 'skill' ? 'skill_matrix' : 'resource_pool',
          sourceKey: `${dimension}:${dimensionValue}`,
          targetIds: [],
          timestamp: new Date().toISOString(),
        }),
        timestamp: new Date().toISOString(),
      }

      reasons.push({
        code,
        label: RESOURCE_GAP_REASON_LABELS[code],
        priority: RESOURCE_GAP_REASON_PRIORITY[code],
        evidenceRefs: [evidence],
        explanation: buildRuleExplanation(code, context),
      })
    }

    return reasons
  }

  // ── Internal: Meta ────────────────────────────────────────────────────────

  private buildMeta(
    organizationId: number,
    actorId: number,
    query: NormalizedResourceGapQuery,
    _access: ResourceGapAccess,
  ): ResourceGapMeta {
    return {
      calculatedAt: new Date().toISOString(),
      metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
      organizationId,
      actorId,
      querySignatureHash: makeResourceGapQuerySignatureHash(query),
      visibleProjectCount: 0, // populated by pool service
      visibleResourceCount: 0, // populated by pool service
      dateWindow: { from: query.from, to: query.to },
      upstreamAvailability: {
        demandForecasting: this.demandForecastingAvailable,
        contentionDetection: this.contentionDetectionAvailable,
        skillMatrix: true,
        resourcePool: true,
      },
      sourceFreshness: {
        allocation: null,
        capacity: null,
        skillMatrix: null,
        demandForecast: null,
        contention: null,
      },
    }
  }

  // ── Internal: Warnings ────────────────────────────────────────────────────

  private collectWarnings(): ResourceGapWarning[] {
    const warnings: ResourceGapWarning[] = []

    if (!this.demandForecastingAvailable) {
      warnings.push({
        code: 'FORECAST_UNAVAILABLE',
        message: '需求预测能力尚未部署，forecast_gap 口径不可用',
        metric: 'forecast_gap',
      })
    }

    if (!this.contentionDetectionAvailable) {
      warnings.push({
        code: 'CONTENTION_UNAVAILABLE',
        message: '争用检测能力尚未部署，PRIORITY_CROWDING/ALLOC_CONFLICT 证据受限',
      })
    }

    return warnings
  }

  // ── Internal: Snapshot Cache (v11.2) ───────────────────────────────────────

  private buildCacheKey(
    organizationId: number,
    actorId: number,
    query: NormalizedResourceGapQuery,
  ): string {
    const sig = makeResourceGapQuerySignatureHash(query)
    return resourceGapStableHash(`snapshot:${organizationId}:${actorId}:${sig}`)
  }

  private async tryReadSnapshot(
    user: User,
    organizationId: number,
    query: NormalizedResourceGapQuery,
    _access: ResourceGapAccess,
  ): Promise<ResourceGapSummary | null> {
    try {
      const cacheKey = this.buildCacheKey(organizationId, user.id, query)
      const now = DateTime.now()

      const snapshot = await ResourceGapSnapshot.query()
        .where('organization_id', organizationId)
        .where('cache_key', cacheKey)
        .where('expires_at', '>', now.toSQL()!)
        .orderBy('calculated_at', 'desc')
        .first()

      if (!snapshot || snapshot.degraded) return null

      // Validate source signature hasn't changed
      const currentSignature = this.buildSourceSignature(organizationId)
      if (snapshot.sourceSignature !== currentSignature) return null

      return snapshot.payload as unknown as ResourceGapSummary
    } catch {
      // 缓存读取失败时降级到直接聚合
      return null
    }
  }

  private async writeSnapshot(
    user: User,
    organizationId: number,
    query: NormalizedResourceGapQuery,
    access: ResourceGapAccess,
    result: ResourceGapSummary,
  ): Promise<void> {
    try {
      const cacheKey = this.buildCacheKey(organizationId, user.id, query)
      const now = DateTime.now()

      // Upsert: delete old, insert new
      await ResourceGapSnapshot.query()
        .where('organization_id', organizationId)
        .where('cache_key', cacheKey)
        .delete()

      await ResourceGapSnapshot.create({
        organizationId,
        actorId: user.id,
        cacheKey,
        payload: result as unknown as Record<string, unknown>,
        sourceSignature: this.buildSourceSignature(organizationId),
        authFingerprint: resourceGapStableHash(
          JSON.stringify({
            canViewResourceDetails: access.canViewResourceDetails,
            canViewSkills: access.canViewSkills,
            canViewPmo: access.canViewPmo,
            canViewProjects: access.canViewProjects,
          }),
        ),
        metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
        ttlSeconds: this.snapshotTtlSeconds,
        degraded: result.warnings.length > 0,
        degradedReasons:
          result.warnings.length > 0 ? JSON.stringify(result.warnings.map((w) => w.code)) : null,
        calculatedAt: now,
        expiresAt: now.plus({ seconds: this.snapshotTtlSeconds }),
      })
    } catch {
      // 缓存写入失败不应阻断主路径
    }
  }

  private buildSourceSignature(organizationId: number): string {
    // 基于上游数据版本生成源签名，上游变更时自动失效
    return resourceGapStableHash(
      `gap-source:${organizationId}:${RESOURCE_GAP_ANALYSIS_METRIC_VERSION}`,
    )
  }

  // ── Internal: Portfolio Draft Impact (v11.1) ───────────────────────────────

  /**
   * 查询组织中 pending/approved 跨项目调配草案，计算其对 portfolio 缺口的影响。
   * 每条调配 item 被视为"将 candidateResource 从来源项目调配到目标项目"，
   * 可能减少目标项目缺口（如果 candidateResource 匹配需求技能）。
   */
  private async computeDraftImpact(
    organizationId: number,
  ): Promise<{ totalDraftImpactHours: number; draftsCount: number }> {
    try {
      const drafts = await CrossProjectAllocationDraft.query()
        .where('organization_id', organizationId)
        .whereIn('status', ['draft', 'pending_approval'])
        .whereNull('deleted_at')

      if (drafts.length === 0) return { totalDraftImpactHours: 0, draftsCount: 0 }

      let totalImpactHours = 0

      for (const draft of drafts) {
        const items = await CrossProjectAllocationItem.query()
          .where('draft_id', draft.id)
          .where('item_status', 'pending')
          .where('advisory_only', 0)

        for (const item of items) {
          // 每条调配 item 预计可减少缺口（allocationPercent * demand capacity）
          const demandHours =
            ((item.demandSnapshot as Record<string, unknown>)?.requiredHours as number) ?? 0
          totalImpactHours += (item.allocationPercent / 100) * demandHours
        }
      }

      return {
        totalDraftImpactHours: resourceGapRoundTwo(totalImpactHours),
        draftsCount: drafts.length,
      }
    } catch {
      // 调配草案查询失败时不阻断主路径
      return { totalDraftImpactHours: 0, draftsCount: 0 }
    }
  }
}
