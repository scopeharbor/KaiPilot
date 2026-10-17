/**
 * v3-enterprise-dlp-engine — 企业级数据防泄漏 (DLP) 共享契约（前后端共享）。
 *
 * 定义 DLP 规则 ID、类别、严重性、动作、作用域、策略版本、项目覆盖、
 * 扫描输入、匹配摘要、决策快照、预览签名、事件 ledger、warning code、
 * 脱敏模式与稳定 hash 辅助函数。
 *
 * 设计原则：
 * - 全部纯函数，零运行时依赖。
 * - 稳定排序：涉及 hash 的计算都对对象 key 做稳定排序。
 * - 禁止键检测 fail closed：未经显式允许的 field name 不被泄露。
 * - 所有 hash/签名使用稳定 FNV-1a 变体，确保跨运行时确定性。
 * - 所有 warning 聚合按 severity 排序，确保 UI 一致性。
 */

// ─── 枚举 ──────────────────────────────────────────────────────────────────────────

/** DLP 规则 ID */
export type DlpRuleId =
  | 'pii_id_card'
  | 'pii_phone'
  | 'pii_email'
  | 'financial_bank_card'
  | 'credential_api_key'
  | 'credential_token'
  | 'credential_password_field'
  | 'credential_authorization_header'
  | 'internal_keyword'
  | 'high_risk_combination'

/** DLP 规则类别 */
export type DlpRuleCategory =
  'pii' | 'financial' | 'credential' | 'internal_keyword' | 'high_risk_combination'

/** DLP 严重性级别 */
export type DlpSeverity = 'critical' | 'high' | 'medium' | 'low'

/** DLP 动作结果 */
export type DlpAction = 'allow' | 'audit_only' | 'mask' | 'warn_confirm' | 'mask_confirm' | 'block'

/** DLP 策略作用域 */
export type DlpPolicyScope = 'system' | 'organization' | 'project'

/** DLP 策略版本状态 */
export type DlpPolicyVersionStatus = 'active' | 'superseded' | 'draft'

/** DLP 扫描类别 */
export type DlpContentCategory =
  | 'file_metadata'
  | 'file_safe_text'
  | 'ocr_metadata'
  | 'ocr_safe_text'
  | 'ai_context_summary'
  | 'report_export_metadata'
  | 'report_export_text'
  | 'document_preview'

/** DLP 声明动作（要执行的操作类型） */
export type DlpDeclaredAction =
  | 'upload'
  | 'download'
  | 'copy'
  | 'export'
  | 'preview'
  | 'ai_context_assembly'
  | 'bulk_export'
  | 'bulk_download'

/** DLP 决策结果 */
export type DlpDecisionResult =
  'allow' | 'block' | 'mask' | 'warn_confirm' | 'mask_confirm' | 'audit_only'

/** DLP 脱敏模式 */
export type DlpRedactionMode =
  'mask_prefix' | 'mask_middle' | 'mask_suffix' | 'hash_only' | 'full_mask' | 'no_redaction'

/** DLP 警告代码 */
export type DlpWarningCode =
  | 'DLP_UNAVAILABLE'
  | 'SCAN_INPUT_TOO_LARGE'
  | 'SCAN_TIME_WINDOW_EXCEEDED'
  | 'SCAN_BATCH_LIMIT_EXCEEDED'
  | 'SCAN_ITEM_COUNT_EXCEEDED'
  | 'SCAN_FILE_SIZE_EXCEEDED'
  | 'POLICY_STALE'
  | 'PREVIEW_EXPIRED'
  | 'CONFIRMATION_STALE'
  | 'ADAPTER_UNAVAILABLE'
  | 'MANDATORY_RULE_CANNOT_BE_DISABLED'
  | 'PROJECT_OVERRIDE_CANNOT_WEAKEN'
  | 'CROSS_ORGANIZATION_DENIED'
  | 'PERMISSION_DENIED'
  | 'REDACTED_EVENT_DETAILS'

/** DLP 事件类型 */
export type DlpEventType =
  | 'policy_update'
  | 'preview_created'
  | 'decision_confirmed'
  | 'decision_blocked'
  | 'decision_masked'
  | 'decision_allowed'
  | 'decision_audit_only'
  | 'stale_block'
  | 'adapter_unavailable'
  | 'permission_denied'

/** DLP 确认状态 */
export type DlpConfirmationStatus = 'pending' | 'confirmed' | 'expired' | 'stale' | 'rejected'

// ─── 常量 ──────────────────────────────────────────────────────────────────────────

export const DLP_RULE_IDS: readonly DlpRuleId[] = [
  'pii_id_card',
  'pii_phone',
  'pii_email',
  'financial_bank_card',
  'credential_api_key',
  'credential_token',
  'credential_password_field',
  'credential_authorization_header',
  'internal_keyword',
  'high_risk_combination',
] as const

export const DLP_RULE_CATEGORIES: readonly DlpRuleCategory[] = [
  'pii',
  'financial',
  'credential',
  'internal_keyword',
  'high_risk_combination',
] as const

export const DLP_SEVERITIES: readonly DlpSeverity[] = ['critical', 'high', 'medium', 'low'] as const

export const DLP_ACTIONS: readonly DlpAction[] = [
  'allow',
  'audit_only',
  'mask',
  'warn_confirm',
  'mask_confirm',
  'block',
] as const

export const DLP_POLICY_SCOPES: readonly DlpPolicyScope[] = [
  'system',
  'organization',
  'project',
] as const

export const DLP_POLICY_VERSION_STATUSES: readonly DlpPolicyVersionStatus[] = [
  'active',
  'superseded',
  'draft',
] as const

export const DLP_CONTENT_CATEGORIES: readonly DlpContentCategory[] = [
  'file_metadata',
  'file_safe_text',
  'ocr_metadata',
  'ocr_safe_text',
  'ai_context_summary',
  'report_export_metadata',
  'report_export_text',
  'document_preview',
] as const

export const DLP_DECLARED_ACTIONS: readonly DlpDeclaredAction[] = [
  'upload',
  'download',
  'copy',
  'export',
  'preview',
  'ai_context_assembly',
  'bulk_export',
  'bulk_download',
] as const

export const DLP_DECISION_RESULTS: readonly DlpDecisionResult[] = [
  'allow',
  'block',
  'mask',
  'warn_confirm',
  'mask_confirm',
  'audit_only',
] as const

export const DLP_REDACTION_MODES: readonly DlpRedactionMode[] = [
  'mask_prefix',
  'mask_middle',
  'mask_suffix',
  'hash_only',
  'full_mask',
  'no_redaction',
] as const

export const DLP_WARNING_CODES: readonly DlpWarningCode[] = [
  'DLP_UNAVAILABLE',
  'SCAN_INPUT_TOO_LARGE',
  'SCAN_TIME_WINDOW_EXCEEDED',
  'SCAN_BATCH_LIMIT_EXCEEDED',
  'SCAN_ITEM_COUNT_EXCEEDED',
  'SCAN_FILE_SIZE_EXCEEDED',
  'POLICY_STALE',
  'PREVIEW_EXPIRED',
  'CONFIRMATION_STALE',
  'ADAPTER_UNAVAILABLE',
  'MANDATORY_RULE_CANNOT_BE_DISABLED',
  'PROJECT_OVERRIDE_CANNOT_WEAKEN',
  'CROSS_ORGANIZATION_DENIED',
  'PERMISSION_DENIED',
  'REDACTED_EVENT_DETAILS',
] as const

export const DLP_EVENT_TYPES: readonly DlpEventType[] = [
  'policy_update',
  'preview_created',
  'decision_confirmed',
  'decision_blocked',
  'decision_masked',
  'decision_allowed',
  'decision_audit_only',
  'stale_block',
  'adapter_unavailable',
  'permission_denied',
] as const

export const DLP_CONFIRMATION_STATUSES: readonly DlpConfirmationStatus[] = [
  'pending',
  'confirmed',
  'expired',
  'stale',
  'rejected',
] as const

/** 系统强制规则（不可通过项目覆盖禁用） */
export const DLP_MANDATORY_RULES: readonly DlpRuleId[] = [
  'credential_api_key',
  'credential_token',
  'credential_password_field',
  'credential_authorization_header',
] as const

/** 密码字段名称集合（大小写不敏感） */
export const DLP_PASSWORD_FIELD_NAMES: readonly string[] = [
  'password',
  'passwordHash',
  'password_hash',
  'passwd',
  'pwd',
  'secret',
  'client_secret',
  'apiSecret',
  'api_secret',
] as const

/** 禁止键集合（大小写不敏感检测，这些键的原始值绝不进入 DLP 输出） */
export const DLP_FORBIDDEN_KEYS: readonly string[] = [
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
  // 以下为水印适配器（AI 上下文 / 文件下载 / OCR 复制导出 / 报表导出）实际会
  // 传入的原文与路径键。原先只登记了凭据类键，四个适配器的正文字段整批漏网。
  // 每个键都登记 camelCase 与 snake_case 两种写法：`isForbiddenKey` 只做
  // 大小写归一，不做命名风格归一，`sourceContent` 拦不住 `source_text`。
  'providerPayload',
  'provider_payload',
  'sourceContent',
  'source_content',
  'sourceText',
  'source_text',
  'sourcePath',
  'source_path',
  'absolutePath',
  'absolute_path',
  'tempPath',
  'temp_path',
  'rawText',
  'raw_text',
  'rawOcrText',
  'raw_ocr_text',
  'ocrText',
  'ocr_text',
  'ocrFullText',
  'ocr_full_text',
  'ocrRaw',
  'ocr_raw',
  'reportBody',
  'report_body',
  'reportContent',
  'report_content',
  'fileContent',
  'file_content',
] as const

/** 预览签名 TTL（秒） */
export const DLP_PREVIEW_SIGNATURE_TTL_SECONDS = 300

/** 扫描输入文本最大长度 */
export const DLP_MAX_SCAN_TEXT_LENGTH = 100_000

/** 扫描输入最大文件大小（字节） */
export const DLP_MAX_SCAN_FILE_SIZE = 10 * 1024 * 1024

/** 扫描最大条目数 */
export const DLP_MAX_SCAN_ITEM_COUNT = 1_000

/** 批量扫描最大项数 */
export const DLP_MAX_BATCH_SIZE = 100

/** 扫描时间窗口（秒） */
export const DLP_SCAN_TIME_WINDOW_SECONDS = 60

/** 每条规则的最大匹配数 */
export const DLP_MAX_MATCHES_PER_RULE = 100

/** 事件列表每页最大条数 */
export const DLP_EVENT_MAX_PER_PAGE = 100

/** 事件列表默认每页条数 */
export const DLP_EVENT_DEFAULT_PER_PAGE = 20

// ─── 接口 ──────────────────────────────────────────────────────────────────────────

/** DLP 规则定义 */
export interface DlpRuleDefinition {
  ruleId: DlpRuleId
  category: DlpRuleCategory
  severity: DlpSeverity
  defaultAction: DlpAction
  isMandatory: boolean
  description: string
  /** 脱敏模式 */
  redactionMode: DlpRedactionMode
}

/** DLP 策略版本 */
export interface DlpPolicyVersion {
  id: number
  organizationId: number
  scope: DlpPolicyScope
  version: number
  policyHash: string
  enabledRules: DlpRuleId[]
  ruleActions: Partial<Record<DlpRuleId, DlpAction>>
  status: DlpPolicyVersionStatus
  createdBy: number
  createdAt: string
  supersededAt: string | null
}

/** DLP 项目覆盖 */
export interface DlpProjectOverride {
  id: number
  organizationId: number
  projectId: number
  policyHash: string
  enabledRules: DlpRuleId[]
  ruleActions: Partial<Record<DlpRuleId, DlpAction>>
  createdBy: number
  createdAt: string
  updatedAt: string
}

/** DLP 扫描输入 */
export interface DlpScanInput {
  contentCategory: DlpContentCategory
  declaredAction: DlpDeclaredAction
  sourceHash: string
  text: string
  textLength: number
  fileSize: number | null
  fileName: string | null
  mimeType: string | null
  itemCount: number
  metadata: Record<string, string>
}

/** DLP 匹配摘要 */
export interface DlpMatchSummary {
  ruleId: DlpRuleId
  category: DlpRuleCategory
  severity: DlpSeverity
  count: number
  maskedSample: string | null
  sampleHash: string | null
  reasonCode: string
  confidence: 'high' | 'medium' | 'low'
}

/** DLP 决策快照 */
export interface DlpDecisionSnapshot {
  actorId: number
  organizationId: number
  projectId: number | null
  action: DlpDeclaredAction
  sourceRef: string
  sourceHash: string
  policyHash: string
  policyVersion: number
  effectiveScope: DlpPolicyScope
  visibilityEvidence: string
  matchSummary: DlpMatchSummary[]
  result: DlpDecisionResult
  requiredFollowUp: DlpAction | null
  reasonCodes: string[]
  decisionHash: string
  expiresAt: string | null
  createdAt: string
}

/** DLP 预览签名 */
export interface DlpPreviewSignature {
  signature: string
  policyHash: string
  sourceHash: string
  decisionHash: string
  matchSummary: DlpMatchSummary[]
  redactionSummary: string
  requiresConfirmation: boolean
  expiresAt: string
  createdAt: string
}

/** DLP 确认请求 */
export interface DlpConfirmationRequest {
  previewSignature: string
  actorId: number
  organizationId: number
  projectId: number | null
  policyHash: string
  sourceHash: string
  action: DlpDeclaredAction
}

/** DLP 确认结果 */
export interface DlpConfirmationResult {
  status: DlpConfirmationStatus
  decisionHash: string
  reasonCodes: string[]
  confirmedAt: string | null
}

/** DLP 事件条目 */
export interface DlpEventEntry {
  id: number
  organizationId: number
  projectId: number | null
  actorId: number
  eventType: DlpEventType
  action: DlpDeclaredAction | null
  result: DlpDecisionResult | null
  ruleIds: DlpRuleId[]
  severityCounts: Partial<Record<DlpSeverity, number>>
  decisionHash: string | null
  policyHash: string | null
  sourceHash: string | null
  previewSignature: string | null
  warningCodes: DlpWarningCode[]
  createdAt: string
}

/** DLP 策略摘要 */
export interface DlpPolicySummary {
  policyHash: string
  policyVersion: number
  effectiveScope: DlpPolicyScope
  enabledRuleCount: number
  enabledRules: DlpRuleId[]
  actionMatrix: Partial<Record<DlpRuleId, DlpAction>>
  warningCodes: DlpWarningCode[]
}

/** DLP 规则目录条目 */
export interface DlpRuleCatalogEntry {
  ruleId: DlpRuleId
  category: DlpRuleCategory
  severity: DlpSeverity
  defaultAction: DlpAction
  isMandatory: boolean
  description: string
  redactionMode: DlpRedactionMode
}

/** DLP 集成状态 */
export type DlpAdapterStatus = 'available' | 'unavailable' | 'degraded'

/** DLP 适配器健康状态 */
export interface DlpAdapterHealth {
  adapterName: string
  status: DlpAdapterStatus
  lastCheckedAt: string | null
  warningCode: DlpWarningCode | null
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────────────

export function isDlpRuleId(v: unknown): v is DlpRuleId {
  return DLP_RULE_IDS.includes(v as DlpRuleId)
}

export function isDlpRuleCategory(v: unknown): v is DlpRuleCategory {
  return DLP_RULE_CATEGORIES.includes(v as DlpRuleCategory)
}

export function isDlpSeverity(v: unknown): v is DlpSeverity {
  return DLP_SEVERITIES.includes(v as DlpSeverity)
}

export function isDlpAction(v: unknown): v is DlpAction {
  return DLP_ACTIONS.includes(v as DlpAction)
}

export function isDlpPolicyScope(v: unknown): v is DlpPolicyScope {
  return DLP_POLICY_SCOPES.includes(v as DlpPolicyScope)
}

export function isDlpContentCategory(v: unknown): v is DlpContentCategory {
  return DLP_CONTENT_CATEGORIES.includes(v as DlpContentCategory)
}

export function isDlpDeclaredAction(v: unknown): v is DlpDeclaredAction {
  return DLP_DECLARED_ACTIONS.includes(v as DlpDeclaredAction)
}

export function isDlpDecisionResult(v: unknown): v is DlpDecisionResult {
  return DLP_DECISION_RESULTS.includes(v as DlpDecisionResult)
}

export function isDlpRedactionMode(v: unknown): v is DlpRedactionMode {
  return DLP_REDACTION_MODES.includes(v as DlpRedactionMode)
}

export function isDlpWarningCode(v: unknown): v is DlpWarningCode {
  return DLP_WARNING_CODES.includes(v as DlpWarningCode)
}

export function isDlpEventType(v: unknown): v is DlpEventType {
  return DLP_EVENT_TYPES.includes(v as DlpEventType)
}

export function isDlpConfirmationStatus(v: unknown): v is DlpConfirmationStatus {
  return DLP_CONFIRMATION_STATUSES.includes(v as DlpConfirmationStatus)
}

// ─── 纯函数 ────────────────────────────────────────────────────────────────────────

/**
 * 稳定 FNV-1a hash（纯 JS 实现，确保跨运行时确定性）。
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
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
 * 计算 DLP 策略 hash。
 * 基于 enabledRules + ruleActions + scope + organizationId 的稳定签名。
 */
export function computePolicyHash(params: {
  enabledRules: DlpRuleId[]
  ruleActions: Partial<Record<DlpRuleId, DlpAction>>
  scope: DlpPolicyScope
  organizationId: number
}): string {
  return computeStableSignature({
    enabledRules: [...params.enabledRules].sort(),
    ruleActions: Object.keys(params.ruleActions)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = params.ruleActions[key as DlpRuleId]
        return acc
      }, {}),
    scope: params.scope,
    organizationId: params.organizationId,
  })
}

/**
 * 计算 DLP 决策 hash。
 * 基于 actorId + organizationId + action + sourceHash + policyHash + matchSummary 的稳定签名。
 */
export function computeDecisionHash(params: {
  actorId: number
  organizationId: number
  projectId: number | null
  action: DlpDeclaredAction
  sourceHash: string
  policyHash: string
  visibilityEvidence: string
}): string {
  return computeStableSignature({
    actorId: params.actorId,
    organizationId: params.organizationId,
    projectId: params.projectId,
    action: params.action,
    sourceHash: params.sourceHash,
    policyHash: params.policyHash,
    visibilityEvidence: params.visibilityEvidence,
  })
}

/**
 * 计算 DLP 预览签名。
 * 基于 decisionHash + expiresAt 的稳定签名。
 */
export function computePreviewSignature(params: {
  decisionHash: string
  expiresAt: string
}): string {
  return computeStableSignature({
    decisionHash: params.decisionHash,
    expiresAt: params.expiresAt,
  })
}

/**
 * 计算 source hash。
 * 基于 sourceRef + 内容摘要的稳定 hash。
 */
export function computeSourceHash(sourceRef: string, contentDigest: string): string {
  return fnv1aHash(`${sourceRef}:${contentDigest}`)
}

/**
 * 校验 DLP 动作是否合法。
 */
export function isValidDlpAction(v: unknown): v is DlpAction {
  return isDlpAction(v)
}

/**
 * 校验未知 action 是否合法——如果未知则返回 false。
 */
export function isKnownAction(action: string): action is DlpDeclaredAction {
  return DLP_DECLARED_ACTIONS.includes(action as DlpDeclaredAction)
}

/**
 * 检查是否违反系统强制规则——项目覆盖不能禁用强制规则。
 * 返回被禁用的强制规则列表。
 */
export function findViolatedMandatoryRules(enabledRules: DlpRuleId[]): DlpRuleId[] {
  const enabledSet = new Set(enabledRules)
  return DLP_MANDATORY_RULES.filter((rule) => !enabledSet.has(rule))
}

/**
 * 检查项目覆盖是否削弱了系统强制规则。
 * projectOverrideActions 被禁用或设为非 block 的强制规则返回为违规。
 */
export function findWeakenedMandatoryRules(
  enabledRules: DlpRuleId[],
  ruleActions: Partial<Record<DlpRuleId, DlpAction>>,
): DlpRuleId[] {
  const enabledSet = new Set(enabledRules)
  const weakened: DlpRuleId[] = []
  for (const rule of DLP_MANDATORY_RULES) {
    if (!enabledSet.has(rule)) {
      weakened.push(rule)
      continue
    }
    const action = ruleActions[rule]
    if (action && action !== 'block') {
      weakened.push(rule)
    }
  }
  return weakened
}

/**
 * 检查是否包含密码字段名（大小写不敏感）。
 */
export function isPasswordFieldName(fieldName: string): boolean {
  return DLP_PASSWORD_FIELD_NAMES.some((name) => name.toLowerCase() === fieldName.toLowerCase())
}

/**
 * 检查 key 是否在禁止键集合中（大小写不敏感）。
 */
export function isForbiddenKey(key: string): boolean {
  return DLP_FORBIDDEN_KEYS.some((forbidden) => forbidden.toLowerCase() === key.toLowerCase())
}

/**
 * 脱敏中国身份证号。
 * 保留前 6 位和后 4 位，中间用 **** 替代。
 * 格式：110101****1234
 */
export function maskIdCard(value: string): string {
  if (value.length < 10) return value.slice(0, 2) + '****'
  return value.slice(0, 6) + '****' + value.slice(-4)
}

/**
 * 脱敏手机号。
 * 保留前 3 位和后 4 位，中间用 **** 替代。
 * 格式：138****5678
 */
export function maskPhone(value: string): string {
  if (value.length < 7) return value.slice(0, 2) + '****'
  return value.slice(0, 3) + '****' + value.slice(-4)
}

/**
 * 脱敏银行卡号。
 * 保留前 4 位和后 4 位，中间用 **** 替代。
 * 格式：6222****1234
 */
export function maskBankCard(value: string): string {
  if (value.length < 8) return value.slice(0, 3) + '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/**
 * 脱敏邮箱。
 * 保留前 2 个字符和 @ 域名，中间用 *** 替代。
 * 格式：te***@example.com
 */
export function maskEmail(value: string): string {
  const atIndex = value.indexOf('@')
  if (atIndex <= 0) return value.slice(0, 2) + '***'
  const localPart = value.slice(0, atIndex)
  if (localPart.length <= 2) return localPart.slice(0, 1) + '***' + value.slice(atIndex)
  return localPart.slice(0, 2) + '***' + value.slice(atIndex)
}

/**
 * 脱敏 API key/token。
 * 保留前 4 位和后 4 位，中间用 **** 替代。
 * 格式：sk-****abcd
 */
export function maskCredential(value: string): string {
  if (value.length <= 8) return '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/**
 * 脱敏密码字段（全掩码）。
 */
export function maskPasswordField(): string {
  return '********'
}

/**
 * 通用脱敏：根据脱敏模式处理值。
 */
export function redactByMode(value: string, mode: DlpRedactionMode): string {
  switch (mode) {
    case 'mask_prefix':
      return '****' + value.slice(-4)
    case 'mask_middle':
      if (value.length <= 4) return '****'
      return value.slice(0, 2) + '****' + value.slice(-2)
    case 'mask_suffix':
      return value.slice(0, 4) + '****'
    case 'hash_only':
      return fnv1aHash(value)
    case 'full_mask':
      return '********'
    case 'no_redaction':
      return value
  }
}

/**
 * 构建扫描输入对象。
 * 自动计算 textLength 和 itemCount。
 */
export function buildScanInput(params: {
  text: string
  /**
   * 原文总长度。可选。
   *
   * 传入场景：`text` 只是被截断到 `DLP_MAX_SCAN_TEXT_LENGTH` 的采样片段，
   * 而风险分级要看**原文**多长。省略时按 `text.length` 计算。
   */
  textLength?: number
  contentCategory?: DlpContentCategory
  declaredAction?: DlpDeclaredAction
  sourceHash?: string
  fileSize?: number | null
  fileName?: string | null
  mimeType?: string | null
  itemCount?: number
  metadata?: Record<string, string>
}): DlpScanInput {
  return {
    // 默认取最保守的一档：未声明来源类别时按「文件安全文本」扫，
    // 未声明动作时按 'preview'（最低风险动作）——都不会因缺省而跳过规则。
    contentCategory: params.contentCategory ?? 'file_safe_text',
    declaredAction: params.declaredAction ?? 'preview',
    // 调用方没算 sourceHash 时就地补一个，避免为了满足签名而传空串。
    sourceHash: params.sourceHash ?? computeSourceHash('inline', fnv1aHash(params.text)),
    text: params.text,
    textLength: params.textLength ?? params.text.length,
    fileSize: params.fileSize ?? null,
    fileName: params.fileName ?? null,
    mimeType: params.mimeType ?? null,
    itemCount: params.itemCount ?? 1,
    metadata: params.metadata ?? {},
  }
}

/**
 * 校验扫描输入是否在限制范围内。
 * 返回 warning code 列表，空数组表示全部通过。
 */
export function validateScanBounds(input: DlpScanInput): DlpWarningCode[] {
  const warnings: DlpWarningCode[] = []
  if (input.textLength > DLP_MAX_SCAN_TEXT_LENGTH) {
    warnings.push('SCAN_INPUT_TOO_LARGE')
  }
  if (input.fileSize !== null && input.fileSize > DLP_MAX_SCAN_FILE_SIZE) {
    warnings.push('SCAN_FILE_SIZE_EXCEEDED')
  }
  if (input.itemCount > DLP_MAX_SCAN_ITEM_COUNT) {
    warnings.push('SCAN_ITEM_COUNT_EXCEEDED')
  }
  return warnings
}

/**
 * 校验批量扫描是否在限制范围内。
 */
export function validateBatchBounds(batchSize: number): DlpWarningCode[] {
  const warnings: DlpWarningCode[] = []
  if (batchSize > DLP_MAX_BATCH_SIZE) {
    warnings.push('SCAN_BATCH_LIMIT_EXCEEDED')
  }
  return warnings
}

/**
 * 解析策略：系统默认 + 组织策略 + 项目覆盖三层合并。
 * 返回 resolved policy summary。
 */
export function resolvePolicy(params: {
  organizationId: number
  /**
   * 以下各层均可省略。省略 = 该层没有配置，直接落到规则目录的出厂默认值，
   * 而不是「该层把规则清空了」——两者的区别在于前者仍启用全部默认规则。
   */
  systemDefaultEnabledRules?: DlpRuleId[]
  systemDefaultRuleActions?: Partial<Record<DlpRuleId, DlpAction>>
  organizationEnabledRules?: DlpRuleId[] | null
  organizationRuleActions?: Partial<Record<DlpRuleId, DlpAction>> | null
  projectOverrideEnabledRules?: DlpRuleId[] | null
  projectOverrideRuleActions?: Partial<Record<DlpRuleId, DlpAction>> | null
  scope?: DlpPolicyScope
}): DlpPolicySummary {
  // 从系统默认开始。未显式传入时用规则目录的出厂默认（全部规则 + 各自 defaultAction）。
  const catalog = getRuleCatalog()
  let enabledRules = [...(params.systemDefaultEnabledRules ?? catalog.map((e) => e.ruleId))]
  let ruleActions = {
    ...(params.systemDefaultRuleActions ??
      Object.fromEntries(catalog.map((e) => [e.ruleId, e.defaultAction]))),
  }

  // 合并组织策略（组织策略可以收紧）
  if (params.organizationEnabledRules) {
    enabledRules = params.organizationEnabledRules
  }
  if (params.organizationRuleActions) {
    ruleActions = { ...ruleActions, ...params.organizationRuleActions }
  }

  // 合并项目覆盖（项目覆盖只能收紧，不能禁用强制规则）
  if (params.projectOverrideEnabledRules) {
    enabledRules = params.projectOverrideEnabledRules
  }
  if (params.projectOverrideRuleActions) {
    ruleActions = { ...ruleActions, ...params.projectOverrideRuleActions }
  }

  // 确保强制规则始终启用且动作为 block
  for (const rule of DLP_MANDATORY_RULES) {
    if (!enabledRules.includes(rule)) {
      enabledRules.push(rule)
    }
    ruleActions[rule] = 'block'
  }

  // 未显式声明 scope 时，由「实际参与合并的最细一层」反推，
  // 而不是固定回落到 'system'——否则组织级配置生效了，policyHash
  // 却按系统级算，两个不同的策略会撞出同一个 hash。
  const scope: DlpPolicyScope =
    params.scope ??
    (params.projectOverrideEnabledRules || params.projectOverrideRuleActions
      ? 'project'
      : params.organizationEnabledRules || params.organizationRuleActions
        ? 'organization'
        : 'system')

  const warnings: DlpWarningCode[] = []
  const policyHash = computePolicyHash({
    enabledRules,
    ruleActions,
    scope,
    organizationId: params.organizationId,
  })

  return {
    policyHash,
    policyVersion: 1,
    effectiveScope: scope,
    enabledRuleCount: enabledRules.length,
    enabledRules,
    actionMatrix: ruleActions,
    warningCodes: warnings,
  }
}

/**
 * 将 DLP 规则定义转换为规则目录条目。
 */
export function buildRuleCatalogEntry(rule: DlpRuleDefinition): DlpRuleCatalogEntry {
  return {
    ruleId: rule.ruleId,
    category: rule.category,
    severity: rule.severity,
    defaultAction: rule.defaultAction,
    isMandatory: rule.isMandatory,
    description: rule.description,
    redactionMode: rule.redactionMode,
  }
}

/**
 * 构建 DLP 事件条目（低敏，只包含 hash/枚举/计数，不含原始文本）。
 */
export function buildDlpEventEntry(params: {
  organizationId: number
  projectId: number | null
  actorId: number
  eventType: DlpEventType
  action: DlpDeclaredAction | null
  result: DlpDecisionResult | null
  ruleIds: DlpRuleId[]
  severityCounts: Partial<Record<DlpSeverity, number>>
  decisionHash: string | null
  policyHash: string | null
  sourceHash: string | null
  previewSignature: string | null
  warningCodes: DlpWarningCode[]
}): DlpEventEntry {
  return {
    id: 0,
    organizationId: params.organizationId,
    projectId: params.projectId,
    actorId: params.actorId,
    eventType: params.eventType,
    action: params.action,
    result: params.result,
    ruleIds: params.ruleIds,
    severityCounts: params.severityCounts,
    decisionHash: params.decisionHash,
    policyHash: params.policyHash,
    sourceHash: params.sourceHash,
    previewSignature: params.previewSignature,
    warningCodes: params.warningCodes,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 根据规则 ID 获取默认规则定义。
 */
export function getDefaultRuleDefinition(ruleId: DlpRuleId): DlpRuleDefinition {
  const definitions: Record<DlpRuleId, DlpRuleDefinition> = {
    pii_id_card: {
      ruleId: 'pii_id_card',
      category: 'pii',
      severity: 'high',
      defaultAction: 'mask',
      isMandatory: false,
      description: '中国大陆身份证号匹配',
      redactionMode: 'mask_middle',
    },
    pii_phone: {
      ruleId: 'pii_phone',
      category: 'pii',
      severity: 'medium',
      defaultAction: 'mask',
      isMandatory: false,
      description: '中国大陆手机号匹配',
      redactionMode: 'mask_middle',
    },
    pii_email: {
      ruleId: 'pii_email',
      category: 'pii',
      severity: 'medium',
      defaultAction: 'mask',
      isMandatory: false,
      description: '邮箱地址匹配',
      redactionMode: 'mask_middle',
    },
    financial_bank_card: {
      ruleId: 'financial_bank_card',
      category: 'financial',
      severity: 'high',
      defaultAction: 'mask',
      isMandatory: false,
      description: '银行卡号匹配',
      redactionMode: 'mask_middle',
    },
    credential_api_key: {
      ruleId: 'credential_api_key',
      category: 'credential',
      severity: 'critical',
      defaultAction: 'block',
      isMandatory: true,
      description: 'API key/token 匹配',
      redactionMode: 'mask_prefix',
    },
    credential_token: {
      ruleId: 'credential_token',
      category: 'credential',
      severity: 'critical',
      defaultAction: 'block',
      isMandatory: true,
      description: 'Access/Refresh Token 匹配',
      redactionMode: 'mask_prefix',
    },
    credential_password_field: {
      ruleId: 'credential_password_field',
      category: 'credential',
      severity: 'critical',
      defaultAction: 'block',
      isMandatory: true,
      description: '密码字段值匹配',
      redactionMode: 'full_mask',
    },
    credential_authorization_header: {
      ruleId: 'credential_authorization_header',
      category: 'credential',
      severity: 'critical',
      defaultAction: 'block',
      isMandatory: true,
      description: 'Authorization 头匹配',
      redactionMode: 'full_mask',
    },
    internal_keyword: {
      ruleId: 'internal_keyword',
      category: 'internal_keyword',
      severity: 'low',
      defaultAction: 'audit_only',
      isMandatory: false,
      description: '内部关键词匹配',
      redactionMode: 'hash_only',
    },
    high_risk_combination: {
      ruleId: 'high_risk_combination',
      category: 'high_risk_combination',
      severity: 'critical',
      defaultAction: 'warn_confirm',
      isMandatory: false,
      description: '高风组合匹配（姓名+身份证/手机号）',
      redactionMode: 'mask_middle',
    },
  }
  return definitions[ruleId]
}

/**
 * 获取所有规则目录。
 */
export function getRuleCatalog(): DlpRuleCatalogEntry[] {
  return DLP_RULE_IDS.map((ruleId) => buildRuleCatalogEntry(getDefaultRuleDefinition(ruleId)))
}

/**
 * 根据 action 判断是否需要预览确认。
 */
export function requiresConfirmation(action: DlpAction): boolean {
  return action === 'warn_confirm' || action === 'mask_confirm'
}

/**
 * 根据动作结果判断是否需要预览。
 */
export function isHighRiskAction(action: DlpDeclaredAction): boolean {
  return action === 'bulk_export' || action === 'bulk_download' || action === 'ai_context_assembly'
}
