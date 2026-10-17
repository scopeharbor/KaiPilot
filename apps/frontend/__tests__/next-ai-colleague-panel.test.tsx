/**
 * AI 同事主抽屉面板测试（v3-ui-next-ai-colleague W2 · tasks 2.6）。
 *
 * 覆盖：Radix Portal 挂载（逃逸测试容器直达 document.body）、data-next-track
 * 令牌作用域重挂、role/aria-modal/aria-label、打开自动聚焦输入框、情境徽章回显
 * （项目空间 / 全域首页）、提交消息携带情境上下文、执行中双锁、关闭按钮 /
 * 遮罩 / Esc 三条关闭路径、关闭焦点回跳触发源、多层模态下 Esc 单次仅关最上层、
 * 空态快捷引导经面板直达 Store、精确档降级（纯黑底 / 停动画 / 停毛玻璃）。
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AiColleaguePanel, type AiColleaguePanelProps } from '@/components/next/ai/AiColleaguePanel'
import { useNextTrackStore } from '@/stores/next-track-store'
import { getColleagueStoreMock } from './_next-ai-colleague-mock'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/stores/next-ai-colleague-store', async () => {
  const { getColleagueStoreMock } = await import('./_next-ai-colleague-mock')
  return { useNextAiColleagueStore: getColleagueStoreMock().hook }
})

const mockStore = getColleagueStoreMock()

function openPanel() {
  act(() => {
    mockStore.hook.setState({ isOpen: true })
  })
}

function PanelHarness({
  pathname,
  entityProjectId,
  entityTitle,
}: Partial<AiColleaguePanelProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <div>
        <button
          type="button"
          data-ai-colleague-trigger=""
          aria-label="唤起 AI 同事"
          tabIndex={-1}
        />
        <AiColleaguePanel
          pathname={pathname ?? '/next/projects/42'}
          entityProjectId={entityProjectId}
          entityTitle={entityTitle}
        />
      </div>
    </QueryClientProvider>
  )
}

/** 模拟更顶层的模态（如空间地图 Overlay），用于 Esc 层级优先级判定。 */
function TopModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          role="dialog"
          aria-modal="true"
          aria-label="顶层模态"
          className="fixed inset-0"
        >
          <button type="button">顶层模态内容</button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

beforeEach(() => {
  mockStore.reset()
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  // 上一用例的组件树在 setup 的 cleanup 前仍挂载：包装 act 避免脱离 act 的重渲染警告
  act(() => {
    useNextTrackStore.setState({ immersionTier: null })
  })
})

describe('components/next/ai/AiColleaguePanel（Portal / 令牌作用域 / ARIA / 焦点）', () => {
  test('关闭态零渲染；打开后经 Portal 挂载到 document.body 并重挂 data-next-track', () => {
    const view = render(<PanelHarness />)
    expect(screen.queryByRole('dialog')).toBeNull()

    openPanel()
    const dialog = screen.getByRole('dialog', { name: 'AI 同事交互面板' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-ai-colleague-panel', '')
    // Portal 逃逸测试容器，直达 document.body（外层 overflow 无法裁剪面板）
    expect(view.container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
    // 令牌作用域重挂：--nx-* 变量作用域选择器在面板根容器内
    expect(dialog.querySelector('[data-next-track]')).not.toBeNull()
  })

  test('打开后自动聚焦输入框（onOpenAutoFocus）', () => {
    render(<PanelHarness />)
    openPanel()

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '向 AI 同事发送指令' }))
  })

  test('关闭后焦点回跳 data-ai-colleague-trigger 触发源', async () => {
    render(<PanelHarness />)
    openPanel()
    expect(document.activeElement).not.toHaveAttribute('data-ai-colleague-trigger')

    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 同事面板' }))
    // 焦点回跳链（双 rAF，测试环境以宏任务模拟）：等到焦点真正落回触发源再断言
    // （固定 20ms 窗口在全量并发负载下偶发不够）
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-ai-colleague-trigger', ''),
    )
    expect(mockStore.hook.getState().isOpen).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('情境徽章回显：项目空间显示「观测中」徽章与实体标题', () => {
    render(<PanelHarness entityTitle="开项核心引擎" />)
    openPanel()

    expect(screen.getByText('[● 观测中] 项目 #42 · 开项核心引擎')).toBeInTheDocument()
    expect(screen.getByText(/快捷规则直连/)).toBeInTheDocument()
  })

  test('情境徽章回显：全域首页显示全域视图徽章，标题缺省不臆造', () => {
    const view = render(<PanelHarness pathname="/next" entityTitle={null} />)
    openPanel()
    expect(screen.getByText('[○ 全域视图] 角色工作台')).toBeInTheDocument()

    act(() => {
      view.rerender(<PanelHarness pathname="/next/create" entityTitle={null} />)
    })
    expect(screen.getByText('[○ 生成剧场] 新剧生成工作台')).toBeInTheDocument()
  })

  test('项目空间缺省实体标题时如实回显「项目空间」', () => {
    render(<PanelHarness entityTitle={null} />)
    openPanel()
    const badge = screen.getByText('[● 观测中] 项目 #42 · 项目空间')
    expect(badge).toBeInTheDocument()
  })
})

describe('components/next/ai/AiColleaguePanel（消息提交流与状态锁定）', () => {
  test('Enter 提交消息：submitUserMessage 携带文本与派生情境上下文', () => {
    render(<PanelHarness entityTitle="开项核心引擎" />)
    openPanel()

    const textarea = screen.getByRole('textbox', { name: '向 AI 同事发送指令' })
    fireEvent.change(textarea, { target: { value: '去甘特图' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    const submitSpy = vi.mocked(mockStore.hook.getState().submitUserMessage)
    expect(submitSpy).toHaveBeenCalledTimes(1)
    const [submittedText, submittedContext] = submitSpy.mock.calls[0] ?? []
    expect(submittedText).toBe('去甘特图')
    expect(submittedContext).toEqual({
      contextType: 'project_space',
      currentProjectId: 42,
      pathname: '/next/projects/42',
      // W5 增补：矛盾求解的前端物理阻断判据随情境一起提交（无权限零请求）
      permissions: [],
      isSuperAdmin: false,
    })
  })

  test('空态快捷引导卡片经面板直达 Store 发送（fill 输入 + 情境注入）', () => {
    render(<PanelHarness />)
    openPanel()

    fireEvent.click(screen.getByRole('button', { name: /前往甘特图镜头/ }))
    const submitSpy = vi.mocked(mockStore.hook.getState().submitUserMessage)
    expect(submitSpy).toHaveBeenCalledTimes(1)
    const [submittedText, submittedContext] = submitSpy.mock.calls[0] ?? []
    expect(submittedText).toBe('去甘特图')
    expect((submittedContext as { currentProjectId: number }).currentProjectId).toBe(42)
  })

  test('thinking / executing 状态下仍可打字与发送（由 Store 排队到这一轮结束后发出）', () => {
    render(<PanelHarness />)
    openPanel()
    const submitSpy = vi.mocked(mockStore.hook.getState().submitUserMessage)

    for (const executionState of ['thinking', 'executing'] as const) {
      act(() => {
        mockStore.hook.setState({ executionState })
      })
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textarea).not.toBeDisabled()
      expect(textarea.placeholder).toContain('AI 正在回答，可以先输入')

      fireEvent.change(textarea, { target: { value: `查看项目摘要（${executionState}）` } })
      expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()
      fireEvent.keyDown(textarea, { key: 'Enter' })
      act(() => {
        mockStore.hook.setState({ executionState: 'idle' })
      })
    }
    expect(submitSpy).toHaveBeenCalledTimes(2)
    expect(submitSpy.mock.calls[0]![0]).toBe('查看项目摘要（thinking）')
  })

  test('排队中的消息显示提示条，可取消', () => {
    const cancelQueuedMessage = vi.fn()
    render(<PanelHarness />)
    openPanel()
    act(() => {
      mockStore.hook.setState({
        executionState: 'thinking',
        queuedMessage: { conversationId: 'conv-test', text: '再帮我排一下明天的会', context: {} },
        cancelQueuedMessage,
      } as never)
    })
    const banner = document.querySelector('[data-ai-colleague-queued]')!
    expect(banner).toHaveTextContent('已排队，这一轮回答完成后自动发送：「再帮我排一下明天的会」')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(cancelQueuedMessage).toHaveBeenCalledTimes(1)
    act(() => {
      mockStore.hook.setState({ queuedMessage: null } as never)
    })
  })

  test('底部状态指示器：executing 呈现执行中呼吸发丝线，idle 不渲染', () => {
    render(<PanelHarness />)
    openPanel()
    expect(screen.queryByTestId('ai-colleague-status')).toBeNull()

    act(() => {
      mockStore.hook.setState({
        executionState: 'executing',
        messages: [
          {
            id: 'a1',
            sender: 'assistant',
            timestamp: 1,
            toolExecution: {
              toolName: 'get_project_summary',
              intentSource: 'rule_preset',
              status: 'executing',
            },
          },
        ],
      })
    })
    const status = screen.getByTestId('ai-colleague-status')
    expect(status).toHaveAttribute('data-status', 'executing')
    expect(screen.getByText(/AI 同事正在执行工具 get_project_summary/)).toBeInTheDocument()
  })
})

describe('components/next/ai/AiColleaguePanel（关闭路径与模态层级）', () => {
  test('点击关闭按钮关闭并收敛 Store 状态', () => {
    render(<PanelHarness />)
    openPanel()

    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 同事面板' }))
    expect(mockStore.hook.getState().closePanel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('点击面板外遮罩关闭（Radix DismissableLayer 延迟派发）', async () => {
    render(<PanelHarness />)
    openPanel()

    // 冲刷 Radix 定时器注册的 document 级 pointerdown 监听（defer 挂载）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // 用户点击遮罩：pointerdown 命中 overlay 表面即触发 dismiss（Radix
    //   dismissable 层在 click 与 pointerdown 双通道都会收敛关闭）
    const scrim = screen.getByTestId('ai-colleague-scrim')
    fireEvent.pointerDown(scrim, { button: 0 })
    // Radix 1.1.15 在 PointerEvent 不完整的 jsdom 中会由 click 通道完成 outside dismiss。
    fireEvent.click(scrim)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockStore.hook.getState().closePanel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('Esc 关闭面板（单模态场景）', () => {
    render(<PanelHarness />)
    openPanel()

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(mockStore.hook.getState().closePanel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('多层模态下 Esc 单次仅关闭最上层，AI 面板不越权连带关闭', () => {
    function MultiModalHarness() {
      const [topOpen, setTopOpen] = React.useState(false)
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      return (
        <QueryClientProvider client={queryClient}>
          <div>
            <button
              type="button"
              data-ai-colleague-trigger=""
              aria-label="唤起 AI 同事"
              tabIndex={-1}
            />
            <AiColleaguePanel pathname="/next/projects/42" entityTitle="开项核心引擎" />
            <TopModal open={topOpen} onOpenChange={setTopOpen} />
            <button type="button" onClick={() => setTopOpen(true)}>
              打开顶层模态
            </button>
          </div>
        </QueryClientProvider>
      )
    }

    render(<MultiModalHarness />)
    openPanel()
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()

    // 面板打开期间 Radix hideOthers 将外围元素置 aria-hidden，需以 hidden 查询
    fireEvent.click(screen.getByRole('button', { name: '打开顶层模态', hidden: true }))
    const topDialog = screen.getByRole('dialog', { name: '顶层模态' })
    expect(topDialog).toBeInTheDocument()

    // 第一次 Esc：仅关闭最上层模态，AI 面板保持展开
    fireEvent.keyDown(topDialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '顶层模态' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()

    // 第二次 Esc：面板成为最上层，此刻才关闭
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('components/next/ai/AiColleaguePanel（沉浸阶梯精确档降级）', () => {
  test('precise 档：纯黑曜石底色、停展开动画、停遮罩毛玻璃与呼吸脉动，功能等价', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    render(<PanelHarness />)
    openPanel()

    act(() => {
      mockStore.hook.setState({
        executionState: 'executing',
        messages: [
          {
            id: 'a1',
            sender: 'assistant',
            timestamp: 1,
            toolExecution: {
              toolName: 'get_project_summary',
              intentSource: 'rule_preset',
              status: 'executing',
            },
          },
        ],
      })
    })

    const dialog = screen.getByRole('dialog', { name: 'AI 同事交互面板' })
    const panelRoot = dialog.querySelector('[data-next-track]') as HTMLElement
    expect(panelRoot.className).toContain('bg-[#0a0d12]')
    expect(dialog.className).toContain('duration-0')

    const scrim = screen.getByTestId('ai-colleague-scrim')
    expect(scrim.className).not.toContain('backdrop-blur')

    const status = screen.getByTestId('ai-colleague-status')
    expect(status.querySelector('.animate-pulse')).toBeNull()
    expect(status).toHaveAttribute('data-status', 'executing')

    // 数据与交互 100% 等价：状态回落 idle 后输入框可用、Enter 仍发起提交
    act(() => {
      mockStore.hook.setState({ executionState: 'idle' })
    })
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeEnabled()
    fireEvent.change(textarea, { target: { value: '项目摘要' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(mockStore.hook.getState().submitUserMessage).toHaveBeenCalledTimes(1)
  })
})
