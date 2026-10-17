'use client'

import { useState, useMemo, useCallback } from 'react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import type {
  OcrDocumentWorkspaceRowSummary,
  OcrDocumentWorkspaceStatus,
  OcrDocumentWorkspaceAction,
  OcrDocumentWorkspaceFilters,
  OcrDocumentWorkspaceBlockReason,
} from '@aiproj/types'
import { filterOcrWorkspaceRows, sortOcrWorkspaceRows, redactDenialReason } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 状态标签视觉映射
// ---------------------------------------------------------------------------

const STATUS_BADGE_VARIANTS: Record<
  OcrDocumentWorkspaceStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai'
> = {
  unsupported: 'neutral',
  no_job: 'neutral',
  queued: 'info',
  processing: 'info',
  failed: 'danger',
  reviewable: 'warning',
  confirmed: 'success',
  stale: 'warning',
  blocked: 'danger',
  degraded: 'neutral',
}

const STATUS_LABELS: Record<OcrDocumentWorkspaceStatus, string> = {
  unsupported: '不支持',
  no_job: '未识别',
  queued: '排队中',
  processing: '处理中',
  failed: '失败',
  reviewable: '待审查',
  confirmed: '已确认',
  stale: '已过期',
  blocked: '已阻止',
  degraded: '降级',
}

const BLOCK_REASON_LABELS: Record<OcrDocumentWorkspaceBlockReason, string> = {
  retention_hold: '保留限制',
  privacy_block: '隐私限制',
  lifecycle_expired: '已过期',
  lifecycle_purged: '已清除',
  permission_denied: '权限不足',
  source_hidden: '不可访问',
  unsupported_mime: '文件不支持',
}

const ACTION_LABELS: Record<OcrDocumentWorkspaceAction, string> = {
  create_ocr: '识别文字',
  retry_ocr: '重试',
  review: '审查',
  confirm: '确认',
  search_index: '索引',
  structured_extraction: '结构化提取',
  entity_linking: '实体关联',
  export: '导出',
  copy: '复制',
  cleanup: '清理',
  view_governance: '治理',
}

const STATUS_FILTER_OPTIONS: { value: OcrDocumentWorkspaceStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'reviewable', label: '待审查' },
  { value: 'processing', label: '处理中' },
  { value: 'confirmed', label: '已确认' },
  { value: 'failed', label: '失败' },
  { value: 'no_job', label: '未识别' },
  { value: 'blocked', label: '已阻止' },
  { value: 'stale', label: '已过期' },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OcrDocumentsWorkspaceProps {
  /** 工作台行摘要 */
  rows: OcrDocumentWorkspaceRowSummary[]
  /** 是否加载中 */
  isLoading: boolean
  /** 是否有 OCR 活动 */
  hasAnyOcrActivity: boolean
  /** 总数统计 */
  counts: {
    total: number
    reviewable: number
    confirmed: number
    processing: number
    failed: number
    blocked: number
  }
  /** 行操作回调 */
  onAction: (action: OcrDocumentWorkspaceAction, row: OcrDocumentWorkspaceRowSummary) => void
  /** 可否过滤 */
  showFilters?: boolean
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function OcrDocumentsWorkspace({
  rows,
  isLoading,
  hasAnyOcrActivity: _hasAnyOcrActivity,
  counts,
  onAction,
  showFilters = true,
}: OcrDocumentsWorkspaceProps) {
  const [filters, setFilters] = useState<OcrDocumentWorkspaceFilters>({
    status: null,
    isSupported: null,
    search: null,
  })
  const [activeFilter, setActiveFilter] = useState<OcrDocumentWorkspaceStatus | 'all'>('all')

  const handleFilterChange = useCallback((status: OcrDocumentWorkspaceStatus | 'all') => {
    setActiveFilter(status)
    setFilters((prev) => ({
      ...prev,
      status: status === 'all' ? null : status,
    }))
  }, [])

  const displayRows = useMemo(() => {
    const filtered = filterOcrWorkspaceRows(rows, filters)
    return sortOcrWorkspaceRows(filtered, { field: 'status', direction: 'asc' })
  }, [rows, filters])

  if (isLoading) {
    return (
      <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        OCR 状态加载中...
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        暂无 OCR 可识别的文件
      </div>
    )
  }

  return (
    <div className="ocr-workspace">
      {/* 筛选栏 */}
      {showFilters && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const isActive = activeFilter === opt.value
            const count =
              opt.value === 'all' ? counts.total : rows.filter((r) => r.status === opt.value).length

            return (
              <button
                key={opt.value}
                onClick={() => handleFilterChange(opt.value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
                )}
                aria-pressed={isActive}
                aria-label={`筛选 ${opt.label} (${count})`}
              >
                {opt.label}
                <span
                  className={cn(
                    'ml-0.5 rounded px-1 text-[10px]',
                    isActive ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 行列表 */}
      {displayRows.length === 0 ? (
        <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          没有匹配的 OCR 状态
        </div>
      ) : (
        <div className="space-y-1.5">
          {displayRows.map((row) => (
            <OcrDocumentRow key={row.sourceId} row={row} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 行组件
// ---------------------------------------------------------------------------

interface OcrDocumentRowProps {
  row: OcrDocumentWorkspaceRowSummary
  onAction: (action: OcrDocumentWorkspaceAction, row: OcrDocumentWorkspaceRowSummary) => void
}

function OcrDocumentRow({ row, onAction }: OcrDocumentRowProps) {
  const primaryAction = row.allowedActions.find((a) => a !== 'view_governance')

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded border p-2 sm:gap-3 sm:p-3',
        row.status === 'blocked' || row.status === 'degraded'
          ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30'
          : row.status === 'reviewable'
            ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30'
            : 'border-gray-200 dark:border-gray-700',
      )}
      data-testid={`ocr-row-${row.sourceId}`}
      role="row"
    >
      {/* 左侧：文件信息 + OCR 状态 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {/* 文件类型图标 */}
        <span className="flex-shrink-0 text-base sm:text-lg" aria-hidden="true">
          {row.isSupported ? '📄' : '📎'}
        </span>

        {/* 文件名与详情 */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium" title={row.sourceFileName ?? ''}>
              {row.sourceFileName ?? '未命名文件'}
            </p>
            <OcrStatusBadge status={row.status} />
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            {/* 页面进度 */}
            {row.totalPages !== null && (
              <span>
                {row.succeededPages ?? 0}/{row.totalPages} 页
              </span>
            )}

            {/* 警告 */}
            {row.warningCodes.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                警告 × {row.warningCodes.length}
              </span>
            )}

            {/* 阻止原因 */}
            {row.blockReason && (
              <span className="text-red-600 dark:text-red-400" role="alert">
                {redactDenialReason({
                  blockReason: row.blockReason,
                  isHidden: row.blockReason === 'source_hidden',
                })}
              </span>
            )}

            {/* 成本 */}
            {row.estimatedCost !== null && (
              <span className="text-gray-400">
                ≈ {row.estimatedCost.toFixed(4)} {row.costCurrency ?? ''}
              </span>
            )}

            {/* Stale 标记 */}
            {row.isStale && <span className="text-amber-600 dark:text-amber-400">源已变更</span>}
          </div>
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
        {primaryAction && (
          <button
            onClick={() => onAction(primaryAction, row)}
            disabled={row.allowedActions.length === 0}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm',
              primaryAction === 'create_ocr' && 'bg-blue-600 text-white hover:bg-blue-700',
              primaryAction === 'retry_ocr' && 'bg-amber-600 text-white hover:bg-amber-700',
              primaryAction === 'review' && 'bg-purple-600 text-white hover:bg-purple-700',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            aria-label={ACTION_LABELS[primaryAction]}
            data-testid={`ocr-action-${primaryAction}-${row.sourceId}`}
          >
            {ACTION_LABELS[primaryAction]}
          </button>
        )}

        {/* 下游入口按钮 */}
        {row.allowedActions.includes('search_index') && (
          <button
            onClick={() => onAction('search_index', row)}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 sm:px-2"
            aria-label="搜索索引"
            data-testid={`ocr-action-search_index-${row.sourceId}`}
          >
            索引
          </button>
        )}

        {row.allowedActions.includes('structured_extraction') && (
          <button
            onClick={() => onAction('structured_extraction', row)}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 sm:px-2"
            aria-label="结构化提取"
            data-testid={`ocr-action-structured_extraction-${row.sourceId}`}
          >
            提取
          </button>
        )}

        {row.allowedActions.includes('entity_linking') && (
          <button
            onClick={() => onAction('entity_linking', row)}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 sm:px-2"
            aria-label="实体关联"
            data-testid={`ocr-action-entity_linking-${row.sourceId}`}
          >
            关联
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 状态徽标
// ---------------------------------------------------------------------------

export function OcrStatusBadge({
  status,
  className,
}: {
  status: OcrDocumentWorkspaceStatus
  className?: string
}) {
  const variant = STATUS_BADGE_VARIANTS[status]
  const label = STATUS_LABELS[status]

  return (
    <Badge
      variant={variant}
      className={cn('flex-shrink-0 text-[10px]', className)}
      data-testid={`ocr-status-${status}`}
      role="status"
    >
      {label}
    </Badge>
  )
}

export { STATUS_LABELS, BLOCK_REASON_LABELS, ACTION_LABELS }
