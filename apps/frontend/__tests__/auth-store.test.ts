import { beforeEach, describe, expect, test } from 'vitest'
import { vi } from 'vitest'
import { selectPlanTier, useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

describe('stores/auth-store', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
  })

  test('setSession 写入用户并解析 access token 权限声明', () => {
    const accessToken = accessTokenWith(['task:view', 'project:view'], { roleVersion: 3 })
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken,
      refreshToken: 'r1',
    })

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.permissions).toEqual(['task:view', 'project:view'])
    expect(s.roleVersion).toBe(3)
    expect(s.hasPermission('task:view')).toBe(true)
    expect(s.hasPermission('org:manage')).toBe(false)
  })

  test('系统管理员哨兵权限放行一切展示', () => {
    useAuthStore.getState().setSession({
      user: {
        id: 9,
        email: 'admin@x.com',
        fullName: null,
        isSuperAdmin: true,
        organizations: [],
      },
      accessToken: accessTokenWith([]),
      refreshToken: 'r',
    })
    expect(useAuthStore.getState().hasPermission('anything:at:all')).toBe(true)
  })

  test('system:admin 权限串同样放行', () => {
    useAuthStore.getState().setSession({
      user: { id: 2, email: 'x@y.com', fullName: null, organizations: [] },
      accessToken: accessTokenWith(['system:admin']),
      refreshToken: 'r',
    })
    expect(useAuthStore.getState().hasPermission('org:manage')).toBe(true)
  })

  test('setTokens 静默刷新仅更新 token 与权限，保留 user', () => {
    const store = useAuthStore.getState()
    store.setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith(['task:view']),
      refreshToken: 'r1',
    })
    store.setTokens({
      accessToken: accessTokenWith(['task:view', 'task:create']),
      refreshToken: 'r2',
    })

    const s = useAuthStore.getState()
    expect(s.user?.id).toBe(1)
    expect(s.refreshToken).toBe('r2')
    expect(s.permissions).toContain('task:create')
  })

  test('clear 清空认证态', () => {
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith(['task:view']),
      refreshToken: 'r1',
    })
    useAuthStore.getState().clear()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.user).toBeNull()
    expect(s.permissions).toEqual([])
    expect(s.planTier).toBeNull()
  })

  test('setSession 解析 planTier：user DTO 优先，JWT 兜底，缺失/非法为 null', () => {
    // user DTO 优先于 JWT 声明
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', planTier: 'team', organizations: [] },
      accessToken: accessTokenWith([], { planTier: 'free' }),
      refreshToken: 'r',
    })
    expect(useAuthStore.getState().planTier).toBe('team')

    // user DTO 缺失 → JWT 声明兜底
    useAuthStore.getState().clear()
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith([], { planTier: 'enterprise' }),
      refreshToken: 'r',
    })
    expect(useAuthStore.getState().planTier).toBe('enterprise')

    // 非法值 → null（按 free 处理，最保守；JWT 声明的脏数据同样被归一）
    useAuthStore.getState().clear()
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith([], { planTier: 'platinum' }),
      refreshToken: 'r',
    })
    expect(useAuthStore.getState().planTier).toBeNull()

    // 全部缺失 → null
    useAuthStore.getState().clear()
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith([]),
      refreshToken: 'r',
    })
    expect(useAuthStore.getState().planTier).toBeNull()
    expect(selectPlanTier(useAuthStore.getState())).toBeNull()
  })

  test('setTokens 保留 user 的 planTier，JWT 兜底更新', () => {
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith([]),
      refreshToken: 'r1',
    })
    useAuthStore.getState().setTokens({
      accessToken: accessTokenWith([], { planTier: 'free' }),
      refreshToken: 'r2',
    })
    expect(useAuthStore.getState().planTier).toBe('free')
  })

  // v3-multitenant-tenant-identification §4.1/§8.2：switchOrganization 已从"复用未认证的
  // refresh 轮换"改为走受保护端点 `POST /account/organization-selection`。旧路径仍保留兼容
  // （`switchOrganizationSession`），但 store 不再用它——新路径带 owner fallback，
  // 且非成员统一 404 不区分。
  test('switchOrganization 走受保护选择端点并重载组织与权限 claims', async () => {
    useAuthStore.getState().setSession({
      user: {
        id: 1,
        email: 'a@b.com',
        fullName: '甲',
        organizations: [
          { id: 1, name: '甲组织', slug: 'a', role: 'owner' },
          { id: 2, name: '乙组织', slug: 'b', role: 'viewer' },
        ],
      },
      accessToken: accessTokenWith(['org:manage'], { organizationId: 1 }),
      refreshToken: 'r1',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            effectiveContext: {
              actorRef: 'user:1',
              organizationId: 2,
              scopeMode: 'tenant',
              selectionSource: 'server_selection',
              resolutionReason: 'RESOLVED',
              scopeHash: 'hash-org-2',
              resolvedAt: new Date().toISOString(),
              warningCodes: [],
              isSuperAdmin: false,
            },
            scopeHash: 'hash-org-2',
            accessToken: accessTokenWith(['org:view'], { organizationId: 2 }),
            selectionEpoch: 2,
            invalidation: { selectionEpoch: 2, entries: [] },
          },
        }),
      }),
    )

    await useAuthStore.getState().switchOrganization(2)
    const s = useAuthStore.getState()
    expect(s.currentOrganizationId).toBe(2)
    expect(s.permissions).toEqual(['org:view'])
    expect(s.selectionEpoch).toBe(2)
    expect(s.effectiveTenantContext?.scopeHash).toBe('hash-org-2')
    // refresh token 不随组织切换轮换（切换只换 access claims）。
    expect(s.refreshToken).toBe('r1')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/account/organization-selection'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
