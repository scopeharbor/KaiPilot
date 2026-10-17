import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  PROJECT_DRAFT_SCHEMA_VERSION,
  type ProjectDraft,
  type ProjectDraftMeta,
  type DraftValidationReport,
} from '@aiproj/types'
import AiCreatePage from '@/app/(dashboard)/ai-create/page'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { createDraftProgressProjection } from '@/lib/ai-draft/progress-projection'
import { writeDraftProgressCursor } from '@/lib/ai-draft/progress-cursor'
import { useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { accessTokenWith } from './_jwt-helper'

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: { analyze: vi.fn() },
}))

vi.mock('@/lib/api/ai-connections', () => ({
  aiConnectionsApi: { list: vi.fn() },
}))

vi.mock('@/components/PermissionGuard', () => ({
  PermissionGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/api/ai-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/ai-draft')>()
  return {
    ...actual,
    aiDraftApi: {
      stream: vi.fn(),
      confirm: vi.fn(),
      save: vi.fn(),
      reject: vi.fn(),
      get: vi.fn(),
      events: vi.fn(),
      retry: vi.fn(),
    },
  }
})

const mockDraft: ProjectDraft = {
  schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
  projectType: 'software',
  charter: {
    title: {
      value: '断线恢复测试项目',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    vision: {
      value: '愿景说明',
      marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    scope: {
      value: '范围说明',
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
  confidenceScore: 0.9,
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

function login(permissions: string[]) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '项目经理',
      organizations: [{ id: 8, name: '开项', slug: 'aiproj', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: 8 }),
    refreshToken: 'refresh',
  })
}

function resetAll() {
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<AiCreatePage />, { wrapper })
}

function setupReadyState() {
  login(['ai:trigger'])
  useAiProjectDraftStore.setState({
    status: 'ready',
    context: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      rawInput: '开发一个工单系统',
      parsedIntent: {
        schemaVersion: AI_INTENT_SCHEMA_VERSION,
        projectType: 'software',
        projectName: null,
        objectives: [],
        deliverables: ['Web 端'],
        timeline: { startDate: null, deadline: null, durationDays: null },
        constraints: [],
        entities: [],
        overallConfidence: 0.85,
      },
      resolvedFields: {},
      assumptions: {},
      unresolvedCriticalFields: [],
      unansweredOptionalFields: [],
    },
    parsedIntent: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      projectType: 'software',
      projectName: null,
      objectives: [],
      deliverables: ['Web 端'],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.85,
    },
    cards: [],
    answers: {},
    rawInput: '开发一个工单系统',
    userId: 1,
    organizationId: 8,
  })
}

function createSseStreamResponse(events: object[]): Response {
  const payload = events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')
  return new Response(payload, { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('任务 2.2 - SSE 异常断线自动重连与终态收敛', () => {
  beforeEach(() => {
    vi.mocked(aiIntentApi.analyze).mockReset()
    vi.mocked(aiDraftApi.stream).mockReset()
    vi.mocked(aiDraftApi.confirm).mockReset()
    vi.mocked(aiDraftApi.save).mockReset()
    vi.mocked(aiDraftApi.reject).mockReset()
    vi.mocked(aiDraftApi.get).mockReset()
    vi.mocked(aiDraftApi.events).mockReset()
    vi.mocked(aiConnectionsApi.list).mockResolvedValue([])
    useAuthStore.getState().clear()
    resetAll()
  })

  test('SSE 流异常中断后自动发起 resumeDraftProgress 游标追尾重连并成功收敛', async () => {
    setupReadyState()

    // 第一次连接：收到 started 和 charter delta，随后流异常断开
    const streamEvents = [
      {
        type: 'draft.started',
        draftId: 'draft-reconnect-001',
        version: 1,
        sequence: 1,
        projectType: 'software',
        modules: ['charter', 'wbs', 'tasks'],
      },
      {
        type: 'module.delta',
        draftId: 'draft-reconnect-001',
        version: 1,
        sequence: 2,
        module: 'charter',
        status: 'completed',
      },
    ]
    vi.mocked(aiDraftApi.stream).mockResolvedValue(createSseStreamResponse(streamEvents))

    // 第一次 get 检查：后端仍在生成中 (drafting)
    vi.mocked(aiDraftApi.get)
      .mockResolvedValueOnce({
        draftId: 'draft-reconnect-001',
        version: 1,
        status: 'drafting',
        generationState: 'running',
        projectType: 'software',
        draft: null,
        meta: null,
        validation: null,
        events: [],
      })
      // 第二次 get 检查（draft.completed 后 loadAuthoritativeDraft）
      .mockResolvedValueOnce({
        draftId: 'draft-reconnect-001',
        version: 1,
        status: 'reviewing',
        generationState: 'settled',
        projectType: 'software',
        draft: mockDraft,
        meta: mockMeta,
        validation: mockValidation,
        events: [],
      })

    // 重连 events(draftId, cursor=2)：续传后续事件及 completed
    const resumeEvents = [
      {
        type: 'module.delta',
        draftId: 'draft-reconnect-001',
        version: 1,
        sequence: 3,
        module: 'wbs',
        status: 'completed',
      },
      {
        type: 'draft.completed',
        draftId: 'draft-reconnect-001',
        version: 1,
        sequence: 4,
        draft: mockDraft,
        meta: mockMeta,
        validation: mockValidation,
      },
    ]
    vi.mocked(aiDraftApi.events).mockResolvedValue(createSseStreamResponse(resumeEvents))

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    // 断言自动发起了带游标的 events 追尾
    await waitFor(() => {
      expect(aiDraftApi.events).toHaveBeenCalledWith('draft-reconnect-001', 2)
    })

    // 断言最终成功收敛到审查面板
    await waitFor(() => {
      expect(screen.getByText('草案审查')).toBeInTheDocument()
    })
    expect(screen.getByText('断线恢复测试项目')).toBeInTheDocument()
  })

  test('SSE 流在 9/9 模块完成后异常断开，通过权威状态直接收敛到 reviewing（不再卡在 9/9）', async () => {
    setupReadyState()

    const allModules = [
      'charter',
      'wbs',
      'tasks',
      'dependencies',
      'acceptance',
      'resource',
      'risk',
      'milestone',
      'ganttPreview',
    ] as const

    const streamEvents = [
      {
        type: 'draft.started',
        draftId: 'draft-9modules-001',
        version: 1,
        sequence: 1,
        projectType: 'software',
        modules: allModules,
      },
      ...allModules.map((module, idx) => ({
        type: 'module.delta',
        draftId: 'draft-9modules-001',
        version: 1,
        sequence: idx + 2,
        module,
        status: 'completed' as const,
      })),
    ]

    vi.mocked(aiDraftApi.stream).mockResolvedValue(createSseStreamResponse(streamEvents))

    // 断开后查询权威详情：服务端已经完成并进入 reviewing
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-9modules-001',
      version: 1,
      status: 'reviewing',
      generationState: 'settled',
      projectType: 'software',
      draft: mockDraft,
      meta: mockMeta,
      validation: mockValidation,
      events: [],
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    // 断言直接收敛到审查面板，没有卡在 9/9 生成中
    await waitFor(() => {
      expect(screen.getByText('草案审查')).toBeInTheDocument()
    })
    expect(screen.getByText('断线恢复测试项目')).toBeInTheDocument()
    // 不需要再去请求 events 流
    expect(aiDraftApi.events).not.toHaveBeenCalled()
  })

  test('SSE 流断开后服务端已进入 error 终态，直接收敛到草案失败面板', async () => {
    setupReadyState()

    const streamEvents = [
      {
        type: 'draft.started',
        draftId: 'draft-failed-002',
        version: 1,
        sequence: 1,
        projectType: 'software',
        modules: ['charter'],
      },
    ]
    vi.mocked(aiDraftApi.stream).mockResolvedValue(createSseStreamResponse(streamEvents))

    // 断开后查询权威详情：服务端因限流已标记 error
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-failed-002',
      version: 1,
      status: 'error',
      generationState: 'settled',
      projectType: 'software',
      draft: null,
      meta: null,
      validation: null,
      events: [],
      failure: {
        errorCode: 'PROVIDER_RATE_LIMIT',
        message: '服务提供商限流，请稍后重试。',
        consistency: 'failed',
        sequence: 2,
      },
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    await waitFor(() => {
      expect(screen.getByText('草案生成失败')).toBeInTheDocument()
    })
    expect(screen.getByText(/PROVIDER_RATE_LIMIT/)).toBeInTheDocument()
    expect(screen.getByText(/服务提供商限流/)).toBeInTheDocument()
  })

  test('有界重试限制：多次断开后达到最大尝试次数停止重连并展示断开状态', async () => {
    setupReadyState()

    const streamEvents = [
      {
        type: 'draft.started',
        draftId: 'draft-persistent-fail-001',
        version: 1,
        sequence: 1,
        projectType: 'software',
        modules: ['charter'],
      },
    ]
    vi.mocked(aiDraftApi.stream).mockResolvedValue(createSseStreamResponse(streamEvents))

    // 服务端仍在生成中，但 events 接口网络异常持续失败
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-persistent-fail-001',
      version: 1,
      status: 'drafting',
      generationState: 'running',
      projectType: 'software',
      draft: null,
      meta: null,
      validation: null,
      events: [],
    })

    vi.mocked(aiDraftApi.events).mockRejectedValue(new Error('Network disconnected'))

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    // 经历有界重试后停止并提示用户可继续
    await waitFor(
      () => {
        expect(screen.getByText('进度连接已中断，可从上次位置继续。')).toBeInTheDocument()
      },
      { timeout: 8000 },
    )
    expect(screen.getByRole('button', { name: /继续接收进度/ })).toBeInTheDocument()
  })

  test('页面刷新恢复时保留已有模块投影，避免在重放完成前把模块硬 reset 为 0/9', async () => {
    login(['ai:trigger'])
    const persistedModules = {
      charter: 'completed' as const,
      wbs: 'completed' as const,
      tasks: 'completed' as const,
      dependencies: 'pending' as const,
      acceptance: 'pending' as const,
      resource: 'pending' as const,
      risk: 'pending' as const,
      milestone: 'pending' as const,
      ganttPreview: 'pending' as const,
    }
    const persistedProjection = {
      ...createDraftProgressProjection({
        draftId: 'draft-partial-001',
        version: 1,
        lastSequence: 4,
      }),
      modules: persistedModules,
    }

    // 模拟刷新前已有 3 个模块 completed 并持久化在 store 中
    useAiProjectDraftStore.setState({
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      userId: 1,
      organizationId: 8,
      status: 'ready',
      draftStatus: 'drafting',
      draftId: 'draft-partial-001',
      draftVersion: 1,
      lastEventSequence: 4,
      moduleStatuses: persistedModules,
      progressProjection: persistedProjection,
    })
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-partial-001',
      version: 1,
      lastSequence: 4,
    })

    // get 返回 drafting
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-partial-001',
      version: 1,
      status: 'drafting',
      generationState: 'running',
      projectType: 'software',
      draft: null,
      meta: null,
      validation: null,
      events: [],
    })

    // events 延迟响应模拟传输过程
    let resolveEventsStream: (res: Response) => void
    const eventsPromise = new Promise<Response>((resolve) => {
      resolveEventsStream = resolve
    })
    vi.mocked(aiDraftApi.events).mockImplementation(() => eventsPromise)

    renderPage()

    // 页面加载并开始恢复时，断言模块状态没有被硬重置为 0/9
    await waitFor(() => {
      expect(screen.getByText('正在生成项目草案')).toBeInTheDocument()
    })
    const state = useAiProjectDraftStore.getState()
    expect(state.moduleStatuses.charter).toBe('completed')
    expect(state.moduleStatuses.wbs).toBe('completed')
    expect(state.moduleStatuses.tasks).toBe('completed')

    // 模拟重放数据到达并完成
    resolveEventsStream!(
      createSseStreamResponse([
        {
          type: 'draft.completed',
          draftId: 'draft-partial-001',
          version: 1,
          sequence: 5,
          draft: mockDraft,
          meta: mockMeta,
          validation: mockValidation,
        },
      ]),
    )
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-partial-001',
      version: 1,
      status: 'reviewing',
      generationState: 'settled',
      projectType: 'software',
      draft: mockDraft,
      meta: mockMeta,
      validation: mockValidation,
      events: [],
    })

    await waitFor(() => {
      expect(screen.getByText('草案审查')).toBeInTheDocument()
    })
  })
})
