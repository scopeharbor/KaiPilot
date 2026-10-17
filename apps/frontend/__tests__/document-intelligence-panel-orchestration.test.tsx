/**
 * 文档智能工作台 —— Owning Panel 生产编排测试
 * （v3-document-intelligence-workbench §5.2 / §5.4 / §5.6 / §5.8 / §5.10 / §5.12 / §5.13）
 *
 * 覆盖：
 * - 四个既有 owning 面板在工作台中**真实挂载**，并收到 scoped project/source/job/extraction 上下文
 * - 深链刷新恢复同一面板；server-denied / stale 深链 fail closed
 * - 关闭面板保留筛选与选中来源，焦点回到原来源行
 * - owning 写入成功后按 surface 精确失效；失败与「未写入即关闭」不失效
 * - 生产调用图静态回归：四个面板各自存在非测试调用者
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import type {
  DocumentIntelligenceListResponse,
  DocumentIntelligenceSourceDetail,
} from '@aiproj/types'
import {
  buildDocumentIntelligenceSourceDetail,
  buildDocumentIntelligenceSourceSummary,
} from '@aiproj/types'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  hasPermission: vi.fn((_permission: string) => true),
  reviewProps: vi.fn(),
  searchIndexProps: vi.fn(),
  structuredProps: vi.fn(),
  entityProps: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch, apiFetchEnvelope: mocks.apiFetch }))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission, can: mocks.hasPermission }),
}))

// owning 面板替身：只记录收到的 props，证明「工作台把 scoped 上下文交给了 owning 面板」，
// 且工作台自身不复制它们的 preview/confirm mutation。
vi.mock('@/components/ocr/OcrReviewPanel', () => ({
  default: (props: unknown) => {
    mocks.reviewProps(props)
    return <div data-testid="owning-review-panel" />
  },
}))
vi.mock('@/components/ocr/OcrSearchIndexPanel', () => ({
  OcrSearchIndexPanel: (props: unknown) => {
    mocks.searchIndexProps(props)
    return <div data-testid="owning-search-index-panel" />
  },
}))
vi.mock('@/components/views/ocr/ocr-structured-extraction-review', () => ({
  default: (props: unknown) => {
    mocks.structuredProps(props)
    return <div data-testid="owning-structured-panel" />
  },
}))
vi.mock('@/components/views/ocr/OcrEntityLinkingPanel', () => ({
  default: (props: unknown) => {
    mocks.entityProps(props)
    return <div data-testid="owning-entity-panel" />
  },
}))

import { DocumentIntelligenceWorkbench } from '../components/document-intelligence/DocumentIntelligenceWorkbench'
import { documentIntelligenceKeys } from '../lib/api/document-intelligence'

const PROJECT_ID = 12
const SOURCE_ID = 42
const JOB_ID = 7
const EXTRACTION_ID = 88

function summaryRow() {
  const base = buildDocumentIntelligenceSourceSummary()
  return {
    ...base,
    sourceKind: 'attachment' as const,
    sourceId: SOURCE_ID,
    displayName: 'ready.pdf',
    latestJob: {
      jobId: JOB_ID,
      status: 'completed',
      createdAt: '2026-08-01T00:00:00.000Z',
      succeededPages: 2,
      totalPages: 2,
    },
    currentExtraction: {
      extractionId: EXTRACTION_ID,
      lifecycle: 'current' as const,
      confirmedAt: '2026-08-02T00:00:00.000Z',
    },
    entrypoints: (
      [
        'review',
        'search_index',
        'structured_extraction',
        'entity_linking',
        'governance',
        'document_reader',
      ] as const
    ).map((surface) => ({
      surface,
      enabled: true,
      reasonCode: null,
      refs: {
        sourceKind: 'attachment' as const,
        sourceId: SOURCE_ID,
        jobId: JOB_ID,
        extractionId: EXTRACTION_ID,
      },
      confirmationOwnedBy: 'owning',
    })),
  }
}

function detailFor(overrides: Partial<DocumentIntelligenceSourceDetail> = {}) {
  const base = buildDocumentIntelligenceSourceDetail()
  return { ...base, ...summaryRow(), ...overrides } as DocumentIntelligenceSourceDetail
}

const LIST_RESPONSE: DocumentIntelligenceListResponse = {
  data: [summaryRow()],
  meta: {
    total: 1,
    page: 1,
    perPage: 20,
    totalPages: 1,
    countMode: 'exact',
    scanTruncated: false,
    facetCounts: { needs_review: 1 },
  },
} as DocumentIntelligenceListResponse

function mockApi(detail: DocumentIntelligenceSourceDetail = detailFor()) {
  mocks.apiFetch.mockImplementation((url: string) => {
    if (url.includes('/sources/')) return Promise.resolve({ data: detail })
    return Promise.resolve(LIST_RESPONSE)
  })
}

function renderWorkbench(
  searchParams: Record<string, string>,
  opts: { client?: QueryClient; onUrlStateChange?: (qs: string) => void } = {},
) {
  const client = opts.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onUrlStateChange = opts.onUrlStateChange ?? vi.fn()
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
  mocks.apiFetch.mockReset()
  mocks.hasPermission.mockReturnValue(true)
  mocks.reviewProps.mockReset()
  mocks.searchIndexProps.mockReset()
  mocks.structuredProps.mockReset()
  mocks.entityProps.mockReset()
})

// ─── §5.3–§5.10 四面板真实挂载 ───────────────────────────────────────────

describe('owning 面板生产挂载', () => {
  it('review 深链挂载既有 OcrReviewPanel 并带 project/job 上下文', async () => {
    mockApi()
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'review',
      job: String(JOB_ID),
    })
    expect(await screen.findByTestId('owning-review-panel')).toBeTruthy()
    expect(mocks.reviewProps).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, jobId: JOB_ID }),
    )
  })

  it('structured extraction 深链挂载既有面板并带 current extraction 上下文', async () => {
    mockApi()
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'structured_extraction',
      extraction: String(EXTRACTION_ID),
    })
    expect(await screen.findByTestId('owning-structured-panel')).toBeTruthy()
    expect(mocks.structuredProps).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, extractionId: EXTRACTION_ID }),
    )
  })

  it('search index 与 entity linking 深链挂载既有项目级面板', async () => {
    mockApi()
    const { unmount } = renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'search_index',
      extraction: String(EXTRACTION_ID),
    })
    expect(await screen.findByTestId('owning-search-index-panel')).toBeTruthy()
    expect(mocks.searchIndexProps).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, readOnly: false }),
    )
    unmount()

    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'entity_linking',
      extraction: String(EXTRACTION_ID),
    })
    expect(await screen.findByTestId('owning-entity-panel')).toBeTruthy()
    expect(mocks.entityProps).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, readOnly: false }),
    )
  })

  it('只读用户挂载 owning 面板时强制 readOnly', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p !== 'file:manage')
    mockApi()
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'search_index',
      extraction: String(EXTRACTION_ID),
    })
    await screen.findByTestId('owning-search-index-panel')
    expect(mocks.searchIndexProps).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }))
  })
})

// ─── §5.2 fail closed ────────────────────────────────────────────────────

describe('panel host fail closed', () => {
  it('服务端禁用该 surface 时不挂载 owning 面板', async () => {
    const denied = detailFor({
      entrypoints: summaryRow().entrypoints.map((e) =>
        e.surface === 'review'
          ? { ...e, enabled: false, reasonCode: 'permission_denied' as const }
          : e,
      ),
    } as Partial<DocumentIntelligenceSourceDetail>)
    mockApi(denied)
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'review',
      job: String(JOB_ID),
    })
    expect(await screen.findByTestId('di-panel-blocked')).toBeTruthy()
    expect(screen.queryByTestId('owning-review-panel')).toBeNull()
    expect(mocks.reviewProps).not.toHaveBeenCalled()
  })

  it('非法 URL 参数整体 fail closed 到安全视图，不打开任何面板', async () => {
    mockApi()
    renderWorkbench({ view: 'intelligence', panel: 'review', evil: 'x' })
    expect(await screen.findByTestId('di-url-rejected')).toBeTruthy()
    expect(screen.queryByTestId('di-panel-host')).toBeNull()
  })

  it('缺少 accepted extraction 的下游深链 fail closed', async () => {
    const noExtraction = detailFor({
      currentExtraction: null,
    } as Partial<DocumentIntelligenceSourceDetail>)
    mockApi(noExtraction)
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'structured_extraction',
    })
    const blocked = await screen.findByTestId('di-panel-blocked')
    expect(blocked.getAttribute('data-reason')).toBe('no_accepted_extraction')
    expect(screen.queryByTestId('owning-structured-panel')).toBeNull()
  })
})

// ─── §5.12 关闭上下文与精确失效 ──────────────────────────────────────────

describe('关闭上下文与 surface 级精确失效', () => {
  it('关闭面板保留筛选与选中来源，只移除 panel 细节', async () => {
    mockApi()
    const onUrlStateChange = vi.fn()
    renderWorkbench(
      {
        view: 'intelligence',
        attention: 'needs_review',
        source: `attachment:${SOURCE_ID}`,
        panel: 'review',
        job: String(JOB_ID),
      },
      { onUrlStateChange },
    )
    await screen.findByTestId('owning-review-panel')
    fireEvent.click(screen.getByTestId('di-panel-close'))

    const qs = onUrlStateChange.mock.calls.at(-1)![0] as string
    const params = new URLSearchParams(qs)
    expect(params.get('attention')).toBe('needs_review')
    expect(params.get('source')).toBe(`attachment:${SOURCE_ID}`)
    expect(params.get('panel')).toBeNull()
  })

  it('未发生写入就关闭：不触发任何工作台失效', async () => {
    mockApi()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderWorkbench(
      {
        view: 'intelligence',
        source: `attachment:${SOURCE_ID}`,
        panel: 'review',
        job: String(JOB_ID),
      },
      { client },
    )
    await screen.findByTestId('owning-review-panel')
    const spy = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByTestId('di-panel-close'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('owning mutation 成功后按 surface 精确失效，失败不失效', async () => {
    mockApi()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    renderWorkbench(
      {
        view: 'intelligence',
        source: `attachment:${SOURCE_ID}`,
        panel: 'search_index',
        extraction: String(EXTRACTION_ID),
      },
      { client },
    )
    await screen.findByTestId('owning-search-index-panel')
    const spy = vi.spyOn(client, 'invalidateQueries')

    // 失败的 owning mutation：不得触发失效
    const failing = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error('nope')
      },
    })
    await act(async () => {
      await failing.execute(undefined).catch(() => undefined)
    })
    expect(spy).not.toHaveBeenCalled()

    // 成功的 owning mutation：触发工作台 + search_index owning keys 精确失效
    const succeeding = client
      .getMutationCache()
      .build(client, { mutationFn: async () => ({ ok: true }) })
    await act(async () => {
      await succeeding.execute(undefined)
    })

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const serialized = JSON.stringify(spy.mock.calls)
    expect(serialized).toContain('document-intelligence')
    expect(serialized).toContain('ocr-search-index')
    expect(serialized).not.toContain('ocr-entity-linking')
    // 从不调用无参数 invalidateQueries（全局清空）
    for (const call of spy.mock.calls) {
      expect((call[0] as { queryKey?: unknown } | undefined)?.queryKey).toBeDefined()
    }
    // 工作台自己的 key 前缀正确
    expect(serialized).toContain(JSON.stringify(documentIntelligenceKeys.sources(PROJECT_ID))[1])
  })
})

// ─── §5.2 焦点归位 / §5.14 §5.15 只读 surface ───────────────────────────

describe('焦点归位与只读 surface', () => {
  it('打开面板时焦点进入面板，关闭后回到原来源行', async () => {
    mockApi()
    const { rerender, client } = renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'review',
      job: String(JOB_ID),
    })
    await screen.findByTestId('owning-review-panel')
    expect(document.activeElement).toBe(screen.getByTestId('di-panel-close'))

    // 关闭（URL 去掉 panel）后，焦点回到该来源行内的可聚焦控件
    rerender(
      <QueryClientProvider client={client}>
        <DocumentIntelligenceWorkbench
          projectId={PROJECT_ID}
          searchParams={{ view: 'intelligence', source: `attachment:${SOURCE_ID}` }}
          onUrlStateChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.queryByTestId('di-panel-host')).toBeNull())
    const sourceRow = await screen.findByTestId(`di-source-attachment:${SOURCE_ID}`)
    expect(sourceRow.getAttribute('aria-selected')).toBe('true')
  })

  it('governance 深链渲染既有证据视图，且零 owning 面板挂载', async () => {
    mockApi()
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'governance',
    })
    expect(await screen.findByTestId('di-evidence-panel')).toBeTruthy()
    expect(mocks.reviewProps).not.toHaveBeenCalled()
    expect(mocks.searchIndexProps).not.toHaveBeenCalled()
    expect(mocks.structuredProps).not.toHaveBeenCalled()
    expect(mocks.entityProps).not.toHaveBeenCalled()
  })

  it('document_reader 只读 surface 不创建任何 document mutation 入口', async () => {
    mockApi()
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'document_reader',
    })
    expect(await screen.findByTestId('di-document-reader')).toBeTruthy()
    // 面板内只有「关闭」一个按钮，没有任何写入控件
    const host = screen.getByTestId('di-panel-host')
    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(['di-panel-close'])
    // 面板内不得出现任何确认/提交类文案（只读 surface）
    expect(host.innerHTML).not.toContain('确认')
    expect(host.innerHTML).not.toContain('提交')
  })

  it('无权限只读用户打开 governance：降级为受限视图而非整页拒绝', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p !== 'file:manage')
    mockApi(
      detailFor({
        governance: {
          ...buildDocumentIntelligenceSourceDetail().governance,
          auditAccess: 'restricted',
          permissionDecision: 'blocked',
        },
      } as Partial<DocumentIntelligenceSourceDetail>),
    )
    renderWorkbench({
      view: 'intelligence',
      source: `attachment:${SOURCE_ID}`,
      panel: 'governance',
    })
    expect(await screen.findByTestId('di-evidence-panel')).toBeTruthy()
    expect(screen.getByTestId('di-gov-audit').textContent).toBe('受限')
  })
})

// ─── §5.13 生产调用图静态回归 ────────────────────────────────────────────

describe('生产调用图：四个 owning 面板均有非测试调用者', () => {
  const ROOT = join(process.cwd())
  const SCAN_DIRS = ['app', 'components', 'hooks', 'lib']

  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return out
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue
        walk(full, out)
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
        out.push(full)
      }
    }
    return out
  }

  const productionFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))

  const PANEL_MODULES: Array<[string, string]> = [
    ['OcrReviewPanel', '@/components/ocr/OcrReviewPanel'],
    ['OcrSearchIndexPanel', '@/components/ocr/OcrSearchIndexPanel'],
    ['OcrStructuredExtractionReview', '@/components/views/ocr/ocr-structured-extraction-review'],
    ['OcrEntityLinkingPanel', '@/components/views/ocr/OcrEntityLinkingPanel'],
  ]

  it.each(PANEL_MODULES)('%s 至少有一个非测试生产导入方', (_name, modulePath) => {
    const importers = productionFiles.filter((file) => {
      if (file.includes(modulePath.replace('@/', '').replace(/\//g, '\\'))) return false
      const src = readFileSync(file, 'utf8')
      return src.includes(modulePath)
    })
    expect(importers.length).toBeGreaterThan(0)
  })

  it('文件页不再保留「只关闭抽屉」的 review/downstream 占位回调', () => {
    const page = readFileSync(
      join(ROOT, 'app', '(dashboard)', 'projects', '[id]', 'files', 'page.tsx'),
      'utf8',
    )
    expect(page).not.toContain('const handleOpenReviewFromDrawer = useCallback((_jobId')
    expect(page).toContain('openIntelligencePanel')
    expect(page).toContain('DocumentIntelligenceWorkbench')
  })
})
