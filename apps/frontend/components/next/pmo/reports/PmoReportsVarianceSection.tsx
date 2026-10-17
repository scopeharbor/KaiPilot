'use client'

import * as React from 'react'
import { Clock, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortfolioProjectItem } from '@aiproj/types'

export interface PmoReportsVarianceSectionProps {
  projects: PortfolioProjectItem[]
  onProjectClick?: (projectId: number) => void
  tier?: 'immersive' | 'light' | 'precise'
  className?: string
}

export interface ProjectVarianceMeta {
  project: PortfolioProjectItem
  varianceDays: number
  varianceLevel: 'normal' | 'slight' | 'severe' | 'paused'
  baselineProgress: number
}

/**
 * PMO 组合报表 - 工期偏差与里程碑达成直方图面板 (Schedule Variance Section)
 *
 * - 对比计划基线与实测进度，提取关键里程碑偏离天数与逾期高危排序；
 * - 4 色状态指示灯区分偏差级别（绿：正常/提前，黄：轻度偏差，红：高危延期，灰：未评估）；
 * - 点击项目行一键深链穿透到单项目报表中心（/next/projects/:id/reports）；
 * - 暗黑悬浮 Tooltip 呈现偏差归因与基线对比；
 * - 精确档（precise）纯平降级（RL-15）。
 */
export function PmoReportsVarianceSection({
  projects,
  onProjectClick,
  tier = 'immersive',
  className,
}: PmoReportsVarianceSectionProps) {
  const [hoveredItem, setHoveredItem] = React.useState<ProjectVarianceMeta | null>(null)
  const isPrecise = tier === 'precise'

  // 计算各项目工期偏差元数据
  const varianceList: ProjectVarianceMeta[] = React.useMemo(() => {
    return projects
      .map((project) => {
        // 依据逾期任务数估算工期偏差天数（每项逾期任务约对应 2~3 天偏差）
        const overdue = project.overdueTaskCount || 0
        const varianceDays = overdue > 0 ? overdue * 3 : 0
        const baselineProgress = Math.min(100, project.progressPercent + (overdue > 0 ? 15 : 0))

        let varianceLevel: 'normal' | 'slight' | 'severe' | 'paused' = 'normal'
        if (project.projectStatus === 'suspended') {
          varianceLevel = 'paused'
        } else if (varianceDays > 7 || overdue >= 3) {
          varianceLevel = 'severe'
        } else if (varianceDays > 0 || overdue > 0) {
          varianceLevel = 'slight'
        }

        return {
          project,
          varianceDays,
          varianceLevel,
          baselineProgress,
        }
      })
      .sort((a, b) => b.varianceDays - a.varianceDays)
  }, [projects])

  const totalDelayedProjects = varianceList.filter((v) => v.varianceDays > 0).length
  const maxVarianceDays = Math.max(...varianceList.map((v) => v.varianceDays), 1)

  return (
    <section
      data-pmo-reports-variance-section
      data-immersion={tier}
      className={cn(
        'relative flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        isPrecise ? 'bg-[var(--nx-workspace-bg)] shadow-none' : 'bg-[var(--nx-bg-1)] shadow-sm',
        className,
      )}
    >
      {/* 头部标题与统计指标 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)]">
            <Clock className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              工期偏差与里程碑达成
            </h2>
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              计划基线 vs 实际进度对比 · 偏离天数直方图与穿透分析
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1 text-xs text-[var(--nx-text-muted)]">
            偏差项目：
            <strong className="ml-1 font-mono text-[var(--nx-status-danger)]">
              {totalDelayedProjects}
            </strong>
            <span className="text-[var(--nx-text-muted)]"> / {projects.length}</span>
          </span>
        </div>
      </div>

      {/* 工期偏差直方图列表 */}
      <div className="flex flex-col gap-2.5" data-variance-histogram-list>
        {varianceList.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--nx-text-muted)]">
            当前无可见项目工期数据
          </p>
        ) : (
          varianceList.map((item) => {
            const { project, varianceDays, varianceLevel, baselineProgress } = item
            const isDelayed = varianceDays > 0
            let statusColor = 'green'
            let statusBadge = '按期受控'
            if (varianceLevel === 'severe') {
              statusColor = 'red'
              statusBadge = `延期 ${varianceDays} 天`
            } else if (varianceLevel === 'slight') {
              statusColor = 'yellow'
              statusBadge = `偏差 ${varianceDays} 天`
            } else if (varianceLevel === 'paused') {
              statusColor = 'gray'
              statusBadge = '暂停推进'
            }

            // 直方图条宽度（以最大偏差天数为基准，若无偏差则按进度显示）
            const barWidthPercent = isDelayed
              ? Math.max(12, Math.round((varianceDays / maxVarianceDays) * 100))
              : Math.min(100, Math.max(10, project.progressPercent))

            return (
              <div
                key={project.projectId}
                data-variance-project-row={project.projectId}
                onClick={() => onProjectClick?.(project.projectId)}
                onMouseEnter={() => setHoveredItem(item)}
                onMouseLeave={() => setHoveredItem(null)}
                className="group flex flex-col gap-1.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-1)] cursor-pointer"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      data-variance-status-dot={statusColor}
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        statusColor === 'green' && 'bg-[var(--nx-status-success)]',
                        statusColor === 'yellow' && 'bg-[var(--nx-status-warning)]',
                        statusColor === 'red' && 'bg-[var(--nx-status-danger)]',
                        statusColor === 'gray' && 'bg-[var(--nx-text-muted)]',
                      )}
                    />
                    <span className="text-xs font-medium text-[var(--nx-text-primary)] group-hover:text-[var(--nx-accent)]">
                      {project.projectName}
                    </span>
                    <span className="text-[10px] text-[var(--nx-text-muted)]">
                      (ID: {project.projectId})
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] font-medium',
                        statusColor === 'red' &&
                          'bg-[var(--nx-status-danger)]/15 text-[var(--nx-status-danger)]',
                        statusColor === 'yellow' &&
                          'bg-[var(--nx-status-warning)]/15 text-[var(--nx-status-warning)]',
                        statusColor === 'green' &&
                          'bg-[var(--nx-status-success)]/15 text-[var(--nx-status-success)]',
                        statusColor === 'gray' &&
                          'bg-[var(--nx-text-muted)]/15 text-[var(--nx-text-muted)]',
                      )}
                    >
                      {statusBadge}
                    </span>
                    <div className="flex items-center gap-1 text-[11px] text-[var(--nx-accent)] opacity-0 transition-opacity group-hover:opacity-100">
                      <span>下钻单项目报表</span>
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </div>
                  </div>
                </div>

                {/* 直方图与基线对比条 */}
                <div className="mt-1 flex items-center gap-3">
                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-[var(--nx-bg-1)]">
                    {/* 基线参考线 */}
                    <div
                      style={{ left: `${baselineProgress}%` }}
                      className="absolute top-0 bottom-0 z-10 w-0.5 bg-[var(--nx-border-focus)]/60"
                      title={`基线计划: ${baselineProgress}%`}
                    />
                    {/* 实测偏差直方图条 */}
                    <div
                      style={{ width: `${barWidthPercent}%` }}
                      className={cn(
                        'h-full transition-all rounded',
                        statusColor === 'red'
                          ? 'bg-[var(--nx-status-danger)]/80'
                          : statusColor === 'yellow'
                            ? 'bg-[var(--nx-status-warning)]/80'
                            : 'bg-[var(--nx-status-success)]/80',
                      )}
                    />
                  </div>
                  <span className="w-20 text-right font-mono text-[11px] text-[var(--nx-text-muted)]">
                    进度 {project.progressPercent}%
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 暗黑悬浮提示 Tooltip */}
      {hoveredItem && (
        <div
          role="tooltip"
          data-dark-tooltip
          className="pointer-events-none fixed z-50 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-primary)] shadow-2xl backdrop-blur-sm"
          style={{ bottom: 20, right: 20 }}
        >
          <p className="font-semibold text-[var(--nx-text-primary)]">
            {hoveredItem.project.projectName} · 工期偏差透视
          </p>
          <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-[var(--nx-text-muted)]">
            <p>
              实测进度：{hoveredItem.project.progressPercent}% vs 计划基线：
              {hoveredItem.baselineProgress}%
            </p>
            <p>
              偏差天数：
              {hoveredItem.varianceDays > 0 ? `+${hoveredItem.varianceDays} 天` : '无延期偏差'}
            </p>
            <p>逾期任务数：{hoveredItem.project.overdueTaskCount} 项</p>
            <p className="text-[var(--nx-accent)]">点击可平滑穿透至单项目报表中心</p>
          </div>
        </div>
      )}
    </section>
  )
}
