import { describe, expect, test } from 'vitest'
import { AiprojClient, NORMALIZED_SDK_ENDPOINT_REGISTRY } from './index.js'
import { createMockFetch, okEnvelope, type MockResponseRule } from './test-fixtures.js'

function makeClient(rules: MockResponseRule[]) {
  const mock = createMockFetch({ rules })
  const client = new AiprojClient({
    baseUrl: 'http://localhost:3333',
    fetch: mock.fetch,
    tokenProvider: () => 'tok',
    organizationContextProvider: () => 9,
  })
  return { client, mock }
}

describe('full API registry-driven SDK clients', () => {
  test('identity and organization clients cover body/auth/error semantics', async () => {
    const { client, mock } = makeClient([
      { match: '/api/v1/auth/login', method: 'POST', ...okEnvelope({ data: { token: 'jwt' } }) },
      {
        match: '/api/v1/organizations/9',
        method: 'PUT',
        ...okEnvelope({ error: { code: 'VALIDATION_ERROR', message: 'bad' } }, 422),
      },
    ])
    const login = await client.api.identity.authLogin({ body: { email: 'a@b.test' } })
    expect(login).toEqual({ data: { token: 'jwt' } })
    expect(mock.calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Organization-Id': '9',
    })
    await expect(
      client.api.organization.organizationsUpdate({
        path: { id: 9 },
        body: { name: '' },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' })
  })

  test('planning clients cover nested path params, query, mutation body, and 204', async () => {
    const { client, mock } = makeClient([
      {
        match: '/api/v1/projects/2/tasks/10/status?include=a&include=b',
        method: 'POST',
        ...okEnvelope({ data: { id: 10, status: 'completed' } }),
      },
      { match: '/api/v1/projects/2/tasks/10', method: 'DELETE', status: 204 },
    ])
    const transition = await client.api.planning.projectsTasksStatus({
      path: { projectId: 2, taskId: 10 },
      query: { include: ['a', 'b'] },
      body: { status: 'completed' },
    })
    expect(transition).toEqual({ data: { id: 10, status: 'completed' } })
    expect(mock.calls[0]?.init.body).toBe(JSON.stringify({ status: 'completed' }))
    const deleted = await client.api.planning.projectsTasksDestroy({
      path: { projectId: 2, taskId: 10 },
    })
    expect(deleted).toBeUndefined()
  })

  test('schedule/resource/risk clients preserve preview-vs-commit as server-owned bodies', async () => {
    const { client, mock } = makeClient([
      {
        match: '/api/v1/projects/7/gantt/baseline',
        method: 'POST',
        ...okEnvelope({ data: { id: 'baseline-1' } }),
      },
      {
        match: '/api/v1/risks/3/status',
        method: 'POST',
        ...okEnvelope({ data: { id: 3, status: 'closed' } }),
      },
    ])
    await client.api['schedule-resource-risk'].projectsGanttBaselineStore({
      path: { projectId: 7 },
      body: { previewToken: 'server-issued-token' },
    })
    await client.api['schedule-resource-risk'].risksStatus({
      path: { id: 3 },
      body: { status: 'closed' },
    })
    expect(mock.calls.map((call) => JSON.parse(String(call.init.body)))).toEqual([
      { previewToken: 'server-issued-token' },
      { status: 'closed' },
    ])
  })

  test('collaboration/reporting clients cover list envelopes and file transfer classifications', async () => {
    const { client } = makeClient([
      {
        match: '/api/v1/projects/2/reports?page=1',
        method: 'GET',
        ...okEnvelope({
          data: [{ id: 1 }],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
      },
    ])
    const reports = await client.api['collaboration-reporting'].projectsReportsIndex({
      path: { projectId: 2 },
      query: { page: 1 },
    })
    expect(reports).toMatchObject({ data: [{ id: 1 }], meta: { total: 1 } })

    const fileClassifications = NORMALIZED_SDK_ENDPOINT_REGISTRY.filter(
      (entry) => entry.supportStatus === 'unsupported-with-reason',
    )
    expect(fileClassifications.every((entry) => entry.reason && entry.owner)).toBe(true)
  })

  test('AI/compiler/integration clients avoid real provider calls and classify SSE endpoints', async () => {
    const { client, mock } = makeClient([
      {
        match: '/api/v1/ai/connections/4/test',
        method: 'POST',
        ...okEnvelope({ data: { status: 'fixture-ok' } }),
      },
    ])
    const result = await client.api['ai-compiler-integration'].aiConnectionsTest({
      path: { id: 4 },
      body: { mode: 'fixture' },
    })
    expect(result).toEqual({ data: { status: 'fixture-ok' } })
    expect(mock.calls).toHaveLength(1)

    const streamingEntries = NORMALIZED_SDK_ENDPOINT_REGISTRY.filter(
      (entry) => entry.supportStatus === 'deferred-with-owner',
    )
    expect(streamingEntries.map((entry) => entry.path).sort()).toEqual([
      '/api/v1/ai/compiler/runs/:id/events',
      '/api/v1/ai/project-drafts/:id/events',
      '/api/v1/ai/project-drafts/stream',
    ])
  })

  test('path guard rejects missing path params before transport call', async () => {
    const { client, mock } = makeClient([okEnvelope({ data: {} })])
    await expect(client.api.planning.projectsTasksShow({ path: { projectId: 2 } })).rejects.toThrow(
      /missing path parameter taskId/,
    )
    expect(mock.calls).toHaveLength(0)
  })
})
