'use client'

import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, PartyPopper, Plus } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { usePermissions } from '@/hooks/use-permissions'
import { useKanbanColumns, type KanbanPages } from '@/hooks/use-kanban'
import {
  KANBAN_COLUMNS,
  columnForStatus,
  kanbanApi,
  type KanbanColumn,
  type KanbanFilters,
} from '@/lib/api/kanban'
import type { Task, TaskStatus } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { canTransition, TASK_STATUS_LABELS } from '@/lib/task-status'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/components/ui/Toast'
import { OtherStatusSelectModal } from './OtherStatusSelectModal'
import { TaskPlacementSlot } from './TaskPlacementSlot'
import { WorkspaceKanbanColumn } from './WorkspaceKanbanColumn'
import { WorkspaceTaskCardContent } from './WorkspaceTaskCard'
import { AiTaskPlacementCard } from './AiTaskPlacementCard'
import { MoveBackConfirmModal } from './MoveBackConfirmModal'
import { applyStatusToSteps, readTaskSteps } from '@/lib/next/task-steps'

type Board = Record<KanbanColumn, Task[]>

const EMPTY_BOARD: Board = { pending: [], in_progress: [], completed: [], other: [] }
const INITIAL_PAGES: KanbanPages = { pending: 1, in_progress: 1, completed: 1, other: 1 }

export interface WorkspaceKanbanBoardProps {
  projectId: number
  /** 列筛选（缺省仅 25 条/页，无搜索/优先级/负责人过滤）。 */
  filters?: Omit<KanbanFilters, 'page'>
  /** 自定义各列放置插槽（缺省渲染 W3 的 TaskPlacementSlot）。 */
  placementSlots?: Partial<Record<KanbanColumn, ReactNode>>
  /** 卡片点击回调（W4 装配任务详情抽屉）。 */
  onOpenTask?: (taskId: number) => void
}

/**
 * 看板卡片的服务端签名：签名变了才把服务端数据同步进本地看板（本地看板为拖拽排位保留乐观状态）。
 * 卡片上看得到的字段都要算进来——此前只有 id / 状态 / 排位，AI 同事或别人改了负责人、名称、
 * 日期、优先级、进度后，数据已经重取，看板却不同步，要按 F5 才更新。
 */
export function kanbanTaskSignature(task: Task): string {
  return [
    task.id,
    task.status,
    task.kanbanRank,
    task.updatedAt ?? '',
    task.assigneeId ?? '',
    task.assignee?.fullName ?? '',
    task.name,
    task.priority,
    task.startDate ?? '',
    task.endDate ?? '',
    task.progressPercent,
  ].join(':')
}

/**
 * 工作面看板画板与拖拽流转控制器（v3-ui-next-project-space D4 / 任务 2.5）。
 *
 * 数据层 100% 复用成熟链路：`useKanbanColumns` 并行拉四列 → 逐列合并渲染
 * （任一列就绪即渲染，根除「单列拖累全板」首屏空窗）。
 *
 * 拖拽流转（@dnd-kit）：
 * - MouseSensor 距离阈值 6px；触屏延迟长按才拖拽，普通滑动保持原生滚动；
 * - 释放前经六态状态机 `canTransition` 校验，非法流转拦截并弹警示横幅，请求数恒为 0；
 * - 拖入「其他」列先弹 `OtherStatusSelectModal` 消解真实状态歧义；
 * - 合法移动本地乐观置位零延迟反馈，请求按顺序排队保存（远端库一次要几秒）：
 *   保存期间其它卡、甚至刚拖过的这张都能继续拖（2026-09-29：此前保存中全板锁住，
 *   刚拖到「进行中」第一张的卡拖不回来）；队列清空后 `invalidateTaskQueries` 刷新
 *   甘特 / WBS 等聚合视图；失败呈现琥珀色警告并以服务端数据为准重新加载；
 * - 进行中退回待处理会清空进度与已勾步骤：有进度时先确认；
 * - 权限防线（RL-06）：仅 `task:update` 或 `task:update:self` 且当前用户为
 *   assignee 时激活拖拽，只读成员卡片原位禁用并锁定光标。
 */
export function WorkspaceKanbanBoard({
  projectId,
  filters,
  placementSlots,
  onOpenTask,
}: WorkspaceKanbanBoardProps) {
  const mobile = useMobileWorkspace()
  const [mobileColumn, setMobileColumn] = useState<KanbanColumn>('pending')
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const currentUserId = useAuthStore((state) => state.user?.id)

  const [pages, setPages] = useState<KanbanPages>(INITIAL_PAGES)
  const [board, setBoard] = useState<Board>(EMPTY_BOARD)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  // 全部完成后的「一句话加新任务」
  const [composing, setComposing] = useState(false)
  // 退回待处理待确认：卡片先放进「待处理」，确认才保存，取消按 snapshot 放回原位
  const [backMove, setBackMove] = useState<{
    task: Task
    anchors: { beforeTaskId?: number; afterTaskId?: number }
    snapshot: Board
  } | null>(null)
  const confirmingRef = useRef(false)
  confirmingRef.current = backMove !== null
  // 排队保存的移动：保存中的卡片 id（可重复，同一张卡连续拖两次）
  const [savingIds, setSavingIds] = useState<number[]>([])
  const pendingRef = useRef(0)
  const moveQueue = useRef<Promise<void>>(Promise.resolve())
  const [resyncNonce, setResyncNonce] = useState(0)
  const [otherMove, setOtherMove] = useState<{
    task: Task
    beforeTaskId?: number
    afterTaskId?: number
  } | null>(null)

  const columnFilters = useMemo(() => ({ perPage: 25, ...filters }), [filters])
  const columnQueries = useKanbanColumns(projectId, columnFilters, pages)

  const queryDataSignature = columnQueries
    .map((query) => query.data?.data.map(kanbanTaskSignature).join(','))
    .join('|')
  useEffect(() => {
    // 还有移动在排队保存：本地排位比服务端新，先不覆盖（队列清空后会刷新并同步）
    if (pendingRef.current > 0 || confirmingRef.current) return
    // 逐列合并：任一列数据就绪即渲染该列，未就绪列保留上一次值——
    // 避免「某列慢/失败拖累全部列不出卡」的首屏空窗（design D4）。
    setBoard((prev) => ({
      pending: columnQueries[0]?.data?.data ?? prev.pending,
      in_progress: columnQueries[1]?.data?.data ?? prev.in_progress,
      completed: columnQueries[2]?.data?.data ?? prev.completed,
      other: columnQueries[3]?.data?.data ?? prev.other,
    }))
    // signature 追踪服务端行变化，不覆盖乐观更新产生的本地排位。
  }, [queryDataSignature, resyncNonce])

  function enqueueMove(input: Parameters<typeof kanbanApi.move>[1]) {
    pendingRef.current += 1
    setSavingIds((ids) => [...ids, input.taskId])
    moveQueue.current = moveQueue.current.then(async () => {
      let failed = false
      try {
        const result = await kanbanApi.move(projectId, input)
        // 服务端提示（如前置任务未完成、排期已顺延）即时告知操作者，项目经理同时收到通知
        for (const warning of result?.moveWarnings ?? []) {
          toast({ variant: 'warning', title: '请注意', description: warning, duration: 8000 })
        }
      } catch (error) {
        failed = true
        setMoveError(
          ((error as { message?: string }).message ?? '任务移动失败') + '，已按服务器数据恢复',
        )
      } finally {
        pendingRef.current -= 1
        setSavingIds((ids) => {
          const index = ids.indexOf(input.taskId)
          return index < 0 ? ids : [...ids.slice(0, index), ...ids.slice(index + 1)]
        })
        if (pendingRef.current === 0 || failed) {
          await invalidateTaskQueries(queryClient, projectId)
          // 服务端数据没变（如移动失败）时签名不变，要显式重同步一次
          if (pendingRef.current === 0) setResyncNonce((value) => value + 1)
        }
      }
    })
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** 拖拽许可：具备 task:update，或具备 task:update:self 且本人为 assignee（RL-06）。只看权限。 */
  const canMove = (task: Task) =>
    can('task:update') || (can('task:update:self') && task.assigneeId === currentUserId)
  // 不能拖的原因：只有「编辑自己任务」权限时说清是指派给了别人
  const lockReason = (task: Task) =>
    can('task:update:self') && !can('task:update')
      ? task.assigneeId
        ? '这张卡指派给了别人：你只能拖动指派给自己的任务'
        : '这张卡还没有指派负责人：你只能拖动指派给自己的任务'
      : '你没有编辑此任务的权限'

  // 待处理与进行中都空了、已完成里有卡：全部完成（按服务端总数判断，不受分页影响）
  const columnTotal = (index: number) =>
    columnQueries[index]?.data?.meta.total ?? (columnQueries[index]?.data ? 0 : null)
  const allDone = columnTotal(0) === 0 && columnTotal(1) === 0 && (columnTotal(2) ?? 0) > 0

  function executeMove(
    task: Task,
    targetColumn: KanbanColumn,
    targetStatus: TaskStatus,
    anchors: { beforeTaskId?: number; afterTaskId?: number } = {},
    note?: string,
  ) {
    if (!canTransition(task.status, targetStatus)) {
      setMoveError(
        task.status === 'not_started' && targetStatus === 'completed'
          ? `「${task.name}」还没开工，请先拖到“进行中”，完成后再拖到“已完成”。`
          : `不能从“${TASK_STATUS_LABELS[task.status]}”直接移动到“${TASK_STATUS_LABELS[targetStatus]}”。`,
      )
      return
    }
    setMoveError(null)
    const snapshot = cloneBoard(board)
    const next = cloneBoard(board)
    const sourceColumn = columnForStatus(task.status)
    next[sourceColumn] = next[sourceColumn].filter((item) => item.id !== task.id)
    const optimistic = applyStatusToSteps(task, targetStatus)
    const targetRows = next[targetColumn]
    const afterIndex = anchors.afterTaskId
      ? targetRows.findIndex((item) => item.id === anchors.afterTaskId)
      : -1
    if (afterIndex >= 0) targetRows.splice(afterIndex, 0, optimistic)
    else targetRows.push(optimistic)
    setBoard(next)
    // 退回待处理会把进度和已勾的步骤清零：有进度时先问一句（0% 的直接退回）。
    // 卡片先落在「待处理」再问——此前确认前卡片飞回原列、还盖住确认框，看起来像拖不过去（2026-09-29 用户反馈）
    if (
      task.status === 'in_progress' &&
      targetStatus === 'not_started' &&
      (task.progressPercent > 0 || readTaskSteps(task).done.some(Boolean))
    ) {
      setBackMove({ task, anchors, snapshot })
      return
    }
    enqueueMove({
      taskId: task.id,
      targetColumn,
      targetStatus,
      ...anchors,
      ...(note ? { note } : {}),
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const task = event.active.data.current?.task as Task | undefined
    if (!task || !event.over) return
    const overData = event.over.data.current as
      | { type: 'column'; column: KanbanColumn }
      | { type: 'task'; task: Task; column?: KanbanColumn }
      | undefined
    const targetColumn: KanbanColumn | undefined =
      overData?.type === 'task' ? overData.column : overData?.column
    if (!targetColumn || !KANBAN_COLUMNS.some((column) => column.id === targetColumn)) return

    const targetRows = board[targetColumn].filter((item) => item.id !== task.id)
    const overTask = overData?.type === 'task' ? overData.task : undefined
    const sameColumn = columnForStatus(task.status) === targetColumn
    // 同列放回空白处：不是排序意图，不发请求（此前会带上「当前页最后一张」作锚点，
    // 列里任务多于一页时被后端判为「锚点不在列尾」而报错）
    if (sameColumn && !overTask) return
    const afterIndex = overTask ? targetRows.findIndex((item) => item.id === overTask.id) : -1
    // 放到某张卡片之前：用相邻两张卡作锚点；放到列的空白处：不带锚点，由服务端追加到列尾
    // （本地只加载了一页，「当前页最后一张」不一定是整列最后一张）
    const anchors =
      afterIndex > 0
        ? {
            beforeTaskId: targetRows[afterIndex - 1]?.id,
            afterTaskId: targetRows[afterIndex]?.id,
          }
        : afterIndex === 0 && pages[targetColumn] === 1
          ? { afterTaskId: targetRows[0]?.id }
          : {}

    if (targetColumn === 'other' && columnForStatus(task.status) !== 'other') {
      // 「其他」列三态歧义：先弹快捷状态选择，确认后才发起移动（RL-01 零静默请求）。
      setOtherMove({ task, ...anchors })
      return
    }
    const targetStatus =
      targetColumn === 'other'
        ? task.status
        : KANBAN_COLUMNS.find((column) => column.id === targetColumn)!.statuses[0]!
    executeMove(task, targetColumn, targetStatus, anchors)
  }

  return (
    <div data-workspace-kanban-board aria-label="工作面看板" className="flex flex-col gap-3 py-4">
      {allDone ? (
        <div
          data-kanban-all-done
          className="flex flex-col gap-2 rounded-md border border-[var(--nx-status-success)]/40 bg-[var(--nx-status-success)]/5 px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--nx-text-primary)]">
            <PartyPopper className="h-4 w-4 text-[var(--nx-status-success)]" aria-hidden />
            <span className="font-medium">全部任务都完成了</span>
            <span className="text-xs text-[var(--nx-text-muted)]">
              还有新的事要做？一句话就能建。
            </span>
            <span className="ml-auto flex items-center gap-2">
              {can('task:create') && !composing ? (
                <button
                  type="button"
                  data-kanban-all-done-compose
                  onClick={() => setComposing(true)}
                  className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-2.5 text-xs font-medium text-[var(--nx-space-bg)]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  用一句话加新任务
                </button>
              ) : null}
              <Link
                href="/next/create"
                data-kanban-all-done-new-project
                className="text-xs text-[var(--nx-accent)] hover:underline"
              >
                开一个新项目 →
              </Link>
            </span>
          </div>
          {composing ? (
            <AiTaskPlacementCard
              projectId={projectId}
              columnId="pending"
              onClose={() => setComposing(false)}
            />
          ) : null}
        </div>
      ) : null}

      {moveError ? (
        <div
          role="alert"
          data-move-error
          className="flex items-center gap-2 rounded-md border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-3 py-2 text-xs text-[var(--nx-status-warning)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {moveError}
        </div>
      ) : null}

      {mobile ? (
        <div
          data-mobile-kanban-nav
          role="group"
          aria-label="任务状态"
          className="grid grid-cols-4 gap-1 rounded-xl bg-[var(--nx-bg-0)] p-1"
        >
          {KANBAN_COLUMNS.map((column, index) => (
            <button
              key={column.id}
              type="button"
              aria-pressed={mobileColumn === column.id}
              onClick={() => setMobileColumn(column.id)}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-xs ${mobileColumn === column.id ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-accent)] shadow-sm' : 'text-[var(--nx-text-muted)]'}`}
            >
              <span>{column.label}</span>
              <span className="font-mono">{columnTotal(index) ?? '…'}</span>
            </button>
          ))}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) =>
          setActiveTask((event.active.data.current?.task as Task | undefined) ?? null)
        }
        onDragCancel={() => setActiveTask(null)}
        onDragEnd={handleDragEnd}
      >
        <div
          role="region"
          aria-label={mobile ? '当前状态任务列表' : '工作面看板，可横向滑动'}
          className={
            mobile
              ? 'flex min-w-0 flex-col gap-3'
              : 'flex min-h-[420px] min-w-0 gap-3 overflow-x-auto pb-2'
          }
        >
          {KANBAN_COLUMNS.map((column, index) => {
            if (mobile && column.id !== mobileColumn) return null
            const result = columnQueries[index]
            const slot = placementSlots?.[column.id] ?? (
              <TaskPlacementSlot projectId={projectId} columnId={column.id} />
            )
            return (
              <WorkspaceKanbanColumn
                key={column.id}
                column={column}
                mobile={mobile}
                mobileAction={(task) =>
                  canMove(task) ? (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {task.status === 'not_started' || task.status === 'in_progress' ? (
                        <button
                          type="button"
                          disabled={savingIds.includes(task.id)}
                          onClick={() =>
                            executeMove(
                              task,
                              task.status === 'not_started' ? 'in_progress' : 'completed',
                              task.status === 'not_started' ? 'in_progress' : 'completed',
                            )
                          }
                          className="min-h-11 flex-1 rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 px-3 text-sm text-[var(--nx-accent)] disabled:opacity-50"
                        >
                          {savingIds.includes(task.id)
                            ? '保存中…'
                            : task.status === 'not_started'
                              ? '开始任务'
                              : '完成任务'}
                        </button>
                      ) : null}
                      <select
                        aria-label={`调整状态：${task.name}`}
                        value={task.status}
                        disabled={savingIds.includes(task.id)}
                        onChange={(event) => {
                          const status = event.target.value as TaskStatus
                          executeMove(task, columnForStatus(status), status)
                        }}
                        className="min-h-11 min-w-0 max-w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm text-[var(--nx-text-secondary)]"
                      >
                        {Object.entries(TASK_STATUS_LABELS).map(([status, label]) => (
                          <option
                            key={status}
                            value={status}
                            disabled={!canTransition(task.status, status as TaskStatus)}
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                      {task.status === 'in_progress' ? (
                        <button
                          type="button"
                          disabled={savingIds.includes(task.id)}
                          onClick={() => executeMove(task, 'pending', 'not_started')}
                          className="min-h-11 rounded-lg border border-[var(--nx-border-hairline)] px-3 text-sm text-[var(--nx-text-secondary)]"
                        >
                          退回待处理
                        </button>
                      ) : null}
                    </div>
                  ) : null
                }
                rows={board[column.id]}
                query={result?.data}
                loading={result?.isLoading ?? true}
                error={result?.isError ?? false}
                page={pages[column.id]}
                canMove={canMove}
                lockReason={lockReason}
                savingIds={savingIds}
                onOpen={onOpenTask}
                onPage={(page) => setPages((current) => ({ ...current, [column.id]: page }))}
                placementSlot={slot}
              />
            )
          })}
        </div>
        {/* 拖起的卡片：放大、微倾、带阴影跟手；松手时平滑落到目标位置 */}
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          {activeTask ? (
            <div
              data-kanban-drag-overlay
              className="w-[272px] rotate-2 scale-105 cursor-grabbing rounded-md shadow-2xl shadow-black/25 ring-2 ring-[var(--nx-border-focus)] motion-reduce:rotate-0 motion-reduce:scale-100"
            >
              <WorkspaceTaskCardContent task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <MoveBackConfirmModal
        task={backMove?.task ?? null}
        onConfirm={() => {
          if (!backMove) return
          enqueueMove({
            taskId: backMove.task.id,
            targetColumn: 'pending',
            targetStatus: 'not_started',
            ...backMove.anchors,
          })
          setBackMove(null)
        }}
        onCancel={() => {
          if (backMove) setBoard(backMove.snapshot)
          setBackMove(null)
        }}
      />

      <OtherStatusSelectModal
        open={otherMove !== null}
        task={otherMove?.task ?? null}
        onSelect={(status, note) => {
          if (!otherMove) return
          const { task, beforeTaskId, afterTaskId } = otherMove
          executeMove(task, 'other', status, { beforeTaskId, afterTaskId }, note)
          setOtherMove(null)
        }}
        onCancel={() => setOtherMove(null)}
      />
    </div>
  )
}

function cloneBoard(board: Board): Board {
  return {
    pending: [...board.pending],
    in_progress: [...board.in_progress],
    completed: [...board.completed],
    other: [...board.other],
  }
}

export default WorkspaceKanbanBoard
