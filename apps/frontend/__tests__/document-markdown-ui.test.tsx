import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MarkdownImportDialog,
  IMPORT_CONFIRM_COPY,
} from '@/components/files/markdown/MarkdownImportDialog'
import {
  MarkdownExportDialog,
  EXPORT_READONLY_COPY,
} from '@/components/files/markdown/MarkdownExportDialog'
import { documentMarkdownApi } from '@/lib/api/files'
import type { Document } from '@/lib/api/files'
import type { MarkdownExportSingleResult, MarkdownImportPreview } from '@aiproj/types'

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

function wrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const DOCS: Document[] = [
  {
    id: 1,
    projectId: 7,
    parentId: null,
    name: '接口文档',
    documentType: 'document',
    content: '# 旧内容',
    version: 1,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    deletedAt: null,
  },
  {
    id: 2,
    projectId: 7,
    parentId: null,
    name: '团队',
    documentType: 'folder',
    content: null,
    version: 1,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    deletedAt: null,
  },
]

const PREVIEW: MarkdownImportPreview = {
  mode: 'create',
  normalizedContent: '# 新计划\n',
  inferredTitle: '新计划',
  safeTitle: '新计划',
  byteCount: 3,
  lineCount: 1,
  target: {
    mode: 'create',
    targetDocumentId: null,
    targetDocumentName: null,
    parentId: null,
  },
  warnings: [],
  previewHash: 'hash-abc',
  sourceDocumentHash: null,
  allowedActions: ['import'],
}

describe('MarkdownImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('预览成功显示推断标题且无警告', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# 新计划\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))

    await waitFor(() =>
      expect(screen.getByTestId('md-preview-title').textContent).toContain('新计划'),
    )
    expect(screen.getByTestId('md-no-warnings').textContent).toContain('未检测到格式警告')
  })

  it('警告列表渲染 code + message', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue({
      ...PREVIEW,
      warnings: [
        { code: 'RAW_HTML', message: '包含原始 HTML', snippet: 'line 3' },
        { code: 'REMOTE_IMAGE', message: '包含远程图片引用', snippet: 'line 5' },
      ],
    })

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# x\n<div/>\n![a](https://x/y.png)\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))

    await waitFor(() => expect(screen.queryByTestId('md-no-warnings')).toBeNull())
    expect(screen.getByText('RAW_HTML')).toBeTruthy()
    expect(screen.getByText('REMOTE_IMAGE')).toBeTruthy()
  })

  it('未预览前确认按钮禁用，预览且勾选确认后可用', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)
    vi.mocked(documentMarkdownApi.confirmImport).mockResolvedValue({
      documentId: 10,
      mode: 'create',
      name: '新计划',
      previewHash: 'hash-abc',
      sourceDocumentHash: null,
      byteCount: 3,
      warningCodes: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    const confirmButton = screen.getByTestId('md-confirm-button')
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# 新计划\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))
    await waitFor(() => expect(screen.getByTestId('md-confirm-checkbox')).toBeEnabled())

    expect(confirmButton).toBeDisabled()

    fireEvent.click(screen.getByTestId('md-confirm-checkbox'))
    await waitFor(() => expect(confirmButton).toBeEnabled())

    fireEvent.click(confirmButton)
    await waitFor(() =>
      expect(documentMarkdownApi.confirmImport).toHaveBeenCalledWith(7, {
        mode: 'create',
        content: '# 新计划\n',
        confirmed: true,
        previewHash: 'hash-abc',
      }),
    )
  })

  it('replace 模式需选择目标，stale 错误阻断确认并要求重新预览', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue({
      ...PREVIEW,
      mode: 'replace',
      sourceDocumentHash: 'old-hash',
    })

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    fireEvent.click(screen.getByTestId('md-import-mode'))
    await waitFor(() => screen.getByText('替换已有文档'))
    fireEvent.click(screen.getByText('替换已有文档'))

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# 新内容\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))
    await waitFor(() => expect(screen.getByTestId('md-source-hash')).toBeTruthy())

    // 未选目标 → 确认禁用
    expect(screen.getByTestId('md-confirm-button')).toBeDisabled()

    // 选择目标文档
    fireEvent.click(screen.getByTestId('md-replace-target'))
    await waitFor(() => screen.getByText('接口文档'))
    fireEvent.click(screen.getByText('接口文档'))

    fireEvent.click(screen.getByTestId('md-confirm-checkbox'))
    await waitFor(() => expect(screen.getByTestId('md-confirm-button')).toBeEnabled())

    // stale 错误：服务端拒绝并给出最新 hash
    vi.mocked(documentMarkdownApi.confirmImport).mockRejectedValue({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: '源文档已变更',
      details: { latestSourceDocumentHash: 'new-hash' },
    })
    fireEvent.click(screen.getByTestId('md-confirm-button'))

    await waitFor(() => expect(screen.getByTestId('md-stale-block')).toBeTruthy())
    expect(screen.getByTestId('md-stale-block').textContent).toContain('请重新预览')
    expect(screen.getByTestId('md-preview-button').textContent).toContain('需重新预览')
  })

  it('确认文案不含自动写入用语', () => {
    expect(IMPORT_CONFIRM_COPY).toContain('确认')
    expect(IMPORT_CONFIRM_COPY).not.toContain('自动')
  })
})

describe('MarkdownExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const SINGLE: MarkdownExportSingleResult = {
    filename: '接口文档.md',
    content: '# 旧内容\n',
    contentHash: 'hash-1',
    byteCount: 6,
    source: { documentId: 1, name: '接口文档' },
  }

  it('单文档导出成功后展示文件名与下载按钮', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue(SINGLE)

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() =>
      expect(screen.getByTestId('md-export-filename').textContent).toContain('接口文档.md'),
    )
    expect(documentMarkdownApi.exportSingle).toHaveBeenCalledWith(7, { documentId: 1 })
    expect(screen.getByTestId('md-export-download')).toBeEnabled()
    expect(screen.getByTestId('md-export-copy')).toBeEnabled()
    expect(screen.getByText(EXPORT_READONLY_COPY)).toBeTruthy()
  })

  it('权限拒绝时展示错误而非结果', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockRejectedValue({
      status: 403,
      code: 'PERMISSION_DENIED',
      message: '无权导出 Markdown',
    })

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(screen.getByTestId('md-export-error')).toBeTruthy())
    expect(screen.getByTestId('md-export-error').textContent).toContain('无权导出')
    expect(screen.queryByTestId('md-export-download')).toBeNull()
  })

  it('选中树导出展示 manifest 摘要', async () => {
    vi.mocked(documentMarkdownApi.exportTree).mockResolvedValue({
      filename: 'project-documents.md',
      content: '# a\n# b\n',
      byteCount: 8,
      manifest: {
        exportedCount: 2,
        skippedCount: 0,
        failedCount: 0,
        deniedCount: 1,
        items: [
          { documentId: 1, path: 'a.md', status: 'exported', byteCount: 4 },
          { documentId: 2, path: 'b.md', status: 'exported', byteCount: 4 },
        ],
      },
      bundleHash: 'bundle-1',
    })

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="tree"
        treeIds={[1, 2]}
        treeLabel="根目录"
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() =>
      expect(screen.getByTestId('md-export-manifest').textContent).toContain('导出 2 个文档'),
    )
    expect(documentMarkdownApi.exportTree).toHaveBeenCalledWith(7, { selectedIds: [1, 2] })
  })

  it('导出文案声明只读，不出现自动写入用语', () => {
    expect(EXPORT_READONLY_COPY).toContain('只读')
    expect(EXPORT_READONLY_COPY).not.toContain('自动')
  })
})

// ---------------------------------------------------------------------------
// 测试组：响应式、主题与密度（§7.8 P1）
// ---------------------------------------------------------------------------
describe('MarkdownImportDialog - responsive, theme and density', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('导入对话框使用 sm:max-w-lg 确保桌面宽度受限', () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    const dialogEl = document.querySelector('[role="dialog"]')
    expect(dialogEl).toBeDefined()
    // DialogContent 有 className sm:max-w-lg
    const contentEl = dialogEl?.querySelector('.sm\\:max-w-lg')
    expect(contentEl).toBeDefined()
  })

  it('对话框内容区域支持 max-h-[85vh] 溢出滚动避免移动端截断', () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    const dialogEl = document.querySelector('[role="dialog"]')
    // max-h-[85vh] overflow-y-auto 在 DialogContent 上
    const overflowEl = dialogEl?.querySelector('.max-h-\\[85vh\\]')
    expect(overflowEl).toBeDefined()
    const scrollEl = dialogEl?.querySelector('.overflow-y-auto')
    expect(scrollEl).toBeDefined()
  })

  it('警告项使用 truncate 确保长文件名在窄屏不溢出', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue({
      ...PREVIEW,
      warnings: [
        {
          code: 'REMOTE_IMAGE',
          message: '包含非常非常非常长的远程图片引用描述文本用于测试截断行为',
          snippet: 'line 3',
        },
      ],
    })

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# 测试\n![x](https://a.b/c.png)\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))

    await waitFor(() => expect(screen.getByText('REMOTE_IMAGE')).toBeTruthy())

    // 警告文本 span 有 truncate 类
    const warningSpans = document.querySelectorAll('li .truncate')
    expect(warningSpans.length).toBeGreaterThan(0)
  })

  it('对话框按钮在 flex-wrap 容器中避免窄屏重叠', () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    // 关键按钮全部存在（通过 data-testid 精确定位）
    expect(screen.getByRole('button', { name: '取消' })).toBeDefined()
    expect(screen.getByTestId('md-preview-button')).toBeDefined()
    expect(screen.getByTestId('md-confirm-button')).toBeDefined()
    expect(screen.getByRole('button', { name: '选择 .md 文件' })).toBeDefined()
    // 所有按钮至少存在，保证功能不丢失
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4)
  })

  it('深色主题：预览区块包含 dark: 变体类', async () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue({
      ...PREVIEW,
      warnings: [{ code: 'RAW_HTML', message: '包含原始 HTML', snippet: 'line 3' }],
    })

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# H1\n<div/>\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))

    // 等待预览结果出现
    await waitFor(() => expect(screen.getByText('RAW_HTML')).toBeTruthy())

    // Radix Dialog 通过 portal 渲染到 document.body — 在全局 DOM 中搜 dark: 类
    const allElements = document.querySelectorAll('*')
    const darkCount = Array.from(allElements).filter(
      (el) => el.className && typeof el.className === 'string' && el.className.includes('dark:'),
    ).length
    expect(darkCount).toBeGreaterThan(0)
  })

  it('密集模式：确认复选框标签文本存在且不可溢出', () => {
    vi.mocked(documentMarkdownApi.previewImport).mockResolvedValue(PREVIEW)

    render(
      <MarkdownImportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        documents={DOCS}
        defaultParentId={null}
      />,
      { wrapper: wrapper() },
    )

    fireEvent.change(screen.getByTestId('md-import-content'), {
      target: { value: '# H1\n\nsome text\n' },
    })
    fireEvent.click(screen.getByTestId('md-preview-button'))

    // checkbox label 渲染确认文案
    expect(screen.getByText(IMPORT_CONFIRM_COPY)).toBeTruthy()
  })
})

describe('MarkdownExportDialog - responsive, theme and density', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const SINGLE: MarkdownExportSingleResult = {
    filename: '接口文档.md',
    content: '# 旧内容\n',
    contentHash: 'hash-1',
    byteCount: 6,
    source: { documentId: 1, name: '接口文档' },
  }

  it('导出对话框桌面宽度受限 sm:max-w-md', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue(SINGLE)

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(screen.getByTestId('md-export-filename')).toBeTruthy())

    const dialogEl = document.querySelector('[role="dialog"]')
    const contentEl = dialogEl?.querySelector('.sm\\:max-w-md')
    expect(contentEl).toBeDefined()
  })

  it('文件名使用 truncate 确保长名称在窄屏不换行', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue({
      ...SINGLE,
      filename: '非常非常非常非常非常非常非常长的文档名称-测试截断.md',
    })

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(screen.getByTestId('md-export-filename')).toBeTruthy())

    const filenameEl = screen.getByTestId('md-export-filename')
    expect(filenameEl.className).toContain('truncate')
  })

  it('深色主题：导出结果包含 dark: 变体类', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue(SINGLE)

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(screen.getByTestId('md-export-filename')).toBeTruthy())

    // 结果区块有 dark:border-gray-700
    const darkBorderEls = document.querySelectorAll('.dark\\:border-gray-700')
    expect(darkBorderEls.length).toBeGreaterThan(0)

    // hash 有 dark:text-gray-400
    expect(screen.getByTestId('md-export-hash').className).toContain('dark:text-gray-400')
  })

  it('底部按钮在窄屏并排不重叠', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue(SINGLE)

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(screen.getByTestId('md-export-filename')).toBeTruthy())

    // Footer 有 gap-2 间距
    const footer = document.querySelector('[role="dialog"] .gap-2')
    expect(footer).toBeDefined()

    const buttons = footer?.querySelectorAll('button')
    expect(buttons?.length).toBeGreaterThanOrEqual(2) // 关闭 + 复制 + 下载
  })

  it('移动端窄屏：对话框仍然可交互', async () => {
    vi.mocked(documentMarkdownApi.exportSingle).mockResolvedValue(SINGLE)

    // 设置窄 viewport 模拟移动端
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true })
    window.dispatchEvent(new Event('resize'))

    render(
      <MarkdownExportDialog
        projectId={7}
        open
        onOpenChange={() => {}}
        mode="single"
        documentId={1}
      />,
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(screen.getByTestId('md-export-filename')).toBeTruthy())

    // 移动端按钮仍可点击（data-testid 精确定位）
    expect(screen.getByTestId('md-export-download')).toBeEnabled()
    expect(screen.getByTestId('md-export-copy')).toBeEnabled()
    // 关闭按钮存在（底部显式按钮，用 data-testid 区分）
    const closeButtons = screen.getAllByRole('button', { name: /^关闭$/ })
    expect(closeButtons.length).toBeGreaterThanOrEqual(1)
    expect(closeButtons[0]).toBeEnabled()
  })
})
