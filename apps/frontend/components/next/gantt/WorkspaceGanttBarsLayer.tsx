/**
 * 新轨甘特镜头（v3-ui-next-gantt-lens W1 tasks 1.5）—— Layer 3 任务条与里程碑图层。
 *
 * 暗黑仪器感确定性 SVG 图元：任务条矩形（`--nx-workspace-surface` 底 + 状态发丝线
 * 高对比边框 + 状态色进度填充 + 5 级优先级微标竖条 + 任务名/负责人缩写）；摘要条
 * 为压暗的浅色条；里程碑以 45° 旋转 `<polygon>` 菱形锚定计划日期，并标注名称。
 * 双向视口裁剪（纵向行窗口 + 横向天窗口）保证常驻图元 ≤ 200；悬停/选中状态
 * 通过 `onTaskHover` / `onTaskSelect` 上报（store 由外层编排，本层纯展示）。
 */

'use client'

import { memo } from 'react'
import {
  NEXT_MILESTONE_LABEL,
  NEXT_MILESTONE_TOKEN,
  NEXT_PRIORITY_LABEL,
  NEXT_PRIORITY_TOKEN,
  NEXT_STATUS_HAIRLINE_TOKEN,
  NEXT_STATUS_LABEL,
  nxDayToX,
  nxRowCenterY,
  nxRowTop,
  selectVisibleBars,
  selectVisibleMilestones,
  type DayRange,
  type NextGanttModel,
  type NextGanttScale,
  type NextGanttRenderTask,
} from '@/lib/gantt/next-gantt-adapter'
import type { RowRange } from '@/lib/gantt/next-gantt-adapter'
import type { GanttRenderTask } from '@/lib/gantt/types'
import type { GanttDragHandleProps, GanttDragGhost } from '@/hooks/use-gantt-drag-interaction'

export interface WorkspaceGanttBarsLayerProps {
  model: NextGanttModel
  scale: NextGanttScale
  rowIndex: Map<number, number>
  visibleRows: RowRange
  visibleDays: DayRange
  hoveredTaskId?: number | null
  selectedTaskId?: number | null
  onTaskHover?: (taskId: number | null) => void
  onTaskSelect?: (taskId: number | null) => void
  /** 双击任务条打开详情（真实里程碑 id < 0 不响应）。 */
  onTaskOpen?: (taskId: number) => void
  /** 拖拽手柄与幽灵条（W2/W4 拖拽集成）。 */
  getMoveHandleProps?: (task: GanttRenderTask) => GanttDragHandleProps
  getResizeHandleProps?: (task: GanttRenderTask) => GanttDragHandleProps
  getMilestoneHandleProps?: (task: GanttRenderTask) => GanttDragHandleProps
  ghost?: GanttDragGhost | null
  /** 今天的天偏移：进行中任务的实际执行细条画到今天。 */
  todayDay?: number
  /** 「关键路径」开启时驱动链上的任务 id：条边描青色加粗。 */
  chainTaskIds?: ReadonlySet<number>
}

/** 任务条在行内的纵向内缩（px）：上下留出发丝间隙。 */
const BAR_Y_INSET = 4

/** 名称文字渲染进条内的最小条宽（px）。 */
const NAME_INSIDE_MIN_WIDTH = 72

/** 优先级微标渲染的最小条宽（px）。 */
const PRIORITY_STRIP_MIN_WIDTH = 24

interface BarLayout {
  x: number
  y: number
  width: number
  height: number
}

function barLayout(scale: NextGanttScale, task: GanttRenderTask, rowIndex: number): BarLayout {
  const x = nxDayToX(scale, task.startDay)
  // 宽度与旧轨 `durationToWidth` 保持一致（duration×pxPerDay），
  // 使依赖连线锚点（buildDepEndpoints）与渲染条缘精确对齐。
  const width = Math.max(3, task.durationDays * scale.pxPerDay)
  const height = Math.max(12, scale.rowHeight - BAR_Y_INSET * 2)
  return { x, y: nxRowTop(scale, rowIndex) + BAR_Y_INSET, width, height }
}

function TaskBar({
  task,
  layout,
  scale,
  todayDay,
  hovered,
  selected,
  onChain,
  onHover,
  onSelect,
  onOpen,
  moveHandleProps,
  resizeHandleProps,
}: {
  task: NextGanttRenderTask
  onChain?: boolean
  layout: BarLayout
  scale: NextGanttScale
  todayDay?: number
  hovered: boolean
  selected: boolean
  onHover?: (taskId: number | null) => void
  onSelect?: (taskId: number | null) => void
  onOpen?: (taskId: number) => void
  moveHandleProps?: GanttDragHandleProps
  resizeHandleProps?: GanttDragHandleProps
}) {
  const stroke =
    hovered || selected
      ? selected
        ? 'var(--nx-workspace-blue)'
        : 'var(--nx-space-cyan)'
      : onChain
        ? 'var(--nx-space-cyan)'
        : `var(${NEXT_STATUS_HAIRLINE_TOKEN[task.status]})`
  const strokeWidth = hovered || selected || onChain ? 1.5 : 1
  const isSummary = task.kind === 'summary'
  const strokeToken = NEXT_STATUS_HAIRLINE_TOKEN[task.status]
  const fill = isSummary ? 'var(--nx-bg-1)' : 'var(--nx-workspace-surface)'
  const progressWidth = Math.max(2, (layout.width - 2) * task.progress)
  const nameInside = layout.width >= NAME_INSIDE_MIN_WIDTH
  const showPriorityStrip = !isSummary && layout.width >= PRIORITY_STRIP_MIN_WIDTH
  const nameText = `${task.name}${task.assignee?.initials ? ` · ${task.assignee.initials}` : ''}`
  // 文字基线：条纵向中心 +4px。
  const nameY = layout.y + layout.height / 2 + 4

  const isMoveActive = moveHandleProps && !moveHandleProps.disabled
  const isResizeActive = resizeHandleProps && !resizeHandleProps.disabled
  const { disabled: _mDisabled, ...movePointerHandlers } = moveHandleProps ?? {}
  const { disabled: _rDisabled, ...resizePointerHandlers } = resizeHandleProps ?? {}

  return (
    <g
      data-gantt-bar-group
      data-task-id={task.id}
      data-gantt-critical={onChain || undefined}
      data-handle-disabled={
        moveHandleProps ? (moveHandleProps.disabled ? 'true' : 'false') : undefined
      }
      style={{ cursor: isMoveActive ? 'grab' : 'default' }}
      onMouseEnter={() => onHover?.(task.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(task.id)}
      onDoubleClick={task.id > 0 && onOpen ? () => onOpen(task.id) : undefined}
      {...movePointerHandlers}
    >
      <rect
        x={layout.x}
        y={layout.y}
        width={layout.width}
        height={layout.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        rx={1}
        data-gantt-element
        data-gantt-bar
        aria-label={`${task.name}（${NEXT_STATUS_LABEL[task.status]}）`}
      >
        <title>{`${task.name} · ${NEXT_STATUS_LABEL[task.status]} · 优先级${NEXT_PRIORITY_LABEL[task.priority]}`}</title>
      </rect>
      {!isSummary && task.progress > 0 ? (
        <rect
          x={layout.x + 1}
          y={layout.y + 1}
          width={Math.min(layout.width - 2, progressWidth)}
          height={layout.height - 2}
          fill={`var(${strokeToken})`}
          opacity={0.9}
          data-gantt-bar-progress
        />
      ) : null}
      {task.actualStartDay !== undefined ? (
        // 实际执行细条：实际开工 → 实际完工（进行中则到今天），画在计划条正下方，
        // 与计划条错位即可看出提前 / 延后开工
        <rect
          data-gantt-actual-bar
          x={nxDayToX(scale, task.actualStartDay)}
          y={layout.y + layout.height + 1}
          width={Math.max(
            2,
            ((task.actualEndDay ?? Math.max(task.actualStartDay, todayDay ?? task.actualStartDay)) -
              task.actualStartDay +
              1) *
              scale.pxPerDay,
          )}
          height={2}
          rx={1}
          fill={task.status === 'completed' ? 'var(--nx-status-success)' : 'var(--nx-space-cyan)'}
        >
          <title>
            {task.actualEndDay !== undefined ? '实际执行（已完工）' : '实际执行（进行中，至今天）'}
          </title>
        </rect>
      ) : null}
      {showPriorityStrip ? (
        <rect
          x={layout.x + 1}
          y={layout.y + 1}
          width={3}
          height={layout.height - 2}
          fill={`var(${NEXT_PRIORITY_TOKEN[task.priority]})`}
          data-gantt-priority-badge
        />
      ) : null}
      {nameInside ? (
        <text
          x={layout.x + 8}
          y={nameY}
          fontSize={11}
          fill="var(--nx-text-primary)"
          data-gantt-bar-name
        >
          {nameText}
        </text>
      ) : (
        <text
          x={layout.x + layout.width + 6}
          y={nameY}
          fontSize={10}
          fill="var(--nx-text-secondary)"
          data-gantt-bar-name
        >
          {nameText}
        </text>
      )}
      {isResizeActive ? (
        <rect
          data-gantt-resize-handle
          data-task-id={task.id}
          x={layout.x + layout.width - 6}
          y={layout.y}
          width={6}
          height={layout.height}
          fill="transparent"
          style={{ cursor: 'ew-resize' }}
          {...resizePointerHandlers}
        />
      ) : null}
    </g>
  )
}

function diamondPoints(size: number): string {
  // 45° 旋转方形的顶点（叠加 rotate(45) 后为仪表感菱形）。
  return `${-size},${-size} ${size},${-size} ${size},${size} ${-size},${size}`
}

export const WorkspaceGanttBarsLayer = memo(function WorkspaceGanttBarsLayer({
  model,
  scale,
  rowIndex,
  visibleRows,
  visibleDays,
  hoveredTaskId,
  selectedTaskId,
  onTaskHover,
  onTaskSelect,
  onTaskOpen,
  getMoveHandleProps,
  getResizeHandleProps,
  getMilestoneHandleProps,
  ghost,
  todayDay,
  chainTaskIds,
}: WorkspaceGanttBarsLayerProps) {
  const bars = selectVisibleBars(model.tasks, visibleRows, visibleDays)
  const milestones = selectVisibleMilestones(model, rowIndex, visibleRows, visibleDays)

  return (
    <g data-gantt-bars-layer>
      {bars.map((task) => {
        const ri = rowIndex.get(task.id)
        if (ri === undefined) return null
        return (
          <TaskBar
            key={task.id}
            task={task as NextGanttRenderTask}
            layout={barLayout(scale, task, ri)}
            scale={scale}
            todayDay={todayDay}
            hovered={hoveredTaskId === task.id}
            selected={selectedTaskId === task.id}
            onChain={chainTaskIds?.has(task.id) === true}
            onHover={onTaskHover}
            onSelect={onTaskSelect}
            onOpen={onTaskOpen}
            moveHandleProps={getMoveHandleProps?.(task)}
            resizeHandleProps={getResizeHandleProps?.(task)}
          />
        )
      })}
      {milestones.map(({ mark, rowIndex: ri }) => {
        const x = nxDayToX(scale, mark.day)
        const y = nxRowCenterY(scale, ri)
        const milestoneTask = model.tasks.find((t) => t.id === mark.taskId)
        const milestoneProps = milestoneTask ? getMilestoneHandleProps?.(milestoneTask) : undefined
        const isMilestoneActive = milestoneProps && !milestoneProps.disabled
        const { disabled: _msDisabled, ...msPointerHandlers } = milestoneProps ?? {}
        return (
          <g
            key={mark.id}
            data-gantt-element
            data-gantt-milestone
            data-milestone-id={mark.id}
            data-milestone-task-id={mark.taskId}
            data-handle-disabled={
              milestoneProps ? (milestoneProps.disabled ? 'true' : 'false') : undefined
            }
            style={{ cursor: isMilestoneActive ? 'grab' : 'default' }}
            onMouseEnter={() => onTaskHover?.(mark.taskId)}
            onMouseLeave={() => onTaskHover?.(null)}
            onClick={() => onTaskSelect?.(mark.taskId)}
            {...msPointerHandlers}
          >
            <polygon
              points={diamondPoints(5)}
              transform={`rotate(45 ${x} ${y})`}
              fill={`var(${NEXT_MILESTONE_TOKEN[mark.status]})`}
              stroke="var(--nx-workspace-bg)"
              strokeWidth={1}
            >
              <title>{`里程碑：${mark.name}（${NEXT_MILESTONE_LABEL[mark.status]}）`}</title>
            </polygon>
            <text
              x={x + 10}
              y={y + 4}
              fontSize={11}
              fill="var(--nx-text-secondary)"
              data-gantt-milestone-name
            >
              {mark.name}
            </text>
          </g>
        )
      })}
      {ghost?.active ? (
        <rect
          data-gantt-ghost-bar
          data-testid="ghost-bar"
          data-ghost-task-id={ghost.taskId}
          data-ghost-kind={ghost.kind}
          data-ghost-start-day={ghost.startDay}
          data-ghost-duration={ghost.durationDays}
          x={nxDayToX(scale, ghost.startDay)}
          y={
            rowIndex.get(ghost.taskId) !== undefined
              ? nxRowTop(scale, rowIndex.get(ghost.taskId)!) + BAR_Y_INSET
              : 0
          }
          width={Math.max(3, (ghost.durationDays || 1) * scale.pxPerDay)}
          height={Math.max(12, scale.rowHeight - BAR_Y_INSET * 2)}
          fill="var(--nx-accent)"
          opacity={0.4}
          rx={1}
        />
      ) : null}
    </g>
  )
})
