/**
 * multi-project-dependency-crud —— 跨项目依赖 CRUD 共享契约
 *
 * 提供组织级跨项目依赖事实的 CRUD DTO、预览/确认、状态迁移、审计摘要、
 * 分页过滤、幂等键、警告码、redaction 标记与测试 fixture。
 *
 * 依赖约束：不引入 AdonisJS、React、数据库、AI、网络、缓存、图表、
 * 容器或外部 provider 运行时依赖。
 */

// 请求侧契约以后端 validator（app/validators/multi_project_dependency.ts）为唯一事实来源，
// 枚举复用已归档的 v3-multi-project-dependency-model 契约，避免同名不同值集。
import type {
  MultiProjectDependencyCategory,
  MultiProjectDependencyRiskLevel,
  MultiProjectDependencySourceMode,
  MultiProjectDependencyStatus,
  MultiProjectDependencyStrength,
  MultiProjectDependencyType,
  MultiProjectEndpointRef,
  MultiProjectEndpointType,
  MultiProjectEvidenceRef,
  MultiProjectWarningCode,
} from './multi-project-dependency-model.js'

// ─── 依赖端点引用 ──────────────────────────────────────────────

export const DEP_ENDPOINT_TYPES = ['project', 'milestone', 'task', 'manual_external'] as const
export type DepEndpointType = (typeof DEP_ENDPOINT_TYPES)[number]

export const DEP_ENDPOINT_TYPE_LABELS: Record<DepEndpointType, string> = {
  project: '项目',
  milestone: '里程碑',
  task: '任务',
  manual_external: '手动外部引用',
}

// ─── 依赖类型 (FS/SS/FF/SF) ───────────────────────────────────

export const DEP_CRUD_TYPES = ['FS', 'SS', 'FF', 'SF'] as const
export type DependencyType = (typeof DEP_CRUD_TYPES)[number]

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: '完成-开始',
  SS: '开始-开始',
  FF: '完成-完成',
  SF: '开始-完成',
}

// ─── 依赖分类 ──────────────────────────────────────────────────

export const DEP_CATEGORIES = [
  'deliverable',
  'resource',
  'technical',
  'schedule',
  'risk',
  'compliance',
  'other',
] as const
export type DepCategory = (typeof DEP_CATEGORIES)[number]

export const DEP_CATEGORY_LABELS: Record<DepCategory, string> = {
  deliverable: '交付物',
  resource: '资源',
  technical: '技术',
  schedule: '排程',
  risk: '风险',
  compliance: '合规',
  other: '其他',
}

// ─── 依赖强度 ──────────────────────────────────────────────────

export const DEP_STRENGTHS = ['strong', 'moderate', 'weak'] as const
export type DepStrength = (typeof DEP_STRENGTHS)[number]

// ─── 生命周期状态 ──────────────────────────────────────────────

export const DEP_CRUD_LIFECYCLE_STATUSES = ['active', 'archived', 'deleted'] as const
export type DepLifecycleStatus = (typeof DEP_CRUD_LIFECYCLE_STATUSES)[number]

export const DEP_LIFECYCLE_LABELS: Record<DepLifecycleStatus, string> = {
  active: '活跃',
  archived: '已归档',
  deleted: '已删除',
}

// ─── 风险等级 ──────────────────────────────────────────────────

export const DEP_RISK_LEVELS = ['none', 'low', 'medium', 'high', 'critical'] as const
export type DepRiskLevel = (typeof DEP_RISK_LEVELS)[number]

export const DEP_RISK_LABELS: Record<DepRiskLevel, string> = {
  none: '无风险',
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

// ─── 来源证据模式 ──────────────────────────────────────────────

export const DEP_SOURCE_MODES = ['manual', 'detected', 'imported'] as const
export type DepSourceMode = (typeof DEP_SOURCE_MODES)[number]

// ─── 操作类型（审计用） ────────────────────────────────────────

export const DEP_CRUD_OPERATIONS = [
  'list',
  'detail',
  'preview_create',
  'confirm_create',
  'preview_update',
  'confirm_update',
  'preview_archive',
  'confirm_archive',
  'preview_restore',
  'confirm_restore',
  'preview_delete',
  'confirm_delete',
] as const
export type DepCrudOperation = (typeof DEP_CRUD_OPERATIONS)[number]

// ─── CRUD 警告码 ───────────────────────────────────────────────

export const DEP_CRUD_WARNING_CODES = [
  'STALE_PREVIEW',
  'PERMISSION_CHANGED',
  'ENDPOINT_REDACTED',
  'DUPLICATE_ACTIVE_KEY',
  'SELF_DEPENDENCY',
  'CYCLE_DETECTED',
  'INVALID_LIFECYCLE_TRANSITION',
  'RESTORE_DUPLICATE',
  'RESTORE_CYCLE',
  'DELETE_NOT_ELIGIBLE',
  'FRESHNESS_EXPIRED',
  'IDEMPOTENCY_REPLAY',
  'FEATURE_DISABLED',
  'HIDDEN_ENDPOINT_WARNING',
  'EXTERNAL_REF_ONLY',
] as const
export type DepCrudWarningCode = (typeof DEP_CRUD_WARNING_CODES)[number]

// ─── Redaction 标记 ────────────────────────────────────────────

export const REDACTION_MARKERS = ['REDACTED'] as const
export type RedactionMarker = (typeof REDACTION_MARKERS)[number]

// ─── 排序字段 allowlist ────────────────────────────────────────

export const DEP_LIST_SORT_KEYS = [
  'createdAt',
  'updatedAt',
  'status',
  'riskLevel',
  'category',
  'freshnessCheckedAt',
] as const
export type DepListSortKey = (typeof DEP_LIST_SORT_KEYS)[number]

// ─── CRUD DTO: 端点摘要 ────────────────────────────────────────

export interface DepEndpointSummary {
  type: DepEndpointType
  id: string
  projectId: string
  projectName: string
  label: string | (typeof REDACTION_MARKERS)[number]
  isRedacted: boolean
}

// ─── CRUD DTO: 依赖列表项 ──────────────────────────────────────

export interface DepListItem {
  id: number
  organizationId: number
  providerEndpoint: MultiProjectEndpointRef
  consumerEndpoint: MultiProjectEndpointRef
  category: MultiProjectDependencyCategory
  type: MultiProjectDependencyType
  lagDays: number
  strength: MultiProjectDependencyStrength
  bufferDays: number
  status: MultiProjectDependencyStatus
  riskLevel: MultiProjectDependencyRiskLevel
  ownerUserId: number | null
  sourceMode: MultiProjectDependencySourceMode
  sourceSuggestionId: number | null
  evidenceRefs?: MultiProjectEvidenceRef[]
  freshnessSignature: string
  freshnessCheckedAt: string | null
  freshnessStatus: 'fresh' | 'stale' | 'unknown'
  confirmationHash: string | null
  idempotencyKey: string | null
  createdAt: string
  updatedAt: string | null
  archivedAt: string | null
  warningCodes?: MultiProjectWarningCode[]
}

// ─── CRUD DTO: 依赖详情 ────────────────────────────────────────

export interface DepDetail extends DepListItem {
  evidenceRefs: MultiProjectEvidenceRef[]
}

// ─── CRUD DTO: 列表过滤器 ──────────────────────────────────────

export interface DepListFilters {
  projectIds?: number[]
  endpointType?: MultiProjectEndpointType
  category?: MultiProjectDependencyCategory
  type?: MultiProjectDependencyType
  status?: MultiProjectDependencyStatus[]
  riskLevel?: MultiProjectDependencyRiskLevel
  sourceMode?: MultiProjectDependencySourceMode
  freshness?: 'fresh' | 'stale'
  dateFrom?: string
  dateTo?: string
  search?: string
  page?: number
  perPage?: number
  sort?: string
}

export const DEP_LIST_DEFAULT_PER_PAGE = 20
export const DEP_LIST_MAX_PER_PAGE = 100

// ─── CRUD DTO: 列表响应 ────────────────────────────────────────

export interface DepListResponse {
  data: DepListItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// ─── CRUD DTO: 预览输入 ────────────────────────────────────────

export interface DepCreatePreviewInput {
  providerEndpointType: MultiProjectEndpointType
  providerProjectId?: number | null
  providerMilestoneId?: number | null
  providerTaskId?: number | null
  providerExternalLabel?: string | null
  providerExternalKey?: string | null
  consumerEndpointType: MultiProjectEndpointType
  consumerProjectId?: number | null
  consumerMilestoneId?: number | null
  consumerTaskId?: number | null
  consumerExternalLabel?: string | null
  consumerExternalKey?: string | null
  category: MultiProjectDependencyCategory
  type?: MultiProjectDependencyType
  lagDays?: number
  strength?: MultiProjectDependencyStrength
  bufferDays?: number
  riskLevel?: MultiProjectDependencyRiskLevel
  sourceMode?: MultiProjectDependencySourceMode
}

export interface DepUpdatePreviewInput {
  dependencyId: number
  category?: MultiProjectDependencyCategory
  type?: MultiProjectDependencyType
  lagDays?: number
  strength?: MultiProjectDependencyStrength
  bufferDays?: number
  status?: MultiProjectDependencyStatus
  riskLevel?: MultiProjectDependencyRiskLevel
  ownerUserId?: number | null
}

export interface DepArchivePreviewInput {
  dependencyId: number
}

export interface DepRestorePreviewInput {
  dependencyId: number
}

export interface DepDeletePreviewInput {
  dependencyId: number
}

// ─── CRUD DTO: 预览快照 ────────────────────────────────────────

export interface DepPreviewSnapshot {
  previewId: string
  operation: DepCrudOperation
  organizationId: string
  providerSummary: DepEndpointSummary
  consumerSummary: DepEndpointSummary
  proposedDiff: Record<string, { from: unknown; to: unknown }>
  warnings: DepCrudWarningCode[]
  isRedacted: boolean
  freshnessSignature: string
  confirmationHash: string
  expiresAt: string
  idempotencyGuidance: string
  createdAt: string
}

// ─── CRUD DTO: 确认请求 ────────────────────────────────────────

export interface DepConfirmRequest {
  previewId: string
  confirmationHash: string
  idempotencyKey: string
}

// ─── CRUD DTO: 确认结果 ────────────────────────────────────────

export interface DepConfirmResult {
  dependency: DepDetail
  auditEventId: string | null
  isReplay: boolean
}

// ─── CRUD DTO: 审计摘要 ────────────────────────────────────────

export interface DepAuditSummary {
  actorId: string
  organizationId: string
  operation: DepCrudOperation
  queryHash: string
  dependencyId: string | null
  endpointHashes: string[]
  warningCodes: DepCrudWarningCode[]
  freshnessHash: string
  confirmationHash: string
  idempotencyKeyHash: string
  statusTransition: string | null
  timestamp: string
}

// ─── CRUD DTO: 特性开关禁用响应 ────────────────────────────────

export interface DepFeatureDisabledResponse {
  error: {
    code: 'FEATURE_DISABLED'
    message: string
    details?: { feature: string }
  }
}

// ─── 预览过期默认值 ────────────────────────────────────────────

export const DEP_PREVIEW_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const DEP_IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
