'use client'

import * as React from 'react'
import { ClipboardList, Eye } from 'lucide-react'
import {
  CR_PRIORITY_LABELS,
  CR_PRIORITY_TONES,
  CR_STATUS_LABELS,
  CR_STATUS_TONES,
  CR_TYPE_LABELS,
  formatCrDate,
} from '@/components/next/change-requests/cr-meta'
import type { CrossProjectChangeRequestItem } from '@/lib/next/pmo-change-queue-composer'
import { cn } from '@/lib/utils'

export interface PmoChangeQueueLensProps {
  items: CrossProjectChangeRequestItem[]
  onRowClick?: (item: CrossProjectChangeRequestItem) => void
  tier?: 'immersive' | 'light' | 'precise'
  className?: string
}

const PRIORITY_DOT_TOKEN: Record<string, string> = {
  danger: 'var(--nx-status-danger)',
  warning: 'var(--nx-status-warning)',
  accent: 'var(--nx-space-cyan)',
  neutral: 'var(--nx-text-muted)',
}

/**
 * PMO 全局变更审批队列高密度表格镜头（W3 · tasks 3.3 / spec「跨项目变更审批队列高密度表格」）。
 *
 * - 36px（精确档 32px）发丝线紧凑仪器表格；
 * - 表头：CR 编码 / 变更标题 / 所属项目徽标 / 类型 / 优先级指示灯 / 状态双通道徽章 /
 *   申请人 / 提交时间 / 操作栏；
 * - 点击行呼出审批抽屉回调（onRowClick）；
 * - 无变更时语义空态；零 3D/Canvas（RL-15）。
 */
export function PmoChangeQueueLens({
  items,
  onRowClick,
  tier = 'immersive',
  className,
}: PmoChangeQueueLensProps) {
  const isPrecise = tier === 'precise'
  const rowHeightClass = isPrecise ? 'h-8' : 'h-9'

  if (items.length === 0) {
    return (
      <div
        data-pmo-change-queue-lens
        data-immersion={isPrecise ? 'precise' : tier}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center',
          className,
        )}
      >
        <ClipboardList className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">当前筛选条件下暂无变更请求</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          调整状态分面、项目或搜索关键词后重试。
        </p>
      </div>
    )
  }

  return (
    <div
      data-pmo-change-queue-lens
      data-immersion={isPrecise ? 'precise' : tier}
      className={cn(
        'overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr
            className={cn(
              'border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[11px] text-[var(--nx-text-muted)]',
              rowHeightClass,
            )}
          >
            <th className="px-3 font-medium">CR 编码</th>
            <th className="px-3 font-medium">变更标题</th>
            <th className="px-3 font-medium">所属项目</th>
            <th className="px-3 font-medium">类型</th>
            <th className="px-3 font-medium">优先级</th>
            <th className="px-3 font-medium">状态</th>
            <th className="px-3 font-medium">申请人</th>
            <th className="px-3 font-medium">提交时间</th>
            <th className="px-3 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--nx-border-hairline)]">
          {items.map((item) => {
            const statusTone = CR_STATUS_TONES[item.status] ?? 'neutral'
            const priorityTone = CR_PRIORITY_TONES[item.priority] ?? 'neutral'
            const dotColor = PRIORITY_DOT_TOKEN[priorityTone] ?? PRIORITY_DOT_TOKEN.neutral

            return (
              <tr
                key={item.id}
                data-change-queue-row={item.id}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-[var(--nx-bg-1)]/50',
                  rowHeightClass,
                )}
              >
                <td className="px-3 font-mono text-[var(--nx-text-primary)]">{item.crCode}</td>
                <td className="max-w-[220px] truncate px-3 font-medium text-[var(--nx-text-primary)]">
                  {item.title}
                </td>
                <td className="px-3">
                  <span
                    data-change-project-badge={item.projectId}
                    className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                  >
                    {item.projectCode ? `[${item.projectCode}] ` : ''}
                    {item.projectName}
                  </span>
                </td>
                <td className="px-3 text-[var(--nx-text-secondary)]">
                  {CR_TYPE_LABELS[item.changeType] ?? item.changeType}
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      data-priority-dot={item.priority}
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                    <span className="text-[var(--nx-text-secondary)]">
                      {CR_PRIORITY_LABELS[item.priority] ?? item.priority}
                    </span>
                  </span>
                </td>
                <td className="px-3">
                  <span
                    data-change-status-badge={item.status}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      statusTone === 'success'
                        ? 'bg-[rgba(34,197,94,0.12)] text-[var(--nx-status-success)]'
                        : statusTone === 'danger'
                          ? 'bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)]'
                          : statusTone === 'warning'
                            ? 'bg-[rgba(245,158,11,0.12)] text-[var(--nx-status-warning)]'
                            : 'bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                    )}
                  >
                    {CR_STATUS_LABELS[item.status] ?? item.status}
                  </span>
                </td>
                <td className="px-3 text-[var(--nx-text-secondary)]">
                  {item.requesterName || (item.requestedBy ? `#${item.requestedBy}` : '系统申请')}
                </td>
                <td className="px-3 font-mono text-[var(--nx-text-muted)]">
                  {formatCrDate(item.submittedAt || item.createdAt)}
                </td>
                <td className="px-3 text-right">
                  <button
                    type="button"
                    data-action="view-change-detail"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRowClick?.(item)
                    }}
                    className="inline-flex h-6.5 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
                  >
                    <Eye className="h-3 w-3" aria-hidden />
                    查看
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PmoChangeQueueLens
