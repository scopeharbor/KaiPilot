// v3-ai-tools-orchestration-layer W2 —— 有界输出映射器
//
// 各 handler 统一把 Luxon DateTime / Lucid 模型映射为有界 JSON 安全对象：
// - 绝不把模型整体 toJSON 抖落（避免 customFields/aiMetadata 等噪音字段进入 AI 上下文）；
// - date 字段统一 ISO 日期字符串，null 保留；
// - 聚合计数（依赖/子任务）从 $extras 读取（TaskService.attachListAggregates 产出）。
import type Risk from '#models/risk'
import { readTaskSteps, type StepsSnapshot } from '#services/task_status_sync'
import type Task from '#models/task'

export interface BoundedTaskItem {
  id: number
  name: string
  status: string
  priority: string
  taskType: string
  startDate: string | null
  endDate: string | null
  durationDays: number | null
  progressPercent: number
  assigneeId: number | null
  assigneeType: string | null
  parentTaskId: number | null
  wbsNodeId: number | null
  milestoneId: number | null
  dependencyCount: number
  subtaskCount: number
}

export interface BoundedTaskDetail extends BoundedTaskItem {
  description: string | null
  estimatedHours: number | null
  assignee: { id: number; fullName: string | null } | null
  reviewer: { id: number; fullName: string | null } | null
  parent: { id: number; name: string } | null
  /** 执行步骤（序号从 1 起，AI 同事「把第 2 步打勾」按这个序号）。 */
  steps: Array<{ n: number; text: string; done: boolean }>
}

export interface BoundedRiskItem {
  id: number
  riskCode: string | null
  title: string
  category: string
  probability: number
  impact: number
  score: number
  riskLevel: string
  status: string
  priority: string
  ownerId: number | null
  identifiedAt: string | null
  targetResolutionDate: string | null
  mitigationStrategy: string | null
}

function extrasCount(task: Task, key: 'dependencyCount' | 'subtaskCount'): number {
  const value = task.$extras[key]
  return typeof value === 'number' ? value : 0
}

/** 列表/详情共用的有界任务条目。 */
export function toBoundedTask(task: Task): BoundedTaskItem {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    priority: task.priority,
    taskType: task.taskType,
    startDate: task.startDate?.toISODate() ?? null,
    endDate: task.endDate?.toISODate() ?? null,
    durationDays: task.durationDays,
    progressPercent: Number(task.progressPercent ?? 0),
    assigneeId: task.assigneeId,
    assigneeType: task.assigneeType,
    parentTaskId: task.parentTaskId,
    wbsNodeId: task.wbsNodeId,
    milestoneId: task.milestoneId,
    dependencyCount: extrasCount(task, 'dependencyCount'),
    subtaskCount: extrasCount(task, 'subtaskCount'),
  }
}

/** 单任务详情（TaskService.get 已 preload assignee/reviewer/parent/subtasks）。 */
export function toBoundedTaskDetail(task: Task): BoundedTaskDetail {
  return {
    ...toBoundedTask(task),
    description: task.description,
    estimatedHours: task.estimatedHours,
    assignee: task.assignee ? { id: task.assignee.id, fullName: task.assignee.fullName } : null,
    reviewer: task.reviewer ? { id: task.reviewer.id, fullName: task.reviewer.fullName } : null,
    parent: task.parent ? { id: task.parent.id, name: task.parent.name } : null,
    steps: numberedSteps({
      customFields: (task.customFields as Record<string, unknown> | null) ?? null,
      description: task.description ?? null,
    }),
  }
}

/** 执行步骤带序号与勾选（AI 同事看详情 / 勾选步骤用同一份序号）。 */
export function numberedSteps(
  task: StepsSnapshot,
): Array<{ n: number; text: string; done: boolean }> {
  const { steps, done } = readTaskSteps(task)
  return steps.map((text, index) => ({ n: index + 1, text, done: done[index] ?? false }))
}

/** 风险登记有界条目（不含触发条件等长文本全文）。 */
export function toBoundedRisk(risk: Risk): BoundedRiskItem {
  return {
    id: risk.id,
    riskCode: risk.riskCode,
    title: risk.title,
    category: risk.category,
    probability: risk.probability,
    impact: risk.impact,
    score: risk.score,
    riskLevel: risk.riskLevel,
    status: risk.status,
    priority: risk.priority,
    ownerId: risk.ownerId,
    identifiedAt: risk.identifiedAt?.toISODate() ?? null,
    targetResolutionDate: risk.targetResolutionDate?.toISODate() ?? null,
    mitigationStrategy: risk.mitigationStrategy,
  }
}
