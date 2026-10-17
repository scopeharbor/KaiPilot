'use client'

import type {
  DocumentIntelligenceAttentionFacet,
  DocumentIntelligenceDimension,
  DocumentIntelligenceDimensionState,
  DocumentIntelligenceReasonCode,
  DocumentIntelligenceSourceSummary,
  DocumentIntelligenceSurface,
} from '@aiproj/types'

/**
 * 文档智能来源清单（v3-document-intelligence-workbench §4.5 / §4.6）。
 *
 * 红线：
 * - 原生文档与可识别附件同列表但**能力互不混淆**：`not_applicable` 永不渲染成失败。
 * - `unavailable` / `blocked` / `stale` / `truncated` 一律显式呈现，绝不合成「空」或「就绪」。
 * - 入口 enabled 完全来自服务端裁决，前端不得自行放行。
 */

export const ATTENTION_LABELS: Record<DocumentIntelligenceAttentionFacet, string> = {
  needs_review: '待审查',
  processing: '处理中',
  failed: '失败',
  stale: '来源已变更',
  governance_blocked: '治理阻断',
  ready_for_downstream: '可进入下游',
}

export const DIMENSION_LABELS: Record<DocumentIntelligenceDimension, string> = {
  ocr_job: 'OCR 作业',
  accepted_extraction: '已接受提取',
  search_index: '搜索索引',
  structured_snapshot: '结构化快照',
  entity_link: '实体关联',
  governance: '治理',
}

export const DIMENSION_STATE_LABELS: Record<DocumentIntelligenceDimensionState, string> = {
  ready: '就绪',
  empty: '暂无',
  unavailable: '不可用',
  hidden: '不可见',
  stale: '已过期',
  blocked: '已阻断',
  truncated: '已截断',
  not_applicable: '不适用',
}

export const REASON_LABELS: Record<DocumentIntelligenceReasonCode, string> = {
  none: '无',
  permission_denied: '权限不足',
  privacy_blocked: '隐私策略阻断',
  retention_hold: '保留冻结中',
  retention_expired: '已过保留期',
  lifecycle_superseded: '已被新版本取代',
  lifecycle_purged: '已清除',
  stale_source: '来源已变更',
  source_hidden: '目标不可见',
  unsupported_mime: '不支持的文件类型',
  no_accepted_extraction: '尚无已接受提取',
  dimension_failed: '该维度读取失败',
  truncated_by_budget: '结果已截断',
  audit_restricted: '审计明细受限',
  profile_invalid: 'Profile 无效',
  profile_disabled: 'Profile 已停用',
  unknown_surface: '未知面板',
}

export const SURFACE_LABELS: Record<DocumentIntelligenceSurface, string> = {
  review: '审查确认',
  search_index: '搜索索引',
  structured_extraction: '结构化抽取',
  entity_linking: '实体关联',
  governance: '证据与治理',
  document_reader: '文档阅读',
}

/** 维度状态 → 视觉语气（同时保留 title 文案，色觉障碍下不丢信息） */
function stateTone(state: DocumentIntelligenceDimensionState): string {
  switch (state) {
    case 'ready':
      return 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    case 'blocked':
    case 'hidden':
      return 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'unavailable':
    case 'truncated':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    case 'stale':
      return 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
    case 'not_applicable':
      return 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

interface DocumentIntelligenceSourceListProps {
  rows: DocumentIntelligenceSourceSummary[]
  isLoading?: boolean
  /** 当前选中的来源（用于焦点/高亮恢复） */
  selectedRef?: string | null
  onSelectSource: (row: DocumentIntelligenceSourceSummary) => void
  onOpenSurface: (
    row: DocumentIntelligenceSourceSummary,
    surface: DocumentIntelligenceSurface,
  ) => void
}

export function sourceRefOf(row: { sourceKind: string; sourceId: number }): string {
  return `${row.sourceKind}:${row.sourceId}`
}

export function DocumentIntelligenceSourceList({
  rows,
  isLoading = false,
  selectedRef = null,
  onSelectSource,
  onOpenSurface,
}: DocumentIntelligenceSourceListProps) {
  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400" role="status">
        正在加载文档智能数据…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        当前筛选条件下没有可显示的来源。
      </div>
    )
  }

  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700" role="list">
      {rows.map((row) => {
        const ref = sourceRefOf(row)
        const primary = row.entrypoints.find(
          (e) => e.enabled && e.surface !== 'document_reader' && e.surface !== 'governance',
        )
        return (
          <li
            key={ref}
            data-testid={`di-source-${ref}`}
            data-source-ref={ref}
            aria-selected={selectedRef === ref}
            className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between ${
              selectedRef === ref ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelectSource(row)}
                className="truncate text-left text-sm font-medium text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-100"
              >
                {row.displayName}
              </button>

              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {row.sourceKind === 'native_document' ? '原生文档' : '附件'}
                </span>
                {row.capabilities.documentBodyReadable && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    正文可读
                  </span>
                )}
                {row.sourceKind === 'attachment' && !row.capabilities.ocrSupportedMime && (
                  <span
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    data-testid={`di-unsupported-${ref}`}
                  >
                    {REASON_LABELS.unsupported_mime}
                  </span>
                )}
                {row.attentionFacets.map((facet) => (
                  <span
                    key={facet}
                    data-testid={`di-facet-${ref}-${facet}`}
                    className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  >
                    {ATTENTION_LABELS[facet]}
                  </span>
                ))}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {(Object.keys(DIMENSION_LABELS) as DocumentIntelligenceDimension[]).map((dim) => {
                  const state = row.dimensionStates[dim]
                  return (
                    <span
                      key={dim}
                      data-testid={`di-dim-${ref}-${dim}`}
                      data-state={state}
                      title={`${DIMENSION_LABELS[dim]}：${DIMENSION_STATE_LABELS[state]}`}
                      className={`rounded px-1.5 py-0.5 ${stateTone(state)}`}
                    >
                      {DIMENSION_LABELS[dim]}·{DIMENSION_STATE_LABELS[state]}
                    </span>
                  )
                })}
              </div>

              {row.warningReasons.length > 0 && (
                <p
                  className="mt-1 text-xs text-amber-700 dark:text-amber-300"
                  data-testid={`di-warnings-${ref}`}
                >
                  {row.warningReasons.map((r) => REASON_LABELS[r]).join('；')}
                </p>
              )}
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              {row.entrypoints.map((entry) => (
                <button
                  key={entry.surface}
                  type="button"
                  data-testid={`di-entry-${ref}-${entry.surface}`}
                  disabled={!entry.enabled}
                  title={
                    entry.enabled
                      ? undefined
                      : REASON_LABELS[entry.reasonCode ?? 'permission_denied']
                  }
                  aria-disabled={!entry.enabled}
                  onClick={() => onOpenSurface(row, entry.surface)}
                  className={`rounded border px-2 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    entry.enabled
                      ? entry === primary
                        ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-600'
                  }`}
                >
                  {SURFACE_LABELS[entry.surface]}
                </button>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default DocumentIntelligenceSourceList
