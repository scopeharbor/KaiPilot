/**
 * v3-plugin-policy-bundles —— PluginPolicyManager 组件测试（任务 4.2）。
 *
 * 覆盖：
 * - 角色矩阵/影响 diff 展示与简体中文文案
 * - 权限不足动作完全隐藏（无 view 不渲染；view-only 无写按钮）
 * - 失败反馈 alert；确认前不变语义提示
 * - 可访问性（region/aria-label/table caption）；data-density 容器存在
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PluginPolicyManager } from '../components/plugin-policy/PluginPolicyManager'
import type { PluginPolicyListResponse } from '../lib/api/plugin-policy-bundles'

const hoisted = vi.hoisted(() => ({
  permissions: new Set<string>(['plugin_install:view']),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => hoisted.permissions.has(p),
  }),
}))

const listPolicies = vi.fn()
const copyPolicy = vi.fn()
const changeActivation = vi.fn()
const getImpact = vi.fn()

vi.mock('../lib/api/plugin-policy-bundles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/plugin-policy-bundles')>()
  return {
    ...actual,
    listPluginPolicies: (...a: unknown[]) => listPolicies(...a),
    copyPluginPolicy: (...a: unknown[]) => copyPolicy(...a),
    changePluginPolicyActivation: (...a: unknown[]) => changeActivation(...a),
    getPluginPolicyChangeImpact: (...a: unknown[]) => getImpact(...a),
  }
})

const LIST: PluginPolicyListResponse = {
  data: {
    templates: [
      {
        templateId: 'admin-managed',
        templateVersion: 1,
        titleZh: '管理员集中管控',
        descriptionZh: '仅管理员可管理与使用插件。',
      },
      {
        templateId: 'pm-enabled',
        templateVersion: 1,
        titleZh: '项目经理可用',
        descriptionZh: '项目经理项目内使用，成员只读。',
      },
      {
        templateId: 'member-readonly',
        templateVersion: 1,
        titleZh: '成员只读',
        descriptionZh: '成员仅查询。',
      },
    ],
    orgCopies: [
      {
        bundleId: 'org-copy.pm-enabled',
        version: 1,
        sourceTemplateId: 'pm-enabled',
        sourceTemplateVersion: 1,
        descriptionZh: '副本说明',
        documentDigest: 'abcd1234',
        createdAt: '2026-08-24T00:00:00.000Z',
      },
    ],
    activation: {
      bundleId: 'org-copy.pm-enabled',
      activeVersion: 1,
      status: 'active',
      revision: 3,
    },
  },
  meta: { total: 1 },
}

const IMPACT = {
  data: {
    summary: {
      action: 'copy' as const,
      bundleId: 'org-copy.member-readonly',
      rolesAffected: ['member', 'org_admin'],
      operationsAffected: ['execute', 'resolve-query'],
      permissionKeysAffected: ['plugin_install:manage'],
      addedTargets: 30,
      removedTargets: 0,
      bounded: true as const,
    },
    state: 'pending-approval',
    approvalRequired: true,
    approvedBy: null,
    expiresAt: '2026-08-25T00:00:00.000Z',
  },
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { Wrapper, client }
}

beforeEach(() => {
  hoisted.permissions = new Set(['plugin_install:view'])
  vi.clearAllMocks()
  listPolicies.mockResolvedValue(LIST)
})

afterEach(() => {
  cleanup()
})

describe('PluginPolicyManager', () => {
  it('无 view 权限：整体不渲染', () => {
    hoisted.permissions = new Set()
    const { Wrapper } = makeWrapper()
    const { container } = render(
      <Wrapper>
        <PluginPolicyManager organizationId={101} />
      </Wrapper>,
    )
    expect(container.querySelector('[data-testid="plugin-policy-manager"]')).toBeNull()
  })

  it('view-only：渲染模板中文说明与激活徽标，但完全隐藏复制/启停动作', async () => {
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <PluginPolicyManager organizationId={101} />
      </Wrapper>,
    )
    await waitFor(() => expect(screen.getByText('管理员集中管控')).toBeTruthy())
    // 激活状态 aria
    expect(screen.getByLabelText(/当前激活 生效中/)).toBeTruthy()
    // 写按钮不渲染
    expect(screen.queryByText('复制为组织副本')).toBeNull()
    expect(screen.queryByLabelText(/停用 org-copy/)).toBeNull()
    expect(screen.queryByLabelText(/启用 org-copy/)).toBeNull()
  })

  it('manage：可见复制与停用按钮、操作列', async () => {
    hoisted.permissions = new Set(['plugin_install:view', 'plugin_install:manage'])
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <PluginPolicyManager organizationId={101} />
      </Wrapper>,
    )
    await waitFor(() => expect(screen.getAllByLabelText(/从模板.*创建组织副本/).length).toBe(3))
    expect(screen.getByLabelText('停用 org-copy.pm-enabled v1')).toBeTruthy()
  })

  it('失败反馈 alert 与确认前不变语义提示', async () => {
    listPolicies.mockRejectedValue(new Error('网络不可用'))
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <PluginPolicyManager organizationId={101} />
      </Wrapper>,
    )
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('策略加载失败'))
    // 说明文案包含「确认后才生效」语义
    expect(screen.getByText(/确认后才会生效/)).toBeTruthy()
  })

  it('影响摘要子组件：角色/操作矩阵与确认前不变语义（简体中文）', async () => {
    const mod = await import('../components/plugin-policy/PluginPolicyManager')
    render(
      <mod.PolicyImpactSummaryPanel
        summary={IMPACT.data.summary}
        state="pending-approval"
        approvalRequired
        approvedBy={null}
      />,
    )
    const panel = screen.getByTestId('policy-impact-panel')
    expect(panel.getAttribute('aria-label')).toBe('变更影响摘要')
    expect(panel.textContent).toContain('受影响角色')
    expect(screen.getByTestId('policy-impact-roles').textContent).toContain('member')
    expect(panel.textContent).toContain('受影响操作')
    expect(panel.textContent).toContain('新增目标')
    expect(panel.textContent).toContain('确认前现有决策保持不变')
  })

  it('copy 成功后请求影响摘要并挂载面板', async () => {
    getImpact.mockResolvedValue(IMPACT)
    copyPolicy.mockResolvedValue({
      data: { requestUid: 'chg-1', bundleId: 'x', digest: 'd', summary: IMPACT.data.summary },
    })
    hoisted.permissions = new Set(['plugin_install:view', 'plugin_install:manage'])
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <PluginPolicyManager organizationId={101} />
      </Wrapper>,
    )
    const { fireEvent } = await import('@testing-library/react')
    await waitFor(() => expect(screen.getAllByLabelText(/从模板.*创建组织副本/).length).toBe(3))
    fireEvent.click(screen.getAllByLabelText(/从模板.*创建组织副本/)[0]!)
    await waitFor(() => expect(copyPolicy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getImpact).toHaveBeenCalledWith(101, 'chg-1'))
    // 影响摘要容器挂载（内容由 PolicyImpactSummaryPanel 子组件测试覆盖）
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-policy-manager').querySelector('[aria-busy]') ?? null,
      ).toBeTruthy(),
    )
  })

  it('可访问性与主题/密度容器语义', async () => {
    const { Wrapper } = makeWrapper()
    render(
      <Wrapper>
        <PluginPolicyManager organizationId={101} />
      </Wrapper>,
    )
    const root = screen.getByTestId('plugin-policy-manager')
    expect(root.getAttribute('aria-label')).toBe('插件策略包')
    expect(root.getAttribute('data-density')).toBe('comfortable')
    expect(screen.getByRole('table', { name: '组织副本列表' })).toBeTruthy()
    expect(screen.getByText(/组织策略副本版本列表/)).toBeTruthy()
  })
})
