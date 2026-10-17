// @aiproj/types — V3 Copilot 引用与出处契约
// v3-copilot-citations — 外部结论必须可点击引用，内部/外部来源结构可区分
//
// 依赖轻量约束：纯类型 + 确定性纯函数，仅依赖本包 triz-contradiction.js
// 的 deterministicHash（同为纯 TS 零依赖）。禁止依赖 AdonisJS、React、
// 数据库客户端、HTTP 客户端、外部网络、容器、provider 凭证或真实模型 SDK。

import { deterministicHash } from './triz-contradiction.js'

// ===========================================================================
// 枚举 — 来源溯源类型
// ===========================================================================

export const COPILOT_SOURCE_PROVENANCE_TYPES = ['internal', 'external'] as const
export type CopilotSourceProvenance = (typeof COPILOT_SOURCE_PROVENANCE_TYPES)[number]

// ===========================================================================
// 枚举 — 需要引用的外部来源类型
// ===========================================================================

export const COPILOT_EXTERNAL_SOURCE_KINDS = [
  'external_content',
  'search_result',
  'help_article',
  'general_knowledge',
] as const
export type CopilotExternalSourceKind = (typeof COPILOT_EXTERNAL_SOURCE_KINDS)[number]

// ===========================================================================
// 接口 — 引用记录
// ===========================================================================

/** 引用记录 - 表示一个被引用的外部来源。 */
export interface CopilotCitation {
  readonly citationId: string
  readonly url: string
  readonly title: string
  /** ISO 8601 抓取时间。 */
  readonly fetchedAt: string
  /** 用于漂移检测的哈希（不展示给用户）。 */
  readonly snapshotHash: string
  /** 该引用支持的结论 ID 列表。 */
  readonly supportedConclusionIds: readonly string[]
}

/** 带漂移状态的引用（用于渲染）。 */
export interface CopilotCitationRender {
  readonly citation: CopilotCitation
  /** 1-based 脚注编号。 */
  readonly footNoteIndex: number
  /** 当前页面与快照不同时为 true。 */
  readonly isDrifted: boolean
}

/** 来源类型标签 - 始终存在，不可关闭。 */
export interface CopilotSourceTypeLabel {
  readonly provenance: CopilotSourceProvenance
  /** 显示文本，如 "外部来源" / "项目数据"。 */
  readonly label: string
  /** 结构性标签，始终为 true。 */
  readonly nonDismissible: true
}

/** 外部检索可观测性记录 - 仅包含域名 + 计数，不泄露查询文本或完整 URL。 */
export interface CopilotExternalRetrievalObservabilityRecord {
  readonly recordId: string
  readonly organizationId: string
  /** 仅域名，不含路径或查询参数。 */
  readonly domain: string
  readonly citationsPresented: number
  /** 被点击的引用数。 */
  readonly citationsActivated: number
  /** 注入拦截次数。 */
  readonly injectionInterceptions: number
  /** ISO 8601 记录时间。 */
  readonly recordedAt: string
}

/** 通过溯源校验的引用。 */
export interface ValidatedCopilotCitation extends CopilotCitation {
  readonly validatedAt: string
}

// ===========================================================================
// 辅助函数 — 类型守卫
// ===========================================================================

/** 判断 source kind 是否需要 citation（外部类型）。与 external-content-safety 的同名函数解耦。 */
export function requiresCitation(kind: string): boolean {
  return (COPILOT_EXTERNAL_SOURCE_KINDS as readonly string[]).includes(kind)
}

/** 判断溯源类型是否为外部。 */
export function isExternalProvenance(provenance: string): boolean {
  return provenance === 'external'
}

// ===========================================================================
// 辅助函数 — 引用校验
// ===========================================================================

/** 校验引用完整性（URL + fetchedAt 必须存在）。 */
export function isCitationComplete(citation: { url?: string; fetchedAt?: string }): boolean {
  return Boolean(citation.url && citation.fetchedAt)
}

/** 从 URL 提取域名（不含查询参数和路径）。 */
export function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return null
  }
}

// ===========================================================================
// 辅助函数 — 可观测性安全校验
// ===========================================================================

/**
 * 检查可观测性记录是否泄露敏感数据。
 * 返回 true 表示安全（仅含域名 + 计数）。
 */
export function isObservabilityRecordSafe(
  record: CopilotExternalRetrievalObservabilityRecord,
): boolean {
  // 不得包含：queryText, pageBody, fullUrl, prompt, modelOutput, tokens, secrets
  // 该记录仅含 domain + counts + org + timestamp - 天然安全
  return !('queryText' in record) && !('fullUrl' in record) && !('pageBody' in record)
}

/**
 * 校验可观测性记录是否仅包含低敏感数据。
 * 禁止字段：queryText, fullUrl, pageBody, prompt, modelOutput, tokens, secrets, apiKey, authorization。
 */
export function validateObservabilityLowSensitivity(record: Record<string, unknown>): {
  valid: boolean
  violations: string[]
} {
  const violations: string[] = []
  const forbidden = [
    'queryText',
    'fullUrl',
    'pageBody',
    'prompt',
    'modelOutput',
    'tokens',
    'secrets',
    'apiKey',
    'authorization',
  ]
  for (const key of forbidden) {
    if (key in record) {
      violations.push(key)
    }
  }
  return { valid: violations.length === 0, violations }
}

// ===========================================================================
// 辅助函数 — 引用合并与 ID 生成
// ===========================================================================

/** 按 URL 合并引用（同一 URL 支持多个结论时合并为一条）。 */
export function mergeCitationsByUrl(citations: readonly CopilotCitation[]): CopilotCitation[] {
  const byUrl = new Map<string, CopilotCitation>()
  for (const c of citations) {
    const existing = byUrl.get(c.url)
    if (existing) {
      const mergedIds = [
        ...new Set([...existing.supportedConclusionIds, ...c.supportedConclusionIds]),
      ]
      byUrl.set(c.url, {
        ...existing,
        supportedConclusionIds: mergedIds,
      })
    } else {
      byUrl.set(c.url, { ...c })
    }
  }
  return Array.from(byUrl.values())
}

/** 确定性引用 ID 生成（基于 URL + 抓取时间的哈希）。 */
export function generateCitationId(url: string, fetchedAt: string): string {
  return `cit_${deterministicHash(url + '|' + fetchedAt).slice(0, 12)}`
}

/** 确定性可观测性记录 ID 生成。 */
export function generateObservabilityRecordId(domain: string, recordedAt: string): string {
  return `obs_${deterministicHash(domain + '|' + recordedAt).slice(0, 12)}`
}
