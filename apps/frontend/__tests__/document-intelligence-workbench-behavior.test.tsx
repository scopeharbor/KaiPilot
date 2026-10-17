/**
 * 文档智能工作台 —— 行为与安全测试
 * （v3-document-intelligence-workbench §4.7 / §4.8 / §4.13 / §4.14 / §6.4 / §6.5 / §6.6）
 *
 * 覆盖：
 * - attention facet / 来源类型 / 能力筛选、排序、分页与 countMode 标签
 * - URL round-trip、浏览器前进后退（searchParams 变化）、刷新恢复、非法 URL 清理
 * - 200+ 来源不被固定截断；scanTruncated 显式呈现
 * - 轮询：仅在存在 processing 来源时启用
 * - 部分维度失败只降级该维度；错误归一化
 * - 低敏：DOM / 请求 URL 中不得出现全文、secret、token、绝对路径
 * - 零副作用：list/detail/filter/refresh 全程只发 GET，无 provider / 无写入
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  buildDocumentIntelligenceSourceSummary,
  buildDocumentIntelligenceSourceDetail,
  type DocumentIntelligenceListResponse,
  type DocumentIntelligenceSourceSummary,
} from '@aiproj/types'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  hasPermission: vi.fn((_permission: string) => true),
}))

vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch, apiFetchEnvelope: mocks.apiFetch }))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission, can: mocks.hasPermission }),
}))
vi.mock('@/components/ocr/OcrReviewPanel', () => ({ default: () => <div /> }))
vi.mock('@/components/ocr/OcrSearchIndexPanel', () => ({ OcrSearchIndexPanel: () => <div /> }))
vi.mock('@/components/views/ocr/ocr-structured-extraction-review', () => ({
  default: () => <div />,
}))
vi.mock('@/components/views/ocr/OcrEntityLinkingPanel', () => ({ default: () => <div /> }))

import { DocumentIntelligenceWorkbench } from '../components/document-intelligence/DocumentIntelligenceWorkbench'

const PROJECT_ID = 5
const SECRET_BODY = '机密正文内容-should-not-leak-2026'

function makeRow(
  id: number,
  overrides: Partial<DocumentIntelligenceSourceSummary> = {},
): DocumentIntelligenceSourceSummary {
  return {
    ...buildDocumentIntelligenceSourceSummary(),
    sourceKind: 'attachment',
    sourceId: id,
    displayName: `doc-${id}.pdf`,
    ...overrides,
  }
}

function listResponse(
  rows: DocumentIntelligenceSourceSummary[],
  meta: Partial<DocumentIntelligenceListResponse['meta']> = {},
): DocumentIntelligenceListResponse {
  return {
    data: rows,
    meta: {
      total: rows.length,
      page: 1,
      perPage: 20,
      totalPages: 1,
      countMode: 'exact',
      scanTruncated: false,
      facetCounts: {},
      ...meta,
    },
  } as DocumentIntelligenceListResponse
}

let requestedUrls: string[] = []
let requestInits: Array<RequestInit | undefined> = []

function mockList(response: DocumentIntelligenceListResponse) {
  mocks.apiFetch.mockImplementation((url: string, init?: RequestInit) => {
    requestedUrls.push(url)
    requestInits.push(init)
    if (url.includes('/sources/')) {
      return Promise.resolve({ data: buildDocumentIntelligenceSourceDetail() })
    }
    return Promise.resolve(response)
  })
}

function renderWorkbench(searchParams: Record<string, string> = { view: 'intelligence' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onUrlStateChange = vi.fn()
  const utils = render(
    <QueryClientProvider client={client}>
      <DocumentIntelligenceWorkbench
        projectId={PROJECT_ID}
        searchParams={searchParams}
        onUrlStateChange={onUrlStateChange}
      />
    </QueryClientProvider>,
  )
  return { ...utils, client, onUrlStateChange }
}

beforeEach(() => {
  requestedUrls = []
  requestInits = []
  mocks.apiFetch.mockReset()
  mocks.hasPermission.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── §4.7 / §4.8 筛选、排序、分页与 URL ──────────────────────────────────

describe('筛选 / 排序 / 分页', () => {
  it('attention facet 点击写回 URL 并保留 view', async () => {
    mockList(listResponse([makeRow(1)], { facetCounts: { needs_review: 3 } }))
    const { onUrlStateChange } = renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')

    fireEvent.click(screen.getByTestId('di-facet-filter-needs_review'))
    const qs = onUrlStateChange.mock.calls.at(-1)![0] as string
    expect(new URLSearchParams(qs).get('attention')).toBe('needs_review')
    expect(new URLSearchParams(qs).get('view')).toBe('intelligence')
  })

  it('facet 计数与 countMode 标签来自服务端 meta', async () => {
    mockList(
      listResponse([makeRow(1)], {
        countMode: 'page',
        scanTruncated: true,
        facetCounts: { needs_review: 7 },
      }),
    )
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')
    expect(screen.getByTestId('di-count-mode').textContent).toContain('仅当前页')
    expect(screen.getByTestId('di-count-mode').textContent).toContain('结果已截断')
    expect(screen.getByTestId('di-facet-filter-needs_review').textContent).toContain('7')
  })

  it('来源类型 / 能力 / 排序筛选进入请求参数', async () => {
    mockList(listResponse([makeRow(1)]))
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')

    fireEvent.change(screen.getByTestId('di-filter-source-kind'), {
      target: { value: 'native_document' },
    })
    await waitFor(() =>
      expect(requestedUrls.some((u) => u.includes('sourceKind=native_document'))).toBe(true),
    )

    fireEvent.change(screen.getByTestId('di-filter-capability'), {
      target: { value: 'ocr_supported' },
    })
    await waitFor(() =>
      expect(requestedUrls.some((u) => u.includes('capability=ocr_supported'))).toBe(true),
    )

    fireEvent.change(screen.getByTestId('di-filter-sort'), { target: { value: 'created_at:desc' } })
    await waitFor(() => expect(requestedUrls.some((u) => u.includes('sort=created_at'))).toBe(true))
  })

  it('分页请求页码，且 200+ 来源不被固定截断', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => makeRow(i + 1))
    mockList(listResponse(rows, { total: 247, page: 1, perPage: 20, totalPages: 13 }))
    renderWorkbench()
    await screen.findByTestId('di-pagination')
    expect(screen.getByTestId('di-pagination').textContent).toContain('247')

    fireEvent.click(screen.getByTestId('di-page-next'))
    await waitFor(() => expect(requestedUrls.some((u) => u.includes('page=2'))).toBe(true))
    // 从不发出固定 perPage=200 的请求
    expect(requestedUrls.every((u) => !u.includes('perPage=200'))).toBe(true)
  })

  it('每页大小受上限约束（不发无界请求）', async () => {
    mockList(listResponse([makeRow(1)]))
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')
    fireEvent.change(screen.getByTestId('di-filter-per-page'), { target: { value: '100' } })
    await waitFor(() => expect(requestedUrls.some((u) => u.includes('perPage=100'))).toBe(true))
    expect(requestedUrls.every((u) => !/perPage=(\d{4,})/.test(u))).toBe(true)
  })

  it('URL 变化（前进/后退）驱动视图恢复', async () => {
    mockList(listResponse([makeRow(1)]))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DocumentIntelligenceWorkbench
          projectId={PROJECT_ID}
          searchParams={{ view: 'intelligence' }}
          onUrlStateChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await screen.findByTestId('di-source-attachment:1')
    expect(screen.getByTestId('di-facet-all').getAttribute('aria-pressed')).toBe('true')

    // 模拟浏览器后退到带 attention 的历史条目
    rerender(
      <QueryClientProvider client={client}>
        <DocumentIntelligenceWorkbench
          projectId={PROJECT_ID}
          searchParams={{ view: 'intelligence', attention: 'stale' }}
          onUrlStateChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('di-facet-filter-stale').getAttribute('aria-pressed')).toBe('true'),
    )
  })

  it('非法 URL 参数被清理并提示，不影响列表可用', async () => {
    mockList(listResponse([makeRow(1)]))
    renderWorkbench({ view: 'intelligence', attention: '<script>alert(1)</script>' })
    expect(await screen.findByTestId('di-url-rejected')).toBeTruthy()
    expect(await screen.findByTestId('di-source-attachment:1')).toBeTruthy()
  })
})

// ─── §4.13 / §4.14 状态、轮询与错误 ──────────────────────────────────────

describe('状态、轮询与错误归一化', () => {
  it('没有 processing 来源时不启用轮询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockList(listResponse([makeRow(1, { attentionFacets: [] })]))
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')
    const before = requestedUrls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000)
    })
    expect(requestedUrls.length).toBe(before)
  })

  it('存在 processing 来源时启用有界轮询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockList(listResponse([makeRow(1, { attentionFacets: ['processing'] })]))
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')
    const before = requestedUrls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(before))
  })

  it('列表失败归一化为可读错误，不抛到渲染层', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('boom'))
    renderWorkbench()
    expect(await screen.findByTestId('di-list-error')).toBeTruthy()
  })

  it('单一维度失败只降级该维度，其余信息仍可用', async () => {
    mockList(
      listResponse([
        makeRow(1, {
          dimensionStates: {
            ocr_job: 'ready',
            accepted_extraction: 'ready',
            search_index: 'ready',
            structured_snapshot: 'ready',
            entity_link: 'unavailable',
            governance: 'ready',
          },
          warningReasons: ['dimension_failed'],
        }),
      ]),
    )
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')
    expect(screen.getByTestId('di-dim-attachment:1-entity_link').getAttribute('data-state')).toBe(
      'unavailable',
    )
    expect(screen.getByTestId('di-dim-attachment:1-ocr_job').getAttribute('data-state')).toBe(
      'ready',
    )
    expect(screen.getByTestId('di-warnings-attachment:1').textContent).toContain('读取失败')
  })
})

// ─── §6.4 / §6.5 / §6.6 低敏与零副作用 ───────────────────────────────────

describe('低敏与零副作用红线', () => {
  it('DOM 与请求 URL 均不出现全文/secret/token/绝对路径', async () => {
    mockList(listResponse([makeRow(1)]))
    const { container, onUrlStateChange } = renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')
    fireEvent.click(screen.getByTestId('di-facet-filter-needs_review'))

    const dom = container.innerHTML
    const urls = requestedUrls.join('|')
    const emitted = onUrlStateChange.mock.calls.map((c) => c[0]).join('|')
    for (const forbidden of [
      SECRET_BODY,
      'Authorization',
      'Bearer ',
      'sk-live',
      'api_key',
      'C:\\Users',
      '/var/lib',
    ]) {
      expect(dom).not.toContain(forbidden)
      expect(urls).not.toContain(forbidden)
      expect(emitted).not.toContain(forbidden)
    }
  })

  it('列表、筛选、分页、详情全程只发 GET（零写入、零 provider）', async () => {
    mockList(listResponse([makeRow(1)], { total: 40, totalPages: 2 }))
    renderWorkbench()
    await screen.findByTestId('di-source-attachment:1')

    fireEvent.click(screen.getByTestId('di-facet-filter-processing'))
    await screen.findByTestId('di-source-attachment:1')

    fireEvent.change(screen.getByTestId('di-filter-source-kind'), {
      target: { value: 'attachment' },
    })
    await screen.findByTestId('di-source-attachment:1')

    fireEvent.click(await screen.findByTestId('di-page-next'))
    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(1))

    // apiFetch 的 init 里不得出现任何写方法或 body
    for (const init of requestInits) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.body).toBeUndefined()
    }
    // 全部请求都指向工作台只读端点
    for (const url of requestedUrls) {
      expect(url).toContain('/document-intelligence/')
      expect(url).not.toContain('/ocr/document-jobs')
      expect(url).not.toContain('http://')
      expect(url).not.toContain('https://')
    }
  })

  it('跨租/隐藏来源：详情不可访问时显示低敏提示且不泄露元数据', async () => {
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.includes('/sources/')) {
        return Promise.reject(
          Object.assign(new Error('RESOURCE_NOT_FOUND'), { code: 'RESOURCE_NOT_FOUND' }),
        )
      }
      return Promise.resolve(listResponse([makeRow(1)]))
    })
    const { container } = renderWorkbench({
      view: 'intelligence',
      source: 'attachment:999999',
    })
    expect(await screen.findByTestId('di-detail-error')).toBeTruthy()
    expect(container.innerHTML).not.toContain('999999.pdf')
    expect(container.innerHTML).not.toContain(SECRET_BODY)
  })
})
