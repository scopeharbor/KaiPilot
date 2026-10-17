/**
 * v3-ui-next-chart-gallery W5 · tasks 5.3 —— RBAC 权限门禁与租户隔离中性 404
 * 防探测集成测试（页面级真实路由 + 全局 fetch 伪后端监控）。
 *
 * 覆盖（spec「RBAC 权限对齐与租户数据隔离」）：
 * - 目录页 / 镜头页：未获 project:view 物理阻断，底层数据接口零发出（RL-06）；
 * - HTTP 404 与跨组织（organizationId 失配）统一中性空态「项目不存在或已被移除」，
 *   不泄露项目名（RL-05）；
 * - 风险镜头：无 risk:view → 受限横幅且 /risks* 数据接口零发出；
 *   有 risk:view 但无 risk:manage/update_own → 底册只读（「新建风险」入口隐藏，
 *   无行内编辑控件），矩阵与列表仅 GET；
 * - 鱼骨镜头：无 diagram:manage → 编辑能力关闭（data-can-edit=false、保存禁用、
 *   无新增原因入口），读取照常（project:view 即视同 diagram:view 通道）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Risk } from '@/lib/api/risks'
import { useAuthStore } from '@/stores/auth-store'
import ProjectChartsGalleryPage from '@/app/(next)/next/projects/[id]/charts/page'
import ProjectChartLensPage from '@/app/(next)/next/projects/[id]/charts/[chartId]/page'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string; chartId?: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 夹具
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

const TENANT_LEAK_WORDS = ['无权', '其他组织', '不属于', '租户', '越权']

function riskRecord(id: number, overrides: Partial<Risk> = {}): Risk {
  const now = '2026-09-01T00:00:00.000Z'
  return {
    organizationId: 1,
    projectId: 42,
    riskCode: `RSK-${id}`,
    title: `风险 ${id}`,
    description: '',
    category: 'technical',
    probability: 4,
    impact: 5,
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
    id,
    score: overrides.score ?? (overrides.probability ?? 4) * (overrides.impact ?? 5),
  }
}

function matrixCells() {
  const cells = []
  for (let p = 1; p <= 5; p += 1) {
    for (let i = 1; i <= 5; i += 1) {
      cells.push({ probability: p, impact: i, count: 0, topRiskIds: [] })
    }
  }
  cells[19] = { probability: 4, impact: 5, count: 1, topRiskIds: [1] }
  return { cells }
}

/** RBAC 场景后端：项目 + 风险（矩阵/列表）+ 空 fishbone。 */
function rbacBackend(projectPayload: unknown, seedRisks: Risk[] = []) {
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: projectPayload })
    }
    if (path.startsWith('/projects/42/diagrams') && method === 'GET') {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 100, totalPages: 0 },
      })
    }
    if (path.includes('/risks/matrix') && method === 'GET') {
      return jsonResponse(200, { data: matrixCells() })
    }
    if (/^\/projects\/42\/risks(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, {
        data: seedRisks,
        meta: { total: seedRisks.length, page: 1, perPage: 100, totalPages: 1 },
      })
    }
    return null
  }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  resetFetchRouter()
})

describe('页面级准入门禁（spec「准入门禁」场景）', () => {
  test('目录页：无 project:view 权限 → 受限横幅，底层数据接口零发出', () => {
    setAuth(['task:view'])
    const router = installFetchRouter(() => null)
    renderPage(<ProjectChartsGalleryPage />)

    expect(screen.getByText('你没有查看该项目图表馆的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(router.records).toHaveLength(0)
  })

  test('镜头页：无 project:view 权限 → 受限横幅，底层数据接口零发出', () => {
    setAuth(['task:view'])
    paramsMock.value = { id: '42', chartId: 'fishbone' }
    const router = installFetchRouter(() => null)
    renderPage(<ProjectChartLensPage />)

    expect(screen.getByText('你没有查看该项目图表馆的权限')).toBeInTheDocument()
    expect(router.records).toHaveLength(0)
  })

  test('HTTP 404：统一中性空态「项目不存在或已被移除」，不泄露项目名（RL-05）', async () => {
    setAuth(['project:view'])
    const router = installFetchRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '' } })
      }
      return null
    })
    renderPage(<ProjectChartsGalleryPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('开项核心引擎')
    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) expect(bodyText).not.toContain(word)
    // 仅一次项目 GET，无任何后续数据探测
    expect(router.records).toHaveLength(1)
  })

  test('跨组织项目（organizationId 失配）：同样中性 404，绝不泄露资源属性', async () => {
    setAuth(['project:view'], 1)
    const router = installFetchRouter(rbacBackend(makeProject({ organizationId: 2 })))
    renderPage(<ProjectChartsGalleryPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(writeMethods(router.records)).toEqual([])
  })

  test('非数字路径 id：直接中性 404，零网络请求', async () => {
    setAuth(['project:view'])
    paramsMock.value = { id: 'abc' }
    const router = installFetchRouter(() => null)
    renderPage(<ProjectChartsGalleryPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(router.records).toHaveLength(0)
  })
})

describe('风险镜头领域权限（spec「领域数据细粒度权限校验」）', () => {
  test('无 risk:view：受限横幅，/risks* 数据接口零发出', async () => {
    setAuth(['project:view'])
    paramsMock.value = { id: '42', chartId: 'risk-register' }
    const router = installFetchRouter(rbacBackend(makeProject(), [riskRecord(1)]))
    renderPage(<ProjectChartLensPage />)

    await screen.findByText('你没有查看该项目风险数据的权限')
    expect(document.querySelector('[data-risk-view-fallback]')).not.toBeNull()
    expect(router.records.some((record) => record.url.includes('/risks'))).toBe(false)
    expect(writeMethods(router.records)).toEqual([])
  })

  test('有 risk:view 但无 risk:manage/update_own：底册只读，「新建风险」入口隐藏', async () => {
    setAuth(['project:view', 'risk:view'])
    paramsMock.value = { id: '42', chartId: 'risk-register' }
    const router = installFetchRouter(rbacBackend(makeProject(), [riskRecord(1)]))
    renderPage(<ProjectChartLensPage />)

    // 矩阵与底册正常渲染（仅 GET）
    await waitFor(() => expect(document.querySelector('[data-risk-matrix]')).not.toBeNull())
    await screen.findByText('结构化风险登记底册')
    expect(screen.getByText('风险 1')).toBeInTheDocument()
    // 无编辑权限：新建入口物理隐藏
    expect(document.querySelector('[data-risk-create-open]')).toBeNull()
    // 行内编辑控件（状态推进/编辑/删除）不存在
    expect(document.querySelector('[data-risk-status-select]')).toBeNull()
    expect(document.querySelector('[data-risk-edit-open]')).toBeNull()
    expect(document.querySelector('[data-risk-delete-open]')).toBeNull()
    expect(writeMethods(router.records)).toEqual([])
  })

  test('有 risk:manage：新建风险入口可见（写权限闭环由 W4 专测）', async () => {
    setAuth(['project:view', 'risk:view', 'risk:manage'])
    paramsMock.value = { id: '42', chartId: 'risk-register' }
    installFetchRouter(rbacBackend(makeProject(), [riskRecord(1)]))
    renderPage(<ProjectChartLensPage />)

    await waitFor(() => expect(document.querySelector('[data-risk-create-open]')).not.toBeNull())
  })
})

describe('鱼骨镜头受控编辑边界（spec「允许编辑项」）', () => {
  test('无 diagram:manage：data-can-edit=false、保存禁用、无新增入口，读取照常', async () => {
    setAuth(['project:view', 'diagram:view'])
    paramsMock.value = { id: '42', chartId: 'fishbone' }
    const router = installFetchRouter(rbacBackend(makeProject()))
    renderPage(<ProjectChartLensPage />)

    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
    const lens = document.querySelector('[data-fishbone-lens]')
    expect(lens?.getAttribute('data-can-edit')).toBe('false')
    expect(document.querySelector('[data-fishbone-save]')).toBeDisabled()
    expect(document.querySelector('[data-fishbone-add-cause]')).toBeNull()
    expect(document.querySelector('[data-fishbone-readonly-note]')).not.toBeNull()
    expect(writeMethods(router.records)).toEqual([])
  })

  test('有 diagram:manage：编辑与保存可用（受控编辑承诺）', async () => {
    setAuth(['project:view', 'diagram:view', 'diagram:manage'])
    paramsMock.value = { id: '42', chartId: 'fishbone' }
    installFetchRouter(rbacBackend(makeProject()))
    renderPage(<ProjectChartLensPage />)

    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
    const lens = document.querySelector('[data-fishbone-lens]')
    expect(lens?.getAttribute('data-can-edit')).toBe('true')
    expect(document.querySelector('[data-fishbone-add-cause]')).not.toBeNull()
    expect(document.querySelector('[data-fishbone-save]')).toBeEnabled()
  })
})
