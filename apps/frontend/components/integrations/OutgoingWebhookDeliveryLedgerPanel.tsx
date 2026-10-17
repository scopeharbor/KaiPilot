'use client'

import { AlertCircle, Clock, Pause, Play, RefreshCw, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useManualRetryOutgoingWebhookDelivery,
  useOutgoingWebhookDeliveries,
  usePauseOutgoingWebhookDelivery,
  useUnpauseOutgoingWebhookDelivery,
} from '@/hooks/use-outgoing-webhook-deliveries'
import { OUTGOING_WEBHOOK_MANAGE_PERMISSION } from '@/lib/api/outgoing-webhook-deliveries'
import {
  OUTGOING_WEBHOOK_EVENT_METADATA,
  isAllowedOutgoingWebhookEvent,
  type OutgoingWebhookDeliveryEventDto,
  type OutgoingWebhookDeliveryStatus,
} from '@aiproj/types'

/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本面板（任务 9.3/9.5）。
 *
 * 列出脱敏投递事件：状态、订阅引用、事件类型、尝试次数、最近尝试摘要、下次重试时间、
 * 暂停态、终态失败原因。权限感知手动重试/暂停/恢复控件：仅 failed 且有权限时可重试。
 * 无 secret/payload body/signature 渲染。默认 fixture 投递，真实外发需授权。
 */

const STATUS_LABEL: Record<OutgoingWebhookDeliveryStatus, string> = {
  pending: '待发送',
  in_progress: '发送中',
  success: '成功',
  failed: '失败',
  paused: '已暂停',
}

function statusVariant(status: OutgoingWebhookDeliveryStatus) {
  switch (status) {
    case 'success':
      return 'success' as const
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

export function OutgoingWebhookDeliveryLedgerPanel() {
  const canManage = usePermissions().can(OUTGOING_WEBHOOK_MANAGE_PERMISSION)
  const query = useOutgoingWebhookDeliveries()
  const retry = useManualRetryOutgoingWebhookDelivery()
  const pause = usePauseOutgoingWebhookDelivery()
  const unpause = useUnpauseOutgoingWebhookDelivery()

  const deliveries = query.data?.data ?? []

  function canRetry(d: OutgoingWebhookDeliveryEventDto): boolean {
    return canManage && d.status === 'failed' && !d.paused
  }

  return (
    <section
      id="outgoing-webhook-deliveries"
      className="rounded-[var(--radius-lg)] border border-border bg-gray-0"
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
          <Webhook className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-md font-semibold text-gray-900">出站 Webhook 投递账本</h2>
          <p className="mt-1 text-sm text-gray-600">
            查看投递事件状态与尝试记录。失败事件可手动重试，需具备出站 webhook 管理权限。
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-[var(--radius-md)] bg-info-bg p-3 text-xs text-info">
          默认使用 fixture 投递，不发起真实外发。真实投递需启用并经明确授权。
        </div>

        {query.isLoading ? (
          <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-gray-100" />
        ) : deliveries.length === 0 ? (
          <EmptyState
            title="暂无投递记录"
            description="出站 webhook 事件触发后，投递记录将在此展示。"
          />
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {deliveries.map((d) => (
              <li key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {d.subscriptionName || `订阅 #${d.subscriptionId}`}
                      </span>
                      <Badge variant={statusVariant(d.status)}>{STATUS_LABEL[d.status]}</Badge>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {eventLabel(d.eventType)}
                      </span>
                      {d.paused && <Badge variant="warning">已暂停</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      尝试次数：{d.attemptCount}/{d.maxAttempts}
                      {d.lastAttemptStatus && ` · 最近尝试：${d.lastAttemptStatus}`}
                      {d.lastAttemptAt && ` · ${formatTime(d.lastAttemptAt)}`}
                    </p>
                    {d.failureCategory && (
                      <p className="mt-1 text-xs text-danger">
                        失败分类：{d.failureCategory}
                        {d.terminalFailureReason && `（${d.terminalFailureReason}）`}
                      </p>
                    )}
                    {d.nextAttemptAt && d.status === 'pending' && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="h-3 w-3" aria-hidden />
                        下次重试：{formatTime(d.nextAttemptAt)}
                      </p>
                    )}
                    <p className="mt-1 break-all font-mono text-xs text-gray-400">
                      {d.idempotencyKey}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-col gap-2">
                      {canRetry(d) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate({ id: d.id })}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          手动重试
                        </Button>
                      )}
                      {!d.paused ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pause.isPending}
                          onClick={() => pause.mutate(d.id)}
                        >
                          <Pause className="h-3.5 w-3.5" aria-hidden />
                          暂停
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={unpause.isPending}
                          onClick={() => unpause.mutate(d.id)}
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden />
                          恢复
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {(retry.isError || pause.isError || unpause.isError) && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-danger">
                    <AlertCircle className="h-3 w-3" aria-hidden />
                    操作失败，请稍后重试。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {!canManage && deliveries.length > 0 && (
          <p className="text-xs text-gray-500">你无权管理投递，以上为只读视图。</p>
        )}
      </div>
    </section>
  )
}
