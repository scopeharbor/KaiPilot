/**
 * AI 同事 · 「说了就去做」：繁体与口语也能触发操作、问答转交执行器、回答指明页面时自动打开、
 * 深色切换真正改到新版界面、一键生成项目、图表馆与退出登录在应用地图里。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GENERATION_MODE_AUTO,
  GENERATION_MODE_AUTO_NO_CONFIRM,
  useNextAiColleagueStore,
} from '@/stores/next-ai-colleague-store'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { looksLikeColleagueRequest, type ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { needsRoutingConversion, toSimplifiedForRouting } from '@/lib/next/ai-colleague-normalize'
import { buildColleagueAppMap } from '@/lib/next/ai-colleague-app-map'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  confirm: vi.fn(),
  plan: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { execute: mocks.execute, confirm: mocks.confirm, plan: mocks.plan },
  isScheduleStaleError: () => false,
}))

const copilotMocks = vi.hoisted(() => ({ submitTurnStream: vi.fn() }))
vi.mock('@/lib/api/copilot', () => ({
  copilotApi: { submitTurnStream: copilotMocks.submitTurnStream },
}))

vi.mock('@/lib/auth/sign-out', () => ({ signOutSession: mocks.signOut }))

const homeCtx: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
  isSuperAdmin: true,
}

function plan(actions: unknown[], extra: Record<string, unknown> = {}) {
  return {
    isAction: true,
    actions,
    reply: null,
    clarification: null,
    rejected: [],
    model: 'deepseek/deepseek-v4.1-flash',
    ...extra,
  }
}

/** 让问答模型「回答」一段原文（含交接标记）。 */
function answerWith(raw: string) {
  copilotMocks.submitTurnStream.mockImplementationOnce(async (_request, handlers) => {
    handlers.onEvent({ type: 'turn-meta', sequence: 1, sessionId: 'cps_1' })
    handlers.onEvent({ type: 'answer-delta', sequence: 2, delta: raw })
    handlers.onEvent({
      type: 'answer-done',
      sequence: 3,
      assistantMessageId: 'm1',
      contentSummary: raw,
      webSearchStatus: null,
    })
  })
}

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.confirm.mockReset()
  mocks.plan.mockReset()
  mocks.signOut.mockReset()
  copilotMocks.submitTurnStream.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-direct',
    openTabIds: ['conv-direct'],
    sessionId: null,
    modelPreference: null,
    webSearchEnabled: false,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
  })
})

describe('繁体与口语', () => {
  test('繁体先转简体再判断；简体不加载词典', async () => {
    expect(needsRoutingConversion('带我去风险管理')).toBe(false)
    expect(needsRoutingConversion('帶我去風險管理')).toBe(true)
    expect(await toSimplifiedForRouting('直接帶我過去配置ai模型')).toBe('直接带我过去配置ai模型')
    expect(await toSimplifiedForRouting('檢視當前專案摘要')).toBe('查看当前项目摘要')
  })

  test('「我要做某事」、一键生成、点名页面都算要做事；提问与乱码不算', () => {
    expect(looksLikeColleagueRequest('我要配置ai模型')).toBe(true)
    expect(looksLikeColleagueRequest('直接带我过去')).toBe(true)
    expect(looksLikeColleagueRequest('呃我想办一个校园演唱会')).toBe(true)
    expect(looksLikeColleagueRequest('建个新项目')).toBe(true)
    expect(looksLikeColleagueRequest('AI连接', ['AI 连接'])).toBe(true)
    expect(looksLikeColleagueRequest('我想问一下关键路径是什么')).toBe(false)
    expect(looksLikeColleagueRequest('什么是 WBS')).toBe(false)
    expect(looksLikeColleagueRequest('123')).toBe(false)
    expect(looksLikeColleagueRequest('xul3ru,3')).toBe(false)
  })

  test('「帶我去 AI 連接」转简体后命中快捷规则，直接跳转（不调模型、不只回链接）', async () => {
    mocks.execute.mockResolvedValueOnce({
      data: { path: '/next/settings/ai-connections' },
      meta: { toolName: 'navigate_to_space', status: 'SUCCESS', durationMs: 1 },
    })
    await useNextAiColleagueStore.getState().submitUserMessage('帶我去 AI 連接', homeCtx)
    expect(mocks.execute).toHaveBeenCalledWith('navigate_to_space', {
      lens: 'settings',
      target: 'ai-connections',
    })
    expect(copilotMocks.submitTurnStream).not.toHaveBeenCalled()
  })

  test('繁体的具体指代（「帶我去食堂訂餐那個項目」）交给操作理解，模型拿到的仍是原话', async () => {
    mocks.plan.mockResolvedValueOnce(
      plan([
        {
          toolName: 'open_app_page',
          parameters: { path: '/next/projects/6', title: '公司内部食堂订餐 H5' },
          summary: '打开项目 PROJ-6',
        },
      ]),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('帶我去食堂訂餐那個項目', homeCtx)
    expect(mocks.plan).toHaveBeenCalledTimes(1)
    expect(mocks.plan.mock.calls[0]![0].text).toBe('帶我去食堂訂餐那個項目')
    expect(copilotMocks.submitTurnStream).not.toHaveBeenCalled()
    const step = useNextAiColleagueStore
      .getState()
      .messages.find((message) => message.toolExecution?.toolName === 'open_app_page')
    expect(step?.toolExecution?.status).toBe('success')
  })

  test('操作理解带上最近几轮对话（「直接带我过去」有指代对象）', async () => {
    useNextAiColleagueStore.setState({
      messages: [
        { id: 'u1', sender: 'user', content: '我要配置ai模型', timestamp: 1 },
        { id: 'a1', sender: 'assistant', content: '入口在 AI 连接', timestamp: 2 },
      ],
    })
    mocks.plan.mockResolvedValueOnce(plan([]))
    copilotMocks.submitTurnStream.mockResolvedValueOnce(undefined)
    await useNextAiColleagueStore.getState().submitUserMessage('直接帶我過去', homeCtx)
    expect(mocks.plan.mock.calls[0]![0].conversation).toEqual([
      { role: 'user', text: '我要配置ai模型' },
      { role: 'assistant', text: '入口在 AI 连接' },
    ])
  })
})

describe('问答转交与自动打开', () => {
  test('问答模型判断是要做事 → 交给操作理解（占位消息去掉）', async () => {
    answerWith('[[AI同事:执行]]')
    mocks.plan.mockResolvedValueOnce(
      plan([
        {
          toolName: 'update_task_assignee',
          parameters: { projectId: 4, taskId: 226, assigneeId: null },
          summary: '取消 PROJ-4#226 的指派',
        },
      ]),
    )
    mocks.execute.mockReturnValue(new Promise(() => {}))
    // 纯提问形态（问答通道），模型却判断为操作
    void useNextAiColleagueStore.getState().submitUserMessage('那個負責人的部分可以取消嗎', homeCtx)
    await vi.waitFor(() => expect(mocks.plan).toHaveBeenCalledTimes(1))
    const messages = useNextAiColleagueStore.getState().messages
    expect(messages.some((message) => message.liveAnswer)).toBe(false)
  })

  test('执行器已判定不是操作：转来的问答不再推回（防来回推）', async () => {
    mocks.plan.mockResolvedValueOnce(plan([], { isAction: false }))
    answerWith('[[AI同事:执行]]')
    await useNextAiColleagueStore.getState().submitUserMessage('帮我弄一下那个', homeCtx)
    expect(mocks.plan).toHaveBeenCalledTimes(1)
    expect(copilotMocks.submitTurnStream.mock.calls[0]![0].colleagueHandoff).toBe(false)
    const live = useNextAiColleagueStore.getState().messages.find((message) => message.liveAnswer)
    expect(live?.content).toContain('说具体')
  })

  test('回答指明唯一页面：去掉标记并记下要自动打开的路径', async () => {
    mocks.plan.mockResolvedValueOnce(plan([], { isAction: false }))
    answerWith(
      'AON 网络图在「图表馆 · 进度网络」。\n[[AI同事:打开:/next/projects/7/charts/aon-network]]',
    )
    await useNextAiColleagueStore.getState().submitUserMessage('AON网路图在哪里', homeCtx)
    const live = useNextAiColleagueStore.getState().messages.find((message) => message.liveAnswer)
    expect(live?.content).toBe('AON 网络图在「图表馆 · 进度网络」。')
    expect(live?.liveAnswer?.autoOpenPath).toBe('/next/projects/7/charts/aon-network')
  })

  test('问答分类器路由到「创建项目」：交给操作理解去一键生成', async () => {
    copilotMocks.submitTurnStream.mockImplementationOnce(async (_request, handlers) => {
      handlers.onEvent({
        type: 'turn-route',
        sequence: 1,
        destinations: [{ destination: 'project_creation' }],
      })
    })
    mocks.plan.mockResolvedValueOnce(plan([]))
    await useNextAiColleagueStore.getState().submitUserMessage('校园演唱会项目的事情', homeCtx)
    expect(mocks.plan).toHaveBeenCalledTimes(1)
  })
})

describe('本地动作', () => {
  test('切换深色 / 浅色：新版界面的明暗（nxTheme）真正改变', async () => {
    useNextTrackStore.getState().setNxTheme('light')
    mocks.plan.mockResolvedValueOnce(
      plan([
        { toolName: 'set_ui_preference', parameters: { theme: 'dark' }, summary: '切换为「深色」' },
      ]),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('切换到深色模式', homeCtx)
    expect(useNextTrackStore.getState().nxTheme).toBe('dark')

    mocks.plan.mockResolvedValueOnce(
      plan([
        {
          toolName: 'set_ui_preference',
          parameters: { theme: 'light' },
          summary: '切换为「浅色」',
        },
      ]),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('換成淺色', homeCtx)
    expect(useNextTrackStore.getState().nxTheme).toBe('light')
  })

  test('一键生成项目：生成剧场填好需求并开始分析，跳转生成剧场', async () => {
    useAuthStore.setState({ permissions: ['ai:trigger', 'ai:confirm'], user: null } as never)
    useNextAiColleagueStore.setState({
      modelPreference: { connectionId: 3, modelId: 9, label: 'DeepSeek' },
    })
    mocks.plan.mockResolvedValueOnce(
      plan([
        {
          toolName: 'start_project_generation',
          parameters: { idea: '筹办一场校园演唱会，预计 2000 名观众' },
          summary: '一键生成项目',
        },
      ]),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('帮我办一个校园演唱会', homeCtx)
    // 先问全自动还是我来回答
    const asked = useNextAiColleagueStore.getState().messages.at(-1)?.question
    expect(asked?.kind).toBe('generation_mode')
    // 同时弹出选择窗口，模型默认与 AI 同事相同
    expect(useNextAiColleagueStore.getState().pendingGenerationChoice).toMatchObject({
      idea: '筹办一场校园演唱会，预计 2000 名观众',
      canConfirm: true,
      modelLabel: 'DeepSeek',
    })
    await useNextAiColleagueStore.getState().submitUserMessage(GENERATION_MODE_AUTO, homeCtx)
    expect(useNextAiColleagueStore.getState().pendingGenerationChoice).toBeNull()
    expect(useNextAiColleagueStore.getState().theaterLink).toEqual({ mode: 'auto' })
    expect(useAiProjectDraftStore.getState().autoPilot).toBe(true)
    const draft = useAiProjectDraftStore.getState()
    expect(draft.rawInput).toBe('筹办一场校园演唱会，预计 2000 名观众')
    expect(draft.status).toBe('analyzing')
    expect(draft.modelSelection).toEqual({ connectionId: 3, modelId: 9 })
    const step = useNextAiColleagueStore
      .getState()
      .messages.find((message) => message.toolExecution?.toolName === 'start_project_generation')
    expect(step?.toolExecution?.status).toBe('success')
    expect((step?.toolExecution?.data as { path: string }).path).toBe('/next/create')
  })

  test('一键生成项目：权限在一开始就说清（没有生成权限不发起；没有转正权限只能全自动到草案）', async () => {
    const generate = plan([
      {
        toolName: 'start_project_generation',
        parameters: { idea: '筹办一场校园演唱会，预计 2000 名观众' },
        summary: '一键生成项目',
      },
    ])
    useNextAiColleagueStore.setState({ theaterLink: null })
    useAuthStore.setState({ permissions: ['ai:trigger'], user: null } as never)
    mocks.plan.mockResolvedValueOnce(generate)
    await useNextAiColleagueStore.getState().submitUserMessage('帮我办一个校园演唱会', homeCtx)
    const asked = useNextAiColleagueStore.getState().messages.at(-1)?.question
    expect(asked?.kind).toBe('generation_mode')
    expect(asked?.prompt).toContain('没有转正权限')
    expect(asked?.options?.[0]).toBe(GENERATION_MODE_AUTO_NO_CONFIRM)

    useAuthStore.setState({ permissions: [], user: null } as never)
    useNextAiColleagueStore.setState({ messages: [] })
    mocks.plan.mockResolvedValueOnce(generate)
    await useNextAiColleagueStore.getState().submitUserMessage('帮我办一个校园演唱会', homeCtx)
    const last = useNextAiColleagueStore.getState().messages.at(-1)
    expect(last?.question).toBeUndefined()
    expect(last?.content).toContain('ai:trigger')
    expect(useNextAiColleagueStore.getState().theaterLink).toBeNull()
  })

  test('明确要求退出登录：执行退出', async () => {
    mocks.plan.mockResolvedValueOnce(
      plan([{ toolName: 'sign_out', parameters: {}, summary: '退出登录' }]),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('帮我退出登录', homeCtx)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('应用地图', () => {
  test('图表馆里的每张图表与退出登录都在目录里', () => {
    const map = buildColleagueAppMap(() => true)
    const aon = map.find((destination) => destination.id === 'chart:aon-network')
    expect(aon?.path).toBe('/next/projects/:id/charts/aon-network')
    expect(aon?.description).toContain('网络图')
    expect(map.find((destination) => destination.id === 'account:sign-out')?.path).toBe(
      '/next/settings/profile#sign-out',
    )
  })
})
