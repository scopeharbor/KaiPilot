/**
 * AI 同事面板 · 建议收件箱（AiColleagueInbox）组件测试 —— 新轨接线、
 * 与旧轨 Copilot 收件箱同源（use-suggestion-inbox hooks + /copilot-suggestion-inbox API）。
 *
 * 覆盖：
 * - 清单渲染：标题（回源投影/缺省落问题种类）、严重度、来源、状态标签；
 * - 状态筛选 chip 把 state 参数传给查询；未读徽标计数；
 * - 展开详情（摘要/建议动作/过期原因）；采纳/忽略走 action 通道（POST）并失效刷新；
 * - 缺失来源标注不静默省略；空态；刷新按钮触发聚合 POST；
 * - 全域视图（无 projectId）刷新禁用并说明原因。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AiColleagueInbox } from '@/components/next/ai/AiColleagueInbox'
import type { InboxEntry } from '@aiproj/types'

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

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
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
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function entryFixture(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'entry-1',
    organizationId: '1',
    projectId: '3',
    state: 'unread',
    problemKind: 'schedule_risk',
    severity: 'critical',
    dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'k-1' },
    sourceRefs: [
      {
        sourceKind: 'progress_risk_prediction',
        sourceId: 's-1',
        projectId: '3',
        sourceHash: 'h1',
        capturedAt: '2026-09-15T00:00:00.000Z',
      },
    ],
    expiryReason: null,
    expiryDetail: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    readAt: null,
    actionedAt: null,
    content: {
      title: '关键路径上 3 个任务排程偏离',
      summary: '支付联调与商城发布任务连续偏离基线 4 天。',
      suggestedAction: '顺延非关键任务或增补人力。',
    },
    ...overrides,
  }
}

function createBackend(options: { entries?: InboxEntry[]; unread?: number } = {}) {
  const entries = options.entries ?? []
  return {
    route: (path: string, method: string): Response | null => {
      if (method === 'GET' && path.startsWith('/copilot-suggestion-inbox/unread-count')) {
        return jsonResponse(200, { unreadCount: options.unread ?? entries.length })
      }
      if (method === 'GET' && path.startsWith('/copilot-suggestion-inbox')) {
        return jsonResponse(200, {
          entries,
          total: entries.length,
          unreadCount: options.unread ?? entries.length,
          missingSources:
            entries.length > 0
              ? [{ sourceKind: 'pmo_priority_recommendation', reason: '来源服务暂不可用' }]
              : [],
          pagination: { page: 1, perPage: 50, totalPages: 1 },
        })
      }
      if (method === 'POST' && path.endsWith('/action')) {
        return jsonResponse(200, { entryId: 'entry-1', previousState: 'unread', newState: 'read' })
      }
      if (method === 'POST' && path.endsWith('/refresh')) {
        return jsonResponse(200, {
          aggregated: 0,
          created: 0,
          updated: 0,
          skippedTerminal: 0,
          missingSources: [],
          expired: 0,
        })
      }
      return null
    },
  }
}

function renderInbox(projectId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AiColleagueInbox projectId={projectId} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('AiColleagueInbox：清单渲染与筛选', () => {
  test('渲染条目：回源标题/严重度/来源/状态；缺失来源标注呈现', async () => {
    installFetchRouter(createBackend({ entries: [entryFixture()] }).route)
    renderInbox(3)

    await waitFor(() =>
      expect(document.querySelector('[data-inbox-entry="entry-1"]')).not.toBeNull(),
    )
    const row = document.querySelector('[data-inbox-entry="entry-1"]')!
    expect(row.textContent).toContain('关键路径上 3 个任务排程偏离')
    expect(row.textContent).toContain('严重')
    expect(row.textContent).toContain('进度风险')
    expect(row.textContent).toContain('进度与风险预测')
    expect(row.textContent).toContain('未读')
    // 缺失来源不静默省略
    await waitFor(() =>
      expect(document.querySelector('[data-inbox-missing-sources]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-inbox-missing-sources]')!.textContent).toContain(
      'PMO 优先级推荐',
    )
  })

  test('状态筛选 chip 传 state 参数；条目无正文投影时以问题种类作标题', async () => {
    const { records } = installFetchRouter(
      createBackend({ entries: [entryFixture({ content: null })] }).route,
    )
    renderInbox(3)

    await waitFor(() =>
      expect(document.querySelector('[data-inbox-entry="entry-1"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-inbox-entry="entry-1"]')!.textContent).toContain(
      '进度风险',
    )

    fireEvent.click(document.querySelector('[data-inbox-filter="unread"]') as Element)
    await waitFor(() => expect(records.some((r) => r.url.includes('state=unread'))).toBe(true))
  })

  test('空清单 → 空态文案', async () => {
    installFetchRouter(createBackend().route)
    renderInbox(3)
    await waitFor(() => expect(document.querySelector('[data-inbox-empty]')).not.toBeNull())
    expect(screen.getByText(/收件箱为空/)).toBeInTheDocument()
  })
})

describe('AiColleagueInbox：展开详情与采纳/忽略', () => {
  test('展开显示摘要与建议动作；采纳走 POST action 通道', async () => {
    const { records } = installFetchRouter(createBackend({ entries: [entryFixture()] }).route)
    renderInbox(3)

    await waitFor(() =>
      expect(document.querySelector('[data-inbox-entry="entry-1"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-inbox-entry-toggle="entry-1"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-inbox-entry-detail="entry-1"]')).not.toBeNull(),
    )
    const detail = document.querySelector('[data-inbox-entry-detail="entry-1"]')!
    expect(detail.textContent).toContain('支付联调与商城发布任务连续偏离基线 4 天')
    expect(detail.textContent).toContain('顺延非关键任务或增补人力')

    fireEvent.click(document.querySelector('[data-inbox-adopt="entry-1"]') as Element)
    await waitFor(() =>
      expect(
        records.some(
          (r) =>
            r.method === 'POST' &&
            r.url === '/copilot-suggestion-inbox/entry-1/action' &&
            r.body?.action === 'adopt',
        ),
      ).toBe(true),
    )
  })

  test('忽略走 POST action 通道（action=dismiss）', async () => {
    const { records } = installFetchRouter(createBackend({ entries: [entryFixture()] }).route)
    renderInbox(3)

    await waitFor(() =>
      expect(document.querySelector('[data-inbox-entry="entry-1"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-inbox-entry-toggle="entry-1"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-inbox-dismiss="entry-1"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-inbox-dismiss="entry-1"]') as Element)
    await waitFor(() => expect(records.some((r) => r.body?.action === 'dismiss')).toBe(true))
  })
})

describe('AiColleagueInbox：刷新与全域降级', () => {
  test('项目上下文下刷新按钮触发聚合 POST /refresh', async () => {
    const { records } = installFetchRouter(createBackend().route)
    renderInbox(3)

    await waitFor(() => expect(document.querySelector('[data-inbox-empty]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-inbox-refresh]') as Element)
    await waitFor(() =>
      expect(
        records.some((r) => r.method === 'POST' && r.url === '/copilot-suggestion-inbox/refresh'),
      ).toBe(true),
    )
  })

  test('全域视图（无 projectId）刷新禁用', async () => {
    installFetchRouter(createBackend().route)
    renderInbox(undefined)

    await waitFor(() => expect(document.querySelector('[data-inbox-empty]')).not.toBeNull())
    const refresh = document.querySelector('[data-inbox-refresh]') as HTMLButtonElement
    expect(refresh.disabled).toBe(true)
    expect(refresh.title).toContain('全域视图')
  })
})
