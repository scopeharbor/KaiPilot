/**
 * v3-ocr-provider-observability-cost-controls §4.5 — OCR 预算守卫。
 *
 * 在 OCR provider 调用前后执行 preflight/postflight 预算决策。
 * 幂等：同一 idempotencyKey 只记录一次。
 */

import type {
  OcrBudgetDecisionStatus,
  OcrBudgetPreflightInput,
  OcrBudgetPreflightResult,
  OcrBudgetPostflightInput,
} from '@aiproj/types'
import { resolveOcrBudgetDecisionStatus, computeOcrBudgetIdempotencyKey } from '@aiproj/types'
import OcrProviderBudgetDecision from '#models/ocr_provider_budget_decision'
import OcrBudgetPolicyResolver from '#services/ai_ocr/ocr_budget_policy_resolver'

export interface OcrBudgetGuardOptions {
  policyResolver?: OcrBudgetPolicyResolver
}

export default class OcrBudgetGuard {
  readonly #policyResolver: OcrBudgetPolicyResolver

  constructor(options?: OcrBudgetGuardOptions) {
    this.#policyResolver = options?.policyResolver ?? new OcrBudgetPolicyResolver()
  }

  /**
   * Preflight: 在调用前检查预算是否允许。
   */
  async preflight(input: OcrBudgetPreflightInput): Promise<OcrBudgetPreflightResult> {
    const resolution = this.#policyResolver.resolve({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ocrJobId: input.ocrJobId,
      provider: input.provider,
      model: input.model,
      capabilityMode: input.capabilityMode ?? null,
    })

    const policy = resolution.policy
    if (!policy || !policy.enabled) {
      return { allowed: true, status: 'allowed', warningCodes: [] }
    }

    const estimatedCost = input.estimatedCost ?? 0
    const status = resolveOcrBudgetDecisionStatus(estimatedCost, policy.hardLimit, policy.softLimit)
    const warningCodes = status !== 'allowed' ? ['BUDGET_HARD_LIMIT_REACHED' as const] : []

    const decisionId = await this.#persistDecision({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ocrJobId: input.ocrJobId,
      pageId: input.pageId ?? null,
      scope: 'job',
      status,
      estimatedCost,
      currency: input.currency ?? policy.currency,
      budgetLimit: policy.hardLimit,
      budgetUsed: policy.usedAmount,
      softLimitAction: policy.softLimitAction,
      warningCodes,
      idempotencyKey: computeOcrBudgetIdempotencyKey({
        organizationId: input.organizationId,
        projectId: input.projectId,
        ocrJobId: input.ocrJobId,
        pageId: input.pageId ?? null,
        scope: 'job',
      }),
    })

    return {
      allowed: status !== 'hard_blocked',
      status,
      warningCodes,
      decisionId,
    }
  }

  /**
   * Postflight: 调用完成后记录实际使用情况。
   */
  async postflight(input: OcrBudgetPostflightInput): Promise<string | null> {
    const status: OcrBudgetDecisionStatus = 'allowed'
    const decisionId = await this.#persistDecision({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ocrJobId: input.ocrJobId,
      pageId: input.pageId ?? null,
      scope: 'job',
      status,
      estimatedCost: input.actualCost ?? 0,
      currency: input.currency ?? 'USD',
      budgetLimit: null,
      budgetUsed: 0,
      softLimitAction: null,
      warningCodes: [],
      idempotencyKey: input.idempotencyKey,
    })

    return decisionId
  }

  /**
   * 持久化预算决策（幂等：idempotencyKey 去重）。
   */
  async #persistDecision(input: {
    organizationId: number
    projectId: number
    ocrJobId: number | null
    pageId: number | null
    scope: string
    status: OcrBudgetDecisionStatus
    estimatedCost: number
    currency: string
    budgetLimit: number | null
    budgetUsed: number
    softLimitAction: string | null
    warningCodes: string[]
    idempotencyKey: string
  }): Promise<string> {
    // v3-multitenant-database-isolation §5.4 / §6.2：幂等命中必须在组织 scope 内查找。
    // 无 scope 时他租已占用的同 key 会被当成"本组织已处理"，直接返回他租决策 ID
    // （跨租读取 + 跳过本组织应有的预算记账）。唯一索引已同步改为
    // (organization_id, idempotency_key)，见迁移 1839300000002。
    const existing = await OcrProviderBudgetDecision.query()
      .where('organization_id', input.organizationId)
      .where('idempotency_key', input.idempotencyKey)
      .first()

    if (existing) return `bd:${existing.id}:${input.idempotencyKey}`

    const decision = await OcrProviderBudgetDecision.create({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ocrJobId: input.ocrJobId,
      pageId: input.pageId,
      scope: input.scope as any,
      status: input.status as any,
      estimatedCost: input.estimatedCost,
      currency: input.currency,
      budgetLimit: input.budgetLimit,
      budgetUsed: input.budgetUsed,
      softLimitAction: input.softLimitAction as any,
      warningCodes: input.warningCodes as any,
      idempotencyKey: input.idempotencyKey,
      metadata: null,
    })

    return `bd:${decision.id}:${input.idempotencyKey}`
  }
}
