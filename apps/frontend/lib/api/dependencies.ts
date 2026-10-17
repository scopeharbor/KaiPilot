import { apiFetch } from '@/lib/api-client'
import type { TaskStatus } from '@/lib/api/tasks'

export type DependencyType = 'fs' | 'ss' | 'ff' | 'sf'

export interface DependencyTaskSummary {
  id: number
  name: string
  status: TaskStatus
  startDate: string | null
  endDate: string | null
}

export interface TaskDependency {
  id: number
  predecessorId: number
  successorId: number
  type: DependencyType
  lagDays: number
  predecessor: DependencyTaskSummary
  successor: DependencyTaskSummary
  createdAt: string
  updatedAt: string | null
}

export interface TaskDependencyGroups {
  predecessors: TaskDependency[]
  successors: TaskDependency[]
}

export interface CreateDependencyInput {
  predecessorId: number
  type?: DependencyType
  lagDays?: number
}

export const dependenciesApi = {
  list: (projectId: number, taskId: number) =>
    apiFetch<TaskDependencyGroups>(`/projects/${projectId}/tasks/${taskId}/dependencies`),
  /** 项目级：一次性拉取整个项目的依赖（甘特渲染用）。 */
  listByProject: (projectId: number) =>
    apiFetch<TaskDependency[]>(`/projects/${projectId}/dependencies`),
  create: (projectId: number, taskId: number, input: CreateDependencyInput) =>
    apiFetch<TaskDependency>(`/projects/${projectId}/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  delete: (dependencyId: number) =>
    apiFetch<void>(`/dependencies/${dependencyId}`, { method: 'DELETE' }),
}

export const dependencyKeys = {
  all: ['task-dependencies'] as const,
  task: (projectId: number, taskId: number) => [...dependencyKeys.all, projectId, taskId] as const,
  project: (projectId: number) => [...dependencyKeys.all, 'project', projectId] as const,
}
