'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useTrafficLightCounts } from '@/hooks/use-pmo-traffic-light'
import type { TrafficLightStatus } from '@aiproj/types'
import { TRAFFIC_LIGHT_STATUSES, TRAFFIC_LIGHT_STATUS_LABELS } from '@aiproj/types'

/**
 * PMO 红绿灯四色计数卡（v3-ui-next-pmo-domain W2 · tasks 2.2）。
 *
 * - 消费 `useTrafficLightCounts()`（GET /pmo/traffic-light/counts）；
 * - 红/黄/绿/灰四色计数，点击即作为状态筛选开关（再次点击取消），
 *   与表格状态筛选同一 `filterStatus` 状态源（镜像旧页交互语义）；
 * - 状态双通道：色块 + 文字（RL-15），色值全部取 --nx-* 令牌；
 * - 计数查询失败（如接口 5xx）降级为占位「—」+ 提示，不影响列表主流程。
 */

/** 灯色 → --nx-* 令牌色（仪表面板实色，非渐变）。 */
const STATUS_COLOR: Record<TrafficLightStatus, string> = {
  red: 'var(--nx-status-danger)',
  yellow: 'var(--nx-status-warning)',
  green: 'var(--nx-status-success)',
  gray: 'var(--nx-text-muted)',
}

function formatCalculatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface PmoTrafficLightCountsCardProps {
  /** 当前生效的状态筛选（null = 全部）。 */
  active: TrafficLightStatus | null
  /** 点击计数卡切换状态筛选（点同一色取消，回「全部」）。 */
  onSelect: (status: TrafficLightStatus | null) => void
}

export function PmoTrafficLightCountsCard({ active, onSelect }: PmoTrafficLightCountsCardProps) {
  const { data, isLoading, isError } = useTrafficLightCounts()

  const counts = data ?? { red: 0, yellow: 0, green: 0, gray: 0, total: 0, calculatedAt: '' }

  return (
    <section
      data-traffic-counts
      aria-label="红绿灯计数总览"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {TRAFFIC_LIGHT_STATUSES.map((status) => {
          const selected = active === status
          return (
            <button
              key={status}
              type="button"
              data-traffic-count={status}
              aria-pressed={selected}
              aria-label={`${TRAFFIC_LIGHT_STATUS_LABELS[status]}项目 ${isLoading ? '加载中' : String(counts[status])}`}
              onClick={() => onSelect(selected ? null : status)}
              className={cn(
                'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
                selected
                  ? 'border-[var(--nx-border-focus)] bg-[rgba(56,189,248,0.08)]'
                  : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] hover:border-[var(--nx-border-focus)]',
              )}
            >
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLOR[status] }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-[var(--nx-text-muted)]">
                  {TRAFFIC_LIGHT_STATUS_LABELS[status]}
                </span>
                <span
                  data-traffic-count-value={status}
                  className={cn(
                    'block font-mono text-lg font-semibold leading-tight text-[var(--nx-text-primary)]',
                    isLoading && 'opacity-40',
                  )}
                >
                  {isLoading ? '…' : String(counts[status])}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] pt-2 text-[11px] text-[var(--nx-text-muted)]">
        {active ? (
          <button
            type="button"
            data-traffic-count-clear
            onClick={() => onSelect(null)}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-2 py-0.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            取消筛选：{TRAFFIC_LIGHT_STATUS_LABELS[active]}
          </button>
        ) : (
          <span>状态筛选：全部</span>
        )}
        {isError ? (
          <span role="note" data-traffic-counts-unavailable>
            计数暂不可用
          </span>
        ) : (
          <span data-traffic-counts-meta>
            共 {counts.total} 个项目
            {formatCalculatedAt(counts.calculatedAt)
              ? ` · 更新于 ${formatCalculatedAt(counts.calculatedAt)}`
              : ''}
          </span>
        )}
      </div>
    </section>
  )
}

export default PmoTrafficLightCountsCard
