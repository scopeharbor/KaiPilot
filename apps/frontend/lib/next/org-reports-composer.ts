/**
 * 组织级报表模板多项目数据合成器 (v3-ui-next-batch4-reports-change-queue W1 · tasks 1.5 / spec §1)
 *
 * 职责：
 * 1. 纯前端多查询并发合成（Multi-Query Synthesis）：基于 projectsApi.list 并发拉取当前组织各项目指标；
 * 2. 受控并发通道：最大并发数限制为 5，避免浏览器发起过多并行连接；
 * 3. 容错与安全降级：单个项目请求异常（如 500/网络抖动）时局部兜底标灰，不导致整体白屏；
 * 4. 纯函数聚合计算：
 *    - 组织总进度：任务数加权平均进度（无任务时按项目进度均值兜底）；
 *    - 延期全景：跨项目逾期任务累加、全域延期率与平均/最大逾期天数统计；
 *    - 工时负荷：跨项目人员与项目双维工时汇总、超负荷标记（overloadHint）；
 *    - 里程碑交付率：跨项目里程碑达成率与风险里程碑聚合；
 * 5. 纯客户端零网络副作用：所有聚合计算为确定性纯函数，纯只读零写请求（RL-01）。
 */

import type { Milestone } from '@/lib/api/milestones'
import { milestonesApi } from '@/lib/api/milestones'
import type { Project } from '@/lib/api/projects'
import { projectsApi } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import { tasksApi } from '@/lib/api/tasks'

// ---------------------------------------------------------------------------
// 领域类型定义
// ---------------------------------------------------------------------------

export type OrgReportTemplate = 'progress' | 'delay' | 'workload' | 'milestone'

export const ORG_REPORT_TEMPLATES: readonly OrgReportTemplate[] = [
  'progress',
  'delay',
  'workload',
  'milestone',
] as const

export interface ProjectDataPackage {
  project: Project
  tasks: Task[]
  milestones: Milestone[]
  isDegraded?: boolean
  errorMessage?: string
}

export interface OrgProjectProgressItem {
  projectId: number
  projectName: string
  projectCode: string | null
  status: string
  priority: string
  healthStatus: string
  progressPercent: number
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  notStartedTasks: number
  blockedTasks: number
  isDegraded?: boolean
}

export interface OrgProgressSnapshotData {
  template: 'progress'
  overallProgressPercent: number
  totalProjects: number
  activeProjects: number
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  notStartedTasks: number
  blockedTasks: number
  taskCompletionRate: number
  projectItems: OrgProjectProgressItem[]
  criticalBlockers: Array<{
    projectId: number
    projectName: string
    taskId: number
    title: string
    reason?: string
  }>
}

export interface OrgDelaySnapshotData {
  template: 'delay'
  totalProjects: number
  totalTasksWithDueDate: number
  totalOverdueTasks: number
  overallDelayRatePercent: number
  averageOverdueDays: number
  maxOverdueDays: number
  projectDelays: Array<{
    projectId: number
    projectName: string
    projectCode: string | null
    overdueCount: number
    delayRatePercent: number
    maxOverdueDays: number
    isDegraded?: boolean
  }>
  topOverdueTasks: Array<{
    projectId: number
    projectName: string
    taskId: number
    title: string
    assigneeName?: string
    plannedEndDate: string | null
    overdueDays: number
    onCriticalPath?: boolean
  }>
}

export interface OrgWorkloadMemberBucket {
  userId: number
  displayName: string
  totalTasks: number
  completedTasks: number
  plannedHours: number
  actualHours: number
  overloadHint: boolean
  projectCount: number
}

export interface OrgWorkloadSnapshotData {
  template: 'workload'
  totalProjects: number
  totalMembers: number
  totalPlannedHours: number
  totalActualHours: number
  overallocatedMemberCount: number
  memberWorkloads: OrgWorkloadMemberBucket[]
  projectWorkloads: Array<{
    projectId: number
    projectName: string
    plannedHours: number
    actualHours: number
    taskCount: number
    isDegraded?: boolean
  }>
  unassignedTasksCount: number
  unassignedPlannedHours: number
}

export interface OrgMilestoneSnapshotData {
  template: 'milestone'
  totalProjects: number
  totalMilestones: number
  completedMilestones: number
  overdueMilestones: number
  upcomingMilestones: number
  deliveryRatePercent: number
  milestoneTimeline: Array<{
    projectId: number
    projectName: string
    projectCode: string | null
    milestoneId: number
    name: string
    plannedDate: string
    status: string
    linkedTaskCount: number
    linkedTaskCompletedCount: number
    linkedTaskProgressPercent: number
    overdueDays: number
  }>
  atRiskMilestones: Array<{
    projectId: number
    projectName: string
    milestoneId: number
    name: string
    reason: string
  }>
}

export type OrgReportSnapshotData =
  | OrgProgressSnapshotData
  | OrgDelaySnapshotData
  | OrgWorkloadSnapshotData
  | OrgMilestoneSnapshotData

export interface OrgReportSnapshotMetadata {
  templateVersion: '1.0'
  generatedAt: string
  generatedBy: number | null
  organizationId: number
  includedProjectIds: number[]
  degradedProjectIds: number[]
  warnings: Array<{ level: 'info' | 'warning' | 'critical'; message: string }>
}

export interface OrgReportSnapshot {
  id: string
  template: OrgReportTemplate
  title: string
  organizationId: number
  generatedAt: string
  metadata: OrgReportSnapshotMetadata
  data: OrgReportSnapshotData
}

// ---------------------------------------------------------------------------
// 日期与算术纯工具
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

function parseDate(dateStr: string): number {
  const parts = dateStr.slice(0, 10).split('-')
  if (parts.length !== 3) return Number.NaN
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (isNaN(y) || isNaN(m) || isNaN(d)) return Number.NaN
  return Date.UTC(y, m - 1, d)
}

function daysDiff(fromStr: string, toStr: string): number {
  const f = parseDate(fromStr)
  const t = parseDate(toStr)
  if (isNaN(f) || isNaN(t)) return 0
  return Math.round((t - f) / MS_PER_DAY)
}

function getTodayString(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ---------------------------------------------------------------------------
// 纯函数聚合计算器
// ---------------------------------------------------------------------------

/**
 * 计算跨项目加权平均进度：
 * 优先按项目任务总数进行权重计算；若总任务数为 0，则回退各项目 progressPercent 的算术平均值。
 */
export function calculateWeightedProgress(
  projects: Array<{ progressPercent: number; totalTasks?: number; isDegraded?: boolean }>,
): number {
  const valid = projects.filter((p) => !p.isDegraded)
  if (valid.length === 0) return 0

  const totalTasks = valid.reduce((sum, p) => sum + (p.totalTasks ?? 0), 0)
  if (totalTasks > 0) {
    const weightedSum = valid.reduce((sum, p) => {
      const taskWeight = p.totalTasks ?? 0
      return sum + p.progressPercent * taskWeight
    }, 0)
    return Math.round((weightedSum / totalTasks) * 10) / 10
  }

  const sumProgress = valid.reduce((sum, p) => sum + (p.progressPercent || 0), 0)
  return Math.round((sumProgress / valid.length) * 10) / 10
}

/**
 * 合成组织进度概览报表（Progress Snapshot）
 */
export function composeOrgProgressReport(packages: ProjectDataPackage[]): OrgProgressSnapshotData {
  let totalTasks = 0
  let completedTasks = 0
  let inProgressTasks = 0
  let notStartedTasks = 0
  let blockedTasks = 0

  const criticalBlockers: OrgProgressSnapshotData['criticalBlockers'] = []
  const projectItems: OrgProjectProgressItem[] = []

  for (const pkg of packages) {
    const { project, tasks = [], isDegraded } = pkg

    let pTotal = tasks.length
    let pCompleted = 0
    let pInProgress = 0
    let pNotStarted = 0
    let pBlocked = 0

    if (!isDegraded) {
      for (const t of tasks) {
        if (t.status === 'completed') pCompleted++
        else if (t.status === 'in_progress') pInProgress++
        else if (t.status === 'not_started') pNotStarted++
        else if (t.status === 'blocked') {
          pBlocked++
          criticalBlockers.push({
            projectId: project.id,
            projectName: project.name,
            taskId: t.id,
            title: t.name,
            reason: t.description ?? '任务处于阻塞状态',
          })
        }
      }
    } else {
      // 降级兜底：如果项目异常且未拉取到任务，采用 project.stats 或 0
      pTotal = project.stats?.taskCount ?? 0
    }

    totalTasks += pTotal
    completedTasks += pCompleted
    inProgressTasks += pInProgress
    notStartedTasks += pNotStarted
    blockedTasks += pBlocked

    projectItems.push({
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      status: project.status,
      priority: project.priority,
      healthStatus: project.healthStatus,
      progressPercent: project.progressPercent ?? 0,
      totalTasks: pTotal,
      completedTasks: pCompleted,
      inProgressTasks: pInProgress,
      notStartedTasks: pNotStarted,
      blockedTasks: pBlocked,
      isDegraded,
    })
  }

  const overallProgressPercent = calculateWeightedProgress(
    projectItems.map((p) => ({
      progressPercent: p.progressPercent,
      totalTasks: p.totalTasks,
      isDegraded: p.isDegraded,
    })),
  )

  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  return {
    template: 'progress',
    overallProgressPercent,
    totalProjects: packages.length,
    activeProjects: packages.filter((p) => p.project.status === 'active').length,
    totalTasks,
    completedTasks,
    inProgressTasks,
    notStartedTasks,
    blockedTasks,
    taskCompletionRate,
    projectItems,
    criticalBlockers: criticalBlockers.slice(0, 10),
  }
}

/**
 * 合成全域延期任务全景（Delay Snapshot）
 */
export function composeOrgDelayReport(
  packages: ProjectDataPackage[],
  options?: { today?: string },
): OrgDelaySnapshotData {
  const today = options?.today ?? getTodayString()

  let totalTasksWithDueDate = 0
  let totalOverdueTasks = 0
  let totalOverdueDaysSum = 0
  let maxOverdueDays = 0

  const allOverdueTasks: OrgDelaySnapshotData['topOverdueTasks'] = []
  const projectDelays: OrgDelaySnapshotData['projectDelays'] = []

  for (const pkg of packages) {
    const { project, tasks = [], isDegraded } = pkg
    let pWithDue = 0
    let pOverdue = 0
    let pMaxOverdue = 0

    if (!isDegraded) {
      for (const t of tasks) {
        if (!t.endDate) continue
        pWithDue++

        const isFinished = t.status === 'completed' || t.status === 'cancelled'
        if (!isFinished) {
          const delay = daysDiff(t.endDate, today)
          if (delay > 0) {
            pOverdue++
            totalOverdueDaysSum += delay
            if (delay > pMaxOverdue) pMaxOverdue = delay
            if (delay > maxOverdueDays) maxOverdueDays = delay

            allOverdueTasks.push({
              projectId: project.id,
              projectName: project.name,
              taskId: t.id,
              title: t.name,
              assigneeName: t.agentAssignee?.name ?? undefined,
              plannedEndDate: t.endDate,
              overdueDays: delay,
              onCriticalPath: t.priority === 'highest',
            })
          }
        }
      }
    }

    totalTasksWithDueDate += pWithDue
    totalOverdueTasks += pOverdue

    const pDelayRate = pWithDue > 0 ? Math.round((pOverdue / pWithDue) * 100) : 0

    projectDelays.push({
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      overdueCount: pOverdue,
      delayRatePercent: pDelayRate,
      maxOverdueDays: pMaxOverdue,
      isDegraded,
    })
  }

  allOverdueTasks.sort((a, b) => b.overdueDays - a.overdueDays)

  const overallDelayRatePercent =
    totalTasksWithDueDate > 0 ? Math.round((totalOverdueTasks / totalTasksWithDueDate) * 100) : 0

  const averageOverdueDays =
    totalOverdueTasks > 0 ? Math.round((totalOverdueDaysSum / totalOverdueTasks) * 10) / 10 : 0

  return {
    template: 'delay',
    totalProjects: packages.length,
    totalTasksWithDueDate,
    totalOverdueTasks,
    overallDelayRatePercent,
    averageOverdueDays,
    maxOverdueDays,
    projectDelays,
    topOverdueTasks: allOverdueTasks.slice(0, 20),
  }
}

/**
 * 合成组织资源工时负荷（Workload Snapshot）
 */
export function composeOrgWorkloadReport(packages: ProjectDataPackage[]): OrgWorkloadSnapshotData {
  let totalPlannedHours = 0
  let totalActualHours = 0
  let unassignedTasksCount = 0
  let unassignedPlannedHours = 0

  const memberMap = new Map<
    number,
    {
      userId: number
      displayName: string
      totalTasks: number
      completedTasks: number
      plannedHours: number
      actualHours: number
      projectIds: Set<number>
    }
  >()

  const projectWorkloads: OrgWorkloadSnapshotData['projectWorkloads'] = []

  for (const pkg of packages) {
    const { project, tasks = [], isDegraded } = pkg
    let pPlanned = 0
    let pActual = 0

    if (!isDegraded) {
      for (const t of tasks) {
        const est = t.estimatedHours ?? 0
        const act = t.actualHours ?? 0
        pPlanned += est
        pActual += act

        if (t.assigneeId == null) {
          unassignedTasksCount++
          unassignedPlannedHours += est
        } else {
          const uid = t.assigneeId
          let item = memberMap.get(uid)
          if (!item) {
            item = {
              userId: uid,
              displayName: t.agentAssignee?.name ?? `成员 #${uid}`,
              totalTasks: 0,
              completedTasks: 0,
              plannedHours: 0,
              actualHours: 0,
              projectIds: new Set<number>(),
            }
            memberMap.set(uid, item)
          }
          item.totalTasks++
          if (t.status === 'completed') item.completedTasks++
          item.plannedHours += est
          item.actualHours += act
          item.projectIds.add(project.id)
        }
      }
    }

    totalPlannedHours += pPlanned
    totalActualHours += pActual

    projectWorkloads.push({
      projectId: project.id,
      projectName: project.name,
      plannedHours: Math.round(pPlanned * 10) / 10,
      actualHours: Math.round(pActual * 10) / 10,
      taskCount: tasks.length,
      isDegraded,
    })
  }

  const memberWorkloads: OrgWorkloadMemberBucket[] = []
  let overallocatedMemberCount = 0

  for (const m of memberMap.values()) {
    // 超额分配启示：周计划工时 > 40h 或任务数过载
    const overloadHint = m.plannedHours > 40 || m.totalTasks > 10
    if (overloadHint) overallocatedMemberCount++

    memberWorkloads.push({
      userId: m.userId,
      displayName: m.displayName,
      totalTasks: m.totalTasks,
      completedTasks: m.completedTasks,
      plannedHours: Math.round(m.plannedHours * 10) / 10,
      actualHours: Math.round(m.actualHours * 10) / 10,
      overloadHint,
      projectCount: m.projectIds.size,
    })
  }

  memberWorkloads.sort((a, b) => b.plannedHours - a.plannedHours)

  return {
    template: 'workload',
    totalProjects: packages.length,
    totalMembers: memberWorkloads.length,
    totalPlannedHours: Math.round(totalPlannedHours * 10) / 10,
    totalActualHours: Math.round(totalActualHours * 10) / 10,
    overallocatedMemberCount,
    memberWorkloads,
    projectWorkloads,
    unassignedTasksCount,
    unassignedPlannedHours: Math.round(unassignedPlannedHours * 10) / 10,
  }
}

/**
 * 合成里程碑交付全景（Milestone Snapshot）
 */
export function composeOrgMilestoneReport(
  packages: ProjectDataPackage[],
  options?: { today?: string },
): OrgMilestoneSnapshotData {
  const today = options?.today ?? getTodayString()

  let totalMilestones = 0
  let completedMilestones = 0
  let overdueMilestones = 0
  let upcomingMilestones = 0

  const milestoneTimeline: OrgMilestoneSnapshotData['milestoneTimeline'] = []
  const atRiskMilestones: OrgMilestoneSnapshotData['atRiskMilestones'] = []

  for (const pkg of packages) {
    const { project, milestones = [], isDegraded } = pkg
    if (isDegraded) continue

    for (const m of milestones) {
      totalMilestones++
      const isCompleted = m.status === 'achieved'
      const isOverdue =
        m.status === 'missed' || (!isCompleted && m.plannedDate && m.plannedDate < today)
      const overdueDays =
        isOverdue && m.plannedDate ? Math.max(0, daysDiff(m.plannedDate, today)) : 0

      if (isCompleted) completedMilestones++
      else if (isOverdue) overdueMilestones++
      else upcomingMilestones++

      if (m.status === 'at_risk' || isOverdue) {
        atRiskMilestones.push({
          projectId: project.id,
          projectName: project.name,
          milestoneId: m.id,
          name: m.name,
          reason: m.status === 'at_risk' ? '里程碑被标记为风险态' : `已逾期 ${overdueDays} 天`,
        })
      }

      milestoneTimeline.push({
        projectId: project.id,
        projectName: project.name,
        projectCode: project.code,
        milestoneId: m.id,
        name: m.name,
        plannedDate: m.plannedDate ?? '',
        status: m.status,
        linkedTaskCount: 0,
        linkedTaskCompletedCount: 0,
        linkedTaskProgressPercent: isCompleted ? 100 : 0,
        overdueDays,
      })
    }
  }

  milestoneTimeline.sort((a, b) => (a.plannedDate > b.plannedDate ? 1 : -1))

  const deliveryRatePercent =
    totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0

  return {
    template: 'milestone',
    totalProjects: packages.length,
    totalMilestones,
    completedMilestones,
    overdueMilestones,
    upcomingMilestones,
    deliveryRatePercent,
    milestoneTimeline,
    atRiskMilestones,
  }
}

/**
 * 统一组织级报表快照合成纯函数入口
 */
export function composeOrgReportSnapshot(options: {
  template: OrgReportTemplate
  organizationId: number
  packages: ProjectDataPackage[]
  generatedBy?: number | null
  today?: string
}): OrgReportSnapshot {
  const { template, organizationId, packages, generatedBy = null, today } = options
  const generatedAt = new Date().toISOString()

  const includedProjectIds: number[] = []
  const degradedProjectIds: number[] = []
  const warnings: OrgReportSnapshotMetadata['warnings'] = []

  for (const pkg of packages) {
    includedProjectIds.push(pkg.project.id)
    if (pkg.isDegraded) {
      degradedProjectIds.push(pkg.project.id)
      warnings.push({
        level: 'warning',
        message: `项目「${pkg.project.name}」数据拉取异常，已采取安全降级策略: ${
          pkg.errorMessage ?? '网络异常'
        }`,
      })
    }
  }

  if (packages.length === 0) {
    warnings.push({
      level: 'info',
      message: '当前组织暂无活跃项目纳入报表范围',
    })
  }

  let data: OrgReportSnapshotData
  let title = ''

  switch (template) {
    case 'progress':
      data = composeOrgProgressReport(packages)
      title = '组织进度概览报表'
      break
    case 'delay':
      data = composeOrgDelayReport(packages, { today })
      title = '全域延期任务全景'
      break
    case 'workload':
      data = composeOrgWorkloadReport(packages)
      title = '组织资源工时负荷'
      break
    case 'milestone':
      data = composeOrgMilestoneReport(packages, { today })
      title = '里程碑交付全景'
      break
  }

  return {
    id: `org-report-${template}-${organizationId}-${Date.now()}`,
    template,
    title,
    organizationId,
    generatedAt,
    metadata: {
      templateVersion: '1.0',
      generatedAt,
      generatedBy,
      organizationId,
      includedProjectIds,
      degradedProjectIds,
      warnings,
    },
    data,
  }
}

// ---------------------------------------------------------------------------
// 纯客户端多查询并发合成器（带通道池控制与错误兜底）
// ---------------------------------------------------------------------------

/**
 * 轻量纯 TS 并发池控制器（零新增外部依赖，严格限制通道数 ≤ limit）
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const effectiveLimit = Math.max(1, Math.min(limit, items.length))
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i]!, i)
    }
  })

  await Promise.all(workers)
  return results
}

export interface FetchOrgReportsOptions {
  template?: OrgReportTemplate
  projectIds?: number[]
  maxProjects?: number
  concurrency?: number
  today?: string
  generatedBy?: number | null
}

/**
 * 纯客户端并发多查询提取并组装组织级报表数据
 * - 并发度默认 5（最大 5 并发通道）；
 * - 单项目失败时 safe degradation，不影响其他项目正常计算；
 * - 纯读请求，零网络写副作用（RL-01）。
 */
export async function fetchAndComposeOrgReport(
  organizationId: number,
  options: FetchOrgReportsOptions = {},
): Promise<OrgReportSnapshot> {
  const template = options.template ?? 'progress'
  const concurrency = Math.min(5, options.concurrency ?? 5)
  const maxProjects = options.maxProjects ?? 50

  // 1. 获取组织项目列表
  const projectsRes = await projectsApi.list({ perPage: maxProjects })
  let projects = projectsRes.data ?? []

  // 若传入特定过滤 projectIds，则精准收敛
  if (options.projectIds && options.projectIds.length > 0) {
    const filterSet = new Set(options.projectIds)
    projects = projects.filter((p) => filterSet.has(p.id))
  }

  // 2. 受控并发拉取各项目的任务与里程碑数据
  const packages: ProjectDataPackage[] = await mapConcurrent(
    projects,
    concurrency,
    async (project) => {
      try {
        const [tasksRes, milestonesRes] = await Promise.all([
          tasksApi.list(project.id, { perPage: 100 }),
          milestonesApi.list(project.id, { perPage: 100 }),
        ])
        return {
          project,
          tasks: tasksRes.data ?? [],
          milestones: milestonesRes.data ?? [],
          isDegraded: false,
        }
      } catch (err: unknown) {
        // 单项目失败安全降级：捕获异常，标记 isDegraded
        const msg = err instanceof Error ? err.message : '项目数据接口请求失败'
        return {
          project,
          tasks: [],
          milestones: [],
          isDegraded: true,
          errorMessage: msg,
        }
      }
    },
  )

  // 3. 纯函数合成最终快照
  return composeOrgReportSnapshot({
    template,
    organizationId,
    packages,
    generatedBy: options.generatedBy,
    today: options.today,
  })
}
