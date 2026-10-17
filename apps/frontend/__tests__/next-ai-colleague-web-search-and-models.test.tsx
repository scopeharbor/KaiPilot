/**
 * 2026-09-26：AI 同事的模型选择 / 网页搜索开关，以及 AI 连接页的「网页搜索连接」卡片。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { AiColleagueModelAndSearchBar } from '@/components/next/ai/AiColleagueChatControls'
import { WebSearchConnectionCard } from '@/components/next/settings/ai/WebSearchConnectionCard'

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

interface Call {
  method: string
  path: string
  body: unknown
}

function installFetch(route: (path: string, method: string) => Response | null) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.replace(API_PREFIX, '')
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return route(path, method) ?? jsonResponse(404, { error: { code: 'NOT_FOUND', message: path } })
  })
  return calls
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'a@b.c',
      fullName: '管理员',
      organizations: [{ id: 1, name: '组织', slug: 'o', role: 'admin' }],
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

const summary = (overrides: Record<string, unknown> = {}) => ({
  organizationId: 1,
  enabled: false,
  configured: true,
  maskedProviderLabel: '免费公开搜索（无需密钥）',
  providerConnectionId: null,
  allowedDomains: [],
  deniedDomains: [],
  allowedDomainCount: 0,
  deniedDomainCount: 0,
  dailyQueryLimit: 50,
  maxResultsPerQuery: 5,
  timeoutMs: 15000,
  cacheTtlMinutes: 60,
  retainDecisionDays: 30,
  requirePerTurnConsent: true,
  allowForAiCreate: false,
  allowForGeneralCopilot: false,
  providerKind: 'free',
  providerBaseUrl: null,
  providerKeyConfigured: false,
  providerKeyHint: null,
  ...overrides,
})

const connection = (
  id: number,
  displayName: string,
  models: Array<[number, string]>,
  extra = {},
) => ({
  id: String(id),
  displayName,
  isActive: true,
  hasKey: true,
  models: models.map(([modelId, modelName]) => ({ id: String(modelId), modelName })),
  ...extra,
})

beforeEach(() => {
  useNextAiColleagueStore.setState({ modelPreference: null, webSearchEnabled: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI 同事：模型与网页搜索', () => {
  test('只列出已激活且有密钥的连接的模型；选择后写入对话偏好', async () => {
    setAuth(['ai:trigger'])
    installFetch((path) => {
      if (path === '/ai/connections')
        return jsonResponse(200, {
          data: [
            connection(1, 'gpt-5.6-luna', [[11, 'gpt-5.6-luna']]),
            connection(2, '主连接', [[21, 'deepseek-v4']]),
            connection(3, '停用', [[31, 'x']], { isActive: false }),
            connection(4, '无密钥', [[41, 'y']], { hasKey: false }),
          ],
        })
      if (path === '/settings/copilot-tools/web-search')
        return jsonResponse(200, { data: summary() })
      return null
    })
    renderWithClient(<AiColleagueModelAndSearchBar />)

    const select = (await screen.findByLabelText('选择回答所用的模型')) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(3))
    expect([...select.options].map((o) => o.text)).toEqual([
      '组织默认模型',
      'gpt-5.6-luna',
      'deepseek-v4（主连接）',
    ])
    fireEvent.change(select, { target: { value: '2:21' } })
    expect(useNextAiColleagueStore.getState().modelPreference).toEqual({
      connectionId: 2,
      modelId: 21,
      label: 'deepseek-v4（主连接）',
    })

    // 网页搜索未开启：开关禁用，只说明未开启，不提示去找管理员（用户决策 2026-10-05）
    const toggle = screen.getByRole('switch', { name: /网页搜索/ })
    expect(toggle).toBeDisabled()
    expect(toggle.getAttribute('title')).toBe('网页搜索未开启')
    expect(toggle.getAttribute('title')).not.toMatch(/管理员/)
  })

  test('以服务端双层同意后的生效状态为准：组织开了但平台未开放仍不可用；个人帐号随平台开放可用', async () => {
    setAuth(['ai:trigger'])
    let governance = {
      mode: 'organization',
      platformApproved: false,
      organizationApproved: true,
      effectiveEnabled: false,
    }
    installFetch((path) => {
      if (path === '/ai/connections') return jsonResponse(200, { data: [] })
      if (path === '/settings/copilot-tools/web-search')
        return jsonResponse(200, {
          data: summary({ enabled: true, allowForGeneralCopilot: true, governance }),
        })
      return null
    })
    const first = renderWithClient(<AiColleagueModelAndSearchBar />)
    const blocked = screen.getByRole('switch', { name: /网页搜索/ })
    await waitFor(() => expect(blocked.getAttribute('title')).toBe('网页搜索未开启'))
    expect(blocked).toBeDisabled()
    first.unmount()

    // Google 个人帐号：本组织旧开关关闭，但平台已开放 → 可用
    governance = {
      mode: 'personal',
      platformApproved: true,
      organizationApproved: true,
      effectiveEnabled: true,
    }
    installFetch((path) => {
      if (path === '/ai/connections') return jsonResponse(200, { data: [] })
      if (path === '/settings/copilot-tools/web-search')
        return jsonResponse(200, { data: summary({ enabled: true, governance }) })
      return null
    })
    renderWithClient(<AiColleagueModelAndSearchBar />)
    const toggle = screen.getByRole('switch', { name: /网页搜索/ })
    await waitFor(() => expect(toggle).not.toBeDisabled())
  })

  test('组织启用网页搜索后可按对话开启', async () => {
    setAuth(['ai:trigger'])
    installFetch((path) => {
      if (path === '/ai/connections') return jsonResponse(200, { data: [] })
      if (path === '/settings/copilot-tools/web-search')
        return jsonResponse(200, { data: summary({ enabled: true, allowForGeneralCopilot: true }) })
      return null
    })
    renderWithClient(<AiColleagueModelAndSearchBar />)
    const toggle = screen.getByRole('switch', { name: /网页搜索/ })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    fireEvent.click(toggle)
    expect(useNextAiColleagueStore.getState().webSearchEnabled).toBe(true)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})

describe('AI 连接页：网页搜索连接卡片', () => {
  test('切换到需要密钥的提供方：出现只写的 Key 输入框，保存时提交提供方、密钥与开关', async () => {
    setAuth(['copilot:web_search:manage'])
    const calls = installFetch((path, method) => {
      if (path === '/settings/copilot-tools/web-search' && method === 'GET')
        return jsonResponse(200, { data: summary() })
      if (path === '/settings/copilot-tools/web-search' && method === 'PUT')
        return jsonResponse(200, {
          data: summary({
            enabled: true,
            allowForGeneralCopilot: true,
            providerKind: 'tavily',
            providerKeyConfigured: true,
            providerKeyHint: '…9876',
          }),
        })
      return null
    })
    renderWithClient(<WebSearchConnectionCard />)

    const provider = (await screen.findByTestId('web-search-provider')) as HTMLSelectElement
    expect(screen.queryByTestId('web-search-api-key')).toBeNull()
    fireEvent.change(provider, { target: { value: 'tavily' } })
    fireEvent.change(screen.getByTestId('web-search-api-key'), {
      target: { value: 'tvly-secret-9876' },
    })
    fireEvent.click(screen.getByTestId('web-search-enabled'))
    fireEvent.click(screen.getByTestId('web-search-allow-copilot'))
    fireEvent.click(screen.getByTestId('web-search-save'))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.body).toMatchObject({
      enabled: true,
      allowForGeneralCopilot: true,
      providerKind: 'tavily',
      providerApiKey: 'tvly-secret-9876',
      allowedDomains: [],
    })
    await waitFor(() =>
      expect(screen.getByTestId('web-search-status')).toHaveTextContent('AI 同事可用'),
    )
    // 保存后密钥框清空，只显示末四位提示
    expect((screen.getByTestId('web-search-api-key') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('web-search-api-key').getAttribute('placeholder')).toContain('…9876')
  })

  test('没有管理权限：只读展示，不出现保存按钮', async () => {
    setAuth(['ai:trigger'])
    installFetch((path) =>
      path === '/settings/copilot-tools/web-search' ? jsonResponse(200, { data: summary() }) : null,
    )
    renderWithClient(<WebSearchConnectionCard />)
    await screen.findByTestId('web-search-provider')
    expect(screen.getByTestId('web-search-provider')).toBeDisabled()
    expect(screen.queryByTestId('web-search-save')).toBeNull()
    expect(screen.getByText('当前帐号只能查看网页搜索设置')).toBeInTheDocument()
    expect(screen.queryByText(/请联系/)).toBeNull()
  })

  test('双层同意：团队组织显示平台与本组织各自状态；个人帐号只读沿用平台设置', async () => {
    setAuth(['copilot:web_search:manage'])
    installFetch((path) =>
      path === '/settings/copilot-tools/web-search'
        ? jsonResponse(200, {
            data: summary({
              enabled: true,
              allowForGeneralCopilot: true,
              governance: {
                mode: 'organization',
                platformApproved: false,
                organizationApproved: true,
                effectiveEnabled: false,
              },
            }),
          })
        : null,
    )
    const team = renderWithClient(<WebSearchConnectionCard />)
    expect(await screen.findByTestId('web-search-governance')).toHaveTextContent(
      '平台尚未开放 · 本组织已开启：两者都开启后成员才能使用。',
    )
    expect(screen.getByTestId('web-search-status')).toHaveTextContent('未开启')
    expect(screen.getByTestId('web-search-save')).toBeInTheDocument()
    team.unmount()

    installFetch((path) =>
      path === '/settings/copilot-tools/web-search'
        ? jsonResponse(200, {
            data: summary({
              enabled: true,
              allowForGeneralCopilot: true,
              governance: {
                mode: 'personal',
                platformApproved: true,
                organizationApproved: true,
                effectiveEnabled: true,
              },
            }),
          })
        : null,
    )
    renderWithClient(<WebSearchConnectionCard />)
    expect(await screen.findByTestId('web-search-governance')).toHaveTextContent(
      '个人帐号沿用平台的网页搜索设置，已可在 AI 同事里使用。',
    )
    expect(screen.getByTestId('web-search-status')).toHaveTextContent('AI 同事可用')
    expect(screen.getByTestId('web-search-provider')).toBeDisabled()
    expect(screen.queryByTestId('web-search-save')).toBeNull()
  })
})
