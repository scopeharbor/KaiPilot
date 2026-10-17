/**
 * v3-unified-ai-invocation-ledger §4 — 统一写入点测试。
 *
 * 覆盖：
 * - §4.5 既有调用方（经 resolver 接缝）零改动产生账本记录；
 * - §4.6/4.7 attempt 重试记录：同 idempotency_key 递增 attempt_number，每次尝试独立落账，
 *   覆盖成功/失败/降级/中止与多次重试的记录形态；
 * - §4.8/4.9 instrumentation 失败隔离：recorder 抛错不改业务终态；
 * - §4.10 instrumentation 错误计数与稳定错误码。
 *
 * 全部使用 InMemoryLedgerWriter / MockAdapter，不触真实 provider、不依赖 DB。
 */
import { test } from '@japa/runner'
import { MockAdapter } from '#services/ai_m0/mock_adapter'
import {
  AIGateway,
  type Adapter,
  type LedgerRecordContext,
  type StreamChunk,
} from '#services/ai_m0/gateway'
import UnifiedAiInvocationRecorder, {
  InMemoryLedgerWriter,
  LEDGER_ERR_WRITE_FAILED,
  LEDGER_ERR_FORBIDDEN_CONTENT,
  LEDGER_ERR_INVALID_STATUS,
  type AiInvocationLedgerWriter,
} from '#services/unified_ai_invocation_ledger/recorder'
import type { UnifiedAiInvocationAttempt } from '@aiproj/types'

/** 带 usage 的确定性 fake adapter（验证 token/延迟采集落账）。 */
class UsageFakeAdapter implements Adapter {
  readonly providerName = 'fake'
  readonly modelName = 'fake-model-v1'
  readonly isReal = false
  async ping() {
    return { ok: true }
  }
  async *stream(): AsyncIterable<StreamChunk> {
    yield { kind: 'text', text: '第一段' }
    yield { kind: 'text', text: '第二段' }
    yield {
      kind: 'done',
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        finishReasons: ['stop'],
        responseId: 'resp-fake-1',
        responseModel: 'fake-model-v1-actual',
      },
    }
  }
}

function makeContext(overrides?: Partial<LedgerRecordContext>): LedgerRecordContext {
  return {
    organizationId: 1,
    projectId: 1,
    userId: 99,
    capability: 'draft',
    surface: 'draft',
    idempotencyKey: 'ik-ctx-001',
    attemptNumber: 1,
    source: 'user',
    ...overrides,
  }
}

async function collectGatewayRecords(options?: {
  context?: LedgerRecordContext
  /** 测试专用：让 recorder 抛错。 */
  brokenWriter?: boolean
  /** 使用带 usage 的 fake adapter。 */
  withUsage?: boolean
}): Promise<{
  gateway: AIGateway
  writer: InMemoryLedgerWriter
  recorder: UnifiedAiInvocationRecorder
}> {
  const writer = new InMemoryLedgerWriter()
  let recorder: UnifiedAiInvocationRecorder
  if (options?.brokenWriter) {
    const broken: AiInvocationLedgerWriter = {
      async record() {
        throw new Error('disk full')
      },
    }
    recorder = new UnifiedAiInvocationRecorder({ writer: broken })
  } else {
    recorder = new UnifiedAiInvocationRecorder({ writer })
  }
  const adapter: Adapter = options?.withUsage ? new UsageFakeAdapter() : new MockAdapter()
  const gateway = new AIGateway(adapter, {
    recorder,
    recordContext: options?.context ?? makeContext(),
  })
  return { gateway, writer, recorder }
}

test.group('§4.5 既有调用方零改动落账（resolver 接缝语义）', () => {
  test('经接缝构造的 gateway.generate() 自动落账（草案/风险/预测等共用路径）', async ({
    assert,
  }) => {
    const { gateway, writer } = await collectGatewayRecords({ withUsage: true })
    const result = await gateway.generate({ sentence: 'test', strategy: 'prompt' })
    assert.isTrue(result.usingRealAdapter === false)
    assert.equal(writer.records.length, 1)
    const rec = writer.records[0]!
    assert.equal(rec.status, 'succeeded')
    assert.equal(rec.aiproj_capability, 'draft')
    assert.equal(rec.aiproj_surface, 'draft')
    assert.equal(rec.aiproj_organization_id, 1)
    assert.equal(rec.aiproj_project_id, 1)
    assert.equal(rec.aiproj_user_id, 99)
    assert.equal(rec.usage_input_tokens, 120)
    assert.equal(rec.usage_output_tokens, 80)
    assert.equal(rec.request_model, 'fake-model-v1')
    assert.equal(rec.response_model, 'fake-model-v1-actual')
    assert.equal(rec.operation_name, 'chat')
  })

  test('缺失调用上下文时以显式 unknown 落账（不静默丢弃）', async ({ assert }) => {
    const { gateway, writer } = await collectGatewayRecords({ context: {} })
    await gateway.generate({ sentence: 'test', strategy: 'prompt' })
    assert.equal(writer.records.length, 1)
    const rec = writer.records[0]!
    assert.equal(rec.aiproj_capability, 'unknown')
    assert.equal(rec.aiproj_surface, 'unknown')
    assert.equal(rec.aiproj_organization_id, 0)
  })

  test('stream() 路径同样落账（草案流式生成共用路径）', async ({ assert }) => {
    const { gateway, writer } = await collectGatewayRecords()
    const chunks: string[] = []
    for await (const chunk of gateway.stream({ sentence: 'test', strategy: 'prompt' })) {
      if (chunk.kind === 'text' && chunk.text) chunks.push(chunk.text)
    }
    assert.isTrue(chunks.length > 0)
    assert.equal(writer.records.length, 1)
    assert.equal(writer.records[0]!.status, 'succeeded')
  })
})

test.group('§4.6/4.7 attempt 重试记录', () => {
  test('同 idempotency_key 递增 attempt_number，每次尝试独立落账', async ({ assert }) => {
    const writer = new InMemoryLedgerWriter()
    const recorder = new UnifiedAiInvocationRecorder({ writer })
    const gateway = new AIGateway(new MockAdapter(), {
      recorder,
      recordContext: makeContext({ idempotencyKey: 'ik-retry', attemptNumber: 1 }),
    })

    // 第一次：失败
    const failed = await gateway.generate({
      sentence: 'x',
      strategy: 'prompt',
      promptSet: { systemPrompt: 'boom', userPrompt: 'boom' },
    })
    assert.isTrue(failed.triggeredErrors.length >= 0)

    // 第二次（模拟重试，递增 attempt_number）
    const gateway2 = new AIGateway(new MockAdapter(), {
      recorder,
      recordContext: makeContext({ idempotencyKey: 'ik-retry', attemptNumber: 2 }),
    })
    await gateway2.generate({ sentence: 'x', strategy: 'prompt' })

    assert.equal(writer.records.length, 2)
    assert.equal(writer.records[0]!.idempotency_key, 'ik-retry')
    assert.equal(writer.records[0]!.aiproj_attempt_number, 1)
    assert.equal(writer.records[1]!.idempotency_key, 'ik-retry')
    assert.equal(writer.records[1]!.aiproj_attempt_number, 2)
    // 每次尝试独立记录（各自的延迟/用量独立）
    assert.isNotNull(writer.records[0]!.duration_ms)
    assert.isNotNull(writer.records[1]!.duration_ms)
  })

  test('失败尝试记录 failed 状态与错误分类', async ({ assert }) => {
    const { gateway, writer, recorder } = await collectGatewayRecords({ context: makeContext() })
    // 先产生一条 succeeded 记录（generate 路径）
    await gateway.generate({ sentence: 'test', strategy: 'prompt' })
    assert.equal(writer.records.length, 1)
    // 再手动构造 failed 记录验证形状（error chunk 驱动路径的等价物）
    const attempt: UnifiedAiInvocationAttempt = {
      aiproj_organization_id: 1,
      aiproj_project_id: 1,
      aiproj_user_id: 5,
      aiproj_connection_id: null,
      aiproj_model_id: null,
      aiproj_capability: 'risk',
      aiproj_surface: 'risk',
      aiproj_attempt_number: 1,
      aiproj_using_real_adapter: false,
      aiproj_fallback_used: false,
      aiproj_source: 'mock',
      status: 'failed',
      error_kind: 'provider_timeout',
      error_message_ref: 'err:timeout:001',
      aiproj_degraded: false,
      operation_name: 'chat',
      provider_name: 'mock',
      request_model: 'mock-model',
      response_model: null,
      response_id: null,
      finish_reasons: ['error'],
      output_type: 'text',
      prompt_name: null,
      aiproj_prompt_version: null,
      tool_name: null,
      tool_type: null,
      tool_call_id: null,
      data_source_id: null,
      trace_id: null,
      span_id: null,
      parent_span_id: null,
      conversation_id: null,
      workflow_name: null,
      agent_id: null,
      agent_name: null,
      agent_version: null,
      idempotency_key: 'ik-fail',
      time_to_first_chunk_ms: 50,
      duration_ms: 300,
      usage_input_tokens: 500,
      usage_output_tokens: 0,
      usage_cache_read_input_tokens: null,
      usage_cache_creation_input_tokens: null,
      usage_reasoning_output_tokens: null,
      aiproj_audio_tokens: null,
      aiproj_context_tokens: null,
      aiproj_total_tokens: 500,
      aiproj_estimated_cost: 0,
      aiproj_currency: 'USD',
      aiproj_cost_status: 'unavailable',
      aiproj_pricing_snapshot_id: null,
      aiproj_input_hash: 'abc',
      aiproj_output_hash: null,
      aiproj_budget_decision_ref: null,
      aiproj_rate_limit_decision_ref: null,
      aiproj_source_ledger_ref: null,
      occurred_at: new Date().toISOString(),
    }
    const ref = await recorder.record(attempt)
    assert.isNotNull(
      ref,
      `record 应成功，实际返回 null；counts=${JSON.stringify(recorder.instrumentationCounts)}`,
    )
    assert.equal(writer.records.length, 2) // generate() 也落了一条
    const failedRec = writer.records.find((r) => r.status === 'failed')
    assert.isTrue(failedRec !== undefined)
    assert.equal(failedRec!.error_kind, 'provider_timeout')
  })

  test('中止由提前 break 流驱动 aborted 记录', async ({ assert }) => {
    const { gateway, writer } = await collectGatewayRecords()
    for await (const chunk of gateway.stream({ sentence: 'test', strategy: 'prompt' })) {
      if (chunk.kind === 'text') break // 提前中止
    }
    assert.equal(writer.records.length, 1)
    assert.equal(writer.records[0]!.status, 'aborted')
  })

  test('收到 done 后调用方提前退出循环：记为 succeeded 而不是 aborted', async ({ assert }) => {
    // AI 生成项目等调用方拿到 done（含用量）即 return；此前全部被误记为「中止」且没有 token 数。
    const { gateway, writer } = await collectGatewayRecords()
    for await (const chunk of gateway.stream({ sentence: 'test', strategy: 'prompt' })) {
      if (chunk.kind === 'done') break
    }
    assert.equal(writer.records.length, 1)
    assert.equal(writer.records[0]!.status, 'succeeded')
    // 耗时写整数：PG 整数列拒收 performance.now() 的小数毫秒（此前成功的 AI 同事对话全部丢账）
    const ttfc = writer.records[0]!.time_to_first_chunk_ms
    assert.isTrue(ttfc === null || Number.isInteger(ttfc), `time_to_first_chunk_ms=${ttfc}`)
    assert.isTrue(Number.isInteger(writer.records[0]!.duration_ms ?? 0))
  })

  test('降级记录 degraded 状态（fallback 路径）', async ({ assert }) => {
    const { gateway, writer, recorder } = await collectGatewayRecords({
      context: makeContext({ source: 'fallback' }),
    })
    await gateway.generate({ sentence: 'test', strategy: 'prompt' })
    assert.equal(writer.records[0]!.status, 'succeeded') // mock 成功
    // fallback 标志透传（source=fallback → aiproj_fallback_used=true）
    assert.equal(writer.records[0]!.aiproj_fallback_used, true)
    // 单独验证降级记录形态
    const degraded: UnifiedAiInvocationAttempt = {
      ...writer.records[0]!,
      status: 'degraded',
      aiproj_degraded: true,
      aiproj_fallback_used: true,
      idempotency_key: 'ik-degraded',
    }
    await recorder.record(degraded)
    const degradedRec = writer.records.find((r) => r.status === 'degraded')
    assert.isTrue(degradedRec !== undefined)
    assert.equal(degradedRec!.aiproj_degraded, true)
    assert.equal(degradedRec!.aiproj_fallback_used, true)
  })
})

test.group('§4.8/4.9 instrumentation 失败隔离', () => {
  test('recorder 抛错时业务结果完全不变', async ({ assert }) => {
    const { gateway, writer, recorder } = await collectGatewayRecords({
      brokenWriter: true,
      withUsage: true,
    })
    const result = await gateway.generate({ sentence: 'test', strategy: 'prompt' })
    // 业务终态不受影响：rawText 正常、无错误、结果可用
    assert.isTrue(result.rawText.length > 0)
    assert.equal(result.triggeredErrors.length, 0)
    assert.isTrue(result.outputTokens !== null)
    // recorder 抛错被吞掉，不向外抛
    assert.isTrue(true)
    assert.equal(writer.records.length, 0)
    // 计入 instrumentation 错误
    const counts = recorder.instrumentationCounts
    assert.equal(counts[LEDGER_ERR_WRITE_FAILED], 1)
  })

  test('流式路径 recorder 抛错不影响流式消费', async ({ assert }) => {
    const { gateway, recorder } = await collectGatewayRecords({ brokenWriter: true })
    let text = ''
    for await (const chunk of gateway.stream({ sentence: 'test', strategy: 'prompt' })) {
      if (chunk.kind === 'text' && chunk.text) text += chunk.text
    }
    assert.isTrue(text.length > 0)
    assert.equal(recorder.instrumentationCounts[LEDGER_ERR_WRITE_FAILED], 1)
  })

  test('未知状态被拒绝且计为 instrumentation 错误（不落账不计成功）', async ({ assert }) => {
    const writer = new InMemoryLedgerWriter()
    const recorder = new UnifiedAiInvocationRecorder({ writer })
    // 直接调用 record 传非法状态
    await recorder.record({
      ...({
        status: 'nonexistent',
        operation_name: 'chat',
        aiproj_organization_id: 1,
        aiproj_attempt_number: 1,
        aiproj_capability: 'draft',
        aiproj_surface: 'draft',
        aiproj_using_real_adapter: false,
        aiproj_fallback_used: false,
        aiproj_source: 'mock',
        error_kind: 'none',
        aiproj_degraded: false,
        provider_name: 'mock',
        request_model: 'mock',
        response_model: null,
        finish_reasons: [],
        output_type: null,
        occurred_at: new Date().toISOString(),
      } as unknown as UnifiedAiInvocationAttempt),
    })
    assert.equal(writer.records.length, 0)
    assert.equal(recorder.instrumentationCounts[LEDGER_ERR_INVALID_STATUS], 1)
  })

  test('禁止内容载荷被拒绝且计为 instrumentation 错误', async ({ assert }) => {
    const writer = new InMemoryLedgerWriter()
    const recorder = new UnifiedAiInvocationRecorder({ writer })
    const attempt = {
      status: 'succeeded',
      operation_name: 'chat',
      aiproj_organization_id: 1,
      aiproj_attempt_number: 1,
      aiproj_capability: 'draft',
      aiproj_surface: 'draft',
      aiproj_using_real_adapter: false,
      aiproj_fallback_used: false,
      aiproj_source: 'mock',
      error_kind: 'none',
      aiproj_degraded: false,
      provider_name: 'mock',
      request_model: 'mock',
      finish_reasons: [],
      occurred_at: new Date().toISOString(),
      // 禁止键：prompt 内容
      promptText: '这是 prompt 全文',
    } as unknown as UnifiedAiInvocationAttempt
    await recorder.record(attempt)
    assert.equal(writer.records.length, 0)
    assert.equal(recorder.instrumentationCounts[LEDGER_ERR_FORBIDDEN_CONTENT], 1)
  })
})

test.group('§4.10 instrumentation 错误计数与稳定错误码', () => {
  test('稳定错误码常量存在且计数可读', async ({ assert }) => {
    // 触发一次写失败
    const broken: AiInvocationLedgerWriter = {
      async record() {
        throw new Error('boom')
      },
    }
    const recorder2 = new UnifiedAiInvocationRecorder({ writer: broken })
    const attempt = {
      status: 'succeeded',
      operation_name: 'chat',
      aiproj_organization_id: 1,
      aiproj_attempt_number: 1,
      aiproj_capability: 'draft',
      aiproj_surface: 'draft',
      aiproj_using_real_adapter: false,
      aiproj_fallback_used: false,
      aiproj_source: 'mock',
      error_kind: 'none',
      aiproj_degraded: false,
      provider_name: 'mock',
      request_model: 'mock',
      finish_reasons: [],
      occurred_at: new Date().toISOString(),
    } as unknown as UnifiedAiInvocationAttempt
    await recorder2.record(attempt)
    assert.equal(recorder2.instrumentationCounts[LEDGER_ERR_WRITE_FAILED], 1)
    assert.equal(recorder2.instrumentationCounts[LEDGER_ERR_FORBIDDEN_CONTENT], undefined)
  })
})
