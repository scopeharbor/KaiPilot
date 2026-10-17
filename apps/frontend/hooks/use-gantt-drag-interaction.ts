'use client'

import { useCallback, useRef, useState } from 'react'
import type * as React from 'react'
import { usePermissions } from '@/hooks/use-permissions'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'
import type { WorkingCalendarSettingsInput } from '@/lib/gantt/working-calendar'
import type { WhatIfCommand } from '@/lib/gantt/what-if-types'

const MS_PER_DAY = 86_400_000

/**
 * 拖拽激活阈值（px）：以微小位移分离「单击查看 / 按住拖拽」两种意图，
 * 与 @dnd-kit PointerSensor 默认 activationConstraint.distance 语义一致。
 */
export const DRAG_ACTIVATION_THRESHOLD_PX = 5

/** 拖拽手柄种类：整条平移 / 右端工期拉伸 / 里程碑平移。 */
export type GanttDragHandleKind = 'move' | 'resize' | 'milestone'

/** 拖拽中的幽灵投影条状态（实时整数天吸附后的落点）。 */
export interface GanttDragGhost {
  taskId: number
  kind: GanttDragHandleKind
  /** 吸附后的任务条起始天（整天，≥0）。 */
  startDay: number
  /** 吸附后的工期天数（任务 ≥1；里程碑 0）。 */
  durationDays: number
  /** 相对手柄起始点的像素位移。 */
  deltaX: number
  /** 是否已越过激活阈值进入拖拽态。 */
  active: boolean
}

export interface GanttDragHandleProps {
  /** 无编辑权限（或该手柄几何上不适用）时为 true，消费方锁定默认光标并忽略事件。 */
  disabled: boolean
  onPointerDown: (event: React.PointerEvent<Element>) => void
  onPointerMove: (event: React.PointerEvent<Element>) => void
  onPointerUp: (event: React.PointerEvent<Element>) => void
  onPointerCancel: (event: React.PointerEvent<Element>) => void
}

export interface UseGanttDragInteractionOptions {
  /** 当前展示的任务集（derivedPreview?.model.tasks ?? 正式 model.tasks）。 */
  tasks: readonly GanttRenderTask[]
  /** 依赖集（惰性进入 session 建 base snapshot 用）。 */
  dependencies: readonly GanttRenderDependency[]
  /** 工作日历设置（惰性进入 session 用）。 */
  calendarSettings: WorkingCalendarSettingsInput | null
  /** 天偏移 0 对应的真实时刻（ms），来自 GanttModel.epochMs。 */
  epochMs: number
  /** 每天像素数（像素位移 → 整数天吸附的换算密度）。 */
  pxPerDay: number
  /** 项目 id（进入 session 时登记单项目单 session）。 */
  projectId?: number
}

interface DragGesture {
  taskId: number
  milestoneId: number
  kind: GanttDragHandleKind
  originStartDay: number
  originDurationDays: number
  startClientX: number
  pointerId: number
  active: boolean
}

function noop(_event: React.PointerEvent<Element>): void {
  /* 禁用态句柄的占位事件处理（不派发任何命令）。 */
}

/** epochMs + 整天偏移 → 'YYYY-MM-DD'（UTC 零点的 ISO 日期，与命令契约一致）。 */
export function dayToIsoDate(epochMs: number, day: number): string {
  return new Date(epochMs + day * MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * useGanttDragInteraction —— 甘特画板拖拽排程交互 Hook（B4 甘特镜头 W2）。
 *
 * 职责（spec「拖拽排程零写入与本地内存派生」/ design 决策 4）：
 * - PointerEvent + `setPointerCapture` 生命周期；5px 阈值分离点击与拖拽；
 * - 过程位移 ΔX → `round(ΔX / pxPerDay)` 整数天吸附，实时产出幽灵投影条（ghost）；
 * - 释放时若吸附位移 ≠ 0，派发强类型命令（move-task / resize-duration / milestone-move）；
 *   首个有效命令惰性唤起 What-if 内存 session（RL-08：拖拽全程零网络写、零持久化）；
 * - RBAC 防线（spec「基于 RBAC 的甘特排程编辑权限守卫」）：仅 `task:update`，
 *   或 `task:update:self` 且本人为 assignee 者激活手柄；只读观察者获得 disabled 句柄，
 *   从源头阻断无权限者创建 What-if session。
 */
export function useGanttDragInteraction(options: UseGanttDragInteractionOptions) {
  const { tasks, dependencies, calendarSettings, epochMs, pxPerDay, projectId } = options
  const { can } = usePermissions()

  const [ghost, setGhost] = useState<GanttDragGhost | null>(null)
  const gestureRef = useRef<DragGesture | null>(null)

  /**
   * RBAC 判定：拖动 = 改排期，只有项目管理者（task:update）可以；
   * 成员（task:update:self）改期走项目经理或变更申请（与后端 authorizeScheduleChange 一致）。
   */
  const canEditTask = useCallback((_task: GanttRenderTask) => can('task:update'), [can])

  /** 把命令派发进 what-if store：无活跃 session 时先惰性进入（RL-08 最小化）。 */
  const dispatchCommand = useCallback(
    (command: WhatIfCommand | null) => {
      if (!command) return
      const state = useWhatIfSessionStore.getState()
      const session = state.session
      if (
        session.status === 'stale' ||
        session.status === 'applying' ||
        session.status === 'applied'
      ) {
        return // 过期 / 提交中禁止派发；提交失败（error）后可继续调整，命令执行后回到 active
      }
      if (!session.baseSnapshot) {
        state.enterSession(
          tasks,
          dependencies,
          calendarSettings,
          `v_${Date.now()}`,
          projectId,
          epochMs,
        )
      }
      useWhatIfSessionStore.getState().executeCommand(command)
    },
    [tasks, dependencies, calendarSettings, projectId, epochMs],
  )

  const beginDrag = useCallback(
    (event: React.PointerEvent<Element>, task: GanttRenderTask, kind: GanttDragHandleKind) => {
      if (!canEditTask(task)) return
      // 几何约束：里程碑无工期拉伸；非里程碑走平移/拉伸
      if (kind === 'resize' && task.kind === 'milestone') return
      const effectiveKind: GanttDragHandleKind =
        kind === 'move' && task.kind === 'milestone' ? 'milestone' : kind

      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId)
      } catch {
        // jsdom 等环境无指针捕获实现：指针事件仍按元素目标派发，不影响交互
      }

      gestureRef.current = {
        taskId: task.id,
        milestoneId: task.milestoneId ?? task.id,
        kind: effectiveKind,
        originStartDay: task.startDay,
        originDurationDays: task.durationDays,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        active: false,
      }
      setGhost({
        taskId: task.id,
        kind: effectiveKind,
        startDay: task.startDay,
        durationDays: task.durationDays,
        deltaX: 0,
        active: false,
      })
    },
    [canEditTask],
  )

  const handleMove = useCallback(
    (event: React.PointerEvent<Element>) => {
      const gesture = gestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      const deltaX = event.clientX - gesture.startClientX
      if (!Number.isFinite(deltaX)) return // 防御：非数值坐标（异常环境）直接忽略

      if (!gesture.active && Math.abs(deltaX) < DRAG_ACTIVATION_THRESHOLD_PX) {
        // 阈值内：未激活，只跟随原始位移（不吸附、不渲染激活态幽灵条）
        setGhost((current) => (current ? { ...current, deltaX, active: false } : current))
        return
      }
      gesture.active = true
      const dayDelta = Math.round(deltaX / pxPerDay) // 整数天吸附
      setGhost({
        taskId: gesture.taskId,
        kind: gesture.kind,
        ...snapGhost(gesture, dayDelta),
        deltaX,
        active: true,
      })
    },
    [pxPerDay],
  )

  const finishDrag = useCallback(
    (event: React.PointerEvent<Element>, cancelled: boolean) => {
      const gesture = gestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      gestureRef.current = null
      setGhost(null)
      if (cancelled || !gesture.active) return

      const deltaX = event.clientX - gesture.startClientX
      if (!Number.isFinite(deltaX)) return // 防御：非数值坐标当作取消
      const dayDelta = Math.round(deltaX / pxPerDay)
      if (dayDelta === 0) return // 整数天吸附回原位：零变更，不派发命令

      const snapped = snapGhost(gesture, dayDelta)
      dispatchCommand(buildCommand(gesture, snapped, epochMs))
    },
    [dispatchCommand, epochMs, pxPerDay],
  )

  const makeProps = useCallback(
    (task: GanttRenderTask, kind: GanttDragHandleKind): GanttDragHandleProps => {
      const applicable = kind !== 'resize' || task.kind !== 'milestone'
      if (!applicable || !canEditTask(task)) {
        return {
          disabled: true,
          onPointerDown: noop,
          onPointerMove: noop,
          onPointerUp: noop,
          onPointerCancel: noop,
        }
      }
      return {
        disabled: false,
        onPointerDown: (event) => beginDrag(event, task, kind),
        onPointerMove: handleMove,
        onPointerUp: (event) => finishDrag(event, false),
        onPointerCancel: (event) => finishDrag(event, true),
      }
    },
    [beginDrag, canEditTask, finishDrag, handleMove],
  )

  return {
    /** 实时幽灵投影条（供画板渲染半透明落点）；null = 无拖拽。 */
    ghost,
    /** RBAC 判定（消费方可用于悬停光标/手柄显隐）。 */
    canEditTask,
    /** 任务条整条平移手柄（里程碑行自动降级为里程碑平移）。 */
    getMoveHandleProps: (task: GanttRenderTask) => makeProps(task, 'move'),
    /** 右端工期拉伸手柄（里程碑返回 disabled）。 */
    getResizeHandleProps: (task: GanttRenderTask) => makeProps(task, 'resize'),
    /** 里程碑平移手柄（仅里程碑行适用）。 */
    getMilestoneHandleProps: (task: GanttRenderTask) => makeProps(task, 'milestone'),
  }
}

/** 按手柄种类把 dayDelta 吸附换算为落点（startDay/durationDays）。 */
function snapGhost(
  gesture: DragGesture,
  dayDelta: number,
): Pick<GanttDragGhost, 'startDay' | 'durationDays'> {
  if (gesture.kind === 'resize') {
    // 右端拉伸：起点不变，工期 = 初始工期 + 整天位移（保底 1 天）
    return {
      startDay: gesture.originStartDay,
      durationDays: Math.max(1, gesture.originDurationDays + dayDelta),
    }
  }
  return {
    startDay: Math.max(0, gesture.originStartDay + dayDelta),
    durationDays: gesture.kind === 'milestone' ? 0 : gesture.originDurationDays,
  }
}

/** 把吸附后的落点组装为强类型 what-if 命令（spec 决策 4.1 命令契约）。 */
function buildCommand(
  gesture: DragGesture,
  snapped: Pick<GanttDragGhost, 'startDay' | 'durationDays'>,
  epochMs: number,
): WhatIfCommand | null {
  switch (gesture.kind) {
    case 'move':
      return {
        kind: 'move-task',
        taskId: gesture.taskId,
        newStartDate: dayToIsoDate(epochMs, snapped.startDay),
      }
    case 'milestone':
      return {
        kind: 'milestone-move',
        milestoneId: gesture.milestoneId,
        taskId: gesture.taskId,
        newDate: dayToIsoDate(epochMs, snapped.startDay),
      }
    case 'resize':
      return {
        kind: 'resize-duration',
        taskId: gesture.taskId,
        newStartDate: dayToIsoDate(epochMs, gesture.originStartDay),
        newEndDate: dayToIsoDate(epochMs, snapped.startDay + snapped.durationDays - 1),
      }
    default:
      return null
  }
}
