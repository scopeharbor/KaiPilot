import { describe, expect, test } from 'vitest'
import { AiprojClient } from './index.js'
import { createMockFetch, okEnvelope, type MockResponseRule } from './test-fixtures.js'

function makeClient(rules: MockResponseRule[]) {
  const mock = createMockFetch({ rules })
  const client = new AiprojClient({
    baseUrl: 'http://localhost:3333',
    fetch: mock.fetch,
    tokenProvider: () => 'tok',
  })
  return { client, mock }
}

describe('v2-5-typescript-sdk-core escape hatch (rawRequest / request)', () => {
  test('rawRequest accepts /api/v1 path and reuses transport', async () => {
    const { client, mock } = makeClient([
      { match: '/api/v1/projects', method: 'GET', ...okEnvelope({ data: [], meta: {} }) },
    ])
    const body = await client.rawRequest('/api/v1/projects')
    expect(body).toEqual({ data: [], meta: {} })
    expect(mock.calls[0]!.url).toBe('http://localhost:3333/api/v1/projects')
  })

  test('rawRequest rejects non-/api/v1 path', async () => {
    const { client } = makeClient([okEnvelope({})])
    await expect(client.rawRequest('/api/v2/stub')).rejects.toThrow(/only permits paths/)
    await expect(client.rawRequest('/projects')).rejects.toThrow(/only permits paths/)
    await expect(client.rawRequest('http://evil.example/api/v1/x')).rejects.toThrow(
      /only permits paths/,
    )
  })

  test('rawRequest reuses auth pipeline (Authorization injected)', async () => {
    const { client, mock } = makeClient([
      { match: '/api/v1/projects/1', method: 'GET', ...okEnvelope({ data: { id: 1 } }) },
    ])
    await client.rawRequest('/api/v1/projects/1')
    expect(mock.calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  test('rawRequest reuses error pipeline on non-ok', async () => {
    const { client } = makeClient([
      {
        ...okEnvelope({ error: { code: 'PERMISSION_DENIED', message: 'no' } }, 403),
        match: '/api/v1/projects/1',
        method: 'DELETE',
      },
    ])
    await expect(
      client.rawRequest('/api/v1/projects/1', { method: 'DELETE' }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    })
  })

  test('rawRequest deterministic query via query option', async () => {
    const { client, mock } = makeClient([
      { match: '/api/v1/projects', method: 'GET', ...okEnvelope({ data: [], meta: {} }) },
    ])
    await client.rawRequest('/api/v1/projects', { query: '?page=3&perPage=10' })
    expect(mock.calls[0]!.url).toBe('http://localhost:3333/api/v1/projects?page=3&perPage=10')
  })

  test('rawRequest returns undefined on 204', async () => {
    const { client } = makeClient([{ match: '/api/v1/projects/1', method: 'DELETE', status: 204 }])
    const r = await client.rawRequest('/api/v1/projects/1', { method: 'DELETE' })
    expect(r).toBeUndefined()
  })

  test('request (list convenience) returns { data, meta } and guards path', async () => {
    const { client } = makeClient([
      {
        match: '/api/v1/projects',
        method: 'GET',
        ...okEnvelope({
          data: [{ id: 1 }],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
      },
    ])
    const res = await client.request('/api/v1/projects')
    expect(res.data).toHaveLength(1)
    expect(res.meta.total).toBe(1)
    await expect(client.request('/projects')).rejects.toThrow(/only permits paths/)
  })
})
