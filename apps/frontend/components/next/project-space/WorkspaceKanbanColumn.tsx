'use client'

import { useDndContext, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { KANBAN_COLUMNS } from '@/lib/api/kanban'
import type { PaginatedTasks, Task } from '@/lib/api/tasks'
import { cn } from '@/lib/utils'
import { WorkspaceTaskCard } from './WorkspaceTaskCard'

type KanbanColumnDef = (typeof KANBAN_COLUMNS)[number]

export interface WorkspaceKanbanColumnProps {
  /** 列定义（KANBAN_COLUMNS 四列投影之一）。 */
  mobile?: boolean
  mobileAction?: (task: Task) => ReactNode
  column: KanbanColumnDef
  /** 当前渲染的任务行（含乐观更新后的本地排位）。 */
  rows: Task[]
  /** 该列服务端查询结果（取 meta.total 计数与分页）。 */
  query?: PaginatedTasks
  loading?: boolean
  error?: boolean
  page?: number
  /** 卡片拖拽许可判定（无权限时卡片原位禁用并锁定光标，RL-06）。 */
  canMove?: (task: Task) => boolean
  /** 不能拖时的原因。 */
  lockReason?: (task: Task) => string
  /** 正在排队保存移动的卡（仍可继续拖）。 */
  savingIds?: readonly number[]
  /** 卡片点击打开详情（W4 装配任务详情抽屉）。 */
  onOpen?: (taskId: number) => void
  /** 分页切换。 */
  onPage?: (page: number) => void
  /** 列内原位放置任务插槽（W4 装配 W3 的 TaskPlacementSlot）。 */
  placementSlot?: ReactNode
}

/**
 * 工作面看板单列（v3-ui-next-project-space D4 / 任务 2.3）。
 *
 * - `useDroppable` 挂载整列为放置目标（id `column-${column.id}`，data 携带列类型）；
 * - 列头展示状态名与任务计数（服务端 total 优先，本地行数兜底）；
 * - 列内常驻 `SortableContext` 垂直排序卡片列表，逐列独立；
 * - 任一列未就绪不拖累其他列：loading 呈现发丝骨架，error 呈现中性失败文案。
 */
export function WorkspaceKanbanColumn({
  column,
  mobile = false,
  mobileAction,
  rows,
  query,
  loading = false,
  error = false,
  page = 1,
  canMove,
  lockReason,
  savingIds = [],
  onOpen,
  onPage,
  placementSlot,
}: WorkspaceKanbanColumnProps) {
  const droppable = useDroppable({
    id: `column-${column.id}`,
    data: { type: 'column', column: column.id },
  })
  const total = query?.meta.total ?? rows.length
  // 悬停在本列的任一张卡上也算「放到本列」：只看列本身的话，列里有卡时几乎不会高亮
  const { active, over } = useDndContext()
  const overData = over?.data.current as { column?: string } | undefined
  const isOver =
    Boolean(active) &&
    over?.id !== active?.id &&
    (droppable.isOver || overData?.column === column.id)

  return (
    <section
      ref={droppable.setNodeRef}
      data-kanban-column={column.id}
      aria-labelledby={`workspace-kanban-${column.id}`}
      className={cn(
        mobile
          ? 'flex min-w-0 flex-col'
          : 'flex min-w-[220px] flex-1 basis-0 flex-col rounded-md border border-[var(--nx-border-hairline)]',
        'bg-[var(--nx-workspace-bg)]/70 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none',
        isOver &&
          'border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/5 shadow-[inset_0_0_0_1px_var(--nx-border-focus)]',
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--nx-border-hairline)] px-3">
        <h3
          id={`workspace-kanban-${column.id}`}
          className="text-xs font-medium tracking-wide text-[var(--nx-text-primary)]"
        >
          {column.label}
        </h3>
        <span
          data-kanban-count
          className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
        >
          {total}
        </span>
      </header>

      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {placementSlot ? <div data-placement-slot-area>{placementSlot}</div> : null}

        {loading
          ? Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                data-kanban-skeleton
                className="h-24 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] motion-reduce:animate-none"
              />
            ))
          : null}

        {error ? (
          <p data-kanban-column-error className="p-3 text-xs text-[var(--nx-text-muted)]">
            本列加载失败
          </p>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <div
            data-kanban-empty
            className={cn(
              'rounded-md border border-dashed px-3 py-8 text-center text-xs transition-colors duration-150',
              isOver
                ? 'border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 text-[var(--nx-accent)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
            )}
          >
            {isOver
              ? '松手放到这里'
              : mobile
                ? '当前状态暂无任务，点击上方新建任务'
                : '可将任务拖到这里'}
          </div>
        ) : null}

        <SortableContext
          items={rows.map((task) => `task-${task.id}`)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-2" aria-label={`${column.label}任务列表`}>
            {rows.map((task) => (
              <li
                key={task.id}
                className={
                  mobile
                    ? 'list-none rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4'
                    : 'list-none'
                }
              >
                <WorkspaceTaskCard
                  task={task}
                  disabled={!canMove?.(task)}
                  dragDisabled={mobile}
                  lockReason={mobile ? undefined : lockReason?.(task)}
                  saving={savingIds.includes(task.id)}
                  onOpen={onOpen}
                />
                {mobile ? mobileAction?.(task) : null}
              </li>
            ))}
          </ul>
        </SortableContext>
      </div>

      {query && query.meta.totalPages > 1 ? (
        <footer className="flex shrink-0 items-center justify-between border-t border-[var(--nx-border-hairline)] px-3 py-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage?.(Math.max(1, page - 1))}
            aria-label={`${column.label}上一页`}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="text-xs text-[var(--nx-text-muted)]">
            {query.meta.page} / {query.meta.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= query.meta.totalPages}
            onClick={() => onPage?.(page + 1)}
            aria-label={`${column.label}下一页`}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </footer>
      ) : null}
    </section>
  )
}

export default WorkspaceKanbanColumn
