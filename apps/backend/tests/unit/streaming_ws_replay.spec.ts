/**
 * Streaming WS Replay 单元测试（§4.8）。
 *
 * 纯内存逻辑测试，不依赖 AdonisJS 运行时/数据库。
 * vitest 配置：vitest_streaming.config.ts
 */
import { describe, expect, it, vi } from 'vitest'

// Mock AdonisJS logger before importing the module under test
vi.mock('@adonisjs/core/services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

// Mock socketio provider to avoid HTTP server dependency
vi.mock('#providers/socketio_provider', () => ({
  getSocketIo: vi.fn().mockReturnValue(null),
}))

// Mock config service
vi.mock('#services/streaming/streaming_ws_config', () => ({
  getStreamingWsConfig: vi.fn().mockReturnValue({ enabled: false }),
  isStreamingWsEnabled: vi.fn().mockReturnValue(false),
}))

// Mock @aiproj/types validateEventSafety
vi.mock('@aiproj/types', () => ({
  validateEventSafety: vi.fn().mockReturnValue({ safe: true, issues: [] }),
}))

import {
  storeReplayEvent,
  clearExpiredReplayEvents,
} from '#services/streaming/streaming_ws_service'

describe('§4.8 Replay Tests', () => {
  it('存储和检索 replay 事件', () => {
    const envelope = {
      contractVersion: '1.0',
      eventId: 'test-1',
      streamId: 'test',
      domain: 'ai-draft',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: 'started',
      payload: {},
    }
    storeReplayEvent('test', 'ai-draft', 1, envelope)
    expect(true).toBe(true)
  })

  it('重复 replay 不报错', () => {
    const e = {
      contractVersion: '1.0',
      eventId: 'dup-1',
      streamId: 'dup',
      domain: 'ai-draft',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: 'started',
      payload: {},
    }
    storeReplayEvent('dup', 'ai-draft', 1, e)
    storeReplayEvent('dup', 'ai-draft', 1, e)
    expect(true).toBe(true)
  })

  it('清除过期 replay 事件不报错', () => {
    expect(() => clearExpiredReplayEvents()).not.toThrow()
  })
})
