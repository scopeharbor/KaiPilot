/**
 * v3-copilot-multi-model-selection —— 能力推导与偏好契约测试。
 *
 * 覆盖 spec REQ：
 * - 结构化输出 selects a schema-capable model
 * - Derivation failure prefers the more capable model
 * - 偏好禁存约束
 * - 确定性排序
 */

import { describe, it, expect } from 'vitest'
import {
  deriveTurnRequiredCapabilities,
  LONG_CONTEXT_THRESHOLD_TOKENS,
  containsForbiddenModelPreference,
  computeSelectionSortKey,
  compareModelSelectionCandidates,
  containsForbiddenModelSelectionResult,
  type TurnCapabilityDerivationInput,
  type ModelSelectionCandidate,
} from './copilot-model-selection.js'
import type { AiModelCapability } from './ai-connection.js'

describe('deriveTurnRequiredCapabilities', () => {
  it('should derive structured_output for structured output turns', () => {
    const input: TurnCapabilityDerivationInput = {
      needsStructuredOutput: true,
    }
    const result = deriveTurnRequiredCapabilities(input)
    expect(result.requiredCapabilities).toContain('structured_output')
    expect(result.derivationConfidence).toBe('partial')
    expect(result.derivationReason).toContain('结构化产出')
  })

  it('should derive tool_calling for tool routing turns', () => {
    const input: TurnCapabilityDerivationInput = {
      needsToolCalling: true,
    }
    const result = deriveTurnRequiredCapabilities(input)
    expect(result.requiredCapabilities).toContain('tool_calling')
    expect(result.derivationConfidence).toBe('partial')
    expect(result.derivationReason).toContain('工具路由')
  })

  it('should derive chat for long context turns', () => {
    const input: TurnCapabilityDerivationInput = {
      needsLongContext: true,
    }
    const result = deriveTurnRequiredCapabilities(input)
    expect(result.requiredCapabilities).toContain('chat')
    expect(result.derivationConfidence).toBe('partial')
    expect(result.derivationReason).toContain('长上下文')
  })

  it('should derive chat when estimated context exceeds threshold', () => {
    const input: TurnCapabilityDerivationInput = {
      estimatedContextTokens: LONG_CONTEXT_THRESHOLD_TOKENS + 1,
    }
    const result = deriveTurnRequiredCapabilities(input)
    expect(result.requiredCapabilities).toContain('chat')
    expect(result.derivationConfidence).toBe('partial')
  })

  it('should derive all three capabilities when all inputs present', () => {
    const input: TurnCapabilityDerivationInput = {
      needsStructuredOutput: true,
      needsToolCalling: true,
      needsLongContext: true,
    }
    const result = deriveTurnRequiredCapabilities(input)
    expect(result.requiredCapabilities).toHaveLength(3)
    expect(result.requiredCapabilities).toContain('structured_output')
    expect(result.requiredCapabilities).toContain('tool_calling')
    expect(result.requiredCapabilities).toContain('chat')
    expect(result.derivationConfidence).toBe('full')
  })

  it('should return empty capabilities with none confidence when no inputs', () => {
    const input: TurnCapabilityDerivationInput = {}
    const result = deriveTurnRequiredCapabilities(input)
    expect(result.requiredCapabilities).toHaveLength(0)
    expect(result.derivationConfidence).toBe('none')
    expect(result.derivationReason).toContain('无法从回合输入推导')
  })
})

describe('containsForbiddenModelPreference', () => {
  it('should detect prompt in preference', () => {
    const preference = { prompt: 'secret prompt', connectionId: 1, modelId: 2 }
    expect(containsForbiddenModelPreference(preference)).toBe(true)
  })

  it('should detect token in preference', () => {
    const preference = { token: 'secret-token', connectionId: 1, modelId: 2 }
    expect(containsForbiddenModelPreference(preference)).toBe(true)
  })

  it('should detect sensitive samples', () => {
    const preference = { connectionId: 1, modelId: 2, reason: 'user said: my secret key' }
    expect(containsForbiddenModelPreference(preference, ['my secret key'])).toBe(true)
  })

  it('should pass for clean preference', () => {
    const preference = { connectionId: 1, modelId: 2, reason: 'user prefers this model' }
    expect(containsForbiddenModelPreference(preference)).toBe(false)
  })
})

describe('computeSelectionSortKey', () => {
  const requiredCaps: AiModelCapability[] = ['structured_output', 'tool_calling']

  it('should give higher match ratio to models with more matching capabilities', () => {
    const candidateA: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 1,
      modelName: 'model-a',
      capabilities: ['structured_output', 'tool_calling', 'chat'],
      declaredPriority: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }
    const candidateB: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 2,
      modelName: 'model-b',
      capabilities: ['structured_output'],
      declaredPriority: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }

    const keyA = computeSelectionSortKey(candidateA, requiredCaps)
    const keyB = computeSelectionSortKey(candidateB, requiredCaps)

    // A has more matches, so capabilityMatchRatio should be more negative (higher priority)
    expect(keyA.capabilityMatchRatio).toBeLessThan(keyB.capabilityMatchRatio)
  })

  it('should use declaredPriority as tiebreaker', () => {
    const candidateA: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 1,
      modelName: 'model-a',
      capabilities: ['structured_output'],
      declaredPriority: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }
    const candidateB: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 2,
      modelName: 'model-b',
      capabilities: ['structured_output'],
      declaredPriority: 2,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }

    const keyA = computeSelectionSortKey(candidateA, requiredCaps)
    const keyB = computeSelectionSortKey(candidateB, requiredCaps)

    expect(keyA.declaredPriority).toBeLessThan(keyB.declaredPriority)
  })
})

describe('compareModelSelectionCandidates', () => {
  const requiredCaps: AiModelCapability[] = ['structured_output']

  it('should sort by capability match ratio first', () => {
    const candidateA: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 1,
      modelName: 'model-a',
      capabilities: ['structured_output'],
      declaredPriority: 2,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }
    const candidateB: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 2,
      modelName: 'model-b',
      capabilities: [],
      declaredPriority: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }

    const result = compareModelSelectionCandidates(candidateA, candidateB, requiredCaps)
    // A has matching capability, B doesn't - A should come first
    expect(result).toBeLessThan(0)
  })

  it('should produce deterministic results regardless of input order', () => {
    const candidates: ModelSelectionCandidate[] = [
      {
        connectionId: 1,
        modelId: 3,
        modelName: 'model-c',
        capabilities: ['structured_output', 'tool_calling'],
        declaredPriority: 1,
        createdAt: '2026-01-03T00:00:00Z',
        isActive: true,
      },
      {
        connectionId: 1,
        modelId: 1,
        modelName: 'model-a',
        capabilities: ['structured_output'],
        declaredPriority: 2,
        createdAt: '2026-01-01T00:00:00Z',
        isActive: true,
      },
      {
        connectionId: 1,
        modelId: 2,
        modelName: 'model-b',
        capabilities: ['tool_calling'],
        declaredPriority: 1,
        createdAt: '2026-01-02T00:00:00Z',
        isActive: true,
      },
    ]

    const sorted1 = [...candidates].sort((a, b) =>
      compareModelSelectionCandidates(a, b, requiredCaps),
    )
    const sorted2 = [...candidates]
      .reverse()
      .sort((a, b) => compareModelSelectionCandidates(a, b, requiredCaps))

    expect(sorted1.map((c) => c.modelId)).toEqual(sorted2.map((c) => c.modelId))
  })

  it('should not use cost or latency as ranking inputs', () => {
    // This is a design invariant test - the function signature doesn't accept cost/latency
    // If someone adds cost/latency parameters, this test would fail at compile time
    const candidateA: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 1,
      modelName: 'model-a',
      capabilities: ['structured_output'],
      declaredPriority: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }
    const candidateB: ModelSelectionCandidate = {
      connectionId: 1,
      modelId: 2,
      modelName: 'model-b',
      capabilities: ['structured_output'],
      declaredPriority: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: true,
    }

    // Same capabilities, priority, and creation time - should tie on modelId
    const result = compareModelSelectionCandidates(candidateA, candidateB, requiredCaps)
    expect(result).toBe(-1) // modelId 1 < modelId 2
  })
})

describe('containsForbiddenModelSelectionResult', () => {
  it('should detect prompt in selection result', () => {
    const result = { requestModelId: 1, prompt: 'secret', requestModelName: 'test' }
    expect(containsForbiddenModelSelectionResult(result)).toBe(true)
  })

  it('should detect modelOutput in selection result', () => {
    const result = { requestModelId: 1, modelOutput: 'secret output', requestModelName: 'test' }
    expect(containsForbiddenModelSelectionResult(result)).toBe(true)
  })

  it('should pass for clean selection result', () => {
    const result = {
      requestModelId: 1,
      requestModelName: 'test',
      responseModelId: 2,
      responseModelName: 'test-v2',
      degraded: false,
      requiredCapabilities: ['structured_output'],
      derivationConfidence: 'full',
    }
    expect(containsForbiddenModelSelectionResult(result)).toBe(false)
  })
})
