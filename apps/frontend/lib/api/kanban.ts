import { apiFetchEnvelope } from '@/lib/api-client'
import type { PaginatedTasks, Task, TaskPriority, TaskStatus } from '@/lib/api/tasks'

export type KanbanColumn = 'pending' | 'in_progress' | 'completed' | 'other'

export interface KanbanFilters {
  priority?: TaskPriority
  assigneeId?: number
  search?: string
  page?: number
  perPage?: number
}

export interface MoveKanbanTaskInput {
  taskId: number
  targetColumn: KanbanColumn
  targetStatus?: TaskStatus
  beforeTaskId?: number
  afterTaskId?: number
  /** 移入「其他」列时的说明（阻塞 / 暂停原因）。 */
  note?: string
}

/** 看板移动结果：任务 + 服务端提示（如前置任务未完成）。 */
export type KanbanMoveResult = Task & { moveWarnings?: string[] }

function buildQuery(column: KanbanColumn, filters: KanbanFilters) {
  const query = new URLSearchParams({ column })
  if (filters.priority) query.set('priority', filters.priority)
  if (filters.assigneeId) query.set('assigneeId', String(filters.assigneeId))
  if (filters.search) query.set('search', filters.search)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.toString()
}

export const kanbanApi = {
  listColumn: (projectId: number, column: KanbanColumn, filters: KanbanFilters = {}) =>
    apiFetchEnvelope<PaginatedTasks>(
      `/projects/${projectId}/kanban?${buildQuery(column, filters)}`,
    ),
  move: async (projectId: number, input: MoveKanbanTaskInput): Promise<KanbanMoveResult> => {
    const envelope = await apiFetchEnvelope<{ data: Task; meta?: { warnings?: string[] } }>(
      `/projects/${projectId}/kanban/move`,
      { method: 'POST', body: JSON.stringify(input) },
    )
    const warnings = envelope?.meta?.warnings ?? []
    return warnings.length ? { ...envelope.data, moveWarnings: warnings } : envelope.data
  },
}

export const KANBAN_COLUMNS: Array<{
  id: KanbanColumn
  label: string
  statuses: readonly TaskStatus[]
}> = [
  { id: 'pending', label: '待处理', statuses: ['not_started'] },
  { id: 'in_progress', label: '进行中', statuses: ['in_progress'] },
  { id: 'completed', label: '已完成', statuses: ['completed'] },
  { id: 'other', label: '其他', statuses: ['blocked', 'on_hold', 'cancelled'] },
]

export function columnForStatus(status: TaskStatus): KanbanColumn {
  return KANBAN_COLUMNS.find((column) => column.statuses.includes(status))?.id ?? 'other'
}

export const kanbanKeys = {
  all: ['kanban'] as const,
  columns: (projectId: number) => [...kanbanKeys.all, 'columns', projectId] as const,
  column: (projectId: number, column: KanbanColumn, filters: KanbanFilters = {}) =>
    [...kanbanKeys.columns(projectId), column, filters] as const,
}
