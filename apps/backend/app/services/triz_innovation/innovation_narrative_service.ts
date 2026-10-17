/**
 * v3-triz-innovation-workbench —— 可选 AI 方案说明服务（§5.1-5.6）。
 *
 * 默认 fake/fallback，不触真实模型：确定性评分与对比在任何失败路径下都保留。
 * - 5.1 紧凑 Context Packet：仅 scheme/option refs、source hashes、warning codes、score 摘要、低敏文本。
 * - 5.2 经 Budget Guard + AIGateway；默认 fake/fallback；失败保留确定性对比。
 * - 5.3 反幻觉：引用的 optionId/principleId/参数必须可追溯；否则降级。
 * - 5.4 记录 provider/model/token/cost/latency/finishReason/errorCategory/context ref/output ref，禁止存正文。
 * - 5.6 真实模型 smoke 钩子由 TRIZ_INNOVATION_REAL_MODEL 显式开启，默认跳过。
 */
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'
import { createHash } from 'node:crypto'
import type {
  InnovationNarrativeCost,
  InnovationScheme,
  InnovationSchemeComparison,
  InnovationSchemeNarrative,
  InventivePrincipleId,
  ProjectParameterKey,
} from '@aiproj/types'

const FAKE_PROVIDER = 'fake'
const FAKE_MODEL = 'triz-innovation-fixture'

/** 真实模型 smoke 钩子由环境变量显式开启（默认关闭，CI/测试用 fake）。 */
function realModelEnabled(): boolean {
  return process.env.TRIZ_INNOVATION_REAL_MODEL === 'true'
}

/** Budget Guard 测试 seam：显式置为 block 时模拟预算阻断（默认放行）。 */
function budgetBlocked(): boolean {
  return process.env.TRIZ_INNOVATION_BUDGET_BLOCK === 'true'
}

/** 编造数值化影响检测（公开，便于测试与前端复用）。 */
export function containsFabricatedNumericImpact(text: string): boolean {
  return /(?:缩短|延长|增加|减少|降低|提升)[^。；\n]{0,8}[\d.]+\s*(%|天|人天|周|个)/.test(text)
}

export interface GenerateNarrativeParams {
  organizationId: number
  projectId: number
  userId: number
  scheme: InnovationScheme
  comparison: InnovationSchemeComparison
  requestId?: string | null
}

/** 紧凑 Context Packet（低敏，仅 refs/hashes/codes/summary）。 */
export interface InnovationContextPacket {
  contextPacketRef: string
  schemeId: string
  optionIds: string[]
  principleIds: InventivePrincipleId[]
  sourceHashes: {
    contradictionSignatures: string[]
    analysisContentHashes: string[]
    schemeHash: string
  }
  warningCodes: string[]
  scoreSummaries: Array<{ optionId: string; total: number }>
  /** 低敏文本片段（无完整证据/无敏感正文） */
  lowSensitivityFacts: string[]
}

@inject()
export default class InnovationNarrativeService {
  constructor(private audit: AuditService) {}

  /**
   * 生成方案 AI 说明（§5.2）。
   * 默认 fake；任何失败/降级路径都保留传入的确定性 comparison（调用方负责）。
   */
  async generateNarrative(params: GenerateNarrativeParams): Promise<InnovationSchemeNarrative> {
    const { scheme, comparison } = params
    const startedAt = Date.now()

    // 5.1 构建紧凑 Context Packet
    const contextPacket = this.buildContextPacket(scheme, comparison)

    // 5.2 Budget Guard seam（默认放行；真实环境在此查询预算并可能阻断）
    const budget = this.checkBudget(contextPacket)
    if (!budget.allowed) {
      const narrative = this.fallback(scheme, '预算阻断 — AI 说明已跳过，请以确定性对比为准')
      const cost = this.buildCost(startedAt, narrative, {
        finishReason: 'budget_blocked',
        errorCategory: 'budget',
        budgetDecisionRef: budget.decisionRef,
        contextPacketRef: contextPacket.contextPacketRef,
      })
      const result: InnovationSchemeNarrative = { ...narrative, cost }
      await this.recordAudit(params, result, 'fallback')
      return result
    }

    // 5.6 真实模型 smoke 钩子（默认 fake）
    if (!realModelEnabled()) {
      const fixture = this.buildFixtureNarrative(scheme, comparison)
      const validated = this.validateTraceability(scheme, fixture)
      const finishReason = validated.isFallback ? 'fallback' : 'completed'
      const errorCategory = validated.degradedReason ? 'hallucination_guard' : null
      const cost = this.buildCost(startedAt, validated, {
        finishReason,
        errorCategory,
        contextPacketRef: contextPacket.contextPacketRef,
      })
      const result: InnovationSchemeNarrative = { ...validated, cost }
      await this.recordAudit(params, result, validated.isFallback ? 'fallback' : 'generated')
      return result
    }

    // 真实模型路径（仅显式开启时）：此处留 AIGateway 调用 seam。
    // 当前实现：调用失败 → 降级 fallback（保留确定性对比由调用方保证）。
    try {
      const real = await this.callRealGateway(scheme, comparison, contextPacket)
      const validated = this.validateTraceability(scheme, real)
      const finishReason = validated.isFallback ? 'fallback' : 'completed'
      const errorCategory = validated.degradedReason ? 'hallucination_guard' : null
      const cost = this.buildCost(startedAt, validated, {
        finishReason,
        errorCategory,
        contextPacketRef: contextPacket.contextPacketRef,
        promptTokens: real.cost?.promptTokens ?? null,
        completionTokens: real.cost?.completionTokens ?? null,
      })
      const result: InnovationSchemeNarrative = { ...validated, cost }
      await this.recordAudit(params, result, validated.isFallback ? 'fallback' : 'generated')
      return result
    } catch {
      const narrative = this.fallback(scheme, '模型调用失败 — 已降级为规则摘要')
      const cost = this.buildCost(startedAt, narrative, {
        finishReason: 'model_failure',
        errorCategory: 'model',
        contextPacketRef: contextPacket.contextPacketRef,
      })
      const result: InnovationSchemeNarrative = { ...narrative, cost }
      await this.recordAudit(params, result, 'fallback')
      return result
    }
  }

  // ──────── Context Packet（§5.1）────────

  buildContextPacket(
    scheme: InnovationScheme,
    comparison: InnovationSchemeComparison,
  ): InnovationContextPacket {
    const optionIds = scheme.options.map((o) => o.optionId)
    const principleIds = Array.from(
      new Set(scheme.options.flatMap((o) => o.principleIds)),
    ) as InventivePrincipleId[]
    const contradictionSignatures = Array.from(
      new Set(scheme.options.flatMap((o) => o.hashes.contradictionSignatures)),
    )
    const analysisContentHashes = Array.from(
      new Set(scheme.options.flatMap((o) => o.hashes.analysisContentHashes)),
    )
    const warningCodes = Array.from(new Set(comparison.warnings.map((w) => w.code)))
    const scoreSummaries = comparison.cells.map((c) => ({
      optionId: c.optionId,
      total: c.score.total,
    }))
    const lowSensitivityFacts = [
      `方案「${scheme.name}」含 ${scheme.options.length} 个候选路径`,
      `最高得分 ${Math.max(0, ...scoreSummaries.map((s) => s.total))}`,
      `warning 数量 ${comparison.warnings.length}`,
    ]
    const contextPacketRef = this.ref(`ctx:${scheme.schemeId}:${scheme.schemeHash}`)
    return {
      contextPacketRef,
      schemeId: scheme.schemeId,
      optionIds,
      principleIds,
      sourceHashes: {
        contradictionSignatures,
        analysisContentHashes,
        schemeHash: scheme.schemeHash,
      },
      warningCodes,
      scoreSummaries,
      lowSensitivityFacts,
    }
  }

  // ──────── Budget Guard seam ────────

  /**
   * Budget Guard seam（§5.2）。
   * 默认放行（fake 模式零成本）；真实环境在此查询预算守卫并返回 decisionRef。
   */
  private checkBudget(packet: InnovationContextPacket): {
    allowed: boolean
    decisionRef: string
  } {
    if (budgetBlocked()) {
      return { allowed: false, decisionRef: `budget-block-${packet.contextPacketRef}` }
    }
    return { allowed: true, decisionRef: `budget-allow-${packet.contextPacketRef}` }
  }

  // ──────── Fake / 真实 ────────

  /** 确定性 fixture 说明：仅复述结构化事实，advisory。 */
  private buildFixtureNarrative(
    scheme: InnovationScheme,
    comparison: InnovationSchemeComparison,
  ): InnovationSchemeNarrative {
    const top = comparison.cells[0]
    const optionPhrases = comparison.cells
      .map((c) => `${c.optionId}（得分 ${c.score.total}）`)
      .join('、')
    const principleIds = Array.from(
      new Set(scheme.options.flatMap((o) => o.principleIds)),
    ) as InventivePrincipleId[]
    const parameterKeys = this.derivedParameterKeys(scheme)
    const narrative = [
      `方案「${scheme.name}」的候选路径按确定性评分排序为：${optionPhrases}。`,
      top ? `当前评分最高的是「${top.optionId}」，综合得分 ${top.score.total}。` : '',
      `涉及候选原理：${principleIds.join('、') || '无'}；涉及参数：${parameterKeys.join('、') || '无'}。`,
      '本说明仅为待审核的参考性中文摘要，不会改变确定性评分，也不会自动修改项目计划、资源或范围。',
    ]
      .filter(Boolean)
      .join('')

    return {
      narrative,
      isFallback: false,
      hallucinationChecked: true,
      hallucinationPassed: true,
      degradedReason: null,
      referencedOptionIds: comparison.cells.map((c) => c.optionId),
      referencedPrincipleIds: principleIds,
      referencedParameterKeys: parameterKeys,
      provider: FAKE_PROVIDER,
      model: FAKE_MODEL,
      cost: null,
    }
  }

  /** 真实模型 seam：仅显式开启时调用。当前未接入真实网关，抛错触发降级。 */
  private async callRealGateway(
    _scheme: InnovationScheme,
    _comparison: InnovationSchemeComparison,
    _packet: InnovationContextPacket,
  ): Promise<InnovationSchemeNarrative> {
    // 真实 AIGateway 集成属后续 change；此处显式抛错以触发 fallback。
    throw new Error('real AIGateway not configured for TRIZ Innovation Workbench')
  }

  /** 反幻觉校验（§5.3）：引用必须可追溯；否则降级。 */
  private validateTraceability(
    scheme: InnovationScheme,
    narrative: InnovationSchemeNarrative,
  ): InnovationSchemeNarrative {
    const allowedOptions = new Set(scheme.options.map((o) => o.optionId))
    const allowedPrinciples = new Set(scheme.options.flatMap((o) => o.principleIds))
    const allowedParams = new Set(this.derivedParameterKeys(scheme))

    const optionOk = narrative.referencedOptionIds.every((id) => allowedOptions.has(id))
    const principleOk = narrative.referencedPrincipleIds.every((id) =>
      allowedPrinciples.has(id as InventivePrincipleId),
    )
    const paramOk = narrative.referencedParameterKeys.every((k) => allowedParams.has(k))

    // 影响声明必须落在确定性来源之内（fixture 已保证；真实模型可能编造 → 降级）
    const impactClaimOk = this.validateImpactClaims(scheme, narrative)

    if (optionOk && principleOk && paramOk && impactClaimOk) {
      return { ...narrative, hallucinationChecked: true, hallucinationPassed: true }
    }
    return this.fallback(scheme, 'AI 说明引用了不可追溯的 option/原理/参数或编造了影响，已降级')
  }

  /**
   * 影响声明校验：禁止出现未在确定性对比中体现的"工期/资源/风险/范围/质量"数值化断言。
   * fixture 不含数值断言；真实模型若编造具体数值会被降级。
   */
  private validateImpactClaims(
    _scheme: InnovationScheme,
    narrative: InnovationSchemeNarrative,
  ): boolean {
    // 禁止具体数值化影响断言（如"缩短工期 30%"）；出现即视为编造 → 降级。
    return !containsFabricatedNumericImpact(narrative.narrative)
  }

  private fallback(scheme: InnovationScheme, reason: string): InnovationSchemeNarrative {
    const principleIds = Array.from(
      new Set(scheme.options.flatMap((o) => o.principleIds)),
    ) as InventivePrincipleId[]
    return {
      narrative: `方案「${scheme.name}」的 AI 说明已降级为规则摘要。请以确定性评分、候选原理与来源 refs 为准进行人工复核。${reason}。`,
      isFallback: true,
      hallucinationChecked: true,
      hallucinationPassed: false,
      degradedReason: reason,
      referencedOptionIds: scheme.options.map((o) => o.optionId),
      referencedPrincipleIds: principleIds,
      referencedParameterKeys: this.derivedParameterKeys(scheme),
      provider: FAKE_PROVIDER,
      model: FAKE_MODEL,
      cost: null,
    }
  }

  // ──────── Cost（§5.4）────────

  private buildCost(
    startedAt: number,
    narrative: InnovationSchemeNarrative,
    over: {
      finishReason: string
      errorCategory: string | null
      budgetDecisionRef?: string | null
      contextPacketRef: string
      promptTokens?: number | null
      completionTokens?: number | null
    },
  ): InnovationNarrativeCost {
    const fakeCompletion = Math.ceil(narrative.narrative.length / 4)
    return {
      promptTokens: over.promptTokens ?? 0,
      completionTokens: over.completionTokens ?? fakeCompletion,
      totalTokens: (over.promptTokens ?? 0) + (over.completionTokens ?? fakeCompletion),
      estimatedCost: 0, // fake 默认零成本；真实模型在此填估算
      latencyMs: Date.now() - startedAt,
      finishReason: over.finishReason,
      errorCategory: over.errorCategory,
      budgetDecisionRef: over.budgetDecisionRef ?? null,
      contextPacketRef: over.contextPacketRef,
      modelOutputRef: this.ref(`out:${narrative.narrative}`),
    }
  }

  // ──────── 内部 ────────

  private derivedParameterKeys(scheme: InnovationScheme): ProjectParameterKey[] {
    // 来源 ref 中不含参数 key；这里从 option 名/描述不可靠，故返回空集合，
    // 表示工作台 advisory 说明不强行绑定参数（避免编造）。真实来源参数应来自矛盾 snapshot。
    void scheme
    return []
  }

  private async recordAudit(
    params: GenerateNarrativeParams,
    narrative: InnovationSchemeNarrative,
    kind: 'generated' | 'fallback',
  ) {
    await this.audit.log({
      event:
        kind === 'fallback'
          ? AuditEvent.TRIZ_INNOVATION_NARRATIVE_FALLBACK
          : AuditEvent.TRIZ_INNOVATION_NARRATIVE_GENERATED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'triz_innovation_scheme',
      entityId: null,
      requestId: params.requestId ?? null,
      metadata: {
        schemeId: params.scheme.schemeId,
        isFallback: narrative.isFallback,
        provider: narrative.provider,
        model: narrative.model,
        // 仅 refs/摘要，不含正文
        contextPacketRef: narrative.cost?.contextPacketRef ?? null,
        modelOutputRef: narrative.cost?.modelOutputRef ?? null,
        finishReason: narrative.cost?.finishReason ?? null,
        totalTokens: narrative.cost?.totalTokens ?? null,
        estimatedCost: narrative.cost?.estimatedCost ?? null,
      },
    })
  }

  private ref(input: string): string {
    return createHash('sha256').update(input, 'utf-8').digest('hex').slice(0, 16)
  }
}
