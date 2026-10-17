/**
 * v3-ui-next-pmo-domain W7 · tasks 7.5 —— 跨项目依赖底册/双模式工作台
 * （页面级渲染 + hook 层 mock，网络零请求断言）。
 *
 * 覆盖（spec「跨项目依赖管理」/ Design D5 门禁裁决）：
 * - orgId 未水合 → 引导态且 list/detail 零调用（RL-05/RL-06 零发包）；
 * - 组织成员即读：legacy 契约行渲染（提供方→消费方/端点类型/徽标/新鲜度），
 *   以及信封响应（无 meta）与 CRUD 契约行的归一（域内适配器兜底）；
 * - 过滤工具栏参数序列化（endpointType/category/type/status/riskLevel/…）与
 *   分页/排序/清除筛选；URL 视图态持久化（?view=graph）；
 * - 行点击详情抽屉（useMpdDetail 参数 + 中性 404 文案 + 重试）；
 * - 写闭环：archive/restore/delete/create/update 全部「预览 → 确认」双步，
 *   confirm 前零写请求、无 portfolio:manage 时写入口物理隐藏（RL-06）。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- 测试 mock/夹具按测试惯例使用 any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import PmoDependenciesPage from '@/app/(next)/next/pmo/dependencies/page'
import { useAuthStore } from '@/stores/auth-store'

/* ── hook 层 mock（模块整体替换，mutation/query 可控） ─────────────────────── */
const hookMocks = vi.hoisted(() => ({
  useMpdList: vi.fn(),
  useMpdDetail: vi.fn(),
  useMpdGraph: vi.fn(),
  useMpdCreatePreview: vi.fn(),
  useMpdConfirmCreate: vi.fn(),
  useMpdUpdatePreview: vi.fn(),
  useMpdConfirmUpdate: vi.fn(),
  useMpdArchivePreview: vi.fn(),
  useMpdConfirmArchive: vi.fn(),
  useMpdRestorePreview: vi.fn(),
  useMpdConfirmRestore: vi.fn(),
  useMpdDeletePreview: vi.fn(),
  useMpdConfirmDelete: vi.fn(),
}))

vi.mock('@/hooks/use-multi-project-dependencies', () => ({
  useMpdList: hookMocks.useMpdList,
  useMpdDetail: hookMocks.useMpdDetail,
  useMpdGraph: hookMocks.useMpdGraph,
  useMpdCreatePreview: hookMocks.useMpdCreatePreview,
  useMpdConfirmCreate: hookMocks.useMpdConfirmCreate,
  useMpdUpdatePreview: hookMocks.useMpdUpdatePreview,
  useMpdConfirmUpdate: hookMocks.useMpdConfirmUpdate,
  useMpdArchivePreview: hookMocks.useMpdArchivePreview,
  useMpdConfirmArchive: hookMocks.useMpdConfirmArchive,
  useMpdRestorePreview: hookMocks.useMpdRestorePreview,
  useMpdConfirmRestore: hookMocks.useMpdConfirmRestore,
  useMpdDeletePreview: hookMocks.useMpdDeletePreview,
  useMpdConfirmDelete: hookMocks.useMpdConfirmDelete,
}))

const portfolioMocks = vi.hoisted(() => ({ usePortfolioProjects: vi.fn() }))
vi.mock('@/hooks/use-portfolio-dashboard', () => ({
  usePortfolioProjects: portfolioMocks.usePortfolioProjects,
}))

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace, back: navMocks.back }),
  usePathname: () => '/next/pmo/dependencies',
  useParams: () => ({}),
  useSearchParams: () => navMocks.params,
}))

/* ── 夹具 ───────────────────────────────────────────────────────────────────── */
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '王启明',
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

function legacyDep(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: 1,
    providerEndpoint: {
      endpointType: 'project',
      projectId: 1,
      projectName: `上游项目 ${id}`,
      milestoneId: null,
      milestoneName: null,
      taskId: null,
      taskName: null,
      externalLabel: null,
      externalKey: null,
      redacted: false,
      redactionReason: null,
    },
    consumerEndpoint: {
      endpointType: 'task',
      projectId: 2,
      projectName: `下游项目 ${id}`,
      milestoneId: null,
      milestoneName: null,
      taskId: 300 + id,
      taskName: `下游任务 ${id}`,
      externalLabel: null,
      externalKey: null,
      redacted: false,
      redactionReason: null,
    },
    category: 'deliverable',
    type: 'fs',
    lagDays: 0,
    strength: 'hard',
    bufferDays: 2,
    status: 'active',
    riskLevel: 'high',
    ownerUserId: null,
    sourceMode: 'manual',
    sourceSuggestionId: null,
    evidenceRefs: [],
    freshnessSignature: 'sig',
    freshnessCheckedAt: '2026-09-10T02:00:00.000Z',
    freshnessStatus: 'fresh',
    confirmationHash: null,
    idempotencyKey: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-02T08:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

const metaFixture = { total: 25, page: 1, perPage: 20, totalPages: 2 }

function okQuery(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...extra }
}

function mutationMock(resolved?: unknown) {
  return { mutateAsync: vi.fn().mockResolvedValue(resolved), isPending: false }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoDependenciesPage />
    </QueryClientProvider>,
  )
}

const PREVIEW_ENVELOPE = {
  data: {
    previewId: 'pv-7',
    operation: 'archive',
    providerEndpoint: {
      endpointType: 'project',
      projectId: 1,
      projectName: '上游项目 7',
      redacted: false,
    },
    consumerEndpoint: {
      endpointType: 'task',
      projectId: 2,
      projectName: '下游项目 7',
      taskId: 307,
      taskName: '下游任务 7',
      redacted: false,
    },
    diff: {
      operation: 'archive',
      before: { status: 'active' },
      after: { status: 'archived' },
      changedFields: ['status'],
    },
    warningCodes: ['DEPENDENCY_STALE'],
    confirmationHash: 'hash-7',
    expiresAt: '2026-09-10T07:00:00.000Z',
    idempotencyGuidance: '同一确认请求请复用幂等键',
  },
}

const CONFIRM_BODY = {
  data: {
    dependency: legacyDep(7, { status: 'archived' }),
    auditEventId: 'audit-7',
    idempotentReplay: false,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  navMocks.params = new URLSearchParams()
  setAuth(['portfolio:view'], 1)

  // 默认：空列表成功
  hookMocks.useMpdList.mockReturnValue(
    okQuery({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
  )
  hookMocks.useMpdDetail.mockReturnValue(okQuery(null))
  hookMocks.useMpdGraph.mockReturnValue(
    okQuery({
      data: {
        nodes: [],
        edges: [],
        visibleNodeCount: 0,
        redactedNodeCount: 0,
        visibleEdgeCount: 0,
        truncated: false,
        truncationReason: null,
        warningCodes: [],
        freshnessMeta: { checkedAt: '', staleCount: 0, freshCount: 0 },
      },
    }),
  )
  portfolioMocks.usePortfolioProjects.mockReturnValue(
    okQuery({
      data: [
        {
          projectId: 1,
          projectName: '上游项目',
          projectStatus: 'active',
          healthStatus: 'healthy',
          progressPercent: 10,
          overdueTaskCount: 0,
          soonDueTaskCount: 0,
          memberCount: 3,
          warnings: [],
        },
      ],
      meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
    }),
  )

  hookMocks.useMpdCreatePreview.mockReturnValue(mutationMock(PREVIEW_ENVELOPE))
  hookMocks.useMpdConfirmCreate.mockReturnValue(mutationMock(CONFIRM_BODY))
  hookMocks.useMpdUpdatePreview.mockReturnValue(mutationMock(PREVIEW_ENVELOPE))
  hookMocks.useMpdConfirmUpdate.mockReturnValue(mutationMock(CONFIRM_BODY))
  hookMocks.useMpdArchivePreview.mockReturnValue(mutationMock(PREVIEW_ENVELOPE))
  hookMocks.useMpdConfirmArchive.mockReturnValue(mutationMock(CONFIRM_BODY))
  hookMocks.useMpdRestorePreview.mockReturnValue(
    mutationMock({
      data: {
        ...PREVIEW_ENVELOPE.data,
        previewId: 'pv-8',
        operation: 'restore',
        diff: {
          before: { status: 'archived' },
          after: { status: 'active' },
          changedFields: ['status'],
        },
      },
    }),
  )
  hookMocks.useMpdConfirmRestore.mockReturnValue(
    mutationMock({
      data: {
        dependency: legacyDep(7, { status: 'active' }),
        auditEventId: 'audit-8',
        idempotentReplay: false,
      },
    }),
  )
  hookMocks.useMpdDeletePreview.mockReturnValue(
    mutationMock({
      data: {
        ...PREVIEW_ENVELOPE.data,
        previewId: 'pv-9',
        operation: 'delete',
        diff: {
          before: { status: 'archived' },
          after: { status: 'deleted' },
          changedFields: ['status'],
        },
      },
    }),
  )
  hookMocks.useMpdConfirmDelete.mockReturnValue(
    mutationMock({
      data: {
        dependency: legacyDep(7, { status: 'deleted' }),
        auditEventId: 'audit-9',
        idempotentReplay: false,
      },
    }),
  )
})

/* ── 用例 ───────────────────────────────────────────────────────────────────── */

describe('PmoDependencies 路由装配与组织引导态', () => {
  test('orgId 未水合 → 组织引导态，list/detail 零调用（RL-06 零发包）', () => {
    setAuth(['portfolio:view'], null)
    renderPage()
    expect(screen.getByText('请先选择组织')).toBeTruthy()
    expect(document.querySelector('[data-org-guide-state]')).not.toBeNull()
    expect(hookMocks.useMpdList).not.toHaveBeenCalled()
    expect(hookMocks.useMpdDetail).not.toHaveBeenCalled()
  })

  test('普通成员（无 portfolio:manage）可读底册：legacy 契约行渲染与双通道徽标', () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({
        data: [
          legacyDep(1),
          legacyDep(2, { status: 'archived', riskLevel: 'critical', freshnessStatus: 'stale' }),
        ],
        meta: metaFixture,
      }),
    )
    renderPage()

    expect(screen.getByText('上游项目 1')).toBeTruthy()
    expect(screen.getByText('下游任务 1')).toBeTruthy()
    // 双通道徽标
    expect(document.querySelector('[data-mpd-risk="high"]')).not.toBeNull()
    expect(document.querySelector('[data-mpd-status="active"]')).not.toBeNull()
    expect(document.querySelector('[data-mpd-risk="critical"]')).not.toBeNull()
    expect(document.querySelector('[data-mpd-status="archived"]')).not.toBeNull()
    expect(document.querySelector('[data-mpd-freshness="stale"]')).not.toBeNull()
    // 分页信息与分页器（meta 信封可用时）
    expect(screen.getByText(/共 25 条/)).toBeTruthy()
    expect(document.querySelector('[data-mpd-pager]')).not.toBeNull()
    // 无 manage：写入口物理隐藏
    expect(document.querySelector('[data-pmo-deps-create]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-archive]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-edit]')).toBeNull()
  })

  test('apiFetch 信封响应（无 meta）与 CRUD 契约行归一兜底', () => {
    const crudRow = {
      id: 'dep-101',
      organizationId: '1',
      provider: {
        type: 'project',
        id: 'p1',
        projectId: '1',
        projectName: 'P 甲',
        label: 'P 甲',
        isRedacted: false,
      },
      consumer: {
        type: 'manual_external',
        id: 'x1',
        projectId: '',
        projectName: '',
        label: 'REDACTED',
        isRedacted: true,
      },
      category: 'schedule',
      type: 'FS',
      lagDays: 3,
      strength: 'moderate',
      bufferDays: 0,
      status: 'active',
      risk: 'medium',
      sourceMode: 'detected',
      freshnessSignature: 's',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      warningCodes: ['CYCLE_DETECTED'],
    }
    // 信封响应（无 meta）+ CRUD 行
    hookMocks.useMpdList.mockReturnValue(
      okQuery({
        data: [legacyDep(5), crudRow] as any,
        meta: null,
      }),
    )
    renderPage()

    expect(screen.getByText('P 甲')).toBeTruthy()
    expect(screen.getByText('已脱敏')).toBeTruthy()
    expect(document.querySelector('[data-mpd-risk="medium"]')).not.toBeNull()
    // CRUD 大写 type 归一（依赖类型列在行内，避免与 legacy 行 FS 文本冲突）
    const crudCell = byData('[data-mpd-row-id="dep-101"]')
    expect(crudCell.textContent).toContain('FS')
    expect(crudCell.textContent).toContain('完成-开始')
    // 无 meta 时退化为单页文本（不渲染分页器、不抛错）
    expect(document.querySelector('[data-mpd-pager]')).toBeNull()
  })

  test('脱敏端点（redacted）行渲染为「已脱敏」并提供受限说明条', () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({
        data: [
          legacyDep(3, {
            providerEndpoint: {
              ...legacyDep(3).providerEndpoint,
              redacted: true,
              projectName: null,
            },
            riskLevel: 'none',
          }),
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    renderPage()
    expect(document.querySelector('[data-mpd-redaction-note]')).not.toBeNull()
    expect(screen.getAllByText('已脱敏').length).toBeGreaterThanOrEqual(1)
  })
})

describe('PmoDependencies 过滤工具栏与 URL 视图态', () => {
  test('筛选交互序列化服务端参数并重置页码；清除筛选还原', () => {
    hookMpdListOk()
    renderPage()

    fireEvent.change(screen.getByLabelText('风险等级筛选'), { target: { value: 'high' } })
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
      riskLevel: 'high',
    })
    // URL 同步
    expect(lastPushQuery().get('riskLevel')).toBe('high')

    fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'at_risk' } })
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
      riskLevel: 'high',
      status: ['at_risk'],
    })
    expect(lastPushQuery().get('status')).toBe('at_risk')
    expect(lastPushQuery().get('riskLevel')).toBe('high')

    fireEvent.change(screen.getByLabelText('依赖类型筛选'), { target: { value: 'fs' } })
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
      riskLevel: 'high',
      status: ['at_risk'],
      type: 'fs',
    })

    // 清除筛选
    fireEvent.click(byData('[data-mpd-filter-clear]'))
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
    })
    expect(lastPushQuery().toString()).toBe('')
  })

  test('搜索输入与端点/来源/新鲜度/日期过滤参数序列化', () => {
    hookMpdListOk()
    renderPage()

    fireEvent.change(screen.getByPlaceholderText('搜索端点/外部标签'), {
      target: { value: '网关' },
    })
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
      search: '网关',
    })

    fireEvent.change(screen.getByLabelText('端点类型筛选'), { target: { value: 'task' } })
    fireEvent.change(screen.getByLabelText('来源模式筛选'), {
      target: { value: 'rule_suggestion' },
    })
    fireEvent.change(screen.getByLabelText('新鲜度筛选'), { target: { value: 'stale' } })
    fireEvent.change(screen.getByLabelText('分类筛选'), { target: { value: 'milestone' } })
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
      search: '网关',
      endpointType: 'task',
      category: 'milestone',
      sourceMode: 'rule_suggestion',
      freshness: 'stale',
    })
  })

  test('排序字段/顺序切换与分页交互同步 URL 与查询参数', () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({ data: [legacyDep(1)], meta: { total: 25, page: 1, perPage: 20, totalPages: 2 } }),
    )
    renderPage()

    // 顺序切换：-createdAt → createdAt（升序）
    fireEvent.click(screen.getByLabelText('切换为升序'))
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: 'createdAt',
    })
    expect(lastPushQuery().get('sort')).toBe('createdAt')

    // 排序字段 → riskLevel（当前升序故无 -）
    fireEvent.change(screen.getByLabelText('排序字段'), { target: { value: 'riskLevel' } })
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: 'riskLevel',
    })

    // 分页（meta.totalPages=2 → 分页器渲染）
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 2,
      perPage: 20,
      sort: 'riskLevel',
    })
    expect(lastPushQuery().get('page')).toBe('2')
    expect(lastPushQuery().get('sort')).toBe('riskLevel')
  })

  test('URL ?view=graph 视图态持久化：graph 面板装配且 list 查询不触发', () => {
    navMocks.params = new URLSearchParams('view=graph')
    renderPage()
    expect(document.querySelector('[data-mpd-graph]')).not.toBeNull()
    expect(document.querySelector('[data-mpd-table]')).toBeNull()
    expect(hookMocks.useMpdList).not.toHaveBeenCalled()
    // 切换回底册 → push view=graph 移除
    fireEvent.click(screen.getByText('底册'))
    expect(navMocks.push).toHaveBeenLastCalledWith('')
  })
})

describe('PmoDependencies 详情抽屉', () => {
  test('行点击打开只读详情抽屉（useMpdDetail 参数）并可关闭', async () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({ data: [legacyDep(3)], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } }),
    )
    hookMocks.useMpdDetail.mockReturnValue(okQuery(legacyDep(3)))
    renderPage()

    fireEvent.click(screen.getAllByLabelText('查看详情')[0]!)
    await waitFor(() => {
      expect(hookMocks.useMpdDetail).toHaveBeenCalledWith(1, '3')
    })
    expect(document.querySelector('[data-mpd-detail-drawer]')).not.toBeNull()
    expect(screen.getByText('依赖详情')).toBeTruthy()
    // 只读：抽屉无任何写按钮
    expect(
      document.querySelector('[data-mpd-detail-drawer] button[data-mpd-row-archive]'),
    ).toBeNull()

    fireEvent.click(screen.getByLabelText('关闭'))
    expect(document.querySelector('[data-mpd-detail-drawer]')).toBeNull()
  })

  test('详情接口 404/403 → 中性文案（RL-05），重试可重新请求', async () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({ data: [legacyDep(4)], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } }),
    )
    const refetch = vi.fn()
    hookMocks.useMpdDetail.mockReturnValue(
      okQuery(undefined, {
        isError: true,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'x' },
        refetch,
      }),
    )
    renderPage()

    fireEvent.click(screen.getAllByLabelText('查看详情')[0]!)
    await waitFor(() => {
      expect(document.querySelector('[data-mpd-detail-drawer]')).not.toBeNull()
    })
    expect(screen.getByText('数据不存在或无权访问')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('重新加载详情'))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('PmoDependencies 预览→确认写闭环', () => {
  test('成员无 manage：全部写入口隐藏，交互全程零写调用（RL-06）', async () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({ data: [legacyDep(1), legacyDep(2, { status: 'archived' })], meta: metaFixture }),
    )
    renderPage()

    expect(document.querySelector('[data-pmo-deps-create]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-archive]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-restore]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-delete]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-edit]')).toBeNull()

    // 只读浏览：点击行详情后仍零写（mutation 内层函数零调用）
    fireEvent.click(screen.getAllByLabelText('查看详情')[0]!)
    await waitFor(() => {
      expect(hookMocks.useMpdDetail).toHaveBeenCalled()
    })
    for (const name of [
      'useMpdCreatePreview',
      'useMpdConfirmCreate',
      'useMpdArchivePreview',
      'useMpdConfirmArchive',
      'useMpdRestorePreview',
      'useMpdConfirmRestore',
      'useMpdDeletePreview',
      'useMpdConfirmDelete',
      'useMpdUpdatePreview',
      'useMpdConfirmUpdate',
    ]) {
      expect(
        mutationOf(hookMocks[name as keyof typeof hookMocks]).mutateAsync,
      ).not.toHaveBeenCalled()
    }
  })

  test('归档：预览 Diff 展示 → 人工确认才落库（confirm 前零写）', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'], 1)
    hookMocks.useMpdList.mockReturnValue(
      okQuery({ data: [legacyDep(7)], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } }),
    )
    renderPage()

    // 确认前：无任何 confirm 调用
    expect(mutationOf(hookMocks.useMpdConfirmArchive).mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('归档依赖 7'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdArchivePreview).mutateAsync).toHaveBeenCalledWith('7')
    })
    // confirm 仍未调用（预览 ≠ 落库）
    expect(mutationOf(hookMocks.useMpdConfirmArchive).mutateAsync).not.toHaveBeenCalled()

    // 确认对话框：Diff 对照 + 警告 + 操作语义
    // （预览 mutation 落定后 setFlow 在微任务链上推进，先等对话框挂载再同步断言）
    await waitFor(() => {
      expect(screen.getByText('确认执行 · 归档依赖')).toBeTruthy()
    })
    expect(document.querySelector('[data-mpd-diff-row="状态"]')).not.toBeNull()
    expect(screen.getAllByText('活跃').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已归档').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-mpd-warning-code="DEPENDENCY_STALE"]')).not.toBeNull()
    expect(screen.getByText(/预览过期时间/)).toBeTruthy()

    // 取消 → 零写
    fireEvent.click(screen.getByText('取消（不落库）'))
    expect(mutationOf(hookMocks.useMpdConfirmArchive).mutateAsync).not.toHaveBeenCalled()
    expect(document.querySelector('[data-mpd-confirm-execute]')).toBeNull()

    // 再次进入并确认
    fireEvent.click(screen.getByLabelText('归档依赖 7'))
    await waitFor(() => {
      expect(screen.getByText('确认执行 · 归档依赖')).toBeTruthy()
    })
    fireEvent.click(byData('[data-mpd-confirm-execute]'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdConfirmArchive).mutateAsync).toHaveBeenCalledWith({
        previewId: 'pv-7',
        confirmationHash: 'hash-7',
        idempotencyKey: expect.stringMatching(/^mpd-archive-/),
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/依赖已归档成功 · #7 · 审计事件 audit-7/)).toBeTruthy()
    })
    // 对话框已关闭
    expect(document.querySelector('[data-mpd-confirm-execute]')).toBeNull()
  })

  test('恢复与删除入口按状态显隐（archived 行）；删除需红色确认', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'], 1)
    hookMocks.useMpdList.mockReturnValue(
      okQuery({
        data: [
          legacyDep(7, { status: 'archived', riskLevel: 'low' }),
          legacyDep(8, { status: 'archived' }),
        ],
        meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    renderPage()

    expect(screen.queryAllByLabelText(/归档依赖/)).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('恢复依赖 7'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdRestorePreview).mutateAsync).toHaveBeenCalledWith('7')
    })
    expect(mutationOf(hookMocks.useMpdConfirmRestore).mutateAsync).not.toHaveBeenCalled()
    await waitFor(() => expect(byData('[data-mpd-confirm-execute]')).toBeTruthy())
    fireEvent.click(byData('[data-mpd-confirm-execute]'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdConfirmRestore).mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ previewId: 'pv-8', confirmationHash: 'hash-7' }),
      )
    })
    await waitFor(() => {
      expect(screen.getByText(/依赖已恢复成功 · #7/)).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('删除依赖 8'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdDeletePreview).mutateAsync).toHaveBeenCalledWith('8')
    })
    expect(screen.getByText('确认删除')).toBeTruthy()
    fireEvent.click(screen.getByText('确认删除'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdConfirmDelete).mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ previewId: 'pv-9' }),
      )
    })
  })

  test('新建依赖：表单校验（端点缺失拒绝）→ 预览 → 确认全链路由人工触发', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'], 1)
    hookMpdListOk()
    renderPage()

    fireEvent.click(byData('[data-pmo-deps-create]'))
    expect(screen.getByText('新建跨项目依赖')).toBeTruthy()

    // 端点 ID 缺失 → 前端校验拦截，预览零调用
    fireEvent.click(byData('[data-mpd-create-preview]'))
    expect(screen.getByText(/请填写提供方端点 ID/)).toBeTruthy()
    expect(mutationOf(hookMocks.useMpdCreatePreview).mutateAsync).not.toHaveBeenCalled()

    // 消费方端点类型切到 task，再填端点 ID
    fireEvent.change(byData('[data-mpd-create-consumer-type]'), { target: { value: 'task' } })
    const inputs = Array.from(
      document.querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[]
    fireEvent.change(inputs[0]!, { target: { value: '1' } })
    fireEvent.change(inputs[1]!, { target: { value: '5' } })
    fireEvent.click(byData('[data-mpd-create-preview]'))

    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdCreatePreview).mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerEndpointType: 'project',
          providerProjectId: 1,
          consumerEndpointType: 'task',
          consumerTaskId: 5,
          category: 'deliverable',
          type: 'fs',
          riskLevel: 'none',
          sourceMode: 'manual',
          strength: 'hard',
        }),
      )
    })
    expect(mutationOf(hookMocks.useMpdConfirmCreate).mutateAsync).not.toHaveBeenCalled()

    // 确认落库
    await waitFor(() => expect(byData('[data-mpd-confirm-execute]')).toBeTruthy())
    fireEvent.click(byData('[data-mpd-confirm-execute]'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdConfirmCreate).mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ previewId: 'pv-7', confirmationHash: 'hash-7' }),
      )
    })
    await waitFor(() => {
      expect(screen.getByText(/依赖已创建成功 · #7/)).toBeTruthy()
    })
  })

  test('编辑（update）流程：预填行值 → 预览 Diff → 人工确认', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'], 1)
    hookMocks.useMpdList.mockReturnValue(
      okQuery({
        data: [legacyDep(12, { riskLevel: 'low' })],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    renderPage()

    fireEvent.click(screen.getByLabelText('编辑依赖 12'))
    expect(screen.getByText(/更新跨项目依赖/)).toBeTruthy()
    // 预填：当前风险值
    const riskSelect = byData('[data-mpd-update-risk]') as HTMLSelectElement
    expect(riskSelect.value).toBe('low')

    fireEvent.change(riskSelect, { target: { value: 'high' } })
    fireEvent.click(byData('[data-mpd-update-preview]'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdUpdatePreview).mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ dependencyId: 12, riskLevel: 'high', category: 'deliverable' }),
      )
    })
    expect(mutationOf(hookMocks.useMpdConfirmUpdate).mutateAsync).not.toHaveBeenCalled()

    await waitFor(() => expect(byData('[data-mpd-confirm-execute]')).toBeTruthy())
    fireEvent.click(byData('[data-mpd-confirm-execute]'))
    await waitFor(() => {
      expect(mutationOf(hookMocks.useMpdConfirmUpdate).mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ previewId: 'pv-7' }),
      )
    })
  })
})

describe('PmoDependencies 空态与错误态', () => {
  test('列表错误 → 错误卡 + 重试重新触发查询', () => {
    const refetch = vi.fn()
    hookMocks.useMpdList.mockReturnValue(
      okQuery(undefined, {
        isError: true,
        error: { code: 'UNKNOWN', message: '网络异常' },
        refetch,
      }),
    )
    renderPage()
    expect(screen.getByText('依赖底册加载失败')).toBeTruthy()
    fireEvent.click(screen.getByText('重新加载'))
    expect(refetch).toHaveBeenCalled()
  })

  test('FEATURE_DISABLED → 诚实降级说明（不伪造数据）', () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery(undefined, { isError: true, error: { code: 'FEATURE_DISABLED', message: 'x' } }),
    )
    renderPage()
    expect(screen.getByText('跨项目依赖功能未启用')).toBeTruthy()
    expect(screen.getByText(/FEATURE_MPD_CRUD/)).toBeTruthy()
  })

  test('筛选无匹配空态与语义文案；清除筛选按钮回归默认查询', () => {
    hookMocks.useMpdList.mockReturnValue(
      okQuery({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    navMocks.params = new URLSearchParams('status=blocked')
    renderPage()
    expect(screen.getByText('未找到匹配的依赖记录')).toBeTruthy()
    fireEvent.click(byData('[data-mpd-table-clear-empty]'))
    expect(hookMocks.useMpdList).toHaveBeenLastCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: '-createdAt',
    })
    expect(navMocks.push).toHaveBeenLastCalledWith('')
  })
})

/* ── 辅助 ───────────────────────────────────────────────────────────────────── */
function hookMpdListOk() {
  hookMocks.useMpdList.mockReturnValue(okQuery({ data: [], meta: metaFixture }))
}

/** document.querySelector 快捷（错误即失败，避免链式 as 转换噪音）。 */
function byData(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`未找到元素：${selector}`)
  return element
}

/** 取某 hook mock 返回的 mutation 对象（mockReturnValue 常量化，取首个 result 即可）。 */
function mutationOf(hook: ReturnType<typeof vi.fn>): {
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
} {
  const value = hook.mock.results[0]?.value as {
    mutateAsync: ReturnType<typeof vi.fn>
    isPending: boolean
  }
  if (!value?.mutateAsync)
    throw new Error('mutation mock 尚未初始化（需在 beforeEach 设置 mockReturnValue）')
  return value
}

/** 最近一次 router.push 的 query 解析。 */
function lastPushQuery(): URLSearchParams {
  const call = navMocks.push.mock.calls.at(-1)?.[0]
  return new URLSearchParams(typeof call === 'string' ? call : '')
}
