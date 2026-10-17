/**
 * v3-global-ai-rate-limiting §4.1–4.5 — 窗口计数器测试。
 *
 * 证明计数来源唯一（统一账本），窗口语义为 1 分钟滚动窗口，
 * 失败/中止 attempt 不计入，且不存在内存计数（重建实例后结果一致）。
 *
 * 本文件原为占位（0 断言、`test.describe` 非 japa API、导入不存在的
 * `#tests/helpers/db_isolation`），由 v3-copilot-live-submission-channel 用真断言重写。
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { RATE_LIMIT_WINDOW_MS } from '@aiproj/types'
import WindowCounter from '#services/rate_limiting/window_counter'
import { setupTest, createTestOrg } from '#tests/helpers/index'

interface LedgerRowOverrides {
  status?: string
  inputTokens?: number
  outputTokens?: number
  ageMs?: number
}

async function insertLedgerRow(
  organizationId: number,
  connectionId: number,
  modelId: number,
  overrides: LedgerRowOverrides = {},
) {
  const occurredAt = DateTime.now().minus({ milliseconds: overrides.ageMs ?? 0 })
  await db.table('unified_ai_invocation_ledger').insert({
    organization_id: organizationId,
    connection_id: connectionId,
    model_id: modelId,
    status: overrides.status ?? 'succeeded',
    usage_input_tokens: overrides.inputTokens ?? 100,
    usage_output_tokens: overrides.outputTokens ?? 50,
    occurred_at: occurredAt.toSQL(),
    created_at: occurredAt.toSQL(),
    updated_at: occurredAt.toSQL(),
  })
}

test.group('window_counter（统一账本为唯一计数来源）', (group) => {
  group.each.setup(async () => {
    await setupTest()
  })

  test('从统一账本推导 RPM 与 TPM', async ({ assert }) => {
    const org = await createTestOrg()
    await insertLedgerRow(org.id, 1, 1, { inputTokens: 100, outputTokens: 50 })
    await insertLedgerRow(org.id, 1, 1, { inputTokens: 200, outputTokens: 30 })

    const counts = await new WindowCounter().getCounts({
      organizationId: org.id,
      connectionId: 1,
      modelId: 1,
    })

    assert.equal(counts.rpm, 2)
    assert.equal(counts.tpm, 380)
  })

  test('窗口外的 attempt 不计入（1 分钟滚动窗口）', async ({ assert }) => {
    const org = await createTestOrg()
    await insertLedgerRow(org.id, 1, 1, { ageMs: 0 })
    await insertLedgerRow(org.id, 1, 1, { ageMs: RATE_LIMIT_WINDOW_MS * 3 })

    const counts = await new WindowCounter().getCounts({
      organizationId: org.id,
      connectionId: 1,
      modelId: 1,
    })

    assert.equal(counts.rpm, 1)
  })

  test('失败与中止的 attempt 不计入', async ({ assert }) => {
    const org = await createTestOrg()
    await insertLedgerRow(org.id, 1, 1, { status: 'succeeded' })
    await insertLedgerRow(org.id, 1, 1, { status: 'failed' })
    await insertLedgerRow(org.id, 1, 1, { status: 'aborted' })

    const counts = await new WindowCounter().getCounts({
      organizationId: org.id,
      connectionId: 1,
      modelId: 1,
    })

    assert.equal(counts.rpm, 1)
  })

  test('跨组织 attempt 不计入（组织隔离）', async ({ assert }) => {
    const orgA = await createTestOrg()
    const orgB = await createTestOrg()
    await insertLedgerRow(orgA.id, 1, 1)
    await insertLedgerRow(orgB.id, 1, 1)

    const counts = await new WindowCounter().getCounts({
      organizationId: orgA.id,
      connectionId: 1,
      modelId: 1,
    })

    assert.equal(counts.rpm, 1)
  })

  test('不维护内存计数：新实例与旧实例读到同一结果', async ({ assert }) => {
    const org = await createTestOrg()
    const first = new WindowCounter()
    await insertLedgerRow(org.id, 1, 1)

    const before = await first.getCounts({ organizationId: org.id, connectionId: 1, modelId: 1 })
    // 新实例不带任何历史状态
    const after = await new WindowCounter().getCounts({
      organizationId: org.id,
      connectionId: 1,
      modelId: 1,
    })

    assert.deepEqual(before, after)
  })

  test('窗口边界跨度等于配置的窗口长度', async ({ assert }) => {
    const bounds = new WindowCounter().getWindowBounds()
    const spanMs = bounds.end.diff(bounds.start).milliseconds

    assert.equal(spanMs, RATE_LIMIT_WINDOW_MS)
  })
})
