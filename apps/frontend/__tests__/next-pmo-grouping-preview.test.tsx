/**
 * v3-ui-next-pmo-domain W3 · tasks 3.4 —— 组合预览工作台测试
 * （PmoGroupingPreviewBoard 独立装配 + envelope 网络层探针）。
 *
 * 覆盖：
 * - 激活已保存视图 → 按 { viewId } 解算并渲染分组卡/列表；
 * - 分组维度/排序键/方向切换 → 转为临时配置按 { query } 解算（参数精确断言）；
 * - 解算渲染：分组卡/计数/KPI/meta/截断徽标/告警/新鲜度（双通道）；
 * - 空态（无可见项目）与错误卡重试成功闭环；
 * - manage 门禁：无权限隐藏「保存为视图」，交互全程零写请求（RL-06）；
 * - 「保存为视图」回调携带当前配置并联动保存对话框预填。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoGroupingPreviewBoard } from '@/components/next/pmo/grouping-views/PmoGroupingPreviewBoard'
import { PmoGroupingViewsWorkspace } from '@/components/next/pmo/grouping-views/PmoGroupingViewsWorkspace'
import { useAuthStore } from '@/stores/auth-store'
import type { PmoGroupingViewDefinition } from '@aiproj/types'

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: envelopeMock,
}))

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

function statusView(): PmoGroupingViewDefinition {
  return makeView({
    id: 'view-status-001',
    name: '按状态分组（个人）',
    query: { primaryGrouping: 'status', sort: 'project_count', order: 'desc' },
  })
}

function staleStatusPreview() {
  return {
    groups: [
      {
        groupKey: 'status',
        groupValue: 'active',
        projectCount: 5,
        kpis: [
          { key: 'total_projects', value: 5, unit: 'count', status: 'ok' },
          { key: 'overall_progress_avg', value: 62, unit: 'percent', status: 'ok' },
          { key: 'health_red_percent', value: null, unit: 'percent', status: 'forbidden' },
        ],
        warnings: [{ code: 'GROUP_TRUNCATED', message: '分组结果已截断' }],
      },
      {
        groupKey: 'status',
        groupValue: 'on_hold',
        projectCount: 0,
        kpis: [],
        warnings: [],
      },
    ],
    freshness: [
      {
        source: 'project_dashboard',
        lastUpdatedAt: '2026-09-01T00:30:00.000Z',
        isStale: true,
        staleThresholdMinutes: 120,
      },
    ],
    warnings: [
      { code: 'METRIC_FORBIDDEN', message: '部分指标因权限不足已隐藏' },
      { code: 'TRAFFIC_LIGHT_UNAVAILABLE', message: 'PMO 交通灯能力未启用' },
    ],
    meta: {
      calculatedAt: '2026-09-01T08:05:00.000Z',
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 5,
      primaryGroupCount: 2,
      secondaryGroupCount: 0,
      truncated: true,
    },
  }
}

function healthPreview() {
  return {
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
    warnings: [],
    meta: {
      calculatedAt: '2026-09-01T08:06:00.000Z',
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 3,
      primaryGroupCount: 1,
      secondaryGroupCount: 0,
      truncated: false,
    },
  }
}

function emptyPreview() {
  return {
    groups: [],
    freshness: [],
    warnings: [],
    meta: {
      calculatedAt: '2026-09-01T08:07:00.000Z',
      metricVersion: 'grouping-view.v1',
      organizationId: 1,
      visibleProjectCount: 0,
      primaryGroupCount: 0,
      secondaryGroupCount: 0,
      truncated: false,
    },
  }
}

interface PreviewCall {
  path: string
  method: string
  body: Record<string, unknown> | null
}

function previewCalls(): PreviewCall[] {
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

function lastPreviewBody(): Record<string, unknown> | null {
  const previews = previewCalls().filter((call) => call.path.endsWith('/preview'))
  return previews[previews.length - 1]?.body ?? null
}

/** 预览端点分发：按请求体（viewId 或 query.primaryGrouping）返回对应切片。 */
function installPreviewBackend(options?: { failFirstPreview?: boolean }) {
  let previewCount = 0
  envelopeMock.mockImplementation(async (rawPath: string, init?: RequestInit) => {
    const path = rawPath.split('?')[0] ?? ''
    const method = init?.method ?? 'GET'
    if (path.endsWith('/pmo/grouping-views/preview') && method === 'POST') {
      previewCount += 1
      if (options?.failFirstPreview && previewCount === 1) {
        throw new Error('预览服务暂不可用')
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        viewId?: string
        query?: { primaryGrouping?: string }
      }
      if (body.query?.primaryGrouping === 'health') return { data: healthPreview() }
      if (body.query?.primaryGrouping === 'source_freshness') return { data: emptyPreview() }
      return { data: staleStatusPreview() }
    }
    if (path.endsWith('/pmo/grouping-views') && method === 'GET') {
      return {
        data: [statusView()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }
    }
    return { data: null }
  })
}

function renderBoard(activeView: PmoGroupingViewDefinition | null, canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSaveAsView = vi.fn()
  const utils = render(
    <QueryClientProvider client={client}>
      <PmoGroupingPreviewBoard
        activeView={activeView}
        canManage={canManage}
        onSaveAsView={onSaveAsView}
      />
    </QueryClientProvider>,
  )
  return { onSaveAsView, ...utils }
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '组合管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  envelopeMock.mockReset()
  setAuth(['portfolio:view', 'portfolio:manage'])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PmoGroupingPreviewBoard：视图跟随与自动解算', () => {
  test('激活已保存视图：控件跟随视图定义，按 { viewId } 解算并渲染分组卡', async () => {
    installPreviewBackend()
    const { onSaveAsView } = renderBoard(statusView(), true)

    // 自动解算触发 { viewId }
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument())
    expect(lastPreviewBody()).toEqual({ viewId: 'view-status-001' })
    // 控件跟随视图定义（status / project_count / desc）
    expect((document.querySelector('[data-gv-primary-select]') as HTMLSelectElement).value).toBe(
      'status',
    )
    expect((document.querySelector('[data-gv-sort-select]') as HTMLSelectElement).value).toBe(
      'project_count',
    )
    expect(screen.getByText('降序')).toBeInTheDocument()
    // 「跟随视图」态（未手工调整）
    expect(document.querySelector('[data-gv-follow-view]')?.textContent).toContain(
      '按状态分组（个人）',
    )
    expect(document.querySelector('[data-gv-custom-mode]')).toBeNull()

    // 分组卡渲染：分组值/计数/KPI（百分比拼 %、null 显示 —）/双通道告警徽标
    expect(document.querySelector('[data-gv-group-card]')).not.toBeNull()
    expect(screen.getByText('on_hold')).toBeInTheDocument()
    expect(document.querySelector('[data-gv-group-count]')?.textContent).toContain('5 项')
    const kpis = document.querySelectorAll('[data-gv-group-kpi]')
    const kpiTexts = Array.from(kpis).map((node) => node.textContent ?? '')
    expect(kpiTexts.some((text) => text.includes('62%'))).toBe(true)
    expect(kpiTexts.some((text) => text.includes('—'))).toBe(true)
    expect(document.querySelectorAll('[data-gv-group-warning]').length).toBeGreaterThan(0)
    // meta / 截断 / 过期新鲜度（双通道）
    expect(document.querySelector('[data-gv-meta-projects]')?.textContent).toContain('5')
    expect(document.querySelector('[data-gv-meta-truncated]')).not.toBeNull()
    expect(document.querySelector('[data-gv-freshness-stale]')?.textContent).toContain(
      '数据可能过期',
    )
    // 面板级 warnings 文案
    expect(document.querySelector('[data-gv-preview-warnings]')?.textContent).toContain(
      '部分指标因权限不足已隐藏',
    )
    // 未点保存：onSaveAsView 未被调用
    expect(onSaveAsView).not.toHaveBeenCalled()
  })

  test('空闲态：无激活视图且未调整时展示引导空态、零请求', async () => {
    installPreviewBackend()
    renderBoard(null, true)

    await waitFor(() => expect(document.querySelector('[data-gv-preview-idle]')).not.toBeNull())
    expect(screen.getByText('尚未开始解算组合')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(previewCalls().some((call) => call.path.endsWith('/preview'))).toBe(false)
  })

  test('切换视图（activeView 变化）：控件重新跟随并按新 viewId 解算', async () => {
    installPreviewBackend()
    const { rerender } = renderBoard(statusView(), true)
    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())

    const healthView = makeView({
      id: 'view-health-002',
      name: '按健康度分组（个人）',
      query: { primaryGrouping: 'health', sort: 'group_name', order: 'asc' },
    })
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PmoGroupingPreviewBoard activeView={healthView} canManage onSaveAsView={vi.fn()} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(lastPreviewBody()).toEqual({ viewId: 'view-health-002' }))
    expect((document.querySelector('[data-gv-primary-select]') as HTMLSelectElement).value).toBe(
      'health',
    )
    expect((document.querySelector('[data-gv-sort-select]') as HTMLSelectElement).value).toBe(
      'group_name',
    )
    expect(screen.getByText('升序')).toBeInTheDocument()
  })
})

describe('PmoGroupingPreviewBoard：分组/排序/方向切换解算参数', () => {
  test('切换分组维度 → 临时配置按 { query } 解算（health 切片渲染）', async () => {
    installPreviewBackend()
    renderBoard(statusView(), true)

    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())
    fireEvent.change(document.querySelector('[data-gv-primary-select]') as Element, {
      target: { value: 'health' },
    })
    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument())
    expect(lastPreviewBody()).toEqual({
      query: { primaryGrouping: 'health', sort: 'project_count', order: 'desc' },
    })
    // 手工调整 → 临时配置态（未保存）
    expect(document.querySelector('[data-gv-custom-mode]')?.textContent).toContain('临时配置')
    expect(document.querySelector('[data-gv-follow-view]')).toBeNull()
    // health 预览无 warnings → 面板级告警区消失
    expect(document.querySelector('[data-gv-preview-warnings]')).toBeNull()
  })

  test('切换排序键与方向 → query 参数精确更新', async () => {
    installPreviewBackend()
    renderBoard(statusView(), true)

    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-gv-sort-select]') as Element, {
      target: { value: 'progress_avg' },
    })
    await waitFor(() =>
      expect(lastPreviewBody()).toEqual({
        query: { primaryGrouping: 'status', sort: 'progress_avg', order: 'desc' },
      }),
    )

    fireEvent.click(document.querySelector('[data-gv-order-toggle]') as Element)
    await waitFor(() =>
      expect(lastPreviewBody()).toEqual({
        query: { primaryGrouping: 'status', sort: 'progress_avg', order: 'asc' },
      }),
    )
    expect(screen.getByText('升序')).toBeInTheDocument()

    // 再次点击切回降序
    fireEvent.click(document.querySelector('[data-gv-order-toggle]') as Element)
    await waitFor(() =>
      expect(lastPreviewBody()).toEqual({
        query: { primaryGrouping: 'status', sort: 'progress_avg', order: 'desc' },
      }),
    )
  })

  test('解算空态：无可见项目分组时展示语义化空态（含告警文案）', async () => {
    installPreviewBackend()
    renderBoard(statusView(), true)

    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())
    fireEvent.change(document.querySelector('[data-gv-primary-select]') as Element, {
      target: { value: 'source_freshness' },
    })
    await waitFor(() => expect(document.querySelector('[data-gv-preview-empty]')).not.toBeNull())
    expect(screen.getByText('没有可呈现的项目分组')).toBeInTheDocument()
    expect(lastPreviewBody()).toEqual({
      query: { primaryGrouping: 'source_freshness', sort: 'project_count', order: 'desc' },
    })
  })

  test('解算失败 → 错误卡（含服务端消息）→ 重试成功闭环', async () => {
    installPreviewBackend({ failFirstPreview: true })
    renderBoard(statusView(), true)

    await waitFor(() => expect(document.querySelector('[data-gv-preview-error]')).not.toBeNull())
    expect(document.querySelector('[data-gv-preview-error]')?.textContent).toContain(
      '预览服务暂不可用',
    )
    fireEvent.click(document.querySelector('[data-gv-preview-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())
    expect(screen.getByText('active')).toBeInTheDocument()
    // 错误卡消失
    expect(document.querySelector('[data-gv-preview-error]')).toBeNull()
  })
})

describe('PmoGroupingPreviewBoard：保存为视图（manage 门禁）', () => {
  test('manage：点击「保存为视图」回调携带当前解算配置', async () => {
    installPreviewBackend()
    const { onSaveAsView } = renderBoard(statusView(), true)

    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())
    // 先切换维度使配置自定义化
    fireEvent.change(document.querySelector('[data-gv-primary-select]') as Element, {
      target: { value: 'health' },
    })
    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument())

    fireEvent.click(document.querySelector('[data-gv-save-as-view]') as Element)
    expect(onSaveAsView).toHaveBeenCalledTimes(1)
    expect(onSaveAsView).toHaveBeenCalledWith({
      primaryGrouping: 'health',
      sort: 'project_count',
      order: 'desc',
    })
  })

  test('无 manage：保存按钮物理隐藏，只读交互零写请求（RL-06）', async () => {
    setAuth(['portfolio:view'])
    installPreviewBackend()
    const { onSaveAsView } = renderBoard(statusView(), false)

    await waitFor(() => expect(document.querySelector('[data-gv-group-card]')).not.toBeNull())
    expect(document.querySelector('[data-gv-save-as-view]')).toBeNull()
    // 只读交互仍可用：切换维度产生一次只读计算 POST
    fireEvent.change(document.querySelector('[data-gv-primary-select]') as Element, {
      target: { value: 'health' },
    })
    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument())
    const calls = previewCalls()
    const writes = calls.filter((call) => call.method !== 'GET')
    expect(writes.length).toBeGreaterThanOrEqual(1)
    expect(writes.every((call) => call.path.endsWith('/preview'))).toBe(true)
    expect(onSaveAsView).not.toHaveBeenCalled()
  })
})

describe('PmoGroupingViewsWorkspace：保存为视图联动对话框预填', () => {
  test('「保存为视图」打开对话框并预填当前配置摘要（提交 POST 携带该 query）', async () => {
    installPreviewBackend()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <PmoGroupingViewsWorkspace organizationId={1} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(document.querySelector('[data-gv-board]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-gv-save-as-view]')).not.toBeNull())
    // 先等默认视图自动解算落定（确定性），再切换维度
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument())

    fireEvent.change(document.querySelector('[data-gv-primary-select]') as Element, {
      target: { value: 'health' },
    })
    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument())

    fireEvent.click(document.querySelector('[data-gv-save-as-view]') as Element)
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).not.toBeNull())
    const dialog = document.querySelector('[data-gv-save-dialog]') as HTMLElement
    expect(dialog.querySelector('[data-gv-save-query-summary]')?.textContent).toContain(
      '维度：健康度',
    )
    expect(dialog.querySelector('[data-gv-save-query-summary]')?.textContent).toContain(
      '排序：项目数',
    )
    expect(dialog.querySelector('[data-gv-save-query-summary]')?.textContent).toContain('降序')

    fireEvent.change(dialog.querySelector('[data-gv-save-name]') as Element, {
      target: { value: '健康度临时视图' },
    })
    fireEvent.click(dialog.querySelector('[data-gv-save-submit]') as Element)
    await waitFor(() =>
      expect(
        previewCalls().some(
          (call) => call.path === '/pmo/grouping-views' && call.method === 'POST',
        ),
      ).toBe(true),
    )
    const createCall = previewCalls().find(
      (call) => call.path === '/pmo/grouping-views' && call.method === 'POST',
    )
    expect(createCall?.body).toMatchObject({
      name: '健康度临时视图',
      scope: 'personal',
      query: { primaryGrouping: 'health', sort: 'project_count', order: 'desc' },
    })
    await waitFor(() => expect(document.querySelector('[data-gv-save-dialog]')).toBeNull())
  })
})
