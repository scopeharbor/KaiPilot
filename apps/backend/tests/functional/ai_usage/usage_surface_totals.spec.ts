import Project from '#models/project'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { unifiedAiInvocationAttemptFixture } from '@aiproj/types'
import AiConnectionModel from '#models/ai_connection_model'
import ModelPricingService from '#services/ai_pricing/model_pricing_service'
import { DatabaseLedgerWriter } from '#services/unified_ai_invocation_ledger/recorder'
import { createAiConnection } from '../../unit/ai/_helpers.js'
import {
  createOrganization,
  createUser,
  orgBearer,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * AI 用量页（GET /ai/usage-surface）回归：
 * - 总计只算一次（此前把组织/项目/用户/能力/模型五个切面相加，次数与 token 被放大约 5 倍）；
 * - token 取账本真实列（usage_input_tokens / usage_output_tokens / total_tokens）；
 * - 模型维度按 provider_name/request_model 分组（此前是 undefined/undefined）；
 * - 项目名、成员名、用途中文名；按结果计数与最近调用明细；时段参数 24h/7d/all。
 */
async function ledgerRow(
  organizationId: number,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<void> {
  await UnifiedAiInvocationLedger.create({
    organizationId,
    projectId: null,
    userId: null,
    capability: 'project_draft',
    surface: 'ai-create-draft',
    attemptNumber: 1,
    usingRealAdapter: true,
    fallbackUsed: false,
    source: 'organization',
    status: 'succeeded',
    errorKind: 'none',
    degraded: false,
    operationName: 'chat',
    providerName: 'openai-compatible',
    requestModel: 'gpt-test',
    usageInputTokens: 700,
    usageOutputTokens: 300,
    totalTokens: 1000,
    durationMs: 1200,
    occurredAt: DateTime.now().minus({ hours: 1 }),
    ...overrides,
  } as never)
}

test.group('AI 用量视图：真实账本聚合', (group) => {
  useAuthDatabase(group)

  test('配置定价后新调用的入账成本在用量 API 中显示，空成本不阻断', async ({ client, assert }) => {
    const { org, user, conn } = await createAiConnection({ model: 'usage-priced-fixture' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    const pricing = await new ModelPricingService().setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1, output: 2 } },
    })
    const ref = await new DatabaseLedgerWriter().record(
      unifiedAiInvocationAttemptFixture({
        aiproj_organization_id: Number(org.id),
        aiproj_connection_id: Number(conn.id),
        aiproj_model_id: Number(model.id),
        aiproj_user_id: Number(user.id),
        aiproj_project_id: null,
        request_model: model.modelName,
        response_model: null,
        idempotency_key: null,
        usage_input_tokens: 1000,
        usage_output_tokens: 500,
        usage_cache_read_input_tokens: null,
        usage_cache_creation_input_tokens: null,
        usage_reasoning_output_tokens: null,
        aiproj_estimated_cost: null,
        aiproj_currency: null,
        aiproj_cost_status: null,
        aiproj_pricing_snapshot_id: null,
        occurred_at: DateTime.now().toISO()!,
      }),
    )
    const rowId = Number(ref.split(':')[1])
    const before = await UnifiedAiInvocationLedger.findOrFail(rowId)
    assert.equal(Number(before.estimatedCost), 0.002)
    // 同一时段另有带快照但无成本的调用，不可将 null 算成 0 或压掉刚入账的金额。
    await ledgerRow(Number(org.id), { pricingSnapshotId: pricing.snapshotId, estimatedCost: null })
    const auth = await orgBearer(user, org.id)
    const response = await client
      .get('/api/v1/ai/usage-surface?window=24h')
      .header('Authorization', auth)
    response.assertStatus(200)
    const data = response.body().data
    assert.equal(data.totalCost.value, 0.002)
    assert.equal(data.totalCost.currency, 'USD')
    assert.equal(data.totalCost.pricingSnapshotId, pricing.snapshotId)
    assert.deepEqual(data.costCoverage, { pricedCalls: 1, unpricedCalls: 1, unconvertedCalls: 0 })
    assert.equal(data.recentCalls.find((call: { cost?: unknown }) => call.cost)?.cost.value, 0.002)
    const after = await UnifiedAiInvocationLedger.findOrFail(rowId)
    assert.equal(after.estimatedCost, before.estimatedCost)
    assert.equal(after.pricingSnapshotId, before.pricingSnapshotId)
  })

  test('总计不重复计数，名称可读，时段参数生效', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('usage-owner'), fullName: '用量管理员' })
    const org = await createOrganization(owner)
    const project = await Project.create({
      organizationId: org.id,
      name: '支付清算中台',
      code: `U${Date.now()}`,
      createdBy: owner.id,
    })
    await ledgerRow(org.id, { projectId: project.id, userId: owner.id })
    await ledgerRow(org.id, {
      userId: owner.id,
      capability: 'chat',
      surface: 'copilot-live-answer-stream',
      status: 'failed',
      usageInputTokens: 50,
      usageOutputTokens: 0,
      totalTokens: 50,
    })
    // 8 天前：近 7 天不计，全部时段计
    await ledgerRow(org.id, { occurredAt: DateTime.now().minus({ days: 8 }) })

    const auth = await orgBearer(owner, org.id)
    const week = await client
      .get('/api/v1/ai/usage-surface?window=7d')
      .header('Authorization', auth)
    week.assertStatus(200)
    const data = week.body().data
    assert.equal(data.window.type, 'last_7_days')
    assert.equal(data.totalCallCount, 2)
    assert.deepEqual(data.totalTokens, { prompt: 750, completion: 300, total: 1050 })
    assert.deepEqual(data.statusCounts, { succeeded: 1, failed: 1 })

    const labels = (dim: string) =>
      (data.dimensions as Array<{ dimension: string; label: string }>)
        .filter((d) => d.dimension === dim)
        .map((d) => d.label)
    assert.sameMembers(labels('model'), ['openai-compatible/gpt-test'])
    assert.sameMembers(labels('project'), ['支付清算中台', '未关联项目'])
    assert.sameMembers(labels('user'), ['用量管理员'])
    assert.sameMembers(labels('capability'), ['AI 生成项目', 'AI 同事对话'])

    assert.lengthOf(data.recentCalls, 2)
    assert.equal(data.recentCalls[0].userLabel, '用量管理员')

    const all = await client
      .get('/api/v1/ai/usage-surface?window=all')
      .header('Authorization', auth)
    all.assertStatus(200)
    assert.equal(all.body().data.totalCallCount, 3)
  })
})
