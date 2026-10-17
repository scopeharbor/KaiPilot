'use client'

import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

/**
 * 项目时间主轴 HUD（v3-ui-next-project-space design Decision 3 / spec「时间主轴 DOM 呈现与今天锚点」）。
 *
 * - 纯高密度 DOM + CSS 发丝线，零 WebGL / Canvas（RL-14、RL-15）；
 * - 三区语义：过去分区（暗调低对比度）｜今天锚点（--nx-space-cyan 电光刻度 + 徽章）｜未来分区（虚线前瞻）；
 * - 周期未设（startDate 或 endDate 为 null）→ 中性虚线兜底（data-timeline-status="unspecified"），
 *   居中呈现今天锚点并提示「未设定起止周期」，绝不抛 NaN / 布局塌陷；
 * - 精确档（precise，含系统减弱动画偏好）→ 彻底剔除今天锚点光晕，刻度退化为 1px 纯实线，
 *   文字升为高对比度（--nx-text-primary），信息等价 100%。
 */

export interface ProjectTimelineBarProps {
  startDate: string | null
  endDate: string | null
  /** 项目综合完成进度百分比。 */
  progressPercent: number
  /** 「今天」锚点（YYYY-MM-DD）；缺省取用户当前系统日期，测试可注入固定值。 */
  today?: string
}

export interface ProjectTimelineMetrics {
  status: 'specified' | 'unspecified'
  /** 周期跨度（含首尾）；未设周期为 null。 */
  totalDays: number | null
  /** 今天相对起点偏移天数；未设周期为 null。 */
  elapsedDays: number | null
  /** 今天锚点位置百分比（0~100）；未设周期为 null（该场景锚点居中 50%）。 */
  todayPercent: number | null
  /** 距截止日剩余天数（负数为已逾期）；endDate 未设为 null。 */
  remainingDays: number | null
}

const DAY_MS = 86_400_000

/** 解析 YYYY-MM-DD 为 UTC 零点毫秒（规避 DST 对自然日差的影响）。 */
function parseDateMs(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

/** 自然日差（calendar days）：dateLeft - dateRight，与 date-fns differenceInCalendarDays 同语义。 */
export function differenceInCalendarDays(dateLeft: string, dateRight: string): number {
  return Math.round((parseDateMs(dateLeft) - parseDateMs(dateRight)) / DAY_MS)
}

/** 本地日期 → YYYY-MM-DD。 */
export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 时间主轴区间计算（design D3 坐标系算法）：
 * - 周期有效（起止均非空）：totalDays = diff(end, start) + 1（含首尾）；
 *   elapsedDays = diff(today, start)；todayPercent = clamp(elapsed/total*100, 0, 100)；
 *   remainingDays = diff(end, today)（<0 表示逾期）；
 * - 数据异常（end 早于 start）：totalDays<=0，百分比安全归零，不抛错；
 * - 周期未设：unspecified，仅当 endDate 存在时给出剩余天数（待定侧不参与计算）。
 */
export function computeProjectTimelineMetrics(
  startDate: string | null,
  endDate: string | null,
  today: string,
): ProjectTimelineMetrics {
  if (startDate === null || endDate === null) {
    return {
      status: 'unspecified',
      totalDays: null,
      elapsedDays: null,
      todayPercent: null,
      remainingDays: endDate === null ? null : differenceInCalendarDays(endDate, today),
    }
  }
  const totalDays = differenceInCalendarDays(endDate, startDate) + 1
  const elapsedDays = differenceInCalendarDays(today, startDate)
  const safeTotal = totalDays > 0 ? totalDays : 1
  const todayPercent = Math.max(0, Math.min(100, (elapsedDays / safeTotal) * 100))
  return {
    status: 'specified',
    totalDays,
    elapsedDays,
    todayPercent,
    remainingDays: differenceInCalendarDays(endDate, today),
  }
}

export function ProjectTimelineBar({
  startDate,
  endDate,
  progressPercent,
  today,
}: ProjectTimelineBarProps) {
  const mobile = useMobileWorkspace()
  const tier = useImmersionTier()
  const todayRef = today ?? toDateString(new Date())
  const metrics = computeProjectTimelineMetrics(startDate, endDate, todayRef)
  const specified = metrics.status === 'specified'
  // 未设周期时锚点居中（spec「中性刻度兜底」）；label 额外夹取防两端溢出。
  const anchorPercent = specified && metrics.todayPercent !== null ? metrics.todayPercent : 50
  const labelPercent = Math.max(10, Math.min(90, anchorPercent))
  const flat = tier === 'precise'

  const remainingLabel =
    metrics.remainingDays === null
      ? null
      : metrics.remainingDays >= 0
        ? `剩余 ${metrics.remainingDays} 天`
        : `已逾期 ${-metrics.remainingDays} 天`
  const overdue = metrics.remainingDays !== null && metrics.remainingDays < 0
  const progress = Math.max(0, Math.min(100, progressPercent))

  if (mobile)
    return (
      <div
        data-timeline-bar
        data-timeline-status={metrics.status}
        data-mobile-project-summary
        className="space-y-2 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {startDate ?? '待定'} → {endDate ?? '待定'}
          </span>
          <span className="text-[var(--nx-accent)]">{progress}%</span>
        </div>
        <progress
          aria-label="项目完成进度"
          value={progress}
          max={100}
          className="block h-1.5 w-full accent-[var(--nx-accent)]"
        />
        <p
          className={cn(
            'text-xs',
            overdue ? 'text-[var(--nx-status-danger)]' : 'text-[var(--nx-text-muted)]',
          )}
        >
          {remainingLabel ?? '未设定起止周期'} · 今天 {todayRef}
        </p>
      </div>
    )
  return (
    <div
      data-timeline-bar
      data-timeline-status={metrics.status}
      data-immersion={tier}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* 宏观度量 HUD：计划周期 · 进度 · 剩余/逾期 */}
      <div data-timeline-metrics className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span data-timeline-period className="font-mono text-xs text-[var(--nx-text-secondary)]">
          {startDate ?? '待定'} ~ {endDate ?? '待定'}
        </span>
        <span
          data-timeline-progress
          className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]"
        >
          <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
            <span
              className="block h-full rounded-full bg-[var(--nx-workspace-blue)]"
              style={{ width: `${progress}%` }}
            />
          </span>
          {progress}%
        </span>
        {remainingLabel !== null ? (
          <span
            data-timeline-remaining
            data-timeline-overdue={overdue ? 'true' : undefined}
            className={cn(
              'text-xs',
              overdue ? 'text-[var(--nx-status-danger)]' : 'text-[var(--nx-text-secondary)]',
            )}
          >
            {remainingLabel}
          </span>
        ) : null}
      </div>

      {/* 时间主轴：三区语义分区 + 今天锚点 */}
      <div
        data-timeline-axis
        data-today-percent={specified ? metrics.todayPercent?.toFixed(2) : undefined}
        role="img"
        aria-label="项目时间主轴（过去 / 今天锚点 / 未来）"
        className="relative mt-4 h-12"
      >
        <div data-timeline-track className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2">
          {specified ? (
            <>
              <div
                data-timeline-past
                className="absolute inset-y-0 left-0 bg-[var(--nx-text-muted)]/50"
                style={{ width: `${anchorPercent}%` }}
              />
              <div
                data-timeline-future
                className={cn(
                  'absolute inset-y-0 right-0 border-t',
                  flat
                    ? 'border-[var(--nx-border-hairline)]'
                    : 'border-dashed border-[var(--nx-border-hairline)]',
                )}
                style={{ width: `${100 - anchorPercent}%` }}
              />
            </>
          ) : (
            <div
              data-timeline-unset
              className="absolute inset-0 border-t border-dashed border-[var(--nx-border-hairline)]"
            />
          )}
        </div>

        <div
          data-timeline-today
          className="absolute inset-y-0"
          style={{ left: `${anchorPercent}%` }}
        >
          <span
            data-timeline-today-line
            className={cn(
              'mx-auto block h-full w-px bg-[var(--nx-space-cyan)]',
              !flat && 'shadow-[0_0_8px_var(--nx-space-cyan)]',
            )}
          />
        </div>
        <span
          data-timeline-today-label
          className={cn(
            'pointer-events-none absolute top-3 -translate-x-1/2 whitespace-nowrap font-mono text-[10px]',
            flat ? 'text-[var(--nx-text-primary)]' : 'text-[var(--nx-space-cyan)]',
          )}
          style={{ left: `${labelPercent}%` }}
        >
          {todayRef} 今天
        </span>
      </div>

      {!specified ? (
        <p
          data-timeline-unspecified-hint
          className="mt-2 text-center text-xs text-[var(--nx-text-muted)]"
        >
          未设定起止周期
        </p>
      ) : null}
    </div>
  )
}

export default ProjectTimelineBar
