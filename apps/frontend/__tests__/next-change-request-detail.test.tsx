/**
 * v3-ui-next-risk-change-domains W2 · tasks 2.6 —— 变更详情状态机展示与
 * 审计评论区接线测试（页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「变更请求受控审批流与全生命周期闭环」/ design Decision 5.3）：
 * - 详情元数据正确展示（CR 编码/标题/状态/申请人/各阶段时间戳域）；
 * - 草稿/已提交/已批准/已实施/已拒绝各态的状态机指示条动态映射（含分支态标记）；
 * - 普通成员（仅 view）只读态：审批决策控件物理隐藏 + 「审批处理中」指示；
 * - 底部评论区正确绑定 change_request 实体（列表请求参数与发言 POST 载荷断言）。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeRequest } from '@/lib/api/change-requests'
import type { CommentWithAuthor } from '@aiproj/types'
import NextProjectChangeRequestDetailPage from '@/app/(next)/next/projects/[id]/change-requests/[crId]/page'
import { useAuthStore } from '@/stores/auth-store'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
  API_PREFIX,
} from './helpers/chart-gallery-network'

const paramsMock = vi.hoisted(() => ({
  value: { id: '42', crId: '7' } as { id: string; crId: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/change-requests/7',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

function setAuth(permissions: string[], userId = 1) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

function makeCr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 7,
    crCode: 'CR-2026-007',
    organizationId: 1,
    projectId: 42,
    title: '增加移动端扫码登录模块',
    description: '在现有账号体系外补充扫码登录通道',
    changeType: 'scope',
    status: 'draft',
    priority: 'high',
    requesterId: 1,
    approverId: null,
    requestedBy: 1,
    reviewedBy: null,
    impactSummary: {
      scope: '新增登录入口',
      schedule: '整体延期 5 天',
      resources: '',
      cost: '',
      risks: '',
      assumptions: '基于当前排程已确认',
    },
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: null,
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
    currentImpactAnalysisId: null,
    approveRefAnalysisId: null,
    impactAnalysisConfirmStatus: null,
    ...overrides,
  }
}

function makeComment(overrides: Partial<CommentWithAuthor> = {}): CommentWithAuthor {
  return {
    id: 101,
    organizationId: 1,
    projectId: 42,
    entityType: 'change_request',
    entityId: 7,
    authorId: 1,
    author: { id: 1, fullName: '王启明', email: 'pm@example.com' },
    body: '建议补充核心数据库备份回滚方案',
    bodyFormat: 'plain',
    parentId: null,
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: '2026-09-04T09:00:00.000Z',
    updatedAt: '2026-09-04T09:00:00.000Z',
    isDeleted: false,
    isEdited: false,
    isResolved: false,
    replyCount: 0,
    mentions: [],
    replies: [],
    ...overrides,
  }
}

const emptyAnalysisMeta = { total: 0, page: 1, perPage: 10, totalPages: 1 }

function detailBackend(
  cr: ChangeRequest,
  comments: CommentWithAuthor[] = [],
  options: {
    members?: boolean
    capture?: Array<{ method: string; url: string; body: string | null }>
  } = {},
) {
  return (path: string, method: string, body?: string | null): Response | null => {
    options.capture?.push({ method, url: path, body: body ?? null })
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (path === '/projects/42/members' && method === 'GET' && options.members !== false) {
      return jsonResponse(200, {
        data: [
          {
            id: 1,
            projectId: 42,
            userId: 1,
            projectRoleId: null,
            isActive: true,
            user: {
              id: 1,
              fullName: '王启明',
              email: 'pm@example.com',
              initials: '王',
              isActive: true,
            },
          },
          {
            id: 2,
            projectId: 42,
            userId: 2,
            projectRoleId: null,
            isActive: true,
            user: {
              id: 2,
              fullName: '李思远',
              email: 'li@example.com',
              initials: '李',
              isActive: true,
            },
          },
        ],
      })
    }
    if (path === '/change-requests/7' && method === 'GET') {
      return jsonResponse(200, { data: cr })
    }
    if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
      return jsonResponse(200, { data: [], meta: emptyAnalysisMeta })
    }
    if (path.startsWith('/projects/42/comments') && method === 'GET') {
      return jsonResponse(200, {
        data: comments,
        meta: { total: comments.length, page: 1, perPage: 50, totalPages: 1 },
      })
    }
    if (path === '/projects/42/comments' && method === 'POST') {
      return jsonResponse(201, {
        data: makeComment({ id: 999, body: JSON.parse(body ?? '{}').body }),
      })
    }
    return null
  }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/** 记录请求体（POST 载荷断言）的 fetch 路由。 */
function installBodyFetchRouter(
  route: (path: string, method: string, body: string | null) => Response | null,
): Array<{ method: string; url: string; body: string | null }> {
  const records: Array<{ method: string; url: string; body: string | null }> = []
  const fetchMock: typeof fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    records.push({ method, url: rawUrl.replace(API_PREFIX, ''), body })
    const matched = route(rawUrl.replace(API_PREFIX, ''), method, body)
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${rawUrl}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

beforeEach(() => {
  paramsMock.value = { id: '42', crId: '7' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setAuth([
    'change_request:view',
    'change_request:create',
    'change_impact:view',
    'comment:view',
    'comment:create',
  ])
})

afterEach(() => {
  resetFetchRouter()
})

describe('详情元数据与六维摘要展示', () => {
  test('草稿态变更完整渲染头部元数据与初始六维影响摘要', async () => {
    installFetchRouter(detailBackend(makeCr()))
    renderPage(<NextProjectChangeRequestDetailPage />)

    expect(await screen.findByText('增加移动端扫码登录模块')).toBeInTheDocument()
    expect(document.querySelector('[data-cr-detail-code]')?.textContent).toContain('CR-2026-007')
    expect(document.querySelector('[data-cr-status="draft"]')?.textContent).toContain('草稿')
    expect(document.querySelector('[data-cr-detail-type]')?.textContent).toContain('范围')
    expect(document.querySelector('[data-cr-priority="high"]')?.textContent).toContain('高')
    // 申请人名经成员映射解析
    await waitFor(() => {
      const metaEntries = document.querySelectorAll('[data-cr-meta]')
      expect(metaEntries.length).toBeGreaterThan(0)
    })
    expect(screen.getByText('王启明')).toBeInTheDocument()
    // 初始六维影响摘要
    expect(screen.getByText('新增登录入口')).toBeInTheDocument()
    expect(screen.getByText('整体延期 5 天')).toBeInTheDocument()
    expect(screen.getByText('基于当前排程已确认')).toBeInTheDocument()
    // 返回项目空间动线
    expect(screen.getByLabelText('返回项目主空间')).toHaveAttribute('href', '/next/projects/42')
    expect(document.querySelector('[data-cr-detail-back-list]')).not.toBeNull()
  })

  test('非法 crId：零网络请求渲染中性 404 空态（RL-05）', async () => {
    paramsMock.value = { id: '42', crId: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderPage(<NextProjectChangeRequestDetailPage />)
    expect(await screen.findByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(records).toHaveLength(0)
  })
})

describe('全生命周期状态机指示条动态映射', () => {
  async function renderWithStatus(cr: Partial<ChangeRequest>) {
    installFetchRouter(detailBackend(makeCr(cr)))
    renderPage(<NextProjectChangeRequestDetailPage />)
    await screen.findByText('增加移动端扫码登录模块')
    return document.querySelector('[data-cr-lifecycle]')
  }

  test('草稿态：主轴第 1 节点 current', async () => {
    await renderWithStatus({ status: 'draft' })
    const node = document.querySelector('[data-cr-lifecycle-node="draft"]')
    expect(node?.getAttribute('data-cr-lifecycle-node-state')).toBe('current')
    expect(
      document.querySelector('[data-cr-lifecycle]')?.getAttribute('data-cr-lifecycle-status'),
    ).toBe('draft')
  })

  test('已批准态：approved 前节点 reached、approved current、后续 muted', async () => {
    const track = await renderWithStatus({
      status: 'approved',
      submittedAt: '2026-09-05T02:30:00.000Z',
      approvedAt: '2026-09-06T08:00:00.000Z',
      approverId: 2,
      reviewedBy: 2,
      decisionReason: '评估后资源可协调',
      conditions: '批准后 3 日内补演练记录',
    })
    expect(track?.getAttribute('data-cr-lifecycle-status')).toBe('approved')
    expect(
      document
        .querySelector('[data-cr-lifecycle-node="draft"]')
        ?.getAttribute('data-cr-lifecycle-node-state'),
    ).toBe('reached')
    expect(
      document
        .querySelector('[data-cr-lifecycle-node="approved"]')
        ?.getAttribute('data-cr-lifecycle-node-state'),
    ).toBe('current')
    expect(
      document
        .querySelector('[data-cr-lifecycle-node="implemented"]')
        ?.getAttribute('data-cr-lifecycle-node-state'),
    ).toBe('muted')
    // 历史决策回显
    expect(screen.getByText('评估后资源可协调')).toBeInTheDocument()
    expect(screen.getByText('批准后 3 日内补演练记录')).toBeInTheDocument()
  })

  test('已实施态：implemented 节点 current，前序节点 reached', async () => {
    await renderWithStatus({
      status: 'implemented',
      submittedAt: '2026-09-05T02:30:00.000Z',
      approvedAt: '2026-09-06T08:00:00.000Z',
      implementedAt: '2026-09-09T10:00:00.000Z',
    })
    expect(
      document
        .querySelector('[data-cr-lifecycle-node="implemented"]')
        ?.getAttribute('data-cr-lifecycle-node-state'),
    ).toBe('current')
    expect(
      document
        .querySelector('[data-cr-lifecycle-node="approved"]')
        ?.getAttribute('data-cr-lifecycle-node-state'),
    ).toBe('reached')
  })

  test('已拒绝态：渲染分支终止标记（流程终止）', async () => {
    await renderWithStatus({
      status: 'rejected',
      submittedAt: '2026-09-05T02:30:00.000Z',
      decisionReason: '缺少备份回滚方案',
    })
    expect(document.querySelector('[data-cr-lifecycle-branch="rejected"]')?.textContent).toContain(
      '流程终止',
    )
    // 主轴节点不再标记 current（全部 muted）
    expect(
      document
        .querySelector('[data-cr-lifecycle-node="draft"]')
        ?.getAttribute('data-cr-lifecycle-node-state'),
    ).toBe('muted')
  })

  test('草稿态请求人本人可提交审批（POST /change-requests/7/submit）', async () => {
    const capture = installBodyFetchRouter(detailBackend(makeCr()))
    renderPage(<NextProjectChangeRequestDetailPage />)
    await screen.findByText('增加移动端扫码登录模块')
    const submitButton = document.querySelector('[data-cr-console-submit]') as HTMLButtonElement
    expect(submitButton).not.toBeNull()
    fireEvent.click(submitButton)
    await waitFor(() => {
      expect(
        capture.some(
          (record) => record.method === 'POST' && record.url === '/change-requests/7/submit',
        ),
      ).toBe(true)
    })
  })
})

describe('普通成员只读态与审批控制台物理隐藏', () => {
  test('仅具备 view 权限的成员：无审批控件，仅见「审批处理中」只读指示', async () => {
    setAuth(['change_request:view', 'change_impact:view', 'comment:view'])
    installFetchRouter(
      detailBackend(makeCr({ status: 'submitted', submittedAt: '2026-09-05T02:30:00.000Z' })),
    )
    renderPage(<NextProjectChangeRequestDetailPage />)
    await screen.findByText('增加移动端扫码登录模块')

    expect(document.querySelector('[data-cr-console-readonly]')?.textContent).toContain(
      '审批处理中',
    )
    expect(document.querySelector('[data-cr-console-approve]')).toBeNull()
    expect(document.querySelector('[data-cr-console-reject]')).toBeNull()
    expect(document.querySelector('[data-cr-console-return]')).toBeNull()
    expect(document.querySelector('[data-cr-console-reason]')).toBeNull()
    // 编辑入口对非请求人/非草稿隐藏
    expect(document.querySelector('[data-cr-detail-edit]')).toBeNull()
  })
})

describe('结构化审计评论区接线（entityType=change_request）', () => {
  test('评论列表绑定变更实体并渲染讨论记录', async () => {
    const capture: Array<{ method: string; url: string; body: string | null }> = []
    installFetchRouter(detailBackend(makeCr(), [makeComment()], { capture }))
    renderPage(<NextProjectChangeRequestDetailPage />)
    await screen.findByText('增加移动端扫码登录模块')

    // 列表请求携带 entityType=change_request 与变更 ID
    await waitFor(() => {
      const listCall = capture.find(
        (record) => record.method === 'GET' && record.url.includes('/projects/42/comments'),
      )
      expect(listCall).toBeDefined()
      expect(listCall!.url).toContain('entityType=change_request')
      expect(listCall!.url).toContain('entityId=7')
    })
    expect(await screen.findByText('建议补充核心数据库备份回滚方案')).toBeInTheDocument()
    // 评论作者回显（避免与申请人元数据同名歧义 → 锚定评论卡）
    expect(document.querySelector('[data-cr-comment-card="101"]')?.textContent).toContain('王启明')
    expect(document.querySelector('[data-cr-comments-count]')?.textContent).toContain('1')
  })

  test('具备 comment:create 成员可发表跟进评论（POST 载荷实体绑定）', async () => {
    const capture = installBodyFetchRouter(detailBackend(makeCr()))
    renderPage(<NextProjectChangeRequestDetailPage />)
    await screen.findByText('增加移动端扫码登录模块')

    const composer = document.querySelector('[data-cr-comments-composer]') as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '补充回滚演练记录链接' } })
    fireEvent.click(document.querySelector('[data-cr-comments-send]')!)
    await waitFor(() => {
      const post = capture.find(
        (record) => record.method === 'POST' && record.url === '/projects/42/comments',
      )
      expect(post).toBeDefined()
      const payload = JSON.parse(post!.body ?? '{}') as {
        entityType: string
        entityId: number
        body: string
      }
      expect(payload.entityType).toBe('change_request')
      expect(payload.entityId).toBe(7)
      expect(payload.body).toBe('补充回滚演练记录链接')
    })
  })

  test('无 comment:create 权限：输入区隐藏并提示', async () => {
    setAuth(['change_request:view', 'change_request:create', 'comment:view'])
    installFetchRouter(detailBackend(makeCr()))
    renderPage(<NextProjectChangeRequestDetailPage />)
    await screen.findByText('增加移动端扫码登录模块')
    await waitFor(() => {
      expect(screen.getByText(/你没有评论权限/)).toBeInTheDocument()
    })
    expect(document.querySelector('[data-cr-comments-composer]')).toBeNull()
  })
})
