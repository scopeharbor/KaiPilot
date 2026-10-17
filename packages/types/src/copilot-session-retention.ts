/**
 * V3 Copilot Session Retention — 共享契约与确定性纯函数引擎
 *
 * 定义 Copilot 会话保留策略治理的枚举/接口/类型守卫/纯函数：
 * 保留策略、删除记录、墓碑引用、状态响应与敏感数据检查。
 *
 * 设计约束：
 * - 会话内容、提示、模型输出、token、secret 绝不进入保留记录。
 * - 墓碑哈希不透明且不可逆推会话内容。
 * - 仅支持组织/项目级作用域，不支持用户级。
 *
 * 消费 copilot-session 相关记录，不改变会话存储契约。
 *
 * 此文件为 Section 2（Shared Contracts And Fixtures）的主产出物。
 */

import { deterministicHash } from './triz-contradiction.js'

// ─── 枚举 ────────────────────────────────────────────────────────────────

/** 触发删除的原因（低敏，枚举化避免自由文本泄露） */
export const COPILOT_SESSION_RETENTION_TRIGGER_REASONS = [
  'retention_expired',
  'user_requested',
  'organization_requested',
] as const
export type CopilotSessionRetentionTriggerReason =
  (typeof COPILOT_SESSION_RETENTION_TRIGGER_REASONS)[number]

/** 保留策略作用域（仅组织/项目级，不支持用户级） */
export const COPILOT_SESSION_RETENTION_SCOPES = ['organization', 'project'] as const
export type CopilotSessionRetentionScope = (typeof COPILOT_SESSION_RETENTION_SCOPES)[number]

// ─── 常量 ────────────────────────────────────────────────────────────────

/** 系统不可变边界（天数） */
export const COPILOT_SESSION_RETENTION_BOUNDS = {
  minDays: 1,
  maxDays: 3650,
} as const
export type CopilotSessionRetentionBounds = typeof COPILOT_SESSION_RETENTION_BOUNDS

/** 系统边界常量（与 OCR 保留一致） */
export const COPILOT_SESSION_RETENTION_SYSTEM_BOUNDS = {
  minDays: 1,
  maxDays: 3650,
} as const

/** 禁止出现在保留记录中的敏感键名（低敏，不包含内容/提示/输出/凭据） */
export const COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS = [
  'content',
  'prompt',
  'modelOutput',
  'token',
  'secret',
  'authorization',
  'contentSummary',
  'sourceRefs',
] as const

// ─── 接口 ────────────────────────────────────────────────────────────────

/** 保留策略配置（不含会话内容） */
export interface CopilotSessionRetentionPolicy {
  scope: CopilotSessionRetentionScope
  organizationId: number
  projectId: number | null
  retentionDays: number
  enabled: boolean
  policyHash: string
  createdAt: string | null
  updatedAt: string | null
}

/** 策略更新请求（只允许边界内的覆盖） */
export interface CopilotSessionRetentionPolicyUpdateRequest {
  retentionDays: number
  enabled: boolean
}

/** 删除记录（低敏，不含会话内容） */
export interface CopilotSessionRetentionDeletionRecord {
  deletionId: number
  organizationId: number
  projectId: number | null
  sessionId: string
  sessionDbId: number | null
  triggerReason: CopilotSessionRetentionTriggerReason
  deletedAt: string
  messageCount: number
  tombstoneId: number | null
  policyHash: string
}

/** 墓碑记录（低敏，可追溯但不可逆推内容） */
export interface CopilotSessionRetentionTombstone {
  tombstoneId: number
  organizationId: number
  projectId: number | null
  originalSessionId: string
  tombstoneHash: string
  messageCount: number
  policyHash: string
  createdAt: string
}

/** 状态响应（项目级保留状态） */
export interface CopilotSessionRetentionStatusResponse {
  organizationId: number
  projectId: number | null
  totalSessions: number
  expiringSoonCount: number
  deletedCount: number
  policyConfigured: boolean
  retentionDays: number | null
}

/** 会话保留摘要（低敏，供前端展示） */
export interface CopilotSessionRetentionReadSummary {
  sessionId: string
  sessionDbId: number | null
  title: string
  createdAt: string
  retentionExpiresAt: string | null
  remainingDays: number | null
  policyConfigured: boolean
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────

export function isCopilotSessionRetentionTriggerReason(
  value: unknown,
): value is CopilotSessionRetentionTriggerReason {
  return (
    typeof value === 'string' &&
    (COPILOT_SESSION_RETENTION_TRIGGER_REASONS as readonly string[]).includes(value)
  )
}

export function isCopilotSessionRetentionScope(
  value: unknown,
): value is CopilotSessionRetentionScope {
  return (
    typeof value === 'string' &&
    (COPILOT_SESSION_RETENTION_SCOPES as readonly string[]).includes(value)
  )
}

// ─── 纯函数：哈希 ────────────────────────────────────────────────────────

/** 策略哈希：只取决于作用域/组织/项目/天数/启用状态，不含时间戳与操作人 */
export function computeCopilotSessionRetentionPolicyHash(params: {
  scope: CopilotSessionRetentionScope
  organizationId: number
  projectId: number | null
  retentionDays: number
  enabled: boolean
}): string {
  const body = `${params.scope}|${params.organizationId}|${params.projectId ?? 'org'}|${params.retentionDays}|${params.enabled}`
  return deterministicHash(body)
}

/** 墓碑哈希：会话身份 + 删除原因 + 策略快照哈希（不包含会话内容） */
export function computeCopilotSessionTombstoneHash(params: {
  originalSessionId: string
  deletionReason: string
  policyHash: string
  deletedAtIso: string
}): string {
  const body = `${params.originalSessionId}|${params.deletionReason}|${params.policyHash}|${params.deletedAtIso}`
  return deterministicHash(body)
}

// ─── 纯函数：验证 ────────────────────────────────────────────────────────

/** 校验保留天数是否在边界内 */
export function isValidCopilotSessionRetentionDays(
  days: number,
  bounds: CopilotSessionRetentionBounds = COPILOT_SESSION_RETENTION_BOUNDS,
): boolean {
  return Number.isInteger(days) && days >= bounds.minDays && days <= bounds.maxDays
}

/** 计算剩余保留天数（null 表示未配置策略） */
export function computeCopilotSessionRemainingDays(
  expiresAt: string | null,
  now: string,
): number | null {
  if (expiresAt === null) return null
  const expiry = new Date(expiresAt).getTime()
  const nowMs = new Date(now).getTime()
  const remaining = Math.ceil((expiry - nowMs) / (24 * 60 * 60 * 1000))
  return remaining < 0 ? 0 : remaining
}

/**
 * 检查对象是否包含敏感数据标记。
 * 基于 COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS 进行键名匹配。
 *
 * 名字带 CopilotSession 前缀是必须的：ocr-result-retention 里已有一个同名但语义不同的
 * containsSensitiveMarkers（按 RETONLY 正则判定、无参数化禁存键），两者都被 barrel
 * star 导出时会构成 ESM「conflicting star exports」，任何显式导入该名字的模块在链接期
 * 直接 SyntaxError——整个 @aiproj/types barrel 随之不可用。
 */
export function containsCopilotSessionSensitiveMarkers(
  value: unknown,
  forbiddenKeys: readonly string[] = COPILOT_SESSION_RETENTION_FORBIDDEN_KEYS,
): boolean {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((item) => containsCopilotSessionSensitiveMarkers(item, forbiddenKeys))
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.some((forbidden) => key.toLowerCase().includes(forbidden.toLowerCase()))) {
      return true
    }
    if (
      typeof val === 'object' &&
      val !== null &&
      containsCopilotSessionSensitiveMarkers(val, forbiddenKeys)
    ) {
      return true
    }
  }
  return false
}
