/**
 * V3 OCR Review Confirmation Flow — 共享契约与确定性纯函数引擎
 *
 * 定义 OCR 审查状态、候选选择、确认预览、已接受提取记录的枚举/接口/类型守卫/纯函数。
 * 与 `ai-ocr.ts`（OCR 预览）互补，不重复定义其类型。
 *
 * 此文件为 Section 2（Shared Review Contract）的主产出物。
 */

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** OCR 审查作业的聚合状态（派生自上游 job + candidates + accepted extractions） */
export const OCR_REVIEW_STATUSES = [
  'reviewable',
  'partially_reviewable',
  'fully_accepted',
  'stale_source',
  'failed',
  'canceled',
] as const
export type OcrReviewStatus = (typeof OCR_REVIEW_STATUSES)[number]

/** 候选文本的选择模式 */
export const OCR_SELECTION_MODES = ['full', 'partial', 'page'] as const
export type OcrSelectionMode = (typeof OCR_SELECTION_MODES)[number]

/** 确认预览的生成状态 */
export const OCR_CONFIRMATION_PREVIEW_STATUSES = ['ready', 'stale', 'invalid'] as const
export type OcrConfirmationPreviewStatus = (typeof OCR_CONFIRMATION_PREVIEW_STATUSES)[number]

/** 已接受提取记录的状态 */
export const OCR_ACCEPTED_EXTRACTION_STATUSES = ['current', 'superseded'] as const
export type OcrAcceptedExtractionStatus = (typeof OCR_ACCEPTED_EXTRACTION_STATUSES)[number]

/** OCR 审查工作台中允许的动作（由后端根据权限和状态派生） */
export const OCR_REVIEW_ALLOWED_ACTIONS = [
  'view',
  'select',
  'preview_confirmation',
  'confirm',
  'supersede',
  'copy',
  'export',
] as const
export type OcrReviewAllowedAction = (typeof OCR_REVIEW_ALLOWED_ACTIONS)[number]

/** 候选数据变陈旧的原因 */
export const OCR_STALE_REASONS = [
  'source_version_changed',
  'source_hash_mismatch',
  'attachment_replaced',
  'document_edited',
  'file_deleted',
] as const
export type OcrStaleReason = (typeof OCR_STALE_REASONS)[number]

/** OCR 审查审计动作 */
export const OCR_REVIEW_AUDIT_ACTIONS = [
  'OCR_REVIEW_OPEN',
  'OCR_REVIEW_SELECTION_UPDATED',
  'OCR_REVIEW_CONFIRMATION_PREVIEW',
  'OCR_REVIEW_CONFIRMATION_SAVED',
  'OCR_REVIEW_SUPERSEDED',
  'OCR_REVIEW_STALE_BLOCKED',
  'OCR_REVIEW_COPY_EXPORT',
  'OCR_REVIEW_PERMISSION_DENIED',
] as const
export type OcrReviewAuditAction = (typeof OCR_REVIEW_AUDIT_ACTIONS)[number]

// ─── 共享 DTO ──────────────────────────────────────────────────────────────

/** 来源摘要——上游 OCR job 的文件/附件引用（脱敏后） */
export interface OcrReviewSourceSummary {
  sourceKind: 'attachment' | 'document' | 'unknown'
  sourceId: number | null
  sourceName: string | null
  sourceHash: string | null
  sourceVersion: number | null
  mimeType: string | null
  /** 来源是否对当前用户可见 */
  visible: boolean
}

/** 单页的候选分组 */
export interface OcrReviewPageGroup {
  pageIndex: number
  pageLabel: string
  candidateStatus: 'succeeded' | 'failed' | 'degraded'
  candidateHash: string | null
  extractedText: string | null
  confidenceSummary: OcrReviewConfidenceSummary | null
  warningCodes: string[]
  providerModel: string | null
  completedAt: string | null
}

/** 置信度摘要（脱敏，不含原始 provider 分数） */
export interface OcrReviewConfidenceSummary {
  level: 'high' | 'medium' | 'low' | 'unknown'
  label: string
}

/** 单条候选审查项 */
export interface OcrReviewCandidateItem {
  candidateId: number
  pageRefs: number[]
  candidateHash: string
  sourceHash: string
  status: 'succeeded' | 'failed'
  extractedText: string
  warningCodes: string[]
  confidenceSummary: OcrReviewConfidenceSummary | null
  providerModel: string | null
  createdAt: string | null
}

/** 警告徽章摘要 */
export interface OcrReviewWarningSummary {
  totalWarnings: number
  topCodes: string[]
  hasFailures: boolean
}

/** 审查详情响应 */
export interface OcrReviewDetailResponse {
  sourceSummary: OcrReviewSourceSummary
  jobStatus: OcrReviewStatus
  jobId: number
  providerLabel: string | null
  modelLabel: string | null
  pageGroups: OcrReviewPageGroup[]
  candidateItems: OcrReviewCandidateItem[]
  warningSummary: OcrReviewWarningSummary
  acceptedExtractions: OcrAcceptedExtractionSummary[]
  allowedActions: OcrReviewAllowedAction[]
  staleReason: OcrStaleReason | null
}

/** 已接受提取的摘要（不含完整文本） */
export interface OcrAcceptedExtractionSummary {
  extractionId: number
  sourceHash: string
  candidateHash: string
  selectedTextHash: string
  pageRefs: number[]
  status: OcrAcceptedExtractionStatus
  reviewerId: number | null
  reviewerName: string | null
  reviewNote: string | null
  confirmedAt: string | null
  supersededAt: string | null
}

/** 已接受提取的详情（含完整选中文本，仅权限用户可见） */
export interface OcrAcceptedExtractionDetail extends OcrAcceptedExtractionSummary {
  selectedText: string
  supersededById: number | null
}

/** 选择请求 */
export interface OcrReviewSelectionRequest {
  candidateId: number
  mode: OcrSelectionMode
  selectedText: string
  pageRefs: number[]
}

/** 确认预览请求 */
export interface OcrConfirmationPreviewRequest {
  selection: OcrReviewSelectionRequest
  reviewNote?: string | null
}

/** 确认预览响应 */
export interface OcrConfirmationPreviewResponse {
  previewHash: string
  sourceHash: string
  candidateHash: string
  selectedTextHash: string
  selectedText: string
  pageRefs: number[]
  redlineSummary: OcrConfirmationRedlineSummary
  requiresExplicitConfirmation: true
}

/** 确认保存请求 */
export interface OcrConfirmationSaveRequest {
  previewHash: string
  selection: OcrReviewSelectionRequest
  reviewNote?: string | null
}

/** 红线摘要——确认不会变更的下游系统清单 */
export interface OcrConfirmationRedlineSummary {
  tasks: 'unchanged'
  wbs: 'unchanged'
  risks: 'unchanged'
  reports: 'unchanged'
  documentBody: 'unchanged'
  compilerArtifacts: 'unchanged'
  aiDrafts: 'unchanged'
  searchIndexes: 'unchanged'
  knowledgeBases: 'unchanged'
  externalSystems: 'unchanged'
}

/** 已接受提取的列表元数据 */
export interface OcrAcceptedExtractionListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

export function isOcrReviewStatus(value: unknown): value is OcrReviewStatus {
  return typeof value === 'string' && (OCR_REVIEW_STATUSES as readonly string[]).includes(value)
}

export function isOcrSelectionMode(value: unknown): value is OcrSelectionMode {
  return typeof value === 'string' && (OCR_SELECTION_MODES as readonly string[]).includes(value)
}

export function isOcrConfirmationPreviewStatus(
  value: unknown,
): value is OcrConfirmationPreviewStatus {
  return (
    typeof value === 'string' &&
    (OCR_CONFIRMATION_PREVIEW_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrAcceptedExtractionStatus(
  value: unknown,
): value is OcrAcceptedExtractionStatus {
  return (
    typeof value === 'string' &&
    (OCR_ACCEPTED_EXTRACTION_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrReviewAllowedAction(value: unknown): value is OcrReviewAllowedAction {
  return (
    typeof value === 'string' && (OCR_REVIEW_ALLOWED_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrStaleReason(value: unknown): value is OcrStaleReason {
  return typeof value === 'string' && (OCR_STALE_REASONS as readonly string[]).includes(value)
}

// ─── 纯函数：哈希 ──────────────────────────────────────────────────────────

/**
 * 简单确定性文本哈希（SHA-256 的前 16 个十六进制字符）。
 * 不依赖 Node crypto——使用纯 JavaScript 实现的快速哈希（FNV-1a + 额外混合）。
 * 仅用于源/候选/选中文本的匹配比较，非加密用途。
 */
function fnv1aHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash >>>= 0
  }
  return hash
}

/** 将 32 位整数转为 8 字符十六进制字符串 */
function toHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

/** 计算选中文本的确定性哈希 */
export function computeSelectedTextHash(selectedText: string): string {
  const normalized = selectedText.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return toHex8(fnv1aHash(normalized))
}

/** 计算确认预览的确定性哈希 */
export function computePreviewHash(
  sourceHash: string,
  candidateHash: string,
  selectedTextHash: string,
  pageRefs: number[],
): string {
  const input = `${sourceHash}|${candidateHash}|${selectedTextHash}|${pageRefs.join(',')}`
  return toHex8(fnv1aHash(input))
}

/** 计算已接受提取的确定性哈希 */
export function computeAcceptedExtractionHash(
  sourceHash: string,
  candidateHash: string,
  selectedTextHash: string,
  reviewerId: number,
  confirmedAt: string,
): string {
  const input = `${sourceHash}|${candidateHash}|${selectedTextHash}|${reviewerId}|${confirmedAt}`
  return toHex8(fnv1aHash(input))
}

// ─── 纯函数：来源新鲜度比较 ────────────────────────────────────────────────

/**
 * 比较来源哈希是否一致。返回 true 表示陈旧。
 * 任意一方为 null 视为陈旧（缺少比较基准）。
 */
export function isSourceHashStale(
  currentHash: string | null,
  candidateHash: string | null,
): boolean {
  if (currentHash === null || candidateHash === null) return true
  return currentHash !== candidateHash
}

// ─── 纯函数：允许动作解析 ──────────────────────────────────────────────────

/**
 * 根据权限和候选状态解析允许的动作集合。
 * `canConfirm` = file:manage + AI confirm 权限 + 非 stale。
 */
export function resolveAllowedActions(params: {
  canView: boolean
  canConfirm: boolean
  isStale: boolean
  hasCandidates: boolean
  hasAcceptedExtractions: boolean
}): OcrReviewAllowedAction[] {
  const actions: OcrReviewAllowedAction[] = []
  if (params.canView) {
    actions.push('view')
    if (params.hasCandidates) actions.push('select')
    if (params.hasAcceptedExtractions) {
      actions.push('copy')
      actions.push('export')
    }
  }
  if (params.canConfirm && !params.isStale) {
    actions.push('preview_confirmation')
    actions.push('confirm')
    if (params.hasAcceptedExtractions) actions.push('supersede')
  }
  return actions
}

// ─── 纯函数：红线摘要生成 ──────────────────────────────────────────────────

/** 生成确定性红线摘要（始终返回相同的不可变对象） */
export function buildRedlineSummary(): OcrConfirmationRedlineSummary {
  return {
    tasks: 'unchanged',
    wbs: 'unchanged',
    risks: 'unchanged',
    reports: 'unchanged',
    documentBody: 'unchanged',
    compilerArtifacts: 'unchanged',
    aiDrafts: 'unchanged',
    searchIndexes: 'unchanged',
    knowledgeBases: 'unchanged',
    externalSystems: 'unchanged',
  }
}

// ─── 纯函数：脱敏 ──────────────────────────────────────────────────────────

const AUDIT_REDACT_PATTERNS: RegExp[] = [
  /api[-_]?key/i,
  /authorization/i,
  /token/i,
  /secret/i,
  /password/i,
  /prompt/i,
  /dataurl/i,
  /base64/i,
  /raw[-_]?body/i,
  /absolute[-_]?path/i,
]

/** 审计脱敏：递归移除敏感字段值，替换为 `[REDACTED]` */
export function redactAuditMetadata(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(redactAuditMetadata)
  }
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (AUDIT_REDACT_PATTERNS.some((p) => p.test(key))) {
      result[key] = '[REDACTED]'
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactAuditMetadata(val)
    } else {
      result[key] = val
    }
  }
  return result
}

/** 审计元数据构建：只保留哈希和引用，移除完整文本 */
export function buildAuditMetadata(params: {
  actorId: number
  organizationId: number
  projectId: number
  sourceHash?: string | null
  candidateHash?: string | null
  selectedTextHash?: string | null
  extractionId?: number | null
  warningCodes?: string[]
  action: OcrReviewAuditAction
  denialReason?: string | null
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    actor: params.actorId,
    org: params.organizationId,
    project: params.projectId,
    action: params.action,
  }
  if (params.sourceHash) meta.sourceHash = params.sourceHash
  if (params.candidateHash) meta.candidateHash = params.candidateHash
  if (params.selectedTextHash) meta.selectedTextHash = params.selectedTextHash
  if (params.extractionId !== undefined && params.extractionId !== null)
    meta.extractionId = params.extractionId
  if (params.warningCodes && params.warningCodes.length > 0) meta.warningCodes = params.warningCodes
  if (params.denialReason) meta.denialReason = params.denialReason
  return redactAuditMetadata(meta) as Record<string, unknown>
}
