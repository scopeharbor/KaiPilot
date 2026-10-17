/**
 * v3-ui-next-settings-admin-domains W5 · tasks 5.2 —— AI 连接工作区测试
 * （spec「AI 模型连接与用量」：新建连接 Key 不回显 + 测连通性 + 删除二次确认 + 权限守卫 0 请求）。
 *
 * 覆盖：
 * - 列表渲染：连接名称、协议类型、激活状态、加密密钥状态；
 * - 新建连接：表单校验拦截（缺少必填项时断言 0 请求）、合法提交发送 POST `/ai/connections`、API Key 密码态且卡面永不回显明文；
 * - 连通性测试：调用 `POST /ai/connections/:id/test`，正确渲染连通结果与往返延迟；
 * - 删除连接二次确认：取消对话框不发请求（0 请求）、确认删除后调用 `DELETE /ai/connections/:id` 并刷新列表；
 * - 无 `ai:connection:manage` 权限时渲染受限横幅，且底层接口 0 请求（RL-06）。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { AiConnectionsWorkspace } from '@/components/next/settings/ai/AiConnectionsWorkspace'
import type { AiConnectionDto, AiConnectionTestResult } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/ai-connections',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body?: unknown
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(
  route: (path: string, method: string, body?: unknown) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    let parsedBody: unknown
    if (init?.body && typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = init.body
      }
    }
    records.push({ method, url: path, body: parsedBody })
    return (
      route(path, method, parsedBody) ??
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

function setAuth(permissions: string[], organizationId: number = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '系统管理员',
      organizations: [{ id: organizationId, name: '主研发组织', slug: 'main-org', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const mockConnection: AiConnectionDto = {
  id: '1',
  organizationId: '1',
  displayName: '主生产 OpenAI',
  protocol: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  catalogProviderId: null,
  catalogProviderName: null,
  catalogProviderLogoUrl: null,
  catalogProviderDocUrl: null,
  catalogProviderEnvKeys: [],
  catalogSyncedAt: null,
  model: 'gpt-4o',
  models: [
    {
      id: 'm-1',
      connectionId: '1',
      organizationId: 'org-1',
      pricingSnapshotId: null,
      tokenLimitSource: null,
      modelName: 'gpt-4o',
      capabilities: ['chat'],
      catalogProviderId: null,
      catalogModelId: null,
      catalogMetadata: null,
      contextWindowTokens: 128000,
      maxInputTokens: 128000,
      maxOutputTokens: 4096,
      rpmLimit: null,
      tpmLimit: null,
      isActive: true,
      lastTestedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  hasKey: true,
  keyHint: '...xab0',
  capabilities: { supportsToolCalling: true, supportsStrictSchema: true },
  toolCallingMode: 'prompt_json',
  isActive: true,
  lastTestedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: null,
}

describe('AiConnectionsWorkspace (v3-ui-next-settings-admin-domains W5 · 5.1/5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('列表渲染连接卡片并断言密钥不回显明文', async () => {
    setAuth(['ai:connection:manage'])
    installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [mockConnection] })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    // 等待连接卡片呈现
    await waitFor(() => {
      expect(screen.getByText('主生产 OpenAI')).toBeInTheDocument()
    })

    expect(screen.getByText('OpenAI 兼容 · 提示词 JSON（Prompt + JSON）')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('已加密 (...xab0)')).toBeInTheDocument()

    // 核心安全红线：界面不得出现任何明文形式的 sk- 密钥
    expect(screen.queryByText(/sk-[a-zA-Z0-9]{10,}/)).toBeNull()
  })

  test('新建连接表单校验拦截（缺少必填项时断言 0 写请求）', async () => {
    setAuth(['ai:connection:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('暂无 AI 模型连接')).toBeInTheDocument()
    })

    // 打开新建对话框
    fireEvent.click(screen.getByTestId('create-connection-button'))
    expect(screen.getByTestId('create-connection-dialog')).toBeInTheDocument()

    // 不输入任何字段直接提交
    fireEvent.click(screen.getByTestId('submit-create-button'))

    // 提示错误
    expect(screen.getByText('请输入连接名称')).toBeInTheDocument()
    expect(screen.getByText('请输入模型标识')).toBeInTheDocument()
    expect(screen.getByText('请输入 API Key')).toBeInTheDocument()

    // 断言网络记录中无任何 POST 请求（RL-06）
    const postRequests = records.filter((r) => r.method === 'POST')
    expect(postRequests.length).toBe(0)
  })

  test('合法提交新建连接并断言 API Key 字段为密码态且加密保存', async () => {
    setAuth(['ai:connection:manage'])
    let connectionList: AiConnectionDto[] = []

    const { records } = installFetchRouter((path, method, body) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: connectionList })
      }
      if (path === '/ai/connections' && method === 'POST') {
        const input = body as { displayName: string; model: string }
        const created: AiConnectionDto = {
          ...mockConnection,
          id: '2',
          displayName: input.displayName,
          model: input.model,
          keyHint: '...k999',
        }
        connectionList = [created]
        return jsonResponse(201, { data: created })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('create-connection-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('create-connection-button'))

    const nameInput = screen.getByTestId('input-display-name')
    const modelInput = screen.getByTestId('input-model')
    const keyInput = screen.getByTestId('input-api-key')

    // 验证 API key 输入框必须是 password 态
    expect(keyInput).toHaveAttribute('type', 'password')

    fireEvent.change(nameInput, { target: { value: '新版 Claude 连接' } })
    fireEvent.change(modelInput, { target: { value: 'claude-3-5-sonnet' } })
    fireEvent.change(keyInput, { target: { value: 'sk-secret-ant-test-key-12345' } })

    fireEvent.click(screen.getByTestId('submit-create-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('create-connection-dialog')).toBeNull()
    })

    // 校验 POST 请求发出且包含参数
    const createReq = records.find((r) => r.method === 'POST' && r.url === '/ai/connections')
    expect(createReq).toBeDefined()
    expect((createReq?.body as Record<string, unknown>).displayName).toBe('新版 Claude 连接')

    // 重新拉取后新卡片显示
    await waitFor(() => {
      expect(screen.getByText('新版 Claude 连接')).toBeInTheDocument()
      expect(screen.getByText('已加密 (...k999)')).toBeInTheDocument()
    })

    // 界面决不泄露 sk-secret
    expect(screen.queryByText('sk-secret-ant-test-key-12345')).toBeNull()
  })

  test('连接协议下拉合并了调用方式：五个选项，提交拆回 protocol + toolCallingMode', async () => {
    setAuth(['ai:connection:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') return jsonResponse(200, { data: [] })
      if (path === '/ai/connections' && method === 'POST') {
        return jsonResponse(201, { data: { ...mockConnection, id: '9' } })
      }
      return null
    })
    renderWithClient(<AiConnectionsWorkspace />)
    await waitFor(() => expect(screen.getByTestId('create-connection-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('create-connection-button'))

    // 不再有单独的「工具调用方式」下拉
    expect(screen.queryByTestId('select-tool-calling-mode')).toBeNull()
    const protocolSelect = screen.getByTestId('select-protocol') as HTMLSelectElement
    expect(Array.from(protocolSelect.options).map((option) => option.value)).toEqual([
      'openai_compatible:prompt_json',
      'openai_compatible:openai_chat_tools',
      'openai_compatible:openai_responses_tools',
      'anthropic_compatible:prompt_json',
      'anthropic_compatible:anthropic_tool_use',
    ])
    expect(protocolSelect.value).toBe('openai_compatible:prompt_json')
    fireEvent.change(protocolSelect, {
      target: { value: 'anthropic_compatible:anthropic_tool_use' },
    })

    fireEvent.change(screen.getByTestId('input-display-name'), { target: { value: 'Claude' } })
    fireEvent.change(screen.getByTestId('input-model'), { target: { value: 'claude-opus-5-5' } })
    fireEvent.change(screen.getByTestId('input-api-key'), { target: { value: 'sk-ant-xxx' } })
    fireEvent.click(screen.getByTestId('submit-create-button'))
    await waitFor(() => {
      const post = records.find((r) => r.method === 'POST' && r.url === '/ai/connections')
      expect(post?.body).toMatchObject({
        protocol: 'anthropic_compatible',
        toolCallingMode: 'anthropic_tool_use',
      })
    })
  })

  test('已有连接：卡片上的协议下拉只列同协议选项，切换即 PATCH', async () => {
    setAuth(['ai:connection:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [mockConnection] })
      }
      if (path === '/ai/connections/1' && method === 'PATCH') {
        return jsonResponse(200, {
          data: { ...mockConnection, toolCallingMode: 'openai_responses_tools' },
        })
      }
      return null
    })
    renderWithClient(<AiConnectionsWorkspace />)
    const select = (await screen.findByTestId('protocol-variant-1')) as HTMLSelectElement
    expect(select.value).toBe('openai_compatible:prompt_json')
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'openai_compatible:prompt_json',
      'openai_compatible:openai_chat_tools',
      'openai_compatible:openai_responses_tools',
    ])
    fireEvent.change(select, { target: { value: 'openai_compatible:openai_responses_tools' } })
    await waitFor(() => {
      const patch = records.find((r) => r.method === 'PATCH')
      expect(patch?.body).toEqual({ toolCallingMode: 'openai_responses_tools' })
    })
  })

  test('连通性测试展示往返延迟与检测成功状态', async () => {
    setAuth(['ai:connection:manage'])
    const testResultFixture: AiConnectionTestResult = {
      ok: true,
      latencyMs: 142,
      model: 'gpt-4o',
      detectedCapabilities: { supportsToolCalling: true, supportsStrictSchema: true },
      usage: { totalTokens: 18 },
    }

    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [mockConnection] })
      }
      if (path === '/ai/connections/1/test' && method === 'POST') {
        return jsonResponse(200, { data: testResultFixture })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('test-connection-1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('test-connection-1'))

    await waitFor(() => {
      expect(screen.getByTestId('test-result-1')).toBeInTheDocument()
    })

    expect(screen.getByText(/连通测试通过 · 往返延迟 142ms/)).toBeInTheDocument()
    expect(screen.getByText(/消耗 Token: 18/)).toBeInTheDocument()

    const testReq = records.find((r) => r.method === 'POST' && r.url === '/ai/connections/1/test')
    expect(testReq).toBeDefined()
  })

  test('多模型连接：测试结果附逐模型明细', async () => {
    setAuth(['ai:connection:manage'])
    const multiModelConnection: AiConnectionDto = {
      ...mockConnection,
      models: [
        mockConnection.models[0]!,
        {
          ...mockConnection.models[0]!,
          id: 'm-2',
          modelName: 'deepseek-chat',
        },
      ],
    }
    const multiModelResult: AiConnectionTestResult = {
      ok: false,
      latencyMs: 320,
      model: 'deepseek-chat',
      detectedCapabilities: {},
      usage: { totalTokens: 30 },
      errorKind: 'AI_SERVICE_ERROR',
      errorMessage: '模拟供应商失败',
      results: [
        {
          modelId: 'm-1',
          modelName: 'gpt-4o',
          ok: true,
          latencyMs: 142,
          usage: { totalTokens: 18 },
        },
        {
          modelId: 'm-2',
          modelName: 'deepseek-chat',
          ok: false,
          latencyMs: 320,
          errorKind: 'AI_SERVICE_ERROR',
          errorMessage: '模拟供应商失败',
        },
      ],
    }

    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [multiModelConnection] })
      }
      if (path === '/ai/connections/1/test' && method === 'POST') {
        return jsonResponse(200, { data: multiModelResult })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('test-connection-1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('test-connection-1'))

    await waitFor(() => {
      expect(screen.getByTestId('test-result-1')).toBeInTheDocument()
    })

    // 聚合行：有失败 → 顶层失败文案（多模型附 N/M 汇总）
    expect(screen.getByText(/连通失败: 1\/2 个模型未通过 · 模拟供应商失败/)).toBeInTheDocument()

    // 逐模型明细：通过的模型带延迟，失败的模型带错误信息
    // （模型名同时出现在模型 chip 与结果明细行，用 getAllByText 断言存在即可）
    expect(screen.getByTestId('test-result-model-1-m-1')).toBeInTheDocument()
    expect(screen.getByTestId('test-result-model-1-m-2')).toBeInTheDocument()
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
    expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThan(0)
    expect(screen.getByText('通过 · 142ms')).toBeInTheDocument()
    expect(screen.getByText('模拟供应商失败')).toBeInTheDocument()

    const testReq = records.find((r) => r.method === 'POST' && r.url === '/ai/connections/1/test')
    expect(testReq).toBeDefined()
  })

  test('删除连接二次确认流程：取消不发请求，确认调用 DELETE', async () => {
    setAuth(['ai:connection:manage'])
    let connectionList = [mockConnection]

    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: connectionList })
      }
      if (path === '/ai/connections/1' && method === 'DELETE') {
        connectionList = []
        return jsonResponse(204, null)
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => {
      expect(screen.getByTestId('delete-connection-1')).toBeInTheDocument()
    })

    // 点击删除触发二次确认
    fireEvent.click(screen.getByTestId('delete-connection-1'))
    expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText(/删除 AI 模型连接确认/)).toBeInTheDocument()

    // 点击取消
    fireEvent.click(screen.getByTestId('cancel-delete-button'))
    expect(screen.queryByTestId('delete-confirm-dialog')).toBeNull()

    // 此时不应有任何 DELETE 请求
    expect(records.filter((r) => r.method === 'DELETE').length).toBe(0)

    // 再次点击删除并确认
    fireEvent.click(screen.getByTestId('delete-connection-1'))
    fireEvent.click(screen.getByTestId('confirm-delete-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('delete-confirm-dialog')).toBeNull()
    })

    // 校验 DELETE 请求发出
    const deleteReq = records.find((r) => r.method === 'DELETE' && r.url === '/ai/connections/1')
    expect(deleteReq).toBeDefined()

    // 列表变为空态
    await waitFor(() => {
      expect(screen.getByText('暂无 AI 模型连接')).toBeInTheDocument()
    })
  })

  test('无 ai:connection:manage 权限时渲染受限横幅且 0 业务请求（RL-06）', async () => {
    // 仅分配普通用户权限，无 ai:connection:manage
    setAuth(['project:view'])

    const { records } = installFetchRouter(() => {
      return jsonResponse(200, { data: [] })
    })

    renderWithClient(<AiConnectionsWorkspace />)

    expect(screen.getByText('没有 AI 连接管理权限')).toBeInTheDocument()
    expect(screen.getByText(/需要 ai:connection:manage 权限/)).toBeInTheDocument()

    // 验证网络监控：底层 /ai/connections 接口 0 请求
    const aiRequests = records.filter((r) => r.url.startsWith('/ai/connections'))
    expect(aiRequests.length).toBe(0)
  })

  test('编辑连接：预填字段，API Key 留空时 PATCH 不含 apiKey', async () => {
    setAuth(['ai:connection:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [mockConnection] })
      }
      if (path === '/ai/connections/1' && method === 'PATCH') {
        return jsonResponse(200, { data: mockConnection })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => expect(screen.getByTestId('edit-connection-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('edit-connection-1'))

    const dialog = screen.getByTestId('create-connection-dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('data-editing', 'true')

    // 预填：名称 / 首个模型 / Base URL
    expect((screen.getByTestId('input-display-name') as HTMLInputElement).value).toBe(
      '主生产 OpenAI',
    )
    expect((screen.getByTestId('input-model') as HTMLInputElement).value).toBe('gpt-4o')
    expect((screen.getByTestId('input-base-url') as HTMLInputElement).value).toBe(
      'https://api.openai.com/v1',
    )

    fireEvent.click(screen.getByTestId('submit-create-button'))

    await waitFor(() => {
      expect(
        records.find((r) => r.method === 'PATCH' && r.url === '/ai/connections/1'),
      ).toBeDefined()
    })
    const payload = records.find((r) => r.method === 'PATCH' && r.url === '/ai/connections/1')
      ?.body as Record<string, unknown>
    // 红线：Key 留空时 payload 不得携带 apiKey
    expect(payload.apiKey).toBeUndefined()
    expect(payload.displayName).toBe('主生产 OpenAI')
    expect(payload.isActive).toBe(true)
    expect(Array.isArray(payload.models)).toBe(true)
    expect((payload.models as unknown[]).length).toBe(1)
  })

  test('启用/停用切换发送 PATCH isActive', async () => {
    setAuth(['ai:connection:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [mockConnection] })
      }
      if (path === '/ai/connections/1' && method === 'PATCH') {
        return jsonResponse(200, { data: { ...mockConnection, isActive: false } })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => expect(screen.getByTestId('toggle-connection-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('toggle-connection-1'))

    await waitFor(() => {
      const patch = records.find((r) => r.method === 'PATCH' && r.url === '/ai/connections/1')
      expect(patch?.body).toEqual({ isActive: false })
    })
  })

  test('未启用连接点击测试连通性：本地拦截提示且 0 测试请求', async () => {
    setAuth(['ai:connection:manage'])
    const inactiveConnection: AiConnectionDto = { ...mockConnection, isActive: false }

    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [inactiveConnection] })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => expect(screen.getByTestId('test-connection-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('test-connection-1'))

    expect(screen.getByText(/请你先启用之后才可以测试/)).toBeInTheDocument()
    // 本地拦截：不得发出任何 POST 测试请求
    expect(records.filter((r) => r.method === 'POST').length).toBe(0)
  })

  test('新建连接支持多模型：POST body 携带 models 数组与限流配置', async () => {
    setAuth(['ai:connection:manage'])
    let connectionList: AiConnectionDto[] = []

    const { records } = installFetchRouter((path, method, body) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: connectionList })
      }
      if (path === '/ai/connections' && method === 'POST') {
        const created: AiConnectionDto = {
          ...mockConnection,
          id: '3',
          displayName: (body as { displayName: string }).displayName,
          keyHint: '...k999',
        }
        connectionList = [created]
        return jsonResponse(201, { data: created })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => expect(screen.getByTestId('create-connection-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('create-connection-button'))

    fireEvent.change(screen.getByTestId('input-display-name'), { target: { value: '多模型网关' } })
    fireEvent.change(screen.getByTestId('input-model'), { target: { value: 'gpt-4o-mini' } })
    fireEvent.change(screen.getByTestId('input-api-key'), { target: { value: 'sk-multi-xxx' } })

    // 追加第二个模型并配置 RPM
    fireEvent.click(screen.getByText('添加模型'))
    fireEvent.change(screen.getByTestId('input-model-1'), { target: { value: 'deepseek-chat' } })
    fireEvent.change(screen.getAllByLabelText('RPM')[1]!, { target: { value: '60' } })

    fireEvent.click(screen.getByTestId('submit-create-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('create-connection-dialog')).toBeNull()
    })

    const createReq = records.find((r) => r.method === 'POST' && r.url === '/ai/connections')
    const payload = createReq?.body as {
      model: string
      models: { modelName: string; rpmLimit: number | null; isActive: boolean }[]
    }
    expect(payload.model).toBe('gpt-4o-mini')
    expect(payload.models.length).toBe(2)
    expect(payload.models[1]?.modelName).toBe('deepseek-chat')
    expect(payload.models[1]?.rpmLimit).toBe(60)
    expect(payload.models[1]?.isActive).toBe(true)
  })

  test('models.dev 目录搜寻调用 search 接口，选用后预填模型与 Base URL', async () => {
    setAuth(['ai:connection:manage'])
    const catalogModel = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      providerId: 'openai',
      providerName: 'OpenAI',
      providerApi: 'https://api.openai.com/v1',
      providerDocsUrl: null,
      providerEnvKeys: [],
      providerLogoUrl: 'https://example.com/logo.png',
      npmPackage: null,
      protocol: 'openai_compatible',
      supportLevel: 'one_click',
      baseUrl: 'https://api.openai.com/v1',
      baseUrlNeedsManualEdit: false,
      family: null,
      description: null,
      modalities: { input: ['text'], output: ['text'] },
      capabilities: ['chat', 'tool_calling'],
      limit: { context: 128000, input: null, output: 4096 },
      cost: {
        input: 2.5,
        output: 10,
        cacheRead: null,
        cacheWrite: null,
        inputAudio: null,
        outputAudio: null,
        reasoning: null,
        contextOver200k: null,
        tiers: null,
      },
      knowledgeCutoff: '2023-10',
      releaseDate: '2024-05-01',
      lastUpdated: '2024-05-01',
      status: null,
      attachment: null,
      reasoning: null,
      reasoningOptions: null,
      toolCall: true,
      structuredOutput: true,
      temperature: null,
      openWeights: null,
      weights: null,
      benchmarks: null,
      license: null,
      links: null,
      experimentalModes: null,
      providerOverride: null,
      pricingSnapshotId: null,
      rawModel: {},
    }

    const { records } = installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      if (path.startsWith('/ai/model-catalog/search') && method === 'GET') {
        return jsonResponse(200, {
          data: [catalogModel],
          meta: {
            query: 'OpenAI',
            providerId: null,
            total: 1,
            stale: false,
            fetchedAt: '2026-10-01T00:00:00.000Z',
            expiresAt: null,
          },
        })
      }
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)

    await waitFor(() => expect(screen.getByTestId('create-connection-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('create-connection-button'))

    fireEvent.change(screen.getByPlaceholderText('OpenAI、火山引擎、腾讯云、DeepSeek...'), {
      target: { value: 'OpenAI' },
    })
    fireEvent.click(screen.getByText('搜寻'))

    await waitFor(() => {
      expect(
        records.find((r) => r.method === 'GET' && r.url.startsWith('/ai/model-catalog/search')),
      ).toBeDefined()
    })

    // 选用目录模型：预填连接名称 / Base URL / 模型标识与目录限制
    await waitFor(() => expect(screen.getByText('选用')).toBeInTheDocument())
    fireEvent.click(screen.getByText('选用'))

    await waitFor(() => {
      expect((screen.getByTestId('input-model') as HTMLInputElement).value).toBe('gpt-4o')
    })
    expect((screen.getByTestId('input-display-name') as HTMLInputElement).value).toBe('OpenAI')
    expect((screen.getByTestId('input-base-url') as HTMLInputElement).value).toBe(
      'https://api.openai.com/v1',
    )
  })
})
