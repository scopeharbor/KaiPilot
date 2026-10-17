/**
 * v3-knowledge-memory-operating-layer —— 组织级知识与记忆运营层共享契约。
 *
 * 定位（design D1-D11）：
 * - 把现有四层知识、Copilot 三 scope 记忆、Skill knowledge drafts 与 context retrieval
 *   observations 投影为语义分区的 attention queue、低敏证据详情和 owning-surface handoff。
 * - 不复制任何 owning 领域状态机；不返回正文、memory summary、prompt、检索 query 或 token。
 * - 所有字段 MUST 来自 owning capability 的权威状态派生；纯函数 + 确定性 fixtures。
 *
 * 核心纪律（spec REQ）：
 * - L3 Synthetic 知识仍只标为 eval-only，运营层不暴露其正文或作为生产事实使用。
 * - Copilot memory 恒为 inference，确认后也不得升格为 fact/project evidence/knowledge。
 * - Skill knowledge draft 恒为 methodology candidate，运营层不擅自改写或 commit。
 * - project Timeline event 只作安全导航目标，不进入 operating object model。
 * - hidden / unavailable / empty / zero-result / degraded / ready MUST 保持可区分。
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / compiler-spec / Date.now() / 网络客户端。
 * 时间由调用方显式传入，纯函数确定性。
 *
 * @aiproj/types 零依赖约束
 */

// ── 1. 封闭词表与 fail-closed validator ─────────────────────────────────

/** 运营对象类型（封闭四 kind，spec REQ: 异构但语义分区的运营投影）。 */
export const KNOWLEDGE_MEMORY_OPERATING_KINDS = [
  'knowledge_item',
  'copilot_memory',
  'skill_knowledge_draft',
  'retrieval_signal',
] as const
export type KnowledgeMemoryOperatingKind = (typeof KNOWLEDGE_MEMORY_OPERATING_KINDS)[number]

export function isKnowledgeMemoryOperatingKind(
  value: string,
): value is KnowledgeMemoryOperatingKind {
  return (KNOWLEDGE_MEMORY_OPERATING_KINDS as readonly string[]).includes(value)
}

/** 运营状态（5 档 + ready 终态；6 档互不替代）。 */
export const KNOWLEDGE_MEMORY_OPERATING_STATUSES = [
  'ready', // 权威稳定、无需处置
  'needs_review', // 显式待审
  'stale_or_unconfirmed', // 陈旧或未确认
  'conflict', // 与实时事实冲突
  'provenance_gap', // 缺少/不可解引用
  'synthetic_eval_only', // L3 / synthetic 仅供 Eval
  'retention_attention', // 保留期到期或治理
  'retrieval_gap', // 检索质量信号
  'degraded', // 依赖降级（adapter / observation 失败）
] as const
export type KnowledgeMemoryOperatingStatus = (typeof KNOWLEDGE_MEMORY_OPERATING_STATUSES)[number]

export function isKnowledgeMemoryOperatingStatus(
  value: string,
): value is KnowledgeMemoryOperatingStatus {
  return (KNOWLEDGE_MEMORY_OPERATING_STATUSES as readonly string[]).includes(value)
}

/** 运营 scope（5 档，复用 owning 词汇）。 */
export const KNOWLEDGE_MEMORY_OPERATING_SCOPES = [
  'organization',
  'project',
  'user',
  'session',
  'global',
] as const
export type KnowledgeMemoryOperatingScope = (typeof KNOWLEDGE_MEMORY_OPERATING_SCOPES)[number]

export function isKnowledgeMemoryOperatingScope(
  value: string,
): value is KnowledgeMemoryOperatingScope {
  return (KNOWLEDGE_MEMORY_OPERATING_SCOPES as readonly string[]).includes(value)
}

/** 可见性档（4 档：visible / hidden / unavailable / empty）。 */
export const KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES = [
  'visible',
  'hidden',
  'unavailable',
  'empty',
] as const
export type KnowledgeMemoryOperatingVisibility =
  (typeof KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES)[number]

export function isKnowledgeMemoryOperatingVisibility(
  value: string,
): value is KnowledgeMemoryOperatingVisibility {
  return (KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES as readonly string[]).includes(value)
}

/** Freshness 档（fresh / aging / stale / unknown；D4 显式档位）。 */
export const KNOWLEDGE_MEMORY_OPERATING_FRESHNESS_STATES = [
  'fresh',
  'aging',
  'stale',
  'unknown',
] as const
export type KnowledgeMemoryOperatingFreshnessState =
  (typeof KNOWLEDGE_MEMORY_OPERATING_FRESHNESS_STATES)[number]

export function isKnowledgeMemoryOperatingFreshnessState(
  value: string,
): value is KnowledgeMemoryOperatingFreshnessState {
  return (KNOWLEDGE_MEMORY_OPERATING_FRESHNESS_STATES as readonly string[]).includes(value)
}

/** Attention 优先级（attention priority，用于 sort tuple 首位）。 */
export const KNOWLEDGE_MEMORY_OPERATING_PRIORITIES = [
  'p0', // 必处置（conflict / synthetic_eval_only / degraded）
  'p1', // 高（needs_review / stale_or_unconfirmed）
  'p2', // 中（provenance_gap / retention_attention / retrieval_gap）
  'p3', // 低（ready）
] as const
export type KnowledgeMemoryOperatingPriority =
  (typeof KNOWLEDGE_MEMORY_OPERATING_PRIORITIES)[number]

export function isKnowledgeMemoryOperatingPriority(
  value: string,
): value is KnowledgeMemoryOperatingPriority {
  return (KNOWLEDGE_MEMORY_OPERATING_PRIORITIES as readonly string[]).includes(value)
}

/** Owning surface 封闭集合（D5；4 surface）。 */
export const KNOWLEDGE_MEMORY_OPERATING_SURFACES = [
  'knowledge_review',
  'copilot_memory_governance',
  'skill_knowledge_authoring',
  'retrieval_observation_detail',
] as const
export type KnowledgeMemoryOperatingSurface = (typeof KNOWLEDGE_MEMORY_OPERATING_SURFACES)[number]

export function isKnowledgeMemoryOperatingSurface(
  value: string,
): value is KnowledgeMemoryOperatingSurface {
  return (KNOWLEDGE_MEMORY_OPERATING_SURFACES as readonly string[]).includes(value)
}

/** Surface authority owner（封闭 4 词；写入权属主路径）。 */
export const KNOWLEDGE_MEMORY_OPERATING_AUTHORITY_OWNERS = [
  'knowledge_service',
  'copilot_memory_service',
  'skill_knowledge_authoring_service',
  'copilot_context_observation_service',
] as const
export type KnowledgeMemoryOperatingAuthorityOwner =
  (typeof KNOWLEDGE_MEMORY_OPERATING_AUTHORITY_OWNERS)[number]

export function isKnowledgeMemoryOperatingAuthorityOwner(
  value: string,
): value is KnowledgeMemoryOperatingAuthorityOwner {
  return (KNOWLEDGE_MEMORY_OPERATING_AUTHORITY_OWNERS as readonly string[]).includes(value)
}

/** Surface enable reason（4 词；closed）。 */
export const KNOWLEDGE_MEMORY_OPERATING_SURFACE_DISABLE_REASONS = [
  'disabled_in_config',
  'plugin_disabled',
  'plugin_uninstalled',
  'stale_base_version',
  'cross_tenant_reference',
  'inference_only',
  'eval_only',
  'missing_review_permission',
  'unknown',
] as const
export type KnowledgeMemoryOperatingSurfaceDisableReason =
  (typeof KNOWLEDGE_MEMORY_OPERATING_SURFACE_DISABLE_REASONS)[number]

export function isKnowledgeMemoryOperatingSurfaceDisableReason(
  value: string,
): value is KnowledgeMemoryOperatingSurfaceDisableReason {
  return (KNOWLEDGE_MEMORY_OPERATING_SURFACE_DISABLE_REASONS as readonly string[]).includes(value)
}

// ── 2. ScopedRef：opaque 引用（D1 envelope 公共字段） ────────────────────

/**
 * 组织内 opaque scoped reference：每 kind + 自身标识，绝不暴露领域主键或外部 ID。
 * - 形态：`{ kind, ref }`，ref 为 closed 字符集（`[a-zA-Z0-9._-]`，长度 1..128）。
 * - 不允许把 ref 解析为 path / URL / hash / 模型 ID。
 */
export interface KnowledgeMemoryScopedRef {
  readonly kind: KnowledgeMemoryOperatingKind
  /** opaque 引用（kind 内部封闭）。 */
  readonly ref: string
}

const SCOPED_REF_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/

export function isValidScopedRefKind(kind: string): kind is KnowledgeMemoryOperatingKind {
  return isKnowledgeMemoryOperatingKind(kind)
}

export function isValidScopedRefRef(ref: string): boolean {
  return typeof ref === 'string' && SCOPED_REF_PATTERN.test(ref)
}

export function makeScopedRef(
  kind: KnowledgeMemoryOperatingKind,
  ref: string,
): KnowledgeMemoryScopedRef {
  if (!isValidScopedRefRef(ref)) {
    throw new Error(`invalid_scoped_ref:${kind}:${ref.slice(0, 32)}`)
  }
  return Object.freeze({ kind, ref })
}

export function isKnowledgeMemoryScopedRef(value: unknown): value is KnowledgeMemoryScopedRef {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.kind === 'string' &&
    isKnowledgeMemoryOperatingKind(v.kind) &&
    typeof v.ref === 'string' &&
    isValidScopedRefRef(v.ref)
  )
}

// ── 3. Low-sensitive evidence（公共 envelope） ───────────────────────────

/** 通用低敏来源引用（D1 envelope：仅 opaque ref + kind + 状态）。 */
export interface OperatingLowSensitiveEvidence {
  /** opaque 引用（不暴露主键）。 */
  readonly ref: string
  /** 来源 kind（与 envelope.kind 一致或为 owning 词表值）。 */
  readonly sourceKind: string
  /** 状态/新鲜度（封闭）。 */
  readonly status: string
  /** 哈希指纹（确定性，由调用方传入；禁止放正文）。 */
  readonly fingerprint?: string
  /** 时间戳 ISO 8601。 */
  readonly observedAt?: string
}

/** Attention 推导 basis 描述。 */
export interface OperatingAttentionBasis {
  /** 推导 reason code（封闭词表）。 */
  readonly reasonCode: string
  /** 引用源 opaque refs（≤ 5 条）。 */
  readonly basisRefs: readonly string[]
  /** 备注（≤ 200 字符，不含正文）。 */
  readonly note?: string
}

// ── 4. 四 kind 封闭 variant projection ───────────────────────────────────

/** Knowledge item 投影：来自 four-layer knowledge。 */
export interface KnowledgeItemOperatingProjection {
  readonly kind: 'knowledge_item'
  readonly scopedRef: KnowledgeMemoryScopedRef
  readonly scope: KnowledgeMemoryOperatingScope
  readonly visibility: KnowledgeMemoryOperatingVisibility
  readonly status: KnowledgeMemoryOperatingStatus
  readonly priority: KnowledgeMemoryOperatingPriority
  readonly freshnessState: KnowledgeMemoryOperatingFreshnessState
  readonly title: string
  readonly layer: 'L1' | 'L2' | 'L3' | 'L4'
  readonly lifecycle: 'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'
  readonly provenance: OperatingLowSensitiveEvidence[]
  readonly reviewCount: number
  readonly lastReviewedAt?: string
  readonly attentionBasis: OperatingAttentionBasis
  /** 安全低敏标签（L3 / inference / methodology 等，禁存约束下使用）。 */
  readonly safeLabels: readonly string[]
  readonly updatedAt: string
}

/** Copilot memory 投影：恒为 inference。 */
export interface CopilotMemoryOperatingProjection {
  readonly kind: 'copilot_memory'
  readonly scopedRef: KnowledgeMemoryScopedRef
  readonly scope: KnowledgeMemoryOperatingScope
  readonly memoryScope: 'user' | 'project' | 'organization'
  /**
   * owning 端点使用的不透明条目标识（`entryId`）。
   *
   * 运营 scopedRef 用的是数据库行 id，而 `/ai/memory` 的确认/失效/删除都按
   * `entryId` 寻址——不带这个字段，handoff 在客户端就无法把两者对上。
   * 它是不透明标识，不含摘要内容。
   */
  readonly owningEntryRef: string
  readonly visibility: KnowledgeMemoryOperatingVisibility
  readonly status: KnowledgeMemoryOperatingStatus
  readonly priority: KnowledgeMemoryOperatingPriority
  readonly freshnessState: KnowledgeMemoryOperatingFreshnessState
  /** 摘要长度（不暴露正文，只记字符数 + basis count）。 */
  readonly summaryByteSize: number
  readonly basisCount: number
  /** 置信度来源档（封闭，参见 copilot-memory.ts）。 */
  readonly confidenceSource: string
  readonly statusDetail: 'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
  /** 是否与实时项目事实冲突（由 detectConflictWithLiveFact 派生）。 */
  readonly hasLiveFactConflict: boolean
  readonly attentionBasis: OperatingAttentionBasis
  readonly safeLabels: readonly string[]
  readonly updatedAt: string
}

/** Skill knowledge draft 投影。 */
export interface SkillKnowledgeDraftOperatingProjection {
  readonly kind: 'skill_knowledge_draft'
  readonly scopedRef: KnowledgeMemoryScopedRef
  readonly scope: KnowledgeMemoryOperatingScope
  readonly visibility: KnowledgeMemoryOperatingVisibility
  readonly status: KnowledgeMemoryOperatingStatus
  readonly priority: KnowledgeMemoryOperatingPriority
  readonly freshnessState: KnowledgeMemoryOperatingFreshnessState
  readonly skillId: number
  readonly skillName: string
  readonly draftStatus: 'pending' | 'committed' | 'discarded'
  /** base version（与 Skill current version 对比）。 */
  readonly baseVersion: string
  readonly currentVersion: string
  readonly baseStale: boolean
  readonly sectionCount: number
  /** plugin provenance 摘要（不可执行代码）。 */
  readonly pluginProvenance:
    | { readonly kind: 'core' }
    | {
        readonly kind: 'plugin'
        readonly pluginId: string
        readonly skillIdentity: string
        readonly disabled: boolean
        readonly uninstalled: boolean
      }
  readonly attentionBasis: OperatingAttentionBasis
  readonly safeLabels: readonly string[]
  readonly updatedAt: string
}

/** Retrieval signal 投影：来自 copilot-context-observation 聚合。 */
export interface RetrievalSignalOperatingProjection {
  readonly kind: 'retrieval_signal'
  readonly scopedRef: KnowledgeMemoryScopedRef
  readonly scope: KnowledgeMemoryOperatingScope
  readonly visibility: KnowledgeMemoryOperatingVisibility
  readonly status: KnowledgeMemoryOperatingStatus
  readonly priority: KnowledgeMemoryOperatingPriority
  readonly freshnessState: KnowledgeMemoryOperatingFreshnessState
  readonly retrievalKind: string
  readonly queryCategory: string
  readonly windowStart: string
  readonly windowEnd: string
  readonly sampleCount: number
  readonly zeroResultRate: number
  readonly degraded: boolean
  readonly truncated: boolean
  readonly permissionExcludedCount: number
  readonly attentionBasis: OperatingAttentionBasis
  readonly safeLabels: readonly string[]
  readonly updatedAt: string
}

/** Operating item 公共 envelope（D1 tagged union）。 */
export type KnowledgeMemoryOperatingItem =
  | KnowledgeItemOperatingProjection
  | CopilotMemoryOperatingProjection
  | SkillKnowledgeDraftOperatingProjection
  | RetrievalSignalOperatingProjection

// ── 5. OwningSurfaceDescriptor（D5） ─────────────────────────────────────

/** Owning surface descriptor：低敏、只承载 scoped refs，无 callback / handle。 */
export interface OperatingOwningSurfaceDescriptor {
  readonly surface: KnowledgeMemoryOperatingSurface
  readonly enabled: boolean
  readonly disableReason?: KnowledgeMemoryOperatingSurfaceDisableReason
  readonly authorityOwner: KnowledgeMemoryOperatingAuthorityOwner
  /** scoped refs（opaque，相同于 envelope.scopedRef）。 */
  readonly scopedRefs: readonly string[]
  /** safe return context（≤ 200 字符、低敏、不携带状态变更 token）。 */
  readonly safeReturnContext: string
  /** 可达路径（low-sensitive，相对路径或 route 标识）。 */
  readonly routeKey: string
}

// ── 6. Operating detail（公共 envelope：kind + scopedRef + projection） ──

/** detail 投影（item 完整 payload + 拥有 surface descriptor）。 */
export interface KnowledgeMemoryOperatingDetail {
  readonly kind: KnowledgeMemoryOperatingKind
  readonly scopedRef: KnowledgeMemoryScopedRef
  readonly item: KnowledgeMemoryOperatingItem
  readonly surfaces: readonly OperatingOwningSurfaceDescriptor[]
  /** 引用计数（用于 detail 「同 kind 关联对象」，不可识别 cross-org）。 */
  readonly relatedCount: number
  /** 时间戳。 */
  readonly fetchedAt: string
}

// ── 7. Operating summary（运营总览） ────────────────────────────────────

/** 单 lane 计数与覆盖度。 */
export interface OperatingLaneCount {
  readonly lane: KnowledgeMemoryOperatingKind
  readonly total: number
  readonly attentionCount: number
  readonly degraded: boolean
  readonly coverage: 'complete' | 'partial' | 'degraded' | 'hidden' | 'empty' | 'unavailable'
}

export interface OperatingSummary {
  readonly organizationId: number
  readonly generatedAt: string
  readonly lanes: readonly OperatingLaneCount[]
  /** 按 attention facet 聚合的 counts。 */
  readonly attentionFacetCounts: Readonly<Record<KnowledgeMemoryOperatingStatus, number>>
  /** 总 attention 数（visible + needs action）。 */
  readonly totalAttention: number
  /** 是否任意 lane 处于 degraded。 */
  readonly anyLaneDegraded: boolean
  /** 是否拥有 superAdmin 视图（与生产 summary 不同语义）。 */
  readonly visibility: KnowledgeMemoryOperatingVisibility
}

// ── 8. List envelope & meta（D3 stable sort / bounded page） ────────────

export interface OperatingListMeta {
  readonly page: number
  readonly perPage: number
  readonly total: number
  readonly totalPages: number
  /** 参与 merge 的 lanes。 */
  readonly lanes: readonly KnowledgeMemoryOperatingKind[]
  /** 任意 lane 失败 → degraded 标。 */
  readonly degradedLanes: readonly KnowledgeMemoryOperatingKind[]
  /** 同一输入下是否确定性返回。 */
  readonly deterministic: true
}

export interface OperatingListEnvelope {
  readonly data: readonly KnowledgeMemoryOperatingItem[]
  readonly meta: OperatingListMeta
}

// ── 9. Filter allowlist（D3 / D6） ──────────────────────────────────────

export interface OperatingListFilters {
  readonly kinds?: readonly KnowledgeMemoryOperatingKind[]
  readonly statuses?: readonly KnowledgeMemoryOperatingStatus[]
  readonly scopes?: readonly KnowledgeMemoryOperatingScope[]
  readonly attentionFacets?: readonly KnowledgeMemoryOperatingStatus[]
  readonly labelKeywords?: readonly string[]
  /** 排序字段：attentionPriority | attentionAt | kind | scopedRef。 */
  readonly sort?: 'attentionPriority' | 'attentionAt' | 'kind' | 'scopedRef'
  /** 排序方向：desc | asc。 */
  readonly order?: 'desc' | 'asc'
  readonly page: number
  readonly perPage: number
}

export const OPERATING_LIST_DEFAULT_PER_PAGE = 20
export const OPERATING_LIST_MAX_PER_PAGE = 100
export const OPERATING_LIST_MAX_PAGE = 1000
export const OPERATING_LABEL_KEYWORD_MAX = 8
export const OPERATING_LABEL_KEYWORD_MAX_LEN = 32

/**
 * D3 bounded multi-lane merge：单个 lane 一次最多加载的低敏 projection 数。
 *
 * 跨 lane 的确定性 offset 分页要求每个 lane 交出「合并窗口内的前 N 项」，
 * 而不是各自的第 N 页——否则相邻页会重复与遗漏。窗口大小 = `page * perPage`，
 * 并被本上限固定，保证深页不会退化成全表扫描。
 */
export const OPERATING_MAX_MERGE_WINDOW = 2000

/** 当前请求需要每个 lane 交出的合并窗口大小（已按上限截断）。 */
export function operatingMergeWindowFor(page: number, perPage: number): number {
  if (!Number.isInteger(page) || !Number.isInteger(perPage)) return 0
  if (page < 1 || perPage < 1) return 0
  return Math.min(page * perPage, OPERATING_MAX_MERGE_WINDOW)
}

/**
 * 深页是否落在合并窗口内。
 *
 * 超出窗口的页 MUST 被拒绝（422），而不是静默返回空页——空页会被读成
 * 「没有更多对象」，属于 spec 禁止的 false-zero。
 */
export function isOperatingPageWithinMergeWindow(page: number, perPage: number): boolean {
  if (!isOperatingPageInBounds(page, perPage)) return false
  return page * perPage <= OPERATING_MAX_MERGE_WINDOW
}

// ── 10. URL state allowlist（D6） ───────────────────────────────────────

export interface OperatingUrlState {
  readonly view: 'operations'
  readonly attention?: KnowledgeMemoryOperatingStatus
  readonly kind?: KnowledgeMemoryOperatingKind
  readonly scope?: KnowledgeMemoryOperatingScope
  readonly status?: KnowledgeMemoryOperatingStatus
  readonly sort?: 'attentionPriority' | 'attentionAt' | 'kind' | 'scopedRef'
  readonly order?: 'desc' | 'asc'
  readonly page?: number
  readonly perPage?: number
  readonly selected?: KnowledgeMemoryScopedRef
  readonly surface?: KnowledgeMemoryOperatingSurface
}

export const OPERATING_URL_QUERY_KEYS = [
  'view',
  'attention',
  'kind',
  'scope',
  'status',
  'sort',
  'order',
  'page',
  'perPage',
  'selected',
  'surface',
] as const

export type OperatingUrlQueryKey = (typeof OPERATING_URL_QUERY_KEYS)[number]

// ── 11. Sort tuple & deterministic k-way merge（D3 / D8） ──────────────

/** sort tuple：priority DESC → attentionAt DESC → kind ASC → scopedRef ASC。 */
export interface OperatingSortKey {
  readonly priorityRank: number // p0=0, p1=1, p2=2, p3=3
  /** attentionAt 倒序 → 用 negative ms 或 fixed comparator。 */
  readonly attentionAt: number
  readonly kindOrder: number
  readonly scopedRef: string
}

const PRIORITY_RANK: Record<KnowledgeMemoryOperatingPriority, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
}

const KIND_ORDER: Record<KnowledgeMemoryOperatingKind, number> = {
  knowledge_item: 0,
  copilot_memory: 1,
  skill_knowledge_draft: 2,
  retrieval_signal: 3,
}

/** 计算 sort tuple（纯函数，确定性）。 */
export function computeOperatingSortKey(item: KnowledgeMemoryOperatingItem): OperatingSortKey {
  const priorityRank = PRIORITY_RANK[item.priority]
  const kindOrder = KIND_ORDER[item.kind]
  const attentionAt = Date.parse(item.updatedAt)
  return {
    priorityRank,
    attentionAt,
    kindOrder,
    scopedRef: item.scopedRef.ref,
  }
}

/** 严格 sort tuple 比较（D3 stable sort）。 */
export function compareOperatingSortKeys(a: OperatingSortKey, b: OperatingSortKey): number {
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
  if (a.attentionAt !== b.attentionAt) return b.attentionAt - a.attentionAt // DESC
  if (a.kindOrder !== b.kindOrder) return a.kindOrder - b.kindOrder
  if (a.scopedRef < b.scopedRef) return -1
  if (a.scopedRef > b.scopedRef) return 1
  return 0
}

// ── 12. Filter / page 纯函数 ───────────────────────────────────────────

/** 校验 page / perPage 边界。 */
export function isOperatingPageInBounds(page: number, perPage: number): boolean {
  if (!Number.isInteger(page) || !Number.isInteger(perPage)) return false
  if (page < 1) return false
  if (perPage < 1) return false
  if (page > OPERATING_LIST_MAX_PAGE) return false
  if (perPage > OPERATING_LIST_MAX_PER_PAGE) return false
  return true
}

/** 应用 allowlist filter（fail closed：未知 kind/status/scope 一律拒绝）。 */
export function applyOperatingListFilter(
  items: readonly KnowledgeMemoryOperatingItem[],
  filters: OperatingListFilters,
): readonly KnowledgeMemoryOperatingItem[] {
  if (!isOperatingPageInBounds(filters.page, filters.perPage)) {
    return []
  }
  const kinds = filters.kinds
  const statuses = filters.statuses
  const scopes = filters.scopes
  const attentions = filters.attentionFacets
  const keywords = (filters.labelKeywords ?? []).slice(0, OPERATING_LABEL_KEYWORD_MAX)
  return items.filter((it) => {
    if (kinds && kinds.length > 0 && !kinds.includes(it.kind)) return false
    if (statuses && statuses.length > 0 && !statuses.includes(it.status)) return false
    if (scopes && scopes.length > 0 && !scopes.includes(it.scope)) return false
    if (attentions && attentions.length > 0 && !attentions.includes(it.status)) return false
    if (keywords.length > 0) {
      const labels = it.safeLabels.join(' ').toLowerCase()
      const ok = keywords.some((k) => labels.includes(k.toLowerCase()))
      if (!ok) return false
    }
    return true
  })
}

/** Stable sort：sort tuple + 不可变输入。 */
export function sortOperatingItems(
  items: readonly KnowledgeMemoryOperatingItem[],
): readonly KnowledgeMemoryOperatingItem[] {
  return [...items].sort((a, b) =>
    compareOperatingSortKeys(computeOperatingSortKey(a), computeOperatingSortKey(b)),
  )
}

/** 跨 kind k-way merge + meta（D3 / D8）。 */
export function buildOperatingListEnvelope(
  lanes: Readonly<Record<KnowledgeMemoryOperatingKind, readonly KnowledgeMemoryOperatingItem[]>>,
  filters: OperatingListFilters,
  degradedLanes: readonly KnowledgeMemoryOperatingKind[] = [],
  /**
   * 每个 lane 在当前 filter 下的**权威总数**（不是合并窗口内的条数）。
   *
   * 省略时退回按合并后条数计数——只有当调用方确实把全部可见对象交进来时
   * 才成立。聚合 Service MUST 传入 lane totals，否则深页 `total` 会缩水成
   * 窗口大小，被读成 false-zero。
   */
  laneTotals?: Readonly<Partial<Record<KnowledgeMemoryOperatingKind, number>>>,
): OperatingListEnvelope {
  if (!isOperatingPageInBounds(filters.page, filters.perPage)) {
    return {
      data: [],
      meta: {
        page: filters.page,
        perPage: filters.perPage,
        total: 0,
        totalPages: 0,
        lanes: Object.keys(lanes).filter((k) =>
          isKnowledgeMemoryOperatingKind(k),
        ) as KnowledgeMemoryOperatingKind[],
        degradedLanes,
        deterministic: true,
      },
    }
  }
  // 1. lane 合并（按 kind order）
  const laneOrder: KnowledgeMemoryOperatingKind[] = [
    'knowledge_item',
    'copilot_memory',
    'skill_knowledge_draft',
    'retrieval_signal',
  ]
  const merged: KnowledgeMemoryOperatingItem[] = []
  for (const lane of laneOrder) {
    const arr = lanes[lane] ?? []
    for (const it of arr) merged.push(it)
  }
  // 2. allowlist filter
  const filtered = applyOperatingListFilter(merged, filters)
  // 3. stable sort
  const sorted = sortOperatingItems(filtered)
  // 4. meta —— total 取 lane 权威总数之和（缺省退回窗口内条数）
  const total = laneTotals
    ? laneOrder.reduce((sum, lane) => sum + (laneTotals[lane] ?? 0), 0)
    : filtered.length
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage))
  const start = (filters.page - 1) * filters.perPage
  const end = start + filters.perPage
  const data = sorted.slice(start, end)
  return {
    data,
    meta: {
      page: filters.page,
      perPage: filters.perPage,
      total,
      totalPages,
      lanes: Object.keys(lanes).filter((k) =>
        isKnowledgeMemoryOperatingKind(k),
      ) as KnowledgeMemoryOperatingKind[],
      degradedLanes,
      deterministic: true,
    },
  }
}

// ── 13. Attention derivation 纯函数（D4：attention 由 owning facts 派生） ──

/** knowledge_item attention 派生（D4 1.4）。 */
export function deriveKnowledgeItemAttention(input: {
  layer: 'L1' | 'L2' | 'L3' | 'L4'
  lifecycle: 'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'
  hasProvenance: boolean
  isL3EvalOnly: boolean
}): KnowledgeMemoryOperatingStatus {
  if (input.isL3EvalOnly || input.layer === 'L3') return 'synthetic_eval_only'
  if (input.lifecycle === 'pending' || input.lifecycle === 'draft') return 'needs_review'
  if (input.lifecycle === 'outdated') return 'stale_or_unconfirmed'
  if (input.lifecycle === 'deprecated') return 'stale_or_unconfirmed'
  if (!input.hasProvenance) return 'provenance_gap'
  return 'ready'
}

/** copilot_memory attention 派生（D4 1.5：恒 inference 标识）。 */
export function deriveCopilotMemoryAttention(input: {
  statusDetail: 'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
  hasLiveFactConflict: boolean
  longUnconfirmed: boolean
}): KnowledgeMemoryOperatingStatus {
  if (input.statusDetail === 'invalidated') return 'stale_or_unconfirmed'
  if (input.hasLiveFactConflict) return 'conflict'
  if (input.statusDetail === 'candidate') return 'needs_review'
  if (input.longUnconfirmed) return 'stale_or_unconfirmed'
  return 'ready'
}

/** skill_knowledge_draft attention 派生（D4 1.6）。 */
export function deriveSkillKnowledgeDraftAttention(input: {
  draftStatus: 'pending' | 'committed' | 'discarded'
  baseStale: boolean
  pluginDisabled: boolean
}): KnowledgeMemoryOperatingStatus {
  if (input.draftStatus === 'discarded') return 'stale_or_unconfirmed'
  if (input.baseStale) return 'stale_or_unconfirmed'
  if (input.draftStatus === 'pending' && input.pluginDisabled) return 'provenance_gap'
  if (input.draftStatus === 'pending') return 'needs_review'
  return 'ready'
}

/** retrieval_signal attention 派生（D4 1.7）。 */
export function deriveRetrievalSignalAttention(input: {
  degraded: boolean
  noObservation: boolean
  zeroResultRate: number
  truncated: boolean
  uncertaintyHigh: boolean
  permissionExcludedCount: number
}): KnowledgeMemoryOperatingStatus {
  if (input.degraded) return 'degraded'
  if (input.noObservation) return 'retrieval_gap'
  if (input.zeroResultRate >= 0.5) return 'retrieval_gap'
  if (input.uncertaintyHigh) return 'retrieval_gap'
  if (input.permissionExcludedCount > 0 && input.truncated) return 'retrieval_gap'
  return 'ready'
}

/** status → priority 映射（D4 / D8：priority 由 status 派生）。 */
export function priorityForStatus(
  status: KnowledgeMemoryOperatingStatus,
): KnowledgeMemoryOperatingPriority {
  switch (status) {
    case 'conflict':
    case 'synthetic_eval_only':
    case 'degraded':
      return 'p0'
    case 'needs_review':
    case 'stale_or_unconfirmed':
      return 'p1'
    case 'provenance_gap':
    case 'retention_attention':
    case 'retrieval_gap':
      return 'p2'
    case 'ready':
      return 'p3'
  }
}

// ── 14. Surface resolve / enabled check（D5） ──────────────────────────

/** 根据 kind → default surface 映射。 */
export function defaultSurfaceForKind(
  kind: KnowledgeMemoryOperatingKind,
): KnowledgeMemoryOperatingSurface {
  switch (kind) {
    case 'knowledge_item':
      return 'knowledge_review'
    case 'copilot_memory':
      return 'copilot_memory_governance'
    case 'skill_knowledge_draft':
      return 'skill_knowledge_authoring'
    case 'retrieval_signal':
      return 'retrieval_observation_detail'
  }
}

/** ownership service / surface 映射。 */
export function authorityOwnerForSurface(
  surface: KnowledgeMemoryOperatingSurface,
): KnowledgeMemoryOperatingAuthorityOwner {
  switch (surface) {
    case 'knowledge_review':
      return 'knowledge_service'
    case 'copilot_memory_governance':
      return 'copilot_memory_service'
    case 'skill_knowledge_authoring':
      return 'skill_knowledge_authoring_service'
    case 'retrieval_observation_detail':
      return 'copilot_context_observation_service'
  }
}

/** Surface disable 判定（fail closed：plugin disabled / uninstalled / stale base / L3 eval-only / inference）。 */
export function computeSurfaceEnabled(input: {
  surface: KnowledgeMemoryOperatingSurface
  pluginDisabled: boolean
  pluginUninstalled: boolean
  baseStale: boolean
  layer?: 'L1' | 'L2' | 'L3' | 'L4'
  isMemoryScope: boolean
}): { enabled: boolean; disableReason?: KnowledgeMemoryOperatingSurfaceDisableReason } {
  if (input.pluginUninstalled) return { enabled: false, disableReason: 'plugin_uninstalled' }
  if (input.pluginDisabled) return { enabled: false, disableReason: 'plugin_disabled' }
  if (input.baseStale) return { enabled: false, disableReason: 'stale_base_version' }
  if (input.layer === 'L3') return { enabled: false, disableReason: 'eval_only' }
  if (input.isMemoryScope) return { enabled: true }
  return { enabled: true }
}

/** 构造 owning surface descriptor（D5 封装：不带 callback / handle / token）。 */
export function buildOwningSurfaceDescriptor(input: {
  surface: KnowledgeMemoryOperatingSurface
  scopedRef: KnowledgeMemoryScopedRef
  enabled: boolean
  disableReason?: KnowledgeMemoryOperatingSurfaceDisableReason
  routeKey: string
  safeReturnContext: string
}): OperatingOwningSurfaceDescriptor {
  return Object.freeze({
    surface: input.surface,
    enabled: input.enabled,
    disableReason: input.disableReason,
    authorityOwner: authorityOwnerForSurface(input.surface),
    scopedRefs: Object.freeze([input.scopedRef.ref]),
    safeReturnContext: input.safeReturnContext.slice(0, 200),
    routeKey: input.routeKey.slice(0, 200),
  })
}

// ── 15. URL state parse/serialize（D6） ─────────────────────────────────

/**
 * 宽松解析：**逐字段**丢弃非法值，保留其余合法筛选。
 *
 * `parseOperatingUrlState` 是严格模式——任一字段非法就整条 URL 判负。用它做
 * 页面恢复会连带把用户合法的筛选一起清空，而 spec 要求「拒绝或移除这些值」
 * 的同时「保留安全筛选上下文」。所以恢复路径用本函数，校验路径仍用严格版。
 *
 * `removed` 只记字段名，不记被丢弃的值——被丢弃的往往正是不该外带的内容。
 */
export function sanitizeOperatingUrlState(params: URLSearchParams): {
  readonly state: OperatingUrlState
  readonly removed: readonly string[]
} {
  const removed: string[] = []
  const keep = new URLSearchParams()
  keep.set('view', 'operations')

  for (const key of Array.from(params.keys())) {
    if (key === 'view') continue
    if (!(OPERATING_URL_QUERY_KEYS as readonly string[]).includes(key)) {
      removed.push(key)
      continue
    }
    const value = params.get(key)
    if (value === null || value === '') continue
    // 逐字段试解析：只把该字段加进来，能过严格校验才保留。
    const probe = new URLSearchParams({ view: 'operations', [key]: value })
    if (parseOperatingUrlState(probe).ok) {
      keep.set(key, value)
    } else {
      removed.push(key)
    }
  }

  const result = parseOperatingUrlState(keep)
  return {
    state: result.ok ? result.value : { view: 'operations' },
    removed,
  }
}

/** 序列化 operating URL state → URLSearchParams。 */
export function serializeOperatingUrlState(state: OperatingUrlState): URLSearchParams {
  const out = new URLSearchParams()
  out.set('view', state.view)
  if (state.attention) out.set('attention', state.attention)
  if (state.kind) out.set('kind', state.kind)
  if (state.scope) out.set('scope', state.scope)
  if (state.status) out.set('status', state.status)
  if (state.sort) out.set('sort', state.sort)
  if (state.order) out.set('order', state.order)
  if (typeof state.page === 'number') out.set('page', String(state.page))
  if (typeof state.perPage === 'number') out.set('perPage', String(state.perPage))
  if (state.selected) out.set('selected', `${state.selected.kind}:${state.selected.ref}`)
  if (state.surface) out.set('surface', state.surface)
  return out
}

/** 反序列化 URLSearchParams → operating URL state（allowlist + 注入拒绝）。 */
export function parseOperatingUrlState(
  params: URLSearchParams,
): { ok: true; value: OperatingUrlState } | { ok: false; reason: string } {
  // 拒绝未知字段
  for (const key of Array.from(params.keys())) {
    if (!(OPERATING_URL_QUERY_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reason: `unknown_query_key:${key}` }
    }
  }
  const view = params.get('view')
  if (view !== 'operations') {
    return { ok: false, reason: 'invalid_view' }
  }
  const attention = params.get('attention')
  if (attention && !isKnowledgeMemoryOperatingStatus(attention)) {
    return { ok: false, reason: 'invalid_attention' }
  }
  const kind = params.get('kind')
  if (kind && !isKnowledgeMemoryOperatingKind(kind)) {
    return { ok: false, reason: 'invalid_kind' }
  }
  const scope = params.get('scope')
  if (scope && !isKnowledgeMemoryOperatingScope(scope)) {
    return { ok: false, reason: 'invalid_scope' }
  }
  const status = params.get('status')
  if (status && !isKnowledgeMemoryOperatingStatus(status)) {
    return { ok: false, reason: 'invalid_status' }
  }
  const sort = params.get('sort')
  if (sort && !['attentionPriority', 'attentionAt', 'kind', 'scopedRef'].includes(sort)) {
    return { ok: false, reason: 'invalid_sort' }
  }
  const order = params.get('order')
  if (order && !['desc', 'asc'].includes(order)) {
    return { ok: false, reason: 'invalid_order' }
  }
  const pageRaw = params.get('page')
  let page: number | undefined
  if (pageRaw) {
    const n = Number(pageRaw)
    if (!Number.isInteger(n) || n < 1 || n > OPERATING_LIST_MAX_PAGE) {
      return { ok: false, reason: 'invalid_page' }
    }
    page = n
  }
  const perPageRaw = params.get('perPage')
  let perPage: number | undefined
  if (perPageRaw) {
    const n = Number(perPageRaw)
    if (!Number.isInteger(n) || n < 1 || n > OPERATING_LIST_MAX_PER_PAGE) {
      return { ok: false, reason: 'invalid_perPage' }
    }
    perPage = n
  }
  const selectedRaw = params.get('selected')
  let selected: KnowledgeMemoryScopedRef | undefined
  if (selectedRaw) {
    const colonIdx = selectedRaw.indexOf(':')
    if (colonIdx <= 0 || colonIdx === selectedRaw.length - 1) {
      return { ok: false, reason: 'invalid_selected' }
    }
    const k = selectedRaw.slice(0, colonIdx)
    const r = selectedRaw.slice(colonIdx + 1)
    if (!isKnowledgeMemoryOperatingKind(k)) {
      return { ok: false, reason: 'invalid_selected_kind' }
    }
    if (!isValidScopedRefRef(r)) {
      return { ok: false, reason: 'invalid_selected_ref' }
    }
    selected = { kind: k, ref: r }
  }
  const surface = params.get('surface')
  if (surface && !isKnowledgeMemoryOperatingSurface(surface)) {
    return { ok: false, reason: 'invalid_surface' }
  }
  // 内容型参数 / 注入拒绝：长度上限 + 字符集
  for (const k of OPERATING_URL_QUERY_KEYS) {
    const v = params.get(k)
    if (v && v.length > 256) {
      return { ok: false, reason: `too_long:${k}` }
    }
  }
  return {
    ok: true,
    value: {
      view: 'operations',
      attention: (attention as KnowledgeMemoryOperatingStatus | undefined) ?? undefined,
      kind: (kind as KnowledgeMemoryOperatingKind | undefined) ?? undefined,
      scope: (scope as KnowledgeMemoryOperatingScope | undefined) ?? undefined,
      status: (status as KnowledgeMemoryOperatingStatus | undefined) ?? undefined,
      sort: (sort as OperatingUrlState['sort']) ?? undefined,
      order: (order as OperatingUrlState['order']) ?? undefined,
      page,
      perPage,
      selected,
      surface: (surface as KnowledgeMemoryOperatingSurface | undefined) ?? undefined,
    },
  }
}

// ── 16. low-sensitive allowlist scan（D7） ─────────────────────────────

/** 禁存 token 集合（核心禁存；fixture 与生产 DTO 都不应含这些子串）。 */
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  // 正文 / memory summary
  'SAMPLE_SECRET_BODY',
  'SAMPLE_MEMORY_SUMMARY',
  // prompt / system instruction / model output
  'SAMPLE_PROMPT_BODY',
  'SAMPLE_SYSTEM_INSTRUCTION',
  'SAMPLE_MODEL_OUTPUT',
  // retrieval query / tool args / results
  'SAMPLE_RETRIEVAL_QUERY',
  'SAMPLE_TOOL_ARG',
  'SAMPLE_TOOL_RESULT',
  // secret / token / auth
  'sk-SAMPLE-SECRET',
  'Bearer SAMPLE-TOKEN',
  'api_key=SAMPLE',
  // absolute path
  'C:\\SAMPLE\\ABSOLUTE\\PATH',
  '/var/sample/absolute/path',
]

export interface OperatingLowSensitiveScanResult {
  readonly safe: boolean
  readonly hits: readonly string[]
}

// ── 低敏 **allowlist**（spec：不得依赖 denylist 猜测敏感字段） ─────────

/**
 * 每个 kind 允许出现的字段名（封闭集合）。
 *
 * `scanOperatingLowSensitive` 是诱饵 denylist，只能在测试里抓已知诱饵串；
 * 真正的边界是本 allowlist——未声明的 key 一律拒绝，因此 adapter 想把正文、
 * prompt、token 之类塞进任何**新**字段都过不去，而不用先猜出它叫什么。
 */
const OPERATING_ITEM_COMMON_KEYS: readonly string[] = [
  'kind',
  'scopedRef',
  'scope',
  'visibility',
  'status',
  'priority',
  'freshnessState',
  'attentionBasis',
  'safeLabels',
  'updatedAt',
]

const OPERATING_ITEM_KIND_KEYS: Readonly<Record<KnowledgeMemoryOperatingKind, readonly string[]>> =
  {
    knowledge_item: ['title', 'layer', 'lifecycle', 'provenance', 'reviewCount', 'lastReviewedAt'],
    copilot_memory: [
      'memoryScope',
      'owningEntryRef',
      'summaryByteSize',
      'basisCount',
      'confidenceSource',
      'statusDetail',
      'hasLiveFactConflict',
    ],
    skill_knowledge_draft: [
      'skillId',
      'skillName',
      'draftStatus',
      'baseVersion',
      'currentVersion',
      'baseStale',
      'sectionCount',
      'pluginProvenance',
    ],
    retrieval_signal: [
      'retrievalKind',
      'queryCategory',
      'windowStart',
      'windowEnd',
      'sampleCount',
      'zeroResultRate',
      'degraded',
      'truncated',
      'permissionExcludedCount',
    ],
  }

/**
 * 校验一个运营对象只包含其 kind 声明过的字段。
 *
 * 未知 kind 与未声明 key 都 fail closed，返回具体命中项供降级日志使用
 * （命中项只含 key 名，不含值）。
 */
export function scanOperatingItemAllowlist(item: unknown): OperatingLowSensitiveScanResult {
  if (item === null || typeof item !== 'object') {
    return { safe: false, hits: ['<root>:not_an_object'] }
  }
  const record = item as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string' || !isKnowledgeMemoryOperatingKind(kind)) {
    return { safe: false, hits: ['kind:unknown_kind'] }
  }
  const allowed = new Set([...OPERATING_ITEM_COMMON_KEYS, ...OPERATING_ITEM_KIND_KEYS[kind]])
  const hits = Object.keys(record).filter((k) => !allowed.has(k))
  return { safe: hits.length === 0, hits: hits.map((k) => `${kind}:${k}`) }
}

/** 对一批运营对象执行 allowlist 校验（任一不合规即整体不安全）。 */
export function scanOperatingItemsAllowlist(
  items: readonly unknown[],
): OperatingLowSensitiveScanResult {
  const hits: string[] = []
  for (const item of items) {
    const res = scanOperatingItemAllowlist(item)
    if (!res.safe) hits.push(...res.hits)
  }
  return { safe: hits.length === 0, hits }
}

/** 对单个 DTO / object 做低敏 allowlist 扫描。 */
export function scanOperatingLowSensitive(value: unknown): OperatingLowSensitiveScanResult {
  const hits: string[] = []
  walk(value, '', hits)
  return { safe: hits.length === 0, hits }
}

function walk(value: unknown, prefix: string, hits: string[]): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    for (const s of FORBIDDEN_SUBSTRINGS) {
      if (value.includes(s)) {
        hits.push(`${prefix || '<root>'}:${s}`)
      }
    }
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${prefix}[${i}]`, hits)
    }
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, prefix ? `${prefix}.${k}` : k, hits)
    }
  }
}
