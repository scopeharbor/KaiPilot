'use client'

import { Suspense, lazy, useEffect, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  isDocumentIntelligenceSurface,
  type DocumentIntelligenceSourceDetail,
  type DocumentIntelligenceSourceSummary,
  type DocumentIntelligenceSurface,
} from '@aiproj/types'
import { REASON_LABELS, SURFACE_LABELS } from './DocumentIntelligenceSourceList'
import DocumentIntelligenceEvidencePanel from './DocumentIntelligenceEvidencePanel'

/**
 * Owning Panel 宿主（v3-document-intelligence-workbench §5.1–§5.11）。
 *
 * 红线（design D3）：
 * - surface → 既有生产面板的**封闭映射**；未知 surface fail closed，不渲染任何东西。
 * - adapter 只做 prop / context 转换：preview、确认、stale 重校验、幂等、Policy、审计
 *   仍全部由 owning hook 与 owning API 承担；工作台不复制任何 mutation。
 * - 服务端拒绝的入口即使 client 声称可用也不挂载（`entrypoint.enabled` 是唯一依据）。
 */

// lazy mount：面板体积大且只在打开时需要
const OcrReviewPanel = lazy(() => import('@/components/ocr/OcrReviewPanel'))
const OcrSearchIndexPanel = lazy(() =>
  import('@/components/ocr/OcrSearchIndexPanel').then((m) => ({ default: m.OcrSearchIndexPanel })),
)
const OcrStructuredExtractionReview = lazy(
  () => import('@/components/views/ocr/ocr-structured-extraction-review'),
)
const OcrEntityLinkingPanel = lazy(() => import('@/components/views/ocr/OcrEntityLinkingPanel'))

/** 面板打开所需的 scoped 上下文（只含 opaque refs，无 callback / preview token） */
export interface PanelHostContext {
  projectId: number
  sourceKind: 'native_document' | 'attachment'
  sourceId: number
  jobId: number | null
  extractionId: number | null
  readOnly: boolean
}

/** owning surface → 是否需要 jobId / extractionId 才能安全挂载 */
const SURFACE_REQUIREMENTS: Record<
  DocumentIntelligenceSurface,
  { needsJob?: boolean; needsExtraction?: boolean }
> = {
  review: { needsJob: true },
  search_index: { needsExtraction: true },
  structured_extraction: { needsExtraction: true },
  entity_linking: { needsExtraction: true },
  document_reader: {},
  governance: {},
}

/**
 * 解析 surface 是否可安全挂载。返回 null 表示可挂载；否则给出低敏原因。
 * 这是 client 侧的**第二道**闸——第一道永远是服务端 entrypoint 裁决。
 */
export function resolvePanelMountBlock(
  surface: unknown,
  ctx: Pick<PanelHostContext, 'jobId' | 'extractionId'>,
  serverAllowed: boolean,
): {
  blocked: true
  reasonCode: 'unknown_surface' | 'permission_denied' | 'no_accepted_extraction'
} | null {
  if (!isDocumentIntelligenceSurface(surface)) {
    return { blocked: true, reasonCode: 'unknown_surface' }
  }
  if (!serverAllowed) {
    return { blocked: true, reasonCode: 'permission_denied' }
  }
  const req = SURFACE_REQUIREMENTS[surface]
  if (req.needsJob && !ctx.jobId) return { blocked: true, reasonCode: 'no_accepted_extraction' }
  if (req.needsExtraction && !ctx.extractionId) {
    return { blocked: true, reasonCode: 'no_accepted_extraction' }
  }
  return null
}

interface DocumentIntelligencePanelHostProps {
  surface: DocumentIntelligenceSurface | null
  context: PanelHostContext | null
  /** 服务端对该 surface 的权威裁决（来自 detail/list 的 entrypoint） */
  serverAllowed: boolean
  /** governance surface 使用的详情（缺失时显示不可用） */
  detail?: DocumentIntelligenceSourceDetail | null
  /** 当前来源摘要（用于标题与返回上下文） */
  summary?: DocumentIntelligenceSourceSummary | null
  onClose: () => void
  /** 面板内 owning 操作成功后回调（由宿主做 surface 级精确失效） */
  onOwningSuccess?: (surface: DocumentIntelligenceSurface) => void
}

export function DocumentIntelligencePanelHost({
  surface,
  context,
  serverAllowed,
  detail,
  summary,
  onClose,
  onOwningSuccess,
}: DocumentIntelligencePanelHostProps) {
  useOwningMutationSuccess(surface, Boolean(surface && context), onOwningSuccess)

  const closeRef = useRef<HTMLButtonElement | null>(null)
  // 打开时把焦点移入面板，关闭时由调用方恢复到原来源行
  useEffect(() => {
    if (surface && context) closeRef.current?.focus()
  }, [surface, context])

  const block = useMemo(
    () =>
      surface && context
        ? resolvePanelMountBlock(
            surface,
            { jobId: context.jobId, extractionId: context.extractionId },
            serverAllowed,
          )
        : null,
    [surface, context, serverAllowed],
  )

  if (!surface || !context) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${SURFACE_LABELS[surface] ?? '面板'}：${summary?.displayName ?? ''}`}
      data-testid="di-panel-host"
      data-surface={surface}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-3xl flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {SURFACE_LABELS[surface]}
          {summary ? ` · ${summary.displayName}` : ''}
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          data-testid="di-panel-close"
          className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          关闭
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {block ? (
          <p
            className="text-sm text-amber-700 dark:text-amber-300"
            data-testid="di-panel-blocked"
            data-reason={block.reasonCode}
          >
            无法打开该面板：{REASON_LABELS[block.reasonCode]}
          </p>
        ) : (
          <Suspense
            fallback={
              <p className="text-sm text-gray-500 dark:text-gray-400" role="status">
                正在加载面板…
              </p>
            }
          >
            <PanelSurface surface={surface} context={context} detail={detail ?? null} />
          </Suspense>
        )}
      </div>
    </div>
  )
}

/**
 * surface → owning 组件的封闭映射（adapter 只做 context 转换）。
 *
 * `OcrSearchIndexPanel` / `OcrEntityLinkingPanel` 是既有的**项目级**面板，
 * 按 owning 规范以 projectId + readOnly 挂载；来源级上下文由 review（jobId）
 * 与 structured extraction（extractionId）承载，与 spec 的 scenario 语义一致。
 */
function PanelSurface({
  surface,
  context,
  detail,
}: {
  surface: DocumentIntelligenceSurface
  context: PanelHostContext
  detail: DocumentIntelligenceSourceDetail | null
}) {
  switch (surface) {
    case 'review':
      return <OcrReviewPanel projectId={context.projectId} jobId={context.jobId as number} />
    case 'search_index':
      return <OcrSearchIndexPanel projectId={context.projectId} readOnly={context.readOnly} />
    case 'structured_extraction':
      return (
        <OcrStructuredExtractionReview
          projectId={context.projectId}
          extractionId={context.extractionId ?? undefined}
          readOnly={context.readOnly}
        />
      )
    case 'entity_linking':
      return <OcrEntityLinkingPanel projectId={context.projectId} readOnly={context.readOnly} />
    case 'governance':
      return detail ? (
        <DocumentIntelligenceEvidencePanel detail={detail} />
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">证据与治理摘要暂不可用。</p>
      )
    case 'document_reader':
      return (
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="di-document-reader">
          {detail?.capabilities.documentBodyReadable
            ? '该来源的正文可在文件库的 Markdown 阅读器中查看（只读，不产生任何写入）。'
            : '该来源没有可直接阅读的文档正文。'}
        </p>
      )
    default:
      return null
  }
}

/**
 * 观测「owning 面板真的写成功了」的信号。
 *
 * 工作台自身零 mutation，因此宿主打开期间出现的任何 mutation 成功都必然来自
 * 当前 owning 面板。据此做 surface 级精确失效：
 * - 失败的 mutation 不触发（status 只认 'success'）；
 * - 未发生写入就关闭面板不触发；
 * - 永不调用无参数 invalidateQueries()（全局清空）。
 */
function useOwningMutationSuccess(
  surface: DocumentIntelligenceSurface | null,
  open: boolean,
  onOwningSuccess?: (surface: DocumentIntelligenceSurface) => void,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!open || !surface || !onOwningSuccess) return
    const cache = queryClient.getMutationCache()
    const seen = new Set<number>()
    const unsubscribe = cache.subscribe((event) => {
      const mutation = (event as { mutation?: { mutationId: number; state: { status: string } } })
        .mutation
      if (!mutation || mutation.state.status !== 'success') return
      if (seen.has(mutation.mutationId)) return
      seen.add(mutation.mutationId)
      onOwningSuccess(surface)
    })
    return () => unsubscribe()
  }, [queryClient, surface, open, onOwningSuccess])
}

export const OWNING_PANEL_COMPONENTS: Record<
  Extract<
    DocumentIntelligenceSurface,
    'review' | 'search_index' | 'structured_extraction' | 'entity_linking'
  >,
  ComponentType<never>
> = {
  review: OcrReviewPanel as unknown as ComponentType<never>,
  search_index: OcrSearchIndexPanel as unknown as ComponentType<never>,
  structured_extraction: OcrStructuredExtractionReview as unknown as ComponentType<never>,
  entity_linking: OcrEntityLinkingPanel as unknown as ComponentType<never>,
}

export default DocumentIntelligencePanelHost
