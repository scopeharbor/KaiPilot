/**
 * 里程碑时间轴泳道镜头（v3-ui-next-chart-gallery W2 · tasks 2.5/2.6）。
 *
 * 自研 DOM 时间轴（纯 CSS 定位 + SVG 进度环，确定性几何）：
 * - 顶部年月旬日历标尺（月段 + 每旬 1/11/21 刻度，数据驱动不依赖测量）；
 * - 水平单泳道轴线按 plannedDate 线性排布里程碑 45° 菱形旗帜（严格日期升序，
 *   同日按 displayOrder 微偏移防重叠），五状态机器视觉：
 *   not_started 灰虚线 / planned 冷蓝实体 / at_risk 警示黄（沉浸档带脉冲）/
 *   achieved 绿实心对勾 / missed 红实心感叹号，均附文字标签（色盲可辨）；
 * - 旗帜下方展示关联任务达成率进度环（SVG stroke-dasharray）+ 任务数徽章，
 *   达成率口径：status === 'completed' / 非 cancelled 任务；
 * - 点击旗帜呼出里程碑详情（目标日期/状态/未完成任务清单）；未排期里程碑
 *   收纳在轴外独立泳区；纯只读零写（RL-01/RL-06）。
 *
 * 数据：milestonesApi.list + tasksApi.list（任务.milestoneId 关联，RL-04 同键）。
 */
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Check, Flag, X } from 'lucide-react'
import type { Milestone, MilestoneStatus } from '@/lib/api/milestones'
import { milestonesApi, milestoneKeys } from '@/lib/api/milestones'
import type { Task } from '@/lib/api/tasks'
import { tasksApi, taskKeys } from '@/lib/api/tasks'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  computeMilestoneAxis,
  MILESTONE_STATUS_LABEL,
  milestoneRingTone,
  type MilestoneAxisModel,
  type MilestoneProgress,
  type MilestoneTimelineNode,
} from '@/lib/next/charts/milestone-timeline-adapter'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface MilestoneTimelineChartLensProps {
  projectId: number
}

/** 里程碑状态 → 旗帜外框/填充语义（令牌名，SVG/DOM 均可用 style 消费）。 */
const FLAG_FRAME: Record<MilestoneStatus, string> = {
  not_started: '--nx-text-muted',
  planned: '--nx-chart-1',
  at_risk: '--nx-status-warning',
  achieved: '--nx-status-success',
  missed: '--nx-status-danger',
}

/** 任务状态 → 信号点色令牌。 */
const TASK_DOT_TONE: Record<Task['status'], string> = {
  not_started: '--nx-text-muted',
  in_progress: '--nx-chart-1',
  completed: '--nx-status-success',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

const PAGE_SIZE = 100
const MAX_PAGES = 10

async function fetchAllTasks(projectId: number): Promise<Task[]> {
  const firstPage = await tasksApi.list(projectId, { page: 1, perPage: PAGE_SIZE, sort: '+id' })
  const pageCount = Math.min(firstPage.meta.totalPages, MAX_PAGES)
  if (pageCount <= 1) return firstPage.data
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      tasksApi.list(projectId, { page: index + 2, perPage: PAGE_SIZE, sort: '+id' }),
    ),
  )
  return [firstPage.data, ...remainingPages.map((page) => page.data)].flat()
}

/** 轴高 / 轴向几何常量（确定性布局，测试据此断言线性定位）。 */
const AXIS_Y = 64
const FLAG_SIZE = 22
const FLAG_TOP_SPACER = AXIS_Y - FLAG_SIZE / 2
const CANVAS_HEIGHT = 190

export function MilestoneTimelineChartLens({ projectId }: MilestoneTimelineChartLensProps) {
  const tier = useImmersionTier()
  const precise = tier === 'precise'
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const milestonesQuery = useQuery({
    queryKey: milestoneKeys.list(projectId, {}),
    queryFn: () => milestonesApi.list(projectId),
    enabled: projectId > 0,
    retry: false,
  })
  const milestones = milestonesQuery.data?.data ?? []
  const tasksQuery = useQuery({
    queryKey: taskKeys.view(projectId, 'milestone-timeline', { page: 1, perPage: PAGE_SIZE }),
    queryFn: () => fetchAllTasks(projectId),
    enabled: projectId > 0 && milestones.length > 0,
    retry: false,
  })

  const model = useMemo(() => {
    if (milestonesQuery.data === undefined) return null
    if (tasksQuery.data === undefined && milestones.length > 0) return null
    return computeMilestoneAxis(milestones, tasksQuery.data ?? [])
  }, [milestonesQuery.data, tasksQuery.data, milestones.length])

  const selected = useMemo(() => {
    if (selectedId === null) return null
    const node = model?.nodes.find((item) => item.milestone.id === selectedId)
    if (node) return node
    const undated = model?.undated.find((item) => item.milestone.id === selectedId)
    return undated ?? null
  }, [model, selectedId])

  const milestonesReady = milestonesQuery.data !== undefined
  const tasksReady = milestones.length === 0 || tasksQuery.data !== undefined
  const failed =
    (milestonesQuery.isError && !milestonesReady) ||
    (milestones.length > 0 && tasksQuery.isError && !tasksReady)
  const pending = !milestonesReady || (milestones.length > 0 && !tasksReady)

  const retry = () => {
    void milestonesQuery.refetch()
    if (milestones.length > 0) void tasksQuery.refetch()
  }

  return (
    <div
      data-chart-lens-root="milestone-timeline"
      ref={rootRef}
      className="flex min-h-[420px] flex-col gap-3"
    >
      <div
        data-milestone-legend
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[var(--nx-text-secondary)]"
      >
        {(Object.keys(MILESTONE_STATUS_LABEL) as MilestoneStatus[]).map((status) => (
          <span
            key={status}
            data-milestone-legend-item={status}
            className="inline-flex items-center gap-1.5"
          >
            <DiamondSwatch status={status} size={10} />
            {MILESTONE_STATUS_LABEL[status]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[var(--nx-text-muted)]">
          <Flag className="h-3 w-3" aria-hidden />
          未排期
        </span>
      </div>

      {pending && !failed ? (
        <ChartLensSkeleton label="正在加载里程碑时间轴数据" />
      ) : failed ? (
        <ChartLensErrorState
          ariaLabel="里程碑时间轴加载失败"
          title="里程碑数据加载失败"
          onRetry={retry}
        />
      ) : model === null ? (
        <ChartLensEmptyState
          icon={Flag}
          title="当前项目暂无里程碑"
          description="项目尚未设定里程碑节点；可前往时间线工作面规划关键节点后回来看泳道图。"
          guideHref={`/next/projects/${projectId}?lens=timeline`}
          guideLabel="前往时间线规划里程碑"
          ariaLabel="里程碑数据为空"
        />
      ) : (
        <>
          <TimelineCanvas model={model} precise={precise} onSelect={setSelectedId} />

          {model.undated.length > 0 ? (
            <div
              data-milestone-undated
              className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
            >
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-secondary)]">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                未排期里程碑（{model.undated.length}）
              </h4>
              <div className="flex flex-wrap gap-2">
                {model.undated.map((entry) => (
                  <MilestoneChip
                    key={entry.milestone.id}
                    milestone={entry.milestone}
                    active={selectedId === entry.milestone.id}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {model.nodes.length === 0 && model.undated.length === 0 ? (
            <ChartLensEmptyState
              icon={Flag}
              title="当前项目暂无里程碑"
              description="项目尚未设定里程碑节点；可前往时间线工作面规划关键节点后回来看泳道图。"
              guideHref={`/next/projects/${projectId}?lens=timeline`}
              guideLabel="前往时间线规划里程碑"
              ariaLabel="里程碑数据为空"
            />
          ) : null}

          {selected ? (
            <MilestoneDetailPanel
              milestone={selected.milestone}
              progress={selected.progress}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/** 纯展示：泳道时间轴（标尺 + 旗帜 + 达成率环），数据与几何均来自适配器。 */
function TimelineCanvas({
  model,
  precise,
  onSelect,
}: {
  model: MilestoneAxisModel
  precise: boolean
  onSelect: (id: number) => void
}) {
  return (
    <div
      data-milestone-timeline-canvas
      className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]"
    >
      <div style={{ width: model.innerWidth, minWidth: model.innerWidth }}>
        {/* 年月旬日历标尺 */}
        <div
          data-milestone-ruler
          role="img"
          aria-label={`里程碑时间标尺 ${model.startKey} ~ ${model.endKey}`}
          className="relative h-11 border-b border-[var(--nx-border-hairline)]"
        >
          {model.months.map((month) => (
            <div
              key={month.monthKey}
              data-ruler-month={month.monthKey}
              className="absolute top-0 h-full border-l border-[var(--nx-border-hairline)]"
              style={{
                left: month.startDayIndex * model.pxPerDay,
                width: month.days * model.pxPerDay,
              }}
            >
              <span
                data-ruler-month-label={month.monthKey}
                className="absolute left-1/2 top-1.5 -translate-x-1/2 truncate text-[10px] text-[var(--nx-text-secondary)]"
                style={{ maxWidth: month.days * model.pxPerDay - 8 }}
              >
                {month.label}
              </span>
            </div>
          ))}
          {/* 每旬（11/21 日）刻度：短刻度线；1 日刻度即月界，复用月段左边框 */}
          {model.months.map((month) => {
            const ticks = month.tickDayIndexes
              .map((dayIndex) => ({
                dayIndex,
                dayOfMonth: dayIndex - month.startDayIndex + 1,
              }))
              .filter(({ dayOfMonth }) => dayOfMonth === 11 || dayOfMonth === 21)
            return ticks.map(({ dayIndex }) => (
              <span
                key={`${month.monthKey}-${dayIndex}`}
                data-ruler-tick={dayIndex}
                aria-hidden
                className="absolute bottom-0 top-1 w-px bg-[var(--nx-border-hairline)]"
                style={{ left: dayIndex * model.pxPerDay }}
              />
            ))
          })}
        </div>

        {/* 泳道：水平主轴线，节点按日期线性定位 */}
        <div
          data-milestone-lane
          className="relative"
          style={{ height: CANVAS_HEIGHT, minHeight: CANVAS_HEIGHT }}
        >
          {/* 主轴线 */}
          <div
            aria-hidden
            data-milestone-axis
            className="absolute inset-x-0 border-t border-[var(--nx-border-focus)]"
            style={{ top: AXIS_Y }}
          />
          {model.nodes.map((node, index) => (
            <MilestoneNodeColumn
              key={node.milestone.id}
              node={node}
              index={index}
              model={model}
              precise={precise}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 单个里程碑节点列：旗帜 + 名称 + 日期 + 达成率环与任务徽章。 */
function MilestoneNodeColumn({
  node,
  index,
  model,
  precise,
  onSelect,
}: {
  node: MilestoneTimelineNode
  index: number
  model: MilestoneAxisModel
  precise: boolean
  onSelect: (id: number) => void
}) {
  const nextCenter = model.nodes[index + 1]?.centerPx
  const gapPx = nextCenter !== undefined ? nextCenter - node.centerPx : 240
  const labelWidth = Math.max(46, Math.min(150, gapPx - 14))
  const { milestone, progress } = node

  return (
    <div
      data-milestone-node-column={milestone.id}
      className="absolute top-0 flex flex-col items-center"
      style={{ left: node.centerPx, width: labelWidth, transform: 'translateX(-50%)' }}
    >
      <div style={{ height: FLAG_TOP_SPACER }} />
      <button
        type="button"
        data-milestone-node={milestone.id}
        data-status={milestone.status}
        aria-label={`里程碑 ${milestone.name}，${MILESTONE_STATUS_LABEL[milestone.status]}，计划日期 ${milestone.plannedDate ?? '未排期'}，关联任务 ${progress.completed}/${progress.total} 达成`}
        title={`${milestone.name} · ${MILESTONE_STATUS_LABEL[milestone.status]}`}
        onClick={() => onSelect(milestone.id)}
        className="relative flex h-7 w-7 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
      >
        <span
          className={cn(
            'relative flex h-[22px] w-[22px] rotate-45 items-center justify-center rounded-[3px] border transition-transform group-hover:scale-110',
            milestone.status === 'not_started' ? 'border-dashed' : '',
          )}
          style={{
            borderColor: `var(${FLAG_FRAME[milestone.status]})`,
            backgroundColor:
              milestone.status === 'achieved' || milestone.status === 'missed'
                ? `var(${FLAG_FRAME[milestone.status]})`
                : milestone.status === 'at_risk'
                  ? 'rgba(245, 158, 11, 0.12)'
                  : 'transparent',
            opacity: milestone.status === 'not_started' ? 0.75 : 1,
          }}
        >
          {milestone.status === 'achieved' || milestone.status === 'missed' ? (
            <span aria-hidden className="flex -rotate-45 items-center justify-center text-white">
              {milestone.status === 'achieved' ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <span className="text-[13px] font-bold leading-none">!</span>
              )}
            </span>
          ) : null}
        </span>
        {milestone.status === 'at_risk' && !precise ? (
          <span
            aria-hidden
            data-milestone-pulse
            className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[4px] border animate-ping"
            style={{ borderColor: 'rgba(245, 158, 11, 0.75)' }}
          />
        ) : null}
      </button>
      <div
        data-milestone-node-label
        className="mt-1.5 truncate text-center text-[11px] font-medium text-[var(--nx-text-primary)]"
        style={{ maxWidth: labelWidth - 6 }}
        title={milestone.name}
      >
        {milestone.name}
      </div>
      <div className="font-mono text-[9px] text-[var(--nx-text-muted)]">
        {milestone.plannedDate ?? '未排期'}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <ProgressRing
          status={milestone.status}
          progress={progress}
          milestoneName={milestone.name}
        />
        <span
          data-milestone-task-badge={milestone.id}
          className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-1 py-0.5 font-mono text-[9px] text-[var(--nx-text-secondary)]"
        >
          {progress.completed}/{progress.total}
        </span>
        <span
          className="text-[9px] text-[var(--nx-text-muted)]"
          data-milestone-status-text={milestone.status}
        >
          {MILESTONE_STATUS_LABEL[milestone.status]}
        </span>
      </div>
    </div>
  )
}

/** 达成率进度环（SVG dasharray，色随里程碑状态发丝令牌）。 */
function ProgressRing({
  status,
  progress,
  milestoneName,
}: {
  status: MilestoneStatus
  progress: MilestoneProgress
  milestoneName: string
}) {
  const size = 26
  const stroke = 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (progress.percent / 100) * circumference
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${milestoneName} 关联任务达成率 ${progress.percent}%（已完成 ${progress.completed}/${progress.total}）`}
      className="-rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
        style={{ stroke: `var(${milestoneRingTone(status)})` }}
      />
    </svg>
  )
}

/** 未排期里程碑徽章块。 */
function MilestoneChip({
  milestone,
  active,
  onSelect,
}: {
  milestone: Milestone
  active: boolean
  onSelect: (id: number) => void
}) {
  return (
    <button
      type="button"
      data-milestone-undated-node={milestone.id}
      data-status={milestone.status}
      onClick={() => onSelect(milestone.id)}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
        active && 'border-[var(--nx-border-focus)]',
      )}
    >
      <DiamondSwatch status={milestone.status} size={9} />
      {milestone.name}
      <span className="text-[var(--nx-text-muted)]">
        {MILESTONE_STATUS_LABEL[milestone.status]}
      </span>
    </button>
  )
}

/** 状态菱形色块（图例/徽章用）。 */
function DiamondSwatch({ status, size }: { status: MilestoneStatus; size: number }) {
  const solid = status === 'achieved' || status === 'missed'
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block rotate-45 rounded-[2px] border',
        status === 'not_started' && 'border-dashed',
      )}
      style={{
        width: size,
        height: size,
        borderColor: `var(${FLAG_FRAME[status]})`,
        backgroundColor: solid ? `var(${FLAG_FRAME[status]})` : 'transparent',
      }}
    />
  )
}

/** 点击旗帜呼出的里程碑详情（目标日期/状态/关联任务清单）。 */
function MilestoneDetailPanel({
  milestone,
  progress,
  onClose,
}: {
  milestone: Milestone
  progress: MilestoneProgress
  onClose: () => void
}) {
  const unfinished = progress.tasks.filter((task) => task.status !== 'completed')
  const finished = progress.tasks.filter((task) => task.status === 'completed')
  return (
    <section
      data-milestone-detail
      aria-label={`里程碑详情：${milestone.name}`}
      className="rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-bg)] p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] border',
              milestone.status === 'not_started' && 'border-dashed',
            )}
            style={{
              borderColor: `var(${FLAG_FRAME[milestone.status]})`,
              backgroundColor:
                milestone.status === 'achieved' || milestone.status === 'missed'
                  ? `var(${FLAG_FRAME[milestone.status]})`
                  : 'transparent',
            }}
          />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{milestone.name}</h3>
        </div>
        <button
          type="button"
          data-milestone-detail-close
          aria-label="关闭里程碑详情"
          onClick={onClose}
          className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-workspace-surface)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 text-[var(--nx-text-secondary)]"
          data-milestone-detail-status={milestone.status}
        >
          {MILESTONE_STATUS_LABEL[milestone.status]}
        </span>
        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 font-mono text-[var(--nx-text-secondary)]">
          {milestone.plannedDate ?? '未排期'}
        </span>
        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 text-[var(--nx-text-secondary)]">
          关联任务 <b className="font-mono text-[var(--nx-text-primary)]">{progress.total}</b> 个 ·
          已完成 <b className="font-mono text-[var(--nx-status-success)]">{progress.completed}</b> ·
          达成率 <b className="font-mono text-[var(--nx-text-primary)]">{progress.percent}%</b>
        </span>
      </div>
      {milestone.description ? (
        <p className="mb-3 text-xs leading-relaxed text-[var(--nx-text-muted)]">
          {milestone.description}
        </p>
      ) : null}
      {progress.tasks.length === 0 ? (
        <p className="text-xs text-[var(--nx-text-muted)]">该里程碑暂无关联任务。</p>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto pr-1" data-milestone-task-list>
          {unfinished.map((task) => (
            <MilestoneTaskRow key={task.id} task={task} unfinished />
          ))}
          {finished.map((task) => (
            <MilestoneTaskRow key={task.id} task={task} unfinished={false} />
          ))}
        </div>
      )}
    </section>
  )
}

/** 详情面板内的任务行（未完成置前，含进度条与状态文字）。 */
function MilestoneTaskRow({ task, unfinished }: { task: Task; unfinished: boolean }) {
  return (
    <div
      data-milestone-task-row={task.id}
      data-unfinished={unfinished || undefined}
      className={cn(
        'flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1.5',
        unfinished ? 'opacity-100' : 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(${TASK_DOT_TONE[task.status]})` }}
      />
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--nx-text-primary)]">
        {task.name}
      </span>
      <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
        {TASK_STATUS_LABELS[task.status]}
      </span>
      <span className="w-16 shrink-0">
        <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
          <span
            data-milestone-task-progress={task.id}
            className="rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, task.progressPercent))}%`,
              backgroundColor: `var(${TASK_DOT_TONE[task.status]})`,
            }}
          />
        </span>
      </span>
    </div>
  )
}

export default MilestoneTimelineChartLens
