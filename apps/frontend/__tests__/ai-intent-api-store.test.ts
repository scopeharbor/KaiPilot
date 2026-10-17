import { beforeEach, describe, expect, test, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import {
  AI_INTENT_SCHEMA_VERSION,
  type AnalyzeProjectIntentResponse,
  type ClarificationCard,
} from '@aiproj/types'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const card: ClarificationCard = {
  cardId: 'projectGoal-critical-v1',
  field: 'projectGoal',
  category: 'critical',
  title: '项目目标是什么？',
  description: '需要明确项目目标。',
  impactScope: [{ domain: '章程', severity: 'high' }],
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
  confidence: 0.42,
  reasoning: '目标缺失。',
  allowSkip: false,
  isRequired: true,
}

const response: AnalyzeProjectIntentResponse = {
  parsedIntent: {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    projectType: 'software',
    projectName: null,
    objectives: [],
    deliverables: ['Web 端'],
    timeline: { startDate: null, deadline: null, durationDays: null },
    constraints: [],
    entities: [],
    overallConfidence: 0.7,
  },
  cards: [card],
  confirmedContext: {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    rawInput: '开发一个运营系统',
    parsedIntent: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      projectType: 'software',
      projectName: null,
      objectives: [],
      deliverables: ['Web 端'],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.7,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: ['projectGoal'],
    unansweredOptionalFields: [],
  },
  branch: 'clarify',
  summary: { critical: 1, recommended: 0, optional: 0 },
  phase: 'core',
  activeCard: card,
  remainingCount: 1,
  completedCount: 2,
  totalCount: 3,
  questionPlanRevision: 'revision-core-1',
  coverage: {
    valid: true,
    requiredIds: [card.cardId],
    coveredIds: [card.cardId],
    missingIds: [],
    rejectedIds: [],
    reasonCodes: [],
    selectedPackIds: [],
  },
}

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
  })
}

describe('AI 意图 API 与草案 Store', () => {
  beforeEach(() => {
    resetStore()
    vi.restoreAllMocks()
    vi.stubGlobal('crypto', webcrypto)
  })

  test('调用分析端点并保持 {data} 契约', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(202, {
        data: {
          id: 'job-1',
          kind: 'intent',
          state: 'completed',
          result: response,
          liveOutputId: null,
          expiresAt: Date.now() + 60_000,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await aiIntentApi.analyze({ rawInput: '开发一个运营系统' })

    expect(result.branch).toBe('clarify')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai/project-intents/analyze/jobs'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('开发一个运营系统'),
      }),
    )
  })

  test('阶段转换、回答记录与错误重试会保留输入和回答', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.setRawInput('开发一个运营系统')
    store.startAnalyzing()
    store.applyAnalysis(response)

    expect(useAiProjectDraftStore.getState().status).toBe('clarifying')
    expect(useAiProjectDraftStore.getState().cards).toHaveLength(1)
    expect(useAiProjectDraftStore.getState()).toMatchObject({
      clarificationPhase: 'core',
      activeCard: card,
      remainingCount: 1,
      completedCount: 2,
      totalCount: 3,
      questionPlanRevision: 'revision-core-1',
    })

    store.recordAnswer({
      field: 'projectGoal',
      action: 'answer',
      value: '提升运营效率',
      marker: null,
    })
    expect(useAiProjectDraftStore.getState().cards).toHaveLength(0)
    expect(useAiProjectDraftStore.getState().answers.projectGoal?.value).toBe('提升运营效率')

    store.fail('网络错误')
    expect(useAiProjectDraftStore.getState().status).toBe('error')
    expect(useAiProjectDraftStore.getState().rawInput).toBe('开发一个运营系统')
    expect(useAiProjectDraftStore.getState().answers.projectGoal).toBeTruthy()

    store.retry()
    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
    expect(useAiProjectDraftStore.getState().answers.projectGoal?.value).toBe('提升运营效率')
  })

  test('服务端确认成功后才一次性保存本轮提交答案', () => {
    const answer = {
      field: 'projectGoal' as const,
      action: 'answer' as const,
      value: '提升运营效率',
      marker: null,
    }
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.applyAnalysis(response, '开发一个运营系统', { projectGoal: answer })

    expect(useAiProjectDraftStore.getState().answers.projectGoal).toEqual(answer)
  })

  test('Agent 多题签名计划随阶段状态持久化并在完成时清除', () => {
    const agentResponse: AnalyzeProjectIntentResponse = {
      ...response,
      phase: 'agent',
      questionPlanRevision: 'agent-revision-1',
      agentQuestionPlanToken: 'signed-agent-plan-token',
    }
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.applyAnalysis(agentResponse)

    expect(useAiProjectDraftStore.getState()).toMatchObject({
      clarificationPhase: 'agent',
      questionPlanRevision: 'agent-revision-1',
      agentQuestionPlanToken: 'signed-agent-plan-token',
    })

    store.applyAnalysis({
      ...agentResponse,
      cards: [],
      activeCard: null,
      branch: 'ready',
      phase: 'ready',
      agentQuestionPlanToken: null,
    })
    expect(useAiProjectDraftStore.getState().agentQuestionPlanToken).toBeNull()
  })

  test('自适应追问停在守卫态时停下说明原因，不当作「继续澄清」自动重发', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.startAnalyzing()
    store.applyAnalysis({
      ...response,
      cards: [],
      activeCard: null,
      branch: 'clarify',
      phase: 'agent',
      adaptiveSession: {
        status: 'needs_human_review',
        guardReason: '问题无法安全发布',
        conversation: null,
      } as unknown as AnalyzeProjectIntentResponse['adaptiveSession'],
    })
    const state = useAiProjectDraftStore.getState()
    expect(state.status).toBe('error')
    expect(state.error).toContain('问题无法安全发布')
  })

  test('刷新恢复必须校验 userId、organizationId 与 schemaVersion', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 1, organizationId: 8 })
    store.setRawInput('开发一个运营系统')

    store.initializeScope({ userId: 2, organizationId: 8 })
    expect(useAiProjectDraftStore.getState().rawInput).toBe('')

    useAiProjectDraftStore.setState({
      schemaVersion: '0.9' as typeof AI_INTENT_SCHEMA_VERSION,
      userId: 2,
      organizationId: 8,
      rawInput: '旧版本草稿',
    })
    useAiProjectDraftStore.getState().initializeScope({ userId: 2, organizationId: 8 })
    expect(useAiProjectDraftStore.getState().rawInput).toBe('')
    expect(useAiProjectDraftStore.getState().schemaVersion).toBe(AI_INTENT_SCHEMA_VERSION)
  })

  test('重新开始只清理草案区并保留当前作用域', () => {
    const store = useAiProjectDraftStore.getState()
    store.initializeScope({ userId: 3, organizationId: 9 })
    store.setRawInput('开发一个运营系统')
    store.applyAnalysis(response)

    store.restart()

    const state = useAiProjectDraftStore.getState()
    expect(state.userId).toBe(3)
    expect(state.organizationId).toBe(9)
    expect(state.rawInput).toBe('')
    expect(state.cards).toHaveLength(0)
  })
})
