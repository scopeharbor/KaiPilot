/**
 * v3-ai-request-tracing —— 契约测试。
 *
 * 验证：
 * - span 类型与账本 operation 取值一致
 * - span 树装配确定性
 * - 关键路径识别
 * - 孤儿标记
 * - sanitizer 禁止内容检测
 * - 时间账平容差
 * - fixtures 一致性
 */

import { describe, it, expect } from 'vitest'
import {
  SPAN_TYPES,
  SPAN_STATUSES,
  ORPHAN_BREAK_REASONS,
  isSpanType,
  isSpanStatus,
  isOrphanBreakReason,
  type AiTraceSpan,
  assembleSpanTree,
  durationAccountingToleranceMs,
  DURATION_ACCOUNTING_TOLERANCE_MS,
  spanDetectForbiddenKeys,
  spanHasForbiddenKeys,
  sanitizeSpanMetadata,
  isValidAiTraceSpan,
} from './ai-request-tracing.js'
import {
  LEDGER_OPERATION_NAMES,
  LEDGER_FORBIDDEN_KEY_CATEGORIES,
} from './unified-ai-invocation-ledger.js'
import {
  singleHopTraceSpans,
  multiHopTraceSpans,
  nonModelSpanTraceSpans,
  orphanSpanTraceSpans,
  brokenLinkTraceSpans,
  refusedHopTraceSpans,
  sessionAggregationFixture,
  workflowAggregationFixture,
} from './ai-request-tracing-fixtures.js'

// ---------------------------------------------------------------------------
// §1 span 类型与账本 operation 一致性
// ---------------------------------------------------------------------------

describe('span types match ledger operations', () => {
  it('SPAN_TYPES contains exactly LEDGER_OPERATION_NAMES', () => {
    expect([...SPAN_TYPES]).toEqual([...LEDGER_OPERATION_NAMES])
  })

  it('span type count matches ledger operation count', () => {
    expect(SPAN_TYPES.length).toBe(LEDGER_OPERATION_NAMES.length)
  })

  it('every span type is a valid ledger operation name', () => {
    for (const spanType of SPAN_TYPES) {
      expect(isSpanType(spanType)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// §2 类型守卫
// ---------------------------------------------------------------------------

describe('type guards', () => {
  it('isSpanType accepts valid types', () => {
    expect(isSpanType('chat')).toBe(true)
    expect(isSpanType('retrieval')).toBe(true)
    expect(isSpanType('execute_tool')).toBe(true)
  })

  it('isSpanType rejects invalid types', () => {
    expect(isSpanType('search')).toBe(false)
    expect(isSpanType('')).toBe(false)
    expect(isSpanType(123)).toBe(false)
  })

  it('isSpanStatus accepts valid statuses', () => {
    expect(isSpanStatus('ok')).toBe(true)
    expect(isSpanStatus('error')).toBe(true)
    expect(isSpanStatus('orphaned')).toBe(true)
  })

  it('isSpanStatus rejects invalid statuses', () => {
    expect(isSpanStatus('success')).toBe(false)
  })

  it('isOrphanBreakReason accepts valid reasons', () => {
    expect(isOrphanBreakReason('parent_not_found')).toBe(true)
    expect(isOrphanBreakReason('cross_service_boundary')).toBe(true)
  })

  it('isOrphanBreakReason rejects invalid reasons', () => {
    expect(isOrphanBreakReason('lost')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §3 span 树装配 —— 确定性
// ---------------------------------------------------------------------------

describe('assembleSpanTree', () => {
  it('deterministic: same spans produce same tree structure', () => {
    const spans = multiHopTraceSpans()
    const tree1 = assembleSpanTree(spans)
    const tree2 = assembleSpanTree(spans)
    expect(tree1.roots.length).toBe(tree2.roots.length)
    expect(tree1.critical_path_span_ids).toEqual(tree2.critical_path_span_ids)
    expect(tree1.total_spans).toBe(tree2.total_spans)
  })

  it('single hop: one root, no children', () => {
    const tree = assembleSpanTree(singleHopTraceSpans())
    expect(tree.roots.length).toBe(1)
    expect(tree.roots[0]!.children.length).toBe(0)
    expect(tree.total_spans).toBe(1)
    expect(tree.orphan_count).toBe(0)
  })

  it('multi hop: correct parent-child relationships', () => {
    const tree = assembleSpanTree(multiHopTraceSpans())
    expect(tree.total_spans).toBe(5)
    expect(tree.roots.length).toBe(1)
    const root = tree.roots[0]!
    expect(root.span.span_id).toBe('span-multi-001')
    expect(root.children.length).toBe(3)
    // 检索子节点
    const retrievalChild = root.children.find((c) => c.span.span_id === 'span-multi-002')
    expect(retrievalChild).toBeDefined()
    // 工具调用挂在模型调用下
    const chatChild = root.children.find((c) => c.span.span_id === 'span-multi-003')
    expect(chatChild).toBeDefined()
    expect(chatChild!.children.length).toBe(1)
    expect(chatChild!.children[0]!.span.span_id).toBe('span-multi-004')
  })

  it('non-model spans are included in tree', () => {
    const tree = assembleSpanTree(nonModelSpanTraceSpans())
    expect(tree.total_spans).toBe(4)
    // 所有子 span 都在根下
    const root = tree.roots[0]!
    expect(root.children.length).toBe(3)
  })

  it('orphan spans are marked as roots with is_orphan=true', () => {
    const tree = assembleSpanTree(orphanSpanTraceSpans())
    expect(tree.orphan_count).toBe(1)
    const orphan = tree.flat_spans.find((s) => s.is_orphan)
    expect(orphan).toBeDefined()
    expect(orphan!.orphan_break_reason).toBe('parent_not_found')
    // 孤儿作为根节点
    expect(tree.roots.length).toBe(2)
  })

  it('broken link spans are marked as orphans', () => {
    const tree = assembleSpanTree(brokenLinkTraceSpans())
    expect(tree.orphan_count).toBe(1)
    const brokenSpan = tree.flat_spans.find((s) => s.span_id === 'span-broken-002')
    expect(brokenSpan).toBeDefined()
    expect(brokenSpan!.is_orphan).toBe(true)
    expect(brokenSpan!.orphan_break_reason).toBe('cross_service_boundary')
  })

  it('refused hops are visible in tree', () => {
    const tree = assembleSpanTree(refusedHopTraceSpans())
    expect(tree.total_spans).toBe(3)
    const refusedSpans = tree.flat_spans.filter((s) => s.status === 'cancelled')
    expect(refusedSpans.length).toBe(2)
    // 被拒 span 有 error_kind
    expect(refusedSpans[0]!.error_kind).toBe('capability_mismatch')
    expect(refusedSpans[1]!.error_kind).toBe('provider_rate_limit')
  })

  it('critical path identifies longest chain', () => {
    const tree = assembleSpanTree(multiHopTraceSpans())
    expect(tree.critical_path_span_ids.length).toBeGreaterThan(0)
    // 关键路径应该从根开始
    expect(tree.critical_path_span_ids[0]).toBe('span-multi-001')
  })

  it('empty spans produce empty tree', () => {
    const tree = assembleSpanTree([])
    expect(tree.roots.length).toBe(0)
    expect(tree.total_spans).toBe(0)
    expect(tree.critical_path_span_ids.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §4 时间账平容差
// ---------------------------------------------------------------------------

describe('duration accounting tolerance', () => {
  it('tolerance is at least 10ms', () => {
    expect(DURATION_ACCOUNTING_TOLERANCE_MS).toBeGreaterThanOrEqual(10)
  })

  it('tolerance scales with parent duration (5%)', () => {
    expect(durationAccountingToleranceMs(1000)).toBe(50) // 5% of 1000 = 50
    expect(durationAccountingToleranceMs(10000)).toBe(500) // 5% of 10000 = 500
  })

  it('tolerance has minimum of 10ms', () => {
    expect(durationAccountingToleranceMs(100)).toBe(10) // 5% of 100 = 5, min 10
    expect(durationAccountingToleranceMs(50)).toBe(10) // 5% of 50 = 2.5, min 10
  })
})

// ---------------------------------------------------------------------------
// §5 sanitizer 禁止内容检测
// ---------------------------------------------------------------------------

describe('span sanitizer', () => {
  it('detects prompt content', () => {
    const detected = spanDetectForbiddenKeys({ promptText: 'hello' })
    expect(detected).toContain('prompt')
  })

  it('detects tool arguments', () => {
    const detected = spanDetectForbiddenKeys({ toolArgs: { query: 'test' } })
    expect(detected).toContain('tool_arguments')
  })

  it('detects tool results', () => {
    const detected = spanDetectForbiddenKeys({ toolResult: 'data' })
    expect(detected).toContain('tool_results')
  })

  it('detects retrieval body', () => {
    const detected = spanDetectForbiddenKeys({ retrievalBody: 'document' })
    expect(detected).toContain('retrieval_body')
  })

  it('detects model output', () => {
    const detected = spanDetectForbiddenKeys({ completion: 'response' })
    expect(detected).toContain('completion')
  })

  it('detects api key', () => {
    const detected = spanDetectForbiddenKeys({ apiKey: 'sk-xxx' })
    expect(detected).toContain('api_key')
  })

  it('detects authorization header', () => {
    const detected = spanDetectForbiddenKeys({ authorization: 'Bearer xxx' })
    expect(detected).toContain('authorization')
  })

  it('detects token', () => {
    const detected = spanDetectForbiddenKeys({ token: 'abc' })
    expect(detected).toContain('token')
  })

  it('detects secret', () => {
    const detected = spanDetectForbiddenKeys({ secret: 'password' })
    expect(detected).toContain('secret')
  })

  it('returns empty for clean input', () => {
    const detected = spanDetectForbiddenKeys({ ref: 'abc', hash: 'def', count: 5 })
    expect(detected.length).toBe(0)
  })

  it('returns empty for null/undefined', () => {
    expect(spanDetectForbiddenKeys(null).length).toBe(0)
    expect(spanDetectForbiddenKeys(undefined).length).toBe(0)
  })

  it('spanHasForbiddenKeys returns boolean', () => {
    expect(spanHasForbiddenKeys({ promptText: 'hi' })).toBe(true)
    expect(spanHasForbiddenKeys({ ref: 'abc' })).toBe(false)
  })

  it('sanitizeSpanMetadata keeps only allowlisted keys', () => {
    const result = sanitizeSpanMetadata({
      ref: 'abc',
      hash: 'def',
      secret: 'should-not-survive',
      count: 42,
    })
    expect(result).toEqual({ ref: 'abc', hash: 'def' })
  })

  it('sanitizeSpanMetadata returns null for empty result', () => {
    expect(sanitizeSpanMetadata({ secret: 'only' })).toBeNull()
  })

  it('sanitizeSpanMetadata returns null for null input', () => {
    expect(sanitizeSpanMetadata(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §6 isValidAiTraceSpan
// ---------------------------------------------------------------------------

describe('isValidAiTraceSpan', () => {
  it('validates correct span', () => {
    const spans = singleHopTraceSpans()
    expect(isValidAiTraceSpan(spans[0])).toBe(true)
  })

  it('rejects missing span_id', () => {
    const span = { ...singleHopTraceSpans()[0]!, span_id: undefined }
    expect(isValidAiTraceSpan(span)).toBe(false)
  })

  it('rejects invalid span_type', () => {
    const span = { ...singleHopTraceSpans()[0]!, span_type: 'invalid' }
    expect(isValidAiTraceSpan(span)).toBe(false)
  })

  it('rejects invalid status', () => {
    const span = { ...singleHopTraceSpans()[0]!, status: 'success' }
    expect(isValidAiTraceSpan(span)).toBe(false)
  })

  it('rejects null input', () => {
    expect(isValidAiTraceSpan(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §7 Fixtures 一致性
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  it('single hop has one span', () => {
    expect(singleHopTraceSpans().length).toBe(1)
  })

  it('multi hop has five spans', () => {
    expect(multiHopTraceSpans().length).toBe(5)
  })

  it('non-model span fixture has four spans', () => {
    expect(nonModelSpanTraceSpans().length).toBe(4)
  })

  it('orphan span fixture has orphaned span', () => {
    const spans = orphanSpanTraceSpans()
    expect(spans.some((s) => s.is_orphan)).toBe(true)
  })

  it('broken link fixture has orphan with cross_service_boundary reason', () => {
    const spans = brokenLinkTraceSpans()
    const orphan = spans.find((s) => s.is_orphan)
    expect(orphan).toBeDefined()
    expect(orphan!.orphan_break_reason).toBe('cross_service_boundary')
  })

  it('refused hop fixture has cancelled spans', () => {
    const spans = refusedHopTraceSpans()
    expect(spans.filter((s) => s.status === 'cancelled').length).toBe(2)
  })

  it('session aggregation fixture has required fields', () => {
    const agg = sessionAggregationFixture()
    expect(agg.conversation_id).toBeTruthy()
    expect(agg.trace_count).toBeGreaterThan(0)
    expect(agg.total_duration_ms).toBeGreaterThan(0)
  })

  it('workflow aggregation fixture has required fields', () => {
    const agg = workflowAggregationFixture()
    expect(agg.workflow_name).toBeTruthy()
    expect(agg.trace_count).toBeGreaterThan(0)
    expect(agg.total_duration_ms).toBeGreaterThan(0)
  })

  it('all fixture spans are valid', () => {
    const allSpans = [
      ...singleHopTraceSpans(),
      ...multiHopTraceSpans(),
      ...nonModelSpanTraceSpans(),
      ...orphanSpanTraceSpans(),
      ...brokenLinkTraceSpans(),
      ...refusedHopTraceSpans(),
    ]
    for (const span of allSpans) {
      expect(isValidAiTraceSpan(span)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// §8 关键路径在已知树上正确
// ---------------------------------------------------------------------------

describe('critical path on known tree', () => {
  it('multi-hop tree critical path goes through longest chain', () => {
    const tree = assembleSpanTree(multiHopTraceSpans())
    // 根 (3000ms) → 模型调用 (1300ms) → 工具调用 (500ms) 是最长链
    expect(tree.critical_path_span_ids).toContain('span-multi-001')
    expect(tree.critical_path_span_ids).toContain('span-multi-003')
    expect(tree.critical_path_span_ids).toContain('span-multi-004')
  })

  it('non-model span trace critical path includes retrieval', () => {
    const tree = assembleSpanTree(nonModelSpanTraceSpans())
    // 根 (5000ms) → 检索 (1900ms) 是最长子链
    expect(tree.critical_path_span_ids).toContain('span-nm-001')
    expect(tree.critical_path_span_ids).toContain('span-nm-002')
  })
})

// ---------------------------------------------------------------------------
// §9 追踪失败降级语义
// ---------------------------------------------------------------------------

describe('tracing degradation rules', () => {
  it('span write failure degrades silently', async () => {
    const { TRACING_DEGRADATION_RULES } = await import('./ai-request-tracing.js')
    expect(TRACING_DEGRADATION_RULES.onSpanWriteFailure).toBe('degrade_silently')
    expect(TRACING_DEGRADATION_RULES.businessImpact).toBe('none')
    expect(TRACING_DEGRADATION_RULES.terminalStateChange).toBe('forbidden')
  })
})
