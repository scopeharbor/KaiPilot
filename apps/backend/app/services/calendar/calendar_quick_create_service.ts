/**
 * 日历快速新建：读取项目现况（成员负载、WBS 缺口、里程碑、工作日历），交给 `calendar_quick_create_logic` 补全。
 * 全部查询按项目 + 组织过滤；纯逻辑（规则兜底、模型输出规整、冲突）在 logic 文件里，便于单测。
 */
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import {
  createWorkingCalendar,
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
} from '#services/gantt_working_calendar'
import { normalizePersonalCalendar, personalOffDays } from '@aiproj/types'
import PersonalCalendarService from '#services/calendar/personal_calendar_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import {
  DAY_MS,
  isoOf,
  type QuickCreateContext,
  type QuickCreateMember,
} from '#services/calendar/calendar_quick_create_logic'

export * from '#services/calendar/calendar_quick_create_logic'

export async function loadQuickCreateContext(args: {
  organizationId: number
  projectId: number
  userId: number
  startDate: string
  endDate: string | null
  now: Date
}): Promise<QuickCreateContext> {
  const project = await Project.query()
    .where('id', args.projectId)
    .where('organization_id', args.organizationId)
    .whereNull('deleted_at')
    .first()
  if (!project) throw new ResourceNotFoundException('项目不存在')

  // 负载窗口：所选日期前后各一周
  const from = formatIsoDate(parseIsoDate(args.startDate) - 7 * DAY_MS)
  const to = formatIsoDate(parseIsoDate(args.endDate ?? args.startDate) + 7 * DAY_MS)

  const [memberRows, loadRows, packageRows, milestoneRows, nameRows] = await Promise.all([
    db
      .from('project_members as pm')
      .join('users as u', 'u.id', 'pm.user_id')
      .leftJoin('project_roles as r', 'r.id', 'pm.project_role_id')
      .where('pm.project_id', args.projectId)
      .where('pm.is_active', true)
      .orderBy('u.id', 'asc')
      .limit(80)
      .select('u.id', 'u.full_name', 'u.email', 'r.name as role') as Promise<
      Array<{ id: number | string; full_name: string | null; email: string; role: string | null }>
    >,
    db
      .from('tasks')
      .where('project_id', args.projectId)
      .whereNull('deleted_at')
      .whereNotNull('assignee_id')
      .whereNotIn('status', ['completed', 'cancelled'])
      .whereRaw('COALESCE(start_date, end_date) <= ?', [to])
      .whereRaw('COALESCE(end_date, start_date) >= ?', [from])
      .groupBy('assignee_id')
      .select('assignee_id')
      .count('* as total') as Promise<Array<{ assignee_id: number | string; total: unknown }>>,
    db
      .from('wbs_nodes as w')
      .where('w.project_id', args.projectId)
      .whereNull('w.deleted_at')
      .whereNull('w.task_id')
      .orderBy('w.path', 'asc')
      .limit(120)
      .select(
        'w.id',
        'w.code',
        'w.name',
        db
          .from('tasks as t')
          .whereColumn('t.wbs_node_id', 'w.id')
          .whereNull('t.deleted_at')
          .count('*')
          .as('task_count'),
        // 挂在它下面的任务节点也算它的任务；有子工作包的是汇总节点，不算缺口
        db
          .from('wbs_nodes as c')
          .whereColumn('c.parent_id', 'w.id')
          .whereNull('c.deleted_at')
          .whereNotNull('c.task_id')
          .count('*')
          .as('child_tasks'),
        db
          .from('wbs_nodes as c')
          .whereColumn('c.parent_id', 'w.id')
          .whereNull('c.deleted_at')
          .whereNull('c.task_id')
          .count('*')
          .as('child_packages'),
      ) as Promise<
      Array<{
        id: number | string
        code: string | null
        name: string
        task_count: unknown
        child_tasks: unknown
        child_packages: unknown
      }>
    >,
    db
      .from('milestones')
      .where('project_id', args.projectId)
      .whereNotNull('planned_date')
      .whereNot('status', 'completed')
      .orderBy('planned_date', 'asc')
      .limit(40)
      .select('id', 'name', 'planned_date') as Promise<
      Array<{ id: number | string; name: string; planned_date: unknown }>
    >,
    db
      .from('tasks')
      .where('project_id', args.projectId)
      .whereNull('deleted_at')
      .orderBy('id', 'desc')
      .limit(200)
      .select('name') as Promise<Array<{ name: string }>>,
  ])

  const load = new Map(loadRows.map((row) => [Number(row.assignee_id), Number(row.total) || 0]))
  const calendar = createWorkingCalendar(
    (project.settings as Record<string, unknown> | null | undefined) ?? null,
  )
  // 不上班的日子：个人工作日历（跨项目）+ 本项目资源的整天不可用例外；看到选中日期后一个月（拆多条会往后排）
  const offTo = formatIsoDate(parseIsoDate(to) + 30 * DAY_MS)
  const memberIds = memberRows.map((row) => Number(row.id))
  const [personalCalendars, exceptionRows] = await Promise.all([
    PersonalCalendarService.forUsers(memberIds),
    memberIds.length === 0
      ? Promise.resolve([])
      : (db
          .from('resource_availability_exceptions as e')
          .join('resources as r', 'r.id', 'e.resource_id')
          .where('e.project_id', args.projectId)
          .where('e.organization_id', args.organizationId)
          .whereNot('e.status', 'cancelled')
          .where('e.capacity_override_hours', '<=', 0)
          .whereIn('r.user_id', memberIds)
          .where('e.start_date', '<=', offTo)
          .where('e.end_date', '>=', from)
          .select('r.user_id', 'e.start_date', 'e.end_date') as Promise<
          Array<{ user_id: number | string; start_date: unknown; end_date: unknown }>
        >),
  ])
  const offDaysOf = (userId: number): string[] => {
    const personal = personalCalendars.get(userId) ?? { workdays: null, leaves: [] }
    const leaves = [
      ...personal.leaves,
      ...exceptionRows
        .filter((row) => Number(row.user_id) === userId)
        .map((row, index) => ({
          id: `resource-${index}`,
          startDate: isoOf(row.start_date) ?? '',
          endDate: isoOf(row.end_date) ?? '',
          note: null,
        })),
    ]
    const merged = normalizePersonalCalendar({ workdays: personal.workdays, leaves })
    // 项目本来就不上班的日子另有「非工作日」提醒，这里不重复算
    return personalOffDays(merged, from, offTo).filter((day) =>
      isWorkingDay(calendar, parseIsoDate(day)),
    )
  }

  const members: QuickCreateMember[] = memberRows.map((row) => {
    const offDays = offDaysOf(Number(row.id))
    return {
      id: Number(row.id),
      name: row.full_name?.trim() || row.email.split('@')[0]!,
      role: row.role ?? null,
      activeTasks: load.get(Number(row.id)) ?? 0,
      ...(offDays.length > 0 ? { offDays } : {}),
    }
  })

  return {
    today: formatIsoDate(Date.UTC(args.now.getFullYear(), args.now.getMonth(), args.now.getDate())),
    projectName: project.name,
    projectStart: isoOf(project.startDate?.toISODate?.() ?? null),
    projectEnd: isoOf(project.endDate?.toISODate?.() ?? null),
    window: { startDate: args.startDate, endDate: args.endDate },
    calendar,
    members,
    workPackages: packageRows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      taskCount: (Number(row.task_count) || 0) + (Number(row.child_tasks) || 0),
      hasChildren: (Number(row.child_packages) || 0) > 0,
    })),
    milestones: milestoneRows
      .map((row) => ({
        id: Number(row.id),
        name: row.name,
        plannedDate: isoOf(row.planned_date) ?? '',
      }))
      .filter((row) => row.plannedDate),
    existingTaskNames: nameRows.map((row) => row.name),
    currentUserId: args.userId,
  }
}
