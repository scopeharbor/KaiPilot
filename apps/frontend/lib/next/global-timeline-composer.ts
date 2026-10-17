/**
 * 跨项目全域时间序列前端多查询合成工具模块
 * (v3-ui-next-batch3-global-convergence W3 任务 3.1 / spec「时间主轴跨项目全域刻度档」).
 *
 * 职责：
 * 1. 纯函数合流：将多个活跃项目的里程碑（plannedDate）与关键任务（排程起止日）按日期严格升序归并，
 *    同一日期下里程碑优先锚定，构建多项目分层泳道时间序列树；
 * 2. 状态与色彩映射：项目特征色彩微标（--nx-chart-1 ~ --nx-chart-8）与里程碑状态微标
 *    （planned 发丝框 / at_risk 琥珀 / achieved 翠绿 / missed 绯红）双通道结合；
 * 3. 刻度与今天锚点：支持周（week）、月（month）、季（quarter）三档刻度换算，
 *    计算今天指示线在坐标系中的相对百分比位置；
 * 4. 前端多查询并发合成：基于 projectsApi.list 并发发起各项目的里程碑与任务查询，
 *    纯客户端内存组装，零新增后端破坏性端点。
 */

import type { Milestone, MilestoneStatus } from '@/lib/api/milestones'
import { milestonesApi } from '@/lib/api/milestones'
import type { Project } from '@/lib/api/projects'
import { projectsApi } from '@/lib/api/projects'
import type { Task, TaskStatus } from '@/lib/api/tasks'
import { tasksApi } from '@/lib/api/tasks'

export type GlobalTimelineScale = 'week' | 'month' | 'quarter'
export type GlobalTimelineNodeType = 'milestone' | 'task'

const MS_PER_DAY = 86_400_000

export const GLOBAL_TIMELINE_QUERY_KEY = ['global-timeline'] as const

/** 项目特征分类色彩令牌（消费 --nx-chart-1 ~ 8，循环分配）。 */
export const PROJECT_COLOR_TOKENS = [
  'var(--nx-chart-1)',
  'var(--nx-chart-2)',
  'var(--nx-chart-3)',
  'var(--nx-chart-4)',
  'var(--nx-chart-5)',
  'var(--nx-chart-6)',
  'var(--nx-chart-7)',
  'var(--nx-chart-8)',
] as const

export function getProjectColorToken(projectId: number): string {
  const index = Math.abs(projectId) % PROJECT_COLOR_TOKENS.length
  return PROJECT_COLOR_TOKENS[index] ?? 'var(--nx-chart-1)'
}

/** 里程碑状态 → 信号色令牌名（css 变量名，供 style/class 消费）。 */
export const GLOBAL_MILESTONE_TONE: Record<MilestoneStatus, string> = {
  not_started: '--nx-text-muted',
  planned: '--nx-text-secondary',
  at_risk: '--nx-status-warning',
  achieved: '--nx-status-success',
  missed: '--nx-status-danger',
}

/** 里程碑状态 → 中文展示文案。 */
export const GLOBAL_MILESTONE_LABEL: Record<MilestoneStatus, string> = {
  not_started: '未开始',
  planned: '计划中',
  at_risk: '有风险',
  achieved: '已达成',
  missed: '已逾期',
}

/** 任务状态 → 信号色令牌名。 */
export const GLOBAL_TASK_TONE: Record<TaskStatus, string> = {
  not_started: '--nx-text-muted',
  in_progress: '--nx-space-cyan',
  completed: '--nx-status-success',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

/** 任务状态 → 中文展示文案。 */
export const GLOBAL_TASK_LABEL: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已挂起',
  cancelled: '已取消',
}

export function milestoneToneToken(status: string): string {
  return GLOBAL_MILESTONE_TONE[status as MilestoneStatus] ?? '--nx-text-muted'
}

export function milestoneStatusLabel(status: string): string {
  return GLOBAL_MILESTONE_LABEL[status as MilestoneStatus] ?? '未知'
}

export function taskToneToken(status: string): string {
  return GLOBAL_TASK_TONE[status as TaskStatus] ?? '--nx-text-muted'
}

export function taskStatusLabel(status: string): string {
  return GLOBAL_TASK_LABEL[status as TaskStatus] ?? '未知'
}

// ---------------------------------------------------------------------------
// 日期工具（'YYYY-MM-DD' UTC 日历算术）
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function dateKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

export function localDateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function todayDateKey(now: Date = new Date()): string {
  return localDateKeyOf(now)
}

export function parseDateKey(key: string): number {
  const parts = key.slice(0, 10).split('-')
  if (parts.length !== 3) return Number.NaN
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    parts[0] === '' ||
    parts[1] === '' ||
    parts[2] === ''
  ) {
    return Number.NaN
  }
  return Date.UTC(year, month - 1, day)
}

export function daysBetween(fromKey: string, toKey: string): number {
  const fromMs = parseDateKey(fromKey)
  const toMs = parseDateKey(toKey)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0
  return Math.round((toMs - fromMs) / MS_PER_DAY)
}

export function compareDateKeys(a: string, b: string): number {
  const aMs = parseDateKey(a)
  const bMs = parseDateKey(b)
  if (Number.isNaN(aMs)) return Number.isNaN(bMs) ? 0 : 1
  if (Number.isNaN(bMs)) return -1
  return aMs < bMs ? -1 : aMs > bMs ? 1 : 0
}

export function addDays(dateStr: string, days: number): string {
  const ms = parseDateKey(dateStr)
  if (Number.isNaN(ms)) return dateStr
  const d = new Date(ms + days * MS_PER_DAY)
  return dateKeyOf(d)
}

// ---------------------------------------------------------------------------
// 视图模型接口
// ---------------------------------------------------------------------------

export interface GlobalTimelineNode {
  /** 稳定唯一键（`m-<milestoneId>` / `t-<taskId>`）。 */
  id: string
  type: GlobalTimelineNodeType
  projectId: number
  projectName: string
  projectColorToken: string
  name: string
  /** 主轴锚定日期（里程碑 = plannedDate，任务 = endDate ?? startDate）。 */
  date: string
  startDate?: string
  endDate?: string
  status: string
  statusLabel: string
  statusTone: string
  isOverdue: boolean
  isAchievedOrCompleted: boolean
  progressPercent?: number
  durationDays?: number
  assigneeName?: string
  description?: string | null
  rawMilestone?: Milestone
  rawTask?: Task
}

export interface GlobalTimelineProjectLane {
  project: Project
  projectId: number
  projectName: string
  projectStatus: string
  progressPercent: number
  colorToken: string
  nodes: GlobalTimelineNode[]
  milestones: GlobalTimelineNode[]
  tasks: GlobalTimelineNode[]
  earliestDate: string | null
  latestDate: string | null
}

export interface GlobalTimelineTick {
  date: string
  label: string
  percent: number
}

export interface GlobalTimelineSeriesTree {
  lanes: GlobalTimelineProjectLane[]
  allNodes: GlobalTimelineNode[]
  minDate: string
  maxDate: string
  todayDate: string
  scale: GlobalTimelineScale
  totalDays: number
  todayPercent: number
  ticks: GlobalTimelineTick[]
}

// ---------------------------------------------------------------------------
// 节点构建与归并
// ---------------------------------------------------------------------------

function numericIdOf(nodeId: string): number {
  const dash = nodeId.indexOf('-')
  if (dash === -1) return 0
  const val = Number(nodeId.slice(dash + 1))
  return Number.isFinite(val) ? val : 0
}

export function compareGlobalTimelineNodes(a: GlobalTimelineNode, b: GlobalTimelineNode): number {
  const byDate = compareDateKeys(a.date, b.date)
  if (byDate !== 0) return byDate
  // 相同日期：里程碑优先锚定，其次按类别与数字 ID 升序
  if (a.type !== b.type) return a.type === 'milestone' ? -1 : 1
  return numericIdOf(a.id) - numericIdOf(b.id)
}

function toMilestoneNode(
  milestone: Milestone,
  project: Project,
  todayStr: string,
): GlobalTimelineNode | null {
  if (!milestone.plannedDate) return null
  const isOverdue =
    milestone.status === 'missed' ||
    (compareDateKeys(milestone.plannedDate, todayStr) < 0 && milestone.status !== 'achieved')

  return {
    id: `m-${milestone.id}`,
    type: 'milestone',
    projectId: project.id,
    projectName: project.name,
    projectColorToken: getProjectColorToken(project.id),
    name: milestone.name,
    date: milestone.plannedDate,
    status: milestone.status,
    statusLabel: milestoneStatusLabel(milestone.status),
    statusTone: milestoneToneToken(milestone.status),
    isOverdue,
    isAchievedOrCompleted: milestone.status === 'achieved',
    description: milestone.description,
    rawMilestone: milestone,
  }
}

function toTaskNode(task: Task, project: Project, todayStr: string): GlobalTimelineNode | null {
  const anchorDate = task.endDate ?? task.startDate
  if (!anchorDate) return null

  const isOverdue =
    task.endDate != null &&
    compareDateKeys(task.endDate, todayStr) < 0 &&
    task.status !== 'completed' &&
    task.status !== 'cancelled'

  const assigneeName =
    task.assigneeType === 'agent'
      ? (task.agentAssignee?.name ?? task.assignee?.fullName ?? task.assignee?.email ?? undefined)
      : (task.assignee?.fullName ?? task.assignee?.email ?? undefined)

  return {
    id: `t-${task.id}`,
    type: 'task',
    projectId: project.id,
    projectName: project.name,
    projectColorToken: getProjectColorToken(project.id),
    name: task.name,
    date: anchorDate,
    startDate: task.startDate ?? undefined,
    endDate: task.endDate ?? undefined,
    status: task.status,
    statusLabel: taskStatusLabel(task.status),
    statusTone: taskToneToken(task.status),
    isOverdue,
    isAchievedOrCompleted: task.status === 'completed',
    progressPercent: task.progressPercent,
    durationDays: task.durationDays ?? undefined,
    assigneeName,
    description: task.description,
    rawTask: task,
  }
}

// ---------------------------------------------------------------------------
// 刻度标尺生成器
// ---------------------------------------------------------------------------

function generateTicks(
  minDate: string,
  maxDate: string,
  totalDays: number,
  scale: GlobalTimelineScale,
): GlobalTimelineTick[] {
  const ticks: GlobalTimelineTick[] = []
  if (totalDays <= 0) return ticks

  let stepDays = 7
  if (scale === 'month') stepDays = 15
  if (scale === 'quarter') stepDays = 30

  let currentMs = parseDateKey(minDate)
  const maxMs = parseDateKey(maxDate)

  while (currentMs <= maxMs) {
    const d = new Date(currentMs)
    const dateStr = dateKeyOf(d)
    const elapsed = daysBetween(minDate, dateStr)
    const percent = Math.max(0, Math.min(100, (elapsed / totalDays) * 100))

    let label = `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`
    if (scale === 'month') {
      label = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
    } else if (scale === 'quarter') {
      const q = Math.floor(d.getUTCMonth() / 3) + 1
      label = `${d.getUTCFullYear()} Q${q}`
    }

    ticks.push({ date: dateStr, label, percent })
    currentMs += stepDays * MS_PER_DAY
  }

  return ticks
}

// ---------------------------------------------------------------------------
// 纯函数主合成器 (composeGlobalTimelineSeries)
// ---------------------------------------------------------------------------

export interface ComposeGlobalTimelineOptions {
  projects: Project[]
  milestonesMap: Record<number, Milestone[]>
  tasksMap: Record<number, Task[]>
  today?: string
  scale?: GlobalTimelineScale
  minDateOverride?: string
  maxDateOverride?: string
}

export function composeGlobalTimelineSeries({
  projects,
  milestonesMap,
  tasksMap,
  today,
  scale = 'month',
  minDateOverride,
  maxDateOverride,
}: ComposeGlobalTimelineOptions): GlobalTimelineSeriesTree {
  const todayStr = today ?? todayDateKey()
  const allNodes: GlobalTimelineNode[] = []
  const lanes: GlobalTimelineProjectLane[] = []

  let globalMinDate: string | null = null
  let globalMaxDate: string | null = null

  for (const project of projects) {
    const pMilestones = milestonesMap[project.id] ?? []
    const pTasks = tasksMap[project.id] ?? []

    const milestoneNodes: GlobalTimelineNode[] = []
    for (const m of pMilestones) {
      const node = toMilestoneNode(m, project, todayStr)
      if (node) {
        milestoneNodes.push(node)
      }
    }

    const taskNodes: GlobalTimelineNode[] = []
    for (const t of pTasks) {
      const node = toTaskNode(t, project, todayStr)
      if (node) {
        taskNodes.push(node)
      }
    }

    const laneNodes = [...milestoneNodes, ...taskNodes]
    laneNodes.sort(compareGlobalTimelineNodes)
    allNodes.push(...laneNodes)

    let laneEarliest: string | null = null
    let laneLatest: string | null = null
    if (laneNodes.length > 0) {
      laneEarliest = laneNodes[0]!.date
      laneLatest = laneNodes[laneNodes.length - 1]!.date

      if (!globalMinDate || compareDateKeys(laneEarliest, globalMinDate) < 0) {
        globalMinDate = laneEarliest
      }
      if (!globalMaxDate || compareDateKeys(laneLatest, globalMaxDate) > 0) {
        globalMaxDate = laneLatest
      }
    }

    lanes.push({
      project,
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
      progressPercent: project.progressPercent,
      colorToken: getProjectColorToken(project.id),
      nodes: laneNodes,
      milestones: milestoneNodes,
      tasks: taskNodes,
      earliestDate: laneEarliest,
      latestDate: laneLatest,
    })
  }

  allNodes.sort(compareGlobalTimelineNodes)

  // 确定全局时间轴起止范围
  let minDate = minDateOverride ?? globalMinDate
  let maxDate = maxDateOverride ?? globalMaxDate

  // 默认视口外扩：按刻度尺度对齐
  const padBefore = scale === 'week' ? 7 : scale === 'month' ? 15 : 30
  const padAfter = scale === 'week' ? 14 : scale === 'month' ? 30 : 60

  if (!minDate || !maxDate) {
    minDate = addDays(todayStr, -padBefore)
    maxDate = addDays(todayStr, padAfter)
  } else {
    // 确保今天锚点包含在视口中
    if (compareDateKeys(todayStr, minDate) < 0) {
      minDate = todayStr
    }
    if (compareDateKeys(todayStr, maxDate) > 0) {
      maxDate = todayStr
    }
    minDate = addDays(minDate, -padBefore)
    maxDate = addDays(maxDate, padAfter)
  }

  const totalDays = Math.max(1, daysBetween(minDate, maxDate))
  const todayOffset = daysBetween(minDate, todayStr)
  const todayPercent = Math.max(0, Math.min(100, (todayOffset / totalDays) * 100))

  const ticks = generateTicks(minDate, maxDate, totalDays, scale)

  return {
    lanes,
    allNodes,
    minDate,
    maxDate,
    todayDate: todayStr,
    scale,
    totalDays,
    todayPercent,
    ticks,
  }
}

// ---------------------------------------------------------------------------
// 纯客户端多查询并发提取器 (fetchGlobalTimelineData)
// ---------------------------------------------------------------------------

export interface FetchGlobalTimelineOptions {
  maxProjects?: number
  today?: string
  scale?: GlobalTimelineScale
}

export async function fetchGlobalTimelineData(
  options: FetchGlobalTimelineOptions = {},
): Promise<GlobalTimelineSeriesTree> {
  const maxProjects = options.maxProjects ?? 20
  const projectsRes = await projectsApi.list({ perPage: maxProjects })
  const projects = projectsRes.data ?? []

  const milestonesMap: Record<number, Milestone[]> = {}
  const tasksMap: Record<number, Task[]> = {}

  // 并发拉取所有活跃项目的里程碑与重点任务
  await Promise.all(
    projects.map(async (project) => {
      try {
        const [milestonesRes, tasksRes] = await Promise.all([
          milestonesApi.list(project.id, { perPage: 100 }),
          tasksApi.list(project.id, { perPage: 100 }),
        ])
        milestonesMap[project.id] = milestonesRes.data ?? []
        tasksMap[project.id] = tasksRes.data ?? []
      } catch {
        milestonesMap[project.id] = []
        tasksMap[project.id] = []
      }
    }),
  )

  return composeGlobalTimelineSeries({
    projects,
    milestonesMap,
    tasksMap,
    today: options.today,
    scale: options.scale ?? 'month',
  })
}
