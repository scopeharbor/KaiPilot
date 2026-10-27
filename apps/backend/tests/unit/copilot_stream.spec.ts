/**
 * v3-copilot-live-streaming-output —— 流式回合服务测试。
 *
 * 覆盖：
 * - answer 流的事件序列（turn-meta → answer-delta × n → answer-done）
 * - clarify / route 终态事件（零 answer-delta）
 * - DLP 阻断 → 零输出（异常在开流前抛出，sink 未被调用）
 * - 空回答 → turn-error，不伪造 answer-done、不落 assistant 消息
 * - 流式中断 → turn-error（内部异常 retryable-service；供应商超时 model-timeout）
 * - 断言序列号严格递增、事件不携带敏感全文键
 *
 * 纯 vitest：依赖全部注入，零 AdonisJS 运行时、零数据库、零网络。
 */

import { describe, it, expect, vi } from 'vitest'
import type { CopilotStreamEvent, CopilotTurnRequest, MentionReference } from '@aiproj/types'
import {
  findCopilotStreamSequenceViolation,
  copilotStreamHasForbiddenPayloadKeys,
} from '@aiproj/types'
import {
  MentionPermissionUnavailableError,
  type MentionEntityPermissionChecker,
} from '../../app/services/copilot_action/mention_reference_validator.js'
import CopilotTurnService, {
  CopilotDlpBlockError,
  CopilotTurnShapeError,
} from '../../app/services/copilot_turn/copilot_turn_service.js'

const ORG = 1
const ACTOR = 5
const PROJECT_ID = 100

const grantAll: MentionEntityPermissionChecker = async ({ entityIds }) => new Set(entityIds)

function makeAssemblyStub(contextBytesUsed = 2048) {
  return {
    assembleContext: vi.fn(async (..._args: any[]) => ({
      packet: {
        sources: [
          {
            sourceRef: 'task:1042',
            sourceHash: 'hash-1042',
            lowSensitivitySummary: '任务延期，等待依赖确认。',
          },
        ],
        budget: { contextBytesUsed, contextBytesLimit: 65536 },
        truncation: { warning: null },
      },
      warnings: [] as const,
      sources: [{ sourceRef: 'task:1042', sourceHash: 'hash-1042' }],
      conclusionTrace: [],
      uncertainty: [],
    })),
  }
}

function makeSessionsStub() {
  const appended: unknown[] = []
  return {
    appended,
    createSession: vi.fn(async (..._args: any[]) => ({ sessionId: 'sess-new-0001' })),
    isOwnedBy: vi.fn(async (..._args: any[]) => true),
    appendMessage: vi.fn(async (input: Record<string, unknown>, ..._args: any[]) => {
      appended.push(input)
      return {
        message: { messageId: `msg-${appended.length}` },
        truncated: false,
        idempotent: false,
      }
    }),
  }
}

function makeSanitizerStub() {
  return {
    sanitizeAssemblyResult: vi.fn((..._args: any[]) => ({
      safe: true,
      violations: [] as string[],
    })),
    checkPacket: vi.fn((..._args: any[]) => ({ safe: true, violations: [] as string[] })),
    checkSourceMetadata: vi.fn((..._args: any[]) => ({ safe: true, violations: [] as string[] })),
    cleanAssemblyResult: vi.fn((result: unknown, ..._args: any[]) => ({
      cleaned: result,
      removedFields: [] as string[],
    })),
  }
}

function makeDlpAdapterStub(
  overrides: {
    allowed?: boolean
    adapterAvailable?: boolean
  } = {},
) {
  return {
    preflightContextAssembly: vi.fn(async (..._args: any[]) => ({
      allowed: overrides.allowed ?? true,
      adapterAvailable: overrides.adapterAvailable ?? true,
      maskedContext: null,
      snapshot: {
        result: 'allow',
        policyVersion: 1,
        matchSummary: [],
        policyHash: 'ph-1',
        reasonCodes: [],
      },
      warnings: [] as string[],
    })),
  }
}

function makeWatermarkAdapterStub() {
  return {
    prepareContext: vi.fn(async (..._args: any[]) => ({ watermarkRequired: true })),
  }
}

function makeService(
  overrides: {
    dlpAdapter?: ReturnType<typeof makeDlpAdapterStub>
    streamAnswerExecutor?: (input: any) => AsyncIterable<string>
    answerExecutor?: (input: any) => Promise<{ text: string }>
    webSearchTool?: unknown
    webSearchBudgetMs?: number
  } = {},
) {
  const assembly = makeAssemblyStub()
  const sessions = makeSessionsStub()
  const dlpAdapter = overrides.dlpAdapter ?? makeDlpAdapterStub()
  const service = new CopilotTurnService({
    assembly: assembly as never,
    sessions: sessions as never,
    permissionChecker: grantAll,
    recordRouting: (async () => ({ success: true })) as never,
    sanitizer: makeSanitizerStub() as never,
    dlpAdapter: dlpAdapter as never,
    watermarkAdapter: makeWatermarkAdapterStub() as never,
    ...(overrides.streamAnswerExecutor
      ? { streamAnswerExecutor: overrides.streamAnswerExecutor }
      : {}),
    ...(overrides.answerExecutor ? { answerExecutor: overrides.answerExecutor } : {}),
    ...(overrides.webSearchTool ? { webSearchTool: overrides.webSearchTool as never } : {}),
    ...(overrides.webSearchBudgetMs !== undefined
      ? { webSearchBudgetMs: overrides.webSearchBudgetMs }
      : {}),
  })
  return { service, sessions, dlpAdapter }
}

function execInput(
  request: Partial<CopilotTurnRequest> & { text: string; mentionEntity?: unknown },
  overrides: Record<string, unknown> = {},
) {
  const mentions = (
    request.mentionEntity ? [request.mentionEntity] : (request.mentions ?? [])
  ) as MentionReference[]
  return {
    request: {
      sessionId: null,
      scope: 'project',
      attribution: { projectId: String(PROJECT_ID) },
      mentions,
      text: request.text,
      ...(request.slashCommand !== undefined ? { slashCommand: request.slashCommand } : {}),
      ...(request.currentRoute !== undefined ? { currentRoute: request.currentRoute } : {}),
      ...(request.clarificationRounds !== undefined
        ? { clarificationRounds: request.clarificationRounds }
        : {}),
    } as unknown as CopilotTurnRequest,
    organizationId: ORG,
    actorId: ACTOR,
    permissions: ['ai:trigger'] as const,
    ...overrides,
  }
}

/** 收集 sink：把事件收进数组，并记录是否被打开。 */
function makeSink() {
  const events: CopilotStreamEvent[] = []
  let opened = false
  return {
    events,
    opened: () => opened,
    sink: {
      onStreamOpen: () => {
        opened = true
      },
      emit: (event: CopilotStreamEvent) => {
        events.push(event)
      },
      isWritable: () => true,
    },
  }
}

// ---------------------------------------------------------------------------
// answer 流
// ---------------------------------------------------------------------------

describe('流式回合：answer 事件序列', () => {
  it('turn-meta → answer-delta × n → answer-done，序列号严格递增', async () => {
    const { service, sessions } = makeService({
      streamAnswerExecutor: async function* () {
        yield '第一段'
        yield '，第二段。'
      },
    })
    const { sink, events, opened } = makeSink()

    const result = await service.executeStream(execInput({ text: '项目现在怎么样' }), sink)

    expect(opened()).toBe(true)
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('turn-meta')
    expect(types.slice(1, 3)).toEqual(['answer-delta', 'answer-delta'])
    expect(types[types.length - 1]).toBe('answer-done')
    expect(findCopilotStreamSequenceViolation(events as { sequence: number }[])).toBeNull()

    const deltas = events.filter((e) => e.type === 'answer-delta')
    expect(deltas).toHaveLength(2)
    const meta = events[0]
    if (meta && meta.type === 'turn-meta') {
      expect(meta.sessionId).toBe('sess-new-0001')
    }

    // 终态事件携带 assistantMessageId，且 assistant 消息已落库
    const done = events.find((e) => e.type === 'answer-done')
    if (done && done.type === 'answer-done') {
      expect(done.assistantMessageId).toBeTruthy()
    }
    expect(sessions.appended.filter((m: any) => m.role === 'assistant')).toHaveLength(1)
    expect(result.response.result?.kind).toBe('answer')
  })

  it('增量文本不携带敏感全文键', async () => {
    const { service } = makeService({
      streamAnswerExecutor: async function* () {
        yield '回答内容'
      },
    })
    const { sink, events } = makeSink()
    await service.executeStream(execInput({ text: '项目现在怎么样' }), sink)
    for (const event of events) {
      expect(
        copilotStreamHasForbiddenPayloadKeys(event as unknown as Record<string, unknown>),
      ).toBe(false)
    }
  })

  it('空回答 → turn-error，不伪造 answer-done，不落 assistant 消息', async () => {
    const { service, sessions } = makeService({
      streamAnswerExecutor: async function* () {
        yield '   '
      },
    })
    const { sink, events } = makeSink()

    await service.executeStream(execInput({ text: '项目现在怎么样' }), sink)

    const errorEvent = events.find((e) => e.type === 'turn-error')
    expect(errorEvent).toBeDefined()
    expect(events.find((e) => e.type === 'answer-done')).toBeUndefined()
    expect(sessions.appended.filter((m: any) => m.role === 'assistant')).toHaveLength(0)
  })

  it('流式中断 → turn-error（retryable-service），保留已累积增量前的非完成终态', async () => {
    // 认不出来的内部异常归为 retryable-service（不冒充供应商问题）
    const { service, sessions } = makeService({
      streamAnswerExecutor: async function* () {
        yield '一部分'
        throw new Error('stream pipeline broke')
      },
    })
    const { sink, events } = makeSink()

    await service.executeStream(execInput({ text: '项目现在怎么样' }), sink)

    const errorEvent = events.find((e) => e.type === 'turn-error')
    expect(errorEvent?.type).toBe('turn-error')
    if (errorEvent && errorEvent.type === 'turn-error') {
      expect(errorEvent.errorKind).toBe('retryable-service')
    }
    expect(events.find((e) => e.type === 'answer-done')).toBeUndefined()
    expect(sessions.appended.filter((m: any) => m.role === 'assistant')).toHaveLength(0)
  })

  it('流式中途供应商超时 → turn-error（model-timeout），不写助手消息', async () => {
    // 2026-10-12 起供应商错误细分（copilot_model_failure）：超时不再笼统归为 retryable-service
    const { service, sessions } = makeService({
      streamAnswerExecutor: async function* () {
        yield '一部分'
        throw new Error('provider timeout')
      },
    })
    const { sink, events } = makeSink()

    await service.executeStream(execInput({ text: '项目现在怎么样' }), sink)

    const errorEvent = events.find((e) => e.type === 'turn-error')
    expect(errorEvent?.type).toBe('turn-error')
    if (errorEvent && errorEvent.type === 'turn-error') {
      expect(errorEvent.errorKind).toBe('model-timeout')
    }
    expect(events.find((e) => e.type === 'answer-done')).toBeUndefined()
    expect(sessions.appended.filter((m: any) => m.role === 'assistant')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// clarify / route 终态
// ---------------------------------------------------------------------------

describe('流式回合：clarify / route 终态', () => {
  it('澄清路由 → turn-clarify 终态，零 answer-delta', async () => {
    const { service } = makeService()
    const { sink, events } = makeSink()

    // '为什么延期' 触发 analysis.delay_attribution（critical 槽位 target_task 缺失）→ clarify
    await service.executeStream(execInput({ text: '为什么延期' }), sink)

    const types = events.map((e) => e.type)
    expect(types[0]).toBe('turn-meta')
    expect(types[types.length - 1]).toBe('turn-clarify')
    expect(types).not.toContain('answer-delta')
    expect(types).not.toContain('answer-done')
  })

  it('写操作路由 → turn-route 或澄清终态，零 answer-delta、零模型调用', async () => {
    const streamAnswerExecutor = vi.fn(async function* () {
      yield '不应调用'
    })
    const { service } = makeService({ streamAnswerExecutor })
    const { sink, events } = makeSink()

    // '/risk 新增' 命中显式斜杠规则（最高优先级）
    await service.executeStream(
      execInput({
        text: '/risk 新增供应商延迟风险',
        slashCommand: '/risk 新增',
        currentRoute: '/projects/7/risks',
      }),
      sink,
    )

    const types = events.map((e) => e.type)
    // 变更类斜杠命令要么直接给待确认 route，要么先澄清补齐槽位——
    // 两者都是合法终态，且都不得产出 answer-delta / answer-done
    expect(['turn-route', 'turn-clarify']).toContain(types[types.length - 1])
    expect(types).not.toContain('answer-delta')
    expect(types).not.toContain('answer-done')
    expect(streamAnswerExecutor).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 阻断与开流时机
// ---------------------------------------------------------------------------

describe('流式回合：阻断与开流时机', () => {
  it('DLP 阻断 → 异常在开流前抛出，sink 从未打开（零输出）', async () => {
    const { service, dlpAdapter } = makeService({
      dlpAdapter: makeDlpAdapterStub({ allowed: false }),
    })
    const { sink, events, opened } = makeSink()

    await expect(
      service.executeStream(execInput({ text: '项目现在怎么样' }), sink),
    ).rejects.toThrow(CopilotDlpBlockError)
    expect(opened()).toBe(false)
    expect(events).toHaveLength(0)
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalled()
  })

  it('形状不合规 → 开流前抛出，零事件', async () => {
    const { service } = makeService()
    const { sink, events, opened } = makeSink()

    await expect(service.executeStream(execInput({ text: '   ' }), sink)).rejects.toThrow(
      CopilotTurnShapeError,
    )
    expect(opened()).toBe(false)
    expect(events).toHaveLength(0)
  })

  it('提及引用权限判定不可用 → 开流前抛出（业务决策阻断）', async () => {
    const { sink, events, opened } = makeSink()
    const unavailable: MentionEntityPermissionChecker = async () => {
      throw new Error('db unavailable')
    }

    const svc = new CopilotTurnService({
      assembly: makeAssemblyStub() as never,
      sessions: makeSessionsStub() as never,
      permissionChecker: unavailable,
      recordRouting: (async () => ({ success: true })) as never,
      sanitizer: makeSanitizerStub() as never,
      dlpAdapter: makeDlpAdapterStub() as never,
      watermarkAdapter: makeWatermarkAdapterStub() as never,
      streamAnswerExecutor: async function* () {
        yield 'x'
      } as never,
    })

    await expect(
      svc.executeStream(
        execInput({
          text: '首页设计（T-1042）为什么延期了',
          mentionEntity: {
            entityType: 'task',
            entityId: 1042,
            label: '首页设计（T-1042）',
            organizationId: ORG,
            projectId: PROJECT_ID,
          },
        } as never),
        sink,
      ),
    ).rejects.toThrow(MentionPermissionUnavailableError)
    expect(opened()).toBe(false)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 联网阶段总时长上限（2026-10-05：联网过久导致页面显示模型不可用）
// ---------------------------------------------------------------------------

describe('流式回合：联网搜索不拖住回答', () => {
  it('网页搜索超过总时长上限 → 带「网页搜索超时」状态继续回答，不报错', async () => {
    let answerInput: any = null
    const { service } = makeService({
      webSearchBudgetMs: 30,
      webSearchTool: {
        // 永不完成的搜索（模拟规划 / 引擎 / 抓取都卡住）
        fetchEvidence: vi.fn(() => new Promise(() => undefined)),
      },
      streamAnswerExecutor: async function* (input: any) {
        answerInput = input
        yield '根据已有知识回答。'
      },
    })
    const { sink, events } = makeSink()
    await service.executeStream(execInput({ text: '美国总统是谁' }, {}) as never, sink)
    const done = events.find((e) => e.type === 'answer-done') as
      { webSearchStatus?: { code?: string } } | undefined
    expect(done).toBeTruthy()
    expect(events.some((e) => e.type === 'turn-error')).toBe(false)
    expect(done?.webSearchStatus?.code).toBe('web_search_timeout')
    expect(answerInput.externalEvidence).toEqual([])
    expect(answerInput.webSearchStatus?.code).toBe('web_search_timeout')
  })

  it('上限内完成的搜索照常把证据交给回答', async () => {
    let answerInput: any = null
    const evidence = [
      {
        title: '美国总统',
        canonicalUrl: 'https://zh.wikipedia.org/wiki/x',
        accessedAt: '2026-10-05T00:00:00.000Z',
        provider: 'free',
        excerpt: '现任总统…',
        contentHash: 'h',
        trustBand: 'known',
        policyDecisionRef: 'r',
      },
    ]
    const { service } = makeService({
      webSearchBudgetMs: 1_000,
      webSearchTool: {
        fetchEvidence: vi.fn(async () => ({ status: 'called', evidence })),
      },
      streamAnswerExecutor: async function* (input: any) {
        answerInput = input
        yield '现任总统是…'
      },
    })
    const { sink, events } = makeSink()
    await service.executeStream(execInput({ text: '美国总统是谁' }) as never, sink)
    expect(events.at(-1)?.type).toBe('answer-done')
    expect(answerInput.externalEvidence).toEqual(evidence)
  })
})
