/**
 * v3-enterprise-audit-enhancement — 企业级审计增强共享契约（前后端共享）。
 *
 * 在既有 `audit-log` 只写不删语义之上，新增低敏证据包、完整性校验、
 * 保留策略摘要、异常摘要与预览/确认导出流程。
 *
 * 设计原则：
 * - 全部纯函数，零运行时依赖。
 * - 禁止键检测 fail closed：未经显式允许的 metadata 字段名不被泄露。
 * - 所有 hash/签名使用稳定 FNV-1a 变体，确保跨运行时确定性。
 * - 所有 warning 聚合按 severity 排序，确保 UI 一致性。
 */

// ─── 枚举 ──────────────────────────────────────────────────────────────────────

/** 企业审计权限 action */
export type EnterpriseAuditAction =
  | 'preview'
  | 'confirm'
  | 'download_attempt'
  | 'verify'
  | 'retention_read'
  | 'anomaly_read'
  | 'stale_block'
  | 'evidence_failure'
  | 'permission_denied'

/** 企业审计 RBAC 权限点 */
export type EnterpriseAuditPermission =
  | 'audit:enterprise:view'
  | 'audit:enterprise:export'
  | 'audit:enterprise:verify'
  | 'audit:enterprise:manage_retention'

/** 证据包状态 */
export type EvidencePackageStatus = 'pending' | 'confirmed' | 'expired' | 'stale' | 'failed'

/** 校验状态 */
export type VerificationStatus = 'passed' | 'warning' | 'failed' | 'stale' | 'error'

/** 异常类别 */
export type AnomalyCategory =
  | 'permission_denied_burst'
  | 'login_failure_burst'
  | 'critical_error_spike'
  | 'export_config_event'
  | 'stale_confirm_attempt'
  | 'evidence_failure'
  | 'integrity_warning'
  | 'unknown'

/** 脱敏 warning code */
export type RedactionWarningCode =
  | 'REDACTED_SENSITIVE_FIELD'
  | 'REDACTED_UNKNOWN_PAYLOAD'
  | 'REDACTED_NESTED_SECRET'
  | 'REDACTED_OVERSIZED_VALUE'

/** stale-source code */
export type StaleSourceCode =
  'STALE_SOURCE_SIGNATURE' | 'STALE_PERMISSION_CHANGED' | 'STALE_SOURCE_DELETED'

/** 证据包 warning code */
export type EvidenceWarningCode =
  | 'LARGE_RESULT_SET'
  | 'BOUNDED_TIME_RANGE'
  | 'MISSING_CONTEXT'
  | 'TRUNCATED_RECORDS'
  | 'REDACTED_CONTENT'
  | 'STALE_SOURCE'

/** 校验 warning code */
export type VerificationWarningCode =
  | 'MISSING_REQUEST_CONTEXT'
  | 'SEQUENCE_GAP'
  | 'CHECKSUM_MISMATCH'
  | 'REDACTION_VIOLATION'
  | 'STALE_EVIDENCE_PACKAGE'
  | 'INCOMPLETE_RANGE'

/** 保留 warning code */
export type RetentionWarningCode =
  | 'NO_RETENTION_POLICY_CONFIGURED'
  | 'FREEZE_ACTIVE'
  | 'APPROACHING_RETENTION_LIMIT'
  | 'RETENTION_EXCEEDED'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

export const ENTERPRISE_AUDIT_ACTIONS: readonly EnterpriseAuditAction[] = [
  'preview',
  'confirm',
  'download_attempt',
  'verify',
  'retention_read',
  'anomaly_read',
  'stale_block',
  'evidence_failure',
  'permission_denied',
] as const

export const ENTERPRISE_AUDIT_PERMISSIONS: readonly EnterpriseAuditPermission[] = [
  'audit:enterprise:view',
  'audit:enterprise:export',
  'audit:enterprise:verify',
  'audit:enterprise:manage_retention',
] as const

export const EVIDENCE_PACKAGE_STATUSES: readonly EvidencePackageStatus[] = [
  'pending',
  'confirmed',
  'expired',
  'stale',
  'failed',
] as const

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'passed',
  'warning',
  'failed',
  'stale',
  'error',
] as const

export const ANOMALY_CATEGORIES: readonly AnomalyCategory[] = [
  'permission_denied_burst',
  'login_failure_burst',
  'critical_error_spike',
  'export_config_event',
  'stale_confirm_attempt',
  'evidence_failure',
  'integrity_warning',
  'unknown',
] as const

export const REDACTION_WARNING_CODES: readonly RedactionWarningCode[] = [
  'REDACTED_SENSITIVE_FIELD',
  'REDACTED_UNKNOWN_PAYLOAD',
  'REDACTED_NESTED_SECRET',
  'REDACTED_OVERSIZED_VALUE',
] as const

export const STALE_SOURCE_CODES: readonly StaleSourceCode[] = [
  'STALE_SOURCE_SIGNATURE',
  'STALE_PERMISSION_CHANGED',
  'STALE_SOURCE_DELETED',
] as const

export const EVIDENCE_WARNING_CODES: readonly EvidenceWarningCode[] = [
  'LARGE_RESULT_SET',
  'BOUNDED_TIME_RANGE',
  'MISSING_CONTEXT',
  'TRUNCATED_RECORDS',
  'REDACTED_CONTENT',
  'STALE_SOURCE',
] as const

export const VERIFICATION_WARNING_CODES: readonly VerificationWarningCode[] = [
  'MISSING_REQUEST_CONTEXT',
  'SEQUENCE_GAP',
  'CHECKSUM_MISMATCH',
  'REDACTION_VIOLATION',
  'STALE_EVIDENCE_PACKAGE',
  'INCOMPLETE_RANGE',
] as const

export const RETENTION_WARNING_CODES: readonly RetentionWarningCode[] = [
  'NO_RETENTION_POLICY_CONFIGURED',
  'FREEZE_ACTIVE',
  'APPROACHING_RETENTION_LIMIT',
  'RETENTION_EXCEEDED',
] as const

/** 证据包行数上限 */
export const EVIDENCE_PACKAGE_MAX_ROWS = 10_000

/** 证据包时间范围上限（天） */
export const EVIDENCE_PACKAGE_MAX_DAYS = 365

/** 预览缓存有效期（秒）——预览签名在此窗口内可确认 */
export const PREVIEW_SIGNATURE_TTL_SECONDS = 300

/** 禁止键集合（大小写不敏感检测，这些键的原始值绝不进入证据包） */
export const FORBIDDEN_KEYS: readonly string[] = [
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
  'modelOutput',
  'model_output',
  'webhookBody',
  'webhook_body',
]

// ─── 类型守卫 ──────────────────────────────────────────────────────────────────

export function isEnterpriseAuditAction(v: unknown): v is EnterpriseAuditAction {
  return ENTERPRISE_AUDIT_ACTIONS.includes(v as EnterpriseAuditAction)
}

export function isEnterpriseAuditPermission(v: unknown): v is EnterpriseAuditPermission {
  return ENTERPRISE_AUDIT_PERMISSIONS.includes(v as EnterpriseAuditPermission)
}

export function isEvidencePackageStatus(v: unknown): v is EvidencePackageStatus {
  return EVIDENCE_PACKAGE_STATUSES.includes(v as EvidencePackageStatus)
}

export function isVerificationStatus(v: unknown): v is VerificationStatus {
  return VERIFICATION_STATUSES.includes(v as VerificationStatus)
}

export function isAnomalyCategory(v: unknown): v is AnomalyCategory {
  return ANOMALY_CATEGORIES.includes(v as AnomalyCategory)
}

export function isRedactionWarningCode(v: unknown): v is RedactionWarningCode {
  return REDACTION_WARNING_CODES.includes(v as RedactionWarningCode)
}

export function isStaleSourceCode(v: unknown): v is StaleSourceCode {
  return STALE_SOURCE_CODES.includes(v as StaleSourceCode)
}

export function isEvidenceWarningCode(v: unknown): v is EvidenceWarningCode {
  return EVIDENCE_WARNING_CODES.includes(v as EvidenceWarningCode)
}

export function isVerificationWarningCode(v: unknown): v is VerificationWarningCode {
  return VERIFICATION_WARNING_CODES.includes(v as VerificationWarningCode)
}

export function isRetentionWarningCode(v: unknown): v is RetentionWarningCode {
  return RETENTION_WARNING_CODES.includes(v as RetentionWarningCode)
}

// ─── 纯函数 ────────────────────────────────────────────────────────────────────

/**
 * 稳定 FNV-1a hash（纯 JS 实现，确保跨运行时确定性）。
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // 转无符号 hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 稳定输入签名：对输入对象按 key 排序后 JSON 序列化，再取 hash。
 * 确保相同内容无论键顺序、多余空白都产生相同签名。
 */
export function computeStableSignature(input: Record<string, unknown>): string {
  const sorted = Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = input[key]
      return acc
    }, {})
  return fnv1aHash(JSON.stringify(sorted))
}

/**
 * 计算审计行摘要 hash（不含敏感字段）。
 * 取 id + createdAt + action + event + severity 的稳定签名。
 */
export function computeRecordDigest(record: {
  id: number
  createdAt: string
  action: string
  event: string | null
  severity: string
}): string {
  return computeStableSignature({
    id: record.id,
    createdAt: normalizeTimestamp(record.createdAt),
    action: record.action,
    event: record.event ?? '',
    severity: record.severity,
  })
}

/**
 * 摘要的摘要(digest)：对一组记录摘要 hash 再取 hash。
 */
export function computeDigestOfDigests(digests: string[]): string {
  const sorted = [...digests].sort()
  return fnv1aHash(sorted.join(''))
}

/**
 * 归一化时间戳：统一为 ISO 日期，去除毫秒/时区差异。
 */
export function normalizeTimestamp(ts: string): string {
  // 取前 19 字符（YYYY-MM-DDTHH:mm:ss），忽略毫秒与时区
  return ts.slice(0, 19)
}

/**
 * 对审计行变化/元数据中的禁止键做检测，返回匹配的禁止键名列表。
 * 递归扫描嵌套对象。
 */
export function detectForbiddenKeys(value: unknown, depth = 0): string[] {
  if (depth > 10 || typeof value !== 'object' || value === null) return []

  const found: string[] = []

  if (Array.isArray(value)) {
    for (const item of value) {
      found.push(...detectForbiddenKeys(item, depth + 1))
    }
    return found
  }

  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase()
    const isForbidden = FORBIDDEN_KEYS.some((fk) => lowerKey.includes(fk.toLowerCase()))
    if (isForbidden) {
      found.push(key)
    }
    found.push(...detectForbiddenKeys(obj[key], depth + 1))
  }

  return [...new Set(found)]
}

/**
 * warning 聚合：按 severity 排序，确保 UI 一致性。
 * severity 权重：critical=4, error=3, warning=2, info=1, 其余=0。
 */
export function sortWarningsBySeverity<T extends { severity?: string }>(warnings: T[]): T[] {
  const weight: Record<string, number> = {
    critical: 4,
    error: 3,
    warning: 2,
    info: 1,
  }
  return [...warnings].sort(
    (a, b) => (weight[b.severity ?? ''] ?? 0) - (weight[a.severity ?? ''] ?? 0),
  )
}

/**
 * 归一化保留策略：返回标准化策略对象。
 */
export function normalizeRetentionPolicy(policy: {
  maxDays?: number
  freezeUntil?: string | null
  description?: string
}): {
  maxDays: number
  freezeUntil: string | null
  description: string
  warnings: Array<{ code: RetentionWarningCode; message: string }>
} {
  const warnings: Array<{ code: RetentionWarningCode; message: string }> = []
  const maxDays = policy.maxDays ?? 365
  const freezeUntil = policy.freezeUntil ?? null
  const description = policy.description ?? ''

  if (!policy.maxDays) {
    warnings.push({
      code: 'NO_RETENTION_POLICY_CONFIGURED',
      message: '未配置保留策略，使用默认值 365 天',
    })
  }

  return { maxDays, freezeUntil, description, warnings }
}

/**
 * 聚合 warning：按 code 去重，保留最高 severity。
 */
export function aggregateWarnings<T extends { code: string; severity?: string }>(
  warnings: T[],
): T[] {
  const map = new Map<string, T>()
  const weight: Record<string, number> = {
    critical: 4,
    error: 3,
    warning: 2,
    info: 1,
  }
  for (const w of warnings) {
    const existing = map.get(w.code)
    if (!existing) {
      map.set(w.code, w)
    } else {
      const existingWeight = weight[existing.severity ?? ''] ?? 0
      const newWeight = weight[w.severity ?? ''] ?? 0
      if (newWeight > existingWeight) {
        map.set(w.code, w)
      }
    }
  }
  return sortWarningsBySeverity([...map.values()])
}

// ─── DTO 类型 ──────────────────────────────────────────────────────────────────

/** 按角色界定范围的过滤条件 */
export interface EnterpriseAuditScopeFilter {
  organizationId?: number | null
  projectId?: number | null
  dateFrom?: string | null
  dateTo?: string | null
  event?: string | null
  action?: string[] | null
  severity?: string[] | null
  cursor?: number | null
  perPage?: number | null
}

/** scope DTO（描述审计范围） */
export interface EnterpriseAuditScope {
  organizationId: number | null
  projectId: number | null
  dateFrom: string
  dateTo: string
  filterHash: string
}

/** 证据包预览 */
export interface EvidencePackagePreview {
  scope: EnterpriseAuditScope
  estimatedRowCount: number
  sourceSignature: string
  packageHash: string
  warnings: Array<{ code: EvidenceWarningCode; message: string; severity: string }>
  requiresConfirmation: true
  redactedDigests: string[]
}

/** 证据包 ledger 条目 */
export interface EvidencePackageLedgerEntry {
  id: number
  organizationId: number | null
  actorId: number
  scope: EnterpriseAuditScope
  filterSummaryJson: string
  sourceSignature: string
  packageHash: string
  status: EvidencePackageStatus
  rowCount: number
  warningSummaryJson: string | null
  fileRef: string | null
  expiresAt: string | null
  createdAt: string
  confirmedAt: string | null
}

/** 证据包 manifest（低敏） */
export interface EvidencePackageManifest {
  packageId: number
  scope: EnterpriseAuditScope
  rowCount: number
  actionDistribution: Record<string, number>
  severityDistribution: Record<string, number>
  recordDigests: string[]
  digestOfDigests: string
  warnings: Array<{ code: EvidenceWarningCode; message: string; severity: string }>
  generatedBy: { userId: number }
  generatedAt: string
}

/** 校验结果 */
export interface VerificationResult {
  id: number
  organizationId: number | null
  scope: EnterpriseAuditScope | null
  evidencePackageId: number | null
  digest: string
  status: VerificationStatus
  verifiedRowCount: number
  warnings: Array<{
    code: VerificationWarningCode
    message: string
    severity: string
    affectedRef?: string
  }>
  createdAt: string
}

/** 保留摘要 */
export interface RetentionSummary {
  policy: {
    maxDays: number
    freezeUntil: string | null
    description: string
  }
  eligibleRange: { dateFrom: string; dateTo: string }
  warnings: Array<{ code: RetentionWarningCode; message: string; severity: string }>
  nextReviewDate: string | null
}

/** 异常摘要项 */
export interface AnomalySummaryItem {
  category: AnomalyCategory
  count: number
  severity: string
  timeBucket: string
  evidenceRefs: Array<{ auditLogId: number; event: string; occurredAt: string }>
}

/** 异常摘要 */
export interface AnomalySummary {
  items: AnomalySummaryItem[]
  totalCount: number
  scopedDateFrom: string
  scopedDateTo: string
}

/** 企业审计概览 */
export interface EnterpriseAuditOverview {
  totalLogs: number
  scopedDateFrom: string
  scopedDateTo: string
  evidencePackageCount: number
  verificationCount: number
  recentAnomalies: number
}

/** 确认请求 */
export interface ConfirmEvidencePackageRequest {
  sourceSignature: string
  packageHash: string
  scope: EnterpriseAuditScopeFilter
}

/** 校验请求 */
export interface VerifyAuditRequest {
  scope?: EnterpriseAuditScopeFilter
  evidencePackageId?: number
}

// ─── 事件/action 映射 ──────────────────────────────────────────────────────────

/** 企业审计 action → EVENT_TO_ACTION 映射值 */
export const ENTERPRISE_EVENT_TO_ACTION: Record<string, string> = {
  ENTERPRISE_AUDIT_PREVIEW: 'read',
  ENTERPRISE_AUDIT_CONFIRM: 'create',
  ENTERPRISE_AUDIT_DOWNLOAD_ATTEMPT: 'read',
  ENTERPRISE_AUDIT_VERIFY: 'read',
  ENTERPRISE_AUDIT_RETENTION_READ: 'read',
  ENTERPRISE_AUDIT_ANOMALY_READ: 'read',
  ENTERPRISE_AUDIT_STALE_BLOCK: 'reject',
  ENTERPRISE_AUDIT_EVIDENCE_FAILURE: 'update',
  ENTERPRISE_AUDIT_PERMISSION_DENIED: 'reject',
}

// ─── 企业审计事件名 ────────────────────────────────────────────────────────────

export const ENTERPRISE_AUDIT_EVENTS = {
  ENTERPRISE_AUDIT_PREVIEW: 'ENTERPRISE_AUDIT_PREVIEW',
  ENTERPRISE_AUDIT_CONFIRM: 'ENTERPRISE_AUDIT_CONFIRM',
  ENTERPRISE_AUDIT_DOWNLOAD_ATTEMPT: 'ENTERPRISE_AUDIT_DOWNLOAD_ATTEMPT',
  ENTERPRISE_AUDIT_VERIFY: 'ENTERPRISE_AUDIT_VERIFY',
  ENTERPRISE_AUDIT_RETENTION_READ: 'ENTERPRISE_AUDIT_RETENTION_READ',
  ENTERPRISE_AUDIT_ANOMALY_READ: 'ENTERPRISE_AUDIT_ANOMALY_READ',
  ENTERPRISE_AUDIT_STALE_BLOCK: 'ENTERPRISE_AUDIT_STALE_BLOCK',
  ENTERPRISE_AUDIT_EVIDENCE_FAILURE: 'ENTERPRISE_AUDIT_EVIDENCE_FAILURE',
  ENTERPRISE_AUDIT_PERMISSION_DENIED: 'ENTERPRISE_AUDIT_PERMISSION_DENIED',
} as const

// ─── 证据包格式化 helper ──────────────────────────────────────────────────────

/**
 * 将证据包记录摘要列表格式化为 CSV 字符串。
 * 每条记录含：id, action, event, severity, createdAt。
 */
export function formatEvidencePackageAsCSV(
  records: Array<{
    id: number
    action: string
    event: string | null
    severity: string
    createdAt: string
  }>,
): string {
  const header = 'id,action,event,severity,created_at'
  const rows = records.map((r) => {
    const event = (r.event ?? '').replace(/"/g, '""')
    return `${r.id},${r.action},"${event}",${r.severity},${r.createdAt}`
  })
  return [header, ...rows].join('\n')
}

/**
 * 将证据包记录摘要列表格式化为 JSONL 字符串。
 * 每条记录一行 JSON。
 */
export function formatEvidencePackageAsJSONL(records: Array<Record<string, unknown>>): string {
  return records.map((r) => JSON.stringify(r)).join('\n')
}

/**
 * 将证据包 manifest 格式化为 CSV 摘要行。
 */
export function formatManifestAsCSV(manifest: EvidencePackageManifest): string {
  const header = 'package_id,row_count,digest_of_digests,generated_at'
  const row = `${manifest.packageId},${manifest.rowCount},${manifest.digestOfDigests},${manifest.generatedAt}`
  return [header, row].join('\n')
}

/**
 * 将证据包 manifest 格式化为 JSONL 摘要行。
 */
export function formatManifestAsJSONL(manifest: EvidencePackageManifest): string {
  return JSON.stringify({
    packageId: manifest.packageId,
    rowCount: manifest.rowCount,
    digestOfDigests: manifest.digestOfDigests,
    actionDistribution: manifest.actionDistribution,
    severityDistribution: manifest.severityDistribution,
    generatedAt: manifest.generatedAt,
  })
}
