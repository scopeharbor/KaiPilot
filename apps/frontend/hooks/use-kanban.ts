'use client'

import { useQueries } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { KANBAN_COLUMNS, kanbanApi, type KanbanColumn, type KanbanFilters } from '@/lib/api/kanban'
import { taskKeys } from '@/lib/api/tasks'

export type KanbanPages = Record<KanbanColumn, number>

export function useKanbanColumns(
  projectId: number,
  filters: Omit<KanbanFilters, 'page'>,
  pages: KanbanPages,
) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQueries({
    queries: KANBAN_COLUMNS.map((column) => {
      const columnFilters = { ...filters, page: pages[column.id] }
      return {
        queryKey: taskKeys.view(projectId, `kanban-${column.id}`, columnFilters),
        queryFn: () => kanbanApi.listColumn(projectId, column.id, columnFilters),
        enabled: isAuthenticated,
      }
    }),
  })
}
