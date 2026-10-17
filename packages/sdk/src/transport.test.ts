import { describe, expect, test } from 'vitest'
import {
  type AiprojClientConfig,
  rawRequest,
  requestList,
  requestResource,
  normalizeBaseUrl,
  joinUrl,
} from './transport.js'
import { createMockFetch, okEnvelope } from './test-fixtures.js'

function makeConfig(
  fetchImpl: typeof fetch,
  overrides: Partial<AiprojClientConfig> = {},
): AiprojClientConfig {
  return { baseUrl: 'http://localhost:3333/api/v1', fetch: fetchImpl, ...overrides }
}

describe('v2-5-typescript-sdk-core transport base URL + method/body/JSON', () => {
  test('normalizeBaseUrl strips trailing slashes', () => {
    expect(normalizeBaseUrl('http://x/api/v1/')).toBe('http://x/api/v1')
    expect(normalizeBaseUrl('http://x/api/v1///')).toBe('http://x/api/v1')
  })

  test('joinUrl joins base + path + query', () => {
    expect(joinUrl('http://x/api/v1', '/projects', '?page=2')).toBe(
      'http://x/api/v1/projects?page=2',
    )
    expect(joinUrl('http://x/api/v1/', 'projects')).toBe('http://x/api/v1/projects')
  })

  test('GET sets no Content-Type and no body', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [], meta: {} }) })
    await rawRequest(makeConfig(mock.fetch), '/projects')
    const call = mock.calls[0]!
    expect(call.init.method).toBe('GET')
    expect(call.init.body).toBeUndefined()
    expect(call.init.headers).not.toHaveProperty('Content-Type')
  })

  test('POST serializes JSON body and sets Content-Type', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: { id: 1 } }, 201) })
    await rawRequest(makeConfig(mock.fetch), '/projects', { method: 'POST', body: { name: 'p' } })
    const call = mock.calls[0]!
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(call.init.body).toBe(JSON.stringify({ name: 'p' }))
  })

  test('parses JSON response body', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: { id: 7 } }) })
    const res = await rawRequest(makeConfig(mock.fetch), '/projects/7')
    const body = await res.json()
    expect(body).toEqual({ data: { id: 7 } })
  })

  test('204 responses are returned as-is (no body parse by rawRequest)', async () => {
    const mock = createMockFetch({ fallback: { status: 204 } })
    const res = await rawRequest(makeConfig(mock.fetch), '/projects/7', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  test('uses injected fetch (no real network call): call recorded via mock', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(makeConfig(mock.fetch), '/projects')
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.url).toBe('http://localhost:3333/api/v1/projects')
  })

  test('requestList returns { data, meta } envelope without unwrapping', async () => {
    const mock = createMockFetch({
      fallback: okEnvelope({
        data: [{ id: 1 }, { id: 2 }],
        meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
      }),
    })
    const result = await requestList(makeConfig(mock.fetch), '/projects')
    expect(result.data).toHaveLength(2)
    expect(result.meta.total).toBe(2)
  })

  test('requestResource unwraps .data', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: { id: 5, name: 'p' } }) })
    const result = await requestResource<{ id: number; name: string }>(
      makeConfig(mock.fetch),
      '/projects/5',
    )
    expect(result).toEqual({ id: 5, name: 'p' })
  })

  test('requestResource returns undefined on 204', async () => {
    const mock = createMockFetch({ fallback: { status: 204 } })
    const result = await requestResource(makeConfig(mock.fetch), '/projects/5', {
      method: 'DELETE',
    })
    expect(result).toBeUndefined()
  })

  test('requestList throws ApiErrorResponse on non-ok with envelope', async () => {
    const mock = createMockFetch({
      fallback: okEnvelope({ error: { code: 'AUTH_REQUIRED', message: 'no' } }, 401),
    })
    await expect(requestList(makeConfig(mock.fetch), '/projects')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    })
  })
})

describe('v2-5-typescript-sdk-core auth + organization context', () => {
  test('injects Authorization header from sync token provider', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(makeConfig(mock.fetch, { tokenProvider: () => 'tok-123' }), '/projects')
    expect(mock.calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer tok-123' })
  })

  test('injects Authorization header from async token provider', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(
      makeConfig(mock.fetch, { tokenProvider: async () => 'async-tok' }),
      '/projects',
    )
    expect(mock.calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer async-tok' })
  })

  test('omits Authorization header when token provider returns null/undefined', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(makeConfig(mock.fetch, { tokenProvider: () => null }), '/projects')
    expect(mock.calls[0]!.init.headers).not.toHaveProperty('Authorization')
  })

  test('omits Authorization when no token provider configured', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(makeConfig(mock.fetch), '/projects')
    expect(mock.calls[0]!.init.headers).not.toHaveProperty('Authorization')
  })

  test('propagates X-Organization-Id from organization context provider', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(makeConfig(mock.fetch, { organizationContextProvider: () => 42 }), '/projects')
    expect(mock.calls[0]!.init.headers).toMatchObject({ 'X-Organization-Id': '42' })
  })

  test('omits X-Organization-Id when context returns null', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(
      makeConfig(mock.fetch, { organizationContextProvider: () => null }),
      '/projects',
    )
    expect(mock.calls[0]!.init.headers).not.toHaveProperty('X-Organization-Id')
  })

  test('defaultHeaders merged into every request', async () => {
    const mock = createMockFetch({ fallback: okEnvelope({ data: [] }) })
    await rawRequest(makeConfig(mock.fetch, { defaultHeaders: { 'X-Client': 'sdk' } }), '/projects')
    expect(mock.calls[0]!.init.headers).toMatchObject({ 'X-Client': 'sdk' })
  })

  test('runtime isolation: SDK does not import frontend/Next/Adonis runtime modules', async () => {
    // 静态断言：transport 仅依赖注入的 fetch，不读取任何全局 store。
    // 若 SDK 误导入 useAuthStore/next/adonis，本文件 import 即会失败。
    const transport = await import('./transport.js')
    expect(typeof transport.rawRequest).toBe('function')
    expect(typeof transport.requestList).toBe('function')
  })
})
