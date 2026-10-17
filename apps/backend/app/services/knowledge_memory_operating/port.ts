/**
 * v3-knowledge-memory-operating-layer —— 四个 read port 的接口契约。
 *
 * 设计 D2：聚合器只依赖四个封闭 read ports。port 类型层不暴露
 * create / update / confirm / transition / invalidate / delete / commit
 * / AIGateway / provider / fetch / http / webhook / 外部 client。
 *
 * 每个 port 暴露：
 * - countByFacets(input)  → lane 计数 + degraded 标
 * - listWindow(input)     → bounded window 投影（≤ perPage 上限）
 * - getProjection(input)  → 单个 kind+scopedRef 的低敏 detail
 * - resolveSurface(input) → owning surface descriptor
 *
 * 所有方法：
 * - 必须接收 effective organization + actor scope；
 * - 必须返回低敏 projection（不返回正文、prompt、token、summary 内容）；
 * - 失败必须 fail closed（抛出 closed 错误码集合中的一种，不吞错）。
 *
 * @aiproj/backend
 */

import type {
  CopilotMemoryOperatingProjection,
  KnowledgeItemOperatingProjection,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryScopedRef,
  OperatingLowSensitiveEvidence,
  OperatingOwningSurfaceDescriptor,
  RetrievalSignalOperatingProjection,
  SkillKnowledgeDraftOperatingProjection,
} from '@aiproj/types'

// ── 公共输入 ────────────────────────────────────────────────────────

/** 调用方执行上下文（被 port 强制附加到所有 SQL / scope）。 */
export interface OperatingReadContext {
  readonly organizationId: number
  readonly actorId: number
  /**
   * 浏览器/调用方声明的 project scope（可空 = 跨项目）。
   *
   * 这里刻意**不带 actor 角色**：入口 RBAC 由 Policy 在 Controller 层判定，
   * 端口只按 organization/actor/project scope 过滤。带一个没人消费的角色字段，
   * 迟早会被后来者当成已校验的授权依据。
   */
  readonly projectId?: number | null
  /** 是否为 eval context（生产路径必须为 false；eval 才允许 L3）。 */
  readonly evalContext?: boolean
}

/** Lane count + coverage 输入。 */
export interface OperatingCountInput {
  readonly ctx: OperatingReadContext
  /** 注意力 facet 过滤（仅 kind 内 status 字段）。 */
  readonly statuses?: readonly import('@aiproj/types').KnowledgeMemoryOperatingStatus[]
}

/** Lane count + coverage 输出。 */
export interface OperatingCountResult {
  readonly total: number
  readonly attentionCount: number
  /** 来自该 lane 内的 facet 计数（去重可见对象）。 */
  readonly statusCounts: Readonly<
    Record<import('@aiproj/types').KnowledgeMemoryOperatingStatus, number>
  >
  readonly degraded: boolean
  readonly coverage: 'complete' | 'partial' | 'degraded' | 'hidden' | 'empty' | 'unavailable'
}

/** List window 输入。 */
export interface OperatingListInput {
  readonly ctx: OperatingReadContext
  readonly statuses?: readonly import('@aiproj/types').KnowledgeMemoryOperatingStatus[]
  readonly scopes?: readonly KnowledgeMemoryOperatingScope[]
  /**
   * 合并窗口大小：本 lane 需要交出**按自身稳定序排在最前的 limit 项**。
   *
   * 不是「第 N 页」——跨 lane 的确定性 offset 分页由聚合器在合并后统一切片，
   * 若每个 lane 各自翻页，相邻页会重复与遗漏（D3）。
   */
  readonly limit: number
  /** 跨 lane 时间窗下界（毫秒，> now 视为非法）。 */
  readonly windowStartMs?: number
  /** 跨 lane 时间窗上界（毫秒，< windowStartMs 视为非法）。 */
  readonly windowEndMs?: number
}

/** List window 输出（per lane；由聚合器做跨 lane k-way merge）。 */
export interface OperatingListResult {
  readonly items: readonly KnowledgeMemoryOperatingItem[]
  /**
   * 该 lane 在当前 filter 下的**权威总数**（可能 > items.length）。
   * 聚合器用它算 `meta.total`，避免深页把总数缩水成窗口大小。
   */
  readonly laneTotal: number
  /** 是否超时 / 降级（聚合器在 degradedLanes 里记录）。 */
  readonly degraded: boolean
  /** 该 lane 的实际查询耗时（毫秒，仅用于 instrumentation；不入 DTO）。 */
  readonly queryMs: number
  /** adapter 实际发出的 SQL / query 计数（用于无 N+1 门禁）。 */
  readonly queryCount: number
}

/** Get projection 输入（按 kind + scopedRef）。 */
export interface OperatingGetInput {
  readonly ctx: OperatingReadContext
  readonly scopedRef: KnowledgeMemoryScopedRef
}

/** Get projection 输出（低敏 detail）。 */
export interface OperatingGetResult {
  readonly item: KnowledgeMemoryOperatingItem
  readonly surfaces: readonly OperatingOwningSurfaceDescriptor[]
  /** 关联对象数（cross-tenant 不可识别；本 lane 内部计数）。 */
  readonly relatedCount: number
  /** 取数时刻（ISO 8601）。 */
  readonly fetchedAt: string
}

/** Resolve surface 输入。 */
export interface OperatingResolveSurfaceInput {
  readonly ctx: OperatingReadContext
  readonly scopedRef: KnowledgeMemoryScopedRef
  readonly surface: import('@aiproj/types').KnowledgeMemoryOperatingSurface
}

/** Resolve surface 输出（与 buildOwningSurfaceDescriptor 同语义，但 enabled 来自权威态）。 */
export interface OperatingResolveSurfaceResult {
  readonly descriptor: OperatingOwningSurfaceDescriptor
}

// ── Port interfaces（封闭 4 port） ──────────────────────────────────

export interface KnowledgeOperatingReadPort {
  readonly kind: 'knowledge_item'
  countByFacets(input: OperatingCountInput): Promise<OperatingCountResult>
  listWindow(input: OperatingListInput): Promise<OperatingListResult>
  getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null>
  resolveSurface(input: OperatingResolveSurfaceInput): Promise<OperatingResolveSurfaceResult | null>
}

export interface CopilotMemoryOperatingReadPort {
  readonly kind: 'copilot_memory'
  countByFacets(input: OperatingCountInput): Promise<OperatingCountResult>
  listWindow(input: OperatingListInput): Promise<OperatingListResult>
  getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null>
  resolveSurface(input: OperatingResolveSurfaceInput): Promise<OperatingResolveSurfaceResult | null>
}

export interface SkillKnowledgeDraftOperatingReadPort {
  readonly kind: 'skill_knowledge_draft'
  countByFacets(input: OperatingCountInput): Promise<OperatingCountResult>
  listWindow(input: OperatingListInput): Promise<OperatingListResult>
  getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null>
  resolveSurface(input: OperatingResolveSurfaceInput): Promise<OperatingResolveSurfaceResult | null>
}

export interface RetrievalSignalOperatingReadPort {
  readonly kind: 'retrieval_signal'
  countByFacets(input: OperatingCountInput): Promise<OperatingCountResult>
  listWindow(input: OperatingListInput): Promise<OperatingListResult>
  getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null>
  resolveSurface(input: OperatingResolveSurfaceInput): Promise<OperatingResolveSurfaceResult | null>
}

// ── 端口集合（用于聚合器） ──────────────────────────────────────────

export interface OperatingReadPortRegistry {
  readonly knowledge: KnowledgeOperatingReadPort
  readonly memory: CopilotMemoryOperatingReadPort
  readonly skillDraft: SkillKnowledgeDraftOperatingReadPort
  readonly retrieval: RetrievalSignalOperatingReadPort
}

export function isReadPortKind(kind: string): kind is KnowledgeMemoryOperatingKind {
  return (
    kind === 'knowledge_item' ||
    kind === 'copilot_memory' ||
    kind === 'skill_knowledge_draft' ||
    kind === 'retrieval_signal'
  )
}

// ── Closed error codes（port 失败只允许以下码） ──────────────────────

export const OPERATING_READ_PORT_ERROR_CODES = [
  'OPERATING_PORT_TIMEOUT',
  'OPERATING_PORT_PARSE_ERROR',
  'OPERATING_PORT_SCOPE_DENIED',
  'OPERATING_PORT_INTERNAL_ERROR',
] as const

export type OperatingReadPortErrorCode = (typeof OPERATING_READ_PORT_ERROR_CODES)[number]

export class OperatingReadPortError extends Error {
  constructor(
    public readonly code: OperatingReadPortErrorCode,
    public readonly port: KnowledgeMemoryOperatingKind,
    message: string,
  ) {
    super(`[${code}] ${port}: ${message}`)
    this.name = 'OperatingReadPortError'
  }
}

// ── Re-exports（方便聚合器一次性 import） ────────────────────────────

export type {
  CopilotMemoryOperatingProjection,
  KnowledgeItemOperatingProjection,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryScopedRef,
  OperatingLowSensitiveEvidence,
  OperatingOwningSurfaceDescriptor,
  RetrievalSignalOperatingProjection,
  SkillKnowledgeDraftOperatingProjection,
}
