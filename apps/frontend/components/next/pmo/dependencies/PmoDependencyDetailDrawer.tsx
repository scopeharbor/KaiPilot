'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { useMpdDetail } from '@/hooks/use-multi-project-dependencies'
import { cn } from '@/lib/utils'
import {
  categoryLabel,
  dependencyTypeLabel,
  endpointTypeLabel,
  formatMpdDateTime,
  normalizeMpdDetailPayload,
  sourceModeLabel,
  type MpdRowView,
} from './mpd-adapter'
import { MpdFreshnessChip, MpdRiskBadge, MpdStatusBadge, MpdWarningChips } from './MpdBadges'

/**
 * 单依赖详情抽屉（v3-ui-next-pmo-domain W7 · tasks 7.3）。
 *
 * - 消费 `useMpdDetail(orgId, depId)`，行/端点双形态归一（mpd-adapter），
 *   覆盖 legacy 与 CRUD 双契约字段；
 * - 只读呈现依赖链路、规则与新鲜度；无任何写入口（RL-01）；
 * - API 404/403 → 中性文案「数据不存在或无权访问」（RL-05），不泄露跨组织存在性；
 * - 三态：加载骨架 / 错误重试 / 内容。
 */
export interface PmoDependencyDetailDrawerProps {
  organizationId: number
  depId: string | null
  onClose: () => void
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-[var(--nx-text-muted)]">
        {label}
      </dt>
      <dd className="text-xs text-[var(--nx-text-primary)]">{children}</dd>
    </div>
  )
}

function DetailContent({ dep }: { dep: MpdRowView }) {
  const providerType = dep.providerType ? `${endpointTypeLabel(dep.providerType)}` : null
  const consumerType = dep.consumerType ? `${endpointTypeLabel(dep.consumerType)}` : null
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      <DetailRow label="提供方">
        <span className="block truncate" title={dep.providerLabel}>
          {dep.providerLabel}
        </span>
        {providerType ? (
          <span className="mt-0.5 block font-mono text-[9px] text-[var(--nx-text-muted)]">
            {providerType}
          </span>
        ) : null}
      </DetailRow>
      <DetailRow label="消费方">
        <span className="block truncate" title={dep.consumerLabel}>
          {dep.consumerLabel}
        </span>
        {consumerType ? (
          <span className="mt-0.5 block font-mono text-[9px] text-[var(--nx-text-muted)]">
            {consumerType}
          </span>
        ) : null}
      </DetailRow>
      <DetailRow label="分类">{categoryLabel(dep.category)}</DetailRow>
      <DetailRow label="依赖类型">{dependencyTypeLabel(dep.type)}</DetailRow>
      <DetailRow label="状态">
        <MpdStatusBadge value={dep.status} />
      </DetailRow>
      <DetailRow label="风险等级">
        <MpdRiskBadge value={dep.risk} />
      </DetailRow>
      <DetailRow label="延迟天数">{dep.lagDays ?? '—'}</DetailRow>
      <DetailRow label="缓冲天数">{dep.bufferDays ?? '—'}</DetailRow>
      <DetailRow label="强度">{dep.strength || '—'}</DetailRow>
      <DetailRow label="来源模式">
        {dep.sourceMode ? sourceModeLabel(dep.sourceMode) : '—'}
      </DetailRow>
      <DetailRow label="新鲜度">
        <MpdFreshnessChip value={dep.freshness} checkedAt={dep.freshnessCheckedAt} />
      </DetailRow>
      <DetailRow label="创建时间">{formatMpdDateTime(dep.createdAt)}</DetailRow>
      <DetailRow label="更新时间">{formatMpdDateTime(dep.updatedAt)}</DetailRow>
      {dep.evidenceSummary ? (
        <div className="col-span-2">
          <DetailRow label="证据摘要">
            <span className="block whitespace-pre-wrap text-[11px] leading-relaxed">
              {dep.evidenceSummary}
            </span>
          </DetailRow>
        </div>
      ) : null}
      {dep.warningCodes.length > 0 ? (
        <div className="col-span-2">
          <dt className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--nx-text-muted)]">
            警告码
          </dt>
          <dd>
            <MpdWarningChips codes={dep.warningCodes} />
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

export function PmoDependencyDetailDrawer({
  organizationId,
  depId,
  onClose,
}: PmoDependencyDetailDrawerProps) {
  const { data, isLoading, isError, refetch } = useMpdDetail(organizationId, depId)

  // depId 变化时重置查询结果由 react-query 自动处理（queryKey 含 depId）。
  const open = depId !== null

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  const dep = normalizeMpdDetailPayload(data)

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      {/* 背板 */}
      <button
        type="button"
        aria-label="关闭详情"
        data-mpd-detail-backdrop
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <aside
        data-mpd-detail-drawer
        data-open={open || undefined}
        className="relative flex h-full w-full max-w-[420px] flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">依赖详情</h3>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
              {depId}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isError ? (
              <button
                type="button"
                data-mpd-detail-retry
                aria-label="重新加载详情"
                onClick={() => void refetch()}
                className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                重试
              </button>
            ) : null}
            <button
              type="button"
              data-mpd-detail-close
              aria-label="关闭"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <div role="status" aria-busy="true" aria-label="依赖详情加载中" className="space-y-3">
              {[1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className={cn(
                    'h-10 animate-pulse rounded-md',
                    item % 2 === 0 ? 'w-2/3' : 'w-full',
                  )}
                  style={{ backgroundColor: 'var(--nx-bg-1)' }}
                />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertTriangle className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-xs text-[var(--nx-text-secondary)]">数据不存在或无权访问</p>
              <button
                type="button"
                data-mpd-detail-retry-message
                onClick={() => void refetch()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重新加载
              </button>
            </div>
          ) : dep ? (
            <DetailContent dep={dep} />
          ) : (
            <div className="px-4 py-12 text-center text-xs text-[var(--nx-text-secondary)]">
              数据不存在或无权访问
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

export default PmoDependencyDetailDrawer
