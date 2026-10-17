/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板目录与投递统计共享契约。
 *
 * 模板是只读的内置预设，选择白名单事件类型和低敏 header 预设（不含 payload transform、
 * 可执行代码、密钥明文/密文、token、API key、auth header、prompt 或模型输出）。
 * 统计是组织级低敏聚合，来自 delivery ledger 模型的只读查询。
 */
import type { OutgoingWebhookEventType } from './outgoing-webhook.js'

// ===== 2.1 模板契约 =====

/** 模板稳定性：stable 可对外展示；disabled 已弃用但保留 id 稳定；internal 仅内部使用。 */
export const OUTGOING_WEBHOOK_TEMPLATE_STABILITY = ['stable', 'disabled', 'internal'] as const
export type OutgoingWebhookTemplateStability = (typeof OUTGOING_WEBHOOK_TEMPLATE_STABILITY)[number]

/** 模板版本语义：semver 兼容格式，追加版本号升序。 */
export type OutgoingWebhookTemplateVersion = string

/** 可选低敏 header 预设（仅允许已知的低敏 header 名，不含 auth/authorization/cookie/secret）。 */
export interface OutgoingWebhookTemplateHeaderPreset {
  name: string
  value: string
}

/** 脱敏模板目录项（design D1/D4：只读 catalog，不包含密钥/transform/代码/payload）。 */
export interface OutgoingWebhookTemplateDto {
  /** 稳定 ID，跨版本不变。 */
  id: string
  version: OutgoingWebhookTemplateVersion
  stability: OutgoingWebhookTemplateStability
  /** 中文展示名。 */
  name: string
  /** 中文描述。 */
  description: string
  /** 从共享白名单选择的事件类型（design D2：仅白名单事件）。 */
  eventTypes: readonly OutgoingWebhookEventType[]
  /** 可选低敏 header 预设（不含 secret/token/auth header/prompt/output）。 */
  headerPresets: readonly OutgoingWebhookTemplateHeaderPreset[]
  /** 展示元数据。 */
  display: {
    icon?: string
    category?: string
    /** 推荐使用场景，简体中文。 */
    recommendedUse?: string
    /** 已知限制，简体中文。 */
    limitations?: string
  }
}

/** 模板应用入参（design D2：复用已有订阅创建边界，模板只预填 eventTypes 等）。 */
export interface ApplyOutgoingWebhookTemplateRequest {
  /** 模板 id。 */
  templateId: string
  name: string
  targetUrl: string
  /** 可选覆盖（默认使用模板的 eventTypes，若提交则取交集）。 */
  eventTypes?: readonly OutgoingWebhookEventType[]
}

/** 模板预填响应：包含模板预填的 DTO 和允许用户自行覆盖的字段提示。 */
export interface OutgoingWebhookTemplatePrefillDto {
  templateId: string
  templateVersion: OutgoingWebhookTemplateVersion
  templateName: string
  suggestedName: string
  suggestedEventTypes: readonly OutgoingWebhookEventType[]
  headerPresets: readonly OutgoingWebhookTemplateHeaderPreset[]
}

// ===== 2.1 统计契约 =====

/** 统计日期窗口（bounded，最多 90 天，默认 30 天）。 */
export interface OutgoingWebhookStatsQuery {
  startDate?: string // ISO date
  endDate?: string // ISO date
}

/** 按状态统计。 */
export interface OutgoingWebhookStatsByStatus {
  pending: number
  in_progress: number
  success: number
  failed: number
  paused: number
}

/** 终态失败分类统计。 */
export interface OutgoingWebhookStatsByFailureCategory {
  timeout: number
  network: number
  rate_limited: number
  server_error: number
  client_error: number
  signature: number
  config: number
  disabled: number
  exhausted: number
  unknown: number
}

/** 脱敏组织级投递统计（design D3/D4：仅聚合计数/分类/时间戳/引用，不含 payload/secret/token/prompt）。 */
export interface OutgoingWebhookStatsDto {
  /** 查询窗口起始。 */
  startDate: string
  /** 查询窗口结束。 */
  endDate: string
  /** 投递事件总数。 */
  totalDeliveries: number
  /** 按状态分布。 */
  byStatus: OutgoingWebhookStatsByStatus
  /** 成功率（success / total）。 */
  successRate: number
  /** 失败率（failed / total）。 */
  failureRate: number
  /** 总重试次数。 */
  totalRetries: number
  /** 按终态失败分类分布（仅 terminal 失败）。 */
  byFailureCategory: OutgoingWebhookStatsByFailureCategory
  /** 最近一次投递时间（ISO string，null 表示无投递）。 */
  lastDeliveryAt: string | null
  /** 最近一次重试窗口时间（ISO string，null 表示无等待重试）。 */
  nextRetryAt: string | null
  /** 活跃订阅数。 */
  activeSubscriptionCount: number
  /** 按模板使用计数（key=templateId, value=count）。 */
  templateUsageCount: Record<string, number>
}

/** 统计不可用/禁用响应（design D5：feature-off 时返回 deterministic 不可用态）。 */
export interface OutgoingWebhookStatsUnavailableDto {
  available: false
  reason: 'feature_disabled' | 'no_data'
}

/** 模板列表 API 响应。 */
export interface OutgoingWebhookTemplateListResponse {
  data: OutgoingWebhookTemplateDto[]
}

/** 模板应用 API 响应（复用已有 OutgoingWebhookSubscriptionCreatedDto 形态）。 */
export interface OutgoingWebhookTemplateApplyResponse {
  data: {
    subscriptionId: number
    templateId: string
    templateVersion: OutgoingWebhookTemplateVersion
  }
}

/** 模板预填 API 响应。 */
export interface OutgoingWebhookTemplatePrefillResponse {
  data: OutgoingWebhookTemplatePrefillDto
}

/** 统计 API 响应。 */
export interface OutgoingWebhookStatsResponse {
  data: OutgoingWebhookStatsDto | OutgoingWebhookStatsUnavailableDto
}
