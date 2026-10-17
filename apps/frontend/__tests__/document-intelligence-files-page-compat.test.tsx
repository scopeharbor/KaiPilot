/**
 * 项目文件页兼容回归（v3-document-intelligence-workbench §4.11 / §4.12）
 *
 * 证明：
 * - 新增 `view=intelligence` 入口是**纯增量**：上传/下载/删除、文件列表、
 *   Markdown 导入导出与原 OCR 回退 tab 全部保留；
 * - 打开与筛选工作台只发工作台只读 GET —— 不创建 OCR 作业、不调用 provider；
 * - URL 带 `view=intelligence` 时刷新可直接恢复到工作台。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDocumentIntelligenceSourceSummary } from '@aiproj/types'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  hasPermission: vi.fn((_permission: string) => true),
  routerReplace: vi.fn(),
  searchParams: new URLSearchParams(),
  filesList: vi.fn(),
  attachmentsList: vi.fn(),
  attachmentsUpload: vi.fn(),
  attachmentsDelete: vi.fn(),
  downloadUrl: vi.fn(() => '/download/1'),
  ocrCreate: vi.fn(),
  ocrRetry: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.apiFetch, apiFetchEnvelope: mocks.apiFetch }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '5' }),
  useRouter: () => ({ replace: mocks.routerReplace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission, can: mocks.hasPermission }),
}))
vi.mock('@/lib/api/files', () => ({
  filesApi: { list: mocks.filesList },
  attachmentsApi: {
    list: mocks.attachmentsList,
    upload: mocks.attachmentsUpload,
    delete: mocks.attachmentsDelete,
    getDownloadUrl: mocks.downloadUrl,
  },
  fileKeys: {
    list: (p: number, f: unknown) => ['files', p, f],
    lists: (p: number) => ['files', p],
  },
  attachmentKeys: {
    list: (p: number, f: unknown) => ['attachments', p, f],
    lists: (p: number) => ['attachments', p],
  },
}))
vi.mock('@/hooks/use-ocr-document', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useOcrDocumentJobCreate: () => ({ mutate: mocks.ocrCreate, isPending: false }),
    useOcrDocumentJobRetry: () => ({ mutate: mocks.ocrRetry, isPending: false }),
  }
})
vi.mock('@/hooks/use-document-markdown', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useDocumentContent: () => ({ data: null, isLoading: false, isError: false }),
  }
})
vi.mock('@/components/ocr/OcrReviewPanel', () => ({ default: () => <div /> }))
vi.mock('@/components/ocr/OcrSearchIndexPanel', () => ({ OcrSearchIndexPanel: () => <div /> }))
vi.mock('@/components/views/ocr/ocr-structured-extraction-review', () => ({
  default: () => <div />,
}))
vi.mock('@/components/views/ocr/OcrEntityLinkingPanel', () => ({ default: () => <div /> }))

import ProjectFilesPage from '../app/(dashboard)/projects/[id]/files/page'

const ATTACHMENT = {
  id: 42,
  fileName: 'ready.pdf',
  mimeType: 'application/pdf',
  fileSize: 2048,
  createdAt: '2026-08-01T00:00:00.000Z',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectFilesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.apiFetch.mockReset()
  mocks.routerReplace.mockReset()
  mocks.ocrCreate.mockReset()
  mocks.ocrRetry.mockReset()
  mocks.hasPermission.mockReturnValue(true)
  mocks.searchParams = new URLSearchParams()
  mocks.filesList.mockResolvedValue({
    data: [{ id: 1, name: '项目章程.md', documentType: 'document', parentId: null }],
    meta: { total: 1 },
  })
  mocks.attachmentsList.mockResolvedValue({ data: [ATTACHMENT], meta: { total: 1 } })
  mocks.apiFetch.mockResolvedValue({
    data: [
      {
        ...buildDocumentIntelligenceSourceSummary(),
        sourceKind: 'attachment',
        sourceId: 42,
        displayName: 'ready.pdf',
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
})

describe('文件页兼容性', () => {
  it('默认仍是文件 tab：文件列表、下载与删除保留', async () => {
    renderPage()
    expect(await screen.findByText('ready.pdf')).toBeTruthy()
    expect(screen.getAllByText('下载').length).toBeGreaterThan(0)
    expect(screen.getAllByText('删除').length).toBeGreaterThan(0)
    expect(screen.getByTestId('workspace-tab-files')).toBeTruthy()
  })

  it('原 OCR tab 作为回退入口保留，新增文档智能 tab', async () => {
    renderPage()
    await screen.findByText('ready.pdf')
    expect(screen.getByTestId('workspace-tab-ocr')).toBeTruthy()
    expect(screen.getByTestId('workspace-tab-intelligence')).toBeTruthy()
  })

  it('Markdown 导入/导出入口不受影响', async () => {
    renderPage()
    await screen.findByText('ready.pdf')
    expect(screen.getAllByText(/导入/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/导出/).length).toBeGreaterThan(0)
  })

  it('切到文档智能 tab 只发工作台只读请求：不创建 OCR 作业、不调 provider', async () => {
    renderPage()
    await screen.findByText('ready.pdf')

    fireEvent.click(screen.getByTestId('workspace-tab-intelligence'))
    await waitFor(() => expect(screen.getByTestId('document-intelligence-workbench')).toBeTruthy())

    expect(mocks.ocrCreate).not.toHaveBeenCalled()
    expect(mocks.ocrRetry).not.toHaveBeenCalled()

    const urls = mocks.apiFetch.mock.calls.map((c) => c[0] as string)
    // 工作台自身发出的是只读聚合请求
    expect(urls.some((u) => u.includes('/document-intelligence/sources'))).toBe(true)
    // 全程零写入：没有任何请求带写方法或 body
    for (const call of mocks.apiFetch.mock.calls) {
      const init = call[1] as RequestInit | undefined
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.body).toBeUndefined()
    }
    // 切 tab 时把 view 写回 URL（可分享/刷新恢复）
    expect(mocks.routerReplace).toHaveBeenCalledWith('?view=intelligence', { scroll: false })
  })

  it('URL 带 view=intelligence 时刷新直接恢复到工作台', async () => {
    mocks.searchParams = new URLSearchParams('view=intelligence')
    renderPage()
    expect(await screen.findByTestId('document-intelligence-workbench')).toBeTruthy()
  })

  it('工作台不复用旧的 fixed perPage:200 / reviewable 推断 hook（§4.3）', () => {
    const workbench = readFileSync(
      join(
        process.cwd(),
        'components',
        'document-intelligence',
        'DocumentIntelligenceWorkbench.tsx',
      ),
      'utf8',
    )
    const list = readFileSync(
      join(
        process.cwd(),
        'components',
        'document-intelligence',
        'DocumentIntelligenceSourceList.tsx',
      ),
      'utf8',
    )
    for (const src of [workbench, list]) {
      expect(src).not.toContain('useOcrDocumentWorkspace')
      expect(src).not.toContain('perPage: 200')
      expect(src).not.toContain("=== 'reviewable'")
    }
  })

  it('筛选工作台不产生任何 OCR 作业写入', async () => {
    mocks.searchParams = new URLSearchParams('view=intelligence')
    renderPage()
    await screen.findByTestId('document-intelligence-workbench')
    fireEvent.click(await screen.findByTestId('di-facet-filter-needs_review'))
    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalled())
    expect(mocks.ocrCreate).not.toHaveBeenCalled()
    expect(mocks.ocrRetry).not.toHaveBeenCalled()
  })
})
