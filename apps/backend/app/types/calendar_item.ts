/**
 * Calendar 完整版派生日历项类型。
 *
 * Calendar 是正式任务/里程碑的只读聚合视图，不新增持久化日历事件表。
 * 所有日历项由 TaskCalendarService / ProjectCalendarService 在查询时派生。
 *
 * @see openspec/changes/v2-calendar-full-view/specs/calendar-full-view/spec.md
 */

/** 日历项种类 */
export type CalendarItemKind = 'task' | 'milestone'

/** 日历项日期区间语义 */
export interface CalendarItemDateRange {
  /** 开始日期（ISO date string），任务 start_date 或里程碑 planned_date */
  start: string | null
  /** 结束日期（ISO date string），任务 end_date 或里程碑 planned_date */
  end: string | null
  /** 是否有跨日区间（start !== end 且两者齐全） */
  isSpan: boolean
  /** 是否缺少开始日期（只有结束日期——截止日单点） */
  missingStart: boolean
  /** 是否缺少结束日期（只有开始日期——开始日单点） */
  missingEnd: boolean
}

/** Calendar 完整版本派生日历项 */
export interface CalendarItem {
  /** 日历项唯一标识，格式 `task-{id}` 或 `milestone-{id}` */
  id: string
  kind: CalendarItemKind
  /** 源实体 ID（任务或里程碑的数据库 ID） */
  sourceId: number
  /** 项目 ID */
  projectId: number
  /** 项目名（「我的日历」跨项目时带上） */
  projectName?: string
  /** 名称 */
  name: string
  /** 状态（任务：not_started/in_progress/completed/blocked/on_hold/cancelled；里程碑：not_started/in_progress/achieved/missed/at_risk） */
  status: string
  /** 显示状态（用于里程碑推导态） */
  displayStatus?: string
  /** 优先级（仅任务有，里程碑无） */
  priority?: string
  /** 负责人信息（仅任务有） */
  assignee?: {
    id: number
    fullName: string | null
    email: string
    avatarUrl?: string | null
  } | null
  /** 日期区间 */
  dateRange: CalendarItemDateRange
  /** 是否为跨日/跨周区间 */
  isMultiDay: boolean
  /** 是否逾期 */
  isOverdue: boolean
  /** 详情入口路由 */
  detailUrl: string
}

/** Calendar 完整版查询响应 */
export interface CalendarFullResponse {
  data: CalendarItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
    /** 结果是否因上限被截断 */
    truncated?: boolean
    /** 未设置任何日期（无 start_date 和 end_date）的任务数量摘要 */
    unscheduledCount?: number
    /** 窗口内没有排期时：前后最近的排期日期（YYYY-MM-DD）。 */
    nearestScheduled?: { before: string | null; after: string | null }
  }
  /** 项目工作日历上下文 */
  workingCalendar?: CalendarWorkingCalendarContext
}

/** 工作日历上下文（仅供展示，不影响任务日期） */
export interface CalendarWorkingCalendarContext {
  /** 常规非工作日（0=周日，6=周六） */
  workdays: number[]
  /** 节假日（ISO date 数组） */
  holidays: string[]
  /** 调休日（ISO date 数组） */
  extraWorkdays: string[]
  /** 客户生产变更冻结（封网）窗口，仅作展示与投产排期参考 */
  changeFreezeWindows: Array<{ start: string; end: string; label: string }>
  /** 指定日期是否为非工作日 */
  isNonWorkingDay: (date: string) => boolean
  /** 指定日期是否为节假日 */
  isHoliday: (date: string) => boolean
  /** 指定日期是否为调休日 */
  isExtraWorkday: (date: string) => boolean
}

/** 日历查询模式 */
export type CalendarMode = 'deadline' | 'schedule'

/** Calendar 完整版查询筛选 */
export interface CalendarFullFilters {
  mode: CalendarMode
  view: 'month' | 'week' | 'day'
  anchorDate: string
  dateFrom?: string
  dateTo?: string
  search?: string
  status?: string
  priority?: string
  assigneeIds?: string
  itemTypes?: string
  page?: number
  perPage?: number
}
