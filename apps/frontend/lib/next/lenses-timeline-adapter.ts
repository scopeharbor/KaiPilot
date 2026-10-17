/**
 * 时间线流向镜头纯函数适配层（v3-ui-next-remaining-lenses W4 任务 4.1 / spec「时间线流向镜头里程碑与任务流动呈现」）。
 *
 * 职责：
 * 1. 双数据源合流：将里程碑（plannedDate）与项目任务（排程截止日）按日期严格升序
 *    合并为线性流向节点链表，同一日期下里程碑优先锚定（tasks 4.1）；
 * 2. 状态语义推导：里程碑沿用后端五态展示态（planned / at_risk / achieved / missed）；
 *    任务「逾期」按 endDate 早于今天且未完结（completed / cancelled 豁免）推导；
 * 3. 今天插值索引：`computeTodayIndex` 返回「今天」在流向链表中的相对浮点插入位置
 *    ——精确命中某锚点日期时为整数，落在两锚点之间时按日距线性插值，供 UI 在
 *    流动主轴上标定发光「今天」指示器；
 * 4. 阶段任务流聚类：`collectStageTaskNodes` 抽取两相邻里程碑之间的同阶段任务节点。
 *
 * 本模块为纯函数层，与 React / DOM 完全解耦；全部日期均为 'YYYY-MM-DD' 日历字符串，
 * 比较与差值均走 UTC 日历算术，规避 DST 抖动。
 */

import type { Milestone, MilestoneStatus } from '@/lib/api/milestones'
import type { Task, TaskStatus } from '@/lib/api/tasks'

const MS_PER_DAY = 86_400_000

/** 流向节点类别：里程碑锚点 / 阶段任务推进。 */
export type TimelineFlowNodeType = 'milestone' | 'task'

/** 时间线流向节点（里程碑或阶段任务在主轴上的统一视图模型）。 */
export interface TimelineFlowNode {
  /** 稳定唯一键（`m-<milestoneId>` / `t-<taskId>`）。 */
  id: string
  type: TimelineFlowNodeType
  /** 主轴锚定日期 'YYYY-MM-DD'（里程碑=计划达成日，任务=排程截止日兜底起始日）。 */
  date: string
  name: string
  /** 原生日志状态（里程碑五态 / 任务六态），由 UI 侧消费中文标签与信号色。 */
  status: string
  /** 里程碑已达成 / 任务已完成（历史侧实线语义）。 */
  isAchievedOrCompleted: boolean
  /** 已逾期（里程碑 missed / 任务越过截止日未完结）。 */
  isOverdue: boolean
  /** 负责人显示名（人类 fullName/email，Agent 取 agentAssignee.name）。 */
  assigneeName?: string
  /** 是否为 AI Agent 负责人。 */
  isAgent?: boolean
  /** 任务进度百分比（0–100，仅任务节点）。 */
  progress?: number
  /** 任务工期天数（仅任务节点）。 */
  durationDays?: number
  rawMilestone?: Milestone
  rawTask?: Task
}

/** `buildTimelineFlowChain` 组装结果：升序链表 + 今天指示器插值位置。 */
export interface TimelineFlowChainResult {
  chain: TimelineFlowNode[]
  /** 「今天」在链表中的相对插值索引（浮点；空链表为 0）。 */
  todayIndex: number
  totalNodes: number
}

// ---------------------------------------------------------------------------
// 日期工具（'YYYY-MM-DD' 日历字符串域）
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把 Date 按本地日历转为 'YYYY-MM-DD'（今天键来源）。 */
export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 当前系统日期键；可注入 now 以获得确定性（测试）。 */
export function todayDateKey(now: Date = new Date()): string {
  return dateKeyOf(now)
}

/** 解析 'YYYY-MM-DD' → UTC 毫秒（纯日历算术，规避 DST）。非法键返回 NaN。 */
function parseDateKey(key: string): number {
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

/** 两日期键之间的整天数（`to - from`；任一侧非法返回 0）。 */
export function daysBetween(fromKey: string, toKey: string): number {
  const fromMs = parseDateKey(fromKey)
  const toMs = parseDateKey(toKey)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0
  return Math.round((toMs - fromMs) / MS_PER_DAY)
}

/** 日历升序比较（-1 / 0 / 1）；非法键排至有效键之后。 */
export function compareDateKeys(a: string, b: string): number {
  const aMs = parseDateKey(a)
  const bMs = parseDateKey(b)
  if (Number.isNaN(aMs)) return Number.isNaN(bMs) ? 0 : 1
  if (Number.isNaN(bMs)) return -1
  return aMs < bMs ? -1 : aMs > bMs ? 1 : 0
}

// ---------------------------------------------------------------------------
// 状态语义色 / 文案映射（design §5：仅消费 --nx-* 令牌，零硬编码色值）
// ---------------------------------------------------------------------------

/** 里程碑状态 → 主轴菱形发丝色令牌（css 变量名，不含 var()）。 */
export const TIMELINE_MILESTONE_TONE: Record<MilestoneStatus, string> = {
  not_started: '--nx-text-muted',
  planned: '--nx-text-secondary',
  at_risk: '--nx-status-warning',
  achieved: '--nx-status-success',
  missed: '--nx-status-danger',
}

/** 里程碑状态 → 中文文案。 */
export const TIMELINE_MILESTONE_LABEL: Record<MilestoneStatus, string> = {
  not_started: '未开始',
  planned: '计划中',
  at_risk: '有风险',
  achieved: '已达成',
  missed: '已逾期',
}

/** 里程碑状态 → 发丝色令牌（未知状态兜底 muted）。 */
export function milestoneToneToken(status: string): string {
  return TIMELINE_MILESTONE_TONE[status as MilestoneStatus] ?? '--nx-text-muted'
}

/** 里程碑状态 → 中文文案（未知状态兜底）。 */
export function milestoneStatusLabel(status: string): string {
  return TIMELINE_MILESTONE_LABEL[status as MilestoneStatus] ?? '未知'
}

/** 任务状态 → 信号色令牌（与 NEXT_STATUS_HAIRLINE_TOKEN 同语义，本镜头独立维护）。 */
export const TIMELINE_TASK_TONE: Record<TaskStatus, string> = {
  not_started: '--nx-text-muted',
  in_progress: '--nx-space-cyan',
  completed: '--nx-status-success',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

/** 任务状态 → 信号色令牌（未知状态兜底 muted）。 */
export function taskToneToken(status: string): string {
  return TIMELINE_TASK_TONE[status as TaskStatus] ?? '--nx-text-muted'
}

// ---------------------------------------------------------------------------
// 流向节点构建
// ---------------------------------------------------------------------------

/** 里程碑节点：未设定计划日期者无法锚定主轴，返回 null（不计入流向）。 */
function toMilestoneFlowNode(milestone: Milestone): TimelineFlowNode | null {
  if (!milestone.plannedDate) return null
  return {
    id: `m-${milestone.id}`,
    type: 'milestone',
    date: milestone.plannedDate,
    name: milestone.name,
    status: milestone.status,
    isAchievedOrCompleted: milestone.status === 'achieved',
    isOverdue: milestone.status === 'missed',
    rawMilestone: milestone,
  }
}

/** 任务节点：以排程截止日（兜底起始日）参与流向；两端均无日期者不参与流向。 */
function toTaskFlowNode(task: Task, todayKey: string): TimelineFlowNode | null {
  const anchorDate = task.endDate ?? task.startDate
  if (!anchorDate) return null
  const isAgent = task.assigneeType === 'agent'
  const assigneeName = isAgent
    ? (task.agentAssignee?.name ?? task.assignee?.fullName ?? task.assignee?.email ?? undefined)
    : (task.assignee?.fullName ?? task.assignee?.email ?? undefined)
  const isOverdue =
    task.endDate != null &&
    compareDateKeys(task.endDate, todayKey) < 0 &&
    task.status !== 'completed' &&
    task.status !== 'cancelled'
  const node: TimelineFlowNode = {
    id: `t-${task.id}`,
    type: 'task',
    date: anchorDate,
    name: task.name,
    status: task.status,
    isAchievedOrCompleted: task.status === 'completed',
    isOverdue,
    progress: task.progressPercent,
    rawTask: task,
  }
  if (assigneeName) node.assigneeName = assigneeName
  if (isAgent) node.isAgent = true
  if (task.durationDays != null) node.durationDays = task.durationDays
  return node
}

/** 同日同类型节点按数字 id 稳定排序（'m-2' 恒先于 'm-10'）。 */
function numericIdOf(nodeId: string): number {
  const dash = nodeId.indexOf('-')
  if (dash === -1) return 0
  const value = Number(nodeId.slice(dash + 1))
  return Number.isFinite(value) ? value : 0
}

function compareFlowNodes(a: TimelineFlowNode, b: TimelineFlowNode): number {
  const byDate = compareDateKeys(a.date, b.date)
  if (byDate !== 0) return byDate
  // 相同日期：里程碑先锚定，其次任务按 id 升序。
  if (a.type !== b.type) return a.type === 'milestone' ? -1 : 1
  return numericIdOf(a.id) - numericIdOf(b.id)
}

/**
 * 双源合流：里程碑 + 任务 → 日期严格升序的线性流向链表（tasks 4.1）。
 * `todayStr` 缺省取当前系统日期；显式注入可获得确定性（测试）。
 */
export function buildTimelineFlowChain(
  milestones: Milestone[],
  tasks: Task[],
  todayStr: string = todayDateKey(),
): TimelineFlowChainResult {
  const chain: TimelineFlowNode[] = []
  for (const milestone of milestones) {
    const node = toMilestoneFlowNode(milestone)
    if (node) chain.push(node)
  }
  for (const task of tasks) {
    const node = toTaskFlowNode(task, todayStr)
    if (node) chain.push(node)
  }
  chain.sort(compareFlowNodes)
  return { chain, todayIndex: computeTodayIndex(chain, todayStr), totalNodes: chain.length }
}

/**
 * 「今天」相对插值索引：今天落在链表两锚点日期之间时按日距线性插值，
 * 精确命中某锚点日期时返回该锚点整数索引；早于全部锚点钉在起点 0，
 * 晚于全部锚点钉在末端（lastIndex）；空链表返回 0。
 */
export function computeTodayIndex(
  chain: TimelineFlowNode[],
  todayStr: string = todayDateKey(),
): number {
  if (chain.length === 0) return 0
  // 下界：首个 date >= today 的槽位（左闭右开二分）。
  let low = 0
  let high = chain.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const midNode = chain[mid]
    if (midNode && compareDateKeys(midNode.date, todayStr) < 0) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  if (low === 0) return 0
  const nextNode = chain[low]
  if (!nextNode) return chain.length - 1 // 今天晚于全部锚点 → 钉在末端
  if (compareDateKeys(nextNode.date, todayStr) === 0) return low
  const prevNode = chain[low - 1]
  if (!prevNode) return 0
  const spanDays = daysBetween(prevNode.date, nextNode.date)
  const offsetDays = daysBetween(prevNode.date, todayStr)
  const fraction = spanDays > 0 ? Math.min(1, Math.max(0, offsetDays / spanDays)) : 0
  return low - 1 + fraction
}

/**
 * 阶段任务流聚类：返回 chain 中紧随 `milestoneIndex` 里程碑锚点之后、
 * 直至下一里程碑之前的同阶段任务节点（design §5「相邻里程碑之间串联阶段任务」）。
 */
export function collectStageTaskNodes(
  chain: TimelineFlowNode[],
  milestoneIndex: number,
): TimelineFlowNode[] {
  if (milestoneIndex < 0 || milestoneIndex >= chain.length) return []
  const stage: TimelineFlowNode[] = []
  for (let i = milestoneIndex + 1; i < chain.length; i += 1) {
    const node = chain[i]
    if (!node) break
    if (node.type === 'milestone') break
    stage.push(node)
  }
  return stage
}
