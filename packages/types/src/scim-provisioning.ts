// @aiproj/types — V3 企业级 SCIM 2.0 Provisioning 共享契约（v3-scim-provisioning §2.1）。
//
// 纯函数 + 纯类型，零运行时外部依赖：不加载 AdonisJS、React、数据库客户端、
// 密码学库、外部网络或 IdP 凭据。前端渲染、后端服务与测试断言共用同一份低敏形状。
//
// 设计要点（design Decision 2/4/5/6/7/8 + RFC 7643/7644 有界子集）：
//  - 对外 DTO 一律**低敏**：只允许 ref/hash、状态枚举、reason code、时间戳、计数与
//    管理员可见的配置字段；bearer token、Authorization 头、raw SCIM 载荷、
//    完整外部属性、密码、隐藏租户名、绝对路径一律禁止出现。
//  - 角色面**上限夹紧**：组映射/JIT 只允许 viewer/member/admin；owner 在契约层就
//    被拒绝（`scimClampRole('owner') === null`），配置写错也不能提权。
//  - 过滤/分页**有界**：只支持精确相等 eq；count=0（RFC 语义 = 返回全部）直接拒绝；
//    count 超限夹紧到 maxResults——绝不允许无界跨租查询。
//  - 错误面**非泄露**：RFC-compatible status/scimType 形状 + 项目错误码映射，
//    detail 一律通用文案，不携带跨租存在性信息。
//  - 本文件只做**形状与纯策略**；token 的 sha256 哈希与常数时间比较、
//    endpoint key 的生成等密码学动作全部发生在后端服务（node:crypto），
//    契约只提供确定性指纹（fnv1a，浏览器/测试环境可用）。
//
// 命名约定：为避免 barrel export 冲突，本模块常量统一 `SCIM_` 前缀、
// 类型统一 `Scim` 前缀、函数统一 `scim` 前缀。

import {
  MULTITENANT_FORBIDDEN_KEYS,
  mtFnv1aHash,
  mtStableSerialize,
} from './multitenant-isolation-architecture.js'

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/** hash 命名空间：与其他能力的 hash 空间隔离，避免跨域碰撞被当成同一实体。 */
export const SCIM_HASH_NS = 'aiproj:v3:scim-provisioning'

/** 低敏 ref 长度（十六进制字符数，64 位）。 */
export const SCIM_REF_LENGTH = 16

/** token 指纹长度（十六进制字符数，128 位——指纹参与前端展示与审计比对）。 */
export const SCIM_FINGERPRINT_LENGTH = 32

/**
 * provider 运行状态。
 * - `enabled`   配置完整且启用，可接收 SCIM 请求
 * - `disabled`  管理员显式停用（保留配置，可恢复）
 * - `degraded`  配置存在但不可用（KMS 不可用、token 缺失、同步异常等）
 */
export const SCIM_PROVIDER_STATUSES = ['enabled', 'disabled', 'degraded'] as const
export type ScimProviderStatus = (typeof SCIM_PROVIDER_STATUSES)[number]

/** SCIM bearer token 生命周期状态。 */
export const SCIM_TOKEN_STATUSES = ['active', 'revoked', 'expired'] as const
export type ScimTokenStatus = (typeof SCIM_TOKEN_STATUSES)[number]

/**
 * SCIM 可授予的组织角色**上限集**：只能是 viewer / member / admin。
 * owner 被显式排除——design Decision 7「owner 转移/移除只能走本地显式流程」。
 */
export const SCIM_ALLOWED_ROLES = ['viewer', 'member', 'admin'] as const
export type ScimOrganizationRole = (typeof SCIM_ALLOWED_ROLES)[number]

/** JIT / 默认角色上限集：新建成员默认角色不能高于 member。 */
export const SCIM_JIT_ALLOWED_ROLES = ['viewer', 'member'] as const
export type ScimJitDefaultRole = (typeof SCIM_JIT_ALLOWED_ROLES)[number]

/**
 * 多组映射冲突策略（design Decision 7）。
 * - `fail_closed` 同一用户被多个组映射到不同角色 → 整体拒绝该用户角色变更（默认）
 * - `highest`     取确定性最高角色（admin > member > viewer）
 */
export const SCIM_CONFLICT_POLICIES = ['fail_closed', 'highest'] as const
export type ScimConflictPolicy = (typeof SCIM_CONFLICT_POLICIES)[number]

/** 用户链接方式。 */
export const SCIM_LINK_MODES = ['existing_member', 'jit_provisioned'] as const
export type ScimLinkMode = (typeof SCIM_LINK_MODES)[number]

/**
 * provider 低敏 warning code（可回前端映射成中文提示）。
 */
export const SCIM_WARNING_CODES = [
  'TOKEN_MISSING',
  'TOKEN_NOT_CREATED',
  'MAPPING_CONFLICT',
  'PROVIDER_DISABLED',
  'KMS_UNAVAILABLE',
  'FILTER_LIMIT_REACHED',
  'SYNC_FAILED',
] as const
export type ScimWarningCode = (typeof SCIM_WARNING_CODES)[number]

/**
 * SCIM reason code（低敏，审计/事件用）。
 *
 * 刻意不区分「组织不存在」「provider 未配置」「endpoint key 未知」：
 * 公开 SCIM 面任何失败都用 generic 401/404 + 同一 reason 族，
 * 细分会造成租户枚举侧信道。
 */
export const SCIM_REASON_CODES = [
  'SCIM_OK',
  // 认证面
  'TOKEN_INVALID',
  'TOKEN_REVOKED',
  'TOKEN_EXPIRED',
  'TOKEN_PROVIDER_MISMATCH',
  'ENDPOINT_KEY_UNKNOWN',
  'AUTH_HEADER_MALFORMED',
  'PROVIDER_DISABLED',
  // 存在性 / 冲突（对外一律隐藏，审计里只存 reason 枚举）
  'RESOURCE_NOT_FOUND',
  'DUPLICATE_EXTERNAL_ID',
  'DUPLICATE_EMAIL_HIDDEN',
  'USER_GLOBAL_INACTIVE',
  'JIT_DISABLED',
  'CROSS_TENANT_HIDDEN',
  // 保护面
  'OWNER_PROTECTED',
  'ROLE_CONFLICT',
  'MAPPING_OWNER_FORBIDDEN',
  // 协议面
  'FILTER_UNSUPPORTED',
  'FILTER_MALFORMED',
  'PAGINATION_UNBOUNDED',
  'BULK_UNSUPPORTED',
  'OPERATION_UNSUPPORTED',
  'INVALID_PAYLOAD',
  'MEMBER_REFERENCE_INVALID',
] as const
export type ScimReasonCode = (typeof SCIM_REASON_CODES)[number]

/** 项目错误码（`{ error: { code } }` 形状的映射目标）。 */
export const SCIM_PROJECT_ERROR_CODES = [
  'SCIM_UNAUTHORIZED',
  'SCIM_NOT_FOUND',
  'SCIM_CONFLICT',
  'SCIM_VALIDATION_ERROR',
  'SCIM_UNSUPPORTED',
  'SCIM_SERVER_ERROR',
] as const
export type ScimProjectErrorCode = (typeof SCIM_PROJECT_ERROR_CODES)[number]

/** 低敏审计事件类型。 */
export const SCIM_AUDIT_EVENTS = [
  'scim.provider.configured',
  'scim.provider.updated',
  'scim.provider.disabled',
  'scim.provider.enabled',
  'scim.provider.degraded',
  'scim.token.created',
  'scim.token.rotated',
  'scim.token.revoked',
  'scim.request.authenticated',
  'scim.request.denied',
  'scim.user.provisioned',
  'scim.user.linked',
  'scim.user.updated',
  'scim.user.deprovisioned',
  'scim.group.created',
  'scim.group.updated',
  'scim.group.deleted',
  'scim.membership.applied',
  'scim.membership.conflict',
  'scim.owner.denied',
  'scim.filter.rejected',
  'scim.mapping.validated',
  'scim.mapping.saved',
  'scim.mapping.previewed',
] as const
export type ScimAuditEvent = (typeof SCIM_AUDIT_EVENTS)[number]

/** SCIM 2.0 schema URN（RFC 7643/7644）。 */
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
export const SCIM_PATCHOP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'

/** 分页上限（ServiceProviderConfig.filter.maxResults 同值）。 */
export const SCIM_DEFAULT_MAX_RESULTS = 100

/**
 * SCIM 专有禁止字段（在多租户通用禁止键之上追加）。
 *
 * 命中任一即视为「敏感内容泄漏到低敏面」——契约测试与运行期 sanitize 都按它判定。
 * 注意 `endpointKey` 本身：管理面摘要可以回**带 key 的 endpointPath**（管理员配置
 * IdP 必需），但审计/事件/日志里只允许 `endpointKeyRef`（hash），所以 key 本体
 * 在这里被列为禁止字段。
 */
export const SCIM_EXTRA_FORBIDDEN_KEYS: readonly string[] = [
  'bearerToken',
  'bearer_token',
  'authorizationHeader',
  'authorization_header',
  'rawAuthorization',
  'raw_authorization',
  'tokenValue',
  'token_value',
  'rawToken',
  'raw_token',
  'rawPayload',
  'raw_payload',
  'rawScimPayload',
  'raw_scim_payload',
  'scimPayload',
  'scim_payload',
  'rawUserPayload',
  'raw_user_payload',
  'rawGroupPayload',
  'raw_group_payload',
  'rawExternalAttributes',
  'raw_external_attributes',
  'externalAttributes',
  'external_attributes',
  'rawEmails',
  'raw_emails',
  'endpointKey',
  'endpoint_key',
  'rawFilter',
  'raw_filter',
  'rawGroupMapping',
  'raw_group_mapping',
]

/** 低敏面禁止字段全集（多租户通用 + SCIM 专有）。 */
export const SCIM_FORBIDDEN_KEYS: readonly string[] = [
  ...MULTITENANT_FORBIDDEN_KEYS,
  ...SCIM_EXTRA_FORBIDDEN_KEYS,
]

/** Users 过滤属性白名单（design Decision 4）。 */
export const SCIM_USER_FILTER_ATTRIBUTES = [
  'id',
  'externalId',
  'userName',
  'active',
  'displayName',
] as const
export type ScimUserFilterAttribute = (typeof SCIM_USER_FILTER_ATTRIBUTES)[number]

/** Groups 过滤属性白名单。 */
export const SCIM_GROUP_FILTER_ATTRIBUTES = ['id', 'externalId', 'displayName'] as const
export type ScimGroupFilterAttribute = (typeof SCIM_GROUP_FILTER_ATTRIBUTES)[number]

/** endpoint key 格式：定长字符集（24–128 字符，后端生成 32 字节 base64url）。 */
export const SCIM_ENDPOINT_KEY_MIN_LENGTH = 24
export const SCIM_ENDPOINT_KEY_MAX_LENGTH = 128
const SCIM_ENDPOINT_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

/** bearer token 格式：定长字符集（32–256 字符）。 */
export const SCIM_TOKEN_MIN_LENGTH = 32
export const SCIM_TOKEN_MAX_LENGTH = 256
const SCIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

/** 属性映射路径白名单字符集（`emails`、`name.givenName` 形态）。 */
const SCIM_ATTRIBUTE_PATH_PATTERN = /^[A-Za-z0-9_.]+$/

/** 默认属性映射（SCIM User 资源路径 → 本地字段）。 */
export const SCIM_DEFAULT_ATTRIBUTE_MAPPING: ScimAttributeMapping = {
  emailAttribute: 'emails',
  userNameAttribute: 'userName',
  displayNameAttribute: 'displayName',
  givenNameAttribute: 'name.givenName',
  familyNameAttribute: 'name.familyName',
  activeAttribute: 'active',
}

// ──────────────────────────────────────────────
// 2. 契约类型
// ──────────────────────────────────────────────

/** SCIM 功能旗标（ServiceProviderConfig 广告位，诚实声明不支持项）。 */
export interface ScimFeatureFlags {
  patchSupported: true
  filterSupported: true
  filterMaxResults: number
  bulkSupported: false
  sortSupported: false
  changePasswordSupported: false
  etagSupported: false
}

/**
 * 属性映射：SCIM User 资源属性路径 → 本地用户字段。
 * 路径按 `SCIM_ATTRIBUTE_PATH_PATTERN` 校验，空值回落到默认映射。
 */
export interface ScimAttributeMapping {
  /** 邮箱来源路径（默认 `emails`，取 primary 项）。 */
  emailAttribute: string
  /** userName 来源路径（默认 `userName`）。 */
  userNameAttribute: string
  /** 展示名来源路径（默认 `displayName`）。 */
  displayNameAttribute: string
  /** 名来源路径（默认 `name.givenName`）。 */
  givenNameAttribute: string
  /** 姓来源路径（默认 `name.familyName`）。 */
  familyNameAttribute: string
  /** active 来源路径（默认 `active`）。 */
  activeAttribute: string
}

/** 组 → 角色映射（key = 归一化后的 SCIM Group displayName）。 */
export type ScimGroupRoleMapping = Record<string, ScimOrganizationRole>

/** JIT / 链接策略（低敏，可直接返回给管理员）。 */
export interface ScimJitPolicy {
  /** 是否允许 SCIM 为未知外部用户建号（JIT provisioning）。 */
  enabled: boolean
  /** 新建成员的默认角色（上限 member）。 */
  defaultRole: ScimJitDefaultRole
  /** 是否允许按归一化邮箱链接既有本地用户（需邮箱唯一且用户全局可用）。 */
  linkByEmail: boolean
}

/**
 * provider 低敏摘要（管理面 + 前端共用）。
 *
 * **不含**：bearer token、token hash、Authorization 头、raw SCIM 载荷、
 * 完整外部属性、密码、隐藏租户名。endpointPath 含 opaque endpoint key
 * （管理员配置 IdP 必需），审计面只用 `endpointKeyRef`。
 */
export interface ScimProviderSummary {
  /** 不可反推的 provider 引用（hash(org, id)）。 */
  providerRef: string
  organizationId: number
  status: ScimProviderStatus
  /** 管理员可读的源展示名（如 "Okta 生产"）。 */
  displayName: string
  /** SCIM 服务端点完整路径（含 endpoint key），如 `/api/v1/scim/v2/epk_…`。 */
  endpointPath: string
  /** endpoint key 的低敏指纹（审计/前端比对用，不是 key 本身）。 */
  endpointKeyRef: string
  featureFlags: ScimFeatureFlags
  attributeMapping: ScimAttributeMapping
  groupRoleMapping: ScimGroupRoleMapping
  conflictPolicy: ScimConflictPolicy
  jitPolicy: ScimJitPolicy
  warningCodes: ScimWarningCode[]
  updatedAt: string
  // ── v3-scim-attribute-mapping §4.7：映射管理元数据（可选，向前兼容） ──
  /** provider 本地映射版本（保存变更后的映射时 +1）。 */
  attributeMappingVersion?: number
  /** 结构化映射描述符（低敏：只含 path/target/枚举，不含任何载荷值）。 */
  mappingDescriptors?: Array<{
    path: string
    selectorType?: string
    selectorTypeValue?: string | null
    valueField?: string | null
    target: string
    required?: boolean
    normalization?: string
  }>
  /** 支持的本地目标键（identity + profile）与 profile 白名单（低敏元数据）。 */
  supportedMappingTargets?: readonly string[]
  /** 组织内 provider 下 mapping_version 过期的快照数（低敏计数）。 */
  staleSnapshotCount?: number
}

/**
 * SCIM token 低敏摘要。
 *
 * **不含** token 值：只含指纹（hash）、状态、使用/失败计数与时间戳。
 * `id` 是组织内数值主键（管理面吊销/定位用；不进审计——审计只存 tokenRef）。
 */
export interface ScimTokenSummary {
  /** 组织内数值 id（管理面操作定位用）。 */
  id: number
  /** token 引用（hash(provider, id)）。 */
  tokenRef: string
  /** token 值指纹（`scimComputeTokenFingerprint`，32 位十六进制）。 */
  fingerprint: string
  status: ScimTokenStatus
  lastUsedAt: string | null
  failureCount: number
  createdAt: string
  revokedAt: string | null
  expiresAt: string | null
}

/** token 创建/轮换结果：`token` 只在这一次响应里出现。 */
export interface ScimTokenCreatedResult {
  summary: ScimTokenSummary
  /** 一次性明文 token（调用方负责展示后丢弃）。 */
  token: string
}

/** SCIM User 资源（RFC 7643 有界子集）。 */
export interface ScimUserResource {
  schemas: string[]
  id?: string
  externalId?: string
  userName?: string
  name?: { givenName?: string; familyName?: string }
  displayName?: string
  emails?: Array<{ value: string; primary?: boolean; type?: string }>
  active?: boolean
  groups?: Array<{ value: string; display?: string }>
  // v3-scim-attribute-mapping：映射 profile 字段的协议回显（RFC 7643 core + enterprise ext）
  title?: string
  userType?: string
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'?: {
    employeeNumber?: string
    department?: string
    costCenter?: string
    organization?: string
    division?: string
    manager?: { value?: string; displayName?: string }
  }
  meta?: { resourceType: 'User'; created?: string; lastModified?: string; version?: string }
}

/** SCIM Group 资源（RFC 7643 有界子集）。 */
export interface ScimGroupResource {
  schemas: string[]
  id?: string
  externalId?: string
  displayName?: string
  members?: Array<{ value: string; display?: string }>
  meta?: { resourceType: 'Group'; created?: string; lastModified?: string; version?: string }
}

/** SCIM ListResponse（RFC 7644 §3.4.2）。 */
export interface ScimListResponse {
  schemas: string[]
  totalResults: number
  itemsPerPage: number
  startIndex: number
  Resources: Array<ScimUserResource | ScimGroupResource>
}

/** SCIM Error（RFC 7644 §3.12）。 */
export interface ScimErrorResponse {
  schemas: string[]
  /** HTTP status 的字符串形态（RFC 要求）。 */
  status: string
  detail?: string
  scimType?: string
}

/** SCIM PATCH 操作（RFC 7644 §3.5.2 有界子集）。 */
export interface ScimPatchOperation {
  op: 'add' | 'remove' | 'replace'
  path?: string
  value?: unknown
}

/** 低敏同步事件记录（事件台账 / 管理面摘要共用）。 */
export interface ScimSyncEventSummary {
  /** 事件引用（hash(org, provider, event, occurredAt)）。 */
  eventRef: string
  occurredAt: string
  event: ScimAuditEvent
  providerRef: string
  reasonCode: ScimReasonCode | null
  /** 低敏计数（如 `{ created: 1, updated: 0, deprovisioned: 1 }`）。 */
  counts: Record<string, number>
  warningCodes: ScimWarningCode[]
}

/** 组映射预览条目（P1：管理员启用前检查冲突）。 */
export interface ScimMappingPreviewEntry {
  groupName: string
  role: ScimOrganizationRole
  conflict: boolean
  conflictReason?: 'DUPLICATE_GROUP' | 'OWNER_FORBIDDEN' | 'UNKNOWN_GROUP' | 'ROLE_CONFLICT'
}

/** 组映射预览（低敏：只含组名/角色/冲突枚举，不含 raw 载荷）。 */
export interface ScimMappingPreview {
  entries: ScimMappingPreviewEntry[]
  conflictCount: number
}

/** 过滤解析成功结果。 */
export interface ScimParsedFilter {
  ok: true
  attribute: string
  value: string
}

/** 过滤解析拒绝结果（detail 用通用文案，不泄露跨租信息）。 */
export interface ScimFilterRejected {
  ok: false
  reason: Extract<ScimReasonCode, 'FILTER_UNSUPPORTED' | 'FILTER_MALFORMED'>
  detail: string
}

export type ScimFilterResult = ScimParsedFilter | ScimFilterRejected

/** 有界分页（startIndex ≥ 1，count ∈ [1, maxResults]）。 */
export interface ScimPagination {
  startIndex: number
  count: number
}

// ──────────────────────────────────────────────
// 3. 确定性 hash / ref
// ──────────────────────────────────────────────

function scimHash(namespace: string, input: string): string {
  const first = mtFnv1aHash(`${SCIM_HASH_NS}:${namespace}:${input}`)
  const second = mtFnv1aHash(`${first}:${input.length}:${namespace}`)
  return `${first}${second}`.slice(0, SCIM_REF_LENGTH).padEnd(SCIM_REF_LENGTH, '0')
}

function scimFingerprint(namespace: string, input: string): string {
  const first = mtFnv1aHash(`${SCIM_HASH_NS}:${namespace}:${input}`)
  const second = mtFnv1aHash(`${first}:${input.length}:${namespace}`)
  return `${first}${second}`.slice(0, SCIM_FINGERPRINT_LENGTH).padEnd(SCIM_FINGERPRINT_LENGTH, '0')
}

/** provider 引用：组织 + provider id 的确定性 hash。 */
export function scimComputeProviderRef(
  organizationId: number | string,
  providerId: number | string,
): string {
  return scimHash('provider', `${organizationId}:${providerId}`)
}

/** token 引用：provider + token id 的确定性 hash。 */
export function scimComputeTokenRef(providerId: number | string, tokenId: number | string): string {
  return scimHash('token', `${providerId}:${tokenId}`)
}

/** endpoint key 指纹：管理面/审计只存它，不存 key 本体。 */
export function scimComputeEndpointKeyRef(endpointKey: string): string {
  return scimHash('endpoint', endpointKey)
}

/** token 值指纹（32 位十六进制）：前端展示/审计比对用，不是可逆的 token。 */
export function scimComputeTokenFingerprint(token: string): string {
  return scimFingerprint('token-fp', token)
}

/** 外部 ID 引用：审计只存 externalId 的 hash，不存原始值。 */
export function scimComputeExternalIdRef(externalId: string | null | undefined): string | null {
  if (!externalId) return null
  return scimHash('external', externalId)
}

/** 事件引用：组织 + provider + 事件 + 时刻的确定性 hash。 */
export function scimComputeEventRef(input: {
  organizationId: number | string
  providerId: number | string
  event: ScimAuditEvent
  occurredAt: string
}): string {
  return scimHash(
    'event',
    `${input.organizationId}:${input.providerId}:${input.event}:${input.occurredAt}`,
  )
}

/**
 * 映射指纹：把影响权限决策的配置（属性映射 + 组角色映射 + 冲突策略 + JIT 策略）
 * 稳定序列化后 hash。用于「配置是否变过」判断与审计比对。
 */
export function scimComputeMappingFingerprint(input: {
  attributeMapping: ScimAttributeMapping
  groupRoleMapping: ScimGroupRoleMapping
  conflictPolicy: ScimConflictPolicy
  jitPolicy: ScimJitPolicy
}): string {
  return scimHash(
    'mapping',
    mtStableSerialize({
      attributeMapping: input.attributeMapping,
      groupRoleMapping: Object.fromEntries(
        Object.entries(input.groupRoleMapping).sort(([a], [b]) => a.localeCompare(b)),
      ),
      conflictPolicy: input.conflictPolicy,
      jitPolicy: input.jitPolicy,
    }),
  )
}

// ──────────────────────────────────────────────
// 4. 归一化（纯函数）
// ──────────────────────────────────────────────

/** 归一化 userName：trim + lowercase（SCIM userName 比较不区分大小写）。 */
export function scimNormalizeUserName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** 归一化邮箱：trim + lowercase。 */
export function scimNormalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** 归一化展示名：trim（保留大小写——组名是管理员可见字面量）。 */
export function scimNormalizeDisplayName(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/**
 * 角色夹紧：任何不在 `SCIM_ALLOWED_ROLES` 里的取值一律返回 null（拒绝）。
 *
 * 刻意 fail safe：owner 在契约层就被拒绝，后端与 DB CHECK 双保险。
 */
export function scimClampRole(configured: string | null | undefined): ScimOrganizationRole | null {
  if (configured === 'viewer' || configured === 'member' || configured === 'admin') {
    return configured
  }
  return null
}

/** JIT 默认角色夹紧：viewer/member 保留，其余（含 admin/owner）降到 member。 */
export function scimClampJitDefaultRole(configured: string | null | undefined): ScimJitDefaultRole {
  if (configured === 'viewer') return 'viewer'
  return 'member'
}

/** 角色秩（用于 highest 冲突策略的确定性比较）。 */
export function scimRoleRank(role: ScimOrganizationRole): number {
  if (role === 'admin') return 3
  if (role === 'member') return 2
  return 1
}

/**
 * 归一化属性映射：trim 路径、空值回落默认、非法路径回落默认。
 * 永不抛错——配置面已有校验，这里是最后一道闸。
 */
export function scimNormalizeAttributeMapping(
  input: Partial<ScimAttributeMapping> | null | undefined,
): ScimAttributeMapping {
  const pick = (value: string | undefined, fallback: string): string => {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return fallback
    if (!SCIM_ATTRIBUTE_PATH_PATTERN.test(trimmed)) return fallback
    return trimmed
  }
  return {
    emailAttribute: pick(input?.emailAttribute, SCIM_DEFAULT_ATTRIBUTE_MAPPING.emailAttribute),
    userNameAttribute: pick(
      input?.userNameAttribute,
      SCIM_DEFAULT_ATTRIBUTE_MAPPING.userNameAttribute,
    ),
    displayNameAttribute: pick(
      input?.displayNameAttribute,
      SCIM_DEFAULT_ATTRIBUTE_MAPPING.displayNameAttribute,
    ),
    givenNameAttribute: pick(
      input?.givenNameAttribute,
      SCIM_DEFAULT_ATTRIBUTE_MAPPING.givenNameAttribute,
    ),
    familyNameAttribute: pick(
      input?.familyNameAttribute,
      SCIM_DEFAULT_ATTRIBUTE_MAPPING.familyNameAttribute,
    ),
    activeAttribute: pick(input?.activeAttribute, SCIM_DEFAULT_ATTRIBUTE_MAPPING.activeAttribute),
  }
}

/**
 * 归一化组角色映射：组名 trim + 去重（后者覆盖前者，返回被覆盖列表），
 * 非法角色（含 owner）整条丢弃并返回 `droppedOwner` 列表供警告展示。
 */
export function scimNormalizeGroupRoleMapping(input: Record<string, unknown> | null | undefined): {
  mapping: ScimGroupRoleMapping
  droppedOwner: string[]
  duplicates: string[]
} {
  const mapping: ScimGroupRoleMapping = {}
  const droppedOwner: string[] = []
  const duplicates: string[] = []
  if (!input) return { mapping, droppedOwner, duplicates }
  for (const [rawName, rawRole] of Object.entries(input)) {
    const name = scimNormalizeDisplayName(rawName)
    if (!name) continue
    if (Object.prototype.hasOwnProperty.call(mapping, name)) {
      duplicates.push(name)
    }
    const role = scimClampRole(typeof rawRole === 'string' ? rawRole : null)
    if (!role) {
      droppedOwner.push(name)
      continue
    }
    mapping[name] = role
  }
  return { mapping, droppedOwner, duplicates }
}

/** 归一化 JIT 策略：布尔归一 + 默认角色夹紧。 */
export function scimNormalizeJitPolicy(
  input: Partial<ScimJitPolicy> | null | undefined,
): ScimJitPolicy {
  return {
    enabled: Boolean(input?.enabled ?? false),
    defaultRole: scimClampJitDefaultRole(input?.defaultRole),
    linkByEmail: Boolean(input?.linkByEmail ?? false),
  }
}

/**
 * 多组角色冲突解析。
 * - 无角色 → { role: null, conflict: false }
 * - 单一角色 → 该角色
 * - 多个不同角色：fail_closed → { role: null, conflict: true }；
 *   highest → 秩最高者
 */
export function scimResolveRole(
  roles: ScimOrganizationRole[],
  conflictPolicy: ScimConflictPolicy,
): { role: ScimOrganizationRole | null; conflict: boolean } {
  const unique = Array.from(new Set(roles))
  if (unique.length === 0) return { role: null, conflict: false }
  if (unique.length === 1) return { role: unique[0] ?? null, conflict: false }
  if (conflictPolicy === 'highest') {
    const highest = [...unique].sort((a, b) => scimRoleRank(b) - scimRoleRank(a))[0]
    return { role: highest ?? null, conflict: false }
  }
  return { role: null, conflict: true }
}

// ──────────────────────────────────────────────
// 5. 格式校验（纯函数，不含密码学）
// ──────────────────────────────────────────────

/** endpoint key 是否符合格式（高熵 opaque key；生成在后端 node:crypto）。 */
export function scimIsValidEndpointKeyFormat(key: string | null | undefined): boolean {
  if (typeof key !== 'string') return false
  if (key.length < SCIM_ENDPOINT_KEY_MIN_LENGTH || key.length > SCIM_ENDPOINT_KEY_MAX_LENGTH) {
    return false
  }
  return SCIM_ENDPOINT_KEY_PATTERN.test(key)
}

/** bearer token 是否符合格式。 */
export function scimIsValidTokenFormat(token: string | null | undefined): boolean {
  if (typeof token !== 'string') return false
  if (token.length < SCIM_TOKEN_MIN_LENGTH || token.length > SCIM_TOKEN_MAX_LENGTH) {
    return false
  }
  return SCIM_TOKEN_PATTERN.test(token)
}

/**
 * 有界分页夹紧。
 *
 * - `count` 缺省 → maxResults；`count <= 0` → 拒绝（RFC 语义 count=0 = 返回全部，
 *   本项目拒绝无界扫描）；`count > maxResults` → 夹紧。
 * - `startIndex < 1` → 夹紧到 1。
 */
export function scimClampPagination(
  startIndex: number | null | undefined,
  count: number | null | undefined,
  maxResults: number = SCIM_DEFAULT_MAX_RESULTS,
): { ok: true; pagination: ScimPagination } | { ok: false; reason: 'PAGINATION_UNBOUNDED' } {
  if (count !== null && count !== undefined && count <= 0) {
    return { ok: false, reason: 'PAGINATION_UNBOUNDED' }
  }
  const safeStart =
    Number.isFinite(Number(startIndex)) && Number(startIndex) >= 1
      ? Math.floor(Number(startIndex))
      : 1
  const hasCount = count !== null && count !== undefined
  const rawCount = hasCount
    ? Number.isFinite(Number(count))
      ? Math.floor(Number(count))
      : maxResults
    : maxResults
  const safeCount = rawCount > maxResults ? maxResults : rawCount
  return { ok: true, pagination: { startIndex: safeStart, count: safeCount } }
}

/**
 * 有界 SCIM 过滤解析（design Decision 4）。
 *
 * 只支持 `attr eq "value"` 精确相等，属性在白名单内。其余（co/sw/布尔组合/
 * and/or/not/括号/未知属性）一律拒绝：
 * - 属性不在白名单或运算符不受支持 → `FILTER_UNSUPPORTED`
 * - 语法不合法（引号不闭合等）→ `FILTER_MALFORMED`
 * detail 用通用文案，不携带请求内容（避免把用户名/邮箱回显成探测面）。
 */
export function scimParseFilter(
  filter: string | null | undefined,
  allowedAttributes: readonly string[],
): ScimFilterResult {
  const trimmed = (filter ?? '').trim()
  if (!trimmed) {
    return { ok: false, reason: 'FILTER_MALFORMED', detail: '过滤器为空或格式不正确' }
  }
  const match = /^([A-Za-z][A-Za-z0-9]*)\s+eq\s+"((?:[^"\\]|\\.)*)"$/.exec(trimmed)
  if (!match) {
    // 运算符/结构不受支持（and/or/not/括号/co/sw/pr/gt/lt…）
    const unsupported =
      /^(?:[A-Za-z0-9_.]+\s+(?:and|or|not)\b|[A-Za-z0-9_.]+\s+(?:co|sw|ew|pr|gt|lt|ge|le)\b|\()/.test(
        trimmed,
      )
    if (unsupported) {
      return { ok: false, reason: 'FILTER_UNSUPPORTED', detail: '暂不支持该过滤表达式' }
    }
    return { ok: false, reason: 'FILTER_MALFORMED', detail: '过滤器为空或格式不正确' }
  }
  const attribute = match[1] ?? ''
  if (!allowedAttributes.includes(attribute as never)) {
    return { ok: false, reason: 'FILTER_UNSUPPORTED', detail: '暂不支持该过滤属性' }
  }
  const rawValue = match[2] ?? ''
  return { ok: true, attribute, value: rawValue.replace(/\\(.)/g, '$1') }
}

// ──────────────────────────────────────────────
// 6. 低敏化与脱敏
// ──────────────────────────────────────────────

/** 值看起来像原始 SCIM 载荷 / bearer 类内容吗？ */
export function scimLooksLikeRawScimPayload(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  // SCIM **消息** URN（ListResponse/Error/PatchOp/SearchRequest）= 原始消息载荷。
  // 注意：核心 schema URN（`…:schemas:core:2.0:User`）出现在我们自己的合法 DTO 里，
  // 不是敏感内容，不能误伤。
  if (trimmed.includes('urn:ietf:params:scim:api:messages')) return true
  // 长 base64url 形态（token / 指纹通常较长；64 字符起判）
  if (trimmed.length >= 64 && /^[A-Za-z0-9\-_]+$/.test(trimmed)) return true
  // JSON 且带 "schemas": [...]（SCIM 资源/操作载荷形态——含消息 URN 时上面已命中，
  // 这里兜底识别「带 schemas 数组的完整 JSON 文档」形态）
  if (trimmed.startsWith('{') && /"schemas"\s*:\s*\[/.test(trimmed)) return true
  // "Resources": [...]（ListResponse 形态）
  if (trimmed.startsWith('{') && /"Resources"\s*:/.test(trimmed)) return true
  return false
}

/**
 * 深度检测低敏面禁止内容。
 * 返回命中的路径列表（空数组 = 干净）。
 */
export function scimDetectForbiddenContent(value: unknown, path = '$'): string[] {
  const hits: string[] = []
  if (value === null || value === undefined) return hits
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      hits.push(...scimDetectForbiddenContent(item, `${path}[${index}]`)),
    )
    return hits
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase()
      if (SCIM_FORBIDDEN_KEYS.some((forbidden) => forbidden.toLowerCase() === lowered)) {
        hits.push(`${path}.${key}`)
        continue
      }
      hits.push(...scimDetectForbiddenContent(child, `${path}.${key}`))
    }
    return hits
  }
  if (scimLooksLikeRawScimPayload(value)) hits.push(`${path}<raw-scim>`)
  return hits
}

/**
 * 深度脱敏：删除禁止键，并把疑似原始 SCIM 载荷替换成占位符。
 *
 * 与 `scimDetectForbiddenContent` 是一对：检测用于测试断言，脱敏用于运行期兜底。
 */
export function scimSanitizeLowSensitive<T>(value: T): T {
  return scimSanitizeInner(value) as T
}

function scimSanitizeInner(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(scimSanitizeInner)
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase()
      if (SCIM_FORBIDDEN_KEYS.some((forbidden) => forbidden.toLowerCase() === lowered)) continue
      result[key] = scimSanitizeInner(child)
    }
    return result
  }
  if (scimLooksLikeRawScimPayload(value)) return '[redacted]'
  return value
}

// ──────────────────────────────────────────────
// 7. RFC 兼容构建器
// ──────────────────────────────────────────────

/**
 * SCIM Error 响应构建器（RFC 7644 §3.12）。
 *
 * detail 一律由调用方传**通用文案**；本函数不注入任何业务字段。
 * status/scimType 映射到项目错误码见 `scimProjectErrorCode`。
 */
export function scimErrorResponse(input: {
  status: number
  scimType?: string
  detail?: string
}): ScimErrorResponse {
  const response: ScimErrorResponse = {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(input.status),
  }
  if (input.detail) response.detail = input.detail
  if (input.scimType) response.scimType = input.scimType
  return response
}

/** HTTP status / scimType → 项目错误码（`{ error: { code } }` 形状）。 */
export function scimProjectErrorCode(status: number, scimType?: string): ScimProjectErrorCode {
  if (status === 401 || status === 403) return 'SCIM_UNAUTHORIZED'
  if (status === 404) return 'SCIM_NOT_FOUND'
  if (status === 409) return 'SCIM_CONFLICT'
  if (scimType === 'invalidFilter' || scimType === 'invalidSyntax' || scimType === 'tooMany')
    return 'SCIM_VALIDATION_ERROR'
  if (status === 400) return 'SCIM_VALIDATION_ERROR'
  if (status === 501) return 'SCIM_UNSUPPORTED'
  return 'SCIM_SERVER_ERROR'
}

/** SCIM ListResponse 构建器（RFC 7644 §3.4.2）。 */
export function scimListResponse(input: {
  totalResults: number
  itemsPerPage: number
  startIndex: number
  resources: Array<ScimUserResource | ScimGroupResource>
}): ScimListResponse {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: input.totalResults,
    itemsPerPage: input.itemsPerPage,
    startIndex: input.startIndex,
    Resources: input.resources,
  }
}

/**
 * 低敏审计载荷构建器。
 *
 * 只允许 ref/hash、枚举、计数、时间戳与布尔；外部 ID / 邮箱 / 组名一律只以
 * hash 形式进入（externalIdRef）。调用方若误传原始值，`scimSanitizeLowSensitive`
 * 会在落库前兜底剥掉（后端 audit service 二次脱敏）。
 */
export function scimBuildAuditPayload(input: {
  event: ScimAuditEvent
  organizationId: number | null
  providerRef: string | null
  actorRef?: string | null
  tokenRef?: string | null
  externalIdRef?: string | null
  groupRef?: string | null
  requestId?: string | null
  reasonCode?: ScimReasonCode | null
  counts?: Record<string, number>
  warningCodes?: ScimWarningCode[]
  occurredAt: string
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    scimEvent: input.event,
    organizationId: input.organizationId,
    providerRef: input.providerRef,
    actorRef: input.actorRef ?? null,
    tokenRef: input.tokenRef ?? null,
    externalIdRef: input.externalIdRef ?? null,
    groupRef: input.groupRef ?? null,
    requestId: input.requestId ?? null,
    reasonCode: input.reasonCode ?? null,
    counts: input.counts ?? {},
    warningCodes: input.warningCodes ?? [],
    occurredAt: input.occurredAt,
  }
  return scimSanitizeLowSensitive(payload)
}

/** warning code 是否属于「需要管理面告警」的集合。 */
export function scimIsDegradedWarning(code: ScimWarningCode): boolean {
  return (
    code === 'TOKEN_MISSING' ||
    code === 'KMS_UNAVAILABLE' ||
    code === 'SYNC_FAILED' ||
    code === 'MAPPING_CONFLICT'
  )
}
