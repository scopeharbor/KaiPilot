/**
 * v3-global-ai-rate-limiting §3.5 — 迁移测试。
 *
 * 验证 `rate_limit_decisions` 表不存在可容纳 prompt 或模型输出的列，
 * 且必备的归属/窗口/限额/计数/结果列齐备。
 *
 * 本文件原为占位（用 `test.describe` 非 japa API、导入不存在的
 * `#tests/helpers/db_isolation`、调用 `expect` 却未导入、在测试里现场
 * `createTable` 空表），由 v3-copilot-live-submission-channel 用真断言重写。
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { setupTest } from '#tests/helpers/index'

/** 可容纳 prompt / 模型输出 / 凭据的列名（命中即违反低敏红线）。 */
const FORBIDDEN_COLUMNS = [
  'prompt',
  'system_instruction',
  'system_instructions',
  'completion',
  'messages',
  'tool_arguments',
  'tool_results',
  'retrieval_body',
  'provider_payload',
  'api_key',
  'authorization',
  'token',
  'secret',
  'output_text',
  'response_text',
  'model_output',
  'input_text',
  'content',
  'text',
  'body',
  'payload',
] as const

/** 决策记录必备列（缺一即无法解释一次限流裁决）。 */
const REQUIRED_COLUMNS = [
  'organization_id',
  'connection_id',
  'model_id',
  'actor_id',
  'window_start',
  'window_end',
  'dimension',
  'layer',
  'limit',
  'current_count',
  'estimated_delta',
  'decision',
  'retry_after_seconds',
  'triggering_layer',
  'idempotency_key',
] as const

async function listColumns(table: string): Promise<string[]> {
  const rows = await db.rawQuery(`PRAGMA table_info(${table})`)
  return (rows as { name: string }[]).map((row) => row.name)
}

test.group('rate_limit_decisions 迁移（低敏形状）', (group) => {
  group.each.setup(async () => {
    await setupTest()
  })

  test('表已建立', async ({ assert }) => {
    const columns = await listColumns('rate_limit_decisions')
    assert.isAbove(columns.length, 0)
  })

  test('不含任何可容纳 prompt 或模型输出的列', async ({ assert }) => {
    const columns = await listColumns('rate_limit_decisions')
    for (const forbidden of FORBIDDEN_COLUMNS) {
      assert.notInclude(columns, forbidden, `列 ${forbidden} 违反低敏红线`)
    }
  })

  test('必备的归属、窗口、限额、计数与结果列齐备', async ({ assert }) => {
    const columns = await listColumns('rate_limit_decisions')
    for (const required of REQUIRED_COLUMNS) {
      assert.include(columns, required, `缺列 ${required}`)
    }
  })

  test('组织归属列不可空（组织隔离前提）', async ({ assert }) => {
    const rows = await db.rawQuery('PRAGMA table_info(rate_limit_decisions)')
    const orgColumn = (rows as { name: string; notnull: number }[]).find(
      (row) => row.name === 'organization_id',
    )
    assert.isDefined(orgColumn)
    assert.equal(orgColumn!.notnull, 1)
  })

  test('幂等键列存在且不可空（重放不重复落账的前提）', async ({ assert }) => {
    const rows = await db.rawQuery('PRAGMA table_info(rate_limit_decisions)')
    const keyColumn = (rows as { name: string; notnull: number }[]).find(
      (row) => row.name === 'idempotency_key',
    )
    assert.isDefined(keyColumn)
    assert.equal(keyColumn!.notnull, 1)
  })
})
