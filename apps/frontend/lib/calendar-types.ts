import type { PersonalWorkingCalendar } from '@aiproj/types'

/** 前端 Calendar 完整版派生日历项类型 */

export type CalendarItemKind = 'task' | 'milestone'

export interface CalendarItemDateRange {
  start: string | null
  end: string | null
  isSpan: boolean
  missingStart: boolean
  missingEnd: boolean
}

export interface CalendarItem {
  id: string
  kind: CalendarItemKind
  sourceId: number
  projectId: number
  /** 项目名（「我的日历」跨项目时带上）。 */
  projectName?: string
  name: string
  status: string
  displayStatus?: string
  priority?: string
  assignee?: {
    id: number
    fullName: string | null
    email: string
    avatarUrl?: string | null
  } | null
  dateRange: CalendarItemDateRange
  isMultiDay: boolean
  isOverdue: boolean
  detailUrl: string
}

export interface CalendarFullResponse {
  data: CalendarItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
    truncated?: boolean
    unscheduledCount?: number
    /** 窗口内没有排期时：前后最近的排期日期（YYYY-MM-DD）。 */
    nearestScheduled?: { before: string | null; after: string | null }
  }
  workingCalendar?: {
    workdays: number[]
    holidays: string[]
    extraWorkdays: string[]
    /** 客户生产变更冻结（封网）窗口 */
    changeFreezeWindows?: Array<{ start: string; end: string; label: string }>
  }
  /** 「我的日历」：我的个人工作日历（休假 / 个人工作日）。 */
  personalCalendar?: PersonalWorkingCalendar
  /** 「我的日历」：我是成员的项目（快速新建时选项目）。 */
  projects?: Array<{ id: number; name: string; code: string | null }>
}

export type CalendarMode = 'deadline' | 'schedule'
