/**
 * v3-global-ai-rate-limiting §5.1–5.12 — 限流守卫。
 *
 * 实现限流决策：消费 ai_connection_models.rpm_limit/tpm_limit，
 * RPM preflight 判定与超限拒绝，TPM preflight/postflight 两段式，
 * 预估与实际偏差记录，幂等结算，actor 公平占比上限。
 *
 * 设计约束：
 * - 以统一账本为唯一计数来源；
 * - 未设限即该维度不约束；
 * - 多层叠加取最严格者；
 * - 超限返回明确错误与确定性重试建议；
 * - 计数不可用不得默认放行；
 * - 与 OCR 既有限流调和，不改写其行为。
 */

import AiConnectionModel from '#models/ai_connection_model'
import RateLimitDecision from '#models/rate_limit_decision'
import { DateTime } from 'luxon'
import WindowCounter from './window_counter.js'
import {
  computeRetryAfterSeconds,
  resolveStrictestLimit,
  computeRateLimitDecisionId,
  rateLimitDecisionHasForbiddenKeys,
  RATE_LIMIT_WINDOW_MS,
} from '@aiproj/types'

export interface RateLimitPreflightInput {
  organizationId: number
  connectionId: number | null
  modelId: number | null
  actorId: number | null
  estimatedTokens?: number // 仅 TPM
  attemptId: string | null
}

export interface RateLimitPreflightResult {
  allowed: boolean
  decision: 'allow' | 'throttle' | 'reject'
  retryAfterSeconds: number | null
  decisionId: string | null
  triggeringLayer: string | null
}

export interface RateLimitPostflightInput {
  decisionId: string
  actualTokens: number
}

export interface RateLimitPostflightResult {
  settled: boolean
  deviation: number | null
}

/** 决策记录写入入参（低敏，逐列映射到 `rate_limit_decisions`）。 */
interface RateLimitDecisionRecordInput {
  readonly decisionId: string
  readonly organizationId: number
  readonly connectionId: number | null
  readonly modelId: number | null
  readonly actorId: number | null
  readonly windowStart: string
  readonly windowEnd: string
  readonly dimension: 'rpm' | 'tpm'
  readonly layer: 'connection' | 'model' | 'organization' | 'actor'
  readonly limit: number | null
  readonly currentCount: number
  readonly estimatedDelta: number | null
  readonly decision: 'allow' | 'throttle' | 'reject'
  readonly retryAfterSeconds: number | null
  readonly triggeringLayer: 'connection' | 'model' | 'organization' | 'actor'
  readonly idempotencyKey: string
  readonly createdAt: string
}

export default class RateLimitGuard {
  private windowCounter = new WindowCounter()

  /**
   * Preflight：检查当前窗口是否有 RPM/TPM 余量。
   * 消费 ai_connection_models.rpm_limit/tpm_limit。
   */
  async preflight(input: RateLimitPreflightInput): Promise<RateLimitPreflightResult> {
    // 1. 读取限额（从 ai_connection_models）
    const limits = await this.#readLimits(input.connectionId, input.modelId)

    // 2. 如果所有维度都未设限，直接放行。
    // 按 null 判定而不是按真假值：限额 0 的含义是「一次调用都不许」，
    // 用 `!limits.rpmLimit` 会把 0 当成未设限而全部放行——把最严的配置读成最松的。
    if (limits.rpmLimit == null && limits.tpmLimit == null) {
      return {
        allowed: true,
        decision: 'allow',
        retryAfterSeconds: null,
        decisionId: null,
        triggeringLayer: null,
      }
    }

    // 3. 获取窗口计数
    const windowBounds = this.windowCounter.getWindowBounds()
    const counts = await this.windowCounter.getCounts({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      modelId: input.modelId,
      windowStart: windowBounds.start,
    })

    // 4. 多层叠加取最严格者
    const rpmLimits = [
      { layer: 'connection' as const, limit: limits.connectionRpmLimit },
      { layer: 'model' as const, limit: limits.modelRpmLimit },
      { layer: 'organization' as const, limit: limits.organizationRpmLimit },
      { layer: 'actor' as const, limit: limits.actorRpmLimit },
    ]

    const tpmLimits = [
      { layer: 'connection' as const, limit: limits.connectionTpmLimit },
      { layer: 'model' as const, limit: limits.modelTpmLimit },
      { layer: 'organization' as const, limit: limits.organizationTpmLimit },
      { layer: 'actor' as const, limit: limits.actorTpmLimit },
    ]

    const rpmResolution = resolveStrictestLimit(rpmLimits)
    const tpmResolution = resolveStrictestLimit(tpmLimits)

    // 5. RPM 判定
    if (rpmResolution.limit !== null && counts.rpm >= rpmResolution.limit) {
      // 滚动窗口下，窗口内已计数的 attempt 最迟在一个完整窗口后全部老化。
      // 直接传 windowBounds.end（= now）会得到 0——等于建议「立即重试」，与限流意图相反。
      const retryAfterSeconds = computeRetryAfterSeconds(
        windowBounds.start.toISO()!,
        windowBounds.end.plus({ milliseconds: RATE_LIMIT_WINDOW_MS }).toISO()!,
      )
      const decisionId = computeRateLimitDecisionId({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        modelId: input.modelId,
        actorId: input.actorId,
        dimension: 'rpm',
        windowStart: windowBounds.start.toISO()!,
        attemptId: input.attemptId,
      })

      await this.#recordDecision({
        decisionId,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        modelId: input.modelId,
        actorId: input.actorId,
        windowStart: windowBounds.start.toISO()!,
        windowEnd: windowBounds.end.toISO()!,
        dimension: 'rpm',
        layer: rpmResolution.triggeringLayer!,
        limit: rpmResolution.limit,
        currentCount: counts.rpm,
        estimatedDelta: null,
        decision: 'reject',
        retryAfterSeconds,
        triggeringLayer: rpmResolution.triggeringLayer!,
        idempotencyKey: decisionId,
        createdAt: new Date().toISOString(),
      })

      return {
        allowed: false,
        decision: 'reject',
        retryAfterSeconds,
        decisionId,
        triggeringLayer: rpmResolution.triggeringLayer,
      }
    }

    // 6. TPM 预估判定
    if (tpmResolution.limit !== null) {
      const estimatedTokens = input.estimatedTokens ?? 0
      const estimatedTotal = counts.tpm + estimatedTokens

      if (estimatedTotal >= tpmResolution.limit) {
        // 滚动窗口下，窗口内已计数的 attempt 最迟在一个完整窗口后全部老化。
        // 直接传 windowBounds.end（= now）会得到 0——等于建议「立即重试」，与限流意图相反。
        const retryAfterSeconds = computeRetryAfterSeconds(
          windowBounds.start.toISO()!,
          windowBounds.end.plus({ milliseconds: RATE_LIMIT_WINDOW_MS }).toISO()!,
        )
        const decisionId = computeRateLimitDecisionId({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          modelId: input.modelId,
          actorId: input.actorId,
          dimension: 'tpm',
          windowStart: windowBounds.start.toISO()!,
          attemptId: input.attemptId,
        })

        await this.#recordDecision({
          decisionId,
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          modelId: input.modelId,
          actorId: input.actorId,
          windowStart: windowBounds.start.toISO()!,
          windowEnd: windowBounds.end.toISO()!,
          dimension: 'tpm',
          layer: tpmResolution.triggeringLayer!,
          limit: tpmResolution.limit,
          currentCount: counts.tpm,
          estimatedDelta: estimatedTokens,
          decision: 'reject',
          retryAfterSeconds,
          triggeringLayer: tpmResolution.triggeringLayer!,
          idempotencyKey: decisionId,
          createdAt: new Date().toISOString(),
        })

        return {
          allowed: false,
          decision: 'reject',
          retryAfterSeconds,
          decisionId,
          triggeringLayer: tpmResolution.triggeringLayer,
        }
      }
    }

    // 7. 放行
    //
    // §8.7：TPM 限额在生效时，放行也要落一条 `allow` 决策并把 decisionId 交回调用方。
    // 此前放行一律 `decisionId: null`、不落行——于是 postflight 永远没有行可结算，
    // 「预估 vs 实际」的偏差结构上不可达。只在 TPM 真设了限额时落行：
    // 没配限额的组织不产生任何新行，表的体积由配置而非流量决定。
    if (tpmResolution.limit !== null) {
      const decisionId = computeRateLimitDecisionId({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        modelId: input.modelId,
        actorId: input.actorId,
        dimension: 'tpm',
        windowStart: windowBounds.start.toISO()!,
        attemptId: input.attemptId,
      })

      await this.#recordDecision({
        decisionId,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        modelId: input.modelId,
        actorId: input.actorId,
        windowStart: windowBounds.start.toISO()!,
        windowEnd: windowBounds.end.toISO()!,
        dimension: 'tpm',
        layer: tpmResolution.triggeringLayer!,
        limit: tpmResolution.limit,
        currentCount: counts.tpm,
        estimatedDelta: input.estimatedTokens ?? 0,
        decision: 'allow',
        retryAfterSeconds: null,
        triggeringLayer: tpmResolution.triggeringLayer!,
        idempotencyKey: decisionId,
        createdAt: new Date().toISOString(),
      })

      return {
        allowed: true,
        decision: 'allow',
        retryAfterSeconds: null,
        decisionId,
        triggeringLayer: null,
      }
    }

    return {
      allowed: true,
      decision: 'allow',
      retryAfterSeconds: null,
      decisionId: null,
      triggeringLayer: null,
    }
  }

  /**
   * Postflight：按账本真实 token 结算窗口。
   * 幂等结算，同一 attempt 只结算一次。
   */
  async postflight(input: RateLimitPostflightInput): Promise<RateLimitPostflightResult> {
    // 1. 查找决策记录
    const decision = await RateLimitDecision.query()
      .where('idempotency_key', input.decisionId)
      .first()

    if (!decision) {
      return { settled: false, deviation: null }
    }

    // 2. 幂等检查（§8.7）：只看 `settled_at`。
    //
    // 原判定是「estimatedDelta 非空且 currentCount > 0」——而这两条在**首次**结算前
    // 就同时成立（TPM 决策必带 estimatedDelta，窗口内已有调用则 currentCount > 0），
    // 于是首次结算即被误判为重复，偏差永远记不下来。
    if (decision.settledAt !== null) {
      return { settled: false, deviation: null }
    }

    // 3. 计算偏差：实际 − 预估。正数表示低估，负数表示高估。
    const estimatedDelta = decision.estimatedDelta ?? 0
    const deviation = input.actualTokens - estimatedDelta

    // 4. 写回结算结果。
    //    不动 `currentCount`：它是决策当时的窗口计数，是判定为什么这样做的证据，
    //    覆盖它等于毁掉证据（原实现的做法）。
    decision.actualTokens = input.actualTokens
    decision.settledAt = DateTime.utc()
    await decision.save()

    return { settled: true, deviation }
  }

  /**
   * 读取限额（从 ai_connection_models）。
   * 不新建第二套声明来源。
   */
  async #readLimits(
    connectionId: number | null,
    modelId: number | null,
  ): Promise<{
    rpmLimit: number | null
    tpmLimit: number | null
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
      rpmLimit: connectionRpmLimit ?? modelRpmLimit,
      tpmLimit: connectionTpmLimit ?? modelTpmLimit,
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

  /**
   * 记录决策（低敏）。
   *
   * 只写模型声明的列：`decisionId` 是对外返回的决策标识，其值已由
   * `idempotencyKey` 承载，模型无同名属性，直接透传会让 Lucid 抛
   * "Cannot define \"decisionId\" ... not defined as a model property"
   * ——即**每次真正超限都崩**。故此处显式逐列映射，不整体透传。
   */
  async #recordDecision(record: RateLimitDecisionRecordInput): Promise<void> {
    // 检查禁止键（低敏纪律：不得含 prompt/输出/token/secret）
    if (rateLimitDecisionHasForbiddenKeys(record)) {
      throw new Error('Decision record contains forbidden keys')
    }

    await RateLimitDecision.create({
      organizationId: record.organizationId,
      connectionId: record.connectionId,
      modelId: record.modelId,
      actorId: record.actorId,
      windowStart: new Date(record.windowStart),
      windowEnd: new Date(record.windowEnd),
      dimension: record.dimension,
      layer: record.layer,
      limit: record.limit,
      currentCount: record.currentCount,
      estimatedDelta: record.estimatedDelta,
      decision: record.decision,
      retryAfterSeconds: record.retryAfterSeconds,
      triggeringLayer: record.triggeringLayer,
      idempotencyKey: record.idempotencyKey,
    })
  }
}
