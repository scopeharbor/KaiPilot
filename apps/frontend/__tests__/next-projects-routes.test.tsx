/**
 * v3-ui-next-batch1-strategy-launch-tasks W2 任务 2.8
 * 新轨项目与新建路由定向导航测试。
 *
 * 覆盖：
 * 1. 访问 `/next/projects` 路由组件挂载后，定向唤起空间地图清单镜头；
 * 2. 访问 `/next/projects/new` 路由组件执行后，定向重定向至生成剧场手动模式 `/next/create?mode=manual`；
 * 3. 验证无死链：`/next/projects` 浮层关闭导向 `/next`；新建重定向目标可解析。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NextProjectsPage from '@/app/(next)/next/projects/page'
import NewProjectRedirectPage from '@/app/(next)/next/projects/new/page'
import { useAuthStore } from '@/stores/auth-store'

const { mockPush, mockRedirect } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
  redirect: (url: string) => mockRedirect(url),
}))

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  mockPush.mockReset()
  mockRedirect.mockReset()

  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '系统管理员',
      organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
    },
    currentOrganizationId: 10,
    permissions: ['project:view', 'project:create', 'ai:trigger'],
  })

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 1,
            organizationId: 10,
            name: '海外电商支付网关',
            code: 'PAY-GW',
            description: '支付链路基础设施改造',
            status: 'active',
            priority: 'high',
            startDate: '2026-09-01',
            endDate: '2026-10-30',
            progressPercent: 60,
            healthStatus: 'healthy',
            createdBy: 1,
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-11T00:00:00Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
      }),
    ),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('app/(next)/next/projects 路由定向承接', () => {
  test('挂载 /next/projects 页面后定向激活空间地图清单镜头', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <NextProjectsPage />
      </QueryClientProvider>,
    )

    // 页面根节点存在
    expect(screen.getByTestId('next-projects-page')).toBeInTheDocument()

    // 空间地图浮层激活并处于「项目清单」模式
    const dialog = screen.getByRole('dialog', { name: '空间地图' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('data-active-lens', 'projects')

    // 清单镜头表格与数据呈现（异步加载）
    expect(screen.getByTestId('space-map-project-list-lens')).toBeInTheDocument()
    expect(await screen.findByText('海外电商支付网关')).toBeInTheDocument()
    expect(await screen.findByText('PAY-GW')).toBeInTheDocument()
  })

  test('在 /next/projects 页面中点击关闭按钮平滑导向 /next', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <NextProjectsPage />
      </QueryClientProvider>,
    )

    const closeBtn = screen.getByRole('button', { name: '关闭空间地图' })
    fireEvent.click(closeBtn)

    // 校验平滑切回新轨主页
    expect(mockPush).toHaveBeenCalledWith('/next')
  })
})

describe('app/(next)/next/projects/new 路由重定向同化', () => {
  test('执行 /next/projects/new 路由平滑重定向至生成剧场手动模式 /next/create?mode=manual', () => {
    NewProjectRedirectPage()

    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).toHaveBeenCalledWith('/next/create?mode=manual')
  })
})
