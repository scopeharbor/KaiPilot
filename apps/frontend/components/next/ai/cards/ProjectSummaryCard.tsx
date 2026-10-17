'use client'

import { CalendarRange, CheckCircle2, ListChecks, Users } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 项目摘要结构化卡片（v3-ui-next-ai-colleague spec「结构化查询结果卡片渲染」）。
 *
 * - 消费只读工具 `get_project_summary` 的输出：项目名称、代号、状态徽章、
 *   起止日期跨度、进度百分比进度槽（天青色微光填充）、任务总数/已完成数与成员数；
 * - 未知字段防崩溃保护：所有数值经 `toFinite` 收敛，字符串字段取原始值回退；
 * - 顶部恒展示「⚡ 快捷规则匹配 · get_project_summary」诚实微标（RL-07）。
 */

/** 项目状态七态中文回显（未知状态不臆造，回退为原始值）。 */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  planning: '规划中',
  active: '进行中',
  on_hold: '暂停',
  completed: '已完成',
  cancelled: '已取消',
  archived: '已归档',
}

const PROJECT_STATUS_TONE: Record<string, string> = {
  active: 'border-[var(--nx-status-success)]/50 text-[var(--nx-status-success)]',
  on_hold: 'border-[var(--nx-status-warning)]/50 text-[var(--nx-status-warning)]',
  completed: 'border-[var(--nx-accent)]/50 text-[var(--nx-accent)]',
  cancelled: 'border-[var(--nx-status-danger)]/50 text-[var(--nx-status-danger)]',
  archived: 'border-[var(--nx-border-focus)] text-[var(--nx-text-muted)]',
}

/** 数值防御：非有限数值一律收敛为 0，杜绝 NaN 污染渲染（防崩溃红线）。 */
function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export interface ProjectSummaryData {
  id: number
  name: string
  code: string | null
  status: string
  priority: string
  startDate: string | null
  endDate: string | null
  taskCount: number
  completedTaskCount: number
  progressPercent: number
  memberCount: number
}

export interface ProjectSummaryCardProps {
  data: ProjectSummaryData
  /** 命中工具名（v1 恒为规则直连，默认诚实标注 get_project_summary）。 */
  toolName?: string
}

export function ProjectSummaryCard({
  data,
  toolName = 'get_project_summary',
}: ProjectSummaryCardProps) {
  const tier = useImmersionTier()
  // 沉浸阶梯降级（spec）：精确档（含 prefers-reduced-motion 合成）彻底停用光晕
  const precise = tier === 'precise'
  const name = typeof data.name === 'string' && data.name.trim() !== '' ? data.name : '未命名项目'
  const code = typeof data.code === 'string' && data.code.trim() !== '' ? data.code : null
  const status = typeof data.status === 'string' ? data.status : ''
  const statusLabel = PROJECT_STATUS_LABELS[status] ?? status
  const startDate = typeof data.startDate === 'string' ? data.startDate : null
  const endDate = typeof data.endDate === 'string' ? data.endDate : null

  const taskCount = toFinite(data.taskCount)
  const completedTaskCount = toFinite(data.completedTaskCount)
  const progressPercent = clampPercent(toFinite(data.progressPercent))
  const memberCount = toFinite(data.memberCount)

  const hasDateRange = startDate && endDate

  return (
    <article
      data-card="project-summary"
      data-status={status}
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--nx-text-primary)]">项目摘要</span>
        <RuleMatchBadge toolName={toolName} />
      </div>

      <div className="space-y-2.5 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              data-summary-name
              className="truncate text-sm font-medium text-[var(--nx-text-primary)]"
            >
              {name}
            </h3>
            <p
              data-summary-code
              className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]"
            >
              {code ? `项目代号 ${code}` : '项目代号未设置'}
            </p>
          </div>
          <span
            data-summary-status
            className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] leading-none ${PROJECT_STATUS_TONE[status] ?? 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]'}`}
          >
            {statusLabel || '状态未知'}
          </span>
        </div>

        <div
          data-summary-dates
          className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
          {hasDateRange ? (
            <span className="font-mono">
              {startDate} ~ {endDate}
            </span>
          ) : (
            <span className="text-[var(--nx-text-muted)]">起止日期未设定</span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] leading-4">
            <span className="text-[var(--nx-text-muted)]">任务完成度</span>
            <span data-summary-progress-label className="font-mono text-[var(--nx-accent)]">
              {progressPercent}%
            </span>
          </div>
          <div
            data-summary-progress
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-label={`项目进度 ${progressPercent}%`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--nx-border-hairline)]"
          >
            <div
              className="h-full rounded-full bg-[var(--nx-space-cyan)]"
              style={{
                width: `${progressPercent}%`,
                // 天青色微光填充（令牌 --nx-space-cyan #38bdf8 的固定透明度展开）；
                // 精确档强制关闭发光（spec「沉浸阶梯降级适配」），沉浸/轻量档保留。
                ...(precise ? {} : { boxShadow: '0 0 6px rgba(56, 189, 248, 0.45)' }),
              }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 pt-0.5 text-center">
          <div className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 py-1.5">
            <dt className="flex items-center justify-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
              <ListChecks className="h-3 w-3" aria-hidden />
              任务总数
            </dt>
            <dd
              data-summary-task-count
              className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]"
            >
              {taskCount}
            </dd>
          </div>
          <div className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 py-1.5">
            <dt className="flex items-center justify-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              已完成
            </dt>
            <dd
              data-summary-completed-count
              className="mt-0.5 font-mono text-sm text-[var(--nx-status-success)]"
            >
              {completedTaskCount}
            </dd>
          </div>
          <div className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 py-1.5">
            <dt className="flex items-center justify-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
              <Users className="h-3 w-3" aria-hidden />
              成员数
            </dt>
            <dd
              data-summary-member-count
              className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]"
            >
              {memberCount}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  )
}

export default ProjectSummaryCard
