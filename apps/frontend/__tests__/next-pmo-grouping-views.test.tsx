/**
 * v3-ui-next-pmo-domain W3 · tasks 3.4 —— 分组视图页面装配、定义列表 CRUD 与
 * 保存对话框测试（页面级真实路由 + envelope 网络层探针）。
 *
 * 覆盖：
 * - 路由门禁：portfolio:view 授权装配 / 无权受限横幅零请求（RL-06）/
 *   orgId 未水合引导态零请求；
 * - 定义列表：系统预设/个人/组织共享分组渲染与默认徽标、行点击激活预览；
 * - 删除/复制/设默认：二次确认流与端点参数（DELETE/duplicate/set-default）；
 * - 保存对话框：名称必填校验、创建端点参数与成功后列表刷新、失败回显服务端错误；
 * - 无 portfolio:manage：全部写入口隐藏、交互过程零写请求（RL-06）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PmoGroupingViewsPage from '@/app/(next)/next/pmo/grouping-views/page'
import { useAuthStore } from '@/stores/auth-store'
import type { PmoGroupingViewDefinition } from '@aiproj/types'

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

// ─── Auth / 渲染基建 ────────────────────────────────────────────────────────────

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '组合管理员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoGroupingViewsPage />
    </QueryClientProvider>,
  )
}

// ─── 夹具 ────────────────────────────────────────────────────────────────────────

function makeView(
  overrides: Partial<PmoGroupingViewDefinition> & { id: string },
): PmoGroupingViewDefinition {
  const now = '2026-09-01T00:00:00.000Z'
  return {
    scope: 'personal',
    organizationId: 1,
    ownerUserId: 1,
    name: '视图',
    description: '视图描述',
    definitionVersion: 'grouping-view.v1',
    query: { primaryGrouping: 'status' },
    isDefault: false,
    capabilities: {
      canEdit: true,
      canDelete: true,
      canDuplicate: true,
      canSetDefault: true,
      canSetOrgDefault: false,
      isReadonly: false,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function systemByStatus(): PmoGroupingViewDefinition {
  return makeView({
    id: 'system-by-status',
    scope: 'system',
    ownerUserId: undefined,
    name: '按状态分组',
    description: '按项目状态（活跃/归档/暂停/草稿）查看组织组合分布',
    isDefault: false,
    capabilities: {
      canEdit: false,
      canDelete: false,
      canDuplicate: true,
      canSetDefault: false,
      canSetOrgDefault: false,
      isReadonly: true,
    },
  })
}

function personalDefault(): PmoGroupingViewDefinition {
  return makeView({
    id: 'view-personal-001',
    scope: 'personal',
    ownerUserId: 1,
    name: '我的按状态分组',
    description: '个人保存的按项目状态分组视图',
    query: { primaryGrouping: 'status', sort: 'project_count', order: 'desc' },
    isDefault: true,
  })
}

function personalSecond(): PmoGroupingViewDefinition {
  return makeView({
    id: 'view-personal-002',
    scope: 'personal',
    ownerUserId: 1,
    name: '我的按健康度分组',
    description: '关注健康度分布',
    query: { primaryGrouping: 'health', sort: 'group_name', order: 'asc' },
    isDefault: false,
  })
}

function orgShared(): PmoGroupingViewDefinition {
  return makeView({
    id: 'view-org-001',
    scope: 'organization',
    ownerUserId: 2,
    name: '组织按健康度分组',
    description: '组织共享的项目健康度分组视图',
    query: { primaryGrouping: 'health' },
    isDefault: false,
    capabilities: {
      canEdit: false,
      canDelete: false,
      canDuplicate: true,
      canSetDefault: false,
      canSetOrgDefault: true,
      isReadonly: false,
    },
  })
}

const VIEWS = [systemByStatus(), personalDefault(), personalSecond(), orgShared()]

function makePreviewBody() {
  return {
    groups: [
      {
        groupKey: 'status',
        groupValue: 'active',
        projectCount: 5,
        kpis: [
          { key: 'total_projects', value: 5, unit: 'count', status: 'ok' },
          { key: 'overall_progress_avg', value: 62, unit: 'percent', status: 'ok' },
        ],
        secondaryGroups: [
          {
            secondaryKey: 'status',
            secondaryValue: 'on_hold',
            projectCount: 1,
            kpis: [],
            warnings: [],
          },
        ],
        warnings: [],
      },
      {
        groupKey: 'status',
        groupValue: 'archived',
        projectCount: 2,
        kpis: [{ key: 'total_projects', value: 2, unit: 'count', status: 'ok' }],
        warnings: [],
      },
    ],
    freshness: [
      {
        source: 'project_dashboard',
        lastUpdatedAt: '2026-09-01T08:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 120,
      },
    ],
    warnings: [],
    meta: {
      calculatedAt: '2026-09-01T08:05:00.000Z',
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 7,
      primaryGroupCount: 2,
      secondaryGroupCount: 1,
      truncated: false,
    },
  }
}

/** 后端 envelope mock：路径 + method 分发（含 preview 只读计算端点）。 */
function installBackend(overrides?: { createError?: Error; views?: PmoGroupingViewDefinition[] }) {
  const views = [...(overrides?.views ?? VIEWS)]
  envelopeMock.mockImplementation(async (rawPath: string, init?: RequestInit) => {
    const path = rawPath.split('?')[0] ?? ''
    const method = init?.method ?? 'GET'
    const body = (() => {
      if (typeof init?.body !== 'string') return null
      try {
        return JSON.parse(init.body) as Record<string, unknown>
      } catch {
        return null
      }
    })()

    if (path.endsWith('/pmo/grouping-views/preview') && method === 'POST') {
      const query = body?.query as { primaryGrouping?: string } | undefined
      if (query?.primaryGrouping === 'health') {
        return {
          data: {
            groups: [
              {
                groupKey: 'health',
                groupValue: 'healthy',
                projectCount: 3,
                kpis: [{ key: 'total_projects', value: 3, unit: 'count', status: 'ok' }],
                warnings: [],
              },
            ],
            freshness: [],
            warnings: [{ code: 'DIMENSION_REDACTED', message: '部分分组维度已脱敏' }],
            meta: {
              calculatedAt: '2026-09-01T08:06:00.000Z',
              metricVersion: 'grouping-view.v1',
              organizationId: 1,
              visibleProjectCount: 3,
              primaryGroupCount: 1,
              secondaryGroupCount: 0,
              truncated: false,
            },
          },
        }
      }
      return { data: makePreviewBody() }
    }

    if (path.endsWith('/pmo/grouping-views') && method === 'GET') {
      return { data: views, meta: { total: views.length, page: 1, perPage: 20, totalPages: 1 } }
    }

    const duplicateMatch = /\/pmo\/grouping-views\/([^/]+)\/duplicate$/.exec(path)
    if (duplicateMatch && method === 'POST') {
      const source = views.find((view) => view.id === duplicateMatch[1]) ?? views[0]!
      const clone = makeView({
        id: `${source.id}-copy`,
        scope: 'personal',
        ownerUserId: 1,
        name: `${source.name}（副本）`,
        query: source.query,
        capabilities: source.capabilities,
      })
      views.push(clone)
      return { data: clone }
    }

    const setDefaultMatch = /\/pmo\/grouping-views\/([^/]+)\/set-default$/.exec(path)
    if (setDefaultMatch && method === 'POST') {
      const target = views.find((view) => view.id === setDefaultMatch[1])
      return { data: target ?? views[0] }
    }

    const itemMatch = /\/pmo\/grouping-views\/([^/]+)$/.exec(path)
    if (itemMatch && method === 'DELETE') {
      const index = views.findIndex((view) => view.id === itemMatch[1])
      if (index >= 0) views.splice(index, 1)
      return undefined
    }

    if (path.endsWith('/pmo/grouping-views') && method === 'POST') {
      if (overrides?.createError) throw overrides.createError
      const created = makeView({
        id: 'view-new-001',
        name: String(body?.name ?? '新视图'),
        description: body?.description ? String(body.description) : undefined,
        scope: (body?.scope as PmoGroupingViewDefinition['scope']) ?? 'personal',
        query: body?.query as PmoGroupingViewDefinition['query'],
      })
      views.push(created)
      return { data: created }
    }

    const updateMatch = /\/pmo\/grouping-views\/([^/]+)$/.exec(path)
    if (updateMatch && method === 'PUT') {
      const target = views.find((view) => view.id === updateMatch[1]) ?? views[0]!
      const updated = {
        ...target,
        name: typeof body?.name === 'string' ? body.name : target.name,
        description: typeof body?.description === 'string' ? body.description : target.description,
      }
      return { data: updated }
    }

    return { data: null }
  })
}

interface Call {
  path: string
  method: string
  body: Record<string, unknown> | null
}

function callPaths(): Call[] {
  return envelopeMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit | undefined
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    return { path: String(call[0]), method: init?.method ?? 'GET', body }
  })
}

beforeEach(() => {
  envelopeMock.mockReset()
  setAuth(['portfolio:view', 'portfolio:manage'])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PmoGroupingViewsPage：装配与 RBAC', () => {
  test('portfolio:view 授权：工作台装配、默认视图自动激活并解算（GET 列表 + preview 只读计算）', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-gv-workspace]')).not.toBeNull())
    await waitFor(() => expect(screen.getByText('分组视图')).toBeInTheDocument())
    // 默认视图（isDefault=view-personal-001）自动激活 → 按 viewId 解算
    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())
    const calls = callPaths()
    const listGet = calls.filter(
      (call) => call.path === '/pmo/grouping-views' && call.method === 'GET',
    )
    expect(listGet.length).toBeGreaterThanOrEqual(1)
    const preview = calls.find((call) => call.path.endsWith('/preview') && call.method === 'POST')
    expect(preview?.body).toEqual({ viewId: 'view-personal-001' })
  })

  test('无 portfolio:view：受限横幅渲染且零请求（RL-06）', async () => {
    setAuth(['task:view'])
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看 PMO 组合分组视图的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })

  test('未选择组织：引导态渲染且零请求', async () => {
    setAuth(['portfolio:view'], null)
    renderPage()

    expect(document.querySelector('[data-org-guide-state]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })
})

describe('PmoGroupingDefinitionList：归属分组与默认徽标', () => {
  test('系统预设/个人/组织共享分组渲染；默认徽标仅落在默认视图', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    // 三个归属分节
    expect(document.querySelector('[data-gv-def-section="system"]')?.textContent).toContain(
      '系统预设',
    )
    expect(document.querySelector('[data-gv-def-section="personal"]')?.textContent).toContain(
      '个人视图',
    )
    expect(document.querySelector('[data-gv-def-section="organization"]')?.textContent).toContain(
      '组织共享',
    )
    // 归属徽标与默认徽标
    const defaultBadge = document.querySelector('[data-gv-def-default-badge]')
    expect(defaultBadge).not.toBeNull()
    const defaultItem = defaultBadge?.closest('[data-gv-def-item]')
    expect(defaultItem?.getAttribute('data-gv-def-scope')).toBe('personal')
    expect(defaultItem?.getAttribute('data-gv-def-default')).toBe('true')
    const scopeBadges = Array.from(document.querySelectorAll('[data-gv-def-item]')).map((item) =>
      item.getAttribute('data-gv-def-scope'),
    )
    expect(scopeBadges).toEqual(['system', 'personal', 'personal', 'organization'])
    expect(screen.getByText('按状态分组')).toBeInTheDocument()
    expect(screen.getByText('我的按状态分组')).toBeInTheDocument()
    expect(screen.getByText('组织按健康度分组')).toBeInTheDocument()
  })

  test('行点击激活视图 → preview 携带 viewId', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    const orgRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find(
      (item) => item.getAttribute('data-gv-def-scope') === 'organization',
    )
    expect(orgRow).toBeTruthy()
    fireEvent.click(orgRow!.querySelector('[data-gv-def-item-open]') as Element)
    await waitFor(() => {
      const clicked = callPaths().some(
        (call) =>
          call.path.endsWith('/preview') &&
          call.method === 'POST' &&
          (call.body as { viewId?: string } | null)?.viewId === 'view-org-001',
      )
      expect(clicked).toBe(true)
    })
    expect(document.querySelector('[data-gv-follow-view]')?.textContent).toContain(
      '组织按健康度分组',
    )
  })
})

describe('PmoGroupingDefinitionList：删除/复制/设默认二次确认与端点参数', () => {
  test('删除：确认弹窗 → DELETE 端点 → 列表自动刷新', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    const personalRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find((item) =>
      item.textContent?.includes('我的按健康度分组'),
    )!
    fireEvent.click(personalRow.querySelector('[data-gv-def-delete]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-confirm]')).not.toBeNull())
    expect(document.querySelector('[data-gv-confirm-message]')?.textContent).toContain(
      '我的按健康度分组',
    )

    // 取消：零写请求
    fireEvent.click(document.querySelector('[data-gv-confirm-cancel]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-confirm]')).toBeNull())
    expect(
      callPaths().some(
        (call) => call.path.includes('view-personal-002') && call.method === 'DELETE',
      ),
    ).toBe(false)

    // 再次删除并确认 → DELETE /pmo/grouping-views/view-personal-002
    fireEvent.click(personalRow.querySelector('[data-gv-def-delete]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-confirm]')).not.toBeNull())
    const listGetsBefore = callPaths().filter(
      (call) => call.path === '/pmo/grouping-views' && call.method === 'GET',
    ).length
    fireEvent.click(document.querySelector('[data-gv-confirm-ok]') as Element)
    await waitFor(() =>
      expect(
        callPaths().some(
          (call) =>
            call.path === '/pmo/grouping-views/view-personal-002' && call.method === 'DELETE',
        ),
      ).toBe(true),
    )
    // 成功后失效缓存 → 列表重新 GET
    await waitFor(() =>
      expect(
        callPaths().filter((call) => call.path === '/pmo/grouping-views' && call.method === 'GET')
          .length,
      ).toBeGreaterThan(listGetsBefore),
    )
  })

  test('复制：确认弹窗 → POST duplicate 端点（含系统预设可复制语义）', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    const systemRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find(
      (item) => item.getAttribute('data-gv-def-scope') === 'system',
    )!
    fireEvent.click(systemRow.querySelector('[data-gv-def-duplicate]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-confirm]')).not.toBeNull())
    expect(document.querySelector('[data-gv-confirm-message]')?.textContent).toContain('按状态分组')
    fireEvent.click(document.querySelector('[data-gv-confirm-ok]') as Element)
    await waitFor(() =>
      expect(
        callPaths().some(
          (call) =>
            call.path === '/pmo/grouping-views/system-by-status/duplicate' &&
            call.method === 'POST',
        ),
      ).toBe(true),
    )
    const duplicateCall = callPaths().find(
      (call) => call.path === '/pmo/grouping-views/system-by-status/duplicate',
    )
    expect(duplicateCall?.body).toEqual({})
  })

  test('设默认：个人视图 → scope=personal；组织视图 → scope=organization', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    // 组织共享视图 →「设为组织默认」→ body scope=organization
    const orgRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find(
      (item) => item.getAttribute('data-gv-def-scope') === 'organization',
    )!
    expect(orgRow.textContent).toContain('设为组织默认')
    fireEvent.click(orgRow.querySelector('[data-gv-def-set-default]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-confirm]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-gv-confirm-ok]') as Element)
    await waitFor(() =>
      expect(
        callPaths().some(
          (call) =>
            call.path === '/pmo/grouping-views/view-org-001/set-default' && call.method === 'POST',
        ),
      ).toBe(true),
    )
    const orgSetDefault = callPaths().find(
      (call) => call.path === '/pmo/grouping-views/view-org-001/set-default',
    )
    expect(orgSetDefault?.body).toEqual({ scope: 'organization' })

    // 个人视图 →「设为默认」→ body scope=personal
    const personalRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find(
      (item) =>
        item.getAttribute('data-gv-def-scope') === 'personal' &&
        item.textContent?.includes('我的按健康度分组'),
    )!
    fireEvent.click(personalRow.querySelector('[data-gv-def-set-default]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-confirm]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-gv-confirm-ok]') as Element)
    await waitFor(() =>
      expect(
        callPaths().some(
          (call) =>
            call.path === '/pmo/grouping-views/view-personal-002/set-default' &&
            call.method === 'POST',
        ),
      ).toBe(true),
    )
    const personalSetDefault = callPaths().find(
      (call) => call.path === '/pmo/grouping-views/view-personal-002/set-default',
    )
    expect(personalSetDefault?.body).toEqual({ scope: 'personal' })
  })
})

describe('PmoGroupingViewSaveDialog：校验与创建/编辑', () => {
  test('名称必填校验：空名称提交被拦截且零写请求', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-gv-def-item]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-gv-create-view]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-gv-save-submit]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-gv-save-name-error]')?.textContent).toContain(
        '请输入视图名称',
      ),
    )
    expect(
      callPaths().some((call) => call.path === '/pmo/grouping-views' && call.method === 'POST'),
    ).toBe(false)
  })

  test('创建成功：POST 携带名称/描述/scope/query，对话框关闭且列表刷新', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-gv-def-item]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-gv-create-view]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull())
    const dialog = document.querySelector('[data-gv-save-dialog]') as HTMLElement

    fireEvent.change(dialog.querySelector('[data-gv-save-name]') as Element, {
      target: { value: '按部门巡检' },
    })
    fireEvent.change(dialog.querySelector('[data-gv-save-desc]') as Element, {
      target: { value: '部门巡检用分组' },
    })
    const listGetsBefore = callPaths().filter(
      (call) => call.path === '/pmo/grouping-views' && call.method === 'GET',
    ).length
    fireEvent.click(dialog.querySelector('[data-gv-save-submit]') as Element)

    await waitFor(() =>
      expect(
        callPaths().some((call) => call.path === '/pmo/grouping-views' && call.method === 'POST'),
      ).toBe(true),
    )
    const createCall = callPaths().find(
      (call) => call.path === '/pmo/grouping-views' && call.method === 'POST',
    )
    expect(createCall?.body).toMatchObject({
      name: '按部门巡检',
      description: '部门巡检用分组',
      scope: 'personal',
      query: { primaryGrouping: 'status', sort: 'project_count', order: 'desc' },
    })
    // 成功后关闭并失效列表 → 重新 GET
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).toBeNull())
    await waitFor(() =>
      expect(
        callPaths().filter((call) => call.path === '/pmo/grouping-views' && call.method === 'GET')
          .length,
      ).toBeGreaterThan(listGetsBefore),
    )
  })

  test('创建失败：保留输入并回显服务端错误', async () => {
    installBackend({ createError: new Error('创建失败：视图名称与既有视图冲突') })
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-gv-create-view]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-gv-create-view]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull())
    const dialog = document.querySelector('[data-gv-save-dialog]') as HTMLElement

    fireEvent.change(dialog.querySelector('[data-gv-save-name]') as Element, {
      target: { value: '重名视图' },
    })
    fireEvent.click(dialog.querySelector('[data-gv-save-submit]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-gv-save-error]')?.textContent).toContain(
        '创建失败：视图名称与既有视图冲突',
      ),
    )
    // 输入保留、对话框不关闭
    expect((dialog.querySelector('[data-gv-save-name]') as HTMLInputElement).value).toBe('重名视图')
    expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull()
  })

  test('编辑既有视图：预填元数据 → PUT 仅提交名称/描述', async () => {
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    const personalRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find(
      (item) =>
        item.getAttribute('data-gv-def-scope') === 'personal' &&
        item.textContent?.includes('我的按健康度分组'),
    )!
    fireEvent.click(personalRow.querySelector('[data-gv-def-edit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull())
    const dialog = document.querySelector('[data-gv-save-dialog]') as HTMLElement
    expect((dialog.querySelector('[data-gv-save-name]') as HTMLInputElement).value).toBe(
      '我的按健康度分组',
    )
    expect(dialog.querySelector('[data-gv-save-scope-static]')?.textContent).toContain('仅自己可见')

    fireEvent.change(dialog.querySelector('[data-gv-save-name]') as Element, {
      target: { value: '我的按健康度分组 v2' },
    })
    fireEvent.click(dialog.querySelector('[data-gv-save-submit]') as Element)
    await waitFor(() =>
      expect(
        callPaths().some(
          (call) => call.path === '/pmo/grouping-views/view-personal-002' && call.method === 'PUT',
        ),
      ).toBe(true),
    )
    const updateCall = callPaths().find(
      (call) => call.path === '/pmo/grouping-views/view-personal-002' && call.method === 'PUT',
    )
    expect(updateCall?.body).toMatchObject({
      name: '我的按健康度分组 v2',
      description: '关注健康度分布',
    })
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).toBeNull())
  })
})

describe('PmoGroupingViewsWorkspace：manage 门禁（RL-06）', () => {
  test('无 portfolio:manage：全部写入口隐藏，交互过程零写请求', async () => {
    setAuth(['portfolio:view'])
    installBackend()
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    // 写入口物理隐藏
    expect(document.querySelector('[data-gv-create-view]')).toBeNull()
    expect(document.querySelector('[data-gv-save-as-view]')).toBeNull()
    expect(document.querySelector('[data-gv-def-edit]')).toBeNull()
    expect(document.querySelector('[data-gv-def-duplicate]')).toBeNull()
    expect(document.querySelector('[data-gv-def-set-default]')).toBeNull()
    expect(document.querySelector('[data-gv-def-delete]')).toBeNull()

    // 仍可只读浏览：切换激活视图（read 语义）
    const orgRow = Array.from(document.querySelectorAll('[data-gv-def-item]')).find(
      (item) => item.getAttribute('data-gv-def-scope') === 'organization',
    )!
    fireEvent.click(orgRow.querySelector('[data-gv-def-item-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-gv-follow-view]')?.textContent).toContain(
        '组织按健康度分组',
      ),
    )

    const calls = callPaths()
    expect(calls.length).toBeGreaterThan(0)
    // 唯一非 GET 请求是只读计算端点 preview（RL-01：零写请求）
    const writes = calls.filter((call) => call.method !== 'GET')
    expect(writes.length).toBeGreaterThanOrEqual(1)
    expect(writes.every((call) => call.path.endsWith('/preview'))).toBe(true)
  })

  test('write 入口按钮在 manage 下逐行按 capabilities 显隐', async () => {
    installBackend()
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-gv-def-item]')).toHaveLength(4))
    const rows = Array.from(document.querySelectorAll('[data-gv-def-item]'))
    const systemRow = rows.find((row) => row.getAttribute('data-gv-def-scope') === 'system')!
    const personalRow = rows.find(
      (row) =>
        row.getAttribute('data-gv-def-scope') === 'personal' &&
        row.textContent?.includes('我的按状态分组'),
    )!
    const orgRow = rows.find((row) => row.getAttribute('data-gv-def-scope') === 'organization')!
    // 系统预设：仅复制
    expect(systemRow.querySelector('[data-gv-def-duplicate]')).not.toBeNull()
    expect(systemRow.querySelector('[data-gv-def-edit]')).toBeNull()
    expect(systemRow.querySelector('[data-gv-def-delete]')).toBeNull()
    expect(systemRow.querySelector('[data-gv-def-set-default]')).toBeNull()
    // 个人视图：编辑/复制/设默认/删除
    expect(personalRow.querySelector('[data-gv-def-edit]')).not.toBeNull()
    expect(personalRow.querySelector('[data-gv-def-delete]')).not.toBeNull()
    expect(personalRow.querySelector('[data-gv-def-set-default]')).not.toBeNull()
    // 组织共享：仅复制 + 设为组织默认（不可编辑/删除）
    expect(orgRow.querySelector('[data-gv-def-edit]')).toBeNull()
    expect(orgRow.querySelector('[data-gv-def-delete]')).toBeNull()
    expect(orgRow.querySelector('[data-gv-def-set-default]')).not.toBeNull()
  })
})

describe('PmoGroupingViewSaveDialog：scope 与摘要', () => {
  test('scope 选择组织共享 → POST body scope=organization', async () => {
    installBackend()
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-gv-create-view]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-gv-create-view]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull())
    const dialog = document.querySelector('[data-gv-save-dialog]') as HTMLElement

    fireEvent.change(dialog.querySelector('[data-gv-save-name]') as Element, {
      target: { value: '组织共享巡检视图' },
    })
    // 摘要回显（默认新建配置）
    expect(dialog.querySelector('[data-gv-save-query-summary]')?.textContent).toContain(
      '维度：状态',
    )
    fireEvent.change(dialog.querySelector('[data-gv-save-scope]') as Element, {
      target: { value: 'organization' },
    })
    fireEvent.click(dialog.querySelector('[data-gv-save-submit]') as Element)
    await waitFor(() =>
      expect(
        callPaths().some((call) => call.path === '/pmo/grouping-views' && call.method === 'POST'),
      ).toBe(true),
    )
    const createCall = callPaths().find(
      (call) => call.path === '/pmo/grouping-views' && call.method === 'POST',
    )
    expect(createCall?.body).toMatchObject({ scope: 'organization', name: '组织共享巡检视图' })
  })
})
