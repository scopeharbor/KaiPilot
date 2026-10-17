// v3-unified-ai-invocation-ledger —— 统一 AI 调用账本共享契约单测。
// 覆盖：operation/provider 枚举与未知值拒绝、request_model/response_model 分列、
// token 字段、本地扩展命名空间（不得冒充 gen_ai.*）、状态生命周期、
// error_kind、sanitizer 禁止键负例、确定性 hash、fixtures 六态、去重与聚合纯函数。
import { describe, it, expect } from 'vitest'
import {
  LEDGER_OPERATION_NAMES,
  LEDGER_PROVIDER_NAMES,
  LEDGER_ATTEMPT_STATUSES,
  LEDGER_ERROR_KINDS,
  LEDGER_FORBIDDEN_KEY_CATEGORIES,
  isLedgerAttemptStatus,
  isLedgerOperationName,
  isLedgerErrorKind,
  assertLedgerAttemptStatus,
  assertLedgerOperationName,
  normalizeLedgerErrorKind,
  ledgerForbiddenCategory,
  sanitizeLedgerMetadata,
  ledgerDetectForbiddenKeys,
  ledgerHasForbiddenKeys,
  ledgerFindDisallowedKeys,
  LEDGER_DTO_ALLOWED_KEYS,
  ledgerFnv1aHash,
  ledgerStableSerialize,
  computeLedgerContentHash,
  computeLedgerInputHash,
  computeLedgerOutputHash,
  serializeLedgerAttributes,
  ledgerFindNamespacingViolations,
  groupLedgerAttemptsByRetry,
  parseSourceLedgerRef,
  dedupeLedgerAndSourceRows,
  defaultLedgerWindowBounds,
  aggregateLedgerAttempts,
  computeLedgerWindowCounts,
  type UnifiedAiInvocationAttempt,
} from './unified-ai-invocation-ledger.js'
import {
  unifiedAiInvocationAttemptFixture,
  ledgerSuccessAttemptFixture,
  ledgerFailedAttemptFixture,
  ledgerDegradedAttemptFixture,
  ledgerRetryAttemptFixture,
  ledgerAbortedAttemptFixture,
  ledgerBridgedAttemptFixture,
  unifiedAiInvocationLedgerFixtures,
  sourceLedgerRowFixture,
  LEDGER_FIXTURE_ORG_A,
  LEDGER_FIXTURE_ORG_B,
} from './unified-ai-invocation-ledger-fixtures.js'

// ── 2.2 operation_name 枚举 ──
describe('operation_name 枚举（task 2.2 / spec: Operation name uses the published enumeration）', () => {
  it('覆盖已发布九类枚举', () => {
    expect(LEDGER_OPERATION_NAMES).toEqual([
      'chat',
      'generate_content',
      'text_completion',
      'embeddings',
      'execute_tool',
      'retrieval',
      'invoke_agent',
      'invoke_workflow',
      'create_agent',
    ])
  })

  it('未知 operation 被拒绝而非静默存储', () => {
    expect(isLedgerOperationName('chat')).toBe(true)
    expect(isLedgerOperationName('teleport')).toBe(false)
    expect(() => assertLedgerOperationName('teleport')).toThrow()
    expect(() => assertLedgerOperationName('chat')).not.toThrow()
  })
})

// ── 2.3 provider_name 枚举 ──
describe('provider_name 枚举（task 2.3）', () => {
  it('覆盖已发布 provider 词汇并允许受控扩展', () => {
    expect(LEDGER_PROVIDER_NAMES).toContain('openai')
    expect(LEDGER_PROVIDER_NAMES).toContain('anthropic')
    expect(LEDGER_PROVIDER_NAMES).toContain('google')
    expect(LEDGER_PROVIDER_NAMES).toContain('deepseek')
    expect(LEDGER_PROVIDER_NAMES).toContain('mock')
  })
})

// ── 2.4 token 用量字段 ──
describe('token 用量字段（task 2.4）', () => {
  it('五类标准 token 字段齐全', () => {
    const a = unifiedAiInvocationAttemptFixture({
      usage_input_tokens: 10,
      usage_output_tokens: 20,
      usage_cache_read_input_tokens: 5,
      usage_cache_creation_input_tokens: 2,
      usage_reasoning_output_tokens: 3,
    })
    expect(a.usage_input_tokens).toBe(10)
    expect(a.usage_output_tokens).toBe(20)
    expect(a.usage_cache_read_input_tokens).toBe(5)
    expect(a.usage_cache_creation_input_tokens).toBe(2)
    expect(a.usage_reasoning_output_tokens).toBe(3)
  })
})

// ── 2.5 request_model / response_model 分列 ──
describe('request_model 与 response_model 分列（task 2.5 / spec: drift 可检测）', () => {
  it('两个独立字段且可容纳不同模型标识', () => {
    const a = unifiedAiInvocationAttemptFixture({
      request_model: 'gpt-4',
      response_model: 'gpt-4-0613',
    })
    expect(a.request_model).toBe('gpt-4')
    expect(a.response_model).toBe('gpt-4-0613')
    expect(a.request_model).not.toBe(a.response_model)
    const b = unifiedAiInvocationAttemptFixture({ response_model: null })
    expect(b.request_model).toBeDefined()
    expect(b.response_model).toBeNull()
  })

  it('序列化后两个键仍独立存在（禁止合并为单一 model）', () => {
    const attrs = serializeLedgerAttributes(unifiedAiInvocationAttemptFixture())
    expect(attrs.request_model).toBeDefined()
    expect(attrs.response_model).toBeDefined()
    expect('model' in attrs).toBe(false)
  })
})

// ── 2.6 延迟与响应字段 ──
describe('延迟与响应字段（task 2.6）', () => {
  it('time_to_first_chunk_ms / duration_ms / response_id / finish_reasons / output_type 齐全', () => {
    const a = unifiedAiInvocationAttemptFixture({
      time_to_first_chunk_ms: 88,
      duration_ms: 1234,
      response_id: 'resp_x',
      finish_reasons: ['length'],
      output_type: 'json',
    })
    expect(a.time_to_first_chunk_ms).toBe(88)
    expect(a.duration_ms).toBe(1234)
    expect(a.response_id).toBe('resp_x')
    expect(a.finish_reasons).toEqual(['length'])
    expect(a.output_type).toBe('json')
  })
})

// ── 2.7 追踪与会话字段 ──
describe('追踪与会话字段（task 2.7）', () => {
  it('trace/span/conversation/workflow/agent/prompt/idempotency 齐全', () => {
    const a = unifiedAiInvocationAttemptFixture({
      trace_id: 't1',
      span_id: 's1',
      parent_span_id: 'p1',
      conversation_id: 'c1',
      workflow_name: 'w1',
      agent_id: 'a1',
      agent_name: 'agent-x',
      agent_version: '1.0.0',
      prompt_name: 'draft-prompt-v3',
      idempotency_key: 'ik-1',
    })
    expect(a.trace_id).toBe('t1')
    expect(a.parent_span_id).toBe('p1')
    expect(a.conversation_id).toBe('c1')
    expect(a.agent_version).toBe('1.0.0')
    expect(a.prompt_name).toBe('draft-prompt-v3')
    expect(a.idempotency_key).toBe('ik-1')
  })
})

// ── 2.8 工具与检索字段 ──
describe('工具与检索字段（task 2.8）', () => {
  it('tool_name / tool_type / tool_call_id / data_source_id 齐全', () => {
    const a = unifiedAiInvocationAttemptFixture({
      tool_name: 'search_web',
      tool_type: 'function',
      tool_call_id: 'call_1',
      data_source_id: 'ds_1',
    })
    expect(a.tool_name).toBe('search_web')
    expect(a.tool_type).toBe('function')
    expect(a.tool_call_id).toBe('call_1')
    expect(a.data_source_id).toBe('ds_1')
  })
})

// ── 2.9/2.10 本地扩展命名空间 ──
describe('本地扩展 aiproj.* 命名空间（task 2.9/2.10 / spec: Fake standard attribute is rejected）', () => {
  it('本地扩展维度齐全且带 aiproj_ 前缀', () => {
    const a = unifiedAiInvocationAttemptFixture({
      aiproj_capability: 'risk',
      aiproj_surface: 'risk',
      aiproj_using_real_adapter: false,
      aiproj_fallback_used: true,
      aiproj_estimated_cost: 0.01,
      aiproj_currency: 'CNY',
      aiproj_cost_status: 'estimated',
      aiproj_pricing_snapshot_id: 'ps-1',
      aiproj_input_hash: 'aa',
      aiproj_output_hash: 'bb',
      aiproj_budget_decision_ref: 'bd-1',
      aiproj_rate_limit_decision_ref: 'rl-1',
      aiproj_audio_tokens: 9,
      aiproj_context_tokens: 8,
    })
    expect(a.aiproj_capability).toBe('risk')
    expect(a.aiproj_audio_tokens).toBe(9)
    expect(a.aiproj_context_tokens).toBe(8)
    expect(a.aiproj_rate_limit_decision_ref).toBe('rl-1')
  })

  it('任何本地扩展属性都不得以 gen_ai.* 键名输出', () => {
    const attrs = serializeLedgerAttributes(unifiedAiInvocationAttemptFixture())
    for (const key of Object.keys(attrs)) {
      expect(key.startsWith('gen_ai.')).toBe(false)
    }
    const violations = ledgerFindNamespacingViolations(attrs)
    expect(violations).toEqual([])
  })

  it('伪造 gen_ai.* 标准键被命名空间校验拒绝', () => {
    const violations = ledgerFindNamespacingViolations({
      'gen_ai.operation.name': 'chat',
      aiproj_capability: 'draft',
      operation_name: 'chat',
    })
    expect(violations).toContain('gen_ai.operation.name')
  })

  it('序列化 map 中可区分标准与本地属性', () => {
    const attrs = serializeLedgerAttributes(unifiedAiInvocationAttemptFixture())
    expect(attrs.operation_name).toBeDefined()
    expect(attrs.aiproj_capability).toBeDefined()
  })
})

// ── 2.11 状态生命周期 ──
describe('attempt 状态生命周期（task 2.11 / spec: Unknown lifecycle status is rejected）', () => {
  it('六态齐全且未知值被拒绝', () => {
    expect(LEDGER_ATTEMPT_STATUSES).toEqual([
      'queued',
      'in_flight',
      'succeeded',
      'failed',
      'aborted',
      'degraded',
    ])
    expect(isLedgerAttemptStatus('succeeded')).toBe(true)
    expect(isLedgerAttemptStatus('SUCCEEDED')).toBe(false)
    expect(() => assertLedgerAttemptStatus('completed')).toThrow()
    expect(() => assertLedgerAttemptStatus('failed')).not.toThrow()
  })
})

// ── 2.12 error_kind ──
describe('error_kind 分类（task 2.12）', () => {
  it('复用 AiM0ErrorKind 语义并补充账本专用分类', () => {
    expect(LEDGER_ERROR_KINDS).toContain('malformed_json')
    expect(LEDGER_ERROR_KINDS).toContain('sse_interrupted')
    expect(LEDGER_ERROR_KINDS).toContain('provider_timeout')
    expect(LEDGER_ERROR_KINDS).toContain('provider_rate_limit')
    expect(LEDGER_ERROR_KINDS).toContain('serialization_error')
    expect(isLedgerErrorKind('truncated')).toBe(true)
    expect(isLedgerErrorKind('storage_error')).toBe(true)
    expect(isLedgerErrorKind('bogus')).toBe(false)
  })

  it('normalizeLedgerErrorKind 从 provider 错误归一', () => {
    expect(normalizeLedgerErrorKind('rate limit exceeded')).toBe('provider_rate_limit')
    expect(normalizeLedgerErrorKind('timeout after 30s')).toBe('provider_timeout')
    expect(normalizeLedgerErrorKind(null)).toBe('none')
    expect(normalizeLedgerErrorKind('some weird thing')).toBe('unknown')
  })
})

// ── 2.13/2.14 sanitizer 禁止键负例 ──
describe('低敏 sanitizer（task 2.13/2.14 / spec: Forbidden key coverage is explicit）', () => {
  it('对每类禁止键至少给一个负例样本', () => {
    const samples: Array<[string, Record<string, unknown>]> = [
      ['prompt', { promptText: '帮我写一个项目计划' }],
      ['system_instruction', { system_instruction: '你是 PM 专家' }],
      ['completion', { completionText: '这是模型输出全文' }],
      ['messages', { messages: [{ role: 'user', content: 'hi' }] }],
      ['tool_arguments', { toolArguments: { query: 'x' } }],
      ['tool_results', { toolResults: [{ id: 1, body: 'r' }] }],
      ['retrieval_body', { retrieval_document: '全文……' }],
      ['provider_payload', { rawBody: { choices: [] } }],
      ['api_key', { apiKey: 'sk-0123456789abcdef' }],
      ['authorization', { Authorization: 'Bearer abc.def.ghi' }],
      ['token', { access_token: 'aaa' }],
      ['secret', { clientSecret: 'hunter2' }],
    ]
    for (const [category, sample] of samples) {
      const detected = ledgerDetectForbiddenKeys(sample)
      expect(detected).toContain(category as never)
      expect(ledgerHasForbiddenKeys(sample)).toBe(true)
    }
    expect(LEDGER_FORBIDDEN_KEY_CATEGORIES.length).toBeGreaterThanOrEqual(12)
  })

  it('自由形式元数据按 allowlist 过滤', () => {
    const safe = sanitizeLedgerMetadata({
      ref: 'artifact:1',
      hash: 'abc123',
      tokenCount: 55,
      errorCode: 'E-1',
      promptText: 'secret',
      apiKey: 'sk-xxx',
    })
    expect(safe).toEqual({ ref: 'artifact:1', hash: 'abc123', tokenCount: 55, errorCode: 'E-1' })
    expect(safe?.promptText).toBeUndefined()
    expect(safe?.apiKey).toBeUndefined()
  })

  it('空元数据返回 null 且不报错', () => {
    expect(sanitizeLedgerMetadata(null)).toBeNull()
    expect(sanitizeLedgerMetadata(undefined)).toBeNull()
    expect(ledgerDetectForbiddenKeys(null)).toEqual([])
  })

  it('结构化 DTO 白名单：prompt_name/usage_input_tokens 等标准字段不被误伤', () => {
    const attempt = unifiedAiInvocationAttemptFixture()
    const disallowed = ledgerFindDisallowedKeys(attempt)
    expect(disallowed).toEqual([])
  })

  it('结构化 DTO 白名单：内容型键（promptText/completionText/apiKey）被拒绝', () => {
    const attempt = unifiedAiInvocationAttemptFixture() as Record<string, unknown>
    attempt['promptText'] = 'prompt 全文'
    expect(ledgerFindDisallowedKeys(attempt)).toContain('promptText')
    attempt['completionText'] = '输出全文'
    expect(ledgerFindDisallowedKeys(attempt)).toContain('completionText')
    attempt['apiKey'] = 'sk-xxx'
    expect(ledgerFindDisallowedKeys(attempt)).toContain('apiKey')
    expect(LEDGER_DTO_ALLOWED_KEYS.has('prompt_name')).toBe(true)
    expect(LEDGER_DTO_ALLOWED_KEYS.has('usage_input_tokens')).toBe(true)
  })
})

// ── 2.15 确定性 hash ──
describe('确定性 hash 与稳定排序 helpers（task 2.15）', () => {
  it('相同输入产生确定性相同指纹', () => {
    const a = computeLedgerContentHash({ x: 1, y: [1, 2] })
    const b = computeLedgerContentHash({ x: 1, y: [1, 2] })
    expect(a).toBe(b)
  })

  it('稳定排序不受键序影响', () => {
    const s1 = ledgerStableSerialize({ b: 1, a: 2 })
    const s2 = ledgerStableSerialize({ a: 2, b: 1 })
    expect(s1).toBe(s2)
    expect(computeLedgerContentHash({ b: 1, a: 2 })).toBe(computeLedgerContentHash({ a: 2, b: 1 }))
  })

  it('input_hash 与 output_hash 前缀稳定且可复现', () => {
    expect(computeLedgerInputHash('hello')).toBe(computeLedgerInputHash('hello'))
    expect(computeLedgerOutputHash('world')).toBe(computeLedgerOutputHash('world'))
    expect(computeLedgerInputHash('hello')).not.toBe(computeLedgerOutputHash('hello'))
  })

  it('fnv1a 确定性', () => {
    expect(ledgerFnv1aHash('abc')).toBe(ledgerFnv1aHash('abc'))
    expect(ledgerFnv1aHash('abc')).toMatch(/^[0-9a-f]{8}$/)
  })
})

// ── 2.16 fixtures 六态 ──
describe('fixtures 六态（task 2.16）', () => {
  it('成功/失败/降级/重试/中止/桥接六态齐全', () => {
    const fixtures = unifiedAiInvocationLedgerFixtures()
    expect(fixtures.length).toBe(7)
    const statuses = new Set(fixtures.map((f) => f.status))
    expect(statuses.has('succeeded')).toBe(true)
    expect(statuses.has('failed')).toBe(true)
    expect(statuses.has('degraded')).toBe(true)
    expect(statuses.has('aborted')).toBe(true)
    expect(fixtures.filter((f) => f.aiproj_source_ledger_ref).length).toBe(1)
  })

  it('重试 fixture 共享 idempotency_key 且 attempt_number 递增', () => {
    const r1 = ledgerRetryAttemptFixture(1)
    const r2 = ledgerRetryAttemptFixture(2)
    expect(r1.idempotency_key).toBe(r2.idempotency_key)
    expect(r1.aiproj_attempt_number).toBe(1)
    expect(r2.aiproj_attempt_number).toBe(2)
  })

  it('桥接 fixture 携带 source_ledger_ref', () => {
    const bridged = ledgerBridgedAttemptFixture('ocr:attempt:9001')
    expect(bridged.aiproj_source_ledger_ref).toBe('ocr:attempt:9001')
    expect(bridged.aiproj_surface).toBe('ocr')
  })
})

// ── 4.6 重试分组 ──
describe('attempt 重试分组（task 4.6 / spec: Retries are recorded as separate attempts）', () => {
  it('同 idempotency_key 分组且按 attempt_number 排序', () => {
    const fixtures = unifiedAiInvocationLedgerFixtures()
    const groups = groupLedgerAttemptsByRetry(fixtures)
    const retryGroup = groups.get('ik-retry-fixture')
    expect(retryGroup).toBeDefined()
    expect(retryGroup!.map((g) => g.aiproj_attempt_number)).toEqual([1, 2])
    expect(retryGroup![0].idempotency_key).toBe(retryGroup![1].idempotency_key)
  })
})

// ── 5.1/5.3/5.4 source_ledger_ref 与去重 ──
describe('桥接与去重（task 5.1/5.3/5.4 / spec: Bridged invocation is counted once）', () => {
  it('parseSourceLedgerRef 识别 compiler / ocr / none', () => {
    expect(parseSourceLedgerRef('compiler:cost_event:artifact:x')).toEqual({
      kind: 'compiler',
      id: 'cost_event:artifact:x',
    })
    expect(parseSourceLedgerRef('ocr:attempt:9001')).toEqual({ kind: 'ocr', id: 'attempt:9001' })
    expect(parseSourceLedgerRef(null)).toEqual({ kind: 'none', id: null })
  })

  it('桥接调用在聚合中只计一次且不丢失成本', () => {
    const unified = [ledgerBridgedAttemptFixture('ocr:attempt:9001')]
    const source = [sourceLedgerRowFixture()]
    const result = dedupeLedgerAndSourceRows(unified, source)
    expect(result.unifiedCount).toBe(1)
    expect(result.sourceCount).toBe(1)
    expect(result.dedupedTotal).toBe(1)
    expect(result.totalCost).toBeCloseTo(0.01, 5) // 0.005 + 0.005
  })

  it('未桥接的来源行不被去重', () => {
    const unified: UnifiedAiInvocationAttempt[] = []
    const source = [
      sourceLedgerRowFixture({ idempotencyKey: 'ik-other', sourceRef: 'compiler:cost_event:z' }),
    ]
    const result = dedupeLedgerAndSourceRows(unified, source)
    expect(result.dedupedTotal).toBe(1)
    expect(result.sourceCount).toBe(1)
  })
})

// ── 5.5 OCR 窗口计数一致 ──
describe('OCR 场景窗口计数（task 5.5 / spec: Unified counts agree with OCR counts on fixtures）', () => {
  it('统一账本窗口计数与 ocr_rate_limit_guard 口径一致', () => {
    const fixtures = unifiedAiInvocationLedgerFixtures()
    const counts = computeLedgerWindowCounts(fixtures, '2026-07-01T00:00:00.000Z')
    // succeeded(1) + failed(2) + degraded(1) + retry1(1) + retry2(1) + bridged(1) = 6；
    // aborted(1) 不计（与 ocr_rate_limit_guard 的 whereNotIn(budget_blocked, skipped) 口径对齐）
    expect(counts.rpm).toBe(6)
    expect(counts.tpm).toBeGreaterThan(0)
  })

  it('窗口外记录不计数、非终态不计 RPM', () => {
    const now = new Date('2026-08-01T00:00:00.000Z')
    const inWindow = unifiedAiInvocationAttemptFixture({ occurred_at: now.toISOString() })
    const outWindow = unifiedAiInvocationAttemptFixture({
      occurred_at: '2026-01-01T00:00:00.000Z',
    })
    const queued = unifiedAiInvocationAttemptFixture({
      status: 'queued',
      occurred_at: now.toISOString(),
    })
    const counts = computeLedgerWindowCounts(
      [inWindow, outWindow, queued],
      '2026-07-01T00:00:00.000Z',
    )
    expect(counts.rpm).toBe(1)
  })
})

// ── 6.1/6.2/6.8/6.9 聚合 ──
describe('只读聚合纯函数（task 6.1/6.2/6.8/6.9 / spec: Rollup answers cost attribution）', () => {
  const window = { startIso: '2026-07-01T00:00:00.000Z', endIso: '2026-09-01T00:00:00.000Z' }

  it('按 capability rollup 成本/token/延迟/失败率/降级率', () => {
    const result = aggregateLedgerAttempts(
      unifiedAiInvocationLedgerFixtures(),
      'capability',
      window,
    )
    expect(result.empty).toBe(false)
    expect(result.costLabel).toBe('estimate')
    const draftBucket = result.buckets.find((b) => b.groupKey === 'draft')
    const ocrBucket = result.buckets.find((b) => b.groupKey === 'ocr')
    expect(draftBucket).toBeDefined()
    expect(draftBucket!.attemptCount).toBe(6) // success+fail+degraded+retry1+retry2+aborted
    expect(draftBucket!.failedCount).toBe(2) // failed + retry1
    expect(draftBucket!.degradedCount).toBeGreaterThanOrEqual(1)
    expect(draftBucket!.failureRate).toBeGreaterThan(0)
    expect(draftBucket!.estimatedCost).toBeGreaterThan(0)
    expect(ocrBucket!.attemptCount).toBe(1)
  })

  it('按 organization rollup 且两个组织互不混计', () => {
    const orgB = ledgerSuccessAttemptFixture({
      aiproj_organization_id: LEDGER_FIXTURE_ORG_B,
      aiproj_capability: 'risk',
    })
    const result = aggregateLedgerAttempts(
      [...unifiedAiInvocationLedgerFixtures(), orgB],
      'organization',
      window,
    )
    const a = result.buckets.find((b) => b.groupKey === String(LEDGER_FIXTURE_ORG_A))
    const b = result.buckets.find((x) => x.groupKey === String(LEDGER_FIXTURE_ORG_B))
    expect(a!.attemptCount).toBe(7)
    expect(b!.attemptCount).toBe(1)
    expect(b!.aiproj_capability).toBeUndefined() // 组织维度桶内无 capability 泄漏
  })

  it('聚合结果确定性：相同数据两次查询结果等价', () => {
    const a = aggregateLedgerAttempts(unifiedAiInvocationLedgerFixtures(), 'model', window)
    const b = aggregateLedgerAttempts(unifiedAiInvocationLedgerFixtures(), 'model', window)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('空数据窗口返回显式空态而非零故障假象', () => {
    const result = aggregateLedgerAttempts([], 'capability', window)
    expect(result.empty).toBe(true)
    expect(result.buckets).toEqual([])
  })

  it('有界窗口：默认 30 天边界生成', () => {
    const bounds = defaultLedgerWindowBounds(30, new Date('2026-08-16T00:00:00.000Z'))
    expect(bounds.startIso).toBe('2026-07-17T00:00:00.000Z')
    expect(bounds.endIso).toBe('2026-08-16T00:00:00.000Z')
  })

  it('缺失归属维度以显式 unknown 聚合（可报告未归属量）', () => {
    const unattributed = unifiedAiInvocationAttemptFixture({
      aiproj_project_id: null,
      aiproj_user_id: null,
      aiproj_capability: '',
    })
    const result = aggregateLedgerAttempts([unattributed], 'project', window)
    expect(result.buckets[0].groupKey).toBe('unknown')
    const byUser = aggregateLedgerAttempts([unattributed], 'user', window)
    expect(byUser.buckets[0].groupKey).toBe('unknown')
  })

  it('响应必须标明 estimated_cost 为估算', () => {
    const result = aggregateLedgerAttempts(
      unifiedAiInvocationLedgerFixtures(),
      'capability',
      window,
    )
    expect(result.costLabel).toBe('estimate')
    for (const bucket of result.buckets) {
      expect(bucket.currency === null || typeof bucket.currency === 'string').toBe(true)
    }
  })
})

// ── 2.9 缺失上下文显式 unknown 标记 ──
describe('缺失上下文显式 unknown 标记（task 4.4 / spec: Missing attribution is explicit）', () => {
  it('缺失归属在聚合中反映为 unknown 分组（见聚合测试）', () => {
    // 覆盖由 §6 聚合测试的「缺失归属维度以显式 unknown 聚合」用例承担
    expect(true).toBe(true)
  })
})
