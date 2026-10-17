/**
 * V3 OCR Entity Linking — 共享契约与确定性纯函数引擎
 *
 * 定义 OCR 实体识别与 advisory linking 的枚举/接口/类型守卫/纯函数。
 * 消费 `ocr-review-confirmation.ts` 的 accepted extraction 契约，
 * 但不重复定义其类型。
 *
 * 此文件为 Section 2（Shared Contracts）的主产出物。
 */

import type { OcrAcceptedExtractionStatus } from './ocr-review-confirmation.js'

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** 实体提及类型：识别到的文本片段的语义类别 */
export const OCR_ENTITY_MENTION_TYPES = [
  'task_ref',
  'wbs_ref',
  'milestone_ref',
  'risk_ref',
  'person_name',
  'organization_name',
  'project_name',
  'date_expression',
  'amount_expression',
  'file_ref',
  'attachment_ref',
  'custom_label',
] as const
export type OcrEntityMentionType = (typeof OCR_ENTITY_MENTION_TYPES)[number]

/** 实体链接运行状态 */
export const OCR_ENTITY_LINK_RUN_STATUSES = ['running', 'completed', 'stale', 'failed'] as const
export type OcrEntityLinkRunStatus = (typeof OCR_ENTITY_LINK_RUN_STATUSES)[number]

/** 候选链接状态 */
export const OCR_ENTITY_LINK_CANDIDATE_STATUSES = [
  'pending',
  'matched',
  'unmatched',
  'duplicate',
  'blocked',
] as const
export type OcrEntityLinkCandidateStatus = (typeof OCR_ENTITY_LINK_CANDIDATE_STATUSES)[number]

/** 已确认 advisory link 的生命周期状态 */
export const OCR_ENTITY_LINK_LIFECYCLE_STATUSES = ['active', 'superseded', 'rejected'] as const
export type OcrEntityLinkLifecycleStatus = (typeof OCR_ENTITY_LINK_LIFECYCLE_STATUSES)[number]

/** 目标实体种类：可被链接到的项目实体 */
export const OCR_TARGET_KINDS = [
  'project',
  'task',
  'wbs_node',
  'milestone',
  'risk',
  'file',
  'attachment',
  'project_member',
] as const
export type OcrTargetKind = (typeof OCR_TARGET_KINDS)[number]

/** 候选匹配原因：描述为何 mention 与 target 关联 */
export const OCR_MATCH_REASONS = [
  'exact_label',
  'normalized_label',
  'alias',
  'fuzzy',
  'custom_rule',
] as const
export type OcrMatchReason = (typeof OCR_MATCH_REASONS)[number]

/** 实体链接运行/候选中的警告代码 */
export const OCR_ENTITY_LINK_WARNING_CODES = [
  'TRUNCATED_TEXT',
  'EXTRACTION_SUPERSEDED',
  'SOURCE_HASH_STALE',
  'RETENTION_EXPIRED',
  'RETENTION_HOLD',
  'TARGET_NOT_FOUND',
  'TARGET_INACCESSIBLE',
  'TARGET_ARCHIVED',
  'TARGET_DELETED',
  'TARGET_RENAMED',
  'DUPLICATE_CANDIDATE',
  'DUPLICATE_CONFIRMED',
  'LOW_CONFIDENCE',
  'AMBIGUOUS_MENTION',
  'MULTIPLE_TARGETS',
  'UNSUPPORTED_TARGET_KIND',
  'BUDGET_LIMIT',
  'RATE_LIMIT',
  'AI_EXPLANATION_FALLBACK',
  'AI_EXPLANATION_HALLUCINATION',
  'EXTRACTION_CURRENTLY_PROCESSING',
] as const
export type OcrEntityLinkWarningCode = (typeof OCR_ENTITY_LINK_WARNING_CODES)[number]

/** 实体链接权限动作 */
export const OCR_ENTITY_LINK_PERMISSION_ACTIONS = ['view', 'manage', 'confirm', 'explain'] as const
export type OcrEntityLinkPermissionAction = (typeof OCR_ENTITY_LINK_PERMISSION_ACTIONS)[number]

/** 实体链接审计动作 */
export const OCR_ENTITY_LINK_AUDIT_ACTIONS = [
  'OCR_ENTITY_LINK_RUN_CREATED',
  'OCR_ENTITY_LINK_RUN_REUSED',
  'OCR_ENTITY_LINK_CANDIDATES_GENERATED',
  'OCR_ENTITY_LINK_REVIEW_OPENED',
  'OCR_ENTITY_LINK_PREVIEW',
  'OCR_ENTITY_LINK_CONFIRMED',
  'OCR_ENTITY_LINK_SUPERSEDED',
  'OCR_ENTITY_LINK_REJECTED',
  'OCR_ENTITY_LINK_STALE_BLOCKED',
  'OCR_ENTITY_LINK_AI_EXPLANATION_ATTEMPT',
  'OCR_ENTITY_LINK_AI_EXPLANATION_FALLBACK',
  'OCR_ENTITY_LINK_PERMISSION_DENIED',
] as const
export type OcrEntityLinkAuditAction = (typeof OCR_ENTITY_LINK_AUDIT_ACTIONS)[number]

// ─── 共享 DTO ──────────────────────────────────────────────────────────────

/** 创建运行请求 */
export interface CreateOcrEntityLinkRunRequest {
  organizationId: number
  projectId: number
  acceptedExtractionIds: number[]
  targetKinds?: OcrTargetKind[]
  ruleVersion?: string
  idempotencyKey?: string
}

/** 运行输入签名（用于幂等复用） */
export interface OcrEntityLinkRunInputSignature {
  organizationId: number
  projectId: number
  actorId: number
  acceptedExtractionIds: number[]
  extractionHashes: string[]
  sourceHashes: string[]
  ruleVersion: string
  targetKinds: OcrTargetKind[]
}

/** 运行摘要（列表项） */
export interface OcrEntityLinkRunSummary {
  runId: number
  organizationId: number
  projectId: number
  actorId: number
  inputSignature: string
  ruleVersion: string
  status: OcrEntityLinkRunStatus
  candidateCount: number
  confirmedCount: number
  staleSummary: OcrEntityLinkStaleSummary | null
  createdAt: string
  updatedAt: string | null
}

/** 运行详情（含候选列表分页） */
export interface OcrEntityLinkRunDetail {
  run: OcrEntityLinkRunSummary
  sourceExtractions: OcrEntityLinkSourceExtractionRef[]
  candidates: OcrEntityLinkCandidate[]
  targetKinds: OcrTargetKind[]
  allowedActions: OcrEntityLinkPermissionAction[]
  warnings: OcrEntityLinkWarning[]
}

/** 来源提取引用（脱敏） */
export interface OcrEntityLinkSourceExtractionRef {
  extractionId: number
  sourceHash: string
  selectedTextHash: string
  pageRefs: number[]
  status: OcrAcceptedExtractionStatus
  confirmedAt: string
}

/** 候选 mention */
export interface OcrEntityLinkCandidate {
  candidateId: number | null // null for preview
  runId: number
  extractionId: number
  pageRefs: number[]
  spanOffset: OcrEntityLinkSpanOffset
  mentionType: OcrEntityMentionType
  normalizedLabel: string
  selectedTextHash: string
  spanHash: string
  confidence: number // 0-1
  status: OcrEntityLinkCandidateStatus
  targetSuggestion: OcrEntityLinkTargetSuggestion | null
  warnings: OcrEntityLinkWarningCode[]
  candidateKey: string
}

/** span 偏移量 */
export interface OcrEntityLinkSpanOffset {
  start: number
  end: number
}

/** 目标建议（匹配到的项目实体摘要） */
export interface OcrEntityLinkTargetSuggestion {
  targetKind: OcrTargetKind
  targetId: number
  title: string
  matchReason: OcrMatchReason
  confidence: number // 0-1
  navigationRef: string | null
  redacted: boolean
}

/** 确认预览 */
export interface OcrEntityLinkPreview {
  runId: number
  candidateId: number
  sourceSpan: OcrEntityLinkSourceSpanSummary
  target: OcrEntityLinkTargetSuggestion
  confidence: number
  warnings: OcrEntityLinkWarningCode[]
  advisoryLinkPayload: OcrEntityLinkAdvisoryPayload
  previewHash: string
  requiresUserConfirmation: boolean
  redlineSummary: OcrEntityLinkRedlineSummary
}

/** 确认预览中的来源 span 摘要 */
export interface OcrEntityLinkSourceSpanSummary {
  extractionId: number
  sourceHash: string
  selectedTextHash: string
  spanHash: string
  pageRefs: number[]
  spanOffset: OcrEntityLinkSpanOffset
}

/** 确认前的 advisory link payload */
export interface OcrEntityLinkAdvisoryPayload {
  organizationId: number
  projectId: number
  extractionId: number
  sourceHash: string
  selectedTextHash: string
  spanHash: string
  targetKind: OcrTargetKind
  targetId: number
  normalizedLabel: string
  confidence: number
  matchReason: OcrMatchReason
}

/** 已确认的 advisory link */
export interface OcrEntityLinkConfirmedLink {
  linkId: number
  runId: number
  organizationId: number
  projectId: number
  extractionId: number
  sourceHash: string
  selectedTextHash: string
  spanHash: string
  targetKind: OcrTargetKind
  targetId: number
  normalizedLabel: string
  confidence: number
  matchReason: OcrMatchReason
  reviewerId: number
  lifecycleStatus: OcrEntityLinkLifecycleStatus
  confirmationHash: string
  supersededById: number | null
  confirmedAt: string
  auditRef: string
}

/** 陈旧状态摘要 */
export interface OcrEntityLinkStaleSummary {
  isStale: boolean
  staleReason: OcrEntityLinkWarningCode | null
  staleSince: string
}

/** 警告 */
export interface OcrEntityLinkWarning {
  code: OcrEntityLinkWarningCode
  message: string
  severity: 'info' | 'warn' | 'error'
}

/** 红线摘要（确认后不变更的系统） */
export interface OcrEntityLinkRedlineSummary {
  taskFields: boolean
  wbsFields: boolean
  riskFields: boolean
  milestoneFields: boolean
  fileBytes: boolean
  documentBody: boolean
  searchIndexes: boolean
  knowledgeBases: boolean
  compilerArtifacts: boolean
  aiDrafts: boolean
  externalSystems: boolean
}

/** 确认请求 */
export interface ConfirmOcrEntityLinkRequest {
  runId: number
  candidateId: number
  previewHash: string
  reviewerNote?: string
}

/** 取代/拒绝请求 */
export interface SupersedeOcrEntityLinkRequest {
  linkId: number
  reason: string
}

/** 可选 AI 解释请求 */
export interface ExplainOcrEntityLinkRequest {
  runId: number
  candidateId: number
}

/** 可选 AI 解释响应 */
export interface OcrEntityLinkExplanation {
  runId: number
  candidateId: number
  text: string
  isFallback: boolean
  degradedReason?: string
  costSummary?: OcrEntityLinkCostSummary
}

/** 成本摘要 */
export interface OcrEntityLinkCostSummary {
  tokensUsed: number
  estimatedCost: number
  currency: string
}

/** 列表过滤参数 */
export interface OcrEntityLinkListFilters {
  status?: OcrEntityLinkRunStatus
  stale?: boolean
  page?: number
  perPage?: number
}

/** 目标实体摘要（来自 target adapter） */
export interface OcrEntityLinkTargetSummary {
  targetKind: OcrTargetKind
  targetId: number
  title: string
  isAccessible: boolean
  isActive: boolean
  matchableLabel: string
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

export function isOcrEntityMentionType(value: unknown): value is OcrEntityMentionType {
  return (
    typeof value === 'string' && (OCR_ENTITY_MENTION_TYPES as readonly string[]).includes(value)
  )
}

export function isOcrEntityLinkRunStatus(value: unknown): value is OcrEntityLinkRunStatus {
  return (
    typeof value === 'string' && (OCR_ENTITY_LINK_RUN_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrEntityLinkCandidateStatus(
  value: unknown,
): value is OcrEntityLinkCandidateStatus {
  return (
    typeof value === 'string' &&
    (OCR_ENTITY_LINK_CANDIDATE_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrEntityLinkLifecycleStatus(
  value: unknown,
): value is OcrEntityLinkLifecycleStatus {
  return (
    typeof value === 'string' &&
    (OCR_ENTITY_LINK_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrTargetKind(value: unknown): value is OcrTargetKind {
  return typeof value === 'string' && (OCR_TARGET_KINDS as readonly string[]).includes(value)
}

export function isOcrMatchReason(value: unknown): value is OcrMatchReason {
  return typeof value === 'string' && (OCR_MATCH_REASONS as readonly string[]).includes(value)
}

export function isOcrEntityLinkWarningCode(value: unknown): value is OcrEntityLinkWarningCode {
  return (
    typeof value === 'string' &&
    (OCR_ENTITY_LINK_WARNING_CODES as readonly string[]).includes(value)
  )
}

export function isOcrEntityLinkPermissionAction(
  value: unknown,
): value is OcrEntityLinkPermissionAction {
  return (
    typeof value === 'string' &&
    (OCR_ENTITY_LINK_PERMISSION_ACTIONS as readonly string[]).includes(value)
  )
}

export function isOcrEntityLinkAuditAction(value: unknown): value is OcrEntityLinkAuditAction {
  return (
    typeof value === 'string' &&
    (OCR_ENTITY_LINK_AUDIT_ACTIONS as readonly string[]).includes(value)
  )
}

// ─── 确定性纯函数 ──────────────────────────────────────────────────────────

/** 计算运行输入签名（SHA-256 风格的稳定哈希） */
export function computeEntityLinkRunInputSignature(input: OcrEntityLinkRunInputSignature): string {
  const payload = [
    input.organizationId,
    input.projectId,
    input.actorId,
    ...input.acceptedExtractionIds.slice().sort((a, b) => a - b),
    ...input.extractionHashes.slice().sort(),
    ...input.sourceHashes.slice().sort(),
    input.ruleVersion,
    ...input.targetKinds.slice().sort(),
  ].join('|')
  return simpleHash(payload)
}

/** 计算候选键（稳定、可复现的候选标识） */
export function computeCandidateKey(
  extractionId: number,
  pageRefs: number[],
  spanOffset: OcrEntityLinkSpanOffset,
  mentionType: OcrEntityMentionType,
  normalizedLabel: string,
): string {
  const payload = [
    extractionId,
    ...pageRefs.slice().sort((a, b) => a - b),
    spanOffset.start,
    spanOffset.end,
    mentionType,
    normalizedLabel,
  ].join('|')
  return simpleHash(payload)
}

/** 计算预览哈希（确认前验证用） */
export function computePreviewHash(payload: OcrEntityLinkAdvisoryPayload): string {
  const parts = [
    payload.organizationId,
    payload.projectId,
    payload.extractionId,
    payload.sourceHash,
    payload.selectedTextHash,
    payload.spanHash,
    payload.targetKind,
    payload.targetId,
    payload.normalizedLabel,
    payload.confidence.toFixed(4),
    payload.matchReason,
  ].join('|')
  return simpleHash(parts)
}

/** 计算确认哈希（保存时验证） */
export function computeConfirmationHash(
  previewHash: string,
  reviewerId: number,
  timestamp: string,
): string {
  return simpleHash(`${previewHash}|${reviewerId}|${timestamp}`)
}

/** 脱敏目标标题（移除隐藏实体名） */
export function redactTargetTitle(title: string, isAccessible: boolean): string {
  if (!isAccessible) return '[不可访问]'
  return title
}

/** 聚合警告列表 */
export function aggregateWarnings(
  codes: OcrEntityLinkWarningCode[],
  severityMap: Record<OcrEntityLinkWarningCode, 'info' | 'warn' | 'error'>,
): OcrEntityLinkWarning[] {
  const seen = new Set<OcrEntityLinkWarningCode>()
  const result: OcrEntityLinkWarning[] = []
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    result.push({
      code,
      message: WARNING_MESSAGES[code] ?? code,
      severity: severityMap[code] ?? 'warn',
    })
  }
  // 按 severity 排序：error > warn > info
  const order = { error: 0, warn: 1, info: 2 }
  result.sort((a, b) => order[a.severity] - order[b.severity])
  return result
}

/** 脱敏摘要 */
export function redactSummary(
  summary: OcrEntityLinkTargetSuggestion,
): OcrEntityLinkTargetSuggestion {
  if (summary.redacted) {
    return {
      ...summary,
      title: '[已脱敏]',
      targetId: 0,
      navigationRef: null,
    }
  }
  return summary
}

// ─── 简单哈希（非加密，仅用于幂等键和候选键） ──────────────────────────────

function simpleHash(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

// ─── 警告消息映射 ──────────────────────────────────────────────────────────

const WARNING_MESSAGES: Record<OcrEntityLinkWarningCode, string> = {
  TRUNCATED_TEXT: 'OCR 文本被截断，可能遗漏实体',
  EXTRACTION_SUPERSEDED: '已确认提取已被取代',
  SOURCE_HASH_STALE: '来源文件哈希已变更',
  RETENTION_EXPIRED: '提取已过保留期',
  RETENTION_HOLD: '提取处于保留锁定状态',
  TARGET_NOT_FOUND: '未找到匹配目标',
  TARGET_INACCESSIBLE: '目标实体不可访问',
  TARGET_ARCHIVED: '目标实体已归档',
  TARGET_DELETED: '目标实体已删除',
  TARGET_RENAMED: '目标实体已重命名',
  DUPLICATE_CANDIDATE: '存在重复候选',
  DUPLICATE_CONFIRMED: '该候选已被确认',
  LOW_CONFIDENCE: '匹配置信度较低',
  AMBIGUOUS_MENTION: '提及内容模糊，匹配到多个目标',
  MULTIPLE_TARGETS: '存在多个可能目标',
  UNSUPPORTED_TARGET_KIND: '不支持的目标类型',
  BUDGET_LIMIT: '预算不足',
  RATE_LIMIT: '频率限制',
  AI_EXPLANATION_FALLBACK: 'AI 解释降级为确定性说明',
  AI_EXPLANATION_HALLUCINATION: 'AI 解释包含幻觉引用',
  EXTRACTION_CURRENTLY_PROCESSING: '提取正在处理中',
}

/** 默认红线摘要（所有字段为 false） */
export const DEFAULT_REDLINE_SUMMARY: OcrEntityLinkRedlineSummary = {
  taskFields: false,
  wbsFields: false,
  riskFields: false,
  milestoneFields: false,
  fileBytes: false,
  documentBody: false,
  searchIndexes: false,
  knowledgeBases: false,
  compilerArtifacts: false,
  aiDrafts: false,
  externalSystems: false,
}
