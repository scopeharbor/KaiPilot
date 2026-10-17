// v3-multitenant-tenant-identification §8.3 —— 前端组织上下文测试。
//
// spec 场景覆盖：
//   - 当前组织渲染（低敏标签，不含组织名）；
//   - 成功切换（新 claims + epoch 递增 + 缓存清理被触发）；
//   - 拒绝切换（404 隐藏，不透露组织是否存在）；
//   - stale context 刷新（refreshEffectiveTenantContext）；
//   - §8.4 低敏错误状态与无障碍属性。
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  ALL_TENANT_IDENTIFICATION_CODES,
  describeTenantIdentificationForDisplay,
  isHandleFreshForSelection,
  toTenantIdentificationNotice,
  toTenantIdentificationNotices,
} from '@/lib/tenant-identification'
import { setTenantScopeInvalidator } from '@/lib/api-client'
import { accessTokenWith } from './_jwt-helper'

function seedSession(organizationId: number | null) {
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
    accessToken: accessTokenWith(['org:manage'], { organizationId }),
    refreshToken: 'r1',
  })
}

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ data }) }
}

function selectionPayload(overrides: Record<string, unknown> = {}) {
  return {
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
      ...((overrides.effectiveContext as object) ?? {}),
    },
    scopeHash: 'hash-org-2',
    selectionEpoch: 2,
    ...overrides,
  }
}

describe('前端组织上下文 —— 当前组织渲染（§8.1）', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    vi.unstubAllGlobals()
  })

  test('初始状态无有效租户上下文与 epoch', () => {
    const s = useAuthStore.getState()
    expect(s.effectiveTenantContext).toBeNull()
    expect(s.selectionEpoch).toBe(0)
  })

  test('低敏标签只含组织 ID / scope hash / scope mode，不含组织名', () => {
    const labels = describeTenantIdentificationForDisplay({
      organizationId: 7,
      scopeHash: 'abcdef0123456789',
      scopeMode: 'tenant',
    })
    expect(labels).not.toBeNull()
    expect(labels!.organizationLabel).toBe('组织 #7')
    expect(labels!.scopeHashLabel).toBe('范围 abcdef01')
    expect(labels!.scopeModeLabel).toBe('组织范围')
    // 不得出现任何组织名字段。
    expect(JSON.stringify(labels)).not.toContain('甲组织')
  })

  test('无组织时渲染明确空态，而非猜一个组织', () => {
    const labels = describeTenantIdentificationForDisplay({
      organizationId: null,
      scopeHash: '',
      scopeMode: 'global-low-sensitive',
    })
    expect(labels!.organizationLabel).toBe('未选择组织')
    expect(labels!.scopeModeLabel).toBe('全局低敏视图')
  })

  test('null 上下文返回 null（调用方据此渲染空态）', () => {
    expect(describeTenantIdentificationForDisplay(null)).toBeNull()
  })
})

describe('前端组织切换（§8.2）', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    vi.unstubAllGlobals()
    setTenantScopeInvalidator(null)
  })

  test('切换成功写入服务端上下文、epoch 与新 claims', async () => {
    seedSession(1)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse(
          selectionPayload({
            accessToken: accessTokenWith(['org:view'], { organizationId: 2 }),
          }),
        ),
      ),
    )

    await useAuthStore.getState().switchOrganization(2)

    const s = useAuthStore.getState()
    expect(s.currentOrganizationId).toBe(2)
    expect(s.selectionEpoch).toBe(2)
    expect(s.effectiveTenantContext?.organizationId).toBe(2)
    expect(s.effectiveTenantContext?.selectionSource).toBe('server_selection')
    expect(s.permissions).toEqual(['org:view'])
  })

  test('切换成功触发租户派生缓存清理', async () => {
    seedSession(1)
    const invalidator = vi.fn()
    setTenantScopeInvalidator(invalidator)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse(
          selectionPayload({
            accessToken: accessTokenWith(['org:view'], { organizationId: 2 }),
          }),
        ),
      ),
    )

    await useAuthStore.getState().switchOrganization(2)
    expect(invalidator).toHaveBeenCalledTimes(1)
  })

  test('切换请求把旧 scope hash 作为审计输入提交（不参与授权）', async () => {
    seedSession(1)
    useAuthStore.setState({
      effectiveTenantContext: {
        actorRef: 'user:1',
        organizationId: 1,
        scopeMode: 'tenant',
        selectionSource: 'auth_token',
        resolutionReason: 'RESOLVED',
        scopeHash: 'hash-org-1',
        resolvedAt: new Date().toISOString(),
        warningCodes: [],
        isSuperAdmin: false,
      },
      selectionEpoch: 1,
    })
    const fetchMock = vi.fn().mockResolvedValue(okResponse(selectionPayload()))
    vi.stubGlobal('fetch', fetchMock)

    await useAuthStore.getState().switchOrganization(2)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const body = JSON.parse(String(init?.body ?? '{}'))
    expect(body).toEqual({ organizationId: 2, previousScopeHash: 'hash-org-1' })
  })

  test('切换被拒（404 隐藏）时抛错且不改动本地租户态', async () => {
    seedSession(1)
    useAuthStore.setState({ selectionEpoch: 1 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'RESOURCE_NOT_FOUND', message: '组织不存在' } }),
      }),
    )

    await expect(useAuthStore.getState().switchOrganization(99)).rejects.toBeTruthy()

    const s = useAuthStore.getState()
    // 关键：被拒不得把本地组织改成目标组织（否则 UI 会显示一个用户无权进入的组织）。
    expect(s.currentOrganizationId).toBe(1)
    expect(s.selectionEpoch).toBe(1)
  })

  test('本地组织列表不含目标组织时也发请求（owner fallback 由服务端裁决）', async () => {
    seedSession(1)
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        selectionPayload({
          effectiveContext: { organizationId: 42 },
          scopeHash: 'hash-org-42',
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    // 组织 42 不在 user.organizations 里——旧实现会本地抛「无权切换」，
    // 从而把 owner-without-member-row 的用户挡在自己组织外面。
    await useAuthStore.getState().switchOrganization(42)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().currentOrganizationId).toBe(42)
  })

  test('登出清空租户上下文与 epoch', () => {
    seedSession(1)
    useAuthStore.setState({
      effectiveTenantContext: {
        actorRef: 'user:1',
        organizationId: 1,
        scopeMode: 'tenant',
        selectionSource: 'auth_token',
        resolutionReason: 'RESOLVED',
        scopeHash: 'h',
        resolvedAt: new Date().toISOString(),
        warningCodes: [],
        isSuperAdmin: false,
      },
      selectionEpoch: 5,
    })

    useAuthStore.getState().clear()
    expect(useAuthStore.getState().effectiveTenantContext).toBeNull()
    expect(useAuthStore.getState().selectionEpoch).toBe(0)
  })
})

describe('stale 上下文刷新（§8.3）', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    vi.unstubAllGlobals()
  })

  test('refreshEffectiveTenantContext 用服务端决定覆盖本地推断值', async () => {
    seedSession(1)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          effectiveContext: {
            actorRef: 'user:1',
            organizationId: null,
            scopeMode: 'global-low-sensitive',
            selectionSource: 'auth_token',
            resolutionReason: 'NO_ACTIVE_ORGANIZATION',
            scopeHash: 'hash-none',
            resolvedAt: new Date().toISOString(),
            warningCodes: ['NO_ACTIVE_TENANT'],
            isSuperAdmin: false,
          },
          scopeHash: 'hash-none',
          selectionEpoch: 0,
          resolved: false,
        }),
      ),
    )

    const context = await useAuthStore.getState().refreshEffectiveTenantContext()

    expect(context?.resolutionReason).toBe('NO_ACTIVE_ORGANIZATION')
    // 服务端说没有有效租户 → 本地展示值也必须清空，不能继续显示组织 1。
    expect(useAuthStore.getState().currentOrganizationId).toBeNull()
    expect(useAuthStore.getState().effectiveTenantContext?.warningCodes).toEqual([
      'NO_ACTIVE_TENANT',
    ])
  })

  test('刷新失败返回 null 且不清会话（网络抖动不应踢用户下线）', async () => {
    seedSession(1)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const context = await useAuthStore.getState().refreshEffectiveTenantContext()
    expect(context).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})

describe('低敏错误状态与无障碍（§8.4）', () => {
  test('每个识别 warning code 都有中文文案与恢复动作', () => {
    for (const code of ALL_TENANT_IDENTIFICATION_CODES) {
      const notice = toTenantIdentificationNotice(code)
      expect(notice, `code ${code} 缺少文案`).not.toBeNull()
      expect(notice!.message.length).toBeGreaterThan(0)
      expect(['select_organization', 'refresh_session', 'regenerate', 'none']).toContain(
        notice!.recovery,
      )
      expect(['polite', 'assertive']).toContain(notice!.ariaLive)
    }
  })

  test('阻断性状态用 assertive，信息性状态用 polite', () => {
    expect(toTenantIdentificationNotice('NO_ACTIVE_TENANT')!.ariaLive).toBe('assertive')
    expect(toTenantIdentificationNotice('ORGANIZATION_HIDDEN')!.ariaLive).toBe('assertive')
    expect(toTenantIdentificationNotice('GLOBAL_LOW_SENSITIVE_ONLY')!.ariaLive).toBe('polite')
  })

  test('隐藏资源/组织的文案不透露存在性', () => {
    const hidden = toTenantIdentificationNotice('ORGANIZATION_HIDDEN')!
    const resource = toTenantIdentificationNotice('RESOURCE_HIDDEN')!
    // 文案必须是"不可用或无权限"这类合并表述，不能出现"存在但无权"的分辨信息。
    expect(hidden.message).toContain('不可用或')
    expect(resource.message).toContain('不存在或')
  })

  test('未知 code 一律丢弃（fail closed，不做原样显示兜底）', () => {
    expect(toTenantIdentificationNotice('SOMETHING_ELSE')).toBeNull()
    expect(toTenantIdentificationNotice({ code: 'NOT_A_CODE' })).toBeNull()
    expect(toTenantIdentificationNotice(null)).toBeNull()
    expect(
      toTenantIdentificationNotices(['NO_ACTIVE_TENANT', 'BOGUS', { code: 'RESOURCE_HIDDEN' }]),
    ).toHaveLength(2)
  })

  test('服务端 message 不被透传（文案只由 code 决定）', () => {
    const notice = toTenantIdentificationNotice({
      code: 'ORGANIZATION_HIDDEN',
      message: '组织「机密客户 A」不存在',
    })
    expect(notice!.message).not.toContain('机密客户 A')
  })

  test('恢复动作映射：stale 要求刷新、重放失效要求重新生成', () => {
    expect(toTenantIdentificationNotice('MEMBERSHIP_STALE_REFRESH_REQUIRED')!.recovery).toBe(
      'refresh_session',
    )
    expect(toTenantIdentificationNotice('REPLAY_STALE_OR_INVALID')!.recovery).toBe('regenerate')
    expect(toTenantIdentificationNotice('NO_ACTIVE_TENANT')!.recovery).toBe('select_organization')
  })
})

describe('前端 epoch 栅栏（§4.3 前端一侧）', () => {
  test('epoch 相同且组织一致 → 句柄仍新鲜', () => {
    expect(
      isHandleFreshForSelection({
        handleEpoch: 3,
        currentEpoch: 3,
        handleOrganizationId: 7,
        currentOrganizationId: 7,
      }),
    ).toBe(true)
  })

  test('缺 epoch 的旧句柄一律判过期', () => {
    expect(
      isHandleFreshForSelection({ handleEpoch: null, currentEpoch: 3, currentOrganizationId: 7 }),
    ).toBe(false)
  })

  test('epoch 落后 → 过期（切回原组织也不复活）', () => {
    expect(
      isHandleFreshForSelection({
        handleEpoch: 1,
        currentEpoch: 3,
        handleOrganizationId: 7,
        currentOrganizationId: 7,
      }),
    ).toBe(false)
  })

  test('组织不一致 → 过期（跨租重放）', () => {
    expect(
      isHandleFreshForSelection({
        handleEpoch: 3,
        currentEpoch: 3,
        handleOrganizationId: 8,
        currentOrganizationId: 7,
      }),
    ).toBe(false)
  })
})
