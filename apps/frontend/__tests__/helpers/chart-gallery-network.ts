/**
 * 图表馆 W5 集成测试共享网络层辅助（v3-ui-next-chart-gallery tasks 5.1-5.5）。
 *
 * 策略：api 层走真实模块（lib/api/*），网络层 stub 全局 fetch（Request/Response
 * 以最小假对象实现，沿用 __tests__/api-client.test.ts 的既有写法），从而能做
 * 「零写监控」（记录每个请求的 method/url，断言 POST/PATCH/PUT/DELETE 为零）与
 * 精确的端点路由（RL-01 / RL-05 / RL-06）。
 */
import type { Project } from '@/lib/api/projects'
import { vi } from 'vitest'

export const API_PREFIX = 'http://localhost:3333/api/v1'

export interface RequestRecord {
  method: string
  url: string
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** 最小 Response 假对象（jsdom 无真实 Response 语义需求，api-client 只读 ok/status/json）。 */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** 中性项目夹具（organizationId 1）。 */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

export interface FetchRouter {
  /** 每次 fetch 的请求记录（method/完整 url），供零写断言与端点白名单断言。 */
  records: RequestRecord[]
  fetchMock: FetchLike
}

/**
 * 安装全局 fetch 路由桩：
 * - `route(path, method)` 返回 Response 或 null（null → 404 兜底，测试会立即暴露漏配）；
 * - 所有请求按序记入 `records`（写方法子集用 writeMethods(records) 过滤）。
 */
export function installFetchRouter(
  route: (path: string, method: string) => Response | null,
): FetchRouter {
  const records: RequestRecord[] = []
  const fetchMock: FetchLike = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const record = { method, url: rawUrl }
    records.push(record)
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records, fetchMock }
}

export function resetFetchRouter(): void {
  vi.unstubAllGlobals()
}

/** GET 请求 URL 清单（便于断言「仅初始 GET 查询」之外的请求集）。 */
export function getRequestUrls(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method === 'GET').map((record) => record.url)
}

/** 写请求方法清单（POST/PATCH/PUT/DELETE），零写断言 = 长度 0。 */
export function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}
