import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_MODEL_CONTEXT_LIMITS,
  estimateAiModelCatalogCost,
  resolveAiModelContextLimits,
  resolveOutputTokenLimit,
} from './ai-model-catalog.js'

describe('AI model catalog shared contract', () => {
  it('calculates priced, cache, audio, and included reasoning components', () => {
    const estimate = estimateAiModelCatalogCost({
      usage: {
        inputTokens: 1000,
        outputTokens: 2000,
        cacheReadTokens: 500,
        cacheWriteTokens: 200,
        inputAudioTokens: 10,
        reasoningTokens: 300,
      },
      cost: {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.075,
        cacheWrite: 0.2,
        inputAudio: 40,
        outputAudio: null,
        reasoning: null,
        contextOver200k: null,
        tiers: null,
      },
      currency: 'USD',
    })

    expect(estimate.currency).toBe('USD')
    expect(estimate.estimatedCost).toBe(0.001828)
    expect(estimate.hasUnknownComponent).toBe(false)
    expect(estimate.components.find((component) => component.kind === 'reasoning')).toMatchObject({
      state: 'included',
      cost: 0,
    })
  })

  it('keeps partial input/output pricing usable when optional detail prices are absent', () => {
    const estimate = estimateAiModelCatalogCost({
      usage: { inputTokens: 1000, outputAudioTokens: 50 },
      cost: {
        input: 0.15,
        output: 0.6,
        cacheRead: null,
        cacheWrite: null,
        inputAudio: null,
        outputAudio: null,
        reasoning: null,
        contextOver200k: null,
        tiers: null,
      },
    })

    expect(estimate.estimatedCost).toBe(0.00015)
    expect(estimate.hasUnknownComponent).toBe(false)
    expect(
      estimate.components.find((component) => component.kind === 'output_audio'),
    ).toMatchObject({
      state: 'included',
      cost: 0,
    })
  })

  it('does not charge reasoning tokens twice when output already includes them', () => {
    const estimate = estimateAiModelCatalogCost({
      usage: { inputTokens: 1000, outputTokens: 2000, reasoningTokens: 300 },
      cost: {
        input: 0.15,
        output: 0.6,
        cacheRead: null,
        cacheWrite: null,
        inputAudio: null,
        outputAudio: null,
        reasoning: 3,
        contextOver200k: null,
        tiers: null,
      },
    })

    expect(estimate.estimatedCost).toBe(0.00207)
    expect(estimate.components.find((component) => component.kind === 'output')?.tokens).toBe(1700)
    expect(estimate.components.find((component) => component.kind === 'reasoning')).toMatchObject({
      tokens: 300,
      state: 'priced',
    })
  })

  it('clamps requested output tokens to configured model limit', () => {
    expect(resolveOutputTokenLimit({ requested: 8192, configured: 4096, fallback: 2048 })).toBe(
      4096,
    )
    expect(resolveOutputTokenLimit({ requested: 8192, configured: 4096, fallback: 16384 })).toBe(
      4096,
    )
    expect(resolveOutputTokenLimit({ requested: null, configured: null, fallback: 4096 })).toBe(
      4096,
    )
  })

  it('uses 1M defaults and conservatively fills missing catalog input limits', () => {
    expect(resolveAiModelContextLimits()).toEqual(DEFAULT_AI_MODEL_CONTEXT_LIMITS)
    expect(resolveAiModelContextLimits({ context: 128_000, output: 16_384 })).toEqual({
      contextWindowTokens: 128_000,
      maxInputTokens: 111_616,
      maxOutputTokens: 16_384,
    })
    expect(
      resolveAiModelContextLimits({ context: 1_000_000, input: 950_000, output: 32_000 }),
    ).toEqual({
      contextWindowTokens: 1_000_000,
      maxInputTokens: 950_000,
      maxOutputTokens: 32_000,
    })
  })
})
