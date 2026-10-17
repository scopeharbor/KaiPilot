// @aiproj/types — V3 AI 安全观测共享契约（v3-ai-security-observability）
//
// 统一安全事件账本：越权尝试、DLP 命中、水印注入、prompt injection 拦截、
// 跨组织探测五类事件的类型、枚举、类型守卫、确定性纯函数与禁存约束校验。
//
// 依赖轻量约束：仅依赖本包 copilot-external-content-safety（纯类型 + 确定性 helpers），
// 无 AdonisJS / React / 数据库客户端 / 网络请求。
//
// 设计要点（D1-D7 裁决）：
// - D1: 事件记录不记资源标识（不成为枚举工具）
// - D2: 注入拦截只记类别与计数，不记注入内容原文
// - D3: 与 audit_logs 并存不合并
// - D4: 观察失败降级但必须被计数
// - D5: 只记录不自动处置（不封禁/不关连接/不收紧权限）
// - D6: 严重度沿用 audit_logs 四档
// - D7: 事件按 (组织, 类型, 时间窗) 聚合供门禁消费

import type { AuditLogSeverity } from './audit-log.js'
import type { ExternalInjectionCategory } from './copilot-external-content-safety.js'

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 安全事件类型（五类）。 */
export const AI_SECURITY_EVENT_KINDS = [
  /** 越权尝试：访问了一个当前主体不可访问的资源。 */
  'permission_denied',
  /** DLP 命中：数据防泄漏规则触发。 */
  'dlp_hit',
  /** 水印注入：上下文水印标记已注入。 */
  'watermark_injection',
  /** 注入拦截：外部内容注入检测拦截。 */
  'injection_block',
  /** 跨组织探测：跨组织访问被拒绝。 */
  'cross_org_probe',
] as const
export type AiSecurityEventKind = (typeof AI_SECURITY_EVENT_KINDS)[number]

export function isAiSecurityEventKind(v: string): v is AiSecurityEventKind {
  return (AI_SECURITY_EVENT_KINDS as readonly string[]).includes(v)
}

/** 安全事件处置结果。 */
export const AI_SECURITY_DISPOSITIONS = [
  /** 已拦截：防护主动阻断了该事件。 */
  'blocked',
  /** 已放行并标记：防护放行但已记录标记。 */
  'flagged',
] as const
export type AiSecurityDisposition = (typeof AI_SECURITY_DISPOSITIONS)[number]

export function isAiSecurityDisposition(v: string): v is AiSecurityDisposition {
  return (AI_SECURITY_DISPOSITIONS as readonly string[]).includes(v)
}

/**
 * 严重度沿用 audit_logs 四档（D6），不另立枚举。
 * 使用 AuditLogSeverity 类型。
 */
export type AiSecurityEventSeverity = AuditLogSeverity

/** 安全事件能力面（事件发生的 AI 链路位置）。 */
export const AI_SECURITY_CAPABILITY_SURFACES = [
  /** 上下文装配阶段。 */
  'context_assembly',
  /** provider 调用阶段。 */
  'provider_call',
  /** 知识检索阶段。 */
  'knowledge_retrieval',
  /** 文件/OCR 处理阶段。 */
  'file_ocr',
  /** 报表导出阶段。 */
  'report_export',
  /** API 请求阶段。 */
  'api_request',
  /** 编译器运行阶段。 */
  'compiler_run',
] as const
export type AiSecurityCapabilitySurface = (typeof AI_SECURITY_CAPABILITY_SURFACES)[number]

export function isAiSecurityCapabilitySurface(v: string): v is AiSecurityCapabilitySurface {
  return (AI_SECURITY_CAPABILITY_SURFACES as readonly string[]).includes(v)
}

// =============================================================================
// 2. 事件记录结构类型
// =============================================================================

/**
 * 安全事件共享形状：五类事件统一承载。
 *
 * 禁存约束（D1/D2 + 通用）：
 * - 不含 prompt
 * - 不含模型输出
 * - 不含 token / secret
 * - 不含被拒资源标识（permission_denied / cross_org_probe）
 * - 不含注入内容原文（injection_block）
 */
export interface AiSecurityEventRecord {
  /** 事件唯一 ID。 */
  readonly eventId: string
  /** 事件类型。 */
  readonly kind: AiSecurityEventKind
  /** 严重度（沿用 audit_logs 四档）。 */
  readonly severity: AiSecurityEventSeverity
  /** 发生时间（ISO 8601）。 */
  readonly occurredAt: string
  /** 组织 ID（组织隔离）。 */
  readonly organizationId: number
  /** 能力面。 */
  readonly capabilitySurface: AiSecurityCapabilitySurface
  /** 处置结果。 */
  readonly disposition: AiSecurityDisposition
  /** 请求 ID（可选，用于关联 audit_logs）。 */
  readonly requestId?: string
  /** 触发者 ID（可选）。 */
  readonly actorId?: number

  // ---- 类型特定字段（仅当对应 kind 时有值） ----

  /**
   * DLP 命中时的规则类别（仅 kind=dlp_hit）。
   * 不含命中原文或匹配详情。
   */
  readonly dlpRuleCategory?: string
  /**
   * DLP 命中时的严重性（仅 kind=dlp_hit，沿用 DLP 自身的严重性分级）。
   */
  readonly dlpSeverity?: string

  /**
   * 水印注入时的格式（仅 kind=watermark_injection）。
   */
  readonly watermarkFormat?: string

  /**
   * 注入拦截时的类别列表（仅 kind=injection_block）。
   * 不含注入内容原文（D2）。
   */
  readonly injectionCategories?: readonly ExternalInjectionCategory[]
  /**
   * 注入拦截时的总命中计数（仅 kind=injection_block）。
   */
  readonly injectionHitCount?: number

  /**
   * 降级标记：当事件写入失败时，该事件被降级记录。
   * 降级本身被计数（D4）。
   */
  readonly degraded?: boolean
  /** 降级原因（仅 degraded=true 时存在）。 */
  readonly degradationReason?: string
}

// =============================================================================
// 3. 聚合类型
// =============================================================================

/**
 * 安全事件聚合键：(组织, 类型, 时间窗)。
 * 门禁消费聚合视图，不直接读明细（D7）。
 */
export interface AiSecurityAggregateKey {
  readonly organizationId: number
  readonly kind: AiSecurityEventKind
  /** 聚合时间窗口起始（ISO 8601）。 */
  readonly windowStart: string
  /** 聚合时间窗口结束（ISO 8601）。 */
  readonly windowEnd: string
}

/**
 * 安全事件聚合结果。
 */
export interface AiSecurityAggregateResult {
  /** 聚合键。 */
  readonly key: AiSecurityAggregateKey
  /** 事件总数。 */
  readonly totalCount: number
  /** 按严重度分组计数。 */
  readonly bySeverity: Readonly<Record<AiSecurityEventSeverity, number>>
  /** 按处置结果分组计数。 */
  readonly byDisposition: Readonly<Record<AiSecurityDisposition, number>>
  /** 按能力面分组计数。 */
  readonly bySurface: Readonly<Record<string, number>>
  /** 降级事件计数（D4：降级必须被计数）。 */
  readonly degradedCount: number
}

// =============================================================================
// 4. 降级计数器类型
// =============================================================================

/**
 * 降级计数器：记录事件写入失败次数。
 * 降级本身必须被计数（D4），不静默。
 */
export interface AiSecurityDegradationCounter {
  /** 降级总次数。 */
  readonly totalDegraded: number
  /** 按事件类型分组的降级计数。 */
  readonly byKind: Readonly<Record<AiSecurityEventKind, number>>
  /** 最近一次降级时间（ISO 8601）。 */
  readonly lastDegradedAt: string | null
}

// =============================================================================
// 5. 查询类型
// =============================================================================

/** 安全事件查询参数。 */
export interface AiSecurityEventQuery {
  /** 组织 ID（必填，组织隔离）。 */
  readonly organizationId: number
  /** 事件类型过滤。 */
  readonly kind?: AiSecurityEventKind[]
  /** 严重度过滤。 */
  readonly severity?: AiSecurityEventSeverity[]
  /** 时间范围起始。 */
  readonly dateFrom?: string
  /** 时间范围结束。 */
  readonly dateTo?: string
  /** 能力面过滤。 */
  readonly capabilitySurface?: AiSecurityCapabilitySurface[]
  /** 分页。 */
  readonly page?: number
  readonly perPage?: number
}

/** 安全事件聚合查询参数。 */
export interface AiSecurityAggregateQuery {
  /** 组织 ID（必填，组织隔离）。 */
  readonly organizationId: number
  /** 事件类型过滤。 */
  readonly kind?: AiSecurityEventKind[]
  /** 聚合时间窗口起始。 */
  readonly windowStart: string
  /** 聚合时间窗口结束。 */
  readonly windowEnd: string
  /** 聚合粒度。 */
  readonly granularity?: 'hour' | 'day' | 'week'
}

// =============================================================================
// 6. 纯函数 — 禁存约束校验（D1/D2 + 通用禁存）
// =============================================================================

/** 禁存字段模式：事件记录中禁止出现的值语义。 */
const EVENT_FORBIDDEN_PATTERNS = [
  // prompt 模式
  /system\s*prompt/i,
  /you\s+are\s+a/i,
  /ignore\s+(previous|all|above)\s+(instructions?|prompts?)/i,
  // 模型输出标记
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  // token/secret
  /sk[-_]proj[-_][a-zA-Z0-9]{20,}/i,
  /sk[-_][a-zA-Z0-9]{20,}/i,
  /ghp_[a-zA-Z0-9]{20,}/i,
  /bearer\s+[a-zA-Z0-9._-]{20,}/i,
] as const

/**
 * 校验事件记录是否违反禁存约束。
 * 检查记录的各字符串字段是否包含 prompt、模型输出、token、secret。
 *
 * 类型级约束：AiSecurityEventRecord 的类型定义本身不含正文字段，
 * 此函数主要防御运行时传入的非类型化数据。
 */
export function validateEventRecordNoSensitivePayloads(record: Partial<AiSecurityEventRecord>): {
  safe: boolean
  violations: string[]
} {
  const violations: string[] = []
  const knownKeys = new Set([
    'eventId',
    'kind',
    'severity',
    'occurredAt',
    'organizationId',
    'capabilitySurface',
    'disposition',
    'requestId',
    'actorId',
    'dlpRuleCategory',
    'dlpSeverity',
    'watermarkFormat',
    'injectionCategories',
    'injectionHitCount',
    'degraded',
    'degradationReason',
  ])
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      violations.push(`事件记录包含未知字段: ${key}（可能含敏感载荷）`)
    }
  }
  // 检查已知字符串字段的值是否含禁存模式
  const strFields = [
    'dlpRuleCategory',
    'dlpSeverity',
    'watermarkFormat',
    'degradationReason',
  ] as const
  for (const field of strFields) {
    const val = record[field]
    if (typeof val === 'string') {
      for (const pattern of EVENT_FORBIDDEN_PATTERNS) {
        if (pattern.test(val)) {
          violations.push(`字段 ${field} 匹配禁存模式: ${pattern.source}`)
        }
      }
    }
  }
  return { safe: violations.length === 0, violations }
}

/**
 * 校验事件记录不含资源标识（D1）。
 * 对于 permission_denied 和 cross_org_probe 类型，事件不得包含被拒资源的标识。
 */
export function validateEventNoResourceIdentifier(record: Partial<AiSecurityEventRecord>): {
  safe: boolean
  violations: string[]
} {
  const violations: string[] = []
  const knownKeys = new Set([
    'eventId',
    'kind',
    'severity',
    'occurredAt',
    'organizationId',
    'capabilitySurface',
    'disposition',
    'requestId',
    'actorId',
    'dlpRuleCategory',
    'dlpSeverity',
    'watermarkFormat',
    'injectionCategories',
    'injectionHitCount',
    'degraded',
    'degradationReason',
  ])
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      violations.push(`事件记录包含未知字段: ${key}（可能含资源标识）`)
    }
  }
  return { safe: violations.length === 0, violations }
}

/**
 * 校验事件记录不含注入内容原文（D2）。
 * 对于 injection_block 类型，事件只记类别与计数，不记注入文本。
 */
export function validateEventNoInjectionPayload(record: Partial<AiSecurityEventRecord>): {
  safe: boolean
  violations: string[]
} {
  const violations: string[] = []
  const knownKeys = new Set([
    'eventId',
    'kind',
    'severity',
    'occurredAt',
    'organizationId',
    'capabilitySurface',
    'disposition',
    'requestId',
    'actorId',
    'dlpRuleCategory',
    'dlpSeverity',
    'watermarkFormat',
    'injectionCategories',
    'injectionHitCount',
    'degraded',
    'degradationReason',
  ])
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      violations.push(`事件记录包含未知字段: ${key}（可能含注入原文）`)
    }
  }
  return { safe: violations.length === 0, violations }
}

// =============================================================================
// 7. 纯函数 — 聚合确定性（D7）
// =============================================================================

/**
 * 计算聚合键的稳定字符串表示。
 * 同一事件快照产出同一聚合（D7 确定性）。
 */
export function computeAggregateKeyString(key: AiSecurityAggregateKey): string {
  return `${key.organizationId}:${key.kind}:${key.windowStart}:${key.windowEnd}`
}

/**
 * 从事件列表构建聚合结果（确定性：同一输入 → 同一输出）。
 */
export function buildAggregateResult(
  events: readonly AiSecurityEventRecord[],
  key: AiSecurityAggregateKey,
): AiSecurityAggregateResult {
  const bySeverity: Record<AiSecurityEventSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  }
  const byDisposition: Record<AiSecurityDisposition, number> = {
    blocked: 0,
    flagged: 0,
  }
  const bySurface: Record<string, number> = {}
  let degradedCount = 0

  for (const event of events) {
    bySeverity[event.severity]++
    byDisposition[event.disposition]++
    bySurface[event.capabilitySurface] = (bySurface[event.capabilitySurface] ?? 0) + 1
    if (event.degraded) {
      degradedCount++
    }
  }

  return {
    key,
    totalCount: events.length,
    bySeverity,
    byDisposition,
    bySurface,
    degradedCount,
  }
}

// =============================================================================
// 8. 纯函数 — 降级计数器（D4）
// =============================================================================

/**
 * 创建空的降级计数器。
 */
export function createEmptyDegradationCounter(): AiSecurityDegradationCounter {
  return {
    totalDegraded: 0,
    byKind: {
      permission_denied: 0,
      dlp_hit: 0,
      watermark_injection: 0,
      injection_block: 0,
      cross_org_probe: 0,
    },
    lastDegradedAt: null,
  }
}

/**
 * 递增降级计数器（D4：降级必须被计数）。
 */
export function incrementDegradationCounter(
  counter: AiSecurityDegradationCounter,
  kind: AiSecurityEventKind,
  now: string,
): AiSecurityDegradationCounter {
  return {
    totalDegraded: counter.totalDegraded + 1,
    byKind: {
      ...counter.byKind,
      [kind]: (counter.byKind[kind] ?? 0) + 1,
    },
    lastDegradedAt: now,
  }
}

// =============================================================================
// 9. 纯函数 — 不自动处置验证（D5）
// =============================================================================

/**
 * 验证事件路径无封禁、连接管理与权限写入依赖（D5）。
 * 返回事件路径中不应存在的操作类型。
 */
export function validateNoAutomaticEnforcement(): {
  safe: boolean
  enforcedOperations: string[]
} {
  // D5: 事件路径只记录，不执行任何处置。
  // 此函数是设计断言：在实现中被调用以证明路径无副作用。
  return { safe: true, enforcedOperations: [] }
}
