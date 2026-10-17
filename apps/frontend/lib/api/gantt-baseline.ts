import { apiFetch } from '@/lib/api-client'

export interface GanttBaselineSnapshot {
  tasks: Array<{ id: number; startDate: string | null; endDate: string | null }>
  milestones: Array<{ id: number; plannedDate: string | null }>
  savedAt: string
}

export interface GanttBaseline {
  id: number
  projectId: number
  snapshot: GanttBaselineSnapshot
  createdBy: number
  createdAt: string
  updatedAt: string | null
}

const path = (projectId: number) => `/projects/${projectId}/gantt/baseline`

export const ganttBaselineApi = {
  get: (projectId: number) => apiFetch<GanttBaseline | null>(path(projectId)),
  save: (projectId: number) => apiFetch<GanttBaseline>(path(projectId), { method: 'POST' }),
}

export const ganttBaselineKeys = {
  all: ['gantt-baselines'] as const,
  detail: (projectId: number) => [...ganttBaselineKeys.all, projectId] as const,
}
