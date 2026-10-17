// AI 同事 —— 只读工具 `get_my_work`：跨项目汇总「我负责、还没完成」的任务。
//
// 场景：「我今天还有哪些工作没做完」「帮我排一下今天先做哪个」。散落在各项目里的任务
// 汇成一张清单，每条带项目、编号、到期状态与直达路径；排序是确定性的（逾期 → 今天到期
// → 受阻 → 优先级 → 截止日），模型的优先级建议只在此基础上补充理由，不改数据。
//
// 权限：只取调用者**已授权项目**（SearchPolicy 与全域搜索同口径）里、负责人是本人的任务；
// 组织隔离经 projects.organization_id 收口。
import SearchPolicy from '#policies/search_policy'
import { formatProjectCode, formatTaskCode } from '@aiproj/types'
import { TASK_STATUS_LABELS, type TaskStatus } from '#services/task_status_machine'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const GET_MY_WORK_TOOL_NAME = 'get_my_work'

export const MY_WORK_FILTERS = ['open', 'today', 'overdue', 'this_week'] as const
export type MyWorkFilter = (typeof MY_WORK_FILTERS)[number]

const OPEN_STATUSES = ['not_started', 'in_progress', 'blocked', 'on_hold'] as const
const PRIORITY_WEIGHT: Record<string, number> = {
  highest: 5,
  urgent: 5,
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
}
const MAX_ITEMS = 50

export type MyWorkDueState = 'overdue' | 'due_today' | 'due_this_week' | 'later' | 'no_due'

export interface MyWorkItem {
  code: string
  id: number
  name: string
  status: string
  statusLabel: string
  priority: string | null
  startDate: string | null
  endDate: string | null
  progressPercent: number | null
  dueState: MyWorkDueState
  /** 逾期天数（仅 overdue）。 */
  overdueDays: number | null
  project: { id: number; code: string; name: string }
  /** 新版界面直达路径（打开项目并展开任务详情）。 */
  path: string
}

export interface MyWorkResult {
  filter: MyWorkFilter
  today: string
  items: MyWorkItem[]
  summary: {
    total: number
    overdue: number
    dueToday: number
    dueThisWeek: number
    blocked: number
    projects: { id: number; code: string; name: string; count: number }[]
  }
  truncated: boolean
}

export interface GetMyWorkDeps {
  searchPolicy?: SearchPolicy
  /** 测试可固定「今天」。 */
  today?: () => DateTime
}

let policyPromise: Promise<SearchPolicy> | null = null
function resolvePolicy(): Promise<SearchPolicy> {
  policyPromise ??= app.container.make(SearchPolicy)
  return policyPromise
}

function dateOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const candidate = value as { toISODate?: () => string | null }
  return typeof candidate.toISODate === 'function' ? candidate.toISODate() : null
}

/** 到期状态（按自然日；本周 = 今天起 7 天内）。 */
export function dueStateOf(
  endDate: string | null,
  today: DateTime,
): { dueState: MyWorkDueState; overdueDays: number | null } {
  if (!endDate) return { dueState: 'no_due', overdueDays: null }
  const end = DateTime.fromISO(endDate, { zone: today.zone })
  const days = Math.round(end.startOf('day').diff(today.startOf('day'), 'days').days)
  if (days < 0) return { dueState: 'overdue', overdueDays: -days }
  if (days === 0) return { dueState: 'due_today', overdueDays: null }
  if (days <= 7) return { dueState: 'due_this_week', overdueDays: null }
  return { dueState: 'later', overdueDays: null }
}

const DUE_RANK: Record<MyWorkDueState, number> = {
  overdue: 0,
  due_today: 1,
  due_this_week: 3,
  later: 4,
  no_due: 5,
}

/** 确定性排序：逾期（越久越前）→ 今天到期 → 受阻 → 本周 → 优先级 → 截止日。 */
export function compareMyWork(a: MyWorkItem, b: MyWorkItem): number {
  const rank = (item: MyWorkItem) =>
    item.status === 'blocked' && DUE_RANK[item.dueState] > 1 ? 2 : DUE_RANK[item.dueState]
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (a.dueState === 'overdue' && b.dueState === 'overdue') {
    return (b.overdueDays ?? 0) - (a.overdueDays ?? 0)
  }
  const weight = (item: MyWorkItem) => PRIORITY_WEIGHT[item.priority ?? ''] ?? 0
  if (weight(a) !== weight(b)) return weight(b) - weight(a)
  return (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999') || a.id - b.id
}

export function createGetMyWorkTool(
  deps?: GetMyWorkDeps,
): ToolDefinition<{ filter?: MyWorkFilter }, MyWorkResult> {
  return {
    name: GET_MY_WORK_TOOL_NAME,
    description:
      '跨项目汇总当前用户负责、还没完成的任务（可筛选：全部未完成 / 今天到期 / 已逾期 / 本周到期），按紧急程度排序，每条带项目、任务编号、到期状态与直达路径。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: [...MY_WORK_FILTERS],
          description:
            'open=全部未完成；today=今天到期或已逾期；overdue=已逾期；this_week=7 天内到期或已逾期',
        },
      },
      additionalProperties: false,
    },
    requiredPermissions: [],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: { filter?: MyWorkFilter },
    ): Promise<ToolExecutionResult<MyWorkResult>> => {
      const filter: MyWorkFilter = MY_WORK_FILTERS.includes(input.filter as MyWorkFilter)
        ? (input.filter as MyWorkFilter)
        : 'open'
      const policy = deps?.searchPolicy ?? (await resolvePolicy())
      const allowed = await policy.getAllowedProjectIds(ctx.user, ctx.organizationId)
      const today = deps?.today?.() ?? DateTime.now().setZone('Asia/Shanghai')
      const todayIso = today.toISODate() ?? ''

      const rows =
        allowed.length === 0
          ? []
          : ((await db
              .from('tasks')
              .join('projects', 'projects.id', 'tasks.project_id')
              .where('tasks.assignee_id', Number(ctx.user.id))
              .whereIn('tasks.status', [...OPEN_STATUSES])
              .whereIn('tasks.project_id', allowed)
              .where('projects.organization_id', ctx.organizationId)
              .whereNull('tasks.deleted_at')
              .whereNull('projects.deleted_at')
              .select(
                'tasks.id',
                'tasks.name',
                'tasks.status',
                'tasks.priority',
                'tasks.start_date',
                'tasks.end_date',
                'tasks.progress_percent',
                'projects.id as project_id',
                'projects.code as project_code',
                'projects.name as project_name',
              )
              .limit(500)) as Record<string, unknown>[])

      const all: MyWorkItem[] = rows.map((row) => {
        const project = { id: Number(row.project_id), code: row.project_code as string | null }
        const endDate = dateOf(row.end_date)
        const status = String(row.status ?? '')
        const progress = Number(row.progress_percent)
        return {
          code: formatTaskCode(project, Number(row.id)),
          id: Number(row.id),
          name: String(row.name ?? ''),
          status,
          statusLabel: TASK_STATUS_LABELS[status as TaskStatus] ?? status,
          priority: typeof row.priority === 'string' ? row.priority : null,
          startDate: dateOf(row.start_date),
          endDate,
          progressPercent: Number.isFinite(progress) ? progress : null,
          ...dueStateOf(endDate, today),
          project: {
            id: project.id,
            code: formatProjectCode(project),
            name: String(row.project_name ?? ''),
          },
          path: `/next/projects/${project.id}?focusTask=${Number(row.id)}`,
        }
      })

      const selected = all
        .filter((item) => {
          if (filter === 'overdue') return item.dueState === 'overdue'
          if (filter === 'today')
            return item.dueState === 'overdue' || item.dueState === 'due_today'
          if (filter === 'this_week') {
            return ['overdue', 'due_today', 'due_this_week'].includes(item.dueState)
          }
          return true
        })
        .sort(compareMyWork)

      const byProject = new Map<number, { id: number; code: string; name: string; count: number }>()
      for (const item of selected) {
        const entry = byProject.get(item.project.id) ?? { ...item.project, count: 0 }
        entry.count += 1
        byProject.set(item.project.id, entry)
      }
      return {
        status: 'SUCCESS',
        data: {
          filter,
          today: todayIso,
          items: selected.slice(0, MAX_ITEMS),
          summary: {
            total: selected.length,
            overdue: selected.filter((item) => item.dueState === 'overdue').length,
            dueToday: selected.filter((item) => item.dueState === 'due_today').length,
            dueThisWeek: selected.filter((item) => item.dueState === 'due_this_week').length,
            blocked: selected.filter((item) => item.status === 'blocked').length,
            projects: [...byProject.values()].sort((a, b) => b.count - a.count),
          },
          truncated: selected.length > MAX_ITEMS,
        },
      }
    },
  }
}
