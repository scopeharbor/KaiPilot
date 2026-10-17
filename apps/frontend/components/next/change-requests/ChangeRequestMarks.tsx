'use client'

import { CheckCircle2, Clock3, FileText, RotateCcw, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ChangeRequestPriority, ChangeRequestStatus } from '@/lib/api/change-requests'
import { CR_PRIORITY_LABELS, CR_PRIORITY_TONES, CR_STATUS_LABELS, CR_STATUS_TONES } from './cr-meta'
import { cn } from '@/lib/utils'

/**
 * 变更请求状态/优先级「双通道传达」微标（v3-ui-next-risk-change-domains W2）。
 *
 * - 状态：文本 + 语义图标双通道（草稿=文件图标 / 流转中=时钟 / 已批准·已实施=绿色
 *   对勾 / 已拒绝·已取消=红色叉号 / 退回修改=回转），色标消费 --nx-* Tokens；
 * - 优先级：urgent 红 / high 琥珀 / medium 青 / low 中性 4 档指示徽标；
 * - 纯展示组件（RL-14 确定性渲染），列表/详情/审批台共用。
 */

/** 双通道状态图标表（spec「高密度表格渲染规范」）。 */
export const CR_STATUS_ICONS: Record<ChangeRequestStatus, LucideIcon> = {
  draft: FileText,
  submitted: Clock3,
  under_review: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  returned: RotateCcw,
  implemented: CheckCircle2,
  closed: CheckCircle2,
  cancelled: XCircle,
}

function statusToneClass(tone: 'neutral' | 'active' | 'success' | 'danger' | 'warning'): string {
  switch (tone) {
    case 'success':
      return 'border-[var(--nx-status-success)] text-[var(--nx-status-success)]'
    case 'danger':
      return 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
    case 'warning':
      return 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
    case 'active':
      return 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]'
    default:
      return 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]'
  }
}

export interface ChangeRequestStatusMarkProps {
  status: ChangeRequestStatus
  /** 紧凑模式（表格单元格）；默认含内边距徽标。 */
  compact?: boolean
  className?: string
}

/** 状态徽标：图标 + 文本双通道，携带 data-cr-status 供测试与筛选定位。 */
export function ChangeRequestStatusMark({
  status,
  compact = false,
  className,
}: ChangeRequestStatusMarkProps) {
  const Icon = CR_STATUS_ICONS[status]
  const tone = CR_STATUS_TONES[status]
  return (
    <span
      data-cr-status={status}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border',
        compact ? 'px-1 py-px text-[10px]' : 'px-1.5 py-0.5 text-[11px]',
        statusToneClass(tone),
        className,
      )}
    >
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      {CR_STATUS_LABELS[status]}
    </span>
  )
}

function priorityToneClass(tone: 'danger' | 'warning' | 'accent' | 'neutral'): string {
  switch (tone) {
    case 'danger':
      return 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
    case 'warning':
      return 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
    case 'accent':
      return 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]'
    default:
      return 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]'
  }
}

export interface ChangeRequestPriorityMarkProps {
  priority: ChangeRequestPriority
  className?: string
}

/** 优先级指示徽标（4 档色标 + 文本）。 */
export function ChangeRequestPriorityMark({ priority, className }: ChangeRequestPriorityMarkProps) {
  return (
    <span
      data-cr-priority={priority}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10px]',
        priorityToneClass(CR_PRIORITY_TONES[priority]),
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          priority === 'urgent'
            ? 'bg-[var(--nx-status-danger)]'
            : priority === 'high'
              ? 'bg-[var(--nx-status-warning)]'
              : priority === 'medium'
                ? 'bg-[var(--nx-accent)]'
                : 'bg-[var(--nx-text-muted)]',
        )}
      />
      {CR_PRIORITY_LABELS[priority]}
    </span>
  )
}
