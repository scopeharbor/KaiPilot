/**
 * v3-ai-request-tracing —— AI 请求追踪共享契约。
 *
 * 一次用户请求内的 AI 链路追踪：
 * - trace：一次用户请求的全局标识
 * - span：请求内的每一跳（模型调用、工具调用、检索、上下文装配等）
 * - span 树：父子关系形成的分析单元
 * - 关键路径：耗时最长的链路
 *
 * 设计约束（来自 design.md）：
 * - span 类型复用账本 LEDGER_OPERATION_NAMES，不新造并行分类
 * - 追踪失败可降级，不得阻断业务
 * - 断链标记孤儿，禁止伪造父子关系
 * - 低敏：只存 ID、类型、时间、状态、错误分类与引用
 * - 复用账本禁止键类别，禁 prompt/模型输出/工具参数/检索正文
 */

import {
  LEDGER_OPERATION_NAMES,
  LEDGER_FORBIDDEN_KEY_CATEGORIES,
} from './unified-ai-invocation-ledger.js'

// ---------------------------------------------------------------------------
// §1 span 类型 —— 复用账本 operation 语义
// ---------------------------------------------------------------------------

/**
 * span 类型枚举。严格复用 LEDGER_OPERATION_NAMES，不新造并行分类。
 * 任何新类型必须先添加到 LEDGER_OPERATION_NAMES 才能在此使用。
 */
export const SPAN_TYPES = [...LEDGER_OPERATION_NAMES] as const
export type SpanType = (typeof SPAN_TYPES)[number]

/** 类型守卫：判断一个值是否为合法 span 类型。 */
export function isSpanType(value: unknown): value is SpanType {
  return typeof value === 'string' && (SPAN_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// §2 span 状态
// ---------------------------------------------------------------------------

export const SPAN_STATUSES = ['ok', 'error', 'cancelled', 'timeout', 'orphaned'] as const
export type SpanStatus = (typeof SPAN_STATUSES)[number]

/** 类型守卫：判断一个值是否为合法 span 状态。 */
export function isSpanStatus(value: unknown): value is SpanStatus {
  return typeof value === 'string' && (SPAN_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// §3 断链原因码
// ---------------------------------------------------------------------------

/**
 * 孤儿 span 的断链原因码。记录上下文传播失败的具体原因，
 * 便于诊断而非静默丢失。
 */
export const ORPHAN_BREAK_REASONS = [
  'parent_not_found',
  'propagation_failure',
  'cross_service_boundary',
  'streaming_context_lost',
  'budget_context_lost',
  'rate_limit_context_lost',
  'unknown',
] as const
export type OrphanBreakReason = (typeof ORPHAN_BREAK_REASONS)[number]

/** 类型守卫：判断一个值是否为合法孤儿断链原因。 */
export function isOrphanBreakReason(value: unknown): value is OrphanBreakReason {
  return typeof value === 'string' && (ORPHAN_BREAK_REASONS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// §4 span 记录 —— 核心追踪数据
// ---------------------------------------------------------------------------

/**
 * 单个 span 记录。记录请求内每一跳的追踪信息。
 *
 * 低敏约束：只存 ID、类型、时间、状态、错误分类与引用。
 * 禁止存储：prompt、模型输出、工具参数/结果、检索正文、原始 provider 载荷。
 */
export interface AiTraceSpan {
  /** span 全局唯一标识 */
  span_id: string

  /** 所属 trace 的标识 */
  trace_id: string

  /** 父 span 标识。根 span 为 null；孤儿 span 为 null 且 is_orphan = true。 */
  parent_span_id: string | null

  /** span 类型，复用账本 operation 语义 */
  span_type: SpanType

  /** span 开始时间（ISO 8601） */
  started_at: string

  /** span 结束时间（ISO 8601）。进行中的 span 为 null。 */
  ended_at: string | null

  /** 耗时（毫秒）。进行中的 span 为 null。 */
  duration_ms: number | null

  /** span 状态 */
  status: SpanStatus

  /** 错误分类。仅 status = 'error' 时可能非 null。 */
  error_kind: string | null

  /** 错误消息引用（低敏，不存原始错误消息）。 */
  error_ref: string | null

  /** 组织 ID（组织隔离必须） */
  organization_id: number

  /** 关联的会话 ID（Copilot 会话维度） */
  conversation_id: string | null

  /** 关联的编排名称（Compiler 编排维度） */
  workflow_name: string | null

  /** 是否为孤儿 span（父 span 缺失） */
  is_orphan: boolean

  /** 孤儿断链原因码。仅 is_orphan = true 时非 null。 */
  orphan_break_reason: OrphanBreakReason | null

  /** 自耗时（毫秒）：排除子 span 耗时后的自身处理时间 */
  self_duration_ms: number | null

  /** 是否在关键路径上（最长耗时链路标记） */
  on_critical_path: boolean

  /** 成本估算（可选，仅模型调用 span） */
  estimated_cost: number | null

  /** 输入 token 数（可选，仅模型调用 span） */
  input_tokens: number | null

  /** 输出 token 数（可选，仅模型调用 span） */
  output_tokens: number | null

  /** 自由元数据（仅低敏 allowlist 键：ref/hash/tokenCount/errorCode/status/id） */
  metadata: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// §5 span 树装配结果
// ---------------------------------------------------------------------------

/**
 * span 树节点：在内存中装配后的树形结构。
 */
export interface AiTraceSpanTreeNode {
  /** span 记录 */
  span: AiTraceSpan

  /** 子节点列表（按 started_at 升序排列） */
  children: AiTraceSpanTreeNode[]
}

/**
 * span 树装配结果。
 */
export interface AiTraceSpanTree {
  /** trace 标识 */
  trace_id: string

  /** 根节点列表（通常只有一个，可能有多个孤儿根） */
  roots: AiTraceSpanTreeNode[]

  /** 所有 span 的平铺列表（按 started_at 升序） */
  flat_spans: AiTraceSpan[]

  /** 关键路径 span ID 列表（从根到叶的最长耗时链路） */
  critical_path_span_ids: string[]

  /** span 总数 */
  total_spans: number

  /** 总耗时（毫秒，根 span 范围内） */
  total_duration_ms: number

  /** 总估算成本 */
  total_estimated_cost: number

  /** 孤儿 span 数 */
  orphan_count: number
}

// ---------------------------------------------------------------------------
// §6 聚合查询契约
// ---------------------------------------------------------------------------

/**
 * 按会话维度的聚合结果。
 */
export interface AiTraceSessionAggregation {
  /** 会话 ID */
  conversation_id: string

  /** 该会话下的 trace 数量 */
  trace_count: number

  /** 该会话下的 span 总数 */
  total_spans: number

  /** 总耗时（毫秒） */
  total_duration_ms: number

  /** 总估算成本 */
  total_estimated_cost: number

  /** 平均每 trace 耗时 */
  avg_trace_duration_ms: number

  /** 最慢的 trace ID */
  slowest_trace_id: string | null

  /** 时间窗口起始 */
  window_start: string

  /** 时间窗口结束 */
  window_end: string
}

/**
 * 按编排维度的聚合结果。
 */
export interface AiTraceWorkflowAggregation {
  /** 编排名称 */
  workflow_name: string

  /** 该编排下的 trace 数量 */
  trace_count: number

  /** 该编排下的 span 总数 */
  total_spans: number

  /** 总耗时（毫秒） */
  total_duration_ms: number

  /** 总估算成本 */
  total_estimated_cost: number

  /** 平均每 trace 耗时 */
  avg_trace_duration_ms: number

  /** 最慢的 trace ID */
  slowest_trace_id: string | null

  /** 时间窗口起始 */
  window_start: string

  /** 时间窗口结束 */
  window_end: string
}

// ---------------------------------------------------------------------------
// §7 查询响应契约
// ---------------------------------------------------------------------------

/**
 * 按 trace_id 查询 span 树的响应。
 */
export interface AiTraceTreeResponse {
  /** span 树 */
  tree: AiTraceSpanTree

  /** 关键路径分析 */
  critical_path: {
    /** 关键路径上的 span ID 列表 */
    span_ids: string[]

    /** 关键路径总耗时 */
    total_duration_ms: number

    /** 关键路径占总耗时的比例 */
    percentage_of_total: number
  }
}

// ---------------------------------------------------------------------------
// §8 span sanitizer —— 复用账本禁止键类别
// ---------------------------------------------------------------------------

/** 禁止键类别：复用账本 LEDGER_FORBIDDEN_KEY_CATEGORIES。 */
export const SPAN_FORBIDDEN_KEY_CATEGORIES = [...LEDGER_FORBIDDEN_KEY_CATEGORIES] as const
export type SpanForbiddenKeyCategory = (typeof SPAN_FORBIDDEN_KEY_CATEGORIES)[number]

/**
 * 检测 span payload 中是否包含禁止内容。
 * 复用账本的禁止键检测逻辑，不重新定义分类。
 */
export function spanDetectForbiddenKeys(
  input: Record<string, unknown> | null | undefined,
): SpanForbiddenKeyCategory[] {
  if (!input) return []
  const found = new Set<SpanForbiddenKeyCategory>()
  const walk = (value: unknown, keyPrefix: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyPrefix)
      return
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const fullKey = keyPrefix ? `${keyPrefix}.${k}` : k
        // 使用账本的禁止键正则检测
        const patterns: Array<{ category: SpanForbiddenKeyCategory; pattern: RegExp }> = [
          { category: 'prompt', pattern: /prompt/i },
          { category: 'system_instruction', pattern: /(system[-_.]?instruction|sys[-_.]?prompt)/i },
          {
            category: 'completion',
            pattern:
              /((^|[-_.])completion|completionText|outputText|responseText|(^|[-_.])content)/i,
          },
          { category: 'messages', pattern: /(^|[-_.])messages?($|[-_.])/i },
          { category: 'tool_arguments', pattern: /tool[-_.]?(args?|arguments|input|parameters)/i },
          { category: 'tool_results', pattern: /tool[-_.]?(result|results|output|response|body)/i },
          {
            category: 'retrieval_body',
            pattern: /retriev(al|ed)[-_.]?(body|document|content|text)/i,
          },
          {
            category: 'provider_payload',
            pattern: /(raw[-_.]?(body|payload)|provider[-_.]?(body|payload|response))/i,
          },
          { category: 'api_key', pattern: /api[-_.]?key/i },
          { category: 'authorization', pattern: /(authorization|auth[-_.]?header)/i },
          { category: 'token', pattern: /token/i },
          { category: 'secret', pattern: /(secret|password|passphrase)/i },
        ]
        for (const { category, pattern } of patterns) {
          if (pattern.test(fullKey)) found.add(category)
        }
        walk(v, fullKey)
      }
    }
  }
  walk(input, '')
  return [...found].sort()
}

/** 断言 span payload 无禁止内容。返回命中类别列表（空 = 通过）。 */
export function spanHasForbiddenKeys(input: Record<string, unknown> | null | undefined): boolean {
  return spanDetectForbiddenKeys(input).length > 0
}

/**
 * 清洗 span metadata，只保留低敏 allowlist 键。
 * 返回新对象，绝不修改入参。
 */
export function sanitizeSpanMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  const allowed = new Set(['ref', 'hash', 'tokenCount', 'errorCode', 'status', 'id'])
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (allowed.has(key)) safe[key] = value
  }
  return Object.keys(safe).length > 0 ? safe : null
}

// ---------------------------------------------------------------------------
// §9 span 树装配 —— 确定性实现
// ---------------------------------------------------------------------------

/**
 * 确定性 span 树装配：相同 span 集合产出相同树与相同关键路径。
 *
 * 算法：
 * 1. 按 started_at 升序排列 span（同时间按 span_id 字典序）
 * 2. 为每个 span 查找父节点（parent_span_id 匹配）
 * 3. 孤儿 span（parent_span_id 为 null 或找不到父）标记为根节点
 * 4. 关键路径：从根开始，递归选择耗时最长的子节点路径
 */
export function assembleSpanTree(spans: AiTraceSpan[]): AiTraceSpanTree {
  if (spans.length === 0) {
    return {
      trace_id: '',
      roots: [],
      flat_spans: [],
      critical_path_span_ids: [],
      total_spans: 0,
      total_duration_ms: 0,
      total_estimated_cost: 0,
      orphan_count: 0,
    }
  }

  // 排序：started_at 升序，同时间按 span_id 字典序（确定性）
  const sorted = [...spans].sort((a, b) => {
    const timeCmp = a.started_at.localeCompare(b.started_at)
    if (timeCmp !== 0) return timeCmp
    return a.span_id.localeCompare(b.span_id)
  })

  const trace_id = sorted[0]?.trace_id ?? ''

  // 构建 span_id → span 映射
  const spanMap = new Map<string, AiTraceSpan>()
  for (const span of sorted) {
    spanMap.set(span.span_id, span)
  }

  // 构建 parent_span_id → children 映射
  const childrenMap = new Map<string | null, AiTraceSpan[]>()
  const orphans: AiTraceSpan[] = []

  for (const span of sorted) {
    // Root: parent_span_id is null or references a non-existent span
    const isRoot = span.parent_span_id === null || !spanMap.has(span.parent_span_id)
    if (isRoot) {
      // Only count as orphan if explicitly marked as orphan
      if (span.is_orphan) {
        orphans.push(span)
      }
      const nullChildren = childrenMap.get(null) ?? []
      nullChildren.push(span)
      childrenMap.set(null, nullChildren)
    } else {
      const parentChildren = childrenMap.get(span.parent_span_id) ?? []
      parentChildren.push(span)
      childrenMap.set(span.parent_span_id, parentChildren)
    }
  }

  // 递归构建树节点
  function buildNode(span: AiTraceSpan): AiTraceSpanTreeNode {
    const childSpans = childrenMap.get(span.span_id) ?? []
    return {
      span,
      children: childSpans.map(buildNode),
    }
  }

  // 构建根节点列表
  const rootSpans = childrenMap.get(null) ?? []
  const roots = rootSpans.map(buildNode)

  // 计算总耗时
  const rootSpansWithDuration = sorted.filter((s) => s.duration_ms !== null && !s.is_orphan)
  const total_duration_ms =
    rootSpansWithDuration.length > 0
      ? Math.max(...rootSpansWithDuration.map((s) => s.duration_ms!))
      : 0

  // 计算总成本
  const total_estimated_cost = sorted.reduce((sum, s) => sum + (s.estimated_cost ?? 0), 0)

  // 关键路径：从根开始递归选择最长路径
  function findCriticalPath(node: AiTraceSpanTreeNode): string[] {
    if (node.children.length === 0) {
      return [node.span.span_id]
    }
    let maxChildPath: string[] = []
    let maxChildDuration = -1
    for (const child of node.children) {
      const childPath = findCriticalPath(child)
      const childDuration = child.span.duration_ms ?? 0
      if (childDuration > maxChildDuration) {
        maxChildDuration = childDuration
        maxChildPath = childPath
      }
    }
    return [node.span.span_id, ...maxChildPath]
  }

  // 选择最长的根路径
  let criticalPathSpanIds: string[] = []
  let maxRootDuration = -1
  for (const root of roots) {
    const rootPath = findCriticalPath(root)
    const rootDuration = root.span.duration_ms ?? 0
    if (rootDuration > maxRootDuration) {
      maxRootDuration = rootDuration
      criticalPathSpanIds = rootPath
    }
  }

  return {
    trace_id,
    roots,
    flat_spans: sorted,
    critical_path_span_ids: criticalPathSpanIds,
    total_spans: sorted.length,
    total_duration_ms,
    total_estimated_cost,
    orphan_count: orphans.length,
  }
}

// ---------------------------------------------------------------------------
// §10 时间账平容差
// ---------------------------------------------------------------------------

/**
 * 时间账平容差（毫秒）。
 * 子 span 耗时加自耗时须在父 span 耗时 ± 容差内。
 *
 * 取值依据：
 * - SQLite/Luxon 时钟精度为毫秒级
 * - 异步调度可能引入 ≤5ms 抖动
 * - 上下文传播有微小开销
 *
 * 容差 = max(父 span 耗时 × 5%, 10ms)
 */
export const DURATION_ACCOUNTING_TOLERANCE_MS = 10

/**
 * 计算时间账平容差阈值。
 * @param parentDurationMs 父 span 耗时
 * @returns 允许的最大偏差
 */
export function durationAccountingToleranceMs(parentDurationMs: number): number {
  return Math.max(parentDurationMs * 0.05, DURATION_ACCOUNTING_TOLERANCE_MS)
}

// ---------------------------------------------------------------------------
// §11 追踪失败降级语义常量
// ---------------------------------------------------------------------------

/**
 * 追踪失败降级规则。
 *
 * 与预算/限流的失败姿态**恰好相反**：
 * - 追踪是纯观测 → 写入失败可降级
 * - 预算/限流是业务决策 → 判定不可用禁止默认放行
 *
 * 这两条规则并存不矛盾，但必须分别写清。
 */
export const TRACING_DEGRADATION_RULES = {
  /** 追踪写入失败时的降级行为 */
  onSpanWriteFailure: 'degrade_silently' as const,
  /** 追踪查询失败时的降级行为 */
  onQueryFailure: 'return_error_without_affected_data' as const,
  /** 追踪失败时的业务影响 */
  businessImpact: 'none' as const,
  /** 追踪失败时的业务状态变更 */
  terminalStateChange: 'forbidden' as const,
} as const

// ---------------------------------------------------------------------------
// §12 span 状态守卫
// ---------------------------------------------------------------------------

/** 类型守卫：判断 span 记录结构是否合法。 */
export function isValidAiTraceSpan(span: unknown): span is AiTraceSpan {
  if (!span || typeof span !== 'object') return false
  const s = span as Record<string, unknown>
  return (
    typeof s.span_id === 'string' &&
    typeof s.trace_id === 'string' &&
    (s.parent_span_id === null || typeof s.parent_span_id === 'string') &&
    isSpanType(s.span_type) &&
    typeof s.started_at === 'string' &&
    (s.ended_at === null || typeof s.ended_at === 'string') &&
    (s.duration_ms === null || typeof s.duration_ms === 'number') &&
    isSpanStatus(s.status) &&
    typeof s.organization_id === 'number' &&
    typeof s.is_orphan === 'boolean'
  )
}
