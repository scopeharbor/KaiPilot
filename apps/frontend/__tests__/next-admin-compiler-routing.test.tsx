/**
 * v3-ui-next-settings-admin-domains W7 · tasks 7.5 —— 编译器路由工作区测试
 * （spec「管理后台平台运营与信任控制台」要求 2）。
 *
 * 覆盖：
 * - 规则列表/查看器渲染与运行统计只读区；
 * - 模拟面板运行（dry-run）与结果呈现；
 * - 编辑器保存确认流：未预览禁止落库 / 预览后取消零写请求 / 确认后携 confirmToken 落库；
 * - 只读态（无 `ai:compiler:routing:manage`）隐藏编辑器 Tab 与写控件；
 * - 服务端错误回显（预览失败 / 落库失败）；
 * - 三态：骨架（aria-busy）/ 空态 / 错误卡「重新载入」重试。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { CompilerRoutingWorkspace } from '@/components/next/admin/compiler-routing/CompilerRoutingWorkspace'
import type { RoutingRuleView } from '@aiproj/types/compiler-dynamic-routing'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/admin/compiler-routing',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body?: string
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
  route: (path: string, method: string, body: string | undefined) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : undefined
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CompilerRoutingWorkspace />
    </QueryClientProvider>,
  )
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

function q<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!node) throw new Error(`未找到元素：${selector}`)
  return node as T
}

function setAuth(
  permissions: string[],
  planTier: 'free' | 'team' | 'enterprise' | null = 'enterprise',
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '系统管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const RULE: RoutingRuleView = {
  id: 'default-plan-v1',
  version: { major: 1, minor: 0 },
  compatibleContracts: { min: '1.0', max: '2.0' },
  scenarioKinds: ['default_plan'],
  allowedStageIds: ['intent_ingestion'],
  allowedSkippedStageIds: [],
  reasonCode: 'ROUTE_DEFAULT_PLAN',
  isDefault: true,
  enabled: true,
  source: 'code_default',
}

const ORG_RULE: RoutingRuleView = {
  ...RULE,
  id: 'org-rule-v2',
  enabled: false,
  isDefault: false,
  source: 'org_persisted',
}

/** 伪后端：rules（apiFetch 解包，无信封）+ simulate + preview + confirm。 */
function routingBackend(
  overrides: {
    rules?: RoutingRuleView[]
    previewFails?: boolean
    confirmFails?: boolean
    sendEnvelope?: boolean
  } = {},
) {
  const rules = overrides.rules ?? [RULE, ORG_RULE]
  return (path: string, method: string): Response | null => {
    if (path.endsWith('/ai/compiler/routing/rules') && method === 'GET') {
      const payload = { data: { version: 'reg-1', rules, ruleCount: rules.length } }
      return jsonResponse(200, overrides.sendEnvelope ? payload : payload.data)
    }
    if (path.endsWith('/ai/compiler/routing/simulate') && method === 'POST') {
      return jsonResponse(200, {
        data: {
          simulated: true,
          decision: {
            inputHash: 'h',
            ruleVersion: null,
            ruleId: null,
            scenarioKind: 'default_plan',
            selectedStageCount: 3,
            originalStageCount: 3,
            reasonCode: 'ROUTE_DEFAULT_PLAN',
            isFallback: true,
            runId: 0,
            createdAt: '2026-09-10T08:00:00.000Z',
            selectedStageIds: ['intent_ingestion', 'intent_parsing'],
            skippedStageIds: [],
          },
          valid: true,
          errors: [],
          noSideEffect: true,
        },
      })
    }
    if (path.endsWith('/ai/compiler/routing/rules') && method === 'POST') {
      if (overrides.previewFails) {
        return jsonResponse(422, {
          error: { code: 'VALIDATION_ERROR', message: '规则场景类型缺失' },
        })
      }
      return jsonResponse(200, {
        data: {
          before: null,
          after: {
            id: 'custom-rule-v1',
            version: { major: 1, minor: 0 },
            compatibleContracts: { min: '1.0', max: '2.0' },
            scenarioKinds: ['default_plan'],
            allowedStageIds: ['intent_ingestion'],
            allowedSkippedStageIds: [],
            reasonCode: 'ROUTE_MATCHED',
            isDefault: false,
            enabled: true,
            source: 'org_persisted',
          },
          affectedScenarioKinds: ['default_plan'],
          affectedStageIds: ['intent_ingestion'],
          confirmToken: 'confirm-token-abc',
          previewOnly: true,
        },
      })
    }
    if (path.endsWith('/ai/compiler/routing/rules') && method === 'PATCH') {
      if (overrides.confirmFails) {
        return jsonResponse(400, {
          error: { code: 'VALIDATION_ERROR', message: '确认令牌已过期' },
        })
      }
      return jsonResponse(200, {
        data: { committed: true, rule: RULE, auditEvent: 'compiler.routing.rule.committed' },
      })
    }
    return null
  }
}

beforeEach(() => {
  setAuth(['ai:compiler:routing:view', 'ai:compiler:routing:manage'])
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 规则查看器与只读统计
// ---------------------------------------------------------------------------
describe('规则列表与运行统计（tasks 7.5）', () => {
  test('渲染规则卡片与只读统计（版本/总数/启停/来源）', async () => {
    installFetchRouter(routingBackend())
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    expect(document.querySelector('[data-routing-rule="default-plan-v1"]')).not.toBeNull()
    expect(document.querySelector('[data-routing-rule="org-rule-v2"]')).not.toBeNull()
    expect(q('[data-routing-stat="version"]').textContent).toContain('reg-1')
    expect(q('[data-routing-stat="total"]').textContent).toContain('2')
    expect(q('[data-routing-stat="enabled"]').textContent).toContain('1 / 1')
    expect(q('[data-routing-stat="source"]').textContent).toContain('1 / 1')
  })

  test('兼容信封形态响应（共享 api 解包语义漂移兜底）', async () => {
    installFetchRouter(routingBackend({ sendEnvelope: true }))
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    expect(document.querySelector('[data-routing-rule="default-plan-v1"]')).not.toBeNull()
  })

  test('空注册表：渲染语义空态并说明使用默认执行计划', async () => {
    installFetchRouter(routingBackend({ rules: [] }))
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-routing-rules-empty]')).not.toBeNull())
    expect(screen.getByText(/默认执行计划/)).toBeInTheDocument()
  })

  test('规则加载失败：错误卡「重新载入」重试成功', async () => {
    let attempts = 0
    installFetchRouter((path, method) => {
      if (path.endsWith('/ai/compiler/routing/rules') && method === 'GET') {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { version: 'reg-1', rules: [RULE], ruleCount: 1 })
      }
      return routingBackend()(path, method)
    })
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-routing-rules-error]')).not.toBeNull())
    fireEvent.click(q('[data-routing-rules-retry]'))
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    expect(attempts).toBeGreaterThanOrEqual(2)
  })

  test('骨架屏：规则未就绪时渲染 aria-busy 骨架，不闪现空态', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    installFetchRouter((path, method) => {
      if (path.endsWith('/ai/compiler/routing/rules') && method === 'GET') {
        const response = jsonResponse(200, { version: 'reg-1', rules: [RULE], ruleCount: 1 })
        response.json = async () => {
          await gate
          return { version: 'reg-1', rules: [RULE], ruleCount: 1 }
        }
        return response
      }
      return routingBackend()(path, method)
    })
    renderWorkspace()

    const loading = document.querySelector('[data-routing-rules-loading]')
    expect(loading).not.toBeNull()
    expect(loading?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-routing-rules-empty]')).toBeNull()

    release?.()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
  })
})

// ---------------------------------------------------------------------------
// 模拟面板
// ---------------------------------------------------------------------------
describe('模拟面板（tasks 7.5）', () => {
  test('执行模拟渲染 noSideEffect 结果与选中/跳过 stage', async () => {
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())

    fireEvent.click(q('[data-routing-tab="simulate"]'))
    fireEvent.click(q('[data-routing-simulate-run]'))

    await waitFor(() =>
      expect(document.querySelector('[data-routing-simulate-result]')).not.toBeNull(),
    )
    const result = q('[data-routing-simulate-result]')
    expect(result.textContent).toContain('ROUTE_DEFAULT_PLAN')
    expect(result.textContent).toContain('intent_ingestion')
    expect(records.some((r) => r.url.includes('/routing/simulate'))).toBe(true)
    // 模拟为只读诊断：不得产生任何写请求。
    expect(records.filter((r) => r.method !== 'GET' && !r.url.includes('simulate'))).toHaveLength(0)
  })

  test('未点击执行前不发起模拟请求', async () => {
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    fireEvent.click(q('[data-routing-tab="simulate"]'))

    await settle()
    expect(records.some((r) => r.url.includes('/routing/simulate'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 编辑器：预览 → 确认落库
// ---------------------------------------------------------------------------
describe('规则编辑器预览确认流（tasks 7.5）', () => {
  test('未预览时「确认并落库」按钮禁用 → 不会有写请求', async () => {
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    fireEvent.click(q('[data-routing-tab="editor"]'))
    fireEvent.click(q('[data-routing-editor-new]'))

    expect(q<HTMLButtonElement>('[data-routing-editor-confirm]').disabled).toBe(true)
    await settle()
    expect(records.filter((r) => r.method !== 'GET')).toHaveLength(0)
  })

  test('预览 → 二次确认取消：零写请求落地', async () => {
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    fireEvent.click(q('[data-routing-tab="editor"]'))
    fireEvent.click(q('[data-routing-editor-new]'))
    fireEvent.click(q('[data-routing-editor-preview]'))

    await waitFor(() =>
      expect(document.querySelector('[data-routing-editor-preview-result]')).not.toBeNull(),
    )
    expect(records.some((r) => r.method === 'PATCH')).toBe(false)

    fireEvent.click(q('[data-routing-editor-confirm]'))
    expect(screen.getByTestId('routing-commit-dialog')).toBeInTheDocument()
    fireEvent.click(q('[data-testid="routing-commit-dialog"] [data-routing-commit-cancel]'))

    await settle()
    expect(records.some((r) => r.method === 'PATCH')).toBe(false)
  })

  test('预览 → 确认：携 confirmToken 落库并刷新规则查看器', async () => {
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    fireEvent.click(q('[data-routing-tab="editor"]'))
    fireEvent.click(q('[data-routing-editor-new]'))
    fireEvent.click(q('[data-routing-editor-preview]'))
    await waitFor(() =>
      expect(document.querySelector('[data-routing-editor-preview-result]')).not.toBeNull(),
    )

    fireEvent.click(q('[data-routing-editor-confirm]'))
    fireEvent.click(q('[data-testid="routing-commit-dialog"] [data-routing-commit-submit]'))

    await waitFor(() => expect(records.some((r) => r.method === 'PATCH')).toBe(true))
    const patch = records.find((r) => r.method === 'PATCH')
    expect(patch?.body).toContain('confirm-token-abc')
    // 落库成功后编辑器草稿清空（回到 idle 态）。
    await waitFor(() => expect(document.querySelector('[data-routing-editor-idle]')).not.toBeNull())
  })

  test('预览失败：回显服务端错误且不进入确认态', async () => {
    installFetchRouter(routingBackend({ previewFails: true }))
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    fireEvent.click(q('[data-routing-tab="editor"]'))
    fireEvent.click(q('[data-routing-editor-new]'))
    fireEvent.click(q('[data-routing-editor-preview]'))

    await waitFor(() =>
      expect(document.querySelector('[data-routing-editor-error]')?.textContent).toContain(
        '规则场景类型缺失',
      ),
    )
    expect(document.querySelector('[data-routing-editor-preview-result]')).toBeNull()
    expect(q<HTMLButtonElement>('[data-routing-editor-confirm]').disabled).toBe(true)
  })

  test('落库失败：回显服务端错误（确认令牌过期）', async () => {
    installFetchRouter(routingBackend({ confirmFails: true }))
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())
    fireEvent.click(q('[data-routing-tab="editor"]'))
    fireEvent.click(q('[data-routing-editor-new]'))
    fireEvent.click(q('[data-routing-editor-preview]'))
    await waitFor(() =>
      expect(document.querySelector('[data-routing-editor-preview-result]')).not.toBeNull(),
    )

    fireEvent.click(q('[data-routing-editor-confirm]'))
    fireEvent.click(q('[data-testid="routing-commit-dialog"] [data-routing-commit-submit]'))

    await waitFor(() =>
      expect(document.querySelector('[data-routing-editor-error]')?.textContent).toContain(
        '确认令牌已过期',
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// 只读态与 RL-06
// ---------------------------------------------------------------------------
describe('只读态与无权零请求（tasks 7.5）', () => {
  test('仅 view 权限：无编辑器 Tab、无任何写控件', async () => {
    setAuth(['ai:compiler:routing:view'])
    installFetchRouter(routingBackend())
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-routing-rules]')).not.toBeNull())

    expect(document.querySelector('[data-routing-tab="editor"]')).toBeNull()
    expect(document.querySelector('[data-routing-editor-new]')).toBeNull()
    expect(document.querySelector('[data-routing-tab="rules"]')).not.toBeNull()
    expect(document.querySelector('[data-routing-tab="simulate"]')).not.toBeNull()
  })

  test('无 ai:compiler:routing:view → 受限横幅且底层接口零请求（RL-06）', async () => {
    setAuth(['task:view'], 'enterprise')
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-testid="compiler-routing-restricted"]')).not.toBeNull()
    expect(document.querySelector('[data-compiler-routing-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('free 档无权限 → 企业版锁定占位且零请求', async () => {
    setAuth(['task:view'], 'free')
    const { records } = installFetchRouter(routingBackend())
    renderWorkspace()

    expect(document.querySelector('[data-enterprise-locked]')).not.toBeNull()
    expect(document.querySelector('[data-testid="compiler-routing-locked"]')).not.toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 精确档降级
// ---------------------------------------------------------------------------
describe('精确档降级（RL-15）', () => {
  test('precise 档剥离氛围光晕、纯色发丝线面板', async () => {
    installFetchRouter(routingBackend())
    const first = renderWorkspace()
    await waitFor(() =>
      expect(document.querySelector('[data-compiler-routing-workspace]')).not.toBeNull(),
    )
    expect(q('[data-compiler-routing-workspace]').className).toContain('nx-space-atmosphere')
    first.unmount()

    useNextTrackStore.setState({ immersionTier: 'precise' })
    renderWorkspace()
    await waitFor(() =>
      expect(document.querySelector('[data-compiler-routing-workspace]')).not.toBeNull(),
    )
    const root = q('[data-compiler-routing-workspace]')
    expect(root.className).not.toContain('nx-space-atmosphere')
    expect(root.getAttribute('data-immersion')).toBe('precise')
    expect(root.className).toContain('bg-[var(--nx-workspace-bg)]')
  })
})
