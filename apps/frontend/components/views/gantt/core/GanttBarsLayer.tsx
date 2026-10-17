'use client'

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { dayToX, durationToWidth, type GanttScale } from '@/lib/gantt/geometry'
import { milestoneStatusVar, statusVar, STRUCTURE_TOKEN, svgVar } from '@/lib/gantt/palette'
import { CopilotInlineTrigger } from '@/components/copilot/CopilotInlineTrigger'
import { isAgentAssignee } from '@/types/agent-assignee'
import type {
  DependencyType,
  GanttEntry,
  GanttMilestoneMark,
  GanttRenderTask,
  GanttScheduleDraft,
} from '@/lib/gantt/types'
import type {
  GanttDependencyDraft,
  GanttInteractionMode,
  GanttMilestoneDateDraft,
  GanttProgressDraft,
} from '@/lib/gantt/interaction-types'

/** 进度键盘步进：普通 ±10%，Shift ±25%。 */
const PROGRESS_STEP = 0.1
const PROGRESS_STEP_FAST = 0.25

interface GanttBarsLayerProps {
  scale: GanttScale
  tasks: GanttRenderTask[]
  milestones?: GanttMilestoneMark[]
  /** 虚拟化后的可见行（含缓冲）。 */
  visibleRows: { index: number; start: number }[]
  /** 可见时间窗（天），用于横向裁剪；带缓冲。 */
  visibleDayRange: { startDay: number; endDay: number }
  width: number
  height: number
  /** 入口 preset：简化入口用更大圆角条 + 阶段分组底纹（design D6 / task 5.2）。 */
  entry?: GanttEntry
  hoveredTaskId: number | null
  selectedTaskId: number | null
  selectedTaskIds?: Set<number>
  focusTaskId?: number | null
  onHover: (id: number | null) => void
  onSelect: (id: number, options?: { toggle?: boolean; range?: boolean }) => void
  onFocusTask?: (id: number | null) => void
  editable?: boolean
  dependencyEditable?: boolean
  /**
   * 交互模式（design D3 / task 5.1）：按模式**只暴露对应可交互图元**（schedule=改期手柄、
   * dependency=依赖锚点、progress=进度手柄）。省略时（dev harness/直测）不按模式收敛，
   * 保持既有「按权限全暴露」行为向后兼容。
   */
  mode?: GanttInteractionMode
  onScheduleDraft?: (draft: GanttScheduleDraft) => void
  onDependencyDraft?: (draft: GanttDependencyDraft) => void
  /** 里程碑目标日期草稿（task 2.5）；缺省则里程碑不可改期。 */
  onMilestoneDraft?: (draft: GanttMilestoneDateDraft) => void
  /** 任务进度草稿（task 2.6）；缺省则进度不可调整。 */
  onProgressDraft?: (draft: GanttProgressDraft) => void
}

const DAY_BUFFER = 4

/** 单条任务条几何。 */
function bar(scale: GanttScale, task: GanttRenderTask) {
  const x = dayToX(scale, task.startDay)
  const w = durationToWidth(scale, task.durationDays)
  return { x, w }
}

type AnchorSide = 'start' | 'finish'

type DragState =
  | {
      kind: 'schedule'
      pointerId: number
      taskId: number
      operation: 'move' | 'resize'
      startClientX: number
      deltaDays: number
    }
  | {
      kind: 'milestone'
      pointerId: number
      taskId: number
      startClientX: number
      deltaDays: number
    }
  | {
      kind: 'progress'
      pointerId: number
      taskId: number
      startClientX: number
      barWidthPx: number
      startProgress: number
      progress: number
    }
  | {
      kind: 'dependency'
      pointerId: number
      taskId: number
      side: AnchorSide
      x1: number
      y1: number
      x2: number
      y2: number
    }

function dependencyType(from: AnchorSide, to: AnchorSide): DependencyType {
  if (from === 'start') return to === 'start' ? 'ss' : 'sf'
  return to === 'start' ? 'fs' : 'ff'
}

/**
 * 任务条层（task 3.3/3.4/3.5）：语义色任务条 + 内嵌进度、里程碑菱形、父级阶段汇总条。
 * 只渲染可见行（虚拟化）与可见时间窗（横向裁剪，视口外不画）。关键路径任务加描边强调。
 * 颜色全部经令牌，无硬编码。
 */
export const GanttBarsLayer = memo(function GanttBarsLayer({
  scale,
  tasks,
  milestones = [],
  visibleRows,
  visibleDayRange,
  width,
  height,
  entry = 'standard',
  hoveredTaskId,
  selectedTaskId,
  selectedTaskIds,
  focusTaskId,
  onHover,
  onSelect,
  onFocusTask,
  editable = false,
  dependencyEditable = false,
  mode,
  onScheduleDraft,
  onDependencyDraft,
  onMilestoneDraft,
  onProgressDraft,
}: GanttBarsLayerProps) {
  // 模式门（design D3）：省略 mode 时全开（向后兼容）；给定 mode 时只放行对应交互图元。
  const scheduleGate = mode === undefined || mode === 'schedule'
  const dependencyGate = mode === undefined || mode === 'dependency'
  const progressGate = mode === undefined || mode === 'progress'
  const [drag, setDrag] = useState<DragState | null>(null)
  const [keyboardAnchor, setKeyboardAnchor] = useState<{
    taskId: number
    side: AnchorSide
  } | null>(null)
  // v3-copilot-inline-triggers：甘特条右键上下文菜单
  const [contextMenu, setContextMenu] = useState<{
    taskId: number
    taskName: string
    x: number
    y: number
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  // 拖动改期/里程碑/进度松开后，浏览器还会在同一任务条上补发一次 click；
  // 不吞掉它就会在「确认排程调整」之外再打开任务依赖详情（7.2 冒烟发现）。
  const suppressClickRef = useRef(false)
  const simplified = entry === 'simplified'
  const rowH = scale.rowHeight
  // 简化入口：更饱满的大圆角条，更亲和。
  const barH = simplified ? Math.min(22, rowH - 6) : Math.min(18, rowH - 10)
  const barRadius = simplified ? 8 : 4
  const minDay = visibleDayRange.startDay - DAY_BUFFER
  const maxDay = visibleDayRange.endDay + DAY_BUFFER
  const milestoneByTaskId = new Map(milestones.map((milestone) => [milestone.taskId, milestone]))

  // v3-copilot-inline-triggers：甘特条右键上下文菜单处理
  const handleContextMenu = useCallback((event: MouseEvent<SVGGElement>, task: GanttRenderTask) => {
    event.preventDefault()
    event.stopPropagation()
    // 获取 SVG 元素的位置
    const svgElement = (event.target as Element).closest('svg')
    if (!svgElement) return
    const svgRect = svgElement.getBoundingClientRect()
    setContextMenu({
      taskId: task.id,
      taskName: task.name,
      x: event.clientX - svgRect.left,
      y: event.clientY - svgRect.top,
    })
  }, [])

  // 点击外部关闭上下文菜单
  useEffect(() => {
    if (!contextMenu) return
    function handleClickOutside(event: globalThis.MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  const emitSchedule = (task: GanttRenderTask, operation: 'move' | 'resize', deltaDays: number) => {
    if (!onScheduleDraft || deltaDays === 0) return
    if (operation === 'move') {
      onScheduleDraft({
        taskId: task.id,
        operation,
        startDay: task.startDay + deltaDays,
        endDay:
          task.kind === 'milestone'
            ? task.startDay + deltaDays
            : task.startDay + deltaDays + Math.max(1, task.durationDays) - 1,
      })
      return
    }
    const durationDays = Math.max(1, task.durationDays + deltaDays)
    onScheduleDraft({
      taskId: task.id,
      operation,
      startDay: task.startDay,
      endDay: task.startDay + durationDays - 1,
    })
  }

  const emitMilestone = (task: GanttRenderTask, deltaDays: number) => {
    if (!onMilestoneDraft || deltaDays === 0 || task.milestoneId === undefined) return
    onMilestoneDraft({
      milestoneId: task.milestoneId,
      taskId: task.id,
      day: task.startDay + deltaDays,
    })
  }

  const emitProgress = (task: GanttRenderTask, nextProgress: number) => {
    if (!onProgressDraft) return
    const clamped = Math.max(0, Math.min(1, nextProgress))
    if (Math.abs(clamped - task.progress) < 1e-6) return
    onProgressDraft({ taskId: task.id, progress: clamped })
  }

  const onSchedulePointerDown = (
    event: PointerEvent<SVGGElement | SVGRectElement>,
    task: GanttRenderTask,
    operation: 'move' | 'resize',
  ) => {
    suppressClickRef.current = false
    if (!editable || task.kind === 'summary') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({
      kind: 'schedule',
      pointerId: event.pointerId,
      taskId: task.id,
      operation,
      startClientX: event.clientX,
      deltaDays: 0,
    })
  }

  const onDependencyPointerDown = (
    event: PointerEvent<SVGCircleElement>,
    task: GanttRenderTask,
    side: AnchorSide,
    x: number,
    y: number,
  ) => {
    if (!dependencyEditable) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({
      kind: 'dependency',
      pointerId: event.pointerId,
      taskId: task.id,
      side,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
    })
  }

  const onMilestonePointerDown = (event: PointerEvent<SVGElement>, task: GanttRenderTask) => {
    suppressClickRef.current = false
    if (!editable || !onMilestoneDraft || task.milestoneId === undefined) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({
      kind: 'milestone',
      pointerId: event.pointerId,
      taskId: task.id,
      startClientX: event.clientX,
      deltaDays: 0,
    })
  }

  const onProgressPointerDown = (
    event: PointerEvent<SVGCircleElement>,
    task: GanttRenderTask,
    barWidthPx: number,
  ) => {
    suppressClickRef.current = false
    if (!editable || !onProgressDraft || task.kind !== 'task') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({
      kind: 'progress',
      pointerId: event.pointerId,
      taskId: task.id,
      startClientX: event.clientX,
      barWidthPx: Math.max(1, barWidthPx),
      startProgress: task.progress,
      progress: task.progress,
    })
  }

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.kind === 'schedule' || drag.kind === 'milestone') {
      const deltaDays = Math.round((event.clientX - drag.startClientX) / scale.pxPerDay)
      if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays })
      return
    }
    if (drag.kind === 'progress') {
      const next = Math.max(
        0,
        Math.min(1, drag.startProgress + (event.clientX - drag.startClientX) / drag.barWidthPx),
      )
      if (next !== drag.progress) setDrag({ ...drag, progress: next })
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setDrag({ ...drag, x2: event.clientX - rect.left, y2: event.clientY - rect.top })
  }

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.kind === 'schedule') {
      const task = tasks.find((item) => item.id === drag.taskId)
      if (task) emitSchedule(task, drag.operation, drag.deltaDays)
      suppressClickRef.current = drag.deltaDays !== 0
      setDrag(null)
      return
    }
    if (drag.kind === 'milestone') {
      const task = tasks.find((item) => item.id === drag.taskId)
      if (task) emitMilestone(task, drag.deltaDays)
      suppressClickRef.current = drag.deltaDays !== 0
      setDrag(null)
      return
    }
    if (drag.kind === 'progress') {
      const task = tasks.find((item) => item.id === drag.taskId)
      if (task) emitProgress(task, drag.progress)
      suppressClickRef.current = drag.progress !== drag.startProgress
      setDrag(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const rowIndex = Math.floor(y / rowH)
    const target = tasks[rowIndex]
    if (target && target.id !== drag.taskId && target.kind !== 'summary') {
      const targetBar = bar(scale, target)
      const toSide: AnchorSide =
        Math.abs(x - targetBar.x) <= Math.abs(x - (targetBar.x + targetBar.w)) ? 'start' : 'finish'
      onDependencyDraft?.({
        predecessorId: drag.taskId,
        successorId: target.id,
        type: dependencyType(drag.side, toSide),
      })
    }
    setDrag(null)
  }

  const selectTaskFromInput = (
    task: GanttRenderTask,
    options?: { toggle?: boolean; range?: boolean },
  ) => {
    if (task.milestoneId !== undefined) return
    onSelect(task.id, options)
    onFocusTask?.(task.id)
  }

  const onTaskKeyDown = (event: KeyboardEvent<SVGGElement>, task: GanttRenderTask) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectTaskFromInput(task, {
        toggle: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      })
      return
    }
    if (!editable || task.kind === 'summary') return
    // 上/下方向键：调整进度草稿（task 2.6，仅进度模式）；左/右：移动日期草稿。
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && onProgressDraft && progressGate) {
      event.preventDefault()
      const step = event.shiftKey ? PROGRESS_STEP_FAST : PROGRESS_STEP
      const direction = event.key === 'ArrowUp' ? 1 : -1
      emitProgress(task, task.progress + direction * step)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    emitSchedule(task, 'move', direction * (event.shiftKey ? 5 : 1))
  }

  const onMilestoneKeyDown = (event: KeyboardEvent<SVGGElement>, task: GanttRenderTask) => {
    if (!editable || !onMilestoneDraft || task.milestoneId === undefined) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    emitMilestone(task, direction * (event.shiftKey ? 5 : 1))
  }

  const onResizeKeyDown = (event: KeyboardEvent<SVGRectElement>, task: GanttRenderTask) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    emitSchedule(task, 'resize', direction * (event.shiftKey ? 5 : 1))
  }

  const onAnchorKeyDown = (
    event: KeyboardEvent<SVGCircleElement>,
    task: GanttRenderTask,
    side: AnchorSide,
  ) => {
    if (!dependencyEditable) return
    if (event.key === 'Escape') {
      setKeyboardAnchor(null)
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (!keyboardAnchor) {
      setKeyboardAnchor({ taskId: task.id, side })
      return
    }
    if (keyboardAnchor.taskId !== task.id) {
      onDependencyDraft?.({
        predecessorId: keyboardAnchor.taskId,
        successorId: task.id,
        type: dependencyType(keyboardAnchor.side, side),
      })
    }
    setKeyboardAnchor(null)
  }

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="absolute inset-0 block"
        role="list"
        aria-label="甘特任务条"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {visibleRows.map(({ index, start }) => {
          const task = tasks[index]
          if (!task) return null
          // 时间窗横向裁剪：完全落在可见窗之外的任务不绘制。
          const endDay = task.startDay + Math.max(task.durationDays, 0)
          if (endDay < minDay || task.startDay > maxDay) return null

          const cy = start + rowH / 2
          const selected = selectedTaskIds?.has(task.id) || task.id === selectedTaskId
          const active = task.id === hoveredTaskId || selected || task.id === focusTaskId
          const scheduleDrag = drag?.kind === 'schedule' && drag.taskId === task.id ? drag : null
          const dragX =
            scheduleDrag?.operation === 'move' ? scheduleDrag.deltaDays * scale.pxPerDay : 0
          const taskEditable =
            editable && task.kind !== 'summary' && task.milestoneId === undefined && scheduleGate
          const dependencyTaskEditable =
            dependencyEditable && task.milestoneId === undefined && dependencyGate
          const commonProps = {
            onMouseEnter: () => onHover(task.id),
            onMouseLeave: () => onHover(null),
            onClick:
              task.milestoneId === undefined
                ? (event: MouseEvent<SVGGElement>) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    selectTaskFromInput(task, {
                      toggle: event.ctrlKey || event.metaKey,
                      range: event.shiftKey,
                    })
                  }
                : undefined,
            // v3-copilot-inline-triggers：右键打开上下文菜单
            onContextMenu:
              task.milestoneId === undefined
                ? (event: MouseEvent<SVGGElement>) => handleContextMenu(event, task)
                : undefined,
            className: taskEditable
              ? 'cursor-grab active:cursor-grabbing'
              : task.milestoneId === undefined
                ? 'cursor-pointer'
                : undefined,
            tabIndex: task.milestoneId === undefined ? 0 : undefined,
            onFocus: () => onFocusTask?.(task.id),
            onKeyDown: (event: KeyboardEvent<SVGGElement>) => onTaskKeyDown(event, task),
            onPointerDown: taskEditable
              ? (event: PointerEvent<SVGGElement>) => onSchedulePointerDown(event, task, 'move')
              : undefined,
            transform: dragX ? `translate(${dragX} 0)` : undefined,
          }

          if (task.kind === 'milestone') {
            const s = Math.min(rowH * 0.42, 10)
            const cx = dayToX(scale, task.startDay)
            const milestone = milestoneByTaskId.get(task.id)
            const realMilestone = task.milestoneId !== undefined
            // 真实里程碑：目标日期编辑（task 2.5）。派生零工期行：仍走任务排程（commonProps）。
            const milestoneEditable =
              editable && realMilestone && Boolean(onMilestoneDraft) && scheduleGate
            const milestoneDrag =
              drag?.kind === 'milestone' && drag.taskId === task.id ? drag : null
            const mDragX = milestoneDrag ? milestoneDrag.deltaDays * scale.pxPerDay : 0
            // 真实里程碑：整行 g 作为可聚焦、带名的交互元素（方向键改期）。派生行沿用 commonProps 排程。
            const gProps = realMilestone
              ? {
                  onMouseEnter: () => onHover(task.id),
                  onMouseLeave: () => onHover(null),
                  transform: mDragX ? `translate(${mDragX} 0)` : undefined,
                  tabIndex: milestoneEditable ? 0 : undefined,
                  className: milestoneEditable ? 'cursor-grab active:cursor-grabbing' : undefined,
                  onPointerDown: milestoneEditable
                    ? (event: PointerEvent<SVGGElement>) => onMilestonePointerDown(event, task)
                    : undefined,
                  onKeyDown: milestoneEditable
                    ? (event: KeyboardEvent<SVGGElement>) => onMilestoneKeyDown(event, task)
                    : undefined,
                }
              : commonProps
            return (
              <g
                key={task.id}
                {...gProps}
                role="listitem"
                aria-label={
                  realMilestone
                    ? `里程碑：${task.name}${milestoneEditable ? '，方向键调整目标日期，Shift 加速' : '（只读）'}`
                    : `里程碑：${task.name}${taskEditable ? '，可调整日期' : ''}`
                }
                aria-selected={selected}
              >
                <polygon
                  points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
                  fill={
                    milestone
                      ? milestoneStatusVar(milestone.status)
                      : svgVar(STRUCTURE_TOKEN.milestone)
                  }
                  stroke={active ? 'var(--primary-500)' : 'var(--gray-0)'}
                  strokeWidth={active ? 2 : 1}
                />
                {dependencyTaskEditable ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="var(--gray-0)"
                    stroke="var(--primary-500)"
                    opacity={active || keyboardAnchor?.taskId === task.id ? 1 : 0.35}
                    tabIndex={0}
                    aria-label={`依赖锚点：从里程碑「${task.name}」建立依赖`}
                    onPointerDown={(event) =>
                      onDependencyPointerDown(event, task, 'finish', cx, cy)
                    }
                    onKeyDown={(event) => onAnchorKeyDown(event, task, 'finish')}
                  />
                ) : null}
              </g>
            )
          }

          const { x, w } = bar(scale, task)

          if (task.kind === 'summary') {
            // 汇总条：细杆 + 两端下折角，视觉区别于叶子任务。
            const cap = 5
            const yTop = cy - 3
            const path = `M${x},${yTop} H${x + w} V${yTop + 6} L${x + w - cap},${yTop + 3} H${x + cap} L${x},${yTop + 6} Z`
            return (
              <g
                key={task.id}
                {...commonProps}
                role="listitem"
                aria-label={`阶段：${task.name}`}
                aria-selected={selected}
              >
                {/* 简化入口：阶段整行底纹，直觉分组（task 5.2）。 */}
                {simplified ? (
                  <rect x={0} y={start} width={width} height={rowH} fill="var(--gray-50)" />
                ) : null}
                <path
                  d={path}
                  fill={svgVar(STRUCTURE_TOKEN.summaryBar)}
                  stroke={active ? 'var(--primary-500)' : 'none'}
                  strokeWidth={active ? 1.5 : 0}
                />
              </g>
            )
          }

          // 叶子任务条：语义色轨道 + 进度填充 + 关键路径描边。
          const y = cy - barH / 2
          const draftWidth =
            scheduleDrag?.operation === 'resize'
              ? durationToWidth(scale, Math.max(1, task.durationDays + scheduleDrag.deltaDays))
              : w
          const progressDrag = drag?.kind === 'progress' && drag.taskId === task.id ? drag : null
          const effectiveProgress = progressDrag
            ? progressDrag.progress
            : Math.max(0, Math.min(1, task.progress))
          const progressW = effectiveProgress * draftWidth
          const progressEditable = editable && Boolean(onProgressDraft) && progressGate
          const fill = statusVar(task.status)
          const hasBaseline =
            task.baselineStartDay !== undefined && task.baselineEndDay !== undefined
          const baselineStartDay = task.baselineStartDay ?? 0
          const baselineEndDay = task.baselineEndDay ?? baselineStartDay
          const baselineX = hasBaseline ? dayToX(scale, baselineStartDay) : 0
          const baselineWidth = hasBaseline
            ? durationToWidth(scale, Math.max(1, baselineEndDay - baselineStartDay + 1))
            : 0
          const currentEndDay = task.startDay + Math.max(1, task.durationDays) - 1
          const deviationDays = hasBaseline ? currentEndDay - baselineEndDay : 0
          // v3-copilot-agent-as-assignee：agent 负责任务用虚线描边区分
          const isAgentTask = isAgentAssignee(task.assignee?.assigneeType)
          return (
            <g
              key={task.id}
              {...commonProps}
              role="listitem"
              aria-label={`任务：${task.name}${isAgentTask ? '，AI 负责人：待确认方案' : ''}${
                editable
                  ? progressEditable
                    ? '，左右方向键移动，上下方向键调整进度，Shift 加速'
                    : '，方向键移动，Shift 加速'
                  : '，Enter 打开任务依赖详情'
              }`}
              aria-selected={selected}
            >
              {hasBaseline ? (
                <>
                  <rect
                    x={baselineX}
                    y={cy + barH / 2 + 2}
                    width={baselineWidth}
                    height={3}
                    rx={1.5}
                    fill={svgVar(STRUCTURE_TOKEN.baseline)}
                    opacity={0.75}
                    data-gantt-baseline
                  />
                  {deviationDays !== 0 ? (
                    <text
                      x={Math.max(x + draftWidth, baselineX + baselineWidth) + 4}
                      y={cy + 4}
                      fontSize={10}
                      fill={deviationDays > 0 ? 'var(--danger)' : 'var(--success)'}
                      data-gantt-deviation={deviationDays > 0 ? 'late' : 'early'}
                    >
                      {deviationDays > 0 ? `滞后 ${deviationDays}天` : `提前 ${-deviationDays}天`}
                    </text>
                  ) : null}
                </>
              ) : null}
              <rect
                x={x}
                y={y}
                width={draftWidth}
                height={barH}
                rx={barRadius}
                fill={fill}
                opacity={0.22}
              />
              {progressW > 0 ? (
                <rect x={x} y={y} width={progressW} height={barH} rx={barRadius} fill={fill} />
              ) : null}
              <rect
                x={x}
                y={y}
                width={draftWidth}
                height={barH}
                rx={barRadius}
                fill="none"
                stroke={
                  task.isCritical
                    ? 'var(--danger)'
                    : isAgentTask
                      ? 'var(--ai)'
                      : active
                        ? 'var(--primary-500)'
                        : 'var(--border-strong)'
                }
                strokeWidth={task.isCritical || active ? 1.5 : 1}
                strokeDasharray={isAgentTask ? '4 2' : undefined}
                opacity={task.isCritical ? 0.9 : isAgentTask ? 0.7 : active ? 1 : 0.5}
              />
              {taskEditable ? (
                <rect
                  x={x + draftWidth - 5}
                  y={y - 2}
                  width={10}
                  height={barH + 4}
                  rx={3}
                  fill="var(--primary-500)"
                  opacity={active || scheduleDrag?.operation === 'resize' ? 0.85 : 0.24}
                  className="cursor-ew-resize"
                  tabIndex={0}
                  aria-label={`改期手柄：调整任务「${task.name}」工期`}
                  onPointerDown={(event) => onSchedulePointerDown(event, task, 'resize')}
                  onKeyDown={(event) => onResizeKeyDown(event, task)}
                />
              ) : null}
              {progressEditable ? (
                <>
                  {progressDrag ? (
                    <text
                      x={x + draftWidth / 2}
                      y={y - 4}
                      fontSize={10}
                      textAnchor="middle"
                      fill="var(--primary-600)"
                      data-gantt-progress-preview
                    >
                      {Math.round(effectiveProgress * 100)}%
                    </text>
                  ) : null}
                  <circle
                    cx={x + progressW}
                    cy={cy}
                    r={5}
                    fill="var(--gray-0)"
                    stroke="var(--primary-500)"
                    strokeWidth={1.5}
                    opacity={active || progressDrag ? 1 : 0.35}
                    className="cursor-ew-resize"
                    tabIndex={0}
                    aria-label={`进度手柄：调整任务「${task.name}」进度，当前 ${Math.round(effectiveProgress * 100)}%`}
                    onPointerDown={(event) => onProgressPointerDown(event, task, draftWidth)}
                    onKeyDown={(event) => onTaskKeyDown(event, task)}
                  />
                </>
              ) : null}
              {dependencyTaskEditable ? (
                <>
                  {(['start', 'finish'] as const).map((side) => {
                    const anchorX = side === 'start' ? x : x + draftWidth
                    return (
                      <circle
                        key={side}
                        cx={anchorX}
                        cy={cy}
                        r={5}
                        fill="var(--gray-0)"
                        stroke="var(--primary-500)"
                        strokeWidth={1.5}
                        opacity={active || keyboardAnchor?.taskId === task.id ? 1 : 0.2}
                        tabIndex={0}
                        aria-label={`依赖${side === 'start' ? '开始' : '结束'}锚点：任务「${task.name}」`}
                        onPointerDown={(event) =>
                          onDependencyPointerDown(event, task, side, anchorX, cy)
                        }
                        onKeyDown={(event) => onAnchorKeyDown(event, task, side)}
                      />
                    )
                  })}
                </>
              ) : null}
            </g>
          )
        })}
        {drag?.kind === 'dependency' ? (
          <line
            x1={drag.x1}
            y1={drag.y1}
            x2={drag.x2}
            y2={drag.y2}
            stroke="var(--primary-500)"
            strokeWidth={2}
            strokeDasharray="5 4"
            pointerEvents="none"
            aria-hidden
          />
        ) : null}
      </svg>
      {/* v3-copilot-inline-triggers：甘特条右键上下文菜单 */}
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="absolute z-50 rounded-[var(--radius-md)] border border-border bg-gray-0 shadow-[var(--shadow-md)] p-2"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={`操作：${contextMenu.taskName}`}
        >
          <CopilotInlineTrigger
            entity={{
              entityType: 'task',
              entityId: contextMenu.taskId,
              label: contextMenu.taskName,
            }}
            size="sm"
            variant="ghost"
          />
        </div>
      ) : null}
    </div>
  )
})
