'use client'

import { AlertCircle, Clock, Package, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useManualRetryOutgoingWebhookBatch,
  useOutgoingWebhookBatchDeliveries,
} from '@/hooks/use-outgoing-webhook-deliveries'
import { OUTGOING_WEBHOOK_MANAGE_PERMISSION } from '@/lib/api/outgoing-webhook-deliveries'
import {
  OUTGOING_WEBHOOK_EVENT_METADATA,
  isAllowedOutgoingWebhookEvent,
  type OutgoingWebhookBatchProjectionDto,
  type OutgoingWebhookBatchStatus,
} from '@aiproj/types'

/**
 * v2-5-webhook-batched-delivery -- 出站 webhook 批量投递面板（任务 6.3）。
 *
 * 列出脱敏批量投递事件：批量状态、入口数、事件类型、上次尝试摘要、下次重试时间、
 * 暂停态、逐项结果。权限感知手动重试控件：仅 failed 且有权限时可重试。
 * 无 secret/payload body/signature 渲染。默认 fixture 投递，真实外发需授权。
 */

const BATCH_STATUS_LABEL: Record<OutgoingWebhookBatchStatus, string> = {
  pending: '待发送',
  in_progress: '发送中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  paused: '已暂停',
}

function batchStatusVariant(status: OutgoingWebhookBatchStatus) {
  switch (status) {
    case 'success':
      return 'success' as const
    case 'partial':
      return 'warning' as const
    case 'failed':
      return 'danger' as const
    case 'paused':
      return 'warning' as const
    default:
      return 'neutral' as const
  }
}

function eventLabel(evt: string): string {
  return isAllowedOutgoingWebhookEvent(evt) ? OUTGOING_WEBHOOK_EVENT_METADATA[evt].label : evt
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function OutgoingWebhookBatchDeliveryPanel() {
  const canManage = usePermissions().can(OUTGOING_WEBHOOK_MANAGE_PERMISSION)
  const query = useOutgoingWebhookBatchDeliveries()
  const retry = useManualRetryOutgoingWebhookBatch()

  const batches = query.data?.data ?? []

  function canRetry(d: OutgoingWebhookBatchProjectionDto): boolean {
    return canManage && d.batchStatus === 'failed' && !d.paused
  }

  return (
    <section
      id="outgoing-webhook-batch-deliveries"
      className="rounded-[var(--radius-lg)] border border-border bg-gray-0"
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
          <Package className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-md font-semibold text-gray-900">出站 Webhook 批量投递</h2>
          <p className="mt-1 text-sm text-gray-600">
            查看批量投递状态与逐项结果。失败批量可手动重试，需具备出站 webhook 管理权限。
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-[var(--radius-md)] bg-info-bg p-3 text-xs text-info">
          默认使用 fixture 投递，不发起真实外发。批量投递需启用并经明确授权。
        </div>

        {query.isLoading ? (
          <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-gray-100" />
        ) : batches.length === 0 ? (
          <EmptyState
            title="暂无批量投递记录"
            description="出站 webhook 事件批量投递后，记录将在此展示。"
          />
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {batches.map((d) => (
              <li key={d.batchId} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">
                        批量 #{d.batchId.slice(0, 16)}
                      </span>
                      <Badge variant={batchStatusVariant(d.batchStatus)}>
                        {BATCH_STATUS_LABEL[d.batchStatus]}
                      </Badge>
                      {d.paused && <Badge variant="warning">已暂停</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      入口数：{d.entryCount}
                      {d.eventTypes.length > 0 && (
                        <span>
                          {' · '}
                          事件类型：{d.eventTypes.map((et) => eventLabel(et)).join('、')}
                        </span>
                      )}
                    </p>
                    {d.lastAttemptSummary && (
                      <p className="mt-1 text-xs text-gray-500">最近尝试：{d.lastAttemptSummary}</p>
                    )}
                    {d.nextAttemptAt && d.batchStatus === 'pending' && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="h-3 w-3" aria-hidden />
                        下次重试：{formatTime(d.nextAttemptAt)}
                      </p>
                    )}
                    {d.perEntryOutcomes && d.perEntryOutcomes.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-gray-600 hover:text-gray-900">
                          查看逐项结果（{d.perEntryOutcomes.length}）
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {d.perEntryOutcomes.map((o) => (
                            <li key={o.deliveryEventId} className="flex items-center gap-2 text-xs">
                              <span className="font-mono text-gray-400">#{o.deliveryEventId}</span>
                              <Badge
                                variant={
                                  o.outcome === 'success'
                                    ? 'success'
                                    : o.outcome === 'retryable'
                                      ? 'warning'
                                      : 'danger'
                                }
                              >
                                {o.outcome}
                              </Badge>
                              {o.failureCategory && (
                                <span className="text-danger">{o.failureCategory}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-col gap-2">
                      {canRetry(d) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate({ batchId: d.batchId })}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          手动重试
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {retry.isError && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-danger">
                    <AlertCircle className="h-3 w-3" aria-hidden />
                    重试操作失败，请稍后重试。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {!canManage && batches.length > 0 && (
          <p className="text-xs text-gray-500">你无权管理批量投递，以上为只读视图。</p>
        )}
      </div>
    </section>
  )
}
