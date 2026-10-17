/**
 * v3-ui-next-resource-team-domains W4 · tasks 4.8 —— 精确档视觉降级、三态完备性
 * 与只读零写验证测试（资源/成员/文件三域页面级 + 全局伪后端）。
 *
 * 覆盖（design §7「沉浸阶梯与三态闭环」/ spec「精确档仪器感降级与系统状态完备性」）：
 * - precise 档（useNextTrackStore.immersionTier='precise' + html[data-immersion] 同步）：
 *   三域工作台根节点停用 .nx-space-atmosphere 深空光晕、纯色 --nx-workspace-bg 实底、
 *   1px 发丝线面板（页头/面板统一 border-[var(--nx-border-hairline)]）、子树零发光滤镜类、
 *   加载骨架在数据就绪后归零（动画元素不再驻留）；
 * - immersive 对照：同页根节点消费 .nx-space-atmosphere（证明 precise 确实切换）；
 * - 三态闭环：项目数据在途 → 骨架屏（role=status + aria-busy，空态零闪现）；
 *   数据为空 → 语义化空态（文件库空态 / 紧凑负荷 HUD 空态）；项目接口 500 →
 *   规范错误卡 + 「重新载入」重试成功闭环；
 * - 负载分析面板高频交互（切换视图 / 悬停行 / 点击图表馆直达链接）网络监控严苛断言
 *   写请求严格为 0（RL-01 纯只读）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import ProjectResourcesDomainPage from '@/app/(next)/next/projects/[id]/resources/page'
import ProjectMembersDomainPage from '@/app/(next)/next/projects/[id]/members/page'
import ProjectFilesDomainPage from '@/app/(next)/next/projects/[id]/files/page'
import type { Project } from '@/lib/api/projects'
import type { ResourceLoadItem } from '@/lib/api/resources'

// ---------------------------------------------------------------------------
// next/navigation / next/link mock
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeLoadItem(resourceId: number, resourceName: string): ResourceLoadItem {
  return {
    resourceId,
    resourceName,
    role: 'member',
    dailyCapacityHours: 8,
    days: Array.from({ length: 10 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      totalAllocatedPercent: 0,
      capacityHours: 8,
      allocatedHours: 8,
    })),
    overallUtilizationPercent: 100,
  }
}

// ---------------------------------------------------------------------------
// 伪后端（资源/成员/文件全端点 + 门控形态）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function paginated(data: unknown[]) {
  return { data, meta: { total: data.length, page: 1, perPage: 100, totalPages: 1 } }
}

type RouteFn = (path: string, method: string) => Response | null

interface BackendOptions {
  domains: Array<'resources' | 'members' | 'files'>
  /** true：GET /projects/42 返回 500（错误态可重试）。 */
  failProject?: boolean
  /** true：空数据形态（附件/文档/负荷全空）。 */
  empty?: boolean
  /** 门控项目响应（骨架测试用；resolve 后返回 200）。 */
  projectGate?: { promise: Promise<void> }
}

function createBackend(options: BackendOptions): RouteFn {
  let projectRequests = 0
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      projectRequests += 1
      if (options.failProject && projectRequests === 1) {
        return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: 'boom' } })
      }
      if (options.projectGate) {
        const gated = jsonResponse(200, { data: makeProject() })
        gated.json = async () => {
          await options.projectGate?.promise
          return { data: makeProject() }
        }
        return gated
      }
      return jsonResponse(200, { data: makeProject() })
    }
    if (method !== 'GET') return null
    if (options.domains.includes('resources')) {
      if (/^\/projects\/42\/resources(\?|$)/.test(path)) {
        return jsonResponse(
          200,
          options.empty
            ? paginated([])
            : paginated([{ id: 1, projectId: 42, name: '张工', resourceType: 'human' }]),
        )
      }
      if (/^\/projects\/42\/resources\/load(\?|$)/.test(path)) {
        return jsonResponse(200, {
          data: {
            from: '2026-08-01',
            to: '2026-08-30',
            resources: options.empty ? [] : [makeLoadItem(1, '张工'), makeLoadItem(3, '李四')],
            teamAverageUtilizationPercent: options.empty ? 0 : 100,
          },
        })
      }
      if (/^\/projects\/42\/tasks(\?|$)/.test(path)) {
        return jsonResponse(200, paginated([]))
      }
    }
    if (options.domains.includes('members')) {
      if (path === '/projects/42/members') {
        return jsonResponse(200, { data: [] })
      }
      if (path === '/projects/42/roles') {
        return jsonResponse(200, { data: [] })
      }
    }
    if (options.domains.includes('files')) {
      if (path === '/projects/42/attachments') {
        return jsonResponse(200, paginated([]))
      }
      if (/^\/projects\/42\/files(\?|$)/.test(path)) {
        return jsonResponse(200, paginated([]))
      }
    }
    return null
  }
}

function installFetchRouter(route: RouteFn): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

/** 断言子树内不存在光晕/发光/渐变滤镜类（RL-15 精确档纯色降级）。 */
function expectNoGlowWithin(root: Element | null) {
  expect(root).not.toBeNull()
  const glowNodes = root?.querySelectorAll(
    '.nx-space-atmosphere, [class*="shadow-"], [class*="backdrop-"]',
  )
  expect(glowNodes).toHaveLength(0)
}

function expectHairlineBorder(node: Element | null) {
  expect(node?.className.toString()).toContain('border-[var(--nx-border-hairline)]')
}

/** 节点内至少一个子元素呈现 1px 发丝线面板（页头本体为 flex 无边框，边框在其子卡）。 */
function expectHairlineWithin(node: Element | null | undefined) {
  expect(node).not.toBeNull()
  expect(node?.querySelector('[class*="border-[var(--nx-border-hairline)]"]')).not.toBeNull()
}

const DOMAIN_PAGE: Record<'resources' | 'members' | 'files', React.ReactNode> = {
  resources: <ProjectResourcesDomainPage />,
  members: <ProjectMembersDomainPage />,
  files: <ProjectFilesDomainPage />,
}

const DOMAIN_WORKSPACE_MARKER: Record<'resources' | 'members' | 'files', string> = {
  resources: '[data-project-resources-workspace]',
  members: '[data-members-workspace]',
  files: '[data-files-workspace-space]',
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
  setAuth(['project:view', 'resource:view', 'file:view'])
})

afterEach(() => {
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
describe('精确档（precise）：光晕剥离、发丝线纯色面板、动画归零（spec 场景）', () => {
  const domainCases: Array<{ domain: 'resources' | 'members' | 'files'; perms: string[] }> = [
    { domain: 'resources', perms: ['project:view', 'resource:view'] },
    { domain: 'members', perms: ['project:view'] },
    { domain: 'files', perms: ['project:view', 'file:view'] },
  ]

  for (const item of domainCases) {
    test(`${item.domain} 域：precise 档根节点停用 nx-space-atmosphere、纯色实底、发丝线面板、子树零光晕`, async () => {
      setAuth(item.perms)
      useNextTrackStore.setState({ immersionTier: 'precise' })
      installFetchRouter(createBackend({ domains: [item.domain], empty: item.domain === 'files' }))
      const view = renderWithClient(DOMAIN_PAGE[item.domain])

      await waitFor(() =>
        expect(document.querySelector(DOMAIN_WORKSPACE_MARKER[item.domain]!)).not.toBeNull(),
      )
      // 沉浸档同步到 html（useImmersionTier effect）
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
      const root = document.querySelector(DOMAIN_WORKSPACE_MARKER[item.domain]!)
      expect(root?.className.toString()).not.toContain('nx-space-atmosphere')
      expect(root?.className.toString()).toContain('bg-[var(--nx-workspace-bg)]')
      expectHairlineBorder(root)
      // 页头（功能域通用页头）内子卡均为发丝线纯色仪器面板
      const header = root?.querySelector('[data-domain-header]')
      expect(header).not.toBeNull()
      expectHairlineWithin(header)
      // 子树零发光/渐变滤镜类（光晕彻底剥离）
      expectNoGlowWithin(root)

      // 数据就绪后骨架动画元素归零（不驻留任何 pulse 占位）
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(root?.querySelector('.animate-pulse')).toBeNull()
      await act(async () => {
        view.unmount()
      })
    })
  }

  test('immersive 对照：同域根节点消费 .nx-space-atmosphere（证明 precise 确实切换）', async () => {
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    installFetchRouter(createBackend({ domains: ['resources'] }))
    renderWithClient(<ProjectResourcesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    const root = document.querySelector('[data-project-resources-workspace]')
    expect(root?.className.toString()).toContain('nx-space-atmosphere')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')
  })

  test('precise 档紧凑负荷面板：纯色降级 + 发丝线 + 成员行数据语义完整', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    installFetchRouter(createBackend({ domains: ['resources'] }))
    renderWithClient(<ProjectResourcesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-resource-tab="load"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-load-compact]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(2))
    const hud = document.querySelector('[data-resource-load-compact]')
    expect(hud?.className.toString()).toContain('bg-[var(--nx-workspace-bg)]')
    expect(hud?.className.toString()).not.toContain('nx-space-atmosphere')
    expectHairlineBorder(hud)
    expectNoGlowWithin(hud)
  })
})

// ---------------------------------------------------------------------------
describe('三态完备性：骨架屏 / 语义化空态 / 500 错误重试（spec 场景）', () => {
  test('资源域项目在途：整体骨架 aria-busy，空态与工作台零闪现', async () => {
    let resolveProject!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveProject = resolve
    })
    installFetchRouter(createBackend({ domains: ['resources'], projectGate: { promise: gate } }))
    renderWithClient(<ProjectResourcesDomainPage />)

    const skeleton = document.querySelector('[data-project-space-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-project-resources-workspace]')).toBeNull()
    expect(screen.queryByText('当前项目暂无资源')).toBeNull()

    resolveProject()
    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
  })

  test('文件域空态：附件与文档均为空时呈现语义化空态引导，无表格行残留', async () => {
    installFetchRouter(createBackend({ domains: ['files'], empty: true }))
    renderWithClient(<ProjectFilesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-files-workspace-space]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelector('[data-file-list-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目暂无交付物与附件')).toBeInTheDocument()
    expect(document.body.textContent).toContain('选择文件上传首个交付物')
    await waitFor(() =>
      expect(document.querySelector('[data-file-documents-empty]')).not.toBeNull(),
    )
    expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(0)
  })

  test('资源域负荷面板空态：无团队成员负荷数据时呈现语义空态卡', async () => {
    installFetchRouter(createBackend({ domains: ['resources'], empty: true }))
    renderWithClient(<ProjectResourcesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-resource-tab="load"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-load-compact-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目暂无团队成员负荷数据')).toBeInTheDocument()
  })

  test('资源域项目接口 500：规范错误卡 → 「重新载入」重试成功闭环', async () => {
    const { records } = installFetchRouter(
      createBackend({ domains: ['resources'], failProject: true }),
    )
    renderWithClient(<ProjectResourcesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="error"]')).not.toBeNull(),
    )
    expect(screen.getByText('项目加载失败')).toBeInTheDocument()
    const retry = document.querySelector('[data-project-space-retry]')
    expect(retry).not.toBeNull()

    fireEvent.click(retry as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-project-space-empty="error"]')).toBeNull()
    // 项目 GET 恰为两轮（首败 + 重试成功）
    expect(records.filter((record) => record.url === '/projects/42')).toHaveLength(2)
    expect(writeMethods(records)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('负载分析面板高频交互：网络写请求严格为 0（RL-01 纯只读）', () => {
  test('切换视图 / 悬停负荷行 / 点击图表馆直达链接全流程零 POST/PATCH/DELETE', async () => {
    setAuth(['project:view', 'resource:view'])
    const { records } = installFetchRouter(createBackend({ domains: ['resources'] }))
    renderWithClient(<ProjectResourcesDomainPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(1))

    // 进入负载分析面板（按需挂载后才发 load GET）
    fireEvent.click(document.querySelector('[data-resource-tab="load"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-load-compact]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(2))
    expect(screen.getByText('团队负荷 · 紧凑 HUD')).toBeInTheDocument()

    // 高频只读交互：反复切视图（List ↔ Load）+ 悬停成员行 + 点击行内信息
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(document.querySelector('[data-resource-tab="list"]') as Element)
      fireEvent.click(document.querySelector('[data-resource-tab="load"]') as Element)
      await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(2))
      const firstRow = document.querySelector('[data-load-member="1"]')
      expect(firstRow).not.toBeNull()
      fireEvent.mouseOver(firstRow as Element)
      fireEvent.mouseMove(firstRow as Element)
      expect(document.querySelectorAll('[data-load-badge]').length).toBeGreaterThanOrEqual(2)
    }

    // 点击「进入图表馆深度分析」→ 纯客户端路由跳转（零写请求）
    fireEvent.click(document.querySelector('[data-load-compact-deep-link]') as Element)
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/resource-load')

    await new Promise((resolve) => setTimeout(resolve, 30))
    // 严苛断言：全程无任何写方法请求（RL-01）
    expect(writeMethods(records)).toEqual([])
  })
})
