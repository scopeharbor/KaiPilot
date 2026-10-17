'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { taskListViewApi, type TaskListViewFilters } from '@/lib/api/list-view'
import { parseListViewState, serializeListViewState } from '@/lib/list-view-state'
import { taskKeys } from '@/lib/api/tasks'

export function useTaskListView(projectId: number, filters: TaskListViewFilters) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: taskKeys.view(projectId, 'list', filters),
    queryFn: () => taskListViewApi.list(projectId, filters),
    enabled: isAuthenticated,
  })
}

export function useListViewUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const state = useMemo(() => parseListViewState(searchParams), [searchParams])

  const update = useCallback(
    (
      patch: Partial<TaskListViewFilters>,
      options: { resetPage?: boolean; replace?: boolean } = {},
    ) => {
      const next = {
        ...state,
        ...patch,
        ...(options.resetPage === false ? {} : { page: 1 }),
      }
      const query = serializeListViewState(next)
      const href = query ? `${pathname}?${query}` : pathname
      if (options.replace === false) router.push(href)
      else router.replace(href, { scroll: false })
    },
    [pathname, router, state],
  )

  return { state, update }
}
