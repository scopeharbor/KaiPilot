'use client'

/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 投递统计面板（5.3 P1）。
 *
 * 展示脱敏组织级投递健康统计：总数、状态分布、成功率、失败分类等。
 * feature-off 时显示不可用态。
 * 无 outgoing_webhook:manage 权限的用户不可见（同其他集成管理面板）。
 */
import * as React from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePermissions } from '@/hooks/use-permissions'
import { useOutgoingWebhookStats } from '@/hooks/use-outgoing-webhook-templates-and-stats'
import { OUTGOING_WEBHOOK_MANAGE_PERMISSION } from '@/lib/api/outgoing-webhooks'
import type { OutgoingWebhookStatsDto, OutgoingWebhookStatsUnavailableDto } from '@aiproj/types'

type StatsQueryData =
  | OutgoingWebhookStatsDto
  | OutgoingWebhookStatsUnavailableDto
  | { data?: OutgoingWebhookStatsDto | OutgoingWebhookStatsUnavailableDto }

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null
}

function unwrapStatsData(
  data: StatsQueryData | undefined,
): OutgoingWebhookStatsDto | OutgoingWebhookStatsUnavailableDto | null {
  if (!isRecord(data)) return null
  const unwrapped = 'data' in data ? data.data : data
  return isRecord(unwrapped)
    ? (unwrapped as OutgoingWebhookStatsDto | OutgoingWebhookStatsUnavailableDto)
    : null
}

function isStatsDto(data: unknown): data is OutgoingWebhookStatsDto {
  return isRecord(data) && 'totalDeliveries' in data
}

function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  variant = 'default',
}: {
  label: string
  value: string | number
  sublabel?: string
  icon: React.ComponentType<{ className?: string }>
  variant?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const colorMap = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-gray-0 p-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-[var(--radius-sm)] p-1.5 ${colorMap[variant]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
      {sublabel ? <p className="text-xs text-gray-500">{sublabel}</p> : null}
    </div>
  )
}

function FailureCategoryBadge({ category, count }: { category: string; count: number }) {
  if (count === 0) return null
  const labelMap: Record<string, { label: string; variant: 'warning' | 'danger' | 'neutral' }> = {
    timeout: { label: '超时', variant: 'warning' },
    network: { label: '网络错误', variant: 'danger' },
    rate_limited: { label: '限流', variant: 'warning' },
    server_error: { label: '服务端错误', variant: 'danger' },
    client_error: { label: '客户端错误', variant: 'warning' },
    signature: { label: '签名错误', variant: 'danger' },
    config: { label: '配置错误', variant: 'danger' },
    disabled: { label: '已禁用', variant: 'neutral' },
    exhausted: { label: '重试耗尽', variant: 'danger' },
    unknown: { label: '未知', variant: 'neutral' },
  }
  const meta = labelMap[category] ?? { label: category, variant: 'neutral' as const }

  return (
    <Badge variant={meta.variant}>
      {meta.label}: {count}
    </Badge>
  )
}

function StatsDisplay({ stats }: { stats: OutgoingWebhookStatsDto }) {
  const byStatus = stats.byStatus
  const total = stats.totalDeliveries

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="投递总数" value={total} icon={BarChart3} />
        <StatCard
          label="成功"
          value={byStatus.success}
          sublabel={`${(stats.successRate * 100).toFixed(1)}%`}
          icon={CheckCircle2}
          variant="success"
        />
        <StatCard
          label="失败"
          value={byStatus.failed}
          sublabel={`${(stats.failureRate * 100).toFixed(1)}%`}
          icon={XCircle}
          variant="danger"
        />
        <StatCard
          label="待处理"
          value={byStatus.pending + byStatus.in_progress}
          icon={Clock}
          variant="warning"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="总重试次数" value={stats.totalRetries} icon={RefreshCw} />
        <StatCard label="活跃订阅" value={stats.activeSubscriptionCount} icon={Activity} />
        <StatCard
          label="最近投递"
          value={
            stats.lastDeliveryAt ? new Date(stats.lastDeliveryAt).toLocaleDateString('zh-CN') : '无'
          }
          icon={Clock}
        />
        <StatCard
          label="下次重试"
          value={stats.nextRetryAt ? new Date(stats.nextRetryAt).toLocaleDateString('zh-CN') : '无'}
          icon={Clock}
        />
      </div>

      {/* 失败分类 */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-gray-700">失败分类</h4>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(stats.byFailureCategory).map(([cat, count]) => (
            <FailureCategoryBadge key={cat} category={cat} count={Number(count)} />
          ))}
        </div>
        {Object.values(stats.byFailureCategory).every((v) => v === 0) ? (
          <p className="text-xs text-gray-500">暂无失败记录</p>
        ) : null}
      </div>
    </div>
  )
}

export function OutgoingWebhookStatsPanel() {
  const canManage = usePermissions().can(OUTGOING_WEBHOOK_MANAGE_PERMISSION)
  const query = useOutgoingWebhookStats()

  if (!canManage) return null

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
          <BarChart3 className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-md font-semibold text-gray-900">出站 Webhook 投递统计</h2>
          <p className="mt-1 text-sm text-gray-600">
            组织级投递健康汇总，仅含聚合计数与分类，不包含 payload 或敏感信息。
          </p>
        </div>
      </div>

      <div className="p-4">
        {query.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : query.isError ? (
          <EmptyState
            icon={ShieldAlert}
            title="统计加载失败"
            description="请检查网络或稍后重试。"
          />
        ) : !query.data ? (
          <EmptyState icon={BarChart3} title="统计不可用" description="暂无投递统计数据。" />
        ) : (
          (() => {
            const data = unwrapStatsData(query.data as StatsQueryData)
            if (!data) {
              return (
                <EmptyState icon={BarChart3} title="统计不可用" description="暂无投递统计数据。" />
              )
            }
            if (!isStatsDto(data)) {
              return (
                <EmptyState
                  icon={AlertTriangle}
                  title={data.reason === 'feature_disabled' ? '统计功能未启用' : '暂无投递数据'}
                  description={
                    data.reason === 'feature_disabled'
                      ? '管理员已禁用出站 webhook 统计功能。'
                      : '当前组织尚未有出站 webhook 投递记录。'
                  }
                />
              )
            }
            return <StatsDisplay stats={data} />
          })()
        )}
      </div>
    </section>
  )
}
