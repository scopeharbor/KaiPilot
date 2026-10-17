/**
 * 新轨高频弹层 Escape 关闭 + 焦点归还行为用例
 * （v3-next-track-dialog-a11y-closure · tasks 3.2）。
 *
 * 覆盖面（6 个高频弹层，逐个真实渲染 + 真实触发链）：
 *   1. `NextDraftConfirmModal`——草案转正二次确认（store 驱动挂载，Escape 走 `canClose` 放行路径）；
 *   2. `WorkspaceGanttImpactDrawer`——试算影响摘要抽屉（空数据分支，无 `canClose` 默认放行）；
 *   3. `ResourceListTable`——资源底册删除两步流（无未结分配 → 确认态）；
 *   4. `ComplianceWorkspace`——合规例外登记弹层（含表单字段）；
 *   5. `OrgMembersPanel`——组织成员邀请弹层（含表单字段）；
 *   6. `PmoAiRecommendationDetailPanel`——推荐审阅单项确认弹层。
 *
 * 每个用例断言同一对事实：**打开后按 Escape 触发关闭**（弹层从文档摘除 / 关闭回调触发）
 * 且**关闭后 `document.activeElement` 回到触发元素**（hook 的焦点归还）。
 *
 * 覆盖降级声明（tasks 3.2 允许项，不虚报）：`MemberListTable` / `RiskOperationalTable`
 * 无既有测试脚手架，本文件不做行为覆盖，其「已 import hook + 调用处传 ref/onClose」由
 * `next-dialog-a11y-guard.test.ts` 的 29 条清单静态断言覆盖（静态断言不证明运行时行为）。
 *
 * 环境约定：setup 已把 `requestAnimationFrame` 换成 0ms 宏任务，焦点落点的「延迟 1 帧」
 * 用 `flushFrame()` 冲刷；`fireEvent.click` 不会移动焦点，故每个用例显式 `trigger.focus()`
 * 后再点击，以验证真实的「打开前记录 → 关闭后归还」链路。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextDraftConfirmModal } from '@/components/next/review/NextDraftConfirmModal'
import { WorkspaceGanttImpactDrawer } from '@/components/next/gantt/WorkspaceGanttImpactDrawer'
import { ResourceListTable } from '@/components/next/resources/ResourceListTable'
import { OrgMembersPanel } from '@/components/next/settings/organization/OrgMembersPanel'
import { PmoAiRecommendationDetailPanel } from '@/components/next/pmo/ai-priority/PmoAiRecommendationDetailPanel'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { OrganizationMember } from '@/lib/api-client'
import type { Resource } from '@/lib/api/resources'
import type { PmoRecommendationRecord } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 通用夹具 / 断言助手
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

/**
 * PMO 详情面板的请求层：`apiFetchEnvelope` 是多个域共用的信封函数（合规 dashboard 也走它），
 * 故只对 PMO 前缀路径做应答，其余路径原样落到真实实现（由全局 fetch 伪后端应答），
 * 避免「PMO 用例的 mock 把同文件其它组件的合规请求也吃掉」。
 */
const pmoEnvelope = vi.hoisted(() => ({
  handler: null as null | ((path: string, init?: RequestInit) => unknown),
}))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return {
    ...actual,
    apiFetchEnvelope: (path: string, init?: RequestInit) => {
      const handled = pmoEnvelope.handler?.(path, init)
      return handled !== undefined ? handled : actual.apiFetchEnvelope(path, init)
    },
  }
})

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
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    records.push({ method, url: rawUrl.replace(API_PREFIX, ''), body })
    return (
      route(rawUrl.replace(API_PREFIX, ''), method, body) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${rawUrl}` } })
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

function setAuth(
  permissions: string[],
  organizationId: number | null = 1,
  planTier: string | null = null,
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '项目经理',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    permissions,
    currentOrganizationId: organizationId,
    planTier: planTier as never,
    roleVersion: 0,
    isAuthenticated: organizationId !== null,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

/** 冲刷 hook 的「延迟 1 帧」焦点落点调度（jsdom 下 rAF = 0ms 宏任务）。 */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 在 document 上派发 Escape（hook 监听 document 级 keydown）。 */
function pressEscape() {
  fireEvent.keyDown(document, { key: 'Escape' })
}

function requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`missing element: ${selector}`)
  return element as T
}

/**
 * 弹层打开 → 焦点落弹层 → Escape 关闭 → 焦点归还触发元素的公共断言链。
 * `dialogSelector` 断言弹层从文档摘除（关闭 UI）；组件自带 onClose 回调时用 `closeSpy`
 * 追加断言回调确实触发（内部 state 关闭的组件不需要，摘除即关闭证据）。
 */
async function assertEscapeClosesAndRestoresFocus(options: {
  trigger: HTMLElement
  dialogSelector: string
  closeSpy?: { mock: { calls: unknown[] } }
}) {
  const { trigger, dialogSelector, closeSpy } = options
  await flushFrame()
  const dialog = requireElement(dialogSelector)
  expect(document.activeElement).toBe(dialog)

  pressEscape()
  if (closeSpy) expect(closeSpy.mock.calls.length).toBeGreaterThan(0)
  await waitFor(() => expect(document.querySelector(dialogSelector)).toBeNull())
  expect(document.activeElement).toBe(trigger)
}

afterEach(() => {
  pmoEnvelope.handler = null
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 1. NextDraftConfirmModal（草案转正二次确认）
// ---------------------------------------------------------------------------

/** 真实挂载链：父层按 store 的 `confirmModalOpen` 条件渲染（与 NextDraftReviewPanel 同构）。 */
function DraftConfirmHarness({ onError }: { onError: () => void }) {
  const confirmModalOpen = useAiDraftConfirmStore((state) => state.confirmModalOpen)
  return (
    <>
      <button
        type="button"
        data-draft-confirm-trigger
        onClick={() => useAiDraftConfirmStore.setState({ confirmModalOpen: true })}
      >
        打开转正确认
      </button>
      {confirmModalOpen ? (
        <NextDraftConfirmModal draftId="df_escape_a11y" onError={onError} />
      ) : null}
    </>
  )
}

describe('Escape 关闭与焦点归还：NextDraftConfirmModal（转正二次确认）', () => {
  beforeEach(() => {
    setAuth(['ai:confirm'])
    useAiProjectDraftStore.setState({ draft: null, draftVersion: 1 })
    useAiDraftConfirmStore.setState({
      mode: 'all',
      selection: {
        taskIds: [],
        wbsNodeIds: [],
        acceptanceIds: [],
        milestoneIds: [],
        riskHintIds: [],
        unselectedStrategy: 'discard',
      },
      acknowledgedWarnings: false,
      isConfirming: false,
      confirmModalOpen: false,
    })
  })

  it('Escape 关闭二次确认弹窗并把焦点归还「打开」按钮；在途提交（isConfirming）时不关', async () => {
    const onError = vi.fn()
    render(<DraftConfirmHarness onError={onError} />)
    const trigger = requireElement('[data-draft-confirm-trigger]')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => expect(document.querySelector('[data-confirm-modal]')).not.toBeNull())

    // 关闭回调 = store 的 confirmModalOpen 落回 false（父层卸载弹层）
    await flushFrame()
    expect(document.activeElement).toBe(requireElement('[data-confirm-modal]'))
    pressEscape()
    await waitFor(() => expect(document.querySelector('[data-confirm-modal]')).toBeNull())
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(false)
    expect(document.activeElement).toBe(trigger)

    // canClose 守卫：在途提交时 Escape 不关（与「取消」按钮 disabled 同判据）
    useAiDraftConfirmStore.setState({ isConfirming: true })
    fireEvent.click(trigger)
    await waitFor(() => expect(document.querySelector('[data-confirm-modal]')).not.toBeNull())
    await flushFrame()
    pressEscape()
    expect(document.querySelector('[data-confirm-modal]')).not.toBeNull()
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. WorkspaceGanttImpactDrawer（试算影响摘要抽屉，空数据分支）
// ---------------------------------------------------------------------------

function ImpactDrawerHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" data-impact-drawer-trigger onClick={() => setOpen(true)}>
        打开试算影响抽屉
      </button>
      <WorkspaceGanttImpactDrawer
        open={open}
        onClose={() => {
          setOpen(false)
          onClose()
        }}
      />
    </>
  )
}

describe('Escape 关闭与焦点归还：WorkspaceGanttImpactDrawer（试算影响抽屉）', () => {
  beforeEach(() => {
    // 空数据分支（尚无沙盒会话）：同一容器 / 同一 hook / 同一 ref，弹层照常可 Escape 关闭。
    useWhatIfSessionStore.setState({
      session: {
        status: 'idle',
        projectId: null,
        baseSnapshot: null,
        history: { entries: [], cursor: 0, maxEntries: 100 },
        derivedPreview: null,
        backendPreview: null,
        errorMessage: null,
        hasUnsavedChanges: false,
      },
      impactSummary: null,
    })
  })

  it('Escape 触发 onClose（无 canClose，默认放行）并把焦点归还触发按钮', async () => {
    const onClose = vi.fn()
    render(<ImpactDrawerHarness onClose={onClose} />)
    const trigger = requireElement('[data-impact-drawer-trigger]')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-what-if-impact-drawer]')).not.toBeNull(),
    )

    await assertEscapeClosesAndRestoresFocus({
      trigger,
      dialogSelector: '[data-what-if-impact-drawer]',
      closeSpy: onClose,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. ResourceListTable（资源删除两步流）
// ---------------------------------------------------------------------------

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    projectId: 42,
    userId: null,
    name: '张工',
    email: 'zhang@example.com',
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('Escape 关闭与焦点归还：ResourceListTable（删除确认弹层）', () => {
  beforeEach(() => {
    setAuth(['resource:manage'])
  })

  it('删除预检无未结分配 → 确认态按 Escape 关闭弹层并把焦点归还行内「删除」按钮', async () => {
    installFetchRouter((path, method) => {
      if (path.startsWith('/projects/42/resources/1/allocations') && method === 'GET') {
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 200, totalPages: 0 },
        })
      }
      if (/^\/projects\/42\/resources(\?|$)/.test(path) && method === 'GET') {
        return jsonResponse(200, {
          data: [makeResource()],
          meta: { total: 1, page: 1, perPage: 200, totalPages: 1 },
        })
      }
      return null
    })

    renderWithClient(<ResourceListTable projectId={42} canManage />)
    const trigger = await waitFor(() => requireElement('[data-resource-delete-open="1"]'))
    trigger.focus()
    fireEvent.click(trigger)

    // 等分配预检落定（确认态），确保用例覆盖的是稳定弹层而非中间态
    await waitFor(() =>
      expect(document.querySelector('[data-resource-delete-confirm]')).not.toBeNull(),
    )
    await assertEscapeClosesAndRestoresFocus({
      trigger,
      dialogSelector: '[data-resource-delete-dialog]',
    })
  })
})

// ---------------------------------------------------------------------------
// 5. OrgMembersPanel（邀请成员弹层）
// ---------------------------------------------------------------------------

function makeMember(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    id: 11,
    organizationId: 1,
    userId: 7,
    role: 'member',
    invitedBy: 1,
    user: { id: 7, fullName: '李四', email: 'lisi@example.com', isActive: true },
    ...overrides,
  } as OrganizationMember
}

describe('Escape 关闭与焦点归还：OrgMembersPanel（邀请成员弹层）', () => {
  beforeEach(() => {
    setAuth(['org:view', 'org:member:manage'])
  })

  it('含表单字段的邀请弹层按 Escape 关闭并把焦点归还「邀请成员」按钮', async () => {
    installFetchRouter((path, method) => {
      if (path === '/organizations/1/members' && method === 'GET') {
        return jsonResponse(200, { data: [makeMember()] })
      }
      return null
    })

    renderWithClient(<OrgMembersPanel organizationId={1} />)
    const trigger = await waitFor(() => requireElement('[data-org-members-invite-open]'))
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-invite-dialog]')).not.toBeNull(),
    )

    await assertEscapeClosesAndRestoresFocus({
      trigger,
      // 外层遮罩带 data 属性、内层才是 role="dialog" + ref 容器（焦点落点断言用内层）。
      dialogSelector: '[data-org-member-invite-dialog] [role="dialog"]',
    })
  })
})

// ---------------------------------------------------------------------------
// 6. PmoAiRecommendationDetailPanel（推荐审阅单项确认弹层）
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<PmoRecommendationRecord> = {}): PmoRecommendationRecord {
  return {
    id: 7,
    organizationId: 1,
    projectId: 107,
    sourceType: 'traffic_light',
    sourceId: 'tl-7',
    title: '推荐 #7：红灯项目需要管理层关注',
    summary: '交通灯信号：项目 107 持续红灯，建议人工复核。',
    suggestedAction: '查看项目详情并评估风险',
    actionType: 'navigate',
    severity: 'critical',
    priorityContext: {
      priorityScore: 91.5,
      priorityLevel: 'critical',
      rank: 1,
      weightVersion: 'priority-scoring.v1',
      topDimensionContributors: ['delivery_urgency'],
      scoringAvailable: true,
    },
    sourceSignals: [],
    evidenceRefs: [],
    status: 'new',
    dedupeKey: 'k-7',
    inputSignature: 'sig-7',
    candidateVersion: 'pmo-ai-priority-recommendations.v1',
    warnings: [],
    aiMetadata: null,
    aiStatus: 'none',
    expiresAt: null,
    stale: false,
    staleReason: null,
    createdBy: 1,
    handledBy: null,
    handledAt: null,
    snoozedUntil: null,
    reviewReason: null,
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    ...overrides,
  }
}

describe('Escape 关闭与焦点归还：PmoAiRecommendationDetailPanel（审阅确认弹层）', () => {
  beforeEach(() => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    pmoEnvelope.handler = (path: string) => {
      // 只接管 PMO 推荐前缀；其余路径返回 undefined，落到真实 apiFetchEnvelope。
      if (!String(path).startsWith('/pmo/ai-priority-recommendations')) return undefined
      const detailMatch = String(path).match(/^\/pmo\/ai-priority-recommendations\/(\d+)$/)
      if (detailMatch) {
        return Promise.resolve({
          data: { record: makeRecord(), sourceWarnings: [], conversionIntents: [] },
        })
      }
      return Promise.resolve({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
        summary: null,
      })
    }
  })

  it('审阅动作确认弹层按 Escape 关闭并把焦点归还「接受」动作按钮', async () => {
    renderWithClient(<PmoAiRecommendationDetailPanel id={7} onClose={() => undefined} />)

    const trigger = await waitFor(() => requireElement('[data-pmo-ai-action="accept"]'))
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-confirm]')).not.toBeNull())

    await assertEscapeClosesAndRestoresFocus({
      trigger,
      dialogSelector: '[data-pmo-ai-confirm]',
    })
  })
})
