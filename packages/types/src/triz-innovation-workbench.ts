// @aiproj/types — V3 TRIZ Innovation Workbench 共享契约（前后端共享）
// v3-triz-innovation-workbench / design D1–D7
//
// 设计要点（advisory-only 语义，贯穿全文件）：
// - 工作台是 PM 审查层，不是 Compiler Stage，也不写正式业务表。
// - 方案（Scheme）= 用户加入篮子的一个方案，包含 1-N 个 option + 备注 + 评分 + 状态 + handoff 引用。
// - 路径（Option）= 来自 TRIZ analysis resolution path 或确定性映射的单个候选路径。
// - 评分确定性优先：AI 只能写中文说明，不得改变事实分数、source refs、影响维度或 handoff 资格。
// - 影响摘要是静态方向标注（非 what-if 仿真），禁止生成临时排程基线或自动甘特重排。
// - Handoff 只创建 sourceType=triz_innovation_workbench 的 Draft Layer 候选输入。
// - 所有 source ref 仅引用低敏摘要/refs/hash；禁止包含完整 prompt、模型输出、API Key 或敏感证据。
//
// 隐私边界：本文件定义的类型不得携带完整证据正文、完整 AI 输出、敏感路径或未授权实体详情；
// 只允许 refs / hash / 低敏 summary / status / warnings / cost refs。

import type {
  ContradictionSeverity,
  InventivePrincipleId,
  ProjectParameterKey,
} from './triz-contradiction.js'
import { deterministicHash } from './triz-contradiction.js'
import type { TrizAnalysisWarning, TrizWarningSeverity } from './triz-compiler-analysis.js'

// ---------------------------------------------------------------------------
// 枚举与常量
// ---------------------------------------------------------------------------

/** 方案状态机：open → abandoned / handed_off */
export const INNOVATION_SCHEME_STATUSES = ['open', 'abandoned', 'handed_off'] as const
export type InnovationSchemeStatus = (typeof INNOVATION_SCHEME_STATUSES)[number]

/** 候选路径来源：TRIZ analysis 解决路径 / 确定性映射 */
export const INNOVATION_OPTION_ORIGINS = ['triz_analysis_path', 'deterministic_mapping'] as const
export type InnovationOptionOrigin = (typeof INNOVATION_OPTION_ORIGINS)[number]

/** Source ref 类型：矛盾快照 / TRIZ analysis artifact */
export const INNOVATION_SOURCE_TYPES = ['contradiction', 'triz_analysis'] as const
export type InnovationSourceType = (typeof INNOVATION_SOURCE_TYPES)[number]

/** 影响方向（静态标注，非仿真数值） */
export const IMPACT_DIRECTIONS = ['improves', 'worsens', 'neutral', 'uncertain'] as const
export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number]

/** 影响维度（D4：六维静态摘要） */
export const IMPACT_DIMENSIONS = [
  'schedule',
  'resource_load',
  'risk',
  'scope_flexibility',
  'quality_maintainability',
  'change_complexity',
] as const
export type ImpactDimension = (typeof IMPACT_DIMENSIONS)[number]

/** 人工评审状态 */
export const INNOVATION_REVIEW_STATES = ['pending', 'reviewed', 'needs_changes'] as const
export type InnovationReviewState = (typeof INNOVATION_REVIEW_STATES)[number]

/** Handoff 状态（与 TrizHandoffStatus 对齐，独立定义避免跨文件耦合） */
export const INNOVATION_HANDOFF_STATUSES = [
  'none',
  'candidate_created',
  'stale',
  'handed_off',
] as const
export type InnovationHandoffStatus = (typeof INNOVATION_HANDOFF_STATUSES)[number]

/** 方案篮子最大数量（Open Question：第一版限 5） */
export const INNOVATION_SCHEME_MAX_OPTIONS = 5

/** Draft Layer source type 标识（handoff 候选输入专用） */
export const TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE = 'triz_innovation_workbench'

/** 方案 schema 版本（随类型演进递增） */
export const INNOVATION_SCHEME_SCHEMA_VERSION = '1.0.0'

/** 列表排序字段 */
export const INNOVATION_SORT_FIELDS = ['score', 'severity', 'createdAt', 'reviewedAt'] as const
export type InnovationSortField = (typeof INNOVATION_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// Source ref（低敏引用）
// ---------------------------------------------------------------------------

/**
 * 工作台 source ref：只引用矛盾快照或 TRIZ analysis artifact 的低敏字段。
 * 禁止包含完整证据正文、AI 解释全文或敏感路径。
 */
export interface InnovationSourceRef {
  sourceType: InnovationSourceType
  /** contradiction key 或 triz_analysis artifactId */
  ref: string
  /** inputSignature（contradiction）或 contentHash（triz_analysis） */
  hash: string | null
  severity: ContradictionSeverity | null
  stale: boolean
  /** 低敏短标题 */
  title: string
  /** 可选关联 compiler run id（triz_analysis 来源） */
  compilerRunId?: number | null
}

// ---------------------------------------------------------------------------
// Option（候选路径）
// ---------------------------------------------------------------------------

/** 静态影响摘要（六维方向标注，非仿真数值） */
export interface InnovationImpactSummary {
  schedule: ImpactDirection
  resource_load: ImpactDirection
  risk: ImpactDirection
  scope_flexibility: ImpactDirection
  quality_maintainability: ImpactDirection
  change_complexity: ImpactDirection
}

/** 候选 option 的来源 hash 集合（handoff 幂等与 stale 判定） */
export interface InnovationOptionHashes {
  /** 关联矛盾 inputSignature 列表 */
  contradictionSignatures: string[]
  /** 关联 triz_analysis contentHash 列表 */
  analysisContentHashes: string[]
  /** 选中 resolution path id（如有） */
  selectedPathId: string | null
}

/**
 * 候选路径（advisory）：来自 TRIZ analysis resolution path 或确定性映射。
 * 不包含任何可执行 patch 字段；只保留描述性建议、来源 refs、hash、影响摘要与评审状态。
 */
export interface InnovationOption {
  /** 在 scheme 内稳定的 option id */
  optionId: string
  origin: InnovationOptionOrigin
  /** 关联的来源（矛盾 + analysis artifact refs） */
  sourceRefs: InnovationSourceRef[]
  /** 选中的 resolution path id（triz_analysis_path 来源时填充） */
  selectedPathId: string | null
  /** 候选原理 refs（仅 id） */
  principleIds: InventivePrincipleId[]
  /** 中文短名称 */
  name: string
  /** 中文描述（advisory） */
  description: string
  /** 适用条件 */
  applicability: string[]
  /** 不适用条件 */
  nonApplicability: string[]
  /** 来源 hash 集合 */
  hashes: InnovationOptionHashes
  /** 警告摘要（低敏） */
  warnings: TrizAnalysisWarning[]
  /** 静态影响摘要 */
  impact: InnovationImpactSummary
  /** 人工评审状态 */
  reviewState: InnovationReviewState
  /** 创建人 */
  createdBy: number
}

// ---------------------------------------------------------------------------
// Score（确定性评分）
// ---------------------------------------------------------------------------

/**
 * 确定性评分明细（零模型成本）。
 * AI narrative 不得修改任何字段。
 */
export interface InnovationScore {
  /** 综合分（0–100，确定性加权） */
  total: number
  /** 来源严重度分（critical/high/medium/low 映射） */
  severity: number
  /** 来源置信度分 */
  confidence: number
  /** stale 惩罚 */
  stalePenalty: number
  /** warning 严重度惩罚 */
  warningPenalty: number
  /** 适用条件匹配分 */
  applicability: number
  /** 约束匹配分 */
  constraintFit: number
  /** source hash 完整度分 */
  hashCompleteness: number
  /** 人工评审状态分 */
  reviewState: number
}

// ---------------------------------------------------------------------------
// Scheme（方案篮子）
// ---------------------------------------------------------------------------

/** 方案 AI 说明（可选，advisory） */
export interface InnovationSchemeNarrative {
  /** 中文叙述（advisory，不得引用结构化 ref 之外的事实） */
  narrative: string
  isFallback: boolean
  hallucinationChecked: boolean
  hallucinationPassed: boolean
  degradedReason: string | null
  /** 引用的 optionId 列表（须可追溯） */
  referencedOptionIds: string[]
  /** 引用的 principleId 列表 */
  referencedPrincipleIds: InventivePrincipleId[]
  /** 引用的参数 key 列表 */
  referencedParameterKeys: ProjectParameterKey[]
  provider: string | null
  model: string | null
  /** 成本摘要（不存正文） */
  cost: InnovationNarrativeCost | null
}

/** AI 调用成本摘要（低敏子集） */
export interface InnovationNarrativeCost {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
  latencyMs: number | null
  finishReason: string | null
  errorCategory: string | null
  budgetDecisionRef: string | null
  contextPacketRef: string | null
  modelOutputRef: string | null
}

/** Handoff 元数据 */
export interface InnovationHandoffMeta {
  status: InnovationHandoffStatus
  draftSessionRef: string | null
  handedOffAt: string | null
  blockedReason: string | null
}

/**
 * 方案（advisory）：用户加入篮子的一个方案，含 1-N option、备注、评分、状态与 handoff 引用。
 * 不直接修改任务/资源/风险/依赖/计划/范围。
 */
export interface InnovationScheme {
  schemeId: string
  organizationId: number
  projectId: number
  name: string
  note: string | null
  options: InnovationOption[]
  /** 确定性综合评分（每个 option 一个） */
  scores: Record<string, InnovationScore>
  status: InnovationSchemeStatus
  reviewState: InnovationReviewState
  handoff: InnovationHandoffMeta
  /** 可选 AI 说明（advisory） */
  narrative: InnovationSchemeNarrative | null
  /** 方案级来源 hash（所有 option hash 的稳定聚合） */
  schemeHash: string
  /** 最近一次确定性对比的快照 ref（可复现，仅作审计追溯） */
  comparisonRef: string | null
  schemaVersion: string
  createdBy: number
  createdAt: string
  updatedAt: string | null
  reviewedAt: string | null
  abandonedAt: string | null
}

// ---------------------------------------------------------------------------
// Comparison（方案对比）
// ---------------------------------------------------------------------------

/** 单个 option 在某维度的对比条目 */
export interface InnovationComparisonCell {
  optionId: string
  score: InnovationScore
  impact: InnovationImpactSummary
  warningCount: number
  blockingWarningCount: number
  reviewState: InnovationReviewState
  handoffEligible: boolean
}

/** 方案对比结果（静态影响摘要，非 what-if 仿真） */
export interface InnovationSchemeComparison {
  schemeId: string
  schemaVersion: string
  /** 按确定性得分稳定排序后的对比单元列表 */
  cells: InnovationComparisonCell[]
  /** 方案级 warnings 汇总 */
  warnings: TrizAnalysisWarning[]
  /** 计算时间（仅展示，不参与 hash） */
  calculatedAt: string
  /** 0 模型调用、0 模型成本标记 */
  modelCostRecorded: boolean
}

// ---------------------------------------------------------------------------
// Draft Layer Handoff 候选输入 DTO
// ---------------------------------------------------------------------------

/**
 * Draft Layer 候选输入（advisory）。
 * sourceType 恒为 triz_innovation_workbench；只创建候选元数据，不写正式数据。
 */
export interface InnovationDraftHandoffInput {
  sourceType: typeof TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE
  schemeId: string
  optionIds: string[]
  organizationId: number
  projectId: number
  actorId: number
  /** 来源矛盾 refs（key 列表） */
  contradictionRefs: string[]
  /** 来源 analysis artifact refs（artifactId 列表） */
  analysisArtifactRefs: string[]
  /** 来源 hash 集合（幂等与 stale 校验） */
  sourceHashes: {
    contradictionSignatures: string[]
    analysisContentHashes: string[]
    schemeHash: string
  }
  /** 警告摘要（低敏） */
  warningSummary: {
    total: number
    blocking: number
    codes: string[]
  }
  /** 幂等键 */
  idempotencyKey: string
  note: string | null
}

/** Handoff 响应 */
export interface InnovationDraftHandoffResponse {
  data: {
    handoffStatus: InnovationHandoffStatus
    draftSessionRef: string | null
    blockedReason: string | null
  }
}

// ---------------------------------------------------------------------------
// API DTO（请求/响应）
// ---------------------------------------------------------------------------

/** 方案 DTO（API 视角，与 InnovationScheme 一致但序列化友好） */
export type InnovationSchemeDTO = InnovationScheme

export interface ListInnovationSchemesResponse {
  data: InnovationSchemeDTO[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface InnovationSchemeDetailResponse {
  data: InnovationSchemeDTO
}

export interface InnovationSchemeComparisonResponse {
  data: InnovationSchemeComparison
}

export interface InnovationNarrativeResponse {
  data: InnovationSchemeNarrative
}

/** 工作台 source 列表响应（聚合授权矛盾 + analysis artifact） */
export interface InnovationWorkbenchSourcesResponse {
  data: {
    contradictions: InnovationSourceRef[]
    analysisArtifacts: Array<{
      artifactId: string
      compilerRunId: number | null
      contentHash: string | null
      status: string
      warningCount: number
      blockingWarningCount: number
      resolutionPathCount: number
      stale: boolean
      calculatedAt: string | null
    }>
    includeDraft: boolean
  }
}

/** Dashboard 只读、权限脱敏摘要 */
export interface InnovationDashboardSummary {
  openSchemeCount: number
  pendingHandoffCount: number
  warningCount: number
  /** 最高严重度来源摘要（低敏） */
  highestSeverity: ContradictionSeverity | null
  latestReviewedAt: string | null
  staleMarker: boolean
}

export interface InnovationDashboardSummaryResponse {
  data: {
    summary: InnovationDashboardSummary | null
    hasViewPermission: boolean
  }
}

// ---------------------------------------------------------------------------
// 创建/更新请求体
// ---------------------------------------------------------------------------

export interface CreateInnovationSchemeRequest {
  name: string
  note?: string
}

export interface AddOptionRequest {
  origin: InnovationOptionOrigin
  sourceRefs: Array<Pick<InnovationSourceRef, 'sourceType' | 'ref' | 'hash'>>
  selectedPathId?: string | null
  principleIds?: InventivePrincipleId[]
  name?: string
  description?: string
  applicability?: string[]
  nonApplicability?: string[]
}

// ---------------------------------------------------------------------------
// 工具函数：稳定 hash / 确定性排序 / warning 严重度 / source hash 比对
// ---------------------------------------------------------------------------

const WARNING_SEVERITY_RANK: Record<TrizWarningSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
}

/** warning 严重度排序：blocking > warning > info。 */
export function rankWarningSeverity(s: TrizWarningSeverity): number {
  return WARNING_SEVERITY_RANK[s] ?? 1
}

/** 按 warning 严重度稳定排序（同 severity 保持原序）。 */
export function sortWarningsBySeverity(warnings: TrizAnalysisWarning[]): TrizAnalysisWarning[] {
  return [...warnings].sort(
    (a, b) => rankWarningSeverity(a.severity) - rankWarningSeverity(b.severity),
  )
}

/** 影响方向权重（用于确定性评分辅助，improves 加分、worsens 减分）。 */
const IMPACT_DIRECTION_WEIGHT: Record<ImpactDirection, number> = {
  improves: 1,
  neutral: 0,
  uncertain: 0,
  worsens: -1,
}

export function impactDirectionWeight(d: ImpactDirection): number {
  return IMPACT_DIRECTION_WEIGHT[d] ?? 0
}

/**
 * 计算 option 稳定 hash：聚合 sourceType/ref/hash/selectedPathId/principleIds。
 * 同输入必同 hash（幂等与 stale 判定）。
 */
export function computeInnovationOptionHash(option: {
  sourceRefs: InnovationSourceRef[]
  selectedPathId: string | null
  principleIds: InventivePrincipleId[]
  origin: InnovationOptionOrigin
}): string {
  const stable = {
    o: option.origin,
    s: [...option.sourceRefs].map((s) => `${s.sourceType}:${s.ref}:${s.hash ?? ''}`).sort(),
    p: option.selectedPathId ?? '',
    pr: [...option.principleIds].sort(),
  }
  return `iw-opt-${deterministicHash(JSON.stringify(stable))}`
}

/**
 * 计算方案 hash：聚合所有 option hash + name（排除 note/评审状态/时间等抖动字段）。
 * 用于 handoff 幂等与 stale 检测。
 */
export function computeInnovationSchemeHash(input: {
  optionHashes: string[]
  name: string
}): string {
  const stable = {
    n: input.name,
    o: [...input.optionHashes].sort(),
  }
  return `iw-sch-${deterministicHash(JSON.stringify(stable))}`
}

/**
 * 计算 handoff 幂等键：schemeId + optionIds + schemeHash。
 */
export function computeHandoffIdempotencyKey(input: {
  schemeId: string
  optionIds: string[]
  schemeHash: string
}): string {
  const stable = {
    s: input.schemeId,
    o: [...input.optionIds].sort(),
    h: input.schemeHash,
  }
  return `iw-hof-${deterministicHash(JSON.stringify(stable))}`
}

/**
 * Source hash 比对：判断 scheme 记录的 source hash 是否仍与当前来源一致。
 * 返回 stale=true 表示来源已变化（handoff 应阻断或标记）。
 */
export function detectStaleSources(args: {
  recorded: {
    contradictionSignatures: string[]
    analysisContentHashes: string[]
  }
  current: {
    contradictionSignatures: string[]
    analysisContentHashes: string[]
  }
}): { stale: boolean; mismatched: { contradictions: string[]; analyses: string[] } } {
  const recContra = new Set(args.recorded.contradictionSignatures)
  const curContra = new Set(args.current.contradictionSignatures)
  const recAna = new Set(args.recorded.analysisContentHashes)
  const curAna = new Set(args.current.analysisContentHashes)

  const mismatchedContradictions = [...recContra].filter((s) => !curContra.has(s))
  const mismatchedAnalyses = [...recAna].filter((s) => !curAna.has(s))

  return {
    stale: mismatchedContradictions.length > 0 || mismatchedAnalyses.length > 0,
    mismatched: {
      contradictions: mismatchedContradictions,
      analyses: mismatchedAnalyses,
    },
  }
}

/**
 * 方案确定性排序比较器：综合分 → 严重度 → warning 更少 → optionId。
 * 同输入必同序，保证对比与 hash 稳定。
 */
export function compareInnovationOptions(
  a: { score: InnovationScore; optionId: string },
  b: { score: InnovationScore; optionId: string },
): number {
  if (Math.abs(b.score.total - a.score.total) > 1e-9) return b.score.total - a.score.total
  if (Math.abs(b.score.severity - a.score.severity) > 1e-9) {
    return b.score.severity - a.score.severity
  }
  if (Math.abs(b.score.confidence - a.score.confidence) > 1e-9) {
    return b.score.confidence - a.score.confidence
  }
  return a.optionId.localeCompare(b.optionId)
}

// ---------------------------------------------------------------------------
// 运行时校验辅助（轻量 schema 校验，前后端共享）
// ---------------------------------------------------------------------------

/** 判断值是否属于某 const 元组。 */
export function isInnovationSchemeStatus(v: string): v is InnovationSchemeStatus {
  return (INNOVATION_SCHEME_STATUSES as readonly string[]).includes(v)
}
export function isInnovationOptionOrigin(v: string): v is InnovationOptionOrigin {
  return (INNOVATION_OPTION_ORIGINS as readonly string[]).includes(v)
}
export function isInnovationSourceType(v: string): v is InnovationSourceType {
  return (INNOVATION_SOURCE_TYPES as readonly string[]).includes(v)
}
export function isImpactDirection(v: string): v is ImpactDirection {
  return (IMPACT_DIRECTIONS as readonly string[]).includes(v)
}
export function isImpactDimension(v: string): v is ImpactDimension {
  return (IMPACT_DIMENSIONS as readonly string[]).includes(v)
}
export function isInnovationReviewState(v: string): v is InnovationReviewState {
  return (INNOVATION_REVIEW_STATES as readonly string[]).includes(v)
}

/** 校验 option 结构（返回错误列表，空表示通过）。 */
export function validateInnovationOption(option: unknown): string[] {
  const errors: string[] = []
  if (!option || typeof option !== 'object') {
    return ['option must be an object']
  }
  const o = option as Record<string, unknown>
  if (typeof o.optionId !== 'string' || !o.optionId) errors.push('optionId is required')
  if (typeof o.origin !== 'string' || !isInnovationOptionOrigin(o.origin)) {
    errors.push('origin is invalid')
  }
  if (!Array.isArray(o.sourceRefs)) {
    errors.push('sourceRefs must be an array')
  } else if (o.sourceRefs.length === 0) {
    errors.push('sourceRefs must not be empty')
  }
  if (o.selectedPathId !== null && typeof o.selectedPathId !== 'string') {
    errors.push('selectedPathId must be string or null')
  }
  if (!Array.isArray(o.principleIds)) errors.push('principleIds must be an array')
  if (typeof o.name !== 'string') errors.push('name must be a string')
  if (typeof o.createdBy !== 'number') errors.push('createdBy must be a number')
  return errors
}

/** 校验方案结构（返回错误列表，空表示通过）。 */
export function validateInnovationScheme(scheme: unknown): string[] {
  const errors: string[] = []
  if (!scheme || typeof scheme !== 'object') return ['scheme must be an object']
  const s = scheme as Record<string, unknown>
  if (typeof s.schemeId !== 'string' || !s.schemeId) errors.push('schemeId is required')
  if (typeof s.name !== 'string' || !s.name) errors.push('name is required')
  if (typeof s.status === 'string' && !isInnovationSchemeStatus(s.status)) {
    errors.push('status is invalid')
  }
  if (!Array.isArray(s.options)) {
    errors.push('options must be an array')
  } else {
    if (s.options.length > INNOVATION_SCHEME_MAX_OPTIONS) {
      errors.push(`options must not exceed ${INNOVATION_SCHEME_MAX_OPTIONS}`)
    }
    s.options.forEach((opt: unknown, i: number) => {
      const optErrors = validateInnovationOption(opt)
      for (const e of optErrors) errors.push(`options[${i}]: ${e}`)
    })
  }
  // 禁止携带可执行 patch 字段
  const forbidden = ['patch', 'mutations', 'sql', 'applyPlan', 'executablePatch']
  for (const f of forbidden) {
    if (f in s) errors.push(`forbidden executable field present: ${f}`)
  }
  return errors
}

/** 校验 handoff 输入结构。 */
export function validateInnovationHandoffInput(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return ['handoff input must be an object']
  const i = input as Record<string, unknown>
  if (i.sourceType !== TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE) {
    errors.push(`sourceType must be ${TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE}`)
  }
  if (typeof i.schemeId !== 'string' || !i.schemeId) errors.push('schemeId is required')
  if (!Array.isArray(i.optionIds) || i.optionIds.length === 0) {
    errors.push('optionIds must be a non-empty array')
  }
  if (typeof i.organizationId !== 'number') errors.push('organizationId is required')
  if (typeof i.projectId !== 'number') errors.push('projectId is required')
  if (typeof i.actorId !== 'number') errors.push('actorId is required')
  if (typeof i.idempotencyKey !== 'string' || !i.idempotencyKey) {
    errors.push('idempotencyKey is required')
  }
  const forbidden = ['patch', 'mutations', 'sql', 'applyPlan']
  for (const f of forbidden) {
    if (f in i) errors.push(`forbidden executable field present: ${f}`)
  }
  return errors
}

/** 校验 narrative 结构（advisory）。 */
export function validateInnovationNarrative(narrative: unknown): string[] {
  const errors: string[] = []
  if (!narrative || typeof narrative !== 'object') return ['narrative must be an object']
  const n = narrative as Record<string, unknown>
  if (typeof n.narrative !== 'string') errors.push('narrative text is required')
  if (typeof n.isFallback !== 'boolean') errors.push('isFallback must be boolean')
  if (!Array.isArray(n.referencedOptionIds)) errors.push('referencedOptionIds must be an array')
  return errors
}

/** 校验对比结构稳定性所需字段。 */
export function validateInnovationComparison(comparison: unknown): string[] {
  const errors: string[] = []
  if (!comparison || typeof comparison !== 'object') return ['comparison must be an object']
  const c = comparison as Record<string, unknown>
  if (!Array.isArray(c.cells)) errors.push('cells must be an array')
  if (c.modelCostRecorded !== true)
    errors.push('modelCostRecorded must be true for deterministic comparison')
  return errors
}
