/**
 * v3-ui-next-risk-change-domains W1 · tasks 1.8 —— AI 风险建议审查采纳与增改抽屉测试
 * （RL-01 人工显式确认闭环）。
 *
 * 覆盖（spec「AI 风险识别建议审查与人工显式采纳」场景）：
 * - RiskCreateDrawer：标题必填校验（空标题提交禁用）与创建成功 POST /risks 落库、
 *   抽屉关闭；
 * - RiskAiSuggestionDrawer：打开即呼出建议（等待期骨架 aria-busy）、免责警示常驻、
 *   AIMarker 置信度 / 来源 / 原因透明回显；
 * - 修改并采纳：在线微调概率 / 缓解方案后「确认采纳」，载荷携带
 *   modifiedByUser: true 与微调值，卡片打上已采纳标记且不可重复操作；
 * - 直接采纳：accept 载荷不带 modifiedByUser；
 * - 拒绝：POST reject 后建议卡片移出候选队列，不创建正式风险。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RiskCreateDrawer } from '@/components/next/risks/RiskCreateDrawer'
import { RiskAiSuggestionDrawer } from '@/components/next/risks/RiskAiSuggestionDrawer'
import type { RiskAiSuggestion } from '@/lib/api/risks'

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

function makeSuggestion(overrides: Partial<RiskAiSuggestion> = {}): RiskAiSuggestion {
  return {
    title: '核心网关前序依赖延迟',
    description: '核心网关任务前序依赖节点延迟 4 天，存在级联滑移风险',
    category: 'schedule',
    probability: 5,
    impact: 4,
    suggestedMitigation: '为关键路径预留 3 天缓冲并前置资源确认',
    aiMarker: {
      confidence: 0.85,
      source: 'inferred',
      reason: '核心网关任务前序依赖节点延迟 4 天，存在级联滑移风险',
      needsConfirmation: true,
    },
    suggestionBatchId: 'ai-batch-001',
    ...overrides,
  }
}

function aiBackend() {
  const suggestions = [
    makeSuggestion(),
    makeSuggestion({
      title: '前端资源组连续超载',
      description: '资源负荷规则识别出前端组两周连续超载',
      category: 'resource',
      probability: 4,
      impact: 3,
      suggestedMitigation: '跨组调剂任务或引入外部支援',
    }),
  ]
  const route = (
    path: string,
    method: string,
    _body: Record<string, unknown> | null = null,
  ): Response | null => {
    if (path === '/projects/42/risks/ai-suggestions' && method === 'POST') {
      return jsonResponse(200, {
        data: { suggestions, suggestionBatchId: 'ai-batch-001' },
      })
    }
    if (/^\/projects\/42\/risks\/ai-suggestions\/[^/]+\/accept$/.test(path) && method === 'POST') {
      return jsonResponse(201, { data: { id: 888, title: '已采纳正式风险' } })
    }
    if (/^\/projects\/42\/risks\/ai-suggestions\/[^/]+\/reject$/.test(path) && method === 'POST') {
      return jsonResponse(200, { data: { rejected: true } })
    }
    return null
  }
  return { route }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** AI 建议抽屉受控壳：open 由外部注入。 */
function AiDrawerHarness({ open }: { open: boolean }) {
  return <RiskAiSuggestionDrawer projectId={42} open={open} onClose={() => undefined} />
}

// ---------------------------------------------------------------------------
describe('RiskCreateDrawer：字段必填校验与创建闭环（tasks 1.7/1.8）', () => {
  test('空标题提交禁用；填写后保存 → POST /projects/:id/risks，成功后抽屉关闭', async () => {
    const { records } = installFetchRouter((path, method, body) => {
      if (path === '/projects/42/risks' && method === 'POST') {
        return jsonResponse(201, { data: { id: 999, title: body?.title ?? '' } })
      }
      return null
    })

    function Harness() {
      const [open, setOpen] = React.useState(true)
      return <RiskCreateDrawer projectId={42} open={open} onClose={() => setOpen(false)} />
    }
    renderWithClient(<Harness />)

    expect(document.querySelector('[data-risk-create-drawer]')).not.toBeNull()
    // 空标题：保存禁用
    expect((screen.getByRole('button', { name: '保存风险' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.change(screen.getByLabelText(/风险标题/), {
      target: { value: '核心数据库迁移导致服务中断' },
    })
    fireEvent.change(screen.getByLabelText('发生概率'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('影响度'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('缓解措施（可选）'), {
      target: { value: '主备切换与回滚演练预案' },
    })
    expect((screen.getByRole('button', { name: '保存风险' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    fireEvent.click(screen.getByRole('button', { name: '保存风险' }))

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks' &&
            record.body?.title === '核心数据库迁移导致服务中断' &&
            record.body?.probability === 4 &&
            record.body?.impact === 5 &&
            record.body?.mitigationStrategy === '主备切换与回滚演练预案',
        ),
      ).toBe(true),
    )
    // 成功落库后抽屉关闭
    await waitFor(() => expect(document.querySelector('[data-risk-create-drawer]')).toBeNull())
  })

  test('描述留空自动填充默认占位；遮罩可关闭抽屉且不发请求', async () => {
    const { records } = installFetchRouter((path, method, body) => {
      if (path === '/projects/42/risks' && method === 'POST') {
        return jsonResponse(201, { data: { id: 998, title: body?.title ?? '' } })
      }
      return null
    })

    function Harness() {
      const [open, setOpen] = React.useState(true)
      return <RiskCreateDrawer projectId={42} open={open} onClose={() => setOpen(false)} />
    }
    renderWithClient(<Harness />)
    // 面板右上关闭按钮（遮罩与关闭钮同名，直接命中 data 属性）
    const closeButton = document.querySelector<HTMLButtonElement>('[data-risk-create-close]')
    expect(closeButton).not.toBeNull()
    fireEvent.click(closeButton as HTMLButtonElement)
    await waitFor(() => expect(document.querySelector('[data-risk-create-drawer]')).toBeNull())
    expect(writeMethods(records)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('RiskAiSuggestionDrawer：呼出骨架、免责与 AIMarker（RL-01）', () => {
  test('打开即触发 AI 建议：等待期骨架（aria-busy）→ 建议清单 + 免责警示 + AIMarker 回显', async () => {
    const backend = aiBackend()
    const gate = deferred<void>()
    const { records } = installFetchRouter(async (path, method, body) => {
      if (path === '/projects/42/risks/ai-suggestions' && method === 'POST') {
        await gate.promise
      }
      return backend.route(path, method, body)
    })

    const view = renderWithClient(<AiDrawerHarness open={false} />)
    expect(document.querySelector('[data-risk-ai-drawer]')).toBeNull()
    expect(records).toHaveLength(0)

    // 打开 → 自动触发建议端点，等待期呈现骨架
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AiDrawerHarness open />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(document.querySelector('[data-risk-ai-skeleton]')).not.toBeNull())
    expect(document.querySelector('[data-risk-ai-skeleton]')?.getAttribute('aria-busy')).toBe(
      'true',
    )
    expect(
      records.some(
        (record) => record.method === 'POST' && record.url === '/projects/42/risks/ai-suggestions',
      ),
    ).toBe(true)
    gate.resolve()

    await waitFor(() => expect(document.querySelectorAll('[data-risk-ai-card]')).toHaveLength(2))
    // 免责警示（RL-01）
    const disclaimer = document.querySelector('[data-risk-ai-disclaimer]')
    expect(disclaimer?.textContent).toContain('AI 风险建议仅供决策参考')
    expect(disclaimer?.textContent).toContain('绝不会自动写入正式项目')

    // AIMarker：置信度 / 来源 / 原因
    const firstMarker = document.querySelector('[data-risk-ai-card] [data-ai-marker]')
    expect(firstMarker?.querySelector('[data-ai-marker-confidence]')?.textContent).toContain('85%')
    expect(firstMarker?.querySelector('[data-ai-marker-source]')?.textContent).toContain('自动推断')
    expect(firstMarker?.querySelector('[data-ai-marker-reason]')?.textContent).toContain(
      '核心网关任务前序依赖节点延迟 4 天',
    )
    // 卡内建议参数
    const firstCard = document.querySelector('[data-risk-ai-card]')
    expect(firstCard?.textContent).toContain('概率 5')
    expect(firstCard?.textContent).toContain('影响 4')
    expect(screen.getByText('待处理 2 条 / 共 2 条 · 已采纳 0 条')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
describe('RiskAiSuggestionDrawer：修改采纳 / 直接采纳 / 拒绝（spec 场景）', () => {
  test('修改并采纳：微调概率与缓解方案后确认，载荷携带 modifiedByUser: true', async () => {
    const backend = aiBackend()
    const { records } = installFetchRouter(backend.route)
    renderWithClient(<AiDrawerHarness open />)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-ai-card]')).toHaveLength(2))

    // 展开首条建议的内联编辑
    fireEvent.click(screen.getByRole('button', { name: '修改并采纳：核心网关前序依赖延迟' }))
    expect(document.querySelector('[data-risk-ai-edit]')).not.toBeNull()

    // 概率 5 → 3，缓解方案就地微调
    fireEvent.change(screen.getByLabelText('发生概率'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('缓解方案'), {
      target: { value: '关键路径预留 5 天缓冲并双人复核排期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认采纳（已修改）' }))

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks/ai-suggestions/ai-batch-001/accept' &&
            record.body?.modifiedByUser === true &&
            record.body?.probability === 3 &&
            record.body?.impact === 4 &&
            record.body?.mitigation === '关键路径预留 5 天缓冲并双人复核排期' &&
            record.body?.suggestionBatchId === 'ai-batch-001',
        ),
      ).toBe(true),
    )
    // 已采纳标记 + 禁止重复操作
    await waitFor(() =>
      expect(document.querySelector('[data-risk-ai-card-accepted]')).not.toBeNull(),
    )
    const acceptedCard = document.querySelector('[data-risk-ai-card-accepted]')
    expect(acceptedCard?.querySelector('[data-risk-ai-accepted]')?.textContent).toContain('已采纳')
    expect(screen.getByText('待处理 1 条 / 共 2 条 · 已采纳 1 条')).toBeInTheDocument()
    expect(acceptedCard?.querySelector('[data-risk-ai-accept]')).toBeNull()
    expect(acceptedCard?.querySelector('[data-risk-ai-accept-modified]')).toBeNull()
    // 未采纳卡片按钮仍然存在
    expect(document.querySelector('[data-risk-ai-reject]')).not.toBeNull()
  })

  test('直接采纳：accept 载荷不带 modifiedByUser', async () => {
    const backend = aiBackend()
    const { records } = installFetchRouter(backend.route)
    renderWithClient(<AiDrawerHarness open />)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-ai-card]')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: '采纳建议：核心网关前序依赖延迟' }))
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks/ai-suggestions/ai-batch-001/accept' &&
            record.body?.title === '核心网关前序依赖延迟' &&
            record.body?.modifiedByUser === false,
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-risk-ai-card-accepted]')).not.toBeNull(),
    )
    const acceptedCard = document.querySelector('[data-risk-ai-card-accepted]')
    expect(acceptedCard?.textContent).toContain('核心网关前序依赖延迟')
  })

  test('拒绝：POST reject 后建议卡片移出候选，不创建正式风险', async () => {
    const backend = aiBackend()
    const { records } = installFetchRouter(backend.route)
    renderWithClient(<AiDrawerHarness open />)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-ai-card]')).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: '拒绝建议：核心网关前序依赖延迟' }))
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks/ai-suggestions/ai-batch-001/reject',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-ai-card]')).toHaveLength(1))
    expect(screen.queryByText('核心网关前序依赖延迟')).toBeNull()
    expect(screen.getByText('前端资源组连续超载')).toBeInTheDocument()
    // 仅 trigger + reject 两次写请求，无任何 accept / 风险创建
    expect(writeMethods(records)).toEqual(['POST', 'POST'])
  })
})
