/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.3 —— 插件目录工作台组件测试。
 *
 * 覆盖（spec「组织插件目录与插件策略治理」+ tasks 9.2/9.3）：
 * - release 底册渲染与状态徽标回显（双通道），状态筛选重查、加载骨架/空态；
 * - 动作权限矩阵：review-only 只见「批准」；无 manage/rollback 时不渲染任何动作
 *   （**不存在于 DOM，非 disabled**——RL-06 不泄露能力存在性）；
 * - 审批闭环：批准 → 提交 → 另一位管理员审批 → 一次性句柄 → 最终确认（写请求序列）；
 * - 回滚阻断项存在即不可提交；无阻断回滚可完整提交；
 * - 只读断言：筛选/排序/开抽屉交互全程零写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { PluginDirectoryWorkspace } from '@/components/next/org-plugin/PluginDirectoryWorkspace'
import type {
  DirectoryReleaseDetail,
  DirectoryReleaseListItem,
  DirectoryRollbackDiff,
} from '@/lib/api/plugin-directory'

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function setAuth(permissions: string[], role = 'org_admin') {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role }],
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
  })
}

const VIEWER_PERMS = ['plugin_registry:view']
const REVIEWER_PERMS = ['plugin_registry:view', 'plugin_registry:review']
const FULL_GOVERNOR_PERMS = [
  'plugin_registry:view',
  'plugin_registry:review',
  'plugin_registry:manage',
  'plugin_registry:rollback',
  'plugin_change_request:view',
  'plugin_change_request:manage',
  'plugin_change_request:approve',
]

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
  query: URLSearchParams
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (
    pathname: string,
    query: URLSearchParams,
    method: string,
    body: Record<string, unknown> | null,
  ) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
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
    const pathname = url.pathname
    records.push({ method, pathname, query: url.searchParams, body })
    const matched = route(pathname, url.searchParams, method, body)
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${pathname}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

// ---------------------------------------------------------------------------
// 目录夹具
// ---------------------------------------------------------------------------

function listItem(overrides: Partial<DirectoryReleaseListItem>): DirectoryReleaseListItem {
  return {
    releaseId: 'rel-1001',
    pluginIdentity: 'acme.widget',
    version: '2.1.0',
    status: 'pending_review',
    createdAt: '2026-09-01T00:00:00.000Z',
    compatibilityAllowed: true,
    activeInstallationCount: 0,
    uninstalledInstallationCount: 0,
    fixtureOnly: false,
    ...overrides,
  }
}

function detailOf(
  item: DirectoryReleaseListItem,
  overrides: Partial<DirectoryReleaseDetail> = {},
): DirectoryReleaseDetail {
  return {
    ...item,
    manifestDigestPresent: true,
    compatibility: {
      allowed: item.compatibilityAllowed,
      digest: 'sha256:0123456789abcdef0123456789abcdef',
      reasonCodes: [],
    },
    review: null,
    impact: {
      activeCount: item.activeInstallationCount,
      uninstalledCount: item.uninstalledInstallationCount,
    },
    ...overrides,
  }
}

function makeStore() {
  const releases: DirectoryReleaseListItem[] = [
    listItem({
      releaseId: 'rel-1001',
      pluginIdentity: 'acme.widget',
      version: '2.1.0',
      status: 'pending_review',
      createdAt: '2026-09-01T00:00:00.000Z',
    }),
    listItem({
      releaseId: 'rel-1002',
      pluginIdentity: 'acme.widget',
      version: '2.0.0',
      status: 'approved',
      activeInstallationCount: 3,
      uninstalledInstallationCount: 1,
      fixtureOnly: true,
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
    listItem({
      releaseId: 'rel-1003',
      pluginIdentity: 'other.tool',
      version: '1.0.0',
      status: 'draft',
      createdAt: '2026-07-01T00:00:00.000Z',
    }),
    listItem({
      releaseId: 'rel-1004',
      pluginIdentity: 'acme.widget',
      version: '1.5.0',
      status: 'withdrawn',
      createdAt: '2026-06-01T00:00:00.000Z',
    }),
    listItem({
      releaseId: 'rel-1005',
      pluginIdentity: 'blocked.tool',
      version: '0.9.0',
      status: 'approved',
      createdAt: '2026-05-01T00:00:00.000Z',
    }),
  ]
  const affectedByRelease: Record<string, unknown[]> = {
    'rel-1002': [
      {
        id: 'inst-1',
        pluginId: 'acme.widget',
        version: '2.0.0',
        status: 'enabled',
        installedAt: '2026-08-02T00:00:00.000Z',
        uninstalledAt: null,
      },
    ],
  }
  const changeRequests: Record<string, unknown>[] = [
    {
      id: 'cr-1',
      organizationId: '1',
      projectId: null,
      kind: 'registry-release-change',
      state: 'applied',
      pluginId: 'acme.widget',
      requestedBy: 'u2',
      targetRevision: '1',
      diff: { kind: 'registry-release-change', pluginId: 'acme.widget' },
      diffDigest: 'diff-digest-1',
      permissionDigest: '',
      compatibilityDigest: '',
      approvalRequired: true,
      approvedBy: 'u3',
      rowVersion: 1,
      expiresAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
  ]
  const changeRequestsFor = (pluginId: string | null) =>
    pluginId ? changeRequests.filter((r) => r.pluginId === pluginId) : changeRequests

  let changeSeq = 0
  const createdRequests: string[] = []

  const rollbackDiff = (releaseId: string, blocked: boolean): DirectoryRollbackDiff => ({
    currentReleaseId: 'rel-1002',
    targetReleaseId: releaseId,
    currentVersion: '2.1.0',
    targetVersion: '2.0.0',
    manifestDigestBefore: 'before-manifest',
    manifestDigestAfter: 'after-manifest',
    packageDigestBefore: null,
    packageDigestAfter: null,
    compatibilityDigestBefore: null,
    compatibilityDigestAfter: null,
    permissionDelta: { added: [], removed: [], unchanged: ['risk:view'] },
    blockingFindings: blocked
      ? (['rollback-target-incompatible'] as DirectoryRollbackDiff['blockingFindings'])
      : [],
    affectedActiveCount: blocked ? 0 : 3,
  })

  return {
    releases,
    route: (
      pathname: string,
      query: URLSearchParams,
      method: string,
      body: Record<string, unknown> | null,
    ): Response | null => {
      // 目录/变更流端点均挂在 /organizations/:organizationId 之下（组织隔离契约）
      const p = pathname.replace(/^\/organizations\/\d+/, '')
      // 列表（含状态/来源/排序筛选）
      if (p === '/plugin-directory/releases' && method === 'GET') {
        let rows = [...releases]
        const status = query.get('status')
        if (status) rows = rows.filter((r) => r.status === status)
        const fixtureOnly = query.get('fixtureOnly')
        if (fixtureOnly !== null) {
          rows = rows.filter((r) => r.fixtureOnly === (fixtureOnly === 'true'))
        }
        return jsonResponse(200, {
          data: rows,
          meta: { total: rows.length, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      // 详情
      const detailMatch = p.match(/^\/plugin-directory\/releases\/([^/]+)$/)
      if (detailMatch && method === 'GET') {
        const item = releases.find((r) => r.releaseId === detailMatch[1])
        if (!item) {
          return jsonResponse(404, {
            error: { code: 'RESOURCE_NOT_FOUND', message: '目录条目不存在' },
          })
        }
        return jsonResponse(200, {
          data: detailOf(item, {
            review:
              item.status === 'pending_review'
                ? null
                : {
                    latestCycleNumber: 2,
                    latestDecision: 'approved',
                    latestResolvedAt: '2026-08-05T00:00:00.000Z',
                  },
          }),
        })
      }
      // 受影响安装
      const affectedMatch = p.match(
        /^\/plugin-directory\/releases\/([^/]+)\/affected-installations$/,
      )
      if (affectedMatch && method === 'GET') {
        const releaseId = affectedMatch[1] as string
        const items = affectedByRelease[releaseId] ?? []
        return jsonResponse(200, {
          data: items,
          meta: { total: items.length, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      // 回滚预览（纯读）：rel-1005 命中阻断，其余干净
      const previewMatch = p.match(/^\/plugin-directory\/releases\/([^/]+)\/rollback-preview$/)
      if (previewMatch && method === 'GET') {
        const releaseId = previewMatch[1] as string
        if (releaseId === 'rel-1005') {
          return jsonResponse(200, { data: rollbackDiff(releaseId, true) })
        }
        return jsonResponse(200, { data: rollbackDiff(releaseId, false) })
      }
      // 统一变更流列表（变更集）
      if (p === '/plugin-change-requests' && method === 'GET') {
        const rows = changeRequestsFor(query.get('pluginId'))
        return jsonResponse(200, {
          data: rows,
          meta: { total: rows.length, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      // 创建目录管理变更请求（202 未生效）
      const createMatch = p.match(/^\/plugin-directory\/releases\/([^/]+)\/changes$/)
      if (createMatch && method === 'POST') {
        changeSeq += 1
        const uid = `req-${changeSeq}`
        createdRequests.push(uid)
        const action = (body?.action ?? '') as string
        return jsonResponse(202, {
          data: {
            requestUid: uid,
            state: 'pending-approval',
            approvalRequired: action !== 'disable',
            rollbackDiff: null,
          },
        })
      }
      // maker 审批
      const approveMatch = p.match(/^\/plugin-change-requests\/([^/]+)\/approve$/)
      if (approveMatch && method === 'POST') {
        return jsonResponse(200, { data: { id: approveMatch[1], state: 'approved' } })
      }
      // 句柄签发
      const handleMatch = p.match(/^\/plugin-change-requests\/([^/]+)\/confirm-handle$/)
      if (handleMatch && method === 'POST') {
        return jsonResponse(200, {
          data: { handle: `handle-${handleMatch[1]}`, expiresAt: '2026-10-01T00:00:00.000Z' },
        })
      }
      // 目录最终确认
      const confirmMatch = p.match(/^\/plugin-directory\/changes\/([^/]+)\/confirm$/)
      if (confirmMatch && method === 'POST') {
        return jsonResponse(200, { data: { success: true } })
      }
      return null
    },
    createdRequests,
  }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PluginDirectoryWorkspace />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ permissions: [], currentOrganizationId: null })
})

afterEach(() => {
  resetFetchRouter()
})

function waitForRows(count: number) {
  return waitFor(() =>
    expect(document.querySelectorAll('[data-plugin-release-row]')).toHaveLength(count),
  )
}

function writeMethods(records: { method: string }[]): string[] {
  return records.filter((r) => r.method !== 'GET').map((r) => r.method)
}

// ---------------------------------------------------------------------------

describe('PluginDirectoryWorkspace：底册渲染与状态徽标（tasks 9.2/9.3）', () => {
  test('具备 plugin_registry:view：骨架 → 底册行渲染，状态徽标/示例数据徽标/安装计数回显', async () => {
    setAuth(VIEWER_PERMS)
    const backend = makeStore()
    installFetchRouter(backend.route)
    renderWorkspace()

    expect(document.querySelector('[data-plugin-releases-skeleton]')).not.toBeNull()
    expect(
      document.querySelector('[data-plugin-releases-skeleton]')?.getAttribute('aria-busy'),
    ).toBe('true')
    await waitForRows(5)

    // 状态徽标（双通道文字；选项文本与徽标同文案，用 data 属性定位徽标）
    expect(
      document.querySelector('[data-plugin-release-status="pending_review"]')?.textContent,
    ).toBe('待审核')
    expect(document.querySelector('[data-plugin-release-status="approved"]')?.textContent).toBe(
      '已批准',
    )
    expect(document.querySelector('[data-plugin-release-status="draft"]')?.textContent).toBe('草稿')
    expect(document.querySelector('[data-plugin-release-status="withdrawn"]')?.textContent).toBe(
      '已撤回',
    )
    // 示例数据徽标（非 production 显示）与安装计数
    expect(document.querySelector('[data-plugin-fixture-badge]')).not.toBeNull()
    expect(screen.getByText('安装中 3 · 已卸载 1')).toBeInTheDocument()
    // 只读用户（无任何动作权限）：行本身无写出口
    expect(document.querySelector('[data-plugin-action]')).toBeNull()
  })

  test('状态筛选触发重查并收敛列表；重置后恢复全量（纯只读，零写请求）', async () => {
    setAuth(VIEWER_PERMS)
    const backend = makeStore()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitForRows(5)

    fireEvent.change(document.querySelector('[data-plugin-filter-status]') as Element, {
      target: { value: 'approved' },
    })
    await waitForRows(2)
    expect(document.querySelector('[data-plugin-filter-status]')).toHaveValue('approved')

    // 重置筛选 → 全量恢复
    fireEvent.click(document.querySelector('[data-plugin-filter-reset]') as Element)
    await waitForRows(5)
    expect(writeMethods(records)).toEqual([])
  })

  test('空态渲染（筛选后无匹配）', async () => {
    setAuth(VIEWER_PERMS)
    const backend = makeStore()
    installFetchRouter(backend.route)
    renderWorkspace()
    await waitForRows(5)
    fireEvent.change(document.querySelector('[data-plugin-filter-status]') as Element, {
      target: { value: 'rejected' },
    })
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-releases-empty]')).not.toBeNull(),
    )
  })
})

describe('PluginDirectoryWorkspace：动作权限矩阵（RL-06 不泄露能力）', () => {
  test('review-only：pending_review 行仅见「批准」，其余状态行无任何动作区且无 disabled 暗示', async () => {
    setAuth(REVIEWER_PERMS)
    const backend = makeStore()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitForRows(5)

    // 打开 pending_review 详情：仅「批准」渲染
    fireEvent.click(document.querySelector('[data-plugin-release-row="rel-1001"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-release-detail-drawer]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelector('[data-plugin-detail-body]')).not.toBeNull())
    const actions = document.querySelector('[data-plugin-detail-actions]')
    expect(actions).not.toBeNull()
    expect(document.querySelector('[data-plugin-action="approve"]')).not.toBeNull()
    expect(document.querySelector('[data-plugin-action="disable"]')).toBeNull()
    expect(document.querySelector('[data-plugin-action="restore"]')).toBeNull()
    expect(document.querySelector('[data-plugin-action="rollback"]')).toBeNull()
    // 无 disabled 暗示：DOM 中不存在任何禁用状态的动作品名
    expect(document.querySelector('[data-plugin-action][disabled]')).toBeNull()
    // 无 plugin_change_request:view：变更集不渲染
    expect(document.querySelector('[data-plugin-changeset-list]')).toBeNull()

    // 关闭后打开 approved 行：review-only 无任何可渲染动作
    fireEvent.click(document.querySelector('[data-plugin-detail-close]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-release-detail-drawer]')).toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-plugin-release-row="rel-1002"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-detail-identity]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-plugin-detail-actions]')).toBeNull()
    // 事实表/受影响清单（canManageReview）只读呈现
    expect(document.querySelector('[data-plugin-detail-active-count]')?.textContent).toBe('3')
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-affected-row="inst-1"]')).not.toBeNull(),
    )
    expect(writeMethods(records)).toEqual([])
  })

  test('full governor：approved 行显示 停止分发 + 回滚；pending_review 行无回滚（非 disabled，不存在）', async () => {
    setAuth(FULL_GOVERNOR_PERMS)
    const backend = makeStore()
    installFetchRouter(backend.route)
    renderWorkspace()
    await waitForRows(5)

    fireEvent.click(document.querySelector('[data-plugin-release-row="rel-1002"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-plugin-detail-body]')).not.toBeNull())
    const actions = document.querySelector('[data-plugin-detail-actions]')
    expect(actions).not.toBeNull()
    expect(document.querySelector('[data-plugin-action="disable"]')).not.toBeNull()
    expect(document.querySelector('[data-plugin-action="rollback"]')).not.toBeNull()
    expect(document.querySelector('[data-plugin-action="approve"]')).toBeNull()
    // 变更集可见（治理视野 + plugin_change_request:view）
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-changeset-list]')).not.toBeNull(),
    )
    expect(screen.getByText('目录变更')).toBeInTheDocument()
  })
})

describe('PluginDirectoryWorkspace：审批确认闭环（RL-06）', () => {
  test('批准 pending_review：提交 → 另一位管理员审批 → 最终确认，写请求序列正确', async () => {
    setAuth(FULL_GOVERNOR_PERMS)
    const backend = makeStore()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitForRows(5)

    fireEvent.click(document.querySelector('[data-plugin-release-row="rel-1001"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-plugin-detail-body]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-plugin-action="approve"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-dialog]')).not.toBeNull(),
    )
    expect(screen.getByText('批准此版本进入组织目录')).toBeInTheDocument()

    // compose → 提交（创建变更请求，202 未生效）
    fireEvent.click(document.querySelector('[data-plugin-action-submit]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-status]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('尚未生效')

    // maker-checker 审批 → 一次性句柄 → 最终确认
    fireEvent.click(document.querySelector('[data-plugin-action-approve]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-confirm]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-plugin-action-confirm]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-applied]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('已生效')

    const posts = records.filter((r) => r.method === 'POST')
    const postPaths = posts.map((p) => p.pathname.replace(/^\/organizations\/\d+/, ''))
    expect(postPaths).toEqual([
      '/plugin-directory/releases/rel-1001/changes',
      '/plugin-change-requests/req-1/approve',
      '/plugin-change-requests/req-1/confirm-handle',
      '/plugin-directory/changes/req-1/confirm',
    ])
    expect(backend.createdRequests).toEqual(['req-1'])
  })

  test('回滚阻断项存在即不可提交；干净回滚可走完提交', async () => {
    setAuth(FULL_GOVERNOR_PERMS)
    const backend = makeStore()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitForRows(5)

    // 阻断回滚（rel-1005）：预览返回 blocking finding → 提交禁用 + 阻断说明
    fireEvent.click(document.querySelector('[data-plugin-release-row="rel-1005"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-plugin-detail-body]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-plugin-action="rollback"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-dialog]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-rollback-blocking]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('目标版本与当前宿主不兼容，回滚会破坏运行时。')
    expect(
      (document.querySelector('[data-plugin-action-submit]') as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(document.querySelector('[data-plugin-action-cancel]') as Element)

    // 干净回滚（rel-1002 approved）：可提交；disable 动作 approvalRequired=false 走句柄直发
    fireEvent.click(document.querySelector('[data-plugin-detail-close]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-release-detail-drawer]')).toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-plugin-release-row="rel-1002"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-plugin-detail-body]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-plugin-action="disable"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-dialog]')).not.toBeNull(),
    )
    expect(
      (document.querySelector('[data-plugin-action-submit]') as HTMLButtonElement).disabled,
    ).toBe(false)
    fireEvent.click(document.querySelector('[data-plugin-action-submit]') as Element)
    // disable 的 approvalRequired=false → 直接签发句柄按钮
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-issue-handle]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-plugin-action-issue-handle]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-confirm]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-plugin-action-confirm]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-plugin-action-applied]')).not.toBeNull(),
    )
    const posts = records
      .filter((r) => r.method === 'POST')
      .map((p) => p.pathname.replace(/^\/organizations\/\d+/, ''))
    expect(posts).toContain('/plugin-directory/releases/rel-1002/changes')
    expect(posts).toContain('/plugin-change-requests/req-1/confirm-handle')
    expect(posts).toContain('/plugin-directory/changes/req-1/confirm')
  })
})
