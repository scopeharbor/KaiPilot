/**
 * v3-ui-next-pmo-domain W5 · tasks 5.5 —— PMO AI 优先级推荐队列：页面装配/RBAC、
 * 摘要计数卡、状态/来源筛选、人工审阅动作闭环（accept/dismiss/snooze/convert）。
 *
 * 覆盖（spec「PMO AI 优先级推荐建议-审阅-采纳闭环」）：
 * - 无 portfolio:view → 受限横幅（data-permission-fallback）且数据接口零请求（RL-06）；
 * - 未选择组织 → 引导态零请求（RL-05）；
 * - G1 端点未注册（404）→ 错误卡 + 重试诚实降级；接口恢复后重试成功（不伪造数据）；
 * - 摘要计数卡（已采纳/待处理等）与列表行（来源/状态/AI 状态/目标项目引用/过期降透明）；
 * - 状态/来源筛选与翻页参数序列化（GET 只读重查，全程零写）；
 * - accept/dismiss/snooze/convert 各自确认流与 POST …/:id/status 端点参数；
 *   convert 说明必填校验、失败回显服务端错误不静默（design D4）；
 * - 动作可用性按状态机收敛（accepted 只余 convert）；无管理权限动作物理隐藏。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PmoAiPriorityRecommendationsPage from '@/app/(next)/next/pmo/ai-priority-recommendations/page'
import { useAuthStore } from '@/stores/auth-store'
import type { PmoRecommendationRecord } from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiFetchEnvelope: envelopeMock }))

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const NOW = '2026-08-20T08:00:00.000Z'

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    totalCount: 12,
    newCount: 3,
    reviewingCount: 1,
    acceptedCount: 5,
    dismissedCount: 1,
    convertedCount: 1,
    criticalCount: 2,
    highCount: 4,
    staleCount: 1,
    aiAvailableCount: 2,
    maxSeverity: 'critical' as const,
    scoringAvailable: true,
    scoringStale: false,
    topRecommendations: [],
    warnings: [],
    generatedAt: NOW,
    ...overrides,
  }
}

function makeQueueItem(id: number, overrides: Record<string, string | boolean> = {}) {
  return {
    id,
    projectId: 100 + id,
    projectName: `组合项目${id}`,
    sourceType: 'priority_scoring',
    title: `推荐 #${id}：项目需要关注`,
    summary: `基于优先级评分的推荐关注项目 ${100 + id}`,
    severity: id % 3 === 0 ? 'critical' : 'high',
    priorityContext: {
      priorityScore: 80 - id,
      priorityLevel: 'high',
      rank: id,
      weightVersion: 'priority-scoring.v1',
      topDimensionContributors: ['delivery_urgency'],
      scoringAvailable: true,
    },
    status: id === 9 ? 'accepted' : 'new',
    aiStatus: id === 7 ? 'available' : 'none',
    sourceSignalCount: 1,
    warningCount: 0,
    stale: false,
    expiresAt: null,
    createdAt: NOW,
    handledBy: null,
    handledAt: null,
    ...overrides,
  }
}

function makeRecord(
  id: number,
  overrides: Partial<PmoRecommendationRecord> = {},
): PmoRecommendationRecord {
  return {
    id,
    organizationId: 1,
    projectId: 100 + id,
    sourceType: 'priority_scoring',
    sourceId: `source-${id}`,
    title: `推荐 #${id}：项目需要关注`,
    summary: `基于优先级评分的推荐关注项目 ${100 + id}`,
    suggestedAction: '查看项目详情并评估风险',
    actionType: 'navigate',
    severity: 'high',
    priorityContext: {
      priorityScore: 80 - id,
      priorityLevel: 'high',
      rank: id,
      weightVersion: 'priority-scoring.v1',
      topDimensionContributors: ['delivery_urgency', 'risk_exposure'],
      scoringAvailable: true,
    },
    sourceSignals: [
      {
        source: 'priority_scoring',
        summary: `项目${100 + id}优先级评分 ${80 - id}`,
        severity: 'medium',
        available: true,
        warnings: [],
        refreshedAt: NOW,
        stale: false,
      },
    ],
    evidenceRefs: [],
    status: id === 9 ? 'accepted' : 'new',
    dedupeKey: `k-${id}`,
    inputSignature: `sig-${id}`,
    candidateVersion: 'pmo-ai-priority-recommendations.v1',
    warnings: [],
    aiMetadata: null,
    aiStatus: 'none',
    expiresAt: null,
    stale: false,
    staleReason: null,
    createdBy: 1,
    handledBy: null,
    handledAt: null,
    snoozedUntil: null,
    reviewReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

interface RouterOptions {
  items?: Array<ReturnType<typeof makeQueueItem>>
  summary?: ReturnType<typeof makeSummary>
  records?: Map<number, PmoRecommendationRecord>
}

function installRouter(options: RouterOptions = {}) {
  const records =
    options.records ?? new Map(options.items?.map((item) => [item.id, makeRecord(item.id)]) ?? [])
  const items = options.items ?? [makeQueueItem(7), makeQueueItem(9)]
  const summary = options.summary ?? makeSummary()
  envelopeMock.mockImplementation((path: string, init?: RequestInit) => {
    const url = String(path)
    const method = init?.method ?? 'GET'
    if (url.includes('/summary')) {
      return Promise.resolve({ data: summary })
    }
    const detailMatch = url.match(/^\/pmo\/ai-priority-recommendations\/(\d+)$/)
    if (detailMatch) {
      const id = Number(detailMatch[1])
      const record = records.get(id) ?? makeRecord(id)
      return Promise.resolve({ data: { record, sourceWarnings: [], conversionIntents: [] } })
    }
    if (method === 'POST' && url.endsWith('/status')) {
      const id = Number(url.split('/').at(-2))
      const record = records.get(id) ?? makeRecord(id)
      const body = JSON.parse(String(init?.body)) as { action: string; reason?: string }
      const status =
        body.action === 'accept'
          ? 'accepted'
          : body.action === 'dismiss'
            ? 'dismissed'
            : body.action === 'snooze'
              ? 'snoozed'
              : 'converted'
      const updated: PmoRecommendationRecord = {
        ...record,
        status: status as PmoRecommendationRecord['status'],
        handledBy: 1,
        handledAt: NOW,
        reviewReason: body.reason ?? null,
      }
      records.set(id, updated)
      return Promise.resolve({ data: { record: updated, conversionIntent: null } })
    }
    if (method === 'POST' && url.endsWith('/refresh')) {
      return Promise.resolve({ data: [], warnings: [], created: 0, merged: 0 })
    }
    if (method === 'POST' && url.endsWith('/ai-rationale')) {
      return Promise.resolve({ data: { aiMetadata: null, record: null } })
    }
    if (method === 'POST') {
      return Promise.reject(Object.assign(new Error('未知写入'), { status: 405 }))
    }
    const query = new URLSearchParams(url.split('?')[1] ?? '')
    const status = query.get('status')
    const sourceType = query.get('sourceType')
    const filtered = items.filter(
      (item) =>
        (status === null || item.status === status) &&
        (sourceType === null || item.sourceType === sourceType),
    )
    return Promise.resolve({
      data: filtered,
      meta: {
        total: filtered.length,
        page: Number(query.get('page') ?? 1),
        perPage: 20,
        totalPages: filtered.length > 0 ? 2 : 0,
      },
      summary,
    })
  })
  return { records, items, summary }
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pmo@example.com',
      fullName: '组合管理员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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
      <PmoAiPriorityRecommendationsPage />
    </QueryClientProvider>,
  )
}

function calls(): Array<{ path: string; init?: RequestInit }> {
  return envelopeMock.mock.calls.map((call) => ({
    path: String(call[0]),
    init: call[1] as RequestInit | undefined,
  }))
}

function writeCalls(): Array<{ path: string; body: Record<string, unknown> }> {
  return calls()
    .filter((call) => call.init?.method && call.init.method !== 'GET')
    .map((call) => ({
      path: call.path,
      body: JSON.parse(String(call.init?.body ?? '{}')) as Record<string, unknown>,
    }))
}

function getCalls(): string[] {
  return calls()
    .filter((call) => !call.init?.method || call.init.method === 'GET')
    .map((call) => call.path)
}

function statusWriteCalls(): Array<{ path: string; body: Record<string, unknown> }> {
  return writeCalls().filter((call) => call.path.includes('/status'))
}

async function settled() {
  await waitFor(() => expect(document.querySelector('[data-pmo-ai-title]')).not.toBeNull())
  await waitFor(() => expect(document.querySelector('[data-pmo-ai-row]')).not.toBeNull())
}

async function openDetailRow(id: number) {
  const row = document.querySelector(`[data-pmo-ai-row-id="${id}"]`)
  expect(row).not.toBeNull()
  fireEvent.click(row as HTMLElement)
  await waitFor(() => expect(document.querySelector('[data-pmo-ai-detail]')).not.toBeNull())
}

function detailEl(): HTMLElement {
  return document.querySelector('[data-pmo-ai-detail]') as HTMLElement
}

async function runStatusFlow(
  actionDataAttr: string,
  confirmText: string,
): Promise<{ path: string; body: Record<string, unknown> }> {
  await openDetailRow(7)
  fireEvent.click(document.querySelector(`[data-pmo-ai-action="${actionDataAttr}"]`) as HTMLElement)
  await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())
  fireEvent.click(
    within(document.querySelector('[data-pmo-ai-confirm]') as HTMLElement).getByText(confirmText),
  )
  await waitFor(() => expect(statusWriteCalls()).toHaveLength(1))
  const write = statusWriteCalls()[0]
  if (!write) throw new Error('expected a status write call')
  return write
}

beforeEach(() => {
  envelopeMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 页面装配 / RBAC / 引导态 / G1 诚实降级
// ---------------------------------------------------------------------------

describe('AI 优先级推荐：页面装配与 RBAC（RL-05/06）', () => {
  test('具备 portfolio:view：工作台装配、摘要与队列渲染、仅 GET 请求', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter()
    renderPage()

    await waitFor(() => expect(screen.getByText('AI 优先级推荐')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelectorAll('[data-pmo-ai-row]').length).toBe(2))
    const acceptedCard = document.querySelector(
      '[data-pmo-ai-summary-card="acceptedCount"]',
    ) as HTMLElement
    expect(within(acceptedCard).getByText('5')).toBeInTheDocument()
    expect(within(acceptedCard).getByText('已采纳')).toBeInTheDocument()
    const requests = getCalls()
    expect(requests.some((path) => path.startsWith('/pmo/ai-priority-recommendations'))).toBe(true)
    expect(requests.some((path) => path.includes('/summary'))).toBe(true)
    expect(writeCalls()).toHaveLength(0)
  })

  test('无 portfolio:view：受限横幅渲染且数据接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    installRouter()
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看 AI 优先级推荐的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })

  test('未选择组织：引导态渲染且零请求（RL-05）', async () => {
    setAuth(['portfolio:view'], null)
    installRouter()
    renderPage()

    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(envelopeMock).not.toHaveBeenCalled()
  })

  test('G1 路由未注册（404）：错误卡 + 重试诚实降级；恢复后重试成功闭环', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter()
    envelopeMock.mockReset()
    envelopeMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('接口未注册'), { status: 404 })),
    )
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-pmo-ai-error]')).not.toBeNull())
    expect(screen.getByText('推荐队列加载失败')).toBeInTheDocument()
    expect(screen.getByText(/尚未开放或不存在/)).toBeInTheDocument()
    expect(screen.getByText(/不会伪造队列数据/)).toBeInTheDocument()

    // 恢复接口后点击重试 → 正常渲染（诚实降级闭环，不伪造数据）
    envelopeMock.mockReset()
    installRouter()
    fireEvent.click(screen.getByText('重新加载'))
    await waitFor(() => expect(document.querySelectorAll('[data-pmo-ai-row]').length).toBe(2))
    expect(document.querySelector('[data-pmo-ai-error]')).toBeNull()
  })

  test('浏览交互（筛选/翻页/行选择）全程零写请求（RL-01）', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter()
    renderPage()
    await settled()

    const statusSelect = screen.getByLabelText('按状态筛选')
    fireEvent.change(statusSelect, { target: { value: 'accepted' } })
    await waitFor(() =>
      expect(getCalls().some((path) => path.includes('status=accepted'))).toBe(true),
    )
    const sourceSelect = screen.getByLabelText('按来源筛选')
    // 选一个既有行命中的来源（priority_scoring），保持队列有行可点
    fireEvent.change(sourceSelect, { target: { value: 'priority_scoring' } })
    await waitFor(() =>
      expect(getCalls().some((path) => path.includes('sourceType=priority_scoring'))).toBe(true),
    )
    await openDetailRow(9)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-ai-detail-status]')).not.toBeNull(),
    )
    expect(writeCalls()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 摘要/队列筛选
// ---------------------------------------------------------------------------

describe('AI 优先级推荐：摘要计数与队列筛选', () => {
  test('摘要计数卡与列表行元数据（来源/状态/AI 状态/目标项目/过期降透明）', async () => {
    setAuth(['portfolio:view'])
    installRouter({
      items: [
        makeQueueItem(1, { status: 'new', stale: true, aiStatus: 'stale' }),
        makeQueueItem(2, { status: 'accepted', aiStatus: 'available' }),
      ],
      summary: makeSummary({ acceptedCount: 1, staleCount: 1 }),
    })
    renderPage()
    await settled()

    const rows = Array.from(document.querySelectorAll('[data-pmo-ai-row]'))
    expect(rows).toHaveLength(2)
    // 过期行降透明 + 过期双通道徽标
    expect((rows[0] as HTMLElement).className).toContain('opacity-60')
    expect(rows[0]?.querySelector('[data-pmo-ai-row-stale]')?.textContent).toBe('数据过期')
    expect(rows[0]?.querySelector('[data-pmo-ai-row-status]')?.textContent).toBe('新推荐')
    expect(rows[0]?.querySelector('[data-pmo-ai-row-source]')?.textContent).toBe('优先级评分')
    expect(rows[0]?.querySelector('[data-pmo-ai-row-ai]')?.textContent).toBe('已过期')
    expect(rows[1]?.querySelector('[data-pmo-ai-row-ai]')?.textContent).toBe('可用')
    // 目标项目引用（TargetRef 语义）
    expect(rows[0]?.querySelector('[data-pmo-ai-row-target]')?.textContent).toContain(
      '目标项目 #101',
    )
    expect(rows[0]?.querySelector('[data-pmo-ai-row-target]')?.textContent).toContain('组合项目1')
    // 摘要计数卡
    const staleCard = document.querySelector(
      '[data-pmo-ai-summary-card="staleCount"]',
    ) as HTMLElement
    expect(within(staleCard).getByText('数据过期')).toBeInTheDocument()
  })

  test('状态/来源筛选携带参数并重置分页；清除筛选恢复', async () => {
    setAuth(['portfolio:view'])
    installRouter()
    renderPage()
    await settled()

    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'accepted' } })
    await waitFor(() =>
      expect(getCalls().some((path) => path.includes('status=accepted'))).toBe(true),
    )
    fireEvent.change(screen.getByLabelText('按来源筛选'), { target: { value: 'traffic_light' } })
    await waitFor(() =>
      expect(getCalls().some((path) => path.includes('sourceType=traffic_light'))).toBe(true),
    )

    fireEvent.click(screen.getByText('清除筛选'))
    // 清空后命中初始缓存键：列表即时回到未过滤状态（2 行）、筛选控件复位
    await waitFor(() => expect(document.querySelectorAll('[data-pmo-ai-row]').length).toBe(2))
    const statusSel = document.querySelector('[data-pmo-ai-filter-status]') as HTMLSelectElement
    const sourceSel = document.querySelector('[data-pmo-ai-filter-source]') as HTMLSelectElement
    expect(statusSel.value).toBe('all')
    expect(sourceSel.value).toBe('all')
    // 换一个从未请求过的状态：新查询只带 status，不带已清除的 sourceType（复位证明）
    fireEvent.change(statusSel, { target: { value: 'reviewing' } })
    await waitFor(() => {
      const latest = getCalls()[getCalls().length - 1] ?? ''
      expect(latest.includes('status=reviewing')).toBe(true)
      expect(latest.includes('sourceType=')).toBe(false)
    })
  })

  test('筛选后空队列：语义空态 + 清除筛选入口', async () => {
    setAuth(['portfolio:view'])
    installRouter({ items: [makeQueueItem(1), makeQueueItem(2)] })
    renderPage()
    await settled()

    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'converted' } })
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-empty]')).not.toBeNull())
    expect(screen.getByText('当前没有需要关注的推荐')).toBeInTheDocument()
    fireEvent.click(screen.getByText('清除筛选并查看全部'))
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-row]')).not.toBeNull())
  })

  test('翻页：下一页携带 page=2；首页时上一页禁用', async () => {
    setAuth(['portfolio:view'])
    installRouter()
    renderPage()
    await settled()

    const prev = document.querySelector('[data-pmo-ai-page-prev]') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    fireEvent.click(document.querySelector('[data-pmo-ai-page-next]') as HTMLElement)
    await waitFor(() => expect(getCalls().some((path) => path.includes('page=2'))).toBe(true))
  })

  test('行点击打开详情：详情 GET 发出、目标项目下钻链接、来源信号回显', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter({ items: [makeQueueItem(7, { status: 'new' })] })
    renderPage()
    await settled()
    await openDetailRow(7)

    expect(getCalls().some((path) => path === '/pmo/ai-priority-recommendations/7')).toBe(true)
    const projectLink = detailEl().querySelector('[data-pmo-ai-detail-project]')
    expect(projectLink?.getAttribute('href')).toBe('/next/projects/107')
    expect(detailEl().querySelector('[data-pmo-ai-detail-status]')?.textContent).toBe('新推荐')
    expect(screen.getByText('来源信号（1）')).toBeInTheDocument()
    expect(screen.getByText('项目107优先级评分 73')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 人工审阅动作闭环
// ---------------------------------------------------------------------------

describe('AI 优先级推荐：人工审阅动作（RL-01）', () => {
  test('accept：确认弹窗 → POST …/7/status {action:accept} → 详情刷新为已采纳', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    const router = installRouter({
      items: [makeQueueItem(7, { status: 'new', title: '推荐 #7：接受目标' })],
    })
    renderPage()
    await settled()

    const write = await runStatusFlow('accept', '确认接受')
    expect(write.path).toContain('/7/status')
    expect(write.body).toEqual({ action: 'accept' })
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).toBeNull())
    await waitFor(() =>
      expect(detailEl().querySelector('[data-pmo-ai-detail-status]')?.textContent).toBe('已采纳'),
    )
    expect(router.records.get(7)?.status).toBe('accepted')
  })

  test('dismiss：确认后 POST {action:dismiss}', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter({ items: [makeQueueItem(7, { status: 'new' })] })
    renderPage()
    await settled()

    const write = await runStatusFlow('dismiss', '确认忽略')
    expect(write.body).toEqual({ action: 'dismiss' })
  })

  test('snooze：选择 3 天 → POST {action:snooze, snoozeUntil:~72h}', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter({ items: [makeQueueItem(7, { status: 'new' })] })
    renderPage()
    await settled()
    await openDetailRow(7)

    fireEvent.click(document.querySelector('[data-pmo-ai-action="snooze"]') as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())
    const dialog = document.querySelector('[data-pmo-ai-confirm]') as HTMLElement
    fireEvent.change(dialog.querySelector('[data-pmo-ai-snooze-option]') as HTMLElement, {
      target: { value: '72' },
    })
    fireEvent.click(within(dialog).getByText('确认稍后处理'))
    await waitFor(() => expect(statusWriteCalls()).toHaveLength(1))
    const writes = statusWriteCalls()
    const body = (writes[0]?.body ?? {}) as { action: string; snoozeUntil: string }
    expect(body.action).toBe('snooze')
    const hours = Math.abs(Date.parse(body.snoozeUntil) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(70)
    expect(hours).toBeLessThan(74)
  })

  test('convert：说明必填校验 → 目标引用 + 说明 → 二次确认 POST 参数对齐', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter({ items: [makeQueueItem(9, { status: 'accepted', title: '推荐 #9：转化目标' })] })
    renderPage()
    await settled()
    await openDetailRow(9)

    // accepted 状态机只余 convert
    expect(document.querySelector('[data-pmo-ai-action="accept"]')).toBeNull()
    expect(document.querySelector('[data-pmo-ai-action="dismiss"]')).toBeNull()
    expect(document.querySelector('[data-pmo-ai-action="convert"]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-pmo-ai-action="convert"]') as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())
    const dialog = document.querySelector('[data-pmo-ai-confirm]') as HTMLElement
    // 空说明 → 本地校验拦截，零写请求
    fireEvent.click(within(dialog).getByText('确认转化'))
    expect(screen.getByText('请填写转化说明（说明转化动机与期望结果）')).toBeInTheDocument()
    expect(statusWriteCalls()).toHaveLength(0)

    // 选目标 + 填说明 → 提交
    fireEvent.change(dialog.querySelector('[data-pmo-ai-convert-target]') as HTMLElement, {
      target: { value: 'risk' },
    })
    fireEvent.change(dialog.querySelector('[data-pmo-ai-convert-reason]') as HTMLElement, {
      target: { value: '建议转为风险登记跟进' },
    })
    fireEvent.click(within(dialog).getByText('确认转化'))
    await waitFor(() => expect(statusWriteCalls()).toHaveLength(1))
    const convertWrites = statusWriteCalls()
    expect(convertWrites[0]?.body).toEqual({
      action: 'convert',
      convertTarget: 'risk',
      convertParams: {},
      reason: '建议转为风险登记跟进',
    })
  })

  test('服务端错误回显：弹窗保持打开、错误可见、取消不静默', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter({ items: [makeQueueItem(7, { status: 'new' })] })
    renderPage()
    await settled()
    await openDetailRow(7)

    // 使 status 写入失败（服务端 409 语义）
    envelopeMock.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const url = String(path)
      if (method === 'POST') {
        return Promise.reject(
          Object.assign(new Error('服务端版本冲突，请刷新后重试'), { status: 409 }),
        )
      }
      if (url.includes('/summary')) {
        return Promise.resolve({ data: makeSummary() })
      }
      const detailMatch = url.match(/^\/pmo\/ai-priority-recommendations\/(\d+)$/)
      if (detailMatch) {
        return Promise.resolve({
          data: {
            record: makeRecord(Number(detailMatch[1])),
            sourceWarnings: [],
            conversionIntents: [],
          },
        })
      }
      return Promise.resolve({
        data: [makeQueueItem(7)],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        summary: makeSummary(),
      })
    })

    fireEvent.click(document.querySelector('[data-pmo-ai-action="accept"]') as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())
    const dialog = document.querySelector('[data-pmo-ai-confirm]') as HTMLElement
    fireEvent.click(within(dialog).getByText('确认接受'))
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-ai-confirm-server-error]')).not.toBeNull(),
    )
    // 失败回显（弹窗内 + 面板错误条），输入保留不静默
    expect(
      within(dialog).getAllByText('服务端版本冲突，请刷新后重试').length,
    ).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull()
    fireEvent.click(within(dialog).getByText('取消'))
    expect(document.querySelector('[data-pmo-ai-confirm]')).toBeNull()
  })

  test('取消确认弹窗不产生任何写请求', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter({ items: [makeQueueItem(7, { status: 'new' })] })
    renderPage()
    await settled()
    await openDetailRow(7)

    fireEvent.click(document.querySelector('[data-pmo-ai-action="accept"]') as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())
    fireEvent.click(
      within(document.querySelector('[data-pmo-ai-confirm]') as HTMLElement).getByText('取消'),
    )
    expect(document.querySelector('[data-pmo-ai-confirm]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeCalls()).toHaveLength(0)
  })

  test('刷新推荐：二次确认后 POST /refresh；失败回显', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    installRouter()
    renderPage()
    await settled()

    fireEvent.click(screen.getByText('刷新推荐'))
    expect(document.querySelector('[data-pmo-ai-refresh-confirm]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-pmo-ai-refresh-confirm-ok]') as HTMLElement)
    await waitFor(() =>
      expect(writeCalls().some((call) => call.path.endsWith('/refresh'))).toBe(true),
    )
    expect(writeCalls().find((call) => call.path.endsWith('/refresh'))?.body).toEqual({})
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-refresh-confirm]')).toBeNull())
  })

  test('无管理权限（MEMBER）：刷新/审阅/生成 AI 理由入口全部物理隐藏（RL-06）', async () => {
    setAuth(['portfolio:view'])
    installRouter({ items: [makeQueueItem(7, { status: 'new' })] })
    renderPage()
    await settled()
    await openDetailRow(7)

    expect(document.querySelector('[data-pmo-ai-refresh]')).toBeNull()
    expect(document.querySelector('[data-pmo-ai-action]')).toBeNull()
    expect(document.querySelector('[data-pmo-ai-rationale-open]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeCalls()).toHaveLength(0)
  })
})
