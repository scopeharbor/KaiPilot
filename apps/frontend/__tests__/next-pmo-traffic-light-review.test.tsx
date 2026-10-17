/**
 * v3-ui-next-pmo-domain W2 · tasks 2.4 —— 红绿灯人工复核闭环测试
 * （弹窗必填校验 / 二次确认 / upsert 调用 / manage 门禁 / 失败回显）。
 *
 * 覆盖（spec「管理层用户对红灯项目执行人工复核」/ design Decision 4、RL-01）：
 * - 复核入口仅 portfolio:manage 可见，只读用户物理隐藏且零写（RL-06）；
 * - 复核状态来自 TRAFFIC_LIGHT_REVIEW_STATES、备注必填校验；
 * - 「下一步 → 二次确认」双步：确认页摘要（项目/灯色/状态/备注）核对后才
 *   POST /pmo/traffic-light/:projectId/review，成功后列表缓存刷新（invalidate）；
 * - 服务端失败回显错误文案、弹窗保持打开、输入保留（不覆盖不静默）；
 * - 关闭（按钮/Escape）不产生任何状态写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoTrafficLightPage from '@/app/(next)/next/pmo/traffic-light/page'
import type {
  PortfolioTrafficLightItem,
  TrafficLightRuleId,
  TrafficLightSeverity,
  TrafficLightStatus,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo/traffic-light',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话与夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[]) {
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
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeEvidence(
  ruleId: TrafficLightRuleId,
  severity: TrafficLightSeverity,
  status: TrafficLightStatus,
  message: string,
) {
  return {
    ruleId,
    ruleVersion: 'pmo-traffic-light-v1',
    severity,
    status,
    message,
    evidenceRefs: [],
    sourceFreshness: {
      source: 'project_dashboard' as const,
      lastUpdatedAt: null,
      isStale: false,
      staleReason: null,
    },
    contributing: true,
  }
}

function redItem(): PortfolioTrafficLightItem {
  return {
    projectId: 1001,
    projectName: '开项核心引擎',
    projectStatus: 'active',
    trafficLight: 'red',
    severityCounts: { critical: 1, high: 1, medium: 0, low: 0 },
    sourceFreshness: {
      overallStale: false,
      staleSources: [],
      lastUpdatedAt: '2026-09-10T08:00:00.000Z',
    },
    evidence: [makeEvidence('TL-R01', 'critical', 'red', '关键里程碑已错过 1 个')],
    warnings: [],
    reviewState: { reviewState: 'acknowledged', reviewedAt: null, reviewedBy: null, stale: false },
    ruleVersion: 'pmo-traffic-light-v1',
    calculatedAt: '2026-09-10T08:00:00.000Z',
    allowedActions: { canReview: true, canViewDetail: true },
  }
}

// ---------------------------------------------------------------------------
// 伪后端（GET 默认路由 + 可插拔 POST 处理器）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body?: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(
  route: (path: string, method: string, body?: string) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body: init?.body ? String(init.body) : undefined })
    const matched = route(path, method, init?.body ? String(init.body) : undefined)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function listBody() {
  return {
    data: [redItem()],
    meta: {
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
      calculatedAt: '2026-09-10T08:00:00.000Z',
    },
  }
}

function countsBody() {
  return {
    data: {
      red: 1,
      yellow: 0,
      green: 0,
      gray: 0,
      total: 1,
      calculatedAt: '2026-09-10T08:00:00.000Z',
    },
  }
}

/** 默认 GET 路由 + 可选写端点处理器。 */
function installRouter(postHandler?: (path: string, body?: string) => Response | null): {
  records: RequestRecord[]
} {
  return installFetchRouter((path, method, body) => {
    if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
      return jsonResponse(200, countsBody())
    }
    if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
      return jsonResponse(200, listBody())
    }
    if (postHandler) {
      const handled = postHandler(path, body)
      if (handled) return handled
    }
    return null
  })
}

function writeRecords(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoTrafficLightPage />
    </QueryClientProvider>,
  )
}

async function openReviewModal() {
  const reviewButton = await screen.findByLabelText('复核项目：开项核心引擎')
  fireEvent.click(reviewButton)
  await waitFor(() => expect(document.querySelector('[data-traffic-review-modal]')).not.toBeNull())
}

beforeEach(() => {
  navMock.push.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
  resetFetchRouter()
})

describe('PmoTrafficLightReviewModal：人工复核闭环（RL-01 零自动写）', () => {
  test('管理用户复核红灯：备注必填 → 二次确认摘要 → POST upsert → 缓存失效刷新', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'])
    const { records } = installRouter((path) => {
      if (path === '/pmo/traffic-light/1001/review') {
        return jsonResponse(200, {
          data: {
            id: 501,
            projectId: 1001,
            organizationId: 1,
            actorId: 1,
            reviewState: 'needs_follow_up',
            note: '已与项目负责人确认追赶计划',
            ruleVersion: 'pmo-traffic-light-v1',
            inputSignatureHash: 'abc123',
            stale: false,
            previousReviewState: null,
            createdAt: '2026-09-10T09:00:00.000Z',
            updatedAt: '2026-09-10T09:00:00.000Z',
          },
        })
      }
      return null
    })
    renderPage()
    await openReviewModal()
    expect(screen.getByText(/当前灯色：红灯/)).toBeInTheDocument()

    // 备注必填：直接下一步被拦截且零写请求
    fireEvent.click(document.querySelector('[data-review-to-confirm]')!)
    await waitFor(() => expect(screen.getByText('请填写复核备注后再继续')).toBeInTheDocument())
    expect(writeRecords(records).length).toBe(0)

    // 选择复核状态 + 填写备注 → 二次确认页（摘要核对）
    fireEvent.change(document.querySelector('[data-review-state]')!, {
      target: { value: 'needs_follow_up' },
    })
    fireEvent.change(document.querySelector('[data-review-note]')!, {
      target: { value: '已与项目负责人确认，9/14 前完成关键里程碑追赶' },
    })
    fireEvent.click(document.querySelector('[data-review-to-confirm]')!)
    await waitFor(() => expect(document.querySelector('[data-review-summary]')).not.toBeNull())
    expect(screen.getByText('需跟进')).toBeInTheDocument()
    expect(screen.getByText('已与项目负责人确认，9/14 前完成关键里程碑追赶')).toBeInTheDocument()

    // 二次确认提交 → POST body 断言 + 弹窗关闭
    fireEvent.click(document.querySelector('[data-review-submit]')!)
    await waitFor(() => expect(document.querySelector('[data-traffic-review-modal]')).toBeNull())

    const posts = writeRecords(records)
    expect(posts.length).toBe(1)
    expect(posts[0]?.url).toBe('/pmo/traffic-light/1001/review')
    expect(JSON.parse(posts[0]?.body ?? '{}')).toEqual({
      reviewState: 'needs_follow_up',
      note: '已与项目负责人确认，9/14 前完成关键里程碑追赶',
    })
    // invalidateQueries(['pmo','traffic-light']) → 列表自动重新拉取
    await waitFor(() =>
      expect(
        records.filter((record) => record.url.startsWith('/pmo/traffic-light?')).length,
      ).toBeGreaterThanOrEqual(2),
    )
  })

  test('服务端失败：错误回显、弹窗保持打开、输入保留（不覆盖不静默）', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'])
    const { records } = installRouter(() =>
      jsonResponse(409, {
        error: { code: 'REVIEW_CONFLICT', message: '复核写入冲突：数据已变化，请重新提交' },
      }),
    )
    renderPage()
    await openReviewModal()

    fireEvent.change(document.querySelector('[data-review-note]')!, {
      target: { value: '备注内容需要保留' },
    })
    fireEvent.click(document.querySelector('[data-review-to-confirm]')!)
    await waitFor(() => expect(document.querySelector('[data-review-submit]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-review-submit]')!)
    await waitFor(() => expect(document.querySelector('[data-review-server-error]')).not.toBeNull())
    expect(screen.getByText('复核写入冲突：数据已变化，请重新提交')).toBeInTheDocument()
    // 弹窗保持打开，输入保留，仅一次写请求
    expect(document.querySelector('[data-traffic-review-modal]')).not.toBeNull()
    expect(writeRecords(records).length).toBe(1)

    fireEvent.click(document.querySelector('[data-review-back]')!)
    await waitFor(() => expect(document.querySelector('[data-review-state]')).not.toBeNull())
    expect((document.querySelector('[data-review-note]') as HTMLTextAreaElement).value).toBe(
      '备注内容需要保留',
    )
  })

  test('关闭（关闭按钮 / Escape）不产生任何写请求（RL-01）', async () => {
    setAuth(['portfolio:view', 'portfolio:manage'])
    const { records } = installRouter()
    renderPage()
    await openReviewModal()

    fireEvent.change(document.querySelector('[data-review-note]')!, {
      target: { value: '写了一半的备注' },
    })
    fireEvent.click(document.querySelector('[data-traffic-review-close]')!)
    await waitFor(() => expect(document.querySelector('[data-traffic-review-modal]')).toBeNull())
    expect(writeRecords(records).length).toBe(0)

    // 再次打开后 Escape 关闭同样零写
    await openReviewModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[data-traffic-review-modal]')).toBeNull())
    expect(writeRecords(records).length).toBe(0)
  })

  test('只读用户（仅 portfolio:view）：复核入口物理隐藏且零写请求（RL-06/RL-01）', async () => {
    setAuth(['portfolio:view'])
    const { records } = installRouter()
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-traffic-row]')).not.toBeNull())
    expect(document.querySelector('[data-review-button]')).toBeNull()
    expect(screen.queryByLabelText('复核项目：开项核心引擎')).toBeNull()
    // 行点击（下钻项目空间）全程零写
    fireEvent.click(document.querySelector('[data-traffic-row]')!)
    await waitFor(() => expect(navMock.push).toHaveBeenCalledWith('/next/projects/1001'))
    expect(writeRecords(records).length).toBe(0)
  })
})
