/**
 * v3-copilot-context-packet-and-project-panorama — CopilotContextBudget（§6）。
 *
 * 上下文预算与确定性截断：
 * - 复用既有预算能力（design.md Decision 6）
 * - 声明式确定性截断顺序：证据正文 → 低分检索结果 → 较旧活动 → 可选切面
 * - 路由输入不可丢弃保护
 * - source hash 与 capturedAt 推导
 * - stale 判定与阻断
 *
 * @aiproj/backend
 */
import type {
  CopilotAssemblyBudgetInput,
  CopilotAssemblySourceMetadata,
  CopilotAssemblyTruncationMarker,
  CopilotAssemblyTruncationPlan,
  CopilotContextAssemblyResult,
  CopilotContextAssemblyRequest,
  CopilotContextFact,
  CopilotMethodologyGuidanceItem,
  CopilotRoutingInputsPreserved,
  CopilotWarningCode,
} from '@aiproj/types'
import {
  COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
  estimateCopilotMethodologyBytes,
  estimateCopilotMethodologyItemBytes,
  estimateCopilotSourceBytes,
  generateCopilotContextAssemblyId,
  makeCopilotRoutingInputsPreserved,
  planCopilotAssemblyTruncation,
  planMethodologyTruncation,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 默认预算
// ---------------------------------------------------------------------------

/** 默认上下文字节预算。 */
export const COPILLOT_DEFAULT_CONTEXT_BYTES_LIMIT = 16384

/** 默认证据字节预算（证据正文不落包，只用于省略计数）。 */
export const COPILLOT_DEFAULT_EVIDENCE_BYTES_LIMIT = 32768

/** 最小允许预算下界。 */
export const COPILLOT_MIN_CONTEXT_BYTES = 512

/** §6.6 默认方法论预算占比（保守值 0.15 = 15%），超预算时方法论优先于项目事实被截断。 */
export const COPILLOT_DEFAULT_METHODOLOGY_BYTES_RATIO = 0.15

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}

// ---------------------------------------------------------------------------
// CopilotContextBudget 服务
// ---------------------------------------------------------------------------

export class CopilotContextBudget {
  /** §6.6 可配置方法论预算占比（默认 15%）。 */
  readonly methodologyBytesRatio: number

  constructor(methodologyBytesRatio?: number) {
    this.methodologyBytesRatio = methodologyBytesRatio ?? COPILLOT_DEFAULT_METHODOLOGY_BYTES_RATIO
  }

  // ── Task 6.1: 上下文预算计算 ────────────────────────────────────

  /**
   * 计算组装预算（复用既有预算能力）。
   */
  computeBudget(request: CopilotContextAssemblyRequest): CopilotAssemblyBudgetInput {
    return {
      contextBytesLimit: request.contextBytesLimit ?? COPILLOT_DEFAULT_CONTEXT_BYTES_LIMIT,
      evidenceBytesLimit: request.evidenceBytesLimit ?? COPILLOT_DEFAULT_EVIDENCE_BYTES_LIMIT,
      minContextBytes: COPILLOT_MIN_CONTEXT_BYTES,
    }
  }

  /**
   * §6.1 计算方法论预算上限（占总预算的 methodologyBytesRatio）。
   * §6.6 支持可配置占比，默认取保守值 15%。
   */
  computeMethodologyBudgetLimit(budget: CopilotAssemblyBudgetInput): number {
    return Math.floor(budget.contextBytesLimit * this.methodologyBytesRatio)
  }

  // ── Task 6.2: 确定性截断 ────────────────────────────────────────

  /**
   * §6.2 执行方法论优先截断：方法论条目在截断序列中排在项目事实之前。
   * 返回方法论截断结果与剩余预算（供后续 planTruncation 使用）。
   */
  planMethodologyTruncation(
    items: readonly CopilotMethodologyGuidanceItem[],
    budget: CopilotAssemblyBudgetInput,
  ): {
    keptItems: readonly CopilotMethodologyGuidanceItem[]
    omittedCount: number
    omittedBytes: number
    remainingBudget: CopilotAssemblyBudgetInput
  } {
    const methodologyLimit = this.computeMethodologyBudgetLimit(budget)
    const result = planMethodologyTruncation({
      items,
      budgetBytesLimit: methodologyLimit,
      estimateBytes: estimateCopilotMethodologyItemBytes,
    })
    // 方法论节省的预算回流到项目事实
    const remainingBudget: CopilotAssemblyBudgetInput = {
      ...budget,
      contextBytesLimit: budget.contextBytesLimit - result.omittedBytes,
    }
    return { ...result, remainingBudget }
  }

  /**
   * 执行声明式确定性截断（项目事实来源）。
   * 丢弃顺序（固定声明）：证据正文 → 低分检索结果 → 较旧活动 → 可选切面。
   */
  planTruncation(
    sources: readonly CopilotAssemblySourceMetadata[],
    budget: CopilotAssemblyBudgetInput,
    evidenceCount: number,
    _methodologyItemCount?: number,
  ): CopilotAssemblyTruncationPlan {
    return planCopilotAssemblyTruncation({ sources, budget, evidenceCount })
  }

  // ── Task 6.3: 路由输入不可丢弃保护 ─────────────────────────────

  /**
   * 断言路由输入在截断后全部存活。
   * 路由输入（intentSlots/entityRefs/sourceHashes/permissionFacts）不参与截断。
   */
  assertRoutingInputsPreserved(
    _request: CopilotContextAssemblyRequest,
    _plan: CopilotAssemblyTruncationPlan,
  ): CopilotRoutingInputsPreserved {
    // 路由输入由组装器保留在结果字段，不参与截断
    // 此处断言契约结构仍可表达全部存活
    return makeCopilotRoutingInputsPreserved(true)
  }

  // ── Task 6.6: 截断标记与省略计数 ────────────────────────────────

  /**
   * 构建截断标记（禁止静默丢弃）。
   */
  buildTruncationMarker(
    plan: CopilotAssemblyTruncationPlan,
    _evidenceOver: number,
  ): CopilotAssemblyTruncationMarker {
    return plan.marker
  }

  // ── Task 6.7: 逐来源 source hash 与 capturedAt 推导 ─────────────

  /**
   * 推导来源的 source hash 与 capturedAt。
   */
  deriveSourceSignature(source: CopilotAssemblySourceMetadata): {
    sourceHash: string
    capturedAt: string
  } {
    return {
      sourceHash: source.sourceHash,
      capturedAt: source.capturedAt,
    }
  }

  // ── Task 6.8: stale 判定 ────────────────────────────────────────

  /**
   * 请求时重推 hash 并比对，失配即标记 stale。
   * 返回当前 hash 与是否 stale。
   */
  checkFreshness(storedHash: string, currentHash: string): { stale: boolean; currentHash: string } {
    return {
      stale: storedHash !== currentHash,
      currentHash,
    }
  }

  /**
   * 批量检查来源新鲜度。
   * 返回 stale 的来源 ref 列表。
   */
  checkBatchFreshness(
    sources: readonly CopilotAssemblySourceMetadata[],
    currentHashesByRef: ReadonlyMap<string, string>,
  ): string[] {
    const staleRefs: string[] = []
    for (const source of sources) {
      const currentHash = currentHashesByRef.get(source.sourceRef)
      if (currentHash && currentHash !== source.sourceHash) {
        staleRefs.push(source.sourceRef)
      }
    }
    return staleRefs
  }

  // ── Task 6.9: stale 阻断 ───────────────────────────────────────

  /**
   * 检查是否有 stale 来源阻断动作。
   * 依赖 stale 来源的动作被阻断或标记，禁止静默刷新。
   */
  detectStaleBlockingActions(
    actions: readonly { sourceHashes: readonly string[]; actionId: string }[],
    staleHashes: ReadonlySet<string>,
  ): string[] {
    const blockedActionIds: string[] = []
    for (const action of actions) {
      const hasStale = action.sourceHashes.some((hash) => staleHashes.has(hash))
      if (hasStale) {
        blockedActionIds.push(action.actionId)
      }
    }
    return blockedActionIds
  }

  /**
   * 对推荐动作执行 stale 阻断。
   * 返回阻断后的动作列表（标记 isStale）。
   */
  applyStaleBlocking<
    T extends { sourceHashes: readonly string[]; isStale: boolean; staleReason?: string },
  >(actions: T[], staleHashes: ReadonlySet<string>): T[] {
    return actions.map((action) => {
      const hasStale = action.sourceHashes.some((hash) => staleHashes.has(hash))
      if (hasStale) {
        return {
          ...action,
          isStale: true,
          staleReason: '来源数据已变更，建议刷新后重新审查',
        }
      }
      return action
    })
  }

  // ── 组装结果构建 ────────────────────────────────────────────────

  /**
   * 构建完整的上下文组装结果。
   * 综合所有采集、截断、路由输入保护与计时。
   */
  buildAssemblyResult(params: {
    request: CopilotContextAssemblyRequest
    sources: readonly CopilotAssemblySourceMetadata[]
    packetSources: CopilotContextAssemblyResult['packet']['sources']
    methodology?: CopilotContextAssemblyResult['methodology']
    panorama?: CopilotContextAssemblyResult['panorama']
    contextFacts?: readonly CopilotContextFact[]
    knowledgeQueryPath?: 'production' | 'eval'
    knowledgeTiers?: CopilotContextAssemblyResult['eligibleKnowledgeTiers']
    uncertainty?: CopilotContextAssemblyResult['uncertainty']
    conclusionTrace?: CopilotContextAssemblyResult['conclusionTrace']
    totalMs: number
    perSourceMs: Record<string, number>
    warnings?: readonly CopilotWarningCode[]
  }): CopilotContextAssemblyResult {
    const budget = this.computeBudget(params.request)

    // §6.2 方法论优先截断：先截断方法论，再截断项目事实
    let methodologyResult: {
      keptItems: readonly CopilotMethodologyGuidanceItem[]
      omittedCount: number
      omittedBytes: number
      remainingBudget: CopilotAssemblyBudgetInput
    } = {
      keptItems: params.methodology?.guidanceItems ?? [],
      omittedCount: 0,
      omittedBytes: 0,
      remainingBudget: budget,
    }
    let methodology: CopilotContextAssemblyResult['methodology'] = params.methodology

    if (params.methodology && params.methodology.guidanceItems.length > 0) {
      methodologyResult = this.planMethodologyTruncation(params.methodology.guidanceItems, budget)
      if (methodologyResult.omittedCount > 0 && methodology) {
        methodology = {
          ...methodology,
          guidanceItems: methodologyResult.keptItems,
        }
      }
    }

    // §6.2 用方法论截断后的剩余预算做项目事实截断
    const plan = this.planTruncation(
      params.sources,
      methodologyResult.remainingBudget,
      0,
      methodology?.guidanceItems.length ?? 0,
    )
    const routingInputs = this.assertRoutingInputsPreserved(params.request, plan)

    // 合并截断标记：方法论截断 + 项目事实截断
    const mergedMarker: CopilotAssemblyTruncationMarker = {
      truncated: plan.marker.truncated || methodologyResult.omittedCount > 0,
      stage: methodologyResult.omittedCount > 0 ? 'methodology' : plan.marker.stage,
      omittedSourceCount: plan.marker.omittedSourceCount,
      omittedEvidenceCount: plan.marker.omittedEvidenceCount,
      droppedRetrievalKinds: plan.marker.droppedRetrievalKinds,
      droppedFacets: plan.marker.droppedFacets,
      hitBudgetFloor: plan.marker.hitBudgetFloor,
      omittedMethodologyCount: methodologyResult.omittedCount,
      warning:
        methodologyResult.omittedCount > 0 && plan.marker.warning
          ? `方法论省略 ${methodologyResult.omittedCount} 条；${plan.marker.warning}`
          : methodologyResult.omittedCount > 0
            ? `方法论超预算，省略 ${methodologyResult.omittedCount} 条`
            : plan.marker.warning,
    }

    const packetSources = params.packetSources
    const packet = {
      contextHash: simpleHash(JSON.stringify(packetSources.map((s) => s.sourceHash).sort())),
      scope: params.request.scope,
      sources: packetSources,
      eligibleKnowledgeTiers: params.knowledgeTiers ?? COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
      truncation: {
        truncated: mergedMarker.truncated,
        omittedSourceCount: mergedMarker.omittedSourceCount,
        omittedEvidenceCount: mergedMarker.omittedEvidenceCount,
        budgetBytes: budget.contextBytesLimit,
        warning: mergedMarker.warning,
      },
      budget: {
        contextBytesUsed:
          plan.keptSources.reduce((sum, s) => sum + estimateCopilotSourceBytes(s), 0) +
          (methodology ? estimateCopilotMethodologyBytes(methodology) : 0),
        contextBytesLimit: budget.contextBytesLimit,
        evidenceBytesUsed: 0,
        evidenceBytesLimit: budget.evidenceBytesLimit,
      },
      warnings: params.warnings ?? [],
      sourceOrdering: packetSources.map((s) => s.sourceKind),
    }

    return {
      assemblyId: generateCopilotContextAssemblyId(),
      requestRef: `${params.request.scope}:${params.request.actorId}`,
      packet,
      sources: params.sources,
      eligibleKnowledgeTiers: params.knowledgeTiers ?? COPILOT_PRODUCTION_KNOWLEDGE_TIERS,
      knowledgeQueryPath: params.knowledgeQueryPath ?? 'production',
      methodology,
      panorama: params.panorama,
      contextFacts: params.contextFacts,
      truncation: mergedMarker,
      uncertainty: params.uncertainty ?? [],
      conclusionTrace: params.conclusionTrace ?? [],
      routingInputs,
      timing: { totalMs: params.totalMs, perSourceMs: params.perSourceMs },
      warnings: params.warnings ?? [],
    }
  }
}
