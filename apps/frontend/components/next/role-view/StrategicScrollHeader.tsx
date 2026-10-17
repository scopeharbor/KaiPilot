'use client'

import * as React from 'react'
import { RotateCcw, ShieldCheck, AlertTriangle, XCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StrategicScrollHeaderProps {
  /** 战略周期名称（如「2026 Q3 全局战略对齐」） */
  cycleTitle?: string | null
  /** 最后汇编时间（ISO 字符串或格式化串） */
  calculatedAt?: string | null
  /** 总体健康状态（ready / healthy / degraded / unavailable / empty 等） */
  overallStatus?: string
  /** 点击重置筛选按钮回调 */
  onResetFilters?: () => void
  /** 组织名称（可选） */
  organizationName?: string | null
  /** 自定义类名 */
  className?: string
}

/** 状态徽标文案与纸光配色映射。 */
function getStatusBadge(status?: string): {
  label: string
  className: string
  icon: React.ComponentType<{ className?: string }>
} {
  switch (status?.toLowerCase()) {
    case 'ready':
    case 'healthy':
    case 'on_track':
      return {
        label: '战略健康',
        className: 'bg-emerald-50 text-emerald-800 border-emerald-300',
        icon: ShieldCheck,
      }
    case 'degraded':
      return {
        label: '部分降级',
        className: 'bg-amber-50 text-amber-800 border-amber-300',
        icon: AlertTriangle,
      }
    case 'at_risk':
      return {
        label: '受控警示',
        className: 'bg-orange-50 text-orange-800 border-orange-300',
        icon: AlertTriangle,
      }
    case 'unavailable':
      return {
        label: '暂不可用',
        className: 'bg-rose-50 text-rose-800 border-rose-300',
        icon: XCircle,
      }
    case 'empty':
      return {
        label: '空范围',
        className: 'bg-stone-100 text-stone-700 border-stone-300',
        icon: Info,
      }
    default:
      return {
        label: status || '未知状态',
        className: 'bg-stone-100 text-stone-700 border-stone-300',
        icon: Info,
      }
  }
}

/** 格式化日期时间（优雅简短呈现）。 */
function formatCalculatedAt(timeStr?: string | null): string {
  if (!timeStr) return '—'
  try {
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return timeStr
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return timeStr
  }
}

/**
 * 战略周期导言栏（v3-ui-next-batch1-strategy-launch-tasks §1.3）。
 * 呈现战略周期名称、最后汇编时间、总体健康状态徽章与重置筛选按钮。
 */
export function StrategicScrollHeader({
  cycleTitle,
  calculatedAt,
  overallStatus = 'ready',
  onResetFilters,
  organizationName,
  className,
}: StrategicScrollHeaderProps) {
  const badge = getStatusBadge(overallStatus)
  const StatusIcon = badge.icon

  return (
    <header
      data-strategic-scroll-header="true"
      className={cn(
        'w-full border-b pb-6 transition-colors',
        'border-[rgba(56,52,44,0.12)]',
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* 左侧：长卷标题与战略周期 */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-widest uppercase text-[var(--nx-role-accent,#d97706)]">
              Role View 方案 B · 纸光长卷
            </span>
            {organizationName && (
              <span className="text-xs text-[var(--nx-role-text,#38342c)]/60">
                / {organizationName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--nx-role-text,#38342c)] sm:text-3xl">
            战略执行驾驶舱
          </h1>
          <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-[var(--nx-role-text,#38342c)]/80">
            <span className="font-medium" data-testid="cycle-title">
              {cycleTitle || '未选择周期'}
            </span>
            <span className="text-[rgba(56,52,44,0.2)]">|</span>
            <span
              className="text-xs text-[var(--nx-role-text,#38342c)]/60"
              data-testid="calculated-at"
            >
              最后汇编：{formatCalculatedAt(calculatedAt)}
            </span>
          </div>
        </div>

        {/* 右侧：健康状态徽标与重置筛选按钮 */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            data-testid="overall-status-badge"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
              badge.className,
            )}
          >
            <StatusIcon className="h-3.5 w-3.5" />
            <span>{badge.label}</span>
          </div>

          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              data-testid="reset-filters-btn"
              className={cn(
                'inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
                'border-[rgba(56,52,44,0.15)] bg-[var(--nx-role-surface,#ebe9e1)] text-[var(--nx-role-text,#38342c)]',
                'hover:bg-[rgba(56,52,44,0.08)] active:bg-[rgba(56,52,44,0.12)]',
                'focus-visible:outline-2 focus-visible:outline-amber-600 focus-visible:outline-offset-2',
                'transition-colors motion-reduce:transition-none',
              )}
            >
              <RotateCcw className="h-3 w-3" />
              <span>重置筛选</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
