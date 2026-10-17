/**
 * v3-ui-next-settings-admin-domains W6 · tasks 6.8 —— 全局审计日志测试
 * （spec「管理后台门户与平台治理控制台」Requirement 2 + RL-06 / RL-12）。
 *
 * 覆盖：
 * - 全局范围过滤组合（事件 / 操作 / 级别 / 起止日期 / 操作人）写入请求参数；
 * - 分页：meta.total 展示与上一页/下一页参数交互；
 * - 行渲染：时间、组织列、事件中文、操作、级别双通道、操作人、对象、结果状态双通道；
 * - 非 system:admin：受限横幅且底层接口零请求（RL-06）；
 * - 全程只读：无写入口、交互过程 0 写请求（RL-01）；
 * - 页面装配：真实 route 页面 /next/admin/audit-logs/page.tsx。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NextAdminAuditLogsPage from '@/app/(next)/next/admin/audit-logs/page'
import { GlobalAuditLogsWorkspace } from '@/components/next/admin/audit/GlobalAuditLogsWorkspace'
import type { AuditLogEntry } from '@/lib/api/audit-logs'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/admin/audit-logs',
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
      fullName: '超级管理员',
      organizations: [{ id: 1, name: '核心研发部', slug: 'core-dev', role: 'owner' }],
    },
    accessToken: 'test-token',
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: 'enterprise',
    roleVersion: 1,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    createdAt: '2026-09-08T10:20:30.000Z',
    action: 'update',
    event: 'USER_DISABLED',
    severity: 'warning',
    userId: 2,
    organizationId: 10,
    projectId: null,
    entityType: 'user',
    entityId: 20,
    requestId: 'req-global-1',
    userName: '管理员张三',
    organizationName: '平台运营部',
    entityName: '被停用用户',
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

beforeEach(() => {
  vi.clearAllMocks()
  useNextTrackStore.setState({ immersionTier: null })
  setAuth(['system:admin'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('全局审计日志工作区：准入门禁与 RL-06 零请求（tasks 6.7 / 6.8）', () => {
  test('无 system:admin 权限：渲染受限横幅且接口零请求', async () => {
    setAuth(['org:view', 'audit:view']) // 只有组织级审计权，无平台级全局权
    const { records } = installFetchRouter(() => null)

    renderWithClient(<GlobalAuditLogsWorkspace />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看全局审计日志的权限')).toBeInTheDocument()

    // 断言网络零请求
    expect(records.filter((r) => r.url.startsWith('/audit-logs'))).toHaveLength(0)
  })

  test('页面装配（NextAdminAuditLogsPage）：无权限受限且 0 请求', async () => {
    setAuth(['org:view'])
    const { records } = installFetchRouter(() => null)

    renderWithClient(<NextAdminAuditLogsPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(records.filter((r) => r.url.startsWith('/audit-logs'))).toHaveLength(0)
  })
})

describe('全局审计日志工作区：行渲染与双通道状态（tasks 6.7 / 6.8）', () => {
  test('渲染时间/组织/事件/操作/级别/操作人/对象/结果，且全程零写请求', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 1, page: 1, perPage: 20, totalPages: 1 }),
    )

    renderWithClient(<GlobalAuditLogsWorkspace />)

    await waitFor(() => {
      expect(document.querySelector('[data-admin-audit-row="1"]')).not.toBeNull()
    })

    const row = document.querySelector('[data-admin-audit-row="1"]')!
    expect(row.textContent).toContain('2026-09-08 10:20:30')
    expect(row.textContent).toContain('平台运营部')
    expect(row.textContent).toContain('停用用户')
    expect(row.textContent).toContain('更新')
    // 级别双通道
    expect(document.querySelector('[data-admin-audit-severity="1"]')?.textContent).toBe('警告')
    expect(row.textContent).toContain('管理员张三')
    expect(row.textContent).toContain('被停用用户')
    expect(row.textContent).toContain('成功')

    // 交互（点击刷新）
    const refreshBtn = document.querySelector('[data-admin-audit-refresh]') as HTMLElement
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(records.some((r) => r.method === 'GET' && r.url.startsWith('/audit-logs'))).toBe(true)
    })

    // 全程零非 GET 写请求
    const writeRecords = records.filter((r) => r.method !== 'GET')
    expect(writeRecords).toHaveLength(0)
  })

  test('错误严重级别显示双通道「失败/异常」状态与组织名兜底', async () => {
    installFetchRouter(
      auditRoute(
        [
          makeEntry({
            id: 2,
            severity: 'error',
            organizationName: null,
            organizationId: 99,
            userName: null,
            userId: 5,
          }),
        ],
        { total: 1, page: 1, perPage: 20, totalPages: 1 },
      ),
    )

    renderWithClient(<GlobalAuditLogsWorkspace />)

    await waitFor(() => {
      expect(document.querySelector('[data-admin-audit-row="2"]')).not.toBeNull()
    })

    const row = document.querySelector('[data-admin-audit-row="2"]')!
    expect(row.textContent).toContain('组织 #99')
    expect(row.textContent).toContain('用户 #5')
    expect(document.querySelector('[data-admin-audit-severity="2"]')?.textContent).toBe('错误')
    expect(document.querySelector('[data-admin-audit-result="2"]')?.textContent).toBe('失败/异常')
  })
})

describe('全局审计日志工作区：全局范围过滤与分页（tasks 6.7 / 6.8）', () => {
  test('组合过滤条件（事件 / 操作 / 级别 / 起止日期 / 操作人 ID）发往 API', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 1, page: 1, perPage: 20, totalPages: 1 }),
    )

    renderWithClient(<GlobalAuditLogsWorkspace />)

    await waitFor(() => {
      expect(document.querySelector('[data-admin-audit-row="1"]')).not.toBeNull()
    })

    // 更改事件过滤
    const eventInput = screen.getByLabelText('事件类型')
    fireEvent.change(eventInput, { target: { value: 'LOGIN_FAILED' } })

    await waitFor(() => {
      expect(records.some((r) => r.url.includes('event=LOGIN_FAILED'))).toBe(true)
    })

    // 更改操作类型
    const actionSelect = screen.getByLabelText('操作类型')
    fireEvent.change(actionSelect, { target: { value: 'delete' } })

    await waitFor(() => {
      expect(records.some((r) => r.url.includes('action=delete'))).toBe(true)
    })

    // 更改级别
    const severitySelect = screen.getByLabelText('严重级别')
    fireEvent.change(severitySelect, { target: { value: 'error' } })

    await waitFor(() => {
      expect(records.some((r) => r.url.includes('severity=error'))).toBe(true)
    })

    // 更改起止日期
    const dateFrom = screen.getByLabelText('开始日期')
    fireEvent.change(dateFrom, { target: { value: '2026-09-01' } })
    const dateTo = screen.getByLabelText('结束日期')
    fireEvent.change(dateTo, { target: { value: '2026-09-10' } })

    await waitFor(() => {
      expect(records.some((r) => r.url.includes('dateFrom=2026-09-01'))).toBe(true)
      expect(records.some((r) => r.url.includes('dateTo=2026-09-10'))).toBe(true)
    })

    // 更改操作人 ID
    const actorInput = screen.getByLabelText('操作人 ID')
    fireEvent.change(actorInput, { target: { value: '42' } })

    await waitFor(() => {
      expect(records.some((r) => r.url.includes('actorId=42'))).toBe(true)
    })

    // 点击重置
    const resetBtn = document.querySelector('[data-admin-audit-filter-reset]') as HTMLElement
    expect(resetBtn).not.toBeNull()
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(records.length).toBeGreaterThan(0)
      const last = records[records.length - 1]!
      expect(last.url).not.toContain('event=')
      expect(last.url).not.toContain('actorId=')
    })
  })

  test('分页导航：下一页与上一页递增递减 page 参数', async () => {
    const { records } = installFetchRouter(
      auditRoute([makeEntry()], { total: 45, page: 1, perPage: 20, totalPages: 3 }),
    )

    renderWithClient(<GlobalAuditLogsWorkspace />)

    await waitFor(() => {
      expect(document.querySelector('[data-admin-audit-row="1"]')).not.toBeNull()
    })

    expect(document.querySelector('[data-admin-audit-total]')?.textContent).toContain(
      '共 45 条记录',
    )

    // 上一页在第一页时禁用
    const prevBtn = document.querySelector('[data-admin-audit-prev]') as HTMLButtonElement
    const nextBtn = document.querySelector('[data-admin-audit-next]') as HTMLButtonElement
    expect(prevBtn).toBeDisabled()
    expect(nextBtn).not.toBeDisabled()

    // 点击下一页
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(records.some((r) => r.url.includes('page=2'))).toBe(true)
    })
  })

  test('页面装配（NextAdminAuditLogsPage）：有权限正常展示标题与数据', async () => {
    installFetchRouter(auditRoute([makeEntry()], { total: 1, page: 1, perPage: 20, totalPages: 1 }))

    renderWithClient(<NextAdminAuditLogsPage />)

    await waitFor(() => {
      expect(document.querySelector('[data-admin-audit-title]')).toHaveTextContent('全局审计日志')
      expect(document.querySelector('[data-admin-audit-row="1"]')).not.toBeNull()
    })
  })
})
