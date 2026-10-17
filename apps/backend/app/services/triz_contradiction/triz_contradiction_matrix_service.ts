// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Service
// v3-triz-contradiction-matrix-ui / design D2
//
// 只读矩阵 view model：聚合已授权矛盾快照、参数/原理目录、rationale target 和 Workbench source refs。
// 矩阵自身不调用 refresh/confirm/dismiss/explain/Compiler rerun/AIGateway/Draft Layer 创建。
// 只读、零副作用。

import ProjectContradiction from '#models/project_contradiction'
import { inject } from '@adonisjs/core'
import type {
  TrizContradictionMatrix,
  MatrixCell,
  MatrixPhysicalTension,
  MatrixSourceRef,
  MatrixCatalogMetadata,
  MatrixParameterAxis,
  MatrixFilters,
  ContradictionAiExplanation,
} from '@aiproj/types'
import {
  PROJECT_PARAMETERS,
  PROJECT_PARAMETER_KEYS,
  INVENTIVE_PRINCIPLES,
  CONTRADICTION_RULESET_VERSION,
  type ProjectParameterKey,
  type ContradictionSeverity,
  type InventivePrincipleId,
} from '@aiproj/types'
import {
  computeMatrixCellKey,
  computeTensionKey,
  aggregateWarnings,
  isCellFullyStale,
  resolveCellState,
  computeAggregateSeverity,
  resolveAvailableActions,
  sortMatrixSourceRefs,
  compareParameterKeys,
} from '@aiproj/types'

interface MatrixServiceScope {
  organizationId: number
  projectId: number
  hasViewPermission: boolean
  canAccessWorkbench: boolean
  canAccessRationale: boolean
}

interface MatrixServiceInput {
  scope: MatrixServiceScope
  filters: MatrixFilters
}

interface ContradictionWithPayload {
  id: number
  type: string
  status: string
  severity: string
  improvingParameterKey: string | null
  worseningParameterKey: string | null
  parameterKey: string | null
  requirementA: string | null
  requirementB: string | null
  confidence: number
  suggestedPrinciples: Array<{ principleId: string }> | null
  stale: boolean
  inputSignature: string
  outputHash: string | null
  hasAiExplanation: boolean
  isAiExplanationFallback: boolean
  warningCodes: string[] | null
  key: string | null
  title: string
}

const CATALOG_VERSION = PROJECT_PARAMETER_KEYS.join(',') + '-' + INVENTIVE_PRINCIPLES.length

/**
 * 从 AI 解释派生矩阵 cell 的低敏 warning code。
 *
 * ContradictionAiExplanation 契约本身不存 warningCodes，
 * 可用信号只有「是否降级 / 是否过反幻觉 / 是否需人工确认」三项，这里显式映射。
 */
function deriveAiExplanationWarningCodes(explanation: ContradictionAiExplanation | null): string[] {
  if (!explanation) return []
  const codes: string[] = []
  if (explanation.isFallback) codes.push('AI_EXPLANATION_FALLBACK')
  if (!explanation.hallucinationChecked) codes.push('AI_HALLUCINATION_UNVERIFIED')
  if (explanation.needsConfirmation) codes.push('AI_NEEDS_CONFIRMATION')
  return codes
}

/**
 * 矛盾矩阵只读 Service（v3-triz-contradiction-matrix-ui D2）。
 *
 * 职责：
 * - 从已授权的矛盾快照组装技术矛盾矩阵单元和物理矛盾列表。
 * - 聚合参数目录和发明原理目录。
 * - 权限脱敏：缺权限时不泄露矛盾数量/参数名/hashes。
 * - 不写任何数据库表、不调用 AIGateway、不创建 Draft Layer。
 */
@inject()
export default class TrizContradictionMatrixService {
  // ──────── 主入口：构建完整矩阵 DTO ────────

  async buildMatrix(input: MatrixServiceInput): Promise<TrizContradictionMatrix> {
    const { scope, filters } = input

    if (!scope.hasViewPermission) {
      return this.emptyMatrix(scope.organizationId, scope.projectId, scope, filters)
    }

    // 1. 收集所有已授权矛盾（已确认或 draft 状态）
    const contradictions = await this.collectAuthorizedContradictions(
      scope.organizationId,
      scope.projectId,
      filters,
    )

    // 2. 检查 Workbench source 可用性
    const workbenchRefs = scope.canAccessWorkbench
      ? await this.collectWorkbenchSourceRefs(scope.organizationId, scope.projectId)
      : []

    // 3. 构建参数轴
    const catalog = this.buildCatalog()

    // 4. 构建技术矛盾矩阵单元
    const cells = this.buildCells(contradictions, catalog, scope, workbenchRefs)

    // 5. 构建物理矛盾列表
    const physicalTensions = this.buildPhysicalTensions(contradictions, scope, workbenchRefs)

    // 6. 聚合 warning summary
    const allRefs: MatrixSourceRef[] = [
      ...cells.flatMap((c) => c.sourceRefs),
      ...physicalTensions.flatMap((t) => t.sourceRefs),
    ]
    const warningSummary = aggregateWarnings(allRefs)

    return {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      scope: {
        hasViewPermission: scope.hasViewPermission,
        canAccessWorkbench: scope.canAccessWorkbench,
        canAccessRationale: scope.canAccessRationale,
      },
      catalog,
      cells,
      physicalTensions,
      warningSummary,
      filters,
      calculatedAt: new Date().toISOString(),
      zeroModelCost: true,
    }
  }

  // ──────── 内部：收集矛盾 ────────

  private async collectAuthorizedContradictions(
    organizationId: number,
    projectId: number,
    filters: MatrixFilters,
  ): Promise<ContradictionWithPayload[]> {
    const query = ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['draft', 'confirmed'])

    // 按 contradiction type 过滤
    if (filters.contradictionType && filters.contradictionType !== 'all') {
      query.where('type', filters.contradictionType)
    }

    // 按 status 过滤
    if (filters.status && filters.status !== 'all') {
      query.where('status', filters.status)
    }

    const rows = await query.orderBy('created_at', 'desc')

    let results = rows.map((r) => this.rowToContradiction(r))

    // 按 severity 过滤（后过滤，因为 severity 字段在 Lucid 可直接 where）
    if (filters.severity && filters.severity !== 'all') {
      results = results.filter((c) => c.severity === filters.severity)
    }

    // 按 stale 过滤
    if (filters.stale === 'stale_only') {
      results = results.filter((c) => c.stale)
    } else if (filters.stale === 'fresh_only') {
      results = results.filter((c) => !c.stale)
    }

    return results
  }

  private rowToContradiction(r: ProjectContradiction): ContradictionWithPayload {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      severity: r.severity,
      improvingParameterKey: r.improvingParameterKey,
      worseningParameterKey: r.worseningParameterKey,
      parameterKey: r.parameterKey,
      requirementA: r.requirementA,
      requirementB: r.requirementB,
      confidence: r.confidence,
      suggestedPrinciples: r.suggestedPrinciples,
      stale: r.stale,
      inputSignature: r.inputSignature,
      outputHash: r.outputHash,
      hasAiExplanation: r.aiExplanation !== null,
      isAiExplanationFallback: r.aiExplanation?.isFallback ?? false,
      warningCodes: deriveAiExplanationWarningCodes(r.aiExplanation),
      key: r.key,
      title: r.title,
    }
  }

  // ──────── 内部：Workbench source refs ────────

  private async collectWorkbenchSourceRefs(
    organizationId: number,
    projectId: number,
  ): Promise<MatrixSourceRef[]> {
    try {
      const { default: TrizInnovationScheme } = await import('#models/triz_innovation_scheme')
      const rows = await TrizInnovationScheme.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('status', 'open')
        .orderBy('created_at', 'desc')
        .limit(50)

      return rows
        .filter((r) => r.schemeHash)
        .map((r): MatrixSourceRef => ({
          sourceType: 'workbench',
          ref: r.schemeId,
          hash: r.schemeHash,
          title: r.name,
          severity: null,
          stale: false,
          isAiGenerated: false,
          isFallback: false,
          warningCodes: [],
        }))
    } catch {
      return []
    }
  }

  // ──────── 内部：构建目录 ────────

  private buildCatalog(): MatrixCatalogMetadata {
    const improving: MatrixParameterAxis[] = PROJECT_PARAMETERS.map((p) => ({
      parameterKey: p.key,
      name: p.name,
      direction: 'improving' as const,
      visibleSourceCount: 0, // 先填 0，后面 buildCells 会填充
      hasHiddenSources: false,
    }))

    const worsening: MatrixParameterAxis[] = PROJECT_PARAMETERS.map((p) => ({
      parameterKey: p.key,
      name: p.name,
      direction: 'worsening' as const,
      visibleSourceCount: 0,
      hasHiddenSources: false,
    }))

    return {
      version: CATALOG_VERSION,
      parameters: [...improving, ...worsening],
      principleIds: INVENTIVE_PRINCIPLES.map((p) => p.principleId),
      rulesetVersion: CONTRADICTION_RULESET_VERSION,
    }
  }

  // ──────── 内部：构建技术矛盾矩阵单元 ────────

  private buildCells(
    contradictions: ContradictionWithPayload[],
    _catalog: MatrixCatalogMetadata,
    scope: MatrixServiceScope,
    _workbenchRefs: MatrixSourceRef[],
  ): MatrixCell[] {
    const techContradictions = contradictions.filter((c) => c.type === 'technical')

    // 按 improvingParameterKey 分组
    const byImproving = new Map<ProjectParameterKey, ContradictionWithPayload[]>()
    for (const c of techContradictions) {
      if (!c.improvingParameterKey || !c.worseningParameterKey) continue
      const key = c.improvingParameterKey as ProjectParameterKey
      if (!byImproving.has(key)) byImproving.set(key, [])
      byImproving.get(key)!.push(c)
    }

    const cells: MatrixCell[] = []

    // 遍历所有 improving × worsening 参数对
    for (const impKey of PROJECT_PARAMETER_KEYS) {
      for (const worsKey of PROJECT_PARAMETER_KEYS) {
        if (impKey === worsKey) continue // 对角线跳过（技术矛盾要求不同参数）

        const cellContradictions = (byImproving.get(impKey) ?? []).filter(
          (c) => c.worseningParameterKey === worsKey,
        )

        const sourceRefs: MatrixSourceRef[] = cellContradictions.map((c) => ({
          sourceType: 'contradiction' as const,
          ref: c.key ?? `contrad-${c.id}`,
          hash: c.outputHash,
          title: c.title ?? `矛盾 #${c.id}`,
          severity: c.severity as ContradictionSeverity,
          stale: c.stale,
          isAiGenerated: c.hasAiExplanation,
          isFallback: c.isAiExplanationFallback,
          warningCodes: c.warningCodes ?? [],
        }))

        const isStale = isCellFullyStale(sourceRefs)
        const hasHiddenSources = false // 无权限用户已在 collectAuthorizedContradictions 过滤
        const state = resolveCellState({
          visibleSourceCount: sourceRefs.length,
          hasHiddenSources,
          isStale,
          isUnavailable: false,
        })

        const severity = computeAggregateSeverity(sourceRefs)
        const warningSummary = aggregateWarnings(sourceRefs)

        const candidatePrincipleIds = this.aggregatePrincipleIds(cellContradictions)

        const availableActions = resolveAvailableActions({
          state,
          canAccessWorkbench: scope.canAccessWorkbench,
          canAccessRationale: scope.canAccessRationale,
          hasSourceRefs: sourceRefs.length > 0,
        })

        // 置信度范围
        const confidences = cellContradictions
          .map((c) => c.confidence)
          .filter((v): v is number => v !== null && v !== undefined)
        const confidenceRange =
          confidences.length > 0
            ? { min: Math.min(...confidences), max: Math.max(...confidences) }
            : null

        cells.push({
          cellKey: computeMatrixCellKey({
            improvingParameterKey: impKey,
            worseningParameterKey: worsKey,
            catalogVersion: CATALOG_VERSION,
          }),
          improvingParameterKey: impKey,
          worseningParameterKey: worsKey,
          state,
          sourceRefs: sortMatrixSourceRefs(sourceRefs),
          totalVisibleSources: sourceRefs.length,
          hasHiddenSources,
          candidatePrincipleIds,
          severity,
          confidenceRange,
          warningSummary,
          isStale,
          availableActions,
        })
      }
    }

    // 排序：按 improving 参数序 → worsening 参数序
    cells.sort((a, b) => {
      const ia = compareParameterKeys(a.improvingParameterKey, b.improvingParameterKey)
      if (ia !== 0) return ia
      return compareParameterKeys(a.worseningParameterKey, b.worseningParameterKey)
    })

    return cells
  }

  // ──────── 内部：构建物理矛盾列表 ────────

  private buildPhysicalTensions(
    contradictions: ContradictionWithPayload[],
    scope: MatrixServiceScope,
    _workbenchRefs: MatrixSourceRef[],
  ): MatrixPhysicalTension[] {
    const physicalContradictions = contradictions.filter((c) => c.type === 'physical')

    // 按 parameterKey 分组
    const byParam = new Map<ProjectParameterKey, ContradictionWithPayload[]>()
    for (const c of physicalContradictions) {
      if (!c.parameterKey) continue
      const key = c.parameterKey as ProjectParameterKey
      if (!byParam.has(key)) byParam.set(key, [])
      byParam.get(key)!.push(c)
    }

    const tensions: MatrixPhysicalTension[] = []

    for (const [paramKey, pContradictions] of byParam) {
      const sourceRefs: MatrixSourceRef[] = pContradictions.map((c) => ({
        sourceType: 'contradiction' as const,
        ref: c.key ?? `contrad-${c.id}`,
        hash: c.outputHash,
        title: c.title ?? `物理矛盾 #${c.id}`,
        severity: c.severity as ContradictionSeverity,
        stale: c.stale,
        isAiGenerated: c.hasAiExplanation,
        isFallback: c.isAiExplanationFallback,
        warningCodes: c.warningCodes ?? [],
      }))

      const isStale = isCellFullyStale(sourceRefs)
      const state = resolveCellState({
        visibleSourceCount: sourceRefs.length,
        hasHiddenSources: false,
        isStale,
        isUnavailable: false,
      })

      const severity = computeAggregateSeverity(sourceRefs)
      const warningSummary = aggregateWarnings(sourceRefs)
      const candidatePrincipleIds = this.aggregatePrincipleIds(pContradictions)

      const confidences = pContradictions
        .map((c) => c.confidence)
        .filter((v): v is number => v !== null && v !== undefined)
      const confidence =
        confidences.length > 0
          ? confidences.reduce((sum, v) => sum + v, 0) / confidences.length
          : null

      const availableActions = resolveAvailableActions({
        state,
        canAccessWorkbench: scope.canAccessWorkbench,
        canAccessRationale: scope.canAccessRationale,
        hasSourceRefs: sourceRefs.length > 0,
      })

      tensions.push({
        tensionKey: computeTensionKey({
          parameterKey: paramKey,
          catalogVersion: CATALOG_VERSION,
        }),
        parameterKey: paramKey,
        opposingRequirements: pContradictions.find((c) => c.requirementA || c.requirementB)
          ? `${pContradictions.find((c) => c.requirementA)?.requirementA ?? ''} vs ${pContradictions.find((c) => c.requirementB)?.requirementB ?? ''}`
          : '物理矛盾：参数对立要求',
        state,
        sourceRefs: sortMatrixSourceRefs(sourceRefs),
        candidatePrincipleIds,
        severity,
        confidence,
        warningSummary,
        isStale,
        availableActions,
      })
    }

    // 稳定排序：按参数 key 序
    tensions.sort((a, b) => compareParameterKeys(a.parameterKey, b.parameterKey))

    return tensions
  }

  // ──────── 内部：聚合原理 ID ────────

  private aggregatePrincipleIds(
    contradictions: ContradictionWithPayload[],
  ): InventivePrincipleId[] {
    const ids = new Set<InventivePrincipleId>()
    for (const c of contradictions) {
      if (!c.suggestedPrinciples) continue
      for (const sp of c.suggestedPrinciples) {
        ids.add(sp.principleId as InventivePrincipleId)
      }
    }
    return Array.from(ids).sort()
  }

  // ──────── 空矩阵（无权限或无数据） ────────

  private emptyMatrix(
    organizationId: number,
    projectId: number,
    scope: MatrixServiceScope,
    filters: MatrixFilters,
  ): TrizContradictionMatrix {
    return {
      organizationId,
      projectId,
      scope: {
        hasViewPermission: scope.hasViewPermission,
        canAccessWorkbench: scope.canAccessWorkbench,
        canAccessRationale: scope.canAccessRationale,
      },
      catalog: this.buildCatalog(),
      cells: [],
      physicalTensions: [],
      warningSummary: { total: 0, blocking: 0, warning: 0, info: 0, codes: [] },
      filters,
      calculatedAt: new Date().toISOString(),
      zeroModelCost: true,
    }
  }
}
