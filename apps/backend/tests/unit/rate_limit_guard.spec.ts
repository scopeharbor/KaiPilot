/**
 * v3-global-ai-rate-limiting §5.1–5.12 — 限流守卫测试。
 *
 * 证明：
 * - 未设限即该维度不约束；
 * - RPM 超限时拒绝并给出确定性重试建议，且落决策记录；
 * - TPM 走 preflight 预估判定，**估算缺省为 0 时不构成约束**（该缺口即
 *   本次修复的 `estimatedTokens` 链路）；
 * - 计数来源为统一账本，组织隔离生效。
 *
 * 本文件原为占位（0 断言、`test.describe` 非 japa API、导入不存在的
 * `#tests/helpers/db_isolation`），由 v3-copilot-live-submission-channel 用真断言重写。
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import RateLimitGuard from '#services/rate_limiting/rate_limit_guard'
import { setupTest, createTestOrg } from '#tests/helpers/index'

async function createConnectionModel(
  organizationId: number,
  limits: { rpmLimit?: number | null; tpmLimit?: number | null },
): Promise<number> {
  const now = DateTime.now().toSQL()
  const [connectionId] = await db.table('ai_connections').insert({
    organization_id: organizationId,
    display_name: '测试连接',
    protocol: 'openai_compatible',
    model: 'gpt-test',
    sync_state: 'synced',
    is_active: true,
    created_at: now,
    updated_at: now,
  })
  const [modelId] = await db.table('ai_connection_models').insert({
    connection_id: connectionId,
    organization_id: organizationId,
    model_name: 'gpt-test',
    rpm_limit: limits.rpmLimit ?? null,
    tpm_limit: limits.tpmLimit ?? null,
    is_active: true,
    created_at: now,
    updated_at: now,
  })
  return Number(modelId)
}

async function insertAttempts(
  organizationId: number,
  modelId: number,
  count: number,
  tokensEach = 100,
) {
  const now = DateTime.now().toSQL()
  for (let i = 0; i < count; i += 1) {
    await db.table('unified_ai_invocation_ledger').insert({
      organization_id: organizationId,
      connection_id: 0,
      model_id: modelId,
      status: 'succeeded',
      usage_input_tokens: tokensEach,
      usage_output_tokens: 0,
      occurred_at: now,
      created_at: now,
      updated_at: now,
    })
  }
}

test.group('rate_limit_guard（限额消费与超限拒绝）', (group) => {
  group.each.setup(async () => {
    await setupTest()
  })

  test('两个维度都未设限时直接放行且不落决策记录', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { rpmLimit: null, tpmLimit: null })

    const result = await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-unset',
    })

    assert.isTrue(result.allowed)
    assert.equal(result.decision, 'allow')
    assert.isNull(result.decisionId)
    const rows = await db
      .from('rate_limit_decisions')
      .where('organization_id', org.id)
      .count('* as total')
    assert.equal(Number(rows[0].total), 0)
  })

  test('RPM 未达限额时放行', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { rpmLimit: 5 })
    await insertAttempts(org.id, modelId, 2)

    const result = await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-under',
    })

    assert.isTrue(result.allowed)
  })

  test('RPM 达到限额时拒绝并给出重试秒数与触发层', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { rpmLimit: 2 })
    await insertAttempts(org.id, modelId, 2)

    const result = await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-over',
    })

    assert.isFalse(result.allowed)
    assert.equal(result.decision, 'reject')
    assert.isNotNull(result.decisionId)
    assert.equal(result.triggeringLayer, 'model')
    assert.isNumber(result.retryAfterSeconds)
    assert.isAbove(result.retryAfterSeconds!, 0)
  })

  test('RPM 拒绝时落一条决策记录', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { rpmLimit: 1 })
    await insertAttempts(org.id, modelId, 1)

    await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-record',
    })

    const rows = await db
      .from('rate_limit_decisions')
      .where('organization_id', org.id)
      .select('dimension', 'decision')
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].dimension, 'rpm')
    assert.equal(rows[0].decision, 'reject')
  })

  test('TPM 携带估算超限时拒绝', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { tpmLimit: 500 })
    await insertAttempts(org.id, modelId, 2, 200) // 窗口内已用 400

    const result = await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-tpm-over',
      estimatedTokens: 200, // 400 + 200 >= 500
    })

    assert.isFalse(result.allowed)
    assert.equal(result.decision, 'reject')
    assert.equal(result.triggeringLayer, 'model')
  })

  test('TPM 携带估算未超限时放行', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { tpmLimit: 5000 })
    await insertAttempts(org.id, modelId, 2, 200)

    const result = await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-tpm-under',
      estimatedTokens: 200,
    })

    assert.isTrue(result.allowed)
  })

  test('不提供 estimatedTokens 时 TPM 仅按窗口已用量判定（缺省估算为 0）', async ({ assert }) => {
    const org = await createTestOrg()
    const modelId = await createConnectionModel(org.id, { tpmLimit: 500 })
    await insertAttempts(org.id, modelId, 2, 200) // 已用 400 < 500

    const result = await new RateLimitGuard().preflight({
      organizationId: org.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-tpm-no-estimate',
      // 不传 estimatedTokens：这正是修复前所有调用点的状态
    })

    // 已用量未超限即放行——说明缺少估算时 TPM 实质只在「历史已超限」后才生效
    assert.isTrue(result.allowed)
  })

  test('跨组织的窗口用量不影响本组织判定', async ({ assert }) => {
    const orgA = await createTestOrg()
    const orgB = await createTestOrg()
    const modelId = await createConnectionModel(orgA.id, { rpmLimit: 2 })
    await insertAttempts(orgB.id, modelId, 5)

    const result = await new RateLimitGuard().preflight({
      organizationId: orgA.id,
      connectionId: null,
      modelId,
      actorId: 1,
      attemptId: 'attempt-cross-org',
    })

    assert.isTrue(result.allowed)
  })
})
