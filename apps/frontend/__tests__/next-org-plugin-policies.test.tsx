/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.6/9.7 —— 插件策略组件与页面装配测试。
 *
 * 覆盖（spec「组织插件目录与插件策略治理」Requirement 2 + tasks 9.5/9.6/9.7）：
 * - 工作台底册：模板卡/组织副本表/激活状态徽标渲染，加载骨架与错误重试；
 * - copy/activate 管理动作仅组织 owner/admin（usePolicyBundleManageGate）可见，
 *   非 owner/admin 时按钮物理不渲染且写请求零发出（RL-06）；
 * - copy 闭环：提交 → 影响预览（只读回显角色/操作/权限/目标计数）→ 审批 →
 *   一次性凭据 → 最终确认，写请求序列正确（RL-06 提交 ≠ 生效表达）；
 * - 无审批必需（disable）分支：直接签发凭据并最终确认；
 * - 页面装配（tasks 9.7）：plugin_install:view 整页守卫——无权限/无组织整页不渲染
 *   且零请求，授权后挂载工作台并发出列表请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { PluginPolicyWorkspace } from '@/components/next/org-plugin/PluginPolicyWorkspace'
import NextOrgPluginPoliciesPage from '@/app/(next)/next/organization/plugin-policies/page'

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function setAuth(
  permissions: string[],
  role = 'org_admin',
  currentOrganizationId: number | null = 1,
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations:
        currentOrganizationId === null
          ? []
          : [{ id: 1, name: '北极星研发部', slug: 'northstar', role }],
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

const ORG_ADMIN_PERMS = [
  'plugin_install:view',
  'plugin_change_request:view',
  'plugin_change_request:manage',
  'plugin_change_request:approve',
]
const MEMBER_PERMS = ['plugin_install:view']

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------

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
  body: Record<string, unknown> | null
}

const POLICY_SUMMARY = {
  action: 'copy',
  bundleId: 'org-copy-1',
  rolesAffected: ['org_admin'],
  operationsAffected: ['plugin:install'],
  permissionKeysAffected: ['plugin_install:manage'],
  addedTargets: 5,
  removedTargets: 0,
  bounded: true,
}

function installFetchRouter(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const approvedUids = new Set<string>()
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const url = new URL(rawUrl.replace(API_PREFIX, 'http://localhost:3333'))
    const p = url.pathname.replace(/^\/organizations\/\d+/, '')
    records.push({ method, pathname: p, body })

    if (p === '/plugin-policy-bundles' && method === 'GET') {
      return jsonResponse(200, {
        data: {
          templates: [
            {
              templateId: 'admin-managed',
              templateVersion: 1,
              titleZh: '管理员全权管理',
              descriptionZh: '全部插件管理动作仅组织管理员可执行；成员只读。',
            },
            {
              templateId: 'pm-enabled',
              templateVersion: 1,
              titleZh: '项目经理可管理',
              descriptionZh: '项目经理与组织管理员可执行插件管理动作；成员只读。',
            },
            {
              templateId: 'member-readonly',
              templateVersion: 1,
              titleZh: '成员只读',
              descriptionZh: '组织成员只能浏览插件目录与安装状态，管理动作关闭。',
            },
          ],
          orgCopies: [
            {
              bundleId: 'org-copy-1',
              version: 1,
              sourceTemplateId: 'admin-managed',
              sourceTemplateVersion: 1,
              descriptionZh: '管理员全权管理（组织副本 v1）',
              documentDigest: 'doc-digest-1',
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          activation: { bundleId: 'org-copy-1', activeVersion: 1, status: 'active', revision: 3 },
        },
        meta: { total: 1 },
      })
    }

    if (p === '/plugin-policy-bundles/copy' && method === 'POST') {
      return jsonResponse(202, {
        data: {
          requestUid: 'pol-req-1',
          bundleId: 'org-copy-2',
          digest: 'digest-copy-2',
          summary: { ...POLICY_SUMMARY, action: 'copy', bundleId: 'org-copy-2' },
        },
      })
    }

    const activationMatch = p.match(/^\/plugin-policy-bundles\/([^/]+)\/activation$/)
    if (activationMatch && method === 'POST') {
      const action = typeof body?.action === 'string' ? body.action : 'enable'
      return jsonResponse(202, {
        data: {
          requestUid: 'pol-req-2',
          summary: {
            ...POLICY_SUMMARY,
            action,
            bundleId: activationMatch[1] as string,
          },
        },
      })
    }

    const impactMatch = p.match(/^\/plugin-policy-bundles\/changes\/([^/]+)\/impact$/)
    if (impactMatch && method === 'GET') {
      const uid = impactMatch[1] as string
      const disableFlow = uid === 'pol-req-2'
      return jsonResponse(200, {
        data: {
          summary: { ...POLICY_SUMMARY, action: disableFlow ? 'disable' : 'copy' },
          state: approvedUids.has(uid) ? 'approved' : 'pending-approval',
          approvalRequired: !disableFlow,
          approvedBy: approvedUids.has(uid) ? 'u2' : null,
          expiresAt: '2026-10-01T00:00:00.000Z',
        },
      })
    }

    const approveMatch = p.match(/^\/plugin-change-requests\/([^/]+)\/approve$/)
    if (approveMatch && method === 'POST') {
      approvedUids.add(approveMatch[1] as string)
      return jsonResponse(200, { data: { id: approveMatch[1], state: 'approved' } })
    }

    const handleMatch = p.match(/^\/plugin-change-requests\/([^/]+)\/confirm-handle$/)
    if (handleMatch && method === 'POST') {
      return jsonResponse(200, {
        data: {
          handle: `handle-${handleMatch[1]}`,
          expiresAt: '2026-10-01T00:00:00.000Z',
        },
      })
    }

    const confirmMatch = p.match(/^\/plugin-change-requests\/([^/]+)\/confirm$/)
    if (confirmMatch && method === 'POST') {
      return jsonResponse(200, { data: { id: confirmMatch[1], state: 'applied' } })
    }

    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${p}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PluginPolicyWorkspace />
    </QueryClientProvider>,
  )
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NextOrgPluginPoliciesPage />
    </QueryClientProvider>,
  )
}

function settle(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeRecords(records: RequestRecord[]): string[] {
  return records.filter((r) => r.method === 'POST').map((r) => r.pathname)
}

beforeEach(() => {
  useAuthStore.setState({ permissions: [], currentOrganizationId: null })
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('PluginPolicyWorkspace：策略包底册与激活状态（tasks 9.5）', () => {
  test('owner/admin：骨架 → 模板/组织副本/激活徽标渲染，加载过程零写请求', async () => {
    setAuth(ORG_ADMIN_PERMS)
    const { records } = installFetchRouter()
    renderWorkspace()

    expect(document.querySelector('[data-policy-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-policy-bundle-list]')).not.toBeNull())
    expect(screen.getByText('管理员全权管理')).toBeInTheDocument()
    expect(screen.getByText('项目经理可管理')).toBeInTheDocument()
    expect(screen.getByText('成员只读')).toBeInTheDocument()
    // 激活徽标（生效中 + 副本与版本）
    expect(document.querySelector('[data-policy-activation-status="active"]')?.textContent).toBe(
      '生效中 · org-copy-1 v1',
    )
    expect(document.querySelector('[data-policy-bundle-row="org-copy-1@1"]')).not.toBeNull()
    // owner/admin：管理动作可见
    expect(document.querySelector('[data-policy-template-copy="admin-managed"]')).not.toBeNull()
    expect(document.querySelector('[data-policy-activation-action]')).not.toBeNull()
    expect(writeRecords(records)).toEqual([])
  })

  test('错误态：列表失败渲染错误卡并可重试', async () => {
    setAuth(ORG_ADMIN_PERMS)
    const fetchMock: typeof fetch = async () =>
      jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-policy-error]')).not.toBeNull())
    expect(screen.getByText('插件策略加载失败')).toBeInTheDocument()
  })
})

describe('PluginPolicyWorkspace：管理动作门禁（RL-06）', () => {
  test('非 owner/admin（member 角色）：复制/启用/停用按钮物理不渲染，写请求零发出', async () => {
    setAuth(MEMBER_PERMS, 'member')
    const { records } = installFetchRouter()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-policy-bundle-list]')).not.toBeNull())
    expect(document.querySelector('[data-policy-template-copy]')).toBeNull()
    expect(document.querySelector('[data-policy-activation-action]')).toBeNull()
    // 操作列表头也不渲染（canManage=false 时无「操作」列）
    expect(screen.queryByText('操作')).toBeNull()
    // 底册仍只读可见
    expect(document.querySelector('[data-policy-bundle-row="org-copy-1@1"]')).not.toBeNull()
    await settle()
    expect(writeRecords(records)).toEqual([])
  })
})

describe('PluginPolicyWorkspace：copy/activate 统一变更闭环（RL-06）', () => {
  test('copy：提交 → 影响预览回显 → 审批 → 一次性凭据 → 最终确认', async () => {
    setAuth(ORG_ADMIN_PERMS)
    const { records } = installFetchRouter()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-policy-bundle-list]')).not.toBeNull())

    fireEvent.click(
      document.querySelector('[data-policy-template-copy="admin-managed"]') as Element,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-policy-activation-dialog]')).not.toBeNull(),
    )
    expect(screen.getByText('复制模板「管理员全权管理」为组织副本')).toBeInTheDocument()

    // compose → 提交（202 未生效）
    fireEvent.click(document.querySelector('[data-policy-flow-submit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-impact]')).not.toBeNull())
    // 影响预览只读回显（角色/操作/权限/目标计数）
    await waitFor(() =>
      expect(document.querySelector('[data-policy-impact-roles]')?.textContent).toBe('org_admin'),
    )
    expect(
      document.querySelector('[data-policy-impact-roles]')?.parentElement?.textContent,
    ).toContain('org_admin')
    expect(screen.getByText('受影响操作')).toBeInTheDocument()
    expect(document.body.textContent).toContain('plugin_install:manage')
    expect(document.body.textContent).toContain('尚未生效')
    // approvalRequired=true：先审批
    await waitFor(() => expect(document.querySelector('[data-policy-flow-approve]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-policy-flow-approve]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-policy-flow-issue-handle]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-policy-flow-issue-handle]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-confirm]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-policy-flow-confirm]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-applied]')).not.toBeNull())
    expect(document.body.textContent).toContain('已生效')

    expect(writeRecords(records)).toEqual([
      '/plugin-policy-bundles/copy',
      '/plugin-change-requests/pol-req-1/approve',
      '/plugin-change-requests/pol-req-1/confirm-handle',
      '/plugin-change-requests/pol-req-1/confirm',
    ])
  })

  test('disable（无审批必需）：提交 → 凭据 → 确认即可生效', async () => {
    setAuth(ORG_ADMIN_PERMS)
    const { records } = installFetchRouter()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-policy-bundle-list]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-policy-activation-action="disable"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-policy-activation-dialog]')).not.toBeNull(),
    )
    expect(screen.getByText('停用策略版本 org-copy-1 v1')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-policy-flow-submit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-impact]')).not.toBeNull())
    await waitFor(() =>
      expect(document.querySelector('[data-policy-flow-issue-handle]')).not.toBeNull(),
    )
    // 无审批必需：审批按钮不存在
    expect(document.querySelector('[data-policy-flow-approve]')).toBeNull()
    fireEvent.click(document.querySelector('[data-policy-flow-issue-handle]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-confirm]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-policy-flow-confirm]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-applied]')).not.toBeNull())
    expect(writeRecords(records)).toEqual([
      '/plugin-policy-bundles/org-copy-1/activation',
      '/plugin-change-requests/pol-req-2/confirm-handle',
      '/plugin-change-requests/pol-req-2/confirm',
    ])
  })

  test('审批按钮按 plugin_change_request:approve 权限显隐：无该权限显示等待文案', async () => {
    setAuth(['plugin_install:view', 'plugin_change_request:manage'], 'org_admin')
    const { records } = installFetchRouter()
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-policy-bundle-list]')).not.toBeNull())
    fireEvent.click(
      document.querySelector('[data-policy-template-copy="admin-managed"]') as Element,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-policy-activation-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-policy-flow-submit]') as Element)
    await waitFor(() => expect(document.querySelector('[data-policy-flow-impact]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-policy-flow-approve]')).toBeNull())
    expect(document.body.textContent).toContain('需由另一位具备审批权限的管理员完成审批与确认')
    expect(writeRecords(records)).toEqual(['/plugin-policy-bundles/copy'])
  })
})

describe('NextOrgPluginPoliciesPage：/next/organization/plugin-policies 整页守卫（tasks 9.7）', () => {
  test('具备 plugin_install:view：工作台挂载、标题回显、列表请求发出', async () => {
    setAuth(ORG_ADMIN_PERMS)
    const { records } = installFetchRouter()
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-policy-workspace]')).not.toBeNull())
    expect(screen.getByRole('heading', { name: '插件策略' })).toBeInTheDocument()
    await settle()
    expect(records.some((r) => r.pathname === '/plugin-policy-bundles' && r.method === 'GET')).toBe(
      true,
    )
  })

  test('无 plugin_install:view：整页不渲染（不暴露入口存在性），零业务请求', async () => {
    setAuth(['plugin_registry:view'])
    const { records } = installFetchRouter()
    renderPage()
    expect(document.querySelector('[data-policy-workspace]')).toBeNull()
    expect(document.body.textContent?.trim()).toBe('')
    await settle()
    expect(records).toHaveLength(0)
  })

  test('未选择组织：整页不渲染且零请求', async () => {
    setAuth(ORG_ADMIN_PERMS, 'org_admin', null)
    const { records } = installFetchRouter()
    renderPage()
    expect(document.body.textContent?.trim()).toBe('')
    await settle()
    expect(records).toHaveLength(0)
  })
})
