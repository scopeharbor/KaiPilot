/**
 * v3-triz-copilot-followups · tasks 6.2 —— 角色首页信号队列（B3 去扇出改造）测试。
 *
 * 覆盖：
 * 1. vi.stubGlobal('fetch') 伪后端；
 * 2. 断言单次请求组织级端点（/organizations/:organizationId/signals）且参数含 confidenceTier=low&status=open；
 * 3. 多项目信号混合渲染，按严重度与创建时间排序；
 * 4. 界面彻底移除「已覆盖最近 X 个项目」文案及相关节点；
 * 5. 空态与错误重试逻辑正常；
 * 6. 高置信信号不在建议队列呈现。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { RoleSignalQueue } from '@/components/next/signals/RoleSignalQueue'
import { useAuthStore } from '@/stores/auth-store'
import { installFetchRouter, resetFetchRouter } from './helpers/chart-gallery-network'
import {
  makeSignal,
  makeSignalRouter,
  type SignalRouterOptions,
} from './helpers/project-signals-fixtures'

function setAuth(permissions: string[] = ['project:view', 'task:view', 'ai:trigger']) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

function mountQueue(route: Parameters<typeof installFetchRouter>[0]) {
  const records = installFetchRouter(route).records
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    records,
    ...render(
      <QueryClientProvider client={client}>
        <RoleSignalQueue />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  resetFetchRouter()
  setAuth()
})

describe('tasks 6.2 角色首页低置信建议队列（去扇出改造）', () => {
  test('单次请求组织级端点，参数含 confidenceTier=low&status=open，多项目信号混合渲染且按严重度与时间排序', async () => {
    const orgSignals = [
      makeSignal({
        id: 10,
        projectId: 101,
        severity: 'info',
        createdAt: '2026-09-01T10:00:00.000Z',
        signalType: 'progress_deviation',
        signalTypeLabel: '进度偏差',
      }),
      makeSignal({
        id: 20,
        projectId: 102,
        severity: 'critical',
        createdAt: '2026-09-01T09:00:00.000Z',
        signalType: 'milestone_slip',
        signalTypeLabel: '里程碑滑移',
      }),
      makeSignal({
        id: 30,
        projectId: 103,
        severity: 'warning',
        createdAt: '2026-09-01T11:00:00.000Z',
        signalType: 'risk_surge',
        signalTypeLabel: '风险/缺陷突变',
      }),
      // 高置信不应出现在角色首页队列中
      makeSignal({
        id: 99,
        projectId: 101,
        confidenceTier: 'high',
        severity: 'critical',
      }),
    ]

    const options: SignalRouterOptions = {
      organizationSignals: orgSignals,
    }

    const { records } = mountQueue(makeSignalRouter(options))

    // 等待渲染完成
    expect(await screen.findByText('里程碑滑移')).toBeInTheDocument()
    expect(screen.getByText('风险/缺陷突变')).toBeInTheDocument()
    expect(screen.getByText('进度偏差')).toBeInTheDocument()

    // 断言网络请求：单次请求组织级端点，不请求 /projects 扇出列表
    const orgRequests = records.filter((r) => r.url.includes('/organizations/1/signals'))
    expect(orgRequests).toHaveLength(1)
    const requestUrl = orgRequests[0]!.url
    expect(requestUrl).toContain('confidenceTier=low')
    expect(requestUrl).toContain('status=open')

    // 零 /projects?sort=-updatedAt 扇出请求
    const fanoutProjectCalls = records.filter((r) => r.url.includes('/projects?sort=-updatedAt'))
    expect(fanoutProjectCalls).toHaveLength(0)

    // 渲染节点数：恰好 3 条低置信信号，高置信（id: 99）被排除
    const items = document.querySelectorAll('[data-role-signal-item]')
    expect(items).toHaveLength(3)
    expect(document.querySelector('[data-role-signal-item="99"]')).toBeNull()

    // 排序断言：第一条应为 critical (id: 20)，第二条为 warning (id: 30)，第三条为 info (id: 10)
    expect(items[0]?.getAttribute('data-role-signal-item')).toBe('20')
    expect(items[1]?.getAttribute('data-role-signal-item')).toBe('30')
    expect(items[2]?.getAttribute('data-role-signal-item')).toBe('10')

    // 多项目链接断言
    expect(document.querySelector('[data-role-signal-project="20"]')?.getAttribute('href')).toBe(
      '/next/projects/102',
    )
    expect(document.querySelector('[data-role-signal-project="30"]')?.getAttribute('href')).toBe(
      '/next/projects/103',
    )
    expect(document.querySelector('[data-role-signal-project="10"]')?.getAttribute('href')).toBe(
      '/next/projects/101',
    )

    // 彻底无「已覆盖最近 X 个项目」文案与 DOM 节点
    expect(document.querySelector('[data-role-signal-queue-coverage]')).toBeNull()
    expect(document.body.textContent).not.toContain('已覆盖最近')
    expect(document.body.textContent).not.toContain('个项目（共')
  })

  test('界面不再出现「已覆盖最近 X 个项目」文案与节点', async () => {
    const { container } = mountQueue(
      makeSignalRouter({
        organizationSignals: [makeSignal({ id: 12, projectId: 101 })],
      }),
    )

    await screen.findByText('进度偏差')

    expect(container.querySelector('[data-role-signal-queue-coverage]')).toBeNull()
    expect(container.textContent).not.toContain('已覆盖最近')
    expect(container.textContent).not.toContain('个项目')
  })

  test('空态：组织无低置信信号时渲染空态，无占位伪数据，无覆盖范围文案', async () => {
    const { container, records } = mountQueue(makeSignalRouter({ organizationSignals: [] }))

    const empty = await waitFor(() => {
      const node = container.querySelector('[data-role-signal-queue-empty]')
      if (!node) throw new Error('空态未渲染')
      return node as HTMLElement
    })

    expect(empty.textContent).toContain('当前没有待查看的低置信信号')
    expect(container.querySelectorAll('[data-role-signal-item]')).toHaveLength(0)
    expect(container.querySelector('[data-role-signal-queue-coverage]')).toBeNull()
    expect(container.textContent).not.toContain('已覆盖最近')

    // 依然只发了一次组织级请求
    const orgRequests = records.filter((r) => r.url.includes('/organizations/1/signals'))
    expect(orgRequests).toHaveLength(1)
  })

  test('错误态可辨识与重试：500 报错渲染错误卡片，点击重新载入触发再次请求', async () => {
    const { container, records } = mountQueue(
      makeSignalRouter({
        signalsStatus: 500,
        signalsError: { code: 'INTERNAL_ERROR', message: '组织级信号服务暂时不可用' },
      }),
    )

    const errorBlock = await waitFor(() => {
      const node = container.querySelector('[data-role-signal-queue-error]')
      if (!node) throw new Error('错误态未渲染')
      return node as HTMLElement
    })

    expect(errorBlock.getAttribute('role')).toBe('alert')
    expect(errorBlock.textContent).toContain('信号读取失败')
    expect(errorBlock.textContent).toContain('组织级信号服务暂时不可用')

    const beforeCount = records.filter((r) => r.url.includes('/organizations/1/signals')).length
    expect(beforeCount).toBe(1)

    // 点击重试
    const retryButton = container.querySelector('[data-role-signal-retry]') as HTMLElement
    expect(retryButton).not.toBeNull()
    fireEvent.click(retryButton)

    await waitFor(() => {
      const afterCount = records.filter((r) => r.url.includes('/organizations/1/signals')).length
      expect(afterCount).toBeGreaterThan(beforeCount)
    })
  })
})
