/**
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.4 —— 组织资源池工作台组件测试。
 *
 * 覆盖（spec「组织资源池与资源缺口分析」场景 + tasks 4.4）：
 * - Tab 切换写回 URL（replace）且刷新/分享可从 URL 恢复视图状态（restorable）；
 * - 容量矩阵受限行不渲染名称/身份数值（RL-05 脱敏）；超载行警戒红徽标 +
 *   「过载」文字双通道；超载单元同样双通道；
 * - summary / 分区错误态重试 refetch 成功；
 * - 一切筛选/切换交互零写请求（全局 fetch 监控断言 0 记录，RL-01/RL-06）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { ResourcePoolWorkspace } from '@/components/next/org-pool/ResourcePoolWorkspace'
import type {
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolConflict,
  OrganizationResourcePoolDemandGap,
  OrganizationResourcePoolMetric,
  OrganizationResourcePoolResourceRow,
  OrganizationResourcePoolSkillItem,
  OrganizationResourcePoolSummary,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock（URL 为筛选唯一事实来源）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-pool',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

// ---------------------------------------------------------------------------
// 数据层 mock：api client 模块整体替换（与工作台直接消费方式对齐）
// ---------------------------------------------------------------------------
const apiMock = vi.hoisted(() => ({
  summary: vi.fn(),
  resources: vi.fn(),
  skills: vi.fn(),
  capacity: vi.fn(),
  conflicts: vi.fn(),
  demandGaps: vi.fn(),
}))
vi.mock('@/lib/api/organization-resource-pool', () => ({
  organizationResourcePoolApi: apiMock,
  organizationResourcePoolKeys: {
    all: ['organization-resource-pool'],
    summary: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'summary', organizationId, query] as const,
    resources: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'resources', organizationId, query] as const,
    skills: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'skills', organizationId, query] as const,
    capacity: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'capacity', organizationId, query] as const,
    conflicts: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'conflicts', organizationId, query] as const,
    demandGaps: (organizationId: number, query?: unknown) =>
      ['organization-resource-pool', 'demandGaps', organizationId, query] as const,
  },
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth() {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'viewer@example.com',
      fullName: '资源观察员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['resource:view'],
    currentOrganizationId: 1,
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
function makeMetric(
  overrides: Partial<OrganizationResourcePoolMetric>,
): OrganizationResourcePoolMetric {
  return {
    key: 'org_respool_total_resources',
    value: 12,
    unit: 'count',
    source: 'resource_registry',
    status: 'ok',
    ...overrides,
  }
}

function makeSummary(
  overrides: Partial<OrganizationResourcePoolSummary> = {},
): OrganizationResourcePoolSummary {
  return {
    meta: {
      calculatedAt: '2026-09-01T08:00:00.000Z',
      metricVersion: 'organization-resource-pool.v1',
      organizationId: 1,
      actorId: 1,
      visibleProjectCount: 5,
      querySignatureHash: 'abc123',
    },
    metrics: [
      makeMetric({ key: 'org_respool_total_resources', value: 12 }),
      makeMetric({ key: 'org_respool_total_capacity_hours', value: 960, unit: 'hours' }),
      makeMetric({ key: 'org_respool_allocated_capacity_hours', value: 720, unit: 'hours' }),
      makeMetric({ key: 'org_respool_remaining_capacity_hours', value: 240, unit: 'hours' }),
      makeMetric({ key: 'org_respool_avg_utilization_percent', value: 75, unit: 'percent' }),
      makeMetric({ key: 'org_respool_overloaded_resources', value: 1 }),
      makeMetric({ key: 'org_respool_conflict_count', value: 1 }),
      makeMetric({ key: 'org_respool_demand_gap_count', value: 2 }),
      makeMetric({
        key: 'org_respool_linked_users',
        value: null,
        source: 'membership',
        status: 'forbidden',
      }),
    ],
    warnings: [],
    sourceFreshness: [],
    resourceCount: 12,
    linkedUserCount: null,
    capacity: {
      totalHours: 960,
      allocatedHours: 720,
      remainingHours: 240,
      averageUtilizationPercent: 75,
    },
    loadDistribution: { idle: 1, normal: 6, high: 3, overloaded: 2, unavailable: 0 },
    skillCoverage: [],
    demandGapCount: 2,
    conflictCount: 1,
    ...overrides,
  }
}

function makeCapacityMatrix(): OrganizationResourcePoolCapacityMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-02',
    rows: [
      {
        resourceId: 1,
        resourceName: '张三',
        role: '前端开发',
        loadStatus: 'overloaded',
        totalCapacityHours: 40,
        totalAllocatedHours: 50,
        totalRemainingHours: -10,
        utilizationPercent: 125,
        redacted: false,
        cells: [
          {
            date: '2026-09-01',
            capacityHours: 8,
            allocatedHours: 8.4,
            remainingHours: 0,
            utilizationPercent: 105,
            loadStatus: 'overloaded',
            conflictFlags: ['error'],
          },
          {
            date: '2026-09-02',
            capacityHours: 8,
            allocatedHours: 6,
            remainingHours: 2,
            utilizationPercent: 75,
            loadStatus: 'normal',
            conflictFlags: [],
          },
        ],
      },
      {
        resourceId: 2,
        resourceName: null,
        role: null,
        loadStatus: 'normal',
        totalCapacityHours: 40,
        totalAllocatedHours: 20,
        totalRemainingHours: 20,
        utilizationPercent: 50,
        redacted: true,
        cells: [
          {
            date: '2026-09-01',
            capacityHours: 8,
            allocatedHours: 4,
            remainingHours: 4,
            utilizationPercent: 50,
            loadStatus: 'normal',
            conflictFlags: [],
          },
          {
            date: '2026-09-02',
            capacityHours: 8,
            allocatedHours: 4,
            remainingHours: 4,
            utilizationPercent: 50,
            loadStatus: 'normal',
            conflictFlags: [],
          },
        ],
      },
    ],
  }
}

function makeSkillItems(): OrganizationResourcePoolSkillItem[] {
  return [
    {
      skill: '前端开发',
      resourceCount: 3,
      capacityHours: 240,
      allocatedHours: 200,
      remainingHours: 40,
      demandCount: 0,
      gap: false,
      redacted: false,
    },
    {
      skill: null,
      resourceCount: null,
      capacityHours: null,
      allocatedHours: null,
      remainingHours: null,
      demandCount: null,
      gap: false,
      redacted: true,
    },
  ]
}

function makeResourceRows(): OrganizationResourcePoolResourceRow[] {
  return [
    {
      resourceId: 1,
      resourceName: '张三',
      resourceType: 'human',
      role: '前端开发',
      status: 'active',
      skillTags: ['React', 'TypeScript'],
      department: null,
      linkedUserId: 1,
      projectCount: 2,
      totalCapacityHours: 80,
      totalAllocatedHours: 100,
      totalRemainingHours: -20,
      utilizationPercent: 125,
      loadStatus: 'overloaded',
      conflictFlags: ['error'],
      freshness: null,
      target: null,
      redacted: false,
    },
  ]
}

function makeConflicts(): OrganizationResourcePoolConflict[] {
  return [
    {
      conflictId: 'conflict-1',
      severity: 'error',
      resourceId: 1,
      resourceName: '张三',
      projectIds: [1, 2],
      projectNames: ['项目A', '项目B'],
      description: '跨项目分配超过 100%',
      date: '2026-09-01',
      remediationHint: '建议下调项目B分配',
      target: null,
      redacted: false,
    },
  ]
}

function makeDemandGaps(): OrganizationResourcePoolDemandGap[] {
  return [
    {
      gapId: 'gap-1',
      skill: '数据科学',
      role: '数据工程师',
      projectId: 1,
      projectName: '项目A',
      taskId: 5,
      dateWindow: { from: '2026-09-01', to: '2026-10-01' },
      priority: 'high',
      target: null,
      redacted: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// 伪网络（只记录，业务由 apiMock 承载；断言零写 = 零 fetch 记录）
// ---------------------------------------------------------------------------
interface RequestRecord {
  method: string
  url: string
}
function installFetchSpy(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    records.push({ method: (init?.method ?? 'GET').toUpperCase(), url: raw })
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
function installDefaultBackend() {
  apiMock.summary.mockResolvedValue(makeSummary())
  apiMock.capacity.mockResolvedValue(makeCapacityMatrix())
  apiMock.resources.mockResolvedValue({
    data: makeResourceRows(),
    meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
  })
  apiMock.skills.mockResolvedValue(makeSkillItems())
  apiMock.conflicts.mockResolvedValue({
    data: makeConflicts(),
    meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
  })
  apiMock.demandGaps.mockResolvedValue({
    data: makeDemandGaps(),
    meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
  })
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ResourcePoolWorkspace />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navMock.replace.mockReset()
  navMock.push.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  setAuth()
  for (const key of Object.keys(apiMock) as Array<keyof typeof apiMock>) {
    ;(apiMock[key] as ReturnType<typeof vi.fn>).mockReset()
  }
  installDefaultBackend()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('ResourcePoolWorkspace：Tab 切换与 URL 状态（tasks 4.4）', () => {
  test('默认矩阵视图：summary KPI + 容量矩阵渲染，加载期骨架占位', async () => {
    const { records } = installFetchSpy()
    const { container } = renderWorkspace()

    expect(container.querySelector('[data-pool-skeleton]')).not.toBeNull()
    await waitFor(() => expect(container.querySelector('[data-pool-summary]')).not.toBeNull())
    await waitFor(() => expect(container.querySelector('[data-pool-capacity-view]')).not.toBeNull())
    expect(apiMock.summary).toHaveBeenCalledWith(1, expect.objectContaining({ view: 'matrix' }))
    expect(apiMock.capacity).toHaveBeenCalled()
    // 加载期之后页面进入稳态：仍为零写（全部 GET 语义由 mock 层覆盖，无任何 fetch 外发）
    expect(records.length).toBe(0)
  })

  test('Tab 切换写回 URL（view），恢复时按 URL 渲染对应视图', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-summary]')).not.toBeNull())

    fireEvent.click(screen.getByRole('tab', { name: '冲突' }))
    expect(navMock.replace).toHaveBeenCalledWith(
      '/next/organization/resource-pool?view=conflicts',
      { scroll: false },
    )

    // 模拟浏览器 URL 生效（replace 之后 searchParams 更新）→ 冲突视图请求发出
    searchParamsMock.value = new URLSearchParams('view=conflicts')
    const { container: next } = renderWorkspace()
    await waitFor(() => expect(next.querySelector('[data-pool-conflicts-view]')).not.toBeNull())
    expect(apiMock.conflicts).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ view: 'conflicts' }),
    )
    expect(screen.getByText('跨项目分配超过 100%')).not.toBeNull()
  })

  test('URL 状态恢复：view=skills 直达技能视图且对应 query 发起', async () => {
    searchParamsMock.value = new URLSearchParams('view=skills')
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-skills-view]')).not.toBeNull())
    expect(apiMock.skills).toHaveBeenCalledWith(1, expect.objectContaining({ view: 'skills' }))
  })

  test('分页写回 URL（page 参数）并在 URL 携带 page 时恢复', async () => {
    apiMock.conflicts.mockResolvedValue({
      data: makeConflicts(),
      meta: { total: 41, page: 1, perPage: 20, totalPages: 3 },
    })
    searchParamsMock.value = new URLSearchParams('view=conflicts')
    const { container } = renderWorkspace()
    await waitFor(() =>
      expect(container.querySelector('[data-pool-conflicts-view]')).not.toBeNull(),
    )
    fireEvent.click(container.querySelector('[data-pool-page-next]') as Element)
    expect(navMock.replace).toHaveBeenCalledWith(
      '/next/organization/resource-pool?view=conflicts&page=2',
      { scroll: false },
    )
  })
})

describe('ResourcePoolWorkspace：受限脱敏与超载双通道（tasks 4.4 / RL-05 / RL-15）', () => {
  test('受限指标卡不渲染任何数值（EyeOff + 不可见）', async () => {
    // 过载人数指标被后端脱敏（status: redacted, value: null）
    apiMock.summary.mockResolvedValue(
      makeSummary({
        metrics: [
          makeMetric({ key: 'org_respool_total_resources', value: 12 }),
          makeMetric({ key: 'org_respool_total_capacity_hours', value: 960, unit: 'hours' }),
          makeMetric({ key: 'org_respool_allocated_capacity_hours', value: 720, unit: 'hours' }),
          makeMetric({ key: 'org_respool_remaining_capacity_hours', value: 240, unit: 'hours' }),
          makeMetric({ key: 'org_respool_avg_utilization_percent', value: 75, unit: 'percent' }),
          makeMetric({ key: 'org_respool_overloaded_resources', value: null, status: 'redacted' }),
          makeMetric({ key: 'org_respool_conflict_count', value: 1 }),
          makeMetric({ key: 'org_respool_demand_gap_count', value: 2 }),
        ],
        loadDistribution: { idle: 1, normal: 6, high: 3, overloaded: 0, unavailable: 0 },
        resourceCount: 12,
        conflictCount: 1,
        demandGapCount: 2,
      }),
    )
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-summary]')).not.toBeNull())
    const restrictedMetric = container.querySelector(
      '[data-pool-metric="org_respool_overloaded_resources"] [data-restricted-metric]',
    )
    expect(restrictedMetric).not.toBeNull()
    expect(restrictedMetric?.textContent).toContain('不可见')
    // 受限卡内不出现任何数字文本
    expect(restrictedMetric?.textContent?.match(/\d/)).toBeNull()
  })

  test('容量矩阵受限行（redacted）不渲染名称与角色数值，中性占位呈现', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-capacity-view]')).not.toBeNull())
    const rows = container.querySelectorAll('[data-pool-capacity-row]')
    expect(rows.length).toBe(2)
    // 受限行
    const restrictedRow = container.querySelector('[data-pool-capacity-row="2"]') as HTMLElement
    const restrictedCell = restrictedRow.querySelector('[data-restricted]') as HTMLElement
    expect(restrictedCell).not.toBeNull()
    expect(restrictedCell.textContent).toContain('已脱敏')
    // 受限行角色列不渲染数值
    const roleCells = Array.from(restrictedRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(roleCells.some((text) => text === '前端开发')).toBe(false)
  })

  test('超载行警戒红徽标 + 过载文字（双通道），超载单元同样带过载徽标', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-capacity-view]')).not.toBeNull())
    const overloadedRow = container.querySelector(
      '[data-pool-capacity-row="1"] [data-pool-load-badge="overloaded"]',
    )
    expect(overloadedRow).not.toBeNull()
    expect(overloadedRow?.textContent).toContain('过载')
    expect((overloadedRow as HTMLElement).style.color).toContain('var(--nx-status-danger)')

    const overloadedCell = container.querySelector('[data-pool-cell="2026-09-01"]')
    expect(overloadedCell).not.toBeNull()
    expect(overloadedCell?.querySelector('[data-overload-text]')?.textContent).toBe('过载')
    expect((overloadedCell as HTMLElement).style.borderColor).toBe('var(--nx-status-danger)')
    expect(overloadedCell?.textContent).toContain('105%')
  })

  test('受限技能条目（redacted）中性呈现且不含数字', async () => {
    searchParamsMock.value = new URLSearchParams('view=skills')
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-skills-view]')).not.toBeNull())
    const redactedItem = container.querySelector('[data-pool-skill-redacted]') as HTMLElement
    expect(redactedItem).not.toBeNull()
    expect(redactedItem.textContent).toContain('不可见')
    expect(redactedItem.textContent?.match(/\d/)).toBeNull()
  })
})

describe('ResourcePoolWorkspace：错误重试（tasks 4.4）', () => {
  test('summary 加载失败展示错误卡，重试成功后渲染工作台', async () => {
    apiMock.summary.mockReset()
    apiMock.summary.mockRejectedValueOnce(new Error('network down'))
    apiMock.summary.mockResolvedValue(makeSummary())
    const { container } = renderWorkspace()

    await waitFor(() => expect(container.querySelector('[data-pool-error]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-pool-retry]') as Element)
    await waitFor(() => expect(container.querySelector('[data-pool-summary]')).not.toBeNull())
  })

  test('容量矩阵分区加载失败：分区错误卡重试', async () => {
    apiMock.capacity.mockReset()
    apiMock.capacity.mockRejectedValueOnce(new Error('capacity down'))
    apiMock.capacity.mockResolvedValue(makeCapacityMatrix())
    const { container } = renderWorkspace()
    await waitFor(() =>
      expect(container.querySelector('[data-pool-capacity-error]')).not.toBeNull(),
    )
    fireEvent.click(container.querySelector('[data-pool-capacity-retry]') as Element)
    await waitFor(() => expect(container.querySelector('[data-pool-capacity-view]')).not.toBeNull())
  })

  test('分区空态：冲突视图无数据时展示空态引导', async () => {
    apiMock.conflicts.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    searchParamsMock.value = new URLSearchParams('view=conflicts')
    const { container } = renderWorkspace()
    await waitFor(() =>
      expect(container.querySelector('[data-pool-conflicts-empty]')).not.toBeNull(),
    )
  })
})

describe('ResourcePoolWorkspace：筛选交互零写请求（tasks 4.4 / RL-01）', () => {
  test('负载/严重度/搜索筛选只做 URL 回写与只读重查，全局零 fetch 记录', async () => {
    const { records } = installFetchSpy()
    const { container } = renderWorkspace()
    await waitFor(() => expect(container.querySelector('[data-pool-summary]')).not.toBeNull())

    // 负载筛选
    fireEvent.change(container.querySelector('[data-pool-filter-load]') as Element, {
      target: { value: 'overloaded' },
    })
    expect(navMock.replace).toHaveBeenCalledWith(
      '/next/organization/resource-pool?view=matrix&loadStatus=overloaded',
      { scroll: false },
    )
    // 严重度筛选
    fireEvent.change(container.querySelector('[data-pool-filter-severity]') as Element, {
      target: { value: 'critical' },
    })
    expect(navMock.replace).toHaveBeenLastCalledWith(
      '/next/organization/resource-pool?view=matrix&conflictSeverity=critical',
      { scroll: false },
    )
    // 搜索提交
    fireEvent.change(container.querySelector('[data-pool-search-input]') as Element, {
      target: { value: '张三' },
    })
    fireEvent.submit(container.querySelector('[data-pool-search-form]') as Element)
    expect(navMock.replace).toHaveBeenLastCalledWith(
      '/next/organization/resource-pool?view=matrix&search=%E5%BC%A0%E4%B8%89',
      { scroll: false },
    )

    // 应用新 URL 后筛选结果回读（severity 过滤下的资源查询）
    searchParamsMock.value = new URLSearchParams('view=matrix&loadStatus=overloaded&search=张三')
    renderWorkspace()
    await waitFor(() => expect(apiMock.capacity).toHaveBeenCalled())
    const lastCall = apiMock.capacity.mock.calls[apiMock.capacity.mock.calls.length - 1]
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({ loadStatus: 'overloaded', search: '张三' }),
    )

    // 筛选过程零外发（无任何真实 fetch，含无写方法）
    expect(records.length).toBe(0)
  })
})
