/**
 * 文档智能工作台 —— 数据层测试（v3-document-intelligence-workbench §4.2 / §4.4 / §5.11）
 *
 * 覆盖：
 * - 分层 query keys 与跨项目缓存隔离
 * - API envelope、enabled 条件、abort signal 透传
 * - 「旧推断 vs 权威结果」的反向回归：reviewable ≠ accepted
 * - surface 级精确失效映射（禁止全局清空）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchEnvelope: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiFetch: mocks.apiFetch,
  apiFetchEnvelope: mocks.apiFetchEnvelope,
}))

import { documentIntelligenceApi, documentIntelligenceKeys } from '../lib/api/document-intelligence'
import {
  resolveOwningInvalidationKeys,
  useDocumentIntelligenceInvalidation,
  useDocumentIntelligenceSourceDetail,
  useDocumentIntelligenceSources,
} from '../hooks/use-document-intelligence'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  mocks.apiFetchEnvelope.mockReset()
})

// ─── query keys ──────────────────────────────────────────────────────────

describe('documentIntelligenceKeys | 分层与跨项目隔离', () => {
  it('列表/详情 key 都挂在项目子树下', () => {
    expect(documentIntelligenceKeys.sourceList(7, { page: 2 })).toEqual([
      'document-intelligence',
      7,
      'sources',
      'list',
      { page: 2 },
    ])
    expect(documentIntelligenceKeys.sourceDetail(7, 'attachment', 9)).toEqual([
      'document-intelligence',
      7,
      'sources',
      'detail',
      'attachment',
      9,
    ])
  })

  it('不同项目的 key 前缀互不覆盖（缓存隔离）', () => {
    const a = documentIntelligenceKeys.sources(1)
    const b = documentIntelligenceKeys.sources(2)
    expect(a).not.toEqual(b)
    expect(a[1]).not.toBe(b[1])
  })
})

// ─── API client ──────────────────────────────────────────────────────────

describe('documentIntelligenceApi | 只序列化 allowlist 参数', () => {
  it('只把有值的 allowlist 键写进 query string', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({ data: [], meta: {} })
    await documentIntelligenceApi.listSources(3, {
      attention: 'needs_review',
      page: 2,
      perPage: 50,
      sort: 'created_at',
      direction: 'asc',
      sourceKind: null,
      capability: null,
      status: null,
      search: null,
    })
    const url = mocks.apiFetchEnvelope.mock.calls[0]![0] as string
    expect(url).toContain('/projects/3/document-intelligence/sources?')
    expect(url).toContain('attention=needs_review')
    expect(url).toContain('page=2')
    expect(url).not.toContain('sourceKind')
    expect(url).not.toContain('status')
    expect(url).not.toContain('search')
  })

  it('详情走 sourceKind/sourceId 路径且无查询串', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({ data: {} })
    await documentIntelligenceApi.sourceDetail(3, 'native_document', 11)
    expect(mocks.apiFetchEnvelope.mock.calls[0]![0]).toBe(
      '/projects/3/document-intelligence/sources/native_document/11',
    )
  })
})

// ─── hooks ───────────────────────────────────────────────────────────────

describe('useDocumentIntelligenceSources | envelope / enabled / abort', () => {
  it('完整消费 { data, meta }（含 countMode 与 scanTruncated）', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({
      data: [],
      meta: {
        total: 12,
        page: 1,
        perPage: 20,
        totalPages: 1,
        countMode: 'exact',
        scanTruncated: false,
        facetCounts: { needs_review: 3 },
      },
    })
    const client = newClient()
    const { result } = renderHook(() => useDocumentIntelligenceSources(4), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.meta.countMode).toBe('exact')
    expect(result.current.data?.meta.scanTruncated).toBe(false)
    expect(result.current.data?.meta.facetCounts.needs_review).toBe(3)
  })

  it('projectId 非法时不发请求（enabled 条件）', async () => {
    const client = newClient()
    renderHook(() => useDocumentIntelligenceSources(0), { wrapper: wrapper(client) })
    await new Promise((r) => setTimeout(r, 10))
    expect(mocks.apiFetchEnvelope).not.toHaveBeenCalled()
  })

  it('把 AbortSignal 透传给 fetch 层', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({ data: [], meta: {} })
    const client = newClient()
    const { result } = renderHook(() => useDocumentIntelligenceSources(4), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const init = mocks.apiFetchEnvelope.mock.calls[0]![1] as { signal?: AbortSignal }
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('错误被归一化为 isError，不抛到渲染层', async () => {
    mocks.apiFetchEnvelope.mockRejectedValue(new Error('boom'))
    const client = newClient()
    const { result } = renderHook(() => useDocumentIntelligenceSources(4), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useDocumentIntelligenceSourceDetail | 深链恢复守卫', () => {
  it('source 未选中时不请求', async () => {
    const client = newClient()
    renderHook(() => useDocumentIntelligenceSourceDetail(4, null, null), {
      wrapper: wrapper(client),
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(mocks.apiFetchEnvelope).not.toHaveBeenCalled()
  })

  it('选中后按 kind/id 请求详情', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({ data: { sourceId: 9 } })
    const client = newClient()
    const { result } = renderHook(() => useDocumentIntelligenceSourceDetail(4, 'attachment', 9), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.apiFetchEnvelope.mock.calls[0]![0]).toContain('/sources/attachment/9')
  })
})

// ─── §4.4 权威结果 vs 旧推断 ─────────────────────────────────────────────

describe('权威 read model 取代旧前端推断', () => {
  it('reviewable 但无 accepted：服务端裁决关闭全部下游入口', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({
      data: [
        {
          sourceKind: 'attachment',
          sourceId: 1,
          displayName: 'a.pdf',
          capabilities: {
            documentBodyReadable: false,
            markdownReadable: false,
            ocrSupportedMime: true,
            mimeType: 'application/pdf',
          },
          status: 'empty',
          attentionFacets: ['needs_review'],
          dimensionStates: {
            ocr_job: 'ready',
            accepted_extraction: 'empty',
            search_index: 'empty',
            structured_snapshot: 'empty',
            entity_link: 'empty',
            governance: 'ready',
          },
          warningReasons: [],
          // 旧推断会因为 status==='reviewable' 认定「已接受」
          latestJob: {
            jobId: 5,
            status: 'reviewable',
            createdAt: '',
            succeededPages: 1,
            totalPages: 1,
          },
          currentExtraction: null,
          entrypoints: [
            {
              surface: 'review',
              enabled: true,
              reasonCode: null,
              refs: {},
              confirmationOwnedBy: 'ocr-review-confirmation-flow',
            },
            {
              surface: 'search_index',
              enabled: false,
              reasonCode: 'no_accepted_extraction',
              refs: {},
              confirmationOwnedBy: 'ocr-document-search-indexing',
            },
          ],
          profileProvenance: null,
          updatedAt: null,
          createdAt: null,
        },
      ],
      meta: {
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
        countMode: 'exact',
        scanTruncated: false,
        facetCounts: {},
      },
    })
    const client = newClient()
    const { result } = renderHook(() => useDocumentIntelligenceSources(4), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const row = result.current.data!.data[0]!
    expect(row.currentExtraction).toBeNull()
    expect(row.entrypoints.find((e) => e.surface === 'search_index')!.enabled).toBe(false)
    expect(row.entrypoints.find((e) => e.surface === 'review')!.enabled).toBe(true)
  })

  it('列表请求不使用固定 perPage=200（分页参数完全来自调用方）', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({ data: [], meta: {} })
    const client = newClient()
    const { result } = renderHook(
      () => useDocumentIntelligenceSources(4, { page: 3, perPage: 50 }),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mocks.apiFetchEnvelope.mock.calls[0]![0] as string
    expect(url).toContain('perPage=50')
    expect(url).not.toContain('perPage=200')
  })
})

// ─── §5.11 surface 级精确失效 ────────────────────────────────────────────

describe('resolveOwningInvalidationKeys | surface 映射', () => {
  it('review 失效 owning review 与作业列表 keys', () => {
    const keys = resolveOwningInvalidationKeys('review', { projectId: 2, jobId: 8 })
    expect(keys.length).toBe(3)
    expect(JSON.stringify(keys)).toContain('ocr-review')
    expect(JSON.stringify(keys)).toContain('ocr-document')
  })

  it('每个下游 surface 只失效自己的 owning 子树', () => {
    expect(
      JSON.stringify(resolveOwningInvalidationKeys('search_index', { projectId: 2 })),
    ).toContain('ocr-search-index')
    expect(
      JSON.stringify(resolveOwningInvalidationKeys('structured_extraction', { projectId: 2 })),
    ).toContain('ocr-structured-extraction')
    expect(
      JSON.stringify(resolveOwningInvalidationKeys('entity_linking', { projectId: 2 })),
    ).toContain('ocr-entity-linking')
  })

  it('只读 surface 不产生任何 owning 失效', () => {
    expect(resolveOwningInvalidationKeys('governance', { projectId: 2 })).toEqual([])
    expect(resolveOwningInvalidationKeys('document_reader', { projectId: 2 })).toEqual([])
  })
})

describe('useDocumentIntelligenceInvalidation | 精确失效不清空全局', () => {
  it('只按前缀失效，且从不调用无参数 invalidateQueries', async () => {
    const client = newClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDocumentIntelligenceInvalidation(3), {
      wrapper: wrapper(client),
    })

    result.current.invalidateAfterPanelSuccess('search_index', {
      sourceKind: 'attachment',
      sourceId: 4,
    })

    expect(spy).toHaveBeenCalled()
    for (const call of spy.mock.calls) {
      expect(call[0]).toBeDefined()
      expect((call[0] as { queryKey?: unknown }).queryKey).toBeDefined()
    }
    const serialized = JSON.stringify(spy.mock.calls)
    expect(serialized).toContain('document-intelligence')
    expect(serialized).toContain('ocr-search-index')
    // 其它 surface 的 owning 子树不受影响
    expect(serialized).not.toContain('ocr-entity-linking')
  })
})
