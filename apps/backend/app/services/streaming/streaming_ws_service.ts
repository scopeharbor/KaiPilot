/**
 * streaming_ws_service —— Streaming WebSocket Service 核心模块（design D1/D4/D5）。
 *
 * 职责：
 * - Stream registry（活跃 stream 注册与查询）
 * - Domain adapter 查找与授权
 * - Replay 游标查找与 reset-required 生成
 * - Publish helper（progress envelope 与低敏 log）
 *
 * 依赖关系：SocketIoProvider 负责连接生命周期，本服务负责 stream 语义。
 * 设计 D1：复用现有 Socket.IO provider，新增长任务 stream service 层。
 * 设计 D4：Resume 以 cursor replay 优先，失败时 reset-required。
 * 设计 D5：客户端控制消息白名单化。
 */

import logger from '@adonisjs/core/services/logger'
import { getSocketIo } from '#providers/socketio_provider'
import { getStreamingWsConfig, isStreamingWsEnabled } from '#services/streaming/streaming_ws_config'
import type { StreamingProgressEnvelope } from '@aiproj/types'
import { validateEventSafety } from '@aiproj/types'
// Re-export config for downstream consumers
export { isStreamingWsEnabled } from '#services/streaming/streaming_ws_config'
import type {
  DomainAuthorizationAdapter,
  DomainAuthorizationResult,
  StreamRegistryEntry,
  RealtimeLogEvent,
} from '@aiproj/types'

// =============================================================================
// 常量
// =============================================================================

const STREAM_ROOM_PREFIX = 'stream'
const MAX_SUBSCRIBERS_PER_STREAM = 100

// =============================================================================
// 内部注册表
// =============================================================================

/** 内存 stream 注册表（单节点，后续多节点需迁移到 Redis）。 */
const streamRegistry = new Map<string, StreamRegistryEntry>()

/** 已注册的 domain authorization adapter。 */
const domainAdapters = new Map<string, DomainAuthorizationAdapter>()

// =============================================================================
// Domain Adapter 注册
// =============================================================================

/**
 * 注册 domain authorization adapter。
 * 应在应用启动阶段调用。
 */
export function registerDomainAdapter(adapter: DomainAuthorizationAdapter): void {
  if (domainAdapters.has(adapter.domain)) {
    logger.warn({ domain: adapter.domain }, 'Domain adapter 已存在，将被覆盖')
  }
  domainAdapters.set(adapter.domain, adapter)
  logger.info({ domain: adapter.domain }, 'Domain authorization adapter 已注册')
}

/**
 * 获取已注册的 domain adapter。
 */
export function getDomainAdapter(domain: string): DomainAuthorizationAdapter | undefined {
  return domainAdapters.get(domain)
}

/**
 * 获取所有已注册 domain 列表。
 */
export function getRegisteredDomains(): string[] {
  return Array.from(domainAdapters.keys())
}

// =============================================================================
// Stream Registry 操作
// =============================================================================

/**
 * 在注册表中创建或获取 stream 条目。
 */
export function getOrCreateStream(
  streamId: string,
  domain: string,
  organizationId: number,
): StreamRegistryEntry {
  const key = registryKey(streamId, domain)
  const existing = streamRegistry.get(key)
  if (existing) {
    return existing
  }

  const entry: StreamRegistryEntry = {
    streamId,
    domain,
    organizationId,
    createdAt: Date.now(),
    maxSequence: 0,
    subscriberSocketIds: [],
    lastActivityAt: Date.now(),
    terminal: false,
  }
  streamRegistry.set(key, entry)
  return entry
}

/**
 * 验证 streamId 的合法性（非空、不包含敏感模式、长度合理）。
 */
export function isValidStreamId(streamId: string): boolean {
  if (!streamId || streamId.length === 0) return false
  if (streamId.length > 256) return false
  // streamId 不应包含敏感关键字
  const forbidden = /[<>{}()\\]/
  if (forbidden.test(streamId)) return false
  return true
}

/**
 * 生成注册表内部 key（stream:domain 格式）。
 */
function registryKey(streamId: string, domain: string): string {
  return `${streamId}:${domain}`
}

/**
 * 构建服务端推导的 stream room 名。
 * 客户端不得提供原始 room 名（design D2）。
 */
export function buildStreamRoom(organizationId: number, domain: string, streamId: string): string {
  return `${STREAM_ROOM_PREFIX}:${organizationId}:${domain}:${streamId}`
}

/**
 * 将 socket 加入 stream room。
 */
export function joinStreamRoom(socketId: string, room: string): void {
  const io = getSocketIo()
  if (!io) return
  const socket = io.sockets.sockets.get(socketId)
  if (socket) {
    socket.join(room)
  }
}

/**
 * 将 socket 从 stream room 移除。
 */
export function leaveStreamRoom(socketId: string, room: string): void {
  const io = getSocketIo()
  if (!io) return
  const socket = io.sockets.sockets.get(socketId)
  if (socket) {
    socket.leave(room)
  }
}

/**
 * 在注册表中增加订阅者计数。
 */
export function addSubscriber(streamId: string, domain: string, socketId: string): boolean {
  const entry = streamRegistry.get(registryKey(streamId, domain))
  if (!entry) return false
  if (entry.subscriberSocketIds.length >= MAX_SUBSCRIBERS_PER_STREAM) {
    return false
  }
  if (!entry.subscriberSocketIds.includes(socketId)) {
    entry.subscriberSocketIds.push(socketId)
  }
  entry.lastActivityAt = Date.now()
  return true
}

/**
 * 在注册表中移除订阅者。
 */
export function removeSubscriber(streamId: string, domain: string, socketId: string): void {
  const entry = streamRegistry.get(registryKey(streamId, domain))
  if (!entry) return
  entry.subscriberSocketIds = entry.subscriberSocketIds.filter((id) => id !== socketId)
  entry.lastActivityAt = Date.now()
  if (entry.subscriberSocketIds.length === 0) {
    // 无订阅者时移除注册表条目
    streamRegistry.delete(registryKey(streamId, domain))
  }
}

/**
 * 获取注册表统计信息（低敏）。
 */
export function getStreamRegistryStats(): {
  activeStreams: number
  totalSubscriptions: number
} {
  let totalSubscriptions = 0
  for (const entry of streamRegistry.values()) {
    totalSubscriptions += entry.subscriberSocketIds.length
  }
  return {
    activeStreams: streamRegistry.size,
    totalSubscriptions,
  }
}

// =============================================================================
// 订阅授权
// =============================================================================

/**
 * 验证用户是否有权订阅指定 stream。
 *
 * 流程：
 * 1. 查找 domain adapter
 * 2. adapter 验证用户对 streamId 代表资源的访问权限
 * 3. adapter 返回授权结果
 *
 * @returns 授权结果
 */
export async function authorizeSubscription(
  userId: number,
  organizationId: number,
  domain: string,
  streamId: string,
): Promise<DomainAuthorizationResult> {
  // 检查 domain 是否注册
  const adapter = domainAdapters.get(domain)
  if (!adapter) {
    return {
      allowed: false,
      reasonCode: 'UNKNOWN_DOMAIN',
      reasonMessage: `Stream domain "${domain}" is not registered.`,
    }
  }

  // 检查 streamId 合法性
  if (!isValidStreamId(streamId)) {
    return {
      allowed: false,
      reasonCode: 'INVALID_STREAM_ID',
      reasonMessage: 'Stream ID is invalid.',
    }
  }

  // 委托 adapter 授权
  try {
    return await adapter.authorize(userId, organizationId, streamId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn({ domain, streamId, userId, error: message }, 'Domain authorization adapter 异常')
    return {
      allowed: false,
      reasonCode: 'AUTHORIZATION_ERROR',
      reasonMessage: 'Authorization check failed.',
    }
  }
}

// =============================================================================
// Replay 与 Reset-required
// =============================================================================

/**
 * 尝试从事件源获取 replay 事件。
 * 实现基于事件 store 接口，默认走现有 REST-backed 事件源。
 * 若 replay 不可用（保留窗口过期/契约不兼容），返回 reset-required。
 *
 * TODO-DEBT: REPLAY-EVENT-STORE —— 当前使用内存事件列表，
 * 后续 change 接入 CompilerStageEvent Model 或专用事件 store。
 */
export async function getReplayResponse(
  streamId: string,
  domain: string,
  lastSequence: number,
  _contractVersion: string,
): Promise<any> {
  const key = replayStoreKey(streamId, domain)
  const entry = replayEventStore.get(key)
  if (!entry) {
    return {
      streamId,
      domain,
      resetRequired: true,
      events: [],
      resetMessage: 'REPLAY_WINDOW_EXPIRED: No stored events for this stream.',
    }
  }
  const events = entry.events.filter((e: any) => e.sequence > lastSequence)
  if (events.length === 0) {
    return { streamId, domain, resetRequired: false, events: [], lastSequence: null }
  }
  const continuation = events[0].sequence === lastSequence + 1
  if (!continuation && lastSequence > 0) {
    return {
      streamId,
      domain,
      resetRequired: true,
      events: [],
      resetMessage: 'SEQUENCE_GAP: Missing intermediate events.',
    }
  }
  return {
    streamId,
    domain,
    resetRequired: false,
    events,
    lastSequence: events[events.length - 1]?.sequence ?? null,
  }
}

// =============================================================================
// Replay Event Store
// =============================================================================

/** In-memory event store for replay */
const replayEventStore = new Map<string, { events: any[]; storedAt: number }>()
const DEFAULT_REPLAY_RETENTION_MS = 5 * 60 * 1000 // 5 minutes

export function storeReplayEvent(
  streamId: string,
  domain: string,
  _organizationId: number,
  envelope: any,
): void {
  const key = replayStoreKey(streamId, domain)
  if (!replayEventStore.has(key)) {
    replayEventStore.set(key, { events: [], storedAt: Date.now() })
  }
  const entry = replayEventStore.get(key)!
  entry.events.push(envelope)
  // Trim to maxReplayEvents
  if (entry.events.length > 500) {
    entry.events = entry.events.slice(-500)
  }
}

export function clearExpiredReplayEvents(): void {
  const now = Date.now()
  for (const [key, entry] of replayEventStore.entries()) {
    if (now - entry.storedAt > DEFAULT_REPLAY_RETENTION_MS) {
      replayEventStore.delete(key)
    }
  }
}

function replayStoreKey(streamId: string, domain: string): string {
  return `${streamId}:${domain}`
}

/**
 * 生成 reset-required 事件。
 * 当 replay 窗口过期、契约不兼容或其他不可恢复错误时调用。
 */
export function createResetRequiredEvent(
  streamId: string,
  reasonCode: string,
): {
  streamId: string
  reasonCode: string
  reasonMessage: string
} {
  return {
    streamId,
    reasonCode,
    reasonMessage: `Stream requires reset: ${reasonCode.toLowerCase().replace(/_/g, ' ')}.`,
  }
}

// =============================================================================
// Publish Helpers
// =============================================================================

/**
 * 向 stream 订阅者发布统一的 StreamingProgressEnvelope。
 * best-effort 广播：失败不抛给调用方，不影响 REST 写入。
 *
 * @param organizationId 组织 ID
 * @param domain 领域名
 * @param streamId 流 ID
 * @param envelope 进度信封
 */
export function publishProgressEnvelope(
  organizationId: number,
  domain: string,
  streamId: string,
  envelope: StreamingProgressEnvelope,
): void {
  if (!isStreamingWsEnabled()) return

  try {
    const io = getSocketIo()
    if (!io) return

    // 验证 payload 安全
    const safety = validateEventSafety(envelope)
    if (!safety.safe) {
      logger.warn(
        { streamId, domain, issues: safety.issues },
        'Streaming envelope 含敏感字段，已拒绝广播',
      )
      return
    }

    const room = buildStreamRoom(organizationId, domain, streamId)
    io.to(room).emit('stream:event', envelope)

    // 存储事件以支持 replay
    storeReplayEvent(streamId, domain, organizationId, envelope)

    // 更新注册表 sequence
    const entry = streamRegistry.get(registryKey(streamId, domain))
    if (entry) {
      entry.maxSequence = Math.max(entry.maxSequence, envelope.sequence)
      entry.lastActivityAt = Date.now()
    }

    logger.debug(
      { streamId, domain, sequence: envelope.sequence, room },
      'Streaming envelope 已广播',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn(
      { streamId, domain, error: message },
      'Streaming envelope 广播失败（旁路，不影响 REST 写入）',
    )
  }
}

/**
 * 向 stream 订阅者发布低敏实时日志事件。
 * best-effort 广播：失败不抛给调用方。
 */
export function publishRealtimeLog(
  organizationId: number,
  domain: string,
  streamId: string,
  logEvent: RealtimeLogEvent,
): void {
  if (!isStreamingWsEnabled()) return

  try {
    const io = getSocketIo()
    if (!io) return

    // 验证日志字段：只允许 allowlist 字段
    const allowedFields = new Set([
      'streamId',
      'stageId',
      'phase',
      'attempt',
      'severity',
      'messageCode',
      'count',
      'durationMs',
      'safeRefs',
      'hash',
      'timestamp',
    ])
    for (const key of Object.keys(logEvent)) {
      if (!allowedFields.has(key)) {
        logger.warn({ streamId, field: key }, '实时日志包含非 allowlist 字段，已拒绝')
        return
      }
    }

    const room = buildStreamRoom(organizationId, domain, streamId)
    io.to(room).emit('stream:log', logEvent)

    logger.debug(
      { streamId, stageId: logEvent.stageId, messageCode: logEvent.messageCode },
      '实时日志已广播',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn({ streamId, domain, error: message }, '实时日志广播失败（旁路）')
  }
}

/**
 * 发送 reset-required 事件到指定 socket。
 * 客户端收到后必须走 REST/SSE/status snapshot 获取权威状态。
 */
export function sendResetRequired(socketId: string, streamId: string, reasonCode: string): void {
  try {
    const io = getSocketIo()
    if (!io) return

    const socket = io.sockets.sockets.get(socketId)
    if (!socket) return

    socket.emit('stream:reset-required', {
      streamId,
      reasonCode,
      reasonMessage: createResetRequiredEvent(streamId, reasonCode).reasonMessage,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    logger.warn({ streamId, error: message }, '发送 reset-required 失败')
  }
}

// =============================================================================
// 健康与诊断
// =============================================================================

/**
 * 获取 Streaming WebSocket Service 诊断信息（低敏，不含 payload/token/secret）。
 */
export function getStreamingServiceDiagnostics(): {
  status: 'ok' | 'degraded' | 'unavailable'
  activeStreams: number
  activeSubscriptions: number
  registeredDomains: string[]
  enabled: boolean
} {
  const config = getStreamingWsConfig()
  if (!config.enabled) {
    return {
      status: 'unavailable',
      activeStreams: 0,
      activeSubscriptions: 0,
      registeredDomains: [],
      enabled: false,
    }
  }

  const stats = getStreamRegistryStats()
  return {
    status: 'ok',
    activeStreams: stats.activeStreams,
    activeSubscriptions: stats.totalSubscriptions,
    registeredDomains: getRegisteredDomains(),
    enabled: true,
  }
}

// =============================================================================
// 清理
// =============================================================================

/**
 * 清理 stream 注册表中所有属于指定 socket 的订阅。
 * 在 socket 断开时调用。
 */
export function cleanupSocketSubscriptions(socketId: string): void {
  for (const [key, entry] of streamRegistry.entries()) {
    if (entry.subscriberSocketIds.includes(socketId)) {
      entry.subscriberSocketIds = entry.subscriberSocketIds.filter((id) => id !== socketId)
      if (entry.subscriberSocketIds.length === 0) {
        streamRegistry.delete(key)
      }
    }
  }
}
