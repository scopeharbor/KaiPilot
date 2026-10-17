/**
 * v3-chart-gallery-data-foundation —— ProjectMetricsService（W3.6/W3.7）。
 *
 * 项目级只读聚合（纯查询，零写库，RL-06 幂等）：
 * - getRaciMatrix：R = assigneeId、A = reviewerId、C = consultedUserIds、
 *   I = informedUserIds，交叉映射 matrix[taskId][userId] = 角色标签数组；
 * - getLobMetrics：线条平衡图（LOB）流水聚合——按空间单元（location_unit）
 *   与工序（cycle_stage）输出活动点阵、单元/工序清单与节奏均衡性诊断。
 *
 * 所有入口先做项目存在 + 组织隔离断言（RL-05），跨租户一律 404。
 */
import { ResourceNotFoundException } from '#exceptions/api_exception'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import Task from '#models/task'
import { type DateTime } from 'luxon'

/** RACI 角色标签。 */
export type RaciRole = 'R' | 'A' | 'C' | 'I'

export interface RaciMember {
  id: number
  name: string | null
  email: string
  role: string | null
}

export interface RaciTaskSummary {
  id: number
  name: string
  status: string
}

export interface RaciMatrixResponse {
  members: RaciMember[]
  tasks: RaciTaskSummary[]
  /** matrix[taskId][userId] = 角色标签数组（同一任务同一人可多角色）。 */
  matrix: Record<number, Record<number, RaciRole[]>>
}

export interface LobActivity {
  taskId: number
  taskName: string
  unit: string
  stage: string
  plannedStart: string | null
  plannedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  /** 含首尾的自然日工期（end - start + 1 天），起止缺失为 null。 */
  durationDays: number | null
  /**
   * 推进速率斜率（单位天推进的单元数）：
   * 同工序非首条活动 = 1 / 与上一条活动的（计划）开始日间隔（天）；
   * 该工序首条活动 = 1 / 自身工期（天）；起止缺失时为 null。
   */
  slopeRate: number | null
}

export interface LobRhythmSummaryRow {
  stage: string
  activityCount: number
  /** 平均工期（自然日含首尾）。 */
  avgDurationDays: number | null
  /** 平均节拍：相邻单元（计划）开始日间隔均值（天）。 */
  avgTaktDays: number | null
  /** 工序碰撞：同工序相邻活动计划窗口重叠（下一条开始日 <= 上一条结束日）。 */
  collision: boolean
  /** 工序间断：同工序相邻活动计划间隔超过上一条结束日 1 个完整自然日以上。 */
  gap: boolean
  diagnostics: Array<'STAGE_COLLISION' | 'STAGE_GAP'>
}

export interface LobMetricsResponse {
  units: string[]
  stages: string[]
  activities: LobActivity[]
  rhythmSummary: LobRhythmSummaryRow[]
}

/** 数值自然排序：Floor-2 < Floor-10。 */
function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

/** 两个日期对象之间的整自然日差（b - a）。 */
function wholeDayDiff(a: DateTime, b: DateTime): number {
  return Math.round(b.startOf('day').diff(a.startOf('day'), 'days').days)
}

/** 含首尾的自然日工期：end - start + 1（同日起止 = 1 天）。 */
function inclusiveDurationDays(start: DateTime, end: DateTime): number {
  return wholeDayDiff(start, end) + 1
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function toDayStart(value: DateTime | null | undefined): DateTime | null {
  return value ? value.startOf('day') : null
}

function toIso(value: DateTime | null): string | null {
  return value ? value.toISODate() : null
}

export default class ProjectMetricsService {
  /**
   * RACI 责任分配矩阵（design D3.2）：
   * - members 来自当前项目活跃项目成员（project_members + users + 项目角色名）；
   * - tasks 为项目全部未删除任务；
   * - matrix 覆盖任务上出现的任意用户 ID（含仅挂组织未挂项目的咨询/知会人），
   *   渲染列可由前端以 members ∪ matrix 用户键取并集。
   */
  async getRaciMatrix(organizationId: number, projectId: number): Promise<RaciMatrixResponse> {
    await this.projectOrFail(organizationId, projectId)

    const memberRows = await ProjectMember.query()
      .where('project_id', projectId)
      .where('is_active', true)
      .preload('user')
      .preload('projectRole')
      .orderBy('id', 'asc')

    const members: RaciMember[] = memberRows.map((member) => ({
      id: member.userId,
      name: member.user?.fullName ?? member.user?.email ?? null,
      email: member.user?.email ?? '',
      role: member.projectRole?.name ?? null,
    }))

    const taskRows = await Task.query()
      .where('project_id', projectId)
      .orderBy('id', 'asc')
      .select(
        'id',
        'name',
        'status',
        'assignee_id',
        'reviewer_id',
        'consulted_user_ids',
        'informed_user_ids',
      )

    const tasks: RaciTaskSummary[] = taskRows.map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
    }))

    const matrix: Record<number, Record<number, RaciRole[]>> = {}
    for (const task of taskRows) {
      const cellMap: Record<number, RaciRole[]> = {}
      const assignee = this.toUserId(task.assigneeId)
      const reviewer = this.toUserId(task.reviewerId)
      if (assignee !== null) cellMap[assignee] = ['R']
      if (reviewer !== null) {
        cellMap[reviewer] = [...(cellMap[reviewer] ?? []), 'A']
      }
      for (const userId of this.toUserIdList(task.consultedUserIds)) {
        cellMap[userId] = [...(cellMap[userId] ?? []), 'C']
      }
      for (const userId of this.toUserIdList(task.informedUserIds)) {
        cellMap[userId] = [...(cellMap[userId] ?? []), 'I']
      }
      if (Object.keys(cellMap).length > 0) {
        matrix[task.id] = cellMap
      }
    }

    return { members, tasks, matrix }
  }

  /**
   * LOB 平衡线流水聚合（tasks W3.7）。
   * 仅纳入同时具备 locationUnit 与 cycleStage 的流水任务。
   * 活动按 单元（自然序）→ 工序出现序 → 计划开始日 → id 排序。
   */
  async getLobMetrics(organizationId: number, projectId: number): Promise<LobMetricsResponse> {
    await this.projectOrFail(organizationId, projectId)

    const tasks = await Task.query()
      .where('project_id', projectId)
      .whereNotNull('location_unit')
      .whereNotNull('cycle_stage')
      .orderBy('id', 'asc')

    const units = Array.from(new Set(tasks.map((task) => task.locationUnit!)))
    units.sort(compareNatural)

    // 工序出现序：沿单元自然序扫描首次出现
    const tasksByUnit = new Map<string, Task[]>()
    for (const unit of units) {
      tasksByUnit.set(
        unit,
        tasks.filter((task) => task.locationUnit === unit),
      )
    }
    const stages: string[] = []
    const stageSeen = new Set<string>()
    for (const unit of units) {
      for (const task of tasksByUnit.get(unit) ?? []) {
        const stage = task.cycleStage!
        if (!stageSeen.has(stage)) {
          stageSeen.add(stage)
          stages.push(stage)
        }
      }
    }
    const stageRank = new Map(stages.map((stage, index) => [stage, index]))

    const activities: LobActivity[] = tasks.map((task) => {
      const plannedStart = toDayStart(task.startDate)
      const plannedEnd = toDayStart(task.endDate)
      const actualStart = toDayStart(task.actualStartDate)
      const actualEnd = toDayStart(task.actualEndDate)
      const effectiveStart = plannedStart ?? actualStart
      const effectiveEnd = plannedEnd ?? actualEnd
      let durationDays: number | null = null
      if (effectiveStart && effectiveEnd && effectiveEnd.toMillis() >= effectiveStart.toMillis()) {
        durationDays = inclusiveDurationDays(effectiveStart, effectiveEnd)
      }
      return {
        taskId: task.id,
        taskName: task.name,
        unit: task.locationUnit!,
        stage: task.cycleStage!,
        plannedStart: toIso(plannedStart),
        plannedEnd: toIso(plannedEnd),
        actualStart: toIso(actualStart),
        actualEnd: toIso(actualEnd),
        durationDays,
        slopeRate: null,
      }
    })

    // 斜率：同一工序内相邻活动按（计划）开始日推进；首条活动用自身工期
    const stageRows = new Map<string, Task[]>()
    for (const task of tasks) {
      const stage = task.cycleStage!
      const rows = stageRows.get(stage) ?? []
      rows.push(task)
      stageRows.set(stage, rows)
    }
    for (const rows of stageRows.values()) {
      rows.sort((a, b) => {
        const startA = toDayStart(a.startDate) ?? toDayStart(a.actualStartDate)
        const startB = toDayStart(b.startDate) ?? toDayStart(b.actualStartDate)
        if (startA === null && startB === null) return a.id - b.id
        if (startA === null) return 1
        if (startB === null) return -1
        return startA.toMillis() - startB.toMillis()
      })
      rows.forEach((task, index) => {
        const activity = activities.find((item) => item.taskId === task.id)!
        const start = toDayStart(task.startDate) ?? toDayStart(task.actualStartDate)
        if (index === 0) {
          if (activity.durationDays !== null && activity.durationDays > 0) {
            activity.slopeRate = round3(1 / activity.durationDays)
          }
          return
        }
        const prevTask = rows[index - 1]
        const prevStart = toDayStart(prevTask.startDate) ?? toDayStart(prevTask.actualStartDate)
        if (prevStart && start) {
          const interval = wholeDayDiff(prevStart, start)
          if (interval > 0) activity.slopeRate = round3(1 / interval)
        }
      })
    }

    // 节奏均衡性诊断（节拍 / 碰撞 / 间断）
    const rhythmSummary: LobRhythmSummaryRow[] = stages.map((stage) => {
      const rows = (stageRows.get(stage) ?? []).filter((task) => {
        return (toDayStart(task.startDate) ?? toDayStart(task.actualStartDate)) !== null
      })

      const durations: number[] = []
      const taktDays: number[] = []
      let collision = false
      let gap = false
      rows.forEach((task, index) => {
        const start = toDayStart(task.startDate) ?? toDayStart(task.actualStartDate)
        const end = toDayStart(task.endDate) ?? toDayStart(task.actualEndDate)
        if (start && end && end.toMillis() >= start.toMillis()) {
          durations.push(inclusiveDurationDays(start, end))
        }
        if (index === 0) return
        const prevTask = rows[index - 1]
        const prevStart = toDayStart(prevTask.startDate) ?? toDayStart(prevTask.actualStartDate)
        const prevEnd = toDayStart(prevTask.endDate) ?? toDayStart(prevTask.actualEndDate)
        if (!prevStart || !start) return
        const interval = wholeDayDiff(prevStart, start)
        taktDays.push(interval)
        if (prevEnd) {
          if (wholeDayDiff(prevEnd, start) <= 0) collision = true
          if (wholeDayDiff(prevEnd, start) > 1) gap = true
        }
      })

      const avgDurationDays =
        durations.length > 0
          ? round3(durations.reduce((sum, value) => sum + value, 0) / durations.length)
          : null
      const avgTaktDays =
        taktDays.length > 0
          ? round3(taktDays.reduce((sum, value) => sum + value, 0) / taktDays.length)
          : null

      const diagnostics: Array<'STAGE_COLLISION' | 'STAGE_GAP'> = []
      if (collision) diagnostics.push('STAGE_COLLISION')
      if (gap) diagnostics.push('STAGE_GAP')

      return {
        stage,
        activityCount: rows.length,
        avgDurationDays,
        avgTaktDays,
        collision,
        gap,
        diagnostics,
      }
    })

    // 最终排序：单元（自然序）→ 工序出现序 → 计划开始日 → id
    activities.sort((a, b) => {
      const unitCompare = compareNatural(a.unit, b.unit)
      if (unitCompare !== 0) return unitCompare
      const stageCompare = (stageRank.get(a.stage) ?? 0) - (stageRank.get(b.stage) ?? 0)
      if (stageCompare !== 0) return stageCompare
      const startCompare = (a.plannedStart ?? a.actualStart ?? '').localeCompare(
        b.plannedStart ?? b.actualStart ?? '',
      )
      if (startCompare !== 0) return startCompare
      return a.taskId - b.taskId
    })

    return { units, stages, activities, rhythmSummary }
  }

  // ---------------- 内部辅助 ----------------

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private toUserId(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
  }

  private toUserIdList(value: unknown): number[] {
    if (value === null || value === undefined) return []
    if (!Array.isArray(value)) return []
    const ids: number[] = []
    for (const entry of value) {
      const id = Number(entry)
      if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id)
    }
    return ids
  }
}
