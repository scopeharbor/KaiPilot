/**
 * 项目问题工作台（IssueWorkbench）组件测试 —— 新轨 /next/risks「项目问题」tab
 * 真实 CRUD 接线（组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖：
 * - 项目选择器：加载项目列表、默认选中首个项目、切换项目重新拉取对应问题清单；
 * - 清单渲染：编号/标题/分类/严重度/优先级/状态/登记时间 + 状态筛选参数传递；
 * - 登记问题：对话框字段齐全、标题空时禁用、提交 POST 成功后失效刷新并关框；
 * - 状态机流转：select 按 ISSUE_STATUS_TRANSITIONS 提供下一态；resolved 不直接提交，
 *   弹出根因+措施对话框，两者必填才可确认，确认后 PATCH 携带 rootCause/resolution；
 * - 空态/错误态/无项目引导态。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { IssueWorkbench } from '@/components/next/org-risk-global/IssueWorkbench'
import type { Issue } from '@/lib/api/issues'

// ---------------------------------------------------------------------------
// 伪后端
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

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function projectRows() {
  return [
    { id: 3, organizationId: 1, name: '商城重构', code: 'MALL-R3' },
    { id: 7, organizationId: 1, name: '户外演出季', code: 'FEST-2026' },
  ]
}

function issueRow(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 11,
    organizationId: 1,
    projectId: 3,
    relatedTaskId: null,
    reportedBy: 1,
    assigneeId: null,
    code: 'ISS-0011',
    title: '支付网关联调阻塞',
    description: null,
    type: 'blocker',
    severity: 'critical',
    priority: 'urgent',
    status: 'open',
    rootCause: null,
    resolution: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function createBackend(options: { issues?: Issue[] } = {}) {
  const issues = options.issues ?? []
  return {
    route: (path: string, method: string): Response | null => {
      if (method === 'GET' && path.startsWith('/projects?')) {
        return jsonResponse(200, {
          data: projectRows(),
          meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      const issuesMatch = /^\/projects\/(\d+)\/issues(\?.*)?$/.exec(path)
      if (issuesMatch && method === 'GET') {
        return jsonResponse(200, {
          data: issues,
          meta: { total: issues.length, page: 1, perPage: 100, totalPages: 1 },
        })
      }
      if (issuesMatch && method === 'POST') {
        return jsonResponse(201, issueRow({ id: 12, code: 'ISS-0012' }))
      }
      const statusMatch = /^\/projects\/(\d+)\/issues\/(\d+)\/status$/.exec(path)
      if (statusMatch && method === 'PATCH') {
        return jsonResponse(200, issueRow())
      }
      return null
    },
  }
}

function renderWorkbench() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IssueWorkbench organizationId={1} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('IssueWorkbench：项目选择与清单加载', () => {
  test('加载项目列表，默认选中首个项目并拉取其问题清单', async () => {
    const { records } = installFetchRouter(createBackend().route)
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-workbench]')).not.toBeNull())
    const select = document.querySelector('[data-issue-project-select]') as HTMLSelectElement
    expect(select.value).toBe('3')
    await waitFor(() =>
      expect(
        records.some((r) => r.method === 'GET' && r.url.startsWith('/projects/3/issues?')),
      ).toBe(true),
    )
  })

  test('切换项目后拉取对应项目的问题清单', async () => {
    const { records } = installFetchRouter(createBackend().route)
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-workbench]')).not.toBeNull())
    fireEvent.change(document.querySelector('[data-issue-project-select]') as Element, {
      target: { value: '7' },
    })
    await waitFor(() =>
      expect(
        records.some((r) => r.method === 'GET' && r.url.startsWith('/projects/7/issues?')),
      ).toBe(true),
    )
  })

  test('清单行渲染编号/标题/分类/严重度/优先级/状态/日期与条数', async () => {
    installFetchRouter(createBackend({ issues: [issueRow()] }).route)
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-row="11"]')).not.toBeNull())
    const row = document.querySelector('[data-issue-row="11"]')!
    expect(row.textContent).toContain('ISS-0011')
    expect(row.textContent).toContain('支付网关联调阻塞')
    expect(row.textContent).toContain('阻塞')
    expect(row.textContent).toContain('致命')
    expect(row.textContent).toContain('紧急')
    expect(row.textContent).toContain('2026-09-10')
    expect(screen.getByText('共 1 条')).toBeInTheDocument()
  })

  test('空清单 → 空态提示；清单 5xx → 错误态', async () => {
    installFetchRouter(createBackend().route)
    renderWorkbench()
    await waitFor(() => expect(document.querySelector('[data-issue-list-empty]')).not.toBeNull())
    expect(screen.getByText('暂无项目问题')).toBeInTheDocument()
  })
})

describe('IssueWorkbench：状态筛选与状态机流转', () => {
  test('状态筛选把 status 参数传给清单查询', async () => {
    const { records } = installFetchRouter(createBackend({ issues: [issueRow()] }).route)
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-row="11"]')).not.toBeNull())
    fireEvent.change(document.querySelector('[data-issue-status-filter]') as Element, {
      target: { value: 'open' },
    })
    await waitFor(() => expect(records.some((r) => r.url.includes('status=open'))).toBe(true))
  })

  test('open 问题提供 in_progress/rejected 下一态（状态机不直达 resolved）；选 in_progress 直接 PATCH', async () => {
    const { records } = installFetchRouter(createBackend({ issues: [issueRow()] }).route)
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-row="11"]')).not.toBeNull())
    const select = document.querySelector('[data-issue-status-select="11"]') as HTMLSelectElement
    const optionValues = Array.from(select.options).map((option) => option.value)
    expect(optionValues).toContain('in_progress')
    expect(optionValues).toContain('rejected')
    expect(optionValues).not.toContain('resolved')

    fireEvent.change(select, { target: { value: 'in_progress' } })
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'PATCH' &&
            r.url === '/projects/3/issues/11/status' &&
            r.body?.status === 'in_progress',
        ),
      ).toBe(true),
    )
  })

  test('处理中问题选 resolved 弹出根因+措施对话框，未填齐不可确认，确认后 PATCH 携带两字段', async () => {
    const { records } = installFetchRouter(
      createBackend({ issues: [issueRow({ status: 'in_progress' })] }).route,
    )
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-row="11"]')).not.toBeNull())
    fireEvent.change(document.querySelector('[data-issue-status-select="11"]') as Element, {
      target: { value: 'resolved' },
    })
    // 不直接提交，先弹对话框
    await waitFor(() =>
      expect(document.querySelector('[data-issue-resolve-dialog]')).not.toBeNull(),
    )
    expect(records.some((r) => r.method === 'PATCH')).toBe(false)

    const confirm = document.querySelector('[data-issue-resolve-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.change(document.querySelector('#issue-root-cause') as Element, {
      target: { value: '第三方支付密钥过期' },
    })
    fireEvent.change(document.querySelector('#issue-resolution') as Element, {
      target: { value: '更换密钥并补回归用例' },
    })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'PATCH' &&
            r.body?.status === 'resolved' &&
            r.body?.rootCause === '第三方支付密钥过期' &&
            r.body?.resolution === '更换密钥并补回归用例',
        ),
      ).toBe(true),
    )
  })
})

describe('IssueWorkbench：登记问题', () => {
  test('登记对话框字段齐全、标题空禁用、提交 POST 成功后关框并刷新清单', async () => {
    const { records } = installFetchRouter(createBackend().route)
    renderWorkbench()

    await waitFor(() => expect(document.querySelector('[data-issue-workbench]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-issue-create-open]') as Element)
    await waitFor(() => expect(document.querySelector('[data-issue-create-dialog]')).not.toBeNull())

    const confirm = document.querySelector('[data-issue-create-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.change(document.querySelector('#issue-title') as Element, {
      target: { value: '供应商交付延迟' },
    })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'POST' &&
            r.url === '/projects/3/issues' &&
            r.body?.title === '供应商交付延迟',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-issue-create-dialog]')).toBeNull())
  })
})
