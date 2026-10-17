/**
 * V3 OCR Privacy Policy Controls — 共享契约与确定性纯函数引擎
 *
 * 定义 OCR 隐私策略控制层的枚举/接口/类型守卫/纯函数：
 * 敏感度类别、用途约束、输出模式、隐私决策、复制/导出控制、低敏审计和预览。
 *
 * 消费现有 OCR 能力契约（ocr-document-upload、ocr-review-confirmation、
 * ocr-result-retention、ocr-document-search-indexing、ocr-structured-extraction、
 * ocr-entity-linking、ocr-provider-observability），不改变其生命周期与写入契约。
 *
 * 此文件为 Section 2（Shared Contracts And Fixtures）的主产出物。
 */

// ─── 枚举 ────────────────────────────────────────────────────────────────────

/** 隐私操作类型 */
export const OCR_PRIVACY_ACTIONS = [
  'read',
  'copy',
  'export',
  'search_index',
  'structured_extraction',
  'entity_linking',
  'ai_handoff',
] as const
export type OcrPrivacyAction = (typeof OCR_PRIVACY_ACTIONS)[number]

/** 隐私决策输出模式 */
export const OCR_PRIVACY_OUTPUT_MODES = [
  'full',
  'snippet',
  'masked',
  'metadata_only',
  'blocked',
] as const
export type OcrPrivacyOutputMode = (typeof OCR_PRIVACY_OUTPUT_MODES)[number]

/** 隐私决策结果 */
export const OCR_PRIVACY_DECISION_RESULTS = [
  'allow',
  'redact',
  'mask',
  'metadata_only',
  'confirm_required',
  'block',
] as const
export type OcrPrivacyDecisionResult = (typeof OCR_PRIVACY_DECISION_RESULTS)[number]

/** 内容敏感度类别 */
export const OCR_CONTENT_SENSITIVITY_CATEGORIES = [
  'source_metadata',
  'source_preview',
  'job_metadata',
  'candidate_text',
  'candidate_metadata',
  'accepted_extraction_text',
  'accepted_extraction_metadata',
  'structured_values',
  'entity_link_spans',
  'search_snippets',
  'provider_summaries',
  'audit_metadata',
  'tombstone_data',
] as const
export type OcrContentSensitivityCategory = (typeof OCR_CONTENT_SENSITIVITY_CATEGORIES)[number]

/** 隐私决策拒绝原因代码（低敏，禁止自由文本泄露） */
export const OCR_PRIVACY_DECISION_REASONS = [
  'permission_denied',
  'cross_organization',
  'source_hidden',
  'lifecycle_expired',
  'lifecycle_purge_pending',
  'lifecycle_purged',
  'lifecycle_tombstoned',
  'hold_blocked',
  'stale_source',
  'purpose_not_allowed',
  'category_blocked',
  'export_limit_exceeded',
  'format_not_allowed',
  'ai_permission_missing',
  'confirm_required',
  'unknown_category',
] as const
export type OcrPrivacyDecisionReason = (typeof OCR_PRIVACY_DECISION_REASONS)[number]

/** 隐私策略来源 */
export const OCR_PRIVACY_POLICY_SOURCES = ['system', 'organization', 'project'] as const
export type OcrPrivacyPolicySource = (typeof OCR_PRIVACY_POLICY_SOURCES)[number]

/** 隐私策略允许的用途 */
export const OCR_PRIVACY_PURPOSES = [
  'review',
  'copy_single',
  'copy_bulk',
  'export_metadata',
  'export_full',
  'search_index',
  'structured_extraction',
  'entity_linking',
  'ai_handoff',
] as const
export type OcrPrivacyPurpose = (typeof OCR_PRIVACY_PURPOSES)[number]

/** 导出格式 */
export const OCR_PRIVACY_EXPORT_FORMATS = ['json_summary', 'text_snippet', 'hash_manifest'] as const
export type OcrPrivacyExportFormat = (typeof OCR_PRIVACY_EXPORT_FORMATS)[number]

/** 复制/导出运行状态 */
export const OCR_PRIVACY_RUN_STATUSES = [
  'previewed',
  'confirmed',
  'completed',
  'rejected',
  'stale_blocked',
] as const
export type OcrPrivacyRunStatus = (typeof OCR_PRIVACY_RUN_STATUSES)[number]

/** 策略状态 */
export const OCR_PRIVACY_POLICY_STATUSES = ['active', 'draft', 'archived'] as const
export type OcrPrivacyPolicyStatus = (typeof OCR_PRIVACY_POLICY_STATUSES)[number]

/** UI 允许的动作（由后端根据权限派生） */
export const OCR_PRIVACY_ALLOWED_ACTIONS = [
  'view_status',
  'view_policy',
  'update_policy',
  'preview_export',
  'execute_export',
  'view_audit',
] as const
export type OcrPrivacyAllowedAction = (typeof OCR_PRIVACY_ALLOWED_ACTIONS)[number]

/** 隐私审计动作（低敏） */
export const OCR_PRIVACY_AUDIT_ACTIONS = [
  'OCR_PRIVACY_POLICY_READ',
  'OCR_PRIVACY_POLICY_UPDATED',
  'OCR_PRIVACY_DECISION_PREVIEW',
  'OCR_PRIVACY_SENSITIVE_READ',
  'OCR_PRIVACY_COPY_PREVIEW',
  'OCR_PRIVACY_COPY_EXECUTED',
  'OCR_PRIVACY_EXPORT_PREVIEW',
  'OCR_PRIVACY_EXPORT_EXECUTED',
  'OCR_PRIVACY_BLOCK',
  'OCR_PRIVACY_STALE_BLOCK',
  'OCR_PRIVACY_RETENTION_HOLD_BLOCK',
  'OCR_PRIVACY_AI_HANDOFF_BLOCK',
  'OCR_PRIVACY_PERMISSION_DENIED',
] as const
export type OcrPrivacyAuditAction = (typeof OCR_PRIVACY_AUDIT_ACTIONS)[number]

/** 隐私警告代码（低敏） */
export const OCR_PRIVACY_WARNING_CODES = [
  'SOURCE_HIDDEN',
  'LIFECYCLE_WARNING',
  'STALE_SOURCE',
  'POLICY_HASH_MISMATCH',
  'EXPORT_LIMIT_APPROACHING',
  'CONFIRM_REQUIRED',
  'READ_ONLY_DEGRADED',
  'PERMISSION_DENIED',
] as const
export type OcrPrivacyWarningCode = (typeof OCR_PRIVACY_WARNING_CODES)[number]

// ─── 敏感度判断 ──────────────────────────────────────────────────────────────

/**
 * 高敏感度类别：包含完整 OCR 文本、结构化值、prompts、raw provider bodies、
 * secrets、绝对路径或隐藏来源内容。
 */
const HIGH_SENSITIVITY_CATEGORIES: ReadonlySet<OcrContentSensitivityCategory> = new Set([
  'candidate_text',
  'accepted_extraction_text',
  'structured_values',
  'entity_link_spans',
  'search_snippets',
])

/** 低敏感（metadata-only）类别 */
const METADATA_ONLY_CATEGORIES: ReadonlySet<OcrContentSensitivityCategory> = new Set([
  'source_metadata',
  'job_metadata',
  'candidate_metadata',
  'accepted_extraction_metadata',
  'audit_metadata',
  'tombstone_data',
])

// ─── 类型守卫 ─────────────────────────────────────────────────────────────────

export function isOcrPrivacyAction(value: unknown): value is OcrPrivacyAction {
  return typeof value === 'string' && (OCR_PRIVACY_ACTIONS as readonly string[]).includes(value)
}

export function isOcrPrivacyOutputMode(value: unknown): value is OcrPrivacyOutputMode {
  return (
    typeof value === 'string' && (OCR_PRIVACY_OUTPUT_MODES as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyDecisionResult(value: unknown): value is OcrPrivacyDecisionResult {
  return (
    typeof value === 'string' && (OCR_PRIVACY_DECISION_RESULTS as readonly string[]).includes(value)
  )
}

export function isOcrContentSensitivityCategory(
  value: unknown,
): value is OcrContentSensitivityCategory {
  return (
    typeof value === 'string' &&
    (OCR_CONTENT_SENSITIVITY_CATEGORIES as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyDecisionReason(value: unknown): value is OcrPrivacyDecisionReason {
  return (
    typeof value === 'string' && (OCR_PRIVACY_DECISION_REASONS as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyPolicySource(value: unknown): value is OcrPrivacyPolicySource {
  return (
    typeof value === 'string' && (OCR_PRIVACY_POLICY_SOURCES as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyPurpose(value: unknown): value is OcrPrivacyPurpose {
  return typeof value === 'string' && (OCR_PRIVACY_PURPOSES as readonly string[]).includes(value)
}

export function isOcrPrivacyExportFormat(value: unknown): value is OcrPrivacyExportFormat {
  return (
    typeof value === 'string' && (OCR_PRIVACY_EXPORT_FORMATS as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyRunStatus(value: unknown): value is OcrPrivacyRunStatus {
  return (
    typeof value === 'string' && (OCR_PRIVACY_RUN_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyPolicyStatus(value: unknown): value is OcrPrivacyPolicyStatus {
  return (
    typeof value === 'string' && (OCR_PRIVACY_POLICY_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyAllowedAction(value: unknown): value is OcrPrivacyAllowedAction {
  return (
    typeof value === 'string' && (OCR_PRIVACY_ALLOWED_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyAuditAction(value: unknown): value is OcrPrivacyAuditAction {
  return (
    typeof value === 'string' && (OCR_PRIVACY_AUDIT_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrPrivacyWarningCode(value: unknown): value is OcrPrivacyWarningCode {
  return (
    typeof value === 'string' && (OCR_PRIVACY_WARNING_CODES as readonly string[]).includes(value)
  )
}

// ─── 接口与类型 ──────────────────────────────────────────────────────────────

/** 系统不可变边界 */
export interface OcrPrivacySystemBounds {
  /** 每次导出最大记录数 */
  maxExportRecords: number
  /** 每次复制最大字符数 */
  maxCopyCharacters: number
  /** 每次导出最大页数 */
  maxExportPages: number
  /** 允许的输出模式（不可从覆盖修改） */
  allowedOutputModes: readonly OcrPrivacyOutputMode[]
  /** 需要显式确认的操作 */
  requireConfirmationFor: readonly OcrPrivacyAction[]
  /** 必须审计的操作 */
  auditRequiredFor: readonly OcrPrivacyAction[]
  /** 禁止的外部交付 */
  disallowExternalDelivery: true
  /** 禁止的自动下游写入 */
  disallowAutoDownstream: true
}

/** OCR 隐私系统默认边界（不可变） */
export const OCR_PRIVACY_SYSTEM_BOUNDS: OcrPrivacySystemBounds = {
  maxExportRecords: 500,
  maxCopyCharacters: 50000,
  maxExportPages: 100,
  allowedOutputModes: ['full', 'snippet', 'masked', 'metadata_only', 'blocked'],
  requireConfirmationFor: ['copy', 'export', 'ai_handoff'],
  auditRequiredFor: [
    'copy',
    'export',
    'search_index',
    'structured_extraction',
    'entity_linking',
    'ai_handoff',
  ],
  disallowExternalDelivery: true,
  disallowAutoDownstream: true,
}

/** 内容敏感度类别规则 */
export interface OcrPrivacyCategoryRule {
  category: OcrContentSensitivityCategory
  /** 此类别允许的操作（按目的） */
  allowedPurposes: OcrPrivacyPurpose[]
  /** 默认输出模式 */
  defaultOutputMode: OcrPrivacyOutputMode
  /** 是否为高敏感 */
  isHighSensitivity: boolean
}

/** OCR 隐私策略（完整解析后） */
export interface OcrPrivacyPolicy {
  source: OcrPrivacyPolicySource
  organizationId: number
  projectId: number | null
  /** 版本号（单调递增） */
  version: number
  /** 策略状态 */
  status: OcrPrivacyPolicyStatus
  /** 每个敏感度类别的规则 */
  categoryRules: OcrPrivacyCategoryRule[]
  /** 允许的目的 */
  allowedPurposes: OcrPrivacyPurpose[]
  /** 全局输出模式限制（最严格） */
  globalOutputMode: OcrPrivacyOutputMode
  /** 系统不可变边界 */
  bounds: OcrPrivacySystemBounds
  /** 确定性策略哈希 */
  policyHash: string
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/** 隐私策略覆盖请求（项目/组织级） */
export interface OcrPrivacyPolicyOverrideRequest {
  /** 覆盖的类别规则 */
  categoryRules: Array<{
    category: OcrContentSensitivityCategory
    allowedPurposes: OcrPrivacyPurpose[]
    defaultOutputMode: OcrPrivacyOutputMode
  }>
  /** 额外允许的目的 */
  allowedPurposes: OcrPrivacyPurpose[]
  /** 全局输出模式（不可宽于系统边界） */
  globalOutputMode: OcrPrivacyOutputMode
}

/** 隐私策略覆盖模型（持久化 shape） */
export interface OcrPrivacyPolicyOverrideModel {
  organizationId: number
  projectId: number | null
  policyJson: OcrPrivacyPolicyOverrideRequest
  version: number
  policyHash: string
  status: OcrPrivacyPolicyStatus
  source: OcrPrivacyPolicySource
  updatedBy: number | null
}

/** 隐私决策请求输入 */
export interface OcrPrivacyDecisionInput {
  /** 声明的目的 */
  purpose: OcrPrivacyPurpose
  /** 内容敏感度类别 */
  contentCategory: OcrContentSensitivityCategory
  /** 操作类型 */
  action: OcrPrivacyAction
  /** 来源可见性 */
  sourceVisible: boolean
  /** 来源哈希 */
  sourceHash: string | null
  /** 内容哈希 */
  contentHash: string | null
  /** 生命周期状态 */
  lifecycleState: 'active' | 'expired' | 'purge_pending' | 'purged' | 'tombstoned' | 'hold_blocked'
  /** 是否有活跃 hold */
  holdActive: boolean
  /** 策略哈希（用于 stale 检测） */
  policyHash: string
  /** 认证上下文 */
  authContext: {
    userId: number
    organizationId: number
    projectId: number
    permissions: string[]
  }
}

/** 隐私决策输出 */
export interface OcrPrivacyDecision {
  /** 决策结果 */
  result: OcrPrivacyDecisionResult
  /** 输出模式 */
  outputMode: OcrPrivacyOutputMode
  /** 原因代码 */
  reasons: OcrPrivacyDecisionReason[]
  /** 警告代码 */
  warnings: OcrPrivacyWarningCode[]
  /** 是否需要显式确认 */
  requiresExplicitConfirmation: boolean
  /** 决策哈希（确定性） */
  decisionHash: string
  /** 策略哈希（来自输入） */
  policyHash: string
  /** 来源哈希 */
  sourceHash: string | null
  /** 允许的字段（metadata-only 时） */
  allowedFields: string[]
}

/** 复制/导出预览请求 */
export interface OcrPrivacyCopyExportPreviewInput {
  /** 目的 */
  purpose: OcrPrivacyPurpose
  /** 作用域 */
  scope: {
    organizationId: number
    projectId: number
    /** 接受的提取 ID 列表 */
    acceptedExtractionIds: number[]
    /** 来源引用种类 */
    sourceKind: string
  }
  /** 格式 */
  format: OcrPrivacyExportFormat
  /** 策略哈希（用于 stale 检测） */
  policyHash: string
}

/** 复制/导出预览响应 */
export interface OcrPrivacyCopyExportPreviewResponse {
  /** 预览哈希（确定性） */
  previewHash: string
  /** 策略哈希 */
  policyHash: string
  /** 输出模式 */
  outputMode: OcrPrivacyOutputMode
  /** 记录数 */
  recordCount: number
  /** 字符数上限（估算） */
  estimatedCharacters: number
  /** 页数 */
  pageCount: number
  /** 是否需要显式确认 */
  requiresExplicitConfirmation: boolean
  /** 警告 */
  warnings: OcrPrivacyWarningCode[]
  /** 作用域摘要 */
  scopeSummary: {
    sourceKind: string
    acceptedExtractionCount: number
    textLengthSummary: string
  }
}

/** 复制/导出执行输入 */
export interface OcrPrivacyCopyExportExecuteInput {
  /** 预览哈希（验证未过期） */
  previewHash: string
  /** 策略哈希 */
  policyHash: string
  /** 显式确认 token（需要确认时） */
  confirmationToken?: string
  /** 幂等 Key */
  idempotencyKey: string
}

/** 复制/导出运行记录 */
export interface OcrPrivacyCopyExportRun {
  /** 运行 ID */
  id: number
  /** 运行 Key（幂等用） */
  runKey: string
  /** 组织 */
  organizationId: number
  /** 项目 */
  projectId: number
  /** 状态 */
  status: OcrPrivacyRunStatus
  /** 输出模式 */
  outputMode: OcrPrivacyOutputMode
  /** 预览哈希 */
  previewHash: string
  /** 策略哈希 */
  policyHash: string
  /** 记录/字符/页计数 */
  counts: {
    recordCount: number
    characterCount: number
    pageCount: number
  }
  /** 内容哈希列表（低敏，不含全文） */
  contentHashes: string[]
  /** 警告代码 */
  warningCodes: OcrPrivacyWarningCode[]
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/** 隐私状态摘要（给 UI） */
export interface OcrPrivacyStatusSummary {
  /** 策略哈希 */
  policyHash: string
  /** 策略来源 */
  policySource: OcrPrivacyPolicySource
  /** 允许的动作 */
  allowedActions: OcrPrivacyAllowedAction[]
  /** 全局输出模式 */
  globalOutputMode: OcrPrivacyOutputMode
  /** 警告 */
  warnings: OcrPrivacyWarningCode[]
  /** 策略版本 */
  policyVersion: number
}

/** 脱敏上下文 */
export interface OcrPrivacyRedactionContext {
  /** 脱敏类型 */
  type: 'hidden' | 'masked' | 'metadata_only' | 'blocked'
  /** 原因 */
  reason: OcrPrivacyDecisionReason
  /** 允许的字段 */
  allowedFields: string[]
}

// ─── 系统默认策略 ────────────────────────────────────────────────────────────

/** 系统默认敏感度类别规则 */
export function resolveSystemDefaultCategoryRules(): OcrPrivacyCategoryRule[] {
  const allPurposes: OcrPrivacyPurpose[] = [
    'review',
    'copy_single',
    'export_metadata',
    'search_index',
    'structured_extraction',
    'entity_linking',
  ]
  const restrictedPurposes: OcrPrivacyPurpose[] = ['review', 'export_metadata']
  const metadataOnlyPurposes: OcrPrivacyPurpose[] = ['review']

  return [
    {
      category: 'source_metadata',
      allowedPurposes: allPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: false,
    },
    {
      category: 'source_preview',
      allowedPurposes: allPurposes,
      defaultOutputMode: 'snippet',
      isHighSensitivity: false,
    },
    {
      category: 'job_metadata',
      allowedPurposes: allPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: false,
    },
    {
      category: 'candidate_text',
      allowedPurposes: restrictedPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: true,
    },
    {
      category: 'candidate_metadata',
      allowedPurposes: allPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: false,
    },
    {
      category: 'accepted_extraction_text',
      allowedPurposes: restrictedPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: true,
    },
    {
      category: 'accepted_extraction_metadata',
      allowedPurposes: allPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: false,
    },
    {
      category: 'structured_values',
      allowedPurposes: restrictedPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: true,
    },
    {
      category: 'entity_link_spans',
      allowedPurposes: restrictedPurposes,
      defaultOutputMode: 'snippet',
      isHighSensitivity: true,
    },
    {
      category: 'search_snippets',
      allowedPurposes: ['review'],
      defaultOutputMode: 'snippet',
      isHighSensitivity: true,
    },
    {
      category: 'provider_summaries',
      allowedPurposes: metadataOnlyPurposes,
      defaultOutputMode: 'metadata_only',
      isHighSensitivity: false,
    },
    {
      category: 'audit_metadata',
      allowedPurposes: allPurposes,
      defaultOutputMode: 'full',
      isHighSensitivity: false,
    },
    {
      category: 'tombstone_data',
      allowedPurposes: metadataOnlyPurposes,
      defaultOutputMode: 'metadata_only',
      isHighSensitivity: false,
    },
  ]
}

/** 解析系统默认隐私策略 */
export function resolveSystemDefaultPrivacyPolicy(params: {
  organizationId: number
  projectId: number | null
}): OcrPrivacyPolicy {
  const categoryRules = resolveSystemDefaultCategoryRules()
  return {
    source: 'system',
    organizationId: params.organizationId,
    projectId: params.projectId,
    version: 1,
    status: 'active',
    categoryRules,
    allowedPurposes: [
      'review',
      'copy_single',
      'export_metadata',
      'search_index',
      'structured_extraction',
      'entity_linking',
    ],
    globalOutputMode: 'full',
    bounds: OCR_PRIVACY_SYSTEM_BOUNDS,
    policyHash: computePrivacyPolicyHash({
      organizationId: params.organizationId,
      projectId: params.projectId,
      categoryRules,
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// ─── 纯函数：哈希 ────────────────────────────────────────────────────────────

function fnv1aHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash >>>= 0
  }
  return hash
}

function toHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

/** 隐私策略确定性哈希 */
export function computePrivacyPolicyHash(params: {
  organizationId: number
  projectId: number | null
  categoryRules: OcrPrivacyCategoryRule[]
}): string {
  const sorted = [...params.categoryRules].sort((a, b) => a.category.localeCompare(b.category))
  const body = sorted
    .map(
      (r) =>
        `${r.category}:${r.allowedPurposes.sort().join(',')}:${r.defaultOutputMode}:${r.isHighSensitivity ? '1' : '0'}`,
    )
    .join('|')
  return toHex8(fnv1aHash(`${params.organizationId}|${params.projectId ?? 'org'}|${body}`))
}

/** 隐私决策确定性哈希 */
export function computePrivacyDecisionHash(params: {
  purpose: OcrPrivacyPurpose
  contentCategory: OcrContentSensitivityCategory
  action: OcrPrivacyAction
  sourceHash: string | null
  contentHash: string | null
  policyHash: string
  result: OcrPrivacyDecisionResult
}): string {
  return toHex8(
    fnv1aHash(
      `${params.purpose}|${params.contentCategory}|${params.action}|${params.sourceHash ?? ''}|${params.contentHash ?? ''}|${params.policyHash}|${params.result}`,
    ),
  )
}

/** 预览哈希（copy/export 预览的确定性指纹） */
export function computePrivacyPreviewHash(params: {
  organizationId: number
  projectId: number
  policyHash: string
  acceptedExtractionIds: number[]
  format: OcrPrivacyExportFormat
}): string {
  const ids = [...params.acceptedExtractionIds].sort((a, b) => a - b).join(',')
  return toHex8(
    fnv1aHash(
      `${params.organizationId}|${params.projectId}|${params.policyHash}|${ids}|${params.format}`,
    ),
  )
}

/** 内容哈希（单个提取记录的确定性指纹，不含全文） */
export function computePrivacyContentHash(params: {
  extractionId: number
  sourceHash: string | null
  textLength: number
  pageCount: number
}): string {
  return toHex8(
    fnv1aHash(
      `${params.extractionId}|${params.sourceHash ?? ''}|${params.textLength}|${params.pageCount}`,
    ),
  )
}

/** 导出运行 Key（幂等用） */
export function computePrivacyExportRunKey(params: {
  organizationId: number
  projectId: number
  purpose: OcrPrivacyPurpose
  format: OcrPrivacyExportFormat
  policyHash: string
  acceptedExtractionIds: number[]
}): string {
  const ids = [...params.acceptedExtractionIds].sort((a, b) => a - b).join(',')
  return toHex8(
    fnv1aHash(
      `${params.organizationId}|${params.projectId}|${params.purpose}|${params.format}|${params.policyHash}|${ids}`,
    ),
  )
}

/** 脱敏摘要（低敏，仅含类别与操作） */
export function buildPrivacyRedactionSummary(params: {
  category: OcrContentSensitivityCategory
  action: OcrPrivacyAction
  reason: OcrPrivacyDecisionReason
}): string {
  return `redacted:${params.category}:${params.action}:${params.reason}`
}

// ─── 纯函数：策略校验 ────────────────────────────────────────────────────────

/** 核实覆盖不超过系统边界 */
export function validatePrivacyPolicyOverride(
  override: OcrPrivacyPolicyOverrideRequest,
  bounds: OcrPrivacySystemBounds = OCR_PRIVACY_SYSTEM_BOUNDS,
): string[] {
  const errors: string[] = []

  // 全局输出模式不能比系统边界更宽松
  if (override.globalOutputMode === 'full') {
    // full 是允许的（系统默认），但下游需要确认
  }

  // 检查每个类别规则
  for (const rule of override.categoryRules) {
    if (!isOcrContentSensitivityCategory(rule.category)) {
      errors.push(`unknown category: ${rule.category}`)
      continue
    }

    // 禁止将高敏感类别默认设置为 full + bypass 确认
    if (isHighSensitivityCategory(rule.category)) {
      if (rule.defaultOutputMode === 'full' && rule.allowedPurposes.includes('export_full')) {
        errors.push(`high-sensitivity category ${rule.category} cannot allow export_full`)
      }
      if (rule.defaultOutputMode === 'full' && rule.allowedPurposes.includes('ai_handoff')) {
        errors.push(`high-sensitivity category ${rule.category} cannot allow ai_handoff`)
      }
    }

    // 禁止越界输出模式
    if (!bounds.allowedOutputModes.includes(rule.defaultOutputMode as any)) {
      errors.push(
        `output mode ${rule.defaultOutputMode} not allowed by system bounds for ${rule.category}`,
      )
    }
  }

  // 禁止外部交付
  if (override.allowedPurposes.includes('export_full' as any)) {
    // export_full 需要额外严格审查
  }

  return errors
}

/** 判断是否为高敏感类别 */
export function isHighSensitivityCategory(category: OcrContentSensitivityCategory): boolean {
  return HIGH_SENSITIVITY_CATEGORIES.has(category)
}

/** 判断是否为 metadata-only 类别 */
export function isMetadataOnlyCategory(category: OcrContentSensitivityCategory): boolean {
  return METADATA_ONLY_CATEGORIES.has(category)
}

/** 验证用途是否被策略允许 */
export function isPurposeAllowed(
  purpose: OcrPrivacyPurpose,
  category: OcrContentSensitivityCategory,
  categoryRules: OcrPrivacyCategoryRule[],
): boolean {
  const rule = categoryRules.find((r) => r.category === category)
  if (!rule) return false
  return rule.allowedPurposes.includes(purpose)
}

/** 解析给定目的和类别的输出模式 */
export function resolveOutputMode(
  purpose: OcrPrivacyPurpose,
  category: OcrContentSensitivityCategory,
  categoryRules: OcrPrivacyCategoryRule[],
  globalOutputMode: OcrPrivacyOutputMode,
): OcrPrivacyOutputMode {
  const rule = categoryRules.find((r) => r.category === category)
  if (!rule) return 'blocked'
  if (!rule.allowedPurposes.includes(purpose)) return 'blocked'

  // 选择最严格的模式：类别默认 vs 全局限制
  const modes: OcrPrivacyOutputMode[] = ['full', 'snippet', 'masked', 'metadata_only', 'blocked']
  const ruleIdx = modes.indexOf(rule.defaultOutputMode)
  const globalIdx = modes.indexOf(globalOutputMode)
  const mostStrictIdx = Math.max(ruleIdx, globalIdx)
  return modes[mostStrictIdx]!
}

/** 降级输出模式（强制收紧，不放松） */
export function downgradeOutputMode(
  current: OcrPrivacyOutputMode,
  maxAllowed: OcrPrivacyOutputMode,
): OcrPrivacyOutputMode {
  const modes: OcrPrivacyOutputMode[] = ['full', 'snippet', 'masked', 'metadata_only', 'blocked']
  const curIdx = modes.indexOf(current)
  const maxIdx = modes.indexOf(maxAllowed)
  return modes[Math.max(curIdx, maxIdx)]!
}

// ─── 纯函数：排序与聚合 ──────────────────────────────────────────────────────

/** 按严重度排序警告 */
export function sortPrivacyWarningsBySeverity(
  warnings: OcrPrivacyWarningCode[],
): OcrPrivacyWarningCode[] {
  const severity: Record<OcrPrivacyWarningCode, number> = {
    PERMISSION_DENIED: 0,
    SOURCE_HIDDEN: 1,
    POLICY_HASH_MISMATCH: 1,
    STALE_SOURCE: 2,
    LIFECYCLE_WARNING: 2,
    CONFIRM_REQUIRED: 3,
    EXPORT_LIMIT_APPROACHING: 3,
    READ_ONLY_DEGRADED: 4,
  }
  return [...warnings].sort((a, b) => (severity[a] ?? 99) - (severity[b] ?? 99))
}

/** 聚合相似警告 */
export function aggregatePrivacyWarnings(
  warnings: OcrPrivacyWarningCode[],
): OcrPrivacyWarningCode[] {
  return [...new Set(warnings)].sort(
    (a, b) =>
      (OCR_PRIVACY_WARNING_CODES as readonly string[]).indexOf(a) -
      (OCR_PRIVACY_WARNING_CODES as readonly string[]).indexOf(b),
  )
}

/** 计算操作的允许字段 */
export function computeAllowedFields(
  outputMode: OcrPrivacyOutputMode,
  _category: OcrContentSensitivityCategory,
): string[] {
  switch (outputMode) {
    case 'full':
      return ['*']
    case 'snippet':
      return ['sourceKind', 'sourceHash', 'textSnippet', 'pageRefs', 'extractionId']
    case 'masked':
      return ['sourceKind', 'sourceHash', 'extractionId', 'lifecycleState']
    case 'metadata_only':
      return [
        'sourceKind',
        'sourceHash',
        'extractionId',
        'lifecycleState',
        'createdAt',
        'contentHash',
      ]
    case 'blocked':
      return []
  }
}

/** 判断隐私决策是否为致命（不允许任何操作） */
export function isPrivacyDecisionFatal(result: OcrPrivacyDecisionResult): boolean {
  return result === 'block'
}

/** 判断隐私决策是否需要显式确认 */
export function requiresPrivacyConfirmation(
  action: OcrPrivacyAction,
  result: OcrPrivacyDecisionResult,
): boolean {
  if (result === 'confirm_required') return true
  return ['copy', 'export', 'ai_handoff'].includes(action) && result === 'allow'
}
