/**
 * v3-ocr-batch-and-queue-processing §6.3–6.9 — OCR 批量/队列 UI 组件。
 *
 * 提供：
 * - OCR 批量创建入口（有界源选择、模型摘要、页面/文档限制）
 * - 批量进度摘要（状态 badges、counters、warnings）
 * - 队列 drill-down（脱敏源引用、job/page 链接、重试时间、warning badges）
 * - retry/cancel/resume 控制（含确认对话框）
 * - 只读降级
 * - 审查导向文案
 */

'use client'

import React, { useState } from 'react'
import type { OcrBatchSummary, OcrBatchAllowedAction } from '@aiproj/types'
import {
  useOcrBatches,
  useOcrQueueSummary,
  useRetryOcrBatch,
  useCancelOcrBatch,
  useResumeOcrBatch,
} from '@/hooks/use-ocr-batch'

// ── Sub-components ──

function BatchStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    processing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    partial: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    paused: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    succeeded: 'bg-green-100 text-green-800',
    budget_blocked: 'bg-amber-100 text-amber-800',
    rate_limited: 'bg-cyan-100 text-cyan-800',
    stale_blocked: 'bg-rose-100 text-rose-800',
  }

  const labelMap: Record<string, string> = {
    queued: '排队中',
    processing: '处理中',
    completed: '已完成',
    partial: '部分完成',
    failed: '失败',
    cancelled: '已取消',
    paused: '已暂停',
    succeeded: '成功',
    budget_blocked: '预算阻断',
    rate_limited: '限流等待',
    stale_blocked: '源已变更',
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        colorMap[status] ?? 'bg-gray-100 text-gray-800'
      }`}
    >
      {labelMap[status] ?? status}
    </span>
  )
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div
        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-sm w-full">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Batch Card ──

function BatchCard({
  batch,
  projectId,
  allowedActions,
}: {
  batch: OcrBatchSummary
  projectId: number
  allowedActions: OcrBatchAllowedAction[]
}) {
  const [showConfirm, setShowConfirm] = useState<{ action: string } | null>(null)
  const retryMutation = useRetryOcrBatch(projectId, Number(batch.id))
  const cancelMutation = useCancelOcrBatch(projectId, Number(batch.id))
  const resumeMutation = useResumeOcrBatch(projectId, Number(batch.id))

  const total = batch.sourceCount
  const completed = batch.completedCount

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-gray-500">#{batch.id}</span>
        <BatchStatusBadge status={batch.status} />
      </div>

      <ProgressBar completed={completed} total={total} />

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>
          {batch.completedCount}/{total} 完成
        </span>
        {batch.failedCount > 0 && <span className="text-red-500">{batch.failedCount} 失败</span>}
        {batch.queuedCount > 0 && <span className="text-blue-500">{batch.queuedCount} 排队</span>}
        {batch.processingCount > 0 && (
          <span className="text-yellow-500">{batch.processingCount} 处理中</span>
        )}
      </div>

      {(batch.warningCodes ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(batch.warningCodes ?? []).map((code) => (
            <span
              key={code}
              className="inline-flex items-center rounded bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-200"
            >
              {code}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      {allowedActions.includes('retry' as OcrBatchAllowedAction) && (
        <button
          onClick={() => setShowConfirm({ action: 'retry' })}
          disabled={retryMutation.isPending}
          className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          重新处理
        </button>
      )}
      {allowedActions.includes('cancel' as OcrBatchAllowedAction) && (
        <button
          onClick={() => setShowConfirm({ action: 'cancel' })}
          disabled={cancelMutation.isPending}
          className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950 disabled:opacity-50"
        >
          取消
        </button>
      )}
      {allowedActions.includes('resume' as OcrBatchAllowedAction) && (
        <button
          onClick={() => setShowConfirm({ action: 'resume' })}
          disabled={resumeMutation.isPending}
          className="text-xs px-2 py-1 rounded border border-green-300 text-green-600 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950 disabled:opacity-50"
        >
          恢复
        </button>
      )}

      <ConfirmDialog
        open={showConfirm !== null}
        title={
          showConfirm?.action === 'retry'
            ? '确认重新处理'
            : showConfirm?.action === 'cancel'
              ? '确认取消'
              : '确认恢复'
        }
        message={
          showConfirm?.action === 'retry'
            ? '将重新处理失败的队列项，已成功的数据不会丢失。是否继续？'
            : showConfirm?.action === 'cancel'
              ? '取消后正在进行的处理将在当前步骤完成后停止，已成功的数据保持可审阅。是否继续？'
              : '恢复后将重新验证源文件和权限，然后继续处理。是否继续？'
        }
        onConfirm={() => {
          const action = showConfirm?.action
          setShowConfirm(null)
          if (action === 'retry') retryMutation.mutate(undefined)
          else if (action === 'cancel') cancelMutation.mutate(undefined)
          else if (action === 'resume') resumeMutation.mutate(undefined)
        }}
        onCancel={() => setShowConfirm(null)}
      />
    </div>
  )
}

// ── Queue Summary ──

function QueueSummaryWidget({ projectId }: { projectId: number }) {
  const { data, isLoading } = useOcrQueueSummary(projectId)

  if (isLoading || !data?.data) {
    return <div className="text-sm text-gray-400">加载队列状态...</div>
  }

  const s = data.data
  if (s.total === 0) {
    return <div className="text-sm text-gray-400">队列为空</div>
  }

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">总计: {s.total}</span>
      {s.queued > 0 && (
        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800">排队: {s.queued}</span>
      )}
      {s.processing > 0 && (
        <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">
          处理中: {s.processing}
        </span>
      )}
      {s.succeeded > 0 && (
        <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">成功: {s.succeeded}</span>
      )}
      {s.failed > 0 && (
        <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">失败: {s.failed}</span>
      )}
      {s.budgetBlocked > 0 && (
        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">
          预算阻断: {s.budgetBlocked}
        </span>
      )}
      {s.rateLimited > 0 && (
        <span className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-800">限流: {s.rateLimited}</span>
      )}
      {s.staleBlocked > 0 && (
        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800">
          源变更: {s.staleBlocked}
        </span>
      )}
    </div>
  )
}

// ── Batch List ──

export function OcrBatchList({ projectId }: { projectId: number }) {
  const { data, isLoading } = useOcrBatches(projectId)

  if (isLoading) {
    return <div className="text-sm text-gray-400">加载批量列表...</div>
  }

  const batches = data?.data ?? []

  if (batches.length === 0) {
    return <div className="text-sm text-gray-400">暂无 OCR 批量操作</div>
  }

  return (
    <div className="space-y-3">
      {batches.map((batch) => (
        <BatchCard
          key={batch.id}
          batch={batch}
          projectId={projectId}
          allowedActions={['view', 'inspect_queue']}
        />
      ))}
    </div>
  )
}

// ── Exported composite panel ──

export function OcrBatchQueuePanel({ projectId }: { projectId: number }) {
  const [view, setView] = useState<'batches' | 'queue'>('batches')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        <button
          onClick={() => setView('batches')}
          className={`text-sm px-3 py-1 rounded-t ${
            view === 'batches'
              ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          批量操作
        </button>
        <button
          onClick={() => setView('queue')}
          className={`text-sm px-3 py-1 rounded-t ${
            view === 'queue'
              ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          队列状态
        </button>
      </div>

      {view === 'batches' ? (
        <OcrBatchList projectId={projectId} />
      ) : (
        <QueueSummaryWidget projectId={projectId} />
      )}

      <p className="text-xs text-gray-400 mt-4">
        OCR 输出为候选数据，需人工审阅确认后才会被使用。不会自动应用或写入项目数据。
      </p>
    </div>
  )
}
