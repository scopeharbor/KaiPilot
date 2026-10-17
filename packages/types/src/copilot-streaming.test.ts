/**
 * v3-copilot-live-streaming-output —— 流式事件契约测试。
 *
 * 纯本地离线：零网络、零 provider、零时钟/随机源。
 */

import { describe, it, expect } from 'vitest'
import {
  boundCopilotStreamDelta,
  COPILOT_STREAM_DELTA_MAX_LENGTH,
  COPILOT_STREAM_SEQUENCE_START,
  copilotStreamFindForbiddenPayloadKeys,
  copilotStreamHasForbiddenPayloadKeys,
  findCopilotStreamSequenceViolation,
  isCopilotStreamEventType,
  isCopilotStreamTerminalEventType,
  type CopilotStreamEvent,
} from './copilot-streaming.js'

describe('copilot-streaming', () => {
  // ── 事件类型 ──

  it('六类事件类型均被识别', () => {
    for (const type of [
      'turn-meta',
      'answer-delta',
      'answer-done',
      'turn-clarify',
      'turn-route',
      'turn-error',
    ]) {
      expect(isCopilotStreamEventType(type)).toBe(true)
    }
    expect(isCopilotStreamEventType('chunk')).toBe(false)
    expect(isCopilotStreamEventType('random')).toBe(false)
  })

  it('终态事件类型为四类', () => {
    for (const type of ['answer-done', 'turn-clarify', 'turn-route', 'turn-error']) {
      expect(isCopilotStreamTerminalEventType(type)).toBe(true)
    }
    expect(isCopilotStreamTerminalEventType('answer-delta')).toBe(false)
    expect(isCopilotStreamTerminalEventType('turn-meta')).toBe(false)
  })

  it('事件形状携带序列号与类型', () => {
    const meta: CopilotStreamEvent = {
      type: 'turn-meta',
      sequence: 1,
      sessionId: 's1',
      destinations: ['general_qa'],
      intentSummary: '查询项目状态',
      scope: 'project',
    }
    const delta: CopilotStreamEvent = {
      type: 'answer-delta',
      sequence: 2,
      delta: '项目进展正常',
    }
    expect(meta.type).toBe('turn-meta')
    expect(delta.type).toBe('answer-delta')
  })

  // ── 序列号校验 ──

  it('单调递增序列通过校验', () => {
    const events = [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }]
    expect(findCopilotStreamSequenceViolation(events)).toBeNull()
  })

  it('从 1 起始', () => {
    expect(COPILOT_STREAM_SEQUENCE_START).toBe(1)
    expect(findCopilotStreamSequenceViolation([{ sequence: 0 }])).not.toBeNull()
  })

  it('非递增序列被检出', () => {
    const events = [{ sequence: 1 }, { sequence: 2 }, { sequence: 2 }]
    const violation = findCopilotStreamSequenceViolation(events)
    expect(violation).not.toBeNull()
    expect(violation?.index).toBe(2)
  })

  it('非整数或小于起点的序列被检出', () => {
    expect(findCopilotStreamSequenceViolation([{ sequence: 1.5 }])).not.toBeNull()
    expect(findCopilotStreamSequenceViolation([{ sequence: -1 }])).not.toBeNull()
  })

  // ── 增量有界化 ──

  it('短增量原样返回', () => {
    expect(boundCopilotStreamDelta('你好')).toBe('你好')
  })

  it('超长增量被截断到上界', () => {
    const long = 'x'.repeat(COPILOT_STREAM_DELTA_MAX_LENGTH + 100)
    const bounded = boundCopilotStreamDelta(long)
    expect(bounded.length).toBe(COPILOT_STREAM_DELTA_MAX_LENGTH)
  })

  // ── 禁存约束 ──

  it('含 prompt/全文/token 键被检出为禁止', () => {
    const event = {
      type: 'answer-delta',
      sequence: 1,
      delta: 'x',
      rawText: '禁止携带全文',
    }
    const found = copilotStreamFindForbiddenPayloadKeys(event)
    expect(found).toContain('rawText')
    expect(copilotStreamHasForbiddenPayloadKeys(event)).toBe(true)
  })

  it('合法事件无禁止键（大小写不敏感）', () => {
    const event = {
      type: 'turn-meta',
      sequence: 1,
      sessionId: 's1',
      destinations: ['general_qa'],
      intentSummary: '查询',
      scope: 'project',
      AuthorizationHeader: '不应存在的键名也按小写命中',
    }
    expect(copilotStreamFindForbiddenPayloadKeys(event)).toContain('AuthorizationHeader')
  })

  it('正常领域事件的载荷不误报', () => {
    const event = {
      type: 'answer-done',
      sequence: 5,
      assistantMessageId: 'cpm_1',
      contentSummary: '摘要',
    }
    expect(copilotStreamHasForbiddenPayloadKeys(event)).toBe(false)
  })
})
