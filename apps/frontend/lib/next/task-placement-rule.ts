import type { KanbanColumn } from '@/lib/api/kanban'
import type { CreateTaskInput, TaskPriority, TaskStatus, TaskType } from '@/lib/api/tasks'

/**
 * 放置建任务规则式补全引擎（v3-ui-next-project-space D5 / 任务 3.1）。
 *
 * - 纯函数、零副作用：给定一句话输入与放置目标列，本地推断默认字段组合；
 * - 推断字段全部挂载 `AIMarker` 待确认标记（RL-01：AI 只建议不自动执行，
 *   落库必须由用户在放置卡片上显式确认）；
 * - 仅做规则式推断，不发起任何网络请求（模型推理留待 B3a 工具编排层）。
 */

/** AIMarker 待确认标记（design D5：source / confidence / needsConfirmation / reason）。 */
export interface AIMarker {
  source: 'rule_based'
  confidence: 0.85
  needsConfirmation: true
  reason: string
}

export const PLACEMENT_CONFIDENCE = 0.85
export const PLACEMENT_MARKER_REASON = '根据放置目标列与上下文默认推断'
export const PLACEMENT_DEFAULT_DURATION_DAYS = 1
export const PLACEMENT_DEFAULT_ESTIMATED_HOURS = 8
export const PLACEMENT_DEFAULT_PRIORITY: TaskPriority = 'medium'
export const PLACEMENT_DEFAULT_TASK_TYPE: TaskType = 'task'

/** 规则式补全产出：待确认草案（未落库，本地态）。 */
export interface PlacementDraft {
  name: string
  status: TaskStatus
  priority: TaskPriority
  taskType: TaskType
  startDate: string
  endDate: string | null
  durationDays: number
  estimatedHours: number
  assigneeId: number | null
  marker: AIMarker
}

/** 生成 AIMarker（source 固定 rule_based，confidence 固定 0.85）。 */
export function createPlacementMarker(): AIMarker {
  return {
    source: 'rule_based',
    confidence: PLACEMENT_CONFIDENCE,
    needsConfirmation: true,
    reason: PLACEMENT_MARKER_REASON,
  }
}

/** 本地时区 YYYY-MM-DD（toISOString 会受 UTC 偏移影响，禁止用于日期锚点）。 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 放置目标列继承初始状态：处于「进行中」列则为 in_progress，其余一律 not_started。
 * （design D5：各列初始状态投影，与 KANBAN_COLUMNS 首选状态一致。）
 */
export function targetStatusForColumn(columnId: KanbanColumn): TaskStatus {
  return columnId === 'in_progress' ? 'in_progress' : 'not_started'
}

/** 提取任务优先级（支持自然语言推断） */
export function inferTaskPriority(text: string): { priority: TaskPriority; matchedText?: string } {
  if (/紧急|最高|特急|critical|blocker|p0/i.test(text)) {
    return {
      priority: 'highest',
      matchedText: text.match(/紧急|最高|特急|critical|blocker|p0/i)?.[0],
    }
  }
  if (/最低/i.test(text)) {
    return { priority: 'lowest', matchedText: text.match(/最低/i)?.[0] }
  }
  if (/(?:高优先级|高优|重要|high|p1|(?:\b|\s|^|[,，])高(?:\b|\s|$|[,，]))/i.test(text)) {
    return {
      priority: 'high',
      matchedText: text.match(
        /(?:高优先级|高优|重要|high|p1|(?:\b|\s|^|[,，])高(?:\b|\s|$|[,，]))/i,
      )?.[0],
    }
  }
  if (/(?:低优先级|低优|次要|low|p3|(?:\b|\s|^|[,，])低(?:\b|\s|$|[,，]))/i.test(text)) {
    return {
      priority: 'low',
      matchedText: text.match(
        /(?:低优先级|低优|次要|low|p3|(?:\b|\s|^|[,，])低(?:\b|\s|$|[,，]))/i,
      )?.[0],
    }
  }
  if (/(?:中优先级|中等|普通|medium|p2|(?:\b|\s|^|[,，])中(?:\b|\s|$|[,，]))/i.test(text)) {
    return {
      priority: 'medium',
      matchedText: text.match(
        /(?:中优先级|中等|普通|medium|p2|(?:\b|\s|^|[,，])中(?:\b|\s|$|[,，]))/i,
      )?.[0],
    }
  }
  return { priority: PLACEMENT_DEFAULT_PRIORITY }
}

/** 提取任务工期天数（支持自然语言推断） */
export function inferTaskDuration(text: string): { durationDays: number; matchedText?: string } {
  const daysMatch = text.match(/(\d+)\s*(?:天|日)/)
  if (daysMatch) {
    return { durationDays: Number(daysMatch[1]), matchedText: daysMatch[0] }
  }
  const weeksMatch = text.match(/(\d+)\s*(?:周|个星期)/)
  if (weeksMatch) {
    return { durationDays: Number(weeksMatch[1]) * 7, matchedText: weeksMatch[0] }
  }
  const monthsMatch = text.match(/(\d+)\s*(?:个月|月)/)
  if (monthsMatch) {
    return { durationDays: Number(monthsMatch[1]) * 30, matchedText: monthsMatch[0] }
  }
  return { durationDays: PLACEMENT_DEFAULT_DURATION_DAYS }
}

/**
 * 规则式补全：从一句话意图提取任务名称并推断默认字段组合。
 *
 * - `name`：输入去首尾空白并剥离工期/优先级词（必填，为空返回 null，调用方保持输入态）；
 * - `status`：继承放置目标列初始状态；
 * - `durationDays` 与 `estimatedHours`：推断工期，默认工期折合一天八小时；
 * - `startDate`：对齐今天锚点（本地 YYYY-MM-DD）；`endDate: null`；
 * - `priority`：推断优先级，默认 medium；`assigneeId: null`（未分配负责人）；
 * - 全部推断字段挂载 AIMarker（confidence 0.85 / needsConfirmation true）。
 */
export function inferTaskPlacementDraft(
  input: string,
  columnId: KanbanColumn = 'pending',
  today: Date = new Date(),
): PlacementDraft | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const priorityResult = inferTaskPriority(trimmed)
  const durationResult = inferTaskDuration(trimmed)

  let cleanName = trimmed
  if (priorityResult.matchedText) {
    cleanName = cleanName.replace(priorityResult.matchedText, '')
  }
  if (durationResult.matchedText) {
    cleanName = cleanName.replace(durationResult.matchedText, '')
  }
  cleanName = cleanName.replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim()

  const finalName = cleanName || trimmed

  return {
    name: finalName,
    status: targetStatusForColumn(columnId),
    priority: priorityResult.priority,
    taskType: PLACEMENT_DEFAULT_TASK_TYPE,
    startDate: formatDateKey(today),
    endDate: null,
    durationDays: durationResult.durationDays,
    estimatedHours: durationResult.durationDays * 8,
    assigneeId: null,
    marker: createPlacementMarker(),
  }
}

/** 就地微调覆盖项（durationDays / priority，design D5 待确认预览微调）。 */
export interface PlacementTweaks {
  durationDays?: number
  priority?: TaskPriority
  assigneeId?: number | null
  startDate?: string
}

/**
 * 由待确认草案组装 `CreateTaskInput`（对齐 tasksApi.create 契约，RL-04）。
 *
 * - 只搬运业务字段，绝不携带 AIMarker（服务端 CreateTaskInput 无该字段）；
 * - 可空字段（assigneeId / endDate）为 null 时省略，避免向后端发送 null。
 */
export function buildPlacementCreateInput(
  draft: PlacementDraft,
  tweaks: PlacementTweaks = {},
): CreateTaskInput {
  const input: CreateTaskInput = {
    name: draft.name,
    status: draft.status,
    priority: tweaks.priority ?? draft.priority,
    taskType: draft.taskType,
    startDate: tweaks.startDate ?? draft.startDate,
    durationDays: tweaks.durationDays ?? draft.durationDays,
    estimatedHours: draft.estimatedHours,
  }
  if (draft.endDate != null) input.endDate = draft.endDate
  const assigneeId = tweaks.assigneeId !== undefined ? tweaks.assigneeId : draft.assigneeId
  if (assigneeId != null) input.assigneeId = assigneeId
  return input
}
