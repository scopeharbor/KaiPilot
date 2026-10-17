/**
 * streaming_ws_config —— Streaming WebSocket Service 配置（design D6）。
 *
 * 读取环境变量，提供运行时配置。Feature flag 关闭时所有发布接口为 no-op。
 * 默认本地开发启用，不要求外部 broker/Redis/Docker/容器。
 *
 * 用法：
 * ```ts
 * import { getStreamingWsConfig } from '#services/streaming/streaming_ws_config'
 * const config = getStreamingWsConfig()
 * if (config.enabled) { ... }
 * ```
 */

import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

export interface StreamingWsConfig {
  enabled: boolean
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  replayRetentionSec: number
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20_000
const DEFAULT_REPLAY_RETENTION_SEC = 300

/**
 * 获取 Streaming WebSocket Service 运行时配置。
 * 每次调用刷新环境变量值，支持运行时切换（env 文件变更需重启）。
 */
export function getStreamingWsConfig(): StreamingWsConfig {
  const enabled = env.get('STREAMING_WS_ENABLED', true)

  const heartbeatIntervalMs = env.get(
    'STREAMING_WS_HEARTBEAT_INTERVAL_MS',
    DEFAULT_HEARTBEAT_INTERVAL_MS,
  )
  const heartbeatTimeoutMs = env.get(
    'STREAMING_WS_HEARTBEAT_TIMEOUT_MS',
    DEFAULT_HEARTBEAT_TIMEOUT_MS,
  )
  const replayRetentionSec = env.get(
    'STREAMING_WS_REPLAY_RETENTION_SEC',
    DEFAULT_REPLAY_RETENTION_SEC,
  )

  return {
    enabled,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    replayRetentionSec,
  }
}

/**
 * 检查 Streaming WebSocket Service 是否启用。
 * 当功能关闭或 REALTIME_ENABLED 也为 false 时返回 false。
 * 不阻塞 REST/SSE/status fallback。
 */
export function isStreamingWsEnabled(): boolean {
  const realtimeEnabled = env.get('REALTIME_ENABLED', true)
  if (!realtimeEnabled) {
    return false
  }
  return env.get('STREAMING_WS_ENABLED', true)
}

/**
 * 记录当前 Streaming WebSocket Service 配置状态。
 * 仅输出低敏配置值。
 */
export function logStreamingWsConfig(): void {
  const config = getStreamingWsConfig()
  logger.info(
    {
      streamingWsEnabled: config.enabled,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs,
      replayRetentionSec: config.replayRetentionSec,
    },
    'Streaming WebSocket Service 配置摘要',
  )
}
