import { createId } from '@paralleldrive/cuid2'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import AiTraceSpan from '#models/ai_trace_span'

/**
 * AI 请求链路追踪上下文服务。
 *
 * 职责：
 * - 为每个用户请求生成唯一 trace ID
 * - 在每次服务间调用（hop）时创建 span 并关联父级
 * - 跨服务调用与 SSE 流式传输传播 trace 上下文
 * - 父 span 不存在或无效时标记为 orphan（孤儿）
 *
 * 设计原则：tracing-degrades —— 追踪失败绝不影响主流程，
 * recordSpan 会静默吞掉所有异常并记日志。
 */
export class TraceContextService {
  /**
   * 生成新的 trace ID（用于用户级请求的唯一标识）。
   * 使用 cuid2 保证时间有序且全局唯一。
   */
  generateTraceId(): string {
    return `tr_${createId()}`
  }

  /**
   * 生成新的 span ID。
   */
  generateSpanId(): string {
    return `sp_${createId()}`
  }

  /**
   * 创建一个新的 span。
   *
   * 如果提供了 parentSpanId 且有效，作为子 span 挂载；
   * 如果 parentSpanId 为 null 或无效，标记为 orphan 并记录断链原因。
   */
  createSpan(params: {
    traceId: string
    parentSpanId: string | null
    spanType: string
    organizationId: number
    conversationId?: string | null
    workflowName?: string | null
  }): {
    spanId: string
    traceId: string
    parentSpanId: string | null
    spanType: string
    isOrphan: boolean
    orphanBreakReason: string | null
    startedAt: string
    organizationId: number
    conversationId: string | null
    workflowName: string | null
  } {
    const spanId = this.generateSpanId()
    const isOrphan = params.parentSpanId === null
    const orphanBreakReason = params.parentSpanId === null ? 'parent_span_id_not_provided' : null

    return {
      spanId,
      traceId: params.traceId,
      parentSpanId: params.parentSpanId,
      spanType: params.spanType,
      isOrphan,
      orphanBreakReason,
      startedAt: new Date().toISOString(),
      organizationId: params.organizationId,
      conversationId: params.conversationId ?? null,
      workflowName: params.workflowName ?? null,
    }
  }

  /**
   * 将已完成的 span 持久化到数据库。
   *
   * tracing-degrades 规则：此方法永远不抛异常。
   * 数据库写入失败时仅记录错误日志。
   */
  async recordSpan(span: {
    spanId: string
    traceId: string
    parentSpanId: string | null
    spanType: string
    startedAt: string
    endedAt: string | null
    durationMs: number | null
    status: string
    errorKind?: string | null
    errorRef?: string | null
    organizationId: number
    conversationId?: string | null
    workflowName?: string | null
    isOrphan: boolean
    orphanBreakReason?: string | null
    selfDurationMs?: number | null
    onCriticalPath?: boolean
    estimatedCost?: number | null
    inputTokens?: number | null
    outputTokens?: number | null
    metadata?: Record<string, unknown> | null
  }): Promise<void> {
    try {
      await AiTraceSpan.create({
        spanId: span.spanId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId,
        spanType: span.spanType,
        startedAt: DateTime.fromISO(span.startedAt),
        endedAt: span.endedAt ? DateTime.fromISO(span.endedAt) : null,
        durationMs: span.durationMs,
        status: span.status,
        errorKind: span.errorKind ?? null,
        errorRef: span.errorRef ?? null,
        organizationId: span.organizationId,
        conversationId: span.conversationId ?? null,
        workflowName: span.workflowName ?? null,
        isOrphan: span.isOrphan,
        orphanBreakReason: span.orphanBreakReason ?? null,
        selfDurationMs: span.selfDurationMs ?? null,
        onCriticalPath: span.onCriticalPath ?? false,
        estimatedCost: span.estimatedCost ?? null,
        inputTokens: span.inputTokens ?? null,
        outputTokens: span.outputTokens ?? null,
        metadata: span.metadata ?? null,
      })
    } catch (error) {
      logger.error(
        { spanId: span.spanId, traceId: span.traceId, error },
        'Failed to record trace span — degrading silently',
      )
    }
  }

  /**
   * 从父级上下文构建子 span 的传播上下文。
   * 继承 traceId、organizationId、conversationId、workflowName。
   */
  childContext(parent: {
    traceId: string
    organizationId: number
    conversationId?: string | null
    workflowName?: string | null
  }): {
    traceId: string
    organizationId: number
    conversationId: string | null
    workflowName: string | null
  } {
    return {
      traceId: parent.traceId,
      organizationId: parent.organizationId,
      conversationId: parent.conversationId ?? null,
      workflowName: parent.workflowName ?? null,
    }
  }

  /**
   * 创建一个自动记录完成状态的 span 辅助器。
   *
   * 用法：
   * ```ts
   * const span = traceContext.startSpan({ ... })
   * try {
   *   // ... 业务逻辑
   *   await span.end('ok')
   * } catch (err) {
   *   await span.end('error', 'ai_provider_error', err.message)
   *   throw err
   * }
   * ```
   */
  startSpan(params: {
    traceId: string
    parentSpanId: string | null
    spanType: string
    organizationId: number
    conversationId?: string | null
    workflowName?: string | null
  }): {
    spanId: string
    ended: boolean
    end: (status: string, errorKind?: string | null, errorRef?: string | null) => Promise<void>
  } {
    const span = this.createSpan(params)
    let ended = false

    return {
      spanId: span.spanId,
      get ended() {
        return ended
      },
      end: async (status: string, errorKind?: string | null, errorRef?: string | null) => {
        if (ended) return
        ended = true

        const endedAt = new Date().toISOString()
        const durationMs = new Date(endedAt).getTime() - new Date(span.startedAt).getTime()

        await this.recordSpan({
          spanId: span.spanId,
          traceId: span.traceId,
          parentSpanId: span.parentSpanId,
          spanType: span.spanType,
          startedAt: span.startedAt,
          endedAt,
          durationMs,
          status,
          errorKind: errorKind ?? null,
          errorRef: errorRef ?? null,
          organizationId: span.organizationId,
          conversationId: span.conversationId,
          workflowName: span.workflowName,
          isOrphan: span.isOrphan,
          orphanBreakReason: span.orphanBreakReason,
        })
      },
    }
  }
}

export default new TraceContextService()
