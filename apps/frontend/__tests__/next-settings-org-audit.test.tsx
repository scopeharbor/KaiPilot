/**
 * v3-ui-next-settings-admin-domains W2 · tasks 2.8 —— 组织审计日志页测试
 * （spec「组织审计日志检索」+ RL-06 / RL-12）。
 *
 * 覆盖：
 * - 过滤条件组合（事件 / 操作 / 级别 / 起止日期 / 操作人）写入请求参数，改动重置页码；
 * - 分页：`meta.total` 展示与上一页/下一页请求参数（page 递增，perPage 恒定）；
 * - 行渲染：时间（UTC）、事件中文、操作、级别双通道、操作人、对象、结果；
 * - 无 `audit:view`：受限横幅且 `/audit-logs` **零请求**（RL-06）；
 * - 全程只读：交互过程 0 写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import OrgAuditLogsPage from '@/app/(next)/next/settings/audit-logs/page'
import type { AuditLogEntry } from '@/lib/api/audit-logs'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/settings/audit-logs',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

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

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    return (
      route(path, method) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
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

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    createdAt: '2026-09-05T03:15:42.000Z',
    action: 'update',
    event: 'ROLE_CHANGED',
    severity: 'warning',
    userId: 7,
    organizationId: 1,
    projectId: null,
    entityType: 'organization_member',
    entityId: 11,
    requestId: 'req-1',
    userName: '张三',
    organizationName: '北极星研发部',
    entityName: '李四',
    projectName: null,
    ...overrides,
  }
}

function auditRoute(
  rows: AuditLogEntry[],
  meta: { total: number; page: number; perPage: number; totalPages: number },
): (path: string, method: string) => Response | null {
  return (path, method) => {
    if (path.startsWith('/audit-logs') && method === 'GET') {
      return jsonResponse(200, { data: rows, meta })
    }
    return null
  }
}

function auditRequests(records: RequestRecord[]): string[] {
  return records.filter((record) => record.url.startsWith('/audit-logs')).map((r) => r.url)
}

function writeRecords(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

function settle(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  setAuth(['audit:view'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('准入门禁（RL-06）', () => {
  test('无 audit:view：受限横幅 + 审计接口零请求', async () => {
    setAuth(['org:view'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<OrgAuditLogsPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(text()).toContain('没有查看审计日志的权限')
    await settle()
    expect(records).toHaveLength(0)
  })
})

describe('行渲染与双通道状态', () => {
  test('渲染时间/事件/操作/级别/操作人/对象，且全程零写请求', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 1, page: 1, perPage: 20, totalPages: 1 }),
    )
    renderWithClient(<OrgAuditLogsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-audit-row="1"]')).not.toBeNull())
    const row = document.querySelector('[data-org-audit-row="1"]')!
    expect(row.textContent).toContain('2026-09-05 03:15:42')
    expect(row.textContent).toContain('变更角色')
    expect(row.textContent).toContain('更新')
    // 级别双通道：颜色类 + 中文文本。
    expect(document.querySelector('[data-org-audit-severity="1"]')?.textContent).toBe('警告')
    expect(row.textContent).toContain('张三')
    expect(row.textContent).toContain('李四')
    expect(row.textContent).toContain('成功')

    // 交互（刷新）后仍为零写请求。
    await waitFor(async () => {
      fireEvent.click(document.querySelector('[data-org-audit-refresh]')!)
      await settle()
    })
    expect(writeRecords(records)).toEqual([])
  })

  test('错误级别：结果列呈「失败/异常」；无 userName 时回退「用户 #id」', async () => {
    installFetchRouter(
      auditRoute([makeEntry({ id: 2, severity: 'critical', userName: null })], {
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      }),
    )
    renderWithClient(<OrgAuditLogsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-audit-row="2"]')).not.toBeNull())
    const row = document.querySelector('[data-org-audit-row="2"]')!
    expect(row.textContent).toContain('失败/异常')
    expect(row.textContent).toContain('用户 #7')
    expect(document.querySelector('[data-org-audit-severity="2"]')?.textContent).toBe('严重')
  })

  test('空结果显示语义化空态；带过滤条件时空态文案区分', async () => {
    installFetchRouter(auditRoute([], { total: 0, page: 1, perPage: 20, totalPages: 0 }))
    renderWithClient(<OrgAuditLogsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-audit-empty]')).not.toBeNull())
    expect(text()).toContain('暂无审计记录')

    fireEvent.change(document.querySelector('[data-org-audit-filter-event]')!, {
      target: { value: 'ROLE_CHANGED' },
    })
    await waitFor(() => expect(text()).toContain('没有命中的审计记录'))
  })

  test('接口 5xx：错误卡「重新载入」恢复', async () => {
    let attempts = 0
    installFetchRouter((path, method) => {
      if (path.startsWith('/audit-logs') && method === 'GET') {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, {
          data: [makeEntry()],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })
    renderWithClient(<OrgAuditLogsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-audit-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-org-audit-retry]')!)
    await waitFor(() => expect(document.querySelector('[data-org-audit-row="1"]')).not.toBeNull())
  })
})

describe('过滤条件组合与分页参数（spec 场景：筛选近 7 天 + 分页）', () => {
  test('过滤组合写入请求参数，且变更过滤重置页码', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 45, page: 1, perPage: 20, totalPages: 3 }),
    )
    renderWithClient(<OrgAuditLogsPage />)
    await waitFor(() => expect(document.querySelector('[data-org-audit-row="1"]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-org-audit-filter-event]')!, {
      target: { value: 'ROLE_CHANGED' },
    })
    fireEvent.change(document.querySelector('[data-org-audit-filter-action]')!, {
      target: { value: 'update' },
    })
    fireEvent.change(document.querySelector('[data-org-audit-filter-severity]')!, {
      target: { value: 'warning' },
    })
    fireEvent.change(document.querySelector('[data-org-audit-filter-date-from]')!, {
      target: { value: '2026-08-30' },
    })
    fireEvent.change(document.querySelector('[data-org-audit-filter-date-to]')!, {
      target: { value: '2026-09-05' },
    })
    fireEvent.change(document.querySelector('[data-org-audit-filter-actor]')!, {
      target: { value: '7' },
    })

    await waitFor(() => {
      const last = auditRequests(records).at(-1)!
      expect(last).toContain('event=ROLE_CHANGED')
      expect(last).toContain('action=update')
      expect(last).toContain('severity=warning')
      expect(last).toContain('dateFrom=2026-08-30')
      expect(last).toContain('dateTo=2026-09-05')
      expect(last).toContain('actorId=7')
      expect(last).toContain('page=1')
      expect(last).toContain('perPage=20')
    })

    await waitFor(() =>
      expect(document.querySelector('[data-org-audit-total]')?.textContent).toContain(
        '共 45 条记录',
      ),
    )
  })

  test('分页：下一页写入 page=2，上一页回到 page=1；首页上一页禁用', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 45, page: 1, perPage: 20, totalPages: 3 }),
    )
    renderWithClient(<OrgAuditLogsPage />)
    await waitFor(() => expect(document.querySelector('[data-org-audit-row="1"]')).not.toBeNull())

    expect((document.querySelector('[data-org-audit-prev]') as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.click(document.querySelector('[data-org-audit-next]')!)
    await waitFor(() =>
      expect(auditRequests(records).some((url) => url.includes('page=2'))).toBe(true),
    )
    await waitFor(() =>
      expect((document.querySelector('[data-org-audit-prev]') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.click(document.querySelector('[data-org-audit-prev]')!)
    await waitFor(() => expect(auditRequests(records).at(-1)).toContain('page=1'))
    await waitFor(() =>
      expect((document.querySelector('[data-org-audit-prev]') as HTMLButtonElement).disabled).toBe(
        true,
      ),
    )
  })

  test('重置过滤回到无筛选态（请求无过滤参数）', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 45, page: 1, perPage: 20, totalPages: 3 }),
    )
    renderWithClient(<OrgAuditLogsPage />)
    await waitFor(() => expect(document.querySelector('[data-org-audit-row="1"]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-org-audit-filter-severity]')!, {
      target: { value: 'error' },
    })
    await waitFor(() => expect(auditRequests(records).at(-1)).toContain('severity=error'))

    fireEvent.click(document.querySelector('[data-org-audit-filter-reset]')!)
    await waitFor(() => {
      const last = auditRequests(records).at(-1)!
      expect(last).not.toContain('severity=')
      expect(last).toBe('/audit-logs?page=1&perPage=20')
    })
  })
})
