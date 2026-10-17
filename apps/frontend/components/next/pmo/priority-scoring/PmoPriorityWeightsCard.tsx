'use client'

import { RefreshCw, Scale } from 'lucide-react'
import { PRIORITY_LEVELS, PRIORITY_LEVEL_LABELS, SCORE_DIMENSION_LABELS } from '@aiproj/types'
import type { PriorityLevel, PriorityWeightVersion } from '@aiproj/types'

/**
 * PMO 优先级评分权重版本卡（v3-ui-next-pmo-domain W4 · tasks 4.2）。
 *
 * 纯展示（数据由工作台容器装配）：当前权重版本只读信息——版本号、说明、
 * 维度权重表（中文标签 + 权重百分比 + 过期惩罚系数）与等级阈值 chips；
 * 零写操作。加载/错误（重试）局部闭环，不阻塞主工作区。
 */
export interface PmoPriorityWeightsCardProps {
  data?: PriorityWeightVersion
  loading: boolean
  error: boolean
  onRetry: () => void
}

/** 阈值范围展示：[-1,-1] 表示 unranked「无法评分」。 */
function formatThreshold(level: PriorityLevel, range: [number, number]): string {
  if (range[0] < 0) return '无法评分'
  if (level === 'critical') return `≥ ${range[0]}`
  if (level === 'low') return `< ${range[1]}`
  return `${range[0]}–${range[1]}`
}

export function PmoPriorityWeightsCard({
  data,
  loading,
  error,
  onRetry,
}: PmoPriorityWeightsCardProps) {
  return (
    <aside
      data-pps-weights
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
      aria-label="权重版本信息"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
          <Scale className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          权重版本
        </h3>
        {data ? (
          <span
            data-pps-weights-version
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
          >
            {data.version}
          </span>
        ) : null}
      </header>

      {loading ? (
        <div data-pps-weights-skeleton role="status" aria-busy="true" className="space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--nx-bg-1)]" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          ))}
        </div>
      ) : error || !data ? (
        <div data-pps-weights-error role="alert" className="flex flex-col items-start gap-2 py-1">
          <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            权重版本信息加载失败。
          </p>
          <button
            type="button"
            data-pps-weights-retry
            onClick={onRetry}
            className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重新加载
          </button>
        </div>
      ) : (
        <>
          <p
            data-pps-weights-desc
            className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
          >
            {data.description}
          </p>

          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-left text-[10px] text-[var(--nx-text-muted)]">
                <th className="py-1.5 font-normal">维度</th>
                <th className="py-1.5 text-right font-normal">权重</th>
                <th className="py-1.5 text-right font-normal">过期惩罚</th>
              </tr>
            </thead>
            <tbody>
              {data.dimensions.map((dimension) => (
                <tr
                  key={dimension.key}
                  data-pps-weight-dim={dimension.key}
                  className="border-b border-[var(--nx-border-hairline)] last:border-0"
                >
                  <td className="py-1.5 text-[var(--nx-text-primary)]">
                    {SCORE_DIMENSION_LABELS[dimension.key] ?? dimension.key}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[var(--nx-text-secondary)]">
                    {Math.round(dimension.weight * 100)}%
                  </td>
                  <td className="py-1.5 text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
                    ×{dimension.stalePenaltyFactor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_LEVELS.map((level) => {
              const range = data.thresholds[level]
              if (!range) return null
              return (
                <span
                  key={level}
                  data-pps-threshold={level}
                  className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                >
                  {PRIORITY_LEVEL_LABELS[level]} {formatThreshold(level, range)}
                </span>
              )
            })}
          </div>
        </>
      )}
    </aside>
  )
}

export default PmoPriorityWeightsCard
