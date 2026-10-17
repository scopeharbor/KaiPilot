/**
 * v3-copilot-optional-web-search-configuration §1.3 —— Copilot 工具网页搜索设置面板组件测试。
 *
 * 覆盖：feature flag 关闭不渲染；默认关闭空态；只读（无权限）不渲染编辑控件；
 * 有权限可编辑并触发 PUT；错误态；开关键盘可达性（role=switch + aria-checked）。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotWebSearchSettingsPanel } from '@/components/integrations/CopilotWebSearchSettingsPanel'
import { copilotWebSearchApi, type CopilotWebSearchStatusDto } from '@/lib/api/copilot-web-search'

vi.mock('@/lib/api/copilot-web-search', () => ({
  copilotWebSearchApi: {
    getSettings: vi.fn(),
    getStatus: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

let permissionGranted = false
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((sel?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      hasHydrated: true,
      hasPermission: vi.fn(() => permissionGranted),
    }
    return sel ? sel(state as never) : state
  }),
}))

const defaultSummary: Omit<CopilotWebSearchStatusDto, 'quota'> = {
  organizationId: 1,
  enabled: false,
  configured: false,
  maskedProviderLabel: null,
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
}

function statusOf(overrides: Partial<CopilotWebSearchStatusDto> = {}): CopilotWebSearchStatusDto {
  return {
    ...defaultSummary,
    quota: { usedToday: 0, limitToday: 50, remainingToday: 50 },
    ...overrides,
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPanel() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <CopilotWebSearchSettingsPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionGranted = false
  vi.mocked(copilotWebSearchApi.getStatus).mockResolvedValue(statusOf())
})

describe('CopilotWebSearchSettingsPanel', () => {
  it('feature flag off → 不渲染（无任何设置 UI）', () => {
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <CopilotWebSearchSettingsPanel enabled={false} />
      </QueryClientProvider>,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('外部网页搜索')).toBeNull()
  })

  it('空态/默认关闭：显示「默认关闭」badge，未启用', async () => {
    renderPanel()
    const heading = await screen.findByRole('heading', { name: /外部网页搜索/ })
    expect(heading).toBeTruthy()
    expect(await screen.findByText('默认关闭')).toBeTruthy()
    expect(await screen.findByText(/未启用/)).toBeTruthy()
  })

  it('无权限 → 只读视图：无保存按钮、无开关控件', async () => {
    permissionGranted = false
    renderPanel()
    await screen.findByRole('heading', { name: /外部网页搜索/ })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /保存设置/ })).toBeNull()
    // 只读说明存在
    expect(await screen.findByText(/每次使用需按次同意/)).toBeTruthy()
  })

  it('有权限 + 已启用：开关可切换并触发 PUT（键盘可达 + 状态同步）', async () => {
    permissionGranted = true
    vi.mocked(copilotWebSearchApi.getStatus).mockResolvedValue(
      statusOf({
        enabled: true,
        configured: true,
        maskedProviderLabel: '搜索服务商 ••••',
        providerConnectionId: 7,
        allowedDomains: ['*.gov.cn'],
        allowedDomainCount: 1,
        quota: { usedToday: 2, limitToday: 50, remainingToday: 48 },
      }),
    )
    vi.mocked(copilotWebSearchApi.updateSettings).mockResolvedValue({
      ...defaultSummary,
      enabled: false,
    })
    renderPanel()
    await screen.findByRole('heading', { name: /外部网页搜索/ })
    const toggle = await screen.findByRole('switch', { name: '启用外部网页搜索' })
    // 键盘可达：switch 是可聚焦按钮，aria-checked 同步状态
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.focus()
    expect(document.activeElement).toBe(toggle)

    // 触发保存（把 enabled 关掉）→ PUT 携带变更
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    const saveButton = await screen.findByRole('button', { name: /保存设置/ })
    fireEvent.click(saveButton)
    await waitFor(() => {
      expect(copilotWebSearchApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })
  })

  it('错误态：加载失败显示降级文案', async () => {
    vi.mocked(copilotWebSearchApi.getStatus).mockRejectedValue(new Error('network'))
    renderPanel()
    expect(await screen.findByText('网页搜索设置加载失败')).toBeTruthy()
  })

  it('调用失败的错误提示（如 403 权限不足）', async () => {
    permissionGranted = true
    vi.mocked(copilotWebSearchApi.updateSettings).mockRejectedValue({
      code: 'PERMISSION_DENIED',
      message: '无权管理',
    })
    renderPanel()
    await screen.findByRole('heading', { name: /外部网页搜索/ })
    const toggle = await screen.findByRole('switch', { name: '启用外部网页搜索' })
    fireEvent.click(toggle)
    const saveButton = await screen.findByRole('button', { name: /保存设置/ })
    fireEvent.click(saveButton)
    expect(await screen.findByText('没有管理网页搜索设置的权限')).toBeTruthy()
  })
})
