'use client'

import * as React from 'react'
import { KANBAN_COLUMNS } from '@/lib/api/kanban'
import { Plus } from 'lucide-react'
import type { KanbanColumn } from '@/lib/api/kanban'
import type { Task } from '@/lib/api/tasks'
import { usePermissions } from '@/hooks/use-permissions'
import { AiTaskPlacementCard } from './AiTaskPlacementCard'

export const PLACEMENT_SLOT_BLOCKED_TIP = '你没有在该项目中创建任务的权限'

export interface TaskPlacementSlotProps {
  projectId: number
  /** 所属看板列（放置补全继承该列初始状态）。 */
  columnId: KanbanColumn
  /** 受控展开态（W4 全局快捷键 P 由容器持有并驱动）；缺省组件内部自管理。 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 创建成功回调（W4 装配：通知看板插入列顶）。 */
  onCreated?: (task: Task) => void
}

/**
 * 列内放置任务原位插槽（v3-ui-next-project-space D5 / 任务 3.3）。
 *
 * - 列顶部常驻发丝线卡槽「+ 放置任务到此列」：点击（或双击空白）即在列内
 *   原地展开 `TaskPlacementCard` 意图输入，展开态由受控/非受控混合驱动；
 * - 无 `task:create` 权限时原位禁用并锁定光标（RL-06 展示层守卫，
 *   最终边界在服务端 RBAC）；
 * - 展开后占位空间被卡片接管，收起后恢复卡槽（零网络请求，RL-01）。
 */
export function TaskPlacementSlot({
  projectId,
  columnId,
  open,
  onOpenChange,
  onCreated,
}: TaskPlacementSlotProps) {
  const { can } = usePermissions()
  const canCreate = can('task:create')
  const [internalOpen, setInternalOpen] = React.useState(false)

  const isOpen = (open ?? internalOpen) && canCreate
  const setOpen = (next: boolean) => {
    if (!canCreate) return
    setInternalOpen(next)
    onOpenChange?.(next)
  }

  if (isOpen) {
    return (
      // 一句话 → AI 补全任务卡 → 核对 → 确认创建（原先只有规则推断工期 / 优先级）
      <AiTaskPlacementCard
        projectId={projectId}
        columnId={columnId}
        onClose={() => setOpen(false)}
        onCreated={onCreated}
      />
    )
  }

  return (
    <button
      type="button"
      data-placement-slot
      aria-label={`在「${KANBAN_COLUMNS.find((column) => column.id === columnId)?.label ?? columnId}」列新建任务`}
      aria-disabled={!canCreate}
      disabled={!canCreate}
      title={!canCreate ? PLACEMENT_SLOT_BLOCKED_TIP : undefined}
      onClick={() => setOpen(true)}
      onDoubleClick={() => setOpen(true)}
      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-transparent text-xs text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      在此列新建任务
    </button>
  )
}

export default TaskPlacementSlot
