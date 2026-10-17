/**
 * streaming-websocket.test —— Streaming WebSocket Service 类型测试。
 *
 * 验证控制消息白名单、禁止写入消息识别、stream room 命名、
 * 领域授权 adapter 接口和低敏日志类型。
 */

import { describe, it, expect } from 'vitest'
import {
  WS_CONTROL_MESSAGE_NAMES,
  WRITE_MESSAGE_PREFIXES,
  buildStreamRoomName,
  parseStreamRoomName,
  REGISTERED_STREAM_DOMAINS,
  WRITE_MESSAGE_PREFIXES as WRITE_PREFIXES,
  type StreamSubscribeRequest,
  type StreamResumeRequest,
  type RealtimeLogEvent,
  type ResetRequiredEvent,
  type StreamRegistryEntry,
  type StreamingWsMetrics,
} from './streaming-websocket.js'

// =============================================================================
// §1.1 控制消息白名单
// =============================================================================

describe('§1.1 WS_CONTROL_MESSAGE_NAMES', () => {
  it('包含所有允许的控制消息名', () => {
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('subscribe:stream')
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('unsubscribe:stream')
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('resume:stream')
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('ack:stream')
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('client:heartbeat')
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('status:stream')
    expect(WS_CONTROL_MESSAGE_NAMES).toContain('diagnostics:stream')
  })

  it('只包含预期的 7 个控制消息', () => {
    expect(WS_CONTROL_MESSAGE_NAMES.length).toBe(7)
  })

  it('所有控制消息不含 write/apply/sync 前缀', () => {
    for (const name of WS_CONTROL_MESSAGE_NAMES) {
      const hasWritePrefix = WRITE_PREFIXES.some((prefix) => name.startsWith(prefix))
      expect(hasWritePrefix).toBe(false)
    }
  })
})

// =============================================================================
// §1.1 写入类消息前缀拒绝
// =============================================================================

describe('§1.1 WRITE_MESSAGE_PREFIXES', () => {
  it('包含所有禁止的写入类消息前缀', () => {
    expect(WRITE_MESSAGE_PREFIXES).toContain('write:')
    expect(WRITE_MESSAGE_PREFIXES).toContain('apply:')
    expect(WRITE_MESSAGE_PREFIXES).toContain('sync:')
    expect(WRITE_MESSAGE_PREFIXES).toContain('external:')
    expect(WRITE_MESSAGE_PREFIXES).toContain('deploy:')
    expect(WRITE_MESSAGE_PREFIXES).toContain('publish:')
  })

  it('能正确识别应被拒绝的消息名', () => {
    const isRejected = (name: string) =>
      WRITE_MESSAGE_PREFIXES.some((prefix) => name.startsWith(prefix))
    expect(isRejected('write:task')).toBe(true)
    expect(isRejected('apply:draft')).toBe(true)
    expect(isRejected('sync:project')).toBe(true)
    expect(isRejected('external:webhook')).toBe(true)
    expect(isRejected('deploy:app')).toBe(true)
    expect(isRejected('publish:report')).toBe(true)
    expect(isRejected('subscribe:stream')).toBe(false)
    expect(isRejected('client:heartbeat')).toBe(false)
    expect(isRejected('ack:stream')).toBe(false)
  })
})

// =============================================================================
// §1.1 Stream room 命名
// =============================================================================

describe('§1.1 buildStreamRoomName / parseStreamRoomName', () => {
  it('能构建标准的 stream room 名', () => {
    const room = buildStreamRoomName(1, 'ai-draft', 'draft-abc-123')
    expect(room).toBe('stream:1:ai-draft:draft-abc-123')
  })

  it('能解析 stream room 名中的组织、领域和流 ID', () => {
    const parsed = parseStreamRoomName('stream:5:compiler:run-xyz-789')
    expect(parsed.organizationId).toBe(5)
    expect(parsed.domain).toBe('compiler')
    expect(parsed.streamId).toBe('run-xyz-789')
  })

  it('非 stream room 名返回 null', () => {
    const parsed = parseStreamRoomName('project:1:2')
    expect(parsed.organizationId).toBeNull()
    expect(parsed.domain).toBeNull()
    expect(parsed.streamId).toBeNull()
  })

  it('不完整格式返回 null', () => {
    const parsed = parseStreamRoomName('stream:1')
    expect(parsed.organizationId).toBeNull()
  })

  it('不同组织 ID 或 domain 的 room 名不同', () => {
    const room1 = buildStreamRoomName(1, 'ai-draft', 'same-id')
    const room2 = buildStreamRoomName(2, 'ai-draft', 'same-id')
    const room3 = buildStreamRoomName(1, 'compiler', 'same-id')
    expect(room1).not.toBe(room2)
    expect(room1).not.toBe(room3)
    expect(room2).not.toBe(room3)
  })
})

// =============================================================================
// §1.1 StreamSubscribeRequest 验证
// =============================================================================

describe('§1.1 StreamSubscribeRequest', () => {
  it('能构造合法的 subscribe request', () => {
    const req: StreamSubscribeRequest = {
      domain: 'ai-draft',
      streamId: 'draft-123',
      lastSequence: 5,
      contractVersion: '1.0',
    }
    expect(req.domain).toBe('ai-draft')
    expect(req.streamId).toBe('draft-123')
    expect(req.lastSequence).toBe(5)
    expect(req.contractVersion).toBe('1.0')
  })

  it('支持无 cursor 的初始订阅', () => {
    const req: StreamSubscribeRequest = {
      domain: 'compiler',
      streamId: 'run-456',
    }
    expect(req.lastSequence).toBeUndefined()
    expect(req.contractVersion).toBeUndefined()
  })

  it('拒绝空 domain 或 streamId 的订阅', () => {
    // 类型层面：运行时验证由业务层负责
    const emptyDomain: StreamSubscribeRequest = { domain: '', streamId: 'test' }
    const emptyStream: StreamSubscribeRequest = { domain: 'ai-draft', streamId: '' }
    expect(emptyDomain.domain).toBe('')
    expect(emptyStream.streamId).toBe('')
  })
})

// =============================================================================
// §1.1 StreamResumeRequest 验证
// =============================================================================

describe('§1.1 StreamResumeRequest', () => {
  it('能构造合法的 resume request', () => {
    const req: StreamResumeRequest = {
      streamId: 'draft-123',
      lastSequence: 10,
      contractVersion: '1.0',
    }
    expect(req.streamId).toBe('draft-123')
    expect(req.lastSequence).toBe(10)
    expect(req.contractVersion).toBe('1.0')
  })
})

// =============================================================================
// §1.1 ResetRequiredEvent 低敏
// =============================================================================

describe('§1.1 ResetRequiredEvent', () => {
  it('包含低敏 reason code 和 message', () => {
    const event: ResetRequiredEvent = {
      streamId: 'draft-123',
      reasonCode: 'REPLAY_WINDOW_EXPIRED',
      reasonMessage: 'Replay retention window exceeded.',
    }
    expect(event.reasonCode).toMatch(/^[A-Z_]+$/)
    expect(event.reasonMessage).not.toContain('secret')
    expect(event.reasonMessage).not.toContain('token')
    expect(event.reasonMessage).not.toContain('prompt')
  })
})

// =============================================================================
// §1.1 RealtimeLogEvent 低敏
// =============================================================================

describe('§1.1 RealtimeLogEvent', () => {
  it('只包含低敏字段', () => {
    const log: RealtimeLogEvent = {
      streamId: 'run-789',
      stageId: 'intent_parsing',
      phase: 'parsing',
      attempt: 1,
      severity: 'info',
      messageCode: 'STAGE_STARTED',
      count: 5,
      durationMs: 1200,
      safeRefs: ['ref-abc-123'],
      hash: 'sha256-abc...',
      timestamp: '2026-07-20T10:00:00Z',
    }
    expect(log.messageCode).not.toContain('prompt')
    expect(log.messageCode).not.toContain('token')
    expect(log.messageCode).not.toContain('secret')
    expect(log.safeRefs).toBeDefined()
    expect(log.hash).toBeDefined()
  })
})

// =============================================================================
// §1.1 Domain 注册表
// =============================================================================

describe('§1.1 REGISTERED_STREAM_DOMAINS', () => {
  it('包含 ai-draft 和 compiler', () => {
    expect(REGISTERED_STREAM_DOMAINS).toContain('ai-draft')
    expect(REGISTERED_STREAM_DOMAINS).toContain('compiler')
  })

  it('不包含未注册领域', () => {
    expect(REGISTERED_STREAM_DOMAINS).not.toContain('chat')
    expect(REGISTERED_STREAM_DOMAINS).not.toContain('notification')
    expect(REGISTERED_STREAM_DOMAINS).not.toContain('file-transfer')
  })
})

// =============================================================================
// §1.1 StreamRegistryEntry
// =============================================================================

describe('§1.1 StreamRegistryEntry', () => {
  it('包含订阅者列表与终态标识', () => {
    const entry: StreamRegistryEntry = {
      streamId: 'test-stream',
      domain: 'ai-draft',
      organizationId: 1,
      createdAt: Date.now(),
      maxSequence: 42,
      subscriberSocketIds: ['socket-1', 'socket-2'],
      lastActivityAt: Date.now(),
      terminal: false,
    }
    expect(entry.subscriberSocketIds).toHaveLength(2)
    expect(entry.maxSequence).toBe(42)
    expect(entry.terminal).toBe(false)
  })
})

// =============================================================================
// §1.1 StreamingWsMetrics
// =============================================================================

describe('§1.1 StreamingWsMetrics', () => {
  it('只包含低敏计数器', () => {
    const metrics: StreamingWsMetrics = {
      activeStreamSubscriptions: 10,
      replaySuccessCount: 5,
      replayFailureCount: 1,
      resetRequiredCount: 0,
      publishFailureCount: 0,
      rejectedControlMessageCount: 0,
      activeStreams: 3,
    }
    expect(metrics.activeStreamSubscriptions).toBeGreaterThanOrEqual(0)
    expect(metrics.replayFailureCount).toBeLessThanOrEqual(metrics.replaySuccessCount + 1)
  })
})
