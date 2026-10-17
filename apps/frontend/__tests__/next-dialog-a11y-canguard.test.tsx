/**
 * `canClose` 关闭守卫用例（v3-next-track-dialog-a11y-closure · tasks 3.3 / design D4）。
 *
 * 判据（与 hook 的 `canClose?.() ?? true` 语义一致）：
 *   - 在途 mutation（`isPending` 为真）时按 Escape **不关闭**：请求在途的弹层不得因一次按键丢现场；
 *   - 请求落定（`isPending` 转假）后 Escape 正常关闭，且焦点归还触发元素；
 *   - 未传 `canClose` 的弹层默认可关（与接线前的「无守卫」语义一致）。
 *
 * 覆盖的两个含表单/在途判据弹层（tasks 3.3 指定）：
 *   - `PmoImpactPlanRunPanel`——运行影响分析二次确认（`canClose: () => !runMutation.isPending`）；
 *   - `AiConnectionsWorkspace`——新建 AI 连接抽屉（`canClose: () => !createMutation.isPending`）。
 * 另附源码级接线契约断言：两处 hook 调用必须携带以 `isPending` 为判据的 `canClose`，
 * 而无判据的 `PmoAiRationaleModal` 必须**不带** `canClose`（默认放行）——把行为用例钉回调用点，
 * 避免「用例绿但调用点被删」。
 *
 * 环境约定：`requestAnimationFrame` 由 setup 换成 0ms 宏任务 → 焦点落点用 `flushFrame()` 冲刷；
 * 在途态用「不落定的 Promise」制造，落定用 `jsonResponse(500, …)`（失败不关闭弹层，可继续断言 Escape）。
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiConnectionsWorkspace } from '@/components/next/settings/ai/AiConnectionsWorkspace'
import { PmoImpactPlanRunPanel } from '@/components/next/pmo/impact-analysis/PmoImpactPlanRunPanel'
import { PmoAiRationaleModal } from '@/components/next/pmo/ai-priority/PmoAiRationaleModal'
import { useAuthStore } from '@/stores/auth-store'
import { makeMultiProjectImpactPlanFixture } from '@aiproj/types'
import type { PmoRecommendationRecord } from '@aiproj/types'

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

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** 可手动落定的请求：制造「mutation 在途」窗口。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function installFetchRouter(
  route: (path: string, method: string, body?: unknown) => Response | Promise<Response> | null,
) {
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
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = await route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '系统管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
    },
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
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

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function pressEscape() {
  fireEvent.keyDown(document, { key: 'Escape' })
}

function requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`missing element: ${selector}`)
  return element as T
}

/** 是否已是禁用态（在途 mutation 的 DOM 证据，与 canClose 同判据）。 */
function isDisabled(selector: string): boolean {
  return requireElement<HTMLButtonElement>(selector).disabled
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 1. AiConnectionsWorkspace：新建连接（含 API Key 表单）在途拒绝 Escape
// ---------------------------------------------------------------------------

describe('canClose 守卫：AiConnectionsWorkspace 新建连接正在提交', () => {
  beforeEach(() => {
    setAuth(['ai:connection:manage'])
  })

  it('POST 在途时 Escape 不关闭；请求落定后 Escape 关闭并把焦点归还「新建连接」按钮', async () => {
    const createRequest = deferred<Response>()
    installFetchRouter((path, method) => {
      if (path === '/ai/connections' && method === 'GET') return jsonResponse(200, { data: [] })
      if (path === '/ai/connections' && method === 'POST') return createRequest.promise
      return null
    })

    renderWithClient(<AiConnectionsWorkspace />)
    const trigger = await waitFor(() => requireElement('[data-testid="create-connection-button"]'))
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="create-connection-dialog"]')).not.toBeNull(),
    )
    await flushFrame()
    expect(document.activeElement).toBe(requireElement('[data-testid="create-connection-dialog"]'))

    fireEvent.change(requireElement('[data-testid="input-display-name"]'), {
      target: { value: '主生产 OpenAI' },
    })
    fireEvent.change(requireElement('[data-testid="input-model"]'), { target: { value: 'gpt-4o' } })
    fireEvent.change(requireElement('[data-testid="input-api-key"]'), {
      target: { value: 'sk-test-key-123456' },
    })
    fireEvent.click(requireElement('[data-testid="submit-create-button"]'))

    // 在途窗口：提交按钮 disabled，此时 Escape 必须无效（canClose → false）
    await waitFor(() => expect(isDisabled('[data-testid="submit-create-button"]')).toBe(true))
    pressEscape()
    await flushFrame()
    expect(document.querySelector('[data-testid="create-connection-dialog"]')).not.toBeNull()

    // 请求落定（失败 → 弹层保留现场）：isPending 转假，Escape 恢复可关
    createRequest.resolve(
      jsonResponse(500, { error: { code: 'INTERNAL', message: '创建连接失败' } }),
    )
    await waitFor(() => expect(isDisabled('[data-testid="submit-create-button"]')).toBe(false))
    pressEscape()
    await waitFor(() =>
      expect(document.querySelector('[data-testid="create-connection-dialog"]')).toBeNull(),
    )
    expect(document.activeElement).toBe(trigger)
  })
})

// ---------------------------------------------------------------------------
// 2. PmoImpactPlanRunPanel：运行影响分析（在途拒绝 Escape）
// ---------------------------------------------------------------------------

describe('canClose 守卫：PmoImpactPlanRunPanel 运行影响分析正在执行', () => {
  beforeEach(() => {
    setAuth(['portfolio:view', 'multi_project_impact:manage'])
  })

  it('run 请求在途时 Escape 不关闭；请求落定后 Escape 关闭并把焦点归还「运行分析」按钮', async () => {
    const runRequest = deferred<Response>()
    installFetchRouter((path, method) => {
      if (path.endsWith('/multi-project-impact-analyses/plan') && method === 'POST') {
        return jsonResponse(200, { data: makeMultiProjectImpactPlanFixture() })
      }
      if (path.endsWith('/multi-project-impact-analyses/run') && method === 'POST') {
        return runRequest.promise
      }
      return null
    })

    renderWithClient(<PmoImpactPlanRunPanel organizationId={1} />)
    fireEvent.change(requireElement('[data-imp-plan-project-ids]'), { target: { value: '1,3' } })
    fireEvent.click(requireElement('[data-imp-plan-action]'))
    await waitFor(() => expect(document.querySelector('[data-imp-plan-summary]')).not.toBeNull())

    const trigger = requireElement('[data-imp-run-open]')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-imp-run-confirm-dialog]')).not.toBeNull(),
    )
    await flushFrame()
    expect(document.activeElement).toBe(requireElement('[data-imp-run-confirm-dialog]'))

    fireEvent.click(requireElement('[data-imp-run-confirm]'))

    // 在途窗口：确认按钮 disabled，此时 Escape 必须无效（canClose → false）
    await waitFor(() => expect(isDisabled('[data-imp-run-confirm]')).toBe(true))
    pressEscape()
    await flushFrame()
    expect(document.querySelector('[data-imp-run-confirm-dialog]')).not.toBeNull()

    // 请求落定（失败 → 确认弹层保留）：Escape 恢复可关
    runRequest.resolve(
      jsonResponse(500, { error: { code: 'INTERNAL', message: '运行影响分析失败' } }),
    )
    await waitFor(() => expect(isDisabled('[data-imp-run-confirm]')).toBe(false))
    pressEscape()
    await waitFor(() => expect(document.querySelector('[data-imp-run-confirm-dialog]')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})

// ---------------------------------------------------------------------------
// 3. 无 canClose 的弹层默认放行
// ---------------------------------------------------------------------------

function makeRecord(): PmoRecommendationRecord {
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
  }
}

function RationaleHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" data-rationale-open onClick={() => setOpen(true)}>
        打开 AI 理由浮层
      </button>
      <PmoAiRationaleModal
        id={7}
        record={makeRecord()}
        open={open}
        onClose={() => {
          setOpen(false)
          onClose()
        }}
      />
    </>
  )
}

describe('canClose 缺省：无判据的弹层默认可关', () => {
  beforeEach(() => {
    setAuth(['portfolio:view', 'recommendation:manage'])
  })

  it('PmoAiRationaleModal 未传 canClose → Escape 默认关闭并把焦点归还触发按钮', async () => {
    const onClose = vi.fn()
    renderWithClient(<RationaleHarness onClose={onClose} />)

    const trigger = requireElement('[data-rationale-open]')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-ai-rationale-modal]')).not.toBeNull(),
    )
    await flushFrame()
    expect(document.activeElement).toBe(requireElement('[data-pmo-ai-rationale-modal]'))

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.querySelector('[data-pmo-ai-rationale-modal]')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})

// ---------------------------------------------------------------------------
// 4. 接线契约（源码级）：canClose 判据钉在调用点
// ---------------------------------------------------------------------------

const FRONTEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 取 `useDialogA11y({...})` 实参块（平衡括号）。 */
function hookCallBodies(relativePath: string): string[] {
  const source = readFileSync(join(FRONTEND_ROOT, relativePath), 'utf8')
  const bodies: string[] = []
  const pattern = /useDialogA11y\s*\(/g
  let match = pattern.exec(source)
  while (match) {
    const openIndex = source.indexOf('(', match.index)
    let depth = 0
    let end = openIndex
    for (let i = openIndex; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    bodies.push(source.slice(openIndex, end + 1))
    match = pattern.exec(source)
  }
  return bodies
}

describe('接线契约：canClose 判据出现在调用点', () => {
  it('PmoImpactPlanRunPanel / AiConnectionsWorkspace 的 hook 调用携带以 isPending 为判据的 canClose', () => {
    const pmoCalls = hookCallBodies('components/next/pmo/impact-analysis/PmoImpactPlanRunPanel.tsx')
    expect(pmoCalls, 'PmoImpactPlanRunPanel 未找到 useDialogA11y 调用').toHaveLength(1)
    expect(pmoCalls[0], 'PmoImpactPlanRunPanel 的 hook 调用缺少 canClose').toContain('canClose')
    expect(
      pmoCalls[0],
      'PmoImpactPlanRunPanel 的 canClose 未以 runMutation.isPending 为判据',
    ).toContain('runMutation.isPending')

    const aiCalls = hookCallBodies('components/next/settings/ai/AiConnectionsWorkspace.tsx')
    expect(
      aiCalls,
      'AiConnectionsWorkspace 应有 2 处 useDialogA11y 调用（新建抽屉 + 删除二次确认）',
    ).toHaveLength(2)
    expect(aiCalls[0], 'AiConnectionsWorkspace 新建抽屉 hook 调用缺少 canClose').toContain(
      'canClose',
    )
    expect(
      aiCalls[0],
      'AiConnectionsWorkspace 新建抽屉 canClose 未以 createMutation.isPending 为判据',
    ).toContain('createMutation.isPending')
    expect(aiCalls[1], 'AiConnectionsWorkspace 删除确认 hook 调用缺少 canClose').toContain(
      'canClose',
    )
    expect(
      aiCalls[1],
      'AiConnectionsWorkspace 删除确认 canClose 未以 deleteMutation.isPending 为判据',
    ).toContain('deleteMutation.isPending')
  })

  it('PmoAiRationaleModal 的 hook 调用不带 canClose（默认放行，与行为用例互为佐证）', () => {
    const calls = hookCallBodies('components/next/pmo/ai-priority/PmoAiRationaleModal.tsx')
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('canClose')
  })
})
