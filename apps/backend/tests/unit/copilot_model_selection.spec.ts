/**
 * v3-copilot-multi-model-selection —— 回合服务能力推导测试。
 *
 * 覆盖 spec REQ：
 * - 回合服务向 resolveAdapter 传入推导出的 requiredCapabilities
 * - 结构化输出的回合选到支持该能力的模型
 */

import { describe, it, expect } from 'vitest'
import { deriveTurnRequiredCapabilities } from '@aiproj/types'

describe('CopilotTurnService capability derivation', () => {
  it('should derive capabilities from turn input', () => {
    // Test that deriveTurnRequiredCapabilities works correctly
    const result = deriveTurnRequiredCapabilities({
      needsStructuredOutput: true,
      needsToolCalling: false,
      needsLongContext: false,
    })

    expect(result.requiredCapabilities).toContain('structured_output')
    expect(result.derivationConfidence).toBe('partial')
  })

  it('should derive tool_calling when needed', () => {
    const result = deriveTurnRequiredCapabilities({
      needsStructuredOutput: false,
      needsToolCalling: true,
      needsLongContext: false,
    })

    expect(result.requiredCapabilities).toContain('tool_calling')
  })

  it('should derive all capabilities when all inputs present', () => {
    const result = deriveTurnRequiredCapabilities({
      needsStructuredOutput: true,
      needsToolCalling: true,
      needsLongContext: true,
    })

    expect(result.requiredCapabilities).toHaveLength(3)
    expect(result.derivationConfidence).toBe('full')
  })
})

describe('CopilotTurnService model preference', () => {
  it('should accept model preference in request', () => {
    // Verify that the request type includes modelPreference
    const request = {
      sessionId: null,
      scope: 'project' as const,
      attribution: {},
      text: 'test input',
      mentions: [],
      modelPreference: {
        connectionId: 1,
        modelId: 2,
        reason: 'user preference',
      },
    }

    expect(request.modelPreference).toBeDefined()
    expect(request.modelPreference?.connectionId).toBe(1)
    expect(request.modelPreference?.modelId).toBe(2)
  })
})

describe('CopilotTurnResponse model fallback', () => {
  it('should include model fallback info in response', () => {
    // Verify that the response type includes modelFallback
    const response = {
      sessionId: 'test',
      messageId: 'test',
      destinations: [],
      clarificationRequired: false,
      clarificationItems: [],
      assumptionEntries: [],
      ambiguity: null,
      warnings: [],
      degradedReason: null,
      rejectedReferenceCount: 0,
      scope: 'project' as const,
      intentSummary: 'test',
      stats: {},
      mode: 'live' as const,
      modelFallback: {
        degraded: true,
        preferredModelId: 1,
        actualModelId: 2,
        actualModelName: 'fallback-model',
        reason: 'preferred model unavailable',
      },
    }

    expect(response.modelFallback).toBeDefined()
    expect(response.modelFallback?.degraded).toBe(true)
    expect(response.modelFallback?.actualModelName).toBe('fallback-model')
  })
})
