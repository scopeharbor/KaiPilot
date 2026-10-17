/**
 * v3-copilot-authoritative-page-context —— 回合服务权威事实接线测试
 * （任务 2.2 / design §F 断言 1–5）。
 *
 * 覆盖：
 * - F1：answerExecutor 收到 `tasks.total=8` 等 exact value，而非「task source hit 8」
 * - F2：非流式与 SSE 首次模型调用输入完全等价（contextFacts + disclosure）
 * - F3：伪造另一组织 projectId 时，executor 输入/披露/响应均无 foreign id、无事实
 * - F5：项目 API 失败 → disclosure status=context_unavailable，不生成伪项目事实
 * - 意图 facet 选择（design §E）：问候不带项目事实；自然问法带相关切面
 *
 * 纯 vitest：依赖全部注入，零数据库、零网络、零真实模型。
 */
import { describe, it, expect, vi } from 'vitest'
import type {
  CopilotContextFact,
  CopilotPageContextDescriptorV1,
  CopilotTurnRequest,
} from '@aiproj/types'
import CopilotTurnService, {
  type CopilotAnswerExecutorInput,
} from '../../app/services/copilot_turn/copilot_turn_service.js'
import { CopilotPageContextResolver } from '../../app/services/copilot/copilot_page_context_resolver.js'
import { COPILOT_PAGE_CONTEXT_PRIVACY_NOTE } from '@aiproj/types'

const ORG = 1
const ACTOR = 5
const PROJECT_ID = 100

// ---------------------------------------------------------------------------
// 测试替身（与 copilot_turn_service.spec.ts 同构）
// ---------------------------------------------------------------------------

function makeAssemblyStub(contextFacts: readonly CopilotContextFact[]) {
  return {
    assembleContext: vi.fn(async () => ({
      packet: {
        sources: [
          {
            sourceRef: 'task:1042',
            sourceHash: 'hash-1042',
            lowSensitivitySummary: '任务延期，等待依赖确认。',
          },
        ],
        budget: { contextBytesUsed: 2048, contextBytesLimit: 65536 },
        truncation: { warning: null },
      },
      warnings: [] as const,
      sources: [{ sourceRef: 'task:1042', sourceHash: 'hash-1042' }],
      conclusionTrace: [],
      uncertainty: [],
      contextFacts,
    })),
  }
}

function makeSessionsStub() {
  const appended: unknown[] = []
  return {
    appended,
    createSession: vi.fn(async () => ({ sessionId: 'sess-new-0001' })),
    isOwnedBy: vi.fn(async (..._args: any[]) => true),
    appendMessage: vi.fn(async (input: Record<string, unknown>) => {
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
    sanitizeAssemblyResult: vi.fn(() => ({ safe: true, violations: [] as string[] })),
    checkPacket: vi.fn(() => ({ safe: true, violations: [] as string[] })),
    checkSourceMetadata: vi.fn(() => ({ safe: true, violations: [] as string[] })),
    cleanAssemblyResult: vi.fn((result: unknown) => ({
      cleaned: result,
      removedFields: [] as string[],
    })),
  }
}

function makeDlpAdapterStub() {
  return {
    preflightContextAssembly: vi.fn(async () => ({
      allowed: true,
      adapterAvailable: true,
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
    prepareContext: vi.fn(async () => ({ watermarkRequired: true, templateHash: 'th-1' })),
  }
}

function makeResolver(
  overrides: {
    allowedProjectIds?: readonly number[]
    findProject?: (projectId: number, organizationId: number) => Promise<unknown | null>
  } = {},
) {
  return new CopilotPageContextResolver({
    findProject: overrides.findProject ?? (async () => ({ id: PROJECT_ID, name: '项目A' })),
    allowedProjectIds: overrides.allowedProjectIds ?? [PROJECT_ID],
  })
}

/** 页面语境描述符（Kanban，status=blocked）。 */
function makeDescriptor(
  overrides: Partial<CopilotPageContextDescriptorV1> = {},
): CopilotPageContextDescriptorV1 {
  return {
    version: 1,
    routeId: 'project-kanban',
    pathname: `/projects/${PROJECT_ID}/(views)/kanban`,
    projectId: PROJECT_ID,
    viewId: 'kanban',
    filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
    routeRevision: 'rev-1',
    ...overrides,
  }
}

/** 能与项目事实同处的行级风险事实（facet=risk）。 */
const projectFacts: readonly CopilotContextFact[] = [
  {
    factKey: 'tasks.total',
    value: 8,
    displayLabel: '任务总数',
    facet: 'taskStatus',
    sourceRef: 'project:100/tasks',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'tasks.byStatus',
    value: { done: 2, blocked: 1 },
    displayLabel: '任务状态分布',
    facet: 'taskStatus',
    sourceRef: 'project:100/tasks',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'risks.total',
    value: 3,
    displayLabel: '风险总数',
    facet: 'risk',
    sourceRef: 'project:100/panorama',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
]

function makeService(
  overrides: {
    answerExecutor?: (input: CopilotAnswerExecutorInput) => Promise<{ text: string }>
    streamAnswerExecutor?: (input: CopilotAnswerExecutorInput) => AsyncIterable<string>
    resolver?: CopilotPageContextResolver
    assembly?: ReturnType<typeof makeAssemblyStub>
    pageContextEnabled?: boolean
  } = {},
) {
  const assembly = overrides.assembly ?? makeAssemblyStub([])
  const sessions = makeSessionsStub()
  const service = new CopilotTurnService({
    assembly: assembly as never,
    sessions: sessions as never,
    permissionChecker: (async ({ entityIds }: any) => new Set(entityIds)) as never,
    recordRouting: (async () => ({ success: true })) as never,
    sanitizer: makeSanitizerStub() as never,
    dlpAdapter: makeDlpAdapterStub() as never,
    watermarkAdapter: makeWatermarkAdapterStub() as never,
    answerExecutor: overrides.answerExecutor ?? (async () => ({ text: '答案' })),
    ...(overrides.streamAnswerExecutor
      ? { streamAnswerExecutor: overrides.streamAnswerExecutor }
      : {}),
    ...(overrides.resolver ? { pageContextResolver: overrides.resolver } : {}),
    ...(overrides.pageContextEnabled !== undefined
      ? { pageContextEnabled: overrides.pageContextEnabled }
      : {}),
  })
  return { service, sessions }
}

function execInput(
  request:
    CopilotTurnRequest | (Record<string, unknown> & { attribution?: Record<string, unknown> }),
) {
  return {
    request: {
      ...request,
      attribution: {
        ...(((request as Record<string, unknown>).attribution as Record<string, unknown>) ?? {}),
        projectId: String(PROJECT_ID),
      },
    } as never,
    organizationId: ORG,
    actorId: ACTOR,
    permissions: ['ai:trigger'] as const,
  }
}

/** 捕获 executor 输入。 */
function capturingExecutor() {
  const inputs: CopilotAnswerExecutorInput[] = []
  return {
    inputs,
    executor: async (input: CopilotAnswerExecutorInput) => {
      inputs.push(input)
      return { text: '这是基于已授权上下文的真实回答。' }
    },
  }
}

// ---------------------------------------------------------------------------
// F1：exact values 到达 executor
// ---------------------------------------------------------------------------

describe('F1：executor 收到精确事实值与披露', () => {
  it('自然问法「当前项目完成了多少」→ contextFacts 含 tasks.total=8（facet 选中 taskStatus）', async () => {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(projectFacts),
      resolver: makeResolver(),
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '当前项目完成了多少？',
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )

    const input = cap.inputs[0]
    const facts = input.contextFacts ?? []
    const total = facts.find((f) => f.factKey === 'tasks.total')
    expect(total?.value).toBe(8)
    expect(total?.facet).toBe('taskStatus')
    const byStatus = facts.find((f) => f.factKey === 'tasks.byStatus')
    expect(byStatus?.value).toEqual({ done: 2, blocked: 1 })
    // 断言没有「task source hit 8」式的元数据摘要被当成事实
    expect(JSON.stringify(input)).not.toContain('hit 8')
    expect(JSON.stringify(input)).not.toContain('source hit')
  })

  it('问候语（无 facet 命中）→ 不强制项目事实', async () => {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(projectFacts),
      resolver: makeResolver(),
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '请问有哪些文档', // 不命中任何 facet 关键词
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    // 未进 answer 分支（改为澄清）时零调用；进 answer 分支时 facts 恒为空
    const input = cap.inputs[0]
    if (input) {
      expect(input.contextFacts ?? []).toEqual([])
    }
  })

  it('响应携带 pageContextDisclosure（routeId/项目/筛选/时间/状态/隐私说明）', async () => {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(projectFacts),
      resolver: makeResolver(),
    })
    const result = await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '有哪些阻塞？',
        mentions: [],
        pageContext: makeDescriptor({ filters: [{ key: 'status', op: 'eq', value: 'blocked' }] }),
      }),
    )
    const disclosure = result.response.pageContextDisclosure
    expect(disclosure?.status).toBe('ready')
    expect(disclosure?.projectId).toBe(PROJECT_ID)
    expect(disclosure?.routeId).toBe('project-kanban')
    expect(disclosure?.filters).toEqual([{ key: 'status', op: 'eq', value: 'blocked' }])
    expect(disclosure?.observedAt).toBeTruthy()
    expect(disclosure?.privacyNote).toBe(COPILOT_PAGE_CONTEXT_PRIVACY_NOTE)
  })
})

// ---------------------------------------------------------------------------
// F3：跨组织伪造 projectId 零泄露
// ---------------------------------------------------------------------------

describe('F3：伪造项目（另一组织）→ executor/响应零泄露', () => {
  it('descriptor.projectId=999 不在可访问集合 → context_unavailable，无 foreign id、无该项目事实', async () => {
    const cap = capturingExecutor()
    const foreign = makeDescriptor({ projectId: 999, pathname: '/projects/999/(views)/kanban' })
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(projectFacts),
      resolver: makeResolver({ allowedProjectIds: [PROJECT_ID] }),
    })
    const result = await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '这个项目有多少任务？',
        mentions: [],
        pageContext: foreign,
      }),
    )

    const disclosure = result.response.pageContextDisclosure
    expect(disclosure?.status).toBe('context_unavailable')
    expect(disclosure?.projectId).toBeUndefined()
    // 响应里不得出现伪造项目 ID
    expect(JSON.stringify(result.response)).not.toContain('999')
    // executor 输入里也不得出现（无该项目的任何 title/count/ref）
    const serialized = JSON.stringify(cap.inputs[0])
    expect(serialized).not.toContain('999')
    expect(cap.inputs[0].pageContextDisclosure?.status).toBe('context_unavailable')
  })
})

// ---------------------------------------------------------------------------
// F5：项目 API 失败 → context_unavailable，不编造
// ---------------------------------------------------------------------------

describe('F5：项目 API 不可用 → 显式不可用', () => {
  it('findProject 抛错 → disclosure.status=context_unavailable，不生成伪事实', async () => {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub([]),
      resolver: makeResolver({
        findProject: async () => {
          throw new Error('db down')
        },
      }),
    })
    const result = await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '风险有哪些？',
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    const disclosure = result.response.pageContextDisclosure
    expect(disclosure?.status).toBe('context_unavailable')
    expect(disclosure?.projectId).toBeUndefined()
    // 没有任何「当前项目/风险共 N 个」式的伪事实
    expect(cap.inputs[0].contextFacts ?? []).toEqual([])
  })

  it('项目不存在（findProject 返回 null）→ 同样 context_unavailable', async () => {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub([]),
      resolver: makeResolver({ findProject: async () => null }),
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '进度如何？',
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    expect(cap.inputs[0].pageContextDisclosure?.status).toBe('context_unavailable')
  })
})

// ---------------------------------------------------------------------------
// F2：非流式与 SSE 首次模型调用输入完全等价
// ---------------------------------------------------------------------------

describe('F2：execute 与 executeStream 共享同一 contract', () => {
  it('两种情况给模型的 contextFacts 与 pageContextDisclosure 完全一致', async () => {
    const nonStream: CopilotAnswerExecutorInput[] = []
    const stream: CopilotAnswerExecutorInput[] = []
    const request = {
      sessionId: null,
      scope: 'project' as const,
      text: '有哪些阻塞？',
      mentions: [],
      pageContext: makeDescriptor(),
    }
    const resolver = makeResolver()

    const { service: executeService } = makeService({
      answerExecutor: async (input) => {
        nonStream.push(input)
        return { text: '答案' }
      },
      assembly: makeAssemblyStub(projectFacts),
      resolver,
    })
    await executeService.execute(execInput(request))

    const { service: streamService } = makeService({
      streamAnswerExecutor: async function* (input) {
        stream.push(input)
        yield '答案'
      },
      assembly: makeAssemblyStub(projectFacts),
      resolver,
    })
    await streamService.executeStream(execInput(request), {
      emit: async () => {},
      isWritable: () => true,
    })

    expect(nonStream).toHaveLength(1)
    expect(stream).toHaveLength(1)
    const a = nonStream[0]
    const b = stream[0]
    expect(JSON.stringify(a.contextFacts)).toBe(JSON.stringify(b.contextFacts))
    // observedAt 为服务端墙钟快照时间，两次调用必然相差毫秒级——
    // 语义等价断言：其余字段全等（F2 的「输入等价」指同一 contract 与事实集）。
    const normalize = (disclosure: typeof a.pageContextDisclosure) =>
      disclosure && { ...disclosure, observedAt: 'T' }
    expect(normalize(a.pageContextDisclosure)).toEqual(normalize(b.pageContextDisclosure))
    expect(b.contextFacts?.some((f) => f.factKey === 'tasks.total')).toBe(true)
    expect(b.pageContextDisclosure?.status).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// 页面筛选任务事实（2.1/2.3）：resolver 注入后进入 executor
// ---------------------------------------------------------------------------

describe('页面筛选事实（filteredTaskFacts）进入回答链', () => {
  it('筛选存在且授权就绪 → executor 收到 filteredTotal（exact，先于明细）', async () => {
    /** 链式 fake query：count 后接 first 或 groupBy（与 resolver 单元测试同构）。 */
    class FakeQuery {
      constructor(readonly rows: Array<Record<string, unknown>>) {}
      where() {
        return this
      }
      whereNull() {
        return this
      }
      whereIn() {
        return this
      }
      count() {
        return {
          first: async () => ({ count: this.rows.length }),
          groupBy: () => {
            const tally: Record<string, number> = {}
            for (const row of this.rows) {
              const status = String(row.status ?? 'unknown')
              tally[status] = (tally[status] ?? 0) + 1
            }
            return Object.entries(tally).map(([status, count]) => ({ status, count }))
          },
        }
      }
      select() {
        return this
      }
      orderBy() {
        return this
      }
      limit() {
        return this.rows.slice(0, 0)
      }
    }
    const rows = [
      { id: 1, name: '甲', status: 'blocked' },
      { id: 2, name: '乙', status: 'blocked' },
      { id: 3, name: '丙', status: 'blocked' },
      { id: 4, name: '丁', status: 'blocked' },
      { id: 5, name: '戊', status: 'blocked' },
    ]
    const resolver = new CopilotPageContextResolver({
      findProject: async () => ({ id: PROJECT_ID }),
      allowedProjectIds: [PROJECT_ID],
      db: { from: () => new FakeQuery(rows) },
    })
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub([]),
      resolver,
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '当前筛选下有哪些阻塞？', // 「阻塞」命中 → taskStatus 切面被选中
        mentions: [],
        pageContext: makeDescriptor({ filters: [{ key: 'status', op: 'eq', value: 'blocked' }] }),
      }),
    )
    const filtered = cap.inputs[0].contextFacts?.find((f) => f.factKey === 'tasks.filteredTotal')
    expect(filtered?.value).toBe(5)
    expect(cap.inputs[0].pageContextDisclosure?.filters[0].value).toBe('blocked')
  })

  it('无筛选 → 不查询 filtered 事实（不产生重复查询）', async () => {
    const resolver = new CopilotPageContextResolver({
      findProject: async () => ({ id: PROJECT_ID }),
      allowedProjectIds: [PROJECT_ID],
      db: { from: () => ({}) },
    })
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(projectFacts),
      resolver,
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '进度如何？',
        mentions: [],
        pageContext: makeDescriptor({ filters: undefined }),
      }),
    )
    const keys = (cap.inputs[0].contextFacts ?? []).map((f) => f.factKey)
    expect(keys).not.toContain('tasks.filteredTotal')
    expect(keys).toContain('tasks.total')
  })
})

// ---------------------------------------------------------------------------
// 3.1：项目 fixture —— Kanban 精确回答且带引用
// ---------------------------------------------------------------------------

/** 项目场景 fixture：8 任务/2 成员/3 风险/里程碑进度（与 panorama 聚合同源）。 */
const kanbanScenarioFacts: readonly CopilotContextFact[] = [
  {
    factKey: 'tasks.total',
    value: 8,
    displayLabel: '任务总数',
    facet: 'taskStatus',
    sourceRef: 'project:100/tasks',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'tasks.byStatus',
    value: { done: 2, blocked: 1, in_progress: 4, not_started: 1 },
    displayLabel: '任务状态分布',
    facet: 'taskStatus',
    sourceRef: 'project:100/tasks',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'tasks.completionRatio',
    value: 0.25,
    displayLabel: '任务完成比例',
    facet: 'taskStatus',
    sourceRef: 'project:100/panorama',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'resource.assignments',
    value: 2,
    displayLabel: '资源分配数',
    facet: 'resource',
    sourceRef: 'project:100/panorama',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'resource.overallocatedUsers',
    value: 1,
    displayLabel: '超配用户数',
    facet: 'resource',
    sourceRef: 'project:100/panorama',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'risks.total',
    value: 3,
    displayLabel: '风险总数',
    facet: 'risk',
    sourceRef: 'project:100/panorama',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
  {
    factKey: 'milestones.overdue',
    value: 1,
    displayLabel: '逾期里程碑数',
    facet: 'milestone',
    sourceRef: 'project:100/panorama',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
  },
]

describe('3.1：项目 fixture —— Kanban 精确回答带引用', () => {
  async function ask(text: string) {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(kanbanScenarioFacts),
      resolver: makeResolver(),
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text,
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    return cap.inputs[0]
  }

  it('任务总数/状态：exact 值 + sourceRef 引用（非 hit count）', async () => {
    const input = await ask('当前项目共有多少个任务，完成了多少？')
    const facts = input.contextFacts ?? []
    expect(facts.find((f) => f.factKey === 'tasks.total')?.value).toBe(8)
    expect(facts.find((f) => f.factKey === 'tasks.byStatus')?.value).toEqual({
      done: 2,
      blocked: 1,
      in_progress: 4,
      not_started: 1,
    })
    for (const fact of facts) {
      expect(fact.sourceRef.length).toBeGreaterThan(0) // 带引用
      expect(JSON.stringify(input)).not.toContain(`hit ${fact.factKey}`)
    }
  })

  it('成员/负载：resource 事实精确', async () => {
    const input = await ask('谁可能忙不过来？')
    const facts = input.contextFacts ?? []
    expect(facts.find((f) => f.factKey === 'resource.assignments')?.value).toBe(2)
    expect(facts.find((f) => f.factKey === 'resource.overallocatedUsers')?.value).toBe(1)
  })

  it('风险：risks.total 精确', async () => {
    const input = await ask('这个项目有哪些风险？')
    expect(input.contextFacts?.find((f) => f.factKey === 'risks.total')?.value).toBe(3)
  })

  it('进度：completionRatio + 逾期里程碑精确', async () => {
    const input = await ask('目前进度到哪了？')
    const facts = input.contextFacts ?? []
    expect(facts.find((f) => f.factKey === 'tasks.completionRatio')?.value).toBe(0.25)
    expect(facts.find((f) => f.factKey === 'milestones.overdue')?.value).toBe(1)
  })

  it('F7 自然问法回归：「进度如何？」不要求规范句式就进项目事实', async () => {
    const casual = await ask('进度如何？')
    expect(casual.contextFacts?.some((f) => f.factKey === 'tasks.completionRatio')).toBe(true)
    expect(casual.contextFacts?.some((f) => f.factKey === 'milestones.overdue')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 回滚 flag 与事实级 DLP（3.3 / design Migration Plan）
// ---------------------------------------------------------------------------

describe('回滚 flag 与事实级 DLP', () => {
  it('pageContextEnabled=false → 无披露、无 facts（回退既有行为，零迁移）', async () => {
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(projectFacts),
      resolver: makeResolver(),
      pageContextEnabled: false,
    })
    const result = await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '有哪些阻塞？',
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    expect(result.response.pageContextDisclosure).toBeUndefined()
    expect(cap.inputs[0].contextFacts ?? []).toEqual([])
  })

  it('事实级 DLP：含禁存内容的事实被过滤，不进入 executor', async () => {
    const leakyFacts: readonly CopilotContextFact[] = [
      ...projectFacts,
      {
        factKey: 'tasks.leak',
        value: 'token: sk-abcdef1234567890',
        displayLabel: '泄露隐患',
        facet: 'taskStatus',
        sourceRef: 'project:100/tasks',
        observedAt: '2026-09-01T06:32:00.000Z',
        sensitivity: 'low',
      },
    ]
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(leakyFacts),
      resolver: makeResolver(),
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '有哪些阻塞？',
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    const serialized = JSON.stringify(cap.inputs[0])
    expect(serialized).not.toContain('tasks.leak')
    expect(serialized).not.toContain('sk-abcdef')
    expect(cap.inputs[0].contextFacts?.some((f) => f.factKey === 'tasks.total')).toBe(true)
  })

  it('F6 prompt 预算：1000 行级事实场景下 exact totals 保留、facts ≤ 40、字节有界', async () => {
    const manyRows: CopilotContextFact[] = [
      {
        factKey: 'tasks.total',
        value: 1000,
        displayLabel: '任务总数',
        facet: 'taskStatus',
        sourceRef: 'project:100/tasks',
        observedAt: '2026-09-01T06:32:00.000Z',
        sensitivity: 'low',
      },
      {
        factKey: 'tasks.byStatus',
        value: { done: 700, in_progress: 300 },
        displayLabel: '任务状态分布',
        facet: 'taskStatus',
        sourceRef: 'project:100/tasks',
        observedAt: '2026-09-01T06:32:00.000Z',
        sensitivity: 'low',
      },
    ]
    for (let i = 0; i < 1000; i += 1) {
      manyRows.push({
        factKey: `tasks.rows.${i}`,
        value: [`任务 ${i}`],
        displayLabel: `任务 ${i}`,
        facet: 'taskStatus',
        sourceRef: 'project:100/tasks',
        observedAt: '2026-09-01T06:32:00.000Z',
        sensitivity: 'low',
      })
    }
    const cap = capturingExecutor()
    const { service } = makeService({
      answerExecutor: cap.executor,
      assembly: makeAssemblyStub(manyRows),
      resolver: makeResolver(),
    })
    await service.execute(
      execInput({
        sessionId: null,
        scope: 'project',
        text: '完成了多少？',
        mentions: [],
        pageContext: makeDescriptor(),
      }),
    )
    const facts = cap.inputs[0].contextFacts ?? []
    expect(facts.length).toBeLessThanOrEqual(40)
    expect(facts.find((f) => f.factKey === 'tasks.total')?.value).toBe(1000)
    expect(facts.find((f) => f.factKey === 'tasks.byStatus')?.value).toEqual({
      done: 700,
      in_progress: 300,
    })
    const bytes = JSON.stringify(facts).length
    expect(bytes).toBeLessThanOrEqual(8192)
    expect(bytes).toBeGreaterThan(0)
  })
})
