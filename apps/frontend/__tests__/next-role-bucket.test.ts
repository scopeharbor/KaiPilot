import { beforeEach, describe, expect, test } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  getRoleHomeConfig,
  resolveRoleBucket,
  ROLE_BUCKET_LABELS,
  ROLE_HOME_CONFIGS,
  selectCurrentOrganization,
  selectRoleBucket,
  type RoleBucketSource,
} from '@/lib/next/role-bucket'

const ORGS = [
  { id: 1, name: '示例组织', slug: 'demo', role: 'member' },
  { id: 2, name: '集团总部', slug: 'hq', role: 'owner' },
]

/** 构造最小合法 RoleBucketSource（有当前组织、已认证）。 */
function source(overrides: Partial<RoleBucketSource> = {}): RoleBucketSource {
  return {
    isAuthenticated: true,
    user: {
      id: 1,
      email: 'u@example.com',
      fullName: '测试用户',
      organizations: [ORGS[0]!],
    },
    effectiveTenantContext: null,
    currentOrganizationId: 1,
    ...overrides,
  }
}

/** 服务端租户上下文的合法形状（仅判定字段必需）。 */
function context(overrides: { membershipRole?: string | null; isSuperAdmin?: boolean }) {
  return {
    actorRef: 'user:1',
    organizationId: 1,
    projectId: null,
    membershipRole: overrides.membershipRole ?? null,
    scopeMode: 'org',
    selectionSource: 'test',
    resolutionReason: 'test',
    scopeHash: 'hash',
    resolvedAt: '2026-01-01T00:00:00.000Z',
    warningCodes: [],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  }
}

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

describe('lib/next/role-bucket（v3-ui-next-shell-space-map D6 / tasks 3.1）', () => {
  test('未认证 → unknown 兜底桶', () => {
    expect(resolveRoleBucket(source({ isAuthenticated: false }))).toBe('unknown')
  })

  test('user 为 null（未登录 / 会话缺失）→ unknown，页面 0 报错', () => {
    expect(resolveRoleBucket(source({ user: null }))).toBe('unknown')
  })

  test('user.isSuperAdmin 为真 → admin 桶', () => {
    expect(resolveRoleBucket(source({ user: { ...source().user!, isSuperAdmin: true } }))).toBe(
      'admin',
    )
  })

  test('effectiveTenantContext.isSuperAdmin 为真 → admin 桶', () => {
    expect(
      resolveRoleBucket(source({ effectiveTenantContext: context({ isSuperAdmin: true }) })),
    ).toBe('admin')
  })

  test('当前组织角色 owner / admin / system_admin / org_admin → admin 桶', () => {
    for (const role of ['owner', 'admin', 'system_admin', 'org_admin']) {
      const orgs = [{ ...ORGS[0]!, role }]
      expect(
        resolveRoleBucket(source({ user: { ...source().user!, organizations: orgs } })),
        role,
      ).toBe('admin')
    }
  })

  test('服务端 membershipRole 与组织角色：project_manager / Project Manager / Project Owner / pm → pm 桶', () => {
    for (const role of ['project_manager', 'Project Manager', 'Project Owner', 'pm']) {
      const viaMembership = resolveRoleBucket(
        source({ effectiveTenantContext: context({ membershipRole: role }) }),
      )
      const viaOrg = resolveRoleBucket(
        source({ user: { ...source().user!, organizations: [{ ...ORGS[0]!, role }] } }),
      )
      expect(viaMembership, `membershipRole=${role}`).toBe('pm')
      expect(viaOrg, `org.role=${role}`).toBe('pm')
    }
  })

  test('member / Member / external_collaborator / External Collaborator / collaborator → member 桶', () => {
    for (const role of [
      'member',
      'Member',
      'external_collaborator',
      'External Collaborator',
      'collaborator',
    ]) {
      expect(
        resolveRoleBucket(
          source({ user: { ...source().user!, organizations: [{ ...ORGS[0]!, role }] } }),
        ),
        role,
      ).toBe('member')
    }
  })

  test('readonly_observer / Read-only Observer / viewer / observer → observer 桶', () => {
    for (const role of ['readonly_observer', 'Read-only Observer', 'viewer', 'observer']) {
      expect(
        resolveRoleBucket(
          source({ user: { ...source().user!, organizations: [{ ...ORGS[0]!, role }] } }),
        ),
        role,
      ).toBe('observer')
    }
  })

  test('未知角色 / 空组织 → unknown 兜底桶', () => {
    const unknownRole = source({
      user: { ...source().user!, organizations: [{ ...ORGS[0]!, role: 'almighty' }] },
    })
    expect(resolveRoleBucket(unknownRole)).toBe('unknown')

    const emptyOrgs = source({ user: { ...source().user!, organizations: [] } })
    expect(resolveRoleBucket(emptyOrgs)).toBe('unknown')
  })

  test('角色串大小写不敏感且容忍首尾空白', () => {
    const trimmed = source({
      user: { ...source().user!, organizations: [{ ...ORGS[0]!, role: '  Project Owner  ' }] },
    })
    expect(resolveRoleBucket(trimmed)).toBe('pm')

    const upper = source({
      user: { ...source().user!, organizations: [{ ...ORGS[0]!, role: 'PROJECT_MANAGER' }] },
    })
    expect(resolveRoleBucket(upper)).toBe('pm')
  })

  test('按 currentOrganizationId 取当前组织角色；失配时兜底首个组织', () => {
    const multiOrg = source({
      user: { ...source().user!, organizations: [ORGS[0]!, ORGS[1]!] },
      currentOrganizationId: 2,
    })
    expect(resolveRoleBucket(multiOrg)).toBe('admin')

    const stale = source({
      user: { ...source().user!, organizations: [ORGS[0]!, ORGS[1]!] },
      currentOrganizationId: 99,
    })
    expect(resolveRoleBucket(stale)).toBe('member')
  })

  test('服务端 membershipRole 优先于本地组织角色（服务端事实优先）', () => {
    const conflicted = source({
      user: { ...source().user!, organizations: [{ ...ORGS[0]!, role: 'owner' }] },
      effectiveTenantContext: context({ membershipRole: 'member' }),
    })
    expect(resolveRoleBucket(conflicted)).toBe('member')
  })

  test('selectRoleBucket 真实读取 auth-store 状态快照', () => {
    useAuthStore.setState({
      hasHydrated: true,
      isAuthenticated: true,
      currentOrganizationId: 1,
      user: {
        id: 1,
        email: 'super@example.com',
        fullName: '管理员',
        isSuperAdmin: true,
        organizations: [ORGS[0]!],
      },
      effectiveTenantContext: null,
    })
    expect(selectRoleBucket(useAuthStore.getState())).toBe('admin')
  })

  test('selectCurrentOrganization：按 id 匹配 / 未指定兜底首个 / 无组织返回 null', () => {
    const user = source().user!
    expect(selectCurrentOrganization(user, 1)?.name).toBe('示例组织')
    expect(selectCurrentOrganization(user, null)?.id).toBe(1)
    expect(selectCurrentOrganization(user, 99)?.id).toBe(1)
    expect(selectCurrentOrganization({ ...user, organizations: [] }, 1)).toBeNull()
    expect(selectCurrentOrganization(null, null)).toBeNull()
  })

  test('ROLE_HOME_CONFIGS 覆盖五桶且 getRoleHomeConfig 永不返回 undefined', () => {
    for (const bucket of ['admin', 'pm', 'member', 'observer', 'unknown'] as const) {
      const config = ROLE_HOME_CONFIGS[bucket]
      expect(config).toBeDefined()
      expect(config!.bucket).toBe(bucket)
      expect(config!.suggestionSlots.length).toBeGreaterThan(0)
      expect(getRoleHomeConfig(bucket)).toBeDefined()
    }
    expect(ROLE_BUCKET_LABELS.unknown).toBe('访客')
  })

  test('PM 桶配置符合 spec：健康度巡检 / 关键路径风险 / 排程偏离卡槽', () => {
    const pm = getRoleHomeConfig('pm')
    expect(pm.title).toBe('项目组合与交付态势')
    expect(pm.suggestionSlots.map((slot) => slot.title)).toEqual([
      '健康度巡检',
      '关键路径风险',
      '排程偏离',
    ])
  })

  test('unknown 桶配置符合 spec：标准开项空间欢迎语 + 通用空间导览', () => {
    const unknown = getRoleHomeConfig('unknown')
    expect(unknown.title).toBe('开项项目空间')
    expect(unknown.suggestionSlots.some((slot) => slot.id === 'space-guide')).toBe(true)
  })
})
