/**
 * copilot-context-chips 契约测试。
 *
 * 覆盖：
 * - 描述符必填完整性
 * - 可用性类别穷尽
 * - 未知值拒绝
 * - 记录脱敏（不含用户输入、prompt、模型输出、token 或 secret）
 */

import { describe, it, expect } from 'vitest'
import {
  type ChipDescriptor,
  type ChipExposureRecord,
  type ChipClickRecord,
  type ChipAvailabilityKind,
  type ChipSourceKind,
  type ChipClickSemantics,
  type ChipRelevanceTier,
  isChipSourceKind,
  isChipClickSemantics,
  isChipRelevanceTier,
  isChipAvailabilityKind,
  isValidChipDescriptor,
} from '../src/copilot-context-chips.js'
import {
  projectPageChips,
  taskPageChips,
  reportPageChips,
  globalScopeChips,
  permissionMissingChips,
  notEnabledChips,
  authorizationGatedChips,
  overflowChips,
  sampleExposureRecord,
  sampleClickRecord,
  sampleUnavailableExposureRecord,
} from '../src/copilot-context-chips-fixtures.js'

describe('copilot-context-chips', () => {
  describe('ChipDescriptor completeness', () => {
    it('should have all required fields for each fixture chip', () => {
      const allChips = [
        ...projectPageChips,
        ...taskPageChips,
        ...reportPageChips,
        ...globalScopeChips,
        ...permissionMissingChips,
        ...notEnabledChips,
        ...authorizationGatedChips,
        ...overflowChips,
      ]

      for (const chip of allChips) {
        expect(isValidChipDescriptor(chip)).toBe(true)
        expect(chip.id).toBeTruthy()
        expect(chip.label).toBeTruthy()
        expect(chip.destination).toBeTruthy()
        expect(Array.isArray(chip.requiredPermissions)).toBe(true)
        expect(chip.sortKey).toBeDefined()
        expect(chip.sortKey.relevanceTier).toBe(chip.relevanceTier)
        expect(chip.sortKey.impactSeverity).toBe(chip.impactSeverity)
      }
    })
  })

  describe('Availability kind exhaustiveness', () => {
    const availabilityKinds: ChipAvailabilityKind[] = [
      'available',
      'not-permitted',
      'not-enabled',
      'authorization-gated',
    ]

    it('should recognize all availability kinds', () => {
      for (const kind of availabilityKinds) {
        expect(isChipAvailabilityKind(kind)).toBe(true)
      }
    })

    it('should reject unknown availability kinds', () => {
      expect(isChipAvailabilityKind('unknown')).toBe(false)
      expect(isChipAvailabilityKind('')).toBe(false)
      expect(isChipAvailabilityKind(null)).toBe(false)
    })

    it('should have at least one fixture for each availability kind', () => {
      const kindsInFixtures = new Set<ChipAvailabilityKind>()
      const allChips = [
        ...projectPageChips,
        ...taskPageChips,
        ...reportPageChips,
        ...globalScopeChips,
        ...permissionMissingChips,
        ...notEnabledChips,
        ...authorizationGatedChips,
        ...overflowChips,
      ]
      for (const chip of allChips) {
        kindsInFixtures.add(chip.availabilityKind)
      }
      for (const kind of availabilityKinds) {
        expect(kindsInFixtures.has(kind)).toBe(true)
      }
    })
  })

  describe('Source kind exhaustiveness', () => {
    const sourceKinds: ChipSourceKind[] = ['registered-command', 'intent-catalog']

    it('should recognize all source kinds', () => {
      for (const kind of sourceKinds) {
        expect(isChipSourceKind(kind)).toBe(true)
      }
    })

    it('should reject unknown source kinds', () => {
      expect(isChipSourceKind('unknown')).toBe(false)
      expect(isChipSourceKind('')).toBe(false)
    })
  })

  describe('Click semantics exhaustiveness', () => {
    const clickSemantics: ChipClickSemantics[] = ['direct-execution', 'populate-composer']

    it('should recognize all click semantics', () => {
      for (const sem of clickSemantics) {
        expect(isChipClickSemantics(sem)).toBe(true)
      }
    })

    it('should reject unknown click semantics', () => {
      expect(isChipClickSemantics('unknown')).toBe(false)
      expect(isChipClickSemantics('')).toBe(false)
    })
  })

  describe('Relevance tier exhaustiveness', () => {
    const relevanceTiers: ChipRelevanceTier[] = ['critical', 'high', 'medium', 'low']

    it('should recognize all relevance tiers', () => {
      for (const tier of relevanceTiers) {
        expect(isChipRelevanceTier(tier)).toBe(true)
      }
    })

    it('should reject unknown relevance tiers', () => {
      expect(isChipRelevanceTier('unknown')).toBe(false)
      expect(isChipRelevanceTier('')).toBe(false)
    })
  })

  describe('Record sanitization', () => {
    it('should not contain user input, prompt, model output, token, or secret in exposure record', () => {
      const record = sampleExposureRecord
      const recordStr = JSON.stringify(record)
      expect(recordStr).not.toContain('prompt')
      expect(recordStr).not.toContain('token')
      expect(recordStr).not.toContain('secret')
      expect(recordStr).not.toContain('Authorization')
      expect(recordStr).not.toContain('model')
      expect(recordStr).not.toContain('input')
    })

    it('should not contain sensitive data in click record', () => {
      const record = sampleClickRecord
      const recordStr = JSON.stringify(record)
      expect(recordStr).not.toContain('prompt')
      expect(recordStr).not.toContain('token')
      expect(recordStr).not.toContain('secret')
      expect(recordStr).not.toContain('Authorization')
    })

    it('should only contain allowed fields in exposure record', () => {
      const record = sampleExposureRecord
      const allowedKeys = ['chipId', 'sourceKind', 'ordinal', 'clicked', 'unavailabilityKind']
      const recordKeys = Object.keys(record)
      for (const key of recordKeys) {
        expect(allowedKeys).toContain(key)
      }
    })
  })
})
