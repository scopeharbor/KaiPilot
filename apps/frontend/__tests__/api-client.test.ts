import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  apiFetch,
  refreshSession,
  membersApi,
  organizationsApi,
  setOnSessionExpired,
  usersApi,
} from '@/lib/api-client'
import { attachmentsApi } from '@/lib/api/files'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

describe('lib/api-client', () => {
  beforeEach(() => {
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith(['task:view']),
      refreshToken: 'refresh-1',
    })
    setOnSessionExpired(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('正常请求返回 data 字段', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(200, { data: { id: 42 } })))
    const data = await apiFetch<{ id: number }>('/tasks/42')
    expect(data.id).toBe(42)
  })

  test('附件上传带 access token，且不把 FormData 标成 JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { data: { id: 7, originalName: 'a.png' } }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const created = await attachmentsApi.upload(3, { entityType: 'project', entityId: 3 }, file)
    expect(created.id).toBe(7)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/projects\/3\/attachments$/)
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toMatch(/^Bearer /)
    expect(headers.get('Content-Type')).toBeNull()
    expect(init.body).toBeInstanceOf(FormData)
  })

  test('保留 envelope 中合法的 null data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(200, { data: null })))

    await expect(apiFetch<null>('/projects/2/gantt-baseline')).resolves.toBeNull()
  })

  test('401 触发静默刷新后重放原请求', async () => {
    const fetchMock = vi
      .fn()
      // 首次业务请求 → 401
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }))
      // refresh → 200 新 token
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: { accessToken: accessTokenWith(['task:view']), refreshToken: 'refresh-2' },
        }),
      )
      // 重放 → 200
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await apiFetch<{ ok: boolean }>('/tasks')
    expect(data.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // 刷新后 store 更新为新 refresh token
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2')
  })

  test('刷新失败：清会话并触发 onSessionExpired', async () => {
    const onExpired = vi.fn()
    setOnSessionExpired(onExpired)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } })) // refresh 也 401
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ status: 401 })
    expect(onExpired).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('刷新时后端不可达（网络错误）：本次请求失败，但保留会话、不触发过期', async () => {
    const onExpired = vi.fn()
    setOnSessionExpired(onExpired)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // 后端热重载中
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ status: 401 })
    expect(onExpired).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().refreshToken).toBe('refresh-1')
  })

  test('刷新返回 5xx：临时故障不登出', async () => {
    const onExpired = vi.fn()
    setOnSessionExpired(onExpired)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ status: 401 })
    expect(onExpired).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  test('单飞：并发 401 只触发一次 refresh', async () => {
    let refreshCalls = 0
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/auth/refresh')) {
        refreshCalls += 1
        return Promise.resolve(
          jsonResponse(200, {
            data: { accessToken: accessTokenWith(['task:view']), refreshToken: 'refresh-x' },
          }),
        )
      }
      // 业务请求：第一次 401，刷新后 200
      return Promise.resolve(
        refreshCalls === 0
          ? jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } })
          : jsonResponse(200, { data: { ok: true } }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')])
    expect(refreshCalls).toBe(1)
  })

  test('非 401 错误直接抛出 ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: '权限不足' } }),
        ),
    )
    await expect(apiFetch('/x')).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    })
  })

  test('用户、组织、成员资源方法使用约定端点与方法', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: 7 } }))
      .mockResolvedValueOnce(jsonResponse(201, { data: { id: 9 } }))
    vi.stubGlobal('fetch', fetchMock)

    const users = await usersApi.list({ search: '甲' })
    await organizationsApi.update(7, { name: '新名称' })
    await membersApi.invite(7, { email: 'member@example.com' })

    expect(users.meta.total).toBe(0)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/users?search=')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' })
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/organizations/7/members/invite')
  })
})

describe('跨账号迟到请求与刷新隔离', () => {
  const login = (id: number) =>
    useAuthStore.getState().setSession({
      user: { id, email: `${id}@test.local`, fullName: null, organizations: [] },
      accessToken: accessTokenWith([], { sub: id }),
      refreshToken: `refresh-${id}`,
    })
  afterEach(() => vi.restoreAllMocks())

  test('旧请求返回 401 时不使用新账号重放旧操作', async () => {
    login(101)
    let finish!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const pending = apiFetch('/copilot/turns', {
      method: 'POST',
      body: JSON.stringify({ text: 'A 的私有输入' }),
    })
    login(102)
    finish(jsonResponse(401, { error: { code: 'AUTH_REQUIRED' } }))
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_SCOPE_CHANGED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().user?.id).toBe(102)
  })

  test.each([200, 401])('旧 refresh 返回 %s 不覆盖或登出新账号', async (status) => {
    login(101)
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      ),
    )
    const pending = refreshSession()
    login(102)
    finish(
      jsonResponse(status, { data: { accessToken: 'old-token', refreshToken: 'old-refresh' } }),
    )
    expect(await pending).toBe(false)
    expect(useAuthStore.getState().user?.id).toBe(102)
    expect(useAuthStore.getState().refreshToken).toBe('refresh-102')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
