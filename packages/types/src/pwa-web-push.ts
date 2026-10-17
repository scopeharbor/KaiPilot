/**
 * v2-5-pwa-web-push-notifications — PWA Web Push 通知共享契约。
 *
 * 定义订阅生命周期、低敏推送 envelope、发送结果、功能能力状态等类型。
 * 所有 DTO 遵循低敏原则：不含 endpoint 明文、keys 明文、payload 正文、业务数据。
 *
 * @see design.md D1-D7 / spec pwa-web-push-notifications
 */

// ===== 2.1 功能能力状态 =====

/** 浏览器推送能力状态。 */
export const PUSH_CAPABILITY_STATUS = [
  'supported',
  'unsupported',
  'permission_denied',
  'permission_granted',
  'permission_prompt',
  'feature_disabled',
  'no_service_worker',
] as const
export type PushCapabilityStatus = (typeof PUSH_CAPABILITY_STATUS)[number]

/** 订阅状态。 */
export const PUSH_SUBSCRIPTION_STATUS = [
  'active',
  'expired',
  'revoked',
  'invalidated',
  'none',
] as const
export type PushSubscriptionStatus = (typeof PUSH_SUBSCRIPTION_STATUS)[number]

// ===== 2.1 能力/状态 API 类型 =====

/** 功能能力状态响应（公开 API，无敏感信息）。 */
export interface PushCapabilityState {
  /** 浏览器推送是否可用（feature flag + 浏览器支持）。 */
  enabled: boolean
  /** 浏览器推送能力状态。 */
  capability: PushCapabilityStatus
  /** 服务器 VAPID 公钥（base64url 编码），仅 capability 为 supported 时返回。 */
  vapidPublicKey: string | null
}

/** 当前用户订阅状态响应。 */
export interface PushSubscriptionState {
  status: PushSubscriptionStatus
  /** 订阅是否可通过浏览器推送。 */
  subscribed: boolean
  /** 订阅创建时间。 */
  createdAt: string | null
  /** 用户代理摘要。 */
  userAgent: string | null
}

// ===== 2.1 订阅请求/响应类型 =====

/** 订阅请求（从浏览器接收的 PushSubscription JSON）。 */
export interface PushSubscribeRequest {
  /** 浏览器 PushSubscription endpoint。 */
  endpoint: string
  /** 浏览器 PushSubscription keys（p256dh + auth）。 */
  keys: {
    p256dh: string
    auth: string
  }
  /** 用户代理摘要，用于展示。 */
  userAgent?: string
}

/** 取消订阅请求。 */
export interface PushUnsubscribeRequest {
  /** 要取消的 endpoint。 */
  endpoint: string
}

/** 订阅操作响应。 */
export interface PushSubscribeResponse {
  success: boolean
  status: PushSubscriptionStatus
}

/** 取消订阅响应。 */
export interface PushUnsubscribeResponse {
  success: boolean
}

// ===== 2.1 低敏推送 Envelope =====

/** 推送通知严重级别。 */
export const PUSH_NOTIFICATION_SEVERITY = ['info', 'warning', 'error', 'critical'] as const
export type PushNotificationSeverity = (typeof PUSH_NOTIFICATION_SEVERITY)[number]

/** 推送通知类型分组（用于图标和通知分组）。 */
export const PUSH_NOTIFICATION_TYPE = [
  'mention',
  'assignment',
  'approval',
  'system',
  'report',
] as const
export type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPE)[number]

/**
 * 低敏推送 Envelope（design D5：仅包含 notificationId、通用类型、严重级别、创建时间和安全路由）。
 *
 * 禁止包含：项目名称、任务标题、正文、评论、AI 输出、文件路径、token、secret、外部 payload、raw metadata。
 */
export interface PushNotificationEnvelope {
  /** 站内通知 ID。 */
  notificationId: number
  /** 通知类型分组。 */
  type: PushNotificationType
  /** 严重级别。 */
  severity: PushNotificationSeverity
  /** 创建时间（ISO 8601）。 */
  createdAt: string
  /** 安全路由（同源 allowlist 路径）。 */
  route: string
  /** 简短标题（仅用于通知显示，低敏，如 "新任务" 而非任务名）。 */
  title: string
  /** 可选的简短正文（仅用于通知显示，低敏，如 "你被指派了一个任务"）。 */
  body: string | null
}

// ===== 2.1 发送器结果 =====

/** 发送模式。 */
export const PUSH_SENDER_MODE = ['fixture', 'production'] as const
export type PushSenderMode = (typeof PUSH_SENDER_MODE)[number]

/** 发送结果。 */
export const PUSH_SEND_RESULT = [
  'sent',
  'failed',
  'invalid_endpoint',
  'feature_disabled',
  'fixture_recorded',
  'no_recipient',
] as const
export type PushSendResult = (typeof PUSH_SEND_RESULT)[number]

/** 发送尝试记录（低敏，不包含 endpoint、keys、payload 正文）。 */
export interface PushSendAttempt {
  notificationId: number
  result: PushSendResult
  mode: PushSenderMode
  createdAt: string
}

// ===== 2.1 推送偏好 =====

/** 推送通知类别偏好。 */
export interface PushNotificationPreference {
  /** 通知类型分组。 */
  type: PushNotificationType
  /** 是否启用推送。 */
  enabled: boolean
}

/** 推送偏好更新请求。 */
export interface PushPreferenceUpdateRequest {
  preferences: PushNotificationPreference[]
}

/** 推送偏好响应。 */
export interface PushPreferenceResponse {
  preferences: PushNotificationPreference[]
}
