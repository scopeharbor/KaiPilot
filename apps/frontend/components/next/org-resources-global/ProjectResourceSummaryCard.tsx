'use client'

import * as React from 'react'
import { ArrowRight, EyeOff, Gauge, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project } from '@/lib/api/projects'
import type { ResourceLoadItem } from '@/lib/api/resources'
import {
  formatUtilizationPercent,
  globalResourceTypeLabel,
  memberInitials,
  type OverloadedMemberModel,
  type ProjectLoadSummaryModel,
  type ResourceTypeDistributionItem,
} from '@/lib/next/org-resources-global/global-resources-adapter'

/**
 * 项目资源摘要卡（v3-ui-next-org-portfolio-domains W7 · tasks 7.6）。
 *
 * - 非受限态：团队负荷（成员数 / 平均利用率 / 超载数）+ 类型分布 + 超载成员 top 列表；
 * - 受限态（无 resource:view / portfolio:view）：EyeOff + 中性文案，零资源数据外泄
 *   （RL-05/RL-06，数据请求已由 Hub 抑制）；
 * - 右上角「进入项目资源工作台」深链（B6d 已迁 /next/projects/:id/resources，
 *   页面自身守卫 project:view + resource:view）。
 */

export interface ProjectResourceSummaryCardProps {
  project: Project | undefined
  /** 受限态（无资源查看权）：不渲染任何数值。 */
  restricted?: boolean
  loadRows?: ResourceLoadItem[]
  loadSummary?: ProjectLoadSummaryModel
  overloadedMembers?: OverloadedMemberModel[]
  typeDistribution?: ResourceTypeDistributionItem[]
  activeResourceCount?: number
  onEnterWorkbench?: () => void
}

export function ProjectResourceSummaryCard({
  project,
  restricted = false,
  loadRows = [],
  loadSummary,
  overloadedMembers = [],
  typeDistribution = [],
  activeResourceCount,
  onEnterWorkbench,
}: ProjectResourceSummaryCardProps) {
  if (project === undefined) {
    return (
      <div
        data-resource-project-missing
        className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-10 text-center"
      >
        <p className="text-xs text-[var(--nx-text-secondary)]">项目信息暂不可用</p>
      </div>
    )
  }

  if (restricted) {
    return (
      <section
        data-resource-summary-restricted
        className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-6"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
              {project.name}
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
              #{project.id}
              {project.code ? ` · ${project.code}` : ''}
            </p>
          </div>
          {onEnterWorkbench ? (
            <button
              type="button"
              data-resource-summary-open
              onClick={onEnterWorkbench}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
            >
              项目资源工作台
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] px-3 py-3">
          <EyeOff className="h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            你没有查看该项目资源明细的权限——摘要数值不可见，进入项目资源工作台需 project:view 与
            resource:view。
          </p>
        </div>
      </section>
    )
  }

  const summary = loadSummary ?? {
    memberCount: 0,
    overloadedCount: 0,
    averageUtilizationPercent: null,
  }

  return (
    <section
      data-resource-summary-card
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
            {project.name}
          </h2>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
            #{project.id}
            {project.code ? ` · ${project.code}` : ''} · 30 天滑动窗口 · 只读
          </p>
        </div>
        {onEnterWorkbench ? (
          <button
            type="button"
            data-resource-summary-open
            onClick={onEnterWorkbench}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            项目资源工作台
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* 负荷 KPI 条 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div
          data-summary-kpi="members"
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-3 py-2.5"
        >
          <p className="text-[10px] text-[var(--nx-text-muted)]">负荷成员</p>
          <p className="mt-1 font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
            {loadRows.length}
          </p>
        </div>
        <div
          data-summary-kpi="active"
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-3 py-2.5"
        >
          <p className="text-[10px] text-[var(--nx-text-muted)]">活跃资源</p>
          <p className="mt-1 font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
            {activeResourceCount ?? typeDistribution.reduce((acc, item) => acc + item.count, 0)}
          </p>
        </div>
        <div
          data-summary-kpi="utilization"
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-3 py-2.5"
        >
          <p className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
            <Gauge className="h-3 w-3" aria-hidden />
            平均利用率
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
            {formatUtilizationPercent(summary.averageUtilizationPercent)}
          </p>
        </div>
        <div
          data-summary-kpi="overloaded"
          className={cn(
            'rounded-sm border px-3 py-2.5',
            summary.overloadedCount > 0
              ? 'border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.08)]'
              : 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
          )}
        >
          <p
            className={cn(
              'flex items-center gap-1 text-[10px]',
              summary.overloadedCount > 0
                ? 'text-[var(--nx-status-danger)]'
                : 'text-[var(--nx-text-muted)]',
            )}
          >
            <TriangleAlert className="h-3 w-3" aria-hidden />
            超载成员
          </p>
          <p
            className={cn(
              'mt-1 font-mono text-lg font-semibold',
              summary.overloadedCount > 0
                ? 'text-[var(--nx-status-danger)]'
                : 'text-[var(--nx-text-primary)]',
            )}
          >
            {summary.overloadedCount}
          </p>
        </div>
      </div>

      {/* 超载成员 top 列表 */}
      {overloadedMembers.length > 0 ? (
        <div data-resource-summary-overloaded className="flex flex-col gap-1">
          <p className="text-[10px] font-medium text-[var(--nx-text-muted)]">
            超载成员（利用率 &gt; 100%，按超载程度降序）
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {overloadedMembers.map((member) => (
              <li
                key={member.resourceId}
                data-resource-overloaded-member={member.resourceId}
                className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-2 py-1"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] text-[9px] font-semibold text-[var(--nx-text-secondary)]">
                  {memberInitials(member.resourceName)}
                </span>
                <span className="text-[11px] text-[var(--nx-text-primary)]">
                  {member.resourceName}
                </span>
                <span className="font-mono text-[10px] text-[var(--nx-status-danger)]">
                  {formatUtilizationPercent(member.utilizationPercent)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 类型分布 */}
      {typeDistribution.length > 0 ? (
        <div data-resource-summary-types className="flex flex-col gap-1.5">
          <p className="text-[10px] font-medium text-[var(--nx-text-muted)]">资源类型分布</p>
          <div className="flex flex-wrap gap-1.5">
            {typeDistribution.map((item) => (
              <span
                key={item.type}
                data-resource-type-chip={item.type}
                className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)]"
              >
                {globalResourceTypeLabel(item.type)}
                <span className="font-mono text-[10px] text-[var(--nx-text-primary)]">
                  {item.count}
                </span>
                {item.percentOfTotal !== null ? (
                  <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {item.percentOfTotal}%
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loadRows.length === 0 &&
      typeDistribution.length === 0 &&
      activeResourceCount === undefined ? (
        <p data-resource-summary-empty className="text-[11px] text-[var(--nx-text-muted)]">
          该项目暂无资源负荷数据——登记资源并分配任务工时后此处将呈现摘要。
        </p>
      ) : null}
    </section>
  )
}

export default ProjectResourceSummaryCard
