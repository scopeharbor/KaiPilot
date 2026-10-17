/**
 * v3-ui-next-chart-gallery W4 · tasks 4.3 / 4.7 —— 风险登记表 + 5×5 矩阵镜头
 * （联动过滤 / 受控增删改闭环 / RBAC 权限）与经典看板直达卡片测试。
 *
 * 测试策略：api 层走真实模块（lib/api/risks），网络层 stub 全局 fetch，由内存
 * 「伪后端」按既有端点语义响应（列表分页 / matrix 重算 / POST/PATCH/DELETE 写库），
 * 从而能精确断言请求方法、载荷与缓存失效后的联动刷新（RL-01/RL-04/RL-06）。
 *
 * 覆盖：
 * - 无权（无 risk:view）物理阻断 + 零数据请求；
 * - 5×5 矩阵与登记底册协同渲染（25 格 + 计数 + 色带）；
 * - 点击高危单元格联动收敛登记表 + 清除筛选恢复全量；
 * - 无 risk:manage 时编辑入口物理隐藏（只读行）；
 * - 受控新增闭环：POST /risks → 底册追加 + 矩阵计数联动 +1；
 * - 行内编辑闭环：状态机推进（POST /risks/:id/status）与概率/影响/缓解措施
 *   （PATCH /risks/:id），成功后矩阵计数联动迁移；
 * - 两步确认删除（DELETE /risks/:id）；
 * - risk:update_own 本人负责行仅可编辑非状态字段；
 * - 只读交互（点击矩阵/筛选/翻页）零写请求；
 * - 看板直达卡片：平滑 push 至 /next/projects/:id?lens=kanban，历史保留。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { RiskRegisterChartLens } from '@/components/next/charts/RiskRegisterChartLens'
import { KanbanRedirectCard } from '@/components/next/charts/KanbanRedirectCard'
import { RISK_ALLOWED_TRANSITIONS } from '@aiproj/types'
import type { Risk, RiskCategory, RiskStatus } from '@/lib/api/risks'

// ---------------------------------------------------------------------------
// next/navigation mock（仅看板直达卡消费）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 风险实体工厂
// ---------------------------------------------------------------------------
let nextRiskId = 1000

function makeRisk(overrides: Partial<Risk>): Risk {
  const probability = overrides.probability ?? 3
  const impact = overrides.impact ?? 3
  const now = '2026-09-01T00:00:00.000Z'
  return {
    organizationId: 1,
    projectId: 42,
    riskCode: null,
    title: '未命名风险',
    description: '',
    category: 'technical',
    probability,
    impact,
    status: 'identified',
    mitigationStrategy: null,
    contingencyPlan: null,
    ownerId: null,
    triggerEvent: null,
    residualProbability: null,
    residualImpact: null,
    residualScore: null,
    identifiedAt: now,
    targetResolutionDate: null,
    resolvedAt: null,
    relatedTaskId: null,
    aiMetadata: null,
    createdBy: 1,
    updatedBy: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    id: overrides.id ?? nextRiskId++,
    score: overrides.score ?? probability * impact,
  }
}

// ---------------------------------------------------------------------------
// 内存伪后端（对齐既有 risks 端点语义）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

type WriteCall = { method: string; url: string; body?: unknown }

function createBackend(seed: Risk[]) {
  const store: Risk[] = seed.map((risk) => ({ ...risk }))
  const writeCalls: WriteCall[] = []

  function paginate(page: number, perPage: number) {
    const total = store.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const start = (page - 1) * perPage
    const data = store.slice(start, start + perPage)
    return { data, meta: { total, page, perPage, totalPages } }
  }

  function matrixCells() {
    const cellMap = new Map<
      string,
      { probability: number; impact: number; count: number; topRiskIds: number[] }
    >()
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++)
        cellMap.set(`${p}-${i}`, { probability: p, impact: i, count: 0, topRiskIds: [] })
    }
    for (const risk of store) {
      const cell = cellMap.get(`${risk.probability}-${risk.impact}`)
      if (cell) {
        cell.count++
        if (cell.topRiskIds.length < 5) cell.topRiskIds.push(risk.id)
      }
    }
    return { cells: Array.from(cellMap.values()) }
  }

  async function route(url: string, method: string, init?: RequestInit): Promise<Response> {
    const path = url.replace(API_PREFIX, '')
    const readBody = async () => {
      if (!init?.body) return {}
      return JSON.parse(String(init.body)) as Record<string, unknown>
    }

    // 矩阵（先于列表匹配：/projects/:id/risks/matrix 前缀更长）
    if (path.includes('/risks/matrix')) {
      return jsonResponse(200, { data: matrixCells() })
    }

    // 项目级列表 / 新建
    if (/^\/projects\/42\/risks(\?|$)/.test(path) && method === 'GET') {
      const query = new URL(path, 'http://x').searchParams
      const page = Number(query.get('page') ?? 1)
      const perPage = Number(query.get('perPage') ?? 20)
      return jsonResponse(200, paginate(page, perPage))
    }
    if (path === '/projects/42/risks' && method === 'POST') {
      const body = await readBody()
      const probability = Number(body.probability ?? 3)
      const impact = Number(body.impact ?? 3)
      const risk = makeRisk({
        projectId: 42,
        organizationId: 1,
        title: String(body.title ?? ''),
        description: String(body.description ?? ''),
        category: (body.category as RiskCategory) ?? 'technical',
        probability,
        impact,
        status: 'identified',
        mitigationStrategy:
          body.mitigationStrategy === null ? null : String(body.mitigationStrategy ?? null),
        ownerId: null,
        createdBy: 1,
      })
      store.push(risk)
      writeCalls.push({ method, url: path, body })
      return jsonResponse(201, { data: risk })
    }

    // 行级操作（PATCH /risks/:id、DELETE、POST /risks/:id/status）
    const statusMatch = path.match(/^\/risks\/(\d+)\/status$/)
    if (statusMatch && method === 'POST') {
      const risk = store.find((item) => item.id === Number(statusMatch[1]))
      if (!risk) return jsonResponse(404, { error: { code: 'RISK_NOT_FOUND', message: '' } })
      const body = await readBody()
      const next = body.status as RiskStatus
      const allowed = RISK_ALLOWED_TRANSITIONS[risk.status]
      if (!allowed?.includes(next)) {
        return jsonResponse(422, {
          error: {
            code: 'VALIDATION_ERROR',
            message: `不允许从 "${risk.status}" 转换到 "${next}"`,
          },
        })
      }
      risk.status = next
      if (next === 'resolved' || next === 'closed') risk.resolvedAt = '2026-09-02T00:00:00.000Z'
      risk.updatedAt = '2026-09-02T00:00:00.000Z'
      writeCalls.push({ method, url: path, body })
      return jsonResponse(200, { data: { ...risk } })
    }

    const riskMatch = path.match(/^\/risks\/(\d+)$/)
    if (riskMatch) {
      const risk = store.find((item) => item.id === Number(riskMatch[1]))
      if (!risk) return jsonResponse(404, { error: { code: 'RISK_NOT_FOUND', message: '' } })
      if (method === 'DELETE') {
        const idx = store.indexOf(risk)
        store.splice(idx, 1)
        writeCalls.push({ method, url: path })
        return jsonResponse(204, undefined)
      }
      if (method === 'PATCH') {
        const body = await readBody()
        if (body.probability !== undefined) {
          risk.probability = Number(body.probability)
        }
        if (body.impact !== undefined) risk.impact = Number(body.impact)
        if (body.mitigationStrategy !== undefined) {
          risk.mitigationStrategy =
            body.mitigationStrategy === null ? null : String(body.mitigationStrategy)
        }
        risk.score = risk.probability * risk.impact
        risk.updatedAt = '2026-09-02T00:00:00.000Z'
        writeCalls.push({ method, url: path, body })
        return jsonResponse(200, { data: { ...risk } })
      }
    }

    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }

  return { store, writeCalls, route }
}

// ---------------------------------------------------------------------------
// 会话辅助
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], userId = 1) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

function resetAuth() {
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
}

// ---------------------------------------------------------------------------
// 默认种子数据集
// ---------------------------------------------------------------------------
function defaultSeed(): Risk[] {
  nextRiskId = 1000
  return [
    makeRisk({
      id: 101,
      riskCode: 'RISK-101',
      title: '核心数据库迁移导致服务中断',
      description: '双机房割接窗口内存在写放大风险',
      category: 'technical',
      probability: 4,
      impact: 5,
      status: 'identified',
      mitigationStrategy: '主备切换与回滚演练预案',
      ownerId: 5,
    }),
    makeRisk({
      id: 102,
      riskCode: 'RISK-102',
      title: '云厂商服务涨价超预算',
      category: 'cost',
      probability: 4,
      impact: 5,
      status: 'identified',
      mitigationStrategy: null,
    }),
    makeRisk({
      id: 103,
      riskCode: 'RISK-103',
      title: '关键开发人员离职',
      category: 'resource',
      probability: 3,
      impact: 3,
      status: 'mitigating',
      mitigationStrategy: '骨干备份与知识库沉淀',
      ownerId: 1,
    }),
    makeRisk({
      id: 104,
      title: '法规合规要求变更',
      category: 'legal',
      probability: 2,
      impact: 5,
      status: 'identified',
      mitigationStrategy: '法务月度跟踪',
    }),
    makeRisk({
      id: 105,
      title: '验收口径未对齐',
      category: 'other',
      probability: 1,
      impact: 1,
      status: 'identified',
    }),
    makeRisk({
      id: 106,
      title: '数据合规审计处罚',
      category: 'external',
      probability: 5,
      impact: 5,
      status: 'accepted',
      mitigationStrategy: '预提风险准备金',
      ownerId: 1,
    }),
  ]
}

function installFetch(backend: ReturnType<typeof createBackend>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    return backend.route(url, method, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function writeMethodsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => {
      const init = call[1] as RequestInit | undefined
      return (init?.method ?? 'GET').toUpperCase()
    })
    .filter((method) => method !== 'GET')
}

function renderLens(backend: ReturnType<typeof createBackend>) {
  const fetchMock = installFetch(backend)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <RiskRegisterChartLens projectId={42} />
    </QueryClientProvider>,
  )
  return { view, client, fetchMock }
}

async function waitForLoaded() {
  await waitFor(() => expect(document.querySelector('[data-risk-matrix]')).not.toBeNull())
  await waitFor(() => expect(document.querySelector('[data-risk-register-skeleton]')).toBeNull())
  await waitFor(() =>
    expect(document.querySelectorAll('[data-risk-row]').length).toBeGreaterThan(0),
  )
}

beforeEach(() => {
  nextRiskId = 1000
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  resetAuth()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('RiskRegisterChartLens：RBAC 门禁与矩阵/底册协同渲染', () => {
  test('无 risk:view 权限：受限提示渲染，矩阵与底册数据请求零发出', async () => {
    setAuth(['project:view'])
    const backend = createBackend(defaultSeed())
    const fetchMock = installFetch(backend)

    render(
      <QueryClientProvider client={new QueryClient()}>
        <RiskRegisterChartLens projectId={42} />
      </QueryClientProvider>,
    )

    expect(document.querySelector('[data-risk-view-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目风险数据的权限')).toBeInTheDocument()
    // 零数据请求：矩阵与登记底册组件均未挂载
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeMethodsOf(fetchMock)).toHaveLength(0)
  })

  test('矩阵 25 格渲染：单元格计数、三色区带与登记底册行数一致', async () => {
    setAuth(['risk:view'])
    const backend = createBackend(defaultSeed())
    renderLens(backend)
    await waitForLoaded()

    // 5×5 = 25 格
    expect(document.querySelectorAll('[data-risk-cell]')).toHaveLength(25)
    // 格内计数与 aria 契约
    const highCell = screen.getByRole('button', {
      name: '概率 4 · 影响 5 · 高危 · 2 条风险',
    })
    expect(highCell.getAttribute('data-risk-cell-count')).toBe('2')
    expect(highCell.getAttribute('data-risk-cell-tone')).toBe('high')
    expect(highCell.getAttribute('aria-pressed')).toBe('false')

    // 底册 6 行 + 汇总计数
    expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6)
    expect(screen.getByText('共 6 条')).toBeInTheDocument()
    expect(screen.getByText('核心数据库迁移导致服务中断')).toBeInTheDocument()
  })

  test('点击高危矩阵单元格：登记表联动收敛；同格再点与「清除筛选」均恢复全量', async () => {
    setAuth(['risk:view'])
    const backend = createBackend(defaultSeed())
    renderLens(backend)
    await waitForLoaded()

    const highCell = screen.getByRole('button', {
      name: '概率 4 · 影响 5 · 高危 · 2 条风险',
    })
    fireEvent.click(highCell)

    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(2))
    expect(screen.getByText('核心数据库迁移导致服务中断')).toBeInTheDocument()
    expect(screen.getByText('云厂商服务涨价超预算')).toBeInTheDocument()
    expect(screen.queryByText('关键开发人员离职')).toBeNull()
    // 联动胶囊可见（含清除入口）
    expect(document.querySelector('[data-risk-cell-filter-chip]')).not.toBeNull()
    expect(screen.getByText('矩阵单元格筛选')).toBeInTheDocument()
    expect(highCell.getAttribute('aria-pressed')).toBe('true')

    // 同格再次点击 = 取消筛选
    fireEvent.click(highCell)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
    expect(document.querySelector('[data-risk-cell-filter-chip]')).toBeNull()

    // 再次选中后走「清除筛选」按钮复位
    fireEvent.click(highCell)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /清除筛选/ }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
    expect(document.querySelector('[data-risk-cell-filter-chip]')).toBeNull()
  })

  test('只读交互（矩阵点击/分类筛选/翻页）零写请求：仅初始 GET', async () => {
    setAuth(['risk:view'])
    const backend = createBackend(defaultSeed())
    const fetchMock = renderLens(backend).fetchMock
    await waitForLoaded()

    // 交互序列：点矩阵格、切分类筛选、切状态筛选、切严重度筛选、翻页按钮
    fireEvent.click(screen.getByRole('button', { name: '概率 4 · 影响 5 · 高危 · 2 条风险' }))
    fireEvent.change(screen.getByLabelText('按分类筛选风险'), { target: { value: 'technical' } })
    fireEvent.change(screen.getByLabelText('按状态筛选风险'), { target: { value: 'identified' } })
    fireEvent.change(screen.getByLabelText('按严重度筛选风险'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeMethodsOf(fetchMock)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('RiskRegisterChartLens：受控增删改闭环（risk:manage）', () => {
  test('新建风险：POST 载荷正确，抽屉关闭，底册追加且矩阵计数联动 +1', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = createBackend(defaultSeed())
    const fetchMock = renderLens(backend).fetchMock
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: '新建风险' }))
    expect(screen.getByRole('dialog', { name: '新建风险' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/风险标题/), {
      target: { value: '海外节点网络抖动影响同步' },
    })
    fireEvent.change(screen.getByLabelText('发生概率'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('影响度'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('缓解措施（可选）'), {
      target: { value: '启用备用专线并限流降级' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存风险' }))

    // POST 写请求载荷断言
    await waitFor(() =>
      expect(
        backend.writeCalls.some(
          (call) =>
            call.method === 'POST' &&
            call.url === '/projects/42/risks' &&
            (call.body as Record<string, unknown>).title === '海外节点网络抖动影响同步' &&
            (call.body as Record<string, unknown>).probability === 5 &&
            (call.body as Record<string, unknown>).impact === 5,
        ),
      ).toBe(true),
    )

    // 抽屉关闭 + 底册追加
    await waitFor(() => expect(document.querySelector('[data-risk-create-drawer]')).toBeNull())
    await waitFor(() => expect(screen.getByText('海外节点网络抖动影响同步')).toBeInTheDocument())
    expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(7)

    // 矩阵计数联动：p5×i5 由 1 → 2
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: '概率 5 · 影响 5 · 高危 · 2 条风险' })
          .getAttribute('data-risk-cell-count'),
      ).toBe('2'),
    )
    // 清空输入后再次提交被禁用（标题必填）
    fireEvent.click(screen.getByRole('button', { name: '新建风险' }))
    expect((screen.getByRole('button', { name: '保存风险' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(fetchMock).toHaveBeenCalled()
  })

  test('行内状态机推进：POST /risks/:id/status，成功后回显新状态并失去更多推进项', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = createBackend(defaultSeed())
    installFetch(backend)
    renderLens(backend)
    await waitForLoaded()

    const statusSelect = screen.getByLabelText(
      '核心数据库迁移导致服务中断 状态',
    ) as HTMLSelectElement
    expect(statusSelect.value).toBe('identified')
    fireEvent.change(statusSelect, { target: { value: 'closed' } })

    await waitFor(() =>
      expect(
        backend.writeCalls.some(
          (call) =>
            call.method === 'POST' &&
            call.url === '/risks/101/status' &&
            (call.body as Record<string, unknown>).status === 'closed',
        ),
      ).toBe(true),
    )
    // 终态无合法推进：状态列由下拉收敛为静态徽章
    await waitFor(() =>
      expect(screen.queryByLabelText('核心数据库迁移导致服务中断 状态')).toBeNull(),
    )
    const row = document.querySelector('[data-risk-row="101"]')
    expect(row?.textContent).toContain('已关闭')
  })

  test('行内编辑概率/影响/缓解措施：PATCH 载荷正确，矩阵计数联动迁移', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = createBackend(defaultSeed())
    installFetch(backend)
    renderLens(backend)
    await waitForLoaded()

    // 编辑 p3×i3 的唯一行 103 → 2×5
    fireEvent.click(screen.getByRole('button', { name: '编辑 关键开发人员离职' }))
    expect(document.querySelector('[data-risk-inline-editor]')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('发生概率等级'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('影响度等级'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('缓解措施'), {
      target: { value: '双人复核与自动化知识库' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(
        backend.writeCalls.some(
          (call) =>
            call.method === 'PATCH' &&
            call.url === '/risks/103' &&
            (call.body as Record<string, unknown>).probability === 2 &&
            (call.body as Record<string, unknown>).impact === 5,
        ),
      ).toBe(true),
    )
    // 编辑器收起，行内暴露 2 × 5
    await waitFor(() => expect(document.querySelector('[data-risk-inline-editor]')).toBeNull())
    const row103 = document.querySelector('[data-risk-row="103"]')
    expect(row103?.querySelector('[data-risk-cell-exposure]')?.textContent).toBe('2 × 5')
    expect(row103?.textContent).toContain('双人复核与自动化知识库')
    // 矩阵联动迁移：p3×i3 1→0，p2×i5 1→2
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '概率 3 · 影响 3 · 中危 · 0 条风险' }),
      ).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '概率 2 · 影响 5 · 高危 · 2 条风险' }),
      ).toBeInTheDocument(),
    )
  })

  test('删除风险：两步确认后 DELETE，行移除且矩阵计数联动 -1', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = createBackend(defaultSeed())
    installFetch(backend)
    renderLens(backend)
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: '删除 数据合规审计处罚' }))
    expect(document.querySelector('[data-risk-delete-confirm]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '确认删除 数据合规审计处罚' }))

    await waitFor(() =>
      expect(
        backend.writeCalls.some((call) => call.method === 'DELETE' && call.url === '/risks/106'),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('数据合规审计处罚')).toBeNull())
    expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(5)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '概率 5 · 影响 5 · 高危 · 0 条风险' }),
      ).toBeInTheDocument(),
    )
  })
})

// ---------------------------------------------------------------------------
describe('RiskRegisterChartLens：RBAC 只读与 update_own 行级边界', () => {
  test('仅 risk:view（无 manage/update_own）：新建/编辑/删除入口全部物理隐藏', async () => {
    setAuth(['risk:view'])
    const backend = createBackend(defaultSeed())
    installFetch(backend)
    renderLens(backend)
    await waitForLoaded()

    expect(screen.queryByRole('button', { name: '新建风险' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑 核心数据库迁移导致服务中断' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除 核心数据库迁移导致服务中断' })).toBeNull()
    expect(screen.queryByLabelText('核心数据库迁移导致服务中断 状态')).toBeNull()
    // 只读行占位
    const row101 = document.querySelector('[data-risk-row="101"]')
    expect(row101?.textContent).toContain('只读')
    // 数据仍在渲染（risk:view 允许读取）
    expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6)
  })

  test('risk:update_own：仅本人负责行可编辑非状态字段，状态与删除对本人也隐藏', async () => {
    setAuth(['risk:view', 'risk:update_own'], 1)
    const backend = createBackend(defaultSeed())
    installFetch(backend)
    renderLens(backend)
    await waitForLoaded()

    // 本人负责行（ownerId=1：103/106）可见编辑入口，且无状态下拉、无删除
    expect(screen.getByRole('button', { name: '编辑 关键开发人员离职' })).toBeInTheDocument()
    expect(screen.queryByLabelText('关键开发人员离职 状态')).toBeNull()
    expect(screen.queryByRole('button', { name: '删除 关键开发人员离职' })).toBeNull()
    // 非本人行（101 ownerId=5）只读
    expect(screen.queryByRole('button', { name: '编辑 核心数据库迁移导致服务中断' })).toBeNull()
    const row101 = document.querySelector('[data-risk-row="101"]')
    expect(row101?.textContent).toContain('只读')

    // 编辑本人行并保存 → PATCH 成功闭环（update_own 允许改缓解措施）
    fireEvent.click(screen.getByRole('button', { name: '编辑 数据合规审计处罚' }))
    fireEvent.change(screen.getByLabelText('缓解措施'), {
      target: { value: '年度合规演练并预留整改预算' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() =>
      expect(
        backend.writeCalls.some(
          (call) =>
            call.method === 'PATCH' &&
            call.url === '/risks/106' &&
            (call.body as Record<string, unknown>).mitigationStrategy ===
              '年度合规演练并预留整改预算',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-risk-inline-editor]')).toBeNull())
    expect(document.querySelector('[data-risk-row="106"]')?.textContent).toContain(
      '年度合规演练并预留整改预算',
    )
  })
})

// ---------------------------------------------------------------------------
describe('KanbanRedirectCard：经典看板直达入口（tasks 4.7）', () => {
  function renderCard() {
    return render(<KanbanRedirectCard projectId={42} />)
  }

  test('渲染看板元数据卡（已就绪徽标/标题/领域副标题）', () => {
    setAuth(['project:view'])
    renderCard()
    const card = document.querySelector('[data-kanban-redirect-card]')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('data-chart-card')).toBe('kanban')
    expect(card?.getAttribute('data-chart-status')).toBe('available')
    expect(screen.getByText('看板')).toBeInTheDocument()
    expect(screen.getByText('已就绪')).toBeInTheDocument()
    expect(screen.getByText('Kanban Board')).toBeInTheDocument()
  })

  test('点击卡片：push 直达 /next/projects/42?lens=kanban（保留历史，非 replace）', () => {
    setAuth(['project:view'])
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: '看板（已就绪）' }))
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42?lens=kanban')
    expect(navMock.replace).not.toHaveBeenCalled()
    expect(navMock.back).not.toHaveBeenCalled()
  })

  test('卡片为原生 button（浏览器原生键盘可达，无需额外处理）', () => {
    setAuth(['project:view'])
    renderCard()
    const card = screen.getByRole('button', { name: '看板（已就绪）' })
    expect(card.tagName).toBe('BUTTON')
    expect(card.getAttribute('type')).toBe('button')
    expect(navMock.push).not.toHaveBeenCalled()
  })
})
