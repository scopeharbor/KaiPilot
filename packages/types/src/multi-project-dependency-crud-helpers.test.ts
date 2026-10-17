/**
 * multi-project-dependency-crud-helpers 测试
 */

import { describe, it, expect } from 'vitest'
import {
  crudHash,
  normalizeDepListFilters,
  computeDepFilterHash,
  isValidLifecycleTransition,
  getValidTransitions,
  isStalePreviewWarning,
  classifyPreviewWarnings,
  computeIdempotencyKeyHash,
  computeConfirmationHash,
  redactedLabel,
  isRedactedLabel,
  isKnownWarningCode,
  isKnownLifecycleStatus,
  computeCreateProposedDiff,
  computeUpdateProposedDiff,
  buildDuplicateActiveKey,
  isSelfDependency,
} from './multi-project-dependency-crud-helpers.js'

describe('crudHash', () => {
  it('produces a deterministic 8-char hex string', () => {
    const h1 = crudHash('hello')
    const h2 = crudHash('hello')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{8}$/)
  })

  it('produces different hashes for different inputs', () => {
    expect(crudHash('a')).not.toBe(crudHash('b'))
  })
})

describe('normalizeDepListFilters', () => {
  it('sorts array fields and normalizes page/perPage', () => {
    const result = normalizeDepListFilters({
      status: ['archived', 'active'],
      page: -1,
      perPage: 999,
      sort: 'createdAt',
    })
    expect(result.status).toEqual(['active', 'archived'])
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(100)
    expect(result.sort).toBe('createdAt')
  })

  it('rejects unsupported sort keys', () => {
    const result = normalizeDepListFilters({ sort: 'invalidKey' as any })
    expect(result.sort).toBeUndefined()
  })

  it('defaults perPage when missing', () => {
    const result = normalizeDepListFilters({})
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(20)
  })
})

describe('computeDepFilterHash', () => {
  it('is stable regardless of object key order', () => {
    const h1 = computeDepFilterHash({ status: ['active'], page: 1 })
    const h2 = computeDepFilterHash({ page: 1, status: ['active'] })
    expect(h1).toBe(h2)
  })

  it('changes when filters differ', () => {
    const h1 = computeDepFilterHash({ status: ['active'] })
    const h2 = computeDepFilterHash({ status: ['archived'] })
    expect(h1).not.toBe(h2)
  })
})

describe('isValidLifecycleTransition', () => {
  it('allows active -> archived', () => {
    expect(isValidLifecycleTransition('active', 'archived')).toBe(true)
  })

  it('allows archived -> active (restore)', () => {
    expect(isValidLifecycleTransition('archived', 'active')).toBe(true)
  })

  it('allows archived -> deleted', () => {
    expect(isValidLifecycleTransition('archived', 'deleted')).toBe(true)
  })

  it('rejects active -> deleted (must archive first)', () => {
    expect(isValidLifecycleTransition('active', 'deleted')).toBe(false)
  })

  it('rejects deleted -> anything', () => {
    expect(isValidLifecycleTransition('deleted', 'active')).toBe(false)
    expect(isValidLifecycleTransition('deleted', 'archived')).toBe(false)
  })

  it('rejects invalid statuses', () => {
    expect(isValidLifecycleTransition('active', 'bogus' as any)).toBe(false)
  })
})

describe('getValidTransitions', () => {
  it('returns correct transitions for active', () => {
    expect(getValidTransitions('active')).toEqual(['archived'])
  })

  it('returns empty for deleted', () => {
    expect(getValidTransitions('deleted')).toEqual([])
  })
})

describe('isStalePreviewWarning', () => {
  it('classifies stale-related codes', () => {
    expect(isStalePreviewWarning('STALE_PREVIEW')).toBe(true)
    expect(isStalePreviewWarning('FRESHNESS_EXPIRED')).toBe(true)
    expect(isStalePreviewWarning('PERMISSION_CHANGED')).toBe(true)
    expect(isStalePreviewWarning('CYCLE_DETECTED')).toBe(false)
  })
})

describe('classifyPreviewWarnings', () => {
  it('separates stale, blocking, and advisory', () => {
    const result = classifyPreviewWarnings([
      'STALE_PREVIEW',
      'CYCLE_DETECTED',
      'DUPLICATE_ACTIVE_KEY',
      'ENDPOINT_REDACTED',
    ])
    expect(result.stale).toEqual(['STALE_PREVIEW'])
    expect(result.blocking).toEqual(['CYCLE_DETECTED', 'DUPLICATE_ACTIVE_KEY'])
    expect(result.advisory).toEqual(['ENDPOINT_REDACTED'])
  })
})

describe('computeIdempotencyKeyHash', () => {
  it('is deterministic', () => {
    const k1 = computeIdempotencyKeyHash('org1', 'user1', 'confirm_create', 'preview1', 'hash1')
    const k2 = computeIdempotencyKeyHash('org1', 'user1', 'confirm_create', 'preview1', 'hash1')
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('computeConfirmationHash', () => {
  it('is deterministic for same input', () => {
    const h1 = computeConfirmationHash('p1', 'fresh', { a: 1 }, 1000)
    const h2 = computeConfirmationHash('p1', 'fresh', { a: 1 }, 1000)
    expect(h1).toBe(h2)
  })

  it('differs when timestamp differs', () => {
    const h1 = computeConfirmationHash('p1', 'fresh', { a: 1 }, 1000)
    const h2 = computeConfirmationHash('p1', 'fresh', { a: 1 }, 2000)
    expect(h1).not.toBe(h2)
  })
})

describe('redactedLabel', () => {
  it('returns REDACTED', () => {
    expect(redactedLabel()).toBe('REDACTED')
  })
})

describe('isRedactedLabel', () => {
  it('detects redacted marker', () => {
    expect(isRedactedLabel('REDACTED')).toBe(true)
    expect(isRedactedLabel('visible')).toBe(false)
  })
})

describe('isKnownWarningCode', () => {
  it('validates known codes', () => {
    expect(isKnownWarningCode('STALE_PREVIEW')).toBe(true)
    expect(isKnownWarningCode('UNKNOWN_CODE')).toBe(false)
  })
})

describe('isKnownLifecycleStatus', () => {
  it('validates known statuses', () => {
    expect(isKnownLifecycleStatus('active')).toBe(true)
    expect(isKnownLifecycleStatus('bogus')).toBe(false)
  })
})

describe('computeCreateProposedDiff', () => {
  it('produces from-null diff for all fields', () => {
    const diff = computeCreateProposedDiff({
      providerEndpointType: 'task',
      providerTaskId: 1,
      consumerEndpointType: 'task',
      consumerTaskId: 2,
      category: 'deliverable',
      type: 'fs',
    })
    expect(diff.category).toEqual({ from: null, to: 'deliverable' })
    expect(diff.type).toEqual({ from: null, to: 'fs' })
    expect(diff.providerTaskId).toEqual({ from: null, to: 1 })
    expect(diff.lagDays).toEqual({ from: null, to: 0 })
    expect(diff.strength).toEqual({ from: null, to: 'hard' })
  })
})

describe('computeUpdateProposedDiff', () => {
  it('only includes changed fields', () => {
    const current = { category: 'deliverable', type: 'fs', lagDays: 0 }
    const diff = computeUpdateProposedDiff({ dependencyId: 1, category: 'technical' }, current)
    expect(diff).toHaveProperty('category')
    expect(diff).not.toHaveProperty('type')
  })
})

describe('buildDuplicateActiveKey', () => {
  it('is order-independent', () => {
    const k1 = buildDuplicateActiveKey('task', 't1', 'task', 't2', 'FS', 'deliverable')
    const k2 = buildDuplicateActiveKey('task', 't2', 'task', 't1', 'FS', 'deliverable')
    expect(k1).toBe(k2)
  })
})

describe('isSelfDependency', () => {
  it('detects self-dependency', () => {
    expect(isSelfDependency({ id: 't1', type: 'task' }, { id: 't1', type: 'task' })).toBe(true)
  })

  it('allows different ids same type', () => {
    expect(isSelfDependency({ id: 't1', type: 'task' }, { id: 't2', type: 'task' })).toBe(false)
  })
})
