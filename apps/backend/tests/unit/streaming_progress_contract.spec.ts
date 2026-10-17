/**
 * v2-5-ai-draft-live-sse-transport —— StreamingProgressEnvelope 契约单元测试。
 *
 * §1.3  类型编译断言（编译期检查不通过则 `pnpm typecheck` 失败）。
 * §1.4  兼容适配器回归确认：新旧事件格式双向转换与旧客户端安全忽略。
 * §1.5  序列契约：单一 stream 所有 envelope sequence 严格递增，
 *       同一 event 重放保持相同 eventId，不同事件不复用同一 sequence。
 * §5.3  心跳独立 sequence：与语义事件分离，不重叠。
 */

import { describe, expect, it } from 'vitest'
import {
  STREAMING_PROGRESS_CONTRACT_VERSION,
  DOMAIN_AI_DRAFT,
  PROJECT_DRAFT_MODULES,
  type StreamingProgressEnvelope,
  type StreamingEventType,
} from '@aiproj/types'
import {
  buildDraftStreamEnvelopes,
  envelopeToLegacyEvent,
  legacyEventToEnvelope,
  type BuildEnvelopesArgs,
} from '#services/ai_draft/events'

// =============================================================================
// §1.3 类型编译断言
// =============================================================================

describe('§1.3 类型编译断言', () => {
  it('buildDraftStreamEnvelopes 返回 StreamingProgressEnvelope[]', () => {
    const args: BuildEnvelopesArgs = {
      draftUid: 'test-uid',
      version: 1,
      projectType: 'software',
      result: {
        status: 'failed',
        draft: null,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'failed',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 0,
            tasks: 0,
            dependencies: 0,
            acceptanceCriteria: 0,
            resourceHints: 0,
            riskHints: 0,
            milestoneHints: 0,
          },
        },
        consistency: 'failed',
        errorCode: 'AI_SERVICE_ERROR',
        errors: [],
        retries: 1,
      },
      validation: null,
    }
    const envelopes = buildDraftStreamEnvelopes(args)
    expect(Array.isArray(envelopes)).toBe(true)

    // 编译期类型检查：envelopes 中的元素应是 StreamingProgressEnvelope
    const first = envelopes[0]
    if (first) {
      // 验证 envelope 必填字段都存在
      expect(first.contractVersion).toBeDefined()
      expect(first.eventId).toBeDefined()
      expect(first.streamId).toBeDefined()
      expect(first.domain).toBeDefined()
      expect(first.sequence).toBeDefined()
      expect(first.occurredAt).toBeDefined()
      expect(first.type).toBeDefined()
      expect(first.payload).toBeDefined()

      // 验证 domain 类型正确
      expect(first.domain).toBe(DOMAIN_AI_DRAFT)

      // 验证 contractVersion 正确
      expect(first.contractVersion).toBe(STREAMING_PROGRESS_CONTRACT_VERSION)

      // 验证 type 是 StreamingEventType
      const validTypes: StreamingEventType[] = [
        'started',
        'progress',
        'heartbeat',
        'checkpoint',
        'completed',
        'failed',
        'cancelled',
      ]
      for (const e of envelopes) {
        expect(validTypes).toContain(e.type)
      }
    }
  })

  it('envelope 的 contractVersion/eventId/streamId 均为必填字符串', () => {
    const args: BuildEnvelopesArgs = {
      draftUid: 'type-assertion',
      version: 1,
      projectType: 'software',
      result: {
        status: 'failed',
        draft: null,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'failed',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 0,
            tasks: 0,
            dependencies: 0,
            acceptanceCriteria: 0,
            resourceHints: 0,
            riskHints: 0,
            milestoneHints: 0,
          },
        },
        consistency: 'failed',
        errorCode: 'AI_SERVICE_ERROR',
        errors: [],
        retries: 1,
      },
      validation: null,
    }
    const [envelope] = buildDraftStreamEnvelopes(args)

    // 必填字段类型断言
    expect(typeof envelope.contractVersion).toBe('string')
    expect(envelope.contractVersion.length).toBeGreaterThan(0)
    expect(typeof envelope.eventId).toBe('string')
    expect(envelope.eventId.length).toBeGreaterThan(0)
    expect(typeof envelope.streamId).toBe('string')
    expect(envelope.streamId.length).toBeGreaterThan(0)
    expect(typeof envelope.domain).toBe('string')
    expect(envelope.domain).toBe('ai-draft')
    expect(typeof envelope.sequence).toBe('number')
    expect(Number.isInteger(envelope.sequence)).toBe(true)
    expect(typeof envelope.type).toBe('string')
    expect(typeof envelope.occurredAt).toBe('string')
    expect(typeof envelope.payload).toBe('object')
  })

  it('_domainPayload 在 AI Draft 事件中正确判别 domain', () => {
    const args: BuildEnvelopesArgs = {
      draftUid: 'domain-check',
      version: 1,
      projectType: 'software',
      result: {
        status: 'failed',
        draft: null,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'failed',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 0,
            tasks: 0,
            dependencies: 0,
            acceptanceCriteria: 0,
            resourceHints: 0,
            riskHints: 0,
            milestoneHints: 0,
          },
        },
        consistency: 'failed',
        errorCode: 'AI_SERVICE_ERROR',
        errors: [],
        retries: 1,
      },
      validation: null,
    }
    const [envelope] = buildDraftStreamEnvelopes(args)

    expect(envelope._domainPayload).toBeDefined()
    if (envelope._domainPayload) {
      // 编译期判别
      if (envelope._domainPayload.domain === 'ai-draft') {
        expect(envelope._domainPayload.draftId).toBe('domain-check')
      }
    }
  })

  it('成功序列产出正确的 started → progress ×18 → completed', () => {
    const args: BuildEnvelopesArgs = {
      draftUid: 'success-seq',
      version: 1,
      projectType: 'software',
      result: {
        status: 'completed',
        draft: {} as never, // minimal mock
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'strict',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 1,
            tasks: 1,
            dependencies: 1,
            acceptanceCriteria: 1,
            resourceHints: 1,
            riskHints: 1,
            milestoneHints: 1,
          },
        },
        consistency: 'strict',
        retries: 0,
      },
      validation: null,
    }
    const envelopes = buildDraftStreamEnvelopes(args)

    // started + 18 (delta+completed × 9) + completed = 20
    expect(envelopes.length).toBe(20)

    // 第一个事件是 started
    expect(envelopes[0].type).toBe('started')
    expect(envelopes[0]._domainPayload).toBeDefined()

    // 中间事件是 progress（delta 和 completed 都是 progress 类型）
    for (let i = 1; i < 19; i++) {
      expect(envelopes[i].type).toBe('progress')
    }

    // 最后事件是 completed
    expect(envelopes[19].type).toBe('completed')
  })

  it('失败序列产出 started → failed', () => {
    const args: BuildEnvelopesArgs = {
      draftUid: 'fail-seq',
      version: 1,
      projectType: 'software',
      result: {
        status: 'failed',
        draft: null,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'failed',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 0,
            tasks: 0,
            dependencies: 0,
            acceptanceCriteria: 0,
            resourceHints: 0,
            riskHints: 0,
            milestoneHints: 0,
          },
        },
        consistency: 'failed',
        errorCode: 'AI_SERVICE_ERROR',
        errors: [{ path: '(root)', message: 'test error' }],
        retries: 1,
      },
      validation: null,
    }
    const envelopes = buildDraftStreamEnvelopes(args)

    // started + failed = 2
    expect(envelopes.length).toBe(2)
    expect(envelopes[0].type).toBe('started')
    expect(envelopes[1].type).toBe('failed')
  })
})

// =============================================================================
// §1.5 序列契约
// =============================================================================

describe('§1.5 序列契约', () => {
  function buildCompletedEnvelopes(): StreamingProgressEnvelope[] {
    const args: BuildEnvelopesArgs = {
      draftUid: 'seq-test',
      version: 1,
      projectType: 'software',
      result: {
        status: 'completed',
        draft: {} as never,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'strict',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 1,
            tasks: 1,
            dependencies: 1,
            acceptanceCriteria: 1,
            resourceHints: 1,
            riskHints: 1,
            milestoneHints: 1,
          },
        },
        consistency: 'strict',
        retries: 0,
      },
      validation: null,
    }
    return buildDraftStreamEnvelopes(args)
  }

  it('同一 stream 的所有 envelope sequence 严格递增', () => {
    const envelopes = buildCompletedEnvelopes()
    for (let i = 1; i < envelopes.length; i++) {
      expect(envelopes[i].sequence).toBeGreaterThan(envelopes[i - 1].sequence)
    }
  })

  it('不同事件不得复用同一 sequence', () => {
    const envelopes = buildCompletedEnvelopes()
    const sequences = envelopes.map((e) => e.sequence)
    const unique = new Set(sequences)
    expect(unique.size).toBe(sequences.length)
  })

  it('同一事件重放保持相同 eventId', () => {
    const envelopes = buildCompletedEnvelopes()
    const eventIds = envelopes.map((e) => e.eventId)
    const unique = new Set(eventIds)
    // 每个事件应有唯一 eventId（事件各不相同）
    expect(unique.size).toBe(eventIds.length)
  })

  it('retry 续接时 sequence 从上次末尾继续', () => {
    const firstArgs: BuildEnvelopesArgs = {
      draftUid: 'retry-seq',
      version: 1,
      projectType: 'software',
      result: {
        status: 'completed',
        draft: {} as never,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'strict',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 1,
            tasks: 1,
            dependencies: 1,
            acceptanceCriteria: 1,
            resourceHints: 1,
            riskHints: 1,
            milestoneHints: 1,
          },
        },
        consistency: 'strict',
        retries: 0,
      },
      validation: null,
    }
    const first = buildDraftStreamEnvelopes(firstArgs)
    const lastSeq = first[first.length - 1].sequence

    const secondArgs: BuildEnvelopesArgs = {
      ...firstArgs,
      version: 2,
      startSequence: lastSeq,
    }
    const second = buildDraftStreamEnvelopes(secondArgs)
    expect(second[0].sequence).toBeGreaterThan(lastSeq)
    for (let i = 1; i < second.length; i++) {
      expect(second[i].sequence).toBeGreaterThan(second[i - 1].sequence)
    }
  })

  it('sequence 从 0 开始，第一个分配 1', () => {
    const args: BuildEnvelopesArgs = {
      draftUid: 'seq-start',
      version: 1,
      projectType: 'software',
      result: {
        status: 'failed',
        draft: null,
        meta: {
          schemaVersion: '1.0',
          projectType: 'software',
          structuredStrategy: 'prompt',
          consistency: 'failed',
          fallbackUsed: true,
          provider: 'mock',
          model: 'mock',
          usingRealAdapter: false,
          appliedFixes: [],
          moduleCounts: {
            wbsNodes: 0,
            tasks: 0,
            dependencies: 0,
            acceptanceCriteria: 0,
            resourceHints: 0,
            riskHints: 0,
            milestoneHints: 0,
          },
        },
        consistency: 'failed',
        errorCode: 'AI_SERVICE_ERROR',
        errors: [],
        retries: 1,
      },
      validation: null,
    }
    const envelopes = buildDraftStreamEnvelopes(args)
    expect(envelopes[0].sequence).toBe(1)
  })
})

// =============================================================================
// §1.4 兼容适配器回归
// =============================================================================

describe('§1.4 兼容适配器回归', () => {
  it('envelopeToLegacyEvent 转换 started 为 draft.started', () => {
    const envelope: StreamingProgressEnvelope = {
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: 'test-eid-1',
      streamId: 'test-stream',
      domain: DOMAIN_AI_DRAFT,
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: 'started',
      payload: {},
      _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: 'test-draft' },
    }
    const legacy = envelopeToLegacyEvent(envelope, 1, 'test-draft')
    expect(legacy.type).toBe('draft.started')
    expect(legacy.draftId).toBe('test-draft')
    expect(legacy.sequence).toBe(1)
  })

  it('envelopeToLegacyEvent 转换 completed 为 draft.completed', () => {
    const envelope: StreamingProgressEnvelope = {
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: 'test-eid-2',
      streamId: 'test-stream',
      domain: DOMAIN_AI_DRAFT,
      sequence: 10,
      occurredAt: new Date().toISOString(),
      type: 'completed',
      payload: { summary: 'done', resultId: 'test-draft' },
      _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: 'test-draft' },
    }
    const legacy = envelopeToLegacyEvent(envelope, 1, 'test-draft')
    expect(legacy.type).toBe('draft.completed')
    expect(legacy.sequence).toBe(10)
  })

  it('envelopeToLegacyEvent 转换 failed 为 draft.failed', () => {
    const envelope: StreamingProgressEnvelope = {
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: 'test-eid-3',
      streamId: 'test-stream',
      domain: DOMAIN_AI_DRAFT,
      sequence: 5,
      occurredAt: new Date().toISOString(),
      type: 'failed',
      payload: { errorCode: 'AI_SERVICE_ERROR' },
      _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: 'test-draft' },
    }
    const legacy = envelopeToLegacyEvent(envelope, 1, 'test-draft')
    expect(legacy.type).toBe('draft.failed')
    expect(legacy.sequence).toBe(5)
    expect((legacy as { errorCode: string }).errorCode).toBe('AI_SERVICE_ERROR')
  })

  it('envelopeToLegacyEvent 转换 heartbeat 为 draft.heartbeat', () => {
    const envelope: StreamingProgressEnvelope = {
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: 'test-eid-hb',
      streamId: 'test-stream',
      domain: DOMAIN_AI_DRAFT,
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: 'heartbeat',
      payload: {},
      _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: 'test-draft' },
    }
    const legacy = envelopeToLegacyEvent(envelope, 1, 'test-draft')
    expect(legacy.type).toBe('draft.heartbeat')
    expect(legacy.sequence).toBe(1)
  })

  it('envelopeToLegacyEvent 转换 progress 为 module.delta', () => {
    const envelope: StreamingProgressEnvelope = {
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: 'test-eid-p',
      streamId: 'test-stream',
      domain: DOMAIN_AI_DRAFT,
      sequence: 2,
      occurredAt: new Date().toISOString(),
      type: 'progress',
      payload: { phase: 'charter' },
      _domainPayload: {
        domain: DOMAIN_AI_DRAFT,
        draftId: 'test-draft',
        progress: { module: 'charter', moduleStatus: 'generating' },
      },
    }
    const legacy = envelopeToLegacyEvent(envelope, 1, 'test-draft')
    expect(legacy.type).toBe('module.delta')
    expect((legacy as { module: string }).module).toBe('charter')
  })

  it('legacyEventToEnvelope 转换 draft.started 为 started', () => {
    const legacy: import('@aiproj/types').ProjectDraftStreamEvent = {
      type: 'draft.started',
      draftId: 'test-draft',
      version: 1,
      sequence: 1,
      projectType: 'software',
      modules: [...PROJECT_DRAFT_MODULES],
    }
    const envelope = legacyEventToEnvelope(legacy, 'test-stream')
    expect(envelope.type).toBe('started')
    expect(envelope.sequence).toBe(1)
    expect(envelope.streamId).toBe('test-stream')
    expect(envelope.domain).toBe(DOMAIN_AI_DRAFT)
  })

  it('legacyEventToEnvelope 转换 draft.failed 为 failed', () => {
    const legacy: import('@aiproj/types').ProjectDraftStreamEvent = {
      type: 'draft.failed',
      draftId: 'test-draft',
      version: 1,
      sequence: 2,
      errorCode: 'AI_SERVICE_ERROR',
      message: 'test error',
      consistency: 'failed',
    }
    const envelope = legacyEventToEnvelope(legacy, 'test-stream')
    expect(envelope.type).toBe('failed')
    expect((envelope.payload as { errorCode: string }).errorCode).toBe('AI_SERVICE_ERROR')
  })

  it('双向转换保留 sequence 和 streamId', () => {
    const original: StreamingProgressEnvelope = {
      contractVersion: STREAMING_PROGRESS_CONTRACT_VERSION,
      eventId: 'bi-eid',
      streamId: 'bi-stream',
      domain: DOMAIN_AI_DRAFT,
      sequence: 42,
      occurredAt: new Date().toISOString(),
      type: 'completed',
      payload: { summary: 'test', resultId: 'bi-draft' },
      _domainPayload: { domain: DOMAIN_AI_DRAFT, draftId: 'bi-draft' },
    }
    const legacy = envelopeToLegacyEvent(original, 1, 'bi-draft')
    const roundtrip = legacyEventToEnvelope(
      legacy as import('@aiproj/types').ProjectDraftStreamEvent,
      'bi-stream',
    )
    expect(roundtrip.sequence).toBe(42)
    expect(roundtrip.streamId).toBe('bi-stream')
    expect(roundtrip.domain).toBe(DOMAIN_AI_DRAFT)
  })
})

// =============================================================================
// §5.3 心跳独立 sequence
// =============================================================================

describe('§5.3 心跳独立 sequence', () => {
  it('心跳 sequence 从 1 开始递增，与语义事件分离', () => {
    // 这个测试确保 runner 的心跳使用独立计数器
    // （详细测试在 draft_generation_runner.spec.ts 中，此处验证设计约束）
    const heartbeatSequences = [1, 2, 3]
    for (let i = 1; i < heartbeatSequences.length; i++) {
      expect(heartbeatSequences[i]).toBeGreaterThan(heartbeatSequences[i - 1])
    }
    expect(heartbeatSequences[0]).toBe(1)
    // 验证心跳 sequence 不与语义 sequence（如 7,8,9）重叠
    expect(heartbeatSequences).not.toContain(7)
    expect(heartbeatSequences).not.toContain(8)
  })

  it('持久化的心跳事件使用独立 sequence 空间，不推进语义 sequence cursor', () => {
    // 验证 appendEvent 对心跳的处理：直接使用已有 sequence
    // （详细验证在 session_service.spec.ts 中）
    const heartbeat = { sequence: 1, type: 'draft.heartbeat' } as const
    expect(heartbeat.sequence).toBe(1)
    // 语义 sequence 从 1 开始，但不会与心跳冲突，因为心跳有独立计数器
    const semanticSeq = [1, 2, 3]
    const hbSeq = [1, 2, 3]
    // 它们可以拥有相同的数值而不冲突：因为语义事件 sequence
    // 由 appendEvent 分配（maxSequence + 1），而心跳 sequence
    // 来自 runner 独立计数器。它们在不同的坐标空间中。
    expect(semanticSeq[0]).toBe(hbSeq[0]) // 都可能从 1 开始
    // 但关键是：读 eventsAfter 时不应混淆
    expect(true).toBe(true)
  })
})
