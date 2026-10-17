/**
 * AI 同事 · 追问卡片（选项 + 自己输入）、确认后各视图联动刷新、回答里画图。
 *
 * 覆盖：
 * - 模型追问带候选 → 追问卡片；在卡片或输入框里回答 → 原话 + 追问 + 回答一起交给模型；
 * - QuestionCard：点选项 / 数字键 / 自己输入，过期卡不可答；
 * - 写操作确认落库 → 通知 QueryProvider 失效任务缓存（看板 / 甘特 / 日历 / WBS / 时间线联动）；
 * - ```mermaid / ```svg / ```html 代码块渲染成图：SVG 清洗、HTML 沙箱禁脚本、流式中不渲染。
 */
import * as React from 'react'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { describeLiveFailure, useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import type { ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { QuestionCard } from '@/components/next/ai/cards/QuestionCard'
import { AiColleagueLiveAnswerBubble } from '@/components/next/ai/AiColleagueLiveAnswer'
import {
  AiDiagramBlock,
  buildSandboxedHtml,
  sanitizeSvg,
} from '@/components/next/ai/AiDiagramBlock'
import { setTaskDataChangeListener } from '@/lib/task-data-change-bus'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  confirm: vi.fn(),
  plan: vi.fn(),
  memberNames: vi.fn(),
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: {
    execute: mocks.execute,
    confirm: mocks.confirm,
    plan: mocks.plan,
    memberNames: mocks.memberNames,
  },
  isScheduleStaleError: () => false,
}))

vi.mock('@/lib/api/copilot', () => ({ copilotApi: { submitTurnStream: vi.fn() } }))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
    })),
  },
}))

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...utils,
    rerender: (next: React.ReactElement) =>
      utils.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

function plan(extra: Record<string, unknown>) {
  return {
    isAction: true,
    actions: [],
    reply: null,
    clarification: null,
    rejected: [],
    model: 'mock/model',
    ...extra,
  }
}

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.confirm.mockReset()
  mocks.plan.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-q',
    openTabIds: ['conv-q'],
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

afterEach(() => {
  setTaskDataChangeListener(null)
})

describe('追问卡片：模型给候选，回答连同原话交回模型', () => {
  test('追问带候选 → 卡片；在输入框里回答 → 原话 + 追问 + 回答一起重新理解', async () => {
    mocks.plan.mockResolvedValueOnce(
      plan({
        clarification: '有两个「登录」任务，指哪一个？',
        clarificationOptions: ['PROJ-42#3 登录页开发', 'PROJ-42#7 登录接口联调'],
      }),
    )
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('把登录任务勾掉', projectCtx)

    let messages = useNextAiColleagueStore.getState().messages
    const card = messages.find((message) => message.question)
    expect(card?.question).toMatchObject({
      prompt: '有两个「登录」任务，指哪一个？',
      options: ['PROJ-42#3 登录页开发', 'PROJ-42#7 登录接口联调'],
      originalText: '把登录任务勾掉',
      status: 'open',
    })

    mocks.plan.mockResolvedValueOnce(plan({ reply: '好的' }))
    await useNextAiColleagueStore.getState().submitUserMessage('PROJ-42#7 登录接口联调', projectCtx)

    expect(mocks.plan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: '把登录任务勾掉\n（补充说明：有两个「登录」任务，指哪一个？ —— PROJ-42#7 登录接口联调）',
      }),
    )
    messages = useNextAiColleagueStore.getState().messages
    expect(messages.find((message) => message.id === card!.id)?.question).toMatchObject({
      status: 'answered',
      answer: 'PROJ-42#7 登录接口联调',
    })
    // 回答以用户消息出现在对话里
    expect(
      messages.some((m) => m.sender === 'user' && m.content === 'PROJ-42#7 登录接口联调'),
    ).toBe(true)
  })

  test('追问之后又有新的助手消息：旧卡不再接管输入', async () => {
    mocks.plan.mockResolvedValueOnce(
      plan({ clarification: '延到哪天？', clarificationOptions: [] }),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('把登录页延期', projectCtx)
    useNextAiColleagueStore.setState((state) => ({
      messages: [
        ...state.messages,
        { id: 'later', sender: 'assistant', content: '别的回答', timestamp: Date.now() },
      ],
    }))
    mocks.plan.mockResolvedValueOnce(plan({ isAction: false }))
    await useNextAiColleagueStore.getState().submitUserMessage('把注册页勾掉', projectCtx)
    expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({ text: '把注册页勾掉' }))
  })
})

describe('QuestionCard', () => {
  test('点选项 / 数字键直接回答；最后一项展开自己输入，回车发送', () => {
    const onAnswer = vi.fn()
    render(
      <QuestionCard
        prompt="延到哪天？"
        options={['明天', '下周一']}
        status="open"
        active
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByText('明天'))
    expect(onAnswer).toHaveBeenLastCalledWith('明天')

    fireEvent.keyDown(screen.getByRole('listbox'), { key: '2' })
    expect(onAnswer).toHaveBeenLastCalledWith('下周一')

    fireEvent.click(screen.getByText('其他（自己输入）'))
    const input = screen.getByLabelText('自己输入回答')
    fireEvent.change(input, { target: { value: '10 月 20 日' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAnswer).toHaveBeenLastCalledWith('10 月 20 日')
  })

  test('没有候选时直接给输入框；过期 / 已回答的卡锁定', () => {
    const onAnswer = vi.fn()
    const { rerender, container } = render(
      <QuestionCard prompt="延到哪天？" options={[]} status="open" active onAnswer={onAnswer} />,
    )
    expect(screen.getByLabelText('自己输入回答')).toBeInTheDocument()

    rerender(
      <QuestionCard
        prompt="延到哪天？"
        options={['明天']}
        status="answered"
        answer="明天"
        active={false}
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByText('明天'))
    expect(onAnswer).not.toHaveBeenCalled()
    expect(container.querySelector('[data-question-option="1"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})

describe('写操作确认后通知各视图刷新', () => {
  test('确认落库 → 按项目通知失效任务缓存', async () => {
    const listener = vi.fn()
    setTaskDataChangeListener(listener)
    useNextAiColleagueStore.setState({
      executionState: 'awaiting_confirmation',
      messages: [
        {
          id: 'm1',
          sender: 'assistant',
          timestamp: Date.now(),
          toolExecution: {
            toolName: 'update_task_status',
            parameters: { projectId: 42, taskId: 7, status: 'completed' },
            status: 'preview',
            previewToken: 'a'.repeat(64),
          } as never,
        },
      ],
      pendingAction: {
        toolName: 'update_task_status',
        parameters: { projectId: 42, taskId: 7, status: 'completed' },
        previewToken: 'a'.repeat(64),
      } as never,
    })
    mocks.confirm.mockResolvedValue({
      data: { committed: true },
      meta: { toolName: 'update_task_status', status: 'SUCCESS', durationMs: 3 },
    })
    await useNextAiColleagueStore.getState().confirmPendingAction()
    expect(listener).toHaveBeenCalledWith(42)
  })
})

describe('回答里画图', () => {
  const live = { status: 'done' as const, modelLabel: 'm', webSearchRequested: false }

  test('sanitizeSvg 去掉脚本、事件属性与外部引用', () => {
    const clean = sanitizeSvg(
      '<svg viewBox="0 0 1 1" onload="alert(1)"><script>alert(2)</script><a href="https://evil.example"><rect width="1" height="1"/></a><use href="#local"/></svg>',
    )
    expect(clean).not.toMatch(/script|onload|evil\.example/)
    expect(clean).toContain('<rect')
  })

  test('```svg 以 <img> 数据 URI 呈现（页面样式与脚本都隔离）', () => {
    const { container } = render(
      <AiColleagueLiveAnswerBubble
        content={
          '依赖关系如下：\n\n```svg\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```'
        }
        live={live}
      />,
    )
    const figure = container.querySelector('[data-ai-diagram="svg"]')!
    const img = figure.querySelector('img')!
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(decodeURIComponent(img.getAttribute('src')!)).toContain('<circle')
    // 不是普通代码块
    expect(container.querySelector('pre code.language-svg')).toBeNull()
  })

  test('```mermaid 渲染成图，结果同样经过清洗', async () => {
    const { container } = render(
      <AiColleagueLiveAnswerBubble
        content={'```mermaid\nflowchart LR\n  A["需求"] --> B["上线"]\n```'}
        live={live}
      />,
    )
    await waitFor(() =>
      expect(container.querySelector('[data-ai-diagram="mermaid"] img')).not.toBeNull(),
    )
    const src = decodeURIComponent(
      container.querySelector('[data-ai-diagram="mermaid"] img')!.getAttribute('src')!,
    )
    expect(src).toContain('<rect')
    expect(src).not.toContain('<script')
  })

  test('```html 放进沙箱 iframe：不允许脚本，CSP 禁外部资源', () => {
    const { container } = render(
      <AiColleagueLiveAnswerBubble
        content={'```html\n<div style="color:red">阶段一</div><script>alert(1)</script>\n```'}
        live={live}
      />,
    )
    const frame = container.querySelector<HTMLIFrameElement>('[data-diagram-frame]')!
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'")
    expect(buildSandboxedHtml('<b>x</b>', true)).toContain("default-src 'none'")
  })

  test('回答还在流式输出时先显示「正在绘图…」，普通代码块照旧', () => {
    render(
      <AiColleagueLiveAnswerBubble
        content={'```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nconst a = 1\n```'}
        live={{ ...live, status: 'streaming' }}
      />,
    )
    expect(screen.getByText('正在绘图…')).toBeInTheDocument()
    expect(screen.getByText('const a = 1')).toBeInTheDocument()
  })

  test('图示提供全屏按钮：点击对图舞台请求原生 Fullscreen；源码态与流式态禁用', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    })
    const { container, unmount } = render(
      <AiDiagramBlock
        language="svg"
        code={'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'}
        streaming={false}
      />,
    )
    const stage = container.querySelector('[data-diagram-stage]')!
    const button = screen.getByRole('button', { name: '全屏' })
    fireEvent.click(button)
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(stage).not.toBeNull()

    // 打开源码后图舞台卸载，全屏按钮禁用
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(screen.getByRole('button', { name: '全屏' })).toBeDisabled()
    unmount()

    render(<AiDiagramBlock language="svg" code={'<svg/>'} streaming />)
    expect(screen.getByRole('button', { name: '全屏' })).toBeDisabled()
  })

  test('HTML 图示同样提供全屏按钮（沙箱 iframe 舞台）', () => {
    const { container } = render(
      <AiDiagramBlock language="html" code={'<div>阶段一</div>'} streaming={false} />,
    )
    expect(screen.getByRole('button', { name: '全屏' })).toBeEnabled()
    expect(container.querySelector('[data-diagram-stage] iframe')).not.toBeNull()
  })
})

describe('没有可用 AI 连接（个人版导出 4.6）', () => {
  test('describeLiveFailure 把 ai-connection-required 译成统一提示', () => {
    expect(describeLiveFailure('ai-connection-required', undefined)).toBe(
      '请先在设置中添加 AI 连接',
    )
  })

  test('回答失败且原因为无连接：气泡显示提示与设置入口', () => {
    const { container } = render(
      <AiColleagueLiveAnswerBubble
        content=""
        live={{
          status: 'error',
          modelLabel: null,
          webSearchRequested: false,
          errorMessage: '请先在设置中添加 AI 连接',
          errorKind: 'ai-connection-required',
        }}
      />,
    )
    expect(screen.getByText('请先在设置中添加 AI 连接')).toBeInTheDocument()
    expect(container.querySelector('[data-ai-connection-required-action]')).toHaveAttribute(
      'href',
      '/next/settings/ai-connections',
    )
  })

  test('其它失败不显示设置入口', () => {
    const { container } = render(
      <AiColleagueLiveAnswerBubble
        content=""
        live={{
          status: 'error',
          modelLabel: null,
          webSearchRequested: false,
          errorMessage: '模型没有返回内容，请换个问法再试。',
          errorKind: 'empty',
        }}
      />,
    )
    expect(container.querySelector('[data-ai-connection-required-action]')).toBeNull()
  })
})
