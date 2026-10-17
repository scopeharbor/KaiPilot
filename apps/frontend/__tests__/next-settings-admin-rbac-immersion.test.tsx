/**
 * v3-ui-next-settings-admin-domains W9 · tasks 9.11 —— 设置 / 管理后台 / 项目设置域
 * RBAC 门禁矩阵、RL-05 中性 404、精确档降级与三态闭环集成测试
 * （spec「管理后台门户与平台治理控制台」/「项目设置（工作日历）」+ RL-05 / RL-06 / RL-15）。
 *
 * 与各 W 页级装配测试互补：本文件以统一夹具对四类代表页做矩阵化收口断言——
 * - 权限矩阵：无准入权限时渲染受限横幅（`data-permission-fallback`）且底层业务接口
 *   零请求（RL-06）；管理后台门户无任何控制台权限时渲染中性受限页且不泄露控制台清单
 *   （RL-05 / D-ADM）；
 * - RL-05：项目 999（后端 404）与跨组织项目统一渲染中性「项目不存在或已被移除」，
 *   零 403 存在性泄露，且工作日历端点零请求（防探测）；
 * - 沉浸阶梯 RL-15：precise 档门户根节点剥离 `.nx-space-atmosphere`、纯色实底 + 1px
 *   发丝线，immersive 档同节点保留氛围光晕（证明档位确实切换）；
 * - 三态完备性（项目设置页代表页）：骨架屏 role=status + aria-busy（悬空 promise 门控，
 *   工作区与空态零闪现）/ 5xx 错误卡 → 「重新载入」重试成功闭环。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import NextAdminPortalPage from '@/app/(next)/next/admin/page'
import NextAdminUsersPage from '@/app/(next)/next/admin/users/page'
import OrganizationSettingsPage from '@/app/(next)/next/settings/organization/page'
import ProjectSettingsDomainPage from '@/app/(next)/next/projects/[id]/settings/page'
import type { Project } from '@/lib/api/projects'
import type { WorkingCalendarSettings } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock（项目 ID 可换）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: { id: '42' } as Record<string, string>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/settings',
  useParams: () => navMock.params,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 网络夹具
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

/** 门控响应：fetch 立即返回但 json 解析挂起 → 查询保持 pending（骨架阶段可断言）。 */
function gatedResponse(body: unknown, gate: Promise<void>): Response {
  const response = jsonResponse(200, body)
  response.json = async () => {
    await gate
    return body
  }
  return response
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
  /** 首次项目请求强制失败一次（三态重试闭环）。 */
  failProjectOnce?: boolean
  /** 项目请求以挂起 json 门控（骨架阶段断言）。 */
  projectGate?: Promise<void>
}

function installBackend(records: RequestRecord[], options: BackendOptions = {}) {
  let projectAttempts = 0
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })

    if (method === 'GET' && path === `/projects/${navMock.params.id}`) {
      projectAttempts += 1
      if (options.failProjectOnce && projectAttempts === 1) {
        return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '服务暂不可用' } })
      }
      if (options.projectGate) {
        return gatedResponse(
          { data: options.project ?? makeProject({ id: Number(navMock.params.id) }) },
          options.projectGate,
        )
      }
      if (options.projectStatus && options.projectStatus >= 400) {
        return jsonResponse(options.projectStatus, {
          error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在' },
        })
      }
      return jsonResponse(200, {
        data: options.project ?? makeProject({ id: Number(navMock.params.id) }),
      })
    }
    if (path === `/projects/${navMock.params.id}/working-calendar`) {
      return jsonResponse(200, { data: CALENDAR })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

/** 纯记账桩：受限页断言使用（任何请求都是失败）。 */
function installRecordingFetch(): RequestRecord[] {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    records.push({ method: (init?.method ?? 'GET').toUpperCase(), url: rawUrl })
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '本测试不应发起任何请求' } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '组织成员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'member' }],
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

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  navMock.params = { id: '42' }
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  setAuth(['task:view'])
})

afterEach(() => {
  act(() => {
    useNextTrackStore.setState({ immersionTier: null })
  })
  document.documentElement.removeAttribute('data-immersion')
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// RBAC 门禁矩阵：受限横幅 + 零请求（RL-06）
// ---------------------------------------------------------------------------
describe('RBAC 门禁矩阵：无准入权限 → 受限横幅且底层接口零请求（RL-06）', () => {
  test('/next/settings/organization：无 org:view → 受限横幅且零请求', async () => {
    setAuth(['project:view'])
    const records = installRecordingFetch()
    renderPage(<OrganizationSettingsPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.body.textContent).toContain('你没有查看组织设置的权限')
    expect(document.querySelector('[data-org-no-organization]')).toBeNull()
    await act(async () => {
      await settle()
    })
    expect(records).toHaveLength(0)
  })

  test('/next/admin：无任何控制台权限 → 中性受限页且零请求', async () => {
    const records = installRecordingFetch()
    renderPage(<NextAdminPortalPage />)

    expect(document.querySelector('[data-admin-landing-restricted]')).not.toBeNull()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-admin-console]')).toBeNull()
    await act(async () => {
      await settle()
    })
    expect(records).toHaveLength(0)
  })

  test('/next/admin/users：无 system:admin → 受限横幅且零请求', async () => {
    setAuth(['project:view', 'org:view', 'audit:view'])
    const records = installRecordingFetch()
    renderPage(<NextAdminUsersPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.body.textContent).toContain('你没有查看用户管理的权限')
    expect(document.querySelector('[data-admin-users-search]')).not.toBeNull()
    await act(async () => {
      await settle()
    })
    expect(records).toHaveLength(0)
  })

  test('/next/projects/42/settings：无 project:view → 受限横幅且零请求', async () => {
    const records = installRecordingFetch()
    renderPage(<ProjectSettingsDomainPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.body.textContent).toContain('你没有查看该项目设置的权限')
    expect(document.querySelector('[data-project-settings-workspace]')).toBeNull()
    expect(document.querySelector('[data-project-space-empty="not_found"]')).toBeNull()
    await act(async () => {
      await settle()
    })
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// RL-05：中性 404（不存在 / 跨组织）
// ---------------------------------------------------------------------------
describe('RL-05：不存在与跨组织项目统一中性 404（零 403 泄露）', () => {
  test('项目 999（后端 404）→ 中性「项目不存在或已被移除」，无 403 字样且工作日历零请求', async () => {
    setAuth(['project:view', 'project:update'])
    navMock.params = { id: '999' }
    const { records } = installBackend([], { projectStatus: 404 })
    renderPage(<ProjectSettingsDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull(),
    )
    const body = document.body.textContent ?? ''
    expect(body).toContain('项目不存在或已被移除')
    expect(body).not.toContain('403')
    expect(body).not.toContain('无权')
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(records.some((record) => record.url.includes('working-calendar'))).toBe(false)
  })

  test('跨组织项目（orgMismatch）→ 同一中性 404 文案，工作日历端点零请求', async () => {
    setAuth(['project:view', 'project:update'], 2)
    const { records } = installBackend([])
    renderPage(<ProjectSettingsDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('项目不存在或已被移除')
    expect(document.body.textContent).not.toContain('403')
    expect(records.some((record) => record.url.includes('working-calendar'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 沉浸阶梯：precise 降级 / immersive 对照（RL-15）
// ---------------------------------------------------------------------------
describe('沉浸阶梯 RL-15：precise 档剥离氛围光晕（immersive 对照）', () => {
  test('precise：管理后台门户根节点停用 nx-space-atmosphere，纯色实底 + 1px 发丝线', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    setAuth(['system:admin'])
    renderPage(<NextAdminPortalPage />)

    const root = document.querySelector('[data-admin-landing]')
    expect(root).not.toBeNull()
    const classes = root?.className.toString() ?? ''
    expect(classes).not.toContain('nx-space-atmosphere')
    expect(classes).toContain('bg-[var(--nx-workspace-bg)]')
    expect(classes).toContain('border-[var(--nx-border-hairline)]')
    expect(root?.querySelectorAll('.nx-space-atmosphere')).toHaveLength(0)
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
  })

  test('precise：用户管理控制台根节点同样纯色化（无光晕、发丝线面板）', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    setAuth(['system:admin'])
    const { records } = installBackend([])
    renderPage(<NextAdminUsersPage />)

    const root = document.querySelector('[data-admin-users]')
    expect(root).not.toBeNull()
    const classes = root?.className.toString() ?? ''
    expect(classes).not.toContain('nx-space-atmosphere')
    expect(classes).toContain('bg-[var(--nx-workspace-bg)]')
    expect(classes).toContain('border-[var(--nx-border-hairline)]')
    expect(root?.getAttribute('data-immersion')).toBe('precise')
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })

  test('immersive 对照：同一门户根节点消费 nx-space-atmosphere（证明档位确实切换）', async () => {
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    setAuth(['system:admin'])
    const first = renderPage(<NextAdminPortalPage />)

    const immersiveClasses =
      document.querySelector('[data-admin-landing]')?.className.toString() ?? ''
    expect(immersiveClasses).toContain('nx-space-atmosphere')
    expect(immersiveClasses).not.toContain('bg-[var(--nx-workspace-bg)]')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')

    await act(async () => {
      first.unmount()
    })

    // 切回 precise：重挂后同节点即刻剥离光晕
    await act(async () => {
      useNextTrackStore.setState({ immersionTier: 'precise' })
    })
    renderPage(<NextAdminPortalPage />)
    expect(
      document.querySelector('[data-admin-landing]')?.className.toString() ?? '',
    ).not.toContain('nx-space-atmosphere')
  })
})

// ---------------------------------------------------------------------------
// 三态闭环（项目设置页代表页）：骨架 / 错误重试
// ---------------------------------------------------------------------------
describe('三态闭环（项目设置页）：骨架 aria-busy 与 5xx 重试成功', () => {
  test('项目接口挂起：骨架屏 role=status + aria-busy，工作区与中性空态零闪现', async () => {
    setAuth(['project:view', 'project:update'])
    let resolveGate!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    installBackend([], { projectGate: gate })
    renderPage(<ProjectSettingsDomainPage />)

    const skeleton = document.querySelector('[data-project-space-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-project-settings-workspace]')).toBeNull()
    expect(document.querySelector('[data-project-space-empty="not_found"]')).toBeNull()
    expect(document.querySelector('[data-project-space-empty="error"]')).toBeNull()

    await act(async () => {
      resolveGate()
    })
    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-project-space-skeleton]')).toBeNull()
    expect(screen.getByText('开项核心引擎 · 项目设置')).toBeInTheDocument()
  })

  test('项目接口 500：错误卡 + 「重新载入」重试成功闭环', async () => {
    setAuth(['project:view', 'project:update'])
    const { records } = installBackend([], { failProjectOnce: true })
    renderPage(<ProjectSettingsDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="error"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-project-space-retry]')).not.toBeNull()
    expect(screen.getByText('项目加载失败')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-project-space-empty="error"]')).toBeNull()
    // 重试后工作日历端点正常加载（三态闭环落到可用工作区）
    await waitFor(() =>
      expect(records.some((record) => record.url.includes('working-calendar'))).toBe(true),
    )
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })
})
