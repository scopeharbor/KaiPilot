/**
 * v3-triz-contradiction-copilot W6 · tasks 6.1/6.2 —— 两处承载的挂载完整性用例。
 *
 * 逐条对应挂载裁定（design D11 方式 ② / D17 ①②）：
 * - 角色首页：`[data-role-home]` 内、`<RoleSuggestionCards />` **之后**追加
 *   `[data-role-signal-queue]`；骨架卡槽 DOM 零改动；无 QueryClient 环境零痕迹零抛错；
 * - 项目空间：成功态分支内在 `<ProjectTimelineBar />` 之后、首个镜头槽条件分支之前
 *   挂 `[data-project-space-signal-slot]`，六镜头下均可见；
 *   骨架 / 中性 404 / 错误三个早退分支零信号痕迹、零信号请求、卡区非覆盖式
 *   （不 fixed / 不绝对定位、不压 `[data-project-space-lens-slot]`）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RoleHomeContainer } from '@/components/next/home/RoleHomeContainer'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { useAuthStore } from '@/stores/auth-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import {
  API_PREFIX,
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  type RequestRecord,
} from './helpers/chart-gallery-network'
import {
  makeHighSignal,
  makeSignal,
  makeSignalRouter,
  type SignalRouterOptions,
} from './helpers/project-signals-fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/projects/101',
  useParams: () => ({ id: '101' }),
  useSearchParams: () => new URLSearchParams(),
}))

const PROJECT_ID = 101

function setAuth(overrides: Record<string, unknown> = {}) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['project:view', 'task:view', 'risk:view', 'ai:trigger'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
    ...overrides,
  })
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function signalRequests(records: RequestRecord[]): string[] {
  return records.filter((record) => /\/signals/.test(record.url)).map((record) => record.url)
}

beforeEach(() => {
  resetFetchRouter()
  setAuth()
  useNextAiColleagueStore.setState({ isOpen: false, messages: [], executionState: 'idle' })
})

const HIGH_SIGNAL_OPTIONS: SignalRouterOptions = {
  signalsByProject: { 101: [makeHighSignal({ id: 201 })] },
}

describe('挂载完整性（W6 承载位置裁定）', () => {
  test('项目空间成功态：信号区在时间主轴之后、镜头槽之前，且镜头槽不在信号区内部', async () => {
    const records = installFetchRouter(makeSignalRouter(HIGH_SIGNAL_OPTIONS)).records
    const { container } = renderWithClient(<ProjectSpaceContainer projectId={PROJECT_ID} />)

    await screen.findByText('开项核心引擎')
    await screen.findByText('风险/缺陷突变')

    const timeline = container.querySelector('[data-timeline-bar]') as HTMLElement
    const slot = container.querySelector('[data-project-space-signal-slot]') as HTMLElement
    const lensSlot = container.querySelector('[data-project-space-lens-slot]') as HTMLElement
    expect(timeline).not.toBeNull()
    expect(slot).not.toBeNull()
    expect(lensSlot).not.toBeNull()
    expect(slot.getAttribute('aria-label')).toBe('项目信号区域')
    // 主轴 → 信号区 → 镜头槽（文档顺序）
    expect(timeline.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(slot.compareDocumentPosition(lensSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 非覆盖式：信号区不包裹镜头工作面，也不使用浮层定位
    expect(slot.contains(lensSlot)).toBe(false)
    expect(slot.className).not.toMatch(/(^|\s)fixed(\s|$)/)
    expect(slot.className).not.toMatch(/(^|\s)absolute(\s|$)/)
    // 低打扰：挂载本身不弹窗、不自动打开面板
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
    expect(signalRequests(records).length).toBeGreaterThan(0)
  })

  test('项目空间六镜头下信号区均可见（不随镜头切换消失）', async () => {
    installFetchRouter(makeSignalRouter(HIGH_SIGNAL_OPTIONS))
    renderWithClient(<ProjectSpaceContainer projectId={PROJECT_ID} />)
    await screen.findByText('开项核心引擎')

    for (const lens of ['gantt', 'wbs', 'list', 'calendar', 'timeline', 'kanban']) {
      const trigger = document.querySelector(`[data-lens-trigger="${lens}"]`) as HTMLElement
      expect(trigger).not.toBeNull()
      fireEvent.click(trigger)
      await waitFor(() => {
        expect(document.querySelector('[data-project-space-lens-slot]')).not.toBeNull()
      })
      expect(document.querySelector('[data-project-space-signal-slot]')).not.toBeNull()
    }
  })

  test('项目空间加载骨架态：零信号痕迹、零信号请求', async () => {
    const records: RequestRecord[] = []
    const router = makeSignalRouter(HIGH_SIGNAL_OPTIONS)
    // 项目详情永不落定 → 停留在骨架态（其余端点照常路由）。
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      records.push({ method, url: rawUrl })
      const path = rawUrl.replace(API_PREFIX, '')
      if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
        return new Promise<Response>(() => {})
      }
      return (
        router(path, method) ??
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
      )
    })

    const { container } = renderWithClient(<ProjectSpaceContainer projectId={PROJECT_ID} />)

    await waitFor(() => {
      expect(container.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    })
    expect(container.querySelector('[data-project-space-signal-slot]')).toBeNull()
    expect(container.querySelector('[data-project-signal-card]')).toBeNull()
    expect(signalRequests(records)).toHaveLength(0)
  })

  test('项目空间中性 404 态：零信号痕迹、零信号请求', async () => {
    const records = installFetchRouter(
      makeSignalRouter({ ...HIGH_SIGNAL_OPTIONS, projectDetailStatus: 404 }),
    ).records
    const { container } = renderWithClient(<ProjectSpaceContainer projectId={PROJECT_ID} />)

    await waitFor(() => {
      expect(container.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-project-space-signal-slot]')).toBeNull()
    expect(signalRequests(records)).toHaveLength(0)
  })

  test('项目空间错误态：零信号痕迹、零信号请求', async () => {
    const records = installFetchRouter(
      makeSignalRouter({ ...HIGH_SIGNAL_OPTIONS, projectDetailStatus: 500 }),
    ).records
    const { container } = renderWithClient(<ProjectSpaceContainer projectId={PROJECT_ID} />)

    await waitFor(() => {
      expect(container.querySelector('[data-project-space-empty="error"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-project-space-signal-slot]')).toBeNull()
    expect(signalRequests(records)).toHaveLength(0)
  })

  test('角色首页：队列追加在建议卡槽之后，骨架卡槽内容零改动', async () => {
    installFetchRouter(
      makeSignalRouter({
        signalsByProject: { 101: [makeSignal({ id: 12, projectId: 101 })], 102: [] },
      }),
    )
    const { container } = renderWithClient(<RoleHomeContainer />)

    await screen.findByText('进度偏差')
    const home = container.querySelector('[data-role-home]') as HTMLElement
    const cards = container.querySelector('[data-role-suggestion-cards]') as HTMLElement
    const queue = container.querySelector('[data-role-signal-queue]') as HTMLElement
    expect(home.contains(cards)).toBe(true)
    expect(home.contains(queue)).toBe(true)
    expect(cards.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 态势建议卡槽：三个槽位与真实态势建议文案
    expect(container.querySelectorAll('[data-role-suggestion-slot]')).toHaveLength(3)
    expect(cards.textContent).toContain('AI 态势感知建议')
  })

  test('角色首页无 QueryClient 环境：零信号痕迹、零抛错（既有静态用例兼容）', async () => {
    const records = installFetchRouter(
      makeSignalRouter({ signalsByProject: { 101: [], 102: [] } }),
    ).records
    const { container } = render(<RoleHomeContainer />)

    expect(screen.getByText('你好，王启明')).toBeInTheDocument()
    expect(container.querySelector('[data-role-home]')).not.toBeNull()
    expect(container.querySelector('[data-role-signal-queue]')).toBeNull()
    expect(records).toHaveLength(0)
  })

  test('角色首页认证水合前：骨架态且零信号请求', async () => {
    setAuth({ hasHydrated: false, isAuthenticated: false, user: null, currentOrganizationId: null })
    const records = installFetchRouter(
      makeSignalRouter({ signalsByProject: { 101: [], 102: [] } }),
    ).records
    const { container } = renderWithClient(<RoleHomeContainer />)

    expect(container.querySelector('[data-role-home]')?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('[data-role-signal-queue]')).toBeNull()
    expect(records).toHaveLength(0)
  })
})
