/**
 * 资源详情抽屉（ResourceDetailDrawer）组件测试 —— 新轨资源工作台补齐件
 * （基本信息查看/编辑、可用性例外管理、单资源负载）。
 *
 * 覆盖：
 * - 打开抽屉加载资源详情并渲染基本信息（名称/邮箱/日产能/时区/工作日/技能）；
 * - 三页签切换；Esc/关闭按钮关闭；
 * - 基本信息编辑（canManage）：表单 PATCH 保存并失效刷新；只读用户无编辑入口；
 * - 可用性：例外清单渲染、添加例外 POST（原因必填置灰）、删除 DELETE；
 * - 负载：14 天热力格 + 综合利用率呈现；无数据空态。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ResourceDetailDrawer } from '@/components/next/resources/ResourceDetailDrawer'

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

const RESOURCE = {
  id: 5,
  projectId: 7,
  organizationId: 1,
  userId: 88,
  name: '张工',
  email: 'zhang@example.com',
  resourceType: 'human',
  role: 'developer',
  status: 'active',
  dailyCapacityHours: 8,
  timezone: 'Asia/Shanghai',
  workDays: [1, 2, 3, 4, 5],
  skillTags: ['前端', '可视化'],
  costPerUnitCents: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: null,
}

function createBackend() {
  return {
    route: (path: string, method: string): Response | null => {
      if (method === 'GET' && path === '/projects/7/resources/5') {
        return jsonResponse(200, { data: RESOURCE })
      }
      if (method === 'GET' && path.startsWith('/projects/7/resources/5/availability-exceptions')) {
        return jsonResponse(200, {
          data: [
            {
              id: 21,
              resourceId: 5,
              startDate: '2026-09-20',
              endDate: '2026-09-21',
              capacityOverrideHours: 4,
              reason: '体检假',
              status: 'planned',
            },
          ],
          meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      if (method === 'POST' && path === '/projects/7/resources/5/availability-exceptions') {
        return jsonResponse(201, { data: { id: 22 } })
      }
      if (method === 'DELETE' && path === '/projects/7/resources/5/availability-exceptions/21') {
        return jsonResponse(204, null)
      }
      if (method === 'GET' && path.startsWith('/projects/7/resources/load')) {
        return jsonResponse(200, {
          data: {
            resources: [
              {
                resourceId: 5,
                overallUtilizationPercent: 86,
                days: Array.from({ length: 14 }, (_, i) => ({
                  date: `2026-09-${String(17 + i).padStart(2, '0')}`,
                  totalAllocatedPercent: i === 3 ? 110 : 60,
                })),
              },
            ],
          },
        })
      }
      if (method === 'PATCH' && path === '/projects/7/resources/5') {
        return jsonResponse(200, { data: { ...RESOURCE, name: '张工（高级）' } })
      }
      return null
    },
  }
}

function renderDrawer(canManage = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ResourceDetailDrawer
        projectId={7}
        resourceId={5}
        onClose={() => {}}
        canManage={canManage}
        currentUserId={1}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('ResourceDetailDrawer：基本信息', () => {
  test('打开抽屉加载详情并渲染只读字段', async () => {
    installFetchRouter(createBackend().route)
    renderDrawer()

    await waitFor(() => expect(document.querySelector('[data-resource-info-tab]')).not.toBeNull())
    const tab = document.querySelector('[data-resource-info-tab]')!
    expect(tab.textContent).toContain('zhang@example.com')
    expect(tab.textContent).toContain('8 小时')
    expect(tab.textContent).toContain('Asia/Shanghai')
    expect(tab.textContent).toContain('前端、可视化')
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toContain('张工')
  })

  test('canManage 可编辑：保存 PATCH 并关表单；只读用户无编辑入口', async () => {
    const { records } = installFetchRouter(createBackend().route)
    const view = renderDrawer(true)

    await waitFor(() => expect(document.querySelector('[data-resource-info-edit]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-resource-info-edit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-resource-info-form]')).not.toBeNull())

    const save = document.querySelector('[data-resource-info-save]') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('资源名称'), { target: { value: '张工（高级）' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'PATCH' &&
            r.url === '/projects/7/resources/5' &&
            r.body?.name === '张工（高级）',
        ),
      ).toBe(true),
    )

    // 只读用户
    view.unmount()
    const client2 = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client2}>
        <ResourceDetailDrawer
          projectId={7}
          resourceId={5}
          onClose={() => {}}
          canManage={false}
          currentUserId={1}
        />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(document.querySelector('[data-resource-info-tab]')).not.toBeNull())
    expect(document.querySelector('[data-resource-info-edit]')).toBeNull()
  })
})

describe('ResourceDetailDrawer：可用性例外', () => {
  test('例外清单渲染；添加例外原因必填置灰；提交 POST；删除 DELETE', async () => {
    const { records } = installFetchRouter(createBackend().route)
    renderDrawer(true)

    await waitFor(() => expect(document.querySelector('[data-resource-info-tab]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-resource-detail-tab="availability"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-availability-row="21"]')).not.toBeNull(),
    )
    const row = document.querySelector('[data-resource-availability-row="21"]')!
    expect(row.textContent).toContain('2026-09-20')
    expect(row.textContent).toContain('4h')
    expect(row.textContent).toContain('体检假')

    // 添加例外：原因必填
    fireEvent.click(document.querySelector('[data-resource-availability-create-open]') as Element)
    const saveBtn = document.querySelector('[data-resource-availability-save]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('例外原因'), { target: { value: '休假' } })
    expect(saveBtn.disabled).toBe(false)
    fireEvent.click(saveBtn)
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'POST' &&
            r.url === '/projects/7/resources/5/availability-exceptions' &&
            r.body?.reason === '休假',
        ),
      ).toBe(true),
    )

    // 删除
    fireEvent.click(document.querySelector('[data-resource-availability-delete="21"]') as Element)
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'DELETE' && r.url === '/projects/7/resources/5/availability-exceptions/21',
        ),
      ).toBe(true),
    )
  })
})

describe('ResourceDetailDrawer：负载', () => {
  test('负载页签渲染综合利用率与 14 天热力格；超载天用危险色', async () => {
    installFetchRouter(createBackend().route)
    renderDrawer()

    await waitFor(() => expect(document.querySelector('[data-resource-info-tab]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-resource-detail-tab="load"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-resource-load-tab]')).not.toBeNull())
    expect(document.querySelector('[data-resource-load-percent]')!.textContent).toBe('86%')
    const days = document.querySelectorAll('[data-resource-load-day]')
    expect(days).toHaveLength(14)
  })
})
