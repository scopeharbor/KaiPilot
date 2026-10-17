/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.4 —— 插件目录页面装配与整页守卫测试。
 *
 * 覆盖（spec「组织插件目录与插件策略治理」Requirement 1 + tasks 9.4）：
 * - 具备 plugin_registry:view：页面挂载工作台、标题「插件目录」回显、release 数据请求发出；
 * - 无 plugin_registry:view：整页不渲染（不暴露入口存在性）且零业务请求（RL-05/RL-06）；
 * - 未选择组织（orgId=null）：同样整页不渲染且零请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import NextOrgPluginDirectoryPage from '@/app/(next)/next/organization/plugin-directory/page'

// ---------------------------------------------------------------------------

function setAuth(permissions: string[], currentOrganizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations:
        currentOrganizationId === null
          ? []
          : [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

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
  pathname: string
}

function installFetchRouter(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const url = new URL(rawUrl.replace(API_PREFIX, 'http://localhost:3333'))
    records.push({ method, pathname: url.pathname })
    if (url.pathname.endsWith('/plugin-directory/releases')) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 50, totalPages: 1 },
      })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '未匹配' } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NextOrgPluginDirectoryPage />
    </QueryClientProvider>,
  )
}

function settle(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  useAuthStore.setState({ permissions: [], currentOrganizationId: null })
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('NextOrgPluginDirectoryPage：/next/organization/plugin-directory 装配与整页守卫（tasks 9.4）', () => {
  test('具备 plugin_registry:view：工作台挂载、标题回显、目录列表请求发出', async () => {
    setAuth(['plugin_registry:view'])
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-plugin-directory-workspace]')).not.toBeNull(),
    )
    expect(screen.getByRole('heading', { name: '插件目录' })).toBeInTheDocument()
    await settle()
    expect(
      records.some((r) => r.pathname.endsWith('/plugin-directory/releases') && r.method === 'GET'),
    ).toBe(true)
  })

  test('无 plugin_registry:view：整页不渲染（不暴露入口存在性），零业务请求', async () => {
    setAuth(['plugin_install:view'])
    const { records } = installFetchRouter()
    renderPage()

    expect(document.querySelector('[data-plugin-directory-workspace]')).toBeNull()
    expect(document.body.textContent?.trim()).toBe('')
    await settle()
    expect(records).toHaveLength(0)
  })

  test('未选择组织：整页不渲染且零请求', async () => {
    setAuth(['plugin_registry:view'], null)
    const { records } = installFetchRouter()
    renderPage()

    expect(document.body.textContent?.trim()).toBe('')
    await settle()
    expect(records).toHaveLength(0)
  })
})
