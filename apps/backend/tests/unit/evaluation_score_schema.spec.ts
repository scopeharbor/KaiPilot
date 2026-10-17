/**
 * v3-ai-automated-evaluation §3.5 — 评测表结构测试。
 *
 * 验证：
 * - explanation 有长度约束（VARCHAR 1024）
 * - 不存在可容纳被评正文的列（prompt / model output / tool results / retrieval body）
 * - 组织隔离索引存在
 * - 幂等键索引存在且唯一
 * - 被评对象引用索引存在
 *
 * @aiproj/backend tests — 零网络零 provider
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFile)

const MIGRATION_PATH = resolve(
  currentDir,
  '../../database/migrations/1840200000000_create_evaluation_scores_table.ts',
)

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf-8')
}

describe('evaluation_scores migration schema', () => {
  let migration: string

  beforeAll(() => {
    migration = readMigration()
  })

  it('explanation column has VARCHAR(1024) length constraint', () => {
    // SQLite: table.string('explanation', 1024)
    // PG: VARCHAR(1024)
    expect(migration).toMatch(/explanation.*1024/)
  })

  it('does NOT contain a prompt column', () => {
    // 禁止存放被评 prompt 正文的列
    const promptColumnPattern = /table\.\w+\(\s*['"]prompt['"]/
    expect(migration).not.toMatch(promptColumnPattern)
  })

  it('does NOT contain a model_output column', () => {
    const outputColumnPattern = /table\.\w+\(\s*['"]model_output['"]/
    expect(migration).not.toMatch(outputColumnPattern)
  })

  it('does NOT contain a tool_results column', () => {
    const toolResultsPattern = /table\.\w+\(\s*['"]tool_results['"]/
    expect(migration).not.toMatch(toolResultsPattern)
  })

  it('does NOT contain a retrieval_body column', () => {
    const retrievalPattern = /table\.\w+\(\s*['"]retrieval_body['"]/
    expect(migration).not.toMatch(retrievalPattern)
  })

  it('does NOT contain a content column capable of holding evaluated text', () => {
    // 通用 "content" 列不应用于存放被评正文
    const contentColumnPattern = /table\.\w+\(\s*['"]content['"]/
    expect(migration).not.toMatch(contentColumnPattern)
  })

  it('has organization_id column', () => {
    expect(migration).toMatch(/organization_id/)
  })

  it('has evaluation_name column (dimension)', () => {
    expect(migration).toMatch(/evaluation_name/)
  })

  it('has score_value column', () => {
    expect(migration).toMatch(/score_value/)
  })

  it('has score_label column', () => {
    expect(migration).toMatch(/score_label/)
  })

  it('has idempotency_key column', () => {
    expect(migration).toMatch(/idempotency_key/)
  })

  it('has organization + dimension + time index', () => {
    expect(migration).toMatch(/idx_evalscore_org_dim_created/)
  })

  it('has artifact reference index', () => {
    expect(migration).toMatch(/idx_evalscore_artifact_ref/)
  })

  it('has idempotency unique index', () => {
    // 唯一约束必须走 table.unique()——原实现写的 table.index(..., { unique: true })
    // 会被 Knex 忽略第三参，唯一性实际不会建立（v3-backend-type-debt-closure 已修）。
    expect(migration).toMatch(/uq_evalscore_idempotency/)
    expect(migration).toContain("table.unique(['idempotency_key']")
  })

  it('has organization isolation index', () => {
    expect(migration).toMatch(/idx_evalscore_organization/)
  })

  it('migration is drop-safe (has down method)', () => {
    expect(migration).toMatch(/async down\(\)/)
    expect(migration).toMatch(/dropTable/)
  })
})
