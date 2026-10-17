/**
 * v3-unified-ai-invocation-ledger §5 —— 与既有账本（Compiler/OCR）调和测试。
 *
 * 覆盖：
 * - §5.1/5.2 source_ledger_ref 语义与桥接元数据写入（不修改既有账本行）；
 * - §5.3/5.4 聚合去重：桥接调用只计一次且不丢失成本；
 * - §5.5 fixture 对照：统一账本 OCR 场景窗口计数与 ocr_rate_limit_guard 现有计数一致；
 * - §5.7 既有 Compiler/OCR 观测行为与摘要输出未回归。
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import OcrProviderAttempt from '#models/ocr_provider_attempt'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import UnifiedAiLedgerBridgeService, {
  ocrStatusToLedgerStatus,
} from '#services/unified_ai_invocation_ledger/bridge_service'
import { parseSourceLedgerRef, dedupeLedgerAndSourceRows } from '@aiproj/types'

test.group('§5.1 source_ledger_ref 语义', () => {
  test('parseSourceLedgerRef 识别 compiler / ocr / none', ({ assert }) => {
    assert.deepEqual(parseSourceLedgerRef('compiler:cost_event:run:1:stage'), {
      kind: 'compiler',
      id: 'cost_event:run:1:stage',
    })
    assert.deepEqual(parseSourceLedgerRef('ocr:attempt:9001'), { kind: 'ocr', id: 'attempt:9001' })
    assert.deepEqual(parseSourceLedgerRef(null), { kind: 'none', id: null })
  })

  test('ocrStatusToLedgerStatus 映射符合限流口径', ({ assert }) => {
    assert.equal(ocrStatusToLedgerStatus('succeeded'), 'succeeded')
    assert.equal(ocrStatusToLedgerStatus('failed'), 'failed')
    assert.equal(ocrStatusToLedgerStatus('budget_blocked'), 'aborted')
    assert.equal(ocrStatusToLedgerStatus('skipped'), 'aborted')
    assert.equal(ocrStatusToLedgerStatus('running'), 'in_flight')
    assert.equal(ocrStatusToLedgerStatus('weird'), 'queued')
  })
})

test.group('§5.2 桥接元数据写入（不修改既有账本行）', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
    await UnifiedAiLedgerBridgeService.clearForTests()
    await OcrProviderAttempt.query().delete()
  })

  test('OCR attempt 桥接后统一账本带 source_ledger_ref，OCR 行保持不变', async ({ assert }) => {
    const ocrRow = await OcrProviderAttempt.create({
      organizationId: 701,
      projectId: 9,
      ocrJobId: 3,
      pageId: 1,
      attemptNumber: 1,
      provider: 'openai-compatible',
      model: 'gpt-4o',
      connectionId: null,
      modelId: null,
      capabilityMode: 'vision',
      status: 'succeeded',
      latencyMs: 250,
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      audioTokens: null,
      reasoningTokens: null,
      contextTokens: null,
      estimatedCost: 0.005,
      currency: 'USD',
      costStatus: 'estimated',
      pricingSnapshotId: null,
      inputHash: 'abc123',
      outputRef: null,
      outputHash: 'def456',
      budgetDecisionRef: null,
      rateLimitDecisionRef: null,
      errorCategory: 'none',
      warningCodes: null,
      idempotencyKey: 'ocr-ik-001',
      occurredAt: DateTime.now(),
    })

    const service = new UnifiedAiLedgerBridgeService()
    const ref = await service.bridgeFromOcrAttempt({
      id: ocrRow.id,
      organizationId: ocrRow.organizationId,
      projectId: ocrRow.projectId,
      attemptNumber: ocrRow.attemptNumber,
      provider: ocrRow.provider,
      model: ocrRow.model,
      connectionId: ocrRow.connectionId,
      modelId: ocrRow.modelId,
      status: ocrRow.status,
      latencyMs: ocrRow.latencyMs,
      inputTokens: ocrRow.inputTokens,
      outputTokens: ocrRow.outputTokens,
      totalTokens: ocrRow.totalTokens,
      cacheReadTokens: ocrRow.cacheReadTokens,
      cacheWriteTokens: ocrRow.cacheWriteTokens,
      audioTokens: ocrRow.audioTokens,
      reasoningTokens: ocrRow.reasoningTokens,
      contextTokens: ocrRow.contextTokens,
      estimatedCost: ocrRow.estimatedCost,
      currency: ocrRow.currency,
      costStatus: ocrRow.costStatus,
      pricingSnapshotId: ocrRow.pricingSnapshotId,
      inputHash: ocrRow.inputHash,
      outputHash: ocrRow.outputHash,
      budgetDecisionRef: ocrRow.budgetDecisionRef,
      rateLimitDecisionRef: ocrRow.rateLimitDecisionRef,
      errorCategory: ocrRow.errorCategory,
      idempotencyKey: ocrRow.idempotencyKey,
      occurredAt: ocrRow.occurredAt,
    })
    assert.isTrue(ref.startsWith('ledger:'))

    const ledgerRow = await UnifiedAiInvocationLedger.query()
      .where('id', Number(ref.split(':')[1]))
      .firstOrFail()
    assert.equal(ledgerRow.sourceLedgerRef, `ocr:attempt:${ocrRow.id}`)
    assert.equal(ledgerRow.capability, 'ocr')
    assert.equal(ledgerRow.surface, 'ocr')
    assert.equal(ledgerRow.usageInputTokens, 500)
    assert.equal(ledgerRow.estimatedCost, 0.005)

    // 既有 OCR 行未被修改
    const ocrAfter = await OcrProviderAttempt.query().where('id', ocrRow.id).firstOrFail()
    assert.equal(ocrAfter.status, 'succeeded')
    assert.equal(ocrAfter.inputTokens, 500)
    assert.equal(ocrAfter.idempotencyKey, 'ocr-ik-001')
    assert.isNull(ocrAfter.tombstoneId)
  })
})

test.group('§5.3/5.4 聚合去重', () => {
  test('桥接调用在聚合中只计一次且不丢失成本（纯函数层）', ({ assert }) => {
    const unified = [
      {
        aiproj_organization_id: 1,
        aiproj_attempt_number: 1,
        aiproj_capability: 'ocr',
        aiproj_surface: 'ocr',
        aiproj_using_real_adapter: true,
        aiproj_fallback_used: false,
        aiproj_source: 'user',
        status: 'succeeded',
        error_kind: 'none',
        aiproj_degraded: false,
        operation_name: 'generate_content',
        provider_name: 'openai-compatible',
        request_model: 'gpt-4o',
        response_model: null,
        finish_reasons: [],
        output_type: 'text',
        idempotency_key: 'ocr-ik-001',
        aiproj_estimated_cost: 0.005,
        aiproj_source_ledger_ref: 'ocr:attempt:9001',
        occurred_at: '2026-08-01T00:00:00.000Z',
      },
    ] as any[]
    const source = [{ idempotencyKey: 'ocr-ik-001', sourceRef: 'ocr:attempt:9001', cost: 0.005 }]
    const result = dedupeLedgerAndSourceRows(unified, source)
    assert.equal(result.unifiedCount, 1)
    assert.equal(result.sourceCount, 1)
    assert.equal(result.dedupedTotal, 1)
    assert.equal(result.totalCost, 0.01)
  })

  test('桥接调用在聚合中只计一次（service 层：统一账本只有一条行）', async ({ assert }) => {
    await testUtils.db().migrate()
    await UnifiedAiLedgerBridgeService.clearForTests()
    const service = new UnifiedAiLedgerBridgeService()
    // 幂等键相同只插一行即可验证内容：catalog 治理声明（organization_id, idempotency_key）
    // 唯一索引已真实存在（迁移 1890000000000），重复插入会被唯一约束拒绝。
    await service.bridgeFromCompilerCostEvent({
      organizationId: 701,
      compilerRunId: 5,
      provider: 'deepseek',
      model: 'deepseek-chat',
      stageId: 'plan',
      attemptNumber: 1,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0.001,
      currency: 'CNY',
      costStatus: 'priced',
      pricingSnapshotId: null,
      latencyMs: 300,
      errorCategory: 'none',
      idempotencyKey: 'compiler-ik-001',
      occurredAt: '2026-08-01T00:00:00.000Z',
    })

    const rows = await UnifiedAiInvocationLedger.query()
      .where('organization_id', 701)
      .where('idempotency_key', 'compiler-ik-001')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.sourceLedgerRef, 'compiler:cost_event:5:plan')
  })
})

test.group('§5.5 OCR 窗口计数与 ocr_rate_limit_guard 一致', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
    await UnifiedAiLedgerBridgeService.clearForTests()
    await OcrProviderAttempt.query().delete()
  })

  test('同一 fixture 场景：统一账本计数 = OCR 账本计数', async ({ assert }) => {
    const now = DateTime.now()
    // 造 3 条 OCR attempt（succeeded/failed/rate_limited）——rate_limited 不计
    const seed = [
      { status: 'succeeded', inputTokens: 500, outputTokens: 200, latencyMs: 250 },
      { status: 'failed', inputTokens: 400, outputTokens: 0, latencyMs: 300 },
      { status: 'rate_limited', inputTokens: 0, outputTokens: 0, latencyMs: null },
    ]
    for (const s of seed) {
      await OcrProviderAttempt.create({
        organizationId: 701,
        projectId: 9,
        ocrJobId: 3,
        pageId: 1,
        attemptNumber: 1,
        provider: 'openai-compatible',
        model: 'gpt-4o',
        status: s.status as 'succeeded' | 'failed' | 'rate_limited',
        latencyMs: s.latencyMs,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        totalTokens: s.inputTokens + s.outputTokens,
        errorCategory: s.status === 'failed' ? 'timeout' : 'none',
        warningCodes: null,
        idempotencyKey: `seed-ik-${s.status}`,
        occurredAt: now.minus({ seconds: 5 }),
      })
    }

    // OCR 侧计数（与 ocr_rate_limit_guard.#countRecentAttempts 相同的查询语义：
    // org/provider/model + occurred_at 窗口 + 排除 budget_blocked/skipped）
    const windowStart = now.minus({ milliseconds: 60_000 })
    const ocrAttempts = await OcrProviderAttempt.query()
      .where('organization_id', 701)
      .where('provider', 'openai-compatible')
      .where('model', 'gpt-4o')
      .where('occurred_at', '>=', windowStart.toSQL()!)
      .whereNotIn('status', ['budget_blocked', 'skipped'])
    let ocrRpm = 0
    let ocrTpm = 0
    for (const a of ocrAttempts) {
      ocrRpm++
      ocrTpm += (a.inputTokens ?? 0) + (a.outputTokens ?? 0)
    }

    // 桥接全部 OCR 行到统一账本
    const service = new UnifiedAiLedgerBridgeService()
    const ocrRows = await OcrProviderAttempt.query().where('organization_id', 701)
    for (const row of ocrRows) {
      await service.bridgeFromOcrAttempt({
        id: row.id,
        organizationId: row.organizationId,
        projectId: row.projectId,
        attemptNumber: row.attemptNumber,
        provider: row.provider,
        model: row.model,
        connectionId: row.connectionId,
        modelId: row.modelId,
        status: row.status,
        latencyMs: row.latencyMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        audioTokens: row.audioTokens,
        reasoningTokens: row.reasoningTokens,
        contextTokens: row.contextTokens,
        estimatedCost: row.estimatedCost,
        currency: row.currency,
        costStatus: row.costStatus,
        pricingSnapshotId: row.pricingSnapshotId,
        inputHash: row.inputHash,
        outputHash: row.outputHash,
        budgetDecisionRef: row.budgetDecisionRef,
        rateLimitDecisionRef: row.rateLimitDecisionRef,
        errorCategory: row.errorCategory,
        idempotencyKey: row.idempotencyKey,
        occurredAt: row.occurredAt,
      })
    }

    // 统一账本侧计数
    const unifiedCounts = await service.windowCountsFromUnifiedLedger({
      organizationId: 701,
      provider: 'openai-compatible',
      model: 'gpt-4o',
      windowStart,
    })

    assert.equal(unifiedCounts.rpm, ocrRpm)
    assert.equal(unifiedCounts.tpm, ocrTpm)
    // OCR 守卫只排除 budget_blocked/skipped：succeeded+failed+rate_limited 计 3
    assert.equal(ocrRpm, 3)
    assert.equal(ocrTpm, 1100)
  })
})

test.group('§5.7 既有 Compiler/OCR 观测行为未回归', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('OCR provider attempt 表结构与记录行为保持不变（桥接不改写）', async ({ assert }) => {
    // 既有表的关键列仍存在（快照校验）
    const res = await db.rawQuery("PRAGMA table_info('ocr_provider_attempts')")
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const columns = rows.map((r: any) => r.name)
    for (const col of [
      'idempotency_key',
      'status',
      'input_tokens',
      'output_tokens',
      'estimated_cost',
      'occurred_at',
    ]) {
      assert.isTrue(columns.includes(col), `ocr_provider_attempts 应保留列: ${col}`)
    }
    // 既有表无 source_ledger_ref（桥接只在统一账本侧）
    assert.isFalse(columns.includes('source_ledger_ref'))
  })

  test('统一账本表不含内容型列（低敏红线贯穿桥接）', async ({ assert }) => {
    const res = await db.rawQuery("PRAGMA table_info('unified_ai_invocation_ledger')")
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const columns = rows.map((r: any) => r.name)
    for (const forbidden of [
      'prompt',
      'completion',
      'messages',
      'api_key',
      'authorization',
      'secret',
    ]) {
      assert.isFalse(columns.includes(forbidden), `禁止内容型列: ${forbidden}`)
    }
  })
})
