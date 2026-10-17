/**
 * v3-ui-next-org-portfolio-domains W1 · tasks 1.6 —— 组织概览布局编排编辑器测试
 * （spec「组织概览布局编排（个人与共享双作用域）」场景）。
 *
 * 覆盖：
 * - 模块隐藏/排序/密度交互与「未保存」脏标记、保存 payload（含 expectedVersion）；
 * - 预览（POST /dashboard/layouts/preview）触发且全程零保存写请求（RL-06）；
 * - 无 org:member:manage 时共享保存按钮物理隐藏且共享写请求零发出；
 * - 保存成功刷新 current layout 缓存（失效后重取），乐观锁版本推进后编辑态同步；
 * - 版本冲突（409 LAYOUT_VERSION_CONFLICT）警示 + 载入最新布局；
 * - 重置两步确认。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { OrgOverviewLayoutEditor } from '@/components/next/org-overview/OrgOverviewLayoutEditor'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
  type OrganizationDashboardLayout,
  type OrganizationDashboardLayoutDensity,
  type OrganizationDashboardLayoutPreviewResult,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '组织成员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

export interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (path: string, method: string, body: RequestRecord['body']) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

// ---------------------------------------------------------------------------
// 布局夹具
// ---------------------------------------------------------------------------
function makeLayout(
  overrides: Partial<OrganizationDashboardLayout> = {},
): OrganizationDashboardLayout {
  return {
    layoutId: 1,
    organizationId: 1,
    scope: 'personal',
    ownerActorId: 1,
    name: '我的概览布局',
    version: 1,
    isDefault: false,
    density: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
    modules: ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules.map((module) => ({ ...module })),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function defaultLayout(): OrganizationDashboardLayout {
  return makeLayout()
}

function makePreviewResult(
  payload: RequestRecord['body'],
): OrganizationDashboardLayoutPreviewResult {
  const density =
    (payload?.density as OrganizationDashboardLayoutDensity | undefined) ??
    ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE
  return {
    valid: true,
    layout: {
      density,
      modules: ((payload?.modules as unknown[]) ?? []) as never,
    },
    warnings: [],
    breakpointSnapshots: [
      {
        breakpoint: 'desktop',
        columnCount: 12,
        modules: ((payload?.modules as unknown[]) ?? []).map(() => ({
          moduleKey: 'identity',
          size: 'full',
          colSpan: 12,
          row: 1,
          col: 1,
        })),
      },
    ],
  }
}

function createBackend() {
  let current = defaultLayout()

  const route = (path: string, method: string, body: RequestRecord['body']): Response | null => {
    if (path === '/organizations/1/dashboard/layouts/current' && method === 'GET') {
      return jsonResponse(200, { data: { layout: current, warnings: [] } })
    }
    if (path === '/organizations/1/dashboard/layouts/preview' && method === 'POST') {
      return jsonResponse(200, { data: makePreviewResult(body) })
    }
    if (path === '/organizations/1/dashboard/layouts/personal' && method === 'POST') {
      const version = current.version + 1
      current = makeLayout({
        version,
        modules: (body?.modules as OrganizationDashboardLayout['modules']) ?? [],
        density: (body?.density as OrganizationDashboardLayout['density']) ?? 'comfortable',
      })
      return jsonResponse(200, { data: current })
    }
    if (path === '/organizations/1/dashboard/layouts/shared' && method === 'POST') {
      current = makeLayout({
        layoutId: 7,
        scope: 'shared',
        ownerActorId: null,
        version: current.version + 1,
        modules: (body?.modules as OrganizationDashboardLayout['modules']) ?? [],
        density: (body?.density as OrganizationDashboardLayout['density']) ?? 'comfortable',
      })
      return jsonResponse(200, { data: current })
    }
    if (path === '/organizations/1/dashboard/layouts/reset' && method === 'POST') {
      current = makeLayout({ scope: 'system', ownerActorId: null, version: current.version + 1 })
      return jsonResponse(200, { data: current })
    }
    return null
  }

  return { route, getCurrent: () => current }
}

function renderEditor(onClose: () => void = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <OrgOverviewLayoutEditor open onClose={onClose} />
    </QueryClientProvider>,
  )
  return { view, onClose }
}

async function waitForModuleRows(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelectorAll('[data-org-layout-module]').length).toBeGreaterThan(0)
  })
}

beforeEach(() => {
  setAuth(['org:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// 模块交互与保存（个人作用域）
// ---------------------------------------------------------------------------
describe('OrgOverviewLayoutEditor：模块显隐/排序/密度与个人保存', () => {
  test('隐藏模块 → 脏标记 → 保存个人布局：payload 携 expectedVersion 且成功后缓存刷新', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    const onClose = vi.fn()
    renderEditor(onClose)
    await waitForModuleRows()

    expect(document.querySelectorAll('[data-org-layout-module]')).toHaveLength(9)
    expect(document.querySelector('[data-org-layout-scope-info]')?.textContent).toContain('v1')

    // 初始未修改：保存禁用、无脏标记
    expect(document.querySelector('[data-org-layout-dirty]')).toBeNull()
    const savePersonal = document.querySelector(
      '[data-org-layout-save-personal]',
    ) as HTMLButtonElement
    expect(savePersonal.disabled).toBe(true)

    // 隐藏 status_distribution
    const hide = document.querySelector('[data-org-layout-hide="status_distribution"]')
    fireEvent.click(hide as Element)
    expect(document.querySelectorAll('[data-org-layout-module]')).toHaveLength(8)
    expect(document.querySelector('[data-org-layout-dirty]')).not.toBeNull()
    expect(savePersonal.disabled).toBe(false)

    fireEvent.click(savePersonal)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    const saveRecord = records.find(
      (record) => record.url === '/organizations/1/dashboard/layouts/personal',
    )
    expect(saveRecord?.method).toBe('POST')
    const modules = saveRecord?.body?.modules as Array<Record<string, unknown>>
    expect(modules).toHaveLength(8)
    expect(modules.some((module) => module.moduleKey === 'status_distribution')).toBe(false)
    expect(saveRecord?.body?.expectedVersion).toBe(1)

    // 保存成功失效布局缓存：current layout 被重新拉取（版本推进到 v2）
    await waitFor(() => {
      expect(
        records.filter((record) => record.url === '/organizations/1/dashboard/layouts/current')
          .length,
      ).toBeGreaterThanOrEqual(2)
    })
  })

  test('排序：下移首个模块交换行位；密度切换后保存 payload 携带 compact', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderEditor()
    await waitForModuleRows()

    const orderedKeys = () =>
      Array.from(document.querySelectorAll('[data-org-layout-module]')).map((node) =>
        node.getAttribute('data-org-layout-module'),
      )
    expect(orderedKeys()[0]).toBe('identity')

    // 下移 identity（与 kpi_strip 交换 row）
    fireEvent.click(document.querySelector('[data-org-layout-move-down="identity"]') as Element)
    expect(orderedKeys()[0]).toBe('kpi_strip')
    expect(orderedKeys()[1]).toBe('identity')

    // 切密度为紧凑
    fireEvent.click(document.querySelector('[data-org-layout-density="compact"]') as Element)
    expect(
      document.querySelector('[data-org-layout-density="compact"]')?.getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(document.querySelector('[data-org-layout-save-personal]') as Element)
    await waitFor(() => {
      const saveRecord = records.find(
        (record) => record.url === '/organizations/1/dashboard/layouts/personal',
      )
      expect(saveRecord).toBeDefined()
      expect(saveRecord?.body?.density).toBe('compact')
    })
    const modules = records.find(
      (record) => record.url === '/organizations/1/dashboard/layouts/personal',
    )?.body?.modules as Array<Record<string, unknown>>
    const identity = modules.find((module) => module.moduleKey === 'identity')
    const kpi = modules.find((module) => module.moduleKey === 'kpi_strip')
    expect(kpi?.row).toBeLessThan((identity?.row as number) ?? 0)
  })
})

// ---------------------------------------------------------------------------
// 预览（零写）与共享保存门禁
// ---------------------------------------------------------------------------
describe('OrgOverviewLayoutEditor：预览零写与共享保存门禁（RL-06）', () => {
  test('打开预览发出 POST /preview（无副作用端点），全程无保存写请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderEditor()
    await waitForModuleRows()

    fireEvent.click(document.querySelector('[data-org-layout-preview-toggle]') as Element)
    await waitFor(() => {
      expect(
        records.some((record) => record.url === '/organizations/1/dashboard/layouts/preview'),
      ).toBe(true)
    })
    expect(document.querySelector('[data-org-layout-preview-panel]')).not.toBeNull()
    await waitFor(() => {
      expect(document.querySelector('[data-org-layout-preview-panel]')?.textContent).toContain(
        '预览通过',
      )
    })

    // 继续编辑（隐藏模块）→ 预览 payload 变化再次请求；仍零保存写请求
    fireEvent.click(document.querySelector('[data-org-layout-hide="activity"]') as Element)
    await waitFor(() => {
      expect(
        records.filter((record) => record.url === '/organizations/1/dashboard/layouts/preview')
          .length,
      ).toBeGreaterThanOrEqual(2)
    })
    const saveWrites = records.filter((record) =>
      [
        '/organizations/1/dashboard/layouts/personal',
        '/organizations/1/dashboard/layouts/shared',
      ].includes(record.url),
    )
    expect(saveWrites).toHaveLength(0)
  })

  test('无 org:member:manage：共享保存按钮物理隐藏，保存个人时共享写请求零发出', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderEditor()
    await waitForModuleRows()

    expect(document.querySelector('[data-org-layout-save-shared]')).toBeNull()
    fireEvent.click(document.querySelector('[data-org-layout-hide="risk_reminders"]') as Element)
    fireEvent.click(document.querySelector('[data-org-layout-save-personal]') as Element)
    await waitFor(() => {
      expect(
        records.some((record) => record.url === '/organizations/1/dashboard/layouts/personal'),
      ).toBe(true)
    })
    expect(
      records.some((record) => record.url === '/organizations/1/dashboard/layouts/shared'),
    ).toBe(false)
  })

  test('具备 org:member:manage：共享保存按钮可见并可保存为组织共享布局', async () => {
    setAuth(['org:view', 'org:member:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    const onClose = vi.fn()
    renderEditor(onClose)
    await waitForModuleRows()

    const shared = document.querySelector('[data-org-layout-save-shared]')
    expect(shared).not.toBeNull()
    fireEvent.click(document.querySelector('[data-org-layout-hide="pmo_entry"]') as Element)
    fireEvent.click(shared as Element)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const sharedRecord = records.find(
      (record) => record.url === '/organizations/1/dashboard/layouts/shared',
    )
    expect(sharedRecord?.method).toBe('POST')
    expect(
      (sharedRecord?.body?.modules as Array<Record<string, unknown>>).some(
        (module) => module.moduleKey === 'pmo_entry',
      ),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 版本冲突与重置
// ---------------------------------------------------------------------------
describe('OrgOverviewLayoutEditor：版本冲突与重置', () => {
  test('409 版本冲突：展示警示并可载入最新布局（重新拉取 current）', async () => {
    let conflict = false
    const backend = createBackend()
    const base = backend.route
    const route = (path: string, method: string, body: RequestRecord['body']): Response | null => {
      if (conflict && path === '/organizations/1/dashboard/layouts/personal' && method === 'POST') {
        return jsonResponse(409, {
          error: {
            code: 'LAYOUT_VERSION_CONFLICT',
            message: '布局已被其他用户更新，请刷新后重试',
          },
        })
      }
      return base(path, method, body)
    }
    const { records } = installFetchRouter(route)
    renderEditor()
    await waitForModuleRows()

    // 制造修改并触发冲突保存
    fireEvent.click(document.querySelector('[data-org-layout-hide="activity"]') as Element)
    conflict = true
    fireEvent.click(document.querySelector('[data-org-layout-save-personal]') as Element)

    await waitFor(() =>
      expect(document.querySelector('[data-org-layout-version-conflict]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-org-layout-error]')?.textContent).toContain('版本冲突')
    // 编辑态保留（未保存标记仍在，模块未被清空）
    expect(document.querySelector('[data-org-layout-dirty]')).not.toBeNull()
    expect(document.querySelectorAll('[data-org-layout-module]')).toHaveLength(8)

    // 载入最新布局：失效缓存重新拉取 current 并清除冲突警示
    const currentGetsBefore = records.filter(
      (record) => record.url === '/organizations/1/dashboard/layouts/current',
    ).length
    fireEvent.click(document.querySelector('[data-org-layout-reload]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-org-layout-version-conflict]')).toBeNull(),
    )
    await waitFor(() => {
      expect(
        records.filter((record) => record.url === '/organizations/1/dashboard/layouts/current')
          .length,
      ).toBeGreaterThan(currentGetsBefore)
    })
  })

  test('重置两步确认：取消不发出请求，确认后 POST /reset 并同步回默认模块', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderEditor()
    await waitForModuleRows()

    // 先修改（脏态）
    fireEvent.click(document.querySelector('[data-org-layout-hide="activity"]') as Element)
    expect(document.querySelectorAll('[data-org-layout-module]')).toHaveLength(8)

    // 第一步：点重置出现确认/取消
    fireEvent.click(document.querySelector('[data-org-layout-reset]') as Element)
    expect(document.querySelector('[data-org-layout-reset-confirm]')).not.toBeNull()
    expect(document.querySelector('[data-org-layout-reset-cancel]')).not.toBeNull()
    expect(records.some((record) => record.url.endsWith('/layouts/reset'))).toBe(false)

    // 取消：确认态收起且零请求
    fireEvent.click(document.querySelector('[data-org-layout-reset-cancel]') as Element)
    expect(document.querySelector('[data-org-layout-reset-confirm]')).toBeNull()
    expect(records.some((record) => record.url.endsWith('/layouts/reset'))).toBe(false)

    // 再点重置并确认：POST /reset，版本推进后编辑态同步回默认九模块
    fireEvent.click(document.querySelector('[data-org-layout-reset]') as Element)
    fireEvent.click(document.querySelector('[data-org-layout-reset-confirm]') as Element)
    await waitFor(() => {
      expect(records.some((record) => record.url.endsWith('/layouts/reset'))).toBe(true)
    })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-org-layout-module]')).toHaveLength(9)
    })
    expect(document.querySelector('[data-org-layout-scope-info]')?.textContent).toContain(
      '系统默认',
    )
    await waitFor(() => expect(document.querySelector('[data-org-layout-dirty]')).toBeNull())
  })
})
