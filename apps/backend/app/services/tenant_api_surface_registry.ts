// @aiproj/backend — TenantApiSurfaceRegistry（v3-multitenant-api §3.1）。
//
// API surface registry：声明每个受保护 /api/v1 route 的租户边界 contract。
// 消费隔离架构的资源声明（TenantScopeRegistry）作为"资源归属"，本 registry 补充
// API 专属字段：scope source、allowed scope modes、route/body/query hint 字段、
// 响应敏感度、preview/confirm/export/job handle 绑定与 fixture 覆盖键。
//
// 设计（v3-multitenant-api design Decision 1）：资源 registry 回答"资源属于谁"，
// API registry 回答"这条 HTTP route 什么时候、从哪里、以什么错误语义消费该归属"，
// 二者分开，避免数据库/Service 细节污染 API 契约，也便于从 start/routes.ts 建 inventory。
//
// 新增 tenant-scoped V3 route 必须在此登记或置显式 global/system 例外：
// registry 完整性校验（见 validate()）与 coverage 测试会拦截未登记路由。

import {
  isApiHandleKind,
  isApiOperationType,
  type ApiSurfaceDeclaration,
} from '@aiproj/types/multitenant-api-boundary'
import { isMultitenantResourceType } from '@aiproj/types/multitenant-isolation-architecture'

const API_EXTRA_TYPES = [
  'report',
  'file_export',
  'ocr_document',
  'compliance_package',
  'enterprise_ledger',
  'background_job',
  'sse_stream',
  'system',
  // v3-plugin-ui-command-extension-pilot：命令 preview/confirm 是动作面，不是持久化租户资源，
  // 故登记在 API 额外类型而不是 MULTITENANT_RESOURCE_TYPES（后者要求有可 scope 的数据表）。
  'plugin_registry_command',
  // v3-plugin-action-preview-boundary：插件写入动作提案（有持久化表但按 API 动作面治理）。
  'plugin_action_proposal',
]

function isApiExtraType(t: string): boolean {
  return API_EXTRA_TYPES.includes(t)
}

/** 规范化 route pattern：去掉重复斜杠、统一小写分段比较（保留 :param）。 */
function normalizePattern(pattern: string): string {
  let p = pattern.trim().replace(/\/+/g, '/')
  if (!p.startsWith('/')) p = '/' + p
  if (p.endsWith('/')) p = p.slice(0, -1)
  return p
}

/**
 * 核心 tenant-scoped API surface 清单（本 change in-scope 的高风险路由）。
 * 覆盖：项目/任务基础 API、AI draft/Compiler preview-confirm/SSE、文件/报表导出、
 * 后台 job、super admin 全局低敏治理。
 *
 * 长尾历史 V1/V2 route 现尚未全部迁移；它们应进入 inventory gap（见 design Decision 6），
 * 不阻塞本 change 完成，但新增 V3 route 必须接入本 registry。
 */
const REGISTERED_SURFACES: readonly ApiSurfaceDeclaration[] = [
  // 显式平台管理例外：RBAC 与 Controller 均要求 super admin，成员写入由目标组织过滤。
  {
    method: 'GET',
    routePattern: '/api/v1/platform/ai-models',
    routeName: 'platform.aiModels.show',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.aiModels.show',
    isGlobalOptIn: true,
  },
  {
    method: 'PUT',
    routePattern: '/api/v1/platform/ai-models',
    routeName: 'platform.aiModels.save',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.aiModels.save',
    isGlobalOptIn: true,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/platform/organizations',
    routeName: 'platform.organizations.index',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.index',
    isGlobalOptIn: true,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/platform/organization-managers',
    routeName: 'platform.organizations.managers',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.managers',
    isGlobalOptIn: true,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/platform/organizations/:id/members',
    routeName: 'platform.organizations.members',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.members',
    isGlobalOptIn: true,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/platform/organizations/:id/members/accounts',
    routeName: 'platform.organizations.createAccount',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.createAccount',
    isGlobalOptIn: true,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/platform/organizations/:id/members',
    routeName: 'platform.organizations.invite',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.invite',
    isGlobalOptIn: true,
  },
  {
    method: 'PUT',
    routePattern: '/api/v1/platform/organizations/:id/members/:memberId',
    routeName: 'platform.organizations.updateMember',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.updateMember',
    isGlobalOptIn: true,
  },
  {
    method: 'DELETE',
    routePattern: '/api/v1/platform/organizations/:id/members/:memberId',
    routeName: 'platform.organizations.removeMember',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['tenant', 'global-low-sensitive', 'system-maintenance'],
    hintFields: [],
    operations: ['admin'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'platform_configuration',
    fixtureKey: 'platform.organizations.removeMember',
    isGlobalOptIn: true,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/organizations/:id/members/accounts',
    routeName: 'organizations.members.createAccount',
    resourceType: 'organization',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [],
    operations: ['create'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'organization_member',
    fixtureKey: 'organizations.members.createAccount',
    isGlobalOptIn: false,
  },
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
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/projects/:projectId/tasks',
    routeName: 'projects.tasks.index',
    resourceType: 'task',
    scopeSource: 'route_param',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
    operations: ['list', 'detail'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'task',
    fixtureKey: 'projects.tasks.index',
    isGlobalOptIn: false,
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
  {
    method: 'POST',
    routePattern: '/api/v1/projects',
    routeName: 'projects.store',
    resourceType: 'project',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'organizationId', location: 'body', role: 'consistency_hint' }],
    operations: ['create'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'project',
    fixtureKey: 'projects.store',
    isGlobalOptIn: false,
  },
  {
    method: 'PATCH',
    routePattern: '/api/v1/projects/:id',
    routeName: 'projects.update',
    resourceType: 'project',
    scopeSource: 'route_param',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'id', location: 'route', role: 'ownership_stamp' }],
    operations: ['update'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'project',
    fixtureKey: 'projects.update',
  },
  {
    method: 'DELETE',
    routePattern: '/api/v1/projects/:id',
    routeName: 'projects.destroy',
    resourceType: 'project',
    scopeSource: 'route_param',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'id', location: 'route', role: 'ownership_stamp' }],
    operations: ['delete'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'project',
    fixtureKey: 'projects.destroy',
  },
  {
    method: 'POST',
    routePattern: '/api/v1/projects/:projectId/tasks',
    routeName: 'projects.tasks.store',
    resourceType: 'task',
    scopeSource: 'route_param',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
    operations: ['create'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'task',
    fixtureKey: 'projects.tasks.store',
  },
  {
    method: 'POST',
    routePattern: '/api/v1/ai/project-drafts/:id/confirm',
    routeName: 'ai.drafts.confirm',
    resourceType: 'ai_draft',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'id', location: 'route', role: 'ownership_stamp' }],
    operations: ['confirm', 'preview'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'ai_draft',
    handleBinding: { preview: ['preview'], confirm: ['confirm'] },
    fixtureKey: 'ai.drafts.confirm',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/ai/project-drafts/:id/events',
    routeName: 'ai.drafts.events',
    resourceType: 'ai_draft',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'id', location: 'route', role: 'ownership_stamp' }],
    operations: ['sse'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'ai_draft',
    handleBinding: { sse: ['sse'] },
    fixtureKey: 'ai.drafts.events',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/ai/project-drafts/stream',
    routeName: 'ai.drafts.stream',
    resourceType: 'ai_draft',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [],
    operations: ['preview', 'ai_context', 'external_boundary'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'ai_draft',
    handleBinding: { preview: ['preview'] },
    fixtureKey: 'ai.drafts.stream',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/ai/compiler/runs/:id/events',
    routeName: 'compiler.runs.events',
    resourceType: 'compiler_run',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'id', location: 'route', role: 'ownership_stamp' }],
    operations: ['sse'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'compiler_run',
    handleBinding: { sse: ['sse'] },
    fixtureKey: 'compiler.runs.events',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions/:versionId/exports',
    routeName: 'projects.reports.v2.exports.create',
    resourceType: 'report',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
    operations: ['export', 'download'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'report',
    handleBinding: { export: ['export'], download: ['download'] },
    fixtureKey: 'projects.reports.v2.exports.create',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/projects/:projectId/reports/v2/exports/:exportId/download',
    routeName: 'projects.reports.v2.exports.download',
    resourceType: 'report',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
    operations: ['download'],
    responseSensitivity: 'tenant_private',
    auditResourceType: 'report',
    handleBinding: { download: ['download'] },
    fixtureKey: 'projects.reports.v2.exports.download',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/projects/:projectId/reports/v2/jobs/:jobId/retry',
    routeName: 'projects.reports.v2.jobs.retry',
    resourceType: 'background_job',
    scopeSource: 'resource_owner',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'projectId', location: 'route', role: 'ownership_stamp' }],
    operations: ['job_resume', 'job'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'background_job',
    handleBinding: { job_resume: ['job'] },
    fixtureKey: 'projects.reports.v2.jobs.retry',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/console/governance/summary',
    routeName: 'console.governance.summary',
    resourceType: 'system',
    scopeSource: 'explicit_global',
    allowedScopeModes: ['global-low-sensitive'],
    hintFields: [],
    operations: ['admin', 'list'],
    responseSensitivity: 'global_low_sensitive',
    auditResourceType: 'admin_console',
    fixtureKey: 'console.governance.summary',
    isGlobalOptIn: true,
  },
  // 私有插件目录（v3-plugin-private-registry-lifecycle）
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-registry',
    routeName: 'plugin_registry.index',
    resourceType: 'plugin_registry_entry',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'organizationId', location: 'route', role: 'ownership_stamp' }],
    operations: ['list'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_entry',
    fixtureKey: 'plugin_registry.index',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-registry/:entryId',
    routeName: 'plugin_registry.show',
    resourceType: 'plugin_registry_entry',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'entryId', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['detail'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_entry',
    fixtureKey: 'plugin_registry.show',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-registry/review-queue',
    routeName: 'plugin_registry.review_queue',
    resourceType: 'plugin_registry_review',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'organizationId', location: 'route', role: 'ownership_stamp' }],
    operations: ['list'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_review',
    fixtureKey: 'plugin_registry.review_queue',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-registry/resolve',
    routeName: 'plugin_registry.resolve',
    resourceType: 'plugin_registry_entry',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'organizationId', location: 'route', role: 'ownership_stamp' }],
    operations: ['detail'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_entry',
    fixtureKey: 'plugin_registry.resolve',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/organizations/:organizationId/plugin-registry/commands/preview',
    routeName: 'plugin_registry.commands.preview',
    resourceType: 'plugin_registry_command',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'organizationId', location: 'route', role: 'ownership_stamp' }],
    operations: ['preview'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_command',
    handleBinding: { preview: ['preview'] },
    fixtureKey: 'plugin_registry.commands.preview',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/organizations/:organizationId/plugin-registry/commands/:handle/confirm',
    routeName: 'plugin_registry.commands.confirm',
    resourceType: 'plugin_registry_command',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'handle', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['confirm'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_command',
    handleBinding: { confirm: ['preview'] },
    fixtureKey: 'plugin_registry.commands.confirm',
    isGlobalOptIn: false,
  },

  // ── v3-organization-private-plugin-directory：组织私有目录只读投影（仅 GET）──
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-directory/releases',
    routeName: 'plugin_directory.releases.index',
    resourceType: 'plugin_registry_release',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [{ name: 'organizationId', location: 'route', role: 'ownership_stamp' }],
    operations: ['list'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_release',
    fixtureKey: 'plugin_directory.releases.index',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId',
    routeName: 'plugin_directory.releases.show',
    resourceType: 'plugin_registry_release',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'releaseId', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['detail'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_release',
    fixtureKey: 'plugin_directory.releases.show',
    isGlobalOptIn: false,
  },
  {
    method: 'GET',
    routePattern:
      '/api/v1/organizations/:organizationId/plugin-directory/releases/:releaseId/affected-installations',
    routeName: 'plugin_directory.releases.affected_installations',
    resourceType: 'plugin_registry_release',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'releaseId', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['list'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_registry_release',
    fixtureKey: 'plugin_directory.releases.affected_installations',
    isGlobalOptIn: false,
  },

  // ── v3-plugin-action-preview-boundary：插件写入动作统一边界（preview→confirm 链）──
  {
    method: 'GET',
    routePattern: '/api/v1/organizations/:organizationId/plugin-actions/:proposalUid',
    routeName: 'plugin_actions.show',
    resourceType: 'plugin_action_proposal',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'proposalUid', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['detail'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_action_proposal',
    fixtureKey: 'plugin_actions.show',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/organizations/:organizationId/plugin-actions/:proposalUid/preview',
    routeName: 'plugin_actions.preview',
    resourceType: 'plugin_action_proposal',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'proposalUid', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['preview'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_action_proposal',
    handleBinding: { confirm: ['preview'] },
    fixtureKey: 'plugin_actions.preview',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/organizations/:organizationId/plugin-actions/:proposalUid/decision',
    routeName: 'plugin_actions.decision',
    resourceType: 'plugin_action_proposal',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'proposalUid', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['update'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_action_proposal',
    fixtureKey: 'plugin_actions.decision',
    isGlobalOptIn: false,
  },
  {
    method: 'POST',
    routePattern: '/api/v1/organizations/:organizationId/plugin-actions/:proposalUid/confirm',
    routeName: 'plugin_actions.confirm',
    resourceType: 'plugin_action_proposal',
    scopeSource: 'server_auth',
    allowedScopeModes: ['tenant'],
    hintFields: [
      { name: 'organizationId', location: 'route', role: 'ownership_stamp' },
      { name: 'proposalUid', location: 'route', role: 'ownership_stamp' },
    ],
    operations: ['confirm'],
    responseSensitivity: 'tenant_low_sensitive',
    auditResourceType: 'plugin_action_proposal',
    handleBinding: { confirm: ['preview'] },
    fixtureKey: 'plugin_actions.confirm',
    isGlobalOptIn: false,
  },
]

export default class TenantApiSurfaceRegistry {
  static all(): ApiSurfaceDeclaration[] {
    return [...REGISTERED_SURFACES]
  }

  /** 按 method + route pattern 查找（pattern 精确匹配）。 */
  static lookup(method: string, routePattern: string): ApiSurfaceDeclaration | null {
    const m = method.toUpperCase()
    const p = normalizePattern(routePattern)
    return (
      REGISTERED_SURFACES.find(
        (s) => s.method.toUpperCase() === m && normalizePattern(s.routePattern) === p,
      ) ?? null
    )
  }

  /** 某 route 是否显式声明为 global（super admin 全局低敏面）。 */
  static isGlobalOptIn(routePattern: string): boolean {
    return REGISTERED_SURFACES.some(
      (d) =>
        d.isGlobalOptIn === true &&
        normalizePattern(d.routePattern) === normalizePattern(routePattern),
    )
  }

  /**
   * 完整性校验：handle 操作/kind 受控、tenant-private 业务不得 global 例外的关键
   * 不变量。返回问题列表（空 = 通过）；以 registry 测试驱动，声明不可静默漂移。
   */
  static validate(): string[] {
    const problems: string[] = []
    for (const s of REGISTERED_SURFACES) {
      if (!s.method || !s.routePattern) {
        problems.push('surface 缺少 method/routePattern: ' + (s.routeName ?? '?'))
      }
      if (!isMultitenantResourceType(s.resourceType as never) && !isApiExtraType(s.resourceType)) {
        problems.push(s.routePattern + ' resourceType 不在受控集合: ' + String(s.resourceType))
      }
      if (s.handleBinding) {
        for (const [op, kinds] of Object.entries(s.handleBinding)) {
          if (!isApiOperationType(op as 'list')) {
            problems.push(s.routePattern + ' handleBinding 操作非法: ' + op)
          }
          for (const kind of kinds ?? []) {
            if (!isApiHandleKind(kind as 'preview')) {
              problems.push(s.routePattern + ' handleBinding kind 非法: ' + String(kind))
            }
          }
        }
      }
      if (s.isGlobalOptIn !== true && !s.allowedScopeModes.includes('tenant')) {
        problems.push(s.routePattern + ' 非 global 例外必须允许具体 tenant scope')
      }
    }
    return problems
  }
}
