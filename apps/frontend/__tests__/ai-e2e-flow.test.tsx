import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  PROJECT_DRAFT_SCHEMA_VERSION,
  type AnalyzeProjectIntentResponse,
  type ConfirmProjectDraftResponse,
  type ProjectDraft,
  type ProjectDraftMeta,
} from '@aiproj/types'
import AiCreatePage from '@/app/(dashboard)/ai-create/page'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { accessTokenWith } from './_jwt-helper'

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: { analyze: vi.fn() },
}))

vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    stream: vi.fn(),
    confirm: vi.fn(),
    save: vi.fn(),
    reject: vi.fn(),
    get: vi.fn(),
    events: vi.fn(),
    retry: vi.fn(),
  },
}))

function makeReadyResponse(
  rawInput = '开发一个面向团队的E2E测试项目',
): AnalyzeProjectIntentResponse {
  const parsedIntent = {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    projectType: 'software' as const,
    projectName: 'E2E测试',
    objectives: ['测试项目'],
    deliverables: ['Web 端'],
    timeline: { startDate: null, deadline: null, durationDays: null },
    constraints: [],
    entities: [],
    overallConfidence: 0.85,
  }
  return {
    parsedIntent,
    cards: [],
    confirmedContext: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      rawInput,
      parsedIntent,
      resolvedFields: {},
      assumptions: {},
      unresolvedCriticalFields: [],
      unansweredOptionalFields: [],
    },
    branch: 'ready',
    summary: { critical: 0, recommended: 0, optional: 0 },
  }
}

const mkMarker = (confidence: number, needsConfirmation = false) => ({
  confidence,
  source: 'inferred' as const,
  reason: '推断',
  needsConfirmation,
})

const mkMarked = <T extends string | number | readonly string[]>(
  value: T,
  confidence = 0.8,
  needsConfirmation = false,
) => ({
  value,
  marker: mkMarker(confidence, needsConfirmation),
})

const mockDraft: ProjectDraft = {
  schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
  projectType: 'software',
  charter: {
    title: mkMarked('E2E测试项目', 0.9),
    vision: mkMarked('测试愿景'),
    scope: mkMarked('测试范围'),
    objectives: mkMarked(['目标1']),
    successCriteria: mkMarked(['标准1']),
    startDate: mkMarked('2026-07-01', 0.7, true),
    endDate: mkMarked('2026-09-30', 0.7, true),
  },
  wbs: [
    {
      id: 'w1',
      parentId: null,
      outlineCode: '1',
      name: mkMarked('阶段一', 0.85),
      description: mkMarked('第一阶段'),
      isLeaf: true,
      isNote: false,
      children: [],
    },
  ],
  tasks: [
    {
      id: 't1',
      wbsNodeId: 'w1',
      name: mkMarked('需求分析', 0.85),
      description: mkMarked('收集需求'),
      status: 'not_started' as const,
      durationDays: mkMarked(5, 0.7, true),
      startDate: mkMarked('2026-07-01', 0.7, true),
      endDate: mkMarked('2026-07-07', 0.7, true),
      assigneeHint: mkMarked('产品经理', 0.6, true),
    },
    {
      id: 't2',
      wbsNodeId: 'w1',
      name: mkMarked('系统设计', 0.85),
      description: mkMarked('架构设计'),
      status: 'not_started' as const,
      durationDays: mkMarked(8, 0.7, true),
      startDate: mkMarked('2026-07-08', 0.7, true),
      endDate: mkMarked('2026-07-18', 0.7, true),
      assigneeHint: mkMarked('架构师', 0.6, true),
    },
  ],
  dependencies: [
    {
      id: 'd1',
      predecessorId: 't1',
      successorId: 't2',
      type: 'FS' as const,
      lagDays: mkMarked(0, 0.7),
    },
  ],
  acceptanceCriteria: [
    {
      id: 'a1',
      statement: mkMarked('需求文档通过评审'),
      linkedTaskId: null,
      linkedSuccessIndex: null,
    },
  ],
  resourceHints: [
    {
      id: 'r1',
      role: mkMarked('产品经理'),
      headcount: mkMarked(1),
      allocationNote: mkMarked('全职'),
    },
  ],
  riskHints: [
    {
      id: 'risk1',
      description: mkMarked('新技术栈风险'),
      level: mkMarked('medium' as const),
      mitigation: mkMarked('安排预研时间'),
    },
  ],
  milestoneHints: [
    { id: 'm1', name: mkMarked('里程碑1'), targetDate: mkMarked('2026-07-18'), linkedTaskIds: [] },
  ],
  ganttPreview: {
    startDate: mkMarked('2026-07-01', 0.7, true),
    endDate: mkMarked('2026-09-30', 0.7, true),
    totalDurationDays: mkMarked(90, 0.7, true),
    criticalPathTaskIds: [],
    phaseCount: 1,
  },
}

const mockMeta: ProjectDraftMeta = {
  schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
  projectType: 'software',
  structuredStrategy: 'native',
  consistency: 'strict',
  fallbackUsed: false,
  provider: 'mock',
  model: 'mock-model',
  usingRealAdapter: false,
  appliedFixes: [],
  moduleCounts: {
    wbsNodes: 1,
    tasks: 2,
    dependencies: 1,
    acceptanceCriteria: 1,
    resourceHints: 1,
    riskHints: 1,
    milestoneHints: 1,
  },
}

function login(permissions: string[]) {
  act(() => {
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
  })
}

function wrapper(qc?: QueryClient) {
  const queryClient = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('AI草案生成完整E2E流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清除 sessionStorage 避免上次测试的持久化状态干扰
    sessionStorage.removeItem('aiproj-ai-project-draft-v1')
    sessionStorage.removeItem('aiproj-auth-session')
    login(['ai:trigger'])
    act(() => {
      useAiProjectDraftStore.setState({
        status: 'idle',
        draftStatus: null,
        draftId: null,
        draft: null,
        draftMeta: null,
        moduleStatuses: {},
        validation: null,
        error: null,
        restored: false,
        rawInput: '',
        cards: [],
        parsedIntent: null,
        context: null,
        answers: {},
        userId: null,
        organizationId: null,
      })
    })
  })

  test('完整流程：输入意图 → 上下文就绪 → 生成草案 → 审查 → 确认 → 跳转', async () => {
    Object.defineProperty(window, 'location', {
      value: { href: '', pathname: '/ai-create' },
      writable: true,
    })

    const mockConfirmResponse: ConfirmProjectDraftResponse = {
      projectId: 42,
      createdCounts: {
        wbsNodes: 1,
        tasks: 2,
        dependencies: 1,
        milestones: 0,
        acceptanceCriteria: 1,
        risks: 1,
      },
    }

    vi.mocked(aiIntentApi.analyze).mockResolvedValue(makeReadyResponse())

    render(<AiCreatePage />, { wrapper: wrapper() })

    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向团队的E2E测试项目' },
    })

    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    await waitFor(
      () => {
        expect(useAiProjectDraftStore.getState().status).toBe('ready')
      },
      { timeout: 5000 },
    )

    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    await waitFor(
      () => {
        expect(useAiProjectDraftStore.getState().draftStatus).toBe('drafting')
      },
      { timeout: 5000 },
    )

    act(() => {
      useAiProjectDraftStore.setState({
        draftStatus: 'reviewing',
        draftId: 'draft-001',
        draft: mockDraft,
        draftMeta: mockMeta,
        moduleStatuses: { charter: 'completed', wbs: 'completed', tasks: 'completed' },
        validation: null,
      })
    })

    await waitFor(
      () => {
        expect(screen.getByText('草案审查')).toBeTruthy()
      },
      { timeout: 5000 },
    )

    expect(screen.getByText('E2E测试项目')).toBeTruthy()
    expect(screen.getByText('需求分析')).toBeTruthy()
    expect(screen.getByText('系统设计')).toBeTruthy()

    vi.mocked(aiDraftApi.confirm).mockResolvedValue(mockConfirmResponse)
    fireEvent.click(screen.getByRole('button', { name: /确认导入（全部）/ }))

    await waitFor(
      () => {
        expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
      },
      { timeout: 5000 },
    )

    fireEvent.click(screen.getByRole('button', { name: /查看项目/ }))

    await waitFor(
      () => {
        expect(window.location.href).toBe('/projects/42')
      },
      { timeout: 5000 },
    )
  })

  test('拒绝重试流程：ready → drafting → reviewing → 拒绝 → 重试 → 重新审查', async () => {
    Object.defineProperty(window, 'location', {
      value: { href: '', pathname: '/ai-create' },
      writable: true,
    })

    vi.mocked(aiIntentApi.analyze).mockResolvedValue(
      makeReadyResponse('开发一个拒绝重试流程测试项目'),
    )

    render(<AiCreatePage />, { wrapper: wrapper() })

    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个拒绝重试流程测试项目' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    await waitFor(
      () => {
        expect(screen.getByText('上下文已就绪，准备生成草案')).toBeTruthy()
      },
      { timeout: 5000 },
    )

    fireEvent.click(screen.getByRole('button', { name: /开始生成草案/ }))

    await waitFor(
      () => {
        expect(useAiProjectDraftStore.getState().draftStatus).toBe('drafting')
      },
      { timeout: 5000 },
    )

    login(['ai:trigger'])
    act(() => {
      useAiProjectDraftStore.setState({
        draftStatus: 'reviewing',
        draftId: 'draft-002',
        draft: mockDraft,
        draftMeta: mockMeta,
        moduleStatuses: { charter: 'completed', tasks: 'completed' },
      })
    })

    await waitFor(
      () => {
        expect(screen.getByText('草案审查')).toBeTruthy()
      },
      { timeout: 5000 },
    )

    vi.mocked(aiDraftApi.reject).mockResolvedValue({ draftId: 'draft-002', status: 'rejected' })
    act(() => {
      useAiProjectDraftStore.setState({ draftStatus: 'rejected', error: '用户拒绝' })
    })

    await waitFor(
      () => {
        expect(screen.getByText(/草案已拒绝|重试|重新生成/)).toBeTruthy()
      },
      { timeout: 5000 },
    )

    act(() => {
      useAiProjectDraftStore.setState({
        draftStatus: 'drafting',
        error: null,
        draftId: null,
        draft: null,
      })
    })

    login(['ai:trigger'])
    act(() => {
      useAiProjectDraftStore.setState({
        draftStatus: 'reviewing',
        draftId: 'draft-003',
        draft: mockDraft,
        draftMeta: mockMeta,
      })
    })

    await waitFor(
      () => {
        expect(screen.getByText('草案审查')).toBeTruthy()
      },
      { timeout: 5000 },
    )
  }, 15_000)
})
