// @aiproj/types — 企业合规准备度：共享契约、确定性评估器、脱敏与稳定 hash helpers。
// 纯函数，零运行时外部依赖，前后端共享。
//
// 本能力是组织级 evidence orchestration layer：把审计、RBAC、DLP、KMS、水印、OCR、
// AI、文件、报表等邻域能力的状态投影成低敏 evidence refs，再按 profile/control 计算
// 准备度状态（ready/partial/missing/not_applicable/blocked），并可生成需要显式确认的
// 低敏 evidence package。
//
// 重要：本模块绝不宣称满足真实认证（SOC2 / ISO27001 / 等保 / GDPR 等）。所有 UI、API、
// 导出包与审计都必须携带 notCertification / requires_external_review 类 warning。
//
// 命名约定：为避免与 enterprise-dlp-engine / enterprise-encryption-helpers /
// enterprise-audit-enhancement 已导出的 fnv1aHash / computeStableSignature 在 barrel
// export 时冲突，本模块的通用 hash 统一使用 cr* 前缀命名；index.ts 使用显式 named export。

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/** 控制项准备度状态 */
export const COMPLIANCE_READINESS_STATES = [
  'ready',
  'partial',
  'missing',
  'not_applicable',
  'blocked',
] as const
export type ComplianceReadinessState =
  'ready' | 'partial' | 'missing' | 'not_applicable' | 'blocked'

/** 证据引用状态 */
export const COMPLIANCE_EVIDENCE_STATUSES = ['fresh', 'stale', 'missing', 'degraded'] as const
export type ComplianceEvidenceStatus = 'fresh' | 'stale' | 'missing' | 'degraded'

/** 邻域能力 provider health */
export const COMPLIANCE_PROVIDER_HEALTH = ['live', 'fixture', 'missing', 'degraded'] as const
export type ComplianceProviderHealth = 'live' | 'fixture' | 'missing' | 'degraded'

/** profile 状态 */
export const COMPLIANCE_PROFILE_STATUSES = ['active', 'archived'] as const
export type ComplianceProfileStatus = 'active' | 'archived'

/** control maturity */
export const COMPLIANCE_MATURITY_LEVELS = ['ad_hoc', 'defined', 'managed', 'measured'] as const
export type ComplianceMaturityLevel = 'ad_hoc' | 'defined' | 'managed' | 'measured'

/** control risk level */
export const COMPLIANCE_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type ComplianceRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** control applicability */
export const COMPLIANCE_APPLICABILITY = ['applicable', 'not_applicable', 'conditional'] as const
export type ComplianceApplicability = 'applicable' | 'not_applicable' | 'conditional'

/** 例外状态 */
export const COMPLIANCE_EXCEPTION_STATUSES = ['open', 'closed', 'expired'] as const
export type ComplianceExceptionStatus = 'open' | 'closed' | 'expired'

/** package ledger 状态 */
export const COMPLIANCE_PACKAGE_STATUSES = ['preview', 'confirmed', 'exported'] as const
export type CompliancePackageStatus = 'preview' | 'confirmed' | 'exported'

/**
 * 合规准备度 warning code。
 * 覆盖缺口、过期、授权门、scope 冲突、邻域降级、非认证声明等。
 */
export const COMPLIANCE_WARNING_CODES = [
  // 证据与缺口
  'no_required_evidence',
  'insufficient_evidence',
  'stale_evidence',
  'expired_evidence',
  'missing_evidence_type',
  // 邻域降级 / 依赖
  'neighbor_provider_degraded',
  'neighbor_provider_missing',
  'dlp_unavailable',
  'kms_unavailable',
  'watermark_unavailable',
  'gated_dependency',
  // 例外 / 人工复核
  'exception_open',
  'exception_expired',
  'manual_review_required',
  'requires_external_review',
  // 范围与签名
  'scope_conflict',
  'stale_source_signature',
  'source_signature_mismatch',
  'oversized_scope',
  'oversized_control_count',
  'provider_timeout',
  'provider_partial_failure',
  'preview_ttl_expired',
  // 非认证声明
  'not_certification',
] as const
export type ComplianceWarningCode = (typeof COMPLIANCE_WARNING_CODES)[number]

/**
 * 禁止键集合。这些键的原始值绝不进入 compliance evidence refs、package 或 audit metadata。
 * 覆盖 spec 明确列出的 prompt / modelOutput / token / Authorization / apiKey / secret /
 * password / rawBody / fileBody / absolutePath 及邻域常见禁止项。
 */
export const COMPLIANCE_FORBIDDEN_KEYS: readonly string[] = [
  'prompt',
  'modelOutput',
  'model_output',
  'token',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'authorization',
  'apiKey',
  'api_key',
  'secret',
  'client_secret',
  'password',
  'passwordHash',
  'password_hash',
  'rawBody',
  'raw_body',
  'webhookBody',
  'webhook_body',
  'fileBody',
  'file_body',
  'absolutePath',
  'absolute_path',
] as const

/** preview TTL（秒）——预览签名默认有效期 5 分钟 */
export const COMPLIANCE_PREVIEW_TTL_SECONDS = 300

/** 单次 preview/export 最大控制项数 */
export const COMPLIANCE_MAX_CONTROL_COUNT = 200

/** 单次 evidence filter 最大时间窗（天） */
export const COMPLIANCE_MAX_TIME_WINDOW_DAYS = 90

/** 无涉密 review 复核的最大 review history 条目 */
export const COMPLIANCE_MAX_REVIEW_HISTORY = 500

/** 内置 profile/control 的领域总数上限（避免过度产品化） */
export const COMPLIANCE_MAX_DOMAINS = 20

// ──────────────────────────────────────────────
// 2. 类型守卫
// ──────────────────────────────────────────────

export function isComplianceReadinessState(v: unknown): v is ComplianceReadinessState {
  return COMPLIANCE_READINESS_STATES.includes(v as ComplianceReadinessState)
}
export function isComplianceEvidenceStatus(v: unknown): v is ComplianceEvidenceStatus {
  return COMPLIANCE_EVIDENCE_STATUSES.includes(v as ComplianceEvidenceStatus)
}
export function isComplianceProviderHealth(v: unknown): v is ComplianceProviderHealth {
  return COMPLIANCE_PROVIDER_HEALTH.includes(v as ComplianceProviderHealth)
}
export function isComplianceProfileStatus(v: unknown): v is ComplianceProfileStatus {
  return COMPLIANCE_PROFILE_STATUSES.includes(v as ComplianceProfileStatus)
}
export function isComplianceMaturityLevel(v: unknown): v is ComplianceMaturityLevel {
  return COMPLIANCE_MATURITY_LEVELS.includes(v as ComplianceMaturityLevel)
}
export function isComplianceRiskLevel(v: unknown): v is ComplianceRiskLevel {
  return COMPLIANCE_RISK_LEVELS.includes(v as ComplianceRiskLevel)
}
export function isComplianceApplicability(v: unknown): v is ComplianceApplicability {
  return COMPLIANCE_APPLICABILITY.includes(v as ComplianceApplicability)
}
export function isComplianceExceptionStatus(v: unknown): v is ComplianceExceptionStatus {
  return COMPLIANCE_EXCEPTION_STATUSES.includes(v as ComplianceExceptionStatus)
}
export function isCompliancePackageStatus(v: unknown): v is CompliancePackageStatus {
  return COMPLIANCE_PACKAGE_STATUSES.includes(v as CompliancePackageStatus)
}
export function isComplianceWarningCode(v: unknown): v is ComplianceWarningCode {
  return COMPLIANCE_WARNING_CODES.includes(v as ComplianceWarningCode)
}

// ──────────────────────────────────────────────
// 3. 稳定 hash / fingerprint helpers（cr* 前缀避免 barrel 冲突）
// ──────────────────────────────────────────────

/**
 * 稳定 FNV-1a 32-bit hash（hex，8 位小写）。
 * 对同一输入始终返回同一值，适合指纹、source hash、预览签名底座。
 * 与 enterprise-dlp-engine 的 FNV-1a 语义对齐；为避免 exports 冲突使用 cr 前缀。
 */
export function crFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 稳定对象签名：对输入对象按 key 排序后 JSON 序列化，再取 hash。
 * 相同内容无论键顺序、多余空白都产生相同签名。
 */
export function crComputeStableSignature(input: Record<string, unknown>): string {
  const sorted = Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = input[key]
      return acc
    }, {})
  return crFnv1aHash(JSON.stringify(sorted))
}

/**
 * 组织 scope hash：用于跨组织隔离检查。
 */
export function crComputeOrgScopeHash(organizationId: number): string {
  return crFnv1aHash(`org:${organizationId}`)
}

/**
 * 计算 profile hash：基于 profile 元数据 + 版本 + 组织 scope 的稳定签名。
 */
export function crComputeProfileHash(params: {
  organizationId: number
  profileId: string
  version: number
  scope: string
}): string {
  return crComputeStableSignature({
    organizationId: params.organizationId,
    profileId: params.profileId,
    version: params.version,
    scope: params.scope,
  })
}

/**
 * 计算 control hash：基于 profileId + controlId + maturity + risk + applicability 的稳定签名。
 */
export function crComputeControlHash(params: {
  profileId: string
  controlId: string
  maturity: ComplianceMaturityLevel
  riskLevel: ComplianceRiskLevel
  applicability: ComplianceApplicability
}): string {
  return crComputeStableSignature({
    profileId: params.profileId,
    controlId: params.controlId,
    maturity: params.maturity,
    riskLevel: params.riskLevel,
    applicability: params.applicability,
  })
}

/**
 * 计算 source hash：基于 sourceType + providerId + sourceRef 的稳定签名。
 */
export function crComputeSourceHash(
  sourceType: string,
  providerId: string,
  sourceRef: string,
): string {
  return crFnv1aHash(`${sourceType}:${providerId}:${sourceRef}`)
}

/**
 * 计算 evidence ref hash：捕获 source、provider、时间、summary 摘要，用于 stale 检测。
 */
export function crComputeEvidenceHash(params: {
  organizationId: number
  sourceType: string
  providerId: string
  capturedAt: string
  summary: string
}): string {
  return crComputeStableSignature({
    organizationId: params.organizationId,
    sourceType: params.sourceType,
    providerId: params.providerId,
    capturedAt: params.capturedAt,
    summary: params.summary,
  })
}

/**
 * 计算 preview signature：基于所选 control ids 排序 + 时间窗 + 组织 scope 的稳定签名。
 */
export function crComputePreviewSignature(params: {
  organizationId: number
  controlIds: string[]
  from: string | null
  to: string | null
  sourceSignature: string
}): string {
  return crComputeStableSignature({
    organizationId: params.organizationId,
    controlIds: [...params.controlIds].sort(),
    from: params.from,
    to: params.to,
    sourceSignature: params.sourceSignature,
  })
}

/**
 * 计算 source signature：汇总 profile hash、control hashes、provider health 与
 * 最新证据捕获时刻（capturedAt）。capturedAt 必须纳入签名，否则 preview 与 confirm
 * 之间证据源变化（含刷新、过期）无法被 staleness 检测识别，违反 Decision 5 的
 * "sourceSignature / provider freshness 必须重新校验"约束。
 */
export function crComputeSourceSignature(params: {
  profileHash: string
  controlHashes: string[]
  providerHealth: Record<string, ComplianceProviderHealth>
  capturedAt: string
}): string {
  return crComputeStableSignature({
    profileHash: params.profileHash,
    controlHashes: [...params.controlHashes].sort(),
    providerHealth: params.providerHealth,
    capturedAt: params.capturedAt,
  })
}

/**
 * 计算 package hash：汇总预览签名 + 控制数 + 证据数 + 时间窗 + warning codes 的稳定签名。
 */
export function crComputePackageHash(params: {
  previewSignature: string
  controlCount: number
  evidenceCount: number
  from: string | null
  to: string | null
  warningCodes: ComplianceWarningCode[]
}): string {
  return crComputeStableSignature({
    previewSignature: params.previewSignature,
    controlCount: params.controlCount,
    evidenceCount: params.evidenceCount,
    from: params.from,
    to: params.to,
    warningCodes: [...params.warningCodes].sort(),
  })
}

// ──────────────────────────────────────────────
// 4. 脱敏 helpers
// ──────────────────────────────────────────────

/**
 * 判断 key 是否命中禁止键集合（大小写不敏感、支持 snake_case 归一）。
 */
export function isComplianceForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return COMPLIANCE_FORBIDDEN_KEYS.some((k) => k.toLowerCase() === normalized)
}

/**
 * 深度扫描对象，返回所有命中禁止键的路径列表。
 */
export function detectComplianceForbiddenKeysDeep(obj: unknown): string[] {
  const found: string[] = []
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], `${path}[${i}]`)
      return
    }
    if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const fullPath = path ? `${path}.${key}` : key
        if (isComplianceForbiddenKey(key)) found.push(fullPath)
        walk(val, fullPath)
      }
    }
  }
  walk(obj, '')
  return found
}

/**
 * 从对象中递归删除命中禁止键的 key，返回新对象（不修改原对象）。
 */
export function redactComplianceForbiddenKeysDeep<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    return obj.map(redactComplianceForbiddenKeysDeep) as unknown as T
  }
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (isComplianceForbiddenKey(key)) continue
    result[key] = redactComplianceForbiddenKeysDeep(val)
  }
  return result as unknown as T
}

/**
 * 生成脱敏摘要 helper：返回低敏 summary + 命中的 warning code。
 */
export function summarizeRedaction(obj: unknown): {
  redactedCount: number
  warningCode: ComplianceWarningCode | null
} {
  const paths = detectComplianceForbiddenKeysDeep(obj)
  if (paths.length === 0) {
    return { redactedCount: 0, warningCode: null }
  }
  return { redactedCount: paths.length, warningCode: 'requires_external_review' }
}

// ──────────────────────────────────────────────
// 5. 领域类型
// ──────────────────────────────────────────────

/** 合规控制域 */
export interface ComplianceControlDomain {
  domainId: string
  title: string
  /** 是否为内置 demo/中性域（不暗示真实认证映射） */
  isDemo: boolean
}

/** 合规 profile（组织级，profile 元数据不宣称认证） */
export interface ComplianceProfile {
  id: string
  organizationId: number
  name: string
  description: string
  version: number
  scope: string
  status: ComplianceProfileStatus
  profileHash: string
  domains: ComplianceControlDomain[]
  /** 非认证声明 —— 任何内置/种子 profile 必须为 true */
  notCertification: boolean
  createdBy: number | null
  createdAt: string
}

/** 合规控制项 */
export interface ComplianceControl {
  id: string
  profileId: string
  controlId: string
  domain: string
  title: string
  description: string
  owner: string | null
  riskLevel: ComplianceRiskLevel
  maturity: ComplianceMaturityLevel
  status: ComplianceReadinessState
  applicability: ComplianceApplicability
  reviewCadenceDays: number
  evidenceRequirements: string[]
  controlHash: string
  notApplicableReason: string | null
}

/** 证据引用（低敏 —— 只含摘要与 hash，绝不含原始敏感 payload） */
export interface ComplianceEvidenceRef {
  id: string
  organizationId: number
  controlId: string
  sourceType: string
  sourceId: string
  sourceHash: string
  providerId: string
  status: ComplianceEvidenceStatus
  capturedAt: string
  expiresAt: string | null
  summary: string
  redactionWarnings: ComplianceWarningCode[]
  freshnessSeconds: number
}

/** 例外记录（不自动宣称认证或永久 ready） */
export interface ComplianceException {
  id: string
  organizationId: number
  controlId: string
  reason: string
  acceptedRisk: string
  owner: string
  dueDate: string
  status: ComplianceExceptionStatus
  reviewHistoryHash: string
  createdBy: number | null
  createdAt: string
}

/** 例外 + 复核历史（用于校验 reviewHistoryHash） */
export interface ComplianceExceptionWithHistory extends ComplianceException {
  reviewHistory: string[]
}

/** provider health 摘要（邻域能力状态） */
export interface ComplianceProviderHealthSummary {
  providerId: string
  health: ComplianceProviderHealth
  reason: string | null
  /** provider 是否支持真实证据（false = fixture-only / degraded） */
  supportsLiveEvidence: boolean
  /** 上一次可用捕获时间 */
  lastCapturedAt: string | null
}

// ──────────────────────────────────────────────
// 6. 评估器相关类型
// ──────────────────────────────────────────────

/** 评估器输入：profile + controls + evidence + exceptions + provider health + review 规则 */
export interface ComplianceReadinessInput {
  profile: ComplianceProfile
  controls: ComplianceControl[]
  evidenceRefs: ComplianceEvidenceRef[]
  exceptions: ComplianceException[]
  providerHealth: Record<string, ComplianceProviderHealthSummary>
  now: string
}

/** 单个控制项的评估结果 */
export interface ComplianceControlEvaluation {
  controlId: string
  state: ComplianceReadinessState
  reasons: ComplianceWarningCode[]
  missingEvidenceTypes: string[]
  staleEvidenceRefs: string[]
  blockedDependency: string | null
  providerHealth: ComplianceProviderHealth | null
  nextProbe: string[]
  requiresConfirmation: boolean
}

/** 完整的 dashboard DTO（聚合结果） */
export interface ComplianceDashboardDto {
  profile: ComplianceProfile
  controls: ComplianceControlEvaluation[]
  stateDistribution: Record<ComplianceReadinessState, number>
  providerHealth: ComplianceProviderHealthSummary[]
  exceptionSummary: {
    open: number
    expired: number
    closed: number
  }
  packageCount: number
  notCertification: boolean
  generatedAt: string
}

// ──────────────────────────────────────────────
// 7. package preview / confirm / ledger 类型
// ──────────────────────────────────────────────

/** preview 输入 filter */
export interface CompliancePackageFilter {
  profileId: number
  controlIds: number[]
  from: string | null
  to: string | null
}

/** package preview 结果（不落 ledger） */
export interface CompliancePackagePreview {
  packageId: string
  organizationId: number
  filter: CompliancePackageFilter
  selectedControlCount: number
  evidenceCount: number
  stateDistribution: Record<ComplianceReadinessState, number>
  redactedManifestSummary: CompliancePackageManifestSummary
  sourceSignature: string
  profileHash: string
  controlHash: string
  packageHash: string
  warningCodes: ComplianceWarningCode[]
  requiresConfirmation: boolean
  previewSignature: string
  previewExpiresAt: string
  notCertification: boolean
  disclaimer: string
}

/** package manifest summary（低敏） */
export interface CompliancePackageManifestSummary {
  profileName: string
  profileScope: string
  domainTitles: string[]
  controlSummary: Record<ComplianceReadinessState, number>
  evidenceRefIds: string[]
  providerIds: string[]
  timeWindow: { from: string | null; to: string | null }
}

/** package ledger 条目（确认后写入） */
export interface CompliancePackageLedgerEntry {
  id: string
  packageId: string
  organizationId: number
  profileHash: string
  sourceSignature: string
  packageHash: string
  controlCount: number
  evidenceCount: number
  status: CompliancePackageStatus
  warningCodes: ComplianceWarningCode[]
  actorId: number | null
  createdAt: string
  previewSignature: string
}

/** confirm 请求（必须携带 preview 签名以供重校验） */
export interface CompliancePackageConfirmRequest {
  packageId: string
  previewSignature: string
  profileId: number
  controlIds: number[]
  from: string | null
  to: string | null
}

// ──────────────────────────────────────────────
// 8. 自审计事件类型（低敏）
// ──────────────────────────────────────────────

/** 合规准备度自审计 action */
export const COMPLIANCE_AUDIT_ACTIONS = [
  'profile_change',
  'control_change',
  'evidence_refresh',
  'readiness_evaluation',
  'manual_review',
  'exception_create',
  'exception_update',
  'exception_close',
  'package_preview',
  'package_confirm',
  'package_download_attempt',
  'stale_confirmation',
  'permission_denial',
  'provider_degraded',
] as const
export type ComplianceAuditAction = (typeof COMPLIANCE_AUDIT_ACTIONS)[number]

/**
 * 合规准备度自审计事件。
 * metadata 只能包含 enum、IDs、counts、hashes、warning codes、requestId ——
 * 绝不能包含原始 payload。
 */
export interface ComplianceAuditEvent {
  id: string
  organizationId: number
  action: ComplianceAuditAction
  status: 'success' | 'denied' | 'blocked'
  actorId: number | null
  profileId: string | null
  controlId: string | null
  packageId: string | null
  counts: {
    controls: number
    evidence: number
    packages: number
  } | null
  hashes: {
    profileHash: string | null
    controlHash: string | null
    packageHash: string | null
    sourceSignature: string | null
  } | null
  warningCodes: ComplianceWarningCode[]
  requestId: string | null
  createdAt: string
}

// ──────────────────────────────────────────────
// 9. 确定性 readiness evaluator
// ──────────────────────────────────────────────

/** 判断时间字符串是否已过期（now > expiresAt）。 */
export function isExpired(now: string, expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return now > expiresAt
}

/** 判断证据是否 fresh：未过期（或无过期时间）且 freshness 在允许窗口内。 */
export function isEvidenceFresh(
  evidence: ComplianceEvidenceRef,
  now: string,
  maxFreshnessSeconds = 60 * 60 * 24 * 90, // 默认 90 天
): boolean {
  if (isExpired(now, evidence.expiresAt)) return false
  if (evidence.freshnessSeconds > maxFreshnessSeconds) return false
  return true
}

/**
 * 评估单个控制项的准备度状态。
 *
 * 判定顺序：
 * 1. not_applicable —— 控制项被标为不适用且有例外/凭据。
 * 2. blocked —— 前置 provider degraded/missing，或存在高风险 warning。
 * 3. ready —— 所有 required evidence fresh & scoped & 无 blocking warning & 附带例外未过期。
 * 4. partial —— 有部分证据，但缺非阻断项/有 stale/需复核。
 * 5. missing —— 无 required evidence。
 */
export function evaluateControl(
  control: ComplianceControl,
  evidenceRefs: ComplianceEvidenceRef[],
  exceptions: ComplianceException[],
  providerHealth: Record<string, ComplianceProviderHealthSummary>,
  now: string,
): ComplianceControlEvaluation {
  const reasons: ComplianceWarningCode[] = []
  const missingEvidenceTypes: string[] = []
  const staleEvidenceRefs: string[] = []
  const nextProbe: string[] = []

  // 组织隔离 —— 只评估本组织的 evidence（调用方已按 orgKey 过滤，此处双保险）
  const scopedEvidence = evidenceRefs.filter((e) => e.controlId === control.id)
  const controlExceptions = exceptions.filter((e) => e.controlId === control.id)
  const openExceptions = controlExceptions.filter((e) => e.status === 'open')

  // ── not_applicable ──
  if (control.applicability === 'not_applicable' && control.notApplicableReason) {
    return {
      controlId: control.controlId,
      state: 'not_applicable',
      reasons: ['requires_external_review'],
      missingEvidenceTypes: [],
      staleEvidenceRefs: [],
      blockedDependency: null,
      providerHealth: null,
      nextProbe: ['review_applicability'],
      requiresConfirmation: false,
    }
  }

  // ── provider health 检查 ──
  let blockedDependency: string | null = null
  let effectiveProviderHealth: ComplianceProviderHealth | null = null
  for (const req of control.evidenceRequirements) {
    const ph = providerHealth[req]
    if (!ph) continue
    effectiveProviderHealth = ph.health
    if (ph.health === 'missing' || ph.health === 'degraded') {
      blockedDependency = ph.providerId
      // 映射为具体邻域 warning
      if (req.includes('dlp')) reasons.push('dlp_unavailable')
      else if (req.includes('kms')) reasons.push('kms_unavailable')
      else if (req.includes('watermark')) reasons.push('watermark_unavailable')
      else reasons.push('neighbor_provider_degraded')
      break
    }
  }

  // ── blocked：前置能力缺失/授权门 ──
  if (blockedDependency) {
    nextProbe.push(`enable_provider:${blockedDependency}`)
    return {
      controlId: control.controlId,
      state: 'blocked',
      reasons: [...reasons, 'gated_dependency'],
      missingEvidenceTypes: [],
      staleEvidenceRefs: [],
      blockedDependency,
      providerHealth: effectiveProviderHealth,
      nextProbe,
      requiresConfirmation: false,
    }
  }

  // ── required evidence 配对 ──
  const evidenceBySource = new Map<string, ComplianceEvidenceRef[]>()
  for (const e of scopedEvidence) {
    const list = evidenceBySource.get(e.sourceType) ?? []
    list.push(e)
    evidenceBySource.set(e.sourceType, list)
  }

  let freshCount = 0
  let staleCount = 0
  for (const req of control.evidenceRequirements) {
    const evList = evidenceBySource.get(req) ?? []
    const fresh = evList.filter((e) => isEvidenceFresh(e, now))
    if (fresh.length > 0) {
      freshCount++
    } else if (evList.length > 0) {
      // stale 但仍存在
      staleCount++
      staleEvidenceRefs.push(...evList.map((e) => e.id))
    } else {
      missingEvidenceTypes.push(req)
    }
  }

  // ── stale evidence 标志 ──
  if (staleEvidenceRefs.length > 0) {
    reasons.push('stale_evidence')
    nextProbe.push('refresh_stale_evidence')
  }

  // ── 过期例外 ──
  const hasExpiredException = controlExceptions.some(
    (e) => e.status === 'expired' || (e.status === 'open' && isExpired(now, e.dueDate)),
  )
  if (hasExpiredException) {
    reasons.push('exception_expired')
    nextProbe.push('close_or_renew_exception')
  }

  // ── ready ──
  // 证据完整 + 新鲜 + 无 stale + 无过期例外 → ready。
  // control.status 是期望/上次记录值，不作为 ready 前提（确定性由 evidence 决定）。
  if (
    freshCount > 0 &&
    missingEvidenceTypes.length === 0 &&
    staleEvidenceRefs.length === 0 &&
    !hasExpiredException
  ) {
    return {
      controlId: control.controlId,
      state: 'ready',
      reasons,
      missingEvidenceTypes: [],
      staleEvidenceRefs: [],
      blockedDependency: null,
      providerHealth: effectiveProviderHealth,
      nextProbe: [],
      requiresConfirmation: false,
    }
  }

  // ── 完全缺失 → missing ──
  if (freshCount === 0 && staleCount === 0 && missingEvidenceTypes.length > 0) {
    reasons.push('no_required_evidence')
    nextProbe.push(`collect_evidence:${control.controlId}`)
    return {
      controlId: control.controlId,
      state: 'missing',
      reasons,
      missingEvidenceTypes,
      staleEvidenceRefs: [],
      blockedDependency: null,
      providerHealth: effectiveProviderHealth,
      nextProbe,
      requiresConfirmation: false,
    }
  }

  // ── 部分/需复核 → partial ──
  if (missingEvidenceTypes.length > 0) {
    reasons.push('missing_evidence_type')
    nextProbe.push(`collect_evidence:${control.controlId}`)
  }
  if (staleEvidenceRefs.length > 0) {
    // stale 已在上面加入 reasons，这里补充 probe
    nextProbe.push('refresh_stale_evidence')
  }
  if (openExceptions.length > 0) {
    reasons.push('exception_open')
    nextProbe.push('review_exception')
  }
  // 存在未关闭例外或过期内容时需人工复核
  if (openExceptions.length > 0 || staleEvidenceRefs.length > 0 || hasExpiredException) {
    reasons.push('manual_review_required')
    nextProbe.push('perform_manual_review')
  }
  return {
    controlId: control.controlId,
    state: 'partial',
    reasons: [...new Set(reasons)],
    missingEvidenceTypes,
    staleEvidenceRefs,
    blockedDependency: null,
    providerHealth: effectiveProviderHealth,
    nextProbe: [...new Set(nextProbe)],
    requiresConfirmation: false,
  }
}

/**
 * 评估整个 profile 的 dashboard。
 * 返回所有控制项状态、分布、provider health、例外摘要。
 */
export function evaluateReadinessDashboard(
  input: ComplianceReadinessInput,
): ComplianceDashboardDto {
  const evaluations = input.controls.map((c) =>
    evaluateControl(c, input.evidenceRefs, input.exceptions, input.providerHealth, input.now),
  )

  const stateDistribution: Record<ComplianceReadinessState, number> = {
    ready: 0,
    partial: 0,
    missing: 0,
    not_applicable: 0,
    blocked: 0,
  }
  for (const ev of evaluations) {
    stateDistribution[ev.state] += 1
  }

  const providerHealth = Object.values(input.providerHealth).map((ph) => ({
    ...ph,
  }))

  const exceptionSummary = {
    open: input.exceptions.filter((e) => e.status === 'open').length,
    expired: input.exceptions.filter(
      (e) => e.status === 'expired' || (e.status === 'open' && isExpired(input.now, e.dueDate)),
    ).length,
    closed: input.exceptions.filter((e) => e.status === 'closed').length,
  }

  return {
    profile: input.profile,
    controls: evaluations,
    stateDistribution,
    providerHealth,
    exceptionSummary,
    packageCount: 0, // 由 service 层填充实际计数值
    notCertification: input.profile.notCertification,
    generatedAt: input.now,
  }
}
