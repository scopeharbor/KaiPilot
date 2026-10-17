/**
 * v3-ui-next-org-portfolio-domains W7 · tasks 7.4 —— 跨项目调配草案工作台组件测试
 * （AllocationWorkspace + 编辑器 + 候选面板 + 二次确认弹窗，真实 hooks + 伪后端）。
 *
 * 覆盖（spec「跨项目资源调配草案工作台」场景 / design Decision 6）：
 * - 草案列表与状态徽标渲染、URL `?draft=` 选中恢复与跳转；
 * - 候选检索（技能关键词过滤为客户端纯函数）全程零写请求（RL-01）；
 * - 逐项编排：添加调配项 / 移除行 / 保存 PUT items 全量替换，成功反馈；
 * - 预览 → 影响摘要回显（冲突严重度徽标、预览哈希/过期时间、零自动写）；
 * - 二次确认阻断语义：弹窗内「返回核对」不发出写请求，确认后才 POST；
 * - 无写权限（仅 resource:view）：新建/编排/预览/确认/应用/取消全部物理隐藏，
 *   网络写请求恒为 0（RL-06）；
 * - 详情 404（跨租户/不存在）中性「草案不存在或已被移除」态（RL-05）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { AllocationWorkspace } from '@/components/next/org-allocation/AllocationWorkspace'
import type {
  CrossProjectAllocationCandidateResource,
  CrossProjectAllocationDraft,
  CrossProjectAllocationDraftDetail,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock（searchParams 可改写以模拟 ?draft= 恢复）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const spMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/cross-project-resource-allocation',
  useParams: () => ({}),
  useSearchParams: () => spMock.value,
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

const baseQueryShape = {
  organizationId: 1,
  projectIds: [9, 10],
  dateWindow: { from: '2026-09-01', to: '2026-11-30' },
  resourceTypes: [],
  roles: [],
  skillTags: [],
  departments: [],
  loadStatuses: [],
  conflictSeverities: [],
  draftStatuses: [],
  search: null,
  sort: 'created_at' as const,
  sortDir: 'desc' as const,
  page: 1,
  perPage: 20,
  topN: 10,
  freshnessThresholdMinutes: 60,
}

function makeDraft(
  overrides: Partial<CrossProjectAllocationDraft> = {},
): CrossProjectAllocationDraft {
  return {
    id: '2',
    organizationId: 1,
    status: 'draft',
    name: 'Q3 前端人力调配',
    queryShape: baseQueryShape,
    itemCount: 1,
    evidence: null,
    previewHash: null,
    previewExpiresAt: null,
    warnings: [],
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  }
}

const draftItem = {
  id: 'i1',
  itemType: 'allocate',
  status: 'pending',
  demand: {
    id: 'd1',
    targetProjectId: 9,
    targetProjectName: '商城重构',
    targetTaskId: 51,
    targetTaskName: '订单列表重构',
    requiredSkillTags: ['React'],
    requiredHours: 120,
    requiredRole: '前端工程师',
    startDate: '2026-09-01',
    endDate: '2026-11-30',
    priority: 2,
    currentAllocationPercent: 0,
  },
  candidate: {
    resourceId: 12,
    resourceName: '赵前端',
    redaction: 'visible',
    sourceProjectId: 9,
    sourceProjectName: '商城重构',
    remainingCapacityHours: 80,
    dailyCapacityHours: 8,
    skillTags: ['React'],
    skillFitPercent: 92,
    availabilitySlots: [],
    unavailableDates: [],
    currentUtilizationPercent: 40,
    afterAllocationUtilizationPercent: null,
    pmoPriorityScore: null,
    source: 'rule',
    rationale: '当前负荷 40%，技能匹配 92%',
  },
  allocationPercent: 80,
  startDate: '2026-09-01',
  endDate: '2026-11-30',
  conflicts: [],
  source: 'rule',
  advisoryOnly: false,
  confirmationRequired: true,
  applied: false,
  createdAt: '2026-09-01T02:00:00.000Z',
  updatedAt: '2026-09-01T02:00:00.000Z',
}

function makeDraftDetail(
  overrides: Partial<CrossProjectAllocationDraftDetail> = {},
): CrossProjectAllocationDraftDetail {
  return {
    ...makeDraft(),
    items: [draftItem as CrossProjectAllocationDraftDetail['items'][number]],
    confirmation: null,
    applyResult: null,
    ...overrides,
  } as CrossProjectAllocationDraftDetail
}

function makeCandidate(
  overrides: Partial<CrossProjectAllocationCandidateResource> = {},
): CrossProjectAllocationCandidateResource {
  return {
    resourceId: 21,
    resourceName: '孙全栈',
    redaction: 'visible',
    sourceProjectId: 10,
    sourceProjectName: '支付中台',
    remainingCapacityHours: 90,
    dailyCapacityHours: 8,
    skillTags: ['React', 'Go'],
    skillFitPercent: 85,
    availabilitySlots: [],
    unavailableDates: [],
    currentUtilizationPercent: 25,
    afterAllocationUtilizationPercent: null,
    pmoPriorityScore: null,
    source: 'rule',
    rationale: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 伪后端（跨项目调配端点；响应形态贴近真实后端 controller 单层包裹——apiFetch
// 自动解包后运行时为裸载荷/数组，工作台按该运行时形态直连 lib/api，不做二次解包）
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

type RouteFn = (path: string, method: string, body?: unknown) => Response | null

function installFetchRouter(route: RouteFn): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method, init?.body)
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

interface BackendState {
  detail: CrossProjectAllocationDraftDetail
  draftList: CrossProjectAllocationDraft[]
  previewCount: number
  itemPutBody: { items: unknown[] } | null
}

/** 标准工作台伪后端：读 list/detail/candidates，写 create/items/preview/confirm/apply/cancel。 */
function createWorkbenchBackend(state: BackendState): RouteFn {
  return (path: string, method: string, bodyParam?: unknown): Response | null => {
    const base = '/organizations/1/cross-project-resource-allocations'
    // 响应形态贴近真实后端（cross_project_allocation_controller.ts 单层包裹）：
    // 列表 = listDrafts 走 apiFetchEnvelope，{data, meta} 信封保真（运行时按 .data/.meta 读）；
    // 详情/写端点 = 单层 {data: X}（apiFetch 解包 → 运行时裸载荷）。
    // 工作台必须在该运行时形态下工作——不得依赖「双层信封 + .data 二次解包」。
    if (
      (method === 'GET' && path.startsWith(`${base}/drafts?`)) ||
      (method === 'GET' && path === `${base}/drafts`)
    ) {
      return jsonResponse(200, {
        data: state.draftList,
        meta: { total: state.draftList.length, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    if (method === 'GET' && path.startsWith(`${base}/candidates`)) {
      const candidates = [
        makeCandidate({ resourceId: 21, skillTags: ['React', 'Go'] }),
        makeCandidate({
          resourceId: 22,
          resourceName: '周数据',
          skillTags: ['SQL'],
          sourceProjectId: 10,
        }),
      ]
      return jsonResponse(200, {
        data: candidates,
        meta: { total: candidates.length, topN: 20, hasMore: false },
      })
    }
    const draftDetailMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)$/.exec(path)
    if (method === 'GET' && draftDetailMatch) {
      if (state.detail.id === draftDetailMatch[1]) {
        return jsonResponse(200, { data: state.detail })
      }
      return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '草案不存在' } })
    }
    if (method === 'POST' && path === `${base}/drafts`) {
      const created = makeDraft({ id: '7', name: '调配方案 2026/9/1' })
      state.detail = makeDraftDetail({ id: '7', name: '调配方案 2026/9/1' })
      return jsonResponse(201, { data: created })
    }
    const actionMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)\/(preview|confirm|apply|cancel)$/.exec(
        path,
      )
    const itemsMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)\/items$/.exec(path)
    if (method === 'PUT' && itemsMatch) {
      // 记录 body 并让详情回到 draft（服务端语义：清预览 + 状态回退）
      const body = (typeof bodyParam === 'string' ? JSON.parse(bodyParam) : (bodyParam ?? {})) as {
        items: unknown[]
      }
      state.itemPutBody = body
      state.detail = makeDraftDetail({ status: 'draft', previewHash: null, previewExpiresAt: null })
      return jsonResponse(200, { data: [draftItem] })
    }
    if (method === 'POST' && actionMatch && actionMatch[2] === 'preview') {
      const draftIdFromPath = actionMatch[1]!
      state.previewCount += 1
      state.detail = makeDraftDetail({
        id: draftIdFromPath,
        status: 'previewed',
        previewHash: 'abc123def456',
        previewExpiresAt: '2026-09-30T00:00:00.000Z',
      })
      return jsonResponse(200, {
        data: {
          draftId: draftIdFromPath,
          status: 'previewed',
          items: [draftItem],
          conflicts: [
            {
              severity: 'warning',
              code: 'SOURCE_PARTIAL',
              message: '部分来源数据不完整',
              affectedDates: [],
              affectedProjectIds: [9],
              redaction: 'visible',
            },
            {
              severity: 'info',
              code: 'SOURCE_STALE',
              message: '资源底册存在陈旧数据',
              affectedDates: [],
              affectedProjectIds: [],
              redaction: 'visible',
            },
          ],
          affectedVisibleProjects: [
            { projectId: 9, projectName: '商城重构', redaction: 'visible' },
          ],
          evidence: {
            references: [],
            sourceSignatures: {},
            freshness: [],
            warnings: [],
            evidenceHash: 'ev-hash',
            computedAt: '2026-09-01T03:00:00.000Z',
          },
          previewHash: 'abc123def456',
          previewExpiresAt: '2026-09-30T00:00:00.000Z',
          warnings: [],
        },
      })
    }
    if (method === 'POST' && actionMatch && actionMatch[2] === 'confirm') {
      const draftIdFromPath = actionMatch[1]!
      state.detail = makeDraftDetail({
        id: draftIdFromPath,
        status: 'confirmed',
        confirmation: {
          id: 'c1',
          draftId: draftIdFromPath,
          actorId: 1,
          organizationId: 1,
          visibleTargetProjectIds: [9],
          itemIds: ['i1'],
          previewHash: 'abc123def456',
          queryShape: baseQueryShape,
          warnings: [],
          idempotencyKeyHash: 'hash',
          confirmedAt: '2026-09-01T04:00:00.000Z',
        },
      })
      return jsonResponse(200, { data: { id: 'c1', confirmedAt: '2026-09-01T04:00:00.000Z' } })
    }
    if (method === 'POST' && actionMatch && actionMatch[2] === 'apply') {
      const draftIdFromPath = actionMatch[1]!
      state.detail = makeDraftDetail({
        id: draftIdFromPath,
        status: 'applied',
        applyResult: {
          status: 'success',
          draftId: draftIdFromPath,
          confirmationId: 'c1',
          itemResults: [
            {
              itemId: 'i1',
              status: 'applied',
              targetProjectId: 9,
              targetAllocationId: 321,
              errorCode: null,
            },
          ],
          idempotencyKeyHash: 'hash',
          appliedAt: '2026-09-01T05:00:00.000Z',
          warnings: [],
        },
      })
      return jsonResponse(200, {
        data: { status: 'success', appliedAt: '2026-09-01T05:00:00.000Z' },
      })
    }
    if (method === 'POST' && actionMatch && actionMatch[2] === 'cancel') {
      state.detail = makeDraftDetail({ id: actionMatch[1]!, status: 'cancelled' })
      return jsonResponse(200, { data: { status: 'cancelled' } })
    }
    return null
  }
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  spMock.value = new URLSearchParams()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

afterEach(() => {
  resetFetchRouter()
})

function newBackendState(): BackendState {
  return {
    detail: makeDraftDetail(),
    draftList: [
      makeDraft({ id: '2', name: 'Q3 前端人力调配', status: 'draft' }),
      makeDraft({ id: '3', name: '容量环联动草案', status: 'applied', queryShape: baseQueryShape }),
    ],
    previewCount: 0,
    itemPutBody: null,
  }
}

// ---------------------------------------------------------------------------
describe('草案列表与 URL 选中状态', () => {
  test('授权写用户：渲染列表行、状态徽标；点击行写入 ?draft= 并加载详情事实', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-draft-row]')).toHaveLength(2),
    )
    expect(
      document.querySelector('[data-allocation-status-badge][data-status="applied"]')?.textContent,
    ).toContain('已应用')

    // 默认未选中：引导态且零详情请求
    expect(document.querySelector('[data-allocation-detail-idle]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-allocation-draft-row="2"]')!)
    expect(navMock.push).toHaveBeenCalledWith('?draft=2')
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-detail-facts]')).not.toBeNull(),
    )
    // 详情事实区标题与列表行同名——以详情容器内 h3 断言
    expect(document.querySelector('[data-allocation-detail-facts] h3')?.textContent).toBe(
      'Q3 前端人力调配',
    )
    expect(
      records.some((record) => /\/drafts\/2$/.test(record.url) && record.method === 'GET'),
    ).toBe(true)
    expect(writeMethods(records)).toEqual([])
  })

  test('URL ?draft= 恢复选中：刷新后直接加载详情（restorable filters）', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-detail-facts]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-allocation-detail-status]')?.getAttribute('data-status'),
    ).toBe('draft')
  })

  test('详情 404（跨租户/不存在）：中性「草案不存在或已被移除」且零写请求（RL-05）', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    state.draftList = [makeDraft({ id: '9' })]
    // 后端不存在草案 #9（详情 fixture id='2'）：GET /drafts/9 返回 404
    spMock.value = new URLSearchParams('draft=9')
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(
      () => expect(document.querySelector('[data-allocation-detail-notfound]')).not.toBeNull(),
      { timeout: 2000 },
    )
    expect(screen.getByText('草案不存在或已被移除')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('候选检索只读与技能过滤（RL-01）', () => {
  test('展开候选池：请求 candidates 且渲染按项目分组卡片；关键词过滤为纯客户端', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-draft-editor]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-candidate-toggle]')!)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-candidate]')).toHaveLength(2),
    )
    expect(screen.getByText('支付中台')).toBeInTheDocument()

    // 技能过滤（客户端）：仅 React 候选保留
    fireEvent.change(document.querySelector('[data-allocation-candidate-search]')!, {
      target: { value: 'sql' },
    })
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-candidate]')).toHaveLength(1),
    )
    expect(document.querySelectorAll('[data-allocation-candidate]')[0]?.textContent).toContain(
      '周数据',
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('逐项编排：添加 / 移除 / 保存 PUT（写请求显式触发）', () => {
  test('添加调配项并保存：PUT items 全量替换载荷与成功反馈', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-item-row="i1"]')).not.toBeNull(),
    )
    // 添加行（新建行需目标项目 ID）
    fireEvent.click(document.querySelector('[data-allocation-item-add]')!)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-item-row]')).toHaveLength(2),
    )
    const projectInput = document.querySelector('[data-allocation-item-project]')!
    expect(projectInput).not.toBeNull()
    fireEvent.change(projectInput, { target: { value: '10' } })
    // 比例输入定位到「新行」内部（既有行同样渲染比例输入，避免误改 i1）
    const newRow = projectInput.closest('[data-allocation-item-row]')!
    const newRowPercent = newRow.querySelector('[data-allocation-item-percent]')!
    fireEvent.change(newRowPercent, { target: { value: '60' } })

    fireEvent.click(document.querySelector('[data-allocation-editor-save]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-editor-saved]')).not.toBeNull(),
    )

    const putRecords = records.filter((record) => record.method === 'PUT')
    expect(putRecords).toHaveLength(1)
    expect(putRecords[0]!.url).toContain('/drafts/2/items')
    expect(state.itemPutBody?.items).toHaveLength(2)
    const added = (state.itemPutBody!.items as Array<Record<string, unknown>>)[1]!
    expect(added.targetProjectId).toBe(10)
    expect(added.allocationPercent).toBe(60)
    // 服务端状态回 draft：详情查询失效后自动刷新（缓存一致性）
    await waitFor(() =>
      expect(
        document.querySelector('[data-allocation-detail-status]')?.getAttribute('data-status'),
      ).toBe('draft'),
    )
  })

  test('移除行后保存：载荷只含保留行', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-item-remove="i1"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-item-remove="i1"]')!)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-allocation-item-row]')).toHaveLength(0),
    )
    // 无行时保存禁用
    expect(
      (document.querySelector('[data-allocation-editor-save]') as HTMLButtonElement).disabled,
    ).toBe(true)
    // 空态引导文案
    expect(screen.getByText('草案暂无调配项')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
describe('写路径闭环：预览 → 摘要回显 → 确认 → 应用 → 取消（全部二次确认）', () => {
  test('预览：确认弹窗阻断-生成 → 影响摘要回显冲突严重度徽标与哈希', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-action-preview]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-action-preview]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-confirm-dialog]')).not.toBeNull(),
    )

    // 阻断语义：关闭（返回核对）→ 零 preview 请求
    fireEvent.click(document.querySelector('[data-allocation-confirm-cancel]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-confirm-dialog]')).toBeNull(),
    )
    expect(state.previewCount).toBe(0)

    // 重新打开并确认 → POST preview 一次
    fireEvent.click(document.querySelector('[data-allocation-action-preview]')!)
    fireEvent.click(document.querySelector('[data-allocation-confirm-submit]')!)
    await waitFor(() => expect(state.previewCount).toBe(1))

    // 影响摘要回显：冲突徽标 + 预览哈希 + 过期时间
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-preview-summary]')).not.toBeNull(),
    )
    expect(screen.getByText('影响预览摘要')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-preview-conflict]')).toHaveLength(2)
    expect(
      document.querySelector('[data-preview-conflict][data-conflict-severity="warning"]')
        ?.textContent,
    ).toContain('警告')
    expect(screen.getAllByText(/预览哈希/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/过期/).length).toBeGreaterThan(0)
    // 二次确认只发出一次 preview POST；无其他写请求
    expect(
      records.filter((record) => record.method === 'POST' && record.url.includes('/preview')),
    ).toHaveLength(1)
  })

  test('确认 → 应用：状态推进并在动作条逐步出现下一动作；失败在弹窗行内回显', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    // 推进到 previewed
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-action-preview]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-action-preview]')!)
    fireEvent.click(document.querySelector('[data-allocation-confirm-submit]')!)
    await waitFor(() => expect(state.previewCount).toBe(1))

    // 确认
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-action-confirm]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-action-confirm]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-confirm-submit]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-confirm-submit]')!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-allocation-detail-status]')?.getAttribute('data-status'),
      ).toBe('confirmed'),
    )
    expect(document.querySelector('[data-allocation-confirmation-facts]')).not.toBeNull()

    // 应用（成功后 apply 结果事实区回显 + status applied）
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-action-apply]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-action-apply]')!)
    fireEvent.click(document.querySelector('[data-allocation-confirm-submit]')!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-allocation-detail-status]')?.getAttribute('data-status'),
      ).toBe('applied'),
    )
    expect(
      document.querySelector('[data-allocation-apply-result]')?.getAttribute('data-apply-status'),
    ).toBe('success')
    expect(screen.getByText(/应用结果：成功/)).toBeInTheDocument()
    expect(screen.getByText(/已应用，正式资源记录写入完成/)).toBeInTheDocument()
  })

  test('取消草案：弹窗内返回核对不发出请求；确认后 POST cancel 且状态回显已取消', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-action-cancel]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-action-cancel]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-confirm-dialog]')).not.toBeNull(),
    )
    expect(screen.getByText('取消调配草案')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-allocation-confirm-cancel]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-confirm-dialog]')).toBeNull(),
    )
    expect(records.filter((record) => record.url.includes('/cancel'))).toHaveLength(0)

    fireEvent.click(document.querySelector('[data-allocation-action-cancel]')!)
    fireEvent.click(document.querySelector('[data-allocation-confirm-submit]')!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-allocation-detail-status]')?.getAttribute('data-status'),
      ).toBe('cancelled'),
    )
    expect(
      records.filter((record) => record.method === 'POST' && record.url.includes('/cancel')),
    ).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('无写权限（仅 resource:view）：写入口物理隐藏且写请求恒为 0（RL-06）', () => {
  test('新建/编排/动作条全部不渲染；网络零写请求', async () => {
    setAuth(['resource:view'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() =>
      expect(document.querySelector('[data-allocation-detail-facts]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-allocation-create]')).toBeNull()
    expect(document.querySelector('[data-allocation-action-bar]')).toBeNull()
    expect(document.querySelector('[data-allocation-item-add]')).toBeNull()
    expect(document.querySelector('[data-allocation-editor-save]')).toBeNull()
    expect(document.querySelector('[data-allocation-write-scope]')).toBeNull()
    // 编辑器只读标记
    expect(document.querySelector('[data-allocation-editor-mode]')?.textContent).toContain('只读')
    // 行内百分比/日期输入不渲染（无编辑控件）
    expect(document.querySelector('[data-allocation-item-percent="i1"]')).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeMethods(records)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('单层信封运行时形态回归（Major-1：无 `.data` 二次解包）', () => {
  test('新建返回草案 ID、详情回显、预览摘要回显——全链以真实后端单层信封工作', async () => {
    setAuth(['resource:view', 'resource:manage'])
    const state = newBackendState()
    const { records } = installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() => expect(document.querySelector('[data-allocation-create]')).not.toBeNull())
    // 新建：POST /drafts 单层 {data: draft} → 运行时裸载荷，直接取 id（不得
    // 误报「创建草案失败」，也不得 Number(undefined) → NaN）。
    fireEvent.click(document.querySelector('[data-allocation-create]')!)
    await waitFor(() =>
      expect(
        screen.getByText('已创建草案 #7，可在下方逐项编排后生成影响预览。'),
      ).toBeInTheDocument(),
    )
    expect(navMock.push).toHaveBeenCalledWith('?draft=7')
    // 详情（单层信封解包后的裸载荷）真实回显，而非恒 null 落到错误态。
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-detail-facts]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-allocation-detail-facts] h3')?.textContent).toBe(
      '调配方案 2026/9/1',
    )

    // 预览：POST preview 单层 {data: preview} → 摘要回显（既有二次解包实现下
    // 运行时结果为 undefined，预览永不回显——此断言为回归锁）。
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-action-preview]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-action-preview]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-confirm-submit]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-allocation-confirm-submit]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-preview-summary]')).not.toBeNull(),
    )
    expect(document.querySelectorAll('[data-preview-conflict]')).toHaveLength(2)
    expect(screen.getAllByText(/预览哈希/).length).toBeGreaterThan(0)

    const previewPosts = records.filter(
      (record) => record.method === 'POST' && record.url.includes('/preview'),
    )
    expect(previewPosts).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('portfolio:view 仅持用户被镜像放行写（design Decision 6 核对点）', () => {
  test('仅 portfolio:view：新建/预览按钮可见（与后端 policy 口径一致）', async () => {
    setAuth(['portfolio:view'])
    const state = newBackendState()
    spMock.value = new URLSearchParams('draft=2')
    installFetchRouter(createWorkbenchBackend(state))
    renderWithClient(<AllocationWorkspace />)

    await waitFor(() => expect(document.querySelector('[data-allocation-create]')).not.toBeNull())
    await waitFor(() =>
      expect(document.querySelector('[data-allocation-detail-facts]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-allocation-action-preview]')).not.toBeNull()
    expect(screen.getByText(/写权限口径与后端一致/)).toBeInTheDocument()
  })
})
