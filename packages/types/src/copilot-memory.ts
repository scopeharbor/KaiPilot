// @aiproj/types — V3 Copilot 跨对话记忆层契约（copilot-memory）
//
// v3-copilot-memory-user-and-project / §2 —— 三层作用域记忆条目、
// 恒为 inference 的序列化约束、抽取候选、注入选取与冲突裁决、
// 禁止类别 sanitizer、时效衰减与陈旧阈值、低敏审计字段集。
//
// 核心纪律：记忆恒为 inference，永不升格为 fact。
// 移植自 agent-observation-mcp-fabric spec §28-38。
//
// 依赖轻量约束：仅依赖本包 copilot-shared-contracts（纯类型 + 确定性 helpers），
// 无 AdonisJS / React / 数据库客户端 / 网络请求。

import type { CopilotScope } from './copilot-shared-contracts.js'
import { copilotStableSerialize } from './copilot-shared-contracts.js'

// ===========================================================================
// 1. 三层 scope 枚举与写入权限要求（§2.3）
// ===========================================================================

/**
 * 记忆作用域枚举。
 * - user: 用户个人偏好，作用域为 actor + organization
 * - project: 项目约定，作用域为 project
 * - organization: 组织术语表/方法论/模板，作用域为 organization
 */
export const COPILLOT_MEMORY_SCOPES = ['user', 'project', 'organization'] as const
export type CopilotMemoryScope = (typeof COPILLOT_MEMORY_SCOPES)[number]

export function isCopilotMemoryScope(v: string): v is CopilotMemoryScope {
  return (COPILLOT_MEMORY_SCOPES as readonly string[]).includes(v)
}

/**
 * 各 scope 写入权限要求。
 * user: 仅本人可写
 * project: 项目成员可写
 * organization: 需组织级管理权限
 */
export interface CopilotMemoryScopePermission {
  readonly scope: CopilotMemoryScope
  /** 写入所需的最低权限等级（RBAC 角色名）。 */
  readonly writePermission: string
  /** 读取策略描述。 */
  readonly readPolicy: string
}

export const COPILLOT_MEMORY_SCOPE_PERMISSIONS: readonly CopilotMemoryScopePermission[] = [
  { scope: 'user', writePermission: 'self', readPolicy: '仅本人与组织审计权限可读' },
  { scope: 'project', writePermission: 'project_member', readPolicy: '项目成员可读' },
  { scope: 'organization', writePermission: 'organization_admin', readPolicy: '组织成员可读' },
] as const

/**
 * 将 copilot memory scope 映射到 CopilotScope（共享契约）。
 * 用于注入选取时复用既有的 scope→合格来源映射。
 */
export function copilotMemoryScopeToCopilotScope(memoryScope: CopilotMemoryScope): CopilotScope {
  const map: Record<CopilotMemoryScope, CopilotScope> = {
    user: 'project', // user memory 在 project scope 下注入
    project: 'project',
    organization: 'organization',
  }
  return map[memoryScope]
}

// ===========================================================================
// 2. 记忆状态枚举（§2.4）
// ===========================================================================

/**
 * 记忆生命周期五态。
 * 候选 → 已确认 → (已编辑) → 可能过期 → 已失效
 */
export const COPILLOT_MEMORY_STATUSES = [
  'candidate',
  'confirmed',
  'edited',
  'possibly_outdated',
  'invalidated',
] as const
export type CopilotMemoryStatus = (typeof COPILLOT_MEMORY_STATUSES)[number]

export function isCopilotMemoryStatus(v: string): v is CopilotMemoryStatus {
  return (COPILLOT_MEMORY_STATUSES as readonly string[]).includes(v)
}

export const COPILLOT_MEMORY_STATUS_LABELS: Record<CopilotMemoryStatus, string> = {
  candidate: '候选',
  confirmed: '已确认',
  edited: '已编辑',
  possibly_outdated: '可能过期',
  invalidated: '已失效',
}

// ===========================================================================
// 3. 时效档与陈旧阈值常量（§2.5）
// ===========================================================================

/**
 * 记忆时效档。
 * - ephemeral: 数小时内过期（偶发细节）
 * - short: 7 天
 * - medium: 30 天
 * - long: 90 天
 * - durable: 180 天（持久性约束，如团队规模、编制）
 */
export const COPILLOT_MEMORY_VALIDITY_TIERS = [
  'ephemeral',
  'short',
  'medium',
  'long',
  'durable',
] as const
export type CopilotMemoryValidityTier = (typeof COPILLOT_MEMORY_VALIDITY_TIERS)[number]

export function isCopilotMemoryValidityTier(v: string): v is CopilotMemoryValidityTier {
  return (COPILLOT_MEMORY_VALIDITY_TIERS as readonly string[]).includes(v)
}

/** 各时效档对应的陈旧阈值（毫秒）。 */
export const COPILLOT_MEMORY_STALENESS_THRESHOLDS: Record<CopilotMemoryValidityTier, number> = {
  ephemeral: 6 * 60 * 60 * 1000, // 6 hours
  short: 7 * 24 * 60 * 60 * 1000, // 7 days
  medium: 30 * 24 * 60 * 60 * 1000, // 30 days
  long: 90 * 24 * 60 * 60 * 1000, // 90 days
  durable: 180 * 24 * 60 * 60 * 1000, // 180 days
}

export const COPILLOT_MEMORY_VALIDITY_TIER_LABELS: Record<CopilotMemoryValidityTier, string> = {
  ephemeral: '临时',
  short: '短期',
  medium: '中期',
  long: '长期',
  durable: '持久',
}

// ===========================================================================
// 4. 置信度来源与派生（§4.8）
// ===========================================================================

/**
 * 置信度来源强度档（派生置信度，禁止模型自报）。
 * 由抽取依据强度决定，不由模型自由赋值。
 */
export const COPILLOT_MEMORY_CONFIDENCE_SOURCES = [
  'explicit_user_statement', // 用户明确表述
  'repeated_observation', // 多次观察一致
  'single_observation', // 单次观察
  'inferred_from_context', // 从上下文推断
] as const
export type CopilotMemoryConfidenceSource = (typeof COPILLOT_MEMORY_CONFIDENCE_SOURCES)[number]

export function isCopilotMemoryConfidenceSource(v: string): v is CopilotMemoryConfidenceSource {
  return (COPILLOT_MEMORY_CONFIDENCE_SOURCES as readonly string[]).includes(v)
}

/** 来源强度 → 置信度值映射（确定性）。 */
export const COPILLOT_MEMORY_CONFIDENCE_MAP: Record<CopilotMemoryConfidenceSource, number> = {
  explicit_user_statement: 0.95,
  repeated_observation: 0.85,
  single_observation: 0.7,
  inferred_from_context: 0.5,
}

/**
 * 由来源强度确定性派生置信度。
 * 禁止模型自报——置信度必须由此函数派生。
 */
export function deriveMemoryConfidence(source: CopilotMemoryConfidenceSource): number {
  return COPILLOT_MEMORY_CONFIDENCE_MAP[source]
}

// ===========================================================================
// 5. Basis 引用类型（§2.2）
// ===========================================================================

/**
 * 记忆来源引用：指向具体会话与消息。
 * 每条记忆必须可溯源到具体会话与消息。
 */
export interface CopilotMemoryBasisRef {
  /** 来源会话 ID（triz_assistant_runs.run_id）。 */
  readonly sessionId: string
  /** 来源消息 ID（triz_assistant_messages.message_id）。 */
  readonly messageId: string
  /** 来源内容摘要（≤256 字符，低敏）。 */
  readonly summary: string
  /** 消息角色。 */
  readonly role: 'user' | 'assistant'
}

// ===========================================================================
// 6. 记忆条目主类型（§2.1/§2.2）
// ===========================================================================

/**
 * 跨对话记忆条目。
 * 核心纪律：记忆恒为 inference，永不升格为 fact。
 */
export interface CopilotMemoryEntry {
  /** 稳定唯一 ID（确定性生成）。 */
  readonly id: string
  /** 组织 ID（组织隔离）。 */
  readonly organizationId: number
  /** 项目 ID（project scope 时必填）。 */
  readonly projectId?: number
  /** actor ID（user scope 时绑定）。 */
  readonly actorId: number
  /** 记忆作用域。 */
  readonly scope: CopilotMemoryScope
  /** 内容摘要（≤512 字符，不含凭据/敏感信息/全文）。 */
  readonly summary: string
  /** 标签（用于注入选取）。 */
  readonly tags: readonly string[]
  /** 置信度（0–1，由来源强度派生，禁止模型自报）。 */
  readonly confidence: number
  /** 置信度来源强度。 */
  readonly confidenceSource: CopilotMemoryConfidenceSource
  /** 来源引用（会话与消息溯源）。 */
  readonly basis: readonly CopilotMemoryBasisRef[]
  /** 观察时间（ISO 8601）。 */
  readonly observedAt: string
  /** 最后确认时间（ISO 8601；未确认则为空）。 */
  readonly lastConfirmedAt?: string
  /** 当前状态。 */
  readonly status: CopilotMemoryStatus
  /** 时效档。 */
  readonly validityTier: CopilotMemoryValidityTier
  /** 保留期截止时间（ISO 8601；可选，由清理作业消费）。 */
  readonly retentionExpiresAt?: string
  /** 创建时间。 */
  readonly createdAt: string
  /** 更新时间。 */
  readonly updatedAt: string
}

// ===========================================================================
// 7. 候选类型与每会话数量上界（§2.6）
// ===========================================================================

/** 每会话候选数量上界。 */
export const COPILLOT_MEMORY_CANDIDATE_BOUND_PER_SESSION = 5

/** 意图类 → 候选数量上界覆盖（可选）。 */
export const COPILLOT_MEMORY_CANDIDATE_BOUNDS_BY_INTENT: Readonly<Record<string, number>> =
  {} as const

/**
 * 抽取产生的候选条目。
 * 候选不静默写入——必须经用户可见 + 确认或忽略。
 */
export interface CopilotMemoryCandidate {
  /** 候选条目（尚未落库）。 */
  readonly entry: Omit<CopilotMemoryEntry, 'id' | 'createdAt' | 'updatedAt'>
  /** 抽取依据强度。 */
  readonly confidenceSource: CopilotMemoryConfidenceSource
  /** 排除原因（若被裁剪）。 */
  readonly omittedReason?: 'over_bound' | 'sanitizer_rejected' | 'low_value'
}

/**
 * 候选提取结果。
 */
export interface CopilotMemoryExtractionResult {
  /** 产生的候选列表。 */
  readonly candidates: readonly CopilotMemoryCandidate[]
  /** 总产生数量。 */
  readonly totalProduced: number
  /** 被裁剪数量（超过上界）。 */
  readonly omittedCount: number
  /** 被 sanitizer 拒绝数量。 */
  readonly sanitizerRejectedCount: number
  /** 来源会话 ID 列表。 */
  readonly sourceSessionIds: readonly string[]
  /** 提取是否确定性（始终为 true）。 */
  readonly deterministic: true
}

// ===========================================================================
// 8. 冲突裁决类型（§2.7）
// ===========================================================================

/**
 * 冲突裁决结果。
 */
export type CopilotMemoryConflictResolution =
  | { readonly outcome: 'live_fact_wins'; readonly memoryId: string; readonly reason: string }
  | {
      readonly outcome: 'memory_wins'
      readonly memoryId: string
      readonly basis: string
    }
  | {
      readonly outcome: 'no_conflict'
    }

/**
 * 记忆间冲突裁决输入。
 */
export interface CopilotMemoryConflictInput {
  /** 冲突的记忆条目 A。 */
  readonly entryA: CopilotMemoryEntry
  /** 冲突的记忆条目 B。 */
  readonly entryB: CopilotMemoryEntry
  /** 可选的实时项目事实值（提供时该事实优先）。 */
  readonly liveFactValue?: unknown
}

// ===========================================================================
// 9. 注入选取类型（§2.8）
// ===========================================================================

/**
 * 记忆切面名称（用于上下文包区分）。记忆切面必须与项目事实切面分开标注。
 */
export const COPILLOT_MEMORY_FACET_NAME = 'copilot_memory_inferred' as const

/**
 * 注入选取输入。
 */
export interface CopilotMemoryInjectionInput {
  readonly organizationId: number
  readonly actorId: number
  readonly scope: CopilotScope
  readonly projectId?: number
  /** 当前意图分类标签（用于相关性匹配）。 */
  readonly intentTags?: readonly string[]
  /** 上下文包字节预算中分配给记忆切面的最大字节数。 */
  readonly memoryBudgetBytes: number
}

/**
 * 注入选取输出。
 */
export interface CopilotMemoryInjectionOutput {
  /** 选中的记忆条目（按注入顺序）。 */
  readonly selected: readonly CopilotMemoryEntry[]
  /** 被截断的数量（超过预算）。 */
  readonly truncatedCount: number
  /** 久未确认标记的数量。 */
  readonly longUnconfirmedCount: number
  /** 记忆切面总字节数估算。 */
  readonly estimatedBytes: number
}

// ===========================================================================
// 10. 序列化约束：记忆恒为 inference（§2.9）
// ===========================================================================

/**
 * 上下文包中的记忆切面。
 * 必须显式标注为 inferred，与项目事实切面区分。
 */
export interface CopilotMemoryFacet {
  /** 切面名称（固定为 'copilot_memory_inferred'）。 */
  readonly facetName: typeof COPILLOT_MEMORY_FACET_NAME
  /** 切面类型标识（显式标注为 inferred）。 */
  readonly kind: 'inferred'
  /** 选中的记忆条目。 */
  readonly memories: readonly CopilotMemoryEntry[]
  /** 久未确认条目数量。 */
  readonly longUnconfirmedCount: number
  /** 被截断数量。 */
  readonly truncatedCount: number
}

/**
 * 判断一个对象是否为已验证事实切面（非记忆）。
 * 记忆切面永远不应该是此返回值。
 */
export function isVerifiedFactFacet(facet: { readonly kind?: string }): boolean {
  return facet.kind === 'verified_fact' || facet.kind === 'retrieval' || facet.kind === 'panorama'
}

/**
 * 校验记忆不得序列化为已验证事实。
 * 用于上下文包组装时的守卫。
 */
export function assertMemoryNotSerializedAsFact(
  facet: CopilotMemoryFacet | Record<string, unknown>,
): { ok: boolean; reason?: string } {
  const f = facet as CopilotMemoryFacet
  if (f.facetName !== COPILLOT_MEMORY_FACET_NAME) {
    return {
      ok: false,
      reason: `记忆切面名称必须为 ${COPILLOT_MEMORY_FACET_NAME}，实际为 ${String(f.facetName)}`,
    }
  }
  if (f.kind !== 'inferred') {
    return { ok: false, reason: `记忆切面 kind 必须为 inferred，实际为 ${String(f.kind)}` }
  }
  return { ok: true }
}

/**
 * 校验上下文包中不包含记忆被序列化为事实的情况。
 */
export function assertNoMemoryAsFact(
  facets: readonly { readonly facetName: string; readonly kind: string }[],
): { ok: boolean; reason?: string } {
  for (const f of facets) {
    if (f.facetName === COPILLOT_MEMORY_FACET_NAME && f.kind !== 'inferred') {
      return {
        ok: false,
        reason: `记忆切面 ${COPILLOT_MEMORY_FACET_NAME} 的 kind 必须为 inferred，实际为 ${f.kind}`,
      }
    }
  }
  return { ok: true }
}

// ===========================================================================
// 11. 禁止类别 Sanitizer（§2.11）
// ===========================================================================

/**
 * 禁止记忆的类别。
 */
export const COPILLOT_MEMORY_FORBIDDEN_CATEGORIES = [
  'credential',
  'personal_sensitive_info',
  'inaccessible_entity_content',
  'prompt_text',
  'model_output_full_text',
  'raw_external_payload',
] as const
export type CopilotMemoryForbiddenCategory = (typeof COPILLOT_MEMORY_FORBIDDEN_CATEGORIES)[number]

export function isCopilotMemoryForbiddenCategory(v: string): v is CopilotMemoryForbiddenCategory {
  return (COPILLOT_MEMORY_FORBIDDEN_CATEGORIES as readonly string[]).includes(v)
}

export const COPILLOT_MEMORY_FORBIDDEN_CATEGORY_LABELS: Record<
  CopilotMemoryForbiddenCategory,
  string
> = {
  credential: '凭据',
  personal_sensitive_info: '个人敏感信息',
  inaccessible_entity_content: '不可访问实体内容',
  prompt_text: 'Prompt 文本',
  model_output_full_text: '模型输出全文',
  raw_external_payload: '原始外部载荷',
}

/**
 * Sanitizer 检测模式（每类禁止内容的匹配规则）。
 */
export const COPILLOT_MEMORY_SANITIZER_PATTERNS: Readonly<
  Record<CopilotMemoryForbiddenCategory, readonly RegExp[]>
> = {
  credential: [
    /password\s*[:=]/i,
    /secret\s*[:=]/i,
    /token\s*[:=]/i,
    /api[_-]?key\s*[:=]/i,
    /authorization\s*[:=]/i,
    /bearer\s+/i,
    /sk-[a-zA-Z0-9]{20,}/,
  ],
  personal_sensitive_info: [
    /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/, // SSN-like
    /\b\d{18}\b/, // Chinese ID
    /\b\d{16}\b/, // credit card
    /\b\d{3}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/, // credit card with dashes
  ],
  inaccessible_entity_content: [], // 由运行时权限判定，不在模式匹配层
  prompt_text: [/^system\s*[:：]/i, /\b(?:instructions|system prompt|you are)\b.*[:：]/i],
  model_output_full_text: [/\b(?:as an ai|i cannot|i'm unable to|my training)\b/i],
  raw_external_payload: [/<html[\s>]/i, /<!doctype/i, /<\?xml/i, /\{"raw"\s*:/],
}

/**
 * 记忆内容 sanitize 结果。
 */
export interface CopilotMemorySanitizeResult {
  /** 是否通过（false = 含禁止内容）。 */
  readonly ok: boolean
  /** 命中的禁止类别（可多个）。 */
  readonly hitCategories: readonly CopilotMemoryForbiddenCategory[]
  /** 命中的具体描述（低敏）。 */
  readonly hitDescriptions: readonly string[]
}

/**
 * 检测记忆内容是否包含禁止类别。
 * 对每类禁止内容至少有一个检测规则。
 */
export function sanitizeMemoryContent(
  content: string,
  _accessibleEntityIds?: readonly string[],
): CopilotMemorySanitizeResult {
  const hitCategories: CopilotMemoryForbiddenCategory[] = []
  const hitDescriptions: string[] = []

  for (const category of COPILLOT_MEMORY_FORBIDDEN_CATEGORIES) {
    if (category === 'inaccessible_entity_content') {
      // 不可访问实体由运行时权限判定，此处跳过模式匹配
      continue
    }
    const patterns = COPILLOT_MEMORY_SANITIZER_PATTERNS[category]
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        hitCategories.push(category)
        hitDescriptions.push(
          `内容命中禁止类别「${COPILLOT_MEMORY_FORBIDDEN_CATEGORY_LABELS[category]}」`,
        )
        break // 每类只报一次
      }
    }
  }

  return {
    ok: hitCategories.length === 0,
    hitCategories,
    hitDescriptions,
  }
}

// ===========================================================================
// 12. 低敏审计字段集（§5.8）
// ===========================================================================

/**
 * 记忆生命周期审计事件类型。
 */
export const COPILLOT_MEMORY_AUDIT_ACTIONS = [
  'candidate_extracted',
  'candidate_confirmed',
  'candidate_ignored',
  'memory_edited',
  'memory_invalidated',
  'memory_deleted',
  'memory_injected',
  'write_attempted',
  'access_denied',
  'conflict_resolved',
] as const
export type CopilotMemoryAuditAction = (typeof COPILLOT_MEMORY_AUDIT_ACTIONS)[number]

export function isCopilotMemoryAuditAction(v: string): v is CopilotMemoryAuditAction {
  return (COPILLOT_MEMORY_AUDIT_ACTIONS as readonly string[]).includes(v)
}

/**
 * 低敏审计事件（不含记忆内容）。
 */
export interface CopilotMemoryAuditEvent {
  /** 审计事件类型。 */
  readonly action: CopilotMemoryAuditAction
  /** 操作者 ID。 */
  readonly actorId: number
  /** 组织 ID。 */
  readonly organizationId: number
  /** 记忆条目 ID。 */
  readonly entryId: string
  /** 记忆 scope。 */
  readonly scope: CopilotMemoryScope
  /** 时间戳。 */
  readonly timestamp: string
  /** 元数据（不含记忆内容摘要）。 */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>
}

// ===========================================================================
// 13. 导出类型（§5.10）
// ===========================================================================

/**
 * 低敏导出条目（脱敏后）。
 */
export interface CopilotMemoryExportEntry {
  readonly id: string
  readonly scope: CopilotMemoryScope
  readonly summary: string
  readonly tags: readonly string[]
  readonly confidence: number
  readonly status: CopilotMemoryStatus
  readonly validityTier: CopilotMemoryValidityTier
  readonly observedAt: string
  readonly lastConfirmedAt?: string
  readonly basisCount: number
}

/**
 * 导出结果（低敏结构化格式）。
 */
export interface CopilotMemoryExportResult {
  readonly entries: readonly CopilotMemoryExportEntry[]
  readonly totalCount: number
  readonly exportedAt: string
  readonly organizationId: number
}

// ===========================================================================
// 14. 确定性 Helpers
// ===========================================================================

/**
 * 稳定排序键：按 scope 优先级 + lastConfirmedAt + id。
 * scope 优先级：organization > project > user。
 */
/**
 * Scope 排序优先级（值越小优先级越高，organization > project > user）。
 */
const SCOPE_SORT_PRIORITY: Record<CopilotMemoryScope, number> = {
  organization: 0,
  project: 1,
  user: 2,
}

export function memoryStableSortKey(entry: CopilotMemoryEntry): string {
  const scopePri = SCOPE_SORT_PRIORITY[entry.scope] ?? 99
  const confirmed = entry.lastConfirmedAt ?? '1970-01-01T00:00:00.000Z'
  return `${scopePri}:${confirmed}:${entry.id}`
}

/**
 * 稳定排序记忆条目（scope 优先级 → lastConfirmedAt → id）。
 */
export function sortMemoryEntries(entries: readonly CopilotMemoryEntry[]): CopilotMemoryEntry[] {
  return [...entries].sort((a, b) => {
    const keyA = memoryStableSortKey(a)
    const keyB = memoryStableSortKey(b)
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
  })
}

/**
 * 判断记忆条目是否已过陈旧阈值。
 */
export function isMemoryStale(entry: CopilotMemoryEntry, nowMs?: number): boolean {
  const now = nowMs ?? Date.now()
  const threshold = COPILLOT_MEMORY_STALENESS_THRESHOLDS[entry.validityTier]
  const lastConfirmed = entry.lastConfirmedAt
    ? new Date(entry.lastConfirmedAt).getTime()
    : new Date(entry.observedAt).getTime()
  return now - lastConfirmed > threshold
}

/**
 * 判断记忆条目是否能驱动变更类动作。
 * 久未确认的记忆不得驱动变更类动作。
 */
export function canDriveMutationAction(entry: CopilotMemoryEntry, nowMs?: number): boolean {
  if (entry.status === 'invalidated') return false
  if (entry.status === 'possibly_outdated') return false
  if (isMemoryStale(entry, nowMs)) return false
  return true
}

/**
 * 估算记忆条目字节数（用于预算控制）。
 */
export function estimateMemoryEntryBytes(entry: CopilotMemoryEntry): number {
  const str = copilotStableSerialize(entry)
  return Buffer.byteLength(str, 'utf-8')
}

/**
 * 生成记忆条目 ID（确定性）。
 */
export function generateMemoryEntryId(
  organizationId: number,
  actorId: number,
  scope: CopilotMemoryScope,
  summary: string,
  observedAt: string,
): string {
  const payload = copilotStableSerialize({
    organizationId,
    actorId,
    scope,
    summary,
    observedAt,
  })
  // 简单稳定 hash（非加密，仅用于确定性 ID）
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `mem_${hex}`
}

/**
 * 记忆间冲突裁决：按 lastConfirmedAt 与 scope 优先级。
 */
export function resolveMemoryConflict(
  a: CopilotMemoryEntry,
  b: CopilotMemoryEntry,
): CopilotMemoryConflictResolution {
  // 1. lastConfirmedAt 优先（晚的赢）
  const confA = a.lastConfirmedAt ?? a.observedAt
  const confB = b.lastConfirmedAt ?? b.observedAt
  if (confA > confB) {
    return {
      outcome: 'memory_wins',
      memoryId: a.id,
      basis: `lastConfirmedAt 更晚 (${confA} > ${confB})`,
    }
  }
  if (confB > confA) {
    return {
      outcome: 'memory_wins',
      memoryId: b.id,
      basis: `lastConfirmedAt 更晚 (${confB} > ${confA})`,
    }
  }
  // 2. scope 优先级（organization > project > user）
  const scopePri: Record<CopilotMemoryScope, number> = { organization: 3, project: 2, user: 1 }
  const priA = scopePri[a.scope] ?? 0
  const priB = scopePri[b.scope] ?? 0
  if (priA > priB) {
    return {
      outcome: 'memory_wins',
      memoryId: a.id,
      basis: `scope 优先级更高 (${a.scope} > ${b.scope})`,
    }
  }
  if (priB > priA) {
    return {
      outcome: 'memory_wins',
      memoryId: b.id,
      basis: `scope 优先级更高 (${b.scope} > ${a.scope})`,
    }
  }
  // 3. id 作为最终稳定排序
  if (a.id < b.id) {
    return {
      outcome: 'memory_wins',
      memoryId: a.id,
      basis: 'id 字典序较小',
    }
  }
  return {
    outcome: 'memory_wins',
    memoryId: b.id,
    basis: 'id 字典序较小',
  }
}

// ===========================================================================
// 15. 保留期相关（§3.7 / §9.9 — 显式记录缺口）
// ===========================================================================

/**
 * 保留期清理入口点（仅声明接口，不实现调度作业）。
 * 调度作业归 v3-observability-data-retention，缺口须显式记录。
 */
export interface CopilotMemoryRetentionCleanupInput {
  readonly organizationId: number
  /** 清理截止时间（清理此时间之前过期的记忆）。 */
  readonly before: string
  /** 仅清理指定 scope（可选）。 */
  readonly scope?: CopilotMemoryScope
}

export interface CopilotMemoryRetentionCleanupResult {
  /** 被清理的条目数。 */
  readonly cleanedCount: number
  /** 剩余条目数。 */
  readonly remainingCount: number
}

// ===========================================================================
// 16. Barrel guard: 确保无命名冲突
// ===========================================================================

// 所有导出类型使用 Copilot / COPILOT / copilot 前缀 + Memory / MEMORY
// 语境，避免与 copilot-shared-contracts / copilot-context-assembly /
// copilot-action-boundary / copilot-intent-catalog 撞名。
