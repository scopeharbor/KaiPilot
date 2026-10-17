import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { useCopilotStore } from '@/stores/copilot-store'
import { clampCopilotPanelWidth } from '@/stores/copilot-store'
import { CopilotSidebarPanel } from '@/components/copilot/CopilotSidebarPanel'
import { CopilotMessageList } from '@/components/copilot/CopilotMessageList'
import {
  buildCopilotDemoWelcomeMessage,
  buildCopilotDemoAssumptions,
  boundedCopilotSummary,
} from '@/components/copilot/copilot-fixtures'
import { setCopilotTriggerElement } from '@/lib/copilot/trigger-focus'
import type { CopilotMessage } from '@aiproj/types'

let mockPathname = '/projects/1'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '1' }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

const canAnyMock = vi.fn(() => true)
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ canAny: canAnyMock, can: () => true, canAll: () => true }),
}))

function resetStores() {
  act(() => {
    useCopilotStore.setState({
      open: false,
      form: 'drawer',
      width: 400,
      draft: '',
      streaming: false,
      streamPhase: 'idle',
      messages: [],
      demoActions: [],
      demoAssumptions: [],
      streamError: null,
      mode: 'demonstration',
      liveSessionId: null,
      turn: null,
      degradeReason: null,
    })
  })
  localStorage.clear()
  sessionStorage.clear()
  canAnyMock.mockReturnValue(true)
  mockPathname = '/projects/1'
}

beforeEach(() => {
  resetStores()
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
})

afterEach(() => {
  resetStores()
})

function renderPanel() {
  return render(<CopilotSidebarPanel />)
}

function openPanel() {
  act(() => {
    useCopilotStore.setState({ open: true, form: 'drawer' })
  })
}

function makeUserMessage(text: string): CopilotMessage {
  return {
    messageId: 'cpm-test-user',
    sessionId: 'cps-test',
    role: 'user',
    messageSummary: boundedCopilotSummary(text),
    sourceRefs: [],
    createdAt: '2026-08-17T01:00:00.000Z',
  }
}

function makeAssistantMessage(): CopilotMessage {
  return buildCopilotDemoWelcomeMessage('2026-08-17T01:00:00.000Z')
}

describe('面板宽度与钳制（任务 3.2/3.3/3.5）', () => {
  test('clampCopilotPanelWidth 下界/上界/越界/非法值', () => {
    expect(clampCopilotPanelWidth(359)).toBe(360)
    expect(clampCopilotPanelWidth(561)).toBe(560)
    expect(clampCopilotPanelWidth(400)).toBe(400)
    expect(clampCopilotPanelWidth(0)).toBe(360)
    expect(clampCopilotPanelWidth(10000)).toBe(560)
    expect(clampCopilotPanelWidth(Number.NaN)).toBe(400)
    expect(clampCopilotPanelWidth(Number.POSITIVE_INFINITY)).toBe(400)
  })

  test('store.setWidth 钳制并持久化宽度偏好', () => {
    act(() => {
      useCopilotStore.getState().setWidth(800)
    })
    expect(useCopilotStore.getState().width).toBe(560)
    // 水合后恢复（persist partialize 只存 width）
    const saved = JSON.parse(localStorage.getItem('aiproj-copilot') ?? '{}')
    expect(saved.state.width).toBe(560)
  })

  test('面板渲染宽度走 store 值（CSS 变量）', () => {
    act(() => {
      useCopilotStore.getState().setWidth(440)
    })
    openPanel()
    renderPanel()
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    expect(panel).toBeTruthy()
    expect(panel.style.getPropertyValue('--copilot-panel-width')).toBe('440px')
  })
})

describe('面板开合与快捷键边界（任务 2.4/2.9）', () => {
  test('Cmd/Ctrl+Enter 在面板输入聚焦时提交（不触发时无副作用）', () => {
    openPanel()
    renderPanel()
    const input = screen.getByLabelText('AI Copilot 输入框')
    fireEvent.change(input, { target: { value: '帮我梳理关键路径' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    const state = useCopilotStore.getState()
    expect(state.messages.length).toBe(1)
    expect(state.messages[0]!.role).toBe('user')
    expect(state.messages[0]!.messageSummary).toContain('关键路径')
    expect(state.streaming).toBe(true)
    expect(state.streamPhase).toBe('understanding')
    expect(state.draft).toBe('')
  })

  test('Cmd/Ctrl+Enter 在无关输入中不误触发（任务 2.9）', () => {
    openPanel()
    renderPanel()
    // 页面里的另一个普通输入（不在面板内）
    const unrelated = document.createElement('textarea')
    document.body.appendChild(unrelated)
    fireEvent.keyDown(unrelated, { key: 'Enter', ctrlKey: true })
    expect(useCopilotStore.getState().messages.length).toBe(0)
    expect(useCopilotStore.getState().streaming).toBe(false)
    unrelated.remove()
  })

  test('Esc 关闭面板且焦点回归触发按钮（任务 6.2/6.3）', () => {
    const fakeTrigger = document.createElement('button')
    const focusSpy = vi.spyOn(fakeTrigger, 'focus')
    setCopilotTriggerElement(fakeTrigger)
    openPanel()
    renderPanel()
    expect(useCopilotStore.getState().open).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useCopilotStore.getState().open).toBe(false)
    expect(focusSpy).toHaveBeenCalled()
  })
})

describe('三态形态（任务 3.6/3.7/3.8/3.9）', () => {
  test('最小化保留草稿与进行中的生成，恢复后继续（任务 3.9）', () => {
    act(() => {
      useCopilotStore.setState({
        open: true,
        draft: '进行中的草稿',
        streaming: true,
        streamPhase: 'generating',
      })
    })
    renderPanel()
    fireEvent.click(screen.getByLabelText('最小化面板'))
    expect(useCopilotStore.getState().form).toBe('minimized')
    // 面板 DOM 保持挂载（hidden），流式与草稿不丢
    expect(document.querySelector('[data-copilot-panel]')).toBeTruthy()
    expect(useCopilotStore.getState().draft).toBe('进行中的草稿')
    expect(useCopilotStore.getState().streaming).toBe(true)
    // 悬浮恢复入口可见
    expect(screen.getByLabelText('恢复 AI Copilot 面板')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('恢复 AI Copilot 面板'))
    expect(useCopilotStore.getState().form).toBe('drawer')
    expect(screen.getByLabelText('AI Copilot 输入框')).toHaveValue('进行中的草稿')
  })

  test('全屏专注切换保留输入草稿（任务 3.8）', () => {
    act(() => {
      useCopilotStore.setState({ open: true, draft: '草稿内容' })
    })
    renderPanel()
    fireEvent.click(screen.getByLabelText('全屏专注'))
    expect(useCopilotStore.getState().form).toBe('fullscreen')
    expect(screen.getByLabelText('AI Copilot 输入框')).toHaveValue('草稿内容')
    fireEvent.click(screen.getByLabelText('退出全屏'))
    expect(useCopilotStore.getState().form).toBe('drawer')
    expect(screen.getByLabelText('AI Copilot 输入框')).toHaveValue('草稿内容')
  })

  test('最小化悬浮可关闭面板（任务 3.7 出口完整）', () => {
    act(() => {
      useCopilotStore.setState({ open: true, form: 'minimized' })
    })
    renderPanel()
    fireEvent.click(screen.getByLabelText('关闭 AI Copilot'))
    expect(useCopilotStore.getState().open).toBe(false)
    expect(screen.queryByLabelText('恢复 AI Copilot 面板')).not.toBeInTheDocument()
  })
})

describe('流式展示与取消（任务 4.6/4.7/4.8/4.9 + 6.4/6.5/6.6）', () => {
  test('分步推进到完成：播报节流 + 完成独立播报（任务 4.6/6.4/6.5）', () => {
    vi.useFakeTimers()
    try {
      openPanel()
      renderPanel()
      const input = screen.getByLabelText('AI Copilot 输入框')
      fireEvent.change(input, { target: { value: '演示问题' } })
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      expect(useCopilotStore.getState().streamPhase).toBe('understanding')
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      expect(useCopilotStore.getState().streamPhase).toBe('analyzing')
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      expect(useCopilotStore.getState().streamPhase).toBe('generating')
      // 流式播报（节流后）至少出现过一次
      expect(document.querySelector('[data-copilot-live-region]')?.textContent).not.toBe('')
      act(() => {
        vi.advanceTimersByTime(1900)
      })
      expect(useCopilotStore.getState().streaming).toBe(false)
      expect(useCopilotStore.getState().streamPhase).toBe('done')
      // 完成态独立播报
      expect(document.querySelector('[data-copilot-complete-region]')?.textContent).toContain(
        '已完成',
      )
      // 回复消息已追加
      expect(useCopilotStore.getState().messages.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('取消后不呈现部分结果为完成态（任务 4.8）', () => {
    vi.useFakeTimers()
    try {
      openPanel()
      renderPanel()
      const input = screen.getByLabelText('AI Copilot 输入框')
      fireEvent.change(input, { target: { value: '演示问题' } })
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      const cancelButton = document.querySelector<HTMLElement>('[data-copilot-cancel]')
      expect(cancelButton).toBeTruthy()
      fireEvent.click(cancelButton!)
      expect(useCopilotStore.getState().streaming).toBe(false)
      expect(useCopilotStore.getState().streamPhase).toBe('cancelled')
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      const state = useCopilotStore.getState()
      // 只追加了用户消息，没有完成态回复
      expect(state.messages.length).toBe(1)
      expect(state.demoActions.length).toBe(0)
      expect(state.streamPhase).toBe('cancelled')
      expect(screen.getByText(/已取消生成/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('消息气泡与主题密度（任务 4.1–4.5）', () => {
  const COMBOS: Array<['light' | 'dark', 'comfortable' | 'compact']> = [
    ['light', 'comfortable'],
    ['light', 'compact'],
    ['dark', 'comfortable'],
    ['dark', 'compact'],
  ]

  test.each(COMBOS)('四种组合下气泡均使用 token 渲染（%s / %s）', (mode, density) => {
    document.documentElement.setAttribute('data-mode', mode)
    document.documentElement.setAttribute('data-density', density)
    act(() => {
      useCopilotStore.setState({
        open: true,
        messages: [makeUserMessage('用户消息'), makeAssistantMessage()],
      })
    })
    renderPanel()
    const bubbles = document.querySelectorAll('[data-copilot-bubble]')
    expect(bubbles.length).toBe(2)
    const classes = Array.from(bubbles).map((b) => b.className)
    // AI 侧：左 3px --ai-accent 边框；用户侧：--primary-500 底
    const assistantClass = classes[1]!
    const userClass = classes[0]!
    expect(assistantClass).toContain('border-l-[3px]')
    expect(assistantClass).toContain('var(--ai-accent)')
    expect(userClass).toContain('var(--primary-500)')
    // 时间戳右对齐且存在
    const timestamps = document.querySelectorAll('[data-copilot-timestamp]')
    expect(timestamps.length).toBe(2)
    // 无硬编码色值（十六进制）出现在气泡类名中
    for (const c of classes) {
      expect(c).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.removeAttribute('data-density')
  })
})

describe('挂载插槽与空状态（任务 5.1–5.8）', () => {
  test('未提供插槽内容时干净折叠，面板仍完整可用（任务 5.3/5.8）', () => {
    act(() => {
      useCopilotStore.setState({ open: true, messages: [makeUserMessage('已有对话')] })
    })
    renderPanel()
    expect(document.querySelector('[data-copilot-chips-slot]')).toBeNull()
    expect(document.querySelector('[data-copilot-assumptions-slot]')).toBeNull()
    expect(document.querySelector('[data-copilot-confidence-slot]')).toBeNull()
    // 面板其余功能完整：标题栏 + 输入 + 消息
    expect(screen.getByText('AI Copilot')).toBeInTheDocument()
    expect(screen.getByLabelText('AI Copilot 输入框')).toBeInTheDocument()
    expect(screen.getByText('已有对话')).toBeInTheDocument()
  })

  test('插槽原样渲染归属能力内容（任务 5.4/5.5）', () => {
    const ownerChips = <span data-owner-chip>归属芯片</span>
    const ownerAssumptions = <div data-owner-assumptions>归属假设</div>
    render(
      <CopilotMessageList
        messages={[makeUserMessage('已有对话')]}
        onPickExample={() => {}}
        quickActionChips={ownerChips}
        assumptions={ownerAssumptions}
      />,
    )
    // 原样渲染，不做转换/过滤/二次派生
    expect(document.querySelector('[data-owner-chip]')?.textContent).toBe('归属芯片')
    expect(document.querySelector('[data-owner-assumptions]')?.textContent).toBe('归属假设')
    expect(document.querySelector('[data-copilot-chips-slot]')).toBeTruthy()
    expect(document.querySelector('[data-copilot-assumptions-slot]')).toBeTruthy()
    // 壳不含按页面动作表/假设编辑逻辑：无编辑控件出现
    expect(document.querySelector('[data-owner-assumptions] button')).toBeNull()
  })

  test('空状态示例按路由与权限过滤并可填入输入框（任务 5.6）', () => {
    canAnyMock.mockImplementation((perms?: string[]) => {
      if (perms && perms.length > 0) return true
      return true
    })
    mockPathname = '/projects/1'
    openPanel()
    renderPanel()
    const examples = document.querySelectorAll('[data-copilot-example]')
    // 项目路由 → 含项目相关示例；且通用示例可见
    expect(examples.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(examples[0] as HTMLElement)
    expect(useCopilotStore.getState().draft.length).toBeGreaterThan(0)
  })

  test('无任何可用权限时降级文案且不泄露隐藏能力（任务 5.7）', () => {
    canAnyMock.mockReturnValue(false)
    mockPathname = '/dashboard'
    openPanel()
    renderPanel()
    expect(screen.getByText(/当前没有可用于 AI 协助的权限/)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-copilot-example]').length).toBe(0)
  })
})

describe('持久化边界红线（任务 7.1–7.6）', () => {
  test('动作卡片为禁用预览态，无任何可点击持久化控件（任务 7.1/7.3）', () => {
    vi.useFakeTimers()
    try {
      openPanel()
      renderPanel()
      const input = screen.getByLabelText('AI Copilot 输入框')
      fireEvent.change(input, { target: { value: '演示问题' } })
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      // 分阶段推进（链式 setTimeout 依赖每个 act 边界内的 effect 重跑）
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      act(() => {
        vi.advanceTimersByTime(1900)
      })
      const cards = document.querySelectorAll('[data-copilot-action-card]')
      expect(cards.length).toBeGreaterThan(0)
      for (const card of Array.from(cards)) {
        expect(card.getAttribute('aria-disabled')).toBe('true')
        expect(card.querySelector('button')).toBeNull()
        expect(card.textContent).toContain('预览不可用')
        expect(card.textContent).toContain('不会自动执行')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  // v3-copilot-live-submission-channel：提交改走真实回合端点后，本红线的含义收紧为
  // 「只打回合端点，绝不打任何域写入端点」——而非「零 fetch」。
  test('面板交互只调用回合端点，不发起任何域写入请求（任务 7.2/7.4）', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => {
      throw new Error('offline in test')
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      openPanel()
      renderPanel()
      fireEvent.change(screen.getByLabelText('AI Copilot 输入框'), { target: { value: '演示' } })
      fireEvent.keyDown(screen.getByLabelText('AI Copilot 输入框'), {
        key: 'Enter',
        ctrlKey: true,
      })
      await act(async () => {
        await Promise.resolve()
      })
      fireEvent.click(screen.getByLabelText('最小化面板'))
      fireEvent.click(screen.getByLabelText('恢复 AI Copilot 面板'))
      fireEvent.click(screen.getByLabelText('关闭面板'))

      const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]))
      // 每一次请求都必须是回合端点
      for (const url of urls) {
        expect(url).toContain('/copilot/turns')
      }
      // 绝不触碰域写入端点
      for (const url of urls) {
        expect(url).not.toMatch(/\/(tasks|projects|risks|milestones|wbs|reports)(\/|\?|$)/)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('无后端状态显式标注（任务 7.5）', () => {
    openPanel()
    renderPanel()
    const label = document.querySelector('[data-copilot-no-backend]')
    expect(label).toBeTruthy()
    // 演示态必须显式标注并说明原因（spec D5）
    expect(label!.textContent).toContain('演示模式')
    expect(label!.textContent).toContain('不会保存或修改')
  })
})

describe('无障碍与响应式（任务 6.1–6.10）', () => {
  test('减弱动画：呼吸头像禁用、面板无位移/宽度过渡（任务 6.7/3.4）', () => {
    act(() => {
      useCopilotStore.setState({
        open: true,
        messages: [makeAssistantMessage()],
      })
    })
    renderPanel()
    // 呼吸头像带 motion-reduce 关闭
    const avatar = document.querySelector('[data-copilot-message] .animate-pulse')
    expect(avatar).toBeTruthy()
    expect(avatar!.className).toContain('motion-reduce:animate-none')
    // 面板容器无 position/width 过渡（布局属性不动画）
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    expect(panel.className).not.toContain('transition')
  })

  test('移动端全宽抽屉 + 底部输入（任务 6.8）', () => {
    openPanel()
    renderPanel()
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement
    expect(panel.className).toContain('w-full')
    expect(panel.className).toContain('md:w-[var(--copilot-panel-width)]')
    // 输入区位于面板内底部（DOM 顺序：消息区之后）
    const inputArea = document.querySelector('[data-copilot-input-area]') as HTMLElement
    expect(inputArea).toBeTruthy()
    expect(panel.contains(inputArea)).toBe(true)
  })

  test('浏览器返回手势可关闭面板（任务 6.9）', () => {
    openPanel()
    renderPanel()
    expect(window.history.state?.copilotPanelOpen).toBe(true)
    fireEvent(window, new PopStateEvent('popstate'))
    expect(useCopilotStore.getState().open).toBe(false)
  })

  test('错误态展示（机器可读原因中文表达，任务 4.10）', () => {
    act(() => {
      useCopilotStore.setState({
        open: true,
        streamError: 'provider_error：生成服务暂不可用（演示）',
      })
    })
    renderPanel()
    expect(document.querySelector('[data-copilot-error]')?.textContent).toContain(
      '生成服务暂不可用',
    )
  })

  test('窄屏 + 紧凑密度下文字与控件不重叠（任务 6.10，结构级保证）', () => {
    document.documentElement.setAttribute('data-density', 'compact')
    // 窄屏：面板全宽（md 起才按宽度偏好），可用横向空间最小
    const longText = 'A'.repeat(200) // 无空格长串——最容易撑破气泡
    act(() => {
      useCopilotStore.setState({
        open: true,
        width: 360, // 下界宽度
        streaming: true,
        streamPhase: 'generating',
        messages: [makeUserMessage(longText), makeAssistantMessage()],
        demoAssumptions: buildCopilotDemoAssumptions(),
      })
    })
    renderPanel()
    const panel = document.querySelector('[data-copilot-panel]') as HTMLElement

    // 标题截断而非挤压控件；控件组不收缩
    const title = panel.querySelector('h2') as HTMLElement
    expect(title.className).toContain('truncate')
    expect(title.className).toContain('min-w-0')
    const controls = panel.querySelector('[data-copilot-titlebar-controls]') as HTMLElement
    expect(controls.className).toContain('shrink-0')

    // 气泡：长串换行 + 宽度受限，不会盖住相邻元素
    for (const bubble of Array.from(panel.querySelectorAll('[data-copilot-bubble]'))) {
      expect(bubble.className).toContain('break-words')
      const wrapper = bubble.parentElement as HTMLElement
      expect(wrapper.className).toContain('min-w-0')
      expect(wrapper.className).toContain('max-w-[85%]')
    }

    // 时间戳独立成行（不叠在气泡上）
    for (const ts of Array.from(panel.querySelectorAll('[data-copilot-timestamp]'))) {
      expect(ts.className).not.toContain('absolute')
      expect(ts.previousElementSibling?.getAttribute('data-copilot-bubble')).not.toBeNull()
    }

    // 流式头部：阶段文案截断、ETA 不被挤压
    const streaming = panel.querySelector('[data-copilot-streaming]') as HTMLElement
    const streamingLabels = streaming.querySelectorAll('span')
    expect(Array.from(streamingLabels).some((s) => s.className.includes('truncate'))).toBe(true)
    expect(Array.from(streamingLabels).some((s) => s.className.includes('shrink-0'))).toBe(true)

    // 输入区：输入自适应、按钮不收缩
    const input = panel.querySelector('[data-copilot-input]') as HTMLElement
    expect(input.className).toContain('flex-1')
    const actionButton = panel.querySelector(
      '[data-copilot-submit], [data-copilot-cancel-input]',
    ) as HTMLElement
    expect(actionButton.className).toContain('shrink-0')

    // 面板内除 1px 调宽把手外无绝对定位覆盖层（绝对定位是重叠的主要来源）
    const absolutes = Array.from(panel.querySelectorAll('*')).filter((el) =>
      el.className && typeof el.className === 'string' ? el.className.includes('absolute') : false,
    )
    for (const el of absolutes) {
      expect(el.hasAttribute('data-copilot-resize-handle')).toBe(true)
    }

    document.documentElement.removeAttribute('data-density')
  })

  test('紧凑密度下假设行文本与可信度徽标不互相挤压（任务 6.10）', () => {
    document.documentElement.setAttribute('data-density', 'compact')
    act(() => {
      useCopilotStore.setState({
        open: true,
        width: 360,
        messages: [makeAssistantMessage()],
        demoAssumptions: buildCopilotDemoAssumptions(),
      })
    })
    renderPanel()
    const rows = document.querySelectorAll('[data-copilot-assumptions] li')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of Array.from(rows)) {
      const statement = row.firstElementChild as HTMLElement
      const badge = row.querySelector('[data-copilot-confidence]') as HTMLElement
      expect(statement.className).toContain('min-w-0')
      expect(statement.className).toContain('break-words')
      expect(badge.className).toContain('shrink-0')
    }
    document.documentElement.removeAttribute('data-density')
  })

  test('刷新后续接进行中会话（任务 4.9，复用低敏游标）', async () => {
    // v3-copilot-productized-operating-entry：提交失败**不再**降级为演示。
    // 演示流式的唯一入口是「宿主显式声明 + 用户显式选择」，故本用例显式进入演示态；
    // fetch 仍然被替换成抛错桩，用以证明演示路径零网络。
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('演示态不得发起网络调用')
    }) as unknown as typeof fetch
    try {
      act(() => {
        useCopilotStore.getState().setDemoCapabilityDeclared(true)
        useCopilotStore.getState().enterExplicitDemonstration()
      })
      openPanel()
      const first = renderPanel()
      const input = screen.getByLabelText('AI Copilot 输入框')
      fireEvent.change(input, { target: { value: '演示问题' } })
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      await act(async () => {
        await Promise.resolve()
      })
      vi.useFakeTimers()
      expect(useCopilotStore.getState().streamPhase).toBe('understanding')
      // 游标已写入（低敏：sessionId + phase + timestamp）
      const raw = sessionStorage.getItem('aiproj-copilot-demo-cursor-v1')
      expect(raw).toBeTruthy()
      expect(raw).not.toContain('演示问题')
      // 模拟刷新：卸载面板 + 流式状态清零（会话/游标仍在）
      first.unmount()
      act(() => {
        useCopilotStore.setState({ streaming: false, streamPhase: 'idle' })
      })
      renderPanel()
      // 挂载时从游标恢复流式阶段，续接推进
      expect(useCopilotStore.getState().streaming).toBe(true)
      expect(useCopilotStore.getState().streamPhase).toBe('understanding')
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      expect(useCopilotStore.getState().streamPhase).toBe('analyzing')
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      expect(useCopilotStore.getState().streamPhase).toBe('generating')
      act(() => {
        vi.advanceTimersByTime(1900)
      })
      expect(useCopilotStore.getState().streamPhase).toBe('done')
      expect(useCopilotStore.getState().messages.length).toBe(2)
    } finally {
      vi.useRealTimers()
      globalThis.fetch = originalFetch
      sessionStorage.clear()
    }
  })
})
