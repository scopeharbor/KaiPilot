import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useMarkdownImportPreview,
  useMarkdownImportConfirm,
  useMarkdownExportSingle,
  useMarkdownExportTree,
} from '@/hooks/use-document-markdown'
import { documentMarkdownApi } from '@/lib/api/files'
import {
  copyExportContent,
  downloadSingleExport,
  downloadTreeExport,
  markdownExportToBlob,
  safeExportFilename,
  toMarkdownApiError,
} from '@/lib/markdown-export-helpers'
import type {
  MarkdownExportSingleResult,
  MarkdownExportTreeResult,
  MarkdownImportConfirmResult,
  MarkdownImportPreview,
} from '@aiproj/types'

vi.mock('@/lib/api/files', () => ({
  documentMarkdownApi: {
    previewImport: vi.fn(),
    confirmImport: vi.fn(),
    exportSingle: vi.fn(),
    exportTree: vi.fn(),
  },
  fileKeys: {
    all: ['files'],
    lists: (projectId: number) => ['files', 'list', projectId],
    documents: (projectId: number) => ['files', 'documents', projectId],
    document: (projectId: number, documentId: number) => [
      'files',
      'documents',
      projectId,
      documentId,
    ],
  },
}))

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const PREVIEW: MarkdownImportPreview = {
  mode: 'create',
  normalizedContent: '# 项目计划\n\n## 目标\n\n在季度末交付。',
  inferredTitle: '项目计划',
  safeTitle: '项目计划',
  byteCount: 48,
  lineCount: 5,
  target: { mode: 'create', targetDocumentId: null, targetDocumentName: null, parentId: null },
  warnings: [],
  previewHash: 'hash-abc',
  sourceDocumentHash: null,
  allowedActions: ['import'],
}

const CONFIRM_RESULT: MarkdownImportConfirmResult = {
  documentId: 42,
  mode: 'create',
  name: '项目计划',
  previewHash: 'hash-abc',
  sourceDocumentHash: 'src-hash-1',
  byteCount: 48,
  warningCodes: [],
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
}

const SINGLE_EXPORT: MarkdownExportSingleResult = {
  filename: '项目计划.md',
  content: '# 项目计划\n',
  contentHash: 'export-hash',
  byteCount: 9,
  source: { documentId: 42, name: '项目计划' },
}

const TREE_EXPORT: MarkdownExportTreeResult = {
  filename: 'project-documents.md',
  content: '---\nmarkdown-export-manifest\n---\n# 项目计划\n',
  byteCount: 42,
  manifest: {
    exportedCount: 2,
    skippedCount: 0,
    failedCount: 0,
    deniedCount: 1,
    items: [
      { documentId: 42, path: '项目计划.md', status: 'exported', byteCount: 9 },
      { documentId: 43, path: '子目录/纪要.md', status: 'exported', byteCount: 12 },
    ],
  },
  bundleHash: 'bundle-hash',
}

describe('useMarkdownImportPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('预览成功返回预览结果且不触发查询失效', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)

    const { result } = renderHook(() => useMarkdownImportPreview(7), {
      wrapper: createWrapper(),
    })
    result.current.mutate({ mode: 'create', content: '# 项目计划\n\n## 目标\n\n在季度末交付。' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(documentMarkdownApi.previewImport).toHaveBeenCalledWith(7, {
      mode: 'create',
      content: '# 项目计划\n\n## 目标\n\n在季度末交付。',
    })
    expect(result.current.data).toEqual(PREVIEW)
  })

  it('校验错误被归一化为 ApiError 形态', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockRejectedValue({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: '内容超出大小限制',
      details: { maxBytes: 100_000 },
    })

    const { result } = renderHook(() => useMarkdownImportPreview(7), {
      wrapper: createWrapper(),
    })
    result.current.mutate({ mode: 'create', content: 'x'.repeat(100_001) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = toMarkdownApiError(result.current.error)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.status).toBe(422)
  })
})

describe('useMarkdownImportConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('create 确认成功并失效项目文件列表', async () => {
    vi.mocked(documentMarkdownApi.confirmImport).mockResolvedValue(CONFIRM_RESULT)
    const queryClient = createQueryClient()
    queryClient.setQueryData(['files', 'list', 7, {}], { data: [], meta: null })
    queryClient.setQueryData(['files', 'documents', 7], { data: [] })

    const { result } = renderHook(() => useMarkdownImportConfirm(7), {
      wrapper: createWrapper(queryClient),
    })
    result.current.mutate({
      mode: 'create',
      content: '# 项目计划\n',
      confirmed: true,
      previewHash: 'hash-abc',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(CONFIRM_RESULT)
  })

  it('stale 替换错误透传给调用方', async () => {
    vi.mocked(documentMarkdownApi.confirmImport).mockRejectedValue({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: '源文档已变更，请重新预览',
      details: { latestSourceDocumentHash: 'new-hash' },
    })

    const { result } = renderHook(() => useMarkdownImportConfirm(7), {
      wrapper: createWrapper(),
    })
    result.current.mutate({
      mode: 'replace',
      content: '# 新内容',
      targetDocumentId: 9,
      confirmed: true,
      previewHash: 'hash-abc',
      expectedSourceDocumentHash: 'old-hash',
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = toMarkdownApiError(result.current.error)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect((err.details as { latestSourceDocumentHash: string }).latestSourceDocumentHash).toBe(
      'new-hash',
    )
  })

  it('replace 确认成功并失效目标文档详情', async () => {
    vi.mocked(documentMarkdownApi.confirmImport).mockResolvedValue({
      ...CONFIRM_RESULT,
      documentId: 9,
      mode: 'replace',
    })
    const queryClient = createQueryClient()
    const invalidationSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useMarkdownImportConfirm(7), {
      wrapper: createWrapper(queryClient),
    })
    result.current.mutate({
      mode: 'replace',
      content: '# 新内容',
      targetDocumentId: 9,
      confirmed: true,
      previewHash: 'hash-abc',
      expectedSourceDocumentHash: 'old-hash',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const called = invalidationSpy.mock.calls.map((c) => c[0])
    expect(
      called.some((c) => JSON.stringify(c?.queryKey) === JSON.stringify(['files', 7, 'list', 9])),
    ).toBe(false)
  })
})

describe('export hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('单文档导出成功', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue(SINGLE_EXPORT)

    const { result } = renderHook(() => useMarkdownExportSingle(7), {
      wrapper: createWrapper(),
    })
    result.current.mutate({ documentId: 42 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(documentMarkdownApi.exportSingle).toHaveBeenCalledWith(7, { documentId: 42 })
    expect(result.current.data).toEqual(SINGLE_EXPORT)
  })

  it('选中树导出成功', async () => {
    vi.mocked(documentMarkdownApi.exportTree).mockResolvedValue(TREE_EXPORT)

    const { result } = renderHook(() => useMarkdownExportTree(7), {
      wrapper: createWrapper(),
    })
    result.current.mutate({ selectedIds: [3, 4] })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(documentMarkdownApi.exportTree).toHaveBeenCalledWith(7, { selectedIds: [3, 4] })
    expect(result.current.data).toEqual(TREE_EXPORT)
  })

  it('权限拒绝错误带 code=PERMISSION_DENIED', async () => {
    vi.mocked(documentMarkdownApi.exportTree).mockRejectedValue({
      status: 403,
      code: 'PERMISSION_DENIED',
      message: '无权导出 Markdown',
    })

    const { result } = renderHook(() => useMarkdownExportTree(7), {
      wrapper: createWrapper(),
    })
    result.current.mutate({ selectedIds: [3] })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = toMarkdownApiError(result.current.error)
    expect(err.code).toBe('PERMISSION_DENIED')
    expect(err.status).toBe(403)
  })
})

describe('markdown export helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('safeExportFilename 保留中文、替换非法字符并保证 .md 后缀', () => {
    expect(safeExportFilename('项目计划')).toBe('项目计划.md')
    expect(safeExportFilename('a/b:c*')).toBe('a_b_c_.md')
    expect(safeExportFilename('文档.md')).toBe('文档.md')
    expect(safeExportFilename('   ')).toBe('document.md')
  })

  it('safeExportFilename 超长截断', () => {
    const long = 'x'.repeat(500)
    const result = safeExportFilename(long, 200)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result.endsWith('.md')).toBe(true)
  })

  it('markdownExportToBlob 生成带 BOM 的 text/markdown Blob', () => {
    const blob = markdownExportToBlob({ content: '# 项目计划\n' })
    expect(blob.type).toBe('text/markdown;charset=utf-8')
  })

  it('downloadSingleExport 触发浏览器下载并清理 URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:md-1')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
    } as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({}) as Element)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({}) as Element)

    downloadSingleExport(SINGLE_EXPORT)

    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:md-1')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('downloadTreeExport 使用 bundle 文件名', () => {
    const createObjectURL = vi.fn(() => 'blob:md-2')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
    } as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({}) as Element)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({}) as Element)

    downloadTreeExport(TREE_EXPORT)

    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:md-2')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('copyExportContent 成功写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    await copyExportContent('# 项目计划\n')
    expect(writeText).toHaveBeenCalledWith('# 项目计划\n')
    vi.unstubAllGlobals()
  })

  it('copyExportContent 失败抛 CLIPBOARD_REJECTED', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })

    await expect(copyExportContent('x')).rejects.toMatchObject({ code: 'CLIPBOARD_REJECTED' })
    vi.unstubAllGlobals()
  })

  it('toMarkdownApiError 归一化任意错误', () => {
    expect(toMarkdownApiError({ code: 'X', message: 'm' })).toEqual({
      status: 0,
      code: 'X',
      message: 'm',
      details: undefined,
    })
    expect(toMarkdownApiError('boom').code).toBe('UNKNOWN')
    expect(toMarkdownApiError(null).message).toBe('操作失败')
  })
})
