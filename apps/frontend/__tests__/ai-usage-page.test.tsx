// apps/frontend/__tests__/ai-usage-page.test.tsx — §6 页面接入测试
// v3-copilot-usage-and-quota-surface

import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// Track whether permission should be granted
let grantPermission = true

// Mock PermissionGuard — 根据 grantPermission 标志决定是否渲染 children
vi.mock('@/components/PermissionGuard', () => ({
  PermissionGuard: ({
    children,
    fallback,
  }: {
    children: React.ReactNode
    require: string | string[]
    fallback?: React.ReactNode
  }) => (grantPermission ? <>{children}</> : <>{fallback}</>),
  default: ({
    children,
    fallback,
  }: {
    children: React.ReactNode
    require: string | string[]
    fallback?: React.ReactNode
  }) => (grantPermission ? <>{children}</> : <>{fallback}</>),
}))

describe('§6.2 AI usage page renders shipped component', () => {
  beforeEach(() => {
    grantPermission = true
  })

  it('CompilerObservabilitySummary is present in the rendered output', async () => {
    const { AiUsagePage } = await import('@/components/ai/AiUsagePage')
    render(<AiUsagePage />)

    expect(screen.getByText('AI 用量与额度')).toBeDefined()
    expect(screen.getByText('暂无可观测数据')).toBeDefined()
  })
})

describe('§6.4 no parallel dashboard component', () => {
  it('page does not import a second dashboard component', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const pagePath = path.resolve(
      process.cwd(),
      '../../apps/frontend/components/ai/AiUsagePage.tsx',
    )
    const source = fs.readFileSync(pagePath, 'utf8')

    expect(source).toContain('CompilerObservabilitySummary')
    expect(source).not.toMatch(/import.*(?:UsageDashboard|AiUsageDashboard|UsageSummary)/)
  })
})

describe('§6.6 unpermitted actor sees no entry point', () => {
  it('shows permission denied fallback when user lacks ai:usage:view', async () => {
    grantPermission = false

    const { AiUsagePage } = await import('@/components/ai/AiUsagePage')
    render(<AiUsagePage />)

    // 应该显示无权限提示
    expect(screen.getByText('没有 AI 用量查看权限')).toBeDefined()

    // 不应该渲染用量标题
    expect(screen.queryByText('AI 用量与额度')).toBeNull()

    // 不应该渲染 CompilerObservabilitySummary
    expect(screen.queryByText('暂无可观测数据')).toBeNull()
  })
})
