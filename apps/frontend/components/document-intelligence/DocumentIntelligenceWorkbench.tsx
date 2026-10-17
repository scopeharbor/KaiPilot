'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  DOCUMENT_INTELLIGENCE_ATTENTION_FACETS,
  DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
  parseIntelligenceUrlState,
  serializeIntelligenceUrlState,
  type DocumentIntelligenceAttentionFacet,
  type DocumentIntelligenceSourceKind,
  type DocumentIntelligenceSourceSummary,
  type DocumentIntelligenceSurface,
  type DocumentIntelligenceUrlState,
} from '@aiproj/types'
import {
  useDocumentIntelligenceInvalidation,
  useDocumentIntelligenceSourceDetail,
  useDocumentIntelligenceSources,
} from '@/hooks/use-document-intelligence'
import { usePermissions } from '@/hooks/use-permissions'
import {
  ATTENTION_LABELS,
  DocumentIntelligenceSourceList,
  sourceRefOf,
} from './DocumentIntelligenceSourceList'
import DocumentIntelligenceEvidencePanel from './DocumentIntelligenceEvidencePanel'
import DocumentIntelligencePanelHost, {
  type PanelHostContext,
} from './DocumentIntelligencePanelHost'

/**
 * 文档智能工作台容器（v3-document-intelligence-workbench §4.5–§4.13 / §5）。
 *
 * 职责：
 * - 消费服务端权威 read model（分页 / countMode / dimension states / entrypoints）；
 * - 把筛选与面板选择同步到 allowlist URL，支持刷新与前进后退恢复；
 * - 打开既有 owning 面板并在写入成功后做 surface 级精确失效；
 * - 关闭面板后回到同一来源与筛选，并把焦点还给原来源行。
 *
 * 红线：本容器零 mutation、零 provider 调用；轮询只在存在 processing 来源时启用。
 */

/** 空 URL 状态 */
const EMPTY_URL_STATE: DocumentIntelligenceUrlState = {
  attention: null,
  source: null,
  panel: null,
  job: null,
  extraction: null,
}

const DEFAULT_PER_PAGE = 20
/** 存在 processing 来源时的有界轮询间隔（毫秒） */
const PROCESSING_POLL_INTERVAL = 15_000

export interface DocumentIntelligenceWorkbenchProps {
  projectId: number
  /** 当前 URL 查询参数（由页面提供，便于测试注入） */
  searchParams: Record<string, string | string[] | undefined>
  /** 写回 URL（页面用 router.replace/push 实现；不提供时退化为纯本地状态） */
  onUrlStateChange?: (queryString: string) => void
}

export function DocumentIntelligenceWorkbench({
  projectId,
  searchParams,
  onUrlStateChange,
}: DocumentIntelligenceWorkbenchProps) {
  const { hasPermission } = usePermissions()
  const { invalidateAfterPanelSuccess } = useDocumentIntelligenceInvalidation(projectId)

  // URL → 状态（非法值 fail closed 到安全空态，并显示低敏提示）
  const parsed = useMemo(() => parseIntelligenceUrlState(searchParams), [searchParams])
  const urlState = parsed.ok ? parsed.state : EMPTY_URL_STATE
  const urlRejectedReason = parsed.ok ? null : parsed.reason

  const [sourceKind, setSourceKind] = useState<DocumentIntelligenceSourceKind | null>(null)
  const [capability, setCapability] = useState<'ocr_supported' | 'document_body' | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE)
  const [sort, setSort] = useState<'updated_at' | 'created_at' | 'source_ref'>('updated_at')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')

  // 关闭面板后把焦点还给原来源行
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})

  const listParams = useMemo(
    () => ({
      ...(urlState.attention ? { attention: urlState.attention } : {}),
      ...(sourceKind ? { sourceKind } : {}),
      ...(capability ? { capability } : {}),
      sort,
      direction,
      page,
      perPage,
    }),
    [urlState.attention, sourceKind, capability, sort, direction, page, perPage],
  )

  const listQuery = useDocumentIntelligenceSources(projectId, listParams)
  const rows = listQuery.data?.data ?? []
  const meta = listQuery.data?.meta

  // 只在当前页存在 processing 来源时开启有界轮询（打开工作台不创建任何作业）
  const hasProcessing = rows.some((r) => r.attentionFacets.includes('processing'))
  const pollingQuery = useDocumentIntelligenceSources(projectId, listParams, {
    enabled: hasProcessing,
    refetchInterval: hasProcessing ? PROCESSING_POLL_INTERVAL : false,
  })
  void pollingQuery

  const selectedSummary: DocumentIntelligenceSourceSummary | null = useMemo(() => {
    if (!urlState.source) return null
    return (
      rows.find(
        (r) => r.sourceKind === urlState.source!.kind && r.sourceId === urlState.source!.id,
      ) ?? null
    )
  }, [rows, urlState.source])

  const detailQuery = useDocumentIntelligenceSourceDetail(
    projectId,
    urlState.source?.kind ?? null,
    urlState.source?.id ?? null,
  )
  const detail = detailQuery.data?.data ?? null

  const pushUrlState = useCallback(
    (next: DocumentIntelligenceUrlState) => {
      onUrlStateChange?.(serializeIntelligenceUrlState(next))
    },
    [onUrlStateChange],
  )

  const handleSelectSource = useCallback(
    (row: DocumentIntelligenceSourceSummary) => {
      pushUrlState({
        ...urlState,
        source: { kind: row.sourceKind, id: row.sourceId },
        panel: null,
        job: row.latestJob?.jobId ?? null,
        extraction: row.currentExtraction?.extractionId ?? null,
      })
    },
    [pushUrlState, urlState],
  )

  const handleOpenSurface = useCallback(
    (row: DocumentIntelligenceSourceSummary, surface: DocumentIntelligenceSurface) => {
      pushUrlState({
        ...urlState,
        source: { kind: row.sourceKind, id: row.sourceId },
        panel: surface,
        job: row.latestJob?.jobId ?? null,
        extraction: row.currentExtraction?.extractionId ?? null,
      })
    },
    [pushUrlState, urlState],
  )

  /** 关闭面板：保留筛选与选中来源，仅移除 panel 细节，并把焦点还回原行 */
  const handleClosePanel = useCallback(() => {
    const ref = urlState.source ? `${urlState.source.kind}:${urlState.source.id}` : null
    pushUrlState({ ...urlState, panel: null })
    if (ref) {
      const el = rowRefs.current[ref]
      const focusable = el?.querySelector<HTMLElement>('button')
      focusable?.focus()
    }
  }, [pushUrlState, urlState])

  const handleOwningSuccess = useCallback(
    (surface: DocumentIntelligenceSurface) => {
      if (!urlState.source) return
      invalidateAfterPanelSuccess(surface, {
        sourceKind: urlState.source.kind,
        sourceId: urlState.source.id,
        jobId: urlState.job,
      })
    },
    [invalidateAfterPanelSuccess, urlState.source, urlState.job],
  )

  // 服务端权威裁决：URL 声称的 panel 是否真的被允许
  const activeEntrypoint = useMemo(() => {
    if (!urlState.panel) return null
    const owner = detail ?? selectedSummary
    return owner?.entrypoints.find((e) => e.surface === urlState.panel) ?? null
  }, [urlState.panel, detail, selectedSummary])

  const panelContext: PanelHostContext | null = useMemo(() => {
    if (!urlState.panel || !urlState.source) return null
    return {
      projectId,
      sourceKind: urlState.source.kind,
      sourceId: urlState.source.id,
      jobId: urlState.job ?? detail?.latestJob?.jobId ?? null,
      extractionId: urlState.extraction ?? detail?.currentExtraction?.extractionId ?? null,
      readOnly: !hasPermission('file:manage'),
    }
  }, [
    urlState.panel,
    urlState.source,
    urlState.job,
    urlState.extraction,
    projectId,
    detail,
    hasPermission,
  ])

  const facetCounts = meta?.facetCounts ?? {}

  return (
    <div className="space-y-3" data-testid="document-intelligence-workbench">
      {urlRejectedReason && (
        <p
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
          data-testid="di-url-rejected"
        >
          链接参数无法识别，已回到安全的默认视图。
        </p>
      )}

      {/* Attention facets */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="待办分类">
        <button
          type="button"
          data-testid="di-facet-all"
          aria-pressed={urlState.attention === null}
          onClick={() => {
            setPage(1)
            pushUrlState({ ...urlState, attention: null, panel: null })
          }}
          className={`rounded border px-2 py-1 text-xs ${
            urlState.attention === null
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200'
          }`}
        >
          全部
        </button>
        {DOCUMENT_INTELLIGENCE_ATTENTION_FACETS.map((facet: DocumentIntelligenceAttentionFacet) => (
          <button
            key={facet}
            type="button"
            data-testid={`di-facet-filter-${facet}`}
            aria-pressed={urlState.attention === facet}
            onClick={() => {
              setPage(1)
              pushUrlState({ ...urlState, attention: facet, panel: null })
            }}
            className={`rounded border px-2 py-1 text-xs ${
              urlState.attention === facet
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200'
            }`}
          >
            {ATTENTION_LABELS[facet]}
            {facetCounts[facet] !== undefined && (
              <span className="ml-1 opacity-80">{facetCounts[facet]}</span>
            )}
          </button>
        ))}
        {meta && (
          <span
            className="ml-1 text-[11px] text-gray-500 dark:text-gray-400"
            data-testid="di-count-mode"
          >
            {meta.countMode === 'exact' ? '计数：全量精确' : '计数：仅当前页'}
            {meta.scanTruncated ? '（结果已截断）' : ''}
          </span>
        )}
      </div>

      {/* 来源类型 / 能力筛选与排序 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">来源类型</span>
          <select
            data-testid="di-filter-source-kind"
            value={sourceKind ?? ''}
            onChange={(e) => {
              setPage(1)
              setSourceKind((e.target.value || null) as DocumentIntelligenceSourceKind | null)
            }}
            className="rounded border border-gray-300 bg-white px-1.5 py-1 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="">全部</option>
            <option value="native_document">原生文档</option>
            <option value="attachment">附件</option>
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">能力</span>
          <select
            data-testid="di-filter-capability"
            value={capability ?? ''}
            onChange={(e) => {
              setPage(1)
              setCapability((e.target.value || null) as 'ocr_supported' | 'document_body' | null)
            }}
            className="rounded border border-gray-300 bg-white px-1.5 py-1 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="">全部</option>
            <option value="ocr_supported">可 OCR</option>
            <option value="document_body">有正文</option>
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">排序</span>
          <select
            data-testid="di-filter-sort"
            value={`${sort}:${direction}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(':')
              setSort(k as 'updated_at' | 'created_at' | 'source_ref')
              setDirection(d as 'asc' | 'desc')
              setPage(1)
            }}
            className="rounded border border-gray-300 bg-white px-1.5 py-1 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="updated_at:desc">最近更新</option>
            <option value="created_at:desc">最近创建</option>
            <option value="source_ref:asc">来源引用</option>
          </select>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">每页</span>
          <select
            data-testid="di-filter-per-page"
            value={perPage}
            onChange={(e) => {
              setPerPage(
                Math.min(
                  Number(e.target.value) || DEFAULT_PER_PAGE,
                  DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
                ),
              )
              setPage(1)
            }}
            className="rounded border border-gray-300 bg-white px-1.5 py-1 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      {listQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400" data-testid="di-list-error">
          文档智能数据暂时不可用，请稍后重试。
        </p>
      )}

      <div
        ref={(node) => {
          if (!node) return
          for (const el of Array.from(node.querySelectorAll<HTMLElement>('[data-source-ref]'))) {
            const ref = el.getAttribute('data-source-ref')
            if (ref) rowRefs.current[ref] = el
          }
        }}
      >
        <DocumentIntelligenceSourceList
          rows={rows}
          isLoading={listQuery.isLoading}
          selectedRef={urlState.source ? `${urlState.source.kind}:${urlState.source.id}` : null}
          onSelectSource={handleSelectSource}
          onOpenSurface={handleOpenSurface}
        />
      </div>

      {/* 分页 */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs" data-testid="di-pagination">
          <span className="text-gray-500 dark:text-gray-400">
            第 {meta.page} / {meta.totalPages} 页 · 共 {meta.total} 条
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="di-page-prev"
              disabled={meta.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-gray-600"
            >
              上一页
            </button>
            <button
              type="button"
              data-testid="di-page-next"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-gray-600"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 选中来源的证据与治理（未打开 owning 面板时内联显示） */}
      {urlState.source && !urlState.panel && (
        <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
          {detailQuery.isLoading && (
            <p className="text-sm text-gray-500 dark:text-gray-400" role="status">
              正在加载来源详情…
            </p>
          )}
          {detailQuery.isError && (
            <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="di-detail-error">
              该来源已不可访问，请返回列表重新选择。
            </p>
          )}
          {detail && <DocumentIntelligenceEvidencePanel detail={detail} />}
        </div>
      )}

      <DocumentIntelligencePanelHost
        surface={urlState.panel}
        context={panelContext}
        serverAllowed={Boolean(activeEntrypoint?.enabled)}
        detail={detail}
        summary={detail ?? selectedSummary}
        onClose={handleClosePanel}
        onOwningSuccess={handleOwningSuccess}
      />
    </div>
  )
}

export { sourceRefOf }
export default DocumentIntelligenceWorkbench
