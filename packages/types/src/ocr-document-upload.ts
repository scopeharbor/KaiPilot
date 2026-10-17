// v3-ocr-document-upload-flow —— OCR 文档上传/选择作业与候选审查共享契约（前后端共享）。
//
// 本文件定义 OCR 文档作业的生命周期状态、页面候选、警告代码、输入归一化、
// 幂等键/源哈希/候选文本哈希/确认哈希的纯函数、状态转换校验、stale 检测和
// 低敏审计/脱敏助手。

import type { OcrSupportedImageMimeType } from './ai-ocr.js'

// ---------------------------------------------------------------------------
// 枚举：作业状态 / 页面状态 / 候选状态 / 警告代码 / 来源类型 / 提供方错误
// ---------------------------------------------------------------------------

export const OCR_DOCUMENT_JOB_STATUSES = [
  'queued',
  'normalizing',
  'processing',
  'reviewable',
  'failed',
  'canceled',
] as const
export type OcrDocumentJobStatus = (typeof OCR_DOCUMENT_JOB_STATUSES)[number]

export const OCR_DOCUMENT_PAGE_STATUSES = [
  'pending',
  'normalizing',
  'queued',
  'processing',
  'succeeded',
  'failed',
  'skipped',
] as const
export type OcrDocumentPageStatus = (typeof OCR_DOCUMENT_PAGE_STATUSES)[number]

export const OCR_DOCUMENT_CANDIDATE_STATUSES = ['pending', 'ready', 'failed', 'stale'] as const
export type OcrDocumentCandidateStatus = (typeof OCR_DOCUMENT_CANDIDATE_STATUSES)[number]

export const OCR_DOCUMENT_WARNING_CODES = [
  'LOW_CONFIDENCE',
  'PARTIAL_PAGE_FAILURE',
  'UNSUPPORTED_PAGE',
  'PROVIDER_DEGRADATION',
  // provider 调用抛异常导致该页失败（区别于 PROVIDER_DEGRADATION 的降级可用）
  'PROVIDER_UNAVAILABLE',
  'NORMALIZATION_WARNING',
  'PAGE_OVERFLOW',
  'PAYLOAD_OVERSIZE',
  'PIXEL_OVERFLOW',
  'TIMEOUT_RISK',
  'PDF_NORMALIZER_UNAVAILABLE',
  'UNSUPPORTED_MIME',
  'MALFORMED_FILE',
  'STALE_SOURCE',
  // 访问控制类：候选/作业不属于当前项目或调用方无权访问
  'PERMISSION_DENIED',
] as const
export type OcrDocumentWarningCode = (typeof OCR_DOCUMENT_WARNING_CODES)[number]

export const OCR_DOCUMENT_SOURCE_KINDS = ['upload', 'attachment'] as const
export type OcrDocumentSourceKind = (typeof OCR_DOCUMENT_SOURCE_KINDS)[number]

export const OCR_DOCUMENT_PROVIDER_ERROR_KINDS = [
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'MODEL_CAPABILITY_MISMATCH',
  'MODEL_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_MALFORMED_RESPONSE',
  'NORMALIZATION_FAILED',
  'AI_SERVICE_ERROR',
] as const
export type OcrDocumentProviderErrorKind = (typeof OCR_DOCUMENT_PROVIDER_ERROR_KINDS)[number]

export const OCR_DOCUMENT_EXTRACTION_STATUSES = ['active', 'superseded'] as const
export type OcrDocumentExtractionStatus = (typeof OCR_DOCUMENT_EXTRACTION_STATUSES)[number]

// ---------------------------------------------------------------------------
// DTO：作业摘要 / 详情 / 页面 / 候选 / 已接受提取
// ---------------------------------------------------------------------------

export interface OcrDocumentJobSummary {
  id: number | string
  organizationId: number
  projectId: number
  sourceKind: OcrDocumentSourceKind
  sourceAttachmentId: number | null
  sourceFileName: string | null
  sourceMimeType: string | null
  sourceHash: string
  status: OcrDocumentJobStatus
  pageCount: number
  succeededPages: number
  failedPages: number
  provider: string | null
  model: string | null
  warningCodes: OcrDocumentWarningCode[]
  costSummary: OcrDocumentCostSummary | null
  idempotencyKeyHash: string | null
  createdAt: string
  updatedAt: string
}

export interface OcrDocumentJobDetail extends OcrDocumentJobSummary {
  connectionId: number | string | null
  modelId: number | string | null
  promptHint: string | null
  inputSignature: string | null
  pages: OcrDocumentPageResult[]
  warnings: OcrDocumentWarning[]
  acceptedExtractionId: number | null
  acceptedExtractionStatus: OcrDocumentExtractionStatus | null
}

export interface OcrDocumentPageResult {
  id: number | string
  jobId: number | string
  pageIndex: number
  sourceHash: string
  status: OcrDocumentPageStatus
  mimeType: string | null
  normalizedBytes: number | null
  warnings: OcrDocumentWarning[]
  candidateId: number | null
  candidateText: string | null
  candidateHash: string | null
  provider: string | null
  model: string | null
  usage: OcrDocumentProviderUsage | null
  createdAt: string
  updatedAt: string
}

export interface OcrDocumentCandidate {
  id: number | string
  jobId: number | string
  pageId: number | string
  status: OcrDocumentCandidateStatus
  extractedText: string
  textHash: string
  confidenceScore: number | null
  sourceHash: string
  provider: string | null
  model: string | null
  warnings: OcrDocumentWarning[]
  usage: OcrDocumentProviderUsage | null
  createdAt: string
}

export interface OcrDocumentWarning {
  code: OcrDocumentWarningCode
  message: string
  pageIndex?: number | null
}

export interface OcrDocumentProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface OcrDocumentCostSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  estimatedCost: number | null
  currency: string | null
}

export interface OcrDocumentAcceptedExtraction {
  id: number | string
  jobId: number | string
  sourceAttachmentId: number | null
  acceptedText: string
  acceptedTextHash: string
  pageRefs: number[]
  sourceHash: string
  reviewerId: number
  reviewNote: string | null
  status: OcrDocumentExtractionStatus
  supersededById: number | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 请求 / 响应 DTO
// ---------------------------------------------------------------------------

export interface OcrDocumentJobCreateRequest {
  sourceKind?: OcrDocumentSourceKind
  sourceAttachmentId?: number | null
  connectionId?: number | string | null
  modelId?: number | string | null
  promptHint?: string | null
  idempotencyKey?: string | null
  pageLimit?: number | null
}

export interface OcrDocumentJobRetryRequest {
  connectionId?: number | string | null
  modelId?: number | string | null
  promptHint?: string | null
  pageLimit?: number | null
}

export interface OcrDocumentConfirmationRequest {
  candidateIds: (number | string)[]
  selectedText?: string | null
  pageRefs?: number[] | null
  reviewNote?: string | null
}

export interface OcrDocumentJobListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// 归一化结果类型
// ---------------------------------------------------------------------------

export interface OcrNormalizedPage {
  pageIndex: number
  mimeType: OcrSupportedImageMimeType
  dataUrl: string
  sizeBytes: number
  widthPixels?: number | null
  heightPixels?: number | null
}

export interface OcrNormalizationResult {
  pages: OcrNormalizedPage[]
  totalPages: number
  skippedPages: number
  warnings: OcrDocumentWarning[]
}

export interface OcrNormalizationFailure {
  reason: OcrDocumentProviderErrorKind
  message: string
  warnings: OcrDocumentWarning[]
}

export type OcrNormalizationOutcome =
  { ok: true; result: OcrNormalizationResult } | { ok: false; failure: OcrNormalizationFailure }

// ---------------------------------------------------------------------------
// 配置常量
// ---------------------------------------------------------------------------

export const OCR_DOCUMENT_MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB
export const OCR_DOCUMENT_MAX_PAGES = 50
export const OCR_DOCUMENT_MAX_PAGE_BYTES = 5 * 1024 * 1024 // 5 MB per page
export const OCR_DOCUMENT_MAX_PAGE_PIXELS = 4096 * 4096 // ~16.8 MP
export const OCR_DOCUMENT_PROVIDER_TIMEOUT_MS = 180_000 // 3 min
export const OCR_DOCUMENT_MAX_OUTPUT_TOKENS = 4096
export const OCR_DOCUMENT_MAX_PROMPT_CHARS = 500

export const OCR_DOCUMENT_CONTRACT_VERSION = '1.0' as const

// ---------------------------------------------------------------------------
// 纯函数：哈希 / 幂等键 / 签名 / 状态转换 / stale 检测
// ---------------------------------------------------------------------------

/**
 * FNV-1a 64-bit 哈希（低敏摘要用，不可逆，非加密）。
 * 前端/测试可复现，与 ocr-review-confirmation 的 fnv1aHash 一致。
 */
export function ocrDocFnv1aHash(input: string): string {
  let h = BigInt('0xcbf29ce484222325')
  const fnvPrime = BigInt('0x100000001b3')
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i))
    h = (h * fnvPrime) & BigInt('0xffffffffffffffff')
  }
  return h.toString(16).padStart(16, '0')
}

/** 源哈希：attachmentId + fileName + mimeType + fileSize → fnv1a */
export function computeSourceHash(params: {
  attachmentId: number | string
  fileName: string
  mimeType: string | null
  fileSize: number | string
}): string {
  const payload = `${params.attachmentId}:${params.fileName}:${params.mimeType ?? ''}:${params.fileSize}`
  return ocrDocFnv1aHash(payload)
}

/** 幂等键归一化：trim + 上限 256 字符 */
export function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 256)
}

/** 候选文本哈希 */
export function computeCandidateTextHash(text: string): string {
  return ocrDocFnv1aHash(text)
}

/** 已接受提取哈希：textHash + sourceHash + pageRefs + reviewerId */
export function computeAcceptedExtractionHash(params: {
  textHash: string
  sourceHash: string
  pageRefs: number[]
  reviewerId: number
}): string {
  const payload = `${params.textHash}:${params.sourceHash}:${params.pageRefs.join(',')}:${params.reviewerId}`
  return ocrDocFnv1aHash(payload)
}

/** 输入签名：sourceKind + attachmentId + modelId + promptHint + pageLimit */
export function computeInputSignature(params: {
  sourceKind: OcrDocumentSourceKind
  sourceAttachmentId?: number | string | null
  modelId?: number | string | null
  promptHint?: string | null
  pageLimit?: number | null
}): string {
  const payload = [
    params.sourceKind,
    params.sourceAttachmentId ?? '',
    params.modelId ?? '',
    params.promptHint ?? '',
    params.pageLimit ?? '',
  ].join(':')
  return ocrDocFnv1aHash(payload)
}

// ---------------------------------------------------------------------------
// 状态转换校验
// ---------------------------------------------------------------------------

export const OCR_JOB_TERMINAL_STATUSES: readonly OcrDocumentJobStatus[] = [
  'reviewable',
  'failed',
  'canceled',
]

export const OCR_JOB_RETRYABLE_STATUSES: readonly OcrDocumentJobStatus[] = ['failed', 'reviewable']

export function isOcrJobTerminal(status: OcrDocumentJobStatus): boolean {
  return OCR_JOB_TERMINAL_STATUSES.includes(status)
}

export function isOcrJobRetryable(status: OcrDocumentJobStatus): boolean {
  return OCR_JOB_RETRYABLE_STATUSES.includes(status)
}

export function isValidJobStatusTransition(
  from: OcrDocumentJobStatus,
  to: OcrDocumentJobStatus,
): boolean {
  const allowed: Record<OcrDocumentJobStatus, readonly OcrDocumentJobStatus[]> = {
    queued: ['normalizing', 'processing', 'failed', 'canceled'],
    normalizing: ['processing', 'failed', 'canceled'],
    processing: ['reviewable', 'failed', 'canceled'],
    reviewable: ['processing', 'failed', 'canceled'], // retry
    failed: ['processing', 'canceled'], // retry
    canceled: [],
  }
  return (allowed[from] as readonly string[]).includes(to)
}

// ---------------------------------------------------------------------------
// Stale 检测
// ---------------------------------------------------------------------------

export function isSourceHashStale(candidateSourceHash: string, currentSourceHash: string): boolean {
  if (!candidateSourceHash || !currentSourceHash) return true
  return candidateSourceHash !== currentSourceHash
}

// ---------------------------------------------------------------------------
// 警告聚合
// ---------------------------------------------------------------------------

export function aggregateOcrWarnings(warnings: OcrDocumentWarning[]): {
  codes: OcrDocumentWarningCode[]
  summary: string
} {
  const codes = [...new Set(warnings.map((w) => w.code))]
  const summary = codes.map((c) => `[${c}]`).join(' ')
  return { codes, summary }
}

// ---------------------------------------------------------------------------
// 脱敏助手
// ---------------------------------------------------------------------------

/** 低敏提供方摘要：只保留 provider/model，不泄露 API key/URL/prompt/路径 */
export function redactProviderSummary(provider: string | null, model: string | null): string {
  return [provider, model].filter(Boolean).join('/') || 'unknown'
}

/** 脱敏审计 metadata：剔除绝对路径、API key、raw body、prompt text */
export function redactOcrAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'apiKey',
    'api_key',
    'authorization',
    'token',
    'secret',
    'password',
    'prompt',
    'dataUrl',
    'base64',
    'rawBody',
    'raw_body',
    'filePath',
    'absolutePath',
    'absolute_path',
    'storagePath',
    'storage_path',
    'fullText',
    'extractedText',
  ]
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const isSensitive = sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))
    redacted[key] = isSensitive ? '[REDACTED]' : value
  }
  return redacted
}

// ---------------------------------------------------------------------------
// 确认前置条件校验
// ---------------------------------------------------------------------------

export interface OcrConfirmationPrecondition {
  allowed: boolean
  reason?: string
  reasonCode?: OcrDocumentWarningCode
}

export function checkConfirmationPreconditions(params: {
  candidateStatus: OcrDocumentCandidateStatus
  candidateSourceHash: string
  currentSourceHash: string
  candidateBelongsToJobProject: boolean
}): OcrConfirmationPrecondition {
  if (params.candidateStatus === 'failed') {
    return { allowed: false, reason: '候选提取失败，无法确认', reasonCode: 'PROVIDER_DEGRADATION' }
  }
  if (params.candidateStatus === 'stale') {
    return { allowed: false, reason: '候选数据已过期', reasonCode: 'STALE_SOURCE' }
  }
  if (isSourceHashStale(params.candidateSourceHash, params.currentSourceHash)) {
    return {
      allowed: false,
      reason: '源文件已变更，请重新运行 OCR',
      reasonCode: 'STALE_SOURCE',
    }
  }
  if (!params.candidateBelongsToJobProject) {
    return { allowed: false, reason: '候选不属于当前项目', reasonCode: 'PERMISSION_DENIED' }
  }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// MIME 类型检查
// ---------------------------------------------------------------------------

export const OCR_DOCUMENT_SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const
export type OcrDocumentSupportedMimeType = (typeof OCR_DOCUMENT_SUPPORTED_MIME_TYPES)[number]

export function isOcrDocumentSupportedMimeType(
  value: string | null | undefined,
): value is OcrDocumentSupportedMimeType {
  return OCR_DOCUMENT_SUPPORTED_MIME_TYPES.includes(value as OcrDocumentSupportedMimeType)
}

export function isOcrDocumentImageMimeType(
  value: string | null | undefined,
): value is OcrSupportedImageMimeType {
  if (!value) return false
  return ['image/png', 'image/jpeg', 'image/webp'].includes(value)
}

// ---------------------------------------------------------------------------
// 费用摘要构建
// ---------------------------------------------------------------------------

export function buildCostSummary(usageList: OcrDocumentProviderUsage[]): OcrDocumentCostSummary {
  const totalInputTokens = usageList.reduce((sum, u) => sum + (u.inputTokens ?? 0), 0)
  const totalOutputTokens = usageList.reduce((sum, u) => sum + (u.outputTokens ?? 0), 0)
  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    estimatedCost: null,
    currency: null,
  }
}

// ---------------------------------------------------------------------------
// PDF 页面清单（manifest）—— v3-ocr-multipage-pdf-support §2.1–2.5
// ---------------------------------------------------------------------------

/** 已处理页面引用（低敏，不含 image dataUrl 或 OCR 文本） */
export interface OcrPdfProcessedPageRef {
  pageIndex: number
  mimeType: OcrSupportedImageMimeType
  sizeBytes: number
  widthPixels: number | null
  heightPixels: number | null
}

/** 被跳过的页面引用 */
export interface OcrPdfSkippedPageRef {
  pageIndex: number
  reason: 'PAGE_LIMIT_EXCEEDED' | 'RASTERIZATION_FAILED' | 'PIXEL_OVERFLOW' | 'BYTE_OVERFLOW'
  warning: OcrDocumentWarning
}

/** PDF 页面清单摘要（持久化至 job/page metadata，不含 raw bytes/text/paths） */
export interface OcrPdfPageManifest {
  sourceHash: string
  totalPages: number
  pageLimit: number | null
  processedRefs: OcrPdfProcessedPageRef[]
  skippedRefs: OcrPdfSkippedPageRef[]
  warnings: OcrDocumentWarning[]
  manifestHash: string
}

// ---------------------------------------------------------------------------
// 清单哈希——确定性，可复现，不含 raw bytes/text
// ---------------------------------------------------------------------------

/** FNV-1a 64-bit over OcrPdfPageManifest 的稳定字段 */
export function computePdfManifestHash(manifest: OcrPdfPageManifest): string {
  const payload = [
    manifest.sourceHash,
    manifest.totalPages,
    manifest.pageLimit ?? '',
    ...manifest.processedRefs.map((r) =>
      [r.pageIndex, r.mimeType, r.sizeBytes, r.widthPixels ?? '', r.heightPixels ?? ''].join(':'),
    ),
    ...manifest.skippedRefs.map((r) => [r.pageIndex, r.reason].join(':')),
  ].join('|')
  return ocrDocFnv1aHash(payload)
}

/**
 * 为页面选择计算 manifest。
 * 从归一化结果中筛选 processed 与 skipped page refs，生成稳定清单哈希。
 */
export function buildPdfPageManifest(params: {
  sourceHash: string
  totalPages: number
  pageLimit: number | null
  pages: OcrNormalizedPage[]
  skippedRefs: OcrPdfSkippedPageRef[]
  warnings: OcrDocumentWarning[]
}): OcrPdfPageManifest {
  const processedRefs: OcrPdfProcessedPageRef[] = params.pages.map((p) => ({
    pageIndex: p.pageIndex,
    mimeType: p.mimeType,
    sizeBytes: p.sizeBytes,
    widthPixels: p.widthPixels ?? null,
    heightPixels: p.heightPixels ?? null,
  }))
  const manifest: OcrPdfPageManifest = {
    sourceHash: params.sourceHash,
    totalPages: params.totalPages,
    pageLimit: params.pageLimit,
    processedRefs,
    skippedRefs: params.skippedRefs,
    warnings: params.warnings,
    manifestHash: '',
  }
  manifest.manifestHash = computePdfManifestHash(manifest)
  return manifest
}

/** 验证 pageLimit 是否在允许范围内 */
export function validatePageLimit(
  requested: number | null | undefined,
  maxPages: number,
): { allowed: boolean; effectiveLimit: number; warning?: OcrDocumentWarning } {
  if (requested == null || requested <= 0) {
    return { allowed: true, effectiveLimit: 0 }
  }
  const effective = Math.min(requested, maxPages)
  if (effective < requested) {
    return {
      allowed: true,
      effectiveLimit: effective,
      warning: {
        code: 'PAGE_OVERFLOW' as OcrDocumentWarningCode,
        message: `请求的 pageLimit ${requested} 超过系统上限 ${maxPages}，已截断为 ${effective}`,
      },
    }
  }
  return { allowed: true, effectiveLimit: effective }
}

/** 聚合 skip refs 到统一的 OcrDocumentWarning[] */
export function collectSkippedPageWarnings(
  skippedRefs: OcrPdfSkippedPageRef[],
): OcrDocumentWarning[] {
  return skippedRefs.map((r) => r.warning)
}

// ---------------------------------------------------------------------------
// PDF 源特有的输入签名
// ---------------------------------------------------------------------------

/** PDF 源的扩展输入签名：包含 manifestHash / pageLimit */
export function computePdfInputSignature(params: {
  sourceKind: OcrDocumentSourceKind
  sourceAttachmentId?: number | string | null
  modelId?: number | string | null
  promptHint?: string | null
  pageLimit?: number | null
  manifestHash?: string | null
}): string {
  const payload = [
    params.sourceKind,
    params.sourceAttachmentId ?? '',
    params.modelId ?? '',
    params.promptHint ?? '',
    params.pageLimit ?? '',
    params.manifestHash ?? '',
  ].join(':')
  return ocrDocFnv1aHash(payload)
}
