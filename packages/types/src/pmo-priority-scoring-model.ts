/**
 * pmo-priority-scoring-model —— PMO 优先级评分模型共享契约
 *
 * 首期权重版本 pmo-priority-v1：
 *   维度：delivery_urgency / traffic_light_severity / management_attention /
 *         risk_pressure / resource_pressure / prediction_pressure / freshness / review_state
 *   阈值：critical ≥ 80 / high ≥ 60 / medium ≥ 40 / low < 40 / unranked = 无法评分
 *   tie-breaker: 等级 → traffic_light_severity → due_urgency → project_id
 *
 * 职责：定义确定性评分的 DTO、常量、权重 catalogue、纯函数 helper 与 fixture。
 * 纯函数不碰 HTTP、数据库或权限。
 */

// ─── 优先级等级 ──────────────────────────────────────────────

export const PRIORITY_LEVELS = ['critical', 'high', 'medium', 'low', 'unranked'] as const
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number]

export const PRIORITY_LEVEL_SCORE_RANGE: Record<PriorityLevel, [number, number]> = {
  critical: [80, 100],
  high: [60, 80],
  medium: [40, 60],
  low: [0, 40],
  unranked: [-1, -1],
}

export const PRIORITY_LEVEL_LABELS: Record<PriorityLevel, string> = {
  critical: '紧急',
  high: '高',
  medium: '中',
  low: '低',
  unranked: '未排名',
}

// ─── 维度键 ──────────────────────────────────────────────────

export const SCORE_DIMENSION_KEYS = [
  'delivery_urgency',
  'traffic_light_severity',
  'management_attention',
  'risk_pressure',
  'resource_pressure',
  'prediction_pressure',
  'freshness',
  'review_state',
] as const
export type ScoreDimensionKey = (typeof SCORE_DIMENSION_KEYS)[number]

export const SCORE_DIMENSION_LABELS: Record<ScoreDimensionKey, string> = {
  delivery_urgency: '交付紧急度',
  traffic_light_severity: '交通灯严重度',
  management_attention: '管理关注度',
  risk_pressure: '风险压力',
  resource_pressure: '资源压力',
  prediction_pressure: '预测压力',
  freshness: '数据新鲜度',
  review_state: '复核状态',
}

// ─── 维度可用性状态 ──────────────────────────────────────────

export const DIMENSION_AVAILABILITY_STATES = [
  'available',
  'unavailable',
  'forbidden',
  'stale',
  'unsupported',
] as const
export type DimensionAvailabilityState = (typeof DIMENSION_AVAILABILITY_STATES)[number]

// ─── 警告码 ──────────────────────────────────────────────────

export const PRIORITY_WARNING_CODES = [
  'DIMENSION_UNAVAILABLE',
  'DIMENSION_FORBIDDEN',
  'DIMENSION_STALE',
  'DIMENSION_UNSUPPORTED',
  'SOURCE_STALE',
  'SOURCE_UNAVAILABLE',
  'FINANCIAL_UNSUPPORTED',
  'EMPTY_PORTFOLIO',
  'CACHE_DEGRADED',
  'FEATURE_OFF',
  'PERMISSION_DENIED',
] as const
export type PriorityWarningCode = (typeof PRIORITY_WARNING_CODES)[number]

// ─── 分数版本常量 ────────────────────────────────────────────

export const SCORE_VERSIONS = ['pmo-priority-v1'] as const
export type ScoreVersion = (typeof SCORE_VERSIONS)[number]

export const DEFAULT_SCORE_VERSION: ScoreVersion = 'pmo-priority-v1'

// ─── 支持的过滤器/排序/分组键 ─────────────────────────────────

export const SUPPORTED_PRIORITY_FILTERS = [
  'priority_level',
  'dimension_availability',
  'score_version',
] as const
export type SupportedPriorityFilter = (typeof SUPPORTED_PRIORITY_FILTERS)[number]

export const SUPPORTED_PRIORITY_SORT_KEYS = [
  'priority_score',
  'priority_level',
  'rank',
  'project_name',
  'updated_at',
] as const
export type SupportedPrioritySortKey = (typeof SUPPORTED_PRIORITY_SORT_KEYS)[number]

export const SUPPORTED_PRIORITY_GROUP_KEYS = [
  'priority_level',
  'traffic_light',
  'department',
  'manager',
] as const
export type SupportedPriorityGroupKey = (typeof SUPPORTED_PRIORITY_GROUP_KEYS)[number]

export const DEFAULT_PRIORITY_PAGE_SIZE = 20
export const MAX_PRIORITY_PAGE_SIZE = 100

// ─── 权重目录 (pmo-priority-v1) ───────────────────────────────

export interface DimensionWeight {
  key: ScoreDimensionKey
  weight: number
  normalizedRange: [number, number]
  stalePenaltyFactor: number
}

export const SCORE_WEIGHT_CATALOGUE: Record<ScoreVersion, DimensionWeight[]> = {
  'pmo-priority-v1': [
    {
      key: 'delivery_urgency',
      weight: 0.25,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'traffic_light_severity',
      weight: 0.2,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'management_attention',
      weight: 0.15,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'risk_pressure',
      weight: 0.12,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'resource_pressure',
      weight: 0.1,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'prediction_pressure',
      weight: 0.08,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'freshness',
      weight: 0.05,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
    {
      key: 'review_state',
      weight: 0.05,
      normalizedRange: [0, 100],
      stalePenaltyFactor: 0.3,
    },
  ],
}

// ─── DTO 类型 ─────────────────────────────────────────────────

/** 评分输入签名——用于复现审计 */
export interface PriorityInputSignature {
  version: ScoreVersion
  organizationHash: string
  inputsHash: string
  computedAt: string
}

/** 源新鲜度 */
export interface PrioritySourceFreshness {
  source: string
  refreshedAt: string | null
  stale: boolean
  staleThresholdMs: number
}

/** 维度贡献 */
export interface ScoreDimensionContribution {
  dimension: ScoreDimensionKey
  rawValue: number
  normalizedValue: number
  weight: number
  weightedContribution: number
  availability: DimensionAvailabilityState
  warning?: PriorityWarningCode
  evidenceRefs: PriorityEvidenceRef[]
}

/** 低敏证据引用 */
export interface PriorityEvidenceRef {
  ref: string
  kind: string
  lowSensitiveLabel: string
}

/** 优先级警告 */
export interface PriorityWarning {
  code: PriorityWarningCode
  message: string
  dimension?: ScoreDimensionKey
  source?: string
}

/** 允许的动作 */
export interface PriorityAllowedAction {
  action: string
  label: string
  enabled: boolean
  reason?: string
}

/** 单个项目的评分项 */
export interface PriorityScoreItem {
  projectId: number
  projectName: string
  priorityScore: number
  priorityLevel: PriorityLevel
  rank: number
  scoreVersion: ScoreVersion
  calculatedAt: string
  inputSignature: PriorityInputSignature
  sourceFreshness: PrioritySourceFreshness[]
  dimensions: ScoreDimensionContribution[]
  topReasons: ScoreDimensionContribution[]
  warnings: PriorityWarning[]
  allowedActions: PriorityAllowedAction[]
  tieBreaker: PriorityTieBreaker
}

/** 稳定 tie-breaker */
export interface PriorityTieBreaker {
  level: PriorityLevel
  trafficLightSeverity: number
  dueUrgency: number
  projectId: number
}

/** 评分摘要 */
export interface PriorityScoringSummary {
  totalProjects: number
  scoredProjects: number
  unscoredProjects: number
  levelCounts: Record<PriorityLevel, number>
  scoreVersion: ScoreVersion
  weightVersion: ScoreVersion
  sourceFreshness: PrioritySourceFreshness[]
  warnings: PriorityWarning[]
  calculatedAt: string
}

/** 分组切片 */
export interface PriorityGroupSlice {
  groupKey: SupportedPriorityGroupKey
  groupValue: string
  count: number
  averageScore: number
  levelCounts: Record<PriorityLevel, number>
}

/** 权重版本说明 */
export interface PriorityWeightVersion {
  version: ScoreVersion
  dimensions: DimensionWeight[]
  thresholds: Record<PriorityLevel, [number, number]>
  description: string
}

/** 项目详情评分 */
export interface PriorityScoreDetail extends PriorityScoreItem {
  groupSlices?: PriorityGroupSlice[]
}

/** 分页元数据 */
export interface PriorityPaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

/** 评分列表响应 */
export interface PriorityScoringListResponse {
  data: PriorityScoreItem[]
  meta: PriorityPaginationMeta
}

/** 分组切片响应 */
export interface PriorityGroupSliceResponse {
  data: PriorityGroupSlice[]
  meta: PriorityPaginationMeta
}

/** 查询参数 */
export interface PriorityScoringQuery {
  page?: number
  perPage?: number
  sort?: string
  priorityLevels?: PriorityLevel[]
  scoreVersion?: ScoreVersion
  groupBy?: SupportedPriorityGroupKey
  dimensionKey?: ScoreDimensionKey
}

/** 项目详情查询 */
export interface PriorityScoringDetailQuery {
  scoreVersion?: ScoreVersion
  includeGroupSlices?: boolean
}

// ─── 默认常量 ─────────────────────────────────────────────────

export const DEFAULT_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── 纯函数 helper ────────────────────────────────────────────

/** 查权重版本 */
export function resolveScoreWeights(version: ScoreVersion): DimensionWeight[] {
  const weights = SCORE_WEIGHT_CATALOGUE[version]
  if (!weights) throw new Error(`Unknown score version: ${version}`)
  return weights
}

/** 查维度权重 */
export function resolveDimensionWeight(
  version: ScoreVersion,
  dimension: ScoreDimensionKey,
): DimensionWeight {
  const weights = resolveScoreWeights(version)
  const dw = weights.find((w) => w.key === dimension)
  if (!dw) throw new Error(`Unknown dimension: ${dimension}`)
  return dw
}

/** 归一化原始值到 0-100 */
export function normalizeDimensionValue(rawValue: number, range: [number, number]): number {
  const [min, max] = range
  if (min === max) return 50
  const clamped = Math.max(min, Math.min(max, rawValue))
  return Math.round(((clamped - min) / (max - min)) * 100)
}

/** 加权贡献计算 */
export function computeWeightedContribution(normalizedValue: number, weight: number): number {
  return Math.round(normalizedValue * weight * 100) / 100
}

/** 四舍五入评分 */
export function roundScore(score: number): number {
  return Math.round(score * 100) / 100
}

/** 从评分推导优先级等级 */
export function derivePriorityLevel(
  score: number,
  thresholds?: Record<PriorityLevel, [number, number]>,
): PriorityLevel {
  const t = thresholds ?? PRIORITY_LEVEL_SCORE_RANGE
  if (score < 0) return 'unranked'
  if (score >= t.critical[0]) return 'critical'
  if (score >= t.high[0]) return 'high'
  if (score >= t.medium[0]) return 'medium'
  return 'low'
}

/** 稳定 tie-breaker 排序 */
export function priorityTieBreakerSort(a: PriorityTieBreaker, b: PriorityTieBreaker): number {
  const levelOrder: Record<PriorityLevel, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    unranked: 0,
  }
  if (a.level !== b.level) return levelOrder[b.level] - levelOrder[a.level]
  if (a.trafficLightSeverity !== b.trafficLightSeverity)
    return b.trafficLightSeverity - a.trafficLightSeverity
  if (a.dueUrgency !== b.dueUrgency) return b.dueUrgency - a.dueUrgency
  return a.projectId - b.projectId
}

/** 生成评分输入签名 */
export function computePriorityInputSignature(
  version: ScoreVersion,
  organizationId: number,
  inputs: Record<string, unknown>,
): PriorityInputSignature {
  const organizationHash = simpleHash(String(organizationId))
  const inputsHash = simpleHash(JSON.stringify(inputs))
  return {
    version,
    organizationHash,
    inputsHash,
    computedAt: new Date().toISOString(),
  }
}

/** 判断源是否过期 */
export function isPrioritySourceStale(
  refreshedAt: string | null,
  thresholdMs: number = DEFAULT_FRESHNESS_THRESHOLD_MS,
): boolean {
  if (!refreshedAt) return true
  const elapsed = Date.now() - new Date(refreshedAt).getTime()
  return elapsed > thresholdMs
}

/** 验证权重版本 */
export function isValidScoreVersion(v: string): v is ScoreVersion {
  return (SCORE_VERSIONS as readonly string[]).includes(v)
}

/** 验证优先级等级 */
export function isValidPriorityLevel(v: string): v is PriorityLevel {
  return (PRIORITY_LEVELS as readonly string[]).includes(v)
}

/** 验证排序键 */
export function isValidPrioritySortKey(v: string): v is SupportedPrioritySortKey {
  return (SUPPORTED_PRIORITY_SORT_KEYS as readonly string[]).includes(v)
}

/** 验证分组键 */
export function isValidPriorityGroupKey(v: string): v is SupportedPriorityGroupKey {
  return (SUPPORTED_PRIORITY_GROUP_KEYS as readonly string[]).includes(v)
}

// ─── 内部辅助 ─────────────────────────────────────────────────

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}
