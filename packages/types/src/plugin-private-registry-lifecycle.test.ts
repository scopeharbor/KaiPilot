/**
 * plugin-private-registry-lifecycle — 共享契约测试
 * 覆盖：合法最小形状、缺字段、未知枚举、非法 semver、state machine、
 * canonical serialization/hash、fixture coverage、sanitizer、type guards。
 */

import { describe, expect, it } from 'vitest'
import {
  // Types & constants
  REGISTRY_RELEASE_STATUSES,
  REGISTRY_STATUS_TRANSITIONS,
  REGISTRY_COMMAND_ACTIONS,
  REGISTRY_OPERATION_STATUSES,
  REGISTRY_ERROR_CODES,
  REGISTRY_PERMISSIONS,
  REGISTRY_REASON_CODES,
  // State machine
  isValidStatusTransition,
  legalTransitionsFrom,
  isTerminalStatus,
  isDiscoverable,
  isInstallationCandidate,
  // Hash & serialization
  stableSerialize,
  fnv1a32,
  computeRegistrySourceHash,
  makeReleaseStableId,
  makePreviewHandle,
  compareSemver,
  isValidSemver,
  // Sanitization
  isRegistrySensitiveKey,
  containsRegistrySensitiveValue,
  sanitizeForAudit,
  sanitizeErrorResponse,
  // Type guards
  isRegistryReleaseStatus,
  isRegistryCommandAction,
  isRegistryOperationStatus,
  isRegistryErrorCode,
  isRegistryPermission,
  // Maker-checker
  checkMakerChecker,
  // Version resolution
  resolveCandidates,
  // Test constants
  TEST_ORG_A,
  TEST_ORG_B,
  // Fixture types
  type PrivateRegistryEntry,
  type PrivateRegistryRelease,
  type PrivateRegistryReview,
  type PrivateRegistryCommandPreview,
} from './plugin-private-registry-lifecycle.js'
import {
  ALL_ENTRIES,
  ALL_RELEASES,
  ALL_REVIEWS,
  ALL_OPERATIONS,
  ALL_PREVIEWS,
  ENTRY_LOGGER_V2,
  ENTRY_LOGGER_ORG_B,
  RELEASE_LOGGER_V1,
  RELEASE_LOGGER_V2,
  RELEASE_LOGGER_V3_DRAFT,
  RELEASE_LOGGER_V2_5,
  RELEASE_FORMATTER_V1_DEPRECATED,
  RELEASE_LOGGER_V0_9_WITHDRAWN,
  RELEASE_LOGGER_V1_ORG_B,
  RELEASE_LOGGER_V2_1_REJECTED,
  REVIEW_LOGGER_V2_CYCLE1,
  REVIEW_MAKER_CHECKER_VIOLATION,
  OPERATION_ROLLBACK_SUCCESS,
  OPERATION_ROLLBACK_FAILED,
  OPERATION_REPLAY_STALE,
  PREVIEW_APPROVE_VALID,
  PREVIEW_CROSS_ORG,
  PREVIEW_STALE,
  PREVIEW_APPROVE_EXPIRED,
  FIXTURE_COVERAGE_INDEX,
} from './plugin-private-registry-lifecycle-fixtures.js'

// =============================================================================
// 1. Enum Completeness
// =============================================================================

describe('Registry enum completeness', () => {
  it('REGISTRY_RELEASE_STATUSES has 6 values', () => {
    expect(REGISTRY_RELEASE_STATUSES).toHaveLength(6)
  })

  it('REGISTRY_COMMAND_ACTIONS has 9 values', () => {
    expect(REGISTRY_COMMAND_ACTIONS).toHaveLength(9)
  })

  it('REGISTRY_OPERATION_STATUSES has 7 values', () => {
    expect(REGISTRY_OPERATION_STATUSES).toHaveLength(7)
  })

  it('REGISTRY_ERROR_CODES covers all spec error domains', () => {
    expect(REGISTRY_ERROR_CODES.length).toBeGreaterThanOrEqual(30)
  })

  it('REGISTRY_PERMISSIONS has 5 values', () => {
    expect(REGISTRY_PERMISSIONS).toHaveLength(5)
  })

  it('REGISTRY_REASON_CODES covers all spec audit scenarios', () => {
    expect(REGISTRY_REASON_CODES.length).toBeGreaterThanOrEqual(15)
  })

  it('REGISTRY_STATUS_TRANSITIONS has entries for all statuses', () => {
    for (const status of REGISTRY_RELEASE_STATUSES) {
      expect(REGISTRY_STATUS_TRANSITIONS).toHaveProperty(status)
      expect(Array.isArray(REGISTRY_STATUS_TRANSITIONS[status])).toBe(true)
    }
  })
})

// =============================================================================
// 2. State Machine — All Legal Transitions
// =============================================================================

describe('State machine — legal transitions', () => {
  it('draft → pending_review', () => {
    expect(isValidStatusTransition('draft', 'pending_review')).toBe(true)
  })

  it('pending_review → approved', () => {
    expect(isValidStatusTransition('pending_review', 'approved')).toBe(true)
  })

  it('pending_review → rejected', () => {
    expect(isValidStatusTransition('pending_review', 'rejected')).toBe(true)
  })

  it('approved → deprecated', () => {
    expect(isValidStatusTransition('approved', 'deprecated')).toBe(true)
  })

  it('approved → withdrawn', () => {
    expect(isValidStatusTransition('approved', 'withdrawn')).toBe(true)
  })

  it('deprecated → approved (undeprecate)', () => {
    expect(isValidStatusTransition('deprecated', 'approved')).toBe(true)
  })

  it('deprecated → withdrawn', () => {
    expect(isValidStatusTransition('deprecated', 'withdrawn')).toBe(true)
  })

  it('legalTransitionsFrom returns correct targets', () => {
    expect(legalTransitionsFrom('draft')).toEqual(['pending_review'])
    expect(legalTransitionsFrom('pending_review')).toEqual(['approved', 'rejected'])
    expect(legalTransitionsFrom('approved')).toEqual(['deprecated', 'withdrawn'])
    expect(legalTransitionsFrom('rejected')).toEqual([])
    expect(legalTransitionsFrom('deprecated')).toEqual(['approved', 'withdrawn'])
    expect(legalTransitionsFrom('withdrawn')).toEqual([])
  })
})

// =============================================================================
// 3. State Machine — Illegal Transitions
// =============================================================================

describe('State machine — illegal transitions', () => {
  it('draft → approved (skip review)', () => {
    expect(isValidStatusTransition('draft', 'approved')).toBe(false)
  })

  it('draft → withdrawn', () => {
    expect(isValidStatusTransition('draft', 'withdrawn')).toBe(false)
  })

  it('rejected → deprecated', () => {
    expect(isValidStatusTransition('rejected', 'deprecated')).toBe(false)
  })

  it('withdrawn → approved (direct restore forbidden)', () => {
    expect(isValidStatusTransition('withdrawn', 'approved')).toBe(false)
  })

  it('withdrawn → pending_review (direct restore forbidden)', () => {
    expect(isValidStatusTransition('withdrawn', 'pending_review')).toBe(false)
  })

  it('rejected → approved', () => {
    expect(isValidStatusTransition('rejected', 'approved')).toBe(false)
  })

  it('draft → rejected (skip review)', () => {
    expect(isValidStatusTransition('draft', 'rejected')).toBe(false)
  })
})

// =============================================================================
// 4. Terminal Status
// =============================================================================

describe('Terminal status detection', () => {
  it('rejected is terminal', () => {
    expect(isTerminalStatus('rejected')).toBe(true)
  })

  it('withdrawn is terminal', () => {
    expect(isTerminalStatus('withdrawn')).toBe(true)
  })

  it('draft is not terminal', () => {
    expect(isTerminalStatus('draft')).toBe(false)
  })

  it('approved is not terminal', () => {
    expect(isTerminalStatus('approved')).toBe(false)
  })
})

// =============================================================================
// 5. Discovery & Installation Candidate
// =============================================================================

describe('Discovery rules', () => {
  it('only approved is discoverable', () => {
    expect(isDiscoverable('approved')).toBe(true)
    expect(isDiscoverable('deprecated')).toBe(false)
    expect(isDiscoverable('withdrawn')).toBe(false)
    expect(isDiscoverable('draft')).toBe(false)
    expect(isDiscoverable('pending_review')).toBe(false)
    expect(isDiscoverable('rejected')).toBe(false)
  })

  it('approved and deprecated are installation candidates', () => {
    expect(isInstallationCandidate('approved')).toBe(true)
    expect(isInstallationCandidate('deprecated')).toBe(true)
    expect(isInstallationCandidate('withdrawn')).toBe(false)
    expect(isInstallationCandidate('draft')).toBe(false)
    expect(isInstallationCandidate('pending_review')).toBe(false)
    expect(isInstallationCandidate('rejected')).toBe(false)
  })
})

// =============================================================================
// 6. Stable Serialization & Hash
// =============================================================================

describe('Stable serialization', () => {
  it('key order does not affect output', () => {
    const a = stableSerialize({ z: 1, a: 2, m: 3 })
    const b = stableSerialize({ a: 2, m: 3, z: 1 })
    expect(a).toBe(b)
  })

  it('nested objects are sorted', () => {
    const a = stableSerialize({ b: { z: 1, a: 2 }, a: 1 })
    const b = stableSerialize({ a: 1, b: { a: 2, z: 1 } })
    expect(a).toBe(b)
  })

  it('arrays preserve order', () => {
    const a = stableSerialize([3, 1, 2])
    const b = stableSerialize([3, 1, 2])
    expect(a).toBe(b)
    expect(a).not.toBe(stableSerialize([1, 2, 3]))
  })

  it('deterministic output for same input', () => {
    const input = { version: '1.0.0', pluginId: 'test', digests: { sha256: 'abc' } }
    expect(stableSerialize(input)).toBe(stableSerialize(input))
  })
})

describe('FNV-1a hash', () => {
  it('produces consistent 8-char hex', () => {
    const h = fnv1a32('hello')
    expect(h).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a32('hello')).toBe(h)
  })

  it('different inputs produce different hashes', () => {
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'))
  })
})

describe('Source hash', () => {
  it('is deterministic', () => {
    const data = { a: 1, b: 'test' }
    expect(computeRegistrySourceHash(data)).toBe(computeRegistrySourceHash(data))
  })

  it('changes when data changes', () => {
    expect(computeRegistrySourceHash({ a: 1 })).not.toBe(computeRegistrySourceHash({ a: 2 }))
  })

  it('is order-independent', () => {
    expect(computeRegistrySourceHash({ z: 1, a: 2 })).toBe(
      computeRegistrySourceHash({ a: 2, z: 1 }),
    )
  })
})

describe('Release stable ID', () => {
  it('is deterministic', () => {
    const id = makeReleaseStableId('org', 'plugin', '1.0.0')
    expect(makeReleaseStableId('org', 'plugin', '1.0.0')).toBe(id)
  })

  it('differs for different versions', () => {
    expect(makeReleaseStableId('org', 'plugin', '1.0.0')).not.toBe(
      makeReleaseStableId('org', 'plugin', '2.0.0'),
    )
  })
})

describe('Preview handle', () => {
  it('is deterministic', () => {
    const h = makePreviewHandle('org', 'approve', 'rel', 1, '2026-01-01')
    expect(makePreviewHandle('org', 'approve', 'rel', 1, '2026-01-01')).toBe(h)
  })

  it('differs for different actions', () => {
    expect(makePreviewHandle('org', 'approve', 'rel', 1, 'ts')).not.toBe(
      makePreviewHandle('org', 'reject', 'rel', 1, 'ts'),
    )
  })
})

// =============================================================================
// 7. Semantic Version
// =============================================================================

describe('Semantic version validation', () => {
  it('valid semver', () => {
    expect(isValidSemver('1.0.0')).toBe(true)
    expect(isValidSemver('0.0.1')).toBe(true)
    expect(isValidSemver('10.20.30')).toBe(true)
  })

  it('invalid semver', () => {
    expect(isValidSemver('v1.0.0')).toBe(false)
    expect(isValidSemver('1.0.0-beta')).toBe(false)
    expect(isValidSemver('1.0')).toBe(false)
    expect(isValidSemver('')).toBe(false)
    expect(isValidSemver('1.0.0-rc.1')).toBe(false)
  })
})

describe('Semantic version comparison', () => {
  it('major version ordering', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1)
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
  })

  it('minor version ordering', () => {
    expect(compareSemver('1.2.0', '1.1.0')).toBe(1)
  })

  it('patch version ordering', () => {
    expect(compareSemver('1.0.2', '1.0.1')).toBe(1)
  })

  it('equal versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
  })
})

// =============================================================================
// 8. Maker-Checker
// =============================================================================

describe('Maker-checker enforcement', () => {
  it('approve by different reviewer succeeds', () => {
    expect(checkMakerChecker('approve', 'actor-a', 'actor-b')).toBeNull()
  })

  it('reject by different reviewer succeeds', () => {
    expect(checkMakerChecker('reject', 'actor-a', 'actor-b')).toBeNull()
  })

  it('rollback by different reviewer succeeds', () => {
    expect(checkMakerChecker('rollback', 'actor-a', 'actor-b')).toBeNull()
  })

  it('submit has no maker-checker restriction', () => {
    expect(checkMakerChecker('submit', 'actor-a', 'actor-a')).toBeNull()
  })

  it('deprecate has no maker-checker restriction', () => {
    expect(checkMakerChecker('deprecate', 'actor-a', 'actor-a')).toBeNull()
  })

  it('approve by same actor (self-approval) fails', () => {
    expect(checkMakerChecker('approve', 'actor-a', 'actor-a')).toBe(
      'registry-maker-checker-violation',
    )
  })

  it('reject by same actor fails', () => {
    expect(checkMakerChecker('reject', 'actor-a', 'actor-a')).toBe(
      'registry-maker-checker-violation',
    )
  })

  it('rollback by same actor fails', () => {
    expect(checkMakerChecker('rollback', 'actor-a', 'actor-a')).toBe(
      'registry-maker-checker-violation',
    )
  })
})

// =============================================================================
// 9. Version Resolution
// =============================================================================

describe('Version resolution', () => {
  it('resolves highest approved version', () => {
    const candidates = resolveCandidates([RELEASE_LOGGER_V1, RELEASE_LOGGER_V2])
    expect(candidates[0].version).toBe('2.0.0')
    expect(candidates[1].version).toBe('1.0.0')
  })

  it('excludes withdrawn by default', () => {
    const candidates = resolveCandidates([RELEASE_LOGGER_V0_9_WITHDRAWN, RELEASE_LOGGER_V1])
    expect(candidates.every((c) => c.status !== 'withdrawn')).toBe(true)
  })

  it('excludes draft by default', () => {
    const candidates = resolveCandidates([RELEASE_LOGGER_V3_DRAFT, RELEASE_LOGGER_V1])
    expect(candidates.every((c) => c.status !== 'draft')).toBe(true)
  })

  it('excludes pending_review by default', () => {
    const candidates = resolveCandidates([RELEASE_LOGGER_V2_5, RELEASE_LOGGER_V1])
    expect(candidates.every((c) => c.status !== 'pending_review')).toBe(true)
  })

  it('excludes rejected by default', () => {
    const candidates = resolveCandidates([RELEASE_LOGGER_V2_1_REJECTED, RELEASE_LOGGER_V1])
    expect(candidates.every((c) => c.status !== 'rejected')).toBe(true)
  })

  it('includes deprecated when explicitly opted in', () => {
    const candidates = resolveCandidates([RELEASE_FORMATTER_V1_DEPRECATED, RELEASE_LOGGER_V1], {
      includeDeprecated: true,
    })
    expect(candidates.some((c) => c.status === 'deprecated')).toBe(true)
  })

  it('same version tiebreaks by stable ID', () => {
    const sameVersion: PrivateRegistryRelease[] = [
      { ...RELEASE_LOGGER_V1, id: 'z-release' },
      { ...RELEASE_LOGGER_V1, id: 'a-release' },
    ]
    const candidates = resolveCandidates(sameVersion)
    expect(candidates[0].id).toBe('a-release') // 'a' < 'z' lexically
  })
})

// =============================================================================
// 10. Low-Sensitive Sanitization
// =============================================================================

describe('Sensitive key detection', () => {
  it('detects token', () => {
    expect(isRegistrySensitiveKey('api_token')).toBe(true)
  })

  it('detects secret', () => {
    expect(isRegistrySensitiveKey('client_secret')).toBe(true)
  })

  it('detects authorization', () => {
    expect(isRegistrySensitiveKey('Authorization')).toBe(true)
  })

  it('allows non-sensitive keys', () => {
    expect(isRegistrySensitiveKey('pluginId')).toBe(false)
    expect(isRegistrySensitiveKey('version')).toBe(false)
    expect(isRegistrySensitiveKey('status')).toBe(false)
  })
})

describe('Sensitive value detection', () => {
  it('detects sk_ prefix', () => {
    expect(containsRegistrySensitiveValue('sk_abcdef1234567890abcdef')).toBe(true)
  })

  it('detects Bearer token', () => {
    expect(containsRegistrySensitiveValue('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe(true)
  })

  it('detects GitHub token', () => {
    expect(containsRegistrySensitiveValue('ghp_abcdef1234567890abcdef')).toBe(true)
  })

  it('allows normal strings', () => {
    expect(containsRegistrySensitiveValue('sha256:abc123')).toBe(false)
    expect(containsRegistrySensitiveValue('1.0.0')).toBe(false)
    expect(containsRegistrySensitiveValue('plugin-id')).toBe(false)
  })
})

describe('Object sanitization', () => {
  it('strips sensitive keys', () => {
    const input = { pluginId: 'test', api_token: 'secret123', version: '1.0.0' }
    const result = sanitizeForAudit(input)
    expect(result).toHaveProperty('pluginId', 'test')
    expect(result).toHaveProperty('version', '1.0.0')
    expect(result).not.toHaveProperty('api_token')
  })

  it('redacts sensitive values', () => {
    const input = { name: 'test', key: 'sk_abcdef1234567890abcdef' }
    const result = sanitizeForAudit(input)
    expect(result.key).toBe('[REDACTED]')
  })

  it('sanitizes nested objects', () => {
    const input = {
      outer: { inner_secret: 'val', safe: 'ok' },
      safe: 'ok',
    }
    const result = sanitizeForAudit(input)
    expect(result).toHaveProperty('safe', 'ok')
    expect(result.outer).toHaveProperty('safe', 'ok')
    expect(result.outer).not.toHaveProperty('inner_secret')
  })

  it('handles arrays', () => {
    const input = { items: ['a', 'b'], safe: true }
    const result = sanitizeForAudit(input)
    expect(result.items).toEqual(['a', 'b'])
  })
})

describe('Error response sanitization', () => {
  it('returns structured error', () => {
    const result = sanitizeErrorResponse('registry-permission-denied', 'Access denied')
    expect(result).toEqual({
      error: {
        code: 'registry-permission-denied',
        message: 'Access denied',
      },
    })
  })

  it('redacts sensitive error messages', () => {
    const result = sanitizeErrorResponse(
      'registry-tool-error',
      'Token sk_abcdefghijklmnopqrstuvwxyz failed',
    )
    expect(result.error.message).toBe('[REDACTED]')
  })
})

// =============================================================================
// 11. Type Guards
// =============================================================================

describe('Type guards', () => {
  it('isRegistryReleaseStatus accepts valid', () => {
    expect(isRegistryReleaseStatus('approved')).toBe(true)
    expect(isRegistryReleaseStatus('withdrawn')).toBe(true)
  })

  it('isRegistryReleaseStatus rejects invalid', () => {
    expect(isRegistryReleaseStatus('unknown')).toBe(false)
    expect(isRegistryReleaseStatus('')).toBe(false)
  })

  it('isRegistryCommandAction accepts valid', () => {
    expect(isRegistryCommandAction('approve')).toBe(true)
    expect(isRegistryCommandAction('rollback')).toBe(true)
  })

  it('isRegistryCommandAction rejects invalid', () => {
    expect(isRegistryCommandAction('delete')).toBe(false)
  })

  it('isRegistryOperationStatus accepts valid', () => {
    expect(isRegistryOperationStatus('committed')).toBe(true)
  })

  it('isRegistryErrorCode accepts valid', () => {
    expect(isRegistryErrorCode('registry-permission-denied')).toBe(true)
  })

  it('isRegistryPermission accepts valid', () => {
    expect(isRegistryPermission('plugin_registry:view')).toBe(true)
  })

  it('isRegistryPermission rejects invalid', () => {
    expect(isRegistryPermission('plugin_registry:delete')).toBe(false)
  })
})

// =============================================================================
// 12. Fixture Coverage & Integrity
// =============================================================================

describe('Fixture coverage index', () => {
  it('every key maps to at least one fixture', () => {
    for (const [key, ids] of Object.entries(FIXTURE_COVERAGE_INDEX)) {
      expect(ids.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('fixture IDs are all valid strings', () => {
    const allIds = Object.values(FIXTURE_COVERAGE_INDEX).flat()
    for (const id of allIds) {
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    }
  })
})

describe('Fixture arrays are non-empty', () => {
  it('has entries', () => {
    expect(ALL_ENTRIES.length).toBeGreaterThanOrEqual(4)
  })

  it('has releases', () => {
    expect(ALL_RELEASES.length).toBeGreaterThanOrEqual(8)
  })

  it('has reviews', () => {
    expect(ALL_REVIEWS.length).toBeGreaterThanOrEqual(3)
  })

  it('has operations', () => {
    expect(ALL_OPERATIONS.length).toBeGreaterThanOrEqual(4)
  })

  it('has previews', () => {
    expect(ALL_PREVIEWS.length).toBeGreaterThanOrEqual(4)
  })
})

describe('Fixture no sensitive data leakage', () => {
  const forbiddenPatterns = [
    /token/i,
    /secret/i,
    /password/i,
    /api_key/i,
    /authorization/i,
    /bearer/i,
    /ghp_/,
    /sk_/,
  ]

  function checkObject(obj: unknown, path: string) {
    if (typeof obj === 'string') {
      for (const p of forbiddenPatterns) {
        if (
          p.test(obj) &&
          !obj.startsWith('sha256:') &&
          !obj.startsWith('actor-') &&
          !obj.startsWith('receipt-') &&
          !obj.startsWith('idem-') &&
          !obj.startsWith('hash-') &&
          !obj.startsWith('handle-')
        ) {
          // Skip known fixture prefixes
          if (!obj.startsWith('reason-') && !obj.startsWith('op-') && !obj.startsWith('review-')) {
            throw new Error(`Sensitive pattern "${p}" found at ${path}: "${obj}"`)
          }
        }
      }
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (forbiddenPatterns.some((p) => p.test(k))) {
          throw new Error(`Sensitive key "${k}" found at ${path}`)
        }
        checkObject(v, `${path}.${k}`)
      }
    }
  }

  it('entries have no sensitive data', () => {
    for (const e of ALL_ENTRIES) checkObject(e, `entry:${e.id}`)
  })

  it('releases have no sensitive data', () => {
    for (const r of ALL_RELEASES) checkObject(r, `release:${r.id}`)
  })

  it('reviews have no sensitive data', () => {
    for (const r of ALL_REVIEWS) checkObject(r, `review:${r.id}`)
  })

  it('operations have no sensitive data', () => {
    for (const o of ALL_OPERATIONS) checkObject(o, `operation:${o.id}`)
  })

  it('previews have no sensitive data', () => {
    for (const p of ALL_PREVIEWS) checkObject(p, `preview:${p.handle}`)
  })
})

// =============================================================================
// 13. Cross-Org Isolation
// =============================================================================

describe('Cross-org isolation', () => {
  it('Org A and Org B can have same plugin identity', () => {
    expect(ENTRY_LOGGER_V2.organizationId).toBe(TEST_ORG_A)
    expect(ENTRY_LOGGER_ORG_B.organizationId).toBe(TEST_ORG_B)
    expect(ENTRY_LOGGER_V2.pluginIdentity).toBe(ENTRY_LOGGER_ORG_B.pluginIdentity)
  })

  it('releases are scoped to their organization', () => {
    expect(RELEASE_LOGGER_V1.organizationId).toBe(TEST_ORG_A)
    expect(RELEASE_LOGGER_V1_ORG_B.organizationId).toBe(TEST_ORG_B)
  })

  it('cross-org preview has different organizationId', () => {
    expect(PREVIEW_CROSS_ORG.organizationId).toBe(TEST_ORG_B)
    expect(PREVIEW_APPROVE_VALID.organizationId).toBe(TEST_ORG_A)
  })
})

// =============================================================================
// 14. JSON Round-Trip
// =============================================================================

describe('JSON round-trip', () => {
  it('entry survives JSON round-trip', () => {
    const serialized = JSON.stringify(ENTRY_LOGGER_V2)
    const parsed = JSON.parse(serialized) as PrivateRegistryEntry
    expect(parsed.id).toBe(ENTRY_LOGGER_V2.id)
    expect(parsed.organizationId).toBe(ENTRY_LOGGER_V2.organizationId)
    expect(parsed.pluginIdentity).toBe(ENTRY_LOGGER_V2.pluginIdentity)
  })

  it('release survives JSON round-trip', () => {
    const serialized = JSON.stringify(RELEASE_LOGGER_V2)
    const parsed = JSON.parse(serialized) as PrivateRegistryRelease
    expect(parsed.version).toBe(RELEASE_LOGGER_V2.version)
    expect(parsed.status).toBe(RELEASE_LOGGER_V2.status)
  })

  it('preview survives JSON round-trip', () => {
    const serialized = JSON.stringify(PREVIEW_APPROVE_VALID)
    const parsed = JSON.parse(serialized) as PrivateRegistryCommandPreview
    expect(parsed.handle).toBe(PREVIEW_APPROVE_VALID.handle)
    expect(parsed.action).toBe(PREVIEW_APPROVE_VALID.action)
  })
})

// =============================================================================
// 15. State Version & Stale Detection
// =============================================================================

describe('Stale detection via state version', () => {
  it('same source hash means not stale', () => {
    const data = { stateVersion: 1, version: '1.0.0' }
    const hash = computeRegistrySourceHash(data)
    expect(computeRegistrySourceHash(data)).toBe(hash)
  })

  it('changed stateVersion makes old hash stale', () => {
    const original = { stateVersion: 1, version: '1.0.0' }
    const changed = { stateVersion: 2, version: '1.0.0' }
    expect(computeRegistrySourceHash(original)).not.toBe(computeRegistrySourceHash(changed))
  })

  it('changed version makes old hash stale', () => {
    const original = { stateVersion: 1, version: '1.0.0' }
    const changed = { stateVersion: 1, version: '2.0.0' }
    expect(computeRegistrySourceHash(original)).not.toBe(computeRegistrySourceHash(changed))
  })
})

// =============================================================================
// 16. Design Constraints (Spec Assertions)
// =============================================================================

describe('Design constraints', () => {
  it('withdrawn cannot directly return to approved', () => {
    expect(isValidStatusTransition('withdrawn', 'approved')).toBe(false)
  })

  it('withdrawn cannot directly go to pending_review', () => {
    expect(isValidStatusTransition('withdrawn', 'pending_review')).toBe(false)
  })

  it('rejected is terminal — no transitions', () => {
    expect(legalTransitionsFrom('rejected')).toHaveLength(0)
  })

  it('withdrawn is terminal — no transitions', () => {
    expect(legalTransitionsFrom('withdrawn')).toHaveLength(0)
  })

  it('directory status does not affect installation', () => {
    // Directory deprecated → installation not affected
    expect(isInstallationCandidate('deprecated')).toBe(true)
    // Directory withdrawn → installation not affected (existing instances keep running)
    expect(isInstallationCandidate('withdrawn')).toBe(false) // excluded from NEW installs
  })

  it('maker-checker prevents self-approval', () => {
    expect(checkMakerChecker('approve', 'self', 'self')).toBe('registry-maker-checker-violation')
  })
})
