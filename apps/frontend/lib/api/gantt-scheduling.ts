import { apiFetch, type ApiError } from '@/lib/api-client'

export type ScheduleOperation = 'move' | 'resize'

/** 服务端 TOCTOU 409 错误码：previewToken 失配（试算期间数据被他人修改）。 */
export const SCHEDULE_STALE_ERROR_CODE = 'SCHEDULE_STALE'

/**
 * 判定错误是否为两阶段提交的 409 并发过期（SCHEDULE_STALE）。
 * 供 apply 流程在 catch 中把 session 置为 stale，而非普通 error。
 */
export function isScheduleStaleError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as Partial<ApiError>
  return candidate.status === 409 || candidate.code === SCHEDULE_STALE_ERROR_CODE
}

export interface GanttScheduleRequest {
  mode: 'preview' | 'commit'
  taskId: number
  operation: ScheduleOperation
  startDate: string
  endDate?: string | null
  autoSchedule: boolean
  previewToken?: string | null
}

export interface GanttScheduleChange {
  taskId: number
  taskName: string
  before: { startDate: string; endDate: string; durationDays: number }
  after: { startDate: string; endDate: string; durationDays: number }
  reason: 'direct_move' | 'direct_resize' | 'dependency'
  dependencyIds: number[]
}

export interface GanttScheduleConflict {
  taskId: number
  taskName: string
  code: 'INBOUND_DEPENDENCY' | 'DEPENDENCY_VIOLATION' | 'CYCLE'
  message: string
  dependencyIds: number[]
}

export interface GanttScheduleResponse {
  changes: GanttScheduleChange[]
  conflicts: GanttScheduleConflict[]
  warnings: string[]
  affectedTaskIds: number[]
  previewToken: string
  committed: boolean
  calendar: { version: number; workdays: number[]; holidays: string[]; extraWorkdays: string[] }
}

export const ganttSchedulingApi = {
  execute: (projectId: number, input: GanttScheduleRequest) =>
    apiFetch<GanttScheduleResponse>(`/projects/${projectId}/gantt/schedule`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

export const ganttScheduleKeys = {
  all: ['gantt-schedule'] as const,
  project: (projectId: number) => [...ganttScheduleKeys.all, projectId] as const,
}
