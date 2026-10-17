import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL } from '@/lib/api-client'
import { getUnreadCount, performAction, queryInbox, refreshInbox } from '@/lib/api/suggestion-inbox'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 收件箱客户端必须走 apiFetch：此前裸 fetch 前端同源相对路径、不带令牌，
 * 浏览器里四个接口全部失败。这里锁定「后端地址 + Bearer 令牌 + 解包 data」。
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('suggestion-inbox 客户端', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    useAuthStore.setState({ accessToken: 'token-abc' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastCall() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return { url, headers: new Headers(init?.headers), init }
  }

  it('查询走后端地址并携带 Bearer 令牌，返回解包后的 data', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { entries: [], total: 0 } }))
    const result = await queryInbox({ projectId: 7, perPage: 100 })
    const { url, headers } = lastCall()
    expect(url).toBe(`${API_BASE_URL}/copilot-suggestion-inbox?projectId=7&perPage=100`)
    expect(headers.get('Authorization')).toBe('Bearer token-abc')
    expect(result).toEqual({ entries: [], total: 0 })
  })

  it('未读计数取 data.unreadCount', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { unreadCount: 4 } }))
    await expect(getUnreadCount(7)).resolves.toBe(4)
    expect(lastCall().url).toBe(`${API_BASE_URL}/copilot-suggestion-inbox/unread-count?projectId=7`)
  })

  it('状态动作与刷新以 JSON POST 发送', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { entryId: '5', previousState: 'read', newState: 'adopted' } }),
    )
    await performAction('5', 'adopt')
    let call = lastCall()
    expect(call.url).toBe(`${API_BASE_URL}/copilot-suggestion-inbox/5/action`)
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe(JSON.stringify({ action: 'adopt' }))

    fetchMock.mockResolvedValue(jsonResponse({ data: { aggregated: 0, missingSources: [] } }))
    await refreshInbox(7)
    call = lastCall()
    expect(call.url).toBe(`${API_BASE_URL}/copilot-suggestion-inbox/refresh`)
    expect(call.headers.get('Authorization')).toBe('Bearer token-abc')
  })

  it('失败时抛出后端错误信息', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'projectId 必填' } }, 422),
    )
    await expect(refreshInbox(7)).rejects.toMatchObject({ message: 'projectId 必填' })
  })
})
