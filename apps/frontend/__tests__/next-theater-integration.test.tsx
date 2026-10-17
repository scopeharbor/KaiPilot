/**
 * v3-ui-next-theater-intent-clarify 任务 4.2 —— 生成剧场端到端集成测试。
 *
 * 覆盖：
 * - PM 用户全链路：一句话意图输入 → Ctrl+Enter 提交 → 要素 HUD → 逐题澄清
 *   （Critical 必答阻断/Recommended 默认假设免责/Optional 跳过）→ 澄清收尾重算 → 就绪态
 *   Confirmed Context 报告 → 人工点击「开始生成项目草案」（B2b 占位，零网络请求）→
 *   「重新调整回答」经 revealCard 回跳澄清流；
 * - 就绪态零自动请求（RL-01：网络调用数在等待期间恒为 0）；
 * - 流式解释展开（打字机输出）与主动中断（AbortController.abort）且追问不记答案；
 * - Observer 无 ai:trigger：TheaterPermissionFallback 只读拦截，物理阻断输入与分析请求；
 * - 错误 → 现场保留 → 「重新分析」retry 恢复链路。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  type AnalyzeProjectIntentResponse,
  type ClarificationCard,
  type ConfirmedProjectContext,
  type ParsedIntent,
} from '@aiproj/types'
import NextCreatePage from '@/app/(next)/next/create/page'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'
import { asMock } from './_mock-types'

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: {
    analyze: vi.fn(),
    explainStream: vi.fn(),
  },
}))

/** B2b 生成流客户端 mock：就绪态点击后 page 调用（真实 client 全链路见 v3-ui-next-theater-generation 集成测试）。 */
const streamClientMock = vi.hoisted(() => ({ runDraftGenerationStream: vi.fn() }))

vi.mock('@/lib/next/theater-sse-client', () => ({
  runDraftGenerationStream: streamClientMock.runDraftGenerationStream,
}))

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/create',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const VALID_INTENT = '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计'

const analyzeMock = vi.mocked(aiIntentApi.analyze)
const explainStreamMock = vi.mocked(aiIntentApi.explainStream)

const criticalCard: ClarificationCard = {
  cardId: 'projectGoal-critical-v1',
  field: 'projectGoal',
  category: 'critical',
  title: '项目目标是什么？',
  description: '请补充这个项目最重要的业务目标。',
  impactScope: [{ domain: '项目章程', severity: 'high' }],
  questionType: 'single_choice',
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
    label: '补充自定义要求',
    placeholder: '请输入补充说明',
    description: '如果以上选项不适合，可以直接补充 projectGoal 的真实情况。',
  },
  defaultValue: null,
  confidence: 0.5,
  reasoning: '目标缺失。',
  allowSkip: false,
  isRequired: true,
}

const recommendedCard: ClarificationCard = {
  cardId: 'methodology-recommended-v1',
  field: 'methodology',
  category: 'recommended',
  title: '采用什么研发方法？',
  description: '建议补充研发方法。',
  impactScope: [{ domain: '研发管理', severity: 'medium' }],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '敏捷迭代',
      value: '敏捷迭代',
      description: '短周期交付。',
      recommended: true,
    },
  ],
  customInput: {
    enabled: true,
    label: '补充自定义要求',
    placeholder: '请输入补充说明',
    description: '如果以上选项不适合，可以直接补充 methodology 的真实情况。',
  },
  defaultValue: {
    value: '敏捷迭代',
    marker: {
      source: 'default',
      confidence: 0.6,
      reason: '常见默认研发方法。',
      needsConfirmation: false,
    },
  },
  confidence: 0.6,
  reasoning: '方法缺失。',
  allowSkip: true,
  isRequired: false,
}

const optionalCard: ClarificationCard = {
  cardId: 'designPreference-optional-v1',
  field: 'designPreference',
  category: 'optional',
  title: '界面偏好是什么？',
  description: '可选补充界面风格。',
  impactScope: [{ domain: '体验', severity: 'low' }],
  questionType: 'single_choice',
  quickOptions: [
    {
      label: '简洁专业',
      value: '简洁专业',
      description: '克制克制的视觉基调。',
      recommended: false,
    },
  ],
  customInput: {
    enabled: true,
    label: '补充自定义要求',
    placeholder: '请输入补充说明',
    description: '如果以上选项不适合，可以直接补充 designPreference 的真实情况。',
  },
  defaultValue: {
    value: '简洁专业',
    marker: {
      source: 'default',
      confidence: 0.7,
      reason: '常见默认偏好。',
      needsConfirmation: false,
    },
  },
  confidence: 0.6,
  reasoning: '偏好缺失。',
  allowSkip: true,
  isRequired: false,
}

const parsedIntent: ParsedIntent = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  projectType: 'software',
  projectName: '企业级敏捷协作平台',
  objectives: ['搭建企业级跨部门敏捷项目协作系统'],
  deliverables: ['任务看板', '工时统计'],
  timeline: { startDate: '2026-09-01', deadline: '2026-12-01', durationDays: 90 },
  constraints: [],
  entities: [],
  overallConfidence: 0.78,
}

function clarifyResponse(): AnalyzeProjectIntentResponse {
  return {
    parsedIntent,
    cards: [criticalCard, recommendedCard, optionalCard],
    confirmedContext: asMock<ConfirmedProjectContext>(null),
    branch: 'clarify',
    summary: { critical: 1, recommended: 1, optional: 1 },
    phase: 'core',
    activeCard: criticalCard,
    remainingCount: 3,
    completedCount: 0,
    totalCount: 3,
    questionPlanRevision: 'rev-1',
    adaptiveSessionToken: 'session-token-1',
  }
}

const confirmedContext: ConfirmedProjectContext = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  rawInput: VALID_INTENT,
  parsedIntent,
  resolvedFields: {
    teamSize: {
      value: '6 人',
      marker: {
        source: 'explicit',
        confidence: 0.95,
        reason: '用户确认。',
        needsConfirmation: false,
      },
    },
    techStack: {
      value: 'Next.js + AdonisJS',
      marker: {
        source: 'default',
        confidence: 0.6,
        reason: '默认技术栈。',
        needsConfirmation: true,
      },
    },
  },
  assumptions: {
    methodology: {
      value: '敏捷迭代',
      marker: {
        source: 'default',
        confidence: 0.6,
        reason: 'AI 默认假设。',
        needsConfirmation: false,
      },
    },
  },
  unresolvedCriticalFields: [],
  unansweredOptionalFields: [],
}

function readyResponse(): AnalyzeProjectIntentResponse {
  return {
    parsedIntent,
    cards: [],
    confirmedContext,
    branch: 'ready',
    summary: { critical: 0, recommended: 0, optional: 0 },
    phase: 'ready',
    activeCard: null,
    remainingCount: 0,
    completedCount: 3,
    totalCount: 3,
    questionPlanRevision: 'rev-1',
    adaptiveSessionToken: 'session-token-1',
  }
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function resetDraft() {
  useAiProjectDraftStore.setState({
    status: 'idle',
    rawInput: '',
    cards: [],
    answers: {},
    parsedIntent: null,
    context: null,
    clarificationPhase: 'core',
    activeCard: null,
    remainingCount: 0,
    completedCount: 0,
    totalCount: 0,
    questionPlanRevision: null,
    agentQuestionPlanToken: null,
    adaptiveSession: null,
    adaptiveSessionToken: null,
    questionPlanCoverage: null,
    error: null,
    restored: false,
    // 草案会话字段：清空上一测试残留（如生成中态），避免污染后续用例
    draftStatus: null,
    draftId: null,
    draftVersion: 0,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
    moduleStatuses: {},
    lastEventSequence: 0,
  })
}

/** 输入合法意图并 Ctrl+Enter 提交（进入 analyzing → analyze 通道）。 */
function submitIntent() {
  fireEvent.change(screen.getByLabelText('用一句话描述项目意图'), {
    target: { value: VALID_INTENT },
  })
  fireEvent.keyDown(screen.getByLabelText('用一句话描述项目意图'), {
    key: 'Enter',
    ctrlKey: true,
  })
}

beforeEach(() => {
  routerPush.mockClear()
  analyzeMock.mockReset()
  explainStreamMock.mockReset()
  streamClientMock.runDraftGenerationStream.mockReset()
  streamClientMock.runDraftGenerationStream.mockResolvedValue({
    status: 'aborted',
    draftId: null,
    lastSequence: 0,
    errorCode: null,
    message: null,
    recoveredFromSnapshot: false,
  })
  resetDraft()
  setAuth(['ai:trigger'])
})

describe('生成剧场全链路（app/(next)/next/create/page.tsx，任务 4.1/4.2）', () => {
  test('PM 全链路：意图 → 解析 → 逐题澄清（Critical 必答阻断/Recommended 默认假设/Optional 跳过）→ 就绪态报告 → revealCard 回跳 → 重新就绪 → 点击生成进入生成流', async () => {
    analyzeMock
      .mockResolvedValueOnce(clarifyResponse())
      .mockResolvedValueOnce(readyResponse())
      .mockResolvedValueOnce(readyResponse())
    render(<NextCreatePage />)

    // 初始：idle 意图输入态
    expect(screen.getByLabelText('用一句话描述项目意图')).toBeInTheDocument()

    // 提交 → 解析成功 → 澄清卡 + 要素 HUD
    submitIntent()
    await screen.findByText('项目目标是什么？')
    expect(screen.getByText('软件系统')).toBeInTheDocument()
    expect(document.querySelector('[data-theater-feedback]')).toBeTruthy()
    expect(document.querySelector('[data-theater-feedback-confidence]')).toBeTruthy()
    expect(analyzeMock).toHaveBeenCalledTimes(1)

    // Critical 必答阻断：未选择时确认按钮禁用
    const confirmButton = () => screen.getByRole('button', { name: /确认此项/ })
    expect(confirmButton()).toBeDisabled()
    expect(screen.queryByRole('button', { name: /跳过此项/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /采用 AI 默认假设/ })).not.toBeInTheDocument()

    // 选择快捷选项后可确认 → 推进到 Recommended 题
    fireEvent.click(screen.getByRole('button', { name: /提升运营效率/ }))
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())
    await screen.findByText('采用什么研发方法？')

    // Recommended：显式「采用 AI 默认假设」+「AI 假设免责」标记
    expect(screen.getByText('AI 推断默认值：敏捷迭代')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /采用 AI 默认假设/ })).toBeInTheDocument()
    expect(document.querySelector('[data-clarify-default-marker]')).toHaveTextContent('AI 假设免责')
    fireEvent.click(screen.getByRole('button', { name: /采用 AI 默认假设/ }))
    await screen.findByText('界面偏好是什么？')

    // Optional：显式跳过
    fireEvent.click(screen.getByRole('button', { name: /跳过此项/ }))

    // 全部作答完毕 → 重算（第二次 analyze 带全部 answers）→ 就绪态
    await screen.findByText('澄清完成 · 生成就绪')
    expect(analyzeMock).toHaveBeenCalledTimes(2)
    const recomputeRequest = analyzeMock.mock.calls[1]![0] as { answers: object }
    expect(Object.keys(recomputeRequest.answers)).toHaveLength(3)

    // 就绪态报告：项目名称 / 团队资源 / AI 默认假设免责清单 / 等待人工确认
    expect(screen.getByText('企业级敏捷协作平台')).toBeInTheDocument()
    expect(document.querySelector('[data-ready-status]')).toHaveTextContent('等待人工确认')
    expect(document.querySelectorAll('[data-assumption-flag="default"]').length).toBeGreaterThan(0)
    expect(screen.getByText('AI 默认假设免责清单')).toBeInTheDocument()

    // 人工确认关卡：未点击前主行动按钮存在，无任何新的生成请求
    expect(screen.getByRole('button', { name: /开始生成项目草案/ })).toBeInTheDocument()
    expect(analyzeMock).toHaveBeenCalledTimes(2)
    expect(streamClientMock.runDraftGenerationStream).not.toHaveBeenCalled()

    // 「重新调整回答」→ revealCard 回跳澄清流第一题（就绪态反悔入口，零生成请求）
    fireEvent.click(screen.getByRole('button', { name: /重新调整回答/ }))
    await screen.findByText('项目目标是什么？')
    expect(document.querySelector('[data-clarify-card]')).toBeTruthy()
    expect(screen.queryByText('澄清完成 · 生成就绪')).not.toBeInTheDocument()
    // 回跳重放时预填上一次的回答：展开自定义输入后可见（previousAnswerText）
    fireEvent.click(screen.getByRole('button', { name: '补充自定义要求' }))
    expect(screen.getByDisplayValue('提升运营效率')).toBeInTheDocument()

    // 重新作答收尾 → 第三次 analyze 携带既有 answers 直通就绪（回跳不破坏澄清状态）
    expect(streamClientMock.runDraftGenerationStream).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /提升运营效率/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))
    await screen.findByText('澄清完成 · 生成就绪')
    expect(analyzeMock).toHaveBeenCalledTimes(3)

    // 点击主行动按钮 → 接通真实生成调度：进入 generating 态（Stage），以已确认
    // context 调用生成流客户端；全程不再走分析通道（RL-01：生成零自动触发）
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
    expect(await screen.findByRole('heading', { name: '草案生成中' })).toBeInTheDocument()
    expect(document.querySelector('[data-theater-generation-stage]')).toBeTruthy()
    expect(streamClientMock.runDraftGenerationStream).toHaveBeenCalledTimes(1)
    const streamOptions = streamClientMock.runDraftGenerationStream.mock.calls[0]![0] as {
      context: ConfirmedProjectContext
      signal: AbortSignal
    }
    expect(streamOptions.context).toEqual(confirmedContext)
    expect(streamOptions.signal).toBeInstanceOf(AbortSignal)
    expect(analyzeMock).toHaveBeenCalledTimes(3)
  })

  test('流式解释展开与打字机输出：追问仅驻留内存，绝不写入澄清答案', async () => {
    analyzeMock.mockResolvedValueOnce(clarifyResponse())
    explainStreamMock.mockImplementation((_input, onDelta) => {
      onDelta('「里程碑」指项目推进中的关键检查节点，用于对齐阶段进度。')
      onDelta('建议在首个里程碑前安排一次演示。')
      return Promise.resolve()
    })
    render(<NextCreatePage />)

    submitIntent()
    await screen.findByText('项目目标是什么？')

    // 展开解释气泡：只读流式输出完整文本
    fireEvent.click(screen.getByRole('button', { name: /我不了解这道题/ }))
    await screen.findByText(/建议在首个里程碑前安排一次演示/)
    expect(document.querySelector('[data-explain-bubble]')).toBeTruthy()
    expect(screen.getByText(/关于「项目目标是什么？」的解释/)).toBeInTheDocument()
    expect(explainStreamMock).toHaveBeenCalledTimes(1)

    // 只读性：解释过程 answers 零写入（RL-01/RL-12）
    expect(Object.keys(useAiProjectDraftStore.getState().answers)).toHaveLength(0)

    // 收起气泡：不产生答案、等待澄清卡状态不变
    fireEvent.click(screen.getByRole('button', { name: '收起解释' }))
    expect(document.querySelector('[data-explain-bubble]')).toBeNull()
    expect(screen.getByText('项目目标是什么？')).toBeInTheDocument()
    expect(Object.keys(useAiProjectDraftStore.getState().answers)).toHaveLength(0)
  })

  test('主动中断解释流：关闭气泡立即 abort 底层 SSE', async () => {
    analyzeMock.mockResolvedValueOnce(clarifyResponse())
    const abortSignals: AbortSignal[] = []
    explainStreamMock.mockImplementation((_input, _onDelta, signal) => {
      abortSignals.push(signal!)
      return new Promise<void>(() => {
        // 永挂起：模拟 SSE 迟迟未完成，直至用户关闭触发 abort
      })
    })
    render(<NextCreatePage />)

    submitIntent()
    await screen.findByText('项目目标是什么？')

    fireEvent.click(screen.getByRole('button', { name: /我不了解这道题/ }))
    expect(document.querySelector('[data-explain-bubble]')).toBeTruthy()
    expect(abortSignals).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '收起解释' }))
    expect(document.querySelector('[data-explain-bubble]')).toBeNull()
    expect(abortSignals[0]?.aborted).toBe(true)
  })

  test('解析失败 → 错误卡现场保留 → 「重新分析」retry 恢复澄清流', async () => {
    analyzeMock
      .mockRejectedValueOnce(new Error('模拟网络连接失败'))
      .mockResolvedValueOnce(clarifyResponse())
    render(<NextCreatePage />)

    submitIntent()

    // 错误卡：原因分类 + 原始输入保留
    await screen.findByRole('alert', { name: '意图解析错误' })
    expect(screen.getByText(/模型、代理或后端连接在等待期间中断/)).toBeInTheDocument()
    expect(screen.getByText(`原始输入已保留（${VALID_INTENT.length} 字符）`)).toBeInTheDocument()
    expect(screen.getByLabelText('已保留的原始输入预览')).toHaveTextContent(VALID_INTENT)

    // 重新分析：沿用现场数据重发请求并恢复澄清流
    fireEvent.click(screen.getByRole('button', { name: /重新分析/ }))
    await screen.findByText('项目目标是什么？')
    expect(analyzeMock).toHaveBeenCalledTimes(2)
  })

  test('Observer 无 ai:trigger：TheaterPermissionFallback 只读拦截，物理阻断输入与分析', () => {
    setAuth([])
    render(<NextCreatePage />)

    expect(screen.getByText('仅审查模式')).toBeInTheDocument()
    expect(
      screen.getByText(/当前角色仅供审查，需要项目经理或管理员权限方可发起 AI 项目创建/),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-theater-permission-fallback]')).toBeTruthy()
    expect(screen.queryByLabelText('用一句话描述项目意图')).not.toBeInTheDocument()
    expect(document.querySelector('[data-theater-shell]')).toBeNull()
    expect(analyzeMock).not.toHaveBeenCalled()
  })
})
