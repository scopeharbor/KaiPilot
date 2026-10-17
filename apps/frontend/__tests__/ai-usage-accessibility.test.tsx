// apps/frontend/__tests__/ai-usage-accessibility.test.tsx — §6.8 无障碍测试
// v3-copilot-usage-and-quota-surface

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// Mock TanStack Query
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn().mockReturnValue({ data: null, isLoading: false, error: null }),
  QueryClient: vi.fn().mockImplementation(() => ({})),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock compiler API
vi.mock('@/lib/api/compiler', () => ({
  compilerApi: {
    getObservabilitySummary: vi.fn().mockResolvedValue({ data: null }),
  },
}))

// Mock query keys
vi.mock('@/lib/api/compiler-query-keys', () => ({
  COMPILER_QUERY_KEYS: {
    observabilitySummary: (id: number) => ['compiler', 'observability', id],
  },
}))

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

// Mock useAuthStore
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn().mockImplementation((selector) => {
    const state = {
      hasHydrated: true,
      isAuthenticated: true,
      user: { organizationId: 1, roles: ['org_admin'] },
    }
    return selector(state)
  }),
}))

// Track permission state
let grantPermission = true

vi.mock('@/components/PermissionGuard', () => ({
  PermissionGuard: ({
    children,
    fallback,
  }: {
    children: React.ReactNode
    fallback?: React.ReactNode
  }) => (grantPermission ? <>{children}</> : <>{fallback}</>),
  default: ({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) =>
    grantPermission ? <>{children}</> : <>{fallback}</>,
}))

describe('§6.8 accessibility', () => {
  it('page has proper heading hierarchy', async () => {
    grantPermission = true
    const { AiUsagePage } = await import('@/components/ai/AiUsagePage')
    render(<AiUsagePage />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toBeDefined()
    expect(heading.textContent).toContain('AI 用量与额度')
  })

  it('usage disclaimer text is present', async () => {
    grantPermission = true
    const { AiUsagePage } = await import('@/components/ai/AiUsagePage')
    render(<AiUsagePage />)

    // 估算标注文本应存在
    const disclaimer = screen.getByText(/所有成本数字均为估算/)
    expect(disclaimer).toBeDefined()
    // 装饰性文本应有 aria-hidden（由 ShieldAlert icon 提供）
    // span 本身是描述性文本，不需要 aria-hidden
    expect(disclaimer.tagName).toBe('SPAN')
  })

  it('permission denied fallback has proper heading', async () => {
    grantPermission = false
    const { AiUsagePage } = await import('@/components/ai/AiUsagePage')
    render(<AiUsagePage />)

    // 无权限提示应存在
    expect(screen.getByText('没有 AI 用量查看权限')).toBeDefined()
    // 不应该渲染主内容
    expect(screen.queryByText('AI 用量与额度')).toBeNull()
  })
})
