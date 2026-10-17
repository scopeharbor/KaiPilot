import db from '@adonisjs/lucid/services/db'

/**
 * 项目健康度（读取期派生，2026-09-28）。
 *
 * `projects.health_status` 列默认 'unknown' 且没有任何写入方，项目列表直接返回列值，
 * 于是空间地图、项目头部把所有项目都显示成「未评估」（实测）。这里按任务实际情况即时派生：
 * - 没有任务 → unknown（真的无从评估）；
 * - 逾期或受阻的任务占 25% 以上 → critical；
 * - 有逾期 / 受阻任务，或最晚的任务完工日晚于项目截止日 → at_risk；
 * - 否则 → healthy。
 * 取值与空间地图、组合看板使用的 healthy / at_risk / critical 一致。
 */
export type DerivedProjectHealth = 'healthy' | 'at_risk' | 'critical' | 'unknown'

const CLOSED_STATUSES = ['completed', 'cancelled']

/**
 * 日期列转 YYYY-MM-DD。PG 驱动把 date 列解析成本地零点的 Date：直接 String() 得到
 * 「Mon Oct 12 …」，toISOString() 在东八区又会退一天，所以按本地年月日取。
 */
export function isoDay(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function classifyProjectHealth(input: {
  taskTotal: number
  overdue: number
  blocked: number
  latestTaskEnd: string | null
  projectEnd: string | null
}): DerivedProjectHealth {
  if (input.taskTotal === 0) return 'unknown'
  if (input.overdue / input.taskTotal >= 0.25 || input.blocked / input.taskTotal >= 0.25) {
    return 'critical'
  }
  const planLate = Boolean(
    input.latestTaskEnd && input.projectEnd && input.latestTaskEnd > input.projectEnd,
  )
  if (input.overdue > 0 || input.blocked > 0 || planLate) return 'at_risk'
  return 'healthy'
}

/** 批量派生：一次查询取回这些项目的全部未删除任务的状态与完工日。 */
export async function deriveProjectHealth(
  projects: ReadonlyArray<{ id: number | string; endDate?: unknown }>,
  now: Date = new Date(),
): Promise<Map<number, DerivedProjectHealth>> {
  const result = new Map<number, DerivedProjectHealth>()
  const ids = projects.map((project) => Number(project.id)).filter(Number.isFinite)
  if (ids.length === 0) return result
  const today = isoDay(now)!
  const rows = (await db
    .from('tasks')
    .whereIn('project_id', ids)
    .whereNull('deleted_at')
    .select('project_id', 'status', 'end_date')) as Array<{
    project_id: number | string
    status: string
    end_date: unknown
  }>
  const stats = new Map<
    number,
    { taskTotal: number; overdue: number; blocked: number; latestTaskEnd: string | null }
  >()
  for (const row of rows) {
    const id = Number(row.project_id)
    const entry = stats.get(id) ?? { taskTotal: 0, overdue: 0, blocked: 0, latestTaskEnd: null }
    entry.taskTotal++
    const end = isoDay(row.end_date)
    const open = !CLOSED_STATUSES.includes(row.status)
    if (open && end && end < today) entry.overdue++
    if (row.status === 'blocked') entry.blocked++
    if (end && (!entry.latestTaskEnd || end > entry.latestTaskEnd)) entry.latestTaskEnd = end
    stats.set(id, entry)
  }
  for (const project of projects) {
    const id = Number(project.id)
    const entry = stats.get(id) ?? { taskTotal: 0, overdue: 0, blocked: 0, latestTaskEnd: null }
    const endDate = project.endDate as { toISODate?: () => string | null } | unknown
    const projectEnd =
      endDate && typeof (endDate as { toISODate?: unknown }).toISODate === 'function'
        ? (endDate as { toISODate: () => string | null }).toISODate()
        : isoDay(endDate)
    result.set(id, classifyProjectHealth({ ...entry, projectEnd }))
  }
  return result
}
