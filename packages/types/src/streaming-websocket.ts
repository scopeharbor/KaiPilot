/**
 * streaming-websocket —— Streaming WebSocket Service 共享契约（前后端共享）。
 *
 * 定义 WebSocket 控制消息类型、stream 订阅/恢复元数据、低敏日志 payload、
 * 安全诊断类型与 feature flag 配置。本模块是纯 TypeScript，零运行时依赖。
 *
 * # 核心设计（对应 design.md D1/D3/D5/D6）
 * - D1：控制消息白名单（subscribe/unsubscribe/resume/ack/heartbeat/status/diagnostics）
 * - D3：所有进度事件统一使用 StreamingProgressEnvelope
 * - D5：客户端控制消息白名单化，禁止 write/apply/sync/external
 * - D6：Feature flag 与降级路径先行
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs / compiler-spec。
 */

// =============================================================================
// 1. Feature Flag 配置
// =============================================================================

/** Streaming WebSocket Service feature flag 环境变量名。 */
export const STREAMING_WS_FEATURE_FLAG = 'STREAMING_WS_ENABLED'

/** Streaming WebSocket Service 默认值（本地开发默认启用）。 */
export const STREAMING_WS_DEFAULT_ENABLED = true

/**
 * Streaming WebSocket Service 配置接口。
 * 允许运行时切换，不要求重启进程。
 */
export interface StreamingWsConfig {
  /** 是否启用 WebSocket 流式推送。 */
  enabled: boolean
  /** 心跳间隔（毫秒）。 */
  heartbeatIntervalMs: number
  /** 心跳超时（毫秒）。 */
  heartbeatTimeoutMs: number
  /** 连接超时（毫秒）。 */
  connectTimeoutMs: number
  /** 事件 replay 保留窗口（秒）。 */
  replayRetentionWindowSec: number
  /** 最大 replay 事件数。 */
  maxReplayEvents: number
  /** 是否用外部 broker（首期 false）。 */
  externalBrokerEnabled: boolean
}

export const DEFAULT_STREAMING_WS_CONFIG: StreamingWsConfig = {
  enabled: STREAMING_WS_DEFAULT_ENABLED,
  heartbeatIntervalMs: 25_000,
  heartbeatTimeoutMs: 20_000,
  connectTimeoutMs: 30_000,
  replayRetentionWindowSec: 300,
  maxReplayEvents: 500,
  externalBrokerEnabled: false,
}

// =============================================================================
// 2. 客户端控制消息
// =============================================================================

/** 客户端 → 服务端允许的 WebSocket 控制消息名称。 */
export const WS_CONTROL_MESSAGE_NAMES = [
  'subscribe:stream',
  'unsubscribe:stream',
  'resume:stream',
  'ack:stream',
  'client:heartbeat',
  'status:stream',
  'diagnostics:stream',
] as const

export type WsControlMessageName = (typeof WS_CONTROL_MESSAGE_NAMES)[number]

/**
 * 禁止的写入类消息前缀。
 * 任何以这些前缀开头的 WebSocket 事件名都必须被拒绝。
 */
export const WRITE_MESSAGE_PREFIXES = [
  'write:',
  'apply:',
  'sync:',
  'external:',
  'deploy:',
  'publish:',
  'package-manager:',
  'repository:',
] as const

// =============================================================================
// 3. 订阅控制消息 payload
// =============================================================================

/** Stream subscribe 请求。 */
export interface StreamSubscribeRequest {
  /** 领域类型（ai-draft / compiler）。 */
  domain: string
  /** 流 ID（如 draftId、runId）。*/
  streamId: string
  /** 可选 cursor：上次收到的 sequence。 */
  lastSequence?: number
  /** 客户端支持的契约版本。 */
  contractVersion?: string
}

/** Stream resume 请求（reconnect 后恢复订阅）。 */
export interface StreamResumeRequest {
  /** 流 ID。 */
  streamId: string
  /** 上次收到的 sequence。 */
  lastSequence: number
  /** 客户端支持的契约版本。 */
  contractVersion: string
}

/** Stream ack 确认（客户端确认已收到指定 sequence）。 */
export interface StreamAckRequest {
  /** 流 ID。 */
  streamId: string
  /** 确认的 sequence。 */
  sequence: number
  /** ack 时间戳。 */
  ackedAt?: string
}

/** 诊断请求——查询 stream service 状态。 */
export interface DiagnosticsRequest {
  /** 请求类型。 */
  type: 'streams' | 'config' | 'stats'
}

// =============================================================================
// 4. 服务端 → 客户端事件
// =============================================================================

/** 服务端 → 客户端 event name 常量。 */
export const WS_STREAM_EVENT_NAME = 'stream:event'
export const WS_LOG_EVENT_NAME = 'stream:log'
export const WS_STATUS_EVENT_NAME = 'stream:status'
export const WS_DIAGNOSTICS_EVENT_NAME = 'stream:diagnostics'
export const WS_RESET_REQUIRED_EVENT_NAME = 'stream:reset-required'

/**
 * Stream 订阅被授权后的确认事件。
 * 服务端在验证客户端权限后发送此事件，并将 socket 加入 stream room。
 */
export interface StreamSubscribedResponse {
  streamId: string
  domain: string
  organizationId: number
  /** 下次心跳预期间隔（毫秒）。 */
  expectedHeartbeatIntervalMs: number
  /** 当前最大可用 sequence。 */
  currentMaxSequence: number
}

/** Stream 取消订阅确认。 */
export interface StreamUnsubscribedResponse {
  streamId: string
  reason?: string
}

/**
 * Resume 的响应。
 * 如果 replayAvailable 为 true，后续会推送 replay 事件；
 * 如果为 false，客户端应走 REST/SSE/status snapshot 获取权威状态。
 */
export interface StreamResumeResponse {
  streamId: string
  replayAvailable: boolean
  /** Replay 开始的 sequence。 */
  replayStartSequence: number
  /** Replay 事件数量。 */
  replayCount: number
  /** 若无 replay，返回 reset-required reason code。 */
  resetReasonCode?: string
}

/**
 * Reset-required 通知。
 * 当 replay 窗口过期、契约不兼容或内部状态不可恢复时发送。
 * 客户端收到后必须走 REST/SSE/status snapshot 获取权威状态。
 */
export interface ResetRequiredEvent {
  streamId: string
  /** 低敏 reason code。 */
  reasonCode: string
  /** 低敏描述（不含 prompt/token/secret）。 */
  reasonMessage: string
}

/** Stream ack 确认。 */
export interface StreamAckResponse {
  streamId: string
  sequence: number
  ok: boolean
}

/** 心跳确认（服务端 → 客户端）。 */
export interface HeartbeatResponse {
  timestamp: string
  serverTime: number
}

/** 诊断响应。 */
export interface DiagnosticsResponse {
  status: 'ok' | 'degraded' | 'unavailable'
  activeStreams: number
  activeSubscriptions: number
  uptime: number
  /** 低敏版本信息 */
  version: string
}

// =============================================================================
// 5. 低敏实时日志事件
// =============================================================================

/** 实时日志事件类型。 */
export const REALTIME_LOG_SEVERITIES = ['info', 'warn', 'error'] as const
export type RealtimeLogSeverity = (typeof REALTIME_LOG_SEVERITIES)[number]

/** 通过 WebSocket 推送的低敏实时日志事件。 */
export interface RealtimeLogEvent {
  streamId: string
  stageId: string
  phase: string
  attempt: number
  severity: RealtimeLogSeverity
  /** 低敏消息代码（不包含自由文本 prompt、token、secret）。 */
  messageCode: string
  /** 计数（如处理的项目数、重试次数）。 */
  count?: number
  /** 耗时（毫秒）。 */
  durationMs?: number
  /** 安全 artifact 引用（hash 或 ref）。 */
  safeRefs?: string[]
  /** 安全 hash 值。 */
  hash?: string
  timestamp: string
}

// =============================================================================
// 6. Stream 房间命名
// =============================================================================

/**
 * 服务端推导的 stream room 名格式：`stream:{organizationId}:{domain}:{streamId}`。
 * 客户端不得提供原始 room 名。
 */
export function buildStreamRoomName(
  organizationId: number,
  domain: string,
  streamId: string,
): string {
  return `stream:${organizationId}:${domain}:${streamId}`
}

/**
 * 从 room 名解析组织 ID（若匹配 stream room 格式）。
 */
export function parseStreamRoomName(room: string): {
  organizationId: number | null
  domain: string | null
  streamId: string | null
} {
  const parts = room.split(':')
  if (parts.length >= 4 && parts[0] === 'stream') {
    const orgId = Number(parts[1])
    return {
      organizationId: Number.isFinite(orgId) ? orgId : null,
      domain: parts[2] || null,
      streamId: parts.slice(3).join(':') || null,
    }
  }
  return { organizationId: null, domain: null, streamId: null }
}

// =============================================================================
// 7. 已验证领域适配器接口
// =============================================================================

/** 已注册的 stream domain。 */
export const REGISTERED_STREAM_DOMAINS = ['ai-draft', 'compiler'] as const

/**
 * Domain 授权适配器接口。
 * 每个 domain 一个 adapter，用于验证用户是否有权订阅该 stream。
 */
export interface DomainAuthorizationAdapter {
  /** 领域名称（如 'ai-draft'）。 */
  domain: string

  /**
   * 检查用户是否有权订阅指定 stream。
   * @returns 授权结果。
   */
  authorize(
    userId: number,
    organizationId: number,
    streamId: string,
  ): Promise<DomainAuthorizationResult>
}

/** Domain 授权结果。 */
export interface DomainAuthorizationResult {
  allowed: boolean
  /** 拒绝原因代码（低敏）。 */
  reasonCode?: string
  /** 拒绝原因描述（低敏）。 */
  reasonMessage?: string
}

// =============================================================================
// 8. Stream 注册表条目
// =============================================================================

/**
 * Stream 注册表条目。
 * 服务端维护每个活跃 stream 的元信息。
 */
export interface StreamRegistryEntry {
  streamId: string
  domain: string
  organizationId: number
  /** 创建时间（Unix ms）。 */
  createdAt: number
  /** 当前最大 sequence。 */
  maxSequence: number
  /** 订阅 socket ID 列表。 */
  subscriberSocketIds: string[]
  /** 上次活动时间。 */
  lastActivityAt: number
  /** Stream 是否已终态。 */
  terminal: boolean
}

// =============================================================================
// 9. Metrics counters
// =============================================================================

/** 低敏流式服务 metrics。 */
export interface StreamingWsMetrics {
  activeStreamSubscriptions: number
  replaySuccessCount: number
  replayFailureCount: number
  resetRequiredCount: number
  publishFailureCount: number
  rejectedControlMessageCount: number
  activeStreams: number
}

/** Metric key 常量（用于日志/计数器标识）。 */
export const METRIC_KEYS = {
  ACTIVE_SUBSCRIPTIONS: 'streaming.ws.active_subscriptions',
  REPLAY_SUCCESS: 'streaming.ws.replay.success',
  REPLAY_FAILURE: 'streaming.ws.replay.failure',
  RESET_REQUIRED: 'streaming.ws.reset_required',
  PUBLISH_FAILURE: 'streaming.ws.publish.failure',
  REJECTED_CONTROL: 'streaming.ws.rejected_control',
  ACTIVE_STREAMS: 'streaming.ws.active_streams',
} as const
