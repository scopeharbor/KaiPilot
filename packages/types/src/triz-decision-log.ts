/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志共享契约（前后端共享）。
 *
 * 定义 TRIZ 决策日志结构化类型，覆盖决策对象 ref、决策类型/状态、低敏理由、
 * source attribution refs、artifact hashes、追加式修订与 API DTO。
 *
 * 红线：
 * - 决策日志只存低敏摘要、hash、refs，不存完整 prompt/输出/证据
 * - 所有 ref 必须包含 kind/id/version/visibility，保证可追溯与权限隔离
 * - 历史更正通过 supersedes 指向旧记录，禁止原地修改
 */

// ---------------------------------------------------------------------------
// 枚举常量
// ---------------------------------------------------------------------------

/** TRIZ 决策类型 */
export const TRIZ_DECISION_TYPES = [
  'adopt', // 采纳
  'reject', // 驳回
  'partial_accept', // 部分采纳
  'modified_accept', // 修改后采纳
  'clarification_requested', // 请求补充说明
  'supersede', // 废止/替换旧决策
] as const

export type TrizDecisionType = (typeof TRIZ_DECISION_TYPES)[number]

/** TRIZ 决策状态 */
export const TRIZ_DECISION_STATUSES = [
  'active', // 生效中（当前有效）
  'superseded', // 已被新决策废止
  'archived', // 归档（不再关联查询）
] as const

export type TrizDecisionStatus = (typeof TRIZ_DECISION_STATUSES)[number]

/** 决策主题来源种类 */
export const TRIZ_DECISION_SOURCE_KINDS = [
  'contradiction', // TRIZ 矛盾
  'analysis_artifact', // TRIZ Compiler 分析 artifact
  'resolution_path', // 解决路径
  'draft_item', // Draft 变更项
  'source_attribution', // 来源归属
  'traceability_link', // 可追溯链路
  'formal_entity', // 正式实体字段
] as const

export type TrizDecisionSourceKind = (typeof TRIZ_DECISION_SOURCE_KINDS)[number]

/** 摘要级别 */
export const TRIZ_SUMMARY_LEVELS = ['low', 'medium', 'high'] as const

export type TrizSummaryLevel = (typeof TRIZ_SUMMARY_LEVELS)[number]

/** 可见性级别 */
export const TRIZ_DECISION_VISIBILITY = [
  'public', // 项目成员可见
  'restricted', // 仅决策日志管理权限可见
  'internal', // 仅系统内部（审计）
] as const

export type TrizDecisionVisibility = (typeof TRIZ_DECISION_VISIBILITY)[number]

/** 校验 warning codes */
export const TRIZ_DECISION_WARNING_CODES = [
  'TRIZ_DECISION_MISSING_SOURCE_REFS', // 缺乏来源 refs
  'TRIZ_DECISION_STALE_HASH', // artifact hash 过期
  'TRIZ_DECISION_UNAUTHORIZED_REF', // 无权限的 ref 目标
  'TRIZ_DECISION_CROSS_ORG_REF', // 跨组织 ref
  'TRIZ_DECISION_REASON_TRUNCATED', // 理由被截断
  'TRIZ_DECISION_AI_FALLBACK', // AI 理由草稿降级
  'TRIZ_DECISION_HALLUCINATION_WARNING', // 反幻觉校验警告
] as const

export type TrizDecisionWarningCode = (typeof TRIZ_DECISION_WARNING_CODES)[number]

// ---------------------------------------------------------------------------
// 核心类型
// ---------------------------------------------------------------------------

/** 决策主题 ref —— 指向一个决策对象 */
export interface TrizDecisionSubjectRef {
  /** ref 种类（contradiction / analysis_artifact / resolution_path / draft_item / source_attribution / traceability_link / formal_entity） */
  kind: TrizDecisionSourceKind
  /** 目标的 stable ID 或 ref */
  id: string
  /** 版本或 hash（保证可追溯） */
  version: string
  /** 摘要级别 */
  summaryLevel: TrizSummaryLevel
  /** 可见性（用于权限脱敏） */
  visibility: TrizDecisionVisibility
  /** 可读标题（低敏，用于展示） */
  title?: string | null
}

/** 来源 ref —— 决策依据指向 */
export interface TrizDecisionSourceRef {
  /** 来源种类 */
  kind: string
  /** 来源 ID */
  id: string
  /** 版本或 hash */
  hash: string
  /** 可读摘要 */
  summary?: string | null
}

/** Artifact hash 快照 */
export interface TrizDecisionArtifactHash {
  /** 用途标签（如 input / output / evidence） */
  label: string
  /** 稳定 hash */
  hash: string
  /** 算法（默认 sha256） */
  algorithm?: string
}

/** 决策 warning */
export interface TrizDecisionWarning {
  code: TrizDecisionWarningCode
  message: string
  details?: string[]
}

/** AI 成本摘要（仅用于 AI 辅助理由草稿，非决策日志持久化字段） */
export interface TrizDecisionAiCostSummary {
  provider: string | null
  model: string | null
  tokens: number
  cost: number | null
  latencyMs: number | null
  budgetDecision: string
  fallback: boolean
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 决策日志条目 DTO（响应体） */
export interface TrizDecisionLogEntry {
  id: number
  organizationId: number
  projectId: number

  /** 决策类型 */
  decisionType: TrizDecisionType
  /** 决策状态 */
  decisionStatus: TrizDecisionStatus

  /** 决策主题 refs（至少一个） */
  subjectRefs: TrizDecisionSubjectRef[]
  /** 来源 refs（adopt/partial/modified 决策必需） */
  sourceRefs: TrizDecisionSourceRef[]
  /** Artifact hash 快照 */
  artifactHashes: TrizDecisionArtifactHash[]

  /** 低敏理由摘要 */
  reasonSummary: string
  /** 理由 hash（用于校验） */
  reasonHash: string
  /** 可选备选项摘要 */
  alternativeSummary: string | null

  /** 前置决策日志 ID（追加式修订用） */
  supersedesDecisionLogId: number | null
  /** 后续决策日志 ID（被当前记录废止的日志列表） */
  supersededByDecisionLogId: number | null

  /** 决策人 */
  createdBy: number
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间（补充理由等） */
  updatedAt: string | null
}

/** 创建决策日志请求 */
export interface TrizDecisionLogCreateRequest {
  decisionType: TrizDecisionType
  subjectRefs: TrizDecisionSubjectRef[]
  sourceRefs: TrizDecisionSourceRef[]
  artifactHashes: TrizDecisionArtifactHash[]
  reasonSummary: string
  alternativeSummary?: string | null
}

/** 废止决策日志请求 */
export interface TrizDecisionLogSupersedeRequest {
  decisionType: TrizDecisionType
  subjectRefs: TrizDecisionSubjectRef[]
  sourceRefs: TrizDecisionSourceRef[]
  artifactHashes: TrizDecisionArtifactHash[]
  reasonSummary: string
  alternativeSummary?: string | null
}

/** 决策日志列表响应 */
export interface TrizDecisionLogListResponse {
  data: TrizDecisionLogEntry[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 决策日志详情响应 */
export interface TrizDecisionLogDetailResponse {
  data: TrizDecisionLogEntry
}

/** 创建决策日志响应 */
export interface TrizDecisionLogCreateResponse {
  data: TrizDecisionLogEntry
}

/** 主题查询请求 */
export interface TrizDecisionSubjectLookupRequest {
  kind: TrizDecisionSourceKind
  id: string
  version?: string | null
}

/** 主题查询响应 */
export interface TrizDecisionSubjectLookupResponse {
  data: TrizDecisionLogEntry[]
  meta: { total: number }
}

/** AI 理由草稿请求 */
export interface TrizDecisionAiDraftRequest {
  subjectRefs: TrizDecisionSubjectRef[]
  sourceRefs: TrizDecisionSourceRef[]
  decisionType: TrizDecisionType
}

/** AI 理由草稿响应 */
export interface TrizDecisionAiDraftResponse {
  data: {
    draftReason: string
    warnings: TrizDecisionWarning[]
    costSummary: TrizDecisionAiCostSummary | null
    isFallback: boolean
  }
}

/** Dashboard 决策日志摘要 */
export interface TrizDecisionDashboardSummary {
  pendingDecisionCount: number
  missingReasonCount: number
  recentKeyDecisions: TrizDecisionLogEntry[]
  staleRefCount: number
}

/** Timeline 事件（低敏） */
export interface TrizDecisionTimelineEvent {
  id: number
  decisionType: TrizDecisionType
  reasonSummary: string
  createdBy: number
  createdAt: string
  /** 目标 ref 摘要（无权限时隐藏） */
  subjectSummary: string | null
  /** 是否有权限查看详情 */
  hasAccess: boolean
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 生成稳定决策日志条目 hash。
 * 基于 subjectRefs + sourceRefs + reasonSummary 的决定性 hash。
 */
export function computeTrizDecisionHash(
  subjectRefs: TrizDecisionSubjectRef[],
  sourceRefs: TrizDecisionSourceRef[],
  reasonSummary: string,
): string {
  const input = [
    subjectRefs
      .map((r) => `${r.kind}:${r.id}:${r.version}`)
      .sort()
      .join('|'),
    sourceRefs
      .map((r) => `${r.kind}:${r.id}:${r.hash}`)
      .sort()
      .join('|'),
    reasonSummary.trim().toLowerCase(),
  ].join('::')

  // 简单确定性 hash（Fowler-Noll-Vo-1a 64-bit 简化版）
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 低敏理由脱敏：替换疑似 token/密钥/路径。
 */
export function sanitizeReasonText(text: string): string {
  return (
    text
      // 替换疑似 API key / token（32+ 位 base64 / hex）
      .replace(/[A-Za-z0-9+/=]{32,}/g, '[REDACTED_TOKEN]')
      // 替换文件路径
      .replace(/(?:\/[a-zA-Z0-9_\-./]+)+/g, '[REDACTED_PATH]')
      // 替换 Authorization header-like 内容
      .replace(/(?:bearer|token|auth)\s+[A-Za-z0-9\-_.+/=]{8,}/gi, '$1 [REDACTED]')
  )
}

/**
 * 判断决策类型是否需要来源 refs。
 */
export function requiresSourceRefs(decisionType: TrizDecisionType): boolean {
  return (
    decisionType === 'adopt' ||
    decisionType === 'partial_accept' ||
    decisionType === 'modified_accept'
  )
}

/**
 * 判断决策类型是否为"最终"（不会再产生后续操作）。
 */
export function isTerminalDecision(decisionType: TrizDecisionType): boolean {
  return decisionType === 'reject' || decisionType === 'adopt' || decisionType === 'supersede'
}
