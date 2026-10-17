/**
 * v3-ui-next-resource-team-domains W1 · tasks 1.4 —— 紧凑负荷面板（Compact Load HUD）
 * 组件测试（ResourceLoadCompactView + 伪后端）。
 *
 * 覆盖（spec「资源负载分析紧凑视图与图表馆联动建议」场景）：
 * - 团队负荷数据渲染：成员行（头像缩写/姓名/角色标签）、工时条带冷蓝正常段，
 *   超载成员追加警戒红段与「过载」徽章；
 * - 数值回显：已分配/总额定（如 100h / 160h）与利用率百分比微标（62.5% / 115%）；
 * - 30 天滑动窗口标签回显；
 * - 点击「进入图表馆深度分析」→ router.push('/next/projects/42/charts/resource-load')；
 * - RL-01 只读铁律：加载 + 高频视图交互全程零写请求（全 GET）；
 * - 空态与 500 错误重试闭环。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ResourceLoadCompactView } from '@/components/next/resources/ResourceLoadCompactView'
import type { ResourceLoadItem, ResourceLoadResult } from '@/lib/api/resources'
import {
  createDefaultLoadWindow,
  NX_NORMAL_COLOR,
  NX_OVERLOAD_COLOR,
} from '@/lib/next/resources/resource-workbench-adapter'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/resources',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 伪后端（只读资源负荷端点）
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

export interface RequestRecord {
  method: string
  url: string
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    records.push({ method, url: rawUrl.replace(API_PREFIX, '') })
    const matched = await route(rawUrl.replace(API_PREFIX, ''), method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function makeLoadItem(
  resourceId: number,
  resourceName: string,
  allocatedDays: Array<{ capacity: number; allocated: number }>,
  role = 'member',
): ResourceLoadItem {
  return {
    resourceId,
    resourceName,
    role,
    dailyCapacityHours: 8,
    days: allocatedDays.map((d, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      totalAllocatedPercent: 0,
      capacityHours: d.capacity,
      allocatedHours: d.allocated,
    })),
    overallUtilizationPercent: 0,
  }
}

function loadResult(items: ResourceLoadItem[]): ResourceLoadResult {
  return {
    from: '2026-08-01',
    to: '2026-08-30',
    resources: items,
    teamAverageUtilizationPercent: 0,
  }
}

/** 20 个工作日：正常成员分配 100h / 容量 160h = 62.5%；超载成员 184h / 160h = 115%。 */
function seedItems(): ResourceLoadItem[] {
  const normalDays = Array.from({ length: 20 }, () => ({ capacity: 8, allocated: 5 }))
  const overloadDays = Array.from({ length: 20 }, (_, index) => ({
    capacity: 8,
    allocated: index === 0 ? 32 : 8,
  }))
  return [
    makeLoadItem(11, '张工', normalDays, 'team_lead'),
    makeLoadItem(12, '李工', overloadDays, 'member'),
    makeLoadItem(
      13,
      '王工',
      Array.from({ length: 20 }, () => ({ capacity: 8, allocated: 0 })),
    ),
  ]
}

function createBackend({ failLoad = false } = {}) {
  let failNext = failLoad
  const route = (path: string, method: string): Response | null => {
    if (/^\/projects\/42\/resources\/load(\?|$)/.test(path) && method === 'GET') {
      if (failNext) {
        failNext = false
        return jsonResponse(500, { error: { code: 'INTERNAL', message: '负荷服务异常' } })
      }
      return jsonResponse(200, { data: loadResult(seedItems()) })
    }
    return null
  }
  return { route }
}

function renderPanel(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

/** hex → css rgb()（React 内联样式会被归一为 rgb，断言用同一表示）。 */
function rgbOf(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  resetFetchRouter()
})

describe('ResourceLoadCompactView：团队负荷条带渲染（spec 场景「切换至负载分析视图查看成员利用率」）', () => {
  test('成员行齐备：姓名 / 角色标签 / 正常冷蓝条带与 115% 超载红段 +「过载」徽章', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)

    expect(document.querySelector('[data-load-compact-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(3))

    // 正常成员：无红段；蓝段使用 --nx-chart-1 冷蓝（NX_NORMAL_COLOR）
    const normalRow = document.querySelector('[data-load-member="11"]')
    expect(normalRow?.textContent).toContain('张工')
    expect(normalRow?.textContent).toContain('团队负责人')
    const normalBar = normalRow?.querySelector('[data-load-bar-normal]')
    expect(normalBar?.getAttribute('style')).toContain(rgbOf(NX_NORMAL_COLOR))
    expect(normalRow?.querySelector('[data-load-bar-overload]')).toBeNull()
    expect(normalRow?.querySelector('[data-load-badge="normal"]')?.textContent).toContain('正常')
    expect(normalRow?.querySelector('[data-load-badge="overload"]')).toBeNull()

    // 超载成员（115%）：蓝段 + 红段（NX_OVERLOAD_COLOR）+ 过载徽章 + 危险红百分比
    const overloadRow = document.querySelector('[data-load-member="12"]')
    expect(overloadRow?.textContent).toContain('李工')
    expect(overloadRow?.textContent).toContain('成员')
    const overloadNormal = overloadRow?.querySelector('[data-load-bar-normal]')
    expect(overloadNormal?.getAttribute('style')).toContain(rgbOf(NX_NORMAL_COLOR))
    const overloadRed = overloadRow?.querySelector('[data-load-bar-overload]')
    expect(overloadRed).not.toBeNull()
    expect(overloadRed?.getAttribute('style')).toContain(rgbOf(NX_OVERLOAD_COLOR))
    expect(overloadRow?.querySelector('[data-load-badge="overload"]')?.textContent).toContain(
      '过载',
    )
    const percent = overloadRow?.querySelector('[data-load-bar-percent]')
    expect(percent?.textContent).toContain('115%')
    expect(percent?.className).toContain('text-[var(--nx-status-danger)]')

    // 空闲成员：未分配徽章
    const idleRow = document.querySelector('[data-load-member="13"]')
    expect(idleRow?.querySelector('[data-load-badge="idle"]')?.textContent).toContain('未分配')
  })

  test('数值回显：「已分配 / 总额定」工时与利用率微标', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(3))

    const normalRow = document.querySelector('[data-load-member="11"]')
    expect(normalRow?.querySelector('[data-load-bar-metrics]')?.textContent).toBe('100h / 160h')
    expect(normalRow?.querySelector('[data-load-bar-percent]')?.textContent).toBe('62.5%')

    const overloadRow = document.querySelector('[data-load-member="12"]')
    expect(overloadRow?.querySelector('[data-load-bar-metrics]')?.textContent).toBe('184h / 160h')
    expect(overloadRow?.querySelector('[data-load-bar-percent]')?.textContent).toBe('115%')
  })

  test('窗口标签回显：30 天滑动窗口（今天含）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(3))
    const window = createDefaultLoadWindow()
    expect(document.querySelector('[data-load-compact-window]')?.textContent).toContain(
      `${window.from} ~ ${window.to} · 30 天滑动窗口 · 只读`,
    )
  })
})

describe('ResourceLoadCompactView：图表馆深度分析直达', () => {
  test('点击「进入图表馆深度分析」平滑导航至 /next/projects/42/charts/resource-load', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(3))

    const deepLink = document.querySelector('[data-load-compact-deep-link]')
    expect(deepLink?.textContent).toContain('进入图表馆深度分析')
    fireEvent.click(deepLink as Element)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/resource-load')
  })
})

describe('ResourceLoadCompactView：RL-01 纯只读零写请求', () => {
  test('加载、悬停与深链跳转交互全程零 POST/PATCH/DELETE 请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(3))

    // 高频交互：鼠标滑过成员行 / 徽章 / 面板头部
    const rows = Array.from(document.querySelectorAll('[data-load-member]'))
    for (const row of rows) {
      fireEvent.mouseOver(row)
      fireEvent.mouseMove(row)
    }
    fireEvent.click(document.querySelector('[data-load-compact-deep-link]') as Element)

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records.length).toBeGreaterThan(0)
    expect(records.every((record) => record.method === 'GET')).toBe(true)
    expect(records.filter((record) => record.method !== 'GET')).toHaveLength(0)
  })
})

describe('ResourceLoadCompactView：空态 / 错误重试三态', () => {
  test('无负荷数据时渲染语义化空态', async () => {
    const route = (path: string, method: string): Response | null => {
      if (/^\/projects\/42\/resources\/load(\?|$)/.test(path) && method === 'GET') {
        return jsonResponse(200, {
          data: {
            from: '2026-08-01',
            to: '2026-08-30',
            resources: [],
            teamAverageUtilizationPercent: 0,
          },
        })
      }
      return null
    }
    const { records } = installFetchRouter(route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)
    await waitFor(() => expect(document.querySelector('[data-load-compact-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目暂无团队成员负荷数据')).toBeInTheDocument()
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })

  test('500 错误渲染警示卡，点击重试后成功载入', async () => {
    const backend = createBackend({ failLoad: true })
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceLoadCompactView projectId={42} />)

    await waitFor(() => expect(document.querySelector('[data-load-compact-error]')).not.toBeNull())
    expect(screen.getByText(/负荷数据加载失败/)).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-load-compact-retry]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(3))
    expect(document.querySelector('[data-load-compact-error]')).toBeNull()
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })
})
