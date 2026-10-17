/**
 * 新轨时间线流向镜头（v3-ui-next-remaining-lenses W4 任务 4.3 / spec「时间线流向镜头里程碑与任务流动呈现」）。
 *
 * 视觉与交互（design §5）：
 * 1. 数据：并行复用 `milestonesApi.list` 与 `tasksApi.list`（每页 100），经
 *    `buildTimelineFlowChain` 合流为日期严格升序的流向节点链表；
 * 2. 流动主轴：贯穿工作面的发丝线水平主轴 —— 今天之前的已推进区段渲染实线，
 *    今天之后的未达成区段渲染点状虚线；
 * 3. 里程碑锚点：主轴对应位置渲染 45° 旋转棱形微标，按状态着色
 *    （planned 发丝框 / at_risk 琥珀 / achieved 翠绿实心 / missed 绯红实心），
 *    锚点下方标注名称与计划达成日期；
 * 4. 阶段任务卡片：按截止日归属在两个相邻里程碑之间推进，卡片含任务名、
 *    状态信号点、负责人（AI Agent 电光天青微标）、工期与进度条；
 * 5. 今天流动指示器：按 `todayIndex` 日距插值锚定发光天青垂直指示线，
 *    工具栏「聚焦今天」平滑滚动至视口中央；
 * 6. 悬停明细：悬停 / 键盘聚焦里程碑或任务节点，浮现暗黑仪器感明细卡
 *    （状态、计划日期、说明、同阶段任务流清单）；
 * 7. 沉浸阶梯：precise 档或系统减弱动效下停用光晕与平滑滚动，纯色 1px 发丝呈现。
 *
 * 8. 点任务卡打开详情抽屉（容器同步 ?focusTask=）；聚焦任务时横向滚到该卡并高亮。
 *
 * 只读防线（RL-06）：本镜头零写操作入口、零写请求，全部交互仅驱动本地状态
 * 与只读查询参数。
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  Crosshair,
  Flag,
  Milestone as MilestoneIcon,
  RotateCw,
} from 'lucide-react'
import type { MilestoneStatus } from '@/lib/api/milestones'
import { milestonesApi, milestoneKeys } from '@/lib/api/milestones'
import { tasksApi, taskKeys } from '@/lib/api/tasks'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { cn } from '@/lib/utils'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import { resolveScrollBehavior } from '@/lib/next/motion/scroll-behavior'
import {
  buildTimelineFlowChain,
  collectStageTaskNodes,
  milestoneStatusLabel,
  milestoneToneToken,
  taskToneToken,
  todayDateKey,
  type TimelineFlowNode,
} from '@/lib/next/lenses-timeline-adapter'

/** 主轴画板几何常量（px）。 */
const FLOW_PAD_X = 176
const FLOW_STEP_PX = 280
const FLOW_CANVAS_HEIGHT = 344
const FLOW_AXIS_Y = 200
const NODE_WRAPPER_WIDTH = 240
const TASK_CARD_WIDTH = 232

/** 悬停明细卡浮层锚点：底边贴齐主轴上方 10px。 */
const HOVER_CARD_BOTTOM = FLOW_CANVAS_HEIGHT - (FLOW_AXIS_Y - 10)
/** 悬停明细卡最大高度：向上伸展至画板顶部 8px 处。 */
const HOVER_CARD_MAX_HEIGHT = FLOW_AXIS_Y - 18

const MILESTONE_PAGE_FILTER = { perPage: 100 }
const TASK_PAGE_FILTER = { perPage: 100 }

const LEGEND_ITEMS: ReadonlyArray<{ status: MilestoneStatus; label: string }> = [
  { status: 'planned', label: '计划中' },
  { status: 'at_risk', label: '有风险' },
  { status: 'achieved', label: '已达成' },
  { status: 'missed', label: '已逾期' },
]

export interface WorkspaceTimelineLensProps {
  projectId: number
  className?: string
  /** 供测试断言首屏渲染耗时与活动 DOM 节点数。 */
  onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
  /** 点任务卡：打开任务详情（容器同步 ?focusTask=）。 */
  onOpenTask?: (taskId: number) => void
  /** 聚焦任务：横向滚到该任务卡并高亮（每个任务一次）。 */
  focusTaskId?: number | null
}

/** 发丝线仪器感按钮（暗黑工作面工具栏基元）。 */
function LensToolButton({ className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded border border-[var(--nx-border-hairline)]',
        'bg-[var(--nx-workspace-surface)] px-2 text-[11px] font-medium text-[var(--nx-text-primary)]',
        'transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-space-cyan)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    />
  )
}

/** 时间线流向主轴脉冲骨架屏（防 CLS：高度贴合真实画板）。 */
function TimelineLensSkeleton({ precise }: { precise: boolean }) {
  const anchors = [8, 24, 40, 56, 72, 88]
  return (
    <div
      data-timeline-skeleton
      role="status"
      aria-label="正在加载时间线流向"
      aria-busy="true"
      className={cn('relative w-full overflow-hidden', !precise && 'animate-pulse')}
      style={{ height: FLOW_CANVAS_HEIGHT }}
    >
      {/* 主轴发丝线 */}
      <div
        aria-hidden
        className="absolute h-px bg-[var(--nx-workspace-surface)]"
        style={{ top: FLOW_AXIS_Y, left: 40, right: 40 }}
      />
      {/* 里程碑棱形锚点与下方标签 / 任务卡占位 */}
      {anchors.map((left, index) => (
        <div key={left} aria-hidden className="absolute" style={{ left: `${left}%`, top: 0 }}>
          <div
            className="h-4 w-4 rotate-45 border border-[var(--nx-border-hairline)]"
            style={{ marginTop: FLOW_AXIS_Y - 8 }}
          />
          <div className="mx-auto mt-1 h-3 w-28 rounded bg-[var(--nx-bg-1)]" />
          {index % 2 === 0 ? (
            <div
              className="mt-2 h-16 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
              style={{
                width: TASK_CARD_WIDTH,
                marginLeft: (NODE_WRAPPER_WIDTH - TASK_CARD_WIDTH) / 2,
              }}
            />
          ) : (
            <div className="mx-auto mt-2 h-2 w-20 rounded bg-[var(--nx-bg-1)]" />
          )}
        </div>
      ))}
    </div>
  )
}

/** 里程碑节点：主轴 45° 棱形锚点 + 下方名称与计划日期。 */
function MilestoneFlowItem({
  node,
  x,
  isHovered,
  isPrecise,
  stageTasks,
  onHoverChange,
}: {
  node: TimelineFlowNode
  x: number
  isHovered: boolean
  isPrecise: boolean
  stageTasks: TimelineFlowNode[]
  onHoverChange: (id: string | null) => void
}) {
  const tone = milestoneToneToken(node.status)
  const label = milestoneStatusLabel(node.status)
  const filled = node.status === 'achieved' || node.status === 'missed'
  const clearHover = useCallback(() => onHoverChange(null), [onHoverChange])

  return (
    <div
      data-timeline-element
      data-timeline-milestone
      data-timeline-node-type="milestone"
      data-timeline-node-date={node.date}
      data-timeline-node-id={node.id}
      tabIndex={0}
      role="button"
      aria-label={`里程碑 ${node.name}，${label}，计划日期 ${node.date}`}
      className="absolute top-0 h-full cursor-default outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
      style={{ left: x - NODE_WRAPPER_WIDTH / 2, width: NODE_WRAPPER_WIDTH }}
      onMouseEnter={() => onHoverChange(node.id)}
      onMouseLeave={clearHover}
      onFocus={() => onHoverChange(node.id)}
      onBlur={clearHover}
    >
      {/* 45° 旋转棱形锚点（状态信号色） */}
      <span
        data-timeline-diamond
        aria-hidden
        className={cn(
          'absolute left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border',
          !filled && 'border-[1.5px] bg-[var(--nx-workspace-bg)]',
        )}
        style={{
          top: FLOW_AXIS_Y - 8,
          borderColor: `var(${tone})`,
          ...(filled ? { backgroundColor: `var(${tone})` } : {}),
        }}
      />
      {/* 锚点下方：名称 + 计划达成日期 */}
      <div
        className="absolute left-1/2 w-fit max-w-[224px] -translate-x-1/2 rounded-sm bg-[var(--nx-workspace-bg)] px-1.5 text-center"
        style={{ top: FLOW_AXIS_Y + 14 }}
      >
        <p
          data-timeline-milestone-name
          title={node.name}
          className="truncate text-xs font-medium text-[var(--nx-text-primary)]"
        >
          {node.name}
        </p>
        <p
          data-timeline-milestone-date
          className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
        >
          {node.date}
        </p>
      </div>
      {isHovered ? (
        <MilestoneHoverCard node={node} stageTasks={stageTasks} isPrecise={isPrecise} />
      ) : null}
    </div>
  )
}

/** 任务节点：附着于主轴的紧凑阶段任务推进卡片。 */
function TaskFlowItem({
  node,
  x,
  isHovered,
  isPrecise,
  isFocused,
  onHoverChange,
  onOpenTask,
}: {
  node: TimelineFlowNode
  x: number
  isHovered: boolean
  isPrecise: boolean
  isFocused: boolean
  onHoverChange: (id: string | null) => void
  onOpenTask?: (taskId: number) => void
}) {
  const statusTone = taskToneToken(node.status)
  const dotTone = node.isOverdue ? '--nx-status-danger' : statusTone
  const barTone = node.isOverdue
    ? '--nx-status-danger'
    : node.isAchievedOrCompleted
      ? '--nx-status-success'
      : statusTone
  const progress = Math.max(0, Math.min(100, Math.round(node.progress ?? 0)))
  const clearHover = useCallback(() => onHoverChange(null), [onHoverChange])
  const taskId = node.rawTask?.id
  const open = taskId !== undefined && onOpenTask ? () => onOpenTask(taskId) : undefined

  return (
    <div
      data-timeline-element
      data-timeline-task-card
      data-focused={isFocused ? 'true' : undefined}
      data-timeline-node-type="task"
      data-timeline-node-date={node.date}
      data-timeline-node-id={node.id}
      data-task-id={node.rawTask?.id}
      data-timeline-task-status={node.status}
      data-task-overdue={node.isOverdue ? 'true' : undefined}
      className="absolute top-0 h-full"
      style={{ left: x - NODE_WRAPPER_WIDTH / 2, width: NODE_WRAPPER_WIDTH }}
      onMouseEnter={() => onHoverChange(node.id)}
      onMouseLeave={clearHover}
    >
      <div
        data-timeline-task-open={open ? 'true' : undefined}
        role={open ? 'button' : undefined}
        tabIndex={open ? 0 : undefined}
        aria-label={open ? `打开任务详情：${node.name}` : undefined}
        onClick={open}
        onFocus={() => onHoverChange(node.id)}
        onBlur={clearHover}
        onKeyDown={(event) => {
          if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            open()
          }
        }}
        className={cn(
          'absolute left-1/2 -translate-x-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2',
          node.isOverdue && 'border-[var(--nx-status-danger)]',
          open &&
            'cursor-pointer transition-colors hover:border-[var(--nx-space-cyan)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]',
          isFocused && 'border-[var(--nx-space-cyan)] ring-1 ring-[var(--nx-space-cyan)]',
        )}
        style={{ top: FLOW_AXIS_Y + 12, width: TASK_CARD_WIDTH }}
      >
        {/* 行 1：状态信号点 + 任务名 + Agent 微标 */}
        <div className="flex h-4 items-center gap-1.5">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: `var(${dotTone})` }}
          />
          <span
            data-timeline-task-name
            title={node.name}
            className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]"
          >
            {node.name}
          </span>
          {node.isAgent ? (
            <span
              data-timeline-agent-badge
              aria-label="AI 负责人"
              title="AI 负责人"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-[var(--nx-space-cyan)] px-0.5 text-[9px] font-medium leading-3 text-[var(--nx-space-cyan)]"
            >
              <Bot className="h-2.5 w-2.5" aria-hidden />
              AI
            </span>
          ) : null}
        </div>
        {/* 行 2：负责人微标 + 工期 */}
        <div className="mt-1 flex h-4 items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
          {node.assigneeName ? (
            <>
              <span
                aria-hidden
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full text-[8px] font-semibold',
                  'ring-1 ring-[var(--nx-border-hairline)]',
                  node.isAgent
                    ? 'bg-[var(--nx-space-cyan)]/15 text-[var(--nx-space-cyan)]'
                    : 'bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                )}
              >
                {assigneeInitialsOf(node)}
              </span>
              <span className="min-w-0 flex-1 truncate">{node.assigneeName}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[var(--nx-text-muted)]">未分配</span>
          )}
          {node.durationDays != null ? (
            <span
              data-timeline-task-duration
              title={`工期 ${node.durationDays} 天`}
              className="shrink-0 font-mono text-[var(--nx-text-secondary)]"
            >
              {node.durationDays}天
            </span>
          ) : null}
        </div>
        {/* 行 3：紧凑进度条 + 百分比 */}
        <div className="mt-1 flex h-3 items-center gap-1.5">
          <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${progress}%`, backgroundColor: `var(${barTone})` }}
            />
          </div>
          <span
            data-timeline-task-progress
            className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {progress}%
          </span>
        </div>
      </div>
      {isHovered ? <TaskHoverCard node={node} isPrecise={isPrecise} /> : null}
    </div>
  )
}

/** 悬停/聚焦明细：里程碑状态、计划日期、验收说明与同阶段任务流。 */
function MilestoneHoverCard({
  node,
  stageTasks,
  isPrecise,
}: {
  node: TimelineFlowNode
  stageTasks: TimelineFlowNode[]
  isPrecise: boolean
}) {
  const tone = milestoneToneToken(node.status)
  const label = milestoneStatusLabel(node.status)
  const milestone = node.rawMilestone
  return (
    <div
      data-timeline-hover-card
      data-hover-kind="milestone"
      className={cn(
        'pointer-events-none absolute left-1/2 z-30 w-60 -translate-x-1/2 overflow-y-auto',
        'rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] p-2.5 text-left',
        !isPrecise && 'shadow-lg shadow-black/40',
      )}
      style={{ bottom: HOVER_CARD_BOTTOM, maxHeight: HOVER_CARD_MAX_HEIGHT }}
    >
      <p className="truncate text-xs font-semibold text-[var(--nx-text-primary)]">{node.name}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
          data-timeline-hover-status
          className="rounded-sm border px-1.5 py-px text-[9px] font-medium"
          style={{ color: `var(${tone})`, borderColor: `var(${tone})` }}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">{node.date}</span>
      </div>
      {milestone?.description ? (
        <p className="mt-1.5 line-clamp-4 text-[10px] leading-4 text-[var(--nx-text-secondary)]">
          {milestone.description}
        </p>
      ) : null}
      <div className="mt-1.5 border-t border-[var(--nx-border-hairline)] pt-1.5">
        <p className="text-[10px] font-medium text-[var(--nx-text-secondary)]">
          阶段任务流 · {stageTasks.length} 项
        </p>
        {stageTasks.length === 0 ? (
          <p className="mt-1 text-[10px] text-[var(--nx-text-muted)]">该里程碑后暂无排期任务</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {stageTasks.slice(0, 3).map((stageNode) => (
              <li
                key={stageNode.id}
                data-timeline-stage-task
                className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-secondary)]"
              >
                <span
                  aria-hidden
                  className="h-1 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(${taskToneToken(stageNode.status)})` }}
                />
                <span className="min-w-0 flex-1 truncate">{stageNode.name}</span>
                {stageNode.progress != null ? (
                  <span className="shrink-0 font-mono text-[var(--nx-text-muted)]">
                    {Math.round(stageNode.progress)}%
                  </span>
                ) : null}
              </li>
            ))}
            {stageTasks.length > 3 ? (
              <li className="text-[10px] text-[var(--nx-text-muted)]">
                另有 {stageTasks.length - 3} 项……
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  )
}

/** 悬停/聚焦明细：任务状态、排期、负责人与备注。 */
function TaskHoverCard({ node, isPrecise }: { node: TimelineFlowNode; isPrecise: boolean }) {
  const task = node.rawTask
  const statusTone = taskToneToken(node.status)
  const statusLabel =
    TASK_STATUS_LABELS[node.status as keyof typeof TASK_STATUS_LABELS] ?? node.status
  const rangeText =
    task?.startDate && task?.endDate ? `${task.startDate} ~ ${task.endDate}` : node.date
  return (
    <div
      data-timeline-hover-card
      data-hover-kind="task"
      className={cn(
        'pointer-events-none absolute left-1/2 z-30 w-60 -translate-x-1/2 overflow-y-auto',
        'rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] p-2.5 text-left',
        !isPrecise && 'shadow-lg shadow-black/40',
      )}
      style={{ bottom: HOVER_CARD_BOTTOM, maxHeight: HOVER_CARD_MAX_HEIGHT }}
    >
      <p className="truncate text-xs font-semibold text-[var(--nx-text-primary)]">{node.name}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
          data-timeline-hover-status
          className="rounded-sm border px-1.5 py-px text-[9px] font-medium"
          style={{ color: `var(${statusTone})`, borderColor: `var(${statusTone})` }}
        >
          {statusLabel}
        </span>
        {node.isOverdue ? (
          <span className="text-[10px] font-medium text-[var(--nx-status-danger)]">已逾期</span>
        ) : null}
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-[var(--nx-text-secondary)]">
        排期 {rangeText}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--nx-text-secondary)]">
        <span className="text-[var(--nx-text-muted)]">负责人</span>
        {node.assigneeName ? (
          <>
            <span>{node.assigneeName}</span>
            {node.isAgent ? (
              <span className="text-[var(--nx-space-cyan)]">（AI Agent）</span>
            ) : null}
          </>
        ) : (
          <span className="text-[var(--nx-text-muted)]">未分配</span>
        )}
      </p>
      {task?.description ? (
        <p className="mt-1.5 line-clamp-4 text-[10px] leading-4 text-[var(--nx-text-secondary)]">
          {task.description}
        </p>
      ) : null}
    </div>
  )
}

/** 负责人微标缩写：优先服务端 initials，中文姓名取末两字，英文取单词首字母。 */
function assigneeInitialsOf(node: TimelineFlowNode): string {
  if (node.isAgent) return node.rawTask?.agentAssignee?.initials || 'AI'
  const human = node.rawTask?.assignee
  if (human?.initials) return human.initials
  const name = node.assigneeName?.trim()
  if (!name) return '?'
  if (/[\u4e00-\u9fa5]/.test(name)) return name.slice(-2)
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
  return (initials || name.slice(0, 2)).toUpperCase()
}

/**
 * 时间线流向镜头（项目空间六镜头之一，只读结构视窗）。
 */
export function WorkspaceTimelineLens({
  projectId,
  className,
  onRenderComplete,
  onOpenTask,
  focusTaskId = null,
}: WorkspaceTimelineLensProps) {
  const mobile = useMobileWorkspace()
  const tier = useImmersionTier()
  const isPreciseMode = tier === 'precise'
  const reducedMotion = useMotionPreference()

  // 1. 双源并行取数（GET 只读，RL-06）
  const milestoneQuery = useQuery({
    queryKey: milestoneKeys.list(projectId, MILESTONE_PAGE_FILTER),
    queryFn: () => milestonesApi.list(projectId, MILESTONE_PAGE_FILTER),
  })
  const taskQuery = useQuery({
    queryKey: taskKeys.list(projectId, TASK_PAGE_FILTER),
    queryFn: () => tasksApi.list(projectId, TASK_PAGE_FILTER),
  })

  // 2. 纯函数合流（里程碑 + 阶段任务 → 升序流向链表）
  const milestoneList = milestoneQuery.data?.data
  const taskList = taskQuery.data?.data
  const flow = useMemo(() => {
    if (!milestoneList || !taskList) return null
    return buildTimelineFlowChain(milestoneList, taskList)
  }, [milestoneList, taskList])

  // 3. 悬停明细状态（本地内存，零副作用）
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const chainIndexById = useMemo(() => {
    const map = new Map<string, number>()
    flow?.chain.forEach((node, index) => map.set(node.id, index))
    return map
  }, [flow])
  const hoveredIndex = hoveredNodeId != null ? (chainIndexById.get(hoveredNodeId) ?? -1) : -1
  const hoveredNode =
    hoveredIndex >= 0 && flow ? (flow.chain[hoveredIndex] ?? undefined) : undefined
  const stageTasks =
    hoveredNode?.type === 'milestone' && flow ? collectStageTaskNodes(flow.chain, hoveredIndex) : []
  const handleHoverChange = useCallback((id: string | null) => setHoveredNodeId(id), [])

  // 4. 状态分支
  const isPending = milestoneQuery.isPending || taskQuery.isPending
  const isError = milestoneQuery.isError || taskQuery.isError
  const errorMessage =
    (milestoneQuery.error instanceof Error ? milestoneQuery.error.message : undefined) ??
    (taskQuery.error instanceof Error ? taskQuery.error.message : undefined)
  const retryLoad = useCallback(() => {
    void milestoneQuery.refetch()
    void taskQuery.refetch()
  }, [milestoneQuery, taskQuery])

  // 5. 几何与计数
  const todayKey = useMemo(() => todayDateKey(), [])
  const chain = flow?.chain ?? []
  const milestoneCount = useMemo(() => chain.filter((n) => n.type === 'milestone').length, [chain])
  const taskCount = chain.length - milestoneCount
  const contentWidth = FLOW_PAD_X * 2 + Math.max(0, chain.length - 1) * FLOW_STEP_PX
  const todayX = flow ? FLOW_PAD_X + flow.todayIndex * FLOW_STEP_PX : FLOW_PAD_X

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const todayMarkerRef = useRef<HTMLDivElement | null>(null)

  // 6. 「聚焦今天」：平滑滚动至今天流动指示线所在视口中央（系统减弱动效或 precise 档瞬时定位）
  const focusToday = useCallback(() => {
    const marker = todayMarkerRef.current
    if (!marker || typeof marker.scrollIntoView !== 'function') return
    marker.scrollIntoView({
      behavior: resolveScrollBehavior(reducedMotion || isPreciseMode),
      block: 'nearest',
      inline: 'center',
    })
  }, [reducedMotion, isPreciseMode])

  // 6b. 聚焦任务：横向滚到该任务卡（每个任务一次）
  const focusedNodeId = useMemo(
    () =>
      focusTaskId
        ? (flow?.chain.find((node) => node.type === 'task' && node.rawTask?.id === focusTaskId)
            ?.id ?? null)
        : null,
    [flow, focusTaskId],
  )
  const scrolledFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTaskId || !focusedNodeId || scrolledFocusRef.current === focusTaskId) return
    const card = viewportRef.current?.querySelector<HTMLElement>(
      `[data-timeline-task-card][data-task-id="${focusTaskId}"]`,
    )
    if (!card) return
    scrolledFocusRef.current = focusTaskId
    if (typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({
        behavior: resolveScrollBehavior(reducedMotion || isPreciseMode),
        block: 'nearest',
        inline: 'center',
      })
    }
  }, [focusTaskId, focusedNodeId, reducedMotion, isPreciseMode])

  // 7. 首屏渲染完成度量（每挂载最多上报一次）
  const mountAtRef = useRef(performance.now())
  const reportedRef = useRef(false)
  useEffect(() => {
    if (!flow || isPending || isError || !onRenderComplete || reportedRef.current) return
    reportedRef.current = true
    const activeElements = viewportRef.current
      ? viewportRef.current.querySelectorAll('[data-timeline-element]').length
      : 0
    onRenderComplete({
      durationMs: performance.now() - mountAtRef.current,
      activeElements,
    })
  }, [flow, isPending, isError, onRenderComplete])

  // 8. 空态文案：里程碑缺失 vs 已建里程碑但未设定计划日期
  const hasAnyMilestone = (milestoneQuery.data?.data.length ?? 0) > 0
  const flowVisible = !isPending && !isError && flow && flow.totalNodes > 0 && milestoneCount > 0
  const emptyTitle = hasAnyMilestone ? '暂无流向节点' : '尚未建立里程碑'
  const emptyDescription = hasAnyMilestone
    ? '已建立的里程碑尚未设定计划日期。为里程碑设定计划日期后，时间线将自动沿主轴串联阶段任务，呈现项目推进流向。'
    : '创建里程碑并设定计划日期后，时间线将自动沿主轴串联各阶段关键任务，呈现从开工到交付的推进节奏。'

  if (mobile && flow)
    return (
      <div data-timeline-lens data-mobile-timeline className="space-y-3 py-4">
        <h3 className="text-base font-medium">项目时间线 · {chain.length} 个节点</h3>
        <ol className="space-y-4 border-l-2 border-[var(--nx-border-hairline)] pl-4">
          {chain.map((node) => (
            <li
              key={node.id}
              className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
            >
              <p className="text-sm text-[var(--nx-accent)]">
                {node.date} · {node.type === 'milestone' ? '里程碑' : '任务'}
              </p>
              <button
                type="button"
                disabled={node.type !== 'task' || !node.rawTask || !onOpenTask}
                onClick={() => node.rawTask && onOpenTask?.(node.rawTask.id)}
                className="min-h-11 w-full break-words text-left text-base font-medium"
              >
                {node.name}
              </button>
              <p className="text-sm text-[var(--nx-text-secondary)]">
                {node.type === 'milestone'
                  ? milestoneStatusLabel(node.status as MilestoneStatus)
                  : TASK_STATUS_LABELS[node.status as keyof typeof TASK_STATUS_LABELS]}
                {node.assigneeName ? ` · ${node.assigneeName}` : ''}
              </p>
              {node.rawTask?.description ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--nx-text-muted)]">
                  {node.rawTask.description}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {chain.length === 0 ? <p role="status">暂无已排期的任务或里程碑</p> : null}
      </div>
    )
  return (
    <div
      data-timeline-lens
      className={cn(
        'relative flex h-full min-h-[520px] flex-col overflow-hidden rounded-lg',
        'border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] text-[var(--nx-text-primary)]',
        className,
      )}
    >
      {/* ── 顶部工具栏 ─────────────────────────────────────────── */}
      <header
        data-timeline-toolbar
        className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--nx-border-hairline)] px-3"
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide">
          <MilestoneIcon className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
          时间线流向
        </div>
        {flow && flowVisible ? (
          <div
            data-timeline-summary
            className="hidden items-center gap-2 text-[11px] text-[var(--nx-text-muted)] sm:flex"
          >
            <span>
              里程碑{' '}
              <span
                data-timeline-count-milestones
                className="font-mono text-[var(--nx-space-cyan)]"
              >
                {milestoneCount}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              任务{' '}
              <span data-timeline-count-tasks className="font-mono text-[var(--nx-text-secondary)]">
                {taskCount}
              </span>
            </span>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {flowVisible ? (
            <span className="hidden font-mono text-[10px] text-[var(--nx-text-muted)] lg:inline">
              今天 {todayKey}
            </span>
          ) : null}
          <LensToolButton data-timeline-focus-today onClick={focusToday} disabled={!flowVisible}>
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            聚焦今天
          </LensToolButton>
        </div>
      </header>

      {/* ── 工作面主体 ─────────────────────────────────────────── */}
      <div
        ref={viewportRef}
        data-timeline-viewport
        role="region"
        aria-label="时间线流向主轴区域"
        className="relative flex-1 overflow-x-auto overflow-y-hidden"
      >
        {isPending ? (
          <div className="flex h-full min-h-[344px] w-full items-center">
            <TimelineLensSkeleton precise={isPreciseMode} />
          </div>
        ) : null}

        {!isPending && isError ? (
          <div
            data-timeline-error
            role="alert"
            className="flex h-full min-h-[344px] w-full items-center justify-center"
          >
            <div className="flex max-w-md flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-8 text-center">
              <AlertTriangle className="h-7 w-7 text-[var(--nx-status-danger)]" aria-hidden />
              <p className="text-sm font-medium text-[var(--nx-status-danger)]">
                时间线数据加载失败
              </p>
              <p className="text-xs text-[var(--nx-text-muted)]">
                {errorMessage ?? '请稍后重试或检查网络连接'}
              </p>
              <LensToolButton
                data-timeline-retry
                onClick={retryLoad}
                className="mt-2 h-7 border-[var(--nx-border-focus)] px-3 text-[var(--nx-space-cyan)]"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
                重新载入
              </LensToolButton>
            </div>
          </div>
        ) : null}

        {!isPending && !isError && flow && !flowVisible ? (
          <div
            data-timeline-empty
            role="status"
            className="flex h-full min-h-[344px] w-full items-center justify-center"
          >
            <div className="flex max-w-sm flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-10 text-center">
              {hasAnyMilestone ? (
                <Flag className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
              ) : (
                <MilestoneIcon className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
              )}
              <p className="text-sm font-medium text-[var(--nx-text-primary)]">{emptyTitle}</p>
              <p className="text-xs leading-5 text-[var(--nx-text-muted)]">{emptyDescription}</p>
            </div>
          </div>
        ) : null}

        {/* ── 时间流向主轴画板（数据就绪、存在里程碑且有流向节点时） ── */}
        {flowVisible ? (
          <div className="flex h-full min-h-[344px] items-center">
            <div
              data-timeline-canvas
              className="relative shrink-0"
              style={{ width: contentWidth, height: FLOW_CANVAS_HEIGHT }}
            >
              {/* 主轴：未达成区段点状虚线（底），已推进区段实线覆盖 */}
              <div
                aria-hidden
                className="pointer-events-none absolute h-0 border-t border-dashed border-[var(--nx-border-hairline)]"
                style={{ top: FLOW_AXIS_Y - 1, left: FLOW_PAD_X, right: FLOW_PAD_X }}
              />
              {todayX > FLOW_PAD_X ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute h-0 border-t border-solid border-[var(--nx-text-secondary)]/40"
                  style={{ top: FLOW_AXIS_Y - 1, left: FLOW_PAD_X, width: todayX - FLOW_PAD_X }}
                />
              ) : null}
              {/* 今天流动指示器：发光天青垂直指示线 + 「今天」标签 */}
              <div
                ref={todayMarkerRef}
                data-timeline-element
                data-timeline-today-marker
                role="img"
                aria-label="今天流动指示线"
                className="pointer-events-none absolute -translate-x-1/2"
                style={{ left: todayX, top: 0, height: FLOW_CANVAS_HEIGHT }}
              >
                <span
                  aria-hidden
                  className="absolute left-0 top-1 w-max -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--nx-space-cyan)] bg-[var(--nx-workspace-bg)] px-2 py-px text-[10px] font-medium text-[var(--nx-space-cyan)]"
                  style={
                    isPreciseMode
                      ? undefined
                      : {
                          boxShadow:
                            '0 0 12px color-mix(in srgb, var(--nx-space-cyan) 35%, transparent)',
                        }
                  }
                >
                  今天
                </span>
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-px"
                  style={{
                    backgroundColor: 'var(--nx-space-cyan)',
                    ...(isPreciseMode
                      ? {}
                      : {
                          boxShadow:
                            '0 0 8px color-mix(in srgb, var(--nx-space-cyan) 50%, transparent)',
                        }),
                  }}
                />
              </div>
              {/* 流向节点序列 */}
              {chain.map((node, index) => {
                const x = FLOW_PAD_X + index * FLOW_STEP_PX
                const isHovered = node.id === hoveredNodeId
                if (node.type === 'milestone') {
                  return (
                    <MilestoneFlowItem
                      key={node.id}
                      node={node}
                      x={x}
                      isHovered={isHovered}
                      isPrecise={isPreciseMode}
                      stageTasks={isHovered ? stageTasks : []}
                      onHoverChange={handleHoverChange}
                    />
                  )
                }
                return (
                  <TaskFlowItem
                    key={node.id}
                    node={node}
                    x={x}
                    isHovered={isHovered}
                    isPrecise={isPreciseMode}
                    isFocused={node.id === focusedNodeId}
                    onHoverChange={handleHoverChange}
                    onOpenTask={onOpenTask}
                  />
                )
              })}
              {/* 底部图例：里程碑状态信号色 */}
              <div
                data-timeline-legend
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-center gap-4 text-[10px] text-[var(--nx-text-muted)]"
              >
                {LEGEND_ITEMS.map((item) => {
                  const tone = milestoneToneToken(item.status)
                  const filled = item.status === 'achieved' || item.status === 'missed'
                  return (
                    <span key={item.status} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 rotate-45 border"
                        style={{
                          borderColor: `var(${tone})`,
                          backgroundColor: filled ? `var(${tone})` : 'transparent',
                        }}
                      />
                      {item.label}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 镜头别名（design 四镜头统一可别名导出）。 */
export const TimelineLens = WorkspaceTimelineLens

export default WorkspaceTimelineLens
