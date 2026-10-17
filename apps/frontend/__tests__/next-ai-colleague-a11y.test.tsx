/**
 * AI 同事无障碍与沉浸阶梯降级测试（v3-ui-next-ai-colleague W4 · tasks 4.4）。
 *
 * 覆盖：
 *   - role="dialog" / aria-modal="true" / aria-label / aria-live="polite" 读屏语义；
 *   - 焦点管理：打开自动聚焦输入框、关闭后焦点回跳触发按钮；
 *   - 多层模态 Esc 层级：空间地图 Overlay 打开时 Esc 仅关最上层，AI 面板不连关；
 *   - 精确档（precise）与 prefers-reduced-motion：停阴影 / 停动画 / 纯黑底 /
 *     停遮罩毛玻璃，数据与交互 100% 等价。
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useNextTrackStore } from '@/stores/next-track-store'

const { navMocks, routerPush, executeMock } = vi.hoisted(() => ({
  navMocks: { pathname: '/next/projects/42' },
  routerPush: vi.fn(),
  executeMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: {
    list: vi.fn(),
    execute: executeMock,
    confirm: vi.fn(),
  },
  isScheduleStaleError: () => false,
}))

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextAppShell>
        <p data-testid="shell-content">新轨工作区</p>
      </NextAppShell>
    </QueryClientProvider>,
  )
}

function openAiPanel() {
  fireEvent.click(screen.getByRole('button', { name: /AI 唤起/ }))
}

async function flushTimers() {
  // 焦点回跳链（双 rAF，测试环境以宏任务模拟）可在任意代数后落定；
  // 单一宏任务窗口保证整条 0ms 链先于断言完成，消除逐代冲刷竞态；
  // 窗口加宽至 200ms 以吸收全量套件顺序执行下的 CPU 争用抖动（簇 K）。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
}

/** 发送消息并在 act 窗口内等待 Store 异步编排（execute 承诺链）全部落定（修补6）。 */
async function sendAndSettle(text: string) {
  const input = screen.getByRole('textbox', { name: '向 AI 同事发送指令' })
  await act(async () => {
    fireEvent.change(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  navMocks.pathname = '/next/projects/42'
  localStorage.clear()
  useNextTrackStore.getState().reset()
  useNextAiColleagueStore.setState({
    isOpen: false,
    messages: [],
    executionState: 'idle',
    pendingAction: null,
  })
  useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
  routerPush.mockReset()
  executeMock.mockReset()
  document.documentElement.removeAttribute('data-immersion')
})

describe('AI 同事无障碍（ARIA 语义与焦点管理）', () => {
  test('面板声明 role="dialog" / aria-modal="true" / aria-label；时间线 aria-live="polite"', () => {
    renderShell()
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()

    openAiPanel()
    const dialog = screen.getByRole('dialog', { name: 'AI 同事交互面板' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-ai-colleague-panel', '')

    const timeline = screen.getByTestId('ai-colleague-timeline')
    expect(timeline).toHaveAttribute('aria-live', 'polite')
  })

  test('打开自动聚焦输入框；Esc 关闭后焦点回跳顶栏触发按钮', async () => {
    renderShell()
    openAiPanel()

    const input = screen.getByRole('textbox', { name: '向 AI 同事发送指令' })
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Escape' })
    await flushTimers() // 焦点回跳经 setTimeout(0) 落定
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute('data-ai-colleague-trigger', '')
  })

  test('关闭按钮关闭后焦点同样回跳触发按钮', async () => {
    renderShell()
    openAiPanel()

    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 同事面板' }))
    await flushTimers()
    expect(document.activeElement).toHaveAttribute('data-ai-colleague-trigger', '')
  })
})

describe('AI 同事无障碍（多层模态 Esc 层级优先级）', () => {
  test('空间地图 Overlay 打开时 Esc 仅关最上层，AI 面板不连带关闭', async () => {
    renderShell()
    openAiPanel()
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()

    // 呼出空间地图（最上层）；面板打开后 Radix hideOthers 隐藏外围按钮，按 data 属性定位
    const spaceMapTrigger = document.querySelector('[data-next-space-map-trigger]') as HTMLElement
    fireEvent.click(spaceMapTrigger)
    const overlay = screen.getByRole('dialog', { name: '空间地图' })
    expect(overlay).toBeInTheDocument()

    // 第一次 Esc：仅关 Overlay，AI 面板保持展开
    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()

    // 第二次 Esc：面板成为最上层，此刻才关闭
    fireEvent.keyDown(screen.getByRole('textbox', { name: '向 AI 同事发送指令' }), {
      key: 'Escape',
    })
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
  })
})

describe('AI 同事沉浸阶梯降级（precise 与 reduced-motion）', () => {
  test('精确档：纯黑底、停展开动画、停遮罩毛玻璃、停呼吸脉动，数据与交互等价', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    renderShell()
    openAiPanel()

    const dialog = screen.getByRole('dialog', { name: 'AI 同事交互面板' })
    const panelRoot = dialog.querySelector('[data-next-track]') as HTMLElement
    expect(panelRoot.className).toContain('bg-[#0a0d12]')
    expect(dialog.className).toContain('duration-0')

    const scrim = screen.getByTestId('ai-colleague-scrim')
    expect(scrim.className).not.toContain('backdrop-blur')

    // 交互与数据 100% 等价：precise 下发起查询仍正常渲染结构化卡片
    executeMock.mockResolvedValueOnce({
      data: {
        id: 42,
        name: '开项核心引擎',
        code: 'CORE-42',
        status: 'active',
        priority: 'high',
        startDate: '2026-08-01',
        endDate: '2026-12-31',
        taskCount: 37,
        completedTaskCount: 25,
        progressPercent: 68,
        memberCount: 6,
      },
      meta: { toolName: 'get_project_summary', status: 'SUCCESS', durationMs: 9 },
    })
    await sendAndSettle('项目概况')

    await screen.findByText('开项核心引擎')
    expect(document.querySelector('[data-card="project-summary"]')).not.toBeNull()
    // 精确档执行中不渲染任何脉动动画类
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0)
  })

  test('prefers-reduced-motion 自动视同精确档：数据等价且动效停用', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    try {
      renderShell()
      // useImmersionTier 挂载后将合成档位写入 <html data-immersion>
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')

      openAiPanel()
      const dialog = screen.getByRole('dialog', { name: 'AI 同事交互面板' })
      const panelRoot = dialog.querySelector('[data-next-track]') as HTMLElement
      expect(panelRoot.className).toContain('bg-[#0a0d12]')
      expect(dialog.className).toContain('duration-0')
      expect(screen.getByTestId('ai-colleague-scrim').className).not.toContain('backdrop-blur')

      // 交互等价：空态快捷入口可用（act 窗口内落定 Store 异步编排）
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /查看当前项目摘要/ }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(executeMock).toHaveBeenCalledWith('get_project_summary', { projectId: 42 })
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})
