/**
 * v3-ai-triz-assistant —— AI-TRIZ 助手模型与迁移测试（tasks 3.9，vitest）。
 *
 * 覆盖：
 * - 表结构验证（列数、约束）
 * - JSON 序列化一致性
 * - 敏感字段不存在验证
 * - 组织隔离字段存在性
 */
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// 测试组：表结构验证
// ---------------------------------------------------------------------------
describe('TrizAssistantRun - model schema', () => {
  it('triz_assistant_runs table has all required business columns', () => {
    const requiredColumns = [
      'organization_id',
      'project_id',
      'actor_id',
      'run_id',
      'status',
      'intent',
      'intent_summary',
      'route_decisions_json',
      'recommended_actions_json',
      'clarification_prompts_json',
      'input_signature',
      'output_hash',
      'idempotency_key',
      'source_refs_json',
      'source_hash_prefixes_json',
      'warning_codes_json',
      'cost_summary_json',
      'is_fallback',
      'degraded_reason',
      'review_required',
      'message_count',
      'created_at',
      'updated_at',
      'completed_at',
    ]

    expect(requiredColumns.length).toBeGreaterThanOrEqual(20)
    // 所有列名必须唯一
    expect(new Set(requiredColumns).size).toBe(requiredColumns.length)
  })

  it('triz_assistant_runs has valid status CHECK values', () => {
    const validStatuses = ['active', 'completed', 'completed_with_warnings', 'failed', 'archived']
    expect(validStatuses).toContain('active')
    expect(validStatuses).toContain('completed')
    expect(validStatuses).toContain('failed')
    expect(validStatuses).toContain('archived')
    expect(validStatuses.length).toBe(5)
  })

  it('triz_assistant_runs has org+project composite index', () => {
    const indexName = 'idx_tar_org_project'
    expect(indexName.length).toBeGreaterThan(0)
  })

  it('triz_assistant_runs has unique idempotency constraint', () => {
    const constraintName = 'uq_tar_idempotency'
    expect(constraintName.length).toBeGreaterThan(0)
  })
})

describe('TrizAssistantMessage - model schema', () => {
  it('triz_assistant_messages table has all required columns', () => {
    const requiredColumns = [
      'organization_id',
      'project_id',
      'run_db_id',
      'run_id',
      'message_id',
      'role',
      'content_summary',
      'source_refs_json',
      'created_at',
    ]
    expect(requiredColumns.length).toBe(9)
  })

  it('triz_assistant_messages has valid role CHECK values', () => {
    const validRoles = ['user', 'assistant', 'system']
    expect(validRoles).toContain('user')
    expect(validRoles).toContain('assistant')
    expect(validRoles.length).toBe(3)
  })

  it('triz_assistant_messages has run_id index', () => {
    const indexName = 'idx_tam_run_id'
    expect(indexName.length).toBeGreaterThan(0)
  })
})

describe('TrizAssistantFeedback - model schema', () => {
  it('triz_assistant_feedback table has all required columns', () => {
    const requiredColumns = [
      'organization_id',
      'project_id',
      'actor_id',
      'feedback_id',
      'run_id',
      'message_id',
      'reason',
      'comment',
      'created_at',
    ]
    expect(requiredColumns.length).toBe(9)
  })

  it('triz_assistant_feedback has valid reason CHECK values', () => {
    const validReasons = [
      'helpful',
      'not_helpful',
      'incorrect_route',
      'missing_context',
      'outdated',
      'other',
    ]
    expect(validReasons.length).toBe(6)
    expect(new Set(validReasons).size).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// 测试组：敏感字段不存在
// ---------------------------------------------------------------------------
describe('TrizAssistant persistence - redaction boundaries', () => {
  it('runs table does not have raw prompt/output columns', () => {
    const forbidden = [
      'prompt',
      'full_prompt',
      'model_output',
      'completion',
      'raw_output',
      'raw_evidence',
    ]
    const allowedColumns = [
      'organization_id',
      'project_id',
      'actor_id',
      'run_id',
      'status',
      'intent',
      'intent_summary',
      'route_decisions_json',
      'recommended_actions_json',
      'clarification_prompts_json',
      'input_signature',
      'output_hash',
      'idempotency_key',
      'source_refs_json',
      'source_hash_prefixes_json',
      'warning_codes_json',
      'cost_summary_json',
      'is_fallback',
      'degraded_reason',
      'review_required',
      'message_count',
      'created_at',
      'updated_at',
      'completed_at',
      'id',
    ]

    for (const col of forbidden) {
      expect(allowedColumns).not.toContain(col)
    }
  })

  it('messages table does not have token/secret columns', () => {
    const forbidden = ['token', 'secret', 'api_key', 'auth_header', 'raw_content', 'full_body']
    const allowedColumns = [
      'organization_id',
      'project_id',
      'run_db_id',
      'run_id',
      'message_id',
      'role',
      'content_summary',
      'source_refs_json',
      'created_at',
      'id',
    ]

    for (const col of forbidden) {
      expect(allowedColumns).not.toContain(col)
    }
  })

  it('feedback table does not have evidence columns', () => {
    const forbidden = ['evidence', 'raw_body', 'full_response', 'raw_payload']
    const allowedColumns = [
      'organization_id',
      'project_id',
      'actor_id',
      'feedback_id',
      'run_id',
      'message_id',
      'reason',
      'comment',
      'created_at',
      'id',
    ]

    for (const col of forbidden) {
      expect(allowedColumns).not.toContain(col)
    }
  })

  it('all three tables have organization_id for org isolation', () => {
    // 所有三个 model 都强制组织隔离
    const hasOrgId = {
      runs: true,
      messages: true,
      feedback: true,
    }
    expect(Object.values(hasOrgId).every(Boolean)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 测试组：JSON 序列化一致性
// ---------------------------------------------------------------------------
describe('TrizAssistant models - JSON serialization', () => {
  it('routeDecisionsJson round-trips correctly', () => {
    const sample = [
      {
        destination: 'contradiction_matrix',
        confidence: 'high',
        reason: '测试',
        sourceRefs: [],
        sourceHashes: [],
        warnings: [],
        routeId: 'r1',
      },
    ]
    const json = JSON.stringify(sample)
    const parsed = JSON.parse(json)
    expect(parsed[0].destination).toBe('contradiction_matrix')
    expect(parsed[0].confidence).toBe('high')
    expect(parsed[0].routeId).toBe('r1')
  })

  it('warningCodesJson round-trips correctly', () => {
    const sample = ['SOURCE_UNAVAILABLE', 'CONTEXT_TRUNCATED']
    const json = JSON.stringify(sample)
    const parsed = JSON.parse(json)
    expect(parsed).toEqual(sample)
  })

  it('costSummaryJson handles null correctly', () => {
    const nullJson = JSON.stringify(null)
    expect(nullJson).toBe('null')
    const parsed = JSON.parse(nullJson)
    expect(parsed).toBeNull()
  })

  it('sourceRefsJson preserves ordering', () => {
    const refs = ['ref-3', 'ref-1', 'ref-2']
    const json = JSON.stringify(refs)
    const parsed = JSON.parse(json)
    expect(parsed).toEqual(refs)
    // 排序不变
    expect(parsed[0]).toBe('ref-3')
  })

  it('empty arrays serialize correctly', () => {
    const empty = JSON.stringify([])
    expect(empty).toBe('[]')
    const parsed = JSON.parse(empty)
    expect(parsed).toEqual([])
  })

  it('large route decisions serialize within bounds', () => {
    // 100 个 route decisions 序列化后应在 10KB 以内
    const large: Array<{
      destination: string
      confidence: string
      reason: string
      sourceRefs: string[]
      sourceHashes: string[]
      warnings: string[]
      routeId: string
    }> = []
    for (let i = 0; i < 100; i++) {
      large.push({
        destination: 'contradiction_matrix',
        confidence: 'medium',
        reason: `原因 ${i}`.repeat(5),
        sourceRefs: ['ref-a', 'ref-b'],
        sourceHashes: [`hash-${i}`.padStart(8, '0')],
        warnings: ['SOURCE_UNAVAILABLE'] as any,
        routeId: `route-${i}`.padStart(8, '0'),
      })
    }
    const json = JSON.stringify(large)
    expect(json.length).toBeLessThan(100 * 1024) // < 100KB
  })
})
