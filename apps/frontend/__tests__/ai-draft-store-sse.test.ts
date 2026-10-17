import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  PROJECT_DRAFT_SCHEMA_VERSION,
  type ConfirmProjectDraftResponse,
  type DraftModuleDeltaEvent,
  type DraftStartedEvent,
  type ProjectDraft,
  type ProjectDraftMeta,
  type ProjectDraftStreamEvent,
  type DraftValidationReport,
} from '@aiproj/types'
import { aiDraftApi, consumeDraftSse } from '@/lib/api/ai-draft'
import { createDraftProgressProjection } from '@/lib/ai-draft/progress-projection'
import {
  AI_DRAFT_PROGRESS_CURSOR_KEY,
  readDraftProgressCursor,
  writeDraftProgressCursor,
} from '@/lib/ai-draft/progress-cursor'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

function resetStore() {
  sessionStorage.clear()
  useAiProjectDraftStore.setState({
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    userId: null,
    organizationId: null,
    status: 'idle',
    rawInput: '',
    cards: [],
    answers: {},
    parsedIntent: null,
    context: null,
    error: null,
    restored: false,
    draftStatus: null,
    draftId: null,
    draftVersion: 0,
    draft: null,
    draftMeta: null,
    validation: null,
    draftEvents: [],
    moduleStatuses: {},
    confirmResponse: null,
    lastEventSequence: 0,
    progressProjection: createDraftProgressProjection(),
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const mockDraft: ProjectDraft = {
  schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
  projectType: 'software',
  charter: {
    title: {
      value: '测试项目',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    vision: {
      value: '测试愿景',
      marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    scope: {
      value: '测试范围',
      marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    objectives: {
      value: ['目标1'],
      marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    successCriteria: {
      value: ['标准1'],
      marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    startDate: {
      value: '2026-07-01',
      marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    endDate: {
      value: '2026-09-30',
      marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
  },
  wbs: [],
  tasks: [],
  dependencies: [],
  acceptanceCriteria: [],
  resourceHints: [],
  riskHints: [],
  milestoneHints: [],
  ganttPreview: {
    startDate: {
      value: '2026-07-01',
      marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    endDate: {
      value: '2026-09-30',
      marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    totalDurationDays: {
      value: 90,
      marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    criticalPathTaskIds: [],
    phaseCount: 3,
  },
}

const mockMeta: ProjectDraftMeta = {
  schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
  projectType: 'software',
  structuredStrategy: 'native',
  consistency: 'strict',
  fallbackUsed: false,
  provider: 'test',
  model: 'test-model',
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
}

const mockValidation: DraftValidationReport = {
  overallRiskLevel: 'low',
  confidenceScore: 0.85,
  dimensionScores: {
    factualAccuracy: 100,
    logicalConsistency: 100,
    assumptionClarity: 100,
    completeness: 100,
    numericPlausibility: 100,
  },
  blocking: [],
  warning: [],
  info: [],
  ruleResults: [],
  autoFixDiffs: [],
  canConfirm: true,
}

describe('AI 草案 Store - 状态转换', () => {
  beforeEach(() => {
    resetStore()
    vi.restoreAllMocks()
  })

  test('初始化时 draftStatus 为 null', () => {
    expect(useAiProjectDraftStore.getState().draftStatus).toBeNull()
  })

  test('startDraftGeneration 进入 drafting 状态', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.startDraftGeneration('draft-001')

    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBe('drafting')
    expect(state.draftId).toBe('draft-001')
    expect(state.draftVersion).toBe(1)
    expect(state.draftEvents).toHaveLength(0)
  })

  test('applyDraftEvent 累加事件', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')

    const deltaEvent: DraftModuleDeltaEvent = {
      type: 'module.delta',
      draftId: 'draft-001',
      version: 1,
      sequence: 1,
      module: 'charter',
      status: 'generating',
    }

    store.applyDraftEvent(deltaEvent)

    const state = useAiProjectDraftStore.getState()
    expect(state.draftEvents).toHaveLength(1)
    expect(state.moduleStatuses.charter).toBe('generating')
    expect(state.lastEventSequence).toBe(1)
  })

  test('generation.output 追加文本且不推进语义序列、不写恢复 cursor', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    store.applyDraftEvent({
      type: 'draft.started',
      draftId: 'draft-001',
      version: 1,
      sequence: 1,
      projectType: 'software',
      modules: [
        'charter',
        'wbs',
        'tasks',
        'dependencies',
        'acceptance',
        'resource',
        'risk',
        'milestone',
        'ganttPreview',
      ],
    } as DraftStartedEvent)

    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '正在生成项目章程…',
    })
    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '继续输出第二段。',
    })

    const state = useAiProjectDraftStore.getState()
    // 文本累积、活跃标记开启
    expect(state.streamOutput).toBe('正在生成项目章程…继续输出第二段。')
    expect(state.streamOutputActive).toBe(true)
    // 不推进语义序列、不进入 draftEvents、不触发 gap
    expect(state.lastEventSequence).toBe(1)
    expect(state.draftEvents).toHaveLength(1)
    expect(state.progressProjection.recovery.state).toBe('none')

    // 后续语义事件仍正常推进序列
    store.applyDraftEvent({
      type: 'module.delta',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      module: 'charter',
      status: 'generating',
    } as DraftModuleDeltaEvent)
    expect(useAiProjectDraftStore.getState().lastEventSequence).toBe(2)
  })

  test('终态事件停止输出活跃标记但保留已累积文本', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '最后的输出。',
    })
    store.applyDraftEvent({
      type: 'draft.failed',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      errorCode: 'AI_SERVICE_ERROR',
      message: '生成失败',
      consistency: 'failed',
    })

    const state = useAiProjectDraftStore.getState()
    expect(state.streamOutput).toBe('最后的输出。')
    expect(state.streamOutputActive).toBe(false)
  })

  test('startDraftGeneration 与 clearStreamOutput 清空输出缓冲', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '第一段',
    })
    store.clearStreamOutput()
    expect(useAiProjectDraftStore.getState().streamOutput).toBe('')

    // 清空后新输出仍继续追加
    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '第二段',
    })
    expect(useAiProjectDraftStore.getState().streamOutput).toBe('第二段')

    useAiProjectDraftStore.getState().startDraftGeneration('draft-002')
    expect(useAiProjectDraftStore.getState().streamOutput).toBe('')
    expect(useAiProjectDraftStore.getState().streamOutputActive).toBe(false)
  })

  test('setDraftCompleted 设置草案并进入 completed 状态', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')

    store.applyDraftEvent({
      type: 'draft.started',
      draftId: 'draft-001',
      version: 1,
      sequence: 1,
      projectType: 'software',
      modules: [
        'charter',
        'wbs',
        'tasks',
        'dependencies',
        'acceptance',
        'resource',
        'risk',
        'milestone',
        'ganttPreview',
      ],
    } as DraftStartedEvent)

    store.setDraftCompleted(mockDraft, mockMeta, mockValidation)

    const state = useAiProjectDraftStore.getState()
    expect(state.draft).toEqual(mockDraft)
    expect(state.draftMeta).toEqual(mockMeta)
    expect(state.validation).toEqual(mockValidation)
  })

  test('setDraftFailed 设置 error、draftStatus 与结构化 draftFailure', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    store.setDraftFailed('PARSE_ERROR', '模型输出格式错误', {
      errorCode: 'PARSE_ERROR',
      message: '模型输出格式错误',
      consistency: 'failed',
      sequence: 3,
      stage: 'wbs_tasks',
      reasonCode: 'SCHEMA_PARSE_ERROR',
      errors: [{ path: 'tasks[0].name', message: '任务名缺失' }],
    })

    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBe('error')
    expect(state.error).toContain('PARSE_ERROR')
    expect(state.draftFailure).toEqual({
      errorCode: 'PARSE_ERROR',
      message: '模型输出格式错误',
      consistency: 'failed',
      sequence: 3,
      stage: 'wbs_tasks',
      reasonCode: 'SCHEMA_PARSE_ERROR',
      errors: [{ path: 'tasks[0].name', message: '任务名缺失' }],
    })
  })

  test('applyDraftEvent 收到 draft.failed 事件时记录 draftFailure', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    store.applyDraftEvent({
      type: 'draft.failed',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      errorCode: 'TOOL_GATE_VIOLATION',
      message: '门禁校验失败',
      consistency: 'failed',
      stage: 'schedule_dependencies',
      reasonCode: 'TOOL_CALL_DISALLOWED',
      errors: [{ message: '未授权的工具调用' }],
    })

    const state = useAiProjectDraftStore.getState()
    expect(state.draftFailure?.stage).toBe('schedule_dependencies')
    expect(state.draftFailure?.reasonCode).toBe('TOOL_CALL_DISALLOWED')
    expect(state.draftFailure?.errors).toHaveLength(1)
  })

  test('完整生命周期：drafting → completed → review → confirmed', () => {
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('drafting')

    store.setDraftCompleted(mockDraft, mockMeta, mockValidation)
    expect(useAiProjectDraftStore.getState().draft).toBeTruthy()

    store.enterReview()
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')

    store.enterApplying()
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('applying')

    const confirmResponse: ConfirmProjectDraftResponse = {
      projectId: 42,
      createdCounts: {
        wbsNodes: 3,
        tasks: 5,
        dependencies: 2,
        milestones: 1,
        acceptanceCriteria: 3,
        risks: 1,
      },
    }
    store.enterConfirmed(confirmResponse)
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    expect(useAiProjectDraftStore.getState().confirmResponse?.projectId).toBe(42)
  })

  test('拒绝后 resetToContext 清除 draft 状态', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.startDraftGeneration('draft-001')
    store.setDraftCompleted(mockDraft, mockMeta, mockValidation)
    store.enterReview()

    store.resetToContext()
    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBeNull()
    expect(state.draft).toBeNull()
    expect(state.userId).toBe(1)
  })
})

describe('AI 草案 API 客户端', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('confirm 调用 POST 并返回 projectId', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          projectId: 42,
          createdCounts: {
            wbsNodes: 3,
            tasks: 5,
            dependencies: 2,
            milestones: 1,
            acceptanceCriteria: 3,
          },
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await aiDraftApi.confirm('draft-001', {
      version: 1,
      mode: 'all',
      acknowledgedWarnings: true,
    })

    expect(result.projectId).toBe(42)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ai/project-drafts/draft-001/confirm'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('save 调用 POST', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          draftId: 'draft-001',
          version: 1,
          status: 'saved',
          projectType: 'software',
          draft: null,
          meta: null,
          validation: null,
          events: [],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await aiDraftApi.save('draft-001')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ai/project-drafts/draft-001/save'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('get 调用 GET 并返回详情', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          draftId: 'draft-001',
          version: 2,
          status: 'reviewing',
          projectType: 'software',
          draft: null,
          meta: null,
          validation: null,
          events: [],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await aiDraftApi.get('draft-001')
    expect(result.draftId).toBe('draft-001')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ai/project-drafts/draft-001'),
      expect.any(Object),
    )
  })
})

describe('SSE 消费 - consumeDraftSse', () => {
  function sseResponse(events: string[]): Response {
    const body = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(new TextEncoder().encode(event))
        }
        controller.close()
      },
    })
    return { ok: true, status: 200, body, headers: new Headers(), statusText: 'OK' } as Response
  }

  test('解析 draft.completed 事件', async () => {
    const raw = `event: draft.completed\ndata: ${JSON.stringify({
      type: 'draft.completed',
      draftId: 'draft-001',
      version: 1,
      sequence: 5,
      draft: mockDraft,
      meta: mockMeta,
      validation: mockValidation,
    })}\n\n`

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(sseResponse([raw]))) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('draft.completed')
    if (events[0]!.type === 'draft.completed') {
      expect(
        (events[0]! as Extract<ProjectDraftStreamEvent, { type: 'draft.completed' }>).draftId,
      ).toBe('draft-001')
    }
  })

  test('解析多事件流', async () => {
    const started = `event: draft.started\ndata: ${JSON.stringify({
      type: 'draft.started',
      draftId: 'draft-001',
      version: 1,
      sequence: 1,
      projectType: 'software',
      modules: ['charter', 'wbs'],
    })}\n\n`
    const delta = `event: module.delta\ndata: ${JSON.stringify({
      type: 'module.delta',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      module: 'charter',
      status: 'completed',
    })}\n\n`

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(sseResponse([started + delta]))) {
      events.push(event)
    }

    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('draft.started')
    expect(events[1]!.type).toBe('module.delta')
  })

  test('abort signal 可中断', async () => {
    const abort = new AbortController()
    const raw = `event: draft.started\ndata: {"type":"draft.started","draftId":"draft-001","version":1,"sequence":1,"projectType":"software","modules":[]}\n\n`

    const response = sseResponse([raw])
    abort.abort()

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(response, abort.signal)) {
      events.push(event)
    }

    expect(events).toHaveLength(0)
  })

  // —— 新旧事件兼容与白名单回归 ——

  test('draft.progress 被当前客户端识别为低敏进度事件', async () => {
    const raw = `event: draft.progress\ndata: ${JSON.stringify({
      type: 'draft.progress',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      phase: 'receiving',
      receivedChars: 100,
    })}\n\n`

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(sseResponse([raw]))) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'draft.progress', phase: 'receiving' })
  })

  test('draft.heartbeat 被当前客户端识别为连接活性事件', async () => {
    const raw = `event: draft.heartbeat\ndata: ${JSON.stringify({
      type: 'draft.heartbeat',
      draftId: 'draft-001',
      version: 1,
      sequence: 3,
      elapsedMs: 1000,
    })}\n\n`

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(sseResponse([raw]))) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'draft.heartbeat', elapsedMs: 1000 })
  })

  test('generation.output 帧被识别为已知事件（sequence=0 瞬时通道）', async () => {
    const raw = `event: generation.output\ndata: ${JSON.stringify({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '模型正在输出真实内容。',
    })}\n\n`

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(sseResponse([raw]))) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'generation.output',
      sequence: 0,
      text: '模型正在输出真实内容。',
    })
  })

  test('混合已知与未知事件仍正常处理已知事件', async () => {
    const started = `event: draft.started\ndata: ${JSON.stringify({
      type: 'draft.started',
      draftId: 'draft-001',
      version: 1,
      sequence: 1,
      projectType: 'software',
      modules: ['charter', 'wbs'],
    })}\n\n`
    const progress = `event: draft.progress\ndata: ${JSON.stringify({
      type: 'draft.progress',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      phase: 'receiving',
      receivedChars: 50,
    })}\n\n`
    const futureUnknown = `event: draft.telemetry\ndata: ${JSON.stringify({
      type: 'draft.telemetry',
      draftId: 'draft-001',
      version: 1,
      sequence: 3,
      sample: 'future-addition',
    })}\n\n`
    const completed = `event: draft.completed\ndata: ${JSON.stringify({
      type: 'draft.completed',
      draftId: 'draft-001',
      version: 1,
      sequence: 5,
      draft: mockDraft,
      meta: mockMeta,
      validation: mockValidation,
    })}\n\n`

    const events: ProjectDraftStreamEvent[] = []
    for await (const event of consumeDraftSse(
      sseResponse([started + progress + futureUnknown + completed]),
    )) {
      events.push(event)
    }

    // 当前已知事件全部保留；未来未知事件仍会被过滤。
    expect(events).toHaveLength(3)
    expect(events[0]!.type).toBe('draft.started')
    expect(events[1]!.type).toBe('draft.progress')
    expect(events[2]!.type).toBe('draft.completed')
  })
})

describe('Store - 作用域隔离与恢复游标保护', () => {
  beforeEach(() => {
    resetStore()
  })

  test('不同用户重置草案作用域并清除游标', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.startDraftGeneration('draft-001')
    store.setDraftCompleted(mockDraft, mockMeta, mockValidation)
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-001',
      version: 1,
      lastSequence: 5,
    })

    store.initializeScope({ userId: 2, organizationId: 8 })
    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBeNull()
    expect(state.draftId).toBeNull()
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
  })

  test('不同组织重置草案作用域并清除游标', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.startDraftGeneration('draft-001')
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-001',
      version: 1,
      lastSequence: 3,
    })

    store.initializeScope({ userId: 1, organizationId: 9 })
    const state = useAiProjectDraftStore.getState()
    expect(state.draftId).toBeNull()
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
  })

  test('auth 状态未就绪（userId 为 null）时不误清游标与草案状态', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.setRawInput('开发一个工单系统')
    store.startDraftGeneration('draft-001')
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-001',
      version: 1,
      lastSequence: 4,
    })

    // 模拟组件挂载初期 auth 状态延迟初始化（userId: null）
    store.initializeScope({ userId: null, organizationId: null })
    let state = useAiProjectDraftStore.getState()
    expect(state.draftId).toBe('draft-001')
    expect(state.rawInput).toBe('开发一个工单系统')
    expect(readDraftProgressCursor({ userId: 1, organizationId: 8 })).toMatchObject({
      draftId: 'draft-001',
      lastSequence: 4,
    })

    // 模拟部分就绪（organizationId 先有，userId 仍 null）
    store.initializeScope({ userId: null, organizationId: 8 })
    state = useAiProjectDraftStore.getState()
    expect(state.draftId).toBe('draft-001')
    expect(readDraftProgressCursor({ userId: 1, organizationId: 8 })).toMatchObject({
      draftId: 'draft-001',
      lastSequence: 4,
    })

    // 模拟 auth 状态最终就绪（userId: 1, organizationId: 8）
    store.initializeScope({ userId: 1, organizationId: 8 })
    state = useAiProjectDraftStore.getState()
    expect(state.draftId).toBe('draft-001')
    expect(state.userId).toBe(1)
    expect(state.organizationId).toBe(8)
    expect(readDraftProgressCursor({ userId: 1, organizationId: 8 })).toMatchObject({
      draftId: 'draft-001',
      lastSequence: 4,
    })
  })

  test('初始未绑定状态（userId 为 null）时接收到有效 scope 不清空已有输入或游标', () => {
    const store = useAiProjectDraftStore.getState()
    store.setRawInput('新项目意图')
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-unbound-001',
      version: 1,
      lastSequence: 2,
    })

    store.initializeScope({ userId: 1, organizationId: 8 })
    const state = useAiProjectDraftStore.getState()
    expect(state.userId).toBe(1)
    expect(state.organizationId).toBe(8)
    expect(state.rawInput).toBe('新项目意图')
    expect(readDraftProgressCursor({ userId: 1, organizationId: 8 })).toMatchObject({
      draftId: 'draft-unbound-001',
      lastSequence: 2,
    })
  })

  test('页面刷新恢复生命周期模拟：持久化状态 + 延迟 auth 解析不丢失游标与上下文', () => {
    useAiProjectDraftStore.setState({
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      userId: 1,
      organizationId: 8,
      status: 'ready',
      rawInput: '工单系统需求',
      draftStatus: 'drafting',
      draftId: 'draft-persisted-001',
      draftVersion: 1,
      lastEventSequence: 6,
    })
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-persisted-001',
      version: 1,
      lastSequence: 6,
    })

    const store = useAiProjectDraftStore.getState()
    // 刷新第 1 帧：auth 尚未从 storage/jwt 恢复
    store.initializeScope({ userId: null, organizationId: null })
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).not.toBeNull()
    expect(useAiProjectDraftStore.getState().draftId).toBe('draft-persisted-001')

    // 刷新第 2 帧：auth 恢复完成
    store.initializeScope({ userId: 1, organizationId: 8 })
    const cursor = readDraftProgressCursor({ userId: 1, organizationId: 8 })
    expect(cursor).toMatchObject({
      draftId: 'draft-persisted-001',
      lastSequence: 6,
    })
    expect(useAiProjectDraftStore.getState().restored).toBe(true)
  })
})

test('retryDraftGeneration 保留 draftId 与上下文、清空失败现场并回到 drafting', () => {
  const store = useAiProjectDraftStore.getState()
  store.startDraftGeneration('draft-retry-001')
  store.setDraftFailed('GENERATION_BUDGET_EXHAUSTED', '生成预算已耗尽', {
    errorCode: 'GENERATION_BUDGET_EXHAUSTED',
    message: '生成预算已耗尽',
    consistency: 'failed',
    sequence: 9,
  })
  const versionBefore = useAiProjectDraftStore.getState().draftVersion

  store.retryDraftGeneration()

  const state = useAiProjectDraftStore.getState()
  expect(state.draftStatus).toBe('drafting')
  expect(state.draftId).toBe('draft-retry-001')
  expect(state.draftVersion).toBe(versionBefore + 1)
  expect(state.draftFailure).toBeNull()
  expect(state.error).toBeNull()
  expect(state.draft).toBeNull()
  expect(state.draftEvents).toEqual([])
  expect(state.lastEventSequence).toBe(0)
})
