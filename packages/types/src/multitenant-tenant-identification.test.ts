// v3-multitenant-tenant-identification —— 共享契约单测。
// 覆盖：确定性 hash、low-sensitive 契约字段、forbidden-field 检测、类型守卫、
// selection snapshot、开关审计辅助、枚举拒绝。
import { describe, it, expect } from 'vitest'
import {
  TENANT_SCOPE_MODES,
  TENANT_SELECTION_SOURCES,
  TENANT_RESOLUTION_REASONS,
  TENANT_WARNING_CODES,
  TENANT_SELECTION_SCHEMA_VERSION,
  TENANT_ID_FORBIDDEN_KEYS,
  isTenantScopeMode,
  isTenantSelectionSource,
  isTenantResolutionReason,
  isTenantWarningCode,
  tiComputeEffectiveScopeHash,
  tiEquivalentContextHashes,
  buildEffectiveTenantContext,
  buildTenantSelectionSnapshot,
  buildScopeSwitchAuditContext,
  hasTenantIdForbiddenKeys,
  mapLegacyTenantContext,
  type EffectiveTenantContext,
} from './multitenant-tenant-identification.js'
import {
  tenantContextFixture,
  superAdminGlobalContextFixture,
  tenantContextReorderedKeyFixture,
  tenantSelectionSnapshotFixture,
  organizationSelectionRequestFixture,
  organizationSelectionResponseFixture,
  tenantIdentificationAuditFixture,
  scopeSwitchAuditFixture,
} from './multitenant-tenant-identification-fixtures.js'

const ORG_7_CONTEXT = { organizationId: 7, scopeMode: 'tenant' as const, projectId: null }
const ORG_8_CONTEXT = { organizationId: 8, scopeMode: 'tenant' as const, projectId: null }

describe('多租户有效租户识别共享契约：确定性 hash（spec scenario: Equivalent context hashes consistently）', () => {
  it('相同输入、不同对象键顺序产生相同 scope hash', () => {
    const a = tiComputeEffectiveScopeHash(ORG_7_CONTEXT)
    const b = tiComputeEffectiveScopeHash({
      projectId: null,
      scopeMode: 'tenant',
      organizationId: 7,
    })
    expect(a).toBe(b)
  })

  it('不同组织产生不同 scope hash', () => {
    expect(tiComputeEffectiveScopeHash(ORG_7_CONTEXT)).not.toBe(
      tiComputeEffectiveScopeHash(ORG_8_CONTEXT),
    )
  })

  it('tenant 与 global-low-sensitive 模式在相同组织下产生不同 scope hash', () => {
    expect(tiComputeEffectiveScopeHash({ organizationId: 7, scopeMode: 'tenant' })).not.toBe(
      tiComputeEffectiveScopeHash({ organizationId: 7, scopeMode: 'global-low-sensitive' }),
    )
  })

  it('相同语义但不同属性顺序的 context 判定为等价 hash', () => {
    expect(
      tiEquivalentContextHashes(tenantContextFixture(), tenantContextReorderedKeyFixture()),
    ).toBe(true)
  })

  it('不同组织或角色的 context 判定为不等价', () => {
    const base = tenantContextFixture()
    const differentOrg = tenantContextFixture({ organizationId: 9 })
    const differentReason = tenantContextFixture({ resolutionReason: 'SUPER_ADMIN_TENANT_SCOPE' })
    expect(tiEquivalentContextHashes(base, differentOrg)).toBe(false)
    expect(tiEquivalentContextHashes(base, differentReason)).toBe(false)
  })
})

describe('多租户有效租户识别共享契约：low-sensitive 契约（spec scenario: Low-sensitive context excludes forbidden data）', () => {
  it('effective tenant context 只包含低敏字段，且不含 forbidden key', () => {
    const context = tenantContextFixture()
    expect(context.organizationId).toBe(7)
    expect(context.scopeMode).toBe('tenant')
    expect(context.scopeHash).toBeTypeOf('string')
    expect(context.scopeHash.length).toBeGreaterThanOrEqual(16)
    expect(context.actorRef).toBe('user:42')
    expect(context.resolvedAt).toBeTypeOf('string')
    expect(hasTenantIdForbiddenKeys(context)).toBe(false)
  })

  it('super admin global 模式不携带隐藏组织信息', () => {
    const context = superAdminGlobalContextFixture()
    expect(context.organizationId).toBeNull()
    expect(context.scopeMode).toBe('global-low-sensitive')
    expect(context.resolutionReason).toBe('SUPER_ADMIN_GLOBAL_LOW_SENSITIVE')
    expect(hasTenantIdForbiddenKeys(context)).toBe(false)
  })

  it('审计元数据不包含 forbidden key', () => {
    expect(hasTenantIdForbiddenKeys(tenantIdentificationAuditFixture())).toBe(false)
  })

  it('selection snapshot 为低敏且 schema 版本正确', () => {
    const snapshot = tenantSelectionSnapshotFixture()
    expect(snapshot.schemaVersion).toBe(TENANT_SELECTION_SCHEMA_VERSION)
    expect(snapshot.organizationId).toBe(7)
    expect(snapshot.scopeHash).toBeTypeOf('string')
    expect(hasTenantIdForbiddenKeys(snapshot)).toBe(false)
  })

  it('forbidden key 检测覆盖 secret/token/prompt/model output/path 类键', () => {
    expect(hasTenantIdForbiddenKeys({ refreshToken: 'x' })).toBe(true)
    expect(hasTenantIdForbiddenKeys({ secret: 'x' })).toBe(true)
    expect(hasTenantIdForbiddenKeys({ prompt: 'x' })).toBe(true)
    expect(hasTenantIdForbiddenKeys({ modelOutput: 'x' })).toBe(true)
    expect(hasTenantIdForbiddenKeys({ absolutePath: '/a/b' })).toBe(true)
    expect(hasTenantIdForbiddenKeys({ password: 'p' })).toBe(true)
    expect(TENANT_ID_FORBIDDEN_KEYS.includes('token')).toBe(true)
    expect(TENANT_ID_FORBIDDEN_KEYS.includes('refreshToken')).toBe(true)
    expect(TENANT_ID_FORBIDDEN_KEYS.includes('model_output')).toBe(true)
  })
})

describe('多租户有效租户识别共享契约：dependency-light + 稳定性', () => {
  it('相同输入多次计算得到完全相同 hash', () => {
    const inputs = [
      { organizationId: 7, scopeMode: 'tenant' as const, projectId: null },
      { organizationId: 7, scopeMode: 'tenant' as const, projectId: 11 },
    ]
    for (const input of inputs) {
      const first = tiComputeEffectiveScopeHash(input)
      const second = tiComputeEffectiveScopeHash(input)
      expect(first).toBe(second)
    }
  })

  it('buildEffectiveTenantContext 使用确定性低敏 scopeHash 且可直接重建', () => {
    const a = buildEffectiveTenantContext({
      actorRef: 'user:5',
      organizationId: 3,
      selectionSource: 'resource_owner',
      resolutionReason: 'RESOLVED',
    })
    const b = buildEffectiveTenantContext({
      actorRef: 'user:5',
      organizationId: 3,
      selectionSource: 'resource_owner',
      resolutionReason: 'RESOLVED',
    })
    expect(a.scopeHash).toBe(b.scopeHash)
    expect(hasTenantIdForbiddenKeys(a)).toBe(false)
  })
})

describe('多租户有效租户识别共享契约：类型守卫与枚举', () => {
  it('scope mode 枚举与守卫', () => {
    expect(TENANT_SCOPE_MODES).toEqual(['tenant', 'global-low-sensitive', 'system-maintenance'])
    expect(isTenantScopeMode('tenant')).toBe(true)
    expect(isTenantScopeMode('global-low-sensitive')).toBe(true)
    expect(isTenantScopeMode('organization_scoped')).toBe(false)
    expect(isTenantScopeMode('bad')).toBe(false)
  })

  it('selection source 枚举', () => {
    expect(TENANT_SELECTION_SOURCES).toContain('auth_token')
    expect(TENANT_SELECTION_SOURCES).toContain('server_selection')
    expect(TENANT_SELECTION_SOURCES).toContain('resource_owner')
    expect(TENANT_SELECTION_SOURCES).toContain('consistency_hint')
    expect(TENANT_SELECTION_SOURCES).toContain('super_admin_mode')
    expect(isTenantSelectionSource('resource_owner')).toBe(true)
    expect(isTenantSelectionSource('client_claim')).toBe(false)
  })

  it('resolution reason 枚举包含关键识别语义', () => {
    for (const reason of [
      'RESOLVED',
      'NOT_A_MEMBER',
      'MEMBERSHIP_STALE',
      'ROUTE_ORGANIZATION_MISMATCH',
      'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE',
      'REPLAY_REJECTED',
    ]) {
      expect(TENANT_RESOLUTION_REASONS).toContain(reason)
      expect(isTenantResolutionReason(reason)).toBe(true)
    }
    expect(isTenantResolutionReason('MAGIC')).toBe(false)
  })

  it('warning code 枚举与守卫', () => {
    for (const code of [
      'NO_ACTIVE_TENANT',
      'ORGANIZATION_HIDDEN',
      'MEMBERSHIP_STALE_REFRESH_REQUIRED',
      'GLOBAL_LOW_SENSITIVE_ONLY',
      'REPLAY_STALE_OR_INVALID',
    ]) {
      expect(TENANT_WARNING_CODES).toContain(code)
      expect(isTenantWarningCode(code)).toBe(true)
    }
    expect(isTenantWarningCode('UNKNOWN')).toBe(false)
  })
})

describe('多租户有效租户识别共享契约：组织选择与会话切换辅助', () => {
  it('organization selection request 只携带低敏意图', () => {
    const request = organizationSelectionRequestFixture({ organizationId: 8 })
    expect(request.organizationId).toBe(8)
    expect(hasTenantIdForbiddenKeys(request)).toBe(false)
  })

  it('organization selection response 返回识别结果与低敏 scope hash', () => {
    const response = organizationSelectionResponseFixture()
    expect(response.effectiveContext.organizationId).toBe(8)
    expect(response.scopeHash).toBe(response.effectiveContext.scopeHash)
    expect(hasTenantIdForbiddenKeys(response)).toBe(false)
  })

  it('scope switch 审计辅助记录 previous/next 且不含隐藏数据', () => {
    const audit = scopeSwitchAuditFixture()
    expect(audit.previousToNextChanged).toBe(true)
    expect(audit.previousScopeHash).not.toBe(audit.nextScopeHash)
    expect(hasTenantIdForbiddenKeys(audit)).toBe(false)
  })

  it('same-scope switch 判定为未变化', () => {
    const next = tiComputeEffectiveScopeHash(ORG_7_CONTEXT)
    const audit = buildScopeSwitchAuditContext({
      previousScopeHash: next,
      nextScopeHash: next,
      actorRef: 'user:42',
      requestId: 'req-1',
    })
    expect(audit.previousToNextChanged).toBe(false)
  })

  it('buildTenantSelectionSnapshot 复现 context 并携带权限快照 hash', () => {
    const context: EffectiveTenantContext = tenantContextFixture()
    const snapshot = buildTenantSelectionSnapshot({
      context,
      permissionSnapshotHash: 'perm-hash-1',
      sourceRefs: ['ref:a', 'ref:b'],
      idempotencyKey: 'idem-1',
      requestId: 'req-1',
    })
    expect(snapshot.actorRef).toBe(context.actorRef)
    expect(snapshot.organizationId).toBe(context.organizationId)
    expect(snapshot.scopeHash).toBe(context.scopeHash)
    expect(snapshot.permissionSnapshotHash).toBe('perm-hash-1')
    expect(snapshot.sourceRefs).toEqual(['ref:a', 'ref:b'])
  })
})

describe('多租户有效租户识别共享契约：兼容映射（任务 2.4：旧 ctx.tenant → effective context）', () => {
  it('把旧 ctx.tenant.organizationId 映射为 tenant 模式 effective context', () => {
    const ctx = mapLegacyTenantContext({
      legacy: { organizationId: 7, projectId: 9, actorRef: 'user:42', isSuperAdmin: false },
    })
    expect(ctx.organizationId).toBe(7)
    expect(ctx.projectId).toBe(9)
    expect(ctx.scopeMode).toBe('tenant')
    expect(ctx.selectionSource).toBe('auth_token')
    expect(ctx.resolutionReason).toBe('RESOLVED')
    expect(ctx.scopeHash).toMatch(/^[0-9a-z]+$/)
    expect(ctx.actorRef).toBe('user:42')
    expect(ctx.isSuperAdmin).toBe(false)
  })

  it('super admin 无具体 org 时归一化为 global-low-sensitive（不默认全局业务可见）', () => {
    const ctx = mapLegacyTenantContext({
      legacy: { organizationId: null, actorRef: 'user:1', isSuperAdmin: true },
    })
    expect(ctx.scopeMode).toBe('global-low-sensitive')
    expect(ctx.isSuperAdmin).toBe(true)
    expect(ctx.organizationId).toBeNull()
  })

  it('super admin 有具体 org 时仍为 tenant 模式', () => {
    const ctx = mapLegacyTenantContext({
      legacy: { organizationId: 7, actorRef: 'user:1', isSuperAdmin: true },
    })
    expect(ctx.scopeMode).toBe('tenant')
    expect(ctx.organizationId).toBe(7)
  })

  it('旧 scopeMode 字符串值（organization_scoped/system_global）被归一化而非透传', () => {
    const ctx = mapLegacyTenantContext({
      legacy: {
        organizationId: 7,
        scopeMode: 'organization_scoped',
        actorRef: 'user:42',
        isSuperAdmin: false,
      },
    })
    expect(TENANT_SCOPE_MODES).toContain(ctx.scopeMode)
    expect(ctx.scopeMode).toBe('tenant')
  })

  it('映射结果不泄露敏感字段且形状完整可被隔离层消费', () => {
    const ctx: EffectiveTenantContext = mapLegacyTenantContext({
      legacy: { organizationId: 7, actorRef: 'user:42' },
    })
    expect(hasTenantIdForbiddenKeys(ctx)).toBe(false)
    expect(ctx.scopeHash).toMatch(/^[0-9a-z]+$/)
    expect(ctx.actorRef).toMatch(/^user:/)
    expect(typeof ctx.resolvedAt).toBe('string')
  })
})
