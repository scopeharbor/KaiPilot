/**
 * AI 同事 · 自然语言操作（一句话 → 模型理解的操作序列 → 逐条执行，写操作逐条确认）。
 *
 * 覆盖：
 * - 判定函数：修改类动词 / 复合句 / 提问 / 规则已命中写工具 / 不在项目空间；
 * - 串联：写操作停在预览 → 确认后自动继续下一步；放弃只跳过当前步；某步失败停止后续；
 * - 模型判定不是操作 → 改走模型问答；
 * - 诚实呈现：模型理解的步骤标「🤖 AI 意图理解」而非「快捷规则匹配」；
 * - 中文标点紧邻 ** 的粗体能正常渲染。
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import {
  isSimpleFixedCommand,
  looksLikeColleagueRequest,
  parseColleagueIntent,
  shouldPlanColleagueActions,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { AiColleagueLiveAnswerBubble } from '@/components/next/ai/AiColleagueLiveAnswer'
import { IntentSourceContext, RuleMatchBadge } from '@/components/next/ai/cards/RuleMatchBadge'
import { TaskStatusPreviewCard } from '@/components/next/ai/cards/TaskStatusPreviewCard'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  confirm: vi.fn(),
  plan: vi.fn(),
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { execute: mocks.execute, confirm: mocks.confirm, plan: mocks.plan },
  isScheduleStaleError: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { status?: number }).status === 409,
}))

const copilotMocks = vi.hoisted(() => ({ submitTurnStream: vi.fn() }))
vi.mock('@/lib/api/copilot', () => ({
  copilotApi: { submitTurnStream: copilotMocks.submitTurnStream },
}))

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}
const homeCtx: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
}

const TOKEN = 'a'.repeat(64)

const statusStep = {
  toolName: 'update_task_status' as const,
  parameters: { projectId: 42, taskId: 7, status: 'completed' },
  summary: '把 #7「登录页」改为「已完成」',
}
const moveStep = {
  toolName: 'update_task_status' as const,
  parameters: { projectId: 42, taskId: 8, status: 'in_progress' },
  summary: '把 #8「注册页」改为「进行中」',
}
const navStep = {
  toolName: 'navigate_to_space' as const,
  parameters: { lens: 'gantt', depth: 'workbench', projectId: 42 },
  summary: '打开甘特图',
}

function plan(actions: unknown[], extra: Record<string, unknown> = {}) {
  return {
    isAction: true,
    actions,
    reply: '好的',
    clarification: null,
    rejected: [],
    model: 'deepseek/deepseek-v4.1-flash',
    ...extra,
  }
}

function previewEnvelope(taskId: number) {
  const diff = {
    taskId,
    taskName: 'x',
    fromLabel: '未开始',
    toLabel: '已完成',
    pathLabels: ['进行中', '已完成'],
  }
  return {
    data: diff,
    meta: {
      toolName: 'update_task_status',
      status: 'PREVIEW_REQUIRED',
      durationMs: 5,
      previewToken: TOKEN,
      diff,
    },
  }
}

const navEnvelope = {
  data: { path: '/next/projects/42?lens=gantt', lens: 'gantt', projectId: 42 },
  meta: { toolName: 'navigate_to_space', status: 'SUCCESS', durationMs: 3 },
}

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.confirm.mockReset()
  mocks.plan.mockReset()
  copilotMocks.submitTurnStream.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-nl',
    openTabIds: ['conv-nl'],
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

describe('shouldPlanColleagueActions', () => {
  const judge = (text: string, ctx: ColleagueContext = projectCtx) =>
    shouldPlanColleagueActions(text, parseColleagueIntent(text, ctx), ctx)

  test('修改类说法交给模型理解', () => {
    expect(judge('把登录页那个任务勾掉')).toBe(true)
    expect(judge('任务 12 做完了，帮我标为完成')).toBe(true)
    expect(judge('把注册页移到进行中')).toBe(true)
    expect(judge('登录接口往后延三天')).toBe(true)
  })

  test('复合句里的跳转不被快捷规则单独吞掉', () => {
    expect(judge('把 12 号标记完成，然后打开甘特图')).toBe(true)
    expect(judge('先列出进行中的任务，再打开甘特图')).toBe(true)
  })

  test('单纯跳转走快捷规则、提问走问答', () => {
    expect(judge('去甘特图')).toBe(false)
    expect(judge('这个项目完成了多少？')).toBe(false)
    expect(judge('哪些任务已经完成')).toBe(false)
    const unmatched = {
      toolName: null,
      parameters: {},
      intentSource: 'rule_preset' as const,
      confidence: 0,
    }
    // 不在项目空间也交给模型（只能打开页面 / 搜索 / 切换界面，项目内操作由服务端拒绝并说明）
    expect(shouldPlanColleagueActions('把登录页那个任务勾掉', unmatched, homeCtx)).toBe(true)
  })

  test('规则已完整命中的排程指令不重复理解', () => {
    expect(judge('延期任务 12 至 2026-09-15')).toBe(false)
  })
})

describe('操作序列串联', () => {
  test('写操作停在预览；确认后自动继续下一步', async () => {
    mocks.plan.mockResolvedValue(plan([statusStep, navStep]))
    mocks.execute.mockImplementation(async (toolName: string) =>
      toolName === 'update_task_status' ? previewEnvelope(7) : navEnvelope,
    )
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('把登录页勾掉再打开甘特图', projectCtx)

    let state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('awaiting_confirmation')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith('update_task_status', statusStep.parameters)
    const note = state.messages[1]?.content ?? ''
    expect(note).toContain('1. 把 #7「登录页」改为「已完成」')
    expect(note).toContain('2. 打开甘特图')
    expect(note).toContain('确认应用')
    const card = state.messages[2]?.toolExecution
    expect(card?.intentSource).toBe('llm_inference')
    expect(card?.stepLabel).toBe('第 1/2 步 · 把 #7「登录页」改为「已完成」')
    expect(card?.modelLabel).toBe('组织默认模型')

    mocks.confirm.mockResolvedValue({
      data: { committed: true },
      meta: { toolName: 'update_task_status', committed: true, durationMs: 9 },
    })
    await useNextAiColleagueStore.getState().confirmPendingAction(TOKEN)

    state = useNextAiColleagueStore.getState()
    expect(mocks.confirm).toHaveBeenCalledWith({
      toolName: 'update_task_status',
      previewToken: TOKEN,
      parameters: statusStep.parameters,
    })
    expect(mocks.execute).toHaveBeenLastCalledWith('navigate_to_space', navStep.parameters)
    expect(state.messages[2]?.toolExecution?.status).toBe('committed')
    expect(state.messages[3]?.toolExecution?.status).toBe('success')
    expect(state.actionQueue).toBeNull()
    expect(state.executionState).toBe('idle')
  })

  test('放弃当前写操作只跳过这一步，后面的步骤照常逐条确认', async () => {
    mocks.plan.mockResolvedValue(plan([statusStep, moveStep]))
    mocks.execute.mockImplementation(async (_tool: string, params: { taskId: number }) =>
      previewEnvelope(params.taskId),
    )
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('把 7 勾掉，8 移到进行中', projectCtx)
    useNextAiColleagueStore.getState().cancelPendingAction()
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2))

    const state = useNextAiColleagueStore.getState()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(state.messages[2]?.toolExecution?.status).toBe('cancelled')
    await vi.waitFor(() =>
      expect(useNextAiColleagueStore.getState().executionState).toBe('awaiting_confirmation'),
    )
    expect(useNextAiColleagueStore.getState().pendingAction?.parameters).toEqual(
      moveStep.parameters,
    )
  })

  test('某一步失败时停止后续步骤', async () => {
    mocks.plan.mockResolvedValue(plan([navStep, statusStep]))
    mocks.execute.mockRejectedValue(
      Object.assign(new Error('没有权限'), { code: 'PERMISSION_DENIED', status: 403 }),
    )
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('打开甘特图，然后把 7 勾掉', projectCtx)

    const state = useNextAiColleagueStore.getState()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(state.actionQueue).toBeNull()
    expect(state.messages.at(-1)?.content).toContain('后面的 1 步已停止')
  })

  test('模型判定不是操作 → 改走模型问答', async () => {
    mocks.plan.mockResolvedValue({ ...plan([]), isAction: false })
    copilotMocks.submitTurnStream.mockResolvedValue(undefined)
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('标记一下我对这个项目的看法', projectCtx)
    expect(copilotMocks.submitTurnStream).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
    const messages = useNextAiColleagueStore.getState().messages
    expect(messages.some((m) => m.content === '正在理解你的指令…')).toBe(false)
  })

  test('理解失败：如实说明，零工具请求', async () => {
    mocks.plan.mockRejectedValue(
      Object.assign(new Error('模型不可用'), { code: 'AI_SERVICE_ERROR', status: 502 }),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('把登录页勾掉', projectCtx)
    const state = useNextAiColleagueStore.getState()
    expect(state.messages[1]?.content).toContain('没有做任何修改')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(state.executionState).toBe('idle')
  })

  test('显式选择模型时显示所选标签，不采用服务器内部身份', async () => {
    useNextAiColleagueStore.getState().setModelPreference({
      connectionId: 12,
      modelId: 34,
      label: '我的模型',
    })
    mocks.plan.mockResolvedValue(plan([navStep], { toolCallingMode: 'prompt_json' }))
    mocks.execute.mockResolvedValue(navEnvelope)
    await useNextAiColleagueStore.getState().submitUserMessage('打开甘特图，然后看看', projectCtx)
    expect(useNextAiColleagueStore.getState().messages.at(-1)?.toolExecution?.modelLabel).toBe(
      '我的模型 · 提示词 JSON（Prompt+JSON）',
    )
  })

  test('原生方式回退时如实提示，徽标带实际方式', async () => {
    mocks.plan.mockResolvedValue(
      plan([navStep], {
        toolCallingMode: 'prompt_json',
        requestedToolCallingMode: 'openai_responses_tools',
        fallbackReason: '原生工具调用失败（HTTP 404：deepseek/deepseek-v4.1-flash unavailable）',
      }),
    )
    mocks.execute.mockResolvedValue(navEnvelope)
    await useNextAiColleagueStore.getState().submitUserMessage('打开甘特图，然后看看', projectCtx)
    const state = useNextAiColleagueStore.getState()
    expect(state.messages[1]?.content).toContain(
      '「Responses API 原生工具（Responses Tools）」这次没能用上（原生工具调用失败（HTTP 404））',
    )
    expect(state.messages[1]?.content).not.toContain('deepseek')
    expect(state.messages[2]?.toolExecution?.modelLabel).toBe(
      '组织默认模型 · 提示词 JSON（Prompt+JSON）',
    )
  })

  test('被丢弃的建议与追问如实展示', async () => {
    mocks.plan.mockResolvedValue(
      plan([], {
        reply: null,
        rejected: ['任务 #999 不在本项目，已忽略改状态'],
        clarification: '有两个「登录」任务：#3、#7，指哪一个？',
      }),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('把登录任务勾掉', projectCtx)
    const messages = useNextAiColleagueStore.getState().messages
    expect(messages[1]?.content ?? '').toContain('任务 #999 不在本项目')
    // 追问以卡片呈现（选项 + 自己输入）
    expect(messages[2]?.question?.prompt).toContain('#3、#7')
    expect(messages[2]?.question?.status).toBe('open')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

describe('诚实呈现与渲染', () => {
  test('模型理解的步骤标「AI 意图理解」，规则命中仍标「快捷规则匹配」', () => {
    const { rerender } = render(<RuleMatchBadge toolName="update_task_status" />)
    expect(screen.getByText(/快捷规则匹配/)).toBeTruthy()
    rerender(
      <IntentSourceContext.Provider value={{ source: 'llm_inference', modelLabel: 'deepseek/x' }}>
        <RuleMatchBadge toolName="update_task_status" />
      </IntentSourceContext.Provider>,
    )
    expect(screen.getByText(/AI 意图理解 · deepseek\/x/)).toBeTruthy()
    expect(screen.queryByText(/快捷规则匹配/)).toBeNull()
  })

  test('状态预览卡列出中间状态', () => {
    render(
      <TaskStatusPreviewCard
        toolName="update_task_status"
        phase="preview"
        diff={{
          taskId: 7,
          taskName: '登录页',
          fromLabel: '未开始',
          toLabel: '已完成',
          pathLabels: ['进行中', '已完成'],
        }}
      />,
    )
    expect(screen.getByText('#7 · 登录页')).toBeTruthy()
    expect(screen.getByText('按状态流转规则会先经过：进行中')).toBeTruthy()
    expect(screen.getByText('确认应用')).toBeTruthy()
  })

  test('中文全角冒号紧邻 ** 时粗体正常渲染（不露出星号）', () => {
    const client = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={client}>
        <AiColleagueLiveAnswerBubble
          content={'- **所属项目 ID：**1\n- **筛选条件：**无（未设定任何筛选）'}
          live={{ status: 'done', modelLabel: null, webSearchRequested: false, projectId: null }}
        />
      </QueryClientProvider>,
    )
    const strong = Array.from(container.querySelectorAll('strong')).map((node) => node.textContent)
    expect(strong).toEqual(['所属项目 ID：', '筛选条件：'])
    expect(container.textContent).not.toContain('**')
  })
})

describe('路由：简单固定指令以外一律调用模型', () => {
  const simple = (text: string, ctx: ColleagueContext = projectCtx) =>
    isSimpleFixedCommand(text, parseColleagueIntent(text, ctx))

  test('简单固定指令走本地快捷规则', () => {
    expect(simple('打开甘特图')).toBe(true)
    expect(simple('去甘特图')).toBe(true)
    expect(simple('查看当前项目摘要')).toBe(true)
    expect(simple('请帮我打开看板。')).toBe(true)
    expect(simple('延期任务 12 至 2026-09-15')).toBe(true)
  })

  test('提问、多步、指代具体对象、修改、长句都不是简单固定指令', () => {
    expect(simple('项目进度怎么样？')).toBe(false)
    expect(simple('打开甘特图，然后看看风险')).toBe(false)
    expect(simple('打开登录那个任务')).toBe(false)
    expect(simple('把任务 7 标成完成')).toBe(false)
    expect(simple('帮我看一下这个项目最近一周的整体进展和主要风险点')).toBe(false)
    expect(simple('今天天气不错')).toBe(false)
  })

  test('像要做事 → 模型理解操作；纯提问 / 闲聊 → 模型问答', () => {
    expect(looksLikeColleagueRequest('把登录页延到下周')).toBe(true)
    expect(looksLikeColleagueRequest('能把登录页标成完成吗')).toBe(true)
    expect(looksLikeColleagueRequest('我今天还有什么没做完')).toBe(true)
    expect(looksLikeColleagueRequest('项目进度怎么样？')).toBe(false)
    expect(looksLikeColleagueRequest('讲一个项目经理的笑话')).toBe(false)
  })

  test('规则能命中但不是简单固定指令的提问：先交给操作理解，判定不是操作再转问答，不执行快捷规则', async () => {
    mocks.plan.mockResolvedValueOnce({
      isAction: false,
      actions: [],
      reply: null,
      clarification: null,
      rejected: [],
      model: null,
    })
    copilotMocks.submitTurnStream.mockResolvedValue(undefined)
    await useNextAiColleagueStore.getState().submitUserMessage('项目进度怎么样？', projectCtx)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.plan).toHaveBeenCalledTimes(1)
    expect(copilotMocks.submitTurnStream).toHaveBeenCalled()
  })

  test('纯知识提问直接问答（不经操作理解）', async () => {
    copilotMocks.submitTurnStream.mockResolvedValue(undefined)
    await useNextAiColleagueStore.getState().submitUserMessage('什么是关键路径', projectCtx)
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(copilotMocks.submitTurnStream).toHaveBeenCalled()
  })

  test('简单固定指令不调模型，直接执行快捷规则', async () => {
    mocks.execute.mockResolvedValue(navEnvelope)
    await useNextAiColleagueStore.getState().submitUserMessage('打开甘特图', projectCtx)
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(copilotMocks.submitTurnStream).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalled()
  })
})
