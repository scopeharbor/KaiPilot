// @aiproj/types — V3 多租户有效租户识别契约测试夹具。
// 纯函数，零运行时外部依赖，前后端共享。与 multitenant-tenant-identification.ts 配套。

import {
  buildEffectiveTenantContext,
  buildScopeSwitchAuditContext,
  buildTenantSelectionSnapshot,
  tiComputeEffectiveScopeHash,
  type EffectiveTenantContext,
  type OrganizationSelectionRequest,
  type OrganizationSelectionResponse,
  type TenantIdentificationAuditMetadata,
  type TenantSelectionSnapshot,
} from './multitenant-tenant-identification.js'

/**
 * 构造一个 tenant 模式的 effective tenant context 夹具。
 * @param overrides 部分覆写；未提供字段使用确定性的默认低敏值。
 */
export function tenantContextFixture(
  overrides: Partial<EffectiveTenantContext> = {},
): EffectiveTenantContext {
  const context = buildEffectiveTenantContext({
    actorRef: 'user:42',
    organizationId: 7,
    projectId: null,
    membershipRole: 'member',
    membershipVersionHash: 'ab12cd34',
    scopeMode: 'tenant',
    selectionSource: 'server_selection',
    resolutionReason: 'RESOLVED',
    isSuperAdmin: false,
    warningCodes: ['NO_ACTIVE_TENANT'],
    resolvedAt: '2026-08-01T00:00:00.000Z',
  })
  return { ...context, ...overrides }
}

/**
 * 构造一个 super admin global-low-sensitive 模式的 effective tenant context 夹具。
 */
export function superAdminGlobalContextFixture(
  overrides: Partial<EffectiveTenantContext> = {},
): EffectiveTenantContext {
  const context = buildEffectiveTenantContext({
    actorRef: 'user:1',
    organizationId: null,
    projectId: null,
    membershipRole: null,
    membershipVersionHash: null,
    scopeMode: 'global-low-sensitive',
    selectionSource: 'super_admin_mode',
    resolutionReason: 'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE',
    isSuperAdmin: true,
    warningCodes: ['GLOBAL_LOW_SENSITIVE_ONLY'],
    resolvedAt: '2026-08-01T00:00:00.000Z',
  })
  return { ...context, ...overrides }
}

/** 相同语义但键顺序不同的 tenant context（用于确定性 hash 一致性断言）。 */
export function tenantContextReorderedKeyFixture(): EffectiveTenantContext {
  const base = tenantContextFixture()
  // 以不同属性定义顺序重建，验证 tiEquivalentContextHashes 忽略 key 顺序。
  const reordered: EffectiveTenantContext = {
    warningCodes: base.warningCodes,
    resolutionReason: base.resolutionReason,
    selectionSource: base.selectionSource,
    membershipVersionHash: base.membershipVersionHash,
    membershipRole: base.membershipRole,
    scopeMode: base.scopeMode,
    scopeHash: base.scopeHash,
    resolvedAt: base.resolvedAt,
    projectId: base.projectId,
    organizationId: base.organizationId,
    isSuperAdmin: base.isSuperAdmin,
    actorRef: base.actorRef,
  }
  return reordered
}

/** 构造后台作业 selection snapshot 夹具。 */
export function tenantSelectionSnapshotFixture(
  overrides: Partial<TenantSelectionSnapshot> = {},
): TenantSelectionSnapshot {
  const snapshot = buildTenantSelectionSnapshot({
    context: tenantContextFixture(),
    permissionSnapshotHash: 'deadbeef',
    sourceRefs: ['ref:project:7:9'],
    idempotencyKey: 'idem-abc-123',
    requestId: 'req-xyz-456',
    issuedAt: '2026-08-01T00:00:00.000Z',
  })
  return { ...snapshot, ...overrides }
}

/** 构造组织切换请求夹具。 */
export function organizationSelectionRequestFixture(
  overrides: Partial<OrganizationSelectionRequest> = {},
): OrganizationSelectionRequest {
  return { organizationId: 7, previousScopeHash: null, ...overrides }
}

/** 构造组织切换成功响应夹具。 */
export function organizationSelectionResponseFixture(
  overrides: Partial<OrganizationSelectionResponse> = {},
): OrganizationSelectionResponse {
  const context = tenantContextFixture({ organizationId: 8, membershipRole: 'owner' })
  return {
    effectiveContext: context,
    scopeHash: context.scopeHash,
    ...overrides,
  }
}

/** 构造低敏识别审计元数据夹具。 */
export function tenantIdentificationAuditFixture(
  overrides: Partial<TenantIdentificationAuditMetadata> = {},
): TenantIdentificationAuditMetadata {
  return {
    actorRef: 'user:42',
    scopeHash: tiComputeEffectiveScopeHash({ organizationId: 7, scopeMode: 'tenant' }),
    organizationId: 7,
    projectId: null,
    scopeMode: 'tenant',
    selectionSource: 'server_selection',
    resolutionReason: 'RESOLVED',
    operation: 'project.read',
    requestId: 'req-xyz-456',
    idempotencyKey: 'idem-abc-123',
    timestamp: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 构造 organization switch 审计辅助上下文（previous/next scope hash）。 */
export function scopeSwitchAuditFixture(
  overrides: Partial<ReturnType<typeof buildScopeSwitchAuditContext>> = {},
): ReturnType<typeof buildScopeSwitchAuditContext> {
  const nextScopeHash = tiComputeEffectiveScopeHash({ organizationId: 8, scopeMode: 'tenant' })
  return {
    actorRef: 'user:42',
    previousScopeHash: tiComputeEffectiveScopeHash({ organizationId: 7, scopeMode: 'tenant' }),
    previousToNextChanged: true,
    nextScopeHash,
    requestId: 'req-xyz-456',
    idempotencyKey: 'idem-abc-123',
    timestamp: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}
