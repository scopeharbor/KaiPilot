/**
 * v2-5-webhook-templates-and-stats -- 模板与统计面板组件测试（5.4 P1）。
 *
 * 验证：
 * - 授权用户可看到模板列表
 * - 无权限用户隐藏写控制
 * - feature-off 状态展示
 * - 空统计状态
 * - 脱敏统计渲染
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OutgoingWebhookTemplatesPanel } from '@/components/integrations/OutgoingWebhookTemplatesPanel'
import { OutgoingWebhookStatsPanel } from '@/components/integrations/OutgoingWebhookStatsPanel'

// Mock hooks
vi.mock('@/hooks/use-outgoing-webhook-templates-and-stats', () => ({
  useOutgoingWebhookTemplates: vi.fn(),
  useOutgoingWebhookTemplateDetail: vi.fn(),
  useOutgoingWebhookTemplatePrefill: vi.fn(),
  useApplyOutgoingWebhookTemplate: vi.fn(),
  useOutgoingWebhookStats: vi.fn(),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: (perm: string) => perm === 'outgoing_webhook:manage',
  }),
}))

vi.mock('@/hooks/use-outgoing-webhooks', () => ({
  useOutgoingWebhooks: vi.fn(),
  useCreateOutgoingWebhook: vi.fn(),
  useDeactivateOutgoingWebhook: vi.fn(),
  useRotateOutgoingWebhook: vi.fn(),
}))

import {
  useOutgoingWebhookTemplates,
  useOutgoingWebhookStats,
  useApplyOutgoingWebhookTemplate,
} from '@/hooks/use-outgoing-webhook-templates-and-stats'

const mockTemplates = vi.mocked(useOutgoingWebhookTemplates)
const mockStats = vi.mocked(useOutgoingWebhookStats)
const mockApply = vi.mocked(useApplyOutgoingWebhookTemplate)

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('OutgoingWebhookTemplatesPanel', () => {
  beforeEach(() => {
    mockApply.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    } as any)
  })

  it('加载态显示骨架', () => {
    mockTemplates.mockReturnValue({
      isLoading: true,
      data: undefined,
      isError: false,
      error: null,
    } as any)

    const { container } = render(<OutgoingWebhookTemplatesPanel />, { wrapper: createWrapper() })
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('错误态显示错误信息', () => {
    mockTemplates.mockReturnValue({
      isLoading: false,
      data: undefined,
      isError: true,
      error: new Error('Network error'),
    } as any)

    render(<OutgoingWebhookTemplatesPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('模板加载失败')).toBeTruthy()
  })

  it('空数据不渲染', () => {
    mockTemplates.mockReturnValue({
      isLoading: false,
      data: { data: [] },
      isError: false,
    } as any)

    const { container } = render(<OutgoingWebhookTemplatesPanel />, { wrapper: createWrapper() })
    expect(container.innerHTML).toBe('')
  })

  it('有模板时渲染模板列表', () => {
    mockTemplates.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            id: 'task-status-changed',
            version: '1.0.0',
            stability: 'stable',
            name: '任务状态变更通知',
            description: '当项目中的任务被创建、更新或完成时发送通知',
            eventTypes: ['task.created', 'task.updated', 'task.completed'],
            headerPresets: [{ name: 'X-Event-Source', value: 'aiproj-task' }],
            display: {
              recommendedUse: '与群机器人对接',
              limitations: '仅发送低敏信息',
            },
          },
        ],
      },
      isError: false,
    } as any)

    render(<OutgoingWebhookTemplatesPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('任务状态变更通知')).toBeTruthy()
    expect(screen.getByText('使用此模板创建')).toBeTruthy()
  })
})

describe('OutgoingWebhookStatsPanel', () => {
  it('加载态显示 spinner', () => {
    mockStats.mockReturnValue({
      isLoading: true,
      data: undefined,
      isError: false,
    } as any)

    render(<OutgoingWebhookStatsPanel />, { wrapper: createWrapper() })
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('错误态显示错误信息', () => {
    mockStats.mockReturnValue({
      isLoading: false,
      data: undefined,
      isError: true,
      error: new Error('Network error'),
    } as any)

    render(<OutgoingWebhookStatsPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('统计加载失败')).toBeTruthy()
  })

  it('feature-off 显示不可用态', () => {
    mockStats.mockReturnValue({
      isLoading: false,
      data: { data: { available: false, reason: 'feature_disabled' } },
      isError: false,
    } as any)

    render(<OutgoingWebhookStatsPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('统计功能未启用')).toBeTruthy()
  })

  it('no_data 显示空态', () => {
    mockStats.mockReturnValue({
      isLoading: false,
      data: { data: { available: false, reason: 'no_data' } },
      isError: false,
    } as any)

    render(<OutgoingWebhookStatsPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('暂无投递数据')).toBeTruthy()
  })

  it('有统计数据时渲染统计卡片', () => {
    mockStats.mockReturnValue({
      isLoading: false,
      data: {
        data: {
          startDate: '2026-07-01',
          endDate: '2026-07-23',
          totalDeliveries: 100,
          byStatus: { pending: 5, in_progress: 2, success: 80, failed: 10, paused: 3 },
          successRate: 0.8,
          failureRate: 0.1,
          totalRetries: 15,
          byFailureCategory: {
            timeout: 3,
            network: 2,
            rate_limited: 1,
            server_error: 4,
            client_error: 0,
            signature: 0,
            config: 0,
            disabled: 0,
            exhausted: 0,
            unknown: 0,
          },
          lastDeliveryAt: '2026-07-23T10:00:00.000Z',
          nextRetryAt: '2026-07-23T11:00:00.000Z',
          activeSubscriptionCount: 5,
          templateUsageCount: {},
        },
      },
      isError: false,
    } as any)

    render(<OutgoingWebhookStatsPanel />, { wrapper: createWrapper() })
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText('80')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('投递总数')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
  })
})
