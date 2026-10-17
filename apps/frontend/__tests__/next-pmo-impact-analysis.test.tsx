/**
 * v3-ui-next-pmo-domain W8 · tasks 8.5 —— 多项目影响分析工作台测试
 * （路由装配 + 快照列表过滤 + plan→run 向导 + 详情动作，真实数据链：
 * hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「多项目影响分析工作台」）：
 * - RBAC（design Decision 5 / G2）：无 multi_project_impact:view|manage 受限横幅
 *   零请求（RL-06）；未选择组织引导态零请求；
 * - 快照列表：行渲染（状态/过期双通道、严重度收敛、脱敏计数）、URL 过滤契约
 *   （状态/严重度/仅过期/项目范围 → router.push 序列化，过滤变更重置分页；
 *   restorable 按 URL 恢复重查）、筛选空结果清除、分页 page 参数、错误重试；
 * - plan→run 向导：manage 门禁（仅 view 时禁用并提示，plan 零发包）、
 *   plan → 摘要 → 二次确认（取消零发包 / 确认 POST runToken）→ 成功后列表刷新；
 * - 详情面板：维度分布/红区项目/受影响实体（脱敏不泄露）；refresh（manage 门禁
 *   与参数）、导出 JSON/CSV 动作参数与回执、跟进草稿参数与「仅提示不自动提交」
 *   回执、featureUnavailable 人工摘要 fallback；详情 404 中性受限态；
 * - 全程只读浏览/筛选/翻页交互零写请求断言（RL-01/RL-06）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoImpactAnalysisPage from '@/app/(next)/next/pmo/impact-analysis/page'
import {
  makeAffectedEndpointFixture,
  makeAiExplanationFixture,
  makeFollowUpDraftFeatureUnavailableFixture,
  makeFollowUpDraftFixture,
  makeMultiProjectImpactPlanFixture,
  makeMultiProjectImpactSnapshotFixture,
  makeMultiProjectImpactStaleSnapshotFixture,
  makePropagationPathFixture,
  makeRedactedEndpointFixture,
  makeSourceRefFixture,
} from '@aiproj/types'
import { fnv1aHash } from '@aiproj/types'
import type {
  MultiProjectImpactScope,
  MultiProjectImpactSeverity,
  MultiProjectImpactSnapshot,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation + next/link mock
// ---------------------------------------------------------------------------
const LIST_PATH = '/next/pmo/impact-analysis'
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => LIST_PATH,
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与伪后端
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '组织管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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
  url: string
  body?: unknown
}

function installFetchRouter(
  route: (path: string, method: string, body: unknown) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    records.push({ method, url: rawUrl, body })
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function writeRequestsOf(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

function queryOf(path: string): URLSearchParams {
  const question = path.indexOf('?')
  return new URLSearchParams(question >= 0 ? path.slice(question + 1) : '')
}

/** 列表 GET 计数（列表 URL 可能无 query 串；详情 GET 为 /{id} 路径）。 */
function listGetCount(records: RequestRecord[]): number {
  return records.filter(
    (record) =>
      record.method === 'GET' && record.url.replace(API_PREFIX, '').split('?')[0] === IMPACT_BASE,
  ).length
}

/** 模拟 router.push 后的真实 URL 往返：按最后一次 push 重建 searchParams 并整体重挂载。 */
async function remountFromLastPush(harness: { unmount: () => void }) {
  const last = navMock.push.mock.calls.at(-1)?.[0] as string
  const qsPart = last === LIST_PATH ? '' : last.slice(LIST_PATH.length).replace(/^\?/, '')
  searchParamsMock.value = new URLSearchParams(qsPart)
  navMock.push.mockClear()
  harness.unmount()
  return makeHarness()
}

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 快照 #1：completed，危急端点（红区项目 Beta）+ 脱敏端点 + 次级路径。 */
function makeSnapshotOne(): MultiProjectImpactSnapshot {
  return makeMultiProjectImpactSnapshotFixture({
    id: 1,
    status: 'completed',
    propagationSummary: {
      propagationPaths: [
        makePropagationPathFixture({
          sourceRef: makeSourceRefFixture('project', 1, 1, '项目 Alpha'),
          affectedEndpoints: [
            makeAffectedEndpointFixture({
              endpointType: 'task',
              endpointId: 100,
              endpointLabel: '任务：前端登录页面',
              projectId: 2,
              projectLabel: '项目 Beta',
              severity: 'critical',
              affectedDimensions: ['schedule', 'risk'],
              evidenceHash: fnv1aHash('evidence-1'),
            }),
            makeRedactedEndpointFixture(),
          ],
        }),
        makePropagationPathFixture({
          sourceRef: makeSourceRefFixture('project', 3, 3, '项目 Gamma'),
          affectedEndpoints: [
            makeAffectedEndpointFixture({
              endpointType: 'milestone',
              endpointId: 201,
              endpointLabel: '里程碑 M2',
              projectId: 3,
              projectLabel: '项目 Gamma',
              severity: 'medium',
              affectedDimensions: ['schedule'],
              evidenceHash: fnv1aHash('evidence-2'),
            }),
          ],
        }),
      ],
      totalAffectedEndpoints: 2,
      severityDistribution: {
        blocker: 0,
        critical: 1,
        high: 0,
        medium: 1,
        low: 0,
        none: 0,
      },
      blockedEndpoints: 1,
      maxDepth: 2,
      averageDelayDays: 4,
    },
  })
}

const SNAPSHOT_ONE = makeSnapshotOne()
const SNAPSHOT_STALE = makeMultiProjectImpactStaleSnapshotFixture()
const SNAPSHOTS = [SNAPSHOT_ONE, SNAPSHOT_STALE]

const IMPACT_BASE = '/organizations/1/multi-project-impact-analyses'

/** 影响分析后端路由（列表 query 过滤模拟 + 全套动作端点）。 */
function createImpactBackend(
  overrides: {
    plan?: (scope: unknown) => unknown
    run?: (runRequest: unknown) => unknown
    followUp?: (followUpRequest: unknown) => unknown
  } = {},
) {
  return (path: string, method: string, body: unknown): Response | null => {
    if (
      path.startsWith(IMPACT_BASE) &&
      method === 'GET' &&
      !path.slice(IMPACT_BASE.length).includes('/')
    ) {
      const qs = queryOf(path)
      const status = qs.get('status')
      const severity = qs.get('severity')
      const page = Number(qs.get('page') ?? 1)
      let rows = SNAPSHOTS
      if (status) rows = rows.filter((snapshot) => snapshot.status === status)
      if (severity) {
        rows = rows.filter(
          (snapshot) =>
            (snapshot.propagationSummary.severityDistribution[
              severity as MultiProjectImpactSeverity
            ] ?? 0) > 0,
        )
      }
      return jsonResponse(200, {
        data: rows,
        meta: { total: SNAPSHOTS.length, page, perPage: 20, totalPages: 2 },
      })
    }
    const detailMatch = path.match(new RegExp(`^${IMPACT_BASE}/(\\d+)$`))
    if (detailMatch && method === 'GET') {
      const id = Number(detailMatch[1])
      const snapshot = SNAPSHOTS.find((item) => item.id === id)
      return snapshot ? jsonResponse(200, { data: snapshot }) : null
    }
    if (path === `${IMPACT_BASE}/plan` && method === 'POST') {
      const scope = (body as { scope?: unknown })?.scope
      return jsonResponse(200, {
        data: overrides.plan ? overrides.plan(scope) : makeMultiProjectImpactPlanFixture(),
      })
    }
    if (path === `${IMPACT_BASE}/run` && method === 'POST') {
      return jsonResponse(200, { data: overrides.run ? overrides.run(body) : SNAPSHOT_ONE })
    }
    if (path === `${IMPACT_BASE}/1/refresh` && method === 'POST') {
      return jsonResponse(200, { data: SNAPSHOT_ONE })
    }
    if (path === `${IMPACT_BASE}/export` && method === 'POST') {
      return jsonResponse(200, {
        data: {
          snapshotId: 1,
          snapshotHash: fnv1aHash('output'),
          format: (body as { format?: string })?.format ?? 'json',
          content: JSON.stringify({ rows: [] }),
        },
      })
    }
    if (path === `${IMPACT_BASE}/follow-up` && method === 'POST') {
      return jsonResponse(200, {
        data: overrides.followUp ? overrides.followUp(body) : makeFollowUpDraftFixture(),
      })
    }
    if (path === `${IMPACT_BASE}/ai-explanation` && method === 'POST') {
      return jsonResponse(200, { data: makeAiExplanationFixture() })
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// 渲染装配
// ---------------------------------------------------------------------------
function makeHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (
    <QueryClientProvider client={client}>
      <PmoImpactAnalysisPage />
    </QueryClientProvider>
  )
  const utils = render(ui)
  return { rerender: () => utils.rerender(ui), unmount: () => utils.unmount() }
}

beforeEach(() => {
  setAuth(['multi_project_impact:view', 'multi_project_impact:manage'])
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  // Vitest 5 的 Node URL.createObjectURL 只接受 Node Blob；组件运行于 jsdom Blob。
  // 浏览器行为在这里以稳定的对象 URL 夹具替代，避免测试环境类型桥接报错。
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aiproj-impact-export')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// RBAC 路由壳（RL-06 / G2）
// ---------------------------------------------------------------------------
describe('PmoImpactAnalysisPage：RBAC 门禁与组织上下文', () => {
  test('无 multi_project_impact:view|manage（含 ORG_ADMIN 常态）：受限横幅渲染且 0 请求', async () => {
    // G2：multi_project_impact:* 未授予任何规范角色——ORG_ADMIN 亦同受限。
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter(() => null)
    makeHarness()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-imp-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-imp-workspace]')).toBeNull()
    await wait()
    expect(records).toHaveLength(0)
  })

  test('未选择组织：引导态渲染且零请求', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        email: 'solo@example.com',
        fullName: '未入组成员',
        organizations: [],
      },
      currentOrganizationId: null,
      permissions: ['multi_project_impact:view'],
    })
    const { records } = installFetchRouter(() => null)
    makeHarness()

    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(document.querySelector('[data-imp-org-guide]')).not.toBeNull()
    await wait()
    expect(records).toHaveLength(0)
  })

  test('显式附加 view+manage 权限：工作台装配，状态/过期/严重度双通道渲染，零写请求', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    makeHarness()

    await waitFor(() => expect(document.querySelector('[data-imp-workspace]')).not.toBeNull())
    expect(screen.getByRole('heading', { name: '多项目影响分析' })).toBeInTheDocument()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(2),
    )
    // 状态/过期双通道
    const rowOne = document.querySelector('[data-imp-snapshot-row="1"]')
    expect(rowOne?.querySelector('[data-imp-status-chip]')?.textContent).toContain('已完成')
    expect(rowOne?.querySelector('[data-imp-status-chip]')?.getAttribute('data-status')).toBe(
      'completed',
    )
    const staleRow = document.querySelector('[data-imp-snapshot-row="2"]')
    expect(staleRow?.querySelector('[data-imp-stale-chip]')?.textContent).toContain('已过期')
    expect(staleRow?.querySelector('[data-imp-severity-chip]')?.textContent).toContain('中')
    // 脱敏端点计数（不泄露端点信息，仅计数）
    expect(document.querySelectorAll('[data-imp-redacted-count]')).toHaveLength(1)
    // 只读装配：仅列表 GET，无任何写请求
    await waitFor(() =>
      expect(records.some((record) => record.url.includes('/multi-project-impact-analyses'))).toBe(
        true,
      ),
    )
    expect(writeRequestsOf(records)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 快照列表：URL 过滤契约（复用旧页 serialize/deserialize）
// ---------------------------------------------------------------------------
describe('PmoImpactSnapshotList：URL 过滤契约与分页', () => {
  test('筛选写回 URL：过滤变更重置分页；restorable 按 URL 恢复重查', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    // 初始 URL 停留在第 2 页
    searchParamsMock.value = new URLSearchParams('page=2')
    let harness = makeHarness()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(2),
    )

    const severity = document.querySelector('[data-imp-severity-filter]') as HTMLSelectElement
    fireEvent.change(severity, { target: { value: 'critical' } })
    // 过滤变更 → 序列化契约 + page 重置（不再携带 page=2）
    expect(navMock.push).toHaveBeenCalledWith(`${LIST_PATH}?severity=critical`)
    harness = await remountFromLastPush(harness)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(1),
    )
    // 重挂载后按 URL 恢复：severity 下拉回显 critical（stale 快照被过滤）
    expect((document.querySelector('[data-imp-severity-filter]') as HTMLSelectElement).value).toBe(
      'critical',
    )

    const status = document.querySelector('[data-imp-status-filter]') as HTMLSelectElement
    fireEvent.change(status, { target: { value: 'failed' } })
    expect(navMock.push).toHaveBeenCalledWith(`${LIST_PATH}?severity=critical&status=failed`)
    harness = await remountFromLastPush(harness)
    await waitFor(() => expect(document.querySelector('[data-imp-no-results]')).not.toBeNull())

    const staleCheckbox = document.querySelector('[data-imp-stale-filter]') as HTMLInputElement
    fireEvent.click(staleCheckbox)
    expect(navMock.push).toHaveBeenCalledWith(
      `${LIST_PATH}?severity=critical&isStale=true&status=failed`,
    )
    harness = await remountFromLastPush(harness)
    // severity=critical + status=failed 过滤命中空 → 无匹配结果态（过滤控件仍在）
    await waitFor(() => expect(document.querySelector('[data-imp-no-results]')).not.toBeNull())
    expect((document.querySelector('[data-imp-stale-filter]') as HTMLInputElement).checked).toBe(
      true,
    )
    expect((document.querySelector('[data-imp-severity-filter]') as HTMLSelectElement).value).toBe(
      'critical',
    )
    expect((document.querySelector('[data-imp-status-filter]') as HTMLSelectElement).value).toBe(
      'failed',
    )

    // 模拟刷新/直达另一过滤 URL：反序列化恢复并重查
    const listGetsBefore = listGetCount(records)
    searchParamsMock.value = new URLSearchParams('status=completed&isStale=true')
    harness.unmount()
    makeHarness()
    await waitFor(() => expect(listGetCount(records)).toBeGreaterThan(listGetsBefore))
    const qs = queryOf(
      records
        .filter(
          (record) =>
            record.method === 'GET' &&
            record.url.replace(API_PREFIX, '').split('?')[0] === IMPACT_BASE,
        )
        .at(-1)?.url ?? '',
    )
    expect(qs.get('status')).toBe('completed')
    expect(qs.get('isStale')).toBe('true')
    await waitFor(() =>
      expect((document.querySelector('[data-imp-stale-filter]') as HTMLInputElement).checked).toBe(
        true,
      ),
    )
  })

  test('项目范围 Enter 提交 projectIds；筛选命中空渲染无匹配 + 清除筛选', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    let harness = makeHarness()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(2),
    )

    const scopeInput = document.querySelector('[data-imp-project-scope-input]') as HTMLInputElement
    fireEvent.change(scopeInput, { target: { value: '1, 2, 3' } })
    fireEvent.keyDown(scopeInput, { key: 'Enter' })
    expect(navMock.push).toHaveBeenCalledWith(`${LIST_PATH}?projectIds=1%2C2%2C3`)
    harness = await remountFromLastPush(harness)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(2),
    )
    // 重挂载后范围输入框回显 URL 中的项目范围
    expect(
      (document.querySelector('[data-imp-project-scope-input]') as HTMLInputElement).value,
    ).toBe('1,2,3')

    // 筛选命中空（status=failed 无快照）→ 无匹配结果态 + 清除筛选回列表
    searchParamsMock.value = new URLSearchParams('status=failed')
    navMock.push.mockClear()
    harness.unmount()
    makeHarness()
    await waitFor(() => expect(document.querySelector('[data-imp-no-results]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-imp-no-results-clear]') as Element)
    expect(navMock.push).toHaveBeenCalledWith(LIST_PATH)
    expect(writeRequestsOf(records)).toHaveLength(0)
  })

  test('分页：上一页/下一页经 URL page 参数写回', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    const firstHarness = makeHarness()
    await waitFor(() => expect(document.querySelector('[data-imp-pagination]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-imp-next-page]') as Element)
    expect(navMock.push).toHaveBeenCalledWith(`${LIST_PATH}?page=2`)
    remountFromLastPush(firstHarness)

    await waitFor(() => {
      const prev = document.querySelector('[data-imp-prev-page]') as HTMLButtonElement
      expect(prev.disabled).toBe(false)
    })
    fireEvent.click(document.querySelector('[data-imp-prev-page]') as Element)
    expect(navMock.push).toHaveBeenCalledWith(LIST_PATH)
    expect(writeRequestsOf(records)).toHaveLength(0)
  })

  test('列表加载失败：错误卡 + 重新载入重试成功闭环', async () => {
    let fail = true
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith(IMPACT_BASE) && method === 'GET') {
        if (fail) {
          fail = false
          return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
        }
        return createImpactBackend()(path, method, undefined)
      }
      return null
    })
    const h = makeHarness()
    await waitFor(() => expect(document.querySelector('[data-imp-list-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-imp-list-retry]') as Element)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(2),
    )
    expect(records.some((record) => record.method === 'GET')).toBe(true)
    h.unmount()
  })
})

// ---------------------------------------------------------------------------
// plan→run 向导（manage 门禁 + 二次确认）
// ---------------------------------------------------------------------------
describe('PmoImpactPlanRunPanel：manage 门禁与 plan→run 闭环', () => {
  test('仅 view（无 manage）：plan 禁用 + 提示徽标；点击不发任何 plan 请求', async () => {
    setAuth(['multi_project_impact:view'])
    const { records } = installFetchRouter(createImpactBackend())
    makeHarness()
    await waitFor(() => expect(document.querySelector('[data-imp-plan-panel]')).not.toBeNull())

    expect(document.querySelector('[data-imp-plan-manage-hint]')).not.toBeNull()
    expect((document.querySelector('[data-imp-plan-action]') as HTMLButtonElement).disabled).toBe(
      true,
    )
    const idsInput = document.querySelector('[data-imp-plan-project-ids]') as HTMLInputElement
    fireEvent.change(idsInput, { target: { value: '1,2' } })
    expect((document.querySelector('[data-imp-plan-action]') as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(document.querySelector('[data-imp-plan-action]') as Element)
    expect(writeRequestsOf(records).some((record) => record.url.includes('/plan'))).toBe(false)
    expect(document.querySelector('[data-imp-plan-summary]')).toBeNull()
  })

  test('manage：plan→摘要展示；取消二次确认零发包；确认运行 POST runToken 且列表自动刷新', async () => {
    const { records } = installFetchRouter(
      createImpactBackend({
        // makeMultiProjectImpactPlanFixture 不接受 overrides 参数，需展开覆盖
        plan: () => ({ ...makeMultiProjectImpactPlanFixture(), scopeHash: 'plan-hash-001' }),
      }),
    )
    makeHarness()
    await waitFor(() => expect(document.querySelector('[data-imp-plan-panel]')).not.toBeNull())

    const idsInput = document.querySelector('[data-imp-plan-project-ids]') as HTMLInputElement
    fireEvent.change(idsInput, { target: { value: '1, 3' } })
    fireEvent.click(document.querySelector('[data-imp-plan-action]') as Element)

    // plan POST 参数
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.url.endsWith('/multi-project-impact-analyses/plan') && record.method === 'POST',
        ),
      ).toBe(true),
    )
    const planRecord = records.find(
      (record) => record.url.endsWith('/plan') && record.method === 'POST',
    )
    const planScope = (planRecord?.body as { scope: MultiProjectImpactScope })?.scope
    expect(planScope.projectIds).toEqual([1, 3])
    expect(planScope.maxPropagationDepth).toBe(5)

    // 计划摘要
    await waitFor(() => expect(document.querySelector('[data-imp-plan-summary]')).not.toBeNull())
    expect(document.querySelector('[data-imp-plan-scope-hash]')?.textContent).toContain('plan-hash')

    // 取消：不发 run 请求
    fireEvent.click(document.querySelector('[data-imp-run-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-imp-run-confirm-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-imp-run-cancel]') as Element)
    await wait()
    expect(records.some((record) => record.url.endsWith('/run'))).toBe(false)

    // 确认运行
    const listGetsBefore = listGetCount(records)
    fireEvent.click(document.querySelector('[data-imp-run-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-imp-run-confirm-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-imp-run-confirm]') as Element)

    await waitFor(() => {
      const runRecord = records.find((record) => record.url.endsWith('/run'))
      expect(runRecord?.method).toBe('POST')
      expect((runRecord?.body as { runToken?: string })?.runToken).toBeTruthy()
    })
    // 成功后：向导复位 + 成功提示 + 列表自动刷新（invalidate → 再次 GET list）
    await waitFor(() => expect(document.querySelector('[data-imp-run-success]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-imp-plan-summary]')).toBeNull())
    await waitFor(() => expect(listGetCount(records)).toBeGreaterThan(listGetsBefore))
  })
})

// ---------------------------------------------------------------------------
// 详情面板（维度分布/红区/实体/动作参数）
// ---------------------------------------------------------------------------
async function openDetailRow(rowIndex: number) {
  await waitFor(() =>
    expect(document.querySelectorAll('[data-imp-snapshot-row]').length).toBeGreaterThan(0),
  )
  fireEvent.click(document.querySelectorAll('[data-imp-row-detail]')[rowIndex] as Element)
  await waitFor(() => expect(document.querySelector('[data-imp-detail]')).not.toBeNull())
  await waitFor(() => expect(document.querySelector('[data-imp-detail-loading]')).toBeNull())
}

describe('PmoImpactSnapshotDetailPanel：详情渲染与动作参数', () => {
  test('行选择展开详情：维度分布/红区项目/受影响实体（脱敏端点无猜测值）', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    makeHarness()
    await openDetailRow(0)

    // 统计
    expect(document.querySelector('[data-imp-stat-affected]')?.textContent).toBe('2')
    expect(document.querySelector('[data-imp-stat-blocked]')?.textContent).toBe('1')
    // 严重度分布（双通道）
    const criticalItem = document.querySelector('[data-imp-severity-summary-item="critical"]')
    expect(criticalItem?.textContent).toContain('危急 ×1')
    // 维度分布：schedule ×2 / risk ×1
    expect(document.querySelector('[data-imp-dimension-chip="schedule"]')?.textContent).toContain(
      '进度 ×2',
    )
    expect(document.querySelector('[data-imp-dimension-chip="risk"]')?.textContent).toContain(
      '风险 ×1',
    )
    // 红区项目：项目 Beta 1 个危急端点
    expect(document.querySelector('[data-imp-redzone-chip]')?.textContent).toContain('项目 Beta')
    // 受影响实体：2 可见端点 + 1 脱敏端点（无猜测值）
    expect(document.querySelectorAll('[data-imp-endpoint-visible]')).toHaveLength(2)
    const redacted = document.querySelectorAll('[data-imp-endpoint-redacted]')
    expect(redacted).toHaveLength(1)
    expect(redacted[0]?.textContent).toContain('隐藏端点')
    // 零写请求（只读展开）
    expect(writeRequestsOf(records)).toHaveLength(0)
  })

  test('详情接口 404：中性受限态（回显固定文案，不暴露后端错误细节）', async () => {
    installFetchRouter((path, method) => {
      if (path === IMPACT_BASE && method === 'GET') {
        return jsonResponse(200, {
          data: [SNAPSHOT_STALE],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      if (path === `${IMPACT_BASE}/2` && method === 'GET') {
        return jsonResponse(404, {
          error: { code: 'RESOURCE_NOT_FOUND', message: 'secret-detail' },
        })
      }
      return null
    })
    makeHarness()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-imp-snapshot-row]')).toHaveLength(1),
    )
    fireEvent.click(document.querySelector('[data-imp-row-detail]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-detail-error]')).not.toBeNull())
    expect(document.querySelector('[data-imp-detail-error]')?.textContent).toContain(
      '快照不存在或无权访问',
    )
    // 后端原始 message 不回流界面（中性 404，RL-05）
    expect(document.querySelector('[data-imp-detail-error]')?.textContent).not.toContain(
      'secret-detail',
    )
  })

  test('refresh（manage 动作）：POST 参数与成功后列表失效刷新', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    makeHarness()
    await openDetailRow(0)

    const listGetsBefore = listGetCount(records)
    fireEvent.click(document.querySelector('[data-imp-refresh]') as Element)
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.url.endsWith('/multi-project-impact-analyses/1/refresh') &&
            record.method === 'POST',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(listGetCount(records)).toBeGreaterThan(listGetsBefore))
  })

  test('仅 view 用户：刷新按钮禁用（manage 门禁）', async () => {
    setAuth(['multi_project_impact:view'])
    installFetchRouter(createImpactBackend())
    makeHarness()
    await openDetailRow(0)
    expect((document.querySelector('[data-imp-refresh]') as HTMLButtonElement).disabled).toBe(true)
  })

  test('导出 JSON/CSV：动作参数与回执呈现', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    makeHarness()
    await openDetailRow(0)

    fireEvent.click(document.querySelector('[data-imp-export-json]') as Element)
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.url.endsWith('/multi-project-impact-analyses/export') &&
            (record.body as { format?: string })?.format === 'json',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-imp-export-receipt]')).not.toBeNull())
    expect(document.querySelector('[data-imp-export-receipt]')?.textContent).toContain('JSON')

    fireEvent.click(document.querySelector('[data-imp-export-csv]') as Element)
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.url.endsWith('/export') &&
            record.method === 'POST' &&
            (record.body as { format?: string })?.format === 'csv',
        ),
      ).toBe(true),
    )
    expect(document.querySelector('[data-imp-export-receipt]')?.textContent).toContain('CSV')
  })

  test('跟进草稿：目标选择 → POST 参数（snapshotId/端点哈希/能力）；回执仅提示不自动提交', async () => {
    const { records } = installFetchRouter(createImpactBackend())
    makeHarness()
    await openDetailRow(0)

    const target = document.querySelector('[data-imp-followup-target]') as HTMLSelectElement
    fireEvent.change(target, { target: { value: 'manual_risk_draft' } })
    fireEvent.click(document.querySelector('[data-imp-followup-run]') as Element)

    await waitFor(() => {
      const followUpRecord = records.find((record) => record.url.endsWith('/follow-up'))
      expect(followUpRecord?.method).toBe('POST')
      const body = followUpRecord?.body as {
        snapshotId: number
        affectedEndpointHashes: string[]
        targetCapability: string
      }
      expect(body.snapshotId).toBe(1)
      expect(body.affectedEndpointHashes).toEqual([
        fnv1aHash('evidence-1'),
        fnv1aHash('evidence-2'),
      ])
      expect(body.targetCapability).toBe('manual_risk_draft')
    })
    await waitFor(() =>
      expect(document.querySelector('[data-imp-followup-receipt]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-imp-followup-receipt]')?.textContent).toContain(
      '跟进草稿已创建',
    )
    // RL-01：回执明确提示需人工确认后才应用，绝不自动提交
    expect(document.querySelector('[data-imp-followup-receipt]')?.textContent).toContain('人工确认')
    const writeCount = writeRequestsOf(records).length
    await wait(30)
    expect(writeRequestsOf(records).length).toBe(writeCount)
  })

  test('跟进草稿：目标能力不可用 → 人工摘要 fallback 回执', async () => {
    const { records } = installFetchRouter(
      createImpactBackend({
        followUp: () => makeFollowUpDraftFeatureUnavailableFixture(),
      }),
    )
    makeHarness()
    await openDetailRow(0)

    const target = document.querySelector('[data-imp-followup-target]') as HTMLSelectElement
    fireEvent.change(target, { target: { value: 'multi_project_dependency_crud' } })
    fireEvent.click(document.querySelector('[data-imp-followup-run]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-followup-manual]')).not.toBeNull())
    expect(document.querySelector('[data-imp-followup-receipt]')?.textContent).toContain(
      '跟进草稿已创建',
    )
    expect(document.querySelector('[data-imp-followup-manual]')?.textContent).toContain('尚未启用')
    expect(writeRequestsOf(records)).toHaveLength(1)
  })

  test('返回角色首页动线', async () => {
    installFetchRouter(createImpactBackend())
    makeHarness()
    await waitFor(() => expect(document.querySelector('[data-imp-workspace]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-imp-back-home]') as Element)
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })
})
