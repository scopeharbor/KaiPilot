import { describe, expect, test } from 'vitest'
import {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_TYPES,
  type ApiErrorEnvelope,
  type ApiErrorResponse,
  type DataResponse,
  type ProjectDto,
  type CreateProjectInput,
  type UpdateProjectInput,
  type ListProjectsQuery,
  type TaskDto,
  type CreateTaskInput,
  type UpdateTaskInput,
  type ListTasksQuery,
} from './api-contracts.js'
import type { PaginationMeta, PaginatedResponse } from './resource.js'

describe('v2-5-typescript-sdk-core shared API contracts', () => {
  test('PROJECT_STATUSES matches backend project validator enum', () => {
    expect(PROJECT_STATUSES).toEqual([
      'draft',
      'planning',
      'active',
      'on_hold',
      'completed',
      'cancelled',
      'archived',
    ])
  })

  test('PROJECT_PRIORITIES matches backend project validator enum', () => {
    expect(PROJECT_PRIORITIES).toEqual(['low', 'medium', 'high', 'critical'])
  })

  test('TASK_STATUSES matches backend task_status_machine enum', () => {
    expect(TASK_STATUSES).toEqual([
      'not_started',
      'in_progress',
      'completed',
      'blocked',
      'on_hold',
      'cancelled',
    ])
  })

  test('TASK_PRIORITIES matches backend task_status_machine enum', () => {
    expect(TASK_PRIORITIES).toEqual(['lowest', 'low', 'medium', 'high', 'highest'])
  })

  test('TASK_TYPES matches backend task_status_machine enum', () => {
    expect(TASK_TYPES).toEqual(['task', 'milestone', 'summary', 'deliverable'])
  })

  test('ApiErrorEnvelope shape is { error: { code, message, details? } }', () => {
    const env: ApiErrorEnvelope = {
      error: { code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'name' } },
    }
    expect(env.error.code).toBe('VALIDATION_ERROR')
    expect(env.error.details).toEqual({ field: 'name' })
  })

  test('ApiErrorResponse carries low-sensitive status/code/message/details only', () => {
    const err: ApiErrorResponse = { status: 404, code: 'RESOURCE_NOT_FOUND', message: 'no' }
    expect(err.status).toBe(404)
    // 不应存在 body/headers 字段
    expect('body' in err).toBe(false)
    expect('headers' in err).toBe(false)
  })

  test('PaginationMeta and PaginatedResponse are reused from resource.ts', () => {
    const meta: PaginationMeta = { total: 1, page: 1, perPage: 20, totalPages: 1 }
    const page: PaginatedResponse<number> = { data: [1], meta }
    expect(page.data).toHaveLength(1)
    expect(page.meta.total).toBe(1)
  })

  test('DataResponse wraps single resource', () => {
    const res: DataResponse<{ id: number }> = { data: { id: 7 } }
    expect(res.data.id).toBe(7)
  })

  test('ProjectDto shape matches projectDto output', () => {
    const p: ProjectDto = {
      id: 1,
      organizationId: 2,
      name: 'n',
      code: 'CODE',
      description: null,
      category: null,
      status: 'active',
      priority: 'medium',
      startDate: null,
      endDate: null,
      actualStartDate: null,
      actualEndDate: null,
      budgetCents: null,
      actualCostCents: null,
      currency: null,
      progressPercent: 0,
      healthStatus: null,
      settings: null,
      createdBy: 3,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
      deletedAt: null,
    }
    expect(p.id).toBe(1)
    // stats 仅 show/$extras 出现，非必填
    expect(p.stats).toBeUndefined()
  })

  test('CreateProjectInput requires name, rest optional', () => {
    const input: CreateProjectInput = { name: 'p' }
    const full: CreateProjectInput = {
      name: 'p',
      code: 'C',
      status: 'draft',
      priority: 'low',
      startDate: '2026-01-01',
      budgetCents: 100,
      currency: 'CNY',
    }
    expect(input.name).toBe('p')
    expect(full.budgetCents).toBe(100)
  })

  test('UpdateProjectInput is Partial<CreateProjectInput>', () => {
    const u: UpdateProjectInput = { status: 'completed' }
    expect(u.status).toBe('completed')
  })

  test('ListProjectsQuery covers filter/sort/pagination/includeArchived', () => {
    const q: ListProjectsQuery = {
      status: 'active',
      priority: 'high',
      search: 'k',
      sort: '-createdAt',
      page: 2,
      perPage: 50,
      includeArchived: true,
    }
    expect(q.includeArchived).toBe(true)
  })

  test('TaskDto shape matches taskDto output', () => {
    const t: TaskDto = {
      id: 1,
      projectId: 2,
      name: 't',
      description: null,
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: null,
      endDate: null,
      actualStartDate: null,
      actualEndDate: null,
      durationDays: null,
      estimatedHours: null,
      actualHours: null,
      progressPercent: 0,
      kanbanRank: null,
      assigneeId: null,
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    }
    expect(t.id).toBe(1)
    expect(t.subtaskCount).toBeUndefined()
  })

  test('CreateTaskInput requires name, projectId from route not in body', () => {
    const input: CreateTaskInput = { name: 't' }
    expect('projectId' in input).toBe(false)
  })

  test('UpdateTaskInput allows nullable assignee/reviewer/parent', () => {
    const u: UpdateTaskInput = { assigneeId: null, reviewerId: 5, progressPercent: 50 }
    expect(u.assigneeId).toBeNull()
  })

  test('ListTasksQuery covers filter/sort/pagination', () => {
    const q: ListTasksQuery = {
      status: 'in_progress',
      assigneeId: 1,
      search: 'k',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      sort: '+name',
      page: 1,
      perPage: 20,
    }
    expect(q.perPage).toBe(20)
  })
})
