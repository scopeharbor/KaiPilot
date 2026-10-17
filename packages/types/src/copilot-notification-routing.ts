/**
 * v3-copilot-notification-routing — 投递路由共享契约
 *
 * 核心设计纪律（D1-D7）：
 * - 三通道包含关系：推送 ⊃ 通知中心 ⊃ 徽章
 * - 组织级偏好为上限，个人级只能更严格
 * - 路由确定性：相同输入 → 相同输出
 * - 本层不做频次判定（疲劳控制归上游触发层）
 * - 投递决策记录为低敏观察记录
 * - 推送载荷只带引用与计数，不含建议正文
 * - 单通道失败不影响其余通道
 */

// ---------------------------------------------------------------------------
// 三通道枚举
// ---------------------------------------------------------------------------

/** 三通道枚举，按打扰强度递增排列。 */
export const DELIVERY_CHANNELS = ['badge', 'in_app_notification', 'push'] as const
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number]

/** 通道标签（低敏展示）。 */
export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  badge: '面板徽章',
  in_app_notification: '站内通知中心',
  push: 'Web Push',
}

/** 通道打扰强度序（数值越大越强）。 */
export const DELIVERY_CHANNEL_STRENGTH: Record<DeliveryChannel, number> = {
  badge: 1,
  in_app_notification: 2,
  push: 3,
}

// ---------------------------------------------------------------------------
// 问题种类（复用 inbox 的问题种类枚举）
// ---------------------------------------------------------------------------

export type { InboxProblemKind } from './copilot-suggestion-inbox.js'

// ---------------------------------------------------------------------------
// 投递偏好
// ---------------------------------------------------------------------------

/**
 * 单通道开关。
 */
export interface DeliveryChannelToggle {
  /** 通道是否启用 */
  enabled: boolean
}

/**
 * 一个问题种类下**各通道**的启用状态。
 *
 * 注（v3-backend-type-debt-closure）：原类型写成 `{ enabled: boolean }`（单通道），
 * 但 fixtures（makeAllChannelsEnabled 返回 badge/in_app_notification/push 三键）与
 * delivery_router（按 DELIVERY_CHANNELS 逐通道索引）都按"按通道映射"使用——
 * 类型与两侧真实用法都不一致，导致路由器整段按通道索引报 TS7053。
 */
export type DeliveryChannelPreference = Record<DeliveryChannel, DeliveryChannelToggle>

/**
 * 按问题种类的通道偏好映射。
 * key = 问题种类，value = 各通道的启用状态。
 */
export type DeliveryPreferenceByKind = Record<string, DeliveryChannelPreference>

/**
 * 投递偏好（组织级或个人级）。
 */
export interface DeliveryPreference {
  /** 偏好所有者类型 */
  level: 'organization' | 'personal'
  /** 所有者 ID（organizationId 或 userId） */
  ownerId: number
  /** 按问题种类的通道偏好 */
  preferences: DeliveryPreferenceByKind
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 通道包含关系约束
// ---------------------------------------------------------------------------

/**
 * 通道包含关系：推送开启隐含通知中心开启，通知中心开启隐含徽章开启。
 * 违反此约束的偏好组合应被拒绝。
 */
export const CHANNEL_CONTAINMENT: Record<DeliveryChannel, DeliveryChannel[]> = {
  push: ['in_app_notification', 'badge'],
  in_app_notification: ['badge'],
  badge: [],
}

/**
 * 检查偏好组合是否违反通道包含关系。
 * 返回 null 表示合法，返回原因字符串表示违规。
 */
export function validateChannelContainment(preferences: DeliveryChannelPreference): string | null {
  // 推送开启 → 通知中心必须开启
  if (preferences.push?.enabled && !preferences.in_app_notification?.enabled) {
    return '推送通道开启时，站内通知中心必须同时开启'
  }
  // 通知中心开启 → 徽章必须开启
  if (preferences.in_app_notification?.enabled && !preferences.badge?.enabled) {
    return '站内通知中心开启时，面板徽章必须同时开启'
  }
  return null
}

// ---------------------------------------------------------------------------
// 组织级 vs 个人级偏好约束
// ---------------------------------------------------------------------------

/**
 * 检查个人偏好是否超出组织上限。
 * 返回 null 表示合法，返回原因字符串表示违规。
 */
export function validatePreferenceCap(
  organizationPref: DeliveryPreferenceByKind,
  personalPref: DeliveryPreferenceByKind,
): string | null {
  for (const kind of Object.keys(organizationPref)) {
    const orgChannels = organizationPref[kind]
    const personalChannels = personalPref[kind]
    if (!orgChannels || !personalChannels) continue

    for (const channel of DELIVERY_CHANNELS) {
      if (orgChannels[channel]?.enabled === false && personalChannels[channel]?.enabled === true) {
        return `组织已关闭「${channel}」通道（问题种类：${kind}），个人无法反向开启`
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 抑制原因
// ---------------------------------------------------------------------------

/** 抑制原因枚举。 */
export const SUPPRESSION_REASONS = [
  'channel_disabled',
  'organization_disabled',
  'authorization_gated',
  'channel_failed',
] as const

export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number]

/** 抑制原因标签（低敏展示）。 */
export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  channel_disabled: '通道已关闭',
  organization_disabled: '组织级已禁用',
  authorization_gated: '授权门未开',
  channel_failed: '通道投递失败',
}

// ---------------------------------------------------------------------------
// 投递决策记录
// ---------------------------------------------------------------------------

/**
 * 投递决策记录（低敏观察记录）。
 * 不含建议正文、prompt、模型输出、token 或 secret。
 */
export interface DeliveryDecisionRecord {
  /** 记录 ID */
  id: string
  /** 收件箱条目 ID（引用，非嵌入） */
  entryId: string
  /** 组织 ID（组织隔离） */
  organizationId: number
  /** 用户 ID（接收人） */
  recipientId: number
  /** 目标通道 */
  channel: DeliveryChannel
  /** 是否投递成功 */
  delivered: boolean
  /** 抑制原因（delivered=false 时必填） */
  suppressionReason: SuppressionReason | null
  /** 问题种类（低敏引用） */
  problemKind: string
  /** 严重度 */
  severity: string
  /** 未读计数（投递时） */
  unreadCount: number
  /** 决策时间 */
  decidedAt: string
}

// ---------------------------------------------------------------------------
// 推送信封
// ---------------------------------------------------------------------------

/**
 * 推送信封（只含引用与计数，不含建议正文）。
 */
export interface NotificationPushEnvelope {
  /** 收件箱条目 ID（引用） */
  entryId: string
  /** 问题种类 */
  problemKind: string
  /** 严重度 */
  severity: string
  /** 未读计数 */
  unreadCount: number
  /** 组织 ID */
  organizationId: number
  /** 用户 ID */
  recipientId: number
}

// ---------------------------------------------------------------------------
// 禁存约束验证
// ---------------------------------------------------------------------------

/** 推送信封中禁止出现的字段名。 */
export const PUSH_ENVELOPE_FORBIDDEN_FIELDS = [
  'suggestionBody',
  'suggestionText',
  'prompt',
  'modelOutput',
  'token',
  'secret',
  'apiKey',
  'authorization',
] as const

/**
 * 检查推送信封是否包含禁止字段。
 * 返回 null 表示安全，返回字段名表示包含禁止内容。
 */
export function validatePushEnvelopeSecurity(envelope: Record<string, unknown>): string | null {
  for (const field of PUSH_ENVELOPE_FORBIDDEN_FIELDS) {
    if (field in envelope && envelope[field] !== undefined && envelope[field] !== null) {
      return field
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 投递结果汇总
// ---------------------------------------------------------------------------

/**
 * 单通道投递结果。
 */
export interface ChannelDeliveryResult {
  /** 通道 */
  channel: DeliveryChannel
  /** 是否投递成功 */
  success: boolean
  /** 失败原因（success=false 时有值） */
  reason: SuppressionReason | null
  /** 额外信息（低敏） */
  detail?: string
}

/**
 * 多通道投递结果汇总。
 */
export interface DeliveryResultSummary {
  /** 收件箱条目 ID */
  entryId: string
  /** 各通道投递结果 */
  results: ChannelDeliveryResult[]
  /** 决策记录列表 */
  decisions: DeliveryDecisionRecord[]
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isDeliveryChannel(v: unknown): v is DeliveryChannel {
  return typeof v === 'string' && (DELIVERY_CHANNELS as readonly string[]).includes(v)
}

export function isSuppressionReason(v: unknown): v is SuppressionReason {
  return typeof v === 'string' && (SUPPRESSION_REASONS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// 低敏 Sanitizer
// ---------------------------------------------------------------------------

/**
 * 低敏化决策记录摘要（用于日志/审计）。
 */
export function sanitizeDecisionRecordSummary(record: DeliveryDecisionRecord): {
  id: string
  channel: DeliveryChannel
  delivered: boolean
  suppressionReason: SuppressionReason | null
  problemKind: string
  severity: string
} {
  return {
    id: record.id,
    channel: record.channel,
    delivered: record.delivered,
    suppressionReason: record.suppressionReason,
    problemKind: record.problemKind,
    severity: record.severity,
  }
}
