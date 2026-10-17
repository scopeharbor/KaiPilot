/**
 * v3-ui-next-batch1-strategy-launch-tasks W2 任务 2.6
 * 放置立项规则推断与人工确认立项测试。
 *
 * 覆盖：
 * 1. 一句话自然语言推断出项目名称、标识代码与优先级；
 * 2. 琥珀色待确认微标（⚡ 待确认推断 0.85）呈现；
 * 3. 人工显式点击确认后发送 POST /projects 请求；
 * 4. 创建成功后触发展现端 `['projects']` 缓存失效；
 * 5. 未授权用户（缺少 project:create 权限）操作阻断。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectPlacementCard } from '@/components/next/theater/ProjectManualPlacementModal'
import { inferProjectCode, inferProjectPlacementDraft } from '@/lib/next/project-placement-rule'
import { useAuthStore } from '@/stores/auth-store'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response
}

function renderCard(queryClient: QueryClient, initialInput = '') {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectPlacementCard initialInput={initialInput} />
    </QueryClientProvider>,
  )
}

describe('lib/next/project-placement-rule（规则式推断引擎单元测试）', () => {
  test('解析一句话提取名称、优先级与截止日期', () => {
    const today = new Date(2026, 8, 11) // 2026-09-11
    const draft = inferProjectPlacementDraft('海外电商支付网关改造，高优先级，10月30日上线', today)

    expect(draft).not.toBeNull()
    expect(draft?.name).toBe('海外电商支付网关改造')
    expect(draft?.priority).toBe('high')
    expect(draft?.endDate).toBe('2026-10-30')
    expect(draft?.code).toBe('PAY-GW')
    expect(draft?.marker.confidence).toBe(0.85)
    expect(draft?.marker.needsConfirmation).toBe(true)
  })

  test('解析紧急优先级与普通优先级', () => {
    const d1 = inferProjectPlacementDraft('金融风控告警中心，紧急')
    expect(d1?.priority).toBe('critical')
    expect(d1?.name).toBe('金融风控告警中心')

    const d2 = inferProjectPlacementDraft('用户中心基础重构')
    expect(d2?.priority).toBe('medium')
    expect(d2?.code).toBe('USER-CTR')
  })

  test('英文字符生成代码', () => {
    expect(inferProjectCode('AI Project Studio')).toBe('AI-PROJECT-STUDIO')
  })
})

describe('components/next/theater/ProjectManualPlacementModal（交互、网络请求与缓存失效）', () => {
  let queryClient: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    pushMock.mockReset()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    // 默认具备 project:create 权限
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目总监',
        organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 10,
      permissions: ['project:view', 'project:create'],
    })

    // 测试必须一律使用 vi.stubGlobal('fetch')，严禁 vi.mock('@/lib/api/*')
    fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/projects') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        return Promise.resolve(
          jsonResponse(201, {
            id: 108,
            organizationId: 10,
            name: body.name,
            code: body.code || 'PAY-GW',
            description: body.description || null,
            category: null,
            status: body.status || 'planning',
            priority: body.priority || 'high',
            startDate: body.startDate || '2026-09-11',
            endDate: body.endDate || '2026-10-30',
            budgetCents: null,
            currency: 'CNY',
            progressPercent: 0,
            healthStatus: 'healthy',
            settings: null,
            createdBy: 1,
            updatedBy: 1,
            createdAt: '2026-09-11T10:00:00Z',
            updatedAt: '2026-09-11T10:00:00Z',
          }),
        )
      }
      return Promise.resolve(jsonResponse(200, { data: [] }))
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('输入自然语言呈现待确认推断结果与琥珀色待确认微标', () => {
    renderCard(queryClient)

    const input = screen.getByRole('textbox', { name: '一句话立项输入' })
    fireEvent.change(input, {
      target: { value: '海外电商支付网关改造，高优先级，10月30日上线' },
    })

    // 显示待确认推断预览
    expect(screen.getByTestId('placement-draft-preview')).toBeInTheDocument()
    expect(screen.getByText('海外电商支付网关改造')).toBeInTheDocument()
    expect(screen.getByText('PAY-GW')).toBeInTheDocument()

    // 琥珀色待确认微标
    const marker = screen.getByTestId('placement-marker')
    expect(marker).toBeInTheDocument()
    expect(marker.textContent).toContain('待确认推断 (0.85)')
    expect(marker).toHaveAttribute('data-confidence', '0.85')
  })

  test('人工点击确认立项后发出 POST /projects 请求并让 ["projects"] 缓存失效', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    renderCard(queryClient, '海外电商支付网关改造，高优先级，10月30日上线')

    const confirmBtn = screen.getByTestId('btn-confirm-placement')
    expect(confirmBtn).toBeEnabled()

    fireEvent.click(confirmBtn)

    // 等待异步 POST 请求完成
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/projects'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"海外电商支付网关改造"'),
        }),
      )
    })

    // 校验 queryClient 集中让 ['projects'] 缓存失效
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['projects'],
        }),
      )
    })

    // 成功后直达新立项的项目空间
    expect(pushMock).toHaveBeenCalledWith('/next/projects/108')
  })

  test('未授权用户操作阻断：缺少 project:create 时按钮禁用并展示阻断警示', () => {
    // 移除 project:create 权限
    useAuthStore.setState({
      permissions: ['project:view'],
    })

    renderCard(queryClient, '海外电商支付网关改造，高优先级，10月30日上线')

    // 展示权限阻断提示条
    expect(screen.getByTestId('placement-permission-blocked')).toBeInTheDocument()
    expect(screen.getByText(/暂未获得 project:create 权限/i)).toBeInTheDocument()

    // 确认按钮处于禁用状态
    const confirmBtn = screen.getByTestId('btn-confirm-placement')
    expect(confirmBtn).toBeDisabled()

    // 点击不发送任何网络写请求（RL-01）
    fireEvent.click(confirmBtn)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
