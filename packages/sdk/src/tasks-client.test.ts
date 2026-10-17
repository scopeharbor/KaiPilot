import { describe, expect, test } from 'vitest'
import type { TaskDto } from '@aiproj/types'
import { AiprojClient } from './index.js'
import { createMockFetch, okEnvelope, type MockResponseRule } from './test-fixtures.js'

function makeClient(rules: MockResponseRule[], fallback?: MockResponseRule, token = 'tok') {
  const mock = createMockFetch({ rules, fallback })
  const client = new AiprojClient({
    baseUrl: 'http://localhost:3333/api/v1',
    fetch: mock.fetch,
    tokenProvider: () => token,
    organizationContextProvider: () => 9,
  })
  return { client, mock }
}

const sampleTask: TaskDto = {
  id: 10,
  projectId: 2,
  name: 'task',
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

describe('v2-5-typescript-sdk-core tasks client', () => {
  test('listForProject → GET /projects/:projectId/tasks with filter/sort/include-free', async () => {
    const { client, mock } = makeClient([
      {
        match: '/projects/2/tasks',
        method: 'GET',
        ...okEnvelope({
          data: [sampleTask],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
      },
    ])
    const result = await client.tasks.listForProject(2, {
      status: 'in_progress',
      assigneeId: 5,
      search: 'k',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      sort: '+name',
      page: 1,
      perPage: 20,
    })
    expect(result.data).toHaveLength(1)
    const url = mock.calls[0]!.url
    expect(url).toContain('/projects/2/tasks?')
    expect(url).toContain('status=in_progress')
    expect(url).toContain('assigneeId=5')
    expect(url).toContain('search=k')
    expect(url).toContain('dateFrom=2026-01-01')
    expect(url).toContain('sort=%2Bname')
  })

  test('get → GET /projects/:projectId/tasks/:taskId nested path', async () => {
    const { client, mock } = makeClient([
      { match: '/projects/2/tasks/10', method: 'GET', ...okEnvelope({ data: sampleTask }) },
    ])
    const t = await client.tasks.get(2, 10)
    expect(t?.id).toBe(10)
    expect(mock.calls[0]!.url).toBe('http://localhost:3333/api/v1/projects/2/tasks/10')
  })

  test('create → POST /projects/:projectId/tasks, body has no projectId', async () => {
    const { client, mock } = makeClient([
      { ...okEnvelope({ data: sampleTask }, 201), match: '/projects/2/tasks', method: 'POST' },
    ])
    const t = await client.tasks.create(2, { name: 'task' })
    expect(t?.id).toBe(10)
    const call = mock.calls[0]!
    expect(call.init.method).toBe('POST')
    expect(call.url).toBe('http://localhost:3333/api/v1/projects/2/tasks')
    const body = JSON.parse(call.init.body as string)
    expect(body.name).toBe('task')
    expect('projectId' in body).toBe(false)
  })

  test('update → PATCH nested path with partial body', async () => {
    const { client, mock } = makeClient([
      {
        match: '/projects/2/tasks/10',
        method: 'PATCH',
        ...okEnvelope({ data: { ...sampleTask, status: 'in_progress' } }),
      },
    ])
    const t = await client.tasks.update(2, 10, { status: 'in_progress', progressPercent: 50 })
    expect(t?.status).toBe('in_progress')
    const body = JSON.parse(mock.calls[0]!.init.body as string)
    expect(body).toEqual({ status: 'in_progress', progressPercent: 50 })
  })

  test('delete → DELETE nested path, 204 → undefined', async () => {
    const { client, mock } = makeClient([
      { match: '/projects/2/tasks/10', method: 'DELETE', status: 204 },
    ])
    const r = await client.tasks.delete(2, 10)
    expect(r).toBeUndefined()
    expect(mock.calls[0]!.init.method).toBe('DELETE')
  })

  test('typed return shape: TaskDto fields accessible', async () => {
    const { client } = makeClient([
      { match: '/projects/2/tasks/10', method: 'GET', ...okEnvelope({ data: sampleTask }) },
    ])
    const t = await client.tasks.get(2, 10)
    expect(t?.taskType).toBe('task')
    expect(t?.projectId).toBe(2)
    expect(t?.createdAt).toBe('2026-01-01T00:00:00Z')
  })

  test('auth propagated to task methods', async () => {
    const { client, mock } = makeClient([
      { match: '/projects/2/tasks', method: 'GET', ...okEnvelope({ data: [], meta: {} }) },
    ])
    await client.tasks.listForProject(2)
    expect(mock.calls[0]!.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Organization-Id': '9',
    })
  })

  test('throws typed ApiErrorResponse on 422', async () => {
    const { client } = makeClient([
      {
        ...okEnvelope(
          { error: { code: 'VALIDATION_ERROR', message: 'bad', details: { name: ['required'] } } },
          422,
        ),
        match: '/projects/2/tasks',
        method: 'POST',
      },
    ])
    await expect(client.tasks.create(2, { name: '' })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    })
  })
})
