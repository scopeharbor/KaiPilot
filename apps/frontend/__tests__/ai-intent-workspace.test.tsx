import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  AI_INTENT_SCHEMA_VERSION,
  type AnalyzeProjectIntentResponse,
  type ClarificationCard,
} from '@aiproj/types'
import AiCreatePage from '@/app/(dashboard)/ai-create/page'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import type { OutputLane } from '@/lib/ai-draft/output-lanes'
import { useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useCopilotOperatingEntry } from '@/lib/copilot/operating-entry'
import { accessTokenWith } from './_jwt-helper'

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: { analyze: vi.fn() },
}))

vi.mock('@/lib/api/ai-connections', () => ({
  aiConnectionsApi: { list: vi.fn() },
}))

vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: vi.fn(() => '11111111-2222-4333-8444-555555555555'),
  useLiveOutputLanes: vi.fn(() => ({ lanes: [], totalChars: 0 })),
}))

const criticalCard: ClarificationCard = {
  cardId: 'projectGoal-critical-v1',
  field: 'projectGoal',
  category: 'critical',
  title: '项目目标是什么？',
  description: '请补充这个项目最重要的业务目标。',
  impactScope: [{ domain: '项目章程', severity: 'high' }],
  questionType: 'text',
  quickOptions: [
    {
      label: '提升运营效率',
      value: '提升运营效率',
      description: '适合内部流程优化项目。',
      recommended: true,
    },
  ],
  customInput: {
    enabled: true,
    label: '自定义输入',
    placeholder: '请输入补充说明',
    description: '如果以上选项不适合，可以直接补充 projectGoal 的真实情况。',
  },
  defaultValue: null,
  confidence: 0.5,
  reasoning: '目标缺失。',
  allowSkip: false,
  isRequired: true,
}

const optionalCard: ClarificationCard = {
  cardId: 'designPreference-optional-v1',
  field: 'designPreference',
  category: 'optional',
  title: '界面偏好是什么？',
  description: '可选补充界面风格。',
  impactScope: [{ domain: '体验', severity: 'low' }],
  questionType: 'text',
  quickOptions: [],
  customInput: {
    enabled: true,
    label: '自定义输入',
    placeholder: '请输入补充说明',
    description: '如果以上选项不适合，可以直接补充 designPreference 的真实情况。',
  },
  defaultValue: {
    value: '简洁专业',
    marker: {
      source: 'default',
      confidence: 0.6,
      reason: '常见默认偏好',
      needsConfirmation: false,
    },
  },
  confidence: 0.6,
  reasoning: '偏好缺失。',
  allowSkip: true,
  isRequired: false,
}

const secondCoreCard: ClarificationCard = {
  ...criticalCard,
  cardId: 'targetUser-critical-v1',
  field: 'targetUser',
  title: '主要使用者是谁？',
  description: '请确认最主要的使用者。',
}

const agentRiskCard: ClarificationCard = {
  ...criticalCard,
  cardId: '1.0:agentRisk:recommended',
  field: 'agentRisk',
  category: 'recommended',
  title: '最需要提前控制的风险是什么？',
  description: '请确认会影响上线的主要风险。',
  phase: 'agent',
  source: 'agent',
  allowSkip: true,
  isRequired: false,
}

const agentDependencyCard: ClarificationCard = {
  ...agentRiskCard,
  cardId: '1.0:agentDependency:recommended',
  field: 'agentDependency',
  title: '哪个外部依赖最可能影响上线？',
}

function makeResponse(
  cards: ClarificationCard[],
  branch: 'clarify' | 'ready',
): AnalyzeProjectIntentResponse {
  const parsedIntent = {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    projectType: 'software' as const,
    projectName: null,
    objectives: [],
    deliverables: ['Web 端'],
    timeline: { startDate: null, deadline: null, durationDays: null },
    constraints: [],
    entities: [
      {
        type: 'platform' as const,
        value: 'Web',
        text: 'Web',
        start: 0,
        end: 3,
        confidence: 0.9,
        source: 'explicit' as const,
      },
    ],
    overallConfidence: 0.72,
  }
  return {
    parsedIntent,
    cards,
    confirmedContext: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      rawInput: '开发一个面向运营团队的内部工单系统',
      parsedIntent,
      resolvedFields: {},
      assumptions:
        branch === 'ready'
          ? {
              designPreference: {
                value: '简洁专业',
                marker: {
                  source: 'default',
                  confidence: 0.6,
                  reason: '用户采用默认假设',
                  needsConfirmation: false,
                },
              },
            }
          : {},
      unresolvedCriticalFields: cards
        .filter((card) => card.category === 'critical')
        .map((card) => card.field),
      unansweredOptionalFields: [],
    },
    branch,
    summary: {
      critical: cards.filter((card) => card.category === 'critical').length,
      recommended: cards.filter((card) => card.category === 'recommended').length,
      optional: cards.filter((card) => card.category === 'optional').length,
    },
    phase: branch === 'ready' ? 'ready' : 'core',
    activeCard: cards[0] ?? null,
    remainingCount: cards.length,
    completedCount: 0,
    totalCount: cards.length,
    questionPlanRevision: branch === 'ready' ? 'revision-ready' : 'revision-core',
    coverage: {
      valid: true,
      requiredIds: cards.map((card) => card.cardId),
      coveredIds: cards.map((card) => card.cardId),
      missingIds: [],
      rejectedIds: [],
      reasonCodes: [],
      selectedPackIds: [],
    },
  }
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

function resetDraft() {
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

describe('/ai-create AI 意图澄清工作台', () => {
  beforeEach(() => {
    useCopilotOperatingEntry.setState({
      input: '',
      route: '/',
      userId: null,
      organizationId: null,
      projectCreation: null,
    })
    vi.mocked(aiIntentApi.analyze).mockReset()
    vi.mocked(aiConnectionsApi.list).mockResolvedValue([])
    vi.mocked(useLiveOutputLanes).mockReturnValue({ lanes: [], totalChars: 0 })
    useAuthStore.getState().clear()
    resetDraft()
  })

  test('Copilot 创建原文带入输入框且不自动调用分析或落库', async () => {
    login(['ai:trigger', 'project:create'])
    useCopilotOperatingEntry.setState({
      userId: '1',
      organizationId: 8,
      projectCreation: '创建一个为期三个月的产品发布项目',
    })
    renderPage()
    await waitFor(() =>
      expect(screen.getByLabelText('项目一句话描述')).toHaveValue(
        '创建一个为期三个月的产品发布项目',
      ),
    )
    expect(aiIntentApi.analyze).not.toHaveBeenCalled()
    expect(useCopilotOperatingEntry.getState().projectCreation).toBeNull()
  })

  test('已有本地草案时必须选择保留或使用新需求', async () => {
    login(['ai:trigger', 'project:create'])
    useAiProjectDraftStore.getState().initializeScope({ userId: 1, organizationId: 8 })
    useAiProjectDraftStore.getState().setRawInput('这是之前尚未完成的项目需求')
    useCopilotOperatingEntry.setState({
      userId: '1',
      organizationId: 8,
      projectCreation: '创建一个新的产品发布项目',
    })
    renderPage()
    expect(screen.getByRole('button', { name: '继续原草案' })).toBeVisible()
    expect(useAiProjectDraftStore.getState().rawInput).toBe('这是之前尚未完成的项目需求')
    fireEvent.click(screen.getByRole('button', { name: '使用新需求开始' }))
    await waitFor(() =>
      expect(screen.getByLabelText('项目一句话描述')).toHaveValue('创建一个新的产品发布项目'),
    )
    expect(aiIntentApi.analyze).not.toHaveBeenCalled()
  })

  test('模糊输入生成关键问题，快速回答后进入 ready 且不出现正式落库操作', async () => {
    login(['ai:trigger'])
    vi.mocked(aiIntentApi.analyze)
      .mockResolvedValueOnce(makeResponse([criticalCard], 'clarify'))
      .mockResolvedValueOnce(makeResponse([], 'ready'))

    renderPage()

    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    expect(await screen.findByText('项目目标是什么？')).toBeInTheDocument()
    expect(screen.getAllByText('关键必答').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '提升运营效率' }))

    await waitFor(() => expect(screen.getByText('上下文已就绪，准备生成草案')).toBeInTheDocument())
    expect(aiIntentApi.analyze).toHaveBeenCalledTimes(2)
    expect(vi.mocked(aiIntentApi.analyze).mock.calls[1]?.[0]).toMatchObject({
      answers: {
        projectGoal: {
          field: 'projectGoal',
          action: 'answer',
          value: '提升运营效率',
        },
      },
    })
    expect(screen.queryByRole('button', { name: /创建正式项目/ })).not.toBeInTheDocument()
  })

  test('可选问题可以采用默认假设并进入草案生成就绪', async () => {
    login(['ai:trigger'])
    vi.mocked(aiIntentApi.analyze)
      .mockResolvedValueOnce(makeResponse([optionalCard], 'clarify'))
      .mockResolvedValueOnce(makeResponse([], 'ready'))

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    expect(await screen.findByText('界面偏好是什么？')).toBeInTheDocument()
    expect(screen.getAllByText('可选优化').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /采用 AI 建议/ }))

    await waitFor(() => expect(screen.getByText('上下文已就绪，准备生成草案')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /开始生成草案/ })).toBeInTheDocument()
    expect(vi.mocked(aiIntentApi.analyze).mock.calls[1]?.[0]).toMatchObject({
      answers: {
        designPreference: {
          action: 'default',
          value: '简洁专业',
        },
      },
    })
  })

  test('服务端返回多张卡时也只显示 activeCard，并展示阶段与剩余题数', async () => {
    login(['ai:trigger'])
    vi.mocked(aiIntentApi.analyze).mockResolvedValueOnce(
      makeResponse([criticalCard, secondCoreCard], 'clarify'),
    )

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    expect(await screen.findByText('项目目标是什么？')).toBeInTheDocument()
    expect(screen.queryByText('主要使用者是谁？')).not.toBeInTheDocument()
    expect(screen.getByText('阶段 1/3 · 核心必答')).toBeInTheDocument()
    expect(screen.getByText('还剩 2 题')).toBeInTheDocument()
  })

  test('Agent 多张卡逐题消费同一签名批次且不会重新开始生成', async () => {
    login(['ai:trigger'])
    const first = {
      ...makeResponse([agentRiskCard, agentDependencyCard], 'clarify'),
      phase: 'agent' as const,
      activeCard: agentRiskCard,
      remainingCount: 2,
      completedCount: 12,
      totalCount: 14,
      questionPlanRevision: 'agent-revision-1',
      agentQuestionPlanToken: 'signed-agent-plan-token',
    }
    const second = {
      ...first,
      cards: [agentDependencyCard],
      activeCard: agentDependencyCard,
      remainingCount: 1,
      completedCount: 13,
      questionPlanRevision: 'agent-revision-2',
    }
    const ready = {
      ...makeResponse([], 'ready'),
      questionPlanRevision: 'agent-revision-3',
      agentQuestionPlanToken: null,
    }
    vi.mocked(aiIntentApi.analyze)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(ready)

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    expect(await screen.findByText('最需要提前控制的风险是什么？')).toBeInTheDocument()
    expect(screen.queryByText('哪个外部依赖最可能影响上线？')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提升运营效率' }))

    expect(await screen.findByText('哪个外部依赖最可能影响上线？')).toBeInTheDocument()
    expect(vi.mocked(aiIntentApi.analyze).mock.calls[1]?.[0]).toMatchObject({
      questionPlanRevision: 'agent-revision-1',
      agentQuestionPlanToken: 'signed-agent-plan-token',
    })
    fireEvent.click(screen.getByRole('button', { name: '提升运营效率' }))

    await waitFor(() => expect(screen.getByText('上下文已就绪，准备生成草案')).toBeInTheDocument())
    expect(vi.mocked(aiIntentApi.analyze).mock.calls[2]?.[0]).toMatchObject({
      questionPlanRevision: 'agent-revision-2',
      agentQuestionPlanToken: 'signed-agent-plan-token',
    })
  })

  test('答案提交失败时保留当前卡片且不把未确认答案写入草案', async () => {
    login(['ai:trigger'])
    vi.mocked(aiIntentApi.analyze)
      .mockResolvedValueOnce(makeResponse([criticalCard], 'clarify'))
      .mockRejectedValueOnce({ message: '问题计划已更新，请重新回答' })

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    expect(await screen.findByText('项目目标是什么？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提升运营效率' }))

    expect(await screen.findByText('问题计划已更新，请重新回答')).toBeInTheDocument()
    expect(screen.getByText('项目目标是什么？')).toBeInTheDocument()
    expect(useAiProjectDraftStore.getState().answers.projectGoal).toBeUndefined()
  })

  test('错误重试保留输入并重新提交', async () => {
    login(['ai:trigger'])
    vi.mocked(aiIntentApi.analyze)
      .mockRejectedValueOnce({ message: '服务暂不可用' })
      .mockResolvedValueOnce(makeResponse([], 'ready'))

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    expect(await screen.findByText('服务暂不可用')).toBeInTheDocument()
    expect(screen.getByLabelText('项目一句话描述')).toHaveValue(
      '开发一个面向运营团队的内部工单系统',
    )

    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    await waitFor(() => expect(screen.getByText('上下文已就绪，准备生成草案')).toBeInTheDocument())
  })

  test('无 ai:trigger 权限显示只读降级', () => {
    login(['project:view'])
    renderPage()

    expect(screen.getByText('当前账号不能使用 AI 创建入口')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /开始分析/ })).not.toBeInTheDocument()
  })

  test('自适应澄清时左侧「澄清进度」与右侧剩余数同源，不再一边 0 一边 6', async () => {
    login(['ai:trigger', 'project:create'])
    // 自适应链路里服务端返回 cards: []。左侧原先数的就是这个空数组，所以永远显示
    // 0/0/0，而右侧显示的是 conversation.remainingEstimate——这正是用户报的不一致。
    const response = makeResponse([], 'clarify')
    const adaptiveSession = {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      sessionId: 'adaptive-1',
      round: 2,
      understanding: {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        summaryForUser: '你要做一个内部工单系统。',
        inferredDomainLabel: '软件系统',
        likelyDeliverables: ['Web 端'],
        knownFacts: [],
        informationNeeds: [],
        sufficientForPreliminaryDraft: false,
      },
      ledger: { schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION, revision: 1, entries: [] },
      knownUnknowns: [],
      status: 'clarifying' as const,
      conversation: {
        schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
        activeNeedId: 'need:scope',
        activeQuestion: {
          needId: 'need:scope',
          question: '这次一定要做的事情有哪些？',
          reason: '范围决定工期与人力。',
          answerKind: 'short_text' as const,
          allowOther: true,
          allowUnknown: true,
        },
        status: 'awaiting_response' as const,
        turns: [],
        understandingRevision: 2,
        ledgerRevision: 1,
        completedCount: 0,
        remainingEstimate: 6,
        remainingBreakdown: { critical: 4, recommended: 1, optional: 1 },
        coverage: [
          { slot: 'scope' as const, status: 'open' as const },
          { slot: 'schedule' as const, status: 'covered' as const },
        ],
        remainingEstimateReason: '问题会根据你的回答调整。',
        canGeneratePreliminaryDraft: false,
        preliminaryDraftReason: '还差 4 项会显著改变计划的信息（项目范围）。',
        currentUnderstanding: '你要做一个内部工单系统。',
      },
    }
    vi.mocked(aiIntentApi.analyze).mockResolvedValue({
      ...response,
      remainingCount: 6,
      completedCount: 0,
      totalCount: 6,
      adaptiveSession,
      adaptiveSessionToken: 'token-1',
    } as AnalyzeProjectIntentResponse)

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    await waitFor(() =>
      expect(screen.getByText(/还有约 6 项待确认（其中关键必答 4 项）/u)).toBeInTheDocument(),
    )
    // 左侧三档必须显示 4/1/1，而不是 0/0/0
    const progress = screen.getByText('澄清进度').closest('div')?.parentElement as HTMLElement
    expect(within(progress).getByText('4')).toBeInTheDocument()
    expect(within(progress).getByText('关键必答')).toBeInTheDocument()
    // 入口关着时也要说清还差什么
    expect(screen.getByText(/还差 4 项会显著改变计划的信息（项目范围）。/u)).toBeInTheDocument()
  })

  test('分析等待期间显示模型实时输出面板，请求体带实时输出频道编号', async () => {
    login(['ai:trigger'])
    const deferred: { resolve?: (value: AnalyzeProjectIntentResponse) => void } = {}
    vi.mocked(aiIntentApi.analyze).mockImplementation(
      () =>
        new Promise<AnalyzeProjectIntentResponse>((resolve) => {
          deferred.resolve = resolve
        }),
    )
    const lane: OutputLane = {
      id: '1',
      label: '理解项目需求',
      text: '项目目标是提升运营效率…',
      reasoning: '',
      model: 'gpt-5.2',
      textChars: 12,
      reasoningChars: 0,
      phase: 'answering',
      done: false,
      order: 0,
    }
    vi.mocked(useLiveOutputLanes).mockReturnValue({ lanes: [lane], totalChars: 12 })

    renderPage()
    fireEvent.change(screen.getByLabelText('项目一句话描述'), {
      target: { value: '开发一个面向运营团队的内部工单系统' },
    })
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))

    // 骨架屏已替换为实时输出面板：逐字文本、模型名、已接收字数都可见
    expect(await screen.findByText('模型实时输出')).toBeInTheDocument()
    expect(screen.getByText('项目目标是提升运营效率…')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText(/已接收 12 字/u)).toBeInTheDocument()
    expect(vi.mocked(aiIntentApi.analyze).mock.calls[0]?.[0]).toMatchObject({
      liveOutputId: '11111111-2222-4333-8444-555555555555',
    })

    deferred.resolve?.(makeResponse([], 'ready'))
    await waitFor(() => expect(screen.getByText('上下文已就绪，准备生成草案')).toBeInTheDocument())
  })
})
