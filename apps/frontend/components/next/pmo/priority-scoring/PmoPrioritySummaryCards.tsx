'use client'

import { AlertTriangle, Layers } from 'lucide-react'
import { PRIORITY_LEVELS, PRIORITY_LEVEL_LABELS } from '@aiproj/types'
import type { PriorityLevel, PriorityScoringSummary } from '@aiproj/types'
import { priorityLevelVisual } from './pmo-priority-level-meta'

/**
 * PMO 优先级评分摘要卡（v3-ui-next-pmo-domain W4 · tasks 4.2）。
 *
 * 纯展示组件（数据由工作台容器装配）：
 * - 三张组合 KPI 卡（项目总数/已评分/未评分）——数值口径与既有 summary 端点一致；
 * - 五个 PRIORITY_LEVELS 等级分布 chips（双通道：色点 + 中文标签 + 计数），点击
 *   切换过滤（aria-pressed 反馈，状态由容器持有）；
 * - 摘要 warnings 提示 rail（SOURCE_STALE 等）。
 */
export interface PmoPrioritySummaryCardsProps {
  summary: PriorityScoringSummary
  /** 当前生效的等级过滤（空数组 = 全部）。 */
  activeLevels: readonly PriorityLevel[]
  onToggleLevel: (level: PriorityLevel) => void
}

const KPI_TILES: Array<{ key: 'total' | 'scored' | 'unscored'; label: string }> = [
  { key: 'total', label: '项目总数' },
  { key: 'scored', label: '已评分' },
  { key: 'unscored', label: '未评分' },
]

export function PmoPrioritySummaryCards({
  summary,
  activeLevels,
  onToggleLevel,
}: PmoPrioritySummaryCardsProps) {
  const tiles: Record<(typeof KPI_TILES)[number]['key'], number> = {
    total: summary.totalProjects,
    scored: summary.scoredProjects,
    unscored: summary.unscoredProjects,
  }

  return (
    <section data-pps-summary className="space-y-3">
      {/* KPI 统计卡 */}
      <div className="grid grid-cols-3 gap-2.5" role="region" aria-label="评分摘要">
        {KPI_TILES.map((tile) => (
          <div
            key={tile.key}
            data-pps-kpi={tile.key}
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
          >
            <p className="text-[10px] text-[var(--nx-text-muted)]">{tile.label}</p>
            <p className="mt-1 font-mono text-xl font-semibold leading-none text-[var(--nx-text-primary)]">
              {tiles[tile.key]}
            </p>
          </div>
        ))}
      </div>

      {/* 等级分布 chips（双通道过滤开关） */}
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-5"
        role="group"
        aria-label="按优先级等级过滤"
      >
        {PRIORITY_LEVELS.map((level) => {
          const visual = priorityLevelVisual(level)
          const active = activeLevels.includes(level)
          const count = summary.levelCounts[level]
          return (
            <button
              key={level}
              type="button"
              data-pps-level-filter={level}
              aria-pressed={active}
              aria-label={`${PRIORITY_LEVEL_LABELS[level]}：${count} 个项目`}
              onClick={() => onToggleLevel(level)}
              className="flex items-center justify-between gap-1.5 rounded-md border bg-[var(--nx-bg-0)] px-2.5 py-2 text-left transition-colors hover:border-[var(--nx-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              style={{
                borderColor: active ? visual.token : undefined,
                boxShadow: active ? `inset 0 0 0 1px ${visual.token}` : undefined,
              }}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: visual.dot }}
                />
                <span className="truncate text-xs text-[var(--nx-text-secondary)]">
                  {PRIORITY_LEVEL_LABELS[level]}
                </span>
              </span>
              <span className="font-mono text-sm font-semibold text-[var(--nx-text-primary)]">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* warnings rail */}
      {summary.warnings.length > 0 ? (
        <div
          data-pps-warnings
          role="note"
          className="flex flex-wrap gap-1.5 rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2"
        >
          {summary.warnings.map((warning, index) => (
            <span
              key={`${warning.code}-${index}`}
              data-pps-warning={warning.code}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
            >
              <AlertTriangle
                className="h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
                aria-hidden
              />
              {warning.message}
            </span>
          ))}
        </div>
      ) : null}

      {/* 权重版本微标（语义地标，供测试收敛） */}
      <p className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
        <Layers className="h-3 w-3" aria-hidden />
        评分模型 {summary.scoreVersion} · 权重版本 {summary.weightVersion}
        {summary.calculatedAt ? ` · 计算于 ${new Date(summary.calculatedAt).toLocaleString()}` : ''}
      </p>
    </section>
  )
}

export default PmoPrioritySummaryCards
