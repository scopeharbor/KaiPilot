import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  PROJECT_DRAFT_SCHEMA_VERSION,
  type ConfirmProjectDraftResponse,
  type ProjectDraft,
  type ProjectDraftMeta,
  type DraftValidationReport,
} from '@aiproj/types'
import AiCreatePage from '@/app/(dashboard)/ai-create/page'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { aiDraftApi } from '@/lib/api/ai-draft'
import {
  createDraftProgressProjection,
  reduceDraftProgress,
} from '@/lib/ai-draft/progress-projection'
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

const mockConfirmResponse: ConfirmProjectDraftResponse = {
  projectId: 42,
  createdCounts: {
    wbsNodes: 3,
    tasks: 8,
    dependencies: 2,
    milestones: 1,
    acceptanceCriteria: 5,
    risks: 1,
  },
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

describe('5.8 / 4.5 / 6.8 - 草案生成与审查测试', () => {
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
          overallConfidence: 0.8,
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
        overallConfidence: 0.8,
      },
      cards: [],
      answers: {},
      rawInput: '开发一个工单系统',
      userId: 1,
      organizationId: 8,
    })
  }

  // --- 5.8: 草案生成与审查状态渲染 ---

  test('(5.8) ready 状态显示「开始生成草案」按钮', () => {
    setupReadyState()
    renderPage()
    expect(screen.getByText('上下文已就绪，准备生成草案')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始生成草案/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新开始/ })).toBeInTheDocument()
  })

  test('(5.1/5.3) completed 后通过 Query 获取权威草案，不把流内内容直接作为审查数据', async () => {
    setupReadyState()
    const streamedDraft = structuredClone(mockDraft)
    streamedDraft.charter.title.value = '流内临时标题'
    const frames = [
      {
        type: 'draft.started',
        draftId: 'draft-stream-001',
        version: 1,
        sequence: 1,
        projectType: 'software',
        modules: [],
      },
      {
        type: 'draft.completed',
        draftId: 'draft-stream-001',
        version: 1,
        sequence: 2,
        draft: streamedDraft,
        meta: mockMeta,
        validation: mockValidation,
      },
    ]
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('')
    vi.mocked(aiDraftApi.stream).mockResolvedValue(
      new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-stream-001',
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

    await waitFor(() => expect(screen.getByText('草案审查')).toBeInTheDocument())
    expect(aiDraftApi.get).toHaveBeenCalledWith('draft-stream-001')
    expect(screen.getByText('测试项目')).toBeInTheDocument()
    expect(screen.queryByText('流内临时标题')).not.toBeInTheDocument()
  })

  test('(3.3) 刷新后按作用域 cursor 重放，并收敛到权威审查版本', async () => {
    login(['ai:trigger'])
    useAiProjectDraftStore.setState({ userId: 1, organizationId: 8 })
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-resume-001',
      version: 1,
      lastSequence: 4,
    })
    const completed = {
      type: 'draft.completed',
      draftId: 'draft-resume-001',
      version: 1,
      sequence: 5,
      draft: mockDraft,
      meta: mockMeta,
      validation: mockValidation,
    }
    vi.mocked(aiDraftApi.events).mockResolvedValue(
      new Response(`event: draft.completed\ndata: ${JSON.stringify(completed)}\n\n`),
    )
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-resume-001',
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

    await waitFor(() => expect(screen.getByText('草案审查')).toBeInTheDocument())
    expect(aiDraftApi.get).toHaveBeenCalledWith('draft-resume-001')
    expect(aiDraftApi.events).not.toHaveBeenCalled()
  })

  test('刷新或 SSE 尾帧丢失时从详情恢复已落库失败终态与具体错误', async () => {
    login(['ai:trigger'])
    useAiProjectDraftStore.setState({ userId: 1, organizationId: 8 })
    writeDraftProgressCursor({
      userId: 1,
      organizationId: 8,
      draftId: 'draft-failed-001',
      version: 1,
      lastSequence: 4,
    })
    const failed = {
      type: 'draft.failed' as const,
      draftId: 'draft-failed-001',
      version: 1,
      sequence: 5,
      errorCode: 'MODEL_RESPONSE_JSON_INVALID',
      message: '模型返回的草案格式不完整，自动修复后仍无法解析。',
      consistency: 'failed' as const,
    }
    vi.mocked(aiDraftApi.events).mockResolvedValue(
      new Response('', { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    vi.mocked(aiDraftApi.get).mockResolvedValue({
      draftId: 'draft-failed-001',
      version: 0,
      status: 'error',
      generationState: 'settled',
      projectType: 'software',
      draft: null,
      meta: null,
      validation: null,
      events: [failed],
      failure: {
        errorCode: failed.errorCode,
        message: failed.message,
        consistency: failed.consistency,
        sequence: failed.sequence,
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('草案生成失败')).toBeInTheDocument())
    expect(screen.getByText(/MODEL_RESPONSE_JSON_INVALID/)).toBeInTheDocument()
    expect(screen.getByText(/自动修复后仍无法解析/)).toBeInTheDocument()
    expect(useAiProjectDraftStore.getState().progressProjection.terminal).toBe('failed')
  })

  test('(5.8) drafting 状态显示正在生成进度', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'drafting',
      draftId: 'draft-test-001',
      moduleStatuses: { charter: 'generating', wbs: 'pending' },
    })
    renderPage()
    expect(screen.getByText('正在生成项目草案')).toBeInTheDocument()
    expect(screen.getByText('项目章程')).toBeInTheDocument()
    expect(screen.getByText('工作分解结构')).toBeInTheDocument()
    expect(screen.getByText((c) => c.includes('会话') && c.includes('draft'))).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '草案模块生成进度' })).toHaveAttribute(
      'aria-valuemax',
      '9',
    )
  })

  test('(4.5) 连接中断保留模块进度并提供显式恢复，不自动重试', () => {
    setupReadyState()
    const projection = reduceDraftProgress(
      createDraftProgressProjection({ draftId: 'draft-test-001', lastSequence: 4 }),
      { kind: 'transport.disconnected', message: '连接静默超时' },
    )
    useAiProjectDraftStore.setState({
      draftStatus: 'drafting',
      draftId: 'draft-test-001',
      moduleStatuses: { charter: 'completed', wbs: 'generating' },
      progressProjection: projection,
    })

    renderPage()
    expect(screen.getByText('连接静默超时')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /继续接收进度/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新生成/ })).toBeInTheDocument()
    expect(aiDraftApi.events).not.toHaveBeenCalled()
  })

  test('(5.8) reviewing 状态显示草案审查面板', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'reviewing',
      draft: mockDraft,
      draftMeta: mockMeta,
      validation: {
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
      },
    })
    renderPage()
    expect(screen.getByText('草案审查')).toBeInTheDocument()
    expect(screen.getByText('确认导入（全部）')).toBeInTheDocument()
    expect(screen.getByText('拒绝重试')).toBeInTheDocument()
    expect(screen.getByText('保存草稿')).toBeInTheDocument()
    expect(screen.getByText('返回修改')).toBeInTheDocument()
    expect(screen.getByText('测试项目')).toBeInTheDocument()
  })

  test('(5.8) saved 状态显示已保存', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({ draftStatus: 'saved' })
    renderPage()
    expect(screen.getByText('草稿已保存')).toBeInTheDocument()
    expect(screen.getByText('返回上下文')).toBeInTheDocument()
    expect(screen.getByText('重新开始')).toBeInTheDocument()
  })

  test('(5.8) rejected 状态显示已拒绝', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({ draftStatus: 'rejected' })
    renderPage()
    expect(screen.getByText('已拒绝草案')).toBeInTheDocument()
    expect(screen.getByText('返回上下文修改')).toBeInTheDocument()
    expect(screen.getByText('重新开始')).toBeInTheDocument()
  })

  test('(5.8) error 状态显示生成失败', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({ draftStatus: 'error', error: '网络连接异常' })
    renderPage()
    expect(screen.getByText('草案生成失败')).toBeInTheDocument()
    expect(screen.getByText('网络连接异常')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    expect(screen.getByText('返回上下文')).toBeInTheDocument()
  })

  test('(3.2) error 状态包含 stage、reasonCode 与脱敏 errors 时完整渲染', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'error',
      error: '[SCHEMA_VALIDATION_FAILED] 阶段结构校验失败',
      draftFailure: {
        errorCode: 'SCHEMA_VALIDATION_FAILED',
        message: '阶段结构校验失败',
        consistency: 'failed',
        sequence: 4,
        stage: 'resources_risks_acceptance',
        reasonCode: 'SCHEMA_CONSTRAINT_VIOLATION',
        errors: [{ path: 'riskHints[0].level', message: '风险等级必须为 low/medium/high' }],
      },
    })
    renderPage()
    expect(screen.getByText('草案生成失败')).toBeInTheDocument()
    expect(screen.getByText(/资源、风险与验收/)).toBeInTheDocument()
    expect(screen.getByText(/SCHEMA_CONSTRAINT_VIOLATION/)).toBeInTheDocument()
    expect(screen.getByText(/阶段结构校验失败/)).toBeInTheDocument()
    expect(screen.getByText('脱敏错误摘要')).toBeInTheDocument()
    expect(screen.getByText('riskHints[0].level')).toBeInTheDocument()
    expect(screen.getByText(/风险等级必须为 low\/medium\/high/)).toBeInTheDocument()
  })

  test('(3.2) 流式生成返回 draft.failed 事件后页面正确展示阶段标签与原因码', async () => {
    setupReadyState()
    const failedEvent = {
      type: 'draft.failed',
      draftId: 'draft-stream-failed-001',
      version: 1,
      sequence: 2,
      errorCode: 'TOOL_GATE_VIOLATION',
      message: '门禁越权，已被拦截。',
      consistency: 'failed',
      stage: 'charter_scope',
      reasonCode: 'UNAUTHORIZED_TOOL_INVOCATION',
      errors: [{ message: '尝试调用未授权工具' }],
    }
    const frames = [
      `event: draft.started\ndata: ${JSON.stringify({
        type: 'draft.started',
        draftId: 'draft-stream-failed-001',
        version: 1,
        sequence: 1,
        projectType: 'software',
        modules: ['charter'],
      })}\n\n`,
      `event: draft.failed\ndata: ${JSON.stringify(failedEvent)}\n\n`,
    ].join('')

    vi.mocked(aiDraftApi.stream).mockResolvedValue(
      new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } }),
    )

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    await waitFor(() => expect(screen.getByText('草案生成失败')).toBeInTheDocument())
    expect(screen.getByText(/章程与范围/)).toBeInTheDocument()
    expect(screen.getByText(/UNAUTHORIZED_TOOL_INVOCATION/)).toBeInTheDocument()
    expect(screen.getByText(/门禁越权，已被拦截/)).toBeInTheDocument()
    expect(screen.getByText(/尝试调用未授权工具/)).toBeInTheDocument()
  })

  test('(5.8) applying 状态显示导入中', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({ draftStatus: 'applying' })
    renderPage()
    expect(screen.getByText('正在导入草案到正式项目...')).toBeInTheDocument()
    expect(screen.getByText('请勿刷新页面')).toBeInTheDocument()
  })

  // --- 4.5: blocking / warning / autoFix ---

  test('(4.5) blocking 校验禁止确认', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'reviewing',
      draft: mockDraft,
      draftMeta: mockMeta,
      validation: {
        overallRiskLevel: 'high',
        confidenceScore: 0.4,
        dimensionScores: {
          factualAccuracy: 50,
          logicalConsistency: 50,
          assumptionClarity: 100,
          completeness: 100,
          numericPlausibility: 100,
        },
        blocking: [
          {
            ruleId: 'HL-001',
            message: '日期逻辑错误：结束日期早于开始日期',
            severity: 'blocking',
            path: 'charter.startDate',
          },
          {
            ruleId: 'HL-003',
            message: '检测到依赖环路：Task-A → Task-B → Task-A',
            severity: 'blocking',
            path: 'dependencies',
          },
        ],
        warning: [],
        info: [],
        ruleResults: [],
        autoFixDiffs: [],
        canConfirm: false,
      },
    })
    renderPage()
    expect(screen.getByText('校验未通过，禁止确认导入')).toBeInTheDocument()
    expect(screen.getByText('日期逻辑错误：结束日期早于开始日期')).toBeInTheDocument()
    expect(screen.getByText('检测到依赖环路：Task-A → Task-B → Task-A')).toBeInTheDocument()
    const confirmBtn = screen.getByRole('button', { name: /确认导入（全部）/ })
    expect(confirmBtn).toBeDisabled()
  })

  test('fallback 或语义未验证草案显示来源与阶段，且即使结构校验通过也不可确认', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'reviewing',
      draft: mockDraft,
      draftMeta: {
        ...mockMeta,
        fallbackUsed: true,
        consistency: 'repairable',
        confirmability: {
          status: 'review_blocked',
          reasons: ['GROUNDING_VALIDATION_FAILED'],
        },
        provenance: {
          requestedStrategy: 'native',
          effectiveStrategy: 'prompt',
          requestedModel: 'gpt-requested',
          responseModel: 'provider-fallback-model',
          provider: 'openai-compatible',
          fallbackUsed: true,
        },
        stages: [
          {
            stage: 'charter_scope',
            status: 'completed',
            contextScope: ['domain'],
            allowedTools: ['draft.reference_lookup'],
            artifactHash: 'hash',
            attemptCount: 1,
            errorCodes: [],
          },
        ],
      },
      validation: { ...mockValidation, confidenceScore: 75, canConfirm: true },
    })
    renderPage()

    expect(screen.getByText('当前草案不可确认导入')).toBeInTheDocument()
    expect(screen.getByText('GROUNDING_VALIDATION_FAILED')).toBeInTheDocument()
    expect(screen.getByText(/请求模型 gpt-requested/)).toBeInTheDocument()
    expect(screen.getByText(/章程与范围：已完成/)).toBeInTheDocument()
    expect(screen.getByText('75% 置信')).toBeInTheDocument()
    expect(screen.queryByText('100% 置信')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认导入（全部）/ })).toBeDisabled()
  })

  test('(4.5) warning 触发二次确认弹窗', async () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'reviewing',
      draft: mockDraft,
      draftMeta: mockMeta,
      validation: {
        overallRiskLevel: 'medium',
        confidenceScore: 0.65,
        dimensionScores: {
          factualAccuracy: 100,
          logicalConsistency: 85,
          assumptionClarity: 100,
          completeness: 100,
          numericPlausibility: 100,
        },
        blocking: [],
        warning: [
          {
            ruleId: 'VE-002',
            message: '任务工期可能过长（15天）',
            severity: 'warning',
            path: 'tasks.durationDays',
          },
        ],
        info: [],
        ruleResults: [],
        autoFixDiffs: [],
        canConfirm: true,
      },
    })
    renderPage()

    const acceptBtn = screen.getByRole('button', { name: /确认导入（全部）/ })
    expect(acceptBtn).not.toBeDisabled()

    fireEvent.click(acceptBtn)

    await waitFor(() => {
      expect(screen.getByText('确认操作')).toBeInTheDocument()
    })
    const warningMsgs = screen.getAllByText(/任务工期可能过长/)
    expect(warningMsgs.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /取消/ })).toBeInTheDocument()
  })

  test('(4.5) warning 确认后可继续操作', async () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'reviewing',
      draft: mockDraft,
      draftMeta: mockMeta,
      draftId: 'draft-confirm-test',
      draftVersion: 1,
      validation: {
        overallRiskLevel: 'medium',
        confidenceScore: 0.65,
        dimensionScores: {
          factualAccuracy: 100,
          logicalConsistency: 85,
          assumptionClarity: 100,
          completeness: 100,
          numericPlausibility: 100,
        },
        blocking: [],
        warning: [
          {
            ruleId: 'VE-002',
            message: '任务工期可能过长（15天）',
            severity: 'warning',
            path: 'tasks.durationDays',
          },
        ],
        info: [],
        ruleResults: [],
        autoFixDiffs: [],
        canConfirm: true,
      },
    })
    renderPage()

    const acceptBtn = screen.getByRole('button', { name: /确认导入（全部）/ })
    fireEvent.click(acceptBtn)

    await waitFor(() => {
      expect(screen.getByText('确认操作')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => {
      expect(aiDraftApi.confirm).toHaveBeenCalled()
    })
  })

  test('(4.5) 自动修正差异展示 before/after', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'reviewing',
      draft: mockDraft,
      draftMeta: mockMeta,
      validation: {
        overallRiskLevel: 'medium',
        confidenceScore: 0.7,
        dimensionScores: {
          factualAccuracy: 100,
          logicalConsistency: 100,
          assumptionClarity: 100,
          completeness: 100,
          numericPlausibility: 85,
        },
        blocking: [],
        warning: [],
        info: [],
        ruleResults: [],
        autoFixDiffs: [
          { path: 'tasks[0].durationDays', before: 45, after: 30, reason: '工期夹到 30 天上限' },
        ],
        canConfirm: true,
      },
    })
    renderPage()
    expect(screen.getByText('自动修正差异')).toBeInTheDocument()
    expect(screen.getByText('tasks[0].durationDays')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('工期夹到 30 天上限')).toBeInTheDocument()
  })

  // --- 6.8: 确认导入跳转 ---

  test('(6.8) 确认后显示项目 ID 和查看按钮', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: mockConfirmResponse,
    })
    renderPage()
    expect(screen.getByText('项目已创建')).toBeInTheDocument()
    expect(screen.getByText(/项目 ID：42/)).toBeInTheDocument()
    expect(screen.getByText(/已导入 8 个任务/)).toBeInTheDocument()
    const viewBtn = screen.getByRole('button', { name: /查看项目/ })
    expect(viewBtn).toBeInTheDocument()
    expect(viewBtn).not.toBeDisabled()
    expect(screen.getByText('创建下一个项目')).toBeInTheDocument()
  })

  test('(6.8) 查看项目按钮存在且可用', () => {
    setupReadyState()
    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: mockConfirmResponse,
    })
    renderPage()

    const viewBtn = screen.getByRole('button', { name: /查看项目/ })
    expect(viewBtn).toBeInTheDocument()
    expect(viewBtn).not.toBeDisabled()
  })
})
