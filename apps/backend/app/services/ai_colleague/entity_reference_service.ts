// AI 同事 / Copilot —— 编号引用解析：让模型「看得到」用户提到的任务与项目。
//
// - 对话里的任务编号（`PROJ-5#128`、`#128`）、项目编号（`PROJ-5`），以及页面上当前打开的
//   任务详情（选中任务），在**已授权项目**范围内查出低敏详情交给模型；
// - 组织隔离：项目一律按 organization_id + 未删除 + 已授权项目集合过滤；任务经项目收口；
// - 负责人只给〔成员·编码〕代号（见 member_alias.ts；与 Copilot 口径一致，不外发姓名）。
import db from '@adonisjs/lucid/services/db'
import {
  formatProjectCode,
  formatTaskCode,
  parseEntityCodes,
  projectIdFromFallbackCode,
} from '@aiproj/types'
import { TASK_STATUS_LABELS, type TaskStatus } from '#services/task_status_machine'
import { memberAlias } from '#services/ai_colleague/member_alias'

export const MAX_REFERENCED_TASKS = 10
export const MAX_REFERENCED_PROJECTS = 5
const DESCRIPTION_MAX = 300

export interface ReferencedTaskFact {
  code: string
  id: number
  name: string
  status: string
  statusLabel: string
  priority: string | null
  startDate: string | null
  endDate: string | null
  progressPercent: number | null
  assignee: string | null
  description: string | null
  project: { id: number; code: string; name: string }
}

export interface ReferencedProjectFact {
  id: number
  code: string
  name: string
  status: string | null
  healthStatus: string | null
  startDate: string | null
  endDate: string | null
  progressPercent: number | null
  taskTotal: number
  tasksByStatus: Record<string, number>
}

export interface EntityReferences {
  tasks: ReferencedTaskFact[]
  projects: ReferencedProjectFact[]
}

function dateOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const candidate = value as { toISODate?: () => string | null }
  return typeof candidate.toISODate === 'function' ? candidate.toISODate() : null
}

function numberOrNull(value: unknown): number | null {
  const num = Number(value)
  return value === null || value === undefined || !Number.isFinite(num) ? null : num
}

export default class EntityReferenceService {
  /**
   * @param allowedProjectIds 调用方已按权限算好的可访问项目集合（为空 → 一律查不到）
   * @param selectedTaskIds 页面上当前打开 / 选中的任务（同样受项目授权约束）
   */
  async resolve(input: {
    text: string
    organizationId: number
    allowedProjectIds: readonly number[]
    selectedTaskIds?: readonly number[]
  }): Promise<EntityReferences> {
    const allowed = [...new Set(input.allowedProjectIds)].filter((id) => id > 0)
    if (allowed.length === 0) return { tasks: [], projects: [] }
    const parsed = parseEntityCodes(input.text)
    const taskIds = [...new Set([...(input.selectedTaskIds ?? []), ...parsed.taskIds])].slice(
      0,
      MAX_REFERENCED_TASKS,
    )
    const [tasks, projects] = await Promise.all([
      this.#loadTasks(taskIds, input.organizationId, allowed),
      this.#loadProjects(parsed.projectCodes, input.organizationId, allowed),
    ])
    // `PROJ-5#128` 写明了项目：与任务实际所属项目不符的不算（防张冠李戴）
    const expectedProject = new Map<number, string | null>()
    parsed.taskIds.forEach((id, index) => expectedProject.set(id, parsed.taskProjectCodes[index]!))
    return {
      tasks: tasks.filter((task) => {
        const expected = expectedProject.get(task.id)
        return !expected || expected.toLowerCase() === task.project.code.toLowerCase()
      }),
      projects,
    }
  }

  async #loadTasks(
    taskIds: readonly number[],
    organizationId: number,
    allowed: readonly number[],
  ): Promise<ReferencedTaskFact[]> {
    if (taskIds.length === 0) return []
    const rows = (await db
      .from('tasks')
      .join('projects', 'projects.id', 'tasks.project_id')
      .whereIn('tasks.id', [...taskIds])
      .whereIn('tasks.project_id', [...allowed])
      .where('projects.organization_id', organizationId)
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
        'tasks.assignee_id',
        'tasks.description',
        'projects.id as project_id',
        'projects.code as project_code',
        'projects.name as project_name',
      )) as Record<string, unknown>[]
    const order = new Map(taskIds.map((id, index) => [id, index]))
    return rows
      .map((row) => {
        const project = { id: Number(row.project_id), code: row.project_code as string | null }
        const description =
          typeof row.description === 'string' && row.description.trim()
            ? row.description.trim().slice(0, DESCRIPTION_MAX)
            : null
        const status = String(row.status ?? '')
        return {
          code: formatTaskCode(project, Number(row.id)),
          id: Number(row.id),
          name: String(row.name ?? ''),
          status,
          statusLabel: TASK_STATUS_LABELS[status as TaskStatus] ?? status,
          priority: typeof row.priority === 'string' ? row.priority : null,
          startDate: dateOf(row.start_date),
          endDate: dateOf(row.end_date),
          progressPercent: numberOrNull(row.progress_percent),
          assignee: row.assignee_id ? memberAlias(organizationId, Number(row.assignee_id)) : null,
          description,
          project: {
            id: project.id,
            code: formatProjectCode(project),
            name: String(row.project_name ?? ''),
          },
        }
      })
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  async #loadProjects(
    codes: readonly string[],
    organizationId: number,
    allowed: readonly number[],
  ): Promise<ReferencedProjectFact[]> {
    if (codes.length === 0) return []
    const lowered = codes.map((code) => code.toLowerCase())
    const fallbackIds = codes
      .map((code) => projectIdFromFallbackCode(code))
      .filter((id): id is number => id !== null)
    const rows = (await db
      .from('projects')
      .where('organization_id', organizationId)
      .whereIn('id', [...allowed])
      .whereNull('deleted_at')
      .where((query) => {
        query.whereIn(db.raw('lower(code)'), lowered)
        if (fallbackIds.length > 0) {
          query.orWhere((inner) => inner.whereIn('id', fallbackIds).whereNull('code'))
        }
      })
      .select(
        'id',
        'code',
        'name',
        'status',
        'health_status',
        'start_date',
        'end_date',
        'progress_percent',
      )
      .limit(MAX_REFERENCED_PROJECTS)) as Record<string, unknown>[]
    if (rows.length === 0) return []
    const ids = rows.map((row) => Number(row.id))
    const counts = (await db
      .from('tasks')
      .whereIn('project_id', ids)
      .whereNull('deleted_at')
      .select('project_id', 'status')
      .count('* as count')
      .groupBy('project_id', 'status')) as Record<string, unknown>[]
    return rows.map((row) => {
      const id = Number(row.id)
      const tasksByStatus: Record<string, number> = {}
      let taskTotal = 0
      for (const count of counts) {
        if (Number(count.project_id) !== id || typeof count.status !== 'string') continue
        const value = Number(count.count ?? 0)
        tasksByStatus[count.status] = value
        taskTotal += value
      }
      return {
        id,
        code: formatProjectCode({ id, code: row.code as string | null }),
        name: String(row.name ?? ''),
        status: typeof row.status === 'string' ? row.status : null,
        healthStatus: typeof row.health_status === 'string' ? row.health_status : null,
        startDate: dateOf(row.start_date),
        endDate: dateOf(row.end_date),
        progressPercent: numberOrNull(row.progress_percent),
        taskTotal,
        tasksByStatus,
      }
    })
  }
}
