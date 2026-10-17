/**
 * v3-frontend-ai-usage-telemetry —— 前端 AI 使用事件聚合服务。
 *
 * 实现要点：
 * - 按组织、事件种类与时间窗的聚合
 * - 五个核心指标可查：打开率、会话长度、首问类别分布、放弃率、芯片点击分布
 * - 聚合确定性：同一事件快照产出同一聚合
 * - 不做跨会话行为拼接与用户画像
 *
 * v3-ai-quality-cost-console-deferred-p1 §3 / D5 增量：
 * - persistBatch：事件批量落库（frontend_telemetry_events），服务端二次校验
 *   禁存字段与敏感样本，违规事件拒绝落库；
 * - aggregateFromStore：从持久化记录求五指标（复用 computeDeterministicAggregation）；
 * - 既有内存态方法签名与行为不变。
 */

import type { CopilotIntentClass } from '@aiproj/types'
import {
  frontendTelemetryContainsForbiddenFields,
  frontendTelemetryContainsSensitiveSamples,
} from '@aiproj/types'
import FrontendTelemetryEvent from '#models/frontend_telemetry_event'

/** persistBatch 结果：接收数与被拒数。 */
export interface FrontendTelemetryPersistResult {
  received: number
  rejected: number
}

/** 防御性时间转换：SQLite 读出的 timestamp 可能是 Date 或 ISO 字符串。 */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date(0).toISOString()
}

/**
 * 前端 AI 使用事件聚合服务。
 */
export class FrontendTelemetryService {
  /**
   * 聚合查询参数。
   */
  private aggregationQuery = {
    organizationId: '',
    eventKind: '',
    start: '',
    end: '',
  }

  /**
   * 设置聚合查询参数。
   */
  setAggregationQuery(params: {
    organizationId: string
    eventKind?: string
    start: string
    end: string
  }): void {
    this.aggregationQuery = {
      organizationId: params.organizationId,
      eventKind: params.eventKind ?? '',
      start: params.start,
      end: params.end,
    }
  }

  /**
   * 获取聚合查询参数。
   */
  getAggregationQuery(): { organizationId: string; eventKind: string; start: string; end: string } {
    return this.aggregationQuery
  }

  /**
   * 计算五个核心指标。
   *
   * @param events - 事件列表
   * @returns 聚合结果
   */
  computeAggregation(events: readonly Record<string, unknown>[]): {
    openRate: number
    sessionLength: number
    firstQuestionDistribution: Record<CopilotIntentClass, number>
    abandonmentRate: number
    chipClickDistribution: Record<string, number>
  } {
    // 按会话分组
    const sessions = new Map<string, Record<string, unknown>[]>()

    for (const event of events) {
      const sessionId = event.sessionId as string
      if (!sessionId) continue

      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, [])
      }
      sessions.get(sessionId)!.push(event)
    }

    // 计算指标
    let totalSessions = 0
    let openCount = 0
    let abandonmentCount = 0
    let totalTurns = 0
    const firstQuestionDistribution: Record<string, number> = {
      query: 0,
      analysis: 0,
      generation: 0,
      mutation: 0,
      instruction: 0,
      meta: 0,
    }
    const chipClickDistribution: Record<string, number> = {}

    for (const [, sessionEvents] of sessions) {
      totalSessions++

      // 检查是否有面板打开事件
      const hasOpen = sessionEvents.some((e) => e.eventKind === 'panel_open')
      if (hasOpen) {
        openCount++
      }

      // 检查是否有放弃事件
      const hasAbandonment = sessionEvents.some((e) => e.eventKind === 'abandonment')
      if (hasAbandonment) {
        abandonmentCount++
      }

      // 计算会话轮数（取最大 turnCount）
      const turnEvents = sessionEvents.filter((e) => e.eventKind === 'session_turn')
      let maxTurnCount = 0
      for (const turnEvent of turnEvents) {
        const turnCount = (turnEvent.turnCount as number) || 0
        if (turnCount > maxTurnCount) {
          maxTurnCount = turnCount
        }
      }
      totalTurns += maxTurnCount

      // 统计首问意图类别
      const firstIntentEvent = sessionEvents.find((e) => e.eventKind === 'first_question_intent')
      if (firstIntentEvent) {
        const intentClass = firstIntentEvent.intentClass as string
        if (intentClass in firstQuestionDistribution) {
          firstQuestionDistribution[intentClass]++
        }
      }

      // 统计芯片点击
      const chipClickEvents = sessionEvents.filter((e) => e.eventKind === 'chip_click')
      for (const chipClickEvent of chipClickEvents) {
        const chipId = chipClickEvent.chipId as string
        if (chipId) {
          chipClickDistribution[chipId] = (chipClickDistribution[chipId] || 0) + 1
        }
      }
    }

    // 计算聚合指标
    const openRate = totalSessions > 0 ? openCount / totalSessions : 0
    const sessionLength = totalSessions > 0 ? totalTurns / totalSessions : 0
    const abandonmentRate = openCount > 0 ? abandonmentCount / openCount : 0

    return {
      openRate,
      sessionLength,
      firstQuestionDistribution: firstQuestionDistribution as Record<CopilotIntentClass, number>,
      abandonmentRate,
      chipClickDistribution,
    }
  }

  /**
   * 确保聚合确定性：同一事件快照产出同一聚合。
   *
   * @param events - 事件列表
   * @returns 聚合结果（确定性）
   */
  computeDeterministicAggregation(events: readonly Record<string, unknown>[]): {
    openRate: number
    sessionLength: number
    firstQuestionDistribution: Record<CopilotIntentClass, number>
    abandonmentRate: number
    chipClickDistribution: Record<string, number>
  } {
    // 排序事件以确保确定性
    const sortedEvents = [...events].sort((a, b) => {
      const aTimestamp = a.timestamp as string
      const bTimestamp = b.timestamp as string
      if (aTimestamp < bTimestamp) return -1
      if (aTimestamp > bTimestamp) return 1

      const aSessionId = a.sessionId as string
      const bSessionId = b.sessionId as string
      if (aSessionId < bSessionId) return -1
      if (aSessionId > bSessionId) return 1

      const aEventKind = a.eventKind as string
      const bEventKind = b.eventKind as string
      if (aEventKind < bEventKind) return -1
      if (aEventKind > bEventKind) return 1

      return 0
    })

    return this.computeAggregation(sortedEvents)
  }

  /**
   * 批量落库（deferred-p1 D5）。
   *
   * 服务端二次校验：含禁存字段或敏感样本的事件拒绝落库；
   * 只映射类别与计数列，自由文本永不落库。
   *
   * @param organizationId - 组织 ID（整数，调用方负责从契约层 string 转换）
   * @param events - 原始事件记录
   * @returns 接收数与被拒数
   */
  async persistBatch(
    organizationId: number,
    events: readonly Record<string, unknown>[],
  ): Promise<FrontendTelemetryPersistResult> {
    let received = 0
    let rejected = 0

    for (const event of events) {
      if (
        frontendTelemetryContainsForbiddenFields(event) ||
        frontendTelemetryContainsSensitiveSamples(event)
      ) {
        rejected++
        continue
      }

      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : ''
      const eventKind = typeof event.eventKind === 'string' ? event.eventKind : ''
      const timestamp = typeof event.timestamp === 'string' ? event.timestamp : ''
      if (!sessionId || !eventKind || !timestamp) {
        rejected++
        continue
      }

      await FrontendTelemetryEvent.create({
        organizationId,
        sessionId,
        eventKind,
        occurredAt: new Date(timestamp).toISOString(),
        hasSubmitted: typeof event.hasSubmitted === 'boolean' ? event.hasSubmitted : null,
        turnCount: typeof event.turnCount === 'number' ? event.turnCount : null,
        intentClass: typeof event.intentClass === 'string' ? event.intentClass : null,
        chipId: typeof event.chipId === 'string' ? event.chipId : null,
        chipSource: typeof event.chipSource === 'string' ? event.chipSource : null,
        actionId: typeof event.actionId === 'string' ? event.actionId : null,
        actionLabel: typeof event.actionLabel === 'string' ? event.actionLabel.slice(0, 128) : null,
        createdAt: new Date(),
      })
      received++
    }

    return { received, rejected }
  }

  /**
   * 从持久化记录求五指标（deferred-p1 D5）。
   * 组织隔离 + 窗口过滤；复用确定性聚合保证同一快照同一结果。
   */
  async aggregateFromStore(
    organizationId: number,
    start: string,
    end: string,
  ): Promise<{
    openRate: number
    sessionLength: number
    firstQuestionDistribution: Record<CopilotIntentClass, number>
    abandonmentRate: number
    chipClickDistribution: Record<string, number>
  }> {
    const rows = await FrontendTelemetryEvent.query()
      .where('organization_id', organizationId)
      .where('occurred_at', '>=', start)
      .where('occurred_at', '<=', end)

    const events: Record<string, unknown>[] = rows.map((row) => ({
      sessionId: row.sessionId,
      eventKind: row.eventKind,
      timestamp: toIso(row.occurredAt),
      hasSubmitted: row.hasSubmitted ?? undefined,
      turnCount: row.turnCount ?? undefined,
      intentClass: row.intentClass ?? undefined,
      chipId: row.chipId ?? undefined,
    }))

    return this.computeDeterministicAggregation(events)
  }
}

/**
 * 创建前端遥测服务实例。
 */
export function createFrontendTelemetryService(): FrontendTelemetryService {
  return new FrontendTelemetryService()
}
