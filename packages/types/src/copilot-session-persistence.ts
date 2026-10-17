/**
 * v3-copilot-session-persistence —— Copilot 会话持久化共享契约。
 *
 * 消费 `copilot-shared-contracts` 已定义的 `CopilotSession` / `CopilotSessionStatus` /
 * `CopilotSessionAttribution` / `CopilotMessage` / `CopilotMessageRole`，不重定义。
 *
 * 设计要点：
 * - 形状继承 `triz_assistant_messages` 的有界低敏范式（content_summary VARCHAR(1024)）
 * - 禁存全文红线：prompt/system instructions/模型输出全文/chat 正文/tool 参数与结果/
 *   检索正文/原始载荷/token/secret/Authorization 一律禁止
 * - 摘要截断标记与上界常量
 * - 幂等键派生 helper
 * - 保留期字段与清理入口签名
 *
 * 依赖约束：纯类型 + 确定性纯函数，只依赖同包 `triz-contradiction.js` 的 `deterministicHash`
 * 和 `copilot-shared-contracts.js` 的共享类型。禁止依赖运行时/DB/HTTP/网络。
 */

import { deterministicHash } from './triz-contradiction.js'
import type {
  CopilotScope,
  CopilotSessionStatus,
  CopilotSessionAttribution,
  CopilotMessageRole,
  CopilotWarningCode,
  CopilotDegradedReason,
} from './copilot-shared-contracts.js'

// ===========================================================================
// 常量 — 摘要截断（§2.5）
// ===========================================================================

/** 摘要列字符上界（与 TRIZ 助手 content_summary 对齐）。 */
export const COPILLOT_SESSION_SUMMARY_MAX_LENGTH = 1024

/** 截断标记后缀。 */
export const COPILLOT_SESSION_TRUNCATION_SUFFIX = '…[已截断]'

/** 序号上限。 */
export const COPILLOT_SESSION_SEQUENCE_MAX = 10_000

// ===========================================================================
// 持久化 DTO — 会话（§2.1）
// ===========================================================================

/**
 * 会话持久化 DTO。
 * 消费 `CopilotSession` 的 scope/attribution/status，不重定义。
 */
export interface CopilotSessionPersistenceRecord {
  /** 数据库主键。 */
  readonly dbId: number
  /** 组织 ID（组织隔离必填）。 */
  readonly organizationId: number
  /** 会话 scope（继承共享契约）。 */
  readonly scope: CopilotScope
  /** 归属引用（继承共享契约）。 */
  readonly attribution: CopilotSessionAttribution
  /** 会话状态（继承共享契约）。 */
  readonly status: CopilotSessionStatus
  /** 会话标题（用户命名或确定性派生）。 */
  readonly title: string
  /** 是否已归档（软状态，不删历史）。 */
  readonly archived: boolean
  /** 创建者用户 ID。 */
  readonly actorId: number
  /** 稳定会话 ID（共享契约生成）。 */
  readonly sessionId: string
  /** 幂等键。 */
  readonly idempotencyKey: string
  /** 保留期 — 可用截止时间（null = 永久）。 */
  readonly retentionExpiresAt: Date | null
  /** 保留期 — 最后清理检查时间。 */
  readonly lastCleanupCheckAt: Date | null
  /** 创建时间。 */
  readonly createdAt: Date
  /** 更新时间。 */
  readonly updatedAt: Date
}

// ===========================================================================
// 持久化 DTO — 消息（§2.2）
// ===========================================================================

/**
 * 消息持久化 DTO。
 * 核心：有界低敏摘要 + source refs，禁止全文。
 */
export interface CopilotMessagePersistenceRecord {
  /** 数据库主键。 */
  readonly dbId: number
  /** 所属会话数据库 ID。 */
  readonly sessionDbId: number
  /** 稳定会话 ID。 */
  readonly sessionId: string
  /** 稳定消息 ID（共享契约生成，全局唯一）。 */
  readonly messageId: string
  /** 消息角色（继承共享契约 CHECK 约束）。 */
  readonly role: CopilotMessageRole
  /** 有界低敏摘要（长度受 schema 约束）。 */
  readonly contentSummary: string
  /** 摘要是否被截断。 */
  readonly truncated: boolean
  /** 来源引用 JSON 数组（完整存活，不截断）。 */
  readonly sourceRefs: readonly string[]
  /** 路由决策 ID 引用。 */
  readonly routeDecisionId: string | null
  /** 动作 ID 引用。 */
  readonly actionId: string | null
  /** 警告码 JSON 数组。 */
  readonly warningCodes: readonly CopilotWarningCode[]
  /** 降级原因。 */
  readonly degradedReason: CopilotDegradedReason | null
  /** 成本引用（指向统一账本 attempt，不存成本数值）。 */
  readonly costLedgerRef: string | null
  /** 序号（会话内单调递增）。 */
  readonly sequence: number
  /** 组织 ID（组织隔离冗余）。 */
  readonly organizationId: number
  /** 幂等键（派生自 input + sessionId + sourceHashes）。 */
  readonly idempotencyKey: string | null
  /** 创建时间。 */
  readonly createdAt: Date
}

// ===========================================================================
// 查询契约 — 会话列表（§2.3）
// ===========================================================================

export interface CopilotSessionListQuery {
  /** 组织 ID（必填，组织隔离）。 */
  readonly organizationId: number
  /** 创建者 ID（可选，actor 过滤）。 */
  readonly actorId?: number
  /** Scope 过滤。 */
  readonly scope?: CopilotScope
  /** 状态过滤。 */
  readonly status?: CopilotSessionStatus
  /** 是否包含已归档会话。 */
  readonly includeArchived?: boolean
  /** 分页 — 页码（从 1 开始）。 */
  readonly page?: number
  /** 分页 — 每页条数。 */
  readonly perPage?: number
  /** 排序字段。 */
  readonly sortField?: 'createdAt' | 'updatedAt'
  /** 排序方向。 */
  readonly sortOrder?: 'asc' | 'desc'
}

export interface CopilotSessionListResult<T> {
  readonly data: T[]
  readonly meta: {
    readonly total: number
    readonly page: number
    readonly perPage: number
    readonly totalPages: number
  }
}

// ===========================================================================
// 查询契约 — 消息分页（§5.1）
// ===========================================================================

export interface CopilotMessageListQuery {
  /** 会话 ID。 */
  readonly sessionId: string
  /** 组织 ID（组织隔离）。 */
  readonly organizationId: number
  /** 分页 — 页码（从 1 开始）。 */
  readonly page?: number
  /** 分页 — 每页条数。 */
  readonly perPage?: number
  /** 排序方向（默认 asc = 正序）。 */
  readonly sortOrder?: 'asc' | 'desc'
}

// ===========================================================================
// 导出契约（§2.4）
// ===========================================================================

/**
 * 会话导出载荷 — 低敏结构化格式。
 * 只包含 bounded low-sensitivity 字段，不含任何禁止内容。
 */
export interface CopilotSessionExportPayload {
  readonly sessionId: string
  readonly scope: CopilotScope
  readonly attribution: CopilotSessionAttribution
  readonly status: CopilotSessionStatus
  readonly title: string
  readonly archived: boolean
  readonly actorId: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly messages: readonly CopilotMessageExportEntry[]
}

export interface CopilotMessageExportEntry {
  readonly messageId: string
  readonly role: CopilotMessageRole
  readonly contentSummary: string
  readonly truncated: boolean
  readonly sourceRefs: readonly string[]
  readonly warningCodes: readonly CopilotWarningCode[]
  readonly degradedReason: CopilotDegradedReason | null
  readonly sequence: number
  readonly createdAt: string
}

// ===========================================================================
// 续接契约（§6）
// ===========================================================================

/**
 * 续接请求。
 */
export interface CopilotResumeRequest {
  readonly sessionId: string
  readonly organizationId: number
  /** 最后可见的消息序号。 */
  readonly lastSequence: number
  /** SSE 事件 ID（来自进度游标）。 */
  readonly lastSseEventId?: string
  /** 进度游标（来自前端 sessionStorage）。 */
  readonly progressCursor?: {
    readonly lastSequence: number
    readonly contractVersion: number
  }
}

/**
 * 续接结果。
 */
export interface CopilotResumeResult {
  /** 是否可以续接。 */
  readonly resumable: boolean
  /** 续接原因（不可续接时）。 */
  readonly reason?: string
  /** 续接的消息序号起点。 */
  readonly resumeFromSequence: number
  /** 已缓存的消息摘要（供前端恢复上下文）。 */
  readonly cachedMessages: readonly CopilotMessageExportEntry[]
}

// ===========================================================================
// 清理入口签名（§2.7 — 本 change 不实现清理作业）
// ===========================================================================

export interface CopilotSessionCleanupEntry {
  /** 组织 ID。 */
  readonly organizationId: number
  /** 清理截止时间。 */
  readonly before: Date
  /** 最大清理条数。 */
  readonly limit?: number
}

export interface CopilotSessionCleanupResult {
  /** 清理的会话数。 */
  readonly sessionsCleaned: number
  /** 清理的消息数。 */
  readonly messagesCleaned: number
}

// ===========================================================================
// Helpers — 幂等键派生（§2.6）
// ===========================================================================

/**
 * 派生幂等键：归一化消息输入 + 会话 ID + source hash。
 * 保证同一输入重复提交返回既有记录。
 */
export function deriveCopilotSessionIdempotencyKey(params: {
  readonly normalizedInput: string
  readonly sessionId: string
  readonly sourceHashes: readonly string[]
}): string {
  const sortedHashes = [...params.sourceHashes].sort()
  const payload = `${params.sessionId}|${params.normalizedInput}|${sortedHashes.join(',')}`
  return deterministicHash(payload)
}

// ===========================================================================
// Helpers — 摘要截断（§2.5）
// ===========================================================================

/**
 * 截断摘要并设置标记。
 * 返回截断后的摘要文本和是否发生了截断。
 */
export function truncateCopilotSummary(summary: string): {
  readonly text: string
  readonly truncated: boolean
} {
  if (summary.length <= COPILLOT_SESSION_SUMMARY_MAX_LENGTH) {
    return { text: summary, truncated: false }
  }
  const maxContent = COPILLOT_SESSION_SUMMARY_MAX_LENGTH - COPILLOT_SESSION_TRUNCATION_SUFFIX.length
  return {
    text: summary.slice(0, maxContent) + COPILLOT_SESSION_TRUNCATION_SUFFIX,
    truncated: true,
  }
}

// ===========================================================================
// Helpers — 确定性标题派生（§4.2）
// ===========================================================================

/**
 * 从首条用户消息摘要确定性派生会话标题。
 * 不调模型，保证同输入同标题。
 */
export function deriveCopilotSessionTitle(firstUserMessageSummary: string): string {
  // 取前 50 个字符作为标题基础
  const MAX_TITLE_LENGTH = 50
  const trimmed = firstUserMessageSummary.trim()
  if (trimmed.length === 0) return '新会话'
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed
  return trimmed.slice(0, MAX_TITLE_LENGTH - 1) + '…'
}

// ===========================================================================
// Helpers — 禁存全文 sanitizer（§2.8）
// ===========================================================================

/** 禁止存储的内容类别。 */
export const COPILLOT_FORBIDDEN_CONTENT_CATEGORIES = [
  'prompt',
  'systemInstructions',
  'modelOutput',
  'chatBody',
  'toolArguments',
  'toolResults',
  'retrievalBody',
  'rawPayload',
  'token',
  'secret',
  'authorization',
] as const

export type CopilotForbiddenContentCategory = (typeof COPILLOT_FORBIDDEN_CONTENT_CATEGORIES)[number]

/**
 * 检查值是否包含禁止存储的内容。
 * 返回是否安全以及命中的类别列表。
 */
export function sanitizeCopilotContentForPersistence(value: unknown): {
  readonly safe: boolean
  readonly rejectedCategories: CopilotForbiddenContentCategory[]
} {
  if (value === null || value === undefined) {
    return { safe: true, rejectedCategories: [] }
  }

  const rejected: CopilotForbiddenContentCategory[] = []

  if (typeof value === 'string') {
    // 检查字符串值中的敏感模式
    if (/^(sk-|pk-|bearer\s)/i.test(value)) {
      rejected.push('token')
    }
    if (/Authorization:\s*(Bearer|Basic|Token)\s+/i.test(value)) {
      rejected.push('authorization')
    }
    return { safe: rejected.length === 0, rejectedCategories: rejected }
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const [key, val] of Object.entries(obj)) {
      const normalizedKey = key.toLowerCase()
      if (/prompt|systeminstruction|systemprompt/.test(normalizedKey)) {
        rejected.push('prompt')
      } else if (/modeloutput|completion(?!count)/.test(normalizedKey)) {
        rejected.push('modelOutput')
      } else if (/^messages$/i.test(normalizedKey)) {
        rejected.push('chatBody')
      } else if (/toolargument|toolparam/.test(normalizedKey)) {
        rejected.push('toolArguments')
      } else if (/toolresult/.test(normalizedKey)) {
        rejected.push('toolResults')
      } else if (/retrievalbod|evidencebod/.test(normalizedKey)) {
        rejected.push('retrievalBody')
      } else if (/rawpayload|rawbody|rawevidence/.test(normalizedKey)) {
        rejected.push('rawPayload')
      } else if (/secret/i.test(normalizedKey)) {
        rejected.push('secret')
      } else if (/^(token|tokens)$/i.test(normalizedKey)) {
        rejected.push('token')
      } else if (/authorization|authheader|apikey/i.test(normalizedKey)) {
        rejected.push('authorization')
      }
      // 递归检查嵌套对象中的值
      if (typeof val === 'string' && val.length > 0) {
        const valResult = sanitizeCopilotContentForPersistence(val)
        for (const cat of valResult.rejectedCategories) {
          if (!rejected.includes(cat)) rejected.push(cat)
        }
      }
    }
  }

  return { safe: rejected.length === 0, rejectedCategories: rejected }
}

// ===========================================================================
// Helpers — 导出脱敏（§7.3）
// ===========================================================================

/**
 * 对会话导出载荷执行脱敏验证。
 * 确保禁止内容不出现在导出中。
 */
export function validateCopilotSessionExport(payload: CopilotSessionExportPayload): {
  readonly valid: boolean
  readonly violations: string[]
} {
  const violations: string[] = []

  // 检查 messages 中的 contentSummary
  for (const msg of payload.messages) {
    const result = sanitizeCopilotContentForPersistence(msg.contentSummary)
    if (!result.safe) {
      violations.push(
        `Message ${msg.messageId}: forbidden categories [${result.rejectedCategories.join(', ')}]`,
      )
    }
    // 检查 sourceRefs 中是否有敏感路径
    for (const ref of msg.sourceRefs) {
      if (/^(sk-|pk-|bearer\s|Authorization:)/i.test(ref)) {
        violations.push(`Message ${msg.messageId}: sourceRef contains sensitive content`)
      }
    }
  }

  return { valid: violations.length === 0, violations }
}
