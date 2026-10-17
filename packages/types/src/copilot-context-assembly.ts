// @aiproj/types — V3 Copilot 上下文采集与组装契约（copilot-context-and-panorama）
//
// v3-copilot-context-packet-and-project-panorama / §2 —— 采集请求、逐来源元数据、
// scope→合格来源映射、合格知识层清单（L3 排除）、方法论切面、项目全景摘要、
// 组装级截断标记、不确定三分、结论回溯与组装结果校验。
//
// 依赖轻量约束：仅依赖本包 copilot-shared-contracts（纯类型 + 确定性 helpers），
// 无 AdonisJS / React / 数据库客户端 / 网络请求。
//
// 命名纪律：全部导出使用 Copilot / COPILOT / copilot 前缀 + Assembly / ASSEMBLY
// 或 Panorama / PANORAMA 语境，避免与 copilot-shared-contracts /
// copilot-action-boundary 撞名。

import type {
  CopilotBudgetMetadata,
  CopilotContextPacket,
  CopilotDestination,
  CopilotKnowledgeTier,
  CopilotScope,
  CopilotSessionAttribution,
  CopilotSourceKind,
  CopilotSourceSummary,
  CopilotTruncationMarker,
  CopilotWarningCode,
} from './copilot-shared-contracts.js'
import {
  computeCopilotSourceHash,
  copilotStableSerialize,
  generateCopilotSessionId,
} from './copilot-shared-contracts.js'
import type { CopilotContextFact, CopilotPageContextDescriptorV1 } from './copilot-page-context.js'

// ===========================================================================
// 枚举 — 十二类结构化检索来源（2.1 / 2.2）
// ===========================================================================

/**
 * 十二类结构化检索来源（与 `SearchService` 注册的十二个 adapter 一一对应）。
 * 组装器只通过既有 `SearchService` 路由到这些来源，不新建并行检索。
 */
export const COPILOT_RETRIEVAL_SOURCE_KINDS = [
  'project',
  'task',
  'file',
  'risk',
  'change_request',
  'report',
  'comment',
  'activity',
  'milestone',
  'task_external_link',
  'ocr_search_index',
  'document',
] as const
export type CopilotRetrievalSourceKind = (typeof COPILOT_RETRIEVAL_SOURCE_KINDS)[number]

export function isCopilotRetrievalSourceKind(v: string): v is CopilotRetrievalSourceKind {
  return (COPILOT_RETRIEVAL_SOURCE_KINDS as readonly string[]).includes(v)
}

/** 检索来源 → 共享契约 source kind 词汇映射（共享枚举未覆盖者落 search_result）。 */
export const COPILOT_RETRIEVAL_KIND_TO_SOURCE_KIND: Record<
  CopilotRetrievalSourceKind,
  CopilotSourceKind
> = {
  project: 'project_facts',
  task: 'task',
  file: 'search_result',
  risk: 'risk',
  change_request: 'search_result',
  report: 'search_result',
  comment: 'search_result',
  activity: 'search_result',
  milestone: 'milestone',
  task_external_link: 'search_result',
  ocr_search_index: 'ocr_document',
  document: 'document',
}

// ===========================================================================
// 枚举 — 权限判定 / 知识层推导 / 截断阶段 / 不确定三分（2.3 / 2.4 / 2.7 / 2.8）
// ===========================================================================

export const COPILOT_SOURCE_PERMISSION_DECISIONS = [
  /** 来源合格且本 actor 有权限——正常采集。 */
  'granted',
  /** 来源合格但本 actor 无权限——零泄露省略，包内不出现该来源的任何细节。 */
  'denied-hidden',
  /** 来源在本 scope 下根本不合格——查询发起前已排除，不发起任何查询。 */
  'skipped-ineligible',
] as const
export type CopilotSourcePermissionDecision = (typeof COPILOT_SOURCE_PERMISSION_DECISIONS)[number]

export function isCopilotSourcePermissionDecision(v: string): v is CopilotSourcePermissionDecision {
  return (COPILOT_SOURCE_PERMISSION_DECISIONS as readonly string[]).includes(v)
}

/** 生产查询路径合格的知识层（L3 合成评测知识恒排除）。 */
export const COPILOT_PRODUCTION_KNOWLEDGE_TIERS: readonly CopilotKnowledgeTier[] = [
  'L1',
  'L2',
  'L4',
]

/** 评测查询路径合格的知识层（含 L3；仅用于证明评测路径产物会被校验拒绝）。 */
export const COPILOT_EVAL_KNOWLEDGE_TIERS: readonly CopilotKnowledgeTier[] = [
  'L1',
  'L2',
  'L3',
  'L4',
]

/**
 * 由实际使用的查询路径推导合格知识层清单（而非调用方自报）。
 * `eval` 路径产出的清单含 L3，契约校验必须拒绝对应上下文包。
 */
export function deriveEligibleKnowledgeTiers(
  path: 'production' | 'eval',
): readonly CopilotKnowledgeTier[] {
  return path === 'production' ? COPILOT_PRODUCTION_KNOWLEDGE_TIERS : COPILOT_EVAL_KNOWLEDGE_TIERS
}

/** 合格层清单是否包含 L3 合成评测层。 */
export function knowledgeTiersIncludeSynthetic(tiers: readonly CopilotKnowledgeTier[]): boolean {
  return tiers.includes('L3')
}

/** L3 排除校验：清单含 L3 → 失败（契约层拒绝）。 */
export function assertEligibleKnowledgeTiersExcludeL3(tiers: readonly CopilotKnowledgeTier[]): {
  ok: boolean
  reason?: string
} {
  if (knowledgeTiersIncludeSynthetic(tiers)) {
    return { ok: false, reason: '合格知识层清单包含 L3 合成评测知识，生产上下文包必须排除' }
  }
  return { ok: true }
}

export const COPILOT_TRUNCATION_STAGES = [
  'none',
  'evidence',
  'methodology',
  'retrieval',
  'activity',
  'facets',
] as const
export type CopilotTruncationStage = (typeof COPILOT_TRUNCATION_STAGES)[number]

export function isCopilotTruncationStage(v: string): v is CopilotTruncationStage {
  return (COPILOT_TRUNCATION_STAGES as readonly string[]).includes(v)
}

/** 不确定三分：不存在 / 对本 actor 不可访问 / 未匹配查询。 */
export const COPILOT_UNCERTAINTY_KINDS = [
  /** 经权威查询确认不存在（来源为空且查询路径正确）。 */
  'not-exists',
  /** 存在但本 actor 不可访问——表达不得泄露存在性。 */
  'not-accessible',
  /** 来源存在但未匹配查询（零结果）。 */
  'no-match',
] as const
export type CopilotUncertaintyKind = (typeof COPILOT_UNCERTAINTY_KINDS)[number]

export function isCopilotUncertaintyKind(v: string): v is CopilotUncertaintyKind {
  return (COPILOT_UNCERTAINTY_KINDS as readonly string[]).includes(v)
}

/** 低置信阈值：聚合置信度低于此值的检索视为低置信。 */
export const COPILOT_LOW_CONFIDENCE_THRESHOLD = 0.5

/** 低置信判定（阈值上 = 恰在阈值允许；< 阈值 = 低置信）。 */
export function isCopilotLowConfidence(confidence: number): boolean {
  return confidence < COPILOT_LOW_CONFIDENCE_THRESHOLD
}

// ===========================================================================
// 2.2 scope → 合格来源映射表结构
// ===========================================================================

export interface CopilotAssemblyScopeEligibility {
  readonly scope: CopilotScope
  /** 本 scope 下合格的十二类检索来源（查询发起前先按此排除）。 */
  readonly retrievalKinds: readonly CopilotRetrievalSourceKind[]
  /** 本 scope 是否合格接入四层知识底座（生产路径）。 */
  readonly knowledgeEligible: boolean
  /** 本 scope 是否合格注入 Skill 方法论切面。 */
  readonly methodologyEligible: boolean
  /** 本 scope 是否合格产出项目全景聚合。 */
  readonly panoramaEligible: boolean
}

/**
 * scope 到合格来源的映射（Spec「Session scope MUST bound eligible sources」）。
 * `global` scope 无任何项目作用域来源；`portfolio` 启用知识与方法论但不加载单项目检索来源（跨项目聚合归 portfolio scope 专属服务）；
 * `entity` 限定为实体本身与其已授权祖先对应的来源种类。
 */
export const COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP: Record<
  CopilotScope,
  CopilotAssemblyScopeEligibility
> = {
  global: {
    scope: 'global',
    retrievalKinds: [],
    knowledgeEligible: false,
    methodologyEligible: false,
    panoramaEligible: false,
  },
  organization: {
    scope: 'organization',
    retrievalKinds: [],
    knowledgeEligible: false,
    methodologyEligible: false,
    panoramaEligible: false,
  },
  project: {
    scope: 'project',
    retrievalKinds: [...COPILOT_RETRIEVAL_SOURCE_KINDS],
    knowledgeEligible: true,
    methodologyEligible: true,
    panoramaEligible: true,
  },
  portfolio: {
    scope: 'portfolio',
    /** 组合级不加载单项目任务明细（避免一次提问拉进十几个项目全量任务）；
     *  跨项目聚合由 portfolio scope 专属服务处理。 */
    retrievalKinds: [],
    /** 组合级可读组织级知识（术语表、模板偏好等）。 */
    knowledgeEligible: true,
    /** 组合级可注入方法论切面。 */
    methodologyEligible: true,
    /** 组合级不做单项目全景。 */
    panoramaEligible: false,
  },
  entity: {
    scope: 'entity',
    retrievalKinds: ['task', 'risk', 'milestone', 'document'],
    knowledgeEligible: false,
    methodologyEligible: false,
    panoramaEligible: false,
  },
}

/** 取某 scope 合格的检索来源；`requested` 提供时取其交集（确定性顺序按映射声明）。 */
export function assemblyEligibleRetrievalKinds(
  scope: CopilotScope,
  requested?: readonly CopilotRetrievalSourceKind[],
): CopilotRetrievalSourceKind[] {
  const eligible = COPILOT_ASSEMBLY_SCOPE_SOURCE_MAP[scope].retrievalKinds
  if (!requested || requested.length === 0) {
    return [...eligible]
  }
  const requestedSet = new Set(requested)
  return eligible.filter((k) => requestedSet.has(k))
}

// ===========================================================================
// 2.1 采集请求与组装结果
// ===========================================================================

export interface CopilotContextAssemblyRequest {
  /** 会话 scope（与 CopilotSession.scope 一致）。 */
  readonly scope: CopilotScope
  /** 会话归属（组织/项目/实体）。 */
  readonly attribution: CopilotSessionAttribution
  readonly organizationId: number
  readonly actorId: number
  /** 检索关键词（可选；无关键词时只做全景/方法论/知识摘要采集）。 */
  readonly query?: string
  /** 路由输入：意图槽位（恒保留，不可截断）。 */
  readonly intentSlots?: Readonly<Record<string, string>>
  /** 路由输入：实体引用（恒保留，不可截断）。 */
  readonly entityRefs?: readonly string[]
  /** 可选来源限定（缺省按 scope 映射全量）。 */
  readonly retrievalKinds?: readonly CopilotRetrievalSourceKind[]
  /** 上下文包字节预算（缺省用默认预算）。 */
  readonly contextBytesLimit?: number
  /** 证据字节预算（证据正文不落包，只用于省略计数）。 */
  readonly evidenceBytesLimit?: number
  /** 新鲜度模式：每回合推导或仅变更类动作回合推导。 */
  readonly freshnessMode: 'per-turn' | 'mutation-turn-only'
  /** 是否产出项目全景（scope 不合格时忽略）。 */
  readonly includePanorama?: boolean
  /**
   * 版本化页面语境（v3-copilot-authoritative-page-context）。
   *
   * 调用方（turn service）传入**已通过服务端授权解析**的描述符；
   * 装配器据此产出页面筛选相关的权威事实候选（`contextFacts`）。
   * 客户端 ID 只作候选——授权由 resolver 完成，此处不再信任原始值。
   */
  readonly pageContext?: CopilotPageContextDescriptorV1
}

/** 逐来源元数据（2.3）：来源种类、source ref、source hash、capturedAt、命中、评分区间、权限判定。 */
export interface CopilotAssemblySourceMetadata {
  readonly retrievalKind: CopilotRetrievalSourceKind
  /** 指向可展开证据的引用（证据抽屉按读者权限展开）。 */
  readonly sourceRef: string
  /** 内容 hash（由来源内容确定性推导，stale 判定依据）。 */
  readonly sourceHash: string
  /** 捕获时间（ISO 8601）。 */
  readonly capturedAt: string
  /** 命中计数（0 = 零结果标记）。 */
  readonly hitCount: number
  /** 评分区间（复用 search_scoring 的评分；未评分来源省略）。 */
  readonly scoreRange?: { readonly min: number; readonly max: number }
  /** 权限判定结果：granted / denied-hidden / skipped-ineligible。 */
  readonly permissionDecision: CopilotSourcePermissionDecision
  /** 映射到共享契约 source kind 词汇（供 CopilotSourceSummary 使用）。 */
  readonly packetSourceKind: CopilotSourceKind
  /** 是否匹配到结果（false = 零结果，走不确定表达）。 */
  readonly matched: boolean
}

/** 方法论切面（2.5）：领域方法论指引，显式标记「非项目事实」。 */
export interface CopilotMethodologyGuidanceItem {
  readonly itemId: string
  readonly skillKey: string
  readonly label: string
  /** 低敏方法论指引摘要（不含项目事实断言）。 */
  readonly summary: string
  /** 可追溯到来源 Skill 与知识片段的引用（§5.7 Provenance）。 */
  readonly sourceRef: string
  /** 可追溯到知识片段的引用（补充来源信息）。 */
  readonly knowledgeRef?: string
  /**
   * 激活规则 ID：产生此方法论条目的 Skill 激活规则标识。
   * 与 Skill 的 activation 字段中的 projectTypes/domains 关联。
   */
  readonly activationRuleId: string
  /**
   * 激活依据：人类可读的激活原因说明。
   * 例如 "projectType='软件开发' 匹配 skill-sw-dev.activation.projectTypes"。
   */
  readonly activationReason: string
}

export interface CopilotMethodologyFacet {
  readonly facetKind: 'methodology'
  /** 非项目事实标记（恒为 true，区别于项目事实来源）。 */
  readonly isMethodologyGuidance: true
  readonly isProjectFact: false
  readonly skillKeys: readonly string[]
  readonly guidanceItems: readonly CopilotMethodologyGuidanceItem[]
  readonly capturedAt: string
  /**
   * 方法论版本 hash（与项目事实 source hash 分列）。
   * 由 Skill 版本 + knowledge 内容的稳定序列化计算得出；
   * Skill 版本变化时此 hash 变化，但不影响项目事实 source hash。
   */
  readonly methodologyVersionHash: string
}

export function isCopilotMethodologyFacet(v: unknown): v is CopilotMethodologyFacet {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return (
    f.facetKind === 'methodology' &&
    f.isMethodologyGuidance === true &&
    f.isProjectFact === false &&
    Array.isArray(f.guidanceItems) &&
    typeof f.methodologyVersionHash === 'string' &&
    (f.methodologyVersionHash as string).length > 0
  )
}

// ===========================================================================
// 2.6 项目全景摘要（仅聚合、不含正文）
// ===========================================================================

export const COPILOT_PANORAMA_FACET_NAMES = [
  'wbs',
  'taskStatus',
  'dependency',
  'resource',
  'risk',
  'milestone',
  'change',
  'docs',
  'activity',
] as const
export type CopilotPanoramaFacetName = (typeof COPILOT_PANORAMA_FACET_NAMES)[number]

export interface CopilotPanoramaWbsFacet {
  readonly nodeCount: number
  readonly depth: number
  readonly leafCount: number
  /** 按 WBS 层级类型的计数分布（如 phase/deliverable/work_package/task）。 */
  readonly byLevel: Readonly<Record<string, number>>
}

export interface CopilotPanoramaTaskStatusFacet {
  readonly total: number
  /** 按任务状态（status machine 词汇）的计数分布。 */
  readonly byStatus: Readonly<Record<string, number>>
  /** 完成比例 0..1（仅计数聚合）。 */
  readonly completionRatio: number
}

export interface CopilotPanoramaDependencyFacet {
  readonly dependencyCount: number
  readonly criticalPathLength: number
  /** 关键路径任务 refs（仅引用，不含正文）。 */
  readonly criticalPathTaskRefs: readonly string[]
  readonly hasCycle: boolean
}

export interface CopilotPanoramaResourceFacet {
  readonly assignmentCount: number
  /** 整体负载比 0..1（计划/估算工时聚合）。 */
  readonly overallLoadRatio: number
  readonly overallocatedUserCount: number
}

export interface CopilotPanoramaRiskFacet {
  readonly total: number
  readonly bySeverity: Readonly<Record<string, number>>
  readonly byStatus: Readonly<Record<string, number>>
}

export interface CopilotPanoramaMilestoneFacet {
  readonly total: number
  readonly upcomingCount: number
  readonly overdueCount: number
  readonly nextMilestoneRef?: string
}

export interface CopilotPanoramaChangeFacet {
  readonly total: number
  readonly byStatus: Readonly<Record<string, number>>
}

export interface CopilotPanoramaDocsFacet {
  readonly documentCount: number
  readonly attachmentCount: number
}

export interface CopilotPanoramaActivityFacet {
  readonly recentCount: number
  readonly latestActivityAt?: string
  readonly byType: Readonly<Record<string, number>>
}

export interface CopilotProjectPanorama {
  readonly scope: 'project'
  readonly projectId: string
  /** 整体捕获时间。 */
  readonly capturedAt: string
  readonly facets: {
    readonly wbs: CopilotPanoramaWbsFacet
    readonly taskStatus: CopilotPanoramaTaskStatusFacet
    readonly dependency: CopilotPanoramaDependencyFacet
    readonly resource: CopilotPanoramaResourceFacet
    readonly risk: CopilotPanoramaRiskFacet
    readonly milestone: CopilotPanoramaMilestoneFacet
    readonly change: CopilotPanoramaChangeFacet
    readonly docs: CopilotPanoramaDocsFacet
    readonly activity: CopilotPanoramaActivityFacet
  }
  /** 逐切面 capturedAt（变更类动作回合必须重新推导）。 */
  readonly facetCapturedAts: Readonly<Record<CopilotPanoramaFacetName, string>>
}

// ===========================================================================
// 2.7 组装级截断标记
// ===========================================================================

export interface CopilotAssemblyTruncationMarker {
  readonly truncated: boolean
  /** 截断阶段：evidence（证据正文）/ methodology（方法论优先截断）/ retrieval（低分检索）/ activity（较旧活动）/ facets（可选切面）。 */
  readonly stage: CopilotTruncationStage
  /** 省略的来源条数（不静默丢弃）。 */
  readonly omittedSourceCount: number
  /** 省略的证据正文字数（正文不落包，只计数）。 */
  readonly omittedEvidenceCount: number
  /** 被丢弃的来源种类（确定性记录）。 */
  readonly droppedRetrievalKinds: readonly CopilotRetrievalSourceKind[]
  /** 被丢弃的可选切面（确定性记录）。 */
  readonly droppedFacets: readonly CopilotPanoramaFacetName[]
  /** 是否触及预算下界（最小允许预算仍不足）。 */
  readonly hitBudgetFloor: boolean
  readonly warning?: string
  /** §6.4 被省略的方法论条数（不静默丢弃）。 */
  readonly omittedMethodologyCount: number
}

export function makeCopilotNoTruncationMarker(): CopilotAssemblyTruncationMarker {
  return {
    truncated: false,
    stage: 'none',
    omittedSourceCount: 0,
    omittedEvidenceCount: 0,
    droppedRetrievalKinds: [],
    droppedFacets: [],
    hitBudgetFloor: false,
    omittedMethodologyCount: 0,
  }
}

// ===========================================================================
// 2.8 不确定三分与结论回溯（7.x）
// ===========================================================================

export interface CopilotUncertaintyEntry {
  readonly uncertaintyId: string
  /** 被询问的主题（低敏描述）。 */
  readonly topic: string
  readonly kind: CopilotUncertaintyKind
  /** 聚合置信度 0..1。 */
  readonly confidence: number
  readonly sourceRefs: readonly string[]
}

/** 不确定三分类的中文表述（下游叙事可按 kind 安全措辞）。 */
export function copilotUncertaintyKindLabel(kind: CopilotUncertaintyKind): string {
  switch (kind) {
    case 'not-exists':
      return '经确认该项目不存在该信息'
    case 'not-accessible':
      return '当前账号能力范围内无法获取该信息'
    case 'no-match':
      return '未检索到与该问题匹配的项目信息'
  }
}

export interface CopilotConclusionTraceEntry {
  readonly conclusionId: string
  /** 结论陈述（低敏、简短）。 */
  readonly statement: string
  /** 支撑该结论的来源引用（证据抽屉按读者权限展开）。 */
  readonly sourceRefs: readonly string[]
  readonly sourceHashes: readonly string[]
  /** 无来源支撑 → 不得作为事实输出（supported=false 且必须被校验拒绝或标记）。 */
  readonly supported: boolean
}

/** 路由输入保护记录：截断后路由输入全部存活。 */
export interface CopilotRoutingInputsPreserved {
  readonly intentSlotsPreserved: boolean
  readonly entityRefsPreserved: boolean
  readonly sourceHashesPreserved: boolean
  readonly permissionFactsPreserved: boolean
}

export function makeCopilotRoutingInputsPreserved(all: boolean): CopilotRoutingInputsPreserved {
  return {
    intentSlotsPreserved: all,
    entityRefsPreserved: all,
    sourceHashesPreserved: all,
    permissionFactsPreserved: all,
  }
}

// ===========================================================================
// 2.1 组装结果
// ===========================================================================

export interface CopilotContextAssemblyResult {
  readonly assemblyId: string
  readonly requestRef: string
  /** 共享契约上下文包（低敏来源摘要 + 合格知识层清单 + 预算 + 截断）。 */
  readonly packet: CopilotContextPacket
  /** 逐来源元数据（含权限判定与命中/评分）。 */
  readonly sources: readonly CopilotAssemblySourceMetadata[]
  /** 本次合格知识层清单（由查询路径推导，含 L3 → 校验拒绝）。 */
  readonly eligibleKnowledgeTiers: readonly CopilotKnowledgeTier[]
  /** 本次实际使用的知识查询路径（production / eval）。 */
  readonly knowledgeQueryPath: 'production' | 'eval'
  /** Skill 方法论切面（scope 不合格或未激活时为 undefined）。 */
  readonly methodology?: CopilotMethodologyFacet
  /** 项目全景聚合（scope 不合格或未请求时为 undefined）。 */
  readonly panorama?: CopilotProjectPanorama
  /** 组装级截断标记（禁止静默丢弃）。 */
  readonly truncation: CopilotAssemblyTruncationMarker
  /** 不确定三分条目（零结果/低置信/不可访问）。 */
  readonly uncertainty: readonly CopilotUncertaintyEntry[]
  /** 结论 → source refs 回溯（供证据抽屉展开）。 */
  readonly conclusionTrace: readonly CopilotConclusionTraceEntry[]
  /** 路由输入保护记录。 */
  readonly routingInputs: CopilotRoutingInputsPreserved
  /**
   * 权威事实候选（v3-copilot-authoritative-page-context，可选）。
   *
   * 由全景切面（聚合）与检索结果 allowlisted projection（行级）组装；
   * 意图相关的切面选择与预算截断在回答 executor 构建侧完成
   * （design §E facet 选择 / §C ContextFact）。旧调用方忽略即可。
   */
  readonly contextFacts?: readonly CopilotContextFact[]
  /** 逐来源耗时（P1 并发采集记录，供后续调优）。 */
  readonly timing: {
    readonly totalMs: number
    readonly perSourceMs: Readonly<Record<string, number>>
  }
  readonly warnings: readonly CopilotWarningCode[]
}

// ===========================================================================
// 确定性 helpers — 组装 ID / 来源字节估计 / 截断计划（6.x 复用）
// ===========================================================================

export function generateCopilotContextAssemblyId(): string {
  return `asm_${generateCopilotSessionId()}`
}

/** 确定性字节估计：来源元数据的稳定序列化长度。 */
export function estimateCopilotSourceBytes(source: CopilotAssemblySourceMetadata): number {
  return copilotStableSerialize(source).length
}

/** §6.1 确定性字节估计：方法论条目的稳定序列化长度。 */
export function estimateCopilotMethodologyItemBytes(item: CopilotMethodologyGuidanceItem): number {
  return copilotStableSerialize(item).length
}

/** §6.1 确定性字节估计：方法论切面的总稳定序列化长度。 */
export function estimateCopilotMethodologyBytes(facet: CopilotMethodologyFacet): number {
  return facet.guidanceItems.reduce(
    (sum, item) => sum + estimateCopilotMethodologyItemBytes(item),
    0,
  )
}

export interface CopilotAssemblyBudgetInput {
  readonly contextBytesLimit: number
  readonly evidenceBytesLimit: number
  /** 预算下界（最小允许预算；低于此值视为触及下界）。 */
  readonly minContextBytes: number
}

export interface CopilotAssemblyTruncationPlan {
  readonly keptSources: readonly CopilotAssemblySourceMetadata[]
  readonly marker: CopilotAssemblyTruncationMarker
}

/**
 * 声明式确定性截断（Spec「Context budget truncation MUST be deterministic」）。
 *
 * 丢弃顺序（固定声明）：证据正文（不落包，只计数）→ 低分检索结果（score asc）→
 * 较旧活动（capturedAt asc）→ 可选切面（facets）。同优先级内按 sourceRef asc 兜底，
 * 保证相同输入两次组装的截断结果完全一致。路由输入（intentSlots/entityRefs/
 * sourceHashes/permissionFacts）不参与截断——由调用方在结果上断言存活。
 */
export function planCopilotAssemblyTruncation(params: {
  sources: readonly CopilotAssemblySourceMetadata[]
  budget: CopilotAssemblyBudgetInput
  evidenceCount: number
  estimateBytes?: (s: CopilotAssemblySourceMetadata) => number
}): CopilotAssemblyTruncationPlan {
  const { budget } = params
  const estimateBytes = params.estimateBytes ?? estimateCopilotSourceBytes

  const withBytes = params.sources.map((s) => ({ source: s, bytes: estimateBytes(s) }))
  const totalBytes = withBytes.reduce((acc, s) => acc + s.bytes, 0)
  const evidenceOver = Math.max(0, params.evidenceCount - budget.evidenceBytesLimit)

  // 未超预算：零来源截断（证据省略单独计数；证据超预算仍算 evidence 阶段截断）
  if (totalBytes <= budget.contextBytesLimit && evidenceOver === 0) {
    return {
      keptSources: [...params.sources],
      marker: {
        truncated: false,
        stage: 'none',
        omittedSourceCount: 0,
        omittedEvidenceCount: 0,
        droppedRetrievalKinds: [],
        droppedFacets: [],
        hitBudgetFloor: false,
        omittedMethodologyCount: 0,
      },
    }
  }

  if (totalBytes <= budget.contextBytesLimit) {
    return {
      keptSources: [...params.sources],
      marker: {
        truncated: true,
        stage: 'evidence',
        omittedSourceCount: 0,
        omittedEvidenceCount: evidenceOver,
        droppedRetrievalKinds: [],
        droppedFacets: [],
        hitBudgetFloor: false,
        omittedMethodologyCount: 0,
        warning: `证据正文超预算，省略 ${evidenceOver} 字节（正文不落包，只计数）`,
      },
    }
  }

  // 丢弃类优先级：retrieval（低分先丢）→ activity（较旧先丢）→ facets（可选切面）。
  const activityKinds: ReadonlySet<string> = new Set(['activity', 'comment'])
  const dropOrder = [...withBytes].sort((a, b) => {
    const aIsActivity = activityKinds.has(a.source.retrievalKind) ? 1 : 0
    const bIsActivity = activityKinds.has(b.source.retrievalKind) ? 1 : 0
    if (aIsActivity !== bIsActivity) return aIsActivity - bIsActivity
    // 同一类内：低分先丢
    const aScore = a.source.scoreRange?.min ?? a.source.scoreRange?.max ?? 0
    const bScore = b.source.scoreRange?.min ?? b.source.scoreRange?.max ?? 0
    if (aScore !== bScore) return aScore - bScore
    // 同分：较旧（capturedAt 更早）先丢
    if (a.source.capturedAt !== b.source.capturedAt) {
      return a.source.capturedAt < b.source.capturedAt ? -1 : 1
    }
    // 兜底：sourceRef 字典序（完全确定性）
    return a.source.sourceRef < b.source.sourceRef ? -1 : 1
  })

  const kept: CopilotAssemblySourceMetadata[] = []
  const dropped: CopilotAssemblySourceMetadata[] = []
  let used = 0
  for (const { source, bytes } of dropOrder) {
    if (used + bytes <= budget.contextBytesLimit) {
      kept.push(source)
      used += bytes
    } else {
      dropped.push(source)
    }
  }

  // 已丢弃但仍可能超预算 → 触及下界
  const keptBytes = kept.reduce((acc, s) => acc + estimateBytes(s), 0)
  const hitFloor = keptBytes < budget.minContextBytes || dropped.length === params.sources.length

  const droppedKinds: CopilotRetrievalSourceKind[] = []
  const droppedFacets: CopilotPanoramaFacetName[] = []
  let stage: CopilotTruncationStage = 'retrieval'
  for (const d of dropped) {
    if (!droppedKinds.includes(d.retrievalKind)) droppedKinds.push(d.retrievalKind)
  }
  const hasActivityDropped = dropped.some((d) => activityKinds.has(d.retrievalKind))
  if (hasActivityDropped) stage = 'activity'

  return {
    keptSources: kept,
    marker: {
      truncated: true,
      stage,
      omittedSourceCount: dropped.length,
      omittedEvidenceCount: evidenceOver,
      droppedRetrievalKinds: droppedKinds,
      droppedFacets,
      hitBudgetFloor: hitFloor,
      // 方法论切面不由本规划器丢弃（droppedFacets 只含 panorama 切面），
      // 实际省略条数由组装层在构建结果时填入（§6.4 不静默丢弃）。
      omittedMethodologyCount: 0,
      warning: hitFloor
        ? '上下文预算触及下界，路由输入之外的最小上下文可能不足'
        : `上下文超预算，按声明顺序丢弃 ${dropped.length} 个来源`,
    },
  }
}

/**
 * §6.2 方法论优先截断：方法论条目在截断序列中排在项目事实之前。
 *
 * 当总预算超限时，先丢弃方法论条目（按 sourceRef 字典序确定性丢弃），
 * 再由调用方对剩余预算调用 planCopilotAssemblyTruncation 处理项目事实来源。
 * 项目事实与路由输入恒保留（路由输入由调用方断言）。
 *
 * §6.6 支持可配置的预算占比：budgetBytesLimit 由调用方按 methodologyBytesRatio 算出。
 */
export function planMethodologyTruncation(params: {
  readonly items: readonly CopilotMethodologyGuidanceItem[]
  readonly budgetBytesLimit: number
  readonly estimateBytes?: (item: CopilotMethodologyGuidanceItem) => number
}): {
  keptItems: readonly CopilotMethodologyGuidanceItem[]
  omittedCount: number
  omittedBytes: number
} {
  const estimateBytes = params.estimateBytes ?? estimateCopilotMethodologyItemBytes
  const totalBytes = params.items.reduce((sum, item) => sum + estimateBytes(item), 0)

  if (totalBytes <= params.budgetBytesLimit) {
    return { keptItems: [...params.items], omittedCount: 0, omittedBytes: 0 }
  }

  // 按 sourceRef 字典序排序（确定性丢弃顺序）
  const sorted = [...params.items].sort((a, b) =>
    a.sourceRef < b.sourceRef ? -1 : a.sourceRef > b.sourceRef ? 1 : 0,
  )

  const kept: CopilotMethodologyGuidanceItem[] = []
  let used = 0
  for (const item of sorted) {
    const bytes = estimateBytes(item)
    if (used + bytes <= params.budgetBytesLimit) {
      kept.push(item)
      used += bytes
    }
  }

  const omittedCount = params.items.length - kept.length
  const omittedBytes = totalBytes - used
  return { keptItems: kept, omittedCount, omittedBytes }
}

// ===========================================================================
// 组装结果校验（2.10 / Spec 契约层拒绝）
// ===========================================================================

export interface CopilotAssemblyValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

/**
 * 上下文包组装结果校验：
 * - 合法枚举值通过、未知值拒绝；
 * - 合格知识层清单含 L3 → 拒绝（生产红线，契约层强制）；
 * - knowledgeQueryPath 与合格层清单一致（推导优先于自报）；
 * - 方法论切面必须带「非项目事实」标记；
 * - 全景各切面 capturedAt 齐备；
 * - 截断标记与路由输入保护一致；
 * - 无来源支撑的结论不得以 supported=true 输出。
 */
export function validateCopilotContextAssembly(
  result: CopilotContextAssemblyResult,
): CopilotAssemblyValidation {
  const errors: string[] = []

  // 1. 合格知识层清单：未知值拒绝 + L3 拒绝
  for (const tier of result.eligibleKnowledgeTiers) {
    if (!['L1', 'L2', 'L3', 'L4'].includes(tier)) {
      errors.push(`合格知识层清单含未知层: ${String(tier)}`)
    }
  }
  const l3Check = assertEligibleKnowledgeTiersExcludeL3(result.eligibleKnowledgeTiers)
  if (!l3Check.ok) errors.push(l3Check.reason!)

  // 2. knowledgeQueryPath 与清单一致（推导优先）
  const derived = deriveEligibleKnowledgeTiers(result.knowledgeQueryPath)
  const actualSet = new Set(result.eligibleKnowledgeTiers)
  if (derived.length !== result.eligibleKnowledgeTiers.length) {
    errors.push('合格知识层清单与查询路径推导不一致（清单必须由实际使用的查询路径推导）')
  } else {
    for (const t of derived) {
      if (!actualSet.has(t)) {
        errors.push(`合格知识层清单缺少查询路径推导层: ${t}`)
        break
      }
    }
  }

  // 3. 逐来源元数据：来源种类/权限判定合法
  for (const s of result.sources) {
    if (!isCopilotRetrievalSourceKind(s.retrievalKind)) {
      errors.push(`未知检索来源种类: ${String(s.retrievalKind)}`)
    }
    if (!isCopilotSourcePermissionDecision(s.permissionDecision)) {
      errors.push(`未知权限判定结果: ${String(s.permissionDecision)}`)
    }
    if (s.hitCount < 0 || !Number.isFinite(s.hitCount)) {
      errors.push(`来源 ${s.sourceRef} 命中计数非法: ${s.hitCount}`)
    }
    if (s.permissionDecision === 'denied-hidden') {
      errors.push('denied-hidden 来源不得出现在组装结果中（零泄露省略要求整条省略）')
    }
  }

  // 4. 方法论切面标记
  if (result.methodology && !isCopilotMethodologyFacet(result.methodology)) {
    errors.push('方法论切面必须携带 isMethodologyGuidance=true 与 isProjectFact=false 标记')
  }

  // 4b. §5.8 方法论条目可追溯性：每条方法论条目必须带 sourceRef
  if (result.methodology) {
    for (const item of result.methodology.guidanceItems) {
      if (!item.sourceRef || item.sourceRef.length === 0) {
        errors.push(`方法论条目 ${item.itemId} 缺少 sourceRef（§5.7 Provenance 要求）`)
      }
    }
  }

  // 5. 全景逐切面 capturedAt
  if (result.panorama) {
    for (const name of COPILOT_PANORAMA_FACET_NAMES) {
      if (!result.panorama.facetCapturedAts[name]) {
        errors.push(`全景切面 ${name} 缺少 capturedAt`)
      }
    }
    const facetKeys = new Set(Object.keys(result.panorama.facetCapturedAts))
    for (const name of facetKeys) {
      if (!(COPILOT_PANORAMA_FACET_NAMES as readonly string[]).includes(name)) {
        errors.push(`全景切面 capturedAt 含未知切面名: ${name}`)
      }
    }
  }

  // 6. 截断标记合法性
  if (!isCopilotTruncationStage(result.truncation.stage)) {
    errors.push(`未知截断阶段: ${String(result.truncation.stage)}`)
  }
  if (
    result.truncation.truncated &&
    result.truncation.omittedSourceCount === 0 &&
    result.truncation.omittedEvidenceCount === 0 &&
    result.truncation.omittedMethodologyCount === 0
  ) {
    errors.push('截断标记 truncated=true 但省略计数全为 0（禁止静默丢弃）')
  }
  if (!result.truncation.truncated && result.truncation.stage !== 'none') {
    errors.push('truncated=false 时截断阶段必须为 none')
  }

  // 7. 路由输入保护
  const routing = result.routingInputs
  if (
    !routing.intentSlotsPreserved ||
    !routing.entityRefsPreserved ||
    !routing.sourceHashesPreserved ||
    !routing.permissionFactsPreserved
  ) {
    errors.push(
      '路由输入保护不完整：intentSlots/entityRefs/sourceHashes/permissionFacts 必须全部存活',
    )
  }

  // 8. 结论支撑（无来源支撑不得作为事实输出）
  for (const c of result.conclusionTrace) {
    if (c.supported && c.sourceRefs.length === 0) {
      errors.push(`结论 ${c.conclusionId} 声明 supported=true 但无任何来源支撑`)
    }
    if (!c.supported && c.sourceRefs.length > 0) {
      errors.push(`结论 ${c.conclusionId} 有来源却声明 unsupported（应 supported=true）`)
    }
  }

  // 9. 不确定三分枚举合法
  for (const u of result.uncertainty) {
    if (!isCopilotUncertaintyKind(u.kind)) {
      errors.push(`未知不确定种类: ${String(u.kind)}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

// 供包内测试/后端复用的共享契约类型再导出（避免调用方重复 import）
export type {
  CopilotBudgetMetadata,
  CopilotContextPacket,
  CopilotDestination,
  CopilotKnowledgeTier,
  CopilotScope,
  CopilotSessionAttribution,
  CopilotSourceKind,
  CopilotSourceSummary,
  CopilotTruncationMarker,
  CopilotWarningCode,
}
export { computeCopilotSourceHash, copilotStableSerialize }
