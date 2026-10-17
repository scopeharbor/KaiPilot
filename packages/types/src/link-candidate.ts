/**
 * v2-5-code-repository-auto-linking —— Repository reference link candidate 共享契约。
 *
 * 定义版本化 RepositoryReferenceEvent、candidate evidence/status、
 * list/detail 与 confirm/ignore 请求响应契约，限制为低敏 GitHub 字段。
 *
 * 设计 D1:
 * - RepositoryReferenceEvent 是从已验签低敏事件 envelope 到候选检测的输入契约
 * - 即使 incoming foundation 尚未实现，本类型定义 fixture 即可独立验证
 * - 所有 payload 字段均为低敏，不含 token、private comment、commit body 或完整 webhook payload
 */

// ---------------------------------------------------------------------------
// RepositoryReferenceEvent —— 入站事件的低敏规范化输入
// ---------------------------------------------------------------------------

/** 代码仓库事件类型（GitHub 首期） */
export const REPOSITORY_EVENT_TYPES = ['branch', 'push', 'pull_request'] as const
export type RepositoryEventType = (typeof REPOSITORY_EVENT_TYPES)[number]

/** 入站事件提供的低敏字段（来源字段 → 提取目标） */
export interface RepositoryReferenceEvent {
  /** 事件版本号，用于向后兼容 */
  eventVersion: number
  /** provider 名称 */
  provider: 'github'
  /** 事件类型 */
  eventType: RepositoryEventType
  /** 组织 ID（从 incoming foundation 组织归属校验获得） */
  organizationId: number
  /** 外部仓库全名（owner/repo） */
  repositoryFullName: string
  /** 仓库外部 ID（GitHub node_id），低敏 */
  repositoryExternalId: string
  /** 事件 delivery ID（来自 provider 或计算幂等键） */
  deliveryId: string
  /** 事件时间戳 ISO */
  eventTimestamp: string
  /** ---------- 以下为允许的低敏字段，按事件类型可选填充 ---------- */
  /** 分支 ref（branch/push 事件） */
  branchRef?: string
  /** commit SHA（push 事件） */
  commitSha?: string
  /** commit message 前 256 字符（低敏摘要） */
  commitMessagePreview?: string
  /** PR/MR 编号（pull_request 事件） */
  pullRequestNumber?: number
  /** PR/MR 标题 */
  pullRequestTitle?: string
  /** PR/MR 描述前 512 字符（低敏摘要） */
  pullRequestBodyPreview?: string
  /** PR/MR 来源分支 */
  pullRequestHeadRef?: string
  /** PR/MR 目标分支 */
  pullRequestBaseRef?: string
}

// ---------------------------------------------------------------------------
// 提取结果 / 证据
// ---------------------------------------------------------------------------

/** 规则版本（用于解释和追溯） */
export const CURRENT_RULE_VERSION = 1

/** 任务引用来源字段 */
export const REFERENCE_SOURCE_FIELDS = [
  'branchRef',
  'commitMessagePreview',
  'pullRequestTitle',
  'pullRequestBodyPreview',
] as const
export type ReferenceSourceField = (typeof REFERENCE_SOURCE_FIELDS)[number]

/** 单条匹配证据（低敏，不含完整 payload） */
export interface ReferenceEvidence {
  /** 来源字段名 */
  sourceField: ReferenceSourceField
  /** 脱敏的匹配片段（最多 120 字符） */
  matchedPreview: string
  /** 原始字符串中的匹配位置 */
  matchStart: number
  matchEnd: number
  /** 规则的版本 */
  ruleVersion: number
}

/** 提取结果 */
export interface ExtractionResult {
  /** 提取到的规范化任务引用（task key） */
  normalizedReference: string
  /** 匹配证据列表 */
  evidences: ReferenceEvidence[]
  /** 去重后的引用数 */
  uniqueReferenceCount: number
}

// ---------------------------------------------------------------------------
// 候选生命周期
// ---------------------------------------------------------------------------

export const CANDIDATE_STATUSES = [
  'pending', // 待审查
  'confirmed', // 已确认 → 转正式外链
  'ignored', // 用户忽略
  'expired', // TTL 过期
  'rejected', // 确认事务失败（如链接已存在/权限变化）
] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

export const CANDIDATE_CONFIDENCE_CLASSES = ['high', 'medium', 'low'] as const
export type CandidateConfidenceClass = (typeof CANDIDATE_CONFIDENCE_CLASSES)[number]

export const DEFAULT_CANDIDATE_TTL_HOURS = 72

// ---------------------------------------------------------------------------
// DTO：候选展示
// ---------------------------------------------------------------------------

/** 低敏候选证据 DTO */
export interface CandidateEvidenceDto {
  sourceField: ReferenceSourceField
  matchedPreview: string
  ruleVersion: number
}

/** 候选 DTO（返回前端） */
export interface LinkCandidateDto {
  id: number
  organizationId: number
  provider: 'github'
  repositoryFullName: string
  repositoryExternalId: string
  eventType: RepositoryEventType
  deliveryId: string
  objectType: 'branch' | 'commit' | 'pull_request'
  objectId: string
  /** 规范化任务引用 */
  taskReference: string
  /** 目标任务 ID（非空时表示已匹配到具体任务） */
  taskId: number | null
  /** 目标任务标题（仅对有权限用户可见） */
  taskTitle: string | null
  /** 低敏证据（不含完整 payload） */
  evidences: CandidateEvidenceDto[]
  confidenceClass: CandidateConfidenceClass
  status: CandidateStatus
  /** 生成时间 */
  createdAt: string
  /** 过期时间 */
  expiresAt: string
  /** 确认/忽略时间 */
  settledAt: string | null
  /** 确认/忽略 actor */
  settledBy: number | null
}

// ---------------------------------------------------------------------------
// Request / Response payloads
// ---------------------------------------------------------------------------

export interface ListCandidatesQuery {
  taskId?: number
  status?: CandidateStatus
  page?: number
  perPage?: number
}

export interface ListCandidatesResponse {
  data: LinkCandidateDto[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface ConfirmCandidateRequest {
  /** 可选的备注（仅审计记录） */
  note?: string
}

export interface IgnoreCandidateRequest {
  /** 可选的忽略原因（仅审计记录） */
  reason?: string
}

export interface CandidateActionResponse {
  id: number
  status: CandidateStatus
  /** 确认后创建的外部链接 ID（仅 confirmed 时有） */
  externalLinkId?: number
  message: string
}

// ---------------------------------------------------------------------------
// 候选审计元数据（低敏）
// ---------------------------------------------------------------------------

export interface CandidateAuditMeta {
  candidateId: number
  provider: 'github'
  repositoryFullName: string
  eventType: RepositoryEventType
  taskReference: string
  taskId: number | null
  previousStatus: CandidateStatus
  newStatus: CandidateStatus
}

// ---------------------------------------------------------------------------
// 候选事件
// ---------------------------------------------------------------------------

export interface CandidateCreatedEvent {
  candidateId: number
  organizationId: number
  provider: 'github'
  repositoryFullName: string
  taskReference: string
  taskId: number | null
  confidenceClass: CandidateConfidenceClass
  status: CandidateStatus
  createdAt: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isValidRepositoryEventType(v: string): v is RepositoryEventType {
  return REPOSITORY_EVENT_TYPES.includes(v as RepositoryEventType)
}

export function isValidCandidateStatus(v: string): v is CandidateStatus {
  return CANDIDATE_STATUSES.includes(v as CandidateStatus)
}

export function isValidCandidateConfidenceClass(v: string): v is CandidateConfidenceClass {
  return CANDIDATE_CONFIDENCE_CLASSES.includes(v as CandidateConfidenceClass)
}

export function isValidReferenceSourceField(v: string): v is ReferenceSourceField {
  return REFERENCE_SOURCE_FIELDS.includes(v as ReferenceSourceField)
}

export function isValidProviderForCandidate(v: string): v is 'github' {
  return v === 'github'
}
