'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useGanttStore } from '@/stores/gantt-store'
import type {
  GanttModel,
  GanttRenderDependency,
  GanttRenderTask,
  TaskStatus,
} from '@/lib/gantt/types'
import type { WorkingCalendarSettingsInput } from '@/lib/gantt/working-calendar'
import type { WhatIfCommand, WhatIfSessionStatus } from '@/lib/gantt/what-if-types'

/**
 * 精确档高密度纯 DOM 表格化甘特（v3-ui-next-gantt-lens design D2 / spec「精确档高密度
 * 纯 DOM 表格化甘特降级」）。
 *
 * - 消费 `useImmersionTier()`：precise 档 / 减弱动画下由装配方切换到本组件（零 SVG 发光、
 *   零呼吸动效，纯色实色条即时瞬移）；
 * - 布局：左侧固定紧凑信息表（序号/WBS/名称/起止日期/工期/状态/负责人/前置徽章）+
 *   右侧 1px 发丝线日期网格（`--nx-border-hairline`），行高 28px；
 * - 能力等价：实色条按住拖拽平移（move-task）、右缘把手拉伸工期（resize-duration），
 *   拖拽自动唤起 What-if 沙盒（enterSession → executeCommand），与 SVG 画板同一命令栈；
 * - 同源 `GanttModel`：展示模型由装配方传入（试算激活时传 `derivedPreview.model`）。
 */

const DAY_CELL_WIDTH = 44
// 行高固定 28px（紧凑标准）：左表与右侧网格行高以 h-[28px]/h-8 硬编码对齐
const MAX_GRID_DAYS = 366
const MS_PER_DAY = 86_400_000

/** 状态 → 实色条令牌（暗黑仪器感语义色，零硬编码色值）。 */
const STATUS_BAR_TOKEN: Record<TaskStatus, string> = {
  not_started: 'var(--nx-text-muted)',
  in_progress: 'var(--nx-workspace-blue)',
  completed: 'var(--nx-status-success)',
  blocked: 'var(--nx-status-danger)',
  on_hold: 'var(--nx-status-warning)',
  cancelled: 'var(--nx-text-muted)',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '受阻',
  on_hold: '暂缓',
  cancelled: '已取消',
}

/** 天偏移 → ISO 日期（`YYYY-MM-DD`，用于命令 newStartDate/newEndDate）。 */
export function preciseDayToIso(epochMs: number, day: number): string {
  return new Date(epochMs + day * MS_PER_DAY).toISOString().slice(0, 10)
}

/** What-if 会话控制器最小契约（装配方传入 useWhatIfSession 对应能力）。 */
export interface PreciseTableSessionController {
  status: WhatIfSessionStatus
  enterSession: (
    tasks: readonly GanttRenderTask[],
    dependencies: readonly GanttRenderDependency[],
    calendarSettings: WorkingCalendarSettingsInput | null,
    serverRevision: string,
  ) => void
  executeCommand: (command: WhatIfCommand) => { valid: boolean; error: string | null }
}

export interface WorkspaceGanttPreciseTableProps {
  /** 展示模型（只读浏览=正式模型；试算激活=派生模型），同源 GanttModel。 */
  model: GanttModel | null
  calendarSettings?: WorkingCalendarSettingsInput | null
  /** RBAC 编辑放行（W2 权限防线）：只读观察者禁用手柄并锁定默认光标。 */
  canEdit?: boolean
  session: PreciseTableSessionController
  /** 双击任务行打开详情（真实里程碑 id < 0 不响应）。 */
  onOpenTask?: (taskId: number) => void
  /** 聚焦任务：选中并滚动到该行（每个任务一次）。 */
  focusTaskId?: number | null
}

interface PreciseDragState {
  taskId: number
  mode: 'move' | 'resize'
  startX: number
  startDay: number
  durationDays: number
  deltaDays: number
}

export function WorkspaceGanttPreciseTable({
  model,
  calendarSettings = null,
  canEdit = true,
  session,
  onOpenTask,
  focusTaskId = null,
}: WorkspaceGanttPreciseTableProps) {
  const tier = useImmersionTier()
  const selectedTaskId = useGanttStore((s) => s.selectedTaskId)
  const setSelectedTaskId = useGanttStore((s) => s.setSelectedTaskId)
  const setHoveredTaskId = useGanttStore((s) => s.setHoveredTaskId)

  // 聚焦任务：选中并滚到该行（每个任务一次）
  const focusedTaskRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!focusTaskId || focusedTaskRef.current === focusTaskId) return
    if (!model?.tasks.some((task) => task.id === focusTaskId)) return
    focusedTaskRef.current = focusTaskId
    setSelectedTaskId(focusTaskId)
    const row = document.querySelector<HTMLElement>(
      `[data-precise-info-row][data-precise-row="${focusTaskId}"]`,
    )
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }, [focusTaskId, model, setSelectedTaskId])

  const [drag, setDrag] = React.useState<PreciseDragState | null>(null)
  const dragRef = React.useRef<PreciseDragState | null>(null)
  const modelRef = React.useRef(model)
  const sessionRef = React.useRef(session)
  const calendarRef = React.useRef(calendarSettings)
  React.useEffect(() => {
    modelRef.current = model
    sessionRef.current = session
    calendarRef.current = calendarSettings
  }, [model, session, calendarSettings])

  // ── 拖拽生命周期（window 级监听，随时读取最新 ref） ─────────────
  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const deltaDays = Math.round((event.clientX - current.startX) / DAY_CELL_WIDTH)
      if (deltaDays !== current.deltaDays) {
        dragRef.current = { ...current, deltaDays }
        setDrag(dragRef.current)
      }
    }
    const handlePointerUp = () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current || current.deltaDays === 0) return

      const currentSession = sessionRef.current
      const currentModel = modelRef.current
      if (!currentModel) return
      // stale：RL-08/TOCTOU 防线——过期沙盒拒绝新命令，恢复动作由 HUD 提供
      if (currentSession.status === 'stale') return
      // 非活跃会话：先自动唤起 What-if 沙盒（正式数据零写入）
      if (currentSession.status !== 'active') {
        currentSession.enterSession(
          currentModel.tasks,
          currentModel.dependencies,
          calendarRef.current,
          `v_${Date.now()}`,
        )
      }
      const epochMs = currentModel.epochMs
      if (current.mode === 'move') {
        const newStartDay = Math.max(0, current.startDay + current.deltaDays)
        currentSession.executeCommand({
          kind: 'move-task',
          taskId: current.taskId,
          newStartDate: preciseDayToIso(epochMs, newStartDay),
        })
      } else {
        const newDurationDays = Math.max(1, current.durationDays + current.deltaDays)
        currentSession.executeCommand({
          kind: 'resize-duration',
          taskId: current.taskId,
          newStartDate: preciseDayToIso(epochMs, current.startDay),
          newEndDate: preciseDayToIso(epochMs, current.startDay + newDurationDays - 1),
        })
      }
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  if (!model) {
    return (
      <div
        data-precise-table
        data-precise-empty
        className="flex h-full items-center justify-center border-t border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] text-xs text-[var(--nx-text-muted)]"
      >
        暂无排程数据
      </div>
    )
  }

  const { tasks, dependencies, epochMs, timeRange } = model
  const gridStartDay = Math.max(0, timeRange.startDay)
  const gridEndDay = Math.min(timeRange.endDay, gridStartDay + MAX_GRID_DAYS)
  const gridDays: number[] = []
  for (let day = gridStartDay; day <= gridEndDay; day += 1) gridDays.push(day)
  const todayDay = Math.floor((Date.now() - epochMs) / MS_PER_DAY)

  const selectedChainIds = React.useMemo(() => {
    if (selectedTaskId === null) return new Set<number>()
    const chain = new Set<number>()
    for (const dep of dependencies) {
      if (dep.predecessorId === selectedTaskId) chain.add(dep.successorId)
      if (dep.successorId === selectedTaskId) chain.add(dep.predecessorId)
    }
    return chain
  }, [selectedTaskId, dependencies])

  const interactable = canEdit && session.status !== 'stale'

  const beginDrag = (task: GanttRenderTask, mode: 'move' | 'resize') => {
    return (event: React.PointerEvent) => {
      if (!interactable) return
      if (task.kind === 'milestone') return
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* jsdom 等无 Pointer Capture 实现时降级为 window 监听 */
      }
      const started: PreciseDragState = {
        taskId: task.id,
        mode,
        startX: event.clientX,
        startDay: task.startDay,
        durationDays: task.durationDays,
        deltaDays: 0,
      }
      dragRef.current = started
      setDrag(started)
    }
  }

  const renderGhost = (task: GanttRenderTask) => {
    if (!drag || drag.taskId !== task.id) return null
    const left = Math.max(0, task.startDay + drag.deltaDays - gridStartDay) * DAY_CELL_WIDTH
    const width =
      drag.mode === 'resize'
        ? Math.max(1, drag.durationDays + drag.deltaDays) * DAY_CELL_WIDTH
        : Math.max(1, task.durationDays) * DAY_CELL_WIDTH
    return (
      <div
        data-precise-ghost
        className="pointer-events-none absolute inset-y-0 opacity-40"
        style={{ left, width, backgroundColor: 'var(--nx-accent)' }}
      />
    )
  }

  const renderTaskBar = (task: GanttRenderTask) => {
    if (task.kind === 'milestone') {
      const milestoneDay = task.startDay
      if (milestoneDay < gridStartDay || milestoneDay > gridEndDay) return null
      return (
        <div className="relative h-[28px]" data-precise-row-bar={task.id}>
          <div
            data-precise-milestone={task.id}
            className="absolute flex h-full items-center justify-center text-xs"
            style={{
              left: (milestoneDay - gridStartDay) * DAY_CELL_WIDTH,
              width: DAY_CELL_WIDTH,
              color: STATUS_BAR_TOKEN[task.status] ?? 'var(--nx-text-muted)',
            }}
            aria-label={`里程碑：${task.name}`}
          >
            ◆
          </div>
          {renderGhost(task)}
        </div>
      )
    }

    const durationCells = Math.max(1, task.durationDays)
    if (task.startDay > gridEndDay) return null
    const gridOverflow = Math.max(0, gridStartDay - task.startDay)
    const visibleCells = Math.max(0, durationCells - gridOverflow)
    if (visibleCells === 0) return null
    const barLeft = (task.startDay - gridStartDay + gridOverflow) * DAY_CELL_WIDTH
    const barWidth = visibleCells * DAY_CELL_WIDTH

    return (
      <div className="relative h-[28px]" data-precise-row-bar={task.id}>
        {/* 发丝线日期网格（1px 重复渐变，非逐单元格 DOM） */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, var(--nx-border-hairline) 0 1px, transparent 1px ${DAY_CELL_WIDTH}px)`,
          }}
        />
        {/* 实色条 */}
        <div
          data-precise-bar={task.id}
          role="button"
          tabIndex={interactable ? 0 : -1}
          aria-label={`${task.name}（拖拽平移，右缘拉伸工期）`}
          onPointerDown={beginDrag(task, 'move')}
          className={cn(
            'absolute flex h-full cursor-default items-center overflow-hidden border border-[var(--nx-bg-0)] px-1 text-[10px] leading-none text-white',
            interactable && 'cursor-grab active:cursor-grabbing',
            selectedTaskId === task.id && 'ring-1 ring-[var(--nx-space-cyan)]',
          )}
          style={{ left: barLeft, width: barWidth, backgroundColor: STATUS_BAR_TOKEN[task.status] }}
        >
          <span className="pointer-events-none truncate">{task.name}</span>
          {task.progress > 0 ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 bg-black/25"
              style={{ width: `${Math.min(100, task.progress * 100)}%` }}
            />
          ) : null}
        </div>
        {/* 右缘工期拉伸手柄 */}
        {interactable && !drag ? (
          <div
            data-precise-resize
            role="slider"
            aria-label={`拉伸 ${task.name} 工期`}
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuenow={task.durationDays}
            onPointerDown={beginDrag(task, 'resize')}
            className="absolute inset-y-0 z-10 w-1.5 cursor-ew-resize bg-white/40 hover:bg-white/80"
            style={{ left: barLeft + barWidth - 3 }}
          />
        ) : null}
        {renderGhost(task)}
      </div>
    )
  }

  const predecessorBadges = (taskId: number) => {
    const preds = dependencies
      .filter((dep) => dep.successorId === taskId)
      .sort((a, b) => a.predecessorId - b.predecessorId)
    if (preds.length === 0) {
      return <span className="text-[var(--nx-text-muted)]">-</span>
    }
    return (
      <span className="flex flex-wrap gap-1">
        {preds.map((dep) => (
          <span
            key={dep.id}
            data-precise-dep-badge
            className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-px text-[10px] text-[var(--nx-text-secondary)]"
          >
            {dep.type.toUpperCase()} #{dep.predecessorId}
          </span>
        ))}
      </span>
    )
  }

  const dateRangeLabel = (task: GanttRenderTask) => {
    if (task.kind === 'milestone' || task.durationDays === 0) {
      return preciseDayToIso(epochMs, task.startDay)
    }
    return `${preciseDayToIso(epochMs, task.startDay)} ~ ${preciseDayToIso(epochMs, task.startDay + task.durationDays - 1)}`
  }

  const infoRowClass = (taskId: number) =>
    cn(
      'flex h-[28px] items-center gap-2 border-b border-[var(--nx-border-hairline)] px-2 text-xs',
      'text-[var(--nx-text-secondary)]',
      selectedTaskId === taskId && 'bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)]',
      selectedChainIds.has(taskId) && 'shadow-[inset_2px_0_0_var(--nx-space-cyan)]',
    )

  const headerRowClass =
    'flex items-center gap-2 border-b border-[var(--nx-border-hairline)] px-2 text-[10px] uppercase tracking-wide text-[var(--nx-text-muted)]'

  return (
    <div
      data-precise-table
      data-immersion={tier}
      data-precise-rows={tasks.length}
      className="h-full overflow-auto bg-[var(--nx-workspace-bg)]"
      role="region"
      aria-label="精确档甘特表格"
    >
      <div className="flex w-max min-w-full">
        {/* 左侧紧凑信息表（横向粘性固定） */}
        <aside className="sticky left-0 z-10 w-[440px] shrink-0 border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]">
          <div className={cn(headerRowClass, 'h-8')}>
            <span className="w-6 shrink-0">#</span>
            <span className="w-12 shrink-0">WBS</span>
            <span className="min-w-0 flex-1">任务名称</span>
            <span className="w-36 shrink-0">起止日期</span>
            <span className="w-12 shrink-0">工期</span>
            <span className="w-12 shrink-0">状态</span>
            <span className="w-10 shrink-0">负责人</span>
            <span className="w-24 shrink-0">前置</span>
          </div>
          {tasks.map((task, index) => (
            <div
              key={task.id}
              data-precise-row={task.id}
              data-precise-info-row
              onClick={() => setSelectedTaskId(task.id)}
              onDoubleClick={task.id > 0 && onOpenTask ? () => onOpenTask(task.id) : undefined}
              title={task.id > 0 && onOpenTask ? '双击打开任务详情' : undefined}
              onMouseEnter={() => setHoveredTaskId(task.id)}
              className={cn(infoRowClass(task.id), 'cursor-pointer')}
            >
              <span className="w-6 shrink-0 text-[var(--nx-text-muted)]">{index + 1}</span>
              <span className="w-12 shrink-0 truncate text-[var(--nx-text-muted)]">
                {task.wbsCode || '-'}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--nx-text-primary)]">
                {task.kind === 'milestone' ? `◆ ${task.name}` : task.name}
              </span>
              <span className="w-36 shrink-0 text-[10px]">{dateRangeLabel(task)}</span>
              <span className="w-12 shrink-0 text-[var(--nx-text-muted)]">
                {task.kind === 'milestone' ? '0天' : `${task.durationDays}天`}
              </span>
              <span className="w-12 shrink-0">{STATUS_LABEL[task.status]}</span>
              <span
                className="w-10 shrink-0 truncate text-[var(--nx-text-muted)]"
                title={task.assignee?.name}
              >
                {task.assignee?.initials || task.assignee?.name || '-'}
              </span>
              <span className="w-24 shrink-0">{predecessorBadges(task.id)}</span>
            </div>
          ))}
        </aside>

        {/* 右侧发丝线日期网格 */}
        <section aria-label="日期网格">
          <div
            className="relative flex h-8 border-b border-[var(--nx-border-hairline)]"
            data-precise-day-header
          >
            {gridDays.map((day) => {
              const isToday = day === todayDay
              const date = new Date(epochMs + day * MS_PER_DAY)
              const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
              return (
                <div
                  key={day}
                  data-precise-day-col={day}
                  data-precise-today-col={isToday || undefined}
                  className={cn(
                    'flex shrink-0 flex-col items-center justify-center border-r border-[var(--nx-border-hairline)] text-[10px] leading-tight',
                    weekend && 'bg-[var(--nx-bg-1)]',
                    isToday && 'bg-[var(--nx-workspace-blue)] font-medium text-white',
                    !isToday && 'text-[var(--nx-text-muted)]',
                  )}
                  style={{ width: DAY_CELL_WIDTH }}
                >
                  {isToday ? (
                    <span>今天</span>
                  ) : (
                    <>
                      <span>
                        {date.getUTCMonth() + 1}月{date.getUTCDate()}日
                      </span>
                      <span className="opacity-70">
                        周{['日', '一', '二', '三', '四', '五', '六'][date.getUTCDay()]}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          {tasks.map((task) => (
            <div
              key={task.id}
              data-precise-row={task.id}
              onClick={() => setSelectedTaskId(task.id)}
              onMouseEnter={() => setHoveredTaskId(task.id)}
              className={cn(
                'border-b border-[var(--nx-border-hairline)]',
                selectedTaskId === task.id && 'bg-[var(--nx-bg-0)]',
              )}
            >
              {renderTaskBar(task)}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

export default WorkspaceGanttPreciseTable
