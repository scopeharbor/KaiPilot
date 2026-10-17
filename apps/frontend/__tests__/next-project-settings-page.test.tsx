/**
 * v3-ui-next-settings-admin-domains W8 · tasks 8.4 —— 项目设置页装配测试
 * （真实页面路由 + 全局伪后端）。
 *
 * 覆盖（spec「项目设置（工作日历）」路由与入口条款 / RL-05 / RL-06）：
 * - 页装配与 DomainPageHeader 面包屑注册（`项目名 · 项目设置`）与卸载清理；
 * - 「返回项目工作面」按钮路由回 `/next/projects/:id`；
 * - 非法/非数字项目 ID 直接中性 404 且零网络请求；
 * - 跨租户项目 ID 中性 404（零 403 存在性泄露）；
 * - 无 project:view 权限：受限横幅渲染且底层接口零请求；
 * - 加载骨架屏（aria-busy）与错误重试闭环。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import ProjectSettingsDomainPage from '@/app/(next)/next/projects/[id]/settings/page'
import type { Project } from '@/lib/api/projects'
import type { WorkingCalendarSettings } from '@aiproj/types'

const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/settings',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

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

const CALENDAR: WorkingCalendarSettings = {
  version: 1,
  workdays: [1, 2, 3, 4, 5],
  holidays: ['2026-10-01'],
  extraWorkdays: [],
}

interface BackendOptions {
  project?: Project
  projectStatus?: number
  calendarStatus?: number
}

function installBackend(records: RequestRecord[], options: BackendOptions = {}) {
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    if (method === 'GET' && path === '/projects/42') {
      return options.projectStatus && options.projectStatus >= 400
        ? jsonResponse(options.projectStatus, {
            error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在' },
          })
        : jsonResponse(200, { data: options.project ?? makeProject() })
    }
    if (path === '/projects/42/working-calendar') {
      return options.calendarStatus && options.calendarStatus >= 400
        ? jsonResponse(options.calendarStatus, {
            error: { code: 'INTERNAL_ERROR', message: '服务暂不可用' },
          })
        : jsonResponse(200, { data: CALENDAR })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProjectSettingsDomainPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('页面装配与页头面包屑（tasks 8.3/8.4）', () => {
  test('页装配：骨架 → 工作区 + DomainPageHeader 注册「项目名 · 项目设置」', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([])
    renderPage()

    // 首帧骨架（项目未就绪）
    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()

    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-workspace]')).not.toBeNull(),
    )
    expect(screen.getByText('开项核心引擎 · 项目设置')).toBeInTheDocument()
    expect(document.querySelector('[data-domain-back]')).not.toBeNull()
    expect(useProjectSpaceEntityStore.getState().projectId).toBe(42)
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 项目设置')
    expect(records.some((record) => record.url === '/projects/42/working-calendar')).toBe(true)
  })

  test('点击「返回项目工作面」路由回 /next/projects/42', async () => {
    setAuth(['project:view', 'project:update'])
    installBackend([])
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-workspace]')).not.toBeNull(),
    )

    fireEvent.click(document.querySelector('[data-domain-back]')!)
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42')
  })

  test('卸载后 entity store 面包屑按 projectId 安全清理', async () => {
    setAuth(['project:view', 'project:update'])
    installBackend([])
    const view = renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-workspace]')).not.toBeNull(),
    )
    expect(useProjectSpaceEntityStore.getState().projectId).toBe(42)

    view.unmount()
    expect(useProjectSpaceEntityStore.getState().projectId).toBeNull()
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()
  })
})

describe('非法项目 ID 中性 404（RL-05，零发包）', () => {
  test.each(['abc', '-3', '0', '4.2'])('id=%s 渲染中性 404 且零网络请求', async (rawId) => {
    setAuth(['project:view', 'project:update'])
    paramsMock.value = { id: rawId }
    const { records } = installBackend([])
    renderPage()

    expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull()
    expect(document.body.textContent).toContain('项目不存在或已被移除')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })
})

describe('准入门禁与组织隔离（RL-05/RL-06）', () => {
  test('无 project:view：受限横幅渲染且底层接口零请求', async () => {
    setAuth(['task:view'])
    const { records } = installBackend([])
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.body.textContent).toContain('你没有查看该项目设置的权限')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(records).toHaveLength(0)
  })

  test('跨组织项目：中性 404 且工作日历端点零请求（绝不 403 泄露）', async () => {
    setAuth(['project:view', 'project:update'], 2)
    const { records } = installBackend([])
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull(),
    )
    expect(records.some((record) => record.url.includes('working-calendar'))).toBe(false)
  })

  test('HTTP 404 项目：中性空态（不区分不存在/跨租户）', async () => {
    setAuth(['project:view', 'project:update'])
    installBackend([], { projectStatus: 404 })
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull(),
    )
  })
})

describe('三态闭环（错误重试）', () => {
  test('项目接口 500：错误卡 + 「重新载入」按钮', async () => {
    setAuth(['project:view', 'project:update'])
    installBackend([], { projectStatus: 500 })
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="error"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-project-space-retry]')).not.toBeNull()
    expect(document.body.textContent).toContain('项目加载失败')
  })
})
