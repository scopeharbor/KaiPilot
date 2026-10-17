'use client'

import type { SkillCoverageSummary } from '@aiproj/types'
import { cn } from '@/lib/utils'
import {
  formatCoveragePercent,
  getCoverageToneChipClass,
  getCoverageToneColor,
  getCoverageToneLabel,
} from '@/lib/next/org-skill-matrix/skill-matrix-adapter'

/**
 * 技能覆盖率环（v3-ui-next-org-portfolio-domains W8 · tasks 8.2）。
 *
 * - 左侧 SVG 覆盖率环：总体覆盖率（0-1）→ 0.8/0.5/0.25 三档色阶（颜色 + 中心文字
 *   双通道），环身为确定性静态几何，零图表库注册（echarts-core 收敛纪律）；
 * - 右侧技能覆盖率行：每行技能 key + 资源覆盖数 + 进度条 + 百分比，点击行即选中
 *   该技能进入候选/下钻面板（纯只读选择，零写请求）。
 */
export interface SkillCoverageRingProps {
  overallRatio: number
  rows: SkillCoverageSummary[]
  selectedSkillKey: string | null
  onSelectSkill: (skillKey: string) => void
}

const RING_SIZE = 168
const RING_RADIUS = 66
const RING_STROKE = 10
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  return Math.min(1, Math.max(0, ratio))
}

export function SkillCoverageRing({
  overallRatio,
  rows,
  selectedSkillKey,
  onSelectSkill,
}: SkillCoverageRingProps) {
  const ratio = clampRatio(overallRatio)
  const center = RING_SIZE / 2
  const dashOffset = RING_CIRCUMFERENCE * (1 - ratio)

  return (
    <div
      data-skill-coverage-card
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <div
          data-skill-coverage-ring
          className="relative shrink-0"
          role="img"
          aria-label={`技能总体覆盖率 ${formatCoveragePercent(ratio)}`}
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            aria-hidden
            className="-rotate-90"
          >
            <circle
              cx={center}
              cy={center}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--nx-border-hairline)"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={center}
              cy={center}
              r={RING_RADIUS}
              fill="none"
              stroke={getCoverageToneColor(ratio)}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              data-skill-coverage-total
              className="text-xl font-semibold text-[var(--nx-text-primary)]"
              style={{ color: getCoverageToneColor(ratio) }}
            >
              {formatCoveragePercent(ratio)}
            </span>
            <span className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">技能覆盖率</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <span
            data-skill-coverage-tone
            className={cn(
              'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px]',
              getCoverageToneChipClass(ratio),
            )}
          >
            {getCoverageToneLabel(ratio)}
          </span>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            点击下方技能行可查看候选资源与 Skill 建议（只读分析）。
          </p>
        </div>
      </div>

      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" data-skill-coverage-rows>
        {rows.length === 0 ? (
          <li className="py-4 text-center text-xs text-[var(--nx-text-muted)]">暂无技能覆盖数据</li>
        ) : (
          rows.map((coverage) => {
            const rowRatio = clampRatio(coverage.coverageRatio)
            const active = coverage.skillKey === selectedSkillKey
            return (
              <li key={coverage.skillKey}>
                <button
                  type="button"
                  data-skill-coverage-row={coverage.skillKey}
                  aria-pressed={active}
                  onClick={() => onSelectSkill(coverage.skillKey)}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors',
                    active
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
                      : 'border-transparent hover:border-[var(--nx-border-hairline)] hover:bg-[var(--nx-space-surface)]',
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={cn(
                        'truncate font-medium',
                        active ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-secondary)]',
                      )}
                    >
                      {coverage.skillKey}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                      {coverage.skilledResources}/{coverage.totalResources} 人 ·{' '}
                      {formatCoveragePercent(coverage.coverageRatio)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--nx-border-hairline)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.round(rowRatio * 100)}%`,
                          backgroundColor: getCoverageToneColor(coverage.coverageRatio),
                        }}
                      />
                    </span>
                    <span className="w-12 text-right text-[10px] text-[var(--nx-text-muted)]">
                      {formatCoveragePercent(coverage.resourceCoverageRatio)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

export default SkillCoverageRing
