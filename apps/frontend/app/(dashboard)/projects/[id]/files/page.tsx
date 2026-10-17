'use client'

import { useState, useCallback, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { filesApi, attachmentsApi, fileKeys, attachmentKeys } from '@/lib/api/files'
import type { FileListFilters } from '@/lib/api/files'
import { usePermissions } from '@/hooks/use-permissions'
import { useOcrDocumentWorkspace } from '@/hooks/use-ocr-document-workspace'
import { useOcrDocumentJobCreate, useOcrDocumentJobRetry } from '@/hooks/use-ocr-document'
import { OcrDocumentsWorkspace } from '@/components/ocr/OcrDocumentsWorkspace'
import { OcrDocumentDrawer } from '@/components/ocr/OcrDocumentDrawer'
import { DocumentIntelligenceWorkbench } from '@/components/document-intelligence/DocumentIntelligenceWorkbench'
import { DOCUMENT_INTELLIGENCE_URL_VIEW, type DocumentIntelligenceSurface } from '@aiproj/types'
import { isOcrSupportedMime } from '@aiproj/types'
import type { OcrDocumentWorkspaceRowSummary, OcrDocumentWorkspaceAction } from '@aiproj/types'
import { MarkdownImportDialog } from '@/components/files/markdown/MarkdownImportDialog'
import { MarkdownExportDialog } from '@/components/files/markdown/MarkdownExportDialog'
import { MarkdownDocumentViewer } from '@/components/files/markdown/MarkdownDocumentViewer'
import { useDocumentContent } from '@/hooks/use-document-markdown'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet'

/**
 * 项目文件库页面（V3 OCR 增强版）。
 *
 * 保留原有上传/搜索/下载/删除/导出工作流，并新增 OCR 文档工作台：
 * - 每个受支持附件显示 OCR 状态、页面进度、主要操作
 * - OCR 状态筛选：未识别/处理中/待审查/已确认/已阻止
 * - 抽屉详情：概览、作业、审查、下游、治理
 * - 权限/隐私/生命周期降级展示
 * - 响应式、暗色/亮色、紧凑/舒适密度
 */

/**
 * 文件页工作区标签。
 * - files：原有文件库（上传/下载/删除/Markdown 导入导出/阅读器）——行为不变
 * - ocr：原有 OCR 工作台（回退入口，保留）
 * - intelligence：V3 文档智能工作台（服务端权威 read model + owning 面板编排）
 */
type OcrWorkspaceTab = 'files' | 'ocr' | 'intelligence'

export default function ProjectFilesPage() {
  const params = useParams()
  const projectId = Number(params?.id)
  const queryClient = useQueryClient()
  const { hasPermission } = usePermissions()

  const canImport = hasPermission('file:manage')
  const canExport = hasPermission('file:view')
  const canDelete = hasPermission('file:manage')

  const [filters, setFilters] = useState<FileListFilters>({
    parentId: null,
    search: '',
  })
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportMode, setExportMode] = useState<'single' | 'tree'>('single')
  const [exportDocId, setExportDocId] = useState<number | undefined>(undefined)
  const [exportOpen, setExportOpen] = useState(false)

  // Markdown 阅读器状态
  const [viewerDocId, setViewerDocId] = useState<number | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)

  // 文档智能工作台的 URL 状态（view=intelligence&attention&source&panel&job&extraction）
  const router = useRouter()
  const searchParams = useSearchParams()
  const intelligenceParams = useMemo(() => {
    const out: Record<string, string> = {}
    searchParams?.forEach((value, key) => {
      out[key] = value
    })
    return out
  }, [searchParams])
  const isIntelligenceUrl = intelligenceParams.view === DOCUMENT_INTELLIGENCE_URL_VIEW

  const handleIntelligenceUrlChange = useCallback(
    (queryString: string) => {
      router.replace(`?${queryString}`, { scroll: false })
    },
    [router],
  )

  // OCR 工作台状态
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<OcrWorkspaceTab>(
    isIntelligenceUrl ? 'intelligence' : 'files',
  )
  const [selectedOcrRow, setSelectedOcrRow] = useState<OcrDocumentWorkspaceRowSummary | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // OCR mutations
  const ocrCreateMutation = useOcrDocumentJobCreate(projectId)
  const ocrRetryMutation = useOcrDocumentJobRetry(
    projectId,
    selectedOcrRow?.latestJobId ? Number(selectedOcrRow.latestJobId) : 0,
  )

  // 文件库查询
  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: fileKeys.list(projectId, filters),
    queryFn: () => filesApi.list(projectId, filters),
    enabled: !!projectId,
  })

  // 附件列表查询
  const { data: attachmentsData, isLoading: attachmentsLoading } = useQuery({
    queryKey: attachmentKeys.list(projectId, {}),
    queryFn: () => attachmentsApi.list(projectId, {}),
    enabled: !!projectId,
  })

  const documents = filesData?.data ?? []
  const attachments = attachmentsData?.data ?? []
  const nonFolderDocs = useMemo(
    () => documents.filter((d) => d.documentType === 'document'),
    [documents],
  )

  // OCR 工作台
  const ocrWorkspace = useOcrDocumentWorkspace(projectId, attachments, {
    isReadOnly: !hasPermission('file:manage') && hasPermission('file:view'),
  })

  // 文档正文查询（v3-document-code-block-support）
  const {
    data: viewerData,
    isLoading: viewerLoading,
    isError: viewerError,
  } = useDocumentContent(projectId, viewerOpen ? viewerDocId : null)

  // 上传文件
  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadError(null)

      try {
        await attachmentsApi.upload(projectId, { entityType: 'project', entityId: projectId }, file)

        queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
        queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
        ocrWorkspace.invalidateAll()
      } catch (error) {
        const message = (error as { message?: string })?.message || '上传失败'
        setUploadError(message)
      } finally {
        setUploading(false)
      }
    },
    [projectId, queryClient, ocrWorkspace.invalidateAll],
  )

  // 删除附件
  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => attachmentsApi.delete(projectId, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
      queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
      ocrWorkspace.invalidateAll()
    },
  })

  // 删除文档
  const deleteDocMutation = useMutation({
    mutationFn: (documentId: number) => filesApi.delete(projectId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileKeys.lists(projectId) })
    },
  })

  // OCR 操作处理
  const handleOcrAction = useCallback(
    (action: OcrDocumentWorkspaceAction, row: OcrDocumentWorkspaceRowSummary) => {
      switch (action) {
        case 'create_ocr':
          ocrCreateMutation.mutate({
            sourceKind: 'attachment',
            sourceAttachmentId: row.sourceId,
          })
          break
        case 'retry_ocr':
          if (row.latestJobId) {
            // 使用独立的 retry 调用
            ocrRetryMutation.mutate({})
          }
          break
        default:
          // 打开抽屉
          setSelectedOcrRow(row)
          setDrawerOpen(true)
      }
    },
    [ocrCreateMutation, ocrRetryMutation],
  )

  const handleCreateOcrFromDrawer = useCallback(
    (attachmentId: number) => {
      ocrCreateMutation.mutate({
        sourceKind: 'attachment',
        sourceAttachmentId: attachmentId,
      })
    },
    [ocrCreateMutation],
  )

  const handleRetryOcrFromDrawer = useCallback(
    (_jobId: number | string) => {
      ocrRetryMutation.mutate({})
    },
    [ocrRetryMutation],
  )

  /**
   * 打开审查面板（§5.13）：不再只关闭抽屉，而是切到文档智能工作台并深链到
   * 既有 `OcrReviewPanel`。preview/确认/stale 重校验仍由 owning 面板执行。
   */
  const openIntelligencePanel = useCallback(
    (panel: DocumentIntelligenceSurface, jobId: number | string | null) => {
      const row = selectedOcrRow
      setDrawerOpen(false)
      setActiveWorkspaceTab('intelligence')
      const usp = new URLSearchParams()
      usp.set('view', DOCUMENT_INTELLIGENCE_URL_VIEW)
      if (row?.sourceId) usp.set('source', `attachment:${Number(row.sourceId)}`)
      usp.set('panel', panel)
      if (jobId) usp.set('job', String(Number(jobId)))
      router.replace(`?${usp.toString()}`, { scroll: false })
    },
    [router, selectedOcrRow],
  )

  const handleOpenReviewFromDrawer = useCallback(
    (jobId: number | string) => openIntelligencePanel('review', jobId),
    [openIntelligencePanel],
  )

  /** 下游动作 → 对应 owning 面板（封闭映射，未知动作 fail closed 到治理只读视图） */
  const handleOpenDownstreamFromDrawer = useCallback(
    (action: OcrDocumentWorkspaceAction, jobId: number | string) => {
      const surface: DocumentIntelligenceSurface =
        action === 'search_index'
          ? 'search_index'
          : action === 'structured_extraction'
            ? 'structured_extraction'
            : action === 'entity_linking'
              ? 'entity_linking'
              : 'governance'
      openIntelligencePanel(surface, jobId)
    },
    [openIntelligencePanel],
  )

  const isLoading = filesLoading || attachmentsLoading

  const hasOcrCapableFiles = useMemo(
    () => attachments.some((a) => isOcrSupportedMime(a.mimeType)),
    [attachments],
  )

  return (
    <div className="p-3 sm:p-4 md:p-6">
      {/* 标题栏 - 响应式 */}
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold sm:text-xl">文件库</h1>
          {/* OCR/文件 Tab 切换 */}
          {hasOcrCapableFiles && (
            <div
              className="flex rounded border border-gray-200 dark:border-gray-700"
              role="tablist"
            >
              <button
                role="tab"
                aria-selected={activeWorkspaceTab === 'files'}
                onClick={() => setActiveWorkspaceTab('files')}
                className={`rounded-l px-3 py-1 text-xs font-medium transition-colors ${
                  activeWorkspaceTab === 'files'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
                data-testid="workspace-tab-files"
              >
                文件
              </button>
              <button
                role="tab"
                aria-selected={activeWorkspaceTab === 'ocr'}
                onClick={() => setActiveWorkspaceTab('ocr')}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  activeWorkspaceTab === 'ocr'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
                data-testid="workspace-tab-ocr"
              >
                OCR
                {ocrWorkspace.reviewableCount > 0 && (
                  <span className="ml-1 rounded bg-amber-500 px-1 py-px text-[10px] text-white">
                    {ocrWorkspace.reviewableCount}
                  </span>
                )}
              </button>
              {/* V3 文档智能工作台入口（原 OCR tab 保留为回退入口） */}
              <button
                role="tab"
                aria-selected={activeWorkspaceTab === 'intelligence'}
                onClick={() => {
                  setActiveWorkspaceTab('intelligence')
                  handleIntelligenceUrlChange(`view=${DOCUMENT_INTELLIGENCE_URL_VIEW}`)
                }}
                className={`rounded-r px-3 py-1 text-xs font-medium transition-colors ${
                  activeWorkspaceTab === 'intelligence'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
                data-testid="workspace-tab-intelligence"
              >
                文档智能
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex cursor-pointer items-center justify-center rounded border border-blue-600 bg-white px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 dark:border-blue-500 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-gray-700 sm:px-4 sm:py-2"
              data-testid="md-import-open"
            >
              导入 Markdown
            </button>
          )}
          {canExport && nonFolderDocs.length > 0 && (
            <button
              onClick={() => {
                setExportMode('tree')
                setExportDocId(undefined)
                setExportOpen(true)
              }}
              className="inline-flex cursor-pointer items-center justify-center rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:px-4 sm:py-2"
              data-testid="md-export-tree-open"
            >
              导出当前视图
            </button>
          )}
          <label className="inline-flex cursor-pointer items-center justify-center rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 sm:px-4 sm:py-2">
            {uploading ? '上传中...' : '上传文件'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleUpload(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>

      {uploadError && (
        <div
          className="mb-4 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300 sm:p-3"
          role="alert"
        >
          {uploadError}
        </div>
      )}

      {/* 文件 Tab 内容 */}
      {activeWorkspaceTab === 'files' && (
        <>
          {/* 搜索 */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="搜索文件..."
              value={filters.search ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 sm:py-2"
              aria-label="搜索文件"
            />
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">加载中...</div>
          ) : documents.length === 0 && attachments.length === 0 ? (
            <div className="py-12 text-center text-gray-500 dark:text-gray-400">
              <p className="text-lg">暂无文件</p>
              <p className="mt-1 text-sm">点击上方按钮上传第一个文件</p>
            </div>
          ) : (
            <div className="space-y-1.5 sm:space-y-2">
              {/* 文件夹/文档 */}
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 sm:gap-3 sm:p-3"
                >
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <span className="flex-shrink-0 text-base sm:text-lg" aria-hidden="true">
                      {doc.documentType === 'folder' ? '📁' : '📄'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {doc.documentType === 'folder' ? '文件夹' : '文档'}
                        {' · '}
                        {new Date(doc.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                  </div>
                  {canExport && doc.documentType === 'document' && (
                    <>
                      <button
                        onClick={() => {
                          setViewerDocId(doc.id)
                          setViewerOpen(true)
                        }}
                        className="flex-shrink-0 text-sm text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                        data-testid={`md-read-open-${doc.id}`}
                      >
                        阅读
                      </button>
                      <button
                        onClick={() => {
                          setExportMode('single')
                          setExportDocId(doc.id)
                          setExportOpen(true)
                        }}
                        className="flex-shrink-0 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        data-testid={`md-export-open-${doc.id}`}
                      >
                        导出
                      </button>
                    </>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => deleteDocMutation.mutate(doc.id)}
                      className="flex-shrink-0 text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      删除
                    </button>
                  )}
                </div>
              ))}

              {/* 附件 */}
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 sm:gap-3 sm:p-3"
                >
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <span className="flex-shrink-0 text-base sm:text-lg" aria-hidden="true">
                      📎
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{att.fileName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatFileSize(att.fileSize)}
                        {' · '}
                        {new Date(att.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
                    <a
                      href={attachmentsApi.getDownloadUrl(projectId, att.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 sm:text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      下载
                    </a>
                    {canDelete && (
                      <button
                        onClick={() => deleteMutation.mutate(att.id)}
                        className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 sm:text-sm"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* OCR Tab 内容 */}
      {activeWorkspaceTab === 'ocr' && (
        <OcrDocumentsWorkspace
          rows={ocrWorkspace.rows}
          isLoading={ocrWorkspace.isLoading}
          hasAnyOcrActivity={ocrWorkspace.hasAnyOcrActivity}
          counts={{
            total: ocrWorkspace.rows.length,
            reviewable: ocrWorkspace.reviewableCount,
            confirmed: ocrWorkspace.confirmedCount,
            processing: ocrWorkspace.processingCount,
            failed: ocrWorkspace.failedCount,
            blocked: ocrWorkspace.blockedCount,
          }}
          onAction={handleOcrAction}
        />
      )}

      {/* 文档智能工作台（v3-document-intelligence-workbench §4.11） */}
      {activeWorkspaceTab === 'intelligence' && (
        <DocumentIntelligenceWorkbench
          projectId={projectId}
          searchParams={intelligenceParams}
          onUrlStateChange={handleIntelligenceUrlChange}
        />
      )}

      {/* OCR 抽屉 */}
      <OcrDocumentDrawer
        row={selectedOcrRow}
        projectId={projectId}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
          setSelectedOcrRow(null)
        }}
        onOpenReview={handleOpenReviewFromDrawer}
        onOpenDownstream={handleOpenDownstreamFromDrawer}
        onCreateOcr={handleCreateOcrFromDrawer}
        onRetryOcr={handleRetryOcrFromDrawer}
      />

      {/* Markdown 导入/导出 */}
      <MarkdownImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
        documents={documents}
        defaultParentId={filters.parentId ?? null}
      />
      <MarkdownExportDialog
        projectId={projectId}
        open={exportOpen}
        onOpenChange={setExportOpen}
        mode={exportMode}
        documentId={exportDocId}
        treeIds={documents.map((d) => d.id)}
        treeLabel={filters.parentId === null ? '根目录' : '当前文件夹'}
      />

      {/* Markdown 文档阅读器 Sheet（v3-document-code-block-support §5.2） */}
      <Sheet open={viewerOpen} onOpenChange={setViewerOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col p-0 sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
          data-testid="md-reader-sheet"
        >
          <SheetHeader className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <SheetTitle className="truncate text-base">
              {viewerData?.title ?? '文档内容'}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Markdown 只读阅读器 · 代码块支持语法高亮与复制
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {viewerLoading && (
              <div
                className="flex h-32 items-center justify-center text-gray-500 dark:text-gray-400"
                data-testid="md-reader-loading"
              >
                加载文档中…
              </div>
            )}
            {viewerError && (
              <div
                className="flex h-32 items-center justify-center text-red-600 dark:text-red-400"
                data-testid="md-reader-error"
              >
                读取失败或无权访问此文档
              </div>
            )}
            {!viewerLoading && !viewerError && viewerData && (
              <MarkdownDocumentViewer
                content={viewerData.content}
                codeBlocks={viewerData.codeBlocks}
              />
            )}
            {!viewerLoading && !viewerError && !viewerData && (
              <div
                className="flex h-32 items-center justify-center text-gray-500 dark:text-gray-400"
                data-testid="md-reader-empty"
              >
                暂无文档内容
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
