/**
 * v3-ui-next-help-knowledge-domain W3 · tasks 3.8 —— 顶栏 HelpCircle 与三通道
 * 导航闭环集成测试（spec「空间地图坐标点亮与 AI 同事意图直达三通道闭环」：
 * 通道一 Ctrl+M 坐标直达 / 通道二 AI 同事意图直达 / 通道三顶栏常驻入口）。
 *
 * 使用真实 Store（next-ai-colleague-store + ai-colleague-intent）与真实
 * SpaceMapOverlay，仅 mock 网络边界（@/lib/api/ai-tools execute）与
 * next/navigation 路由，覆盖：
 * - 顶栏右侧操作区常驻 HelpCircle（aria-label="帮助中心" + data-next-help-trigger），
 *   位于 AI 同事唤起与「回到旧版」之间；点击触发纯客户端导航 router.push('/next/help')，
 *   零网络请求、零 execute 调用、零数据拉取；
 * - 全局按下 Ctrl+M 输入「帮助」/「知识库」即时高亮 help/knowledge 全局坐标
 *   卡片（available 可点），点击直达 /next/help 与 /next/knowledge——单项目
 *   上下文与全域视图均恒为全局绝对路径（不拼装项目 ID、不回退首页引导）；
 * - AI 同事自然语言「打开帮助中心」/「打开知识库」命中规则 → execute 仅携带
 *   lens（零 projectId 注入）→ 导航结果卡中文回显「帮助中心/知识底座」→
 *   自动 router.push 直达；
 * - 精确档（precise）降级：data-immersion="precise" 生效、HelpCircle 入口
 *   零动效（无 animate-* 类）且点击导航 100% 等价。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import type { AiToolExecuteEnvelope } from '@/lib/api/ai-tools'

const { navMocks, routerPush, executeMock } = vi.hoisted(() => ({
  navMocks: { pathname: '/next/projects/42' },
  routerPush: vi.fn(),
  executeMock: vi.fn(),
  fetchSpy: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { list: vi.fn(), execute: executeMock, confirm: vi.fn() },
  isScheduleStaleError: () => false,
}))

// ---------------------------------------------------------------- fixtures

/** 帮助/知识全域镜头后端契约回显：projectId 恒为 null（无项目载体）。 */
function globalNavData(lens: 'help' | 'knowledge'): Record<string, unknown> {
  return {
    path: lens === 'knowledge' ? '/next/knowledge' : '/next/help',
    lens,
    projectId: null,
    depth: 'workbench',
    targetId: null,
  }
}

function resetNetworkMocks() {
  routerPush.mockReset()
  executeMock.mockReset()
  executeMock.mockImplementation(
    async (
      toolName: string,
      parameters: Record<string, unknown>,
    ): Promise<AiToolExecuteEnvelope> => {
      if (toolName !== 'navigate_to_space') {
        throw new Error(`unexpected tool ${toolName}`)
      }
      const lens = parameters.lens === 'knowledge' ? 'knowledge' : 'help'
      return {
        data: globalNavData(lens),
        meta: { toolName, status: 'SUCCESS', durationMs: 8 },
      }
    },
  )
}

// ---------------------------------------------------------------- harness

function renderTopbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextTopbar />
    </QueryClientProvider>,
  )
}

/** Ctrl+M 装配路径（useNextShortcuts Cmd/Ctrl+M 全局监听）的薄壳。 */
function OverlayHarness() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return <SpaceMapOverlay open={open} onOpenChange={setOpen} />
}

async function settleStoreUpdates() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function openPanelAndSend(text: string) {
  await settleStoreUpdates()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /AI 唤起/ }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const textarea = screen.getByRole('textbox', { name: '向 AI 同事发送指令' })
  await act(async () => {
    fireEvent.change(textarea, { target: { value: text } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
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
  document.documentElement.removeAttribute('data-immersion')
  resetNetworkMocks()
})

// ---------------------------------------------------------------------------
describe('顶栏 HelpCircle 常驻入口（tasks 3.7，design Decision 1 通道三）', () => {
  test('右侧操作区常驻渲染：aria-label/data-testid 完备，位于 AI 唤起与回到旧版之间', () => {
    renderTopbar()

    const help = screen.getByRole('button', { name: '帮助中心' })
    expect(help).toHaveAttribute('data-next-help-trigger')
    expect(help.querySelector('svg')).not.toBeNull()
    expect(help).toBeEnabled()

    // 位置契约：AI 同事唤起（data-ai-colleague-trigger）与「回到旧版」之间
    const aiTrigger = document.querySelector('[data-ai-colleague-trigger]') as HTMLElement
    const legacyTrigger = document.querySelector('[data-next-back-to-legacy]') as HTMLElement
    expect(aiTrigger).not.toBeNull()
    expect(legacyTrigger).not.toBeNull()
    expect(aiTrigger.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      help.compareDocumentPosition(legacyTrigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  test('点击 HelpCircle → 纯客户端导航 router.push(/next/help)：零网络请求、零 execute、零数据拉取', async () => {
    renderTopbar()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帮助中心' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/next/help')
    // 纯导航零副作用：不触发任何 AI 工具执行与网络请求（RL-01）
    expect(executeMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
describe('Ctrl+M 空间地图：help/knowledge 全局坐标高亮并直达（通道一）', () => {
  test('单项目上下文输入「帮助」：唯一高亮帮助中心卡并直达 /next/help（不拼装项目 ID）', () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    render(<OverlayHarness />)

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '空间地图' })
    expect(dialog).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索空间坐标' }))

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '帮助' } })
    const helpCard = screen.getByRole('button', { name: /帮助中心/ })
    expect(helpCard).toHaveAttribute('data-space-coordinate', 'help')
    expect(helpCard).toHaveAttribute('data-status', 'available')
    expect(helpCard).toBeEnabled()
    expect(screen.queryByRole('button', { name: /知识底座/ })).not.toBeInTheDocument()

    fireEvent.click(helpCard)
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(routerPush).toHaveBeenCalledTimes(1)
    // 全局坐标：即便处于项目空间也不替换 :id —— 恒为全局绝对路径
    expect(routerPush).toHaveBeenCalledWith('/next/help')
  })

  test('输入「知识库」：唯一高亮知识底座卡并直达 /next/knowledge', () => {
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '知识库' } })
    const knowledgeCard = screen.getByRole('button', { name: /知识底座/ })
    expect(knowledgeCard).toHaveAttribute('data-space-coordinate', 'knowledge')
    expect(knowledgeCard).toBeEnabled()
    expect(screen.queryByRole('button', { name: /帮助中心/ })).not.toBeInTheDocument()

    fireEvent.click(knowledgeCard)
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/next/knowledge')
  })

  test('全域视图（无项目上下文）同样原样直达，绝不回退首页引导', () => {
    useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
    navMocks.pathname = '/next'
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '知识' } })
    fireEvent.click(screen.getByRole('button', { name: /知识底座/ }))
    expect(routerPush).toHaveBeenCalledWith('/next/knowledge')

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '指南' } })
    fireEvent.click(screen.getByRole('button', { name: /帮助中心/ }))
    expect(routerPush).toHaveBeenLastCalledWith('/next/help')
  })
})

// ---------------------------------------------------------------------------
describe('AI 同事意图直达（通道二）：help/knowledge 规则 → 结果卡 → 自动跳转', () => {
  test('单项目上下文「打开帮助中心」：execute 仅携带 lens=help（零 projectId）→ 直达 /next/help', async () => {
    renderTopbar()
    await openPanelAndSend('打开帮助中心')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', { lens: 'help' }),
    )

    // 导航结果卡中文回显（NAVIGATION_LENS_LABELS 补 help/knowledge 后）
    expect(screen.getByText('快捷规则匹配 · navigate_to_space')).toBeInTheDocument()
    const lensCell = await waitFor(() => document.querySelector('[data-navigate-lens]'))
    expect(lensCell?.textContent).toContain('帮助中心')
    expect(document.querySelector('[data-navigate-path]')?.textContent).toBe('/next/help')
    expect(routerPush).toHaveBeenCalledWith('/next/help')
  })

  test('全域视图「打开知识库」：同契约执行并直达 /next/knowledge（全域导航不抛上下文缺失）', async () => {
    navMocks.pathname = '/next'
    renderTopbar()
    await openPanelAndSend('打开知识库')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', { lens: 'knowledge' }),
    )
    const lensCell = await waitFor(() => document.querySelector('[data-navigate-lens]'))
    expect(lensCell?.textContent).toContain('知识底座')
    expect(document.querySelector('[data-navigate-path]')?.textContent).toBe('/next/knowledge')
    expect(routerPush).toHaveBeenCalledWith('/next/knowledge')
    // 无 ContextMissingError 引导文案（全域规则不要求项目上下文）
    expect(screen.queryByText(/需要项目环境/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
describe('精确档（precise）降级（spec「精确档视觉降级」）', () => {
  test('data-immersion=precise 生效：HelpCircle 入口零动效类且导航 100% 等价', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    renderTopbar()

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise'),
    )
    const help = screen.getByRole('button', { name: '帮助中心' })
    // 常驻入口零动效（无 animate-* 类；弥散光晕/呼吸动效由全局 CSS 依
    // data-immersion=precise 置空，组件层不新增任何动画样式）
    expect(help.className).not.toMatch(/animate-/)
    expect(help.className).not.toMatch(/transition-all/)

    await act(async () => {
      fireEvent.click(help)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/next/help')
  })
})
