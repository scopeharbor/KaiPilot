'use client'

import type { SkillGapEntry } from '@aiproj/types'
import { cn } from '@/lib/utils'
import {
  formatCapacityHours,
  getGapSeverityChipClass,
  getGapSeverityLabel,
  sortGapsBySeverity,
} from '@/lib/next/org-skill-matrix/skill-matrix-adapter'

/**
 * 关键缺口表（v3-ui-next-org-portfolio-domains W8 · tasks 8.2）。
 *
 * 消费摘要端点 criticalGaps（后端已按 severity 聚合 top 缺口）：
 * - 每行 = 技能 key + 严重度徽标（双通道：色阶 + 中文文字）+ 需求项数 + 缺口容量；
 * - 点击行「查看候选」选中该技能（同覆盖率环共用选中态），进入候选/下钻面板；
 * - 空缺口渲染中性空态；全部只读交互，零写请求。
 */
export interface SkillGapTableProps {
  gaps: SkillGapEntry[]
  selectedSkillKey: string | null
  onSelectSkill: (skillKey: string) => void
}

export function SkillGapTable({ gaps, selectedSkillKey, onSelectSkill }: SkillGapTableProps) {
  const sorted = sortGapsBySeverity(gaps)

  return (
    <div
      data-skill-gap-card
      className="flex flex-col rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">关键技能缺口</h3>
        <span className="text-[10px] text-[var(--nx-text-muted)]">需求容量 - 可用容量</span>
      </div>

      {sorted.length === 0 ? (
        <div
          data-skill-gap-empty
          className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-8 text-center"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">暂无严重技能缺口</p>
          <p className="mt-1 text-[10px] text-[var(--nx-text-muted)]">
            技能覆盖良好，暂无 critical/high 级别缺口
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" data-skill-gap-rows>
          {sorted.map((gap) => {
            const active = gap.skillKey === selectedSkillKey
            return (
              <li key={gap.skillKey}>
                <div
                  data-skill-gap-row={gap.skillKey}
                  className={cn(
                    'rounded-md border px-2.5 py-2 transition-colors',
                    active
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                        {gap.skillKey}
                      </span>
                      <span
                        data-skill-gap-severity={gap.skillKey}
                        className={cn(
                          'shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]',
                          getGapSeverityChipClass(gap.severity),
                        )}
                      >
                        {getGapSeverityLabel(gap.severity)}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-skill-gap-view-candidates={gap.skillKey}
                      onClick={() => onSelectSkill(gap.skillKey)}
                      className="h-7 shrink-0 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                    >
                      查看候选
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--nx-text-muted)]">
                    <span data-skill-gap-requirements={gap.skillKey}>
                      需求 {gap.requirementCount} 项
                    </span>
                    <span>需 {formatCapacityHours(gap.requiredCapacityHours)}</span>
                    <span>可 {formatCapacityHours(gap.availableCapacityHours)}</span>
                    <span
                      data-skill-gap-hours={gap.skillKey}
                      className="font-mono text-[var(--nx-status-danger)]"
                    >
                      缺口 {formatCapacityHours(gap.gapCapacityHours)}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default SkillGapTable
