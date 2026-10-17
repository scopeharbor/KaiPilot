/**
 * 空间地图全域搜索浮层集成测试（v3-ui-next-batch3-global-convergence W1 · tasks 1.4）。
 *
 * 覆盖：
 * 1. 浮层唤起后输入关键词联动全域搜索（300ms 防抖后调用 POST /api/v1/search）；
 * 2. 点击任务直达目标项目并携带 `?focusTask=:taskId`；
 * 3. 按 Esc 键退出并关闭浮层；
 * 4. 遵守纪律：vi.stubGlobal('fetch')，禁 vi.mock('@/lib/api/*')。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { useAuthStore } from '@/stores/auth-store'
import type { SearchResponse } from '@/lib/api/search'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

const mockSearchPayload: SearchResponse = {
  data: [
    {
      entityType: 'project',
      entityId: 42,
      projectId: 42,
      title: '云原生自动化验收底座',
      summary: '全域自动化验收与质量守卫',
      matchedFields: ['title'],
      status: 'active',
      updatedAt: '2026-09-10T12:00:00Z',
      target: '/projects/42',
      source: 'project',
      score: 95,
      metadata: { code: 'QA-BASE', healthStatus: 'healthy', status: 'active' },
    },
    {
      entityType: 'task',
      entityId: 101,
      projectId: 42,
      title: '执行核心接口集成验收',
      summary: '支付与鉴权模块集成验收',
      matchedFields: ['title'],
      status: 'in_progress',
      updatedAt: '2026-09-12T08:00:00Z',
      target: '/projects/42/tasks/101',
      source: 'task',
      score: 90,
      metadata: {
        projectName: '云原生自动化验收底座',
        status: 'in_progress',
        dueDate: '2026-09-20',
      },
    },
    {
      entityType: 'file',
      entityId: 301,
      projectId: 42,
      title: '端到端验收用例文档.docx',
      summary: '验收准则清单',
      matchedFields: ['title'],
      updatedAt: '2026-09-11T16:00:00Z',
      target: '/next/projects/42?focusFile=301',
      source: 'file',
      score: 85,
      metadata: {
        extension: 'DOCX',
        projectName: '云原生自动化验收底座',
      },
    },
  ],
  meta: {
    total: 3,
    page: 1,
    perPage: 40,
    totalPages: 1,
  },
}

function renderSpaceMap(props: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onOpenChange = props.onOpenChange ?? vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SpaceMapOverlay open={props.open ?? true} onOpenChange={onOpenChange} defaultLens="spaces" />
    </QueryClientProvider>,
  )
  return { ...view, onOpenChange }
}

describe('SpaceMapOverlay 全域搜索集成测试', () => {
  beforeEach(() => {
    pushMock.mockReset()
    useAuthStore.setState({
      accessToken: 'test-token',
      user: {
        id: 1,
        email: 'tester@example.com',
        fullName: '测试员',
        organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
      },
    })

    // vi.stubGlobal('fetch')，拦截 /api/v1/search
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
        if (String(url).includes('/search')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => mockSearchPayload,
            headers: new Headers({ 'content-type': 'application/json' }),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
          headers: new Headers({ 'content-type': 'application/json' }),
        } as Response)
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试浮层唤起后输入关键词联动全域搜索并呈现跨实体结果', async () => {
    renderSpaceMap()

    const input = screen.getByRole('searchbox', { name: '搜索空间坐标' })
    expect(input).toBeInTheDocument()

    // 输入「验收」
    fireEvent.change(input, { target: { value: '验收' } })

    // 等待 300ms 防抖触发与 fetch 完成
    await waitFor(() => {
      expect(screen.getByText('执行核心接口集成验收')).toBeInTheDocument()
    })

    // 验证项目、任务、文件均结构化呈现
    expect(screen.getAllByText('云原生自动化验收底座').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('端到端验收用例文档.docx')).toBeInTheDocument()

    // 验证 fetch 确由真实 API 路径发出，含 POST /search
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/search'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('测试点击任务直达目标项目并携带 ?focusTask=', async () => {
    const { onOpenChange } = renderSpaceMap()

    const input = screen.getByRole('searchbox', { name: '搜索空间坐标' })
    fireEvent.change(input, { target: { value: '验收' } })

    await waitFor(() => {
      expect(screen.getByText('执行核心接口集成验收')).toBeInTheDocument()
    })

    // 点击该任务行
    const taskRow = screen.getByText('执行核心接口集成验收').closest('[data-search-row]')
    expect(taskRow).not.toBeNull()
    fireEvent.click(taskRow!)

    // 关闭浮层并路由跳转
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/42?focusTask=101')
  })

  test('测试按 Esc 键平滑退出并关闭浮层', () => {
    const { onOpenChange } = renderSpaceMap()

    const input = screen.getByRole('searchbox', { name: '搜索空间坐标' })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
