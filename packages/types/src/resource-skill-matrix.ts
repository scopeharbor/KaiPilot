// @aiproj/types - Resource Skill Matrix shared contract.
// v3-resource-skill-matrix: skill normalization, coverage, gaps, advisory, warnings, freshness, evidence.
//
// 本契约前、后端共用：纯 TypeScript 类型 + 确定性纯函数，零运行时依赖。
// 资源技能矩阵是只读派生服务，不拥有资源或 Skill 事实。

// ─── Skill Normalization ────────────────────────────────────────────────────

/** 技能标签来源类型 */
export const SKILL_SOURCE_TYPES = {
  RESOURCE: 'resource',
  TASK_REQUIREMENT: 'task_requirement',
  RESOURCE_ALLOCATION: 'resource_allocation',
  SKILL_REGISTRY: 'skill_registry',
} as const

export type SkillSourceType = (typeof SKILL_SOURCE_TYPES)[keyof typeof SKILL_SOURCE_TYPES]

/** 技能标签来源引用，保留原始标签用于 low-sensitivity 证据与人工治理 */
export interface SkillSourceRef {
  sourceType: SkillSourceType
  sourceId: number | string
  originalTag: string
  contextLabel?: string
}

/** 规范化后的技能条目 */
export interface NormalizedSkillEntry {
  /** 规范化技能 key（确定性产出） */
  normalizedKey: string
  /** 原始标签来源列表（去重） */
  sourceRefs: SkillSourceRef[]
}

/** 别名映射条目 */
export interface SkillAliasEntry {
  pattern: string
  normalized: string
  confidence: 'high' | 'medium' | 'low'
}

// ─── Matrix Query ──────────────────────────────────────────────────────────

export const RESOURCE_SKILL_MATRIX_SCOPES = {
  ORGANIZATION: 'organization',
  PROJECT: 'project',
} as const

export type ResourceSkillMatrixScope =
  (typeof RESOURCE_SKILL_MATRIX_SCOPES)[keyof typeof RESOURCE_SKILL_MATRIX_SCOPES]

export const RESOURCE_SKILL_MATRIX_GROUP_BY = {
  SKILL: 'skill',
  RESOURCE: 'resource',
  PROJECT: 'project',
  ROLE: 'role',
} as const

export type ResourceSkillMatrixGroupBy =
  (typeof RESOURCE_SKILL_MATRIX_GROUP_BY)[keyof typeof RESOURCE_SKILL_MATRIX_GROUP_BY]

export const RESOURCE_SKILL_MATRIX_GROUP_BY_VALUES = Object.values(RESOURCE_SKILL_MATRIX_GROUP_BY)

export const RESOURCE_SKILL_MATRIX_SORT_FIELDS = {
  COVERAGE: 'coverage',
  SKILL_KEY: 'skill_key',
  RESOURCE_NAME: 'resource_name',
  PROJECT_NAME: 'project_name',
  GAP_SEVERITY: 'gap_severity',
  AVAILABLE_CAPACITY: 'available_capacity',
  SKILL_NAME: 'skill_name',
} as const

export type ResourceSkillMatrixSortField =
  (typeof RESOURCE_SKILL_MATRIX_SORT_FIELDS)[keyof typeof RESOURCE_SKILL_MATRIX_SORT_FIELDS]

export const RESOURCE_SKILL_MATRIX_SORT_FIELD_VALUES = Object.values(
  RESOURCE_SKILL_MATRIX_SORT_FIELDS,
)

/** 矩阵查询参数白名单 */
export interface ResourceSkillMatrixQuery {
  /** 组织/项目级 scope */
  scope?: ResourceSkillMatrixScope
  /** 限定项目 ID 列表，空=全部可见项目 */
  projectIds?: number[]
  /** 限定技能 key 列表 */
  skillKeys?: string[]
  /** 资源状态过滤 */
  resourceStatuses?: string[]
  /** 需求状态过滤 */
  requirementStatuses?: string[]
  /** 是否包含 Skill advisory */
  includeSkillAdvisory?: boolean
  /** 日期窗口起始（默认 30 天前） */
  from?: string
  /** 日期窗口结束（默认 today），最大跨度 180 天 */
  to?: string
  /** 返回行数上限（默认 20，最大 50） */
  topN?: number
  /** 分组维度 */
  groupBy?: ResourceSkillMatrixGroupBy
  /** 排序字段 */
  sort?: ResourceSkillMatrixSortField
  /** 搜索关键词（匹配技能名、资源名、项目名） */
  search?: string
  /** 分页 */
  page?: number
  perPage?: number
}

export const RESOURCE_SKILL_MATRIX_DEFAULT_TOP_N = 20
export const RESOURCE_SKILL_MATRIX_MAX_TOP_N = 50
export const RESOURCE_SKILL_MATRIX_DEFAULT_DATE_WINDOW_DAYS = 30
export const RESOURCE_SKILL_MATRIX_MAX_DATE_WINDOW_DAYS = 180
export const RESOURCE_SKILL_MATRIX_METRIC_VERSION = '1.0.0'

// ─── Warning Codes ──────────────────────────────────────────────────────────

export const RESOURCE_SKILL_MATRIX_WARNING_CODES = {
  // 政策/脱敏
  DATA_PARTIALLY_REDACTED: 'DATA_PARTIALLY_REDACTED',
  SKILL_ADVISORY_FORBIDDEN: 'SKILL_ADVISORY_FORBIDDEN',
  RESOURCE_DETAIL_FORBIDDEN: 'RESOURCE_DETAIL_FORBIDDEN',

  // 数据质量
  NORMALIZATION_AMBIGUOUS: 'NORMALIZATION_AMBIGUOUS',
  LOW_CONFIDENCE_ALIAS: 'LOW_CONFIDENCE_ALIAS',
  UNMATCHED_SKILL: 'UNMATCHED_SKILL',
  STALE_RESOURCE_DATA: 'STALE_RESOURCE_DATA',
  STALE_SKILL_DATA: 'STALE_SKILL_DATA',

  // 容量/需求
  CAPACITY_INSUFFICIENT: 'CAPACITY_INSUFFICIENT',
  OVERALLOCATED_RESOURCE: 'OVERALLOCATED_RESOURCE',
  NO_CANDIDATE_FOR_REQUIREMENT: 'NO_CANDIDATE_FOR_REQUIREMENT',
  CONFLICT_DETECTED: 'CONFLICT_DETECTED',

  // 基础设施
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  PARTIAL_ORGANIZATION_SCOPE: 'PARTIAL_ORGANIZATION_SCOPE',
  RESOURCE_POOL_UNAVAILABLE: 'RESOURCE_POOL_UNAVAILABLE',
} as const

export type ResourceSkillMatrixWarningCode =
  (typeof RESOURCE_SKILL_MATRIX_WARNING_CODES)[keyof typeof RESOURCE_SKILL_MATRIX_WARNING_CODES]

export const RESOURCE_SKILL_MATRIX_WARNING_CODE_VALUES = Object.values(
  RESOURCE_SKILL_MATRIX_WARNING_CODES,
)

export interface ResourceSkillMatrixWarning {
  code: ResourceSkillMatrixWarningCode
  message: string
  skillKey?: string
  resourceId?: number
  projectId?: number
  dimension?: string
  severity?: 'info' | 'warning' | 'critical'
}

// ─── Gap Severity ───────────────────────────────────────────────────────────

export const RESOURCE_SKILL_GAP_SEVERITIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none',
} as const

export type ResourceSkillGapSeverity =
  (typeof RESOURCE_SKILL_GAP_SEVERITIES)[keyof typeof RESOURCE_SKILL_GAP_SEVERITIES]

export const RESOURCE_SKILL_GAP_SEVERITY_ORDER: Record<ResourceSkillGapSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}

// ─── Freshness ──────────────────────────────────────────────────────────────

export const RESOURCE_SKILL_MATRIX_SOURCES = {
  PROJECT_RESOURCE: 'project_resource',
  TASK_REQUIREMENT: 'task_requirement',
  RESOURCE_LOAD: 'resource_load',
  RESOURCE_CONFLICT: 'resource_conflict',
  SKILL_REGISTRY: 'skill_registry',
  RESOURCE_POOL: 'resource_pool',
} as const

export type ResourceSkillMatrixSource =
  (typeof RESOURCE_SKILL_MATRIX_SOURCES)[keyof typeof RESOURCE_SKILL_MATRIX_SOURCES]

export interface ResourceSkillMatrixFreshness {
  source: ResourceSkillMatrixSource
  lastUpdatedAt: string | null
  stale: boolean
  staleReason?: string
}

// ─── Evidence ───────────────────────────────────────────────────────────────

export const RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY = {
  FULL: 'full',
  LOW_SENSITIVITY: 'low_sensitivity',
  REDACTED: 'redacted',
} as const

export type ResourceSkillMatrixEvidenceVisibility =
  (typeof RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY)[keyof typeof RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY]

export interface ResourceSkillMatrixEvidenceRef {
  source: ResourceSkillMatrixSource
  refSeed: string
  valueSummary: string
  visibility: ResourceSkillMatrixEvidenceVisibility
  lastUpdatedAt: string | null
}

// ─── Coverage ───────────────────────────────────────────────────────────────

/** 单个技能的覆盖摘要 */
export interface SkillCoverageSummary {
  /** 规范化技能 key */
  skillKey: string
  /** 可见资源总数 */
  totalResources: number
  /** 有该技能的可见资源数 */
  skilledResources: number
  /** 总剩余可用容量（小时） */
  totalAvailableCapacityHours: number
  /** 总已分配容量（小时） */
  totalAllocatedCapacityHours: number
  /** 该技能的容量覆盖率（0-1） */
  coverageRatio: number
  /** 该技能的资源覆盖率（0-1） */
  resourceCoverageRatio: number
}

// ─── Gap ────────────────────────────────────────────────────────────────────

/** 技能缺口条目 */
export interface SkillGapEntry {
  /** 规范化技能 key */
  skillKey: string
  /** 缺口严重度 */
  severity: ResourceSkillGapSeverity
  /** 需求数量 */
  requirementCount: number
  /** 需求容量（小时） */
  requiredCapacityHours: number
  /** 可用容量（小时） */
  availableCapacityHours: number
  /** 缺口容量（小时） */
  gapCapacityHours: number
  /** 低敏需求来源列表 */
  requirementSourceRefs: string[]
  /** 可恢复建议文本 */
  recoverySuggestion?: string
  /** 关联警告 */
  warnings: ResourceSkillMatrixWarning[]
  /** v3-resource-gap-analysis 统一缺口引用（能力可用时填充） */
  gapAnalysisRef?: {
    metricVersion: string
    reasonCodes: string[]
    severity: string
    evidenceHashes: string[]
  }
}

// ─── Skill Advisory ─────────────────────────────────────────────────────────

/** Skill advisory 候选（只读，不自动激活） */
export interface SkillAdvisoryCandidate {
  /** Skill 低敏名称（无 skill:view 权限时脱敏） */
  skillName: string
  /** Skill key */
  skillKey: string
  /** Skill 版本 */
  skillVersion: string
  /** Skill 状态 */
  skillStatus: string
  /** Skill 分类 */
  skillCategory?: string
  /** 匹配的标签 */
  matchedTags: string[]
  /** 匹配原因 */
  matchReason: string
  /** 是否为评审中（eval） */
  evaluationOnly: boolean
  /** 始终为 true */
  advisoryOnly: true
  /** 始终为 false */
  activationApplied: false
  /** Skill 详情下钻链接（无权限时为 null） */
  drillDownUrl: string | null
}

// ─── Matrix Row ─────────────────────────────────────────────────────────────

/** 资源技能矩阵行（核心聚合行） */
export interface ResourceSkillMatrixRow {
  /** 规范化技能 key */
  skillKey: string
  /** 技能显示名称 */
  skillLabel: string
  /** 可见资源数 */
  resourceCount: number
  /** 可用总容量（小时） */
  totalAvailableCapacityHours: number
  /** 已分配总容量（小时） */
  totalAllocatedCapacityHours: number
  /** 剩余容量（小时） */
  remainingCapacityHours: number
  /** 关联任务需求数 */
  requirementCount: number
  /** 需求容量（小时） */
  requiredCapacityHours: number
  /** 覆盖率（0-1） */
  coverageRatio: number
  /** 缺口严重度 */
  gapSeverity: ResourceSkillGapSeverity
  /** 候选资源列表 */
  candidateResources: ResourceCandidateSummary[]
  /** Skill advisory 候选 */
  skillAdvisory: SkillAdvisoryCandidate[]
  /** 冲突摘要 */
  conflictSummary: string[]
  /** 证据引用 */
  evidenceRefs: ResourceSkillMatrixEvidenceRef[]
  /** 关联警告 */
  warnings: ResourceSkillMatrixWarning[]
}

// ─── Candidate Resource ─────────────────────────────────────────────────────

/** 候选资源摘要（用于矩阵行中的资源列举） */
export interface ResourceCandidateSummary {
  resourceId: number
  resourceName: string
  role: string
  availableCapacityHours: number
  allocatedCapacityHours: number
  remainingCapacityHours: number
  skillTags: string[]
  matchScore?: number
  conflictSummary: string[]
}

// ─── Response Envelopes ─────────────────────────────────────────────────────

/** 矩阵元数据 */
export interface ResourceSkillMatrixMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  scope: ResourceSkillMatrixScope
  visibleProjectCount: number
  visibleResourceCount: number
  visibleRequirementCount: number
  visibleSkillCount: number
  dateWindow: { from: string; to: string }
  sourceFreshness: ResourceSkillMatrixFreshness[]
  inputSignatureHash: string
}

/** 矩阵摘要响应 */
export interface ResourceSkillMatrixSummaryResponse {
  meta: ResourceSkillMatrixMeta
  /** 总技能覆盖率（0-1） */
  overallCoverageRatio: number
  /** 有缺口的技能数 */
  totalGaps: number
  /** 候选资源总数 */
  totalCandidateResources: number
  /** Skill advisory 总数 */
  totalSkillAdvisories: number
  /** 技能覆盖率明细 */
  coverageBySkill: SkillCoverageSummary[]
  /** 严重缺口列表（top 10） */
  criticalGaps: SkillGapEntry[]
  /** 关联警告 */
  warnings: ResourceSkillMatrixWarning[]
  /** v3-resource-gap-analysis 统一缺口引用（能力可用时填充） */
  gapAnalysisRef?: {
    metricVersion: string
    reasonCodes: string[]
    severity: string
    evidenceHashes: string[]
  }
}

/** 矩阵全量响应 */
export interface ResourceSkillMatrixResponse {
  meta: ResourceSkillMatrixMeta
  rows: ResourceSkillMatrixRow[]
  warnings: ResourceSkillMatrixWarning[]
}

/** 覆盖率响应 */
export interface ResourceSkillMatrixCoverageResponse {
  meta: ResourceSkillMatrixMeta
  coverages: SkillCoverageSummary[]
  warnings: ResourceSkillMatrixWarning[]
}

/** 缺口响应 */
export interface ResourceSkillMatrixGapsResponse {
  meta: ResourceSkillMatrixMeta
  gaps: SkillGapEntry[]
  warnings: ResourceSkillMatrixWarning[]
}

/** 候选资源响应 */
export interface ResourceSkillMatrixCandidatesResponse {
  meta: ResourceSkillMatrixMeta
  skillKey: string
  candidates: ResourceCandidateSummary[]
  warnings: ResourceSkillMatrixWarning[]
}

/** Skill 详情响应（来自矩阵下钻） */
export interface ResourceSkillMatrixSkillDetailResponse {
  meta: ResourceSkillMatrixMeta
  skillKey: string
  skillLabel: string
  resourceCount: number
  requirementCount: number
  coverageRatio: number
  gapSeverity: ResourceSkillGapSeverity
  resources: ResourceCandidateSummary[]
  advisory: SkillAdvisoryCandidate[]
  evidenceRefs: ResourceSkillMatrixEvidenceRef[]
  warnings: ResourceSkillMatrixWarning[]
}

/**
 * 下钻响应（项目、资源、需求详情二次授权）。
 *
 * 后端实码 `{ data: { items }, meta }`（`resource_skill_matrix_controller#drillDown`）：
 * `meta` 与 `data` 平级，顶层**没有** `warnings`（警告挂在每个下钻 item 上）。
 */
export interface ResourceSkillMatrixDrillDownResponse {
  items: ResourceSkillMatrixDrillDownItem[]
  meta: ResourceSkillMatrixMeta
}

export interface ResourceSkillMatrixDrillDownItem {
  itemId: number
  itemType: 'resource' | 'task_requirement' | 'project'
  itemName: string
  skillKey: string
  details: Record<string, unknown>
  evidenceRefs: ResourceSkillMatrixEvidenceRef[]
  warnings: ResourceSkillMatrixWarning[]
}

// ─── Deterministic Pure Functions ───────────────────────────────────────────

/**
 * 技能标签确定性规范化。
 * 规则：trim → 小写 → 连续空白归一 → 全角半角安全归一 → 去重。
 * 返回规范化 key，不改变输入。
 */
export function normalizeSkillTag(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  // Trim
  let result = raw.trim()
  // 全角字母/数字 → 半角
  result = result.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
  // 全角空格 → 半角
  result = result.replace(/　/g, ' ')
  // 连续空白 → 单个空格
  result = result.replace(/\s+/g, ' ')
  // 小写
  result = result.toLowerCase()
  // 再次 trim（可能因替换产生前导/尾随空白）
  return result.trim()
}

/**
 * 批量规范化技能标签列表。
 * - 返回去重后的规范化 key 数组（稳定排序）。
 * - 同时返回每个规范化 key 对应的来源引用列表。
 */
export function normalizeSkillTags(
  tags: readonly string[],
  sourceRefBuilder?: (tag: string) => SkillSourceRef,
): { normalizedKeys: string[]; entries: NormalizedSkillEntry[] } {
  const map = new Map<string, SkillSourceRef[]>()
  for (const tag of tags) {
    const key = normalizeSkillTag(tag)
    if (!key) continue
    const refs = map.get(key) ?? []
    const ref = sourceRefBuilder ? sourceRefBuilder(tag) : (null as any)
    if (
      ref &&
      !refs.some(
        (existing) =>
          existing.sourceId === ref.sourceId &&
          existing.sourceType === ref.sourceType &&
          existing.originalTag === ref.originalTag,
      )
    ) {
      refs.push(ref)
    } else if (!ref) {
      // 无 builder 时仍记录原始标签
      const placeholder: SkillSourceRef = {
        sourceType: 'resource' as const,
        sourceId: 0,
        originalTag: tag,
      }
      if (!refs.some((existing) => existing.originalTag === tag)) {
        refs.push(placeholder)
      }
    }
    map.set(key, refs)
  }
  const normalizedKeys = [...map.keys()].sort()
  const entries: NormalizedSkillEntry[] = normalizedKeys.map((key) => ({
    normalizedKey: key,
    sourceRefs: map.get(key)!,
  }))
  return { normalizedKeys, entries }
}

/**
 * 使用别名映射表规范化技能标签。
 * 先做标准规范化，再用别名映射表做二级映射。
 * 返回 { normalizedKey, confidence, matchedAlias }。
 */
export function normalizeSkillTagWithAliases(
  raw: string,
  aliases: readonly SkillAliasEntry[],
): { normalizedKey: string; confidence: 'high' | 'medium' | 'low'; matchedAlias: boolean } {
  const baseKey = normalizeSkillTag(raw)
  if (!baseKey) return { normalizedKey: '', confidence: 'low', matchedAlias: false }

  for (const alias of aliases) {
    if (
      normalizeSkillTag(alias.pattern) === baseKey ||
      baseKey.includes(normalizeSkillTag(alias.pattern))
    ) {
      return { normalizedKey: alias.normalized, confidence: alias.confidence, matchedAlias: true }
    }
  }

  return { normalizedKey: baseKey, confidence: 'high', matchedAlias: false }
}

/**
 * 构建技能覆盖摘要。
 * 输入：规范化技能 key 列表、资源按技能分组数据、需求按技能分组数据。
 */
export function buildSkillCoverageSummary(input: {
  skillKey: string
  skilledResourceCount: number
  totalResourceCount: number
  totalAvailableCapacityHours: number
  totalAllocatedCapacityHours: number
}): SkillCoverageSummary {
  const resourceCoverageRatio =
    input.totalResourceCount > 0 ? input.skilledResourceCount / input.totalResourceCount : 0
  const coverageRatio =
    input.totalAllocatedCapacityHours + input.totalAvailableCapacityHours > 0
      ? input.totalAvailableCapacityHours /
        (input.totalAllocatedCapacityHours + input.totalAvailableCapacityHours)
      : input.skilledResourceCount > 0
        ? 1
        : 0

  return {
    skillKey: input.skillKey,
    totalResources: input.totalResourceCount,
    skilledResources: input.skilledResourceCount,
    totalAvailableCapacityHours: roundTwo(input.totalAvailableCapacityHours),
    totalAllocatedCapacityHours: roundTwo(input.totalAllocatedCapacityHours),
    coverageRatio: roundTwo(coverageRatio),
    resourceCoverageRatio: roundTwo(resourceCoverageRatio),
  }
}

/**
 * 构建技能缺口摘要。
 */
export function buildSkillGapSummary(input: {
  skillKey: string
  requirementCount: number
  requiredCapacityHours: number
  availableCapacityHours: number
  requirementSourceRefs: string[]
  recoverySuggestion?: string
  warnings?: ResourceSkillMatrixWarning[]
}): SkillGapEntry {
  const gapCapacityHours = Math.max(0, input.requiredCapacityHours - input.availableCapacityHours)
  const ratio =
    input.requiredCapacityHours > 0 ? input.availableCapacityHours / input.requiredCapacityHours : 1
  let severity: ResourceSkillGapSeverity = 'none'
  if (ratio < 0.25) severity = 'critical'
  else if (ratio < 0.5) severity = 'high'
  else if (ratio < 0.75) severity = 'medium'
  else if (ratio < 1) severity = 'low'

  return {
    skillKey: input.skillKey,
    severity,
    requirementCount: input.requirementCount,
    requiredCapacityHours: roundTwo(input.requiredCapacityHours),
    availableCapacityHours: roundTwo(input.availableCapacityHours),
    gapCapacityHours: roundTwo(gapCapacityHours),
    requirementSourceRefs: input.requirementSourceRefs,
    recoverySuggestion:
      input.recoverySuggestion ??
      (severity !== 'none' ? `建议为技能 ${input.skillKey} 补充资源或调整任务需求` : undefined),
    warnings: input.warnings ?? [],
  }
}

/** 按缺口 severity 做稳定排序 */
export function sortMatrixRowsByGapSeverity<T extends { gapSeverity: ResourceSkillGapSeverity }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const order =
      RESOURCE_SKILL_GAP_SEVERITY_ORDER[a.gapSeverity] -
      RESOURCE_SKILL_GAP_SEVERITY_ORDER[b.gapSeverity]
    return order !== 0 ? order : 0
  })
}

/** 按技能 key 做稳定排序 */
export function sortMatrixRowsBySkillKey<T extends { skillKey: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.skillKey.localeCompare(b.skillKey, 'zh-Hans-CN'))
}

/** 按资源名称做稳定排序 */
export function sortByResourceName<T extends { resourceName: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.resourceName.localeCompare(b.resourceName, 'zh-Hans-CN'))
}

/** 按项目名称做稳定排序 */
export function sortByProjectName<T extends { projectName: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh-Hans-CN'))
}

/** 严格 float 两位小数 */
export function roundTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** 稳定字符串哈希 */
export function stableStringHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
