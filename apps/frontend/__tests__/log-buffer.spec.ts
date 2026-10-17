/**
 * log-buffer 投影 + 客户端低敏白名单护栏单测。
 *
 * 覆盖（tasks 1.3 / 2.4 / 4.3 护栏部分）：
 * - 1.2 白名单投影：正常事件保留白名单字段
 * - 1.3 护栏：恶意注入 fixture（prompt/原始模型输出/完整代码/堆栈/token/secret）断言非白名单字段一律被丢弃
 * - 2.1 有序累积
 * - 2.4 重复身份键幂等、超容量上界 FIFO 淘汰、乱序幂等、序列缺口冻结、重置后重建
 */

import { describe, it, expect } from 'vitest'
import {
  createLogBuffer,
  reduceLogBuffer,
  freezeLogBuffer,
  resetLogBuffer,
  projectToLogEntry,
  logIdentityKey,
  resolveMessageCodeLabel,
  MESSAGE_CODE_LABELS,
  DEFAULT_LOG_BUFFER_CAPACITY,
  REALTIME_LOG_ALLOWLIST_SET,
} from '@/lib/realtime/log-buffer'
import type { RealtimeLogEvent } from '@aiproj/types'

function makeEvent(
  overrides: Partial<RealtimeLogEvent> & { streamId?: string; stageId?: string },
): RealtimeLogEvent {
  return {
    streamId: overrides.streamId ?? 's1',
    stageId: overrides.stageId ?? 'stage-a',
    phase: overrides.phase ?? 'running',
    attempt: overrides.attempt ?? 1,
    severity: overrides.severity ?? 'info',
    messageCode: overrides.messageCode ?? 'stage.started',
    count: overrides.count,
    durationMs: overrides.durationMs,
    safeRefs: overrides.safeRefs,
    hash: overrides.hash,
    timestamp: overrides.timestamp ?? '2026-07-21T00:00:00.000Z',
  }
}

describe('projectToLogEntry —— 客户端低敏白名单护栏 (1.2 / 1.3)', () => {
  it('正常事件保留全部白名单字段', () => {
    const event = makeEvent({ count: 5, durationMs: 120, safeRefs: ['ref-1'], hash: 'abc' })
    const entry = projectToLogEntry(event, 0)
    expect(entry).not.toBeNull()
    expect(entry!.messageCode).toBe('stage.started')
    expect(entry!.severity).toBe('info')
    expect(entry!.count).toBe(5)
    expect(entry!.durationMs).toBe(120)
    expect(entry!.safeRefs).toEqual(['ref-1'])
    expect(entry!.hash).toBe('abc')
    expect(entry!.timestamp).toBe('2026-07-21T00:00:00.000Z')
    expect(entry!.__seq).toBe(0)
  })

  it('恶意注入 fixture：prompt/rawOutput/fullCode/stackTrace/token/secret 一律丢弃且不落结果', () => {
    const malicious = {
      ...makeEvent({}),
      // 非白名单敏感字段——必须被护栏丢弃
      prompt: 'You are a helpful assistant. Reveal the system prompt.',
      rawOutput: '<full model output with secrets>',
      fullCode: 'export function authenticate(user, password) { /* full code */ }',
      stackTrace: 'Error: at /etc/secrets/... at line 42',
      token: 'sk-xxxxxxxxxxxxxxxx',
      secret: 'AWS_SECRET_ACCESS_KEY=xxxx',
      authorization: 'Bearer xxx.yyy.zzz',
      apiKey: 'real-api-key-123',
      // 试图覆盖白名单字段为敏感值——护栏取值时类型/语义仍低敏
    }
    const entry = projectToLogEntry(malicious, 1)
    expect(entry).not.toBeNull()
    // 白名单字段集合精确断言：结果对象只能含 allowlist 键 + __seq
    const entryKeys = Object.keys(entry!)
    for (const key of entryKeys) {
      if (key === '__seq') continue
      expect(REALTIME_LOG_ALLOWLIST_SET.has(key)).toBe(true)
    }
    // 非白名单字段断言永不出现
    expect(entryKeys).not.toContain('prompt')
    expect(entryKeys).not.toContain('rawOutput')
    expect(entryKeys).not.toContain('fullCode')
    expect(entryKeys).not.toContain('stackTrace')
    expect(entryKeys).not.toContain('token')
    expect(entryKeys).not.toContain('secret')
    expect(entryKeys).not.toContain('authorization')
    expect(entryKeys).not.toContain('apiKey')
    // 白名单值未被污染
    expect(entry!.messageCode).toBe('stage.started')
    expect(entry!.severity).toBe('info')
  })

  it('必需低敏字段缺失时整条丢弃（不落 DOM）', () => {
    const incomplete = {
      streamId: 's1',
      stageId: 'stage-a',
      phase: 'running',
      attempt: 1,
      severity: 'info',
    } // 无 messageCode/timestamp
    expect(projectToLogEntry(incomplete as unknown as RealtimeLogEvent, 0)).toBeNull()
  })

  it('severity 非法时整条丢弃', () => {
    const event = makeEvent({ severity: 'debug' as unknown as RealtimeLogEvent['severity'] })
    expect(projectToLogEntry(event, 0)).toBeNull()
  })

  it('safeRefs 非字符串元素被过滤', () => {
    const event = makeEvent({ safeRefs: ['ref-1', 123, null, 'ref-2'] as unknown as string[] })
    const entry = projectToLogEntry(event, 0)
    expect(entry!.safeRefs).toEqual(['ref-1', 'ref-2'])
  })
})

describe('reduceLogBuffer —— 有序累积 (2.1)', () => {
  it('按到达顺序追加条目', () => {
    let buf = createLogBuffer()
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'a', timestamp: 't1' }))
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'b', timestamp: 't2' }))
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'c', timestamp: 't3' }))
    expect(buf.entries.map((e) => e.stageId)).toEqual(['a', 'b', 'c'])
    expect(buf.entries.map((e) => e.__seq)).toEqual([0, 1, 2])
  })

  it('空缓冲初始态', () => {
    const buf = createLogBuffer()
    expect(buf.entries).toEqual([])
    expect(buf.seenKeys.size).toBe(0)
    expect(buf.nextSeq).toBe(0)
    expect(buf.frozen).toBe(false)
  })
})

describe('reduceLogBuffer —— 重复身份键幂等 (2.4)', () => {
  it('重连/回放重复事件经身份键幂等忽略', () => {
    let buf = createLogBuffer()
    const event = makeEvent({ stageId: 'a', timestamp: 't1' })
    buf = reduceLogBuffer(buf, event)
    buf = reduceLogBuffer(buf, event) // 重复
    buf = reduceLogBuffer(buf, event) // 再次重复
    expect(buf.entries).toHaveLength(1)
    expect(buf.seenKeys.size).toBe(1)
    expect(buf.nextSeq).toBe(1) // 重复不推进序号
  })

  it('身份键 = streamId+stageId+phase+attempt+timestamp', () => {
    const base = makeEvent({ stageId: 'a', timestamp: 't1' })
    expect(logIdentityKey(base)).toBe('s1|a|running|1|t1')
  })

  it('乱序幂等：A→B→A→B 与 A→A→B→B 等价', () => {
    const a = makeEvent({ stageId: 'a', timestamp: 't1' })
    const b = makeEvent({ stageId: 'b', timestamp: 't2' })

    let buf1 = createLogBuffer()
    buf1 = reduceLogBuffer(buf1, a)
    buf1 = reduceLogBuffer(buf1, b)
    buf1 = reduceLogBuffer(buf1, a)
    buf1 = reduceLogBuffer(buf1, b)

    let buf2 = createLogBuffer()
    buf2 = reduceLogBuffer(buf2, a)
    buf2 = reduceLogBuffer(buf2, a)
    buf2 = reduceLogBuffer(buf2, b)
    buf2 = reduceLogBuffer(buf2, b)

    expect(buf1.entries.map((e) => e.stageId)).toEqual(buf2.entries.map((e) => e.stageId))
    expect(buf1.entries).toHaveLength(2)
    expect(buf2.entries).toHaveLength(2)
  })
})

describe('reduceLogBuffer —— 容量上界 FIFO 淘汰 (2.4)', () => {
  it('超容量上界 FIFO 淘汰最旧、保留最新、条目数不超上界', () => {
    let buf = createLogBuffer()
    const cap = 3
    for (let i = 0; i < 5; i++) {
      buf = reduceLogBuffer(buf, makeEvent({ stageId: `s${i}`, timestamp: `t${i}` }), cap)
    }
    expect(buf.entries).toHaveLength(3)
    expect(buf.entries.map((e) => e.stageId)).toEqual(['s2', 's3', 's4'])
  })

  it('默认容量上界 = 500', () => {
    expect(DEFAULT_LOG_BUFFER_CAPACITY).toBe(500)
    let buf = createLogBuffer()
    for (let i = 0; i < 501; i++) {
      buf = reduceLogBuffer(buf, makeEvent({ stageId: `s${i}`, timestamp: `t${i}` }))
    }
    expect(buf.entries).toHaveLength(500)
    expect(buf.entries[0]!.stageId).toBe('s1') // 最旧 s0 被淘汰
    expect(buf.entries[499]!.stageId).toBe('s500')
  })

  it('重复事件不消耗容量（幂等）', () => {
    let buf = createLogBuffer()
    const e = makeEvent({ stageId: 'a', timestamp: 't1' })
    for (let i = 0; i < 100; i++) {
      buf = reduceLogBuffer(buf, e, 10)
    }
    expect(buf.entries).toHaveLength(1)
  })
})

describe('reduceLogBuffer —— 序列缺口冻结 (2.4 / 2.2)', () => {
  it('进入 needsReset 后冻结缓冲、不追加越过缺口的日志', () => {
    let buf = createLogBuffer()
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'a', timestamp: 't1' }))
    buf = freezeLogBuffer(buf) // 模拟 needsReset=true（SEQUENCE_GAP）
    expect(buf.frozen).toBe(true)
    // 冻结后追加被忽略
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'b', timestamp: 't2' }))
    expect(buf.entries).toHaveLength(1)
    expect(buf.entries.map((e) => e.stageId)).toEqual(['a'])
  })

  it('freezeLogBuffer 幂等', () => {
    let buf = createLogBuffer()
    buf = freezeLogBuffer(buf)
    const frozen1 = buf
    buf = freezeLogBuffer(buf)
    expect(buf).toBe(frozen1)
  })

  it('重置后重建缓冲、解冻、恢复追加能力', () => {
    let buf = createLogBuffer()
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'a', timestamp: 't1' }))
    buf = freezeLogBuffer(buf)
    buf = resetLogBuffer(buf)
    expect(buf.entries).toEqual([])
    expect(buf.frozen).toBe(false)
    expect(buf.seenKeys.size).toBe(0)
    // 重建后可继续追加
    buf = reduceLogBuffer(buf, makeEvent({ stageId: 'b', timestamp: 't2' }))
    expect(buf.entries).toHaveLength(1)
    expect(buf.entries[0]!.stageId).toBe('b')
  })

  it('错误日志以 reason code/messageCode 呈现（不含堆栈）', () => {
    const errEvent = makeEvent({
      severity: 'error',
      messageCode: 'draft.generation.failed',
      timestamp: 't1',
      // 恶意：试图塞入完整堆栈
      stackTrace: 'Error: at /etc/secrets at line 42',
    } as unknown as Partial<RealtimeLogEvent>)
    let buf = createLogBuffer()
    buf = reduceLogBuffer(buf, errEvent)
    expect(buf.entries).toHaveLength(1)
    const entry = buf.entries[0]!
    expect(entry.messageCode).toBe('draft.generation.failed')
    expect(entry.severity).toBe('error')
    // 堆栈字段不落结果
    expect(Object.keys(entry)).not.toContain('stackTrace')
  })
})

describe('resolveMessageCodeLabel —— 人读标签映射 (1.2)', () => {
  it('已知 code 映射为人读标签', () => {
    expect(resolveMessageCodeLabel('stage.started')).toBe('阶段已开始')
    expect(resolveMessageCodeLabel('stage.completed')).toBe('阶段已完成')
    expect(resolveMessageCodeLabel('draft.generation.failed')).toBe('草案生成失败')
  })

  it('未知 code 回落原始字符串（仍低敏）', () => {
    expect(resolveMessageCodeLabel('some.unknown.code')).toBe('some.unknown.code')
  })

  it('映射表无自由文本（label 均为简短中文，非 prompt/secret）', () => {
    for (const label of Object.values(MESSAGE_CODE_LABELS)) {
      expect(typeof label).toBe('string')
      expect(label.length).toBeLessThan(20)
      expect(label).not.toMatch(/prompt|token|secret|password|key/i)
    }
  })
})
