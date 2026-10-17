/**
 * 列表精确面板镜头（WorkspaceListLens）—— 高密度行格式化与查询参数组装纯函数层
 * （v3-ui-next-remaining-lenses W2，独立 adapter 文件，防并行 worker 冲突）。
 *
 * 职责（tasks 2.1 / design「列表数据适配纯函数」）：
 * - `formatTaskRows`：`Task[]` → 高密度表格行视图模型 `FormattedTaskRow[]`，
 *   解析 6 状态发丝线令牌、5 档优先级徽章、负责人（缩写 / AI Agent 专属微标判定）、
 *   等宽 `startDate ~ endDate` 时间戳、工期天数与 0~100 进度百分比；
 * - `withMemberAssignees`：`tasksApi.list` 响应不内嵌 assignee 用户详情时，
 *   用 `projectMembersApi.list` 的成员索引补齐人类负责人姓名与缩写（只读派生态）；
 * - 排序 / 筛选 / 分页状态 → `TaskListFilters`（服务端联动）+ URL 序列化辅助；
 * - 纯函数、零 DOM / 零 React 状态，jsdom 与 SSR 均可安全使用。
 *
 * 数据真相与缺口（如实记录，供 W5 集成与后续增强参考）：
 * 1. `GET /projects/:id/tasks`（tasksApi.list）的 TaskDto 仅携带 `assigneeId` /
 *    `assigneeType` 等标量，**不预载** assignee / reviewer / parent 关联，
 *    也不携带 WBS 节点名称——WBS 归属编码需另行 join `wbs-tree`（与甘特
 *    `model-from-api.ts` 的 wbsCode 初版留空同一数据缺口）。因此：
 *    - `code`：任务编号 `#<id>`（与旧轨列表行一致的等宽编号语义）；
 *    - `wbsLabel`：退化为任务层级标签（`raw.parent?.name`，parent 为空时 '—'），
 *      表头呈现为「归属」，绝不虚构不存在的 WBS 名称；
 *    - 人类负责人由 `withMemberAssignees` 以成员索引补齐（内部行 fallback '—'，
 *      `assigneeId === null` 的真未分配才显示「未分配」）。
 * 2. 状态发丝线令牌 / 文案必须与 `lib/gantt/next-gantt-adapter.ts` 的
 *    `NEXT_STATUS_HAIRLINE_TOKEN` 保持同值（--nx-* 令牌），改色需两边同步。
 */
import type { ProjectMember } from '@/lib/api/projects'
import type { Task, TaskListFilters, TaskPriority, TaskStatus } from '@/lib/api/tasks'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { isAgentAssignee } from '@/types/agent-assignee'

const MS_PER_DAY = 86_400_000

/** 6 状态标准顺序（工具栏下拉与服务端枚举对齐）。 */
export const LIST_STATUS_ORDER: readonly TaskStatus[] = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
]

/** 5 档优先级标准顺序（最低 → 最高）。 */
export const LIST_PRIORITY_ORDER: readonly TaskPriority[] = [
  'lowest',
  'low',
  'medium',
  'high',
  'highest',
]

/** 状态中文文案（复用全平台共享 `TASK_STATUS_LABELS`，单一事实来源）。 */
export const LIST_STATUS_LABEL: Record<TaskStatus, string> = TASK_STATUS_LABELS

/** 优先级中文文案（与工作面卡片 `最低/低/中/高/最高` 同文案）。 */
export const LIST_PRIORITY_LABEL: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

/**
 * 任务 6 状态 → 发丝线微标令牌名（`var(<token>)` 消费；值同步甘特镜头
 * `NEXT_STATUS_HAIRLINE_TOKEN`，设计 spec「列表精确面板」要求消费同语义信号色）。
 */
export const LIST_STATUS_HAIRLINE_TOKEN: Record<TaskStatus, string> = {
  completed: '--nx-status-success',
  in_progress: '--nx-space-cyan',
  not_started: '--nx-text-muted',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

/**
 * 5 档优先级徽章令牌名（文本 / 发丝边框同色，低两档静默中性、高两档语义警示色，
 * 与工作面卡片优先级双通道色板一致）。
 */
export const LIST_PRIORITY_TOKEN: Record<TaskPriority, string> = {
  lowest: '--nx-text-muted',
  low: '--nx-text-muted',
  medium: '--nx-text-secondary',
  high: '--nx-status-warning',
  highest: '--nx-status-danger',
}

/** 分页档位（服务端 perPage ≤ 100；spec 默认每页 25，可选 50）。 */
export const LIST_PAGE_SIZE_OPTIONS: readonly number[] = [25, 50] as const

/** 默认每页条数。 */
export const LIST_DEFAULT_PER_PAGE = 25

/** 工具栏搜索最大长度（后端 listTasksValidator 上限 255）。 */
export const LIST_MAX_SEARCH_LENGTH = 255

/** 日期范围分隔符（等宽时间戳，如 `2026-09-01 ~ 2026-09-30`）。 */
export const LIST_DATE_SPAN_SEPARATOR = ' ~ '

/** 缺省占位符（无数据 / 接口未附带）。 */
export const LIST_EMPTY_PLACEHOLDER = '—'

// ---------------------------------------------------------------------------
// 高密度行视图模型
// ---------------------------------------------------------------------------

export interface FormattedTaskRow {
  id: number
  /** 任务名称（原样）。 */
  name: string
  /** 任务编号 `#<id>`（等宽；旧轨列表同语义，见文件头数据缺口说明）。 */
  code: string
  /** 归属层级标签（parent 任务名；无则 '—'，绝不虚构 WBS 名称）。 */
  wbsLabel: string
  status: TaskStatus
  /** 状态中文文案（工具栏下拉 / 徽章 / aria 共用）。 */
  statusLabel: string
  /** 状态发丝线令牌名（消费 `var(<token>)`）。 */
  statusToken: string
  priority: TaskPriority
  /** 优先级中文文案。 */
  priorityLabel: string
  /** 优先级徽章令牌名。 */
  priorityToken: string
  /** 负责人显示名（agent：名称或 'AI'；human：内嵌/成员补齐；真未分配：'未分配'）。 */
  assigneeName: string
  /** 负责人姓名缩写（human 圆形微标内文案；无法解析时 '—'）。 */
  assigneeInitials: string
  /** AI Agent 专属徽章判定（`assigneeType === 'agent'`）。 */
  isAgentAssignee: boolean
  /** `YYYY-MM-DD ~ YYYY-MM-DD` 等宽时间戳；起止均缺省时 '—'。 */
  dateSpanText: string
  /** 起止单侧原始日期（未设置为 null，供排序/aria/详情面板）。 */
  dateStart: string | null
  dateEnd: string | null
  /** 工期天数（后端 durationDays 缺失时由起止日期推算，含首尾）。 */
  durationDays: number | null
  /** 工期文案（`N 天`；无法推算时 '—'）。 */
  durationText: string
  /** 进度百分比（钳制 0~100）。 */
  progressPercent: number
  /** 原始任务（详情预览 / 回调透传）。 */
  raw: Task
}

/** 解析 'YYYY-MM-DD' → UTC 毫秒；null/非法 → null。 */
function parseIsoMs(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

/** 含首尾的跨天天数（end ≥ start 时 ≥ 1）。 */
function inclusiveDays(startDate: string | null, endDate: string | null): number | null {
  const startMs = parseIsoMs(startDate)
  const endMs = parseIsoMs(endDate)
  if (startMs === null || endMs === null) return null
  const days = Math.round((endMs - startMs) / MS_PER_DAY) + 1
  return Math.max(1, days)
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, progress))
}

/**
 * `Task[]` → 高密度表格行视图模型（纯函数，不修改入参）。
 *
 * 负责人派生规则（isAgentAssignee / assigneeType === 'agent'）：
 * - agent：名称与缩写取 `agentAssignee`，接口未附带时回退 'AI'；
 * - human 且 `assigneeId === null`：真未分配 → '未分配' / '—'；
 * - human 且已设负责人但响应未内嵌 assignee：占位 '—'，交由
 *   `withMemberAssignees`（成员索引）补齐。
 */
export function formatTaskRows(tasks: readonly Task[]): FormattedTaskRow[] {
  const rows: FormattedTaskRow[] = []
  for (const task of tasks) {
    const isAgent = isAgentAssignee(task.assigneeType)
    const embedded = task.assignee
    let assigneeName: string
    let assigneeInitials: string
    if (isAgent) {
      assigneeName = task.agentAssignee?.name?.trim() || 'AI'
      assigneeInitials = task.agentAssignee?.initials?.trim() || 'AI'
    } else if (task.assigneeId === null) {
      assigneeName = '未分配'
      assigneeInitials = LIST_EMPTY_PLACEHOLDER
    } else if (embedded) {
      assigneeName = embedded.fullName?.trim() || embedded.email || LIST_EMPTY_PLACEHOLDER
      assigneeInitials =
        embedded.initials?.trim() ||
        (embedded.fullName ? embedded.fullName.slice(0, 1) : LIST_EMPTY_PLACEHOLDER)
    } else {
      assigneeName = LIST_EMPTY_PLACEHOLDER
      assigneeInitials = LIST_EMPTY_PLACEHOLDER
    }

    const dateStart = task.startDate ?? null
    const dateEnd = task.endDate ?? null
    const durationDays =
      task.durationDays !== null && task.durationDays > 0
        ? Math.round(task.durationDays)
        : inclusiveDays(dateStart, dateEnd)
    const parentName = task.parent?.name?.trim()

    rows.push({
      id: task.id,
      name: task.name,
      code: `#${task.id}`,
      wbsLabel: parentName || LIST_EMPTY_PLACEHOLDER,
      status: task.status,
      statusLabel: LIST_STATUS_LABEL[task.status],
      statusToken: LIST_STATUS_HAIRLINE_TOKEN[task.status],
      priority: task.priority,
      priorityLabel: LIST_PRIORITY_LABEL[task.priority],
      priorityToken: LIST_PRIORITY_TOKEN[task.priority],
      assigneeName,
      assigneeInitials,
      isAgentAssignee: isAgent,
      dateSpanText:
        dateStart === null && dateEnd === null
          ? LIST_EMPTY_PLACEHOLDER
          : `${dateStart ?? LIST_EMPTY_PLACEHOLDER}${LIST_DATE_SPAN_SEPARATOR}${dateEnd ?? LIST_EMPTY_PLACEHOLDER}`,
      dateStart,
      dateEnd,
      durationDays,
      durationText: durationDays !== null ? `${durationDays} 天` : LIST_EMPTY_PLACEHOLDER,
      progressPercent: clampProgress(task.progressPercent),
      raw: task,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// 人类负责人成员补齐（tasksApi.list 不预载 assignee 时的只读派生态）
// ---------------------------------------------------------------------------

export interface MemberAssigneeRef {
  userId: number
  fullName: string | null
  email: string
  initials: string
}

/**
 * `ProjectMember[]` → userId → 用户引用索引（key 为 `user.id`，即任务
 * `assigneeId` 指向的 users 表主键；member.user 未附带的防御性回退 `userId`）。
 */
export function buildMemberAssigneeIndex(
  members: readonly ProjectMember[],
): ReadonlyMap<number, MemberAssigneeRef> {
  const index = new Map<number, MemberAssigneeRef>()
  for (const member of members) {
    const user = member.user
    if (!user) continue
    const ref: MemberAssigneeRef = {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      initials: user.initials,
    }
    // 同 userId 多条成员记录时取先到者（行为确定）。
    if (!index.has(user.id)) index.set(user.id, ref)
  }
  return index
}

/**
 * 用成员索引补齐人类负责人占位行（纯函数，返回新数组）。
 *
 * 仅替换 `!isAgentAssignee && assigneeId !== null` 且响应未内嵌 assignee
 * 的占位行；索引未命中（成员已退出/脏数据）保持占位 '—'，绝不猜测。
 */
export function withMemberAssignees(
  rows: readonly FormattedTaskRow[],
  memberIndex: ReadonlyMap<number, MemberAssigneeRef> | null | undefined,
): FormattedTaskRow[] {
  if (!memberIndex || memberIndex.size === 0) return [...rows]
  return rows.map((row) => {
    if (row.isAgentAssignee || row.raw.assigneeId === null || row.raw.assignee) return row
    const member = memberIndex.get(row.raw.assigneeId)
    if (!member) return row
    const fullName = member.fullName?.trim() || null
    const initials =
      member.initials?.trim() || (fullName ? fullName.slice(0, 1) : LIST_EMPTY_PLACEHOLDER)
    return {
      ...row,
      assigneeName: fullName || member.email || LIST_EMPTY_PLACEHOLDER,
      assigneeInitials: initials,
    }
  })
}

/**
 * 用 WBS 树补齐「归属层级」：任务挂在哪个工作包就显示「编码 名称」（纯函数）。
 * AI 生成的任务通常没有父任务，只按父任务名显示会整列都是「—」。
 */
export function withWbsLabels(
  rows: readonly FormattedTaskRow[],
  wbsIndex: ReadonlyMap<number, { code: string; name: string }> | null | undefined,
): FormattedTaskRow[] {
  if (!wbsIndex || wbsIndex.size === 0) return [...rows]
  return rows.map((row) => {
    const nodeId = row.raw.wbsNodeId
    const node = nodeId !== null && nodeId !== undefined ? wbsIndex.get(Number(nodeId)) : undefined
    return node ? { ...row, wbsLabel: `${node.code} ${node.name}` } : row
  })
}

// ---------------------------------------------------------------------------
// 服务端查询联动：排序 / 筛选 / 分页参数组装
// ---------------------------------------------------------------------------

/**
 * 可排序列字段白名单——与后端 `TaskService.parseSortField` 列映射对齐
 * （createdAt/updatedAt/name/status/priority/startDate/endDate/dueDate）。
 * 注意：后端尚无 progressPercent 列映射，`+progressPercent` 会按服务端
 * 回退列（created_at）执行——排序指示与结果非严格对应，属服务端能力缺口，
 * 表头仍按 spec 提供进度排序入口（只读 GET，无副作用）。
 */
export type ListSortField = 'name' | 'status' | 'priority' | 'endDate' | 'progressPercent'

/** 表头排序字段 → 列标题（工具栏/aria 文案）。 */
export const LIST_SORT_FIELD_LABEL: Record<ListSortField, string> = {
  name: '任务名称',
  status: '状态',
  priority: '优先级',
  endDate: '截止日',
  progressPercent: '进度',
}

/** 表头点击排序状态机：默认序 → 升序 → 降序 → 默认序（spec 单列轮转）。 */
export interface ListSortState {
  field: ListSortField
  direction: 'asc' | 'desc'
}

/** 排序参数串（`+endDate` / `-endDate`）；默认序为 undefined（服务端 -createdAt）。 */
export function toSortParam(sort: ListSortState | null): string | undefined {
  if (!sort) return undefined
  return `${sort.direction === 'asc' ? '+' : '-'}${sort.field}`
}

/**
 * 点击列头 `field` 后的下一个排序状态：
 * 点新列 → 升序；点同列升序 → 降序；点同列降序 → 回到默认序（null）。
 */
export function nextSortState(
  current: ListSortState | null,
  field: ListSortField,
): ListSortState | null {
  if (!current || current.field !== field) return { field, direction: 'asc' }
  if (current.direction === 'asc') return { field, direction: 'desc' }
  return null
}

/** 镜头内 UI 筛选状态（status/priority 缺省为 undefined = 全部）。 */
export interface ListLensFilterState {
  status?: TaskStatus
  priority?: TaskPriority
  /** 关键词搜索（组装前会 trim；空串视为未筛）。 */
  search?: string
  /** AI 建议岗位。 */
  roleHint?: string
}

/** 完整查询状态（含服务端分页与排序）。 */
export interface ListLensQueryState extends ListLensFilterState {
  sort: ListSortState | null
  page: number
  perPage: number
}

/**
 * UI 状态 → `TaskListFilters`（tasksApi.list / taskKeys.list 的服务端契约）。
 * page/perPage 恒携带（tasksApi.buildQuery 仅在 truthy 时拼接）。
 */
/** 列表默认排序：计划开始日期升序。 */
export const LIST_DEFAULT_SORT = '+startDate'

export function toTaskListFilters(state: ListLensQueryState): TaskListFilters {
  const filters: TaskListFilters = {}
  if (state.status) filters.status = state.status
  if (state.priority) filters.priority = state.priority
  const search = state.search?.trim()
  if (search) filters.search = search
  if (state.roleHint) filters.roleHint = state.roleHint
  // 未手动排序时按计划开始日期升序：项目从头往后读（接口默认是创建时间倒序，最新建的排最前）
  filters.sort = toSortParam(state.sort) ?? LIST_DEFAULT_SORT
  filters.page = Math.max(1, Math.trunc(state.page) || 1)
  filters.perPage = state.perPage
  return filters
}

/**
 * `TaskListFilters` → 查询串（与 tasksApi.buildQuery 同序同步，
 * URLSearchParams 编码：`sort=+endDate` 序列化为 `sort=%2BendDate`，
 * 服务端解码后语义不变）。零参数时返回空串。
 */
export function serializeTaskListFilters(filters: TaskListFilters): string {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.roleHint) query.set('roleHint', filters.roleHint)
  if (filters.priority) query.set('priority', filters.priority)
  if (filters.assigneeId !== undefined && filters.assigneeId !== null) {
    query.set('assigneeId', String(filters.assigneeId))
  }
  if (filters.search) query.set('search', filters.search)
  if (filters.dateFrom) query.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) query.set('dateTo', filters.dateTo)
  if (filters.sort) query.set('sort', filters.sort)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}
