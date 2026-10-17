/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { linkCandidatesApi, linkCandidateKeys } from '@/lib/api/link-candidates'
import type { LinkCandidateDto } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock auth store — Zustand-compatible (callable + .getState())
// ---------------------------------------------------------------------------

vi.mock('@/stores/auth-store', () => {
  const state = {
    isAuthenticated: true,
    token: 'test-token',
    currentOrganizationId: 1,
    refreshToken: 'test-refresh',
    hasPermission: (perm: string) => perm === 'task:view' || perm === 'task:update',
    setTokens: () => {},
    clear: () => {},
  }
  const store: any = (selector?: any) => {
    return selector ? selector(state) : state
  }
  store.getState = () => state
  return { useAuthStore: store }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  } as Response
}

function candidate(overrides: Partial<LinkCandidateDto> = {}): LinkCandidateDto {
  return {
    id: 1,
    organizationId: 1,
    provider: 'github',
    repositoryFullName: 'org/repo',
    repositoryExternalId: 'R_kg123',
    eventType: 'pull_request',
    deliveryId: 'del-001',
    objectType: 'pull_request',
    objectId: '42',
    taskReference: 'PROJ-123',
    taskId: 100,
    taskTitle: 'Implement login',
    evidences: [
      { sourceField: 'pullRequestTitle', matchedPreview: 'PROJ-123 login', ruleVersion: 1 },
    ],
    confidenceClass: 'high',
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
    settledAt: null,
    settledBy: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// §6.2 API client 测试
// ---------------------------------------------------------------------------

describe('linkCandidatesApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('list 构造正确 URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    await linkCandidatesApi.list(1, 100)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/tasks/100/link-candidates'),
      expect.anything(),
    )
  })

  test('list 支持分页参数', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    await linkCandidatesApi.list(1, 100, { page: 2, perPage: 10, status: 'pending' })
    const url = (globalThis.fetch as any).mock.calls[0][0] as string
    expect(url).toContain('page=2')
    expect(url).toContain('perPage=10')
    expect(url).toContain('status=pending')
  })

  test('confirm 发送 POST 请求', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(201, { data: { id: 1, status: 'confirmed', message: 'ok' } }),
    )
    await linkCandidatesApi.confirm(1, 100, 1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/link-candidates/1/confirm'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('ignore 发送 POST 请求', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, { data: { id: 1, status: 'ignored', message: 'ok' } }),
    )
    await linkCandidatesApi.ignore(1, 100, 1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/link-candidates/1/ignore'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

// ---------------------------------------------------------------------------
// §6.2 Query keys
// ---------------------------------------------------------------------------

describe('linkCandidateKeys', () => {
  test('all 返回 root key', () => {
    expect(linkCandidateKeys.all).toEqual(['link-candidates'])
  })

  test('list 包含 projectId 和 taskId', () => {
    expect(linkCandidateKeys.list(1, 100)).toEqual(['link-candidates', 'list', 1, 100])
  })

  test('不同 taskId 产生不同 key', () => {
    expect(linkCandidateKeys.list(1, 100)).not.toEqual(linkCandidateKeys.list(1, 101))
  })
})

// ---------------------------------------------------------------------------
// §6.4 UI 渲染测试
// ---------------------------------------------------------------------------

describe('LinkCandidatesPanel rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('API client 返回正确形状', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        data: [candidate()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    const result = await linkCandidatesApi.list(1, 100)
    expect(result.data).toHaveLength(1)
    expect(result.meta.total).toBe(1)
    expect(result.data[0]?.taskReference).toBe('PROJ-123')
  })

  test('confirm mutation 返回正确结果', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(201, {
        data: { id: 1, status: 'confirmed', externalLinkId: 42, message: 'ok' },
      }),
    )
    const result = await linkCandidatesApi.confirm(1, 100, 1)
    expect(result.data.status).toBe('confirmed')
    expect(result.data.externalLinkId).toBe(42)
  })

  test('ignore mutation 返回正确结果', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, { data: { id: 1, status: 'ignored', message: 'ok' } }),
    )
    const result = await linkCandidatesApi.ignore(1, 100, 1)
    expect(result.data.status).toBe('ignored')
  })

  test('空候选列表返回 meta 正确', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    const result = await linkCandidatesApi.list(1, 100)
    expect(result.meta.total).toBe(0)
    expect(result.data).toHaveLength(0)
  })

  test('权限错误返回 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: '无权访问' } }),
    )
    try {
      await linkCandidatesApi.list(1, 100)
      // 403 应抛异常
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(403)
    }
  })
})
