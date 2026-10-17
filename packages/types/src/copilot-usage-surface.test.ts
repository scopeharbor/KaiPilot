// packages/types/src/copilot-usage-surface.test.ts —— 用量与额度只读视图共享契约测试
// v3-copilot-usage-and-quota-surface §2.4, §2.7, §2.8

import { describe, it, expect } from 'vitest'

import {
  USAGE_SURFACE_FORBIDDEN_FIELDS,
  detectUsageSurfaceForbiddenFields,
  isCostEntryValid,
} from './copilot-usage-surface.js'

import {
  usageSurfaceFixture,
  usageSurfaceMissingSnapshotFixture,
  usageSurfaceMissingTimezoneFixture,
  usageSurfacePartialDimensionsFixture,
  usageSurfaceZeroUsageFixture,
} from './copilot-usage-surface-fixtures.js'

// ---------------------------------------------------------------------------
// §2.4 — 缺少快照标识时成本条目缺席（不显示裸数字）
// ---------------------------------------------------------------------------

describe('§2.4 cost entry without snapshot is suppressed', () => {
  it('isCostEntryValid rejects entries missing pricingSnapshotId', () => {
    expect(isCostEntryValid({ value: 0.01, currency: 'CNY', costBasis: 'estimate' })).toBe(false)
  })

  it('isCostEntryValid rejects entries missing costBasis', () => {
    expect(isCostEntryValid({ value: 0.01, currency: 'CNY', pricingSnapshotId: 'snap-1' })).toBe(
      false,
    )
  })

  it('isCostEntryValid rejects entries with empty pricingSnapshotId', () => {
    expect(
      isCostEntryValid({
        value: 0.01,
        currency: 'CNY',
        pricingSnapshotId: '',
        costBasis: 'estimate',
      }),
    ).toBe(false)
  })

  it('isCostEntryValid rejects entries with invalid costBasis', () => {
    expect(
      isCostEntryValid({
        value: 0.01,
        currency: 'CNY',
        pricingSnapshotId: 'snap-1',
        costBasis: 'unknown' as any,
      }),
    ).toBe(false)
  })

  it('isCostEntryValid accepts valid estimate entry', () => {
    expect(
      isCostEntryValid({
        value: 0.01,
        currency: 'CNY',
        pricingSnapshotId: 'snap-1',
        costBasis: 'estimate',
      }),
    ).toBe(true)
  })

  it('isCostEntryValid accepts valid billed entry', () => {
    expect(
      isCostEntryValid({
        value: 0.01,
        currency: 'USD',
        pricingSnapshotId: 'snap-2',
        costBasis: 'billed',
      }),
    ).toBe(true)
  })

  it('missing_snapshot fixture has null cost on dimensions (no bare numbers)', () => {
    const fixture = usageSurfaceMissingSnapshotFixture()
    for (const dim of fixture.dimensions) {
      expect(dim.cost).toBeNull()
    }
    expect(fixture.totalCost).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §2.7 — 敏感样本不出现在任一契约字段
// ---------------------------------------------------------------------------

describe('§2.7 sensitive samples absent from contract', () => {
  const sensitiveSamples: Array<[string, Record<string, unknown>]> = [
    ['prompt', { prompt: 'What is the meaning of life?' }],
    ['promptText', { promptText: 'System instructions here' }],
    ['systemInstructions', { systemInstructions: 'You are a helpful assistant' }],
    ['modelOutput', { modelOutput: 'The answer is 42' }],
    ['outputText', { outputText: 'Generated text here' }],
    ['tokenText', { tokenText: 'raw token content' }],
    ['secret', { secret: 'super-secret-value' }],
    ['apiKey', { apiKey: 'sk-1234567890' }],
    ['authorization', { authorization: 'Bearer token123' }],
    ['password', { password: 'hunter2' }],
    ['rawPayload', { rawPayload: { data: 'sensitive' } }],
    ['contextPacketRef', { contextPacketRef: 'ref-to-context' }],
    ['modelOutputRef', { modelOutputRef: 'ref-to-output' }],
  ]

  for (const [fieldName, sample] of sensitiveSamples) {
    it(`forbids field "${fieldName}" from appearing in contract`, () => {
      const hits = detectUsageSurfaceForbiddenFields(sample)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits).toContain(fieldName)
    })
  }

  it('detectUsageSurfaceForbiddenFields returns empty for clean objects', () => {
    const clean = {
      value: 0.01,
      currency: 'CNY',
      pricingSnapshotId: 'snap-1',
      costBasis: 'estimate',
    }
    const hits = detectUsageSurfaceForbiddenFields(clean)
    expect(hits).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §2.8 — 五态 fixtures 结构完整性
// ---------------------------------------------------------------------------

describe('§2.8 five-state fixtures', () => {
  const kinds = [
    'full_visibility',
    'partial_dimensions',
    'zero_usage',
    'missing_snapshot',
    'missing_timezone',
  ] as const

  for (const kind of kinds) {
    it(`${kind} fixture has required top-level fields`, () => {
      const fixture = usageSurfaceFixture(kind)
      expect(typeof fixture.organizationId).toBe('number')
      expect(fixture.window).toBeDefined()
      expect(typeof fixture.window.start).toBe('string')
      expect(typeof fixture.window.end).toBe('string')
      expect(typeof fixture.window.timezone).toBe('string')
      expect(typeof fixture.window.utcFallback).toBe('boolean')
      expect(Array.isArray(fixture.dimensions)).toBe(true)
      expect(Array.isArray(fixture.allowances)).toBe(true)
      expect(typeof fixture.totalCallCount).toBe('number')
      expect(typeof fixture.aggregatedAt).toBe('string')
      expect(fixture.topModels).toBeDefined()
      expect(Array.isArray(fixture.topModels.items)).toBe(true)
    })
  }

  it('missing_timezone fixture has utcFallback=true', () => {
    const fixture = usageSurfaceMissingTimezoneFixture()
    expect(fixture.window.utcFallback).toBe(true)
    expect(fixture.window.timezone).toBe('UTC')
  })

  it('partial_dimensions fixture has fewer dimensions than full_visibility', () => {
    const full = usageSurfaceFixture('full_visibility')
    const partial = usageSurfaceFixture('partial_dimensions')
    expect(partial.dimensions.length).toBeLessThan(full.dimensions.length)
  })

  it('zero_usage fixture has zero callCount and null cost', () => {
    const fixture = usageSurfaceZeroUsageFixture()
    expect(fixture.totalCallCount).toBe(0)
    expect(fixture.totalCost).toBeNull()
    expect(fixture.dimensions.length).toBe(0)
  })
})
