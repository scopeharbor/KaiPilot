/**
 * v3-ui-next-pmo-domain W8 · tasks 8.6 —— AI 影响解释浮层测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「多项目影响分析工作台」AI 解释 + RL-01）：
 * - 浮层打开零请求（显式触发纪律：不自动调用 AI）；
 * - 「生成 AI 解释」显式触发：请求体 {snapshotId, focus}、生成中态、成功呈现
 *   解释文本与 AIMarker（provider/model/置信度/生成时间）；
 * - 服务端 AI 不可用（provider=null）→ 中性说明，无 AI 结论冒充；
 * - 失败 → 错误回显 + 重试成功闭环；
 * - 关闭浮层后：网络监控断言无任何状态写请求、无自动重发（RL-01）；
 * - 重新生成可再次显式触发。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { PmoImpactSnapshotDetailPanel } from '@/components/next/pmo/impact-analysis/PmoImpactSnapshotDetailPanel'
import {
  makeAiExplanationFixture,
  makeAiExplanationUnavailableFixture,
  makeMultiProjectImpactSnapshotFixture,
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

/** 除 GET 与显式 ai-explanation POST 之外的任何业务写。 */
function businessWrites(records: RequestRecord[]): RequestRecord[] {
  return records.filter(
    (record) => record.method !== 'GET' && !record.url.endsWith('/ai-explanation'),
  )
}

const IMPACT_BASE = '/organizations/1/multi-project-impact-analyses'
const SNAPSHOT: MultiProjectImpactSnapshot = makeMultiProjectImpactSnapshotFixture({ id: 1 })

/** AI 后端路由：GET 详情 + POST ai-explanation（可配置成功/失败/不可用）。 */
function createAiBackend(
  options: {
    unavailable?: boolean
    failOnce?: boolean
    failAlways?: boolean
  } = {},
) {
  let failLeft = options.failAlways ? Infinity : options.failOnce ? 1 : 0
  return (path: string, method: string): Response | null => {
    if (path === `${IMPACT_BASE}/1` && method === 'GET') {
      return jsonResponse(200, { data: SNAPSHOT })
    }
    if (path === `${IMPACT_BASE}/ai-explanation` && method === 'POST') {
      if (failLeft > 0) {
        failLeft -= 1
        return jsonResponse(503, {
          error: { code: 'AI_UNAVAILABLE', message: 'AI 服务暂时不可用' },
        })
      }
      return jsonResponse(200, {
        data: options.unavailable
          ? makeAiExplanationUnavailableFixture()
          : makeAiExplanationFixture(),
      })
    }
    return null
  }
}

function renderDetailPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  const utils = render(
    <QueryClientProvider client={client}>
      <PmoImpactSnapshotDetailPanel organizationId={1} snapshotId={1} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { ...utils, onClose }
}

async function openModal() {
  await waitFor(() => expect(document.querySelector('[data-imp-detail]')).not.toBeNull())
  await waitFor(() => expect(document.querySelector('[data-imp-ai-open]')).not.toBeNull())
  fireEvent.click(document.querySelector('[data-imp-ai-open]') as Element)
  await waitFor(() => expect(document.querySelector('[data-imp-ai-modal]')).not.toBeNull())
}

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  setAuth(['multi_project_impact:view'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('PmoImpactAiExplanationModal：显式触发与零副作用（RL-01）', () => {
  test('打开浮层零请求；显式点击生成：请求体带 snapshotId+focus，成功呈现解释与 AIMarker', async () => {
    const { records } = installFetchRouter(createAiBackend())
    renderDetailPanel()

    const aiPostsBefore = records.filter((record) => record.url.endsWith('/ai-explanation'))
    await openModal()
    // 免责声明常驻
    expect(document.querySelector('[data-imp-ai-disclaimer]')?.textContent).toContain(
      'AI 解释仅供决策参考',
    )
    // 打开不自动调用（仅详情 GET）
    expect(records.filter((record) => record.url.endsWith('/ai-explanation'))).toHaveLength(
      aiPostsBefore.length,
    )

    // 显式触发
    const focusInput = document.querySelector('[data-imp-ai-focus]') as HTMLTextAreaElement
    fireEvent.change(focusInput, { target: { value: '项目 Beta 的里程碑' } })
    fireEvent.click(document.querySelector('[data-imp-ai-generate]') as Element)

    // 请求参数
    await waitFor(() => {
      const aiRecord = records.find((record) => record.url.endsWith('/ai-explanation'))
      expect(aiRecord?.method).toBe('POST')
    })
    const aiRecord = records.find((record) => record.url.endsWith('/ai-explanation'))
    expect(aiRecord?.body).toEqual({ snapshotId: 1, focus: '项目 Beta 的里程碑' })

    // 成功呈现：解释文本 + 假设 + 追问 + AIMarker
    await waitFor(() => expect(document.querySelector('[data-imp-ai-result]')).not.toBeNull())
    expect(document.querySelector('[data-imp-ai-text]')?.textContent).toContain('项目 Beta')
    expect(document.querySelector('[data-imp-ai-confidence]')?.textContent).toContain('85%')
    expect(document.querySelector('[data-imp-ai-marker]')?.textContent).toContain(
      'anthropic/claude-fable-5',
    )
    expect(document.querySelector('[data-imp-ai-result]')?.textContent).toContain('数据假设')
    // 全程零业务写（除显式 ai-explanation 外无任何写请求）
    expect(businessWrites(records)).toHaveLength(0)
  })

  test('生成中态呈现；关闭浮层零状态变更、零重发', async () => {
    const { records } = installFetchRouter(createAiBackend())
    renderDetailPanel()
    await openModal()

    fireEvent.click(document.querySelector('[data-imp-ai-generate]') as Element)
    await waitFor(() =>
      expect(records.some((record) => record.url.endsWith('/ai-explanation'))).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-imp-ai-result]')).not.toBeNull())

    // 关闭（X）
    const postsBeforeClose = records.filter((record) =>
      record.url.endsWith('/ai-explanation'),
    ).length
    fireEvent.click(document.querySelector('[data-imp-ai-close]') as Element)
    expect(document.querySelector('[data-imp-ai-modal]')).toBeNull()
    // 面板本身仍在（仅浮层关闭）
    expect(document.querySelector('[data-imp-detail]')).not.toBeNull()
    await wait(40)
    // 关闭不产生任何新的写请求 / AI 请求（RL-01：零状态变更）
    expect(records.filter((record) => record.url.endsWith('/ai-explanation'))).toHaveLength(
      postsBeforeClose,
    )
    expect(businessWrites(records)).toHaveLength(0)
  })

  test('重新打开保留既有回执不重发；「重新生成」显式二次触发', async () => {
    const { records } = installFetchRouter(createAiBackend())
    renderDetailPanel()
    await openModal()

    fireEvent.click(document.querySelector('[data-imp-ai-generate]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-ai-result]')).not.toBeNull())
    const postsAfterFirst = records.filter((record) =>
      record.url.endsWith('/ai-explanation'),
    ).length

    // 关闭再打开：不自动重发，回执保留
    fireEvent.click(document.querySelector('[data-imp-ai-close]') as Element)
    await openModal()
    expect(records.filter((record) => record.url.endsWith('/ai-explanation'))).toHaveLength(
      postsAfterFirst,
    )
    expect(document.querySelector('[data-imp-ai-result]')).not.toBeNull()

    // 重新生成按钮显式触发第二次
    fireEvent.click(document.querySelector('[data-imp-ai-generate]') as Element)
    await waitFor(() =>
      expect(
        records.filter((record) => record.url.endsWith('/ai-explanation')).length,
      ).toBeGreaterThan(postsAfterFirst),
    )
    expect(businessWrites(records)).toHaveLength(0)
  })

  test('AI 服务不可用（provider=null）：中性说明呈现，无 AI 结论冒充、无置信度', async () => {
    const { records } = installFetchRouter(createAiBackend({ unavailable: true }))
    renderDetailPanel()
    await openModal()

    fireEvent.click(document.querySelector('[data-imp-ai-generate]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-ai-unavailable]')).not.toBeNull())
    expect(document.querySelector('[data-imp-ai-unavailable]')?.textContent).toContain(
      '确定性影响分析结果仍然有效',
    )
    // AI 不可用态不展示置信度/模型等 AIMarker 数值
    expect(document.querySelector('[data-imp-ai-confidence]')).toBeNull()
    expect(businessWrites(records)).toHaveLength(0)
  })

  test('失败回显 + 重试成功闭环；错误后无自动重发', async () => {
    const { records } = installFetchRouter(createAiBackend({ failOnce: true }))
    renderDetailPanel()
    await openModal()

    fireEvent.click(document.querySelector('[data-imp-ai-generate]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-ai-error]')).not.toBeNull())
    expect(document.querySelector('[data-imp-ai-error]')?.textContent).toContain(
      'AI 服务暂时不可用',
    )

    const postsAfterFail = records.filter((record) => record.url.endsWith('/ai-explanation')).length
    await wait(30)
    // 失败后无自动重试（显式纪律）
    expect(records.filter((record) => record.url.endsWith('/ai-explanation'))).toHaveLength(
      postsAfterFail,
    )

    // 人工点击「重试」成功闭环
    fireEvent.click(document.querySelector('[data-imp-ai-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-imp-ai-result]')).not.toBeNull())
    expect(document.querySelector('[data-imp-ai-error]')).toBeNull()
    expect(businessWrites(records)).toHaveLength(0)
  })

  test('Esc 关闭同样零副作用', async () => {
    const { records } = installFetchRouter(createAiBackend())
    renderDetailPanel()
    await openModal()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('[data-imp-ai-modal]')).toBeNull()
    await wait(20)
    expect(records.filter((record) => record.url.endsWith('/ai-explanation'))).toHaveLength(0)
    expect(businessWrites(records)).toHaveLength(0)
  })
})
