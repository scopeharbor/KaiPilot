'use client'

import * as React from 'react'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortfolioProjectItem } from '@aiproj/types'

export interface PmoReportsWorkloadSectionProps {
  projects: PortfolioProjectItem[]
  tier?: 'immersive' | 'light' | 'precise'
  className?: string
}

interface ProjectWorkloadMeta {
  project: PortfolioProjectItem
  memberCount: number
  workloadRate: number
  loadStatus: 'overload' | 'heavy' | 'balanced' | 'idle'
}

/**
 * PMO 组合报表 - 跨项目工时负荷对比矩阵面板 (Resource Workload Section)
 *
 * - 跨项目与职能团队容量占用直方图与负载对比矩阵；
 * - 4 色状态指示灯（红：超负荷 >85%，黄：负荷偏高 70~85%，绿：均衡健康 40~70%，灰：空闲 <40%）；
 * - 暗黑悬浮 Tooltip 呈现成员分配率与容量负荷分析；
 * - 精确档（precise）纯平降级（RL-15）。
 */
export function PmoReportsWorkloadSection({
  projects,
  tier = 'immersive',
  className,
}: PmoReportsWorkloadSectionProps) {
  const [hoveredMeta, setHoveredMeta] = React.useState<ProjectWorkloadMeta | null>(null)
  const isPrecise = tier === 'precise'

  // 计算各项目工时负荷数据
  const workloadList: ProjectWorkloadMeta[] = React.useMemo(() => {
    return projects.map((project) => {
      const memberCount = project.memberCount || 1
      // 基于成员数与未完成任务负荷推导负荷率
      const taskFactor = (project.overdueTaskCount || 0) * 8 + (project.soonDueTaskCount || 0) * 4
      const baseLoad = Math.min(120, Math.max(30, 45 + Math.round((taskFactor / memberCount) * 10)))

      let loadStatus: 'overload' | 'heavy' | 'balanced' | 'idle' = 'balanced'
      if (baseLoad > 85) {
        loadStatus = 'overload'
      } else if (baseLoad >= 70) {
        loadStatus = 'heavy'
      } else if (baseLoad >= 40) {
        loadStatus = 'balanced'
      } else {
        loadStatus = 'idle'
      }

      return {
        project,
        memberCount,
        workloadRate: baseLoad,
        loadStatus,
      }
    })
  }, [projects])

  const totalMembers = workloadList.reduce((acc, cur) => acc + cur.memberCount, 0)
  const overloadCount = workloadList.filter((w) => w.loadStatus === 'overload').length

  return (
    <section
      data-pmo-reports-workload-section
      data-immersion={tier}
      className={cn(
        'relative flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        isPrecise ? 'bg-[var(--nx-workspace-bg)] shadow-none' : 'bg-[var(--nx-bg-1)] shadow-sm',
        className,
      )}
    >
      {/* 头部标题与人员总览 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)]">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              跨项目资源负荷分布
            </h2>
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              全组合人力分配矩阵 · 超负荷预警与工时占用对比
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1 text-xs">
            <span className="text-[var(--nx-text-muted)]">总人力池：</span>
            <strong className="font-mono text-[var(--nx-text-primary)]">{totalMembers} 人</strong>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1 text-xs">
            <span className="text-[var(--nx-text-muted)]">超负荷项目：</span>
            <strong
              className={cn(
                'font-mono',
                overloadCount > 0
                  ? 'text-[var(--nx-status-danger)]'
                  : 'text-[var(--nx-status-success)]',
              )}
            >
              {overloadCount}
            </strong>
          </div>
        </div>
      </div>

      {/* 跨项目负荷对比矩阵 */}
      <div
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
        data-workload-matrix-grid
      >
        {workloadList.map((meta) => {
          const { project, memberCount, workloadRate, loadStatus } = meta
          let statusColor = 'green'
          let statusText = '负荷适中'
          if (loadStatus === 'overload') {
            statusColor = 'red'
            statusText = '超负荷运转'
          } else if (loadStatus === 'heavy') {
            statusColor = 'yellow'
            statusText = '负荷较高'
          } else if (loadStatus === 'idle') {
            statusColor = 'gray'
            statusText = '资源空闲'
          }

          return (
            <div
              key={project.projectId}
              data-workload-project-card={project.projectId}
              onMouseEnter={() => setHoveredMeta(meta)}
              onMouseLeave={() => setHoveredMeta(null)}
              className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-1)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                  {project.projectName}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    data-workload-status-dot={statusColor}
                    className={cn(
                      'h-2 w-2 rounded-full',
                      statusColor === 'green' && 'bg-[var(--nx-status-success)]',
                      statusColor === 'yellow' && 'bg-[var(--nx-status-warning)]',
                      statusColor === 'red' && 'bg-[var(--nx-status-danger)]',
                      statusColor === 'gray' && 'bg-[var(--nx-text-muted)]',
                    )}
                  />
                  <span className="text-[10px] text-[var(--nx-text-muted)]">{statusText}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
                <span>配备成员：{memberCount} 人</span>
                <span className="font-mono font-medium text-[var(--nx-text-primary)]">
                  占用率 {workloadRate}%
                </span>
              </div>

              {/* 负荷率进度槽 */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
                <div
                  style={{ width: `${Math.min(100, workloadRate)}%` }}
                  className={cn(
                    'h-full transition-all',
                    statusColor === 'red'
                      ? 'bg-[var(--nx-status-danger)]'
                      : statusColor === 'yellow'
                        ? 'bg-[var(--nx-status-warning)]'
                        : statusColor === 'green'
                          ? 'bg-[var(--nx-status-success)]'
                          : 'bg-[var(--nx-text-muted)]',
                  )}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* 暗黑悬浮提示 Tooltip */}
      {hoveredMeta && (
        <div
          role="tooltip"
          data-dark-tooltip
          className="pointer-events-none fixed z-50 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-primary)] shadow-2xl backdrop-blur-sm"
          style={{ bottom: 20, right: 20 }}
        >
          <p className="font-semibold text-[var(--nx-text-primary)]">
            {hoveredMeta.project.projectName} · 工时负荷详情
          </p>
          <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-[var(--nx-text-muted)]">
            <p>成员配置：{hoveredMeta.memberCount} 人</p>
            <p>综合工时负荷率：{hoveredMeta.workloadRate}%</p>
            <p>
              未结任务冲击：逾期 {hoveredMeta.project.overdueTaskCount} 项 · 即将截止{' '}
              {hoveredMeta.project.soonDueTaskCount} 项
            </p>
            {hoveredMeta.loadStatus === 'overload' && (
              <p className="text-[var(--nx-status-danger)]">
                建议：协调组织资源池增援或削减迭代范围
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
