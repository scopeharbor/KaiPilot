'use client'

import * as React from 'react'
import { AlertCircle, EyeOff, LayoutGrid, RotateCw } from 'lucide-react'
import type { OrganizationResourcePoolCapacityMatrix } from '@aiproj/types'
import {
  buildPoolCapacityRows,
  collectPoolMatrixDates,
  formatPoolHours,
  getPoolLoadLabel,
} from '@/lib/next/org-pool/org-pool-adapter'

/**
 * 组织资源池容量矩阵（v3-ui-next-org-portfolio-domains W4 · tasks 4.3）。
 *
 * - 人员 × 时段矩阵：行首为资源（受限行 EyeOff + 中性「已脱敏」，零名称泄露
 *   RL-05），其后按日期列呈现逐日负载单元；
 * - 超载单元（利用率 >100% / overloaded / 冲突标记）警戒红描边 + 「过载」文字
 *   徽标（颜色 + 文字双通道，RL-15）；
 * - 全部只读；加载骨架 / 空态 / 错误重试三态闭环。
 */

export interface PoolCapacityMatrixProps {
  data?: OrganizationResourcePoolCapacityMatrix
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function PoolCapacityMatrix({ data, isLoading, isError, onRetry }: PoolCapacityMatrixProps) {
  if (isLoading) {
    return (
      <div
        data-pool-capacity-skeleton
        aria-busy
        className="space-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-9 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div
        data-pool-capacity-error
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-primary)]">容量矩阵加载失败</p>
        <button
          type="button"
          data-pool-capacity-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }

  if (!data || data.rows.length === 0) {
    return (
      <div
        data-pool-capacity-empty
        className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <LayoutGrid className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-primary)]">无容量数据</p>
        <p className="text-xs text-[var(--nx-text-muted)]">在日期窗口内没有可显示的资源容量数据</p>
      </div>
    )
  }

  const dates = collectPoolMatrixDates(data)
  const rows = buildPoolCapacityRows(data)

  return (
    <div
      data-pool-capacity-view
      className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)]"
    >
      <table className="w-full min-w-max text-xs">
        <thead>
          <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
            <th className="sticky left-0 z-10 bg-[var(--nx-bg-1)] px-3 py-2 text-left font-medium text-[var(--nx-text-secondary)]">
              资源
            </th>
            <th className="px-2 py-2 text-left font-medium text-[var(--nx-text-secondary)]">
              角色
            </th>
            <th className="px-2 py-2 text-center font-medium text-[var(--nx-text-secondary)]">
              负载
            </th>
            <th className="px-2 py-2 text-right font-medium text-[var(--nx-text-secondary)]">
              总容量
            </th>
            <th className="px-2 py-2 text-right font-medium text-[var(--nx-text-secondary)]">
              已分配
            </th>
            <th className="px-2 py-2 text-right font-medium text-[var(--nx-text-secondary)]">
              剩余
            </th>
            <th className="px-2 py-2 text-center font-medium text-[var(--nx-text-secondary)]">
              利用率
            </th>
            {dates.map((date) => (
              <th
                key={date}
                className="min-w-[84px] border-l border-[var(--nx-border-hairline)] px-1 py-2 text-center font-mono text-[10px] font-normal text-[var(--nx-text-muted)]"
              >
                {date.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.resourceId}
              data-pool-capacity-row={row.resourceId}
              className="border-b border-[var(--nx-border-hairline)] last:border-b-0 hover:bg-[var(--nx-bg-1)]"
            >
              <td className="sticky left-0 z-10 bg-[var(--nx-bg-0)] px-3 py-2">
                {row.restricted ? (
                  <span
                    data-restricted
                    className="inline-flex items-center gap-1.5 text-[var(--nx-text-muted)]"
                  >
                    <EyeOff className="h-3 w-3" aria-hidden />
                    已脱敏
                  </span>
                ) : (
                  <span className="font-medium text-[var(--nx-text-primary)]">{row.name}</span>
                )}
              </td>
              <td className="px-2 py-2 text-[var(--nx-text-muted)]">{row.role ?? '—'}</td>
              <td className="px-2 py-2 text-center">
                <PoolLoadBadge status={row.loadStatus} label={row.loadLabel} tone={row.loadTone} />
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-[var(--nx-text-secondary)]">
                {formatPoolHours(row.totalCapacityHours)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-[var(--nx-text-secondary)]">
                {formatPoolHours(row.totalAllocatedHours)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-[var(--nx-text-secondary)]">
                {formatPoolHours(row.totalRemainingHours)}
              </td>
              <td className="px-2 py-2">
                <PoolUtilizationBar percent={row.utilizationPercent} tone={row.loadTone} />
              </td>
              {dates.map((date) => {
                const cell = row.cells.find((candidate) => candidate.date === date)
                return (
                  <td
                    key={date}
                    className="border-l border-[var(--nx-border-hairline)] px-1 py-1.5 text-center"
                  >
                    {cell ? (
                      <div
                        data-pool-cell={cell.date}
                        data-cell-load={cell.loadStatus}
                        data-cell-overloaded={cell.overloaded || undefined}
                        className={
                          cell.overloaded
                            ? 'flex items-center justify-center gap-1 rounded border border-[var(--nx-border-hairline)] px-1 py-1'
                            : 'flex items-center justify-center gap-1 rounded border border-transparent px-1 py-1'
                        }
                        style={
                          cell.overloaded ? { borderColor: 'var(--nx-status-danger)' } : undefined
                        }
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(${cell.tone})` }}
                        />
                        <span
                          className="tabular-nums text-[var(--nx-text-secondary)]"
                          style={{ color: `var(${cell.tone})` }}
                        >
                          {cell.text}
                        </span>
                        {cell.overloaded ? (
                          <span
                            data-overload-text
                            className="text-[10px] font-semibold text-[var(--nx-status-danger)]"
                          >
                            过载
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[var(--nx-text-muted)]">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 负载状态徽标（颜色 + 文字双通道）。 */
export function PoolLoadBadge({
  status,
  label,
  tone,
}: {
  status: string
  label: string
  tone: string
}) {
  return (
    <span
      data-pool-load-badge={status}
      className="inline-flex items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color: `var(${tone})` }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `var(${tone})` }}
      />
      {label}
    </span>
  )
}

/** 利用率条带（按负载状态取色，>100% 截断展示但文字保留原始百分比）。 */
export function PoolUtilizationBar({ percent, tone }: { percent: number; tone: string }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const label =
    percent > 100 ? getPoolLoadLabel('overloaded') : percent <= 10 ? getPoolLoadLabel('idle') : ''
  const resolvedTone =
    percent > 100 ? '--nx-status-danger' : percent <= 10 ? '--nx-text-secondary' : tone
  return (
    <div className="flex items-center justify-end gap-1.5" title={label || undefined}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--nx-bg-0)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, backgroundColor: `var(${resolvedTone})` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums text-[var(--nx-text-secondary)]">
        {percent > 100 ? '>100%' : `${Math.round(percent)}%`}
      </span>
    </div>
  )
}

export default PoolCapacityMatrix
