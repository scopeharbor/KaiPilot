'use client'

import * as React from 'react'
import { Activity, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortfolioProjectItem, PortfolioDashboardSummary } from '@aiproj/types'

export interface PmoReportsHealthSectionProps {
  projects: PortfolioProjectItem[]
  summary?: PortfolioDashboardSummary | null
  onProjectClick?: (projectId: number) => void
  tier?: 'immersive' | 'light' | 'precise'
  className?: string
}

/**
 * PMO 组合报表 - 交付健康透视面板 (Health & Delivery Section)
 *
 * - 交付健康状态分布与 4 色状态指示灯（绿/黄/红/灰）；
 * - 整体健康推进率计算与分布柱/堆叠条展示；
 * - 支持暗黑悬浮 Tooltip 呈现各项目健康详情与逾期概览；
 * - 精确档（precise）纯平降级（RL-15：零 3D/Canvas，发丝线与纯色背景）。
 */
export function PmoReportsHealthSection({
  projects,
  summary,
  onProjectClick,
  tier = 'immersive',
  className,
}: PmoReportsHealthSectionProps) {
  const [hoveredProject, setHoveredProject] = React.useState<PortfolioProjectItem | null>(null)
  const isPrecise = tier === 'precise'

  // 从 summary.trafficLight 或 projects 聚合统计
  const counts = React.useMemo(() => {
    if (summary?.trafficLight) {
      const { greenCount, yellowCount, redCount, grayCount } = summary.trafficLight
      const total = greenCount + yellowCount + redCount + grayCount || projects.length || 1
      return {
        green: greenCount,
        yellow: yellowCount,
        red: redCount,
        gray: grayCount,
        total,
      }
    }
    let green = 0
    let yellow = 0
    let red = 0
    let gray = 0
    projects.forEach((p) => {
      const color = (p.trafficLightColor || '').toLowerCase()
      const health = (p.healthStatus || '').toLowerCase()
      if (color === 'green' || health === 'healthy') green += 1
      else if (color === 'yellow' || health === 'at_risk') yellow += 1
      else if (color === 'red' || health === 'critical') red += 1
      else gray += 1
    })
    const total = projects.length || 1
    return { green, yellow, red, gray, total }
  }, [summary?.trafficLight, projects])

  const healthyRate = Math.round(((counts.green + counts.yellow * 0.5) / counts.total) * 100)

  return (
    <section
      data-pmo-reports-health-section
      data-immersion={tier}
      className={cn(
        'relative flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        isPrecise ? 'bg-[var(--nx-workspace-bg)] shadow-none' : 'bg-[var(--nx-bg-1)] shadow-sm',
        className,
      )}
    >
      {/* 头部标题与关键健康率 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)]">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              组合交付与健康透视
            </h2>
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              全域 {projects.length} 个受纳项目交付健康状态与红绿灯分布
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--nx-status-success)]" aria-hidden />
            <span className="text-xs text-[var(--nx-text-muted)]">综合交付推进率</span>
            <span className="font-mono text-xs font-semibold text-[var(--nx-text-primary)]">
              {healthyRate}%
            </span>
          </div>
        </div>
      </div>

      {/* 四色指示灯态势分布汇总卡片 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-health-indicators-grid>
        {/* 绿灯: 正常健康 */}
        <div
          data-health-card="green"
          className="flex flex-col gap-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--nx-text-secondary)]">正常交付</span>
            <span
              data-status-dot="green"
              className="h-2.5 w-2.5 rounded-full bg-[var(--nx-status-success)] ring-2 ring-[var(--nx-status-success)]/20"
              title="状态正常"
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-xl font-bold text-[var(--nx-text-primary)]">
              {counts.green}
            </span>
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              ({Math.round((counts.green / counts.total) * 100)}%)
            </span>
          </div>
        </div>

        {/* 黄灯: 关注预警 */}
        <div
          data-health-card="yellow"
          className="flex flex-col gap-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--nx-text-secondary)]">关注预警</span>
            <span
              data-status-dot="yellow"
              className="h-2.5 w-2.5 rounded-full bg-[var(--nx-status-warning)] ring-2 ring-[var(--nx-status-warning)]/20"
              title="状态预警"
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-xl font-bold text-[var(--nx-text-primary)]">
              {counts.yellow}
            </span>
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              ({Math.round((counts.yellow / counts.total) * 100)}%)
            </span>
          </div>
        </div>

        {/* 红灯: 严重延期 */}
        <div
          data-health-card="red"
          className="flex flex-col gap-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--nx-text-secondary)]">高危延期</span>
            <span
              data-status-dot="red"
              className="h-2.5 w-2.5 rounded-full bg-[var(--nx-status-danger)] ring-2 ring-[var(--nx-status-danger)]/20"
              title="严重延期"
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-xl font-bold text-[var(--nx-text-primary)]">
              {counts.red}
            </span>
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              ({Math.round((counts.red / counts.total) * 100)}%)
            </span>
          </div>
        </div>

        {/* 灰灯: 暂停未评 */}
        <div
          data-health-card="gray"
          className="flex flex-col gap-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--nx-text-secondary)]">未评/暂停</span>
            <span
              data-status-dot="gray"
              className="h-2.5 w-2.5 rounded-full bg-[var(--nx-text-muted)] ring-2 ring-[var(--nx-text-muted)]/20"
              title="未评或暂停"
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-xl font-bold text-[var(--nx-text-primary)]">
              {counts.gray}
            </span>
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              ({Math.round((counts.gray / counts.total) * 100)}%)
            </span>
          </div>
        </div>
      </div>

      {/* 堆叠分布横条 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[10px] text-[var(--nx-text-muted)]">
          <span>红绿灯全景分布</span>
          <span>{counts.total} 个项目</span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--nx-bg-0)]">
          {counts.green > 0 && (
            <div
              style={{ width: `${(counts.green / counts.total) * 100}%` }}
              className="bg-[var(--nx-status-success)] transition-all"
              title={`正常交付: ${counts.green}`}
            />
          )}
          {counts.yellow > 0 && (
            <div
              style={{ width: `${(counts.yellow / counts.total) * 100}%` }}
              className="bg-[var(--nx-status-warning)] transition-all"
              title={`关注预警: ${counts.yellow}`}
            />
          )}
          {counts.red > 0 && (
            <div
              style={{ width: `${(counts.red / counts.total) * 100}%` }}
              className="bg-[var(--nx-status-danger)] transition-all"
              title={`高危延期: ${counts.red}`}
            />
          )}
          {counts.gray > 0 && (
            <div
              style={{ width: `${(counts.gray / counts.total) * 100}%` }}
              className="bg-[var(--nx-text-muted)] transition-all"
              title={`未评暂停: ${counts.gray}`}
            />
          )}
        </div>
      </div>

      {/* 项目健康明细清单 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-[var(--nx-text-secondary)]">项目健康概览</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const color = (project.trafficLightColor || '').toLowerCase()
            const health = (project.healthStatus || '').toLowerCase()
            let statusColor = 'gray'
            let statusLabel = '未评估'
            if (color === 'green' || health === 'healthy') {
              statusColor = 'green'
              statusLabel = '正常交付'
            } else if (color === 'yellow' || health === 'at_risk') {
              statusColor = 'yellow'
              statusLabel = '预警关注'
            } else if (color === 'red' || health === 'critical') {
              statusColor = 'red'
              statusLabel = '高危延期'
            }

            return (
              <div
                key={project.projectId}
                data-project-health-item={project.projectId}
                onMouseEnter={() => setHoveredProject(project)}
                onMouseLeave={() => setHoveredProject(null)}
                onClick={() => onProjectClick?.(project.projectId)}
                className="group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-1)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-[var(--nx-text-primary)] group-hover:text-[var(--nx-accent)]">
                    {project.projectName}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      data-status-dot={statusColor}
                      className={cn(
                        'h-2 w-2 rounded-full',
                        statusColor === 'green' && 'bg-[var(--nx-status-success)]',
                        statusColor === 'yellow' && 'bg-[var(--nx-status-warning)]',
                        statusColor === 'red' && 'bg-[var(--nx-status-danger)]',
                        statusColor === 'gray' && 'bg-[var(--nx-text-muted)]',
                      )}
                    />
                    <span className="text-[10px] text-[var(--nx-text-muted)]">{statusLabel}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
                  <span>进度: {project.progressPercent}%</span>
                  {project.overdueTaskCount > 0 ? (
                    <span className="font-medium text-[var(--nx-status-danger)]">
                      逾期 {project.overdueTaskCount} 项
                    </span>
                  ) : (
                    <span>零逾期</span>
                  )}
                </div>

                {/* 迷你进度条 */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
                  <div
                    style={{ width: `${Math.min(100, Math.max(0, project.progressPercent))}%` }}
                    className={cn(
                      'h-full transition-all',
                      statusColor === 'red'
                        ? 'bg-[var(--nx-status-danger)]'
                        : statusColor === 'yellow'
                          ? 'bg-[var(--nx-status-warning)]'
                          : 'bg-[var(--nx-accent)]',
                    )}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 暗黑悬浮提示 Tooltip */}
      {hoveredProject && (
        <div
          role="tooltip"
          data-dark-tooltip
          className="pointer-events-none fixed z-50 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-primary)] shadow-2xl backdrop-blur-sm"
          style={{ bottom: 20, right: 20 }}
        >
          <p className="font-semibold text-[var(--nx-text-primary)]">
            {hoveredProject.projectName}
          </p>
          <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-[var(--nx-text-muted)]">
            <p>综合进度：{hoveredProject.progressPercent}%</p>
            <p>
              逾期任务：{hoveredProject.overdueTaskCount} 项 · 近期截止：
              {hoveredProject.soonDueTaskCount} 项
            </p>
            <p>团队规模：{hoveredProject.memberCount} 人</p>
            {hoveredProject.warnings && hoveredProject.warnings.length > 0 && (
              <p className="text-[var(--nx-status-warning)]">
                告警提示：{hoveredProject.warnings[0]?.message}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
