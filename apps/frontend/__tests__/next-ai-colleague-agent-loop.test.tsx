/**
 * AI 同事 · 多步任务（读 → 想 → 做）、看当前页面、删除任务、生成剧场联动、Tab 预填建议。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isWriteToolName, useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { capturePageText } from '@/lib/next/ai-colleague-page-snapshot'
import { ruleBasedAutoAnswer, theaterAnswerFromText } from '@/lib/next/ai-colleague-theater-bridge'
import { autoAnswerTheaterCard } from '@/hooks/use-theater-colleague-bridge'
import { AiColleagueInput, matchSuggestion } from '@/components/next/ai/AiColleagueInput'
import type { ColleagueContext } from '@/lib/next/ai-colleague-intent'
import type { ClarificationCard } from '@aiproj/types'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  confirm: vi.fn(),
  plan: vi.fn(),
  pageVision: vi.fn(),
  suggestReplies: vi.fn(),
  chooseTheaterAnswer: vi.fn(),
  toJpeg: vi.fn(),
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: {
    execute: mocks.execute,
    confirm: mocks.confirm,
    plan: mocks.plan,
    pageVision: mocks.pageVision,
    suggestReplies: mocks.suggestReplies,
    chooseTheaterAnswer: mocks.chooseTheaterAnswer,
  },
  isScheduleStaleError: () => false,
}))

const copilotMocks = vi.hoisted(() => ({ submitTurnStream: vi.fn() }))
vi.mock('@/lib/api/copilot', () => ({
  copilotApi: { submitTurnStream: copilotMocks.submitTurnStream },
}))

vi.mock('html-to-image', () => ({ toJpeg: mocks.toJpeg }))

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 7,
  pathname: '/next/projects/7',
  isSuperAdmin: true,
}

function plan(actions: unknown[], extra: Record<string, unknown> = {}) {
  return {
    isAction: actions.length > 0,
    actions,
    continue: false,
    answer: null,
    reply: null,
    clarification: null,
    rejected: [],
    model: 'deepseek/deepseek-v4.1-flash',
    ...extra,
  }
}

const listStep = {
  toolName: 'list_project_tasks',
  parameters: { projectId: 7, status: 'blocked' },
  summary: '列出「受阻」的任务',
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  copilotMocks.submitTurnStream.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-agent',
    openTabIds: ['conv-agent'],
    sessionId: null,
    modelPreference: null,
    webSearchEnabled: false,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
    pageVision: null,
    suggestions: [],
    theaterLink: null,
  })
})

describe('多步任务', () => {
  test('先看数据（continue）→ 带着观察结果再想 → 给出结论', async () => {
    mocks.plan
      .mockResolvedValueOnce(plan([listStep], { continue: true, reply: '我先看看受阻的任务' }))
      .mockResolvedValueOnce(
        plan([], {
          isAction: false,
          answer: '有 1 个受阻任务：**PROJ-7#3 接口联调**，建议先解决依赖。',
        }),
      )
    mocks.execute.mockResolvedValueOnce({
      data: { items: [{ id: 3, code: 'PROJ-7#3', name: '接口联调', status: 'blocked' }], total: 1 },
      meta: { toolName: 'list_project_tasks', status: 'SUCCESS', durationMs: 3 },
    })
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('分析一下受阻的任务怎么处理', projectCtx)

    expect(mocks.plan).toHaveBeenCalledTimes(2)
    const second = mocks.plan.mock.calls[1]![0]
    expect(second.iteration).toBe(2)
    expect(second.observations).toHaveLength(1)
    expect(second.observations[0]).toMatchObject({ tool: 'list_project_tasks', status: 'success' })
    expect(second.observations[0].result).toContain('接口联调')
    const last = useNextAiColleagueStore.getState().messages.at(-1)
    expect(last?.liveAnswer?.status).toBe('done')
    expect(last?.content).toContain('PROJ-7#3')
    // 多步任务的结论不再走问答通道
    expect(copilotMocks.submitTurnStream).not.toHaveBeenCalled()
  })

  test('某一步失败也交回模型（让它换个办法），不直接中断', async () => {
    mocks.plan
      .mockResolvedValueOnce(plan([listStep], { continue: true }))
      .mockResolvedValueOnce(plan([], { isAction: false, answer: '没取到任务清单，请稍后再试。' }))
    mocks.execute.mockRejectedValueOnce({ code: 'NETWORK_ERROR', message: '网络异常' })
    await useNextAiColleagueStore.getState().submitUserMessage('看看受阻任务', projectCtx)
    const second = mocks.plan.mock.calls[1]![0]
    expect(second.observations[0].status).toBe('error')
    expect(second.observations[0].result).toContain('网络异常')
  })

  test('每次理解都带上当前页面的可见文字', async () => {
    document.body.innerHTML = '<main><h1>项目看板</h1><button>新建任务</button></main>'
    mocks.plan.mockResolvedValueOnce(plan([], { isAction: false }))
    copilotMocks.submitTurnStream.mockResolvedValueOnce(undefined)
    await useNextAiColleagueStore.getState().submitUserMessage('这里能做什么', projectCtx)
    const page = mocks.plan.mock.calls[0]![0].page
    expect(page.visibleText).toContain('# 项目看板')
    expect(page.visibleText).toContain('[按钮] 新建任务')
  })
})

describe('看当前页面', () => {
  test('📷：截图交给看图模型，描述留给下一句话', async () => {
    mocks.toJpeg.mockResolvedValueOnce('data:image/jpeg;base64,AAAA')
    mocks.pageVision.mockResolvedValueOnce({
      description: '这是项目看板，有 4 列',
      model: 'qwen-vl',
    })
    await useNextAiColleagueStore.getState().attachPageVision()
    expect(mocks.pageVision).toHaveBeenCalledWith(
      expect.objectContaining({ imageDataUrl: 'data:image/jpeg;base64,AAAA' }),
    )
    expect(useNextAiColleagueStore.getState().pageVision?.description).toBe('这是项目看板，有 4 列')

    mocks.plan.mockResolvedValueOnce(plan([], { isAction: false }))
    copilotMocks.submitTurnStream.mockResolvedValueOnce(undefined)
    await useNextAiColleagueStore.getState().submitUserMessage('这页有几列', projectCtx)
    expect(mocks.plan.mock.calls[0]![0].page.visualDescription).toBe('这是项目看板，有 4 列')
  })

  test('AI 主动「看一眼页面」：结果作为观察交回下一轮', async () => {
    mocks.toJpeg.mockResolvedValueOnce('data:image/jpeg;base64,BBBB')
    mocks.pageVision.mockResolvedValueOnce({
      description: '甘特图，3 个任务逾期',
      model: 'gpt-vision',
    })
    mocks.plan
      .mockResolvedValueOnce(
        plan([{ toolName: 'capture_page', parameters: {}, summary: '看一眼当前页面' }], {
          continue: true,
        }),
      )
      .mockResolvedValueOnce(plan([], { isAction: false, answer: '页面上有 3 个逾期任务。' }))
    await useNextAiColleagueStore.getState().submitUserMessage('这个页面哪里有问题', projectCtx)
    const second = mocks.plan.mock.calls[1]![0]
    expect(second.observations[0]).toMatchObject({
      tool: 'capture_page',
      result: '甘特图，3 个任务逾期',
    })
  })

  test('可见文字不包含 AI 同事面板本身', () => {
    document.body.innerHTML =
      '<main><h2>风险登记表</h2></main><div data-ai-colleague-panel><h2>AI 同事</h2></div>'
    const text = capturePageText()
    expect(text).toContain('风险登记表')
    expect(text).not.toContain('AI 同事')
  })
})

describe('删除任务', () => {
  test('「刪除#551」交给操作理解，删除是写操作（先预览再确认）', async () => {
    mocks.plan.mockResolvedValueOnce(
      plan([
        {
          toolName: 'delete_task',
          parameters: { projectId: 7, taskId: 551 },
          summary: '删除 PROJ-7#551「123」（移入回收站）',
        },
      ]),
    )
    mocks.execute.mockResolvedValueOnce({
      data: { taskId: 551, taskCode: 'PROJ-7#551', taskName: '123', statusLabel: '未开始' },
      meta: {
        toolName: 'delete_task',
        status: 'PREVIEW_REQUIRED',
        durationMs: 2,
        previewToken: 'a'.repeat(64),
        diff: { taskId: 551, taskCode: 'PROJ-7#551', taskName: '123', statusLabel: '未开始' },
      },
    })
    await useNextAiColleagueStore.getState().submitUserMessage('刪除#551', projectCtx)
    expect(isWriteToolName('delete_task')).toBe(true)
    expect(mocks.plan).toHaveBeenCalledTimes(1)
    expect(useNextAiColleagueStore.getState().pendingAction?.toolName).toBe('delete_task')
    expect(useNextAiColleagueStore.getState().executionState).toBe('awaiting_confirmation')
  })
})

const card = (patch: Partial<ClarificationCard> = {}): ClarificationCard =>
  ({
    cardId: 'card-team',
    field: 'teamSize',
    category: 'resource',
    title: '团队有几个人？',
    description: '',
    impactScope: [],
    questionType: 'single_choice',
    quickOptions: [
      { label: '3 人', value: 3, description: '' },
      { label: '5 人', value: 5, description: '', recommended: true },
    ],
    customInput: { enabled: true, label: '', placeholder: '', description: '' },
    defaultValue: null,
    confidence: 0.6,
    reasoning: '',
    allowSkip: false,
    isRequired: true,
    ...patch,
  }) as ClarificationCard

describe('生成剧场联动', () => {
  test('对话里的回答换成剧场的答案：选项 / 自填 / 多选', () => {
    expect(theaterAnswerFromText(card(), '5 人（推荐）').value).toBe(5)
    expect(theaterAnswerFromText(card(), '大概八个人').value).toBe('大概八个人')
    const multi = card({
      questionType: 'multi_choice',
      quickOptions: [
        { label: '小程序', value: 'mini', description: '' },
        { label: '后台', value: 'admin', description: '' },
      ],
    })
    expect(theaterAnswerFromText(multi, '小程序、后台').value).toEqual(['mini', 'admin'])
  })

  test('全自动代答：模型审阅全部选项后作答，可以不选推荐项；把选项、推荐与之前的回答都交给模型', async () => {
    useAiProjectDraftStore.setState({ rawInput: '我一个人做一个记账小程序' })
    mocks.chooseTheaterAnswer.mockResolvedValueOnce({
      action: 'answer',
      value: 3,
      reason: '原话说一个人做，选最小规模',
      model: 'deepseek/deepseek-v4.1-flash',
    })
    const outcome = await autoAnswerTheaterCard(card(), [{ question: '目标用户', answer: '个人' }])
    expect(outcome.answer.value).toBe(3)
    expect(outcome.answer.action).toBe('answer')
    expect(outcome.note).toContain('原话说一个人做')
    const request = mocks.chooseTheaterAnswer.mock.calls[0]![0]
    expect(request.projectInput).toBe('我一个人做一个记账小程序')
    expect(request.previousAnswers).toEqual([{ question: '目标用户', answer: '个人' }])
    expect(request.question.options).toEqual([
      { label: '3 人', value: 3, description: null },
      { label: '5 人', value: 5, description: null, recommended: true },
    ])
    expect(mocks.suggestReplies).not.toHaveBeenCalled()
  })

  test('全自动代答：模型不可用时才按推荐 / 默认兜底', async () => {
    mocks.chooseTheaterAnswer.mockResolvedValueOnce(null)
    const outcome = await autoAnswerTheaterCard(card(), [])
    expect(outcome.answer.value).toBe(5)
    expect(outcome.note).toContain('按推荐')
    mocks.chooseTheaterAnswer.mockRejectedValueOnce(new Error('timeout'))
    mocks.suggestReplies.mockResolvedValueOnce([])
    const bare = await autoAnswerTheaterCard(card({ quickOptions: [], questionType: 'text' }), [])
    expect(bare.answer.value).toContain('按行业常见做法')
  })

  test('全自动代答：推荐选项优先；纯自填题交给模型', () => {
    expect(ruleBasedAutoAnswer(card())?.value).toBe(5)
    expect(ruleBasedAutoAnswer(card({ quickOptions: [], questionType: 'text' }))).toBeNull()
  })

  test('手动模式：剧场的问题转到对话里，回答写回剧场', () => {
    useAiProjectDraftStore.setState({
      status: 'clarifying',
      cards: [card()],
      activeCard: card(),
      answers: {},
    })
    useNextAiColleagueStore.getState().relayTheaterCard(card())
    const question = useNextAiColleagueStore.getState().messages.at(-1)?.question
    expect(question?.kind).toBe('theater_card')
    expect(question?.options).toEqual(['3 人', '5 人（推荐）'])
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)

    void useNextAiColleagueStore.getState().submitUserMessage('3 人', projectCtx)
    expect(useAiProjectDraftStore.getState().answers.teamSize?.value).toBe(3)
    // 一轮问题答完：回到分析
    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
  })
})

describe('Tab 预填建议', () => {
  test('空输入取第一条；已输入时取以它开头的', () => {
    expect(matchSuggestion('', ['好的，确认', '先不改'])).toBe('好的，确认')
    expect(matchSuggestion('先', ['好的，确认', '先不改'])).toBe('先不改')
    expect(matchSuggestion('换个', ['好的，确认'])).toBeNull()
  })

  test('按 Tab 采用建议；没有建议时 Tab 不被拦截', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <AiColleagueInput onSubmit={onSubmit} suggestions={['把它延到下周一']} />,
    )
    const box = screen.getByLabelText('向 AI 同事发送指令') as HTMLTextAreaElement
    expect(box.placeholder).toContain('把它延到下周一')
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box.value).toBe('把它延到下周一')
    rerender(<AiColleagueInput onSubmit={onSubmit} suggestions={[]} />)
    fireEvent.change(box, { target: { value: 'abc' } })
    const event = fireEvent.keyDown(box, { key: 'Tab' })
    expect(event).toBe(true)
  })

  test('store 请求建议时带上正在回答的问题与候选', async () => {
    mocks.suggestReplies.mockResolvedValueOnce(['全自动生成'])
    useNextAiColleagueStore.setState({
      messages: [
        { id: 'u', sender: 'user', content: '帮我办演唱会', timestamp: 1 },
        {
          id: 'q',
          sender: 'assistant',
          timestamp: 2,
          question: {
            kind: 'generation_mode',
            prompt: '要全自动生成吗？',
            options: ['全自动生成', '我来回答'],
            originalText: '帮我办演唱会',
            status: 'open',
          },
        },
      ],
    })
    await useNextAiColleagueStore.getState().refreshSuggestions()
    expect(mocks.suggestReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '要全自动生成吗？',
        options: ['全自动生成', '我来回答'],
      }),
    )
    expect(useNextAiColleagueStore.getState().suggestions).toEqual(['全自动生成'])
  })
})

// React 在测试里被 JSX 使用
void React
