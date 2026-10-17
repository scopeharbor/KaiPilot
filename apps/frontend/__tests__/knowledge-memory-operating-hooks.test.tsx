/**
 * v3-knowledge-memory-operating-layer —— 数据层测试（§5.2 / §5.12）
 *
 * 覆盖：
 * - 分层 query keys 与跨组织缓存隔离
 * - envelope 透传、enabled 条件、flag-off 零请求、错误归一化不泄露内容
 * - URL state：合法 round-trip、非法/内容型参数被清理、安全 filter 保留
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiFetch: mocks.apiFetch,
}))

import {
  KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS,
  describeOperatingError,
  operatingUrlStateToQuery,
  useKnowledgeMemoryOperatingDetail,
  useKnowledgeMemoryOperatingList,
  useKnowledgeMemoryOperatingSummary,
} from '../hooks/use-knowledge-memory-operating'
import { knowledgeMemoryOperatingApi } from '../lib/api/knowledge-memory-operating'
import {
  parseOperatingUrlState,
  sanitizeOperatingUrlState,
  serializeOperatingUrlState,
  OPERATING_LIST_MAX_PER_PAGE,
} from '@aiproj/types'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  mocks.apiFetch.mockReset()
})

// ─── query keys ──────────────────────────────────────────────────────────

describe('operating query keys | 分层与跨组织隔离（§5.2）', () => {
  it('summary / list / detail / surface 都挂在同一根下并按组织分层', () => {
    const K = KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS
    expect(K.summary(7)[0]).toBe('knowledgeMemoryOperating')
    expect(K.list(7, { page: 1 })[0]).toBe('knowledgeMemoryOperating')
    expect(K.detail(7, 'knowledge_item', 'k-1')[0]).toBe('knowledgeMemoryOperating')
    expect(K.surface(7, 'knowledge_item', 'k-1', 'knowledge_review')[0]).toBe(
      'knowledgeMemoryOperating',
    )
  })

  it('不同组织的 key 互不覆盖（缓存不串租）', () => {
    const K = KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS
    expect(K.summary(1)).not.toEqual(K.summary(2))
    expect(K.detail(1, 'copilot_memory', 'm-1')).not.toEqual(K.detail(2, 'copilot_memory', 'm-1'))
  })

  it('无组织上下文时 key 用显式占位而不是复用别的组织', () => {
    expect(KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.summary(null)).toContain('none')
  })
})

// ─── hooks ───────────────────────────────────────────────────────────────

describe('operating hooks | enabled 条件与 envelope（§5.2）', () => {
  it('flag off（enabled=false）时零请求', async () => {
    const client = newClient()
    renderHook(() => useKnowledgeMemoryOperatingSummary({ organizationId: 1, enabled: false }), {
      wrapper: wrapper(client),
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })

  it('无组织上下文时零请求', async () => {
    const client = newClient()
    renderHook(() => useKnowledgeMemoryOperatingSummary({ organizationId: null }), {
      wrapper: wrapper(client),
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })

  it('summary 原样透传 {data} envelope', async () => {
    mocks.apiFetch.mockResolvedValue({ data: { organizationId: 1, lanes: [] } })
    const client = newClient()
    const { result } = renderHook(() => useKnowledgeMemoryOperatingSummary({ organizationId: 1 }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.organizationId).toBe(1)
  })

  it('list 把 filter 带进请求 URL，且不带任何内容型参数', async () => {
    mocks.apiFetch.mockResolvedValue({ data: { data: [], meta: {} } })
    const client = newClient()
    renderHook(
      () =>
        useKnowledgeMemoryOperatingList({
          organizationId: 1,
          query: { kind: 'knowledge_item', status: 'needs_review', page: 2, perPage: 20 },
        }),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled())
    const url = mocks.apiFetch.mock.calls[0]![0] as string
    expect(url).toContain('kind=knowledge_item')
    expect(url).toContain('status=needs_review')
    expect(url).toContain('page=2')
    expect(url).not.toMatch(/title=|summary=|prompt=|token=/)
  })

  it('detail 在 kind/ref 缺失时不发起请求', async () => {
    const client = newClient()
    renderHook(
      () => useKnowledgeMemoryOperatingDetail({ organizationId: 1, kind: null, ref: null }),
      { wrapper: wrapper(client) },
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })

  it('surface 请求路径只含封闭 surface 名', async () => {
    mocks.apiFetch.mockResolvedValue({ data: {} })
    await knowledgeMemoryOperatingApi.surface('knowledge_item', 'k-1', 'knowledge_review')
    const url = mocks.apiFetch.mock.calls[0]![0] as string
    expect(url).toContain('/surfaces/knowledge_review')
  })
})

describe('describeOperatingError | 错误归一化不泄露内容（§5.2）', () => {
  it('把 401/403/404 映射成稳定错误码', () => {
    expect(describeOperatingError(new Error('401 unauthorized')).code).toBe('AUTH_REQUIRED')
    expect(describeOperatingError(new Error('403 forbidden')).code).toBe('PERMISSION_DENIED')
    expect(describeOperatingError(new Error('404 not-found')).code).toBe('RESOURCE_NOT_FOUND')
  })

  it('未知错误不回显原始对象', () => {
    const described = describeOperatingError({ secret: 'sk-live-leak' })
    expect(described.code).toBe('UNKNOWN')
    expect(JSON.stringify(described)).not.toContain('sk-live-leak')
  })

  it('内部错误消息被截断，不无限外带', () => {
    const described = describeOperatingError(new Error('x'.repeat(5000)))
    expect(described.message.length).toBeLessThanOrEqual(200)
  })
})

// ─── URL state ───────────────────────────────────────────────────────────

describe('operating URL state | round-trip 与清理（§5.12）', () => {
  it('合法筛选可 round-trip', () => {
    const state = {
      view: 'operations',
      kind: 'copilot_memory',
      status: 'needs_review',
      scope: 'user',
      page: 3,
      perPage: 50,
    } as const
    const result = parseOperatingUrlState(serializeOperatingUrlState(state))
    expect(result.ok).toBe(true)
    const parsed = result.ok ? result.value : ({} as never)
    expect(parsed.kind).toBe('copilot_memory')
    expect(parsed.status).toBe('needs_review')
    expect(parsed.scope).toBe('user')
    expect(parsed.page).toBe(3)
    expect(parsed.perPage).toBe(50)
  })

  it('未知字段与未知枚举被剔除，安全 filter 仍保留', () => {
    const params = new URLSearchParams({
      view: 'operations',
      kind: 'knowledge_item',
      status: 'totally_unknown',
      evilField: 'x',
    })
    const { state: parsed, removed } = sanitizeOperatingUrlState(params)
    void removed
    expect(parsed.kind).toBe('knowledge_item')
    expect(parsed.status).toBeUndefined()
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty('evilField')
  })

  it('负数 / 过大页码 / 过大 perPage 被拒绝', () => {
    const { state: parsed } = sanitizeOperatingUrlState(
      new URLSearchParams({ view: 'operations', page: '-5', perPage: '99999' }),
    )
    expect(parsed.page === undefined || parsed.page >= 1).toBe(true)
    expect(parsed.perPage === undefined || parsed.perPage <= OPERATING_LIST_MAX_PER_PAGE).toBe(true)
  })

  it('正文 / prompt / token 注入不会进入解析结果', () => {
    const params = new URLSearchParams({
      view: 'operations',
      title: '知识正文-should-not-leak',
      summary: '记忆摘要-should-not-leak',
      prompt: 'system instruction',
      token: 'sk-live-should-not-leak',
      q: 'retrieval query text',
    })
    const { state: parsed, removed } = sanitizeOperatingUrlState(params)
    void removed
    expect(JSON.stringify(parsed)).not.toContain('should-not-leak')
    expect(JSON.stringify(parsed)).not.toContain('system instruction')
    expect(JSON.stringify(parsed)).not.toContain('retrieval query text')
  })

  it('过长 selected ref 被拒绝', () => {
    const { state: parsed } = sanitizeOperatingUrlState(
      new URLSearchParams({
        view: 'operations',
        selected: `knowledge_item:${'k'.repeat(500)}`,
      }),
    )
    expect(parsed.selected).toBeUndefined()
  })

  it('operatingUrlStateToQuery 只带 allowlist 字段', () => {
    const query = operatingUrlStateToQuery({
      view: 'operations',
      kind: 'knowledge_item',
      page: 2,
      selected: { kind: 'knowledge_item', ref: 'k-1' },
    } as never)
    expect(query).not.toHaveProperty('selected')
    expect(query).not.toHaveProperty('view')
    expect(query.kind).toBe('knowledge_item')
  })
})
