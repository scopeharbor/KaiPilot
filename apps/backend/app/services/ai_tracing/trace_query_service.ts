/**
 * v3-ai-request-tracing —— Trace 查询服务。
 *
 * 提供：
 * - 按 trace_id 查询 span 树（含关键路径标记）
 * - 按会话维度聚合
 * - 按编排维度聚合
 * - 孤儿 span 查询
 *
 * 组织隔离：所有查询路径附加 organization_id 过滤。
 */
import AiTraceSpan from '#models/ai_trace_span'
import {
  assembleSpanTree,
  type AiTraceSpan as AiTraceSpanContract,
  type AiTraceTreeResponse,
  type AiTraceSessionAggregation,
  type AiTraceWorkflowAggregation,
} from '@aiproj/types'

export class TraceQueryService {
  /**
   * 按 trace_id 查询 span 树，含关键路径标记。
   * 组织隔离：必须传入 organizationId。
   */
  async queryTraceTree(
    organizationId: number,
    traceId: string,
  ): Promise<AiTraceTreeResponse | null> {
    const rows = await AiTraceSpan.forTrace(organizationId, traceId)
    if (rows.length === 0) return null

    const spans: AiTraceSpanContract[] = rows.map((r) => this.rowToSpanContract(r))

    const tree = assembleSpanTree(spans)

    const criticalPathDuration = tree.critical_path_span_ids.reduce((sum, spanId) => {
      const span = tree.flat_spans.find((s) => s.span_id === spanId)
      return sum + (span?.duration_ms ?? 0)
    }, 0)

    const percentageOfTotal =
      tree.total_duration_ms > 0
        ? Math.round((criticalPathDuration / tree.total_duration_ms) * 10000) / 100
        : 0

    return {
      tree,
      critical_path: {
        span_ids: tree.critical_path_span_ids,
        total_duration_ms: criticalPathDuration,
        percentage_of_total: percentageOfTotal,
      },
    }
  }

  /**
   * 按会话维度聚合。
   */
  async aggregateBySession(
    organizationId: number,
    conversationId: string,
    windowStart?: string,
    windowEnd?: string,
  ): Promise<AiTraceSessionAggregation> {
    const query = AiTraceSpan.forConversation(organizationId, conversationId)

    if (windowStart) query.where('started_at', '>=', windowStart)
    if (windowEnd) query.where('started_at', '<=', windowEnd)

    const rows = await query

    const totalSpans = rows.length
    const totalDurationMs = rows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
    const totalCost = rows.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0)

    // 按 traceId 分组计算 trace 数量
    const traceIds = new Set(rows.map((r) => r.traceId))

    // 找最慢的 trace
    const traceDurations = new Map<string, number>()
    for (const row of rows) {
      const current = traceDurations.get(row.traceId) ?? 0
      traceDurations.set(row.traceId, current + (row.durationMs ?? 0))
    }
    let slowestTraceId: string | null = null
    let maxDuration = -1
    for (const [traceId, duration] of traceDurations) {
      if (duration > maxDuration) {
        maxDuration = duration
        slowestTraceId = traceId
      }
    }

    return {
      conversation_id: conversationId,
      trace_count: traceIds.size,
      total_spans: totalSpans,
      total_duration_ms: totalDurationMs,
      total_estimated_cost: totalCost,
      avg_trace_duration_ms: traceIds.size > 0 ? Math.round(totalDurationMs / traceIds.size) : 0,
      slowest_trace_id: slowestTraceId,
      window_start: windowStart ?? rows[0]?.startedAt?.toISO() ?? '',
      window_end: windowEnd ?? rows[rows.length - 1]?.startedAt?.toISO() ?? '',
    }
  }

  /**
   * 按编排维度聚合。
   */
  async aggregateByWorkflow(
    organizationId: number,
    workflowName: string,
    windowStart?: string,
    windowEnd?: string,
  ): Promise<AiTraceWorkflowAggregation> {
    const query = AiTraceSpan.forOrganization(organizationId).where('workflow_name', workflowName)

    if (windowStart) query.where('started_at', '>=', windowStart)
    if (windowEnd) query.where('started_at', '<=', windowEnd)

    const rows = await query

    const totalSpans = rows.length
    const totalDurationMs = rows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
    const totalCost = rows.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0)

    const traceIds = new Set(rows.map((r) => r.traceId))

    const traceDurations = new Map<string, number>()
    for (const row of rows) {
      const current = traceDurations.get(row.traceId) ?? 0
      traceDurations.set(row.traceId, current + (row.durationMs ?? 0))
    }
    let slowestTraceId: string | null = null
    let maxDuration = -1
    for (const [traceId, duration] of traceDurations) {
      if (duration > maxDuration) {
        maxDuration = duration
        slowestTraceId = traceId
      }
    }

    return {
      workflow_name: workflowName,
      trace_count: traceIds.size,
      total_spans: totalSpans,
      total_duration_ms: totalDurationMs,
      total_estimated_cost: totalCost,
      avg_trace_duration_ms: traceIds.size > 0 ? Math.round(totalDurationMs / traceIds.size) : 0,
      slowest_trace_id: slowestTraceId,
      window_start: windowStart ?? rows[0]?.startedAt?.toISO() ?? '',
      window_end: windowEnd ?? rows[rows.length - 1]?.startedAt?.toISO() ?? '',
    }
  }

  /**
   * 查询孤儿 span。
   */
  async queryOrphanSpans(organizationId: number, traceId?: string): Promise<AiTraceSpanContract[]> {
    let query = AiTraceSpan.forOrganization(organizationId).where('is_orphan', true)
    if (traceId) query = query.where('trace_id', traceId)
    const rows = await query.orderBy('started_at', 'asc')
    return rows.map((r) => this.rowToSpanContract(r))
  }

  /**
   * 将数据库行转换为共享契约类型。
   */
  private rowToSpanContract(row: AiTraceSpan): AiTraceSpanContract {
    return {
      span_id: row.spanId,
      trace_id: row.traceId,
      parent_span_id: row.parentSpanId,
      span_type: row.spanType as AiTraceSpanContract['span_type'],
      started_at: row.startedAt.toISO() ?? '',
      ended_at: row.endedAt?.toISO() ?? null,
      duration_ms: row.durationMs,
      status: row.status as AiTraceSpanContract['status'],
      error_kind: row.errorKind,
      error_ref: row.errorRef,
      organization_id: row.organizationId,
      conversation_id: row.conversationId,
      workflow_name: row.workflowName,
      is_orphan: row.isOrphan,
      orphan_break_reason: row.orphanBreakReason as AiTraceSpanContract['orphan_break_reason'],
      self_duration_ms: row.selfDurationMs,
      on_critical_path: row.onCriticalPath,
      estimated_cost: row.estimatedCost,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      metadata: row.metadata,
    }
  }
}
