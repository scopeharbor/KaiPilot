/**
 * 模型定价弹层（2026-10-01）。
 *
 * 覆盖三件事：
 * 1. 状态呈现：未定价 / 已定价 / **近似价必须显式标出**（不能与真实结算价混同）；
 * 2. 历史用量回算：把「过去这些 token 按当前价多少钱」显示出来，供人工调价对照；
 * 3. 两个写入口：自动预填（POST pricing/prefill）与人工填写（PUT pricing，带币种与单价）。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore, type PlanTier } from '@/stores/auth-store'
import { AiConnectionsWorkspace } from '@/components/next/settings/ai/AiConnectionsWorkspace'
import type { AiConnectionDto, AiConnectionModelDto } from '@aiproj/types'

const API_PREFIX = 'http://localhost:3333/api/v1'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/settings/ai-connections',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(route: (path: string, method: string) => Response | null) {
  const records: Array<{ method: string; url: string; body: unknown }> = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    let body: unknown = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    records.push({ method, url: path, body })
    return (
      route(path, method) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[], planTier: PlanTier | null = 'enterprise') {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '主研发组织', slug: 'main-org', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const model = {
  id: '20',
  connectionId: '6',
  organizationId: '1',
  modelName: 'relay-a/vendor-x-model-1',
  capabilities: ['chat'],
  catalogProviderId: null,
  catalogModelId: null,
  pricingSnapshotId: null,
  catalogMetadata: null,
  contextWindowTokens: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  tokenLimitSource: null,
  rpmLimit: null,
  tpmLimit: null,
  isActive: true,
  lastTestedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: null,
} as unknown as AiConnectionModelDto

const connection = {
  id: '6',
  organizationId: '1',
  displayName: 'Relay A 通道',
  protocol: 'openai_compatible',
  baseUrl: 'https://api.relay-a.example/v1',
  catalogProviderId: null,
  catalogProviderName: null,
  catalogProviderLogoUrl: null,
  catalogProviderDocUrl: null,
  catalogProviderEnvKeys: [],
  catalogSyncedAt: null,
  model: model.modelName,
  models: [model],
  hasKey: true,
  keyHint: null,
  capabilities: null,
  toolCallingMode: 'prompt_json',
  isActive: true,
  lastTestedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: null,
} as unknown as AiConnectionDto

const unpricedDetail = {
  model: { id: '20', connectionId: '6', modelName: model.modelName, isActive: true },
  pricing: {
    hasPricing: false,
    snapshotId: null,
    source: null,
    currency: 'USD',
    pricingUnit: '1M_tokens',
    cost: null,
    approximate: false,
    decidedBy: null,
    reason: null,
    boundAt: null,
  },
  backCompute: {
    calls: 3264,
    pricedCalls: 0,
    unpricedCalls: 3264,
    tokens: {
      input: 14000000,
      output: 37000000,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 52798000,
    },
    estimatedCost: null,
    currency: 'USD',
    approximate: false,
    from: '1970-01-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
  },
}

const pricedDetail = {
  model: unpricedDetail.model,
  pricing: {
    hasPricing: true,
    snapshotId: '42',
    source: 'models.dev',
    currency: 'USD',
    pricingUnit: '1M_tokens',
    cost: {
      input: 0.15,
      output: 0.6,
      cacheRead: 0.003,
      cacheWrite: null,
      inputAudio: null,
      outputAudio: null,
      reasoning: null,
    },
    approximate: true,
    decidedBy: 'ai-prefill',
    reason: '模型判断：与官方同价',
    boundAt: '2026-10-01T12:00:00.000Z',
  },
  backCompute: {
    ...unpricedDetail.backCompute,
    pricedCalls: 3264,
    unpricedCalls: 0,
    estimatedCost: 24.3,
    approximate: true,
  },
}

async function openPricingDialog(records: Array<{ method: string; url: string; body: unknown }>) {
  renderWithClient(<AiConnectionsWorkspace />)
  await waitFor(() => expect(screen.getByText('Relay A 通道')).toBeInTheDocument())
  fireEvent.click(screen.getByTestId('pricing-connection-6'))
  await waitFor(() => expect(screen.getByTestId('model-pricing-dialog')).toBeInTheDocument())
  return records
}

describe('模型定价弹层（2026-10-01）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAuth(['ai:connection:manage'])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('未定价时显示未定价徽标与历史用量，token 与调用次数可读', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET')
        return jsonResponse(200, { data: [connection] })
      if (path.startsWith('/ai/connections/6/models/20/pricing') && method === 'GET') {
        return jsonResponse(200, { data: unpricedDetail })
      }
      return null
    })

    await openPricingDialog(records)

    const row = screen.getByTestId('model-pricing-20')
    expect(within(row).getByTestId('pricing-missing-20')).toBeInTheDocument()
    expect(records.some((record) => record.url.includes('includeBackCompute=false'))).toBe(true)
    expect(within(row).queryByTestId('back-compute-20')).not.toBeInTheDocument()
    fireEvent.click(within(row).getByTestId('load-back-compute-20'))
    await waitFor(() => expect(within(row).getByText(/52,798,000/)).toBeInTheDocument())
    expect(within(row).getByTestId('back-compute-20').textContent).toContain('未定价')
  })

  test('已定价时显示来源、单价与「近似价」显式标记', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET')
        return jsonResponse(200, { data: [connection] })
      if (path.startsWith('/ai/connections/6/models/20/pricing') && method === 'GET') {
        return jsonResponse(200, { data: pricedDetail })
      }
      return null
    })

    await openPricingDialog(records)

    const row = screen.getByTestId('model-pricing-20')
    await waitFor(() => expect(within(row).getByText('AI 预填')).toBeInTheDocument())
    expect(within(row).getByTestId('pricing-approximate-20')).toBeInTheDocument()
    expect(within(row).getByText(/USD\/百万token/)).toBeInTheDocument()
    // 回算按当前价给出金额，并标明是近似价
    fireEvent.click(within(row).getByTestId('load-back-compute-20'))
    await waitFor(() => expect(within(row).getByTestId('back-compute-20')).toBeInTheDocument())
    expect(within(row).getByTestId('back-compute-20').textContent).toContain('24.3000')
  })

  test('自动预填：POST pricing/prefill，成功后刷新为已定价', async () => {
    let prefilled = false
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET')
        return jsonResponse(200, { data: [connection] })
      if (path.startsWith('/ai/connections/6/models/20/pricing') && method === 'GET') {
        return jsonResponse(200, { data: prefilled ? pricedDetail : unpricedDetail })
      }
      if (path === '/ai/connections/6/models/20/pricing/prefill' && method === 'POST') {
        prefilled = true
        return jsonResponse(200, {
          data: {
            applied: true,
            strategy: 'ai-prefill',
            reason: '模型判断：与官方同价',
            approximate: true,
            chosen: null,
            candidates: [],
            pricing: pricedDetail.pricing,
          },
        })
      }
      return null
    })

    await openPricingDialog(records)

    fireEvent.click(screen.getByTestId('pricing-prefill-20'))

    await waitFor(() => {
      expect(records.some((r) => r.method === 'POST' && r.url.endsWith('/pricing/prefill'))).toBe(
        true,
      )
    })
    await waitFor(() =>
      expect(
        within(screen.getByTestId('model-pricing-20')).getByText('AI 预填'),
      ).toBeInTheDocument(),
    )
  })

  test('人工填写：PUT pricing 带上币种与各项单价', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET')
        return jsonResponse(200, { data: [connection] })
      if (path.startsWith('/ai/connections/6/models/20/pricing') && method === 'GET') {
        return jsonResponse(200, { data: unpricedDetail })
      }
      if (path === '/ai/connections/6/models/20/pricing' && method === 'PUT') {
        return jsonResponse(200, { data: pricedDetail.pricing })
      }
      return null
    })

    await openPricingDialog(records)

    fireEvent.click(screen.getByTestId('pricing-manual-20'))
    fireEvent.change(screen.getByTestId('pricing-currency-20'), { target: { value: 'CNY' } })
    fireEvent.change(screen.getByTestId('pricing-input-input-20'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByTestId('pricing-input-output-20'), { target: { value: '6' } })
    fireEvent.change(screen.getByTestId('pricing-input-cacheRead-20'), { target: { value: '0.2' } })
    fireEvent.change(screen.getByTestId('pricing-input-cacheWrite-20'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('pricing-input-inputAudio-20'), { target: { value: '12' } })
    fireEvent.change(screen.getByTestId('pricing-input-outputAudio-20'), {
      target: { value: '24' },
    })
    fireEvent.change(screen.getByTestId('pricing-input-reasoning-20'), { target: { value: '9' } })
    fireEvent.click(screen.getByTestId('pricing-save-20'))

    await waitFor(() => {
      const put = records.find((r) => r.method === 'PUT' && r.url.endsWith('/pricing'))
      expect(put).toBeTruthy()
      expect(put!.body).toEqual({
        currency: 'CNY',
        cost: {
          input: 1.5,
          output: 6,
          cacheRead: 0.2,
          cacheWrite: 2,
          inputAudio: 12,
          outputAudio: 24,
          reasoning: 9,
        },
      })
    })
  })

  test('编辑已有定价时回填原币种与全部七个价格维度', async () => {
    const cnyDetail = {
      ...pricedDetail,
      pricing: {
        ...pricedDetail.pricing,
        currency: 'CNY',
        cost: {
          input: 1,
          output: 2,
          cacheRead: 0.1,
          cacheWrite: 1.2,
          inputAudio: 10,
          outputAudio: 20,
          reasoning: 3,
        },
      },
    }
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET')
        return jsonResponse(200, { data: [connection] })
      if (path.startsWith('/ai/connections/6/models/20/pricing') && method === 'GET') {
        return jsonResponse(200, { data: cnyDetail })
      }
      return null
    })

    await openPricingDialog(records)
    await waitFor(() => expect(screen.getByText('AI 预填')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pricing-manual-20'))

    expect(screen.getByTestId('pricing-currency-20')).toHaveValue('CNY')
    expect(screen.getByTestId('pricing-input-inputAudio-20')).toHaveValue(10)
    expect(screen.getByTestId('pricing-input-outputAudio-20')).toHaveValue(20)
    expect(screen.getByTestId('pricing-input-reasoning-20')).toHaveValue(3)
  })

  test('无管理权限时写入口禁用（只读）', async () => {
    setAuth(['ai:usage:view'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET')
        return jsonResponse(200, { data: [connection] })
      if (path.startsWith('/ai/connections/6/models/20/pricing') && method === 'GET') {
        return jsonResponse(200, { data: unpricedDetail })
      }
      return null
    })

    // 无 ai:connection:manage 时工作区本身渲染受限横幅，弹层入口不可达
    renderWithClient(<AiConnectionsWorkspace />)
    await waitFor(() => expect(screen.getByText('没有 AI 连接管理权限')).toBeInTheDocument())
    expect(records.filter((r) => r.url.startsWith('/ai/connections')).length).toBe(0)
  })
})
