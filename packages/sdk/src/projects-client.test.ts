import { describe, expect, test } from 'vitest'
import type { ProjectDto } from '@aiproj/types'
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

const sampleProject: ProjectDto = {
  id: 1,
  organizationId: 9,
  name: 'demo',
  code: 'DEMO',
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
  createdBy: 1,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
  deletedAt: null,
}

describe('v2-5-typescript-sdk-core projects client', () => {
  test('list → GET /projects with pagination+filter query', async () => {
    const { client, mock } = makeClient([
      {
        match: '/projects',
        method: 'GET',
        ...okEnvelope({
          data: [sampleProject],
          meta: { total: 1, page: 2, perPage: 50, totalPages: 1 },
        }),
      },
    ])
    const result = await client.projects.list({
      page: 2,
      perPage: 50,
      status: 'active',
      includeArchived: true,
    })
    expect(result.data).toHaveLength(1)
    const url = mock.calls[0]!.url
    expect(url).toContain('/projects?')
    expect(url).toContain('page=2')
    expect(url).toContain('perPage=50')
    expect(url).toContain('status=active')
    expect(url).toContain('includeArchived=true')
    expect(mock.calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  test('get → GET /projects/:id, unwraps .data', async () => {
    const { client } = makeClient([
      { match: '/projects/1', method: 'GET', ...okEnvelope({ data: sampleProject }) },
    ])
    const p = await client.projects.get(1)
    expect(p?.id).toBe(1)
  })

  test('create → POST /projects with JSON body, path /projects', async () => {
    const { client, mock } = makeClient([
      { ...okEnvelope({ data: sampleProject }, 201), match: '/projects', method: 'POST' },
    ])
    const p = await client.projects.create({ name: 'demo' })
    expect(p?.id).toBe(1)
    const call = mock.calls[0]!
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe(JSON.stringify({ name: 'demo' }))
    expect(call.url).toBe('http://localhost:3333/api/v1/projects')
  })

  test('update → PATCH /projects/:id', async () => {
    const { client, mock } = makeClient([
      {
        match: '/projects/1',
        method: 'PATCH',
        ...okEnvelope({ data: { ...sampleProject, name: 'renamed' } }),
      },
    ])
    const p = await client.projects.update(1, { name: 'renamed' })
    expect(p?.name).toBe('renamed')
    expect(mock.calls[0]!.init.method).toBe('PATCH')
    expect(mock.calls[0]!.url).toBe('http://localhost:3333/api/v1/projects/1')
  })

  test('archive → POST /projects/:id/archive', async () => {
    const { client, mock } = makeClient([
      {
        match: '/projects/1/archive',
        method: 'POST',
        ...okEnvelope({ data: { ...sampleProject, status: 'archived' } }),
      },
    ])
    const p = await client.projects.archive(1)
    expect(p?.status).toBe('archived')
    expect(mock.calls[0]!.init.method).toBe('POST')
  })

  test('restore → POST /projects/:id/restore', async () => {
    const { client } = makeClient([
      { match: '/projects/1/restore', method: 'POST', ...okEnvelope({ data: sampleProject }) },
    ])
    const p = await client.projects.restore(1)
    expect(p?.id).toBe(1)
  })

  test('archiveOrDelete → DELETE /projects/:id returns undefined on 204', async () => {
    const { client, mock } = makeClient([{ match: '/projects/1', method: 'DELETE', status: 204 }])
    const r = await client.projects.archiveOrDelete(1, { force: true })
    expect(r).toBeUndefined()
    expect(mock.calls[0]!.url).toContain('force=true')
  })

  test('typed return shape: ProjectDto fields accessible', async () => {
    const { client } = makeClient([
      { match: '/projects/1', method: 'GET', ...okEnvelope({ data: sampleProject }) },
    ])
    const p = await client.projects.get(1)
    expect(p?.status).toBe('active')
    expect(p?.priority).toBe('medium')
    expect(p?.organizationId).toBe(9)
  })

  test('propagates auth header to all methods', async () => {
    const { client, mock } = makeClient([
      { match: '/projects', method: 'GET', ...okEnvelope({ data: [], meta: {} }) },
    ])
    await client.projects.list()
    expect(mock.calls[0]!.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Organization-Id': '9',
    })
  })

  test('throws typed ApiErrorResponse on 404', async () => {
    const { client } = makeClient([
      {
        ...okEnvelope({ error: { code: 'RESOURCE_NOT_FOUND', message: 'gone' } }, 404),
        match: '/projects/99',
        method: 'GET',
      },
    ])
    await expect(client.projects.get(99)).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    })
  })
})
