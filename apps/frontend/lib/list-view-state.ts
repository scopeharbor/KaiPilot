import {
  LIST_SORT_FIELDS,
  type ListSortField,
  type ListSortTerm,
  type TaskListViewFilters,
} from '@/lib/api/list-view'
import type { TaskPriority, TaskStatus } from '@/lib/api/tasks'

const STATUSES = new Set<TaskStatus>([
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
])
const PRIORITIES = new Set<TaskPriority>(['lowest', 'low', 'medium', 'high', 'highest'])
const SORT_FIELDS = new Set<string>(LIST_SORT_FIELDS)
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface SearchParamsReader {
  get(name: string): string | null
}

function list<T extends string>(value: string | null, allowed: Set<T>): T[] | undefined {
  const values = value?.split(',').filter((item): item is T => allowed.has(item as T))
  return values?.length ? [...new Set(values)] : undefined
}

function positiveInteger(value: string | null, fallback: number, maximum = 100000) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback
}

export function parseListViewState(
  params: SearchParamsReader,
): Required<Pick<TaskListViewFilters, 'page' | 'perPage' | 'sort'>> & TaskListViewFilters {
  const rawSort = params.get('sort')?.split(',') ?? []
  const sort = rawSort
    .filter((term): term is ListSortTerm => {
      const direction = term[0]
      return (
        (direction === '+' || direction === '-') && SORT_FIELDS.has(term.slice(1) as ListSortField)
      )
    })
    .filter(
      (term, index, terms) => terms.findIndex((item) => item.slice(1) === term.slice(1)) === index,
    )
    .slice(0, 3)

  const assigneeIds = (params.get('assigneeId')?.split(',') ?? [])
    .map(Number)
    .filter((value, index, values) => value > 0 && values.indexOf(value) === index)

  return {
    search: params.get('search')?.trim() || undefined,
    statuses: list(params.get('status'), STATUSES),
    priorities: list(params.get('priority'), PRIORITIES),
    assigneeIds: assigneeIds.length ? assigneeIds : undefined,
    dateFrom: DATE_PATTERN.test(params.get('dateFrom') ?? '') ? params.get('dateFrom')! : undefined,
    dateTo: DATE_PATTERN.test(params.get('dateTo') ?? '') ? params.get('dateTo')! : undefined,
    sort: sort.length ? sort : ['+name'],
    page: positiveInteger(params.get('page'), 1),
    perPage: positiveInteger(params.get('perPage'), 50, 100),
  }
}

export function serializeListViewState(filters: TaskListViewFilters) {
  const query = new URLSearchParams()
  if (filters.search) query.set('search', filters.search)
  if (filters.statuses?.length) query.set('status', filters.statuses.join(','))
  if (filters.priorities?.length) query.set('priority', filters.priorities.join(','))
  if (filters.assigneeIds?.length) query.set('assigneeId', filters.assigneeIds.join(','))
  if (filters.dateFrom) query.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) query.set('dateTo', filters.dateTo)
  if (filters.sort?.length && filters.sort.join(',') !== '+name') {
    query.set('sort', filters.sort.join(','))
  }
  if (filters.page && filters.page !== 1) query.set('page', String(filters.page))
  if (filters.perPage && filters.perPage !== 50) query.set('perPage', String(filters.perPage))
  return query.toString()
}
