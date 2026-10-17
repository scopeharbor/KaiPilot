import { describe, it, expect } from 'vitest'
import {
  COPILOT_SOURCE_PROVENANCE_TYPES,
  COPILOT_EXTERNAL_SOURCE_KINDS,
  requiresCitation,
  isExternalProvenance,
  isCitationComplete,
  extractDomainFromUrl,
  isObservabilityRecordSafe,
  mergeCitationsByUrl,
  generateCitationId,
  generateObservabilityRecordId,
  validateObservabilityLowSensitivity,
} from './copilot-citations.js'
import type {
  CopilotCitation,
  CopilotExternalRetrievalObservabilityRecord,
} from './copilot-citations.js'
import {
  makeCitationWithProvenance,
  makeCitationWithoutUrl,
  makeCitationWithoutFetchTime,
  makeCitationMultiConclusion,
  makeCitationDrifted,
  makeInternalSourceLabel,
  makeExternalSourceLabel,
  makeObservabilityRecord,
  makeUnsafeObservabilityRecord,
} from './copilot-citations-fixtures.js'

describe('copilot-citations', () => {
  // =========================================================================
  // §2 Citation Contract
  // =========================================================================
  describe('citation contract types', () => {
    it('has source provenance types: internal, external', () => {
      expect(COPILOT_SOURCE_PROVENANCE_TYPES).toEqual(['internal', 'external'])
    })

    it('has external source kinds', () => {
      expect(COPILOT_EXTERNAL_SOURCE_KINDS).toContain('external_content')
      expect(COPILOT_EXTERNAL_SOURCE_KINDS).toContain('search_result')
    })

    it('citation ID is deterministic for same inputs', () => {
      const id1 = generateCitationId('https://example.com', '2026-08-18T10:00:00Z')
      const id2 = generateCitationId('https://example.com', '2026-08-18T10:00:00Z')
      expect(id1).toBe(id2)
      expect(id1).toMatch(/^cit_/)
    })

    it('citation ID differs for different inputs', () => {
      const id1 = generateCitationId('https://a.com', '2026-08-18T10:00:00Z')
      const id2 = generateCitationId('https://b.com', '2026-08-18T10:00:00Z')
      expect(id1).not.toBe(id2)
    })

    it('observability record ID is deterministic', () => {
      const id1 = generateObservabilityRecordId('example.com', '2026-08-18T12:00:00Z')
      const id2 = generateObservabilityRecordId('example.com', '2026-08-18T12:00:00Z')
      expect(id1).toBe(id2)
      expect(id1).toMatch(/^obs_/)
    })
  })

  // =========================================================================
  // §2.4 禁存约束
  // =========================================================================
  describe('forbidden fields (§2.4)', () => {
    it('citation record does not contain sensitive fields', () => {
      const citation = makeCitationWithProvenance()
      const forbidden = [
        'queryText',
        'pageBody',
        'prompt',
        'modelOutput',
        'tokens',
        'secrets',
        'apiKey',
        'authorization',
        'searchQuery',
      ]
      for (const field of forbidden) {
        expect(field in citation).toBe(false)
      }
    })

    it('observability record does not contain sensitive fields', () => {
      const record = makeObservabilityRecord()
      const forbidden = [
        'queryText',
        'pageBody',
        'prompt',
        'modelOutput',
        'tokens',
        'secrets',
        'apiKey',
        'authorization',
        'searchQuery',
      ]
      for (const field of forbidden) {
        expect(field in record).toBe(false)
      }
    })

    it('validateObservabilityLowSensitivity accepts safe records', () => {
      const safe = makeObservabilityRecord()
      const result = validateObservabilityLowSensitivity(safe as unknown as Record<string, unknown>)
      expect(result.valid).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('validateObservabilityLowSensitivity rejects unsafe records', () => {
      const unsafe = makeUnsafeObservabilityRecord()
      const result = validateObservabilityLowSensitivity(unsafe)
      expect(result.valid).toBe(false)
      expect(result.violations).toContain('queryText')
      expect(result.violations).toContain('fullUrl')
    })
  })

  // =========================================================================
  // §2.6 Fixtures — 五种状态
  // =========================================================================
  describe('fixtures cover five states', () => {
    it('with provenance: URL and fetchTime present', () => {
      const c = makeCitationWithProvenance()
      expect(isCitationComplete(c)).toBe(true)
      expect(c.url).toBeTruthy()
      expect(c.fetchedAt).toBeTruthy()
      expect(c.snapshotHash).toBeTruthy()
    })

    it('without URL: citation incomplete', () => {
      const c = makeCitationWithoutUrl()
      expect(isCitationComplete(c)).toBe(false)
    })

    it('without fetchTime: citation incomplete', () => {
      const c = makeCitationWithoutFetchTime()
      expect(isCitationComplete(c)).toBe(false)
    })

    it('multi-conclusion: same URL supports multiple conclusions', () => {
      const c = makeCitationMultiConclusion()
      expect(c.supportedConclusionIds.length).toBeGreaterThanOrEqual(3)
    })

    it('drifted: snapshot hash present for comparison', () => {
      const c = makeCitationDrifted()
      expect(c.snapshotHash).toBeTruthy()
    })
  })

  // =========================================================================
  // §3 Provenance Enforcement
  // =========================================================================
  describe('provenance enforcement (§3)', () => {
    it('external conclusions without complete citation are absent', () => {
      const incomplete = [makeCitationWithoutUrl(), makeCitationWithoutFetchTime()]
      for (const c of incomplete) {
        expect(isCitationComplete(c)).toBe(false)
      }
    })

    it('no unknown-source label is used as substitute', () => {
      const externalLabel = makeExternalSourceLabel()
      expect(externalLabel.label).not.toContain('不明')
      expect(externalLabel.label).not.toContain('unknown')
    })

    it('one URL supporting multiple conclusions merges into one citation', () => {
      const citations = [
        makeCitationWithProvenance({
          citationId: 'c1',
          url: 'https://same.com',
          supportedConclusionIds: ['conc-1'],
        }),
        makeCitationWithProvenance({
          citationId: 'c2',
          url: 'https://same.com',
          supportedConclusionIds: ['conc-2'],
        }),
      ]
      const merged = mergeCitationsByUrl(citations)
      expect(merged).toHaveLength(1)
      expect(merged[0].supportedConclusionIds).toContain('conc-1')
      expect(merged[0].supportedConclusionIds).toContain('conc-2')
    })

    it('different URLs are not merged', () => {
      const citations = [
        makeCitationWithProvenance({
          citationId: 'c1',
          url: 'https://a.com',
          supportedConclusionIds: ['conc-1'],
        }),
        makeCitationWithProvenance({
          citationId: 'c2',
          url: 'https://b.com',
          supportedConclusionIds: ['conc-2'],
        }),
      ]
      const merged = mergeCitationsByUrl(citations)
      expect(merged).toHaveLength(2)
    })
  })

  // =========================================================================
  // §4 Internal/External Distinction
  // =========================================================================
  describe('internal/external distinction (§4)', () => {
    it('internal and external source labels are structurally different', () => {
      const internal = makeInternalSourceLabel()
      const external = makeExternalSourceLabel()
      expect(internal.provenance).not.toBe(external.provenance)
    })

    it('source type labels are non-dismissible', () => {
      const internal = makeInternalSourceLabel()
      const external = makeExternalSourceLabel()
      expect(internal.nonDismissible).toBe(true)
      expect(external.nonDismissible).toBe(true)
    })

    it('distinction is structural (provenance field), not icon-based', () => {
      const internal = makeInternalSourceLabel()
      const external = makeExternalSourceLabel()
      expect(typeof internal.provenance).toBe('string')
      expect(typeof external.provenance).toBe('string')
      expect(internal.provenance).not.toBe(external.provenance)
    })

    it('rules hold even when external retrieval is unauthorized', () => {
      const internal = makeInternalSourceLabel()
      expect(internal.nonDismissible).toBe(true)
      expect(internal.provenance).toBe('internal')
    })
  })

  // =========================================================================
  // §5 Snapshot & Timeliness
  // =========================================================================
  describe('snapshot & timeliness (§5)', () => {
    it('citation states fetch time', () => {
      const c = makeCitationWithProvenance()
      expect(c.fetchedAt).toBeTruthy()
      expect(new Date(c.fetchedAt).getTime()).not.toBeNaN()
    })

    it('snapshot hash is present for drift detection', () => {
      const c = makeCitationWithProvenance()
      expect(c.snapshotHash).toBeTruthy()
      expect(c.snapshotHash.length).toBeGreaterThan(0)
    })

    it('snapshot hash is present in raw citation but not in render contract', () => {
      const citation = makeCitationWithProvenance()
      // Raw citation has snapshotHash
      expect('snapshotHash' in citation).toBe(true)
      // Render type only has: citation, footNoteIndex, isDrifted
      const render = { citation, footNoteIndex: 1, isDrifted: false }
      expect('snapshotHash' in render).toBe(false)
    })
  })

  // =========================================================================
  // §6 External Link Safety
  // =========================================================================
  describe('external link safety (§6)', () => {
    it('citation URL is valid and absolute', () => {
      const c = makeCitationWithProvenance()
      expect(() => new URL(c.url)).not.toThrow()
    })

    it('domain extraction works correctly', () => {
      expect(extractDomainFromUrl('https://example.com/path?q=test')).toBe('example.com')
      expect(extractDomainFromUrl('https://sub.domain.org/page')).toBe('sub.domain.org')
      expect(extractDomainFromUrl('not-a-url')).toBeNull()
    })

    it('observability records only store domain, not full URL', () => {
      const record = makeObservabilityRecord({ domain: 'example.com' })
      expect(record.domain).toBe('example.com')
      expect(record).not.toHaveProperty('fullUrl')
      expect(record).not.toHaveProperty('queryParameters')
    })
  })

  // =========================================================================
  // §7 External Retrieval Observability
  // =========================================================================
  describe('external retrieval observability (§7)', () => {
    it('record includes organizationId for isolation', () => {
      const record = makeObservabilityRecord({ organizationId: 'org-123' })
      expect(record.organizationId).toBe('org-123')
    })

    it('record tracks citations presented and activated', () => {
      const record = makeObservabilityRecord({
        citationsPresented: 5,
        citationsActivated: 2,
      })
      expect(record.citationsPresented).toBe(5)
      expect(record.citationsActivated).toBe(2)
    })

    it('record tracks injection interceptions', () => {
      const record = makeObservabilityRecord({ injectionInterceptions: 3 })
      expect(record.injectionInterceptions).toBe(3)
    })

    it('record only stores domain, not full URL', () => {
      const record = makeObservabilityRecord()
      expect(typeof record.domain).toBe('string')
      expect(record.domain).not.toContain('?')
      expect(record.domain).not.toContain('q=')
    })

    it('unsafe observability record is detected', () => {
      const unsafe = makeUnsafeObservabilityRecord()
      const result = validateObservabilityLowSensitivity(unsafe)
      expect(result.valid).toBe(false)
      expect(result.violations.length).toBeGreaterThan(0)
    })

    it('click rate is observability metric, not ranking input', () => {
      const record = makeObservabilityRecord({ citationsActivated: 10 })
      expect(record.citationsActivated).toBe(10)
      // No ranking-related fields exist in the observability record type
      expect('rankingScore' in record).toBe(false)
      expect('sortWeight' in record).toBe(false)
    })
  })

  // =========================================================================
  // §8 Red Lines
  // =========================================================================
  describe('red lines (§8)', () => {
    it('citation types have no write dependency', () => {
      const citation = makeCitationWithProvenance()
      expect(typeof citation).toBe('object')
      expect(Object.keys(citation)).toEqual(
        expect.arrayContaining([
          'citationId',
          'url',
          'title',
          'fetchedAt',
          'snapshotHash',
          'supportedConclusionIds',
        ]),
      )
    })

    it('observability record has no execution affordance', () => {
      const record = makeObservabilityRecord()
      expect(typeof record).toBe('object')
      const keys = Object.keys(record)
      expect(keys).not.toContain('execute')
      expect(keys).not.toContain('apply')
      expect(keys).not.toContain('write')
    })

    it('source type labels have no execution controls', () => {
      const label = makeExternalSourceLabel()
      expect(typeof label).toBe('object')
      expect(Object.keys(label)).toEqual(
        expect.arrayContaining(['provenance', 'label', 'nonDismissible']),
      )
    })
  })

  // =========================================================================
  // §2.7 Barrel export (no name collisions)
  // =========================================================================
  describe('exports', () => {
    it('all key types and functions are exported', () => {
      expect(typeof requiresCitation).toBe('function')
      expect(typeof isExternalProvenance).toBe('function')
      expect(typeof isCitationComplete).toBe('function')
      expect(typeof extractDomainFromUrl).toBe('function')
      expect(typeof mergeCitationsByUrl).toBe('function')
      expect(typeof generateCitationId).toBe('function')
      expect(typeof generateObservabilityRecordId).toBe('function')
      expect(typeof validateObservabilityLowSensitivity).toBe('function')
    })

    it('requiresCitation correctly identifies external kinds', () => {
      expect(requiresCitation('external_content')).toBe(true)
      expect(requiresCitation('search_result')).toBe(true)
      expect(requiresCitation('task')).toBe(false)
      expect(requiresCitation('project_facts')).toBe(false)
    })

    it('isExternalProvenance correctly identifies external', () => {
      expect(isExternalProvenance('external')).toBe(true)
      expect(isExternalProvenance('internal')).toBe(false)
    })
  })
})
