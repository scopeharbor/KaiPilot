/**
 * v3-ui-next-risk-change-domains W1 · tasks 1.4 —— 风险看板、复查队列与规则候选测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「风险态势总览看板 / 工作台核心队列展示」场景）：
 * - RiskStatCards：四项态势指标计算（高危严重合并数）、健康分色标渲染、骨架态
 *   与错误重试；
 * - RiskReviewQueue：队列渲染（等级 / 责任人 / 下次复查日期）、逾期项高亮、
 *   提交复查结论弹窗（conclusion + nextAction 必填）与 POST 载荷；
 * - RiskCandidateList：规则评估触发（骨架 → 清单）、证据链展开、确认采纳弹窗
 *   转为正式风险（POST accept）并移出队列、拒绝移出（POST reject）、
 *   无写能力时评估入口物理隐藏。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { RiskStatCards } from '@/components/next/risks/RiskStatCards'
import { RiskReviewQueue } from '@/components/next/risks/RiskReviewQueue'
import { RiskCandidateList } from '@/components/next/risks/RiskCandidateList'
import type { RiskReviewItem, RiskSignalCandidate, RiskWorkbenchSummary } from '@/lib/api/risks-v2'

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
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
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ) => Response | Promise<Response | null> | null,
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
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

/** 手动放行 deferred：测试中门控接口响应以断言确定性中间态。 */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

function makeSummary(overrides: Partial<RiskWorkbenchSummary> = {}): RiskWorkbenchSummary {
  return {
    totalRisks: 6,
    openRisks: 5,
    highRiskCount: 2,
    criticalRiskCount: 1,
    overdueReviewCount: 1,
    incompleteResponsePlans: 1,
    trend30d: { created: 3, closed: 1 },
    healthScore: 72,
    topRisks: [
      {
        id: 101,
        title: '核心数据库迁移导致服务中断',
        riskLevel: 'critical',
        score: 20,
        status: 'identified',
      },
      { id: 103, title: '关键开发人员离职', riskLevel: 'high', score: 16, status: 'mitigating' },
    ],
    ...overrides,
  }
}

function makeQueue(): RiskReviewItem[] {
  return [
    {
      id: 103,
      title: '关键开发人员离职',
      riskLevel: 'high',
      score: 16,
      nextReviewAt: '2025-10-01T00:00:00.000Z',
      lastReviewAt: '2025-08-01T00:00:00.000Z',
      ownerId: 1,
    },
    {
      id: 101,
      title: '核心数据库迁移导致服务中断',
      riskLevel: 'critical',
      score: 20,
      nextReviewAt: '2099-01-15T00:00:00.000Z',
      lastReviewAt: null,
      ownerId: null,
    },
  ]
}

function makeCandidates(): RiskSignalCandidate[] {
  return [
    {
      id: 501,
      ruleId: 'R003-critical-path-slip',
      ruleVersion: '1.2.0',
      severity: 'high',
      evidence: [
        {
          type: 'task',
          id: 77,
          title: '核心网关联调',
          detail: '前序依赖延迟 4 天，存在级联滑移',
        },
        {
          type: 'milestone',
          id: 8,
          title: 'UAT 验收',
          detail: '关键路径触碰发布里程碑',
        },
      ],
      recommendedAction: '为核心网关联调预留 3 天缓冲并前置资源确认',
      confidence: 0.85,
      source: 'risk-signal-evaluator',
      templateId: null,
      idempotencyKey: 'k-501',
      expiresAt: '2099-12-31T00:00:00.000Z',
      status: 'pending',
    },
    {
      id: 502,
      ruleId: 'R007-resource-overload',
      ruleVersion: '1.0.0',
      severity: 'medium',
      evidence: [{ type: 'resource', id: 3, title: '前端组负载 132%', detail: '连续两周超载' }],
      recommendedAction: '调整任务分配或引入外部支援以降低前端组负载',
      confidence: 0.72,
      source: 'risk-signal-evaluator',
      templateId: null,
      idempotencyKey: 'k-502',
      expiresAt: '2099-12-31T00:00:00.000Z',
      status: 'pending',
    },
  ]
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function resetAuth() {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  resetAuth()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('RiskStatCards：四项态势指标与健康分色标（tasks 1.3/1.4）', () => {
  test('指标卡渲染：高危严重合并计数 + 健康分色标（≥60 success）', async () => {
    setAuth(['risk:view'])
    installFetchRouter((path, method) => {
      if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
        return jsonResponse(200, { data: makeSummary() })
      }
      return null
    })
    renderWithClient(<RiskStatCards projectId={42} onOpenRisk={() => undefined} />)

    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
    const total = document.querySelector('[data-risk-stat-kind="total"]')
    expect(total?.textContent).toContain('6')
    const highCritical = document.querySelector('[data-risk-stat-kind="highcritical"]')
    expect(highCritical?.textContent).toContain('3')
    expect(highCritical?.textContent).toContain('高危/严重风险')
    const overdue = document.querySelector('[data-risk-stat-kind="overdue"]')
    expect(overdue?.textContent).toContain('1')
    const health = document.querySelector('[data-risk-stat-kind="health"]')
    expect(health?.textContent).toContain('72')
    expect(health?.getAttribute('data-health-tone')).toBe('success')

    // Top 高危简表
    expect(document.querySelectorAll('[data-risk-top-risk]')).toHaveLength(2)
    expect(screen.getByText('核心数据库迁移导致服务中断')).toBeInTheDocument()
  })

  test('健康分低于 60：warning 色标', async () => {
    setAuth(['risk:view'])
    installFetchRouter((path, method) => {
      if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
        return jsonResponse(200, { data: makeSummary({ healthScore: 42 }) })
      }
      return null
    })
    renderWithClient(<RiskStatCards projectId={42} onOpenRisk={() => undefined} />)

    await waitFor(() =>
      expect(document.querySelector('[data-risk-stat-kind="health"]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-risk-stat-kind="health"]')?.getAttribute('data-health-tone'),
    ).toBe('warning')
  })

  test('加载中呈现骨架（aria-busy）且不闪现空态', async () => {
    setAuth(['risk:view'])
    const gate = deferred<void>()
    installFetchRouter(async (path, method) => {
      if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
        await gate.promise
        return jsonResponse(200, { data: makeSummary() })
      }
      return null
    })
    renderWithClient(<RiskStatCards projectId={42} onOpenRisk={() => undefined} />)

    const skeleton = document.querySelector('[data-risk-stat-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-risk-top-risks]')).toBeNull()
    gate.resolve()
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
  })

  test('摘要接口失败：规范错误卡 + 「重新载入」重试成功闭环', async () => {
    setAuth(['risk:view'])
    let failed = true
    installFetchRouter((path, method) => {
      if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
        if (failed) {
          return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { data: makeSummary() })
      }
      return null
    })
    renderWithClient(<RiskStatCards projectId={42} onOpenRisk={() => undefined} />)

    await waitFor(() => expect(document.querySelector('[data-risk-summary-error]')).not.toBeNull())
    expect(screen.getByText('风险态势摘要加载失败，请稍后重试')).toBeInTheDocument()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
  })
})

// ---------------------------------------------------------------------------
describe('RiskReviewQueue：队列渲染、逾期高亮与复查提交（tasks 1.3/1.4）', () => {
  function queueBackend() {
    const queue = makeQueue()
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42/risks/workbench/review-queue' && method === 'GET') {
        return jsonResponse(200, { data: queue })
      }
      if (path === '/projects/42/risks/103/review' && method === 'POST') {
        // 复查成功：目标移出待复查队列
        const index = queue.findIndex((item) => item.id === 103)
        if (index >= 0) queue.splice(index, 1)
        return jsonResponse(200, { data: { id: 103, title: '关键开发人员离职' } })
      }
      return null
    }
    return { queue, route }
  }

  test('队列渲染：等级 / 责任人 / 下次复查日期；逾期项高亮「已逾期」', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = queueBackend()
    installFetchRouter(backend.route)
    renderWithClient(<RiskReviewQueue projectId={42} />)

    await waitFor(() =>
      expect(document.querySelectorAll('[data-risk-review-item]')).toHaveLength(2),
    )
    // 逾期项（2025 年复查日期）
    const overdueItem = document.querySelector('[data-risk-review-item="103"]')
    expect(overdueItem?.getAttribute('data-review-overdue')).toBe('true')
    expect(overdueItem?.querySelector('[data-review-overdue-badge]')?.textContent).toContain(
      '已逾期',
    )
    expect(overdueItem?.textContent).toContain('责任人：#1')
    expect(overdueItem?.textContent).toContain('敞口 16 分')
    expect(overdueItem?.textContent).toContain('2025-10-01')
    // 未逾期项（未来复查日期）无逾期标记
    const normalItem = document.querySelector('[data-risk-review-item="101"]')
    expect(normalItem?.getAttribute('data-review-overdue')).toBeNull()
    expect(normalItem?.querySelector('[data-review-overdue-badge]')).toBeNull()
    expect(normalItem?.textContent).toContain('2099-01-15')
  })

  test('提交复查：结论与后续行动必填，POST /review 载荷正确，成功后弹窗关闭', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = queueBackend()
    const { records } = installFetchRouter(backend.route)
    renderWithClient(<RiskReviewQueue projectId={42} />)

    await waitFor(() =>
      expect(document.querySelectorAll('[data-risk-review-item]')).toHaveLength(2),
    )
    fireEvent.click(screen.getByRole('button', { name: '提交 关键开发人员离职 的复查' }))

    const dialog = document.querySelector('[data-risk-review-dialog]')
    expect(dialog).not.toBeNull()
    // 未填结论：提交禁用
    expect(
      (screen.getByRole('button', { name: '提交复查结论' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.change(screen.getByLabelText(/复查结论/), {
      target: { value: '人员风险升级，双人复核机制已启动' },
    })
    fireEvent.change(screen.getByLabelText(/后续行动/), {
      target: { value: '两周内完成知识库交接并启动招聘备份' },
    })
    fireEvent.change(screen.getByLabelText(/下次复查日期/), { target: { value: '2099-02-01' } })
    expect(
      (screen.getByRole('button', { name: '提交复查结论' }) as HTMLButtonElement).disabled,
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '提交复查结论' }))

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks/103/review' &&
            record.body?.conclusion === '人员风险升级，双人复核机制已启动' &&
            record.body?.nextAction === '两周内完成知识库交接并启动招聘备份' &&
            String(record.body?.nextReviewAt).startsWith('2099-02-01'),
        ),
      ).toBe(true),
    )
    // 弹窗关闭 + 目标移出队列（刷新后仅剩 1 条）
    await waitFor(() => expect(document.querySelector('[data-risk-review-dialog]')).toBeNull())
    await waitFor(() =>
      expect(document.querySelectorAll('[data-risk-review-item]')).toHaveLength(1),
    )
    expect(screen.queryByText('关键开发人员离职')).toBeNull()
  })

  test('无 risk:manage/risk:update：复查按钮物理隐藏（只读队列）', async () => {
    setAuth(['risk:view'])
    const backend = queueBackend()
    const { records } = installFetchRouter(backend.route)
    renderWithClient(<RiskReviewQueue projectId={42} />)

    await waitFor(() =>
      expect(document.querySelectorAll('[data-risk-review-item]')).toHaveLength(2),
    )
    expect(screen.queryByRole('button', { name: /提交 .* 的复查/ })).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('RiskCandidateList：规则评估、采纳确认与拒绝（tasks 1.3/1.4）', () => {
  function candidatesBackend() {
    const candidates = makeCandidates()
    const acceptedIds: number[] = []
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42/risks/evaluate-candidates' && method === 'POST') {
        const pending = candidates.filter(
          (candidate) => candidate.status === 'pending' && !acceptedIds.includes(candidate.id),
        )
        return jsonResponse(200, { data: pending })
      }
      const acceptMatch = path.match(/^\/projects\/42\/risks\/candidates\/(\d+)\/accept$/)
      if (acceptMatch && method === 'POST') {
        acceptedIds.push(Number(acceptMatch[1]))
        return jsonResponse(201, { data: { id: 999, title: '已转正式风险' } })
      }
      const rejectMatch = path.match(/^\/projects\/42\/risks\/candidates\/(\d+)\/reject$/)
      if (rejectMatch && method === 'POST') {
        const target = candidates.find((candidate) => candidate.id === Number(rejectMatch[1]))
        if (target) target.status = 'rejected'
        return jsonResponse(200, { data: { rejected: true } })
      }
      return null
    }
    return { route }
  }

  test('规则评估：触发 → 骨架 → 清单（置信度 / 规则 ID / 证据链展开）', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = candidatesBackend()
    const gate = deferred<void>()
    installFetchRouter(async (path, method) => {
      if (path === '/projects/42/risks/evaluate-candidates' && method === 'POST') {
        await gate.promise
      }
      return backend.route(path, method)
    })
    renderWithClient(<RiskCandidateList projectId={42} canEvaluate />)

    // 初始空态（无评估请求）
    await waitFor(() =>
      expect(document.querySelector('[data-risk-candidates-empty]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-risk-candidates-evaluate]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '规则评估' }))
    // 评估中骨架（aria-busy）：门控请求未返回前恒定存在
    await waitFor(() =>
      expect(document.querySelector('[data-risk-candidates-skeleton]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-risk-candidates-skeleton]')?.getAttribute('aria-busy'),
    ).toBe('true')
    gate.resolve()

    await waitFor(() => expect(document.querySelectorAll('[data-risk-candidate]')).toHaveLength(2))
    expect(screen.getByText('R003-critical-path-slip · v1.2.0')).toBeInTheDocument()
    const firstCard = document.querySelector('[data-risk-candidate="501"]')
    expect(firstCard?.textContent).toContain('置信度 85%')
    expect(firstCard?.textContent).toContain('为核心网关联调预留 3 天缓冲并前置资源确认')

    // 证据链展开
    fireEvent.click(screen.getByRole('button', { name: '查看证据链（2）' }))
    const evidence = document.querySelector('[data-risk-candidate-evidence]')
    expect(evidence?.textContent).toContain('核心网关联调')
    expect(evidence?.textContent).toContain('UAT 验收')
    fireEvent.click(screen.getByRole('button', { name: '收起证据链' }))
    expect(document.querySelector('[data-risk-candidate-evidence]')).toBeNull()
  })

  test('确认采纳：弹窗展示推荐行动/置信度/证据，POST accept 后条目移出队列', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const { records } = installFetchRouter(candidatesBackend().route)
    renderWithClient(<RiskCandidateList projectId={42} canEvaluate />)

    fireEvent.click(screen.getByRole('button', { name: '规则评估' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-candidate]')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: /采纳候选：为核心网关联调预留/ }))
    const dialog = document.querySelector('[data-risk-candidate-confirm]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('置信度 85%')
    expect(dialog?.textContent).toContain('核心网关联调')
    expect(dialog?.textContent).toContain('R003-critical-path-slip')

    fireEvent.click(screen.getByRole('button', { name: '确认采纳' }))
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' && record.url === '/projects/42/risks/candidates/501/accept',
        ),
      ).toBe(true),
    )
    // 弹窗关闭 + 已采纳条目移出，剩余 502
    await waitFor(() => expect(document.querySelector('[data-risk-candidate-confirm]')).toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-risk-candidate]')).toHaveLength(1))
    expect(document.querySelector('[data-risk-candidate="502"]')).not.toBeNull()
  })

  test('拒绝候选：POST reject 后条目直接移出队列', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const { records } = installFetchRouter(candidatesBackend().route)
    renderWithClient(<RiskCandidateList projectId={42} canEvaluate />)

    fireEvent.click(screen.getByRole('button', { name: '规则评估' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-candidate]')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /拒绝候选：为核心网关联调预留/ }))

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' && record.url === '/projects/42/risks/candidates/501/reject',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-candidate]')).toHaveLength(1))
    expect(document.querySelector('[data-risk-candidate="501"]')).toBeNull()
    expect(document.querySelector('[data-risk-candidate="502"]')).not.toBeNull()
  })

  test('无写能力（canEvaluate=false）：评估与采纳/拒绝入口物理隐藏，且零请求', async () => {
    setAuth(['risk:view'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<RiskCandidateList projectId={42} canEvaluate={false} />)

    await waitFor(() =>
      expect(document.querySelector('[data-risk-candidates-empty]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-risk-candidates-evaluate]')).toBeNull()
    expect(records).toHaveLength(0)
  })
})
