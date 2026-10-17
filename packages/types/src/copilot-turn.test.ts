/**
 * v3-copilot-live-submission-channel —— 回合契约测试。
 *
 * 覆盖任务 2.6（禁存负例）、2.8（字段集合一致）、
 * 4.14/4.15 幂等键确定性、8.1/8.5 估算确定性、2.4 上界执行。
 */

import { describe, it, expect } from 'vitest'
import {
  COPILOT_ROUTING_RECORD_FIELDS,
  COPILOT_TURN_BYTES_PER_TOKEN,
  COPILOT_TURN_MAX_MENTION_REFS,
  COPILOT_TURN_MODES,
  COPILOT_TURN_OVERHEAD_TOKENS,
  COPILOT_TURN_SUMMARY_MAX_LENGTH,
  COPILOT_TURN_TEXT_MAX_LENGTH,
  boundedTurnSummary,
  containsForbiddenTurnPayload,
  deriveTurnIdempotencyKey,
  deriveTurnMetrics,
  estimateTurnTokens,
  toRoutingDecisionRecord,
  utf8ByteLength,
  validateTurnRequestShape,
} from './copilot-turn.js'
import {
  COPILOT_TURN_FIXTURE_REF_TASK,
  COPILOT_TURN_FIXTURE_REF_CROSS_ORG,
  COPILOT_TURN_FIXTURE_REQUEST_SLASH,
  COPILOT_TURN_FIXTURE_REQUEST_MENTION,
  COPILOT_TURN_FIXTURE_RESPONSE_DEMONSTRATION,
  COPILOT_TURN_FIXTURE_RESPONSE_LEDGER_DEGRADED,
  COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES,
} from './copilot-turn-fixtures.js'
import { COPILOT_WARNING_CODES } from './copilot-shared-contracts.js'
import type { CopilotRoutingDecisionRecordSimple } from './copilot-intent-router.js'

const SIMPLE_RECORD: CopilotRoutingDecisionRecordSimple = {
  recordId: 'rec-0001',
  catalogVersion: '1.0.0',
  intentClass: 'analysis',
  subIntentId: 'a.delay_attribution',
  intentSummary: '任务延期归因',
  destinationOrder: ['project.predictions', 'project.gantt'],
  confidences: [92, 71],
  clarificationRoundCount: 0,
  ambiguous: false,
  unavailabilityKinds: ['not-enabled'],
  ruleHitCount: 1,
  fallbackCount: 0,
  userRerouted: false,
  scope: 'project',
}

describe('回合禁存约束（2.5 / 2.6）', () => {
  it('干净响应不触发禁存判定', () => {
    expect(
      containsForbiddenTurnPayload(
        COPILOT_TURN_FIXTURE_RESPONSE_LEDGER_DEGRADED,
        COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES,
      ),
    ).toBe(false)
  })

  it('敏感样本出现在任一字段即不合规', () => {
    for (const sample of COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES) {
      const polluted = {
        ...COPILOT_TURN_FIXTURE_RESPONSE_LEDGER_DEGRADED,
        intentSummary: sample,
      }
      expect(containsForbiddenTurnPayload(polluted, COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES)).toBe(
        true,
      )
    }
  })

  it('禁存键名出现即不合规，无需给出样本', () => {
    expect(containsForbiddenTurnPayload({ prompt: '任意' })).toBe(true)
    expect(containsForbiddenTurnPayload({ model_output: '任意' })).toBe(true)
    expect(containsForbiddenTurnPayload({ apiKey: '任意' })).toBe(true)
    expect(containsForbiddenTurnPayload({ intentSummary: '任意' })).toBe(false)
  })

  it('有界摘要截断到上界且确定性', () => {
    const long = '甲'.repeat(COPILOT_TURN_SUMMARY_MAX_LENGTH + 200)
    const first = boundedTurnSummary(long)
    const second = boundedTurnSummary(long)
    expect(first.length).toBe(COPILOT_TURN_SUMMARY_MAX_LENGTH)
    expect(first).toBe(second)
  })

  it('有界摘要去除首尾空白且不改动界内文本', () => {
    expect(boundedTurnSummary('  排期调整  ')).toBe('排期调整')
  })
})

describe('路由决策记录显式转换（2.7 / 2.8）', () => {
  it('转换保留每个字段的值', () => {
    const record = toRoutingDecisionRecord(SIMPLE_RECORD)
    for (const field of COPILOT_ROUTING_RECORD_FIELDS) {
      expect(record[field]).toEqual(SIMPLE_RECORD[field])
    }
  })

  it('转换结果字段集合与声明列表全等，任一侧增删即失败', () => {
    const record = toRoutingDecisionRecord(SIMPLE_RECORD)
    expect(Object.keys(record).sort()).toEqual([...COPILOT_ROUTING_RECORD_FIELDS].sort())
    expect(Object.keys(SIMPLE_RECORD).sort()).toEqual([...COPILOT_ROUTING_RECORD_FIELDS].sort())
  })

  it('转换不引入额外键', () => {
    const record = toRoutingDecisionRecord(SIMPLE_RECORD)
    expect(Object.keys(record)).toHaveLength(COPILOT_ROUTING_RECORD_FIELDS.length)
  })
})

describe('回合幂等键（4.14）', () => {
  it('同输入同键', () => {
    const params = {
      normalizedText: '为什么延期',
      sessionId: 'sess-1',
      slashCommand: undefined,
      mentions: [COPILOT_TURN_FIXTURE_REF_TASK],
      actorId: 5,
    }
    expect(deriveTurnIdempotencyKey(params)).toBe(deriveTurnIdempotencyKey({ ...params }))
  })

  it('引用顺序不同不改变键（排序后参与推导）', () => {
    const base = {
      normalizedText: '为什么延期',
      sessionId: 'sess-1',
      mentions: [COPILOT_TURN_FIXTURE_REF_TASK, COPILOT_TURN_FIXTURE_REF_CROSS_ORG],
      actorId: 5,
    }
    const reversed = { ...base, mentions: [...base.mentions].reverse() }
    expect(deriveTurnIdempotencyKey(base)).toBe(deriveTurnIdempotencyKey(reversed))
  })

  it('斜杠命令不同则键不同', () => {
    const base = { normalizedText: '新增风险', sessionId: null, mentions: [], actorId: 5 }
    expect(deriveTurnIdempotencyKey({ ...base, slashCommand: '/risk' })).not.toBe(
      deriveTurnIdempotencyKey({ ...base, slashCommand: '/task' }),
    )
  })

  it('actor 不同则键不同', () => {
    const base = { normalizedText: '新增风险', sessionId: null, mentions: [] }
    expect(deriveTurnIdempotencyKey({ ...base, actorId: 5 })).not.toBe(
      deriveTurnIdempotencyKey({ ...base, actorId: 6 }),
    )
  })
})

describe('回合观测指标（4.21）', () => {
  it('ruleHitRate 为 ruleHitCount / (ruleHitCount + fallbackCount)，保留三位小数', () => {
    const metrics = deriveTurnMetrics({
      stats: { ruleHitCount: 2, fallbackCount: 1 },
      durationMs: 123,
      routedDestinationCount: 3,
    })
    expect(metrics.durationMs).toBe(123)
    expect(metrics.ruleHitRate).toBe(0.667)
    expect(metrics.routedDestinationCount).toBe(3)
  })

  it('分母为 0 时 ruleHitRate 为 0 而非 NaN', () => {
    const metrics = deriveTurnMetrics({
      stats: { ruleHitCount: 0, fallbackCount: 0 },
      durationMs: 50,
      routedDestinationCount: 1,
    })
    expect(Number.isNaN(metrics.ruleHitRate)).toBe(false)
    expect(metrics.ruleHitRate).toBe(0)
  })

  it('负耗时与负条数被钳为 0（输出恒为非负整数）', () => {
    const metrics = deriveTurnMetrics({
      stats: { ruleHitCount: 1, fallbackCount: 0 },
      durationMs: -5.4,
      routedDestinationCount: -2,
    })
    expect(metrics.durationMs).toBe(0)
    expect(metrics.routedDestinationCount).toBe(0)
  })

  it('同输入同输出（确定性纯函数，不读时钟）', () => {
    const params = {
      stats: { ruleHitCount: 3, fallbackCount: 2 },
      durationMs: 777,
      routedDestinationCount: 4,
    } as const
    expect(deriveTurnMetrics(params)).toEqual(deriveTurnMetrics(params))
  })

  it('全部规则命中时 ruleHitRate 为 1', () => {
    const metrics = deriveTurnMetrics({
      stats: { ruleHitCount: 5, fallbackCount: 0 },
      durationMs: 10,
      routedDestinationCount: 2,
    })
    expect(metrics.ruleHitRate).toBe(1)
  })
})

describe('TPM 输入侧估算（8.1 / 8.5）', () => {
  it('估算为确定性纯函数', () => {
    const params = { normalizedText: '帮我把排期往后推三天', contextBytes: 4096 }
    expect(estimateTurnTokens(params)).toBe(estimateTurnTokens({ ...params }))
  })

  it('估算随输入增长单调不减', () => {
    const small = estimateTurnTokens({ normalizedText: '短', contextBytes: 0 })
    const large = estimateTurnTokens({ normalizedText: '短'.repeat(100), contextBytes: 0 })
    expect(large).toBeGreaterThan(small)
  })

  it('估算含固定开销且不小于开销值', () => {
    expect(estimateTurnTokens({ normalizedText: '', contextBytes: 0 })).toBe(
      COPILOT_TURN_OVERHEAD_TOKENS,
    )
  })

  it('非法 contextBytes 归零而非产出 NaN', () => {
    expect(estimateTurnTokens({ normalizedText: '甲', contextBytes: Number.NaN })).toBe(
      COPILOT_TURN_OVERHEAD_TOKENS + Math.ceil(3 / COPILOT_TURN_BYTES_PER_TOKEN),
    )
  })

  it('UTF-8 字节长度对中文与 ASCII 分别正确', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('甲')).toBe(3)
    expect(utf8ByteLength('甲乙')).toBe(6)
  })
})

describe('请求形状上界（2.4）', () => {
  it('合规请求无违规', () => {
    expect(validateTurnRequestShape(COPILOT_TURN_FIXTURE_REQUEST_SLASH)).toEqual([])
    expect(validateTurnRequestShape(COPILOT_TURN_FIXTURE_REQUEST_MENTION)).toEqual([])
  })

  it('空文本报 empty', () => {
    expect(validateTurnRequestShape({ text: '   ', mentions: [] })).toEqual([
      { field: 'text', reason: 'empty' },
    ])
  })

  it('超长文本报 too-long', () => {
    expect(
      validateTurnRequestShape({
        text: '甲'.repeat(COPILOT_TURN_TEXT_MAX_LENGTH + 1),
        mentions: [],
      }),
    ).toEqual([{ field: 'text', reason: 'too-long' }])
  })

  it('引用超上界报 too-many', () => {
    const many = Array.from({ length: COPILOT_TURN_MAX_MENTION_REFS + 1 }, (_, i) => ({
      ...COPILOT_TURN_FIXTURE_REF_TASK,
      entityId: i + 1,
    }))
    expect(validateTurnRequestShape({ text: '甲', mentions: many })).toEqual([
      { field: 'mentions', reason: 'too-many' },
    ])
  })

  it('空斜杠命令报 empty', () => {
    expect(validateTurnRequestShape({ text: '甲', mentions: [], slashCommand: '  ' })).toEqual([
      { field: 'slashCommand', reason: 'empty' },
    ])
  })
})

describe('降级契约', () => {
  it('演示态 fixture 标注 mode 为 demonstration 且无 destination', () => {
    expect(COPILOT_TURN_FIXTURE_RESPONSE_DEMONSTRATION.mode).toBe('demonstration')
    expect(COPILOT_TURN_FIXTURE_RESPONSE_DEMONSTRATION.destinations).toEqual([])
  })

  it('落账降级告警码已登记于共享枚举', () => {
    expect(COPILOT_WARNING_CODES).toContain('ROUTING_LEDGER_DEGRADED')
  })

  it('落账降级时 mode 仍为 live（观察层降级不改变回合成败）', () => {
    expect(COPILOT_TURN_FIXTURE_RESPONSE_LEDGER_DEGRADED.mode).toBe('live')
    expect(COPILOT_TURN_FIXTURE_RESPONSE_LEDGER_DEGRADED.warnings).toContain(
      'ROUTING_LEDGER_DEGRADED',
    )
  })

  it('回合模式枚举恰两态', () => {
    expect([...COPILOT_TURN_MODES]).toEqual(['live', 'demonstration'])
  })
})
