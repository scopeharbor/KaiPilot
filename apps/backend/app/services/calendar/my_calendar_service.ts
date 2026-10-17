/**
 * 「我的日历」（日历第 3 批）：跨项目列出指派给我的任务（只看我是成员的项目，按组织隔离），
 * 附上我的个人工作日历（休假 / 个人工作日）与可新建任务的项目清单。
 */
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { PersonalWorkingCalendar } from '@aiproj/types'
import Task from '#models/task'
import type User from '#models/user'
import SearchPolicy from '#policies/search_policy'
import PersonalCalendarService from '#services/calendar/personal_calendar_service'
import { sortCalendarItems, taskToCalendarItem } from '#services/calendar/calendar_item_mapper'
import type { CalendarItem } from '#types/calendar_item'

/** 一次最多返回的任务数（跨项目窗口一般远小于此）。 */
export const MY_CALENDAR_LIMIT = 500

export interface MyCalendarResponse {
  data: CalendarItem[]
  meta: {
    total: number
    truncated: boolean
    unscheduledCount: number
    nearestScheduled?: { before: string | null; after: string | null }
  }
  personalCalendar: PersonalWorkingCalendar
  projects: Array<{ id: number; name: string; code: string | null }>
}

const iso = (value: unknown): string | null => {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

@inject()
export default class MyCalendarService {
  constructor(
    private searchPolicy: SearchPolicy,
    private personal: PersonalCalendarService,
  ) {}

  async list(
    user: User,
    organizationId: number,
    dateFrom: string,
    dateTo: string,
    today: string,
  ): Promise<MyCalendarResponse> {
    const projectIds = await this.searchPolicy.getAllowedProjectIds(user, organizationId)
    const projectRows =
      projectIds.length === 0
        ? []
        : ((await db
            .from('projects')
            .whereIn('id', projectIds)
            .where('organization_id', organizationId)
            .whereNull('deleted_at')
            .orderBy('name', 'asc')
            .select('id', 'name', 'code')) as Array<{
            id: number | string
            name: string
            code: string | null
          }>)
    const projects = projectRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      code: row.code,
    }))
    const visibleIds = projects.map((project) => project.id)
    const names = new Map(projects.map((project) => [project.id, project.name]))

    const mine = () =>
      db
        .from('tasks')
        .whereIn('project_id', visibleIds.length > 0 ? visibleIds : [0])
        .where('assignee_id', user.id)
        .where('assignee_type', 'user')
        .whereNull('deleted_at')

    const tasks =
      visibleIds.length === 0
        ? []
        : await Task.query()
            .whereIn('project_id', visibleIds)
            .where('assignee_id', user.id)
            .where('assignee_type', 'user')
            .whereNull('deleted_at')
            .whereRaw('COALESCE(start_date, end_date) <= ?', [dateTo])
            .whereRaw('COALESCE(end_date, start_date) >= ?', [dateFrom])
            .preload('assignee')
            .orderByRaw("COALESCE(start_date, end_date, '9999-12-31') ASC")
            .orderBy('id', 'asc')
            .limit(MY_CALENDAR_LIMIT + 1)

    const items = sortCalendarItems(
      tasks.slice(0, MY_CALENDAR_LIMIT).map((task) => ({
        ...taskToCalendarItem(task, today),
        projectName: names.get(Number(task.projectId)) ?? '',
      })),
    )

    let unscheduledCount = 0
    let nearestScheduled: MyCalendarResponse['meta']['nearestScheduled']
    if (visibleIds.length > 0) {
      const unscheduled = await mine()
        .whereNull('start_date')
        .whereNull('end_date')
        .count('* as count')
        .first()
      unscheduledCount = Number(unscheduled?.count ?? 0)
      if (items.length === 0) {
        const after = await mine()
          .whereRaw('COALESCE(start_date, end_date) > ?', [dateTo])
          .min({ value: db.raw('COALESCE(start_date, end_date)') })
          .first()
        const before = await mine()
          .whereRaw('COALESCE(end_date, start_date) < ?', [dateFrom])
          .max({ value: db.raw('COALESCE(end_date, start_date)') })
          .first()
        nearestScheduled = { before: iso(before?.value), after: iso(after?.value) }
      }
    }

    return {
      data: items,
      meta: {
        total: items.length,
        truncated: tasks.length > MY_CALENDAR_LIMIT,
        unscheduledCount,
        ...(nearestScheduled ? { nearestScheduled } : {}),
      },
      personalCalendar: this.personal.get(user),
      projects,
    }
  }
}
