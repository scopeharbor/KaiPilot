'use client'

import * as React from 'react'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { FileText, ScanText, ShieldAlert, Sparkles } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { ProjectFilesWorkspace } from '@/components/next/files/ProjectFilesWorkspace'
import { usePermissions } from '@/hooks/use-permissions'
import { attachmentKeys, attachmentsApi } from '@/lib/api/files'
import { useOcrDocumentWorkspace } from '@/hooks/use-ocr-document-workspace'
import { useOcrDocumentJobCreate, useOcrDocumentJobRetry } from '@/hooks/use-ocr-document'
import { OcrDocumentsWorkspace } from '@/components/ocr/OcrDocumentsWorkspace'
import { OcrDocumentDrawer } from '@/components/ocr/OcrDocumentDrawer'
import { DocumentIntelligenceWorkbench } from '@/components/document-intelligence/DocumentIntelligenceWorkbench'
import { DOCUMENT_INTELLIGENCE_URL_VIEW, type DocumentIntelligenceSurface } from '@aiproj/types'
import type { OcrDocumentWorkspaceRowSummary, OcrDocumentWorkspaceAction } from '@aiproj/types'
import { cn } from '@/lib/utils'

/**
 * 文件域新轨路由（/next/projects/:id/files）。
 *
 * 三视图页签：
 * - files：新轨 ProjectFilesWorkspace（仪器感文件库）；
 * - ocr / intelligence：**刻意跨轨复用**旧轨生产组件（OcrDocumentsWorkspace /
 *   DocumentIntelligenceWorkbench）——两者是服务端权威 read model 的完整工作台，
 *   功能补齐优先于视觉重绘（重绘另立专项）；旧轨页面零改动。
 * - URL 深链兼容：?view=intelligence 直达文档智能工作台（与旧轨契约一致）。
 */

type FilesTab = 'files' | 'ocr' | 'intelligence'

export default function ProjectFilesNextPage() {
  return (
    <Suspense
      fallback={
        <div
          data-files-page-loading
          className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-10 text-center text-xs text-[var(--nx-text-muted)]"
        >
          正在载入文件工作台…
        </div>
      }
    >
      <ProjectFilesNextPageInner />
    </Suspense>
  )
}

function ProjectFilesNextPageInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0
  const { hasPermission } = usePermissions()

  // 文档智能工作台的 URL 状态（view=intelligence&source&panel&job…）
  const searchParams = useSearchParams()
  const intelligenceParams = useMemo(() => {
    const out: Record<string, string> = {}
    searchParams?.forEach((value, key) => {
      out[key] = value
    })
    return out
  }, [searchParams])

  const [tab, setTab] = useState<FilesTab>(
    intelligenceParams.view === DOCUMENT_INTELLIGENCE_URL_VIEW ? 'intelligence' : 'files',
  )
  const [selectedOcrRow, setSelectedOcrRow] = useState<OcrDocumentWorkspaceRowSummary | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const ocrCreateMutation = useOcrDocumentJobCreate(validId ? projectId : 0)
  const ocrRetryMutation = useOcrDocumentJobRetry(
    validId ? projectId : 0,
    selectedOcrRow?.latestJobId ? Number(selectedOcrRow.latestJobId) : 0,
  )

  // 附件列表（OCR 工作台行数据源）
  const { data: attachmentsData, isLoading: attachmentsLoading } = useQuery({
    queryKey: attachmentKeys.list(validId ? projectId : 0, {}),
    queryFn: () => attachmentsApi.list(validId ? projectId : 0, {}),
    enabled: validId && tab !== 'files',
  })

  const ocrWorkspace = useOcrDocumentWorkspace(
    validId ? projectId : 0,
    attachmentsData?.data ?? [],
    { isReadOnly: !hasPermission('file:manage') && hasPermission('file:view') },
  )

  const handleIntelligenceUrlChange = useCallback(
    (queryString: string) => {
      router.replace(`?${queryString}`, { scroll: false })
    },
    [router],
  )

  const handleOcrAction = useCallback(
    (action: OcrDocumentWorkspaceAction, row: OcrDocumentWorkspaceRowSummary) => {
      switch (action) {
        case 'create_ocr':
          ocrCreateMutation.mutate({ sourceKind: 'attachment', sourceAttachmentId: row.sourceId })
          break
        case 'retry_ocr':
          if (row.latestJobId) ocrRetryMutation.mutate({})
          break
        default:
          setSelectedOcrRow(row)
          setDrawerOpen(true)
      }
    },
    [ocrCreateMutation, ocrRetryMutation],
  )

  const openIntelligencePanel = useCallback(
    (panel: DocumentIntelligenceSurface, jobId: number | string | null) => {
      const row = selectedOcrRow
      setDrawerOpen(false)
      setTab('intelligence')
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

  const switchTab = (next: FilesTab) => {
    setTab(next)
    if (next !== 'intelligence') router.replace('?', { scroll: false })
  }

  return (
    <PermissionGuard
      require={['project:view', 'file:view']}
      fallback={
        <div
          data-permission-fallback
          data-files-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看该项目文件库的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 与 file:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <div className="flex flex-col gap-4" data-files-next-page>
          {/* 三视图页签 */}
          <div
            role="tablist"
            aria-label="文件工作台视图"
            data-files-tabs
            className="flex w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
          >
            {(
              [
                { id: 'files', label: '文件', icon: FileText },
                { id: 'ocr', label: 'OCR 识别', icon: ScanText },
                { id: 'intelligence', label: '文档智能', icon: Sparkles },
              ] as const
            ).map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  data-files-tab={item.id}
                  onClick={() => switchTab(item.id)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-xs transition-colors',
                    tab === item.id
                      ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                      : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {item.label}
                </button>
              )
            })}
          </div>

          {tab === 'files' ? (
            <section data-files-tab-files>
              <ProjectFilesWorkspace projectId={projectId} />
            </section>
          ) : null}

          {tab === 'ocr' ? (
            <section data-files-tab-ocr>
              <OcrDocumentsWorkspace
                rows={ocrWorkspace.rows}
                isLoading={ocrWorkspace.isLoading || attachmentsLoading}
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
            </section>
          ) : null}

          {tab === 'intelligence' ? (
            <section data-files-tab-intelligence>
              <DocumentIntelligenceWorkbench
                projectId={projectId}
                searchParams={intelligenceParams}
                onUrlStateChange={handleIntelligenceUrlChange}
              />
            </section>
          ) : null}

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
            onCreateOcr={(attachmentId) =>
              ocrCreateMutation.mutate({
                sourceKind: 'attachment',
                sourceAttachmentId: attachmentId,
              })
            }
            onRetryOcr={() => ocrRetryMutation.mutate({})}
          />
        </div>
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
