/**
 * plugin-scoped-storage —— V3 插件组织/项目级 scoped 存储共享契约
 * （纯类型 + 常量 + 类型守卫 + 确定性归一化/序列化/digest + 低敏扫描，
 *  零运行时依赖，零网络/IO/时间/随机数依赖；reference time 由调用方注入）。
 *
 * 本模块是前后端共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-scoped-storage.test.ts`。
 *
 * # 语义要点（对应 openspec/changes/v3-plugin-scoped-storage spec/design）
 * - 两表模型：namespace（组织/项目/插件/安装绑定 + 配额 + 用量 + 生命周期）与 entry（key 文档）。
 * - value 仅限 canonical JSON document：深度/字段数/key 格式/字节数全部有界；确定性序列化与 digest。
 * - 生命周期映射：enabled→active（可读写）；installed(disabled)→read-only（runtime 拒读写，
 *   仅宿主授权导出可读）；uninstalled→orphaned（保留期，管理员清理/导出）；清理确认→pending-deletion。
 * - 并发：entry revision 单调递增，写入必须携带 expectedRevision 才覆盖（CAS）。
 * - 配额三层：organization 总量 / project 总量 / 单 namespace（即单插件单 scope）；
 *   接近上限产出有界 warning，超限原子拒绝且不得降级为非托管存储。
 * - 清理：preview 绑定 namespace revision/digest 的一次性句柄，confirm 必须逐字匹配并写可信审计。
 * - 导出：仅有权组织管理员、版本化 `plugin-storage-export-v1`、分页有界、二次低敏扫描 fail closed。
 * - 所有错误码封闭、低敏、非泄露：跨租/跨项目/跨插件统一为 not-found 语义由服务层裁决，契约只提供码。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 存储 schema 版本（首版固定）。 */
export const PLUGIN_STORAGE_SCHEMA_VERSION = '1.0' as const
export type PluginStorageSchemaVersion = typeof PLUGIN_STORAGE_SCHEMA_VERSION

/** Scope kind（封闭集；global 不存在）。 */
export const PLUGIN_STORAGE_SCOPES = ['organization', 'project'] as const
export type PluginStorageScope = (typeof PLUGIN_STORAGE_SCOPES)[number]

/** Namespace 生命周期状态（design D4）。 */
export const PLUGIN_STORAGE_NAMESPACE_STATUSES = [
  'active',
  'read-only',
  'orphaned',
  'pending-deletion',
] as const
export type PluginStorageNamespaceStatus = (typeof PLUGIN_STORAGE_NAMESPACE_STATUSES)[number]

/** 安装态 → namespace 生命周期映射输入（复用安装生命周期的封闭集）。 */
export type PluginStorageInstallStatusInput = 'installed' | 'enabled' | 'uninstalled'

/**
 * 由安装态派生 namespace 生命周期：
 * - enabled → active（runtime 可读写）
 * - installed（已安装未启用 = 停用）→ read-only（runtime 拒读写，宿主授权导出可读）
 * - uninstalled → orphaned（保留期开始，管理员清理/导出）
 */
export function deriveStorageNamespaceStatus(
  installStatus: PluginStorageInstallStatusInput,
): PluginStorageNamespaceStatus {
  switch (installStatus) {
    case 'enabled':
      return 'active'
    case 'installed':
      return 'read-only'
    case 'uninstalled':
      return 'orphaned'
  }
}

/**
 * runtime（插件侧）操作是否被允许；返回 null 表示允许，否则为低敏拒绝码。
 * active 全允许；read-only/orphaned/pending-deletion 一律拒（含读——D4：插件 runtime 不读）。
 */
export function assertRuntimeStorageAccess(
  status: PluginStorageNamespaceStatus,
): PluginStorageErrorCode | null {
  if (status === 'active') return null
  if (status === 'read-only') return 'storage-namespace-read-only'
  if (status === 'orphaned') return 'storage-namespace-orphaned'
  return 'storage-namespace-pending-deletion'
}

/** 错误码（稳定、封闭、低敏、非泄露）。 */
export const PLUGIN_STORAGE_ERROR_CODES = [
  // 认证与授权
  'storage-auth-required',
  'storage-permission-denied',
  // 隔离（响应一律非泄露）
  'storage-cross-tenant-denied',
  'storage-cross-project-denied',
  'storage-cross-plugin-namespace',
  // 安装与生命周期
  'storage-install-not-enabled',
  'storage-namespace-not-found',
  'storage-namespace-read-only',
  'storage-namespace-orphaned',
  'storage-namespace-pending-deletion',
  // key/value 校验
  'storage-key-invalid',
  'storage-value-invalid',
  'storage-value-too-large',
  'storage-secret-like-content',
  // 容量
  'storage-entry-limit-reached',
  'storage-quota-exceeded',
  'storage-quota-org-exceeded',
  'storage-quota-project-exceeded',
  'storage-quota-plugin-exceeded',
  // 并发
  'storage-revision-conflict',
  // 清理
  'storage-cleanup-handle-invalid',
  'storage-cleanup-handle-expired',
  'storage-cleanup-binding-mismatch',
  'storage-cleanup-already-consumed',
  'storage-cleanup-audit-failed',
  // 导出
  'storage-export-permission-denied',
  'storage-export-too-large',
  'storage-export-scan-failed',
  // 分页与通用
  'storage-pagination-invalid',
  'storage-unknown-error',
] as const
export type PluginStorageErrorCode = (typeof PLUGIN_STORAGE_ERROR_CODES)[number]

/** RBAC 权限码（管理面；runtime 面复用组织/项目成员资格判定）。 */
export const PLUGIN_STORAGE_PERMISSIONS = [
  'plugin_storage:view',
  'plugin_storage:manage',
  'plugin_storage:export',
] as const
export type PluginStoragePermission = (typeof PLUGIN_STORAGE_PERMISSIONS)[number]

/** 低敏审计动作码。 */
export const PLUGIN_STORAGE_AUDIT_ACTIONS = [
  'plugin_storage_written',
  'plugin_storage_deleted',
  'plugin_storage_cleanup_previewed',
  'plugin_storage_cleanup_confirmed',
  'plugin_storage_exported',
] as const
export type PluginStorageAuditAction = (typeof PLUGIN_STORAGE_AUDIT_ACTIONS)[number]

/** 导出格式版本（版本化有界格式）。 */
export const PLUGIN_STORAGE_EXPORT_FORMAT = 'plugin-storage-export-v1' as const

// -----------------------------------------------------------------------------
// 有界限制（design D2/D3；所有上限必须显式、可测试）
// -----------------------------------------------------------------------------

/** 存储硬上限集合（全部为不可变常量）。 */
export const PLUGIN_STORAGE_LIMITS: Readonly<{
  /** 单个 key 最大 UTF-8 字节数。 */
  maxKeyBytes: number
  /** 单个 value 文档最大 UTF-8 字节数（canonical 序列化后）。 */
  maxValueBytes: number
  /** 文档最大嵌套深度（顶层对象为 1）。 */
  maxDepth: number
  /** 文档最大字段总数（所有层级累计）。 */
  maxFields: number
  /** 单 namespace 最大条目数。 */
  maxEntriesPerNamespace: number
  /** 单 namespace 默认总字节配额。 */
  namespaceQuotaBytes: number
  /** 组织默认总字节配额。 */
  organizationQuotaBytes: number
  /** 项目默认总字节配额。 */
  projectQuotaBytes: number
  /** 列表分页默认/上限。 */
  listPageSize: number
  maxListPageSize: number
  /** 导出单批最大条目数（分页流式）。 */
  exportBatchEntries: number
  /** 导出临时文件有效期（秒）。 */
  exportTempTtlSeconds: number
  /** 清理确认句柄有效期（秒）。 */
  cleanupHandleTtlSeconds: number
  /** orphaned 数据默认保留天数。 */
  orphanedRetentionDays: number
}> = {
  maxKeyBytes: 200,
  maxValueBytes: 64 * 1024,
  maxDepth: 8,
  maxFields: 128,
  maxEntriesPerNamespace: 256,
  namespaceQuotaBytes: 512 * 1024,
  organizationQuotaBytes: 4 * 1024 * 1024,
  projectQuotaBytes: 2 * 1024 * 1024,
  listPageSize: 50,
  maxListPageSize: 100,
  exportBatchEntries: 500,
  exportTempTtlSeconds: 600,
  cleanupHandleTtlSeconds: 600,
  orphanedRetentionDays: 30,
}

/** 配额接近上限的警告阈值（用量/配额 ≥ 0.8 时产出有界 warning）。 */
export const PLUGIN_STORAGE_QUOTA_WARN_RATIO = 0.8

// =============================================================================
// 2. 核心类型与 DTO
// =============================================================================

/** 低敏 finding（结构化、无自由文本值）。 */
export interface PluginStorageFinding {
  code: PluginStorageErrorCode
  severity: 'info' | 'warning' | 'blocking'
  /** 出错字段路径（如 `value.tags[3]`），不含值内容。 */
  fieldPath?: string
}

/** 配额快照（namespace 行内冗余 + 汇总探测共用形状）。 */
export interface PluginStorageQuotaSnapshot {
  /** 当前已用字节数。 */
  usedBytes: number
  /** 当前条目数。 */
  usedEntries: number
  /** 字节配额上限。 */
  quotaBytes: number
  /** 条目数上限。 */
  quotaEntries: number
}

/** 配额评估结果（纯函数输出；接近上限给 warning，超限给 blocking 码）。 */
export interface PluginStorageQuotaVerdict {
  ok: boolean
  /** 超限时的具体层（组织/项目/插件 namespace）。 */
  exceeded?: 'organization' | 'project' | 'namespace'
  reasonCode?: PluginStorageErrorCode
  warnings: readonly PluginStorageFinding[]
}

/** Namespace 引用（服务端权威解析后的坐标；客户端提供的 scope 不是 authority）。 */
export interface PluginStorageNamespaceRef {
  namespaceId: number
  organizationId: number
  projectId: number | null
  pluginId: string
  pluginVersion: string
  installationId: number
  scope: PluginStorageScope
  status: PluginStorageNamespaceStatus
}

/** Entry 读取结果 DTO（低敏；不含跨 namespace 信息）。 */
export interface PluginStorageEntryDto {
  namespaceId: number
  key: string
  value: unknown
  schemaVersion: string
  revision: number
  byteSize: number
  createdAt: string
  updatedAt: string
}

/** 写入请求（runtime 服务层入参；authority 字段由服务端注入，不接受客户端声明）。 */
export interface PluginStoragePutRequest {
  key: string
  value: unknown
  /** 期望 revision（缺省表示“仅新建”，已存在则冲突）。 */
  expectedRevision?: number
  schemaVersion?: string
}

/** 写入结果。 */
export interface PluginStoragePutResult {
  entry: PluginStorageEntryDto
  /** 本 namespace 写入后的用量快照。 */
  usage: PluginStorageQuotaSnapshot
}

/** 列表请求（有界分页）。 */
export interface PluginStorageListRequest {
  page?: number
  perPage?: number
  /** key 前缀过滤（规范化后前缀匹配）。 */
  prefix?: string
}

/** 列表结果（统一 envelope 形状）。 */
export interface PluginStorageListResult {
  data: readonly PluginStorageEntryDto[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 清理预览（一次性句柄载体；digest 绑定 namespace 内容状态）。 */
export interface PluginStorageCleanupPreview {
  format: typeof PLUGIN_STORAGE_EXPORT_FORMAT | 'plugin-storage-cleanup-preview-v1'
  cleanupHandle: string
  namespaceId: number
  pluginId: string
  scope: PluginStorageScope
  projectId: number | null
  status: PluginStorageNamespaceStatus
  entryCount: number
  totalBytes: number
  /** 绑定摘要 = f(namespace 行 revision + 条目聚合 digest)；confirm 必须逐字回传。 */
  cleanupDigest: string
  irreversible: true
  expiresAt: string
  createdAt: string
}

/** 清理确认请求。 */
export interface PluginStorageCleanupConfirmRequest {
  cleanupHandle: string
  cleanupDigest: string
}

/** 清理执行结果（逐 namespace）。 */
export interface PluginStorageCleanupResult {
  namespaceId: number
  pluginId: string
  deletedEntries: number
  freedBytes: number
  auditReceiptId: string | null
}

/** 导出清单 manifest（JSONL 首行）。 */
export interface PluginStorageExportManifest {
  format: typeof PLUGIN_STORAGE_EXPORT_FORMAT
  organizationId: number
  requestedByActorRef: string
  filter: {
    pluginId: string | null
    scope: PluginStorageScope | null
    includeOrphaned: boolean
  }
  pages: number
  totalEntries: number
  totalBytes: number
  digest: string
  expiresAt: string
  createdAt: string
}

/** 导出数据行（JSONL 后续行；只含本组织授权 namespace 内数据）。 */
export interface PluginStorageExportRecord {
  namespaceId: number
  pluginId: string
  scope: PluginStorageScope
  projectId: number | null
  status: PluginStorageNamespaceStatus
  key: string
  value: unknown
  schemaVersion: string
  revision: number
  byteSize: number
  updatedAt: string
}

// =============================================================================
// 3. key 与 canonical JSON document 校验（纯函数）
// =============================================================================

/** key 规范化字符集：小写字母数字开头，允许 `.`,`_`,`-`；禁止 `..`、前后导点/横线由首尾规则排除。 */
const STORAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/

function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length
}

/** 校验并规范化 storage key（小写化 + 去首尾空白后全匹配）。 */
export function normalizeStorageKey(
  raw: string,
): { ok: true; key: string } | { ok: false; reasonCode: PluginStorageErrorCode } {
  if (typeof raw !== 'string') return { ok: false, reasonCode: 'storage-key-invalid' }
  const key = raw.trim().toLowerCase()
  if (!STORAGE_KEY_PATTERN.test(key)) return { ok: false, reasonCode: 'storage-key-invalid' }
  if (key.includes('..')) return { ok: false, reasonCode: 'storage-key-invalid' }
  if (utf8ByteLength(key) > PLUGIN_STORAGE_LIMITS.maxKeyBytes) {
    return { ok: false, reasonCode: 'storage-key-invalid' }
  }
  return { ok: true, key }
}

/** 文档内禁止出现的危险键名（原型污染与保留命名空间，精确小写匹配）。 */
export const PLUGIN_STORAGE_FORBIDDEN_KEYS = ['__proto__', 'prototype', 'constructor'] as const

/** 敏感键模式（小写包含匹配；存储不是 secret vault）。 */
export const PLUGIN_STORAGE_SENSITIVE_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'credential',
  'private_key',
  'private-key',
  'client_secret',
] as const

/** 敏感值模式（凭据样式的字符串值）。 */
export const PLUGIN_STORAGE_SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
]

/**
 * 规范化并校验 value 为 canonical JSON document：
 * - 顶层必须是普通对象（document 语义，D2）；
 * - 深度 ≤ maxDepth、字段总数 ≤ maxFields、canonical 序列化字节 ≤ maxValueBytes；
 * - 禁止 `__proto__`/`prototype`/`constructor` 键；
 * - 键名命中敏感模式或字符串值命中凭据样式 → blocking finding（存储不是 secret vault）。
 *
 * 返回 canonical 序列化文本与字节数；任何 blocking 直接拒绝，不做静默裁剪。
 */
export function validateStorageValueDocument(value: unknown): {
  ok: boolean
  canonicalJson?: string
  byteSize?: number
  findings: readonly PluginStorageFinding[]
} {
  const findings: PluginStorageFinding[] = []
  const push = (code: PluginStorageErrorCode, fieldPath?: string) =>
    findings.push({ code, severity: 'blocking', ...(fieldPath ? { fieldPath } : {}) })

  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    push('storage-value-invalid', 'value')
    return { ok: false, findings }
  }

  let fieldCount = 0
  const visit = (node: unknown, depth: number, path: string): boolean => {
    if (depth > PLUGIN_STORAGE_LIMITS.maxDepth) {
      push('storage-value-invalid', path)
      return false
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string') {
        for (const pattern of PLUGIN_STORAGE_SENSITIVE_VALUE_PATTERNS) {
          if (pattern.test(node)) {
            push('storage-secret-like-content', path)
            return false
          }
        }
      }
      return true
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        fieldCount += 1
        if (fieldCount > PLUGIN_STORAGE_LIMITS.maxFields) {
          push('storage-value-invalid', `${path}[${i}]`)
          return false
        }
        if (!visit(node[i], depth + 1, `${path}[${i}]`)) return false
      }
      return true
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const lower = k.toLowerCase()
      if ((PLUGIN_STORAGE_FORBIDDEN_KEYS as readonly string[]).includes(lower)) {
        push('storage-value-invalid', `${path}.${k}`)
        return false
      }
      if (
        (PLUGIN_STORAGE_SENSITIVE_KEY_PATTERNS as readonly string[]).some((p) => lower.includes(p))
      ) {
        push('storage-secret-like-content', `${path}.${k}`)
        return false
      }
      fieldCount += 1
      if (fieldCount > PLUGIN_STORAGE_LIMITS.maxFields) {
        push('storage-value-invalid', `${path}.${k}`)
        return false
      }
      if (!visit(v, depth + 1, `${path}.${k}`)) return false
    }
    return true
  }

  if (!visit(value, 1, 'value')) return { ok: false, findings }

  const canonicalJson = storageStableSerialize(value)
  const byteSize = utf8ByteLength(canonicalJson)
  if (byteSize > PLUGIN_STORAGE_LIMITS.maxValueBytes) {
    push('storage-value-too-large', 'value')
    return { ok: false, findings }
  }
  return { ok: true, canonicalJson, byteSize, findings }
}

/**
 * 对任意待外发/落账负载做二次低敏扫描（fail closed 输入）：
 * - 路径键名命中敏感模式（如 `{ apiToken: ... }`）→ 违规；
 * - 字符串值命中凭据样式（sk_xxx / Bearer xxx / ghp_xxx）→ 违规；
 * - 字符串值为标识符样式且含敏感词（如存储条目 key 名 `api_token`，导出记录中是数据）→ 违规。
 * 返回命中数量与有界 fieldPath 列表（≤20），供导出/审计前置校验。
 */
export function storageSecondaryScan(payload: unknown): {
  violations: number
  fieldPaths: readonly string[]
} {
  const fieldPaths: string[] = []
  let violations = 0
  const identifierLike = /^[A-Za-z0-9._\-]{1,200}$/
  const record = (path: string) => {
    violations += 1
    if (fieldPaths.length < 20) fieldPaths.push(path)
  }
  const visit = (node: unknown, depth: number, path: string): void => {
    if (depth > PLUGIN_STORAGE_LIMITS.maxDepth + 2) return
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string' && node.length > 0) {
        const lastSegment = path.split('.').pop() ?? ''
        const pathHit = (PLUGIN_STORAGE_SENSITIVE_KEY_PATTERNS as readonly string[]).some((p) =>
          lastSegment.toLowerCase().includes(p),
        )
        const nameHit =
          identifierLike.test(node) &&
          (PLUGIN_STORAGE_SENSITIVE_KEY_PATTERNS as readonly string[]).some((p) =>
            node.toLowerCase().includes(p),
          )
        const valueHit = PLUGIN_STORAGE_SENSITIVE_VALUE_PATTERNS.some((r) => r.test(node))
        if (pathHit || nameHit || valueHit) record(path)
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, depth + 1, `${path}[${i}]`))
      return
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      visit(v, depth + 1, `${path}.${k}`)
    }
  }
  visit(payload, 0, 'payload')
  return { violations, fieldPaths }
}

// =============================================================================
// 4. 确定性序列化 / digest / revision
// =============================================================================

/** 确定性稳定 JSON 序列化（键排序递归；与仓库其他契约模块同构）。 */
export function storageStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => storageStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + storageStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/** 确定性 FNV-1a 32-bit 哈希。 */
export function fnv1a32Storage(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 域分离 digest：对 parts 顺序敏感。 */
export function computeStorageDigest(parts: readonly string[]): string {
  return fnv1a32Storage(`plugin-scoped-storage\x1f${parts.join('\x1e')}`)
}

/** entry 内容 digest（canonical JSON 域分离）。 */
export function computeEntryContentDigest(canonicalJson: string): string {
  return computeStorageDigest(['entry', canonicalJson])
}

/**
 * revision CAS 判定：
 * - expectedRevision 为 undefined/null：仅允许新建（current 必须为 null）；
 * - 否则必须严格等于 current。
 */
export function evaluateRevisionCas(
  current: number | null,
  expectedRevision: number | undefined | null,
): { ok: true } | { ok: false; reasonCode: PluginStorageErrorCode } {
  if (expectedRevision === undefined || expectedRevision === null) {
    if (current !== null) return { ok: false, reasonCode: 'storage-revision-conflict' }
    return { ok: true }
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return { ok: false, reasonCode: 'storage-revision-conflict' }
  }
  if (current === null || current !== expectedRevision) {
    return { ok: false, reasonCode: 'storage-revision-conflict' }
  }
  return { ok: true }
}

// =============================================================================
// 5. 配额评估（纯函数；事务内 delta 由服务层套用）
// =============================================================================

/**
 * 三层配额评估：namespace / project / organization。
 * 任一层超限 → ok=false 且给出对应层与原因码；≥80% 产出 warning finding。
 */
export function evaluateStorageQuota(input: {
  namespace: PluginStorageQuotaSnapshot
  project: PluginStorageQuotaSnapshot | null
  organization: PluginStorageQuotaSnapshot
  deltaBytes: number
  deltaEntries: number
}): PluginStorageQuotaVerdict {
  const warnings: PluginStorageFinding[] = []
  const layers: ReadonlyArray<{
    layer: 'organization' | 'project' | 'namespace'
    snap: PluginStorageQuotaSnapshot
    bytesCode: PluginStorageErrorCode
    entriesCode: PluginStorageErrorCode
  }> = [
    {
      layer: 'namespace',
      snap: input.namespace,
      bytesCode: 'storage-quota-exceeded',
      entriesCode: 'storage-entry-limit-reached',
    },
    ...(input.project
      ? [
          {
            layer: 'project' as const,
            snap: input.project,
            bytesCode: 'storage-quota-project-exceeded' as PluginStorageErrorCode,
            entriesCode: 'storage-entry-limit-reached' as PluginStorageErrorCode,
          },
        ]
      : []),
    {
      layer: 'organization',
      snap: input.organization,
      bytesCode: 'storage-quota-org-exceeded',
      entriesCode: 'storage-entry-limit-reached',
    },
  ]

  for (const { layer, snap, bytesCode, entriesCode } of layers) {
    const nextBytes = snap.usedBytes + input.deltaBytes
    const nextEntries = snap.usedEntries + input.deltaEntries
    if (nextBytes > snap.quotaBytes) {
      return { ok: false, exceeded: layer, reasonCode: bytesCode, warnings }
    }
    if (nextEntries > snap.quotaEntries) {
      return { ok: false, exceeded: layer, reasonCode: entriesCode, warnings }
    }
    if (
      snap.quotaBytes > 0 &&
      nextBytes >= snap.quotaBytes * PLUGIN_STORAGE_QUOTA_WARN_RATIO &&
      nextBytes < snap.quotaBytes
    ) {
      warnings.push({ code: bytesCode, severity: 'warning', fieldPath: `quota.${layer}.bytes` })
    }
  }
  return { ok: true, warnings }
}

// =============================================================================
// 6. 清理句柄构造与校验（纯部分；一次性消费由服务层保证）
// =============================================================================

/** 清理句柄载荷（句柄本体为其 stable 序列化的 base64url；digest 单独绑定）。 */
export interface PluginStorageCleanupHandlePayload {
  namespaceId: number
  organizationId: number
  pluginId: string
  /** 预览时 namespace 行 revision。 */
  namespaceRevision: number
  /** 预览时条目聚合 digest（key+revision+contentDigest 有序拼接）。 */
  entriesDigest: string
  nonce: string
  issuedAt: string
  expiresAt: string
}

/** base64url 编码（UTF-8 安全，零 Buffer 依赖以便浏览器端测试复用）。 */
export function storageBase64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url 解码。 */
export function storageBase64UrlDecode(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 构造清理句柄（纯函数；时间由调用方注入）。 */
export function buildStorageCleanupHandle(payload: PluginStorageCleanupHandlePayload): {
  handle: string
  digest: string
} {
  const canonical = storageStableSerialize(payload)
  return {
    handle: storageBase64UrlEncode(canonical),
    digest: computeStorageDigest(['cleanup', canonical]),
  }
}

/** 解析并校验清理句柄。校验顺序固定：可解析对象 → digest 绑定 → 封闭形状 → 过期；
 * 篡改/扩展字段的载荷统一落 binding-mismatch，缺失字段才报 handle-invalid。 */
export function verifyStorageCleanupHandle(input: {
  handle: string
  expectedDigest: string
  referenceTime: string
}):
  | { ok: true; payload: PluginStorageCleanupHandlePayload }
  | { ok: false; reasonCode: PluginStorageErrorCode } {
  let parsed: unknown
  try {
    parsed = JSON.parse(storageBase64UrlDecode(input.handle))
  } catch {
    return { ok: false, reasonCode: 'storage-cleanup-handle-invalid' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reasonCode: 'storage-cleanup-handle-invalid' }
  }
  // 1) digest 绑定优先：任何字段增删改都会改变 canonical 序列化 → binding-mismatch。
  const obj = parsed as Record<string, unknown>
  const recomputed = computeStorageDigest(['cleanup', storageStableSerialize(obj)])
  if (recomputed !== input.expectedDigest) {
    return { ok: false, reasonCode: 'storage-cleanup-binding-mismatch' }
  }
  // 2) 封闭形状：必需字段齐全且不得有未知字段。
  const required: ReadonlyArray<keyof PluginStorageCleanupHandlePayload> = [
    'namespaceId',
    'organizationId',
    'pluginId',
    'namespaceRevision',
    'entriesDigest',
    'nonce',
    'issuedAt',
    'expiresAt',
  ]
  for (const field of required) {
    if (!(field in obj)) return { ok: false, reasonCode: 'storage-cleanup-handle-invalid' }
  }
  if (Object.keys(obj).length !== required.length) {
    return { ok: false, reasonCode: 'storage-cleanup-binding-mismatch' }
  }
  const payload = parsed as PluginStorageCleanupHandlePayload
  // 3) 过期检查（时间由调用方注入）。
  if (new Date(payload.expiresAt).getTime() <= new Date(input.referenceTime).getTime()) {
    return { ok: false, reasonCode: 'storage-cleanup-handle-expired' }
  }
  return { ok: true, payload }
}

// =============================================================================
// 7. 分页归一化与类型守卫
// =============================================================================

/** 有界分页归一化；非法输入返回固定错误（调用方转 400）。 */
export function normalizeStoragePagination(
  page?: number | string | null,
  perPage?: number | string | null,
): { ok: true; page: number; perPage: number } | { ok: false; reasonCode: PluginStorageErrorCode } {
  const p = typeof page === 'string' ? Number(page) : page
  const pp = typeof perPage === 'string' ? Number(perPage) : perPage
  const safePage = p ?? 1
  const safePerPage = pp ?? PLUGIN_STORAGE_LIMITS.listPageSize
  if (!Number.isInteger(safePage) || safePage < 1 || safePage > 10000) {
    return { ok: false, reasonCode: 'storage-pagination-invalid' }
  }
  if (
    !Number.isInteger(safePerPage) ||
    safePerPage < 1 ||
    safePerPage > PLUGIN_STORAGE_LIMITS.maxListPageSize
  ) {
    return { ok: false, reasonCode: 'storage-pagination-invalid' }
  }
  return { ok: true, page: safePage, perPage: safePerPage }
}

export function isPluginStorageScope(v: unknown): v is PluginStorageScope {
  return typeof v === 'string' && (PLUGIN_STORAGE_SCOPES as readonly string[]).includes(v)
}

export function isPluginStorageErrorCode(v: unknown): v is PluginStorageErrorCode {
  return typeof v === 'string' && (PLUGIN_STORAGE_ERROR_CODES as readonly string[]).includes(v)
}

export function isPluginStorageNamespaceStatus(v: unknown): v is PluginStorageNamespaceStatus {
  return (
    typeof v === 'string' && (PLUGIN_STORAGE_NAMESPACE_STATUSES as readonly string[]).includes(v)
  )
}
