/**
 * TRIZ 决策中心新轨路由测试（/next/projects/:id/triz-decision-center）。
 *
 * 覆盖（用户审计项 #7）：
 * - 新轨路由存在且挂载旧轨生产页（刻意跨轨复用，含交付闭环）；
 * - 权限守卫：无 triz_decision:view → 受限横幅且不挂载内容；
 * - 非法 id → 中性 404 空态；
 * - 空间坐标含 triz-decision-center 条目（关键词避让「决策」）。
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import TrizDecisionCenterNextPage from '@/app/(next)/next/projects/[id]/triz-decision-center/page'
import { PRESET_SPACE_COORDINATES } from '@/lib/next/space-coordinates'

// 旧轨生产页以 stub 替代（本测试只验新轨路由接线，不验其内部行为）
vi.mock('@/app/(dashboard)/projects/[id]/triz-decision-center/page', () => ({
  default: () => <div data-stub-triz-center />,
}))

let mockParamsId = '7'
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockParamsId }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

function setAuth(permissions: string[]) {
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
  } as never)
}

beforeEach(() => {
  mockParamsId = '7'
})

describe('TRIZ 决策中心新轨路由', () => {
  test('有权限时挂载决策中心内容（跨轨复用旧轨生产页）', async () => {
    setAuth(['project:view', 'triz_decision:view'])
    render(<TrizDecisionCenterNextPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-triz-center-next-page]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-stub-triz-center]')).not.toBeNull()
  })

  test('无 triz_decision:view → 受限横幅且不挂载内容', async () => {
    setAuth(['project:view'])
    render(<TrizDecisionCenterNextPage />)
    expect(await screen.findByText('你没有查看 TRIZ 决策中心的权限')).toBeTruthy()
    expect(document.querySelector('[data-stub-triz-center]')).toBeNull()
  })

  test('非法项目 id → 中性 404 空态', async () => {
    mockParamsId = 'abc'
    setAuth(['project:view', 'triz_decision:view'])
    render(<TrizDecisionCenterNextPage />)
    expect(await screen.findByText(/项目不存在或已被移除/)).toBeTruthy()
    expect(document.querySelector('[data-stub-triz-center]')).toBeNull()
  })

  test('空间坐标含 triz-decision-center 且关键词避让「决策」', () => {
    const coord = PRESET_SPACE_COORDINATES.find((item) => item.id === 'triz-decision-center')
    expect(coord).toBeTruthy()
    expect(coord!.path).toBe('/next/projects/:id/triz-decision-center')
    expect(coord!.status).toBe('available')
    expect(coord!.keywords).toContain('TRIZ')
    expect(coord!.keywords).not.toContain('决策')
  })
})
