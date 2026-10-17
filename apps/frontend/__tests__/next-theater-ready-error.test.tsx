/**
 * v3-ui-next-theater-intent-clarify tasks 3.5 —— W3 就绪态、错误态、Store 契约与坐标升级。
 *
 * 覆盖：要素 HUD 双通道渲染、就绪态上下文汇总与人工确认门控（RL-01 零自动请求）、
 * 错误卡片重试/二次确认重置与现场保留、跨组织切换清空草案、同作用域现场恢复
 * （restored: true），以及空间坐标 create 可用态升级。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  type ClarificationCard,
  type ClarificationField,
  type ConfirmedProjectContext,
  type Marked,
  type ParsedIntent,
} from '@aiproj/types'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { TheaterIntentFeedback } from '@/components/next/theater/TheaterIntentFeedback'
import { TheaterReadyView } from '@/components/next/theater/TheaterReadyView'
import { TheaterErrorCard, classifyAnalyzeError } from '@/components/next/theater/TheaterErrorCard'
import {
  filterSpaceCoordinates,
  PRESET_SPACE_COORDINATES,
  type SpaceCoordinate,
} from '@/lib/next/space-coordinates'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import { SpaceMapCard } from '@/components/next/navigation/SpaceMapCard'

const parsedIntent: ParsedIntent = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  projectType: 'software',
  projectName: '企业级敏捷项目协作系统',
  objectives: ['搭建跨部门敏捷协作平台，沉淀项目知识'],
  deliverables: ['任务看板', '工时统计', '项目报表'],
  timeline: { startDate: '2026-09-01', deadline: '2026-12-01', durationDays: 90 },
  constraints: [],
  entities: [],
  overallConfidence: 0.92,
}

function marked(
  value: string | number | string[],
  source: 'explicit' | 'inferred' | 'default',
  needsConfirmation = false,
): Marked<string | number | string[]> {
  return {
    value,
    marker: {
      confidence: 0.92,
      source,
      reason: '测试用标记原因',
      needsConfirmation,
    },
  }
}

const confirmedContext: ConfirmedProjectContext = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  rawInput: '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计',
  parsedIntent,
  resolvedFields: {
    projectGoal: marked('搭建跨部门敏捷协作平台', 'explicit'),
    teamSize: marked(6, 'explicit'),
    techStack: marked(['React', 'Node'], 'inferred', true),
  },
  assumptions: {
    startDate: marked('2026-09-01', 'default', true),
    methodology: marked('敏捷迭代', 'default'),
  },
  unresolvedCriticalFields: [],
  unansweredOptionalFields: [],
}

const card: ClarificationCard = {
  cardId: 'card-1',
  field: 'projectGoal' as ClarificationField,
  category: 'critical',
  title: '项目核心目标是什么？',
  description: '需要明确项目的核心目标',
  impactScope: [{ domain: 'scope', severity: 'high' }],
  questionType: 'single_choice',
  quickOptions: [],
  customInput: {
    enabled: true,
    label: '补充要求',
    placeholder: '请输入…',
    description: '自然语言补充',
  },
  defaultValue: null,
  confidence: 0.9,
  reasoning: '核心要素缺失',
  allowSkip: false,
  isRequired: true,
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
  })
}

beforeEach(() => {
  resetDraft()
})

describe('components/next/theater/TheaterIntentFeedback（要素 HUD，tasks 3.1）', () => {
  test('解析成功后结构化渲染项目类型徽章 / 核心目标 / 范围交付物 / 置信度（颜色+文字双通道）', () => {
    useAiProjectDraftStore.setState({ parsedIntent, status: 'clarifying' })
    const { container } = render(<TheaterIntentFeedback />)

    expect(screen.getByLabelText('意图解析要素反馈')).toBeInTheDocument()
    expect(screen.getByText('软件系统')).toBeInTheDocument()
    expect(screen.getByText('搭建跨部门敏捷协作平台，沉淀项目知识')).toBeInTheDocument()
    expect(screen.getByText('任务看板 · 工时统计 · 项目报表')).toBeInTheDocument()
    expect(screen.getByText('高置信度 92%')).toBeInTheDocument()

    // 双通道：类型徽章与置信度同时具备颜色令牌与文字
    const badge = container.querySelector('[data-project-type="software"]') as HTMLElement
    expect(badge).toBeInTheDocument()
    expect(badge.style.color).toBe('var(--nx-chart-3)')
    expect(container.querySelector('[data-theater-feedback-confidence] svg')).toBeTruthy()
    expect(container.querySelector('[data-theater-feedback-objective] svg')).toBeTruthy()
  })

  test('branch=ready（status 就绪）时呈现 100% 完备指示', () => {
    useAiProjectDraftStore.setState({ parsedIntent, status: 'ready' })
    render(<TheaterIntentFeedback />)

    expect(screen.getByText('要素完备 100%')).toBeInTheDocument()
    expect(screen.getByText('意图信息完备 · 可直接生成')).toBeInTheDocument()
  })

  test('低置信度以「低置信度 N%」文字 + 红色令牌呈现', () => {
    useAiProjectDraftStore.setState({
      parsedIntent: { ...parsedIntent, overallConfidence: 0.4 },
      status: 'clarifying',
    })
    const { container } = render(<TheaterIntentFeedback />)

    expect(screen.getByText('低置信度 40%')).toBeInTheDocument()
    const confidence = container.querySelector(
      '[data-theater-feedback-confidence] p[aria-label]',
    ) as HTMLElement
    expect(confidence.style.color).toBe('var(--nx-status-danger)')
  })

  test('尚未解析（parsedIntent 为空）时渲染为空，不占位', () => {
    const { container } = render(<TheaterIntentFeedback />)
    expect(container.firstChild).toBeNull()
  })
})

describe('components/next/theater/TheaterReadyView（就绪态，tasks 3.2）', () => {
  test('结构化汇总项目名称 / 范围交付物 / 周期假设 / 团队资源 / 免责清单', () => {
    useAiProjectDraftStore.setState({ status: 'ready', context: confirmedContext })
    render(<TheaterReadyView onStartGeneration={vi.fn()} onEditContext={vi.fn()} />)

    expect(screen.getByRole('region', { name: '澄清完成 · 生成就绪' })).toBeInTheDocument()
    expect(screen.getByText('企业级敏捷项目协作系统')).toBeInTheDocument()
    expect(screen.getByText('软件系统')).toBeInTheDocument()
    expect(screen.getByText('搭建跨部门敏捷协作平台，沉淀项目知识')).toBeInTheDocument()
    for (const deliverable of ['任务看板', '工时统计', '项目报表']) {
      expect(screen.getByText(deliverable)).toBeInTheDocument()
    }
    expect(
      screen.getByText(
        (content: string) =>
          content.includes('开工 2026-09-01') &&
          content.includes('截止 2026-12-01') &&
          content.includes('预计工期 90 天'),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/6 人/)).toBeInTheDocument()
    expect(screen.getByText('React、Node')).toBeInTheDocument()

    // 来源标记：explicit=用户确认；inferred=AI 推断（需确认）
    expect(screen.getByText('用户确认')).toBeInTheDocument()
    expect(screen.getByText('AI 推断 · 需确认')).toBeInTheDocument()
  })

  test('AI 默认假设免责清单逐项呈现并附带免责标记', () => {
    useAiProjectDraftStore.setState({ status: 'ready', context: confirmedContext })
    render(<TheaterReadyView onStartGeneration={vi.fn()} />)

    expect(screen.getByText('AI 默认假设免责清单')).toBeInTheDocument()
    expect(screen.getByText('开工日期')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()
    expect(screen.getByText('敏捷迭代')).toBeInTheDocument()
    expect(screen.getAllByText('AI 假设免责')).toHaveLength(2)
    expect(screen.getAllByText('待您确认')).toHaveLength(1)
  })

  test('RL-01 门控：就绪态渲染与按钮点击全程零网络请求，仅回调对接', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const onStartGeneration = vi.fn()
    const onEditContext = vi.fn()
    useAiProjectDraftStore.setState({ status: 'ready', context: confirmedContext })
    render(<TheaterReadyView onStartGeneration={onStartGeneration} onEditContext={onEditContext} />)

    // 等待状态明示，网络面板零请求
    expect(screen.getByText('等待人工确认')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
    fireEvent.click(screen.getByRole('button', { name: /重新调整回答/ }))
    expect(onStartGeneration).toHaveBeenCalledTimes(1)
    expect(onEditContext).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  test('重新调整回答入口缺省不渲染（onEditContext 未提供）', () => {
    useAiProjectDraftStore.setState({ status: 'ready', context: confirmedContext })
    render(<TheaterReadyView onStartGeneration={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /重新调整回答/ })).toBeNull()
  })

  test('无确认上下文（context 为空）时渲染为空', () => {
    const { container } = render(<TheaterReadyView onStartGeneration={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('components/next/theater/TheaterErrorCard（错误态，tasks 3.3）', () => {
  test('展示中文错误指引 + 原始输入与已答进度完整保留', () => {
    useAiProjectDraftStore.setState({
      status: 'error',
      error: '请求超时（20 秒无响应）',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计',
      answers: {
        projectGoal: { field: 'projectGoal', action: 'answer', value: '目标', marker: null },
      },
    })
    render(<TheaterErrorCard />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/模型响应达到等待上限/)).toBeInTheDocument()
    expect(screen.getByText('请求超时（20 秒无响应）')).toBeInTheDocument()
    expect(screen.getByText('原始输入已保留（30 字符）')).toBeInTheDocument()
    expect(screen.getByText('已保留 1 条已答澄清记录，重新分析后将沿用')).toBeInTheDocument()
  })

  test('「重新分析」调用 store.retry()：保留现场并回到 analyzing', () => {
    useAiProjectDraftStore.setState({
      status: 'error',
      error: 'Failed to fetch',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计',
      answers: {
        projectGoal: { field: 'projectGoal', action: 'answer', value: '目标', marker: null },
      },
    })
    render(<TheaterErrorCard />)

    fireEvent.click(screen.getByRole('button', { name: /重新分析/ }))
    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
    expect(useAiProjectDraftStore.getState().error).toBeNull()
    // 现场保留：输入与已答答案不被清空
    expect(useAiProjectDraftStore.getState().rawInput).toContain('敏捷项目协作系统')
    expect(useAiProjectDraftStore.getState().answers.projectGoal).toBeTruthy()
  })

  test('「重新开始」需二次确认：确认后清空草案回到 idle', () => {
    useAiProjectDraftStore.setState({
      organizationId: 101,
      userId: 1,
      status: 'error',
      error: '服务不可用',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计',
      answers: {
        projectGoal: { field: 'projectGoal', action: 'answer', value: '目标', marker: null },
      },
    })
    render(<TheaterErrorCard />)

    expect(screen.queryByRole('button', { name: /确认重新开始/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重新开始/ }))
    // 未确认前状态不变（防误触）
    expect(useAiProjectDraftStore.getState().status).toBe('error')

    fireEvent.click(screen.getByRole('button', { name: /确认重新开始/ }))
    const state = useAiProjectDraftStore.getState()
    expect(state.status).toBe('idle')
    expect(state.rawInput).toBe('')
    expect(state.answers).toEqual({})
    // 作用域保留：不因重置丢失组织绑定
    expect(state.organizationId).toBe(101)
  })

  test('二次确认中点「暂不重置」取消，错误态原样保留', () => {
    useAiProjectDraftStore.setState({
      status: 'error',
      error: '解析失败',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计',
    })
    render(<TheaterErrorCard />)

    fireEvent.click(screen.getByRole('button', { name: /重新开始/ }))
    fireEvent.click(screen.getByRole('button', { name: /暂不重置/ }))
    expect(screen.queryByRole('button', { name: /确认重新开始/ })).toBeNull()
    expect(useAiProjectDraftStore.getState().status).toBe('error')
    expect(useAiProjectDraftStore.getState().rawInput).toContain('敏捷项目协作系统')
  })

  test('错误为空（非错误态）时渲染为空', () => {
    const { container } = render(<TheaterErrorCard />)
    expect(container.firstChild).toBeNull()
  })

  test('classifyAnalyzeError 确定性中文分类：超时 / 网络 / 5xx / 通用', () => {
    expect(classifyAnalyzeError('请求超时（20 秒无响应）')).toContain('不一定是本机网络问题')
    expect(classifyAnalyzeError('Failed to fetch')).toContain('不应仅据此判定为本机网络问题')
    expect(classifyAnalyzeError('503 Service Unavailable')).toContain('服务暂时不可用')
    expect(classifyAnalyzeError('模型输出不合法')).toContain('意图解析未能完成')
  })
})

describe('stores/ai-project-draft-store 契约（跨组织清空与现场恢复，tasks 3.5）', () => {
  test('跨组织切换触发 isCrossScopeSwitch：立即清空输入、卡片与上下文', () => {
    useAiProjectDraftStore.setState({
      organizationId: 101,
      userId: 1,
      status: 'clarifying',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统',
      cards: [card],
      context: confirmedContext,
    })
    useAiProjectDraftStore.getState().initializeScope({ userId: 1, organizationId: 102 })

    const state = useAiProjectDraftStore.getState()
    expect(state.organizationId).toBe(102)
    expect(state.status).toBe('idle')
    expect(state.rawInput).toBe('')
    expect(state.cards).toEqual([])
    expect(state.context).toBeNull()
    expect(state.restored).toBe(false)
  })

  test('同作用域重新进入标记现场恢复 restored: true', () => {
    useAiProjectDraftStore.setState({
      organizationId: 101,
      userId: 1,
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统',
      cards: [card],
    })
    useAiProjectDraftStore.getState().initializeScope({ userId: 1, organizationId: 101 })

    expect(useAiProjectDraftStore.getState().restored).toBe(true)
    expect(useAiProjectDraftStore.getState().rawInput).toBe('搭建一个企业级跨部门敏捷项目协作系统')
  })

  test('restart() 清空草案但保留组织作用域绑定', () => {
    useAiProjectDraftStore.setState({
      organizationId: 101,
      userId: 1,
      status: 'error',
      rawInput: '搭建一个企业级跨部门敏捷项目协作系统',
    })
    useAiProjectDraftStore.getState().restart()

    const state = useAiProjectDraftStore.getState()
    expect(state.status).toBe('idle')
    expect(state.rawInput).toBe('')
    expect(state.organizationId).toBe(101)
    expect(state.userId).toBe(1)
  })
})

describe('lib/next/space-coordinates 坐标升级（tasks 3.4）', () => {
  test('create 坐标升级为 available 且徽标「已就绪」', () => {
    const create = PRESET_SPACE_COORDINATES.find(
      (coordinate) => coordinate.id === 'create',
    ) as SpaceCoordinate
    expect(create.status).toBe('available')
    expect(create.badge).toBe('已就绪')
    expect(create.title).toBe('生成剧场')
  })

  test('filterSpaceCoordinates 检索 create / 生成 / 剧场均命中且解除置灰', () => {
    for (const query of ['create', '生成', '剧场']) {
      const hit = filterSpaceCoordinates(query).find((coordinate) => coordinate.id === 'create')
      expect(hit).toBeDefined()
      expect(hit?.status).toBe('available')
    }
  })

  test('面包屑标题保持「生成剧场」一致', () => {
    expect(resolveSpaceBreadcrumb('/next/create')).toBe('/next/create · 生成剧场')
  })

  test('SpaceMapCard 渲染 create 为可用可点状态，点击触发回调', () => {
    const create = PRESET_SPACE_COORDINATES.find(
      (coordinate) => coordinate.id === 'create',
    ) as SpaceCoordinate
    const onSelect = vi.fn()
    render(<SpaceMapCard coordinate={create} onSelect={onSelect} />)

    const button = screen.getByRole('button', { name: /生成剧场/ })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('data-status', 'available')
    expect(button).not.toHaveAttribute('tabindex', '-1')
    expect(screen.getByText('已就绪')).toBeInTheDocument()

    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(create)
  })

  test('回归：charts 点亮为 available（v3-ui-next-chart-gallery 1.4）', () => {
    const charts = PRESET_SPACE_COORDINATES.find(
      (coordinate) => coordinate.id === 'charts',
    ) as SpaceCoordinate
    expect(charts.status).toBe('available')
    expect(charts.badge).toBe('已就绪')
    expect(charts.path).toBe('/next/charts')
  })
})
