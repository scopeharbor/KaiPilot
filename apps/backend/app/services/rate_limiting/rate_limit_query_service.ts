/**
 * v3-global-ai-rate-limiting §8.1–8.5 — 只读限流状态查询服务。
 *
 * 实现只读限流状态查询：当前窗口用量、剩余额度、近期决策。
 * 组织隔离：全部查询路径附加 `organization_id` 过滤。
 * 未设限返回明确「未设限」而非零额度假象。
 */

import RateLimitDecision from '#models/rate_limit_decision'
import AiConnectionModel from '#models/ai_connection_model'
import WindowCounter from './window_counter.js'

export interface RateLimitStatusInput {
  organizationId: number
  connectionId?: number | null
  modelId?: number | null
}

export interface RateLimitStatusOutput {
  organizationId: number
  dimensions: Array<{
    dimension: 'rpm' | 'tpm'
    limit: number | null
    currentCount: number
    remaining: number | null
    windowStart: string
    windowEnd: string
    isUnlimited: boolean
  }>
  recentDecisions: Array<{
    decisionId: string
    dimension: string
    decision: string
    retryAfterSeconds: number | null
    createdAt: string
  }>
}

export default class RateLimitQueryService {
  private windowCounter = new WindowCounter()

  /**
   * 查询当前窗口限流状态。
   * 组织隔离：全部查询路径附加 `organization_id` 过滤。
   */
  async getStatus(input: RateLimitStatusInput): Promise<RateLimitStatusOutput> {
    const windowBounds = this.windowCounter.getWindowBounds()

    // 获取窗口计数
    const counts = await this.windowCounter.getCounts({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      modelId: input.modelId ?? null,
      windowStart: windowBounds.start,
    })

    // 读取限额
    const limits = await this.#readLimits(input.connectionId ?? null, input.modelId ?? null)

    // 构建维度状态
    const dimensions = []

    // RPM 维度
    const rpmLimit =
      limits.connectionRpmLimit ??
      limits.modelRpmLimit ??
      limits.organizationRpmLimit ??
      limits.actorRpmLimit
    const rpmRemaining = rpmLimit !== null ? Math.max(0, rpmLimit - counts.rpm) : null
    dimensions.push({
      dimension: 'rpm' as const,
      limit: rpmLimit,
      currentCount: counts.rpm,
      remaining: rpmRemaining,
      windowStart: windowBounds.start.toISO()!,
      windowEnd: windowBounds.end.toISO()!,
      isUnlimited: rpmLimit === null,
    })

    // TPM 维度
    const tpmLimit =
      limits.connectionTpmLimit ??
      limits.modelTpmLimit ??
      limits.organizationTpmLimit ??
      limits.actorTpmLimit
    const tpmRemaining = tpmLimit !== null ? Math.max(0, tpmLimit - counts.tpm) : null
    dimensions.push({
      dimension: 'tpm' as const,
      limit: tpmLimit,
      currentCount: counts.tpm,
      remaining: tpmRemaining,
      windowStart: windowBounds.start.toISO()!,
      windowEnd: windowBounds.end.toISO()!,
      isUnlimited: tpmLimit === null,
    })

    // 获取近期决策（组织隔离）
    const recentDecisions = await RateLimitDecision.query()
      .where('organization_id', input.organizationId)
      .orderBy('created_at', 'desc')
      .limit(10)
      .then((decisions) =>
        decisions.map((d) => ({
          decisionId: d.idempotencyKey,
          dimension: d.dimension,
          decision: d.decision,
          retryAfterSeconds: d.retryAfterSeconds,
          createdAt: d.createdAt.toISOString(),
        })),
      )

    return {
      organizationId: input.organizationId,
      dimensions,
      recentDecisions,
    }
  }

  /**
   * 读取限额（从 ai_connection_models）。
   */
  async #readLimits(
    connectionId: number | null,
    modelId: number | null,
  ): Promise<{
    connectionRpmLimit: number | null
    connectionTpmLimit: number | null
    modelRpmLimit: number | null
    modelTpmLimit: number | null
    organizationRpmLimit: number | null
    organizationTpmLimit: number | null
    actorRpmLimit: number | null
    actorTpmLimit: number | null
  }> {
    let connectionRpmLimit: number | null = null
    let connectionTpmLimit: number | null = null
    let modelRpmLimit: number | null = null
    let modelTpmLimit: number | null = null

    // 读取连接级限额
    if (connectionId) {
      const connection = await AiConnectionModel.query().where('id', connectionId).first()
      if (connection) {
        connectionRpmLimit = connection.rpmLimit
        connectionTpmLimit = connection.tpmLimit
      }
    }

    // 读取模型级限额
    if (modelId) {
      const model = await AiConnectionModel.query().where('id', modelId).first()
      if (model) {
        modelRpmLimit = model.rpmLimit
        modelTpmLimit = model.tpmLimit
      }
    }

    return {
      connectionRpmLimit,
      connectionTpmLimit,
      modelRpmLimit,
      modelTpmLimit,
      organizationRpmLimit: null, // 组织级限额待实现
      organizationTpmLimit: null,
      actorRpmLimit: null, // actor 级限额待实现
      actorTpmLimit: null,
    }
  }
}
