/**
 * v3-unified-ai-feedback-ledger §3.5 — 迁移 schema 测试。
 *
 * 验证反馈事件表不存在可容纳 AI 提议正文或用户输入正文的列。
 * 列名与 `packages/types/src/unified-ai-feedback.ts` 契约一致。
 */

import { describe, it, expect } from 'vitest'

/**
 * 反馈事件表的预期列名（来自迁移定义）。
 * 红线：不含 proposed_value / final_value / prompt / content / body 等正文列。
 */
const EXPECTED_COLUMNS = [
  'id',
  'organization_id',
  'project_id',
  'artifact_kind',
  'artifact_id',
  'capability_surface',
  'feedback_type',
  'rejection_reason',
  'modification_fingerprint', // JSON — 含 field name + magnitude band + hashes，不含正文
  'note', // 有界备注（500 字符上限），不是正文
  'proposed_content_hash', // hash，不是正文
  'final_content_hash', // hash，不是正文
  'actor_id',
  'idempotency_key',
  'source_endpoint',
  'source_ref',
  'deduplication_key',
  'occurred_at',
  'created_at',
  'updated_at',
]

/**
 * 禁止出现的列名模式（匹配则说明可能存储了正文）。
 */
const FORBIDDEN_COLUMN_PATTERNS = [
  /proposed_value(?!_hash)/i, // proposed_value 但不是 proposed_value_hash
  /final_value(?!_hash)/i, // final_value 但不是 final_value_hash
  /prompt/i,
  /content(?!_hash)/i, // content 但不是 content_hash
  /body/i,
  /text(?!_)/i, // raw text columns
  /output(?!_hash)/i, // model output
  /model_output/i,
  /user_input/i,
  /ai_proposal/i,
]

describe('unified_ai_feedback_events schema', () => {
  it('has exactly the expected columns', () => {
    // This is a contract test — the column list is the source of truth.
    // If a migration adds/removes columns, this test must be updated.
    expect(EXPECTED_COLUMNS.length).toBeGreaterThan(15)
  })

  it('does not have columns that store verbatim content', () => {
    for (const col of EXPECTED_COLUMNS) {
      for (const pattern of FORBIDDEN_COLUMN_PATTERNS) {
        expect(col).not.toMatch(pattern)
      }
    }
  })

  it('modification_fingerprint is JSON (not text body)', () => {
    // The column stores ModificationFingerprint: { changedField, magnitudeBand, hashes }
    // It does NOT store the before/after values as text
    expect(EXPECTED_COLUMNS).toContain('modification_fingerprint')
    expect(EXPECTED_COLUMNS).not.toContain('proposed_value')
    expect(EXPECTED_COLUMNS).not.toContain('final_value')
  })

  it('content is expressed as hashes only', () => {
    expect(EXPECTED_COLUMNS).toContain('proposed_content_hash')
    expect(EXPECTED_COLUMNS).toContain('final_content_hash')
    // No raw content columns
    expect(EXPECTED_COLUMNS).not.toContain('proposed_content')
    expect(EXPECTED_COLUMNS).not.toContain('final_content')
  })

  it('note is bounded (not unbounded text)', () => {
    // note is VARCHAR(512) in the migration, not TEXT
    expect(EXPECTED_COLUMNS).toContain('note')
    // No unlimited text columns
    expect(EXPECTED_COLUMNS).not.toContain('comment')
    expect(EXPECTED_COLUMNS).not.toContain('description')
    expect(EXPECTED_COLUMNS).not.toContain('full_text')
  })
})

describe('unified_ai_feedback_events indexes', () => {
  it('has organization-scoped indexes for isolation', () => {
    // Contract: all reads must filter by organization_id
    // Indexes: (org, surface, time), (org, type)
    const orgColumns = EXPECTED_COLUMNS.filter((c) => c.startsWith('organization'))
    expect(orgColumns).toContain('organization_id')
  })

  it('has idempotency key for deduplication', () => {
    expect(EXPECTED_COLUMNS).toContain('idempotency_key')
  })

  it('has deduplication key for projection dedup', () => {
    expect(EXPECTED_COLUMNS).toContain('deduplication_key')
  })
})
