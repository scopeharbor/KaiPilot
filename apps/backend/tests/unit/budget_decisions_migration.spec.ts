/**
 * v3-unified-ai-budget-and-quota §3.6 — 迁移测试。
 *
 * 验证 budget_decisions 表不存在可容纳 prompt 或模型输出的列。
 * 低敏红线：不存 prompt、模型输出、原始载荷、token、secret、Authorization。
 */

import { describe, it, expect } from 'vitest'

/**
 * 从迁移文件中提取列定义，验证不含敏感列。
 * 这是静态分析测试——不实际运行迁移，只检查迁移文件内容。
 */
describe('§3.6 budget_decisions migration low-sensitivity', () => {
  const FORBIDDEN_COLUMN_PATTERNS = [
    /prompt/i,
    /completion/i,
    /output.*text/i,
    /model.*output/i,
    /system.*instruction/i,
    /message.*content/i,
    /tool.*argument/i,
    /tool.*result/i,
    /retrieval.*body/i,
    /provider.*payload/i,
    /raw.*body/i,
    /api.*key/i,
    /authorization/i,
    /secret/i,
    /password/i,
    /token(?!s)/i, // 匹配 "token" 但不匹配 "tokens"（token 计数是低敏的）
  ]

  it('budget_decisions migration contains no forbidden columns', async () => {
    // Read the migration file
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migrationPath = path.resolve(
      process.cwd(),
      'apps/backend/database/migrations/1842000000000_create_budget_decisions_table.ts',
    )

    // If running from backend dir, adjust path
    const altPath = path.resolve(
      process.cwd(),
      'database/migrations/1842000000000_create_budget_decisions_table.ts',
    )

    const filePath = fs.existsSync(migrationPath) ? migrationPath : altPath
    const content = fs.readFileSync(filePath, 'utf-8')

    // Extract column definitions (table.string(...), table.integer(...), etc.)
    const columnPattern = /table\.\w+\(['"](\w+)['"]/g
    let match
    const columns: string[] = []
    while ((match = columnPattern.exec(content)) !== null) {
      columns.push(match[1]!)
    }

    // Verify no forbidden columns exist
    const forbiddenColumns = columns.filter((col) =>
      FORBIDDEN_COLUMN_PATTERNS.some((pattern) => pattern.test(col)),
    )

    // Token count columns (accumulated_tokens, estimated_tokens, actual_tokens) are allowed
    const allowedExceptions = ['accumulated_tokens', 'estimated_tokens', 'actual_tokens']

    const realViolations = forbiddenColumns.filter((col) => !allowedExceptions.includes(col))

    expect(realViolations).toEqual([])
    expect(columns.length).toBeGreaterThan(0) // Sanity: migration has columns
  })

  it('budget_decisions has organization_id for isolation', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migrationPath = path.resolve(
      process.cwd(),
      'apps/backend/database/migrations/1842000000000_create_budget_decisions_table.ts',
    )
    const altPath = path.resolve(
      process.cwd(),
      'database/migrations/1842000000000_create_budget_decisions_table.ts',
    )
    const filePath = fs.existsSync(migrationPath) ? migrationPath : altPath
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('organization_id')
  })

  it('budget_decisions has idempotency_key unique constraint', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migrationPath = path.resolve(
      process.cwd(),
      'apps/backend/database/migrations/1842000000000_create_budget_decisions_table.ts',
    )
    const altPath = path.resolve(
      process.cwd(),
      'database/migrations/1842000000000_create_budget_decisions_table.ts',
    )
    const filePath = fs.existsSync(migrationPath) ? migrationPath : altPath
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('idempotency_key')
    expect(content).toContain('unique')
  })
})
