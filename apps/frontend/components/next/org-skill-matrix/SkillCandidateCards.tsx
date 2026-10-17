'use client'

import type { ResourceCandidateSummary } from '@aiproj/types'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCapacityHours } from '@/lib/next/org-skill-matrix/skill-matrix-adapter'

/**
 * 候选资源卡（v3-ui-next-org-portfolio-domains W8 · tasks 8.2/8.3）。
 *
 * 消费 `/resource-skill-matrix/candidates?skillKey=` 响应（父组件在选中技能后加载）：
 * - 每张卡 = 资源名 + 角色 + 可用/已分配/剩余容量 + 技能标签 + 冲突摘要（警戒文案）
 *   + 匹配分；
 * - 「下钻明细」按钮触达父组件的下钻（drill-down 只读二次授权端点），零写请求；
 * - 加载中渲染与卡片几何匹配的骨架行（aria-busy），防布局抖动。
 */
export interface SkillCandidateCardsProps {
  skillKey: string
  candidates: ResourceCandidateSummary[]
  isLoading: boolean
  onDrillDown: (candidate: ResourceCandidateSummary) => void
}

function skeletonCard(key: number) {
  return (
    <div
      key={key}
      className="h-28 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)]"
    />
  )
}

export function SkillCandidateCards({
  skillKey,
  candidates,
  isLoading,
  onDrillDown,
}: SkillCandidateCardsProps) {
  if (isLoading) {
    return (
      <div
        data-skill-candidates-loading
        aria-busy="true"
        className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
      >
        {[0, 1, 2].map((index) => skeletonCard(index))}
      </div>
    )
  }

  if (candidates.length === 0) {
    return (
      <div
        data-skill-candidates-empty
        className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-6 text-center"
      >
        <Users className="mx-auto h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="mt-2 text-xs text-[var(--nx-text-secondary)]">暂无该技能的可选候选资源</p>
        <p className="mt-1 text-[10px] text-[var(--nx-text-muted)]">
          技能 {skillKey} 无剩余容量匹配的可见资源
        </p>
      </div>
    )
  }

  return (
    <ul data-skill-candidates-list className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {candidates.map((candidate) => {
        const remaining = candidate.remainingCapacityHours
        return (
          <li
            key={candidate.resourceId}
            data-skill-candidate-card={candidate.resourceId}
            className="flex flex-col rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                  {candidate.resourceName}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-[var(--nx-text-muted)]">
                  {candidate.role || '未分配角色'}
                </p>
              </div>
              {typeof candidate.matchScore === 'number' ? (
                <span
                  data-skill-candidate-match={candidate.resourceId}
                  className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-accent)]"
                >
                  匹配 {Math.round(candidate.matchScore * 100)}%
                </span>
              ) : null}
            </div>

            <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-sm bg-[var(--nx-bg-0)] px-1 py-1">
                <dt className="text-[9px] text-[var(--nx-text-muted)]">可用</dt>
                <dd
                  data-skill-candidate-available={candidate.resourceId}
                  className="font-mono text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {formatCapacityHours(candidate.availableCapacityHours)}
                </dd>
              </div>
              <div className="rounded-sm bg-[var(--nx-bg-0)] px-1 py-1">
                <dt className="text-[9px] text-[var(--nx-text-muted)]">已分配</dt>
                <dd
                  data-skill-candidate-allocated={candidate.resourceId}
                  className="font-mono text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {formatCapacityHours(candidate.allocatedCapacityHours)}
                </dd>
              </div>
              <div className="rounded-sm bg-[var(--nx-bg-0)] px-1 py-1">
                <dt className="text-[9px] text-[var(--nx-text-muted)]">剩余</dt>
                <dd
                  data-skill-candidate-remaining={candidate.resourceId}
                  className={cn(
                    'font-mono text-[11px]',
                    remaining < 0
                      ? 'text-[var(--nx-status-danger)]'
                      : 'text-[var(--nx-text-secondary)]',
                  )}
                >
                  {formatCapacityHours(remaining)}
                </dd>
              </div>
            </dl>

            {candidate.skillTags.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1">
                {candidate.skillTags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}

            {candidate.conflictSummary.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {candidate.conflictSummary.map((conflict) => (
                  <li
                    key={conflict}
                    data-skill-candidate-conflict={candidate.resourceId}
                    className="rounded-sm border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
                  >
                    {conflict}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-auto pt-2">
              <button
                type="button"
                data-skill-candidate-drilldown={candidate.resourceId}
                onClick={() => onDrillDown(candidate)}
                className="h-7 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                下钻明细
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default SkillCandidateCards
