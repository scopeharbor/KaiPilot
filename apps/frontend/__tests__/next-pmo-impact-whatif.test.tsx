/**
 * v3-ui-next-pmo-domain W8 · tasks 8.6 —— What-if 试算面板测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「多项目影响分析工作台」What-if）：
 * - 场景类型切换与参数输入（delay 天数 / dependency_disablement 依赖 ID）；
 * - 目标端点候选收敛自快照可见受影响端点（去重、脱敏端点不进入候选）；
 * - 试算 POST 参数（snapshotId / scenario 结构：assumption 自动文案、
 *   targetEndpointType/id、params）与只读回放渲染（基线 vs 场景、增量、
 *   严重度变化、假设性徽标）；
 * - 过期源快照 meta 警示呈现；
 * - RL-01：交互过程除 GET 详情与 /what-if 试算 POST 外零其它请求
 *   （无 run/refresh/export/follow-up/status 等任何业务写）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { PmoImpactWhatIfPanel } from '@/components/next/pmo/impact-analysis/PmoImpactWhatIfPanel'
import {
  makeAffectedEndpointFixture,
  makeMultiProjectImpactSnapshotFixture,
  makePropagationPathFixture,
  makeWhatIfOutputFixture,
} from '@aiproj/types'
import type { MultiProjectImpactSnapshot } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 会话与伪后端
// ---------------------------------------------------------------------------
function setAuth(permissions: string[]) {
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
    currentOrganizationId: 1,
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

function nonGetRequests(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET' && !record.url.endsWith('/what-if'))
}

const IMPACT_BASE = '/organizations/1/multi-project-impact-analyses'

// ---------------------------------------------------------------------------
// 夹具：快照 #1（两个可见受影响端点：task:100 / milestone:201）
// ---------------------------------------------------------------------------
function makeSnapshot(): MultiProjectImpactSnapshot {
  return makeMultiProjectImpactSnapshotFixture({
    id: 1,
    status: 'completed',
    propagationSummary: {
      propagationPaths: [
        makePropagationPathFixture({
          sourceRef: {
            sourceType: 'project',
            sourceId: 1,
            sourceLabel: '项目 Alpha',
            projectId: 1,
          },
          affectedEndpoints: [
            makeAffectedEndpointFixture({
              endpointType: 'task',
              endpointId: 100,
              endpointLabel: '任务：前端登录页面',
              projectId: 2,
              projectLabel: '项目 Beta',
              severity: 'critical',
            }),
            {
              endpointType: 'milestone',
              endpointId: 201,
              endpointLabel: '里程碑 M2',
              projectId: 3,
              projectLabel: '项目 Gamma',
              depth: 2,
              propagatedDelayDays: 5,
              bufferAbsorbedDays: 0,
              remainingBufferDays: 0,
              leadLagAdjustmentDays: 0,
              severity: 'medium',
              affectedDimensions: ['schedule'],
              visibility: 'redacted',
              redactionReason: 'hidden_milestone',
              evidenceHash: 'redacted-hash',
            },
          ],
        }),
      ],
      totalAffectedEndpoints: 1,
      severityDistribution: {
        blocker: 0,
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
      },
      blockedEndpoints: 0,
      maxDepth: 2,
      averageDelayDays: 3,
    },
  })
}

const SNAPSHOT = makeSnapshot()

/** What-if 后端路由：GET 详情 + POST /what-if 只读试算。 */
function createWhatIfBackend(
  options: {
    stale?: boolean
    outputCount?: (scenariosLength: number) => number
    failOnce?: boolean
  } = {},
) {
  let failLeft = options.failOnce ? 1 : 0
  return (path: string, method: string, body: unknown): Response | null => {
    if (path === `${IMPACT_BASE}/1` && method === 'GET') {
      return jsonResponse(200, { data: SNAPSHOT })
    }
    if (path === `${IMPACT_BASE}/what-if` && method === 'POST') {
      if (failLeft > 0) {
        failLeft -= 1
        return jsonResponse(500, { error: { code: 'INTERNAL', message: '试算失败' } })
      }
      const scenario = (body as { scenarios?: unknown[] })?.scenarios?.[0] ?? null
      const outputs = Array.from(
        {
          length:
            options.outputCount?.((body as { scenarios?: unknown[] })?.scenarios?.length ?? 1) ?? 1,
        },
        () =>
          makeWhatIfOutputFixture({
            scenario: scenario as never,
          }),
      )
      return jsonResponse(200, {
        data: outputs,
        meta: {
          snapshotId: 1,
          snapshotHash: 'hash-1',
          isStale: options.stale ?? false,
          staleReason: options.stale ? 'snapshot_ttl_expired' : null,
        },
      })
    }
    return null
  }
}

function renderPanel(organizationId = 1, snapshotId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoImpactWhatIfPanel organizationId={organizationId} snapshotId={snapshotId} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setAuth(['multi_project_impact:view'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('PmoImpactWhatIfPanel：场景试算与只读回放（RL-01）', () => {
  test('候选目标端点收敛自可见受影响端点（脱敏不进入候选）；delay 试算参数与回放渲染', async () => {
    const { records } = installFetchRouter(createWhatIfBackend())
    renderPanel()

    await waitFor(() => expect(document.querySelector('[data-imp-whatif-scenario]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-loading]')).toBeNull())

    // 候选仅 1 个可见端点（task:100，redacted milestone 不进入候选）
    const targetSelect = document.querySelector('[data-imp-whatif-target]') as HTMLSelectElement
    expect(targetSelect.options.length).toBe(1)
    expect(targetSelect.value).toBe('task:100')
    expect(targetSelect.textContent).toContain('任务：前端登录页面（项目 Beta）')

    // delay 参数默认 7 天
    const delayInput = document.querySelector(
      '[data-imp-whatif-param="delayDays"]',
    ) as HTMLInputElement
    expect(delayInput.value).toBe('7')
    fireEvent.change(delayInput, { target: { value: '14' } })

    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await waitFor(() => {
      const whatIfRecord = records.find((record) => record.url.endsWith('/what-if'))
      expect(whatIfRecord?.method).toBe('POST')
    })
    const whatIfRecord = records.find((record) => record.url.endsWith('/what-if'))
    const requestBody = whatIfRecord?.body as {
      snapshotId: number
      scenarios: Array<{
        scenarioType: string
        assumption: string
        targetEndpointType: string
        targetEndpointId: number
        params: Record<string, string>
      }>
    }
    expect(requestBody.snapshotId).toBe(1)
    expect(requestBody.scenarios).toHaveLength(1)
    expect(requestBody.scenarios[0]).toMatchObject({
      scenarioType: 'delay',
      assumption: '假设目标端点延期 14 天',
      targetEndpointType: 'task',
      targetEndpointId: 100,
      params: { delayDays: '14' },
    })

    // 只读回放
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-result]')).not.toBeNull())
    expect(document.querySelector('[data-imp-whatif-baseline]')?.textContent).toBe('5')
    expect(document.querySelector('[data-imp-whatif-scenario-total]')?.textContent).toBe('8')
    expect(document.querySelector('[data-imp-whatif-delta]')?.textContent).toBe('+3')
    // 假设性徽标 + 严重度变化（medium → high）
    expect(document.querySelector('[data-imp-whatif-hypothetical]')?.textContent).toContain(
      '假设性',
    )
    const severityChange = document.querySelector('[data-imp-whatif-severity-changes]')
    expect(severityChange?.textContent).toContain('中')
    expect(severityChange?.textContent).toContain('高')

    // RL-01：交互过程仅 GET 详情 + /what-if 试算 POST，零业务写
    expect(nonGetRequests(records)).toHaveLength(0)
  })

  test('场景切换：dependency_disablement 参数输入并随请求体提交', async () => {
    const { records } = installFetchRouter(createWhatIfBackend())
    renderPanel()
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-loading]')).toBeNull())

    const scenarioSelect = document.querySelector('[data-imp-whatif-scenario]') as HTMLSelectElement
    fireEvent.change(scenarioSelect, { target: { value: 'dependency_disablement' } })
    // 参数区切换到停用依赖 ID 输入
    await waitFor(() =>
      expect(
        document.querySelector('[data-imp-whatif-param="dependencyIdToDisable"]'),
      ).not.toBeNull(),
    )
    const idInput = document.querySelector(
      '[data-imp-whatif-param="dependencyIdToDisable"]',
    ) as HTMLInputElement
    fireEvent.change(idInput, { target: { value: '55' } })

    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await waitFor(() =>
      expect(records.some((record) => record.url.endsWith('/what-if'))).toBe(true),
    )
    const whatIfRecord = records.find((record) => record.url.endsWith('/what-if'))
    const requestBody = whatIfRecord?.body as {
      scenarios: Array<{
        scenarioType: string
        assumption: string
        params: Record<string, string>
      }>
    }
    expect(requestBody.scenarios[0]).toMatchObject({
      scenarioType: 'dependency_disablement',
      assumption: '假设停用依赖 #55',
      params: { dependencyIdToDisable: '55' },
    })
    // 仅一次 GET + 一次 what-if
    expect(nonGetRequests(records)).toHaveLength(0)
    const getCount = records.filter((record) => record.method === 'GET').length
    expect(getCount).toBeGreaterThanOrEqual(1)
  })

  test('负数值输入禁用试算（输入校验不发包）', async () => {
    const { records } = installFetchRouter(createWhatIfBackend())
    renderPanel()
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-loading]')).toBeNull())

    const delayInput = document.querySelector(
      '[data-imp-whatif-param="delayDays"]',
    ) as HTMLInputElement
    fireEvent.change(delayInput, { target: { value: '-3' } })
    expect((document.querySelector('[data-imp-whatif-run]') as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await wait()
    expect(records.some((record) => record.url.endsWith('/what-if'))).toBe(false)
  })

  test('源快照过期：回放结果附带 stale 警示（不阻断只读试算）', async () => {
    installFetchRouter(createWhatIfBackend({ stale: true }))
    renderPanel()
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-loading]')).toBeNull())

    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-imp-whatif-stale-note]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-imp-whatif-stale-note]')?.textContent).toContain(
      'snapshot_ttl_expired',
    )
  })

  test('试算失败：错误回显可重试；重试成功呈现回放', async () => {
    const { records } = installFetchRouter(createWhatIfBackend({ failOnce: true }))
    renderPanel()
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-loading]')).toBeNull())

    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-error]')).not.toBeNull())
    // 再次点击（错误态不清除场景输入，直接重试）
    fireEvent.click(document.querySelector('[data-imp-whatif-run]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-whatif-result]')).not.toBeNull())
    expect(document.querySelector('[data-imp-whatif-error]')).toBeNull()
    // 最终：1 次失败 + 1 次成功的 what-if POST；无其它非 GET 请求
    const whatIfPosts = records.filter((record) => record.url.endsWith('/what-if'))
    expect(whatIfPosts).toHaveLength(2)
    expect(nonGetRequests(records)).toHaveLength(0)
  })
})

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
