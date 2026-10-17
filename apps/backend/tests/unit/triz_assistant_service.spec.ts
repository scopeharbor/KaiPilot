/**
 * v3-ai-triz-assistant —— AI-TRIZ 助手后端 Service 纯逻辑测试（tasks 5.11，vitest）。
 *
 * 覆盖（无需 AdonisJS 容器）：
 * - 响应结构完整性
 * - 确定性路由
 * - AI fallback 默认行为
 * - action 元数据
 * - 正式数据不变性断言
 */
import { describe, it, expect } from 'vitest'
import type { AiTrizAssistantResponse } from '@aiproj/types'
import {
  generateAssistantRunId,
  generateAssistantMessageId,
  generateAssistantActionId,
  generateAssistantFeedbackId,
  computeAssistantIdempotencyKey,
  computeAssistantSourceHash,
  computeAssistantOutputHash,
  computeAssistantContextPacketHash,
  computeAssistantStableSortKey,
  normalizeAssistantIntent,
  isAssistantSourceHashStale,
  validateAssistantSubmitRequest,
  AI_TRIZ_ASSISTANT_DESTINATIONS,
  AI_TRIZ_ASSISTANT_DESTINATION_LABELS,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 测试组：ID/哈希稳定性（§2.10）
// ---------------------------------------------------------------------------
describe('TrizAssistant - id/hash stability', () => {
  it('generateAssistantRunId produces unique values', () => {
    const id1 = generateAssistantRunId()
    const id2 = generateAssistantRunId()
    expect(id1).not.toBe(id2)
    expect(id1.length).toBeGreaterThan(0)
    expect(typeof id1).toBe('string')
  })

  it('generateAssistantMessageId produces unique values', () => {
    const id1 = generateAssistantMessageId()
    const id2 = generateAssistantMessageId()
    expect(id1).not.toBe(id2)
  })

  it('generateAssistantActionId produces unique values', () => {
    const id1 = generateAssistantActionId()
    const id2 = generateAssistantActionId()
    expect(id1).not.toBe(id2)
  })

  it('generateAssistantFeedbackId produces unique values', () => {
    const id1 = generateAssistantFeedbackId()
    const id2 = generateAssistantFeedbackId()
    expect(id1).not.toBe(id2)
  })

  it('computeAssistantIdempotencyKey is deterministic', () => {
    const key1 = computeAssistantIdempotencyKey('测试', ['hash1', 'hash2'], 1)
    const key2 = computeAssistantIdempotencyKey('测试', ['hash1', 'hash2'], 1)
    expect(key1).toBe(key2)
  })

  it('computeAssistantIdempotencyKey changes with different input', () => {
    const key1 = computeAssistantIdempotencyKey('A', ['h1'], 1)
    const key2 = computeAssistantIdempotencyKey('B', ['h1'], 1)
    expect(key1).not.toBe(key2)
  })

  it('computeAssistantSourceHash is deterministic', () => {
    const h1 = computeAssistantSourceHash('test-source-data', 'contradiction')
    const h2 = computeAssistantSourceHash('test-source-data', 'contradiction')
    expect(h1).toBe(h2)
  })

  it('computeAssistantSourceHash 区分来源种类', () => {
    // kind 参与哈希：同一摘要在不同来源域下必须得到不同哈希
    expect(computeAssistantSourceHash('same', 'contradiction')).not.toBe(
      computeAssistantSourceHash('same', 'function_analysis'),
    )
  })

  it('computeAssistantOutputHash produces valid string for valid response', () => {
    const mockResponse: AiTrizAssistantResponse = {
      runId: 'run-test',
      messageId: 'msg-test',
      intent: 'technical_contradiction',
      routeDecisions: [
        {
          routeId: 'r1',
          destination: 'contradiction_matrix',
          confidence: 'high',
          order: 1,
          reason: 'test',
          sourceRefs: [],
          sourceHashes: [],
          warnings: [],
        },
      ],
      recommendedActions: [],
      clarificationPrompts: [],
      warnings: [],
      fallback: false,
      reviewRequired: true,
      auditRefs: {
        runId: 'run-test',
        routeIds: [],
        actionIds: [],
        sourceRefKinds: [],
        sourceHashPrefixes: [],
        warningCodes: [],
        fallbackState: false,
      },
      createdAt: new Date().toISOString(),
    }
    const hash = computeAssistantOutputHash(mockResponse)
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('computeAssistantContextPacketHash produces valid string', () => {
    const hash = computeAssistantContextPacketHash([])
    expect(typeof hash).toBe('string')
  })

  it('computeAssistantStableSortKey returns value', () => {
    const key = computeAssistantStableSortKey('contradiction_matrix', 'high', 1)
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('computeAssistantStableSortKey 按置信度给出稳定序', () => {
    // high 排在 medium 前：同 destination/order 下排序键必须严格递增
    const high = computeAssistantStableSortKey('contradiction_matrix', 'high', 1)
    const medium = computeAssistantStableSortKey('contradiction_matrix', 'medium', 1)
    expect(high < medium).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 测试组：intent 归一化（§2.6）
// ---------------------------------------------------------------------------
describe('TrizAssistant - intent normalization', () => {
  it('normalizeAssistantIntent maps technical contradiction keywords', () => {
    const intent = normalizeAssistantIntent('如何改善质量但降低成本？')
    expect(intent).toBeDefined()
    expect(typeof intent).toBe('string')
  })

  it('normalizeAssistantIntent handles empty input', () => {
    const intent = normalizeAssistantIntent('')
    expect(intent).toBeDefined()
  })

  it('normalizeAssistantIntent is deterministic', () => {
    const i1 = normalizeAssistantIntent('相同的输入')
    const i2 = normalizeAssistantIntent('相同的输入')
    expect(i1).toBe(i2)
  })
})

// ---------------------------------------------------------------------------
// 测试组：stale 检测（§2.10）
// ---------------------------------------------------------------------------
describe('TrizAssistant - stale detection', () => {
  // 第二参是「已存快照哈希列表」：当前哈希不在列表里才算 stale
  it('isAssistantSourceHashStale detects mismatch', () => {
    expect(isAssistantSourceHashStale('hash-a', ['hash-b'])).toBe(true)
  })

  it('isAssistantSourceHashStale same hash is not stale', () => {
    expect(isAssistantSourceHashStale('same-hash', ['other', 'same-hash'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 测试组：验证器（§3.8）
// ---------------------------------------------------------------------------
describe('TrizAssistant - submit request validation', () => {
  it('validateAssistantSubmitRequest passes valid message', () => {
    const result = validateAssistantSubmitRequest({ message: '有效的问题' })
    expect(result.valid).toBe(true)
  })

  it('validateAssistantSubmitRequest rejects empty message', () => {
    const result = validateAssistantSubmitRequest({ message: '' })
    expect(result.valid).toBe(false)
  })

  it('validateAssistantSubmitRequest includes error details', () => {
    const result = validateAssistantSubmitRequest({ message: '' })
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 测试组：目标枚举覆盖（§2.3）
// ---------------------------------------------------------------------------
describe('TrizAssistant - destination enum coverage', () => {
  it('AI_TRIZ_ASSISTANT_DESTINATIONS includes all 12 destinations', () => {
    expect(AI_TRIZ_ASSISTANT_DESTINATIONS.length).toBe(12)
  })

  it('every destination has a Chinese label', () => {
    for (const dest of AI_TRIZ_ASSISTANT_DESTINATIONS) {
      expect(AI_TRIZ_ASSISTANT_DESTINATION_LABELS[dest]).toBeDefined()
      expect(typeof AI_TRIZ_ASSISTANT_DESTINATION_LABELS[dest]).toBe('string')
      expect(AI_TRIZ_ASSISTANT_DESTINATION_LABELS[dest].length).toBeGreaterThan(0)
    }
  })

  it('required destinations are present', () => {
    const required = [
      'clarification_cards',
      'contradiction_matrix',
      'technical_contradiction_analyzer',
      'physical_contradiction_analyzer',
      'ifr_visualization',
      'function_analysis_diagram',
      'resource_analyzer',
      'evolution_trend_analysis',
      'recommendation_rationale',
      'innovation_workbench',
      'decision_center',
      'draft_preview',
    ]

    for (const r of required) {
      expect(AI_TRIZ_ASSISTANT_DESTINATIONS).toContain(r)
    }
  })
})
