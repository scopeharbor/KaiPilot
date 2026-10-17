import { apiFetch } from '@/lib/api-client'
import type { TaskPriority } from '@/lib/api/tasks'

/** AI 补的字段（界面标 🤖）。 */
export type QuickCreateField = 'name' | 'dates' | 'assignee' | 'wbs' | 'priority'

export interface QuickCreateConflict {
  code: 'overload' | 'non_working' | 'outside_project' | 'after_milestone' | 'duplicate'
  message: string
}

export interface QuickCreateSuggestion {
  name: string
  startDate: string
  endDate: string
  durationDays: number
  assigneeId: number | null
  assigneeName: string | null
  assigneeReason: string | null
  wbsNodeId: number | null
  wbsNodeName: string | null
  priority: TaskPriority
  aiFields: QuickCreateField[]
  conflicts: QuickCreateConflict[]
}

export interface QuickCreateOptions {
  members: Array<{ id: number; name: string; activeTasks: number }>
  workPackages: Array<{ id: number; label: string }>
}

export interface QuickCreateResult {
  tasks: QuickCreateSuggestion[]
  note: string | null
  /** ai = 模型补全；rules = 规则补全（模型未配置 / 失败，或 ai:false）。 */
  source: 'ai' | 'rules'
  options: QuickCreateOptions
}

export interface QuickCreateCheckInput {
  name: string
  startDate: string
  endDate: string
  assigneeId: number | null
}

/** 日历快速新建：选的日期 + 原地输入 → 补全建议（不落库，建任务仍走 tasksApi.create）。 */
export const calendarQuickCreateApi = {
  suggest: (
    projectId: number,
    input: { startDate: string; endDate?: string; text?: string; ai?: boolean },
    signal?: AbortSignal,
  ) =>
    apiFetch<QuickCreateResult>(`/projects/${projectId}/tasks/calendar-suggest`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    }),
  check: (projectId: number, startDate: string, check: QuickCreateCheckInput[]) =>
    apiFetch<{ conflicts: QuickCreateConflict[][] }>(
      `/projects/${projectId}/tasks/calendar-suggest`,
      { method: 'POST', body: JSON.stringify({ startDate, check }) },
    ),
}
