/**
 * V3 OCR Structured Extraction — 共享契约与确定性纯函数引擎
 *
 * 从已确认 OCR 文本中按版本化提取 profile 生成 schema-bound 的字段、章节和表格候选。
 * 只消费 current/non-expired/non-held 已接受提取记录，
 * 候选经 preview 与显式确认后才保存 advisory structured extraction snapshot。
 *
 * 红线：
 * - 不自动创建/更新/写入正式项目、任务、WBS、风险、里程碑、资源、
 *   document body、search index、knowledge base、Compiler、AI draft 或外部系统
 * - 不做发票/预算/财务处理、知识图谱/VectorDB/Elasticsearch/Redis 强依赖
 * - 不默认调用真实 OCR provider/model
 */

import type { OcrProfileProjection } from './ocr-profile-plugin-pack.js'

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** 提取 profile 状态 */
export const OCR_EXTRACTION_PROFILE_STATUSES = ['draft', 'active', 'archived'] as const
export type OcrExtractionProfileStatus = (typeof OCR_EXTRACTION_PROFILE_STATUSES)[number]

/** profile 作用域 */
export const OCR_EXTRACTION_PROFILE_SCOPES = ['builtin', 'project', 'organization'] as const
export type OcrExtractionProfileScope = (typeof OCR_EXTRACTION_PROFILE_SCOPES)[number]

/** 结构化字段类型 */
export const OCR_STRUCTURED_FIELD_TYPES = [
  'text',
  'date',
  'number',
  'enum',
  'person_name',
  'project_ref',
  'table',
] as const
export type OcrStructuredFieldType = (typeof OCR_STRUCTURED_FIELD_TYPES)[number]

/** 提取运行状态 */
export const OCR_EXTRACTION_RUN_STATUSES = [
  'pending',
  'processing',
  'completed',
  'completed_with_warnings',
  'failed',
  'canceled',
] as const
export type OcrExtractionRunStatus = (typeof OCR_EXTRACTION_RUN_STATUSES)[number]

/** 候选记录状态 */
export const OCR_EXTRACTION_CANDIDATE_STATUSES = [
  'generated',
  'selected',
  'rejected',
  'superseded',
] as const
export type OcrExtractionCandidateStatus = (typeof OCR_EXTRACTION_CANDIDATE_STATUSES)[number]

/** 结构化提取警告代码 */
export const OCR_EXTRACTION_WARNING_CODES = [
  'AMBIGUOUS_DATE',
  'AMBIGUOUS_LABEL',
  'LOW_CONFIDENCE_MATCH',
  'MISSING_REQUIRED_FIELD',
  'MISSING_TABLE_HEADER',
  'TABLE_BOUNDARY_UNCLEAR',
  'EXTRA_FIELD_IGNORED',
  'VALUE_COERCION_FAILED',
  'AI_CANDIDATE_REJECTED',
  'AI_FALLBACK_USED',
  'SOURCE_TRUNCATED',
  'PROFILE_VERSION_MISMATCH',
] as const
export type OcrExtractionWarningCode = (typeof OCR_EXTRACTION_WARNING_CODES)[number]

/** 候选来源/出处 */
export const OCR_EXTRACTION_PROVENANCE_KINDS = [
  'deterministic',
  'ai_assisted',
  'ai_fallback',
] as const
export type OcrExtractionProvenanceKind = (typeof OCR_EXTRACTION_PROVENANCE_KINDS)[number]

/** 置信度等级 */
export const OCR_EXTRACTION_CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const
export type OcrExtractionConfidenceLevel = (typeof OCR_EXTRACTION_CONFIDENCE_LEVELS)[number]

/** 结构化提取审计动作 */
export const OCR_STRUCTURED_EXTRACTION_AUDIT_ACTIONS = [
  'OCR_STRUCTURED_PROFILE_CREATED',
  'OCR_STRUCTURED_PROFILE_UPDATED',
  'OCR_STRUCTURED_PROFILE_ARCHIVED',
  'OCR_STRUCTURED_RUN_CREATED',
  'OCR_STRUCTURED_RUN_COMPLETED',
  'OCR_STRUCTURED_RUN_FAILED',
  'OCR_STRUCTURED_AI_FALLBACK',
  'OCR_STRUCTURED_PREVIEW',
  'OCR_STRUCTURED_SAVED',
  'OCR_STRUCTURED_SUPERSEDED',
  'OCR_STRUCTURED_STALE_BLOCKED',
  'OCR_STRUCTURED_LIFECYCLE_BLOCKED',
  'OCR_STRUCTURED_PERMISSION_DENIED',
] as const
export type OcrStructuredExtractionAuditAction =
  (typeof OCR_STRUCTURED_EXTRACTION_AUDIT_ACTIONS)[number]

/** profile 排序字段 */
export const OCR_EXTRACTION_PROFILE_SORT_FIELDS = [
  'name',
  'scope',
  'status',
  'created_at',
  'updated_at',
] as const
export type OcrExtractionProfileSortField = (typeof OCR_EXTRACTION_PROFILE_SORT_FIELDS)[number]

/** 运行排序字段 */
export const OCR_EXTRACTION_RUN_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'completed_at',
  'status',
] as const
export type OcrExtractionRunSortField = (typeof OCR_EXTRACTION_RUN_SORT_FIELDS)[number]

// ─── Table Schema ───────────────────────────────────────────────────────

/** 表格列定义 */
export interface OcrExtractionTableColumn {
  key: string
  label: string
  fieldType: OcrStructuredFieldType
  required: boolean
  enumValues?: string[]
  maxLength?: number
  hint?: string
}

/** 表格 schema——profile 内的表格定义 */
export interface OcrExtractionTableSchema {
  key: string
  label: string
  columns: OcrExtractionTableColumn[]
  maxRows: number
  maxCellsPerRow: number
  allowExtraColumns: boolean
  hint?: string
}

// ─── Profile Schema ─────────────────────────────────────────────────────

/** 单字段定义 */
export interface OcrExtractionFieldDefinition {
  key: string
  label: string
  fieldType: OcrStructuredFieldType
  required: boolean
  enumValues?: string[]
  maxLength?: number
  pattern?: string
  hint?: string
}

/** 章节定义（一组相关字段） */
export interface OcrExtractionSectionDefinition {
  key: string
  label: string
  fields: OcrExtractionFieldDefinition[]
  optional: boolean
  repeatable: boolean
  hint?: string
}

/** Profile schema 定义（版本化） */
export interface OcrExtractionProfileSchema {
  schemaKey: string
  version: number
  label: string
  description: string
  sections: OcrExtractionSectionDefinition[]
  tables: OcrExtractionTableSchema[]
  validationRules: {
    maxFieldsPerRun: number
    maxTableRowsPerRun: number
    maxTotalCandidates: number
    forbidExternalUrls: true
    forbidArbitraryCode: true
    forbidDownstreamWrites: true
  }
  redactionHints: {
    fields: string[]
    patterns: string[]
  }
}

// ─── Profile DTO ────────────────────────────────────────────────────────

/** Profile 摘要（列表用） */
export interface OcrExtractionProfileSummary {
  profileId: number | null
  profileRef?: string
  profileSource?: 'builtin' | 'organization' | 'plugin'
  profilePayloadDigest?: string
  /** 插件 profile 保留完整 semver，避免 currentVersion 的数值兼容字段丢失信息。 */
  pluginVersion?: string
  /** 仅声明式、已白名单校验的插件 schema/review 投影。 */
  schemaSnapshot?: OcrProfileProjection['schemaSnapshot']
  reviewSnapshot?: OcrProfileProjection['reviewSnapshot']
  name: string
  scope: OcrExtractionProfileScope
  status: OcrExtractionProfileStatus
  schemaKey: string
  currentVersion: number
  totalRuns: number
  description: string | null
  organizationId: number
  projectId: number | null
  createdAt: string
  updatedAt: string
}

/** Profile 详情（含当前 active 版本的定义） */
export interface OcrExtractionProfileDetail extends OcrExtractionProfileSummary {
  schemaDefinition: OcrExtractionProfileSchema
  versionHistory: OcrExtractionProfileVersionSummary[]
}

/** Profile 版本摘要 */
export interface OcrExtractionProfileVersionSummary {
  versionId: number
  version: number
  status: OcrExtractionProfileStatus
  createdAt: string
  createdBy: number | null
}

/** 创建 profile 请求 */
export interface CreateOcrExtractionProfileRequest {
  name: string
  scope: OcrExtractionProfileScope
  description?: string | null
  schemaDefinition: OcrExtractionProfileSchema
  /** project-scoped 时必传 */
  projectId?: number | null
}

/** 更新 profile 请求 */
export interface UpdateOcrExtractionProfileRequest {
  name?: string
  description?: string | null
  status?: OcrExtractionProfileStatus
  schemaDefinition?: OcrExtractionProfileSchema
}

// ─── Typed Values ───────────────────────────────────────────────────────

/** 文本值 */
export interface OcrTypedTextValue {
  kind: 'text'
  raw: string
  normalized: string
}

/** 日期值 */
export interface OcrTypedDateValue {
  kind: 'date'
  raw: string
  normalized: string // ISO 8601
  parsed: {
    year: number
    month: number
    day: number
  } | null
}

/** 数字值 */
export interface OcrTypedNumberValue {
  kind: 'number'
  raw: string
  normalized: number | null
}

/** 枚举-like 标签值 */
export interface OcrTypedEnumValue {
  kind: 'enum'
  raw: string
  normalized: string
  matchedValue: string | null
}

/** 人名值 */
export interface OcrTypedPersonNameValue {
  kind: 'person_name'
  raw: string
  normalized: string
  matchType: 'exact' | 'fuzzy' | 'none'
}

/** 项目引用值 */
export interface OcrTypedProjectRefValue {
  kind: 'project_ref'
  raw: string
  normalized: string
  matchedProjectId: number | null
  matchType: 'exact' | 'fuzzy' | 'none'
}

/** 源跨度引用 */
export interface OcrSourceSpanRef {
  pageIndex: number
  charStart: number
  charEnd: number
}

/** 表格单元格值 */
export interface OcrTypedTableCellValue {
  fieldKey: string
  fieldType: OcrStructuredFieldType
  raw: string
  value:
    | OcrTypedTextValue
    | OcrTypedDateValue
    | OcrTypedNumberValue
    | OcrTypedEnumValue
    | OcrTypedPersonNameValue
    | OcrTypedProjectRefValue
  spanRef: OcrSourceSpanRef | null
}

/** 统一类型化值（字段级别） */
export type OcrTypedFieldValue =
  | OcrTypedTextValue
  | OcrTypedDateValue
  | OcrTypedNumberValue
  | OcrTypedEnumValue
  | OcrTypedPersonNameValue
  | OcrTypedProjectRefValue

// ─── Candidate DTO ──────────────────────────────────────────────────────

/** 单个扩展警告 */
export interface OcrExtractionWarning {
  code: OcrExtractionWarningCode
  message: string
  fieldKey?: string
  tableKey?: string
  rowKey?: string
  severity: 'info' | 'warn' | 'error'
}

/** 字段候选 */
export interface OcrFieldCandidate {
  candidateId: number
  runId: number
  sectionKey: string
  fieldKey: string
  fieldType: OcrStructuredFieldType
  raw: string
  value: OcrTypedFieldValue | null
  confidence: OcrExtractionConfidenceLevel
  confidenceScore: number // 0..1
  spanRef: OcrSourceSpanRef | null
  sourceSpanHash: string
  candidateHash: string
  warnings: OcrExtractionWarning[]
  provenance: OcrExtractionProvenanceKind
  status: OcrExtractionCandidateStatus
  createdAt: string
}

/** 表格行候选 */
export interface OcrTableRowCandidate {
  rowKey: string
  rowIndex: number
  cells: OcrTypedTableCellValue[]
  spanRefs: OcrSourceSpanRef[]
  sourceSpanHash: string
  candidateHash: string
  confidence: OcrExtractionConfidenceLevel
  confidenceScore: number
  warnings: OcrExtractionWarning[]
  provenance: OcrExtractionProvenanceKind
  status: OcrExtractionCandidateStatus
}

/** 表格候选 */
export interface OcrTableCandidate {
  candidateId: number
  runId: number
  tableKey: string
  columnCount: number
  rows: OcrTableRowCandidate[]
  maxRows: number
  confidence: OcrExtractionConfidenceLevel
  confidenceScore: number
  warnings: OcrExtractionWarning[]
  provenance: OcrExtractionProvenanceKind
  status: OcrExtractionCandidateStatus
  createdAt: string
}

// ─── Run DTO ────────────────────────────────────────────────────────────

/** 运行摘要（列表用） */
export interface OcrExtractionRunSummary {
  runId: number
  extractionId: number
  profileId: number | null
  profileRef?: string
  profileSource?: 'builtin' | 'organization' | 'plugin'
  profilePayloadDigest?: string
  pluginVersion?: string
  profileName: string
  profileVersion: number
  status: OcrExtractionRunStatus
  totalFieldCandidates: number
  totalTableCandidates: number
  warningCount: number
  errorCount: number
  provenance: OcrExtractionProvenanceKind
  createdBy: number
  createdAt: string
  completedAt: string | null
  allowedActions: OcrExtractionRunAction[]
}

/** 运行详情 */
export interface OcrExtractionRunDetail extends OcrExtractionRunSummary {
  extractionSummary: OcrExtractionSourceSummary
  inputSignature: string
  idempotencyKey: string
  sourceHash: string
  fieldCandidates: OcrFieldCandidate[]
  tableCandidates: OcrTableCandidate[]
  warningSummary: OcrExtractionWarningSummary
}

/** 运行允许的动作 */
export const OCR_EXTRACTION_RUN_ACTIONS = [
  'view',
  'review',
  'preview_confirm',
  'confirm',
  'supersede',
  'cancel',
] as const
export type OcrExtractionRunAction = (typeof OCR_EXTRACTION_RUN_ACTIONS)[number]

/** 提取源摘要 */
export interface OcrExtractionSourceSummary {
  extractionId: number
  sourceHash: string
  candidateHash: string
  selectedTextHash: string
  pageRefs: number[]
  sourceKind: string
  sourceName: string | null
  confirmedAt: string
  status: 'current' | 'superseded'
}

/** 警告汇总 */
export interface OcrExtractionWarningSummary {
  totalWarnings: number
  totalErrors: number
  topCodes: OcrExtractionWarningCode[]
  topFields: string[]
  hasBlockingErrors: boolean
}

/** 创建运行请求 */
export interface CreateOcrExtractionRunRequest {
  extractionId: number
  profileId?: number
  /** Namespaced plugin profile ref; mutually exclusive with profileId. */
  profileRef?: string
  /** 客户端幂等键 */
  idempotencyKey?: string
  /** 是否启用可选 AI 辅助草稿 */
  aiAssist?: boolean
  options?: {
    maxFieldCandidates?: number
    maxTableRows?: number
  }
}

/** 列出运行请求的过滤器 */
export interface ListOcrExtractionRunsFilter {
  extractionId?: number
  profileId?: number
  status?: OcrExtractionRunStatus
  provenance?: OcrExtractionProvenanceKind
  sort?: string
  page?: number
  perPage?: number
}

// ─── Confirmation / Preview ─────────────────────────────────────────────

/** 确认预览请求 */
export interface OcrStructuredExtractionPreviewRequest {
  runId: number
  selectedFieldCandidateIds: number[]
  selectedTableCandidateIds: number[]
  selectedTableRowKeys?: Record<string, string[]> // tableKey -> rowKeys[]
  reviewNote?: string | null
}

/** 确认预览响应 */
export interface OcrStructuredExtractionPreviewResponse {
  previewHash: string
  runId: number
  sourceHash: string
  profileId: number | null
  profileRef?: string
  profileSource?: 'builtin' | 'organization' | 'plugin'
  pluginVersion?: string
  profileVersion: number
  selectedFields: OcrFieldCandidate[]
  selectedTables: OcrTableCandidate[]
  snapshot: OcrStructuredExtractionSnapshotPayload
  redlineSummary: OcrStructuredExtractionRedlineSummary
  staleWarnings: OcrExtractionWarning[]
  requiresExplicitConfirmation: true
}

/** 结构化提取快照 payload——将要写入的内容 */
export interface OcrStructuredExtractionSnapshotPayload {
  extractionId: number
  sourceHash: string
  profileId: number | null
  profileRef?: string
  profileSource?: 'builtin' | 'organization' | 'plugin'
  profilePayloadDigest?: string
  pluginVersion?: string
  profileVersion: number
  fieldValues: Record<string, OcrTypedFieldValue | null> // fieldKey -> value
  tableValues: Record<string, OcrTableRowCandidate[]> // tableKey -> rows
  sourceSpanHashes: string[]
  candidateHashes: string[]
}

/** 确认保存请求 */
export interface OcrStructuredExtractionSaveRequest {
  previewHash: string
  runId: number
  selectedFieldCandidateIds: number[]
  selectedTableCandidateIds: number[]
  selectedTableRowKeys?: Record<string, string[]>
  reviewNote?: string | null
}

/** 红线摘要——确认不会变更的下游系统清单 */
export interface OcrStructuredExtractionRedlineSummary {
  tasks: 'unchanged'
  wbs: 'unchanged'
  risks: 'unchanged'
  milestones: 'unchanged'
  resources: 'unchanged'
  reports: 'unchanged'
  documentBody: 'unchanged'
  compilerArtifacts: 'unchanged'
  aiDrafts: 'unchanged'
  searchIndexes: 'unchanged'
  knowledgeBases: 'unchanged'
  externalSystems: 'unchanged'
}

// ─── Confirmed Snapshot ──────────────────────────────────────────────────

/** 已确认的结构化提取快照摘要（列表用） */
export interface OcrStructuredSnapshotSummary {
  snapshotId: number
  extractionId: number
  profileId: number | null
  profileRef?: string
  profileSource?: 'builtin' | 'organization' | 'plugin'
  profilePayloadDigest?: string
  pluginVersion?: string
  profileName: string
  profileVersion: number
  sourceHash: string
  snapshotHash: string
  fieldCount: number
  tableCount: number
  reviewerId: number | null
  reviewNote: string | null
  status: 'current' | 'superseded'
  supersededById: number | null
  confirmedAt: string
  supersededAt: string | null
}

/** 已确认的结构化提取快照详情 */
export interface OcrStructuredSnapshotDetail extends OcrStructuredSnapshotSummary {
  fieldValues: Record<string, OcrTypedFieldValue | null>
  tableValues: Record<string, OcrTableRowCandidate[]>
  sourceSpanHashes: string[]
  candidateHashes: string[]
  previewHash: string
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

export function isOcrExtractionProfileStatus(value: unknown): value is OcrExtractionProfileStatus {
  return (
    typeof value === 'string' &&
    (OCR_EXTRACTION_PROFILE_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrExtractionProfileScope(value: unknown): value is OcrExtractionProfileScope {
  return (
    typeof value === 'string' &&
    (OCR_EXTRACTION_PROFILE_SCOPES as readonly string[]).includes(value)
  )
}

export function isOcrStructuredFieldType(value: unknown): value is OcrStructuredFieldType {
  return (
    typeof value === 'string' && (OCR_STRUCTURED_FIELD_TYPES as readonly string[]).includes(value)
  )
}

export function isOcrExtractionRunStatus(value: unknown): value is OcrExtractionRunStatus {
  return (
    typeof value === 'string' && (OCR_EXTRACTION_RUN_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrExtractionCandidateStatus(
  value: unknown,
): value is OcrExtractionCandidateStatus {
  return (
    typeof value === 'string' &&
    (OCR_EXTRACTION_CANDIDATE_STATUSES as readonly string[]).includes(value)
  )
}

export function isOcrExtractionWarningCode(value: unknown): value is OcrExtractionWarningCode {
  return (
    typeof value === 'string' && (OCR_EXTRACTION_WARNING_CODES as readonly string[]).includes(value)
  )
}

export function isOcrExtractionProvenanceKind(
  value: unknown,
): value is OcrExtractionProvenanceKind {
  return (
    typeof value === 'string' &&
    (OCR_EXTRACTION_PROVENANCE_KINDS as readonly string[]).includes(value)
  )
}

export function isOcrExtractionConfidenceLevel(
  value: unknown,
): value is OcrExtractionConfidenceLevel {
  return (
    typeof value === 'string' &&
    (OCR_EXTRACTION_CONFIDENCE_LEVELS as readonly string[]).includes(value)
  )
}

export function isOcrExtractionRunAction(value: unknown): value is OcrExtractionRunAction {
  return (
    typeof value === 'string' && (OCR_EXTRACTION_RUN_ACTIONS as readonly string[]).includes(value)
  )
}

// ─── 纯函数：哈希 ────────────────────────────────────────────────────────

/**
 * 简单确定性文本哈希（FNV-1a + 额外混合）。
 * 仅用于源/候选/快照的匹配比较，非加密用途。
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

/** Stable JSON 序列化（按 key 排序确保确定性） */
export function stableJson(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableJson).join(',') + ']'
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  return (
    '{' +
    keys
      .map((k) => `${JSON.stringify(k)}:${stableJson((obj as Record<string, unknown>)[k])}`)
      .join(',') +
    '}'
  )
}

/** 计算源跨度的确定性哈希 */
export function computeSourceSpanHash(
  text: string,
  pageIndex: number,
  charStart: number,
  charEnd: number,
): string {
  const normalized = text.slice(charStart, charEnd).trim().replace(/\r\n/g, '\n')
  const input = `${pageIndex}|${charStart}|${charEnd}|${normalized}`
  return toHex8(fnv1aHash(input))
}

/** 计算字段候选的确定性哈希 */
export function computeFieldCandidateHash(
  fieldKey: string,
  sectionKey: string,
  raw: string,
  spanRef: OcrSourceSpanRef | null,
): string {
  const span = spanRef ? `${spanRef.pageIndex}|${spanRef.charStart}|${spanRef.charEnd}` : 'no_span'
  const input = `${fieldKey}|${sectionKey}|${raw.trim()}|${span}`
  return toHex8(fnv1aHash(input))
}

/** 计算表格行候选的确定性哈希 */
export function computeTableRowHash(
  tableKey: string,
  rowIndex: number,
  rawCells: string[],
): string {
  const input = `${tableKey}|${rowIndex}|${rawCells.join('|')}`
  return toHex8(fnv1aHash(input))
}

/** 计算确认预览的确定性哈希 */
export function computeStructuredExtractionPreviewHash(
  sourceHash: string,
  profileId: number | string,
  profileVersion: number,
  selectedFieldHashes: string[],
  selectedTableHashes: string[],
): string {
  const input = [
    sourceHash,
    profileId,
    profileVersion,
    ...selectedFieldHashes.sort(),
    ...selectedTableHashes.sort(),
  ].join('|')
  return toHex8(fnv1aHash(input))
}

/** 计算快照保存的确定性哈希 */
export function computeStructuredExtractionSnapshotHash(
  extractionId: number,
  sourceHash: string,
  profileId: number | string,
  profileVersion: number,
  fieldHashes: string[],
  tableHashes: string[],
): string {
  const input = [
    extractionId,
    sourceHash,
    profileId,
    profileVersion,
    ...fieldHashes.sort(),
    ...tableHashes.sort(),
  ].join('|')
  return toHex8(fnv1aHash(input))
}

/** 计算运行输入签名（用于幂等性检测） */
export function computeStructuredExtractionInputSignature(
  extractionId: number,
  sourceHash: string,
  profileId: number | string,
  profileVersion: number | string,
  options?: { maxFieldCandidates?: number; maxTableRows?: number },
): string {
  const opts = options ? `${options.maxFieldCandidates ?? 0}|${options.maxTableRows ?? 0}` : '0|0'
  const input = `${extractionId}|${sourceHash}|${profileId}|${profileVersion}|${opts}`
  return toHex8(fnv1aHash(input))
}

/** 规范化幂等键 */
export function normalizeStructuredExtractionIdempotencyKey(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 255)
}

// ─── 纯函数：Profile Schema 验证 ───────────────────────────────────────

/** Profile schema 安全验证结果 */
export interface OcrProfileValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * 验证 profile schema 不包含不安全配置。
 *
 * 入参来自未经收窄的用户 payload（校验器只保证是对象），所以先做结构预检：
 * 缺少 validationRules / sections / tables 时直接判不通过，而不是让后续访问抛 TypeError。
 */
export function validateOcrExtractionProfileSchema(input: unknown): OcrProfileValidationResult {
  const errors: string[] = []

  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['profile schema must be an object'] }
  }
  const candidate = input as Partial<OcrExtractionProfileSchema>
  if (typeof candidate.schemaKey !== 'string' || candidate.schemaKey.trim() === '') {
    errors.push('profile schema must contain a non-empty schemaKey')
  }
  if (typeof candidate.validationRules !== 'object' || candidate.validationRules === null) {
    errors.push('profile schema must contain validationRules')
  }
  if (!Array.isArray(candidate.sections)) {
    errors.push('profile schema must contain sections[]')
  }
  if (!Array.isArray(candidate.tables)) {
    errors.push('profile schema must contain tables[]')
  }
  if (errors.length > 0) {
    return { valid: false, errors }
  }
  const schema = input as OcrExtractionProfileSchema

  // 检查是否禁止外部 URL
  if (!schema.validationRules.forbidExternalUrls) {
    errors.push('profile schema must set validationRules.forbidExternalUrls=true')
  }

  // 检查是否禁止任意代码
  if (!schema.validationRules.forbidArbitraryCode) {
    errors.push('profile schema must set validationRules.forbidArbitraryCode=true')
  }

  // 检查是否禁止下游写动作
  if (!schema.validationRules.forbidDownstreamWrites) {
    errors.push('profile schema must set validationRules.forbidDownstreamWrites=true')
  }

  // 检查字段定义无外部 URL
  const allFields = [...schema.sections.flatMap((s) => s.fields)]
  for (const field of allFields) {
    if (field.fieldType === 'project_ref' && field.pattern) {
      try {
        const url = new URL(field.pattern)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          errors.push(`field "${field.key}": pattern must not be an external URL`)
        }
      } catch {
        // 不是 URL，没问题
      }
    }
  }

  // 检查字段类型有效
  for (const field of allFields) {
    if (!isOcrStructuredFieldType(field.fieldType)) {
      errors.push(`field "${field.key}": unknown field type "${field.fieldType}"`)
    }
  }

  // 检查枚举值不包含不安全内容
  for (const field of allFields) {
    if (field.enumValues) {
      for (const ev of field.enumValues) {
        if (ev.includes('<script') || ev.includes('javascript:')) {
          errors.push(`field "${field.key}": enum value "${ev}" contains unsafe content`)
        }
      }
    }
  }

  // 检查表格列定义
  for (const table of schema.tables) {
    if (table.maxRows < 0 || table.maxRows > 10000) {
      errors.push(`table "${table.key}": maxRows must be between 0 and 10000`)
    }
    if (table.maxCellsPerRow < 0 || table.maxCellsPerRow > 1000) {
      errors.push(`table "${table.key}": maxCellsPerRow must be between 0 and 1000`)
    }
    for (const col of table.columns) {
      if (!isOcrStructuredFieldType(col.fieldType)) {
        errors.push(`table "${table.key}" column "${col.key}": unknown field type`)
      }
    }
  }

  // 检查配置上限合理性
  if (
    schema.validationRules.maxFieldsPerRun < 1 ||
    schema.validationRules.maxFieldsPerRun > 10000
  ) {
    errors.push('maxFieldsPerRun must be between 1 and 10000')
  }
  if (
    schema.validationRules.maxTableRowsPerRun < 1 ||
    schema.validationRules.maxTableRowsPerRun > 100000
  ) {
    errors.push('maxTableRowsPerRun must be between 1 and 100000')
  }

  // 检查无重复 key
  const fieldKeys = new Set<string>()
  for (const field of allFields) {
    if (fieldKeys.has(field.key)) {
      errors.push(`duplicate field key "${field.key}"`)
    }
    fieldKeys.add(field.key)
  }

  const tableKeys = new Set<string>()
  for (const table of schema.tables) {
    if (tableKeys.has(table.key)) {
      errors.push(`duplicate table key "${table.key}"`)
    }
    tableKeys.add(table.key)
  }

  return { valid: errors.length === 0, errors }
}

// ─── 纯函数：生命周期/新鲜度守卫 ─────────────────────────────────────────

/** 检查已接受提取是否可用于结构化提取 */
export function isAcceptedExtractionEligible(params: {
  status: string
  isExpired: boolean
  isPurged: boolean
  isHeld: boolean
}): boolean {
  if (params.status !== 'current') return false
  if (params.isExpired) return false
  if (params.isPurged) return false
  if (params.isHeld) return false
  return true
}

/** 检查源是否有权对用户可见（不泄露是否存在） */
export function isStructuredExtractionSourceVisible(params: {
  sameOrganization: boolean
  sameProject: boolean
  hasViewPermission: boolean
}): boolean {
  return params.sameOrganization && params.sameProject && params.hasViewPermission
}

// ─── 纯函数：脱敏辅助 ───────────────────────────────────────────────────

const REDACT_PATTERNS: RegExp[] = [
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

/** 脱敏：移除 OCR 全量文本、隐藏路径、密钥 */
export function redactStructuredExtractionMetadata(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(redactStructuredExtractionMetadata)
  }
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_PATTERNS.some((p) => p.test(key))) {
      result[key] = '[REDACTED]'
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactStructuredExtractionMetadata(val)
    } else {
      result[key] = val
    }
  }
  return result
}

/** 审计元数据构建：只保留哈希和引用，不含全量文本 */
export function buildStructuredExtractionAuditMetadata(params: {
  actorId: number
  organizationId: number
  projectId: number
  action: OcrStructuredExtractionAuditAction
  runId?: number | null
  profileId?: number | null
  profileVersion?: number | null
  extractionId?: number | null
  sourceHash?: string | null
  previewHash?: string | null
  snapshotId?: number | null
  warningCodes?: string[]
  denialReason?: string | null
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    actor: params.actorId,
    org: params.organizationId,
    project: params.projectId,
    action: params.action,
  }
  if (params.runId) meta.runId = params.runId
  if (params.profileId) meta.profileId = params.profileId
  if (params.profileVersion) meta.profileVersion = params.profileVersion
  if (params.extractionId) meta.extractionId = params.extractionId
  if (params.sourceHash) meta.sourceHash = params.sourceHash
  if (params.previewHash) meta.previewHash = params.previewHash
  if (params.snapshotId) meta.snapshotId = params.snapshotId
  if (params.warningCodes && params.warningCodes.length > 0) meta.warningCodes = params.warningCodes
  if (params.denialReason) meta.denialReason = params.denialReason
  return redactStructuredExtractionMetadata(meta) as Record<string, unknown>
}

// ─── 纯函数：Confidence 辅助 ─────────────────────────────────────────────

/** 根据 score 确定 confidence level */
export function resolveConfidenceLevel(score: number): OcrExtractionConfidenceLevel {
  if (score >= 0.8) return 'high'
  if (score >= 0.5) return 'medium'
  if (score >= 0.1) return 'low'
  return 'unknown'
}

/** 根据字段或表格候选聚合 warning summary */
export function aggregateExtractionWarningSummary(params: {
  fieldWarnings: OcrExtractionWarning[]
  tableWarnings: OcrExtractionWarning[]
}): OcrExtractionWarningSummary {
  const all = [...params.fieldWarnings, ...params.tableWarnings]
  const totalWarnings = all.filter((w) => w.severity !== 'error').length
  const totalErrors = all.filter((w) => w.severity === 'error').length

  // 统计 top codes
  const codeCounts = new Map<OcrExtractionWarningCode, number>()
  const fieldCounts = new Map<string, number>()
  for (const w of all) {
    codeCounts.set(w.code, (codeCounts.get(w.code) ?? 0) + 1)
    if (w.fieldKey) fieldCounts.set(w.fieldKey, (fieldCounts.get(w.fieldKey) ?? 0) + 1)
  }
  const topCodes = [...codeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)
  const topFields = [...fieldCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)

  return {
    totalWarnings,
    totalErrors,
    topCodes,
    topFields,
    hasBlockingErrors: totalErrors > 0,
  }
}

// ─── 纯函数：红线摘要 ──────────────────────────────────────────────────────

/** 生成确定性红线摘要 */
export function buildStructuredExtractionRedlineSummary(): OcrStructuredExtractionRedlineSummary {
  return {
    tasks: 'unchanged',
    wbs: 'unchanged',
    risks: 'unchanged',
    milestones: 'unchanged',
    resources: 'unchanged',
    reports: 'unchanged',
    documentBody: 'unchanged',
    compilerArtifacts: 'unchanged',
    aiDrafts: 'unchanged',
    searchIndexes: 'unchanged',
    knowledgeBases: 'unchanged',
    externalSystems: 'unchanged',
  }
}

// ─── 纯函数：允许动作解析 ──────────────────────────────────────────────────

/** 根据权限和运行状态解析允许的动作 */
export function resolveStructuredExtractionActions(params: {
  canView: boolean
  canManage: boolean
  canRun: boolean
  canConfirm: boolean
  isStale: boolean
  isComplete: boolean
  hasCandidates: boolean
  hasConfirmedSnapshots: boolean
}): OcrExtractionRunAction[] {
  const actions: OcrExtractionRunAction[] = []
  if (params.canView) {
    actions.push('view')
    if (params.isComplete && params.hasCandidates) {
      actions.push('review')
    }
  }
  if (params.canConfirm && !params.isStale && params.isComplete && params.hasCandidates) {
    actions.push('preview_confirm')
    actions.push('confirm')
  }
  if (params.canConfirm && !params.isStale && params.hasConfirmedSnapshots) {
    actions.push('supersede')
  }
  if (params.canManage) {
    actions.push('cancel')
  }
  return actions
}

// ─── 纯函数：排序辅助 ──────────────────────────────────────────────────────

/** 稳定排序 field candidates：先按 sectionKey，再按 fieldKey */
export function sortFieldCandidates(candidates: OcrFieldCandidate[]): OcrFieldCandidate[] {
  return [...candidates].sort((a, b) => {
    const cmp = a.sectionKey.localeCompare(b.sectionKey)
    return cmp !== 0 ? cmp : a.fieldKey.localeCompare(b.fieldKey)
  })
}

/** 稳定排序 table row candidates：按 rowIndex */
export function sortTableRows(rows: OcrTableRowCandidate[]): OcrTableRowCandidate[] {
  return [...rows].sort((a, b) => a.rowIndex - b.rowIndex)
}
