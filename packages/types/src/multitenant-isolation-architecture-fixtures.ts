// @aiproj/types — V3 多租户隔离架构共享夹具。
// 提供两个组织的 mirror fixtures：org A 与 org B 有同构但隔离的
// project/task/file/report/compiler/ledger 引用，用于跨租户负例测试。
// 纯数据，零运行时依赖。

import type {
  MultitenantResourceType,
  TenantContext,
  TenantScopeSnapshot,
  TenantResourceDeclaration,
  MultitenantReasonCode,
  MultitenantOperationType,
  MultitenantDecision,
} from './multitenant-isolation-architecture.js'

/** 组织 A 的固定 id（镜像对的组织 A） */
export const MT_ORG_A_ID = 101
/** 组织 B 的固定 id（镜像对的组织 B） */
export const MT_ORG_B_ID = 202

/** 组织 A 的项目 id */
export const MT_ORG_A_PROJECT_ID = 11001
/** 组织 B 的项目 id（与 A 同构但隔离） */
export const MT_ORG_B_PROJECT_ID = 22002

/**
 * 组织 A 的索引：actor + tenant context + scope mode。
 */
export function buildOrgAContext(overrides?: Partial<TenantContext>): TenantContext {
  return {
    organizationId: MT_ORG_A_ID,
    scopeMode: 'organization_scoped',
    actorRef: 'user:1001',
    isSuperAdmin: false,
    ...overrides,
  }
}

/**
 * 组织 B 的索引：actor + tenant context + scope mode。
 */
export function buildOrgBContext(overrides?: Partial<TenantContext>): TenantContext {
  return {
    organizationId: MT_ORG_B_ID,
    scopeMode: 'organization_scoped',
    actorRef: 'user:2002',
    isSuperAdmin: false,
    ...overrides,
  }
}

/**
 * 组织 A 的 scope 资源引用镜像：resourceType -> ref。
 * 与组织 B 镜像结构完全一致，仅 id/内容不同，确保任何跨租户读取/计数/hash
 * 如果不过滤，就会被负例测试捕获。
 */
export function buildOrgAMirrorRefs(): Record<MultitenantResourceType, string> {
  return {
    organization: String(MT_ORG_A_ID),
    project: String(MT_ORG_A_PROJECT_ID),
    task: 'task:A-1',
    wbs: 'wbs:A-1',
    member: 'member:A-1',
    file: 'file:A-1',
    report: 'report:A-1',
    audit: 'audit:A-1',
    ai_draft: 'ai-draft:A-1',
    compiler_run: 'compiler-run:A-1',
    compiler_artifact: 'artifact:A-1',
    source_attribution: 'source:A-1',
    knowledge_item: 'knowledge:A-1',
    // v3-plugin-private-registry-lifecycle §3 新增的四类私有仓库租户资源
    plugin_registry_entry: 'plugin-registry-entry:A-1',
    plugin_registry_release: 'plugin-registry-release:A-1',
    plugin_registry_review: 'plugin-registry-review:A-1',
    plugin_registry_operation: 'plugin-registry-operation:A-1',
  }
}

/**
 * 组织 B 的 scope 资源引用镜像（与 A 同构但 id 不同）。
 */
export function buildOrgBMirrorRefs(): Record<MultitenantResourceType, string> {
  return {
    organization: String(MT_ORG_B_ID),
    project: String(MT_ORG_B_PROJECT_ID),
    task: 'task:B-2',
    wbs: 'wbs:B-2',
    member: 'member:B-2',
    file: 'file:B-2',
    report: 'report:B-2',
    audit: 'audit:B-2',
    ai_draft: 'ai-draft:B-2',
    compiler_run: 'compiler-run:B-2',
    compiler_artifact: 'artifact:B-2',
    source_attribution: 'source:B-2',
    knowledge_item: 'knowledge:B-2',
    // v3-plugin-private-registry-lifecycle §3 新增的四类私有仓库租户资源
    plugin_registry_entry: 'plugin-registry-entry:B-2',
    plugin_registry_release: 'plugin-registry-release:B-2',
    plugin_registry_review: 'plugin-registry-review:B-2',
    plugin_registry_operation: 'plugin-registry-operation:B-2',
  }
}

/**
 * 组织 A 的低敏租户 scope 快照（用于 job/export/cache 负例）。
 */
export function buildOrgAScopeSnapshot(
  overrides?: Partial<TenantScopeSnapshot>,
): TenantScopeSnapshot {
  const base: TenantScopeSnapshot = {
    actorRef: 'user:1001',
    organizationId: MT_ORG_A_ID,
    organizationScopeHash: 'a1a1a1a1a1a1a1a1',
    projectId: MT_ORG_A_PROJECT_ID,
    projectScopeHash: 'a2a2a2a2a2a2a2a2',
    sourceRefs: buildOrgAMirrorRefsAsRefs(),
    permissionSnapshotHash: 'perm-aaa',
    scopeMode: 'organization_scoped',
    idempotencyKey: 'idem:A-1',
    requestId: 'req:A-1',
    issuedAt: '2026-08-07T00:00:00.000Z',
  }
  return Object.assign(base, overrides)
}

/**
 * 组织 B 的低敏租户 scope 快照（用于跨租户回放负例）。
 */
export function buildOrgBScopeSnapshot(
  overrides?: Partial<TenantScopeSnapshot>,
): TenantScopeSnapshot {
  const base: TenantScopeSnapshot = {
    actorRef: 'user:2002',
    organizationId: MT_ORG_B_ID,
    organizationScopeHash: 'b1b1b1b1b1b1b1b1',
    projectId: MT_ORG_B_PROJECT_ID,
    projectScopeHash: 'b2b2b2b2b2b2b2b2',
    sourceRefs: buildOrgBMirrorRefsAsRefs(),
    permissionSnapshotHash: 'perm-bbb',
    scopeMode: 'organization_scoped',
    idempotencyKey: 'idem:B-2',
    requestId: 'req:B-2',
    issuedAt: '2026-08-07T00:00:00.000Z',
  }
  return Object.assign(base, overrides)
}

function buildOrgAMirrorRefsAsRefs(): string[] {
  const refs = buildOrgAMirrorRefs()
  return Object.values(refs)
}

function buildOrgBMirrorRefsAsRefs(): string[] {
  const refs = buildOrgBMirrorRefs()
  return Object.values(refs)
}

/**
 * 一个完整 registry 声明清单（覆盖 2.3 声明的核心资源），
 * 每个条目都带显式归属字段解析与 registry status。
 */
export function buildTenantResourceDeclarations(): TenantResourceDeclaration[] {
  return [
    {
      resourceType: 'organization',
      organizationField: 'id',
      projectField: null,
      parentResolver: 'none',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'organization',
    },
    {
      resourceType: 'project',
      organizationField: 'organization_id',
      projectField: 'id',
      parentResolver: 'organization',
      allowSuperAdminGlobal: true,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'project',
    },
    {
      resourceType: 'task',
      organizationField: null,
      projectField: 'project_id',
      parentResolver: 'project',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'task',
    },
    {
      resourceType: 'wbs',
      organizationField: null,
      projectField: 'project_id',
      parentResolver: 'project',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'wbs',
    },
    {
      resourceType: 'member',
      organizationField: null,
      projectField: 'project_id',
      parentResolver: 'project',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'organization_member',
    },
    {
      resourceType: 'file',
      organizationField: null,
      projectField: 'project_id',
      parentResolver: 'project',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'file',
    },
    {
      resourceType: 'report',
      organizationField: null,
      projectField: 'project_id',
      parentResolver: 'project',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'report',
    },
    {
      resourceType: 'audit',
      organizationField: 'organization_id',
      projectField: null,
      parentResolver: 'organization',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'audit_log',
    },
    {
      resourceType: 'ai_draft',
      organizationField: 'organization_id',
      projectField: 'project_id',
      parentResolver: 'project',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'ai_draft',
    },
    {
      resourceType: 'compiler_run',
      organizationField: 'organization_id',
      projectField: null,
      parentResolver: 'organization',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'compiler_run',
    },
    {
      resourceType: 'compiler_artifact',
      organizationField: 'organization_id',
      projectField: null,
      parentResolver: 'organization',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'compiler_artifact',
    },
    {
      resourceType: 'source_attribution',
      organizationField: 'organization_id',
      projectField: null,
      parentResolver: 'organization',
      allowSuperAdminGlobal: false,
      registryStatus: 'registered',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'source_attribution',
    },
    {
      resourceType: 'knowledge_item',
      organizationField: 'organization_id',
      projectField: null,
      parentResolver: 'organization',
      allowSuperAdminGlobal: false,
      registryStatus: 'degraded',
      errorSemantics: 'RESOURCE_NOT_FOUND',
      auditResourceType: 'knowledge_item',
    },
  ]
}

/**
 * 构造一个审计元数据样本（组织 A denial）。
 */
export function buildAuditMetadataFixture(params?: {
  reasonCode?: MultitenantReasonCode
  operationType?: MultitenantOperationType
  decision?: MultitenantDecision
}) {
  return {
    actorRef: 'user:1001',
    scopeHash: 'a1a1a1a1a1a1a1a1',
    organizationId: MT_ORG_A_ID,
    projectId: MT_ORG_A_PROJECT_ID,
    resourceType: 'project' as MultitenantResourceType,
    operationType: params?.operationType ?? ('read' as MultitenantOperationType),
    reasonCode: params?.reasonCode ?? ('CROSS_ORGANIZATION_BLOCKED' as MultitenantReasonCode),
    decision: params?.decision ?? ('deny' as MultitenantDecision),
    requestId: 'req:A-1',
    idempotencyKey: 'idem:A-1',
    timestamp: '2026-08-07T00:00:00.000Z',
  }
}
