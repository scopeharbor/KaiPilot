// @aiproj/types — V3 多租户 API 边界共享夹具。
// 提供两个组织的 mirror fixtures：org A 与 org B 有同构但隔离的 project/task/file/report/
// AI draft/Compiler artifact/enterprise ledger 引用，加上 unsafe client hints，用于跨租户负例测试。
// 纯数据，零运行时依赖。

import type {
  ApiBoundaryResolution,
  ApiDecisionMetadata,
  ApiHandleBindingMetadata,
  ApiHandleKind,
  ApiResourceType,
  ApiSurfaceDeclaration,
  MapReasonCode,
} from './multitenant-api-boundary.js'
import {
  MULTITENANT_SCOPE_HASH_LENGTH,
  mtComputeOrganizationScopeHash,
  mtFnv1aHash,
} from './multitenant-isolation-architecture.js'

/** 组织 A 的固定 id。 */
export const API_ORG_A_ID = 101
/** 组织 B 的固定 id。 */
export const API_ORG_B_ID = 202

/** 组织 A 的项目 id。 */
export const API_ORG_A_PROJECT_ID = 11001
/** 组织 B 的项目 id（与 A 同构但隔离）。 */
export const API_ORG_B_PROJECT_ID = 22002

/** 组织 scope hash（org id -> 低敏 16 位 hash）。 */
export function apiOrgScopeHash(orgId: number): string {
  return mtComputeOrganizationScopeHash(orgId)
}

/** 组织 A 的 scope hash。 */
export function apiOrgAScopeHash(): string {
  return apiOrgScopeHash(API_ORG_A_ID)
}

/** 组织 B 的 scope hash。 */
export function apiOrgBScopeHash(): string {
  return apiOrgScopeHash(API_ORG_B_ID)
}

/**
 * org A mirror resource refs（project/task/file/report/ai_draft/compiler_artifact/enterprise_ledger…）。
 * 与 org B 同构但 id 不同，任何跨租户读取/计数/hash 若不过滤即被负例测试捕获。
 */
export function buildApiOrgAMirrorRefs(): Record<ApiResourceType, string> {
  return {
    organization: String(API_ORG_A_ID),
    project: 'project:A-1',
    task: 'task:A-1',
    wbs: 'wbs:A-1',
    member: 'member:A-1',
    file: 'file:A-1',
    file_export: 'export:A-1',
    report: 'report:A-1',
    audit: 'audit:A-1',
    ai_draft: 'ai-draft:A-1',
    compiler_run: 'compiler-run:A-1',
    compiler_artifact: 'artifact:A-1',
    compliance_package: 'compliance:A-1',
    enterprise_ledger: 'ledger:A-1',
    ocr_document: 'ocr:A-1',
    background_job: 'job:A-1',
    sse_stream: 'sse:A-1',
    source_attribution: 'source:A-1',
    knowledge_item: 'knowledge:A-1',
    // v3-plugin-private-registry-lifecycle §3 新增的四类私有仓库租户资源
    plugin_registry_entry: 'plugin-registry-entry:A-1',
    plugin_registry_release: 'plugin-registry-release:A-1',
    plugin_registry_review: 'plugin-registry-review:A-1',
    plugin_registry_operation: 'plugin-registry-operation:A-1',
    plugin_registry_command: 'plugin-registry-command:A-1',
    // v3-plugin-action-preview-boundary 新增的 API 动作面资源
    plugin_action_proposal: 'plugin-action-proposal:A-1',
    system: 'sys:A-1',
  }
}

/** org B mirror resource refs（与 A 同构但 id 不同）。 */
export function buildApiOrgBMirrorRefs(): Record<ApiResourceType, string> {
  return {
    organization: String(API_ORG_B_ID),
    project: 'project:B-2',
    task: 'task:B-2',
    wbs: 'wbs:B-2',
    member: 'member:B-2',
    file: 'file:B-2',
    file_export: 'export:B-2',
    report: 'report:B-2',
    audit: 'audit:B-2',
    ai_draft: 'ai-draft:B-2',
    compiler_run: 'compiler-run:B-2',
    compiler_artifact: 'artifact:B-2',
    compliance_package: 'compliance:B-2',
    enterprise_ledger: 'ledger:B-2',
    ocr_document: 'ocr:B-2',
    background_job: 'job:B-2',
    sse_stream: 'sse:B-2',
    source_attribution: 'source:B-2',
    knowledge_item: 'knowledge:B-2',
    // v3-plugin-private-registry-lifecycle §3 新增的四类私有仓库租户资源
    plugin_registry_entry: 'plugin-registry-entry:B-2',
    plugin_registry_release: 'plugin-registry-release:B-2',
    plugin_registry_review: 'plugin-registry-review:B-2',
    plugin_registry_operation: 'plugin-registry-operation:B-2',
    plugin_registry_command: 'plugin-registry-command:B-2',
    // v3-plugin-action-preview-boundary 新增的 API 动作面资源
    plugin_action_proposal: 'plugin-action-proposal:B-2',
    system: 'sys:B-2',
  }
}

/** project/task 基础 API surface 覆盖（项目/任务的高风险子集）。 */
export function buildApiProjectSurfaces(): ApiSurfaceDeclaration[] {
  return [
    {
      method: 'GET',
      routePattern: '/api/v1/projects',
      routeName: 'projects.index',
      resourceType: 'project',
      scopeSource: 'server_auth',
      allowedScopeModes: ['tenant'],
      hintFields: [{ name: 'organizationId', location: 'query', role: 'consistency_hint' }],
      operations: ['list'],
      responseSensitivity: 'tenant_low_sensitive',
      auditResourceType: 'project',
      fixtureKey: 'projects.index',
      isGlobalOptIn: false,
    },
    {
      method: 'GET',
      routePattern: '/api/v1/projects/:id',
      routeName: 'projects.show',
      resourceType: 'project',
      scopeSource: 'route_param',
      allowedScopeModes: ['tenant'],
      hintFields: [{ name: 'id', location: 'route', role: 'ownership_stamp' }],
      operations: ['detail'],
      responseSensitivity: 'tenant_private',
      auditResourceType: 'project',
      fixtureKey: 'projects.show',
    },
    {
      method: 'GET',
      routePattern: '/api/v1/projects/:projectId/tasks',
      routeName: 'projects.tasks.index',
      resourceType: 'task',
      scopeSource: 'route_param',
      allowedScopeModes: ['tenant'],
      hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
      operations: ['list'],
      responseSensitivity: 'tenant_private',
      auditResourceType: 'task',
      fixtureKey: 'projects.tasks.index',
    },
    {
      method: 'POST',
      routePattern: '/api/v1/projects/:projectId/tasks/batch',
      routeName: 'projects.tasks.batch',
      resourceType: 'task',
      scopeSource: 'resource_owner',
      allowedScopeModes: ['tenant'],
      hintFields: [{ name: 'organizationId', location: 'body', role: 'consistency_hint' }],
      operations: ['batch', 'create'],
      responseSensitivity: 'tenant_private',
      auditResourceType: 'task',
      fixtureKey: 'projects.tasks.batch',
      isGlobalOptIn: false,
    },
  ]
}

/** AI draft / Compiler 高风险 surface 覆盖（preview + confirm handle 绑定）。 */
export function buildAiCompilerSurfaces(): ApiSurfaceDeclaration[] {
  return [
    {
      method: 'POST',
      routePattern: '/api/v1/projects/:projectId/ai-drafts/:draftId/confirm',
      routeName: 'projects.ai-drafts.confirm',
      resourceType: 'ai_draft',
      scopeSource: 'route_param',
      allowedScopeModes: ['tenant'],
      hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
      operations: ['preview', 'confirm'],
      responseSensitivity: 'tenant_private',
      auditResourceType: 'ai_draft',
      handleBinding: {
        preview: ['preview'] as ApiHandleKind[],
        confirm: ['confirm'] as ApiHandleKind[],
      },
      fixtureKey: 'ai-drafts.confirm',
    },
  ]
}

/** org A 的低敏 decision metadata fixture。 */
export function buildApiDecisionFixture(input?: Partial<ApiDecisionMetadata>): ApiDecisionMetadata {
  const scopeHash = apiOrgAScopeHash()
  return {
    requestId: 'req:A-1',
    tenantScopeHash: scopeHash,
    cacheNamespace: 'map:cache:' + scopeHash,
    scopeMode: 'tenant',
    decision: 'allow',
    reasonCode: 'OK' as MapReasonCode,
    warnings: [],
    idempotencyScope: 'map:idem:' + scopeHash + ':create:task',
    ...input,
  }
}

/** org A 的 preview handle fixture。 */
export function buildApiHandleFixtureA(
  overrides?: Partial<ApiHandleBindingMetadata>,
): ApiHandleBindingMetadata {
  const scopeHash = apiOrgAScopeHash()
  return {
    kind: 'preview',
    handle: mtFnv1aHash('map:preview:A-1').padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0'),
    scopeHash,
    sourceHash: mtFnv1aHash('map:src:A-1').padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0'),
    actorRef: 'user:1001',
    operation: 'preview',
    expiresAt: '2099-01-01T00:00:00.000Z',
    requestId: 'req:A-1',
    idempotencyScope: 'map:h:' + scopeHash + ':preview:preview',
    ...overrides,
  }
}

/** org A 的 unsafe body hint（body 组织与服务器不一致）。 */
export function buildOrgAUnsafeBodyHint(): { bodyOrganizationId: number } {
  return { bodyOrganizationId: API_ORG_B_ID }
}

/** org A 的 unsafe query hint（查询过滤器跨组织，不能扩大 scope）。 */
export function buildOrgAUnsafeQueryHint(): { organizationId: number } {
  return { organizationId: API_ORG_B_ID }
}

/** org A 的 unsafe claim（客户端声明的 permission/DLP/KMS/decision allow 一律被忽略重算）。 */
export function buildOrgAUnsafeDecisionClaim(): Record<string, string> {
  return {
    permissionClaim: 'ai:allowed',
    dlpDecision: 'allowed',
    kmsDecision: 'allowed',
  }
}

/** org A 的 api boundary resolution（允许进入业务）。 */
export function buildApiBoundaryResolutionA(
  input?: Partial<ApiBoundaryResolution>,
): ApiBoundaryResolution {
  const scopeHash = apiOrgAScopeHash()
  return {
    allowed: true,
    decision: 'allow',
    reasonCode: 'OK' as MapReasonCode,
    warnings: [],
    scopeMode: 'tenant',
    scopeHash,
    cacheNamespace: 'map:cache:' + scopeHash,
    ...input,
  }
}
