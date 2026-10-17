/**
 * 模型定价与账本成本归属（2026-10-01）。
 *
 * 覆盖三条修复：
 * 1. 人工定价（第三方中转实际结算价）能落库并绑定到连接模型；
 * 2. 账本记账时按 connection_id/model_id 解析定价——这两个字段为空时按模型名回落，
 *    成本与 cost_status 真正写进账本（此前恒为 null → 用量页成本永远「未定价」）；
 * 3. 历史用量按当前价回算，且改价**不追溯改写**历史账本行。
 */
import { test } from '@japa/runner'
import { unifiedAiInvocationAttemptFixture } from '@aiproj/types'
import ModelPricingService from '#services/ai_pricing/model_pricing_service'
import { DatabaseLedgerWriter } from '#services/unified_ai_invocation_ledger/recorder'
import AiConnectionModel from '#models/ai_connection_model'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import type AiModelCatalogService from '#services/ai_model_catalog_service'
import ExchangeRateService from '#services/ai_pricing/exchange_rate_service'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import { createAiConnection, useAiDatabase } from '../../unit/ai/_helpers.js'
import { DateTime } from 'luxon'

const MODEL_NAME = 'relay-a/vendor-x-model-1'

async function firstModelOf(connectionId: number) {
  return AiConnectionModel.query().where('connection_id', connectionId).firstOrFail()
}

/** 造一条「连接/模型 id 缺失」的账本记录——线上 chat 路径的常态。 */
function attemptWithoutAttribution(
  organizationId: number,
  inputTokens: number,
  outputTokens: number,
) {
  return unifiedAiInvocationAttemptFixture({
    aiproj_organization_id: organizationId,
    aiproj_connection_id: null,
    aiproj_model_id: null,
    provider_name: 'openai-compatible',
    request_model: MODEL_NAME,
    response_model: null,
    idempotency_key: null,
    usage_input_tokens: inputTokens,
    usage_output_tokens: outputTokens,
    usage_cache_read_input_tokens: null,
    usage_cache_creation_input_tokens: null,
    usage_reasoning_output_tokens: null,
    aiproj_total_tokens: inputTokens + outputTokens,
    aiproj_estimated_cost: null,
    aiproj_currency: null,
    aiproj_cost_status: null,
    aiproj_pricing_snapshot_id: null,
  })
}

test.group('模型定价 · 展示币种设置', (group) => {
  useAiDatabase(group)

  test('按组织保存展示币种，未设置的组织保持 USD 默认值', async ({ assert }) => {
    const first = await createAiConnection({ model: MODEL_NAME })
    const second = await createAiConnection({ model: 'other-model' })
    const exchange = new ExchangeRateService()

    await exchange.setDisplayCurrency(Number(first.org.id), 'cny')

    assert.equal(await exchange.getDisplayCurrency(Number(first.org.id)), 'CNY')
    assert.equal(await exchange.getDisplayCurrency(Number(second.org.id)), 'USD')
  })
})

test.group('模型定价 · 人工定价', (group) => {
  useAiDatabase(group)

  test('落库为 manual 快照并绑定，币种与备注可追溯', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))

    const view = await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'cny', cost: { input: 1, output: 2 }, note: '中转实际结算价' },
    })

    assert.isTrue(view.hasPricing)
    assert.equal(view.source, 'manual')
    assert.equal(view.currency, 'CNY')
    assert.isFalse(view.approximate)
    assert.equal(view.reason, '中转实际结算价')
    assert.isNotNull(view.snapshotId)

    const reloaded = await firstModelOf(Number(conn.id))
    assert.equal(String(reloaded.pricingSnapshotId), view.snapshotId)
  })

  test('同价重复保存复用同一条快照（改价才新建）', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    const args = {
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 0.15, output: 0.6 } },
    }

    const first = await pricing.setManualPricing(args)
    const second = await pricing.setManualPricing(args)
    assert.equal(first.snapshotId, second.snapshotId)

    const changed = await pricing.setManualPricing({
      ...args,
      input: { currency: 'USD', cost: { input: 0.15, output: 0.61 } },
    })
    assert.notEqual(changed.snapshotId, first.snapshotId)
  })

  test('解绑后回到未定价', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))

    await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1 } },
    })
    await pricing.unbindPricing(Number(org.id), Number(model.id))

    const view = await pricing.view(Number(org.id), Number(model.id))
    assert.isFalse(view.hasPricing)
    assert.isNull(view.snapshotId)
  })

  test('目录定价绑定与解绑不改写模型的目录身份字段', async ({ assert }) => {
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    model.catalogProviderId = 'original-provider'
    model.catalogModelId = 'original-model'
    model.catalogMetadata = { providerName: 'Original Provider', custom: 'keep-me' }
    await model.save()

    const snapshot = await AiModelPricingSnapshot.create({
      snapshotKey: 'identity-test',
      source: 'catalog-test',
      sourceHash: 'identity-test-hash',
      providerId: 'suggested-provider',
      providerName: 'Suggested Provider',
      modelId: 'suggested-model',
      modelName: 'Suggested Model',
      currency: 'USD',
      pricingUnit: 'per_million_tokens',
      cost: {
        input: 1,
        output: 2,
        cacheRead: null,
        cacheWrite: null,
        inputAudio: null,
        outputAudio: null,
        reasoning: null,
        contextOver200k: null,
        tiers: null,
      },
      limits: null,
      modalities: null,
      rawProvider: null,
      rawModel: null,
      fetchedAt: DateTime.now(),
      expiresAt: DateTime.now().plus({ days: 1 }),
      stale: false,
    })
    const catalog = {
      createPricingSnapshot: async () => snapshot,
    } as unknown as AiModelCatalogService
    const pricing = new ModelPricingService({ catalog })

    await pricing.bindCatalogPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      catalogProviderId: 'suggested-provider',
      catalogModelId: 'suggested-model',
      decidedBy: 'ai-prefill',
    })
    await pricing.unbindPricing(Number(org.id), Number(model.id))

    await model.refresh()
    assert.equal(model.catalogProviderId, 'original-provider')
    assert.equal(model.catalogModelId, 'original-model')
    assert.equal(
      (model.catalogMetadata as Record<string, unknown>).providerName,
      'Original Provider',
    )
    assert.equal((model.catalogMetadata as Record<string, unknown>).custom, 'keep-me')
  })
})

test.group('模型定价 · 账本成本归属', (group) => {
  useAiDatabase(group)

  test('连接/模型 id 缺失时按模型名回落，成本与状态写入账本', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1, output: 2 } },
    })

    await new DatabaseLedgerWriter().record(
      attemptWithoutAttribution(Number(org.id), 1_000_000, 500_000),
    )

    const row = await UnifiedAiInvocationLedger.query()
      .where('organization_id', org.id)
      .firstOrFail()
    // 1M 输入 × $1 + 0.5M 输出 × $2 = $2
    assert.closeTo(Number(row.estimatedCost), 2, 0.000001)
    assert.equal(row.costStatus, 'estimated')
    assert.equal(row.currency, 'USD')
    assert.isNotNull(row.pricingSnapshotId)
    assert.equal(row.pricingMatchedBy, 'model_name')
    assert.isFalse(Boolean(row.pricingApproximate))
  })

  test('同组织两个连接同名模型时，只使用指定连接的价格', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const first = await createAiConnection({ model: MODEL_NAME })
    const second = await createAiConnection({
      organizationId: Number(first.org.id),
      model: MODEL_NAME,
    })
    const modelA = await firstModelOf(Number(first.conn.id))
    const modelB = await firstModelOf(Number(second.conn.id))
    await pricing.setManualPricing({
      organizationId: Number(first.org.id),
      connectionModelId: Number(modelA.id),
      input: { currency: 'USD', cost: { input: 1 } },
    })
    const priceB = await pricing.setManualPricing({
      organizationId: Number(first.org.id),
      connectionModelId: Number(modelB.id),
      input: { currency: 'USD', cost: { input: 2 } },
    })

    await new DatabaseLedgerWriter().record({
      ...attemptWithoutAttribution(Number(first.org.id), 1_000_000, 0),
      aiproj_connection_id: Number(second.conn.id),
    })

    const row = await UnifiedAiInvocationLedger.query()
      .where('organization_id', first.org.id)
      .firstOrFail()
    assert.closeTo(Number(row.estimatedCost), 2, 0.000001)
    assert.equal(row.pricingSnapshotId, priceB.snapshotId)
  })

  test('近似价与按名回落方式一并落到账本', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1 } },
    })
    await model.refresh()
    model.catalogMetadata = {
      ...((model.catalogMetadata as Record<string, unknown> | null) ?? {}),
      pricing: {
        source: 'ai-prefill',
        currency: 'USD',
        approximate: true,
        decidedBy: 'ai-prefill',
        reason: '测试近似价',
        decidedAt: new Date().toISOString(),
      },
    }
    await model.save()

    await new DatabaseLedgerWriter().record(attemptWithoutAttribution(Number(org.id), 1_000_000, 0))
    const row = await UnifiedAiInvocationLedger.query()
      .where('organization_id', org.id)
      .firstOrFail()
    assert.isTrue(Boolean(row.pricingApproximate))
    assert.equal(row.pricingMatchedBy, 'model_name')
  })

  test('未定价模型的调用记 cost_unknown，不伪装成 0 元', async ({ assert }) => {
    const { org } = await createAiConnection({ model: MODEL_NAME })

    await new DatabaseLedgerWriter().record(
      attemptWithoutAttribution(Number(org.id), 1_000_000, 500_000),
    )

    const row = await UnifiedAiInvocationLedger.query()
      .where('organization_id', org.id)
      .firstOrFail()
    assert.isNull(row.estimatedCost)
    assert.equal(row.costStatus, 'cost_unknown')
    assert.isNull(row.pricingSnapshotId)
  })

  test('过期或标记 stale 的快照不再用于调用记账', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    const view = await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1 } },
    })
    const snapshot = await AiModelPricingSnapshot.findOrFail(Number(view.snapshotId))
    snapshot.stale = true
    await snapshot.save()

    const resolved = await pricing.resolveForAttempt({
      organizationId: Number(org.id),
      connectionId: Number(conn.id),
      modelId: Number(model.id),
      requestModel: MODEL_NAME,
    })
    assert.isNull(resolved)
  })

  test('上游已带成本的记录不被覆盖', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1, output: 2 } },
    })

    await new DatabaseLedgerWriter().record({
      ...attemptWithoutAttribution(Number(org.id), 1_000_000, 500_000),
      aiproj_estimated_cost: 9.99,
      aiproj_currency: 'CNY',
      aiproj_cost_status: 'fallback_estimate',
    })

    const row = await UnifiedAiInvocationLedger.query()
      .where('organization_id', org.id)
      .firstOrFail()
    assert.closeTo(Number(row.estimatedCost), 9.99, 0.000001)
    assert.equal(row.currency, 'CNY')
    assert.equal(row.costStatus, 'fallback_estimate')
  })
})

test.group('模型定价 · 历史回算', (group) => {
  useAiDatabase(group)

  test('历史 token × 当前单价，且改价不改写历史账本行', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))

    await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 1, output: 2 } },
    })
    await new DatabaseLedgerWriter().record(attemptWithoutAttribution(Number(org.id), 1_000_000, 0))
    await new DatabaseLedgerWriter().record(attemptWithoutAttribution(Number(org.id), 500_000, 0))

    const before = await pricing.backCompute({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
    })
    assert.equal(before.calls, 2)
    assert.equal(before.tokens.input, 1_500_000)
    assert.closeTo(before.estimatedCost ?? -1, 1.5, 0.000001)

    // 改价：只剩 0.5 倍
    await pricing.setManualPricing({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
      input: { currency: 'USD', cost: { input: 0.5, output: 2 } },
    })

    const after = await pricing.backCompute({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
    })
    assert.closeTo(after.estimatedCost ?? -1, 0.75, 0.000001)

    // 历史账本行保持当时算出的成本，不被追溯改写
    const rows = await UnifiedAiInvocationLedger.query()
      .where('organization_id', org.id)
      .orderBy('id', 'asc')
    assert.closeTo(Number(rows[0]!.estimatedCost), 1, 0.000001)
    assert.closeTo(Number(rows[1]!.estimatedCost), 0.5, 0.000001)
  })

  test('未定价时回算只给用量、不给成本', async ({ assert }) => {
    const pricing = new ModelPricingService()
    const { conn, org } = await createAiConnection({ model: MODEL_NAME })
    const model = await firstModelOf(Number(conn.id))
    await new DatabaseLedgerWriter().record(attemptWithoutAttribution(Number(org.id), 1_000, 500))

    const back = await pricing.backCompute({
      organizationId: Number(org.id),
      connectionModelId: Number(model.id),
    })
    assert.equal(back.calls, 1)
    assert.equal(back.tokens.total, 1_500)
    assert.isNull(back.estimatedCost)
    assert.equal(back.unpricedCalls, 1)
  })
})
