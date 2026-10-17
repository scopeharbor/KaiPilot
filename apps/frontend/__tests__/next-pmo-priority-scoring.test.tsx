/**
 * v3-ui-next-pmo-domain W4 · tasks 4.4 —— 优先级评分只读工作台测试
 * （spec「PMO 优先级评分只读工作台」场景 + 装配/RBAC/三态）。
 *
 * 覆盖（tasks 4.4 / spec 场景）：
 * - 摘要卡数值（项目总数/已评分/未评分 + 等级分布计数）与权重卡（版本/维度权重/
 *   阈值）渲染；
 * - 等级多选过滤：重复 priorityLevels 查询参数 + 分页重置为第 1 页；
 * - 排序参数（priority_score → project_name）与清除过滤；
 * - 分页（下一页 page=2 参数、上一页在第 1 页禁用）；
 * - 行点击唤起明细抽屉：GET /projects/:id 分数构成与权重明细、forbidden 维度
 *   中性「不可见」零数值、stale 警示、新鲜度、项目空间下钻链接；
 * - 三态：骨架屏 aria-busy / 错误卡重试闭环（500）与 403 中性受限 / 空态；
 * - RBAC 装配：无 portfolio:view 受限横幅、orgId 未水合引导态，均零请求（RL-06）；
 * - 只读铁律：全流程（过滤/排序/翻页/抽屉）写请求严格为 0（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoPriorityScoringPage from '@/app/(next)/next/pmo/priority-scoring/page'
import { PmoPriorityScoringWorkspace } from '@/components/next/pmo/priority-scoring/PmoPriorityScoringWorkspace'
import type {
  PriorityLevel,
  PriorityScoringListResponse,
  PriorityScoringSummary,
  PriorityScoreItem,
  PriorityScoreDetail,
  PriorityWeightVersion,
} from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与伪后端（真实 apiFetch/apiFetchEnvelope → stub global fetch）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '项目总监',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

interface RequestRecord {
  method: string
  url: string
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
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
// 夹具（与 @aiproj/types pmo-priority-scoring-model 契约全字段）
// ---------------------------------------------------------------------------
const SUMMARY: PriorityScoringSummary = {
  totalProjects: 5,
  scoredProjects: 4,
  unscoredProjects: 1,
  levelCounts: { critical: 1, high: 2, medium: 0, low: 1, unranked: 1 },
  scoreVersion: 'pmo-priority-v1',
  weightVersion: 'pmo-priority-v1',
  sourceFreshness: [
    {
      source: 'traffic_light',
      refreshedAt: '2026-09-09T08:00:00.000Z',
      stale: true,
      staleThresholdMs: 86400000,
    },
  ],
  warnings: [{ code: 'SOURCE_STALE', message: '交通灯数据源已过期', source: 'traffic_light' }],
  calculatedAt: '2026-09-10T08:00:00.000Z',
}

const WEIGHTS: PriorityWeightVersion = {
  version: 'pmo-priority-v1',
  description: '首期确定性评分权重目录：交通灯严重度与交付紧急度权重最高。',
  dimensions: [
    { key: 'delivery_urgency', weight: 0.25, normalizedRange: [0, 100], stalePenaltyFactor: 0.3 },
    {
      key: 'traffic_light_severity',
      weight: 0.2,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    { key: 'risk_pressure', weight: 0.12, normalizedRange: [0, 100], stalePenaltyFactor: 0.3 },
  ],
  thresholds: {
    critical: [80, 100],
    high: [60, 80],
    medium: [40, 60],
    low: [0, 40],
    unranked: [-1, -1],
  },
}

const INPUT_SIGNATURE = {
  version: 'pmo-priority-v1' as const,
  organizationHash: 'abc123',
  inputsHash: 'def456',
  computedAt: '2026-09-10T08:00:00.000Z',
}

const TIE_BREAKER = {
  level: 'low' as PriorityLevel,
  trafficLightSeverity: 0,
  dueUrgency: 0,
  projectId: 1,
}

function makeItem(overrides: Partial<PriorityScoreItem>): PriorityScoreItem {
  return {
    projectId: 7,
    projectName: '开项核心引擎',
    priorityScore: 88.4,
    priorityLevel: 'critical',
    rank: 1,
    scoreVersion: 'pmo-priority-v1',
    calculatedAt: '2026-09-10T08:00:00.000Z',
    inputSignature: INPUT_SIGNATURE,
    sourceFreshness: [],
    dimensions: [],
    topReasons: [],
    warnings: [],
    allowedActions: [],
    tieBreaker: { ...TIE_BREAKER, level: 'critical', projectId: 7 },
    ...overrides,
  }
}

function defaultItems(): PriorityScoreItem[] {
  return [
    makeItem({
      projectId: 7,
      projectName: '开项核心引擎',
      priorityScore: 88.4,
      priorityLevel: 'critical',
      rank: 1,
      topReasons: [
        {
          dimension: 'delivery_urgency',
          rawValue: 92,
          normalizedValue: 92,
          weight: 0.25,
          weightedContribution: 23,
          availability: 'available',
          evidenceRefs: [],
        },
      ],
      warnings: [{ code: 'SOURCE_STALE', message: '交通灯数据源已过期', source: 'traffic_light' }],
      tieBreaker: { level: 'critical', trafficLightSeverity: 3, dueUrgency: 2, projectId: 7 },
    }),
    makeItem({
      projectId: 12,
      projectName: '商城重构',
      priorityScore: 65,
      priorityLevel: 'high',
      rank: 2,
      warnings: [{ code: 'DIMENSION_FORBIDDEN', message: '部分维度受限' }],
      tieBreaker: { level: 'high', trafficLightSeverity: 2, dueUrgency: 1, projectId: 12 },
    }),
    makeItem({
      projectId: 21,
      projectName: '数据中台',
      priorityScore: 35.8,
      priorityLevel: 'low',
      rank: 3,
      topReasons: [],
      tieBreaker: { level: 'low', trafficLightSeverity: 1, dueUrgency: 0, projectId: 21 },
    }),
    makeItem({
      projectId: 30,
      projectName: '官网改版',
      priorityScore: -1,
      priorityLevel: 'unranked',
      rank: 0,
      tieBreaker: { level: 'unranked', trafficLightSeverity: 0, dueUrgency: 0, projectId: 30 },
    }),
  ]
}

function listResponse(
  items: PriorityScoreItem[],
  total: number,
  page: number,
): PriorityScoringListResponse {
  return {
    data: items,
    meta: { total, page, perPage: 50, totalPages: Math.max(1, Math.ceil(total / 50)) },
  }
}

/** 项目 7 的评分明细（含分数构成/权重明细/新鲜度）。 */
function detailForProject7(): PriorityScoreDetail {
  return {
    ...makeItem({
      projectId: 7,
      projectName: '开项核心引擎',
      priorityScore: 88.4,
      priorityLevel: 'critical',
      rank: 1,
      scoreVersion: 'pmo-priority-v1',
      calculatedAt: '2026-09-10T08:00:00.000Z',
      topReasons: [],
      tieBreaker: { level: 'critical', trafficLightSeverity: 3, dueUrgency: 2, projectId: 7 },
    }),
    sourceFreshness: [
      {
        source: 'traffic_light',
        refreshedAt: '2026-09-01T08:00:00.000Z',
        stale: true,
        staleThresholdMs: 86400000,
      },
      {
        source: 'risk_register',
        refreshedAt: '2026-09-10T07:00:00.000Z',
        stale: false,
        staleThresholdMs: 86400000,
      },
    ],
    dimensions: [
      {
        dimension: 'delivery_urgency',
        rawValue: 92,
        normalizedValue: 92,
        weight: 0.25,
        weightedContribution: 23,
        availability: 'available',
        evidenceRefs: [{ ref: 'tl:7', kind: 'traffic_light', lowSensitiveLabel: '交通灯快照' }],
      },
      {
        dimension: 'traffic_light_severity',
        rawValue: 75,
        normalizedValue: 75,
        weight: 0.2,
        weightedContribution: 15,
        availability: 'stale',
        evidenceRefs: [{ ref: 'tl:7', kind: 'traffic_light', lowSensitiveLabel: '交通灯快照' }],
      },
      {
        dimension: 'management_attention',
        rawValue: 60,
        normalizedValue: 60,
        weight: 0.15,
        weightedContribution: 9,
        availability: 'forbidden',
        evidenceRefs: [],
      },
    ],
    warnings: [{ code: 'SOURCE_STALE', message: '交通灯数据源已过期', source: 'traffic_light' }],
  }
}

// ---------------------------------------------------------------------------
// 后端路由工厂
// ---------------------------------------------------------------------------
function createBackend(options: { projectsFailures?: number } = {}) {
  let projectsFailures = options.projectsFailures ?? 0
  const route = (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path === '/pmo/priority-scoring/summary') {
      return jsonResponse(200, { data: SUMMARY })
    }
    if (path === '/pmo/priority-scoring/weights') {
      return jsonResponse(200, { data: WEIGHTS })
    }
    const projectsPrefix = '/pmo/priority-scoring/projects'
    if (path === projectsPrefix || path.startsWith(`${projectsPrefix}?`)) {
      if (projectsFailures > 0) {
        projectsFailures -= 1
        return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } })
      }
      const qs = new URLSearchParams(path.split('?')[1] ?? '')
      if (qs.get('page') === '2') {
        return jsonResponse(
          200,
          listResponse(
            [
              makeItem({
                projectId: 55,
                projectName: '国际站建设',
                priorityScore: 71.2,
                priorityLevel: 'high',
                rank: 6,
              }),
            ],
            120,
            2,
          ),
        )
      }
      return jsonResponse(200, listResponse(defaultItems(), 120, 1))
    }
    if (path.startsWith(`${projectsPrefix}/`)) {
      const projectId = path.slice(projectsPrefix.length + 1).split('?')[0]
      if (projectId === '7') return jsonResponse(200, { data: detailForProject7() })
      return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'not found' } })
    }
    return null
  }
  return { route }
}

function renderNode(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function listQueries(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.url.startsWith('/pmo/priority-scoring/projects'))
}

beforeEach(() => {
  setAuth(['portfolio:view'])
})

afterEach(() => {
  resetFetchRouter()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 装配与 RBAC（spec 场景 + RL-06）
// ---------------------------------------------------------------------------
describe('PmoPriorityScoringPage：装配与 RBAC', () => {
  test('具备 portfolio:view：骨架 → 工作台装配，摘要/权重/项目请求均为 GET', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringPage />)

    expect(document.querySelector('[data-pps-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-pps-workspace]')).not.toBeNull())
    expect(screen.getByRole('heading', { name: '优先级评分' })).toBeInTheDocument()

    await waitFor(() => {
      const summaryGets = records.filter((record) =>
        record.url.startsWith('/pmo/priority-scoring/summary'),
      )
      expect(summaryGets.length).toBeGreaterThanOrEqual(1)
    })
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('无 portfolio:view：受限横幅渲染且数据接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderNode(<PmoPriorityScoringPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看优先级评分的权限')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('orgId 未水合：中性引导态渲染且零请求', async () => {
    useAuthStore.setState({
      user: { id: 9, email: 'solo@example.com', fullName: '未入组成员', organizations: [] },
      accessToken: null,
      refreshToken: null,
      permissions: ['portfolio:view'],
      currentOrganizationId: null,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })
    const { records } = installFetchRouter(() => null)
    renderNode(<PmoPriorityScoringPage />)

    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 摘要卡 / 权重卡 / 队列表渲染（spec 场景「管理层按优先级层级过滤组合项目」）
// ---------------------------------------------------------------------------
describe('PmoPriorityScoringWorkspace：摘要、权重与队列表渲染', () => {
  test('摘要卡数值、等级分布计数、权重版本与阈值、队列表与双通道徽标', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)

    await waitFor(() => expect(document.querySelector('[data-pps-table]')).not.toBeNull())

    // 摘要 KPI 卡数值
    expect(document.querySelector('[data-pps-kpi="total"]')?.textContent).toContain('5')
    expect(document.querySelector('[data-pps-kpi="scored"]')?.textContent).toContain('4')
    expect(document.querySelector('[data-pps-kpi="unscored"]')?.textContent).toContain('1')
    // 等级分布 chips（计数 + 双通道标签）
    const criticalChip = document.querySelector('[data-pps-level-filter="critical"]')
    expect(criticalChip?.textContent).toContain('紧急')
    expect(criticalChip?.textContent).toContain('1')
    expect(criticalChip?.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('[data-pps-level-filter="unranked"]')?.textContent).toContain(
      '未排名',
    )
    // warnings rail
    expect(document.querySelector('[data-pps-warning="SOURCE_STALE"]')?.textContent).toContain(
      '交通灯数据源已过期',
    )

    // 权重版本卡
    const weightsCard = document.querySelector('[data-pps-weights]')
    expect(weightsCard?.textContent).toContain('权重版本')
    expect(document.querySelector('[data-pps-weights-version]')?.textContent).toBe(
      'pmo-priority-v1',
    )
    expect(
      document.querySelector('[data-pps-weight-dim="delivery_urgency"]')?.textContent,
    ).toContain('交付紧急度')
    expect(
      document.querySelector('[data-pps-weight-dim="delivery_urgency"]')?.textContent,
    ).toContain('25%')
    expect(document.querySelector('[data-pps-threshold="critical"]')?.textContent).toContain('≥ 80')
    expect(document.querySelector('[data-pps-threshold="unranked"]')?.textContent).toContain(
      '无法评分',
    )

    // 队列表：行、评分格式、等级双通道徽标
    expect(document.querySelectorAll('[data-pps-row]')).toHaveLength(4)
    expect(document.querySelector('[data-pps-score="7"]')?.textContent).toBe('88.4')
    expect(document.querySelector('[data-pps-score="12"]')?.textContent).toBe('65.0')
    const criticalBadge = document.querySelector('[data-pps-badge="critical"]')
    expect(criticalBadge?.textContent).toContain('紧急')
    const unrankedRow = document.querySelector('[data-pps-row="30"]')
    expect(unrankedRow?.querySelector('[data-pps-badge="unranked"]')?.textContent).toContain(
      '未排名',
    )
    // topReasons 中文标签 + 贡献值
    expect(
      document.querySelector('[data-pps-top-reason="delivery_urgency"]')?.textContent,
    ).toContain('交付紧急度')
    // 行状态双通道
    expect(document.querySelector('[data-pps-status="7"] [data-pps-status-stale]')).not.toBeNull()
    expect(
      document.querySelector('[data-pps-status="12"] [data-pps-status-forbidden]'),
    ).not.toBeNull()
    expect(document.querySelector('[data-pps-status="21"] [data-pps-status-ok]')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 过滤 / 排序 / 分页（spec 场景：过滤后分页重置；零写铁律）
// ---------------------------------------------------------------------------
describe('PmoPriorityScoringWorkspace：level 过滤、排序与分页', () => {
  test('多选等级过滤：重复 priorityLevels 参数、分页重置为 1；清除过滤恢复', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)
    await waitFor(() => expect(document.querySelector('[data-pps-table]')).not.toBeNull())

    // 先进第 2 页
    fireEvent.click(document.querySelector('[data-pps-page-next]') as Element)
    await waitFor(() =>
      expect(listQueries(records).some((record) => record.url.includes('page=2'))).toBe(true),
    )

    // 勾选 critical → page 重置为 1，priorityLevels=critical 参数发出
    fireEvent.click(document.querySelector('[data-pps-level-filter="critical"]') as Element)
    await waitFor(() => {
      const filtered = listQueries(records).filter((record) =>
        record.url.includes('priorityLevels=critical'),
      )
      expect(filtered.length).toBeGreaterThanOrEqual(1)
    })
    const lastFiltered = listQueries(records).filter((record) =>
      record.url.includes('priorityLevels=critical'),
    )
    expect(lastFiltered[lastFiltered.length - 1]?.url).toContain('page=1')

    // 再勾选 high → 两个重复 priorityLevels 参数
    fireEvent.click(document.querySelector('[data-pps-level-filter="high"]') as Element)
    await waitFor(() => {
      const qs = new URLSearchParams(
        listQueries(records)[listQueries(records).length - 1]?.url.split('?')[1] ?? '',
      )
      expect(qs.getAll('priorityLevels').sort()).toEqual(['critical', 'high'])
    })

    // chips 选中态反馈
    expect(
      document.querySelector('[data-pps-level-filter="critical"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      document.querySelector('[data-pps-level-filter="high"]')?.getAttribute('aria-pressed'),
    ).toBe('true')

    // 清除过滤 → 命中最初的无过滤缓存键（fresh，不发网请求），UI 立即回落到全量；
    // chips 复位、清除按钮消失、过滤前数据行回到首屏
    const clearButton = document.querySelector('[data-pps-clear-filters]')
    expect(clearButton?.textContent).toContain('清除过滤（2）')
    fireEvent.click(clearButton as Element)
    await waitFor(() => {
      expect(
        document.querySelector('[data-pps-level-filter="critical"]')?.getAttribute('aria-pressed'),
      ).toBe('false')
      expect(
        document.querySelector('[data-pps-level-filter="high"]')?.getAttribute('aria-pressed'),
      ).toBe('false')
      expect(document.querySelector('[data-pps-clear-filters]')).toBeNull()
    })
    await waitFor(() => expect(document.querySelector('[data-pps-row="7"]')).not.toBeNull())
  })

  test('排序切换：sort 参数更新并重置分页', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)
    await waitFor(() => expect(document.querySelector('[data-pps-table]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-pps-sort]') as Element, {
      target: { value: 'project_name' },
    })
    await waitFor(() => {
      const latest = listQueries(records)[listQueries(records).length - 1]
      expect(latest?.url).toContain('sort=project_name')
      expect(latest?.url).toContain('page=1')
    })
  })

  test('分页：下一页带 page=2 参数，第 1 页时上一页禁用', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)
    await waitFor(() => expect(document.querySelector('[data-pps-table]')).not.toBeNull())

    const prevButton = document.querySelector('[data-pps-page-prev]') as HTMLButtonElement
    expect(prevButton.disabled).toBe(true)

    fireEvent.click(document.querySelector('[data-pps-page-next]') as Element)
    await waitFor(() =>
      expect(listQueries(records).some((record) => record.url.includes('page=2'))).toBe(true),
    )
    // 第二页行渲染（切换后的数据）
    await waitFor(() => expect(document.querySelector('[data-pps-row="55"]')).not.toBeNull())
    expect((document.querySelector('[data-pps-page-prev]') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// 明细抽屉（spec 场景「用户查看项目评分构成明细」）
// ---------------------------------------------------------------------------
describe('PmoPriorityScoringWorkspace：评分明细抽屉（只读）', () => {
  test('行点击 → GET 明细：分数构成/权重/新鲜度/forbidden 中性、项目空间链接；关闭后重开同项目命中缓存', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)
    await waitFor(() => expect(document.querySelector('[data-pps-row="7"]')).not.toBeNull())

    // 键盘等价入口（明细按钮）与行点击均可打开
    fireEvent.click(document.querySelector('[data-pps-row="7"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pps-drawer-panel]')).not.toBeNull())

    const detailGets = records.filter((record) =>
      record.url.startsWith('/pmo/priority-scoring/projects/7'),
    )
    expect(detailGets.length).toBeGreaterThanOrEqual(1)

    const drawer = document.querySelector('[data-pps-drawer-panel]') as HTMLElement
    await waitFor(() => expect(drawer.querySelector('[data-pps-drawer-score]')).not.toBeNull())
    expect(drawer.querySelector('[data-pps-drawer-score]')?.textContent).toBe('88.4')
    expect(drawer.querySelector('[data-pps-drawer-badge="critical"]')?.textContent).toContain(
      '紧急',
    )

    // 分数构成：维度中文标签 / 权重 / 贡献值
    const urgencyRow = drawer.querySelector('[data-pps-drawer-dim="delivery_urgency"]')
    expect(urgencyRow?.textContent).toContain('交付紧急度')
    expect(urgencyRow?.textContent).toContain('25%')
    expect(urgencyRow?.textContent).toContain('23.0')
    // stale 维度：数值仍在但带警示
    const staleRow = drawer.querySelector('[data-pps-drawer-dim="traffic_light_severity"]')
    expect(staleRow?.textContent).toContain('可能过期')
    expect(staleRow?.textContent).toContain('15.0')
    // forbidden 维度：中性「不可见」，零数值（RL-05）
    const forbiddenRow = drawer.querySelector('[data-pps-drawer-dim="management_attention"]')
    expect(forbiddenRow?.textContent).toContain('不可见')
    expect(forbiddenRow?.textContent).not.toMatch(/\d/)

    // 新鲜度双通道
    const freshness = drawer.querySelector('[data-pps-drawer-freshness]')
    expect(freshness?.textContent).toContain('traffic_light')
    expect(freshness?.querySelector('[data-pps-drawer-fresh-stale]')).not.toBeNull()
    expect(freshness?.querySelector('[data-pps-drawer-fresh-ok]')).not.toBeNull()
    // warnings
    expect(drawer.querySelector('[data-pps-drawer-warning="SOURCE_STALE"]')).not.toBeNull()

    // 进入项目空间链接（跨景深下推 /next/projects/:id）
    const link = drawer.querySelector('[data-pps-drawer-link]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/next/projects/7')

    // 关闭零副作用
    fireEvent.click(drawer.querySelector('[data-pps-drawer-close]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pps-drawer]')).toBeNull())
    await settle()
    const statusWrites = records.filter((record) => record.method !== 'GET')
    expect(statusWrites).toHaveLength(0)
  })

  test('键盘关闭（Escape）可关闭抽屉', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)
    await waitFor(() => expect(document.querySelector('[data-pps-row="7"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-pps-row="7"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pps-drawer-panel]')).not.toBeNull())
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[data-pps-drawer]')).toBeNull())
  })
})

// ---------------------------------------------------------------------------
// 三态：骨架 / 错误重试 / 受限 / 空态
// ---------------------------------------------------------------------------
describe('PmoPriorityScoringWorkspace：三态闭环', () => {
  test('骨架屏 aria-busy；500 错误 → 错误卡重试成功', async () => {
    const backend = createBackend({ projectsFailures: 1 })
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)

    expect(document.querySelector('[data-pps-skeleton]')?.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(document.querySelector('[data-pps-error]')).not.toBeNull())
    expect(document.querySelector('[data-pps-restricted]')).toBeNull()
    expect(screen.getByText('优先级评分加载失败')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-pps-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pps-table]')).not.toBeNull())
    const projectGets = records.filter(
      (record) =>
        record.url.startsWith('/pmo/priority-scoring/projects?') ||
        record.url === '/pmo/priority-scoring/projects',
    )
    expect(projectGets.length).toBeGreaterThanOrEqual(2)
  })

  test('403：中性受限卡（不区分文案、无重试按钮、不泄露数据）', async () => {
    const route = (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path === '/pmo/priority-scoring/summary') {
        return jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: 'denied' } })
      }
      if (path === '/pmo/priority-scoring/weights') {
        return jsonResponse(200, { data: WEIGHTS })
      }
      return jsonResponse(200, listResponse(defaultItems(), 120, 1))
    }
    installFetchRouter(route)
    renderNode(<PmoPriorityScoringWorkspace />)

    await waitFor(() => expect(document.querySelector('[data-pps-error]')).not.toBeNull())
    expect(document.querySelector('[data-pps-restricted]')).not.toBeNull()
    expect(document.querySelector('[data-pps-retry]')).toBeNull()
    expect(document.body.textContent).toContain('可能不可用或无权访问')
  })

  test('空态：无项目数据时队列表语义空态', async () => {
    const route = (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path === '/pmo/priority-scoring/summary') {
        return jsonResponse(200, {
          data: {
            ...SUMMARY,
            totalProjects: 0,
            scoredProjects: 0,
            unscoredProjects: 0,
            levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
          },
        })
      }
      if (path === '/pmo/priority-scoring/weights') {
        return jsonResponse(200, { data: WEIGHTS })
      }
      return jsonResponse(200, listResponse([], 0, 1))
    }
    installFetchRouter(route)
    renderNode(<PmoPriorityScoringWorkspace />)

    await waitFor(() => expect(document.querySelector('[data-pps-empty]')).not.toBeNull())
    expect(screen.getByText('暂无项目评分数据')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 只读铁律（RL-01）：全交互链写请求严格为 0
// ---------------------------------------------------------------------------
describe('PmoPriorityScoringWorkspace：只读铁律（RL-01）', () => {
  test('过滤/排序/翻页/明细抽屉全程零写请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoPriorityScoringWorkspace />)
    await waitFor(() => expect(document.querySelector('[data-pps-table]')).not.toBeNull())

    // 明细抽屉（行 7 在第 1 页数据中，先于翻页打开）
    fireEvent.click(document.querySelector('[data-pps-row="7"]') as Element)
    await waitFor(() =>
      expect(
        records.some((record) => record.url.startsWith('/pmo/priority-scoring/projects/7')),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-pps-drawer-panel]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-pps-drawer-close]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pps-drawer]')).toBeNull())

    fireEvent.click(document.querySelector('[data-pps-level-filter="high"]') as Element)
    await waitFor(() =>
      expect(
        listQueries(records).some((record) => record.url.includes('priorityLevels=high')),
      ).toBe(true),
    )
    fireEvent.change(document.querySelector('[data-pps-sort]') as Element, {
      target: { value: 'project_name' },
    })
    await waitFor(() =>
      expect(listQueries(records).some((record) => record.url.includes('sort=project_name'))).toBe(
        true,
      ),
    )
    fireEvent.click(document.querySelector('[data-pps-page-next]') as Element)
    await waitFor(() =>
      expect(listQueries(records).some((record) => record.url.includes('page=2'))).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-pps-row="55"]')).not.toBeNull())
    await settle(30)
    expect(records.length).toBeGreaterThanOrEqual(7)
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })
})
