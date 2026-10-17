/**
 * v3-ui-next-org-portfolio-domains W10 · tasks 10.8 —— 组织/全局三通道导航端到端
 * 集成测试（spec「组织级空间坐标与 AI 同事全域导航闭环」场景 + design Decision 1）。
 *
 * 使用真实 Store（next-ai-colleague-store + ai-colleague-intent）与真实
 * SpaceMapOverlay/NextTopbar，仅 mock 网络边界（@/lib/api/ai-tools execute）与
 * next/navigation 路由，覆盖：
 * - 通道一 Ctrl+M：输入「组织资源池」「组织 OKR」「风险热力」「插件目录」「技能矩阵」
 *   即时高亮对应组织/全局坐标卡并可直达——点击后按坐标全局绝对路径 router.push
 *   （/next/organization/**、/next/resources/skill-matrix），绝不拼装项目 ID；
 * - 容量环详情动态路由不设坐标：检索「容量环」唯一高亮列表页坐标并直达列表页
 *   （详情由列表页顶栏空间探索承接）；
 * - 通道二 AI 同事：「打开组织资源池」「查看组织 OKR」「去技能矩阵」命中全域规则
 *   （rule_nav_org 与 rule_nav_global 系列）→ execute 仅携带 lens（零 projectId
 *   注入，即便处于单项目上下文）→ 导航结果卡中文回显（NAVIGATION_LENS_LABELS）→
 *   自动 router.push 直达 /next/organization/... 路径；
 * - 全域导航不抛 ContextMissingError：角色首页（无项目上下文）唤起组织规则正常分发。
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

/** 组织镜头后端契约回显：projectId 恒为 null（无项目载体）。 */
const ORG_LENS_DATA: Record<string, { path: string; label: string }> = {
  org_overview: { path: '/next/organization', label: '组织概览' },
  org_bi_dashboards: { path: '/next/organization/bi/dashboards', label: 'BI 仪表盘' },
  org_bi_risk_heatmap: { path: '/next/organization/bi/risk-heatmap', label: '组织风险热力图' },
  org_bi_trends: { path: '/next/organization/bi/trends', label: '趋势分析' },
  org_okrs: { path: '/next/organization/okrs', label: 'OKR 层级管理' },
  org_okr_dashboard: { path: '/next/organization/okrs/dashboard', label: 'OKR 仪表盘' },
  org_resource_pool: { path: '/next/organization/resource-pool', label: '组织资源池' },
  org_resource_gaps: { path: '/next/organization/resource-gaps', label: '资源缺口分析' },
  org_resource_contentions: {
    path: '/next/organization/resource-contentions',
    label: '资源争用检测',
  },
  org_resource_demand: {
    path: '/next/organization/resource-demand-forecasting',
    label: '资源需求预测',
  },
  org_capacity_loops: { path: '/next/organization/resource-capacity-loops', label: '容量闭环' },
  org_cross_project_allocation: {
    path: '/next/organization/cross-project-resource-allocation',
    label: '跨项目调配',
  },
  org_plugin_directory: { path: '/next/organization/plugin-directory', label: '插件目录' },
  org_plugin_policies: { path: '/next/organization/plugin-policies', label: '插件策略' },
  global_resources: { path: '/next/resources', label: '全局资源' },
  global_skill_matrix: { path: '/next/resources/skill-matrix', label: '技能矩阵' },
  global_risks: { path: '/next/risks', label: '问题与风险' },
}

function orgNavData(lens: string): Record<string, unknown> {
  const entry = ORG_LENS_DATA[lens]
  return {
    path: entry!.path,
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
      const lens = String(parameters.lens ?? '')
      if (!(lens in ORG_LENS_DATA)) {
        throw new Error(`unexpected lens ${lens}`)
      }
      return {
        data: orgNavData(lens),
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
describe('Ctrl+M 空间地图：组织/全局坐标高亮并直达（tasks 10.8，通道一）', () => {
  test('输入「组织资源池」：唯一高亮组织资源池卡并直达列表路径（不拼装项目 ID）', () => {
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '空间地图' })
    expect(dialog).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '组织资源池' } })
    const poolCard = screen.getByRole('button', { name: /组织资源池/ })
    expect(poolCard).toHaveAttribute('data-space-coordinate', 'org_resource_pool')
    expect(poolCard).toHaveAttribute('data-status', 'available')
    expect(poolCard).toBeEnabled()
    // 不被项目级「资源工作台」误吞
    expect(screen.queryByRole('button', { name: /资源工作台/ })).not.toBeInTheDocument()

    fireEvent.click(poolCard)
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(routerPush).toHaveBeenCalledTimes(1)
    // 单项目上下文同样恒定直达全局绝对路径（无 :id 占位）
    expect(routerPush).toHaveBeenCalledWith('/next/organization/resource-pool')
  })

  test('输入「风险热力」：唯一高亮组织风险热力图卡并直达 /next/organization/bi/risk-heatmap', () => {
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '风险热力' } })
    const heatmapCard = screen.getByRole('button', { name: /风险热力图/ })
    expect(heatmapCard).toHaveAttribute('data-space-coordinate', 'org_bi_risk_heatmap')
    expect(screen.queryByRole('button', { name: /风险管理/ })).not.toBeInTheDocument()
    fireEvent.click(heatmapCard)
    expect(routerPush).toHaveBeenLastCalledWith('/next/organization/bi/risk-heatmap')
  })

  test('输入「OKR」：OKR 层级管理与 OKR 仪表盘双卡共存；「技能矩阵」「插件目录」精准归属', () => {
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'OKR' } })
    expect(screen.getByRole('button', { name: /OKR 层级管理/ })).toHaveAttribute(
      'data-space-coordinate',
      'org_okrs',
    )
    expect(screen.getByRole('button', { name: /OKR 仪表盘/ })).toHaveAttribute(
      'data-space-coordinate',
      'org_okr_dashboard',
    )
    expect(screen.queryByRole('button', { name: /组织概览/ })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '技能矩阵' } })
    const matrixCard = screen.getByRole('button', { name: /技能矩阵/ })
    expect(matrixCard).toHaveAttribute('data-space-coordinate', 'global_skill_matrix')
    fireEvent.click(matrixCard)
    expect(routerPush).toHaveBeenLastCalledWith('/next/resources/skill-matrix')

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '插件目录' } })
    fireEvent.click(screen.getByRole('button', { name: /插件目录/ }))
    expect(routerPush).toHaveBeenLastCalledWith('/next/organization/plugin-directory')
  })

  test('容量环详情动态路由不设坐标：检索「容量环」唯一高亮列表页坐标并直达列表页', () => {
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '容量环' } })
    const loopCard = screen.getByRole('button', { name: /容量闭环/ })
    expect(loopCard).toHaveAttribute('data-space-coordinate', 'org_capacity_loops')
    // 详情页 [loopId] 无独立坐标：不出现任何其它容量坐标卡
    expect(document.querySelectorAll('[data-space-coordinate^="org_capacity"]')).toHaveLength(1)
    fireEvent.click(loopCard)
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/next/organization/resource-capacity-loops')
  })
})

// ---------------------------------------------------------------------------
describe('AI 同事意图直达（tasks 10.8，通道二）：组织规则 → 结果卡 → 自动跳转', () => {
  test('单项目上下文「打开组织资源池」：execute 仅携带 lens（零 projectId）→ 直达组织池', async () => {
    renderTopbar()
    await openPanelAndSend('打开组织资源池')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', { lens: 'org_resource_pool' }),
    )
    // 导航结果卡中文回显 + 无项目载体摘要（不出现「项目 null」）
    expect(screen.getByText('快捷规则匹配 · navigate_to_space')).toBeInTheDocument()
    const summary = await waitFor(() => document.querySelector('[data-navigate-summary]'))
    expect(summary?.textContent).toBe('已为你导航至组织资源池')
    expect(screen.getByText('组织资源池')).toBeInTheDocument()
    expect(document.querySelector('[data-navigate-path]')?.textContent).toBe(
      '/next/organization/resource-pool',
    )
    expect(document.querySelector('[data-navigate-project]')).toBeNull()
    expect(routerPush).toHaveBeenCalledWith('/next/organization/resource-pool')
  })

  test('「查看组织 OKR」：全域规则分发 → /next/organization/okrs（无项目 ID 拼接）', async () => {
    renderTopbar()
    await openPanelAndSend('查看组织 OKR')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', { lens: 'org_okrs' }),
    )
    expect(document.querySelector('[data-navigate-path]')?.textContent).toBe(
      '/next/organization/okrs',
    )
    expect(routerPush).toHaveBeenCalledWith('/next/organization/okrs')
  })

  test('「去技能矩阵」：global_skill_matrix 规则分发 → /next/resources/skill-matrix', async () => {
    renderTopbar()
    await openPanelAndSend('去技能矩阵')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', {
        lens: 'global_skill_matrix',
      }),
    )
    expect(document.querySelector('[data-navigate-path]')?.textContent).toBe(
      '/next/resources/skill-matrix',
    )
    expect(routerPush).toHaveBeenCalledWith('/next/resources/skill-matrix')
  })

  test('全域视图（角色首页，无项目上下文）唤起组织规则：正常分发不抛上下文缺失', async () => {
    navMocks.pathname = '/next'
    renderTopbar()
    await openPanelAndSend('打开组织资源池')

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('navigate_to_space', { lens: 'org_resource_pool' }),
    )
    expect(routerPush).toHaveBeenCalledWith('/next/organization/resource-pool')
    // 无 ContextMissingError 引导文案（组织规则为全域导航，不要求项目上下文）
    expect(screen.queryByText(/需要项目环境/)).not.toBeInTheDocument()
  })
})
