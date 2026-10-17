/**
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.4 —— BI 仪表盘工作台组件测试。
 *
 * 覆盖（tasks 3.4 / spec「组织 BI 三镜头」场景）：
 * - 双作用域（我的/组织共享）列表切换与当前视图装配；
 * - widget 类型映射与未知类型不渲染（RL-14，跳过不中断）；
 * - 共享盘写入口（新建/编辑/设默认/归档）按 org:manage 显隐；无权限零写请求；
 * - 个人盘编辑保存（PUT 携带 version 乐观锁）与列表缓存刷新。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BiDashboardsWorkspace } from '@/components/next/org-bi/BiDashboardsWorkspace'
import { useAuthStore } from '@/stores/auth-store'
import type {
  BiDashboardDefinition,
  BiDashboardScope,
  BiDashboardWidgetKey,
  BiDashboardWidgetRegistryEntry,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 网络层 mock：从既有 lib 路径观测 envelope 请求
// ---------------------------------------------------------------------------
const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
function makeRegistryEntry(
  widgetKey: BiDashboardWidgetKey,
  availability = 'available',
): BiDashboardWidgetRegistryEntry {
  return {
    widgetKey,
    displayKey: widgetKey,
    allowedSizes: ['small', 'medium', 'large', 'full'],
    supportedVisualizations: [],
    settingSchema: {},
    dataDependencyId: `ddi-${widgetKey}`,
    permissionTags: [],
    supportedFilters: [],
    supportedDrillDown: false,
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    emptyBehavior: 'show_empty',
    fallbackBehavior: 'warning',
    availability: availability as BiDashboardWidgetRegistryEntry['availability'],
  }
}

function makeDefinition(
  overrides: Partial<BiDashboardDefinition> & { dashboardId: number },
): BiDashboardDefinition {
  return {
    organizationId: 1,
    scope: 'organization_shared' as BiDashboardScope,
    ownerActorId: null,
    name: '组织健康看板',
    version: 1,
    definitionHash: 'h1',
    snapshotHash: 's1',
    layout: { columns: 2, density: 'comfortable' },
    // RL-14 场景需要服务端可能携带注册表外 widgetKey 的畸形载荷：
    // 实例键类型收窄为字符串态（运行时真实载荷同此形态）。
    widgets: [
      {
        widgetKey: 'bi_trend',
        size: 'large',
        position: { x: 0, y: 0, w: 1, h: 1 },
        settings: {},
      },
      {
        widgetKey: 'ghost_unknown_widget',
        size: 'medium',
        position: { x: 1, y: 0, w: 1, h: 1 },
        settings: {},
      },
    ] as unknown as BiDashboardDefinition['widgets'],
    globalFilters: [],
    timeWindow: { mode: 'last_n_days', days: 30 },
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    isDefault: false,
    isArchived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

function sharedDef(): BiDashboardDefinition {
  return makeDefinition({
    dashboardId: 5,
    name: '组织健康看板',
    scope: 'organization_shared',
    ownerActorId: null,
    isDefault: true,
  })
}

function personalDef(): BiDashboardDefinition {
  return makeDefinition({
    dashboardId: 9,
    name: '我的冲刺盘',
    scope: 'personal',
    ownerActorId: 1,
    isDefault: false,
    widgets: [
      {
        widgetKey: 'okr_summary',
        size: 'small',
        position: { x: 0, y: 0, w: 1, h: 1 },
        settings: {},
      },
    ],
  })
}

const REGISTRY = [makeRegistryEntry('bi_trend'), makeRegistryEntry('okr_summary')]

function installBackend(overrides?: { createScopeGuard?: (scope: string) => boolean }) {
  const shared = sharedDef()
  const personal = personalDef()
  envelopeMock.mockImplementation(async (rawPath: string, init?: RequestInit) => {
    const path = rawPath.split('?')[0] ?? ''
    const method = init?.method ?? 'GET'
    if (path.endsWith('/bi/dashboards/registry') && method === 'GET') {
      return { data: REGISTRY }
    }
    if (path.endsWith('/bi/dashboards/current') && method === 'GET') {
      return { data: shared }
    }
    if (path.endsWith('/bi/dashboards') && method === 'GET') {
      return { data: [shared, personal], meta: { total: 2, page: 1, perPage: 50, totalPages: 1 } }
    }
    if (path.endsWith('/bi/dashboards') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        scope?: string
        name?: string
        widgets?: Array<{ widgetKey: string }>
      }
      if (overrides?.createScopeGuard && !overrides.createScopeGuard(String(body.scope))) {
        throw new Error('403 无共享写权限')
      }
      return {
        data: makeDefinition({
          dashboardId: 99,
          name: body.name ?? '新看板',
          scope: body.scope as BiDashboardScope,
          ownerActorId: body.scope === 'personal' ? 1 : null,
        }),
      }
    }
    const updateMatch = /\/bi\/dashboards\/(\d+)$/.exec(path)
    if (updateMatch && method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string; version?: number }
      return {
        data: { ...personal, name: body.name ?? personal.name, version: (body.version ?? 1) + 1 },
      }
    }
    const actionMatch = /\/bi\/dashboards\/(\d+)\/(set-default|archive)$/.exec(path)
    if (actionMatch && method === 'POST') {
      return {
        data:
          actionMatch[2] === 'set-default'
            ? { ...shared, isDefault: true }
            : { ...shared, isArchived: true },
      }
    }
    return { data: null }
  })
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BiDashboardsWorkspace organizationId={1} />
    </QueryClientProvider>,
  )
}

function callPaths(): Array<{
  path: string
  method: string
  body: Record<string, unknown> | null
}> {
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
  setAuth(['org:view'])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BiDashboardsWorkspace：双作用域与确定性渲染', () => {
  test('当前视图装配：默认盘网格渲染已知 widget，未知类型跳过不中断（RL-14）', async () => {
    installBackend()
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-bi-dash-workspace]')).not.toBeNull())
    await waitFor(() => expect(screen.getByText('BI 仪表盘')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-bi-dash-viewer]')).not.toBeNull())

    // 当前视图 = 共享默认盘：仅注册表既有类型（bi_trend）渲染，ghost 跳过
    const widgets = document.querySelectorAll('[data-bi-dash-widget]')
    expect(widgets).toHaveLength(1)
    expect(document.querySelector('[data-bi-dash-widget-key="bi_trend"]')).not.toBeNull()
    expect(document.querySelector('[data-bi-dash-widget-key="ghost_unknown_widget"]')).toBeNull()
    expect(document.querySelector('[data-bi-dash-grid-skipped]')?.textContent).toContain(
      '1 个未注册',
    )
    expect(screen.getByText('BI 趋势')).toBeInTheDocument()
    // 作用域标签回显
    expect(document.querySelector('[data-bi-dash-viewer-scope]')?.textContent).toContain('组织共享')
  })

  test('双作用域切换：我的/组织共享列表各自过滤', async () => {
    installBackend()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-item]')).not.toBeNull())

    // 切到「我的仪表盘」
    fireEvent.click(document.querySelector('[data-bi-dash-scope-tab="personal"]') as Element)
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-bi-dash-list-item]')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.getAttribute('data-bi-dash-list-scope')).toBe('personal')
    })
    expect(screen.getByText('我的冲刺盘')).toBeInTheDocument()
    expect(screen.queryByText('组织健康看板')).toBeNull()

    // 切到「组织共享」
    fireEvent.click(
      document.querySelector('[data-bi-dash-scope-tab="organization_shared"]') as Element,
    )
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-bi-dash-list-item]')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.getAttribute('data-bi-dash-list-scope')).toBe('organization_shared')
    })
    expect(screen.getByText('组织健康看板')).toBeInTheDocument()
    // 默认徽标
    expect(document.querySelector('[data-bi-dash-default-badge]')).not.toBeNull()
  })

  test('空列表语境：无盘时展示引导空态', async () => {
    envelopeMock.mockImplementation(async (rawPath: string) => {
      const path = rawPath.split('?')[0] ?? ''
      if (path.endsWith('/registry')) return { data: REGISTRY }
      if (path.endsWith('/current')) return { data: sharedDef() }
      if (path.endsWith('/bi/dashboards'))
        return { data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 0 } }
      return { data: null }
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-empty]')).not.toBeNull())
  })
})

describe('BiDashboardsWorkspace：写入口按权限显隐（RL-06）', () => {
  test('成员（无 org:manage）：共享盘写按钮/行操作物理隐藏，全程零写请求', async () => {
    setAuth(['org:view'])
    installBackend()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-item]')).not.toBeNull())

    // 新建共享盘按钮不存在；新建个人盘按钮存在
    expect(document.querySelector('[data-bi-dash-create-shared]')).toBeNull()
    expect(document.querySelector('[data-bi-dash-create-personal]')).not.toBeNull()

    // 共享盘行无编辑/设默认/归档动作
    fireEvent.click(
      document.querySelector('[data-bi-dash-scope-tab="organization_shared"]') as Element,
    )
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-item]')).not.toBeNull())
    expect(document.querySelector('[data-bi-dash-row-edit]')).toBeNull()
    expect(document.querySelector('[data-bi-dash-row-set-default]')).toBeNull()
    expect(document.querySelector('[data-bi-dash-row-archive]')).toBeNull()

    // 查看器「编辑此盘」也不出现
    fireEvent.click(document.querySelector('[data-bi-dash-list-open]') as Element)
    await waitFor(() => expect(document.querySelector('[data-bi-dash-viewer]')).not.toBeNull())
    expect(document.querySelector('[data-bi-dash-viewer-edit]')).toBeNull()

    const requests = callPaths()
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  test('org:manage：共享盘新建/行设默认/归档入口可见可执行', async () => {
    setAuth(['org:view', 'org:manage'])
    installBackend()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-item]')).not.toBeNull())

    expect(document.querySelector('[data-bi-dash-create-shared]')).not.toBeNull()
    fireEvent.click(
      document.querySelector('[data-bi-dash-scope-tab="organization_shared"]') as Element,
    )
    await waitFor(() => expect(document.querySelector('[data-bi-dash-row-edit]')).not.toBeNull())
    expect(document.querySelector('[data-bi-dash-row-archive]')).not.toBeNull()
    // 默认盘不可再设默认
    expect(document.querySelector('[data-bi-dash-row-set-default]')).toBeNull()

    // 归档动作 → POST :id/archive
    fireEvent.click(document.querySelector('[data-bi-dash-row-archive]') as Element)
    await waitFor(() =>
      expect(callPaths().some((request) => request.path.endsWith('/bi/dashboards/5/archive'))).toBe(
        true,
      ),
    )
  })

  test('无管理权限用户打开共享盘编辑（后端拒绝场景）：容器不渲染入口（不出现 403 提示）', async () => {
    setAuth(['org:view'])
    installBackend()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-item]')).not.toBeNull())

    // 个人盘行操作仅对 owner 展示：本用户 id=1 是个人盘 owner
    fireEvent.click(document.querySelector('[data-bi-dash-scope-tab="personal"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-bi-dash-row-edit]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-bi-dash-row-edit]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-bi-dash-editor-panel]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-bi-dash-editor-panel]')?.textContent).toContain(
      '编辑仪表盘 · 我的仪表盘',
    )
    const nameField = document.querySelector('[data-bi-dash-editor-name]') as HTMLInputElement
    expect(nameField.value).toBe('我的冲刺盘')
  })
})

describe('BiDashboardsWorkspace：个人盘编辑保存与刷新', () => {
  test('编辑个人盘：改名称保存 → PUT 携带 version 乐观锁，成功后关闭并刷新列表', async () => {
    setAuth(['org:view'])
    installBackend()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-list-item]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-bi-dash-scope-tab="personal"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-bi-dash-row-edit]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-bi-dash-row-edit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-bi-dash-editor-name]')).not.toBeNull())

    const nameInput = document.querySelector('[data-bi-dash-editor-name]') as HTMLInputElement
    expect(nameInput.value).toBe('我的冲刺盘')
    fireEvent.change(nameInput, { target: { value: '我的冲刺盘 v2' } })

    const beforeSave = envelopeMock.mock.calls.length
    fireEvent.click(document.querySelector('[data-bi-dash-editor-save]') as Element)
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThan(beforeSave))

    // PUT /bi/dashboards/9 且 body 带 version=1（乐观锁）与 scope=personal
    const put = callPaths().find(
      (request) => request.path.endsWith('/bi/dashboards/9') && request.method === 'PUT',
    )
    expect(put).toBeTruthy()
    expect(put?.body?.version).toBe(1)
    expect(put?.body?.scope).toBe('personal')
    expect(put?.body?.name).toBe('我的冲刺盘 v2')
    // 保存成功后失效列表 → 列表 GET 再次发出（缓存刷新）
    await waitFor(() => {
      const listGets = callPaths().filter(
        (request) =>
          request.path.startsWith('/organizations/1/bi/dashboards?') && request.method === 'GET',
      )
      expect(listGets.length).toBeGreaterThanOrEqual(2)
    })
    // 抽屉关闭
    expect(document.querySelector('[data-bi-dash-editor-panel]')).toBeNull()
  })

  test('新建个人盘：POST 双作用域创建语义', async () => {
    setAuth(['org:view'])
    installBackend()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-bi-dash-workspace]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-bi-dash-create-personal]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-bi-dash-editor-panel]')).not.toBeNull(),
    )
    const drawer = document.querySelector('[data-bi-dash-editor-panel]') as HTMLElement
    expect(within(drawer).getByText('新建仪表盘 · 我的仪表盘')).toBeInTheDocument()

    fireEvent.change(drawer.querySelector('[data-bi-dash-editor-name]') as Element, {
      target: { value: '个人跟踪盘' },
    })
    // 添加 okr_summary widget
    fireEvent.click(drawer.querySelector('[data-bi-dash-editor-add-key="okr_summary"]') as Element)
    await waitFor(() =>
      expect(drawer.querySelectorAll('[data-bi-dash-editor-widget]')).toHaveLength(1),
    )

    const beforeSave = envelopeMock.mock.calls.length
    fireEvent.click(drawer.querySelector('[data-bi-dash-editor-save]') as Element)
    await waitFor(() => expect(envelopeMock.mock.calls.length).toBeGreaterThan(beforeSave))

    const post = callPaths().find(
      (request) => request.path.endsWith('/bi/dashboards') && request.method === 'POST',
    )
    expect(post?.body?.scope).toBe('personal')
    expect(post?.body?.name).toBe('个人跟踪盘')
    expect(
      (post?.body?.widgets as Array<{ widgetKey: string }>)?.map((w) => w.widgetKey),
    ).toContain('okr_summary')
  })
})
