// @aiproj/types — V3 多租户 HTTP/API 边界共享契约、确定性 hash、低敏 metadata 与 handle 绑定。
// 纯函数，零运行时外部依赖，前后端共享。
//
// 本模块定义"每个受保护 /api/v1 请求如何解析租户、校验 route/body/query 一致性、隐藏跨租户资源、
// 绑定 preview/confirm/export/job/AI/Compiler 操作、返回低敏响应并自审计"的统一契约：
//   - ApiSurfaceDeclaration   API surface registry 条目（method/route/资源类型/scope来源/
//                             hint字段/敏感度/handle绑定/审计资源类型），前端与后端共享声明形状。
//   - ApiDecisionMetadata     低敏响应 envelope 元数据（requestId/scopeHash/cacheNamespace/
//                             decision/reason/warnings），前端/SDK 据此派生 cache key 与 handle。
//   - 确定性 hash/namespace   租户 cache namespace、idempotency scope、handle 绑定签名。
//   - 低敏脱敏                复用隔离架构 forbidden keys，额外提供 handle 校验与不安全 override 预检。
//   - 非泄露错误语义          统一 reason/warning code，保证跨租户读取不泄露存在性。
//
// 消费关系（避免重复实现）：识别层产出 EffectiveTenantContext（tenant-identification），跨层隔离
// 执行靠 TenantScopeService/TenantScopeRegistry（isolation-architecture），数据库层靠
// DatabaseTenantBoundary（database-isolation）。本模块只负责"API 专属"的 route inventory、
// response envelope 元数据、cache namespace 与 handle 绑定形状，不在层间重复落地租户过滤。
//
// 命名约定：本模块标识符统一使用 map* / MAP_* / Api* 前缀，index.ts 使用显式具名导出，
// 避免与隔离层（mt*）/识别层（ti*）/管理控制台（mac*）/连接池（tcpm*）/enterprise-* 冲突。

import {
  MULTITENANT_FORBIDDEN_KEYS,
  MULTITENANT_SCOPE_HASH_LENGTH,
  detectMultitenantForbiddenKeysDeep,
  mtComputeOrganizationScopeHash,
  mtComputeScopeHash,
  mtFnv1aHash,
  redactMultitenantForbiddenKeys,
} from './multitenant-isolation-architecture.js'
import type { MultitenantResourceType } from './multitenant-isolation-architecture.js'
import type { TenantScopeMode } from './multitenant-tenant-identification.js'

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/**
 * API 响应敏感度：registry 声明每条 route 的 response 归属，约束允许回传的 envelope 元数据。
 */
export const API_RESPONSE_SENSITIVITIES = [
  'tenant_private',
  'tenant_low_sensitive',
  'global_low_sensitive',
  'system_maintenance',
] as const
export type ApiResponseSensitivity = (typeof API_RESPONSE_SENSITIVITIES)[number]

/** API 作用域来源：本 route 的租户归属从哪个可信来源解析（客户端提供只作一致性输入）。 */
export const API_SCOPE_SOURCES = [
  'server_auth',
  'route_param',
  'resource_owner',
  'consistency_hint',
  'explicit_global',
  'system',
] as const
export type ApiScopeSource = (typeof API_SCOPE_SOURCES)[number]

/** API 操作类型：供审计与 scope 顺序断言。 */
export const API_OPERATIONS = [
  'list',
  'detail',
  'create',
  'update',
  'delete',
  'batch',
  'import',
  'preview',
  'confirm',
  'export',
  'download',
  'job',
  'job_resume',
  'sse',
  'idempotent',
  'ai_context',
  'external_boundary',
  'admin',
  'audit',
] as const
export type ApiOperationType = (typeof API_OPERATIONS)[number]

/** API handle 类型：preview/confirm/export/job/SSE/idempotency/signature 等绑定对象。 */
export const API_HANDLE_KINDS = [
  'preview',
  'confirm',
  'export',
  'download',
  'job',
  'sse',
  'idempotency',
  'signature',
] as const
export type ApiHandleKind = (typeof API_HANDLE_KINDS)[number]

/** hint 字段可出现的请求位置。 */
export const API_HINT_LOCATIONS = ['route', 'query', 'body', 'header'] as const
export type ApiHintLocation = (typeof API_HINT_LOCATIONS)[number]

/** hint 字段角色：客户端提供的组织/权限/decision 一律只作一致性输入，不作事实源。 */
export const API_HINT_ROLES = ['ignored', 'consistency_hint', 'ownership_stamp'] as const
export type ApiHintRole = (typeof API_HINT_ROLES)[number]

/** API 边界 reason code（低敏，可安全进入响应 metadata / 审计 / SDK 提示）。 */
export const MAP_REASON_CODES = [
  'OK',
  'MISSING_TENANT',
  'ORGANIZATION_MISMATCH',
  'ROUTE_ORGANIZATION_MISMATCH',
  'BODY_ORGANIZATION_MISMATCH',
  'QUERY_ORGANIZATION_MISMATCH',
  'REGISTRY_GAP',
  'GLOBAL_NOT_ALLOWED',
  'RESOURCE_NOT_FOUND',
  'PERMISSION_DENIED',
  'MIXED_TENANT_BATCH',
  'MIXED_TENANT_REFERENCE',
  'STALE_MEMBERSHIP',
  'STALE_HANDLE',
  'INVALID_HANDLE',
  'STALE_SOURCE_HASH',
  'EXPIRED_HANDLE',
  'CROSS_TENANT_REPLAY',
  'HANDLE_OPERATION_MISMATCH',
  'UNSAFE_TENANT_OVERRIDE',
  'DEGRADED_RESPONSE',
] as const
export type MapReasonCode = (typeof MAP_REASON_CODES)[number]

/** API boundary warning code（低敏，可安全返回前端展示）。 */
export const MAP_WARNING_CODES = [
  'API_ROUTE_ORGANIZATION_MISMATCH',
  'API_BODY_ORGANIZATION_HINT_IGNORED',
  'API_QUERY_ORGANIZATION_CLIPPED',
  'API_GLOBAL_LOW_SENSITIVE_ONLY',
  'API_RESOURCE_HIDDEN',
  'API_CROSS_TENANT_BLOCKED',
  'API_STALE_HANDLE',
  'API_INVALID_HANDLE',
  'API_EXPIRED_HANDLE',
  'API_DEGRADED_STATE',
  'API_REGISTRY_GAP',
] as const
export type MapWarningCode = (typeof MAP_WARNING_CODES)[number]

/** API 判定结果：允许 / 拒绝 / 降级 / 剪裁（query 组织过滤器）。 */
export const MAP_DECISIONS = ['allow', 'deny', 'degrade', 'clip'] as const
export type ApiDecision = (typeof MAP_DECISIONS)[number]

/** 默认 handle 有效期（秒）。 */
export const MAP_HANDLE_DEFAULT_EXPIRY_SECONDS = 900

/** 默认 cache namespace / hash 前缀。 */
export const MAP_HASH_NS = 'map'

/** cache namespace 推荐长度（scope hash 16 + 前缀常量区 + 用户命名空间 hash）。 */
export const MAP_CACHE_NAMESPACE_HASH_LENGTH = MULTITENANT_SCOPE_HASH_LENGTH + 26

/** API 专属资源类型：在 MultitenantResourceType 基础上补 API 层可见的派生/治理类型。 */
export type ApiResourceType =
  | MultitenantResourceType
  | 'report'
  | 'file_export'
  | 'ocr_document'
  | 'compliance_package'
  | 'enterprise_ledger'
  | 'background_job'
  | 'sse_stream'
  | 'plugin_registry_command'
  | 'plugin_action_proposal'
  | 'system'

/** hint 字段声明：某请求字段从哪个位置、以什么角色参与租户一致性校验。 */
export interface ApiHintField {
  name: string
  location: ApiHintLocation
  role: ApiHintRole
}

/** handle 绑定需求声明：route 的哪些操作需要绑定租户 scope 的句柄。 */
export type ApiHandleBinding = Partial<Record<ApiOperationType, ApiHandleKind[]>>

/**
 * API surface 声明：某个 HTTP method + route pattern 的租户边界 contract。
 * 前端/SDK 与后端 registry 共用此形状；新增 tenant-scoped route 必须声明或置显式例外。
 */
export interface ApiSurfaceDeclaration {
  /** HTTP method（大写）。 */
  method: string
  /** 显式 route pattern（统一存长路径规范，如 /api/v1/projects/:id）。 */
  routePattern: string
  /** route 名称（Adonis named route），可为空。 */
  routeName?: string | null
  /** 资源类型（租户归属）。 */
  resourceType: ApiResourceType
  /** 作用域来源。 */
  scopeSource: ApiScopeSource
  /** 允许的 scope mode（缺省只允许 tenant；全局/运维须显式列出）。 */
  allowedScopeModes: TenantScopeMode[]
  /** 该 route 上客户端传入的租户一致性 hint 字段。 */
  hintFields: ApiHintField[]
  /** 支持的操作（审计 + scope 顺序断言）。 */
  operations: ApiOperationType[]
  /** 响应敏感度。 */
  responseSensitivity: ApiResponseSensitivity
  /** 审计资源类型。 */
  auditResourceType: string
  /** 需要绑定租户 scope 的 handle 类型。 */
  handleBinding?: ApiHandleBinding
  /** fixture 覆盖键（跨租户负例测试定位）。 */
  fixtureKey?: string | null
  /** 是否为显式 global/system 例外（tenant 业务路由此值必须为 false）。 */
  isGlobalOptIn?: boolean
}

/** 客户端提供的租户一致性输入（低敏，供校验，不作事实源）。 */
export type ApiRequestScopingHints = {
  routeOrganizationId?: number | string | null
  routeProjectId?: number | string | null
  bodyOrganizationId?: number | string | null
  queryOrganizationId?: number | string | null
  /** 客户端声明的 permission/DLP/KMS/decision allow 声明，一律忽略后重算。 */
  permissionClaim?: string | null
}

/** scope mode 本地别名（避免 barrel 与 tenant-identification 类型名重复推导）。 */
export type ApiScopeMode = TenantScopeMode

/**
 * 低敏 response 决策元数据（成功/降级时随响应携带）。
 * 只允许包含 scope/hash/cacheNamespace/计数/时间与 reason/warning codes。
 */
export interface ApiDecisionMetadata {
  requestId: string
  tenantScopeHash: string
  cacheNamespace: string
  scopeMode: ApiScopeMode
  decision: ApiDecision
  reasonCode: MapReasonCode
  warnings: MapWarningCode[]
  idempotencyScope?: string | null
  degradedReason?: string | null
}

/** 单个 handle 绑定结果：对外只暴露稳定 hash + 低敏元数据。 */
export interface ApiHandleBindingMetadata {
  kind: ApiHandleKind
  handle: string
  scopeHash: string
  sourceHash: string
  actorRef: string
  operation: ApiOperationType
  expiresAt: string
  requestId: string
  idempotencyScope: string
}

/** API 低敏自审计元数据（从不含原始 JWT、隐藏资源名、完整内容）。 */
export interface ApiLowSensitiveAudit {
  actorRef: string
  scopeHash: string
  organizationId: number | null
  route: string
  operation: ApiOperationType
  reasonCode: MapReasonCode
  scopeMode: ApiScopeMode
  requestId: string
  timestamp: string
}

/** 一次受保护请求的租户边界解析结果（controller/service handoff 与前端提示）。 */
export interface ApiBoundaryResolution {
  allowed: boolean
  decision: ApiDecision
  reasonCode: MapReasonCode
  warnings: MapWarningCode[]
  scopeMode: ApiScopeMode
  scopeHash: string
  cacheNamespace: string
  apiScope?: ApiDecisionMetadata | null
}

// ──────────────────────────────────────────────
// 2. 类型守卫
// ──────────────────────────────────────────────

export function isApiResponseSensitivity(v: unknown): v is ApiResponseSensitivity {
  return API_RESPONSE_SENSITIVITIES.includes(v as ApiResponseSensitivity)
}

export function isApiScopeSource(v: unknown): v is ApiScopeSource {
  return API_SCOPE_SOURCES.includes(v as ApiScopeSource)
}

export function isApiOperationType(v: unknown): v is ApiOperationType {
  return API_OPERATIONS.includes(v as ApiOperationType)
}

export function isApiHandleKind(v: unknown): v is ApiHandleKind {
  return API_HANDLE_KINDS.includes(v as ApiHandleKind)
}

export function isApiHintLocation(v: unknown): v is ApiHintLocation {
  return API_HINT_LOCATIONS.includes(v as ApiHintLocation)
}

export function isApiHintRole(v: unknown): v is ApiHintRole {
  return API_HINT_ROLES.includes(v as ApiHintRole)
}

export function isMapReasonCode(v: unknown): v is MapReasonCode {
  return MAP_REASON_CODES.includes(v as MapReasonCode)
}

export function isMapWarningCode(v: unknown): v is MapWarningCode {
  return MAP_WARNING_CODES.includes(v as MapWarningCode)
}

export function isApiDecision(v: unknown): v is ApiDecision {
  return MAP_DECISIONS.includes(v as ApiDecision)
}

// ──────────────────────────────────────────────
// 3. 确定性 hash 与 cache / idempotency namespace
// ──────────────────────────────────────────────

/** scope mode 的规范键（供 hash/审计，不泄露 id）。 */
export function apiScopeModeKey(mode: ApiScopeMode): string {
  return mode
}

/** 计算租户 scope hash（org 或 org+project），确定性、低敏。 */
export function mapComputeScope(params: {
  organizationId: number | string
  projectId?: number | string | null
}): string {
  return mtComputeScopeHash({
    organizationId: params.organizationId,
    projectId: params.projectId ?? null,
  })
}

/** 计算某组织租户的 cache namespace（含 scope hash，租户隔离缓存键根）。 */
export function mapComputeCacheNamespace(input: {
  organizationId: number | string
  projectId?: number | string | null
  namespace: string
}): string {
  const scopeHash = mapComputeScope(input)
  const base = MAP_HASH_NS + ':cache:' + scopeHash + ':' + mtFnv1aHash(input.namespace)
  return base.padEnd(MAP_CACHE_NAMESPACE_HASH_LENGTH, '0')
}

/** 计算幂等 scope（租户 + 操作 + 资源类型屏障，跨租户不可复用）。 */
export function mapComputeIdempotencyScope(input: {
  organizationId: number | string
  operation: ApiOperationType
  resourceType: ApiResourceType
}): string {
  const orgHash = mtComputeOrganizationScopeHash(input.organizationId)
  return MAP_HASH_NS + ':idem:' + orgHash + ':' + input.operation + ':' + input.resourceType
}

/** 计算 source hash（预览/导出/任务来源的确定性摘要，用于 stale 检测）。 */
export function mapComputeSourceHash(input: {
  organizationId: number | string
  sourceRef: string
}): string {
  return mtFnv1aHash(
    MAP_HASH_NS +
      ':src:' +
      mtComputeOrganizationScopeHash(input.organizationId) +
      ':' +
      input.sourceRef,
  ).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
}

// ──────────────────────────────────────────────
// 4. 低敏脱敏与禁止字段
// ──────────────────────────────────────────────

/** 检测对象（含嵌套）是否包含 API boundary 禁止出现的敏感字段。 */
export function mapDetectForbiddenKeys(obj: unknown): string[] {
  return detectMultitenantForbiddenKeysDeep(obj)
}

/** 判断对象是否包含禁止 key。 */
export function mapHasForbiddenKeys(obj: unknown): boolean {
  return mapDetectForbiddenKeys(obj).length > 0
}

/** 从对象中递归删除禁止字段，返回新对象。 */
export function mapRedactLowSensitive<T>(obj: T): T {
  return redactMultitenantForbiddenKeys(obj)
}

/** 底层禁止字段集合（forward 导出）。 */
export const MAP_FORBIDDEN_KEYS: readonly string[] = MULTITENANT_FORBIDDEN_KEYS

// ──────────────────────────────────────────────
// 5. 一致性判定与低敏决策元数据
// ──────────────────────────────────────────────

/** 客户端 hint 与服务器租户的一致性判定（route/body/query 位置独立），不允许扩大 scope。 */
export function mapAssertOrgConsistency(input: {
  serverOrganizationId: number | string
  clientOrganizationId?: number | string | null
  origin: 'route' | 'query' | 'body'
}): { allowed: boolean; reasonCode: MapReasonCode; warning?: MapWarningCode } {
  const client = input.clientOrganizationId
  if (client === undefined || client === null || client === '') {
    return { allowed: true, reasonCode: 'OK' }
  }
  if (String(client) !== String(input.serverOrganizationId)) {
    if (input.origin === 'route') {
      return {
        allowed: false,
        reasonCode: 'ROUTE_ORGANIZATION_MISMATCH',
        warning: 'API_ROUTE_ORGANIZATION_MISMATCH',
      }
    }
    if (input.origin === 'body') {
      return {
        allowed: false,
        reasonCode: 'BODY_ORGANIZATION_MISMATCH',
        warning: 'API_BODY_ORGANIZATION_HINT_IGNORED',
      }
    }
    return {
      allowed: false,
      reasonCode: 'QUERY_ORGANIZATION_MISMATCH',
      warning: 'API_QUERY_ORGANIZATION_CLIPPED',
    }
  }
  return { allowed: true, reasonCode: 'OK' }
}

/** 拒绝/降级响应构造（非泄露错误 + 低敏 metadata）。 */
export function mapBuildDecisionEnvelope(input: {
  requestId: string
  scopeHash: string
  scopeMode: ApiScopeMode
  decision: ApiDecision
  reasonCode: MapReasonCode
  warnings?: MapWarningCode[]
  idempotencyScope?: string | null
  degradedReason?: string | null
}): ApiDecisionMetadata {
  return {
    requestId: input.requestId,
    tenantScopeHash: input.scopeHash,
    cacheNamespace: MAP_HASH_NS + ':cache:' + input.scopeHash,
    scopeMode: input.scopeMode,
    decision: input.decision,
    reasonCode: input.reasonCode,
    warnings: input.warnings ?? [],
    idempotencyScope: input.idempotencyScope ?? null,
    degradedReason: input.degradedReason ?? null,
  }
}

/** 低敏 API 自审计元数据构造。 */
export function mapBuildLowSensitiveAudit(input: {
  actorRef: string
  organizationId: number | null
  scopeHash: string
  route: string
  operation: ApiOperationType
  reasonCode: MapReasonCode
  scopeMode: ApiScopeMode
  requestId: string
  timestamp?: string
}): ApiLowSensitiveAudit {
  return {
    actorRef: input.actorRef,
    scopeHash: input.scopeHash,
    organizationId: input.organizationId,
    route: input.route,
    operation: input.operation,
    reasonCode: input.reasonCode,
    scopeMode: input.scopeMode,
    requestId: input.requestId,
    timestamp: input.timestamp ?? new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────
// 6. Handle 绑定（preview/confirm/export/job/SSE/idempotency/signature）
// ──────────────────────────────────────────────

/** 生成一个租户绑定的 handle。 */
export function mapCreateHandle(input: {
  scopeHash: string
  actorRef: string
  operation: ApiOperationType
  sourceHash: string
  requestId: string
  kind: ApiHandleKind
  expiresInSeconds?: number
  nonce?: string
}): ApiHandleBindingMetadata {
  const expiresIn = input.expiresInSeconds ?? MAP_HANDLE_DEFAULT_EXPIRY_SECONDS
  const idempotencyScope =
    MAP_HASH_NS + ':h:' + input.scopeHash + ':' + input.operation + ':' + input.kind
  const raw =
    MAP_HASH_NS +
    ':hb:' +
    input.scopeHash +
    ':' +
    input.actorRef +
    ':' +
    input.operation +
    ':' +
    input.kind +
    ':' +
    input.sourceHash +
    ':' +
    (input.nonce ?? '0')
  const handle = mtFnv1aHash(raw).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
  return {
    kind: input.kind,
    handle,
    scopeHash: input.scopeHash,
    sourceHash: input.sourceHash,
    actorRef: input.actorRef,
    operation: input.operation,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    requestId: input.requestId,
    idempotencyScope,
  }
}

/** 消费/验证 handle：绑定租户作用域 + 顶层操作 + kind + 未过期。 */
export function mapConsumeHandle(input: {
  handle: ApiHandleBindingMetadata
  scopeHash: string
  actorRef: string
  operation: ApiOperationType
  kind: ApiHandleKind
  now?: string
  /** 消费时重算的源 hash；若与绑定时不同 → 视为 stale（spec §5.5）。 */
  expectedSourceHash?: string | null
}): { allowed: boolean; reasonCode: MapReasonCode; warning?: MapWarningCode } {
  const now = input.now ?? new Date().toISOString()
  if (
    input.expectedSourceHash !== undefined &&
    input.expectedSourceHash !== null &&
    input.handle.sourceHash !== input.expectedSourceHash
  ) {
    return { allowed: false, reasonCode: 'STALE_SOURCE_HASH', warning: 'API_STALE_HANDLE' }
  }
  if (input.handle.kind !== input.kind) {
    return { allowed: false, reasonCode: 'INVALID_HANDLE', warning: 'API_INVALID_HANDLE' }
  }
  if (input.handle.scopeHash !== input.scopeHash) {
    return {
      allowed: false,
      reasonCode: 'CROSS_TENANT_REPLAY',
      warning: 'API_CROSS_TENANT_BLOCKED',
    }
  }
  if (input.handle.operation !== input.operation) {
    return {
      allowed: false,
      reasonCode: 'HANDLE_OPERATION_MISMATCH',
      warning: 'API_INVALID_HANDLE',
    }
  }
  if (input.handle.expiresAt < now) {
    return { allowed: false, reasonCode: 'EXPIRED_HANDLE', warning: 'API_EXPIRED_HANDLE' }
  }
  return { allowed: true, reasonCode: 'OK' }
}

// ──────────────────────────────────────────────
// 7. Scope mode 允许项与 SDK 预检
// ──────────────────────────────────────────────

/** 检查宣布的 scope mode 是否被 API surface 允许。 */
export function mapIsAllowedScopeMode(
  declaration: Pick<ApiSurfaceDeclaration, 'allowedScopeModes'>,
  mode: ApiScopeMode,
): boolean {
  return declaration.allowedScopeModes.includes(mode)
}

/**
 * 低敏安全 scope hash 前缀（供 SDK 预检 client 组织与服务器 scope 一致性）。
 * 缺省假设 scope hash 以组织 hash 为前缀；集群化时每组织稳定。
 */
export function mapExtractOrganizationHash(scopeHash: string): string {
  return scopeHash.slice(0, MULTITENANT_SCOPE_HASH_LENGTH)
}

/**
 * SDK 预检：客户端传入的组织 override 若与服务器租户 scope hash 冲突则拒绝/忽略。
 * 用于 mutation/preview/export/job/AI 请求发出前拦截不安全 override。
 */
export function mapValidateUnsafeOverride(input: {
  clientOrganizationId: number | string | null
  serverScopeHash: string
}): { allowed: boolean; reasonCode: MapReasonCode; warning?: MapWarningCode } {
  if (input.clientOrganizationId === null || input.clientOrganizationId === undefined) {
    return { allowed: true, reasonCode: 'OK' }
  }
  const expectedOrgHash = mtComputeOrganizationScopeHash(input.clientOrganizationId)
  if (mapExtractOrganizationHash(input.serverScopeHash) !== expectedOrgHash) {
    return {
      allowed: false,
      reasonCode: 'UNSAFE_TENANT_OVERRIDE',
      warning: 'API_CROSS_TENANT_BLOCKED',
    }
  }
  return { allowed: true, reasonCode: 'OK' }
}

/** 构造低敏 warning（统一形状）。 */
export function mapBuildWarning(input: {
  code: MapWarningCode
  reasonCode: MapReasonCode
  message: string
}): { code: MapWarningCode; reasonCode: MapReasonCode; message: string } {
  return {
    code: input.code,
    reasonCode: input.reasonCode,
    message: input.message,
  }
}
