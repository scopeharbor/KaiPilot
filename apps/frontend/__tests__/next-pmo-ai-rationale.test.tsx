/**
 * v3-ui-next-pmo-domain W5 · tasks 5.5 —— PMO AI 优先级推荐「AI 理由」显式触发
 * 浮层：免责声明、生成中/可用/过期/失败/不可用状态、关闭零状态变更（RL-01）。
 *
 * 覆盖（spec「PMO AI 优先级推荐建议-审阅-采纳闭环」AI 理由辅助场景）：
 * - 仅显式点击「生成 AI 理由」才发起 POST …/:id/ai-rationale，浮层打开本身零请求；
 * - 浮层顶部常驻免责声明「AI 理由仅供决策参考，未经人工确认不会执行任何变更」；
 * - 生成中态（aria-busy）/ 可用态（叙述文本 + AIMarker 供应商/置信度）/ stale 黄色
 *   警示 + 重新生成 / failed 失败原因回显 + 重试 / unavailable 禁用说明；
 * - 关闭浮层不改变推荐状态：网络监控断言全程无 POST …/status 写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PmoAiRecommendationDetailPanel } from '@/components/next/pmo/ai-priority/PmoAiRecommendationDetailPanel'
import { useAuthStore } from '@/stores/auth-store'
import type { PmoRecommendationRecord } from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const envelopeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiFetchEnvelope: envelopeMock }))

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const NOW = '2026-08-20T08:00:00.000Z'

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
      topDimensionContributors: ['delivery_urgency', 'risk_exposure'],
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const AVAILABLE_AI_METADATA = {
  provider: 'mock-pmo',
  model: 'mock-pmo-recommendation',
  inputTokens: null,
  outputTokens: 120,
  totalCost: null,
  currency: 'CNY',
  latencyMs: 240,
  inputSignature: 'sig-input',
  outputHash: 'hash-1',
  status: 'pending' as const,
  failureCode: null,
  failureMessage: null,
  narrative:
    '推荐理由：该项目持续两周红灯且关键路径滑移，建议管理层本周内完成复核并决策。（AI 理由草案——待审查）',
  focusPoints: [],
  suggestedActions: [],
  assumptions: [],
  confidence: 0.3,
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectReason: null,
  generatedAt: NOW,
}

/** 可变服务端记录：AI 理由生成成功后详情 refetch 返回更新态。 */
function mutableServer() {
  const record = makeRecord()
  let rationaleCalls = 0
  let failNext = false
  envelopeMock.mockImplementation((path: string, init?: RequestInit) => {
    const url = String(path)
    const method = init?.method ?? 'GET'
    if (url.includes('/summary')) {
      return Promise.resolve({ data: null })
    }
    if (method === 'POST' && url.endsWith('/ai-rationale')) {
      rationaleCalls += 1
      if (failNext) {
        failNext = false
        return Promise.reject(Object.assign(new Error('AI 服务超时'), { status: 502 }))
      }
      record.aiStatus = 'available'
      record.aiMetadata = AVAILABLE_AI_METADATA
      return Promise.resolve({ data: { aiMetadata: AVAILABLE_AI_METADATA, record } })
    }
    if (method === 'POST') {
      // status 等其它写入一律拒绝——测试全程不应出现
      return Promise.reject(Object.assign(new Error('意外写入'), { status: 405 }))
    }
    const detailMatch = url.match(/^\/pmo\/ai-priority-recommendations\/(\d+)$/)
    if (detailMatch) {
      return Promise.resolve({
        data: { record, sourceWarnings: [], conversionIntents: [] },
      })
    }
    return Promise.resolve({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      summary: null,
    })
  })
  return {
    record,
    get rationaleCalls() {
      return rationaleCalls
    },
    set failNext(v: boolean) {
      failNext = v
    },
  }
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pmo@example.com',
      fullName: '组合管理员',
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

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoAiRecommendationDetailPanel id={7} onClose={() => undefined} />
    </QueryClientProvider>,
  )
}

async function openModal() {
  await waitFor(() => expect(document.querySelector('[data-pmo-ai-rationale-open]')).not.toBeNull())
  fireEvent.click(document.querySelector('[data-pmo-ai-rationale-open]') as HTMLElement)
  await waitFor(() =>
    expect(document.querySelector('[data-pmo-ai-rationale-modal]')).not.toBeNull(),
  )
}

function writeCalls(): Array<{ path: string; body: Record<string, unknown> }> {
  return envelopeMock.mock.calls
    .filter((call) => {
      const init = call[1] as RequestInit | undefined
      return init?.method && init.method !== 'GET'
    })
    .map((call) => ({
      path: String(call[0]),
      body: JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? '{}')) as Record<
        string,
        unknown
      >,
    }))
}

beforeEach(() => {
  envelopeMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 显式触发与零自动写
// ---------------------------------------------------------------------------

describe('AI 理由浮层：显式触发与免责（RL-01）', () => {
  test('打开浮层零请求；仅点击「生成 AI 理由」才 POST /ai-rationale（幂等键载荷）', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    mutableServer()
    renderPanel()
    await openModal()

    // 打开本身无任何写请求；免责声明常驻
    expect(writeCalls()).toHaveLength(0)
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement
    expect(within(modal).getByText(/AI 理由仅供决策参考/)).toBeInTheDocument()
    expect(within(modal).getByText(/不会执行任何变更/)).toBeInTheDocument()
    expect(modal.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toBe('无 AI 理由')

    // 显式点击生成 → POST …/7/ai-rationale
    fireEvent.click(within(modal).getByText('生成 AI 理由'))
    await waitFor(() => {
      const writes = writeCalls()
      expect(writes.some((call) => call.path.endsWith('/7/ai-rationale'))).toBe(true)
    })
    const body = writeCalls().find((call) => call.path.endsWith('/7/ai-rationale'))?.body as {
      idempotencyKey?: string
    }
    expect(typeof body.idempotencyKey).toBe('string')
    expect(body.idempotencyKey?.startsWith('pmo-ai-rationale:7:')).toBe(true)
  })

  test('生成成功后呈现叙述文本与 AIMarker（供应商/置信度）；重新生成再次 POST', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    const server = mutableServer()
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    fireEvent.click(within(modal).getByText('生成 AI 理由'))
    await waitFor(() => expect(modal.querySelector('[data-pmo-ai-rationale-text]')).not.toBeNull())
    expect(modal.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toBe('可用')
    const textEl = modal.querySelector('[data-pmo-ai-rationale-text]') as HTMLElement
    expect(textEl.textContent).toContain('该项目持续两周红灯且关键路径滑移')
    const marker = modal.querySelector('[data-pmo-ai-rationale-marker]') as HTMLElement
    expect(marker.textContent).toContain('mock-pmo')
    expect(marker.textContent).toContain('置信度 30%')
    // 服务端记录已随 refetch 更新（AIMarker 双通道：状态文本）
    expect(server.record.aiStatus).toBe('available')

    // 重新生成（可用态刷新重取）
    const before = server.rationaleCalls
    fireEvent.click(within(modal).getByText('重新生成'))
    await waitFor(() => expect(server.rationaleCalls).toBe(before + 1))
  })

  test('生成失败：失败原因回显并可重试；推荐状态不发生任何变化', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    const server = mutableServer()
    server.failNext = true
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    fireEvent.click(within(modal).getByText('生成 AI 理由'))
    await waitFor(() =>
      expect(modal.querySelector('[data-pmo-ai-rationale-action-error]')).not.toBeNull(),
    )
    expect(within(modal).getByText('AI 服务超时')).toBeInTheDocument()
    // 失败不触碰记录状态（服务端未落盘）
    expect(server.record.aiStatus).toBe('none')

    // 显式重试成功（无 AI 理由态保留生成入口）
    fireEvent.click(within(modal).getByText('生成 AI 理由'))
    await waitFor(() => expect(modal.querySelector('[data-pmo-ai-rationale-text]')).not.toBeNull())
  })

  test('关闭浮层（生成成功前后）均无任何状态写请求（RL-01 零自动采纳）', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    mutableServer()
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    // 生成 → 呈现 → 关闭
    fireEvent.click(within(modal).getByText('生成 AI 理由'))
    await waitFor(() => expect(modal.querySelector('[data-pmo-ai-rationale-text]')).not.toBeNull())
    fireEvent.click(within(modal).getByText('关闭'))
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-rationale-modal]')).toBeNull())
    // 网络监控：全程只有 /ai-rationale 触发，绝无 /status 写请求
    const writes = writeCalls()
    expect(writes.every((call) => call.path.endsWith('/ai-rationale'))).toBe(true)
    expect(writes.some((call) => call.path.includes('/status'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 状态呈现：过期 / 失败 / 不可用 / 权限
// ---------------------------------------------------------------------------

describe('AI 理由浮层：状态呈现与权限', () => {
  test('stale 记录：叙述保留 + 黄色过期警示 + 重新生成入口', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    const server = mutableServer()
    server.record.aiStatus = 'stale'
    server.record.aiMetadata = { ...AVAILABLE_AI_METADATA, generatedAt: NOW }
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    expect(modal.querySelector('[data-pmo-ai-rationale-stale]')).not.toBeNull()
    expect(within(modal).getByText(/已超过新鲜度阈值/)).toBeInTheDocument()
    expect(modal.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toBe('已过期')
    expect(modal.querySelector('[data-pmo-ai-rationale-text]')).not.toBeNull()
    expect(within(modal).getByText('重新生成')).toBeInTheDocument()
  })

  test('failed 记录：失败块回显 failureCode/failureMessage；推荐状态不变', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    const server = mutableServer()
    server.record.aiStatus = 'failed'
    server.record.aiMetadata = {
      ...AVAILABLE_AI_METADATA,
      status: 'failed',
      narrative: null,
      failureCode: 'AI_GENERATION_FAILED',
      failureMessage: '模型输出超时',
      confidence: 0,
    }
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    const failed = modal.querySelector('[data-pmo-ai-rationale-failed]') as HTMLElement
    expect(failed).not.toBeNull()
    expect(failed.textContent).toContain('模型输出超时')
    expect(failed.textContent).toContain('AI_GENERATION_FAILED')
    expect(modal.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toBe('生成失败')
    expect(writeCalls()).toHaveLength(0)
  })

  test('unavailable：不可用说明 + 生成入口禁用（不发请求）', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    const server = mutableServer()
    server.record.aiStatus = 'unavailable'
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    expect(within(modal).getByText(/AI 服务当前不可用/)).toBeInTheDocument()
    const generate = modal.querySelector('[data-pmo-ai-rationale-generate]') as HTMLButtonElement
    expect(generate).not.toBeNull()
    expect(generate.disabled).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeCalls()).toHaveLength(0)
  })

  test('无管理权限（MEMBER）：生成 AI 理由入口物理隐藏（RL-06）', async () => {
    setAuth(['portfolio:view'])
    const server = mutableServer()
    renderPanel()
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-detail]')).not.toBeNull())
    expect(document.querySelector('[data-pmo-ai-rationale-open]')).toBeNull()
    expect(document.querySelector('[data-pmo-ai-rationale-modal]')).toBeNull()
    // 详情只读呈现 AI 状态，但无写入口
    expect(server.record.aiStatus).toBe('none')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writeCalls()).toHaveLength(0)
  })

  test('生成中态：aria-busy + 「生成中」文案；完成后自动收起生成态', async () => {
    setAuth(['portfolio:view', 'recommendation:manage'])
    // 可控延迟的服务端：POST 悬空 300ms 以便断言生成中态，成功后详情 refetch 返回可用记录
    const record = makeRecord()
    envelopeMock.mockImplementation((path: string, init?: RequestInit) => {
      const url = String(path)
      const method = init?.method ?? 'GET'
      if (url.includes('/summary')) return Promise.resolve({ data: null })
      if (method === 'POST' && url.endsWith('/ai-rationale')) {
        return new Promise((resolve) => {
          setTimeout(() => {
            record.aiStatus = 'available'
            record.aiMetadata = AVAILABLE_AI_METADATA
            resolve({ data: { aiMetadata: AVAILABLE_AI_METADATA, record } })
          }, 300)
        })
      }
      if (method === 'POST') {
        return Promise.reject(Object.assign(new Error('意外写入'), { status: 405 }))
      }
      const detailMatch = url.match(/^\/pmo\/ai-priority-recommendations\/(\d+)$/)
      if (detailMatch) {
        return Promise.resolve({ data: { record, sourceWarnings: [], conversionIntents: [] } })
      }
      return Promise.resolve({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
        summary: null,
      })
    })
    renderPanel()
    await openModal()
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]') as HTMLElement

    fireEvent.click(within(modal).getByText('生成 AI 理由'))
    // 悬空期：生成中态（aria-busy + 生成中文案 + 状态徽标）
    await waitFor(
      () => expect(modal.querySelector('[data-pmo-ai-rationale-generating]')).not.toBeNull(),
      { timeout: 250 },
    )
    const generating = modal.querySelector('[data-pmo-ai-rationale-generating]') as HTMLElement
    expect(generating.getAttribute('aria-busy')).toBe('true')
    expect(modal.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toBe('生成中')

    // 完成后：详情 refetch → 可用 + 叙述文本
    await waitFor(() => expect(modal.querySelector('[data-pmo-ai-rationale-text]')).not.toBeNull())
    expect(modal.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toBe('可用')
    expect(record.aiStatus).toBe('available')
  })
})
