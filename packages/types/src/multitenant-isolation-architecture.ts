// @aiproj/types — V3 多租户隔离架构共享契约、确定性 hash 与低敏脱敏 helpers。
// 纯函数，零运行时外部依赖，前后端共享。
//
// 本模块定义跨层租户隔离的统一契约：TenantContext、TenantScopeSnapshot、scope mode、
// resource type、operation type、reason code 与 warning code，并提供确定性的 scope hash
// 与稳定序列化 helper。所有派生值（hash、signature、cache key、preview signature、
// artifact ref、idempotency key）必须先完成租户过滤，再计算派生值，且必须包含
// organization scope hash 或以租户命名空间区分，防止跨租户计数/hash/缓存命中泄漏存在性。
//
// 命名约定：为避免与 enterprise-dlp-engine / enterprise-encryption-helpers /
// enterprise-audit-enhancement / enterprise-compliance-readiness 已导出的
// fnv1aHash / computeStableSignature 在 barrel export 时冲突，本模块的通用 hash
// 统一使用 mt* 前缀；index.ts 使用显式 named export。

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/** 租户 scope mode：请求/作业执行时的租户作用域形态 */
export const MULTITENANT_SCOPE_MODES = [
  'organization_scoped',
  'project_scoped',
  'system_global',
] as const
export type MultitenantScopeMode = (typeof MULTITENANT_SCOPE_MODES)[number]

/** 资源类型：需要在 Tenant Scope Registry 声明的租户归属资源 */
export const MULTITENANT_RESOURCE_TYPES = [
  'organization',
  'project',
  'task',
  'wbs',
  'member',
  'file',
  'report',
  'audit',
  'ai_draft',
  'compiler_run',
  'compiler_artifact',
  'source_attribution',
  'knowledge_item',
  // v3-plugin-private-registry-lifecycle：组织私有插件目录的四类租户数据
  'plugin_registry_entry',
  'plugin_registry_release',
  'plugin_registry_review',
  'plugin_registry_operation',
] as const
export type MultitenantResourceType = (typeof MULTITENANT_RESOURCE_TYPES)[number]

/** 操作类型：隔离审计与 registry 声明使用的操作动作 */
export const MULTITENANT_OPERATION_TYPES = [
  'read',
  'write',
  'batch',
  'preview',
  'confirm',
  'export',
  'job',
  'cache_lookup',
  'signature',
  'ai_context',
  'external_boundary',
  'audit',
] as const
export type MultitenantOperationType = (typeof MULTITENANT_OPERATION_TYPES)[number]

/** 隔离 reason code：审计记录与错误语义使用 */
export const MULTITENANT_REASON_CODES = [
  'OK',
  'NO_TENANT_CONTEXT',
  'ORGANIZATION_MISMATCH',
  'ROUTE_ORGANIZATION_MISMATCH',
  'BODY_ORGANIZATION_MISMATCH',
  'NOT_A_MEMBER',
  'RESOURCE_NOT_FOUND',
  'MIXED_TENANT_BATCH',
  'MIXED_TENANT_REFERENCE',
  'STALE_SCOPE',
  'STALE_MEMBERSHIP',
  'RESOURCE_OWNERSHIP_CHANGED',
  'PERMISSION_DENIED',
  'GLOBAL_NOT_ALLOWED',
  'DEGRADED_RESOURCE',
  'UNSUPPORTED_RESOURCE',
  'REPLAY_ATTEMPT',
] as const
export type MultitenantReasonCode = (typeof MULTITENANT_REASON_CODES)[number]

/** 隔离 warning code：低敏响应中可安全返回的风险提示 */
export const MULTITENANT_WARNING_CODES = [
  'NO_ACTIVE_TENANT',
  'ORGANIZATION_NOT_MATCHED',
  'CROSS_ORGANIZATION_BLOCKED',
  'GLOBAL_LOW_SENSITIVE_ONLY',
  'DEGRADED_ADAPTER_MODULE',
  'UNSUPPORTED_TENANT_RESOURCE',
  'STALE_SCOPE_SNAPSHOT',
  'PARTIAL_SAME_TENANT_SUCCESS',
  'HIDDEN_CROSS_TENANT_ID',
] as const
export type MultitenantWarningCode = (typeof MULTITENANT_WARNING_CODES)[number]

/** 判定结果：请求/作业在隔离边界处的结果 */
export const MULTITENANT_DECISIONS = ['allow', 'deny', 'degrade', 'unavailable'] as const
export type MultitenantDecision = (typeof MULTITENANT_DECISIONS)[number]

/** registry 中资源声明的隔离状态 */
export const MULTITENANT_REGISTRY_STATUSES = ['registered', 'degraded', 'unsupported'] as const
export type MultitenantRegistryStatus = (typeof MULTITENANT_REGISTRY_STATUSES)[number]

/**
 * 低敏响应禁止出现的字段键集合（大小写不敏感）。
 * 包括 secrets、prompt、model output、raw provider payload、完整文件/报表/OCR 内容、
 * 绝对存储路径与 full logs。
 */
export const MULTITENANT_FORBIDDEN_KEYS: readonly string[] = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'apiKey',
  'api_key',
  'secret',
  'client_secret',
  'authorization',
  'prompt',
  'promptText',
  'prompt_text',
  'modelOutput',
  'model_output',
  'webhookBody',
  'webhook_body',
  'webhookPayload',
  'webhook_payload',
  'providerPayload',
  'provider_payload',
  'fileContent',
  'file_content',
  'reportContent',
  'report_content',
  'ocrContent',
  'ocr_content',
  'absolutePath',
  'absolute_path',
  'storagePath',
  'storage_path',
  'fullLogs',
  'full_logs',
  'rawPayload',
  'raw_payload',
  'dek',
  'plaintext',
]

/** 默认 scope hash 命名空间前缀 */
export const MULTITENANT_HASH_NS = 'mt'

/** scope hash 长度（16 位十六进制） */
export const MULTITENANT_SCOPE_HASH_LENGTH = 16

// ──────────────────────────────────────────────
// 2. 核心契约类型
// ──────────────────────────────────────────────

/**
 * TenantContext：当前请求有效租户作用域。
 * organizationId 来自服务端认证态解析；projectId 可选，供项目级 API 使用。
 */
export interface TenantContext {
  organizationId: number
  projectId?: number | null
  scopeMode: MultitenantScopeMode
  actorRef: string
  isSuperAdmin: boolean
}

/**
 * TenantScopeSnapshot：后台作业/异步任务持久化的低敏租户快照。
 * 只允许包含低敏字段；执行时必须重新校验资源归属与权限。
 */
export interface TenantScopeSnapshot {
  actorRef: string
  organizationId: number
  organizationScopeHash: string
  projectId?: number | null
  projectScopeHash?: string | null
  resourceType?: MultitenantResourceType | null
  sourceRefs: string[]
  permissionSnapshotHash: string
  scopeMode: MultitenantScopeMode
  idempotencyKey: string
  requestId: string
  issuedAt: string
}

/**
 * 隔离判定结果信封。
 */
export interface MultitenantDecisionEnvelope {
  decision: MultitenantDecision
  reasonCode: MultitenantReasonCode
  resourceType?: MultitenantResourceType | null
  operationType?: MultitenantOperationType | null
}

/**
 * registry 资源声明：描述每类租户资源的归属字段、父子归属解析与全局例外。
 * 默认 scoped-only；global 必须显式声明。
 */
export interface TenantResourceDeclaration {
  resourceType: MultitenantResourceType
  /**
   * 资源行上标识所属组织的 DB 列（snake_case，供 Lucid where）。
   * null = 该资源无直接组织列，归属必须经 parentResolver='project' 的项目父级派生
   * （如 task/wbs/member/file/report），scope 查询以 projectField 过滤。
   */
  organizationField: string | null
  projectField?: string | null
  parentResolver?: 'project' | 'organization' | 'none' | null
  allowSuperAdminGlobal: boolean
  registryStatus: MultitenantRegistryStatus
  errorSemantics: 'RESOURCE_NOT_FOUND' | 'PERMISSION_DENIED'
  auditResourceType: string
}

/**
 * 低敏隔离审计元数据。
 */
export interface MultitenantAuditMetadata {
  actorRef: string
  scopeHash: string
  organizationId: number
  projectId?: number | null
  resourceType?: MultitenantResourceType | null
  operationType: MultitenantOperationType
  reasonCode: MultitenantReasonCode
  decision: MultitenantDecision
  requestId: string
  idempotencyKey?: string | null
  timestamp: string
}

// ──────────────────────────────────────────────
// 3. 类型守卫
// ──────────────────────────────────────────────

export function isMultitenantScopeMode(v: unknown): v is MultitenantScopeMode {
  return MULTITENANT_SCOPE_MODES.includes(v as MultitenantScopeMode)
}

export function isMultitenantResourceType(v: unknown): v is MultitenantResourceType {
  return MULTITENANT_RESOURCE_TYPES.includes(v as MultitenantResourceType)
}

export function isMultitenantOperationType(v: unknown): v is MultitenantOperationType {
  return MULTITENANT_OPERATION_TYPES.includes(v as MultitenantOperationType)
}

export function isMultitenantReasonCode(v: unknown): v is MultitenantReasonCode {
  return MULTITENANT_REASON_CODES.includes(v as MultitenantReasonCode)
}

export function isMultitenantWarningCode(v: unknown): v is MultitenantWarningCode {
  return MULTITENANT_WARNING_CODES.includes(v as MultitenantWarningCode)
}

export function isMultitenantDecision(v: unknown): v is MultitenantDecision {
  return MULTITENANT_DECISIONS.includes(v as MultitenantDecision)
}

export function isMultitenantRegistryStatus(v: unknown): v is MultitenantRegistryStatus {
  return MULTITENANT_REGISTRY_STATUSES.includes(v as MultitenantRegistryStatus)
}

// ──────────────────────────────────────────────
// 4. 确定性 hash 与稳定序列化
// ──────────────────────────────────────────────

/**
 * 稳定 FNV-1a hash（纯 JS 实现，跨运行时确定性）。
 * 对同一输入始终返回同一值。
 */
export function mtFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 对对象键做稳定排序后返回 JSON 字符串（递归）。
 * 确保 hash 计算不因 key 顺序变化而改变。
 */
export function mtStableSerialize(obj: Record<string, unknown>): string {
  return JSON.stringify(mtSortKeys(obj))
}

function mtSortKeys(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(mtSortKeys)
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    ordered[key] = mtSortKeys((value as Record<string, unknown>)[key])
  }
  return ordered
}

/**
 * 计算 organization scope hash。
 * 输入 organization id，输出 16 位十六进制低敏 hash，用于租户命名空间。
 */
export function mtComputeOrganizationScopeHash(organizationId: number | string): string {
  return mtFnv1aHash(`${MULTITENANT_HASH_NS}:org:${organizationId}`).padEnd(
    MULTITENANT_SCOPE_HASH_LENGTH,
    '0',
  )
}

/**
 * 计算 project scope hash（留空则返回 null）。
 */
export function mtComputeProjectScopeHash(projectId?: number | string | null): string | null {
  if (projectId === undefined || projectId === null || projectId === '') return null
  return mtFnv1aHash(`${MULTITENANT_HASH_NS}:prj:${projectId}`).padEnd(
    MULTITENANT_SCOPE_HASH_LENGTH,
    '0',
  )
}

/**
 * 计算默认的 scope hash 摘要（org + 可选 project）。
 */
export function mtComputeScopeHash(params: {
  organizationId: number | string
  projectId?: number | string | null
}): string {
  const orgHash = mtComputeOrganizationScopeHash(params.organizationId)
  const projectHash = mtComputeProjectScopeHash(params.projectId)
  return projectHash
    ? mtFnv1aHash(`${orgHash}::${projectHash}`).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
    : orgHash
}

/**
 * 计算 resource scope hash（用于特定资源 ref 的 tenure 绑定）。
 */
export function mtComputeResourceScopeHash(
  organizationId: number | string,
  resourceType: MultitenantResourceType,
  resourceRef: string,
): string {
  const base = `${MULTITENANT_HASH_NS}:res:${organizationId}:${resourceType}:${resourceRef}`
  return mtFnv1aHash(base).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
}

/**
 * 计算权限快照 hash（用于作业过期检测）。
 */
export function mtComputePermissionSnapshotHash(params: {
  roleVersion: number
  organizationId: number | string
  scopeMode: MultitenantScopeMode
}): string {
  const raw = `${MULTITENANT_HASH_NS}:perm:${params.roleVersion}:${params.organizationId}:${params.scopeMode}`
  return mtFnv1aHash(raw).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
}

/**
 * 构建 `scope:mtime:actor` 结构的签名输入信封，用于预览签名与 idempotency。
 */
export function mtBuildScopeSigningEnvelope(params: {
  organizationId: number | string
  projectId?: number | string | null
  resourceRef?: string | null
  nonce: string
}): string {
  const scopeHash = mtComputeScopeHash({
    organizationId: params.organizationId,
    projectId: params.projectId,
  })
  const ref = params.resourceRef ?? 'resource'
  return `${MULTITENANT_HASH_NS}:sign:${scopeHash}:${mtFnv1aHash(ref)}:${params.nonce}`
}

/**
 * 从 TenantScopeSnapshot 生成稳定签名（用于预览/确认防回放）。
 */
export function mtComputeSnapshotSignature(snapshot: TenantScopeSnapshot): string {
  return mtFnv1aHash(
    `${snapshot.organizationScopeHash}::${snapshot.scopeMode}::${snapshot.permissionSnapshotHash}::${snapshot.idempotencyKey}`,
  ).padEnd(MULTITENANT_SCOPE_HASH_LENGTH, '0')
}

// ──────────────────────────────────────────────
// 5. 低敏脱敏与安全响应
// ──────────────────────────────────────────────

/**
 * 检测对象（含嵌套）中是否包含禁止 key。
 * 返回所有匹配的禁止 key 路径列表。
 */
export function detectMultitenantForbiddenKeysDeep(obj: unknown): string[] {
  const found: string[] = []
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof value !== 'object') return
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const full = path ? `${path}.${key}` : key
      if (MULTITENANT_FORBIDDEN_KEYS.includes(key)) found.push(full)
      walk(val, full)
    }
  }
  walk(obj, '')
  return found
}

/**
 * 从对象中递归删除禁止 key，返回新对象。
 */
export function redactMultitenantForbiddenKeys<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.map((item) => redactMultitenantForbiddenKeys(item)) as unknown as T
  }
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (MULTITENANT_FORBIDDEN_KEYS.includes(key)) continue
    result[key] = redactMultitenantForbiddenKeys(val)
  }
  return result as T
}

/**
 * 判断对象中是否有禁止 key。
 */
export function hasMultitenantForbiddenKeys(obj: unknown): boolean {
  return detectMultitenantForbiddenKeysDeep(obj).length > 0
}

/**
 * 构建低敏 scope context（用于安全地渲染 organization/project scope 标签）。
 * 返回 organizationId + scope hash + 低敏 label；不暴露隐藏的租户详情。
 */
export function buildLowSensitiveScopeLabels(context: {
  organizationId: number
  projectId?: number | null
  projectName?: string | null
}): {
  organizationId: number
  organizationScopeHash: string
  projectId: number | null
  projectScopeHash: string | null
  projectLabel: string | null
} {
  return {
    organizationId: context.organizationId,
    organizationScopeHash: mtComputeOrganizationScopeHash(context.organizationId),
    projectId: context.projectId ?? null,
    projectScopeHash: mtComputeProjectScopeHash(context.projectId),
    projectLabel: context.projectName ?? null,
  }
}

/**
 * 将复合值映射为低敏 warning 条目（不含隐藏租户详情）。
 */
export function buildMultitenantWarning(params: {
  code: MultitenantWarningCode
  reasonCode: MultitenantReasonCode
  message: string
}): {
  code: MultitenantWarningCode
  reasonCode: MultitenantReasonCode
  message: string
} {
  return {
    code: params.code,
    reasonCode: params.reasonCode,
    message: params.message,
  }
}

/**
 * 构建 TenantScopeSnapshot 低敏快照。
 * 所有输入必须已经是低敏引用（sourceRefs 为资源 hash 或低敏 id）。
 */
export function buildTenantScopeSnapshot(params: {
  actorRef: string
  organizationId: number
  scopeMode: MultitenantScopeMode
  sourceRefs: string[]
  permissionSnapshotHash: string
  idempotencyKey: string
  requestId: string
  projectId?: number | null
  resourceType?: MultitenantResourceType | null
  issuedAt?: string
}): TenantScopeSnapshot {
  return {
    actorRef: params.actorRef,
    organizationId: params.organizationId,
    organizationScopeHash: mtComputeOrganizationScopeHash(params.organizationId),
    projectId: params.projectId ?? null,
    projectScopeHash: mtComputeProjectScopeHash(params.projectId),
    sourceRefs: [...params.sourceRefs],
    permissionSnapshotHash: params.permissionSnapshotHash,
    scopeMode: params.scopeMode,
    idempotencyKey: params.idempotencyKey,
    requestId: params.requestId,
    resourceType: params.resourceType ?? null,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
  }
}

/**
 * 构建低敏隔离审计元数据。
 */
export function buildMultitenantAuditMetadata(params: {
  actorRef: string
  organizationId: number
  operationType: MultitenantOperationType
  reasonCode: MultitenantReasonCode
  decision: MultitenantDecision
  requestId: string
  projectId?: number | null
  resourceType?: MultitenantResourceType | null
  idempotencyKey?: string | null
  timestamp?: string
}): MultitenantAuditMetadata {
  return {
    actorRef: params.actorRef,
    scopeHash: mtComputeScopeHash({
      organizationId: params.organizationId,
      projectId: params.projectId,
    }),
    organizationId: params.organizationId,
    projectId: params.projectId ?? null,
    resourceType: params.resourceType ?? null,
    operationType: params.operationType,
    reasonCode: params.reasonCode,
    decision: params.decision,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey ?? null,
    timestamp: params.timestamp ?? new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────
// 6. 批量混租校验辅助（纯函数判定）
// ──────────────────────────────────────────────

/**
 * 检查批量输入的租户归属是否都落在同一 organization scope 内。
 *
 * 调用方必须已经用 registry 声明的归属字段把每个 ref 解析为 owner organization id。
 * 返回判定 + 命中 reason；cross-tenant 输入仅报告 generic 原因，不泄露具体 ID 或
 * 来源组织，符合"partial success 不泄露隐藏 ID"要求。
 */
export function isBatchSameTenant(params: {
  currentOrganizationId: number | string
  resolvedOwners: Array<number | string>
}): MultitenantDecisionEnvelope {
  const cur = String(params.currentOrganizationId)
  for (const owner of params.resolvedOwners) {
    if (String(owner) !== cur) {
      return {
        decision: 'deny',
        reasonCode: 'MIXED_TENANT_BATCH',
      }
    }
  }
  return { decision: 'allow', reasonCode: 'OK' }
}
