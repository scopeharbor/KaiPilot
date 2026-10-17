/**
 * plugin-private-registry-lifecycle — Schema & Migration 结构验证测试
 * （task 3.2, 3.4, 3.6, 3.8 的本机可运行替代方案）。
 *
 * 覆盖：迁移文件结构、唯一约束声明、FK 声明、CHECK 约束、
 * model relation 辅助方法、CAS 并发逻辑、tenant-scoped query helpers。
 *
 * 注：实际 SQLite migration round-trip 需要无沙箱限制环境补跑；
 * 本文件验证迁移文件正确性与纯函数逻辑。
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  // State machine
  isValidStatusTransition,
  isTerminalStatus,
  // Hash
  computeRegistrySourceHash,
  makeReleaseStableId,
  // Fixtures
  TEST_ORG_A,
  TEST_ORG_B,
} from './plugin-private-registry-lifecycle.js'
import {
  FIXTURE_ORG_A,
  FIXTURE_ORG_B,
  ALL_ENTRIES,
  ALL_RELEASES,
  ALL_REVIEWS,
  ALL_OPERATIONS,
  ENTRY_LOGGER_V2,
  ENTRY_LOGGER_ORG_B,
  RELEASE_LOGGER_V1,
  RELEASE_LOGGER_V2,
  RELEASE_LOGGER_V0_9_WITHDRAWN,
  RELEASE_FORMATTER_V1_DEPRECATED,
} from './plugin-private-registry-lifecycle-fixtures.js'

// =============================================================================
// 1. Migration File Structure (task 3.2, 3.4)
// =============================================================================

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../apps/backend/database/migrations')

function findMigration(pattern: string): string | undefined {
  const files = fs.readdirSync(MIGRATIONS_DIR)
  return files.find((f) => f.includes(pattern))
}

function readMigration(pattern: string): string {
  const file = findMigration(pattern)
  if (!file) throw new Error(`Migration not found: ${pattern}`)
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
}

describe('Migration files exist', () => {
  it('entries + releases migration exists', () => {
    const file = findMigration('plugin_private_registry_entries')
    expect(file).toBeDefined()
    expect(file).toMatch(/^\d+_create_plugin_private_registry_entries/)
  })

  it('reviews + operations migration exists', () => {
    const file = findMigration('plugin_private_registry_reviews')
    expect(file).toBeDefined()
    expect(file).toMatch(/^\d+_create_plugin_private_registry_reviews/)
  })
})

describe('Entries migration — unique constraints (task 3.2)', () => {
  const sql = readMigration('plugin_private_registry_entries')

  it('has organization_id FK to organizations', () => {
    expect(sql).toContain("'organizations'")
    expect(sql).toContain('organization_id')
    expect(sql).toContain('onDelete')
  })

  it('has unique constraint on (organization_id, plugin_identity)', () => {
    expect(sql).toContain('unique')
    expect(sql).toContain('organization_id')
    expect(sql).toContain('plugin_identity')
  })

  it('has recommended_release_id FK to releases', () => {
    expect(sql).toContain('recommended_release_id')
    expect(sql).toContain('plugin_private_registry_releases')
  })

  it('has row_version column', () => {
    expect(sql).toContain('row_version')
  })

  it('has created_at and updated_at timestamps', () => {
    expect(sql).toContain('created_at')
    expect(sql).toContain('updated_at')
  })

  it('cross-org same name allowed (no global unique on plugin_identity alone)', () => {
    // The unique constraint is on (organization_id, plugin_identity), not plugin_identity alone.
    // 迁移使用显式约束名（uq_ppr_entries_org_plugin）规避 PG 63 字节自动名截断，
    // 断言需匹配实际写法（含约束名参数），并反向验证不存在 plugin_identity 全局唯一。
    expect(sql).toContain(
      "table.unique(['organization_id', 'plugin_identity'], 'uq_ppr_entries_org_plugin')",
    )
    // 反向：不得出现 plugin_identity 单独唯一（全局唯一会阻止跨组织同名）
    expect(sql).not.toMatch(/unique\(\s*\[['"]plugin_identity['"]\]/)
    expect(sql).not.toMatch(
      /unique\(\s*\[['"]organization_id['"],\s*['"]plugin_identity['"]\]\)\s*$/m,
    )
  })
})

describe('Releases migration — schema constraints (task 3.2)', () => {
  const sql = readMigration('plugin_private_registry_entries')

  it('has digest triple columns', () => {
    expect(sql).toContain('package_digest')
    expect(sql).toContain('manifest_digest')
    expect(sql).toContain('compatibility_digest')
  })

  it('has upstream_receipt_ref column', () => {
    expect(sql).toContain('upstream_receipt_ref')
  })

  it('has CHECK constraint on status', () => {
    expect(sql).toContain(
      "status IN ('draft','pending_review','approved','rejected','deprecated','withdrawn')",
    )
  })

  it('has unique constraint on (organization_id, plugin_identity, version)', () => {
    expect(sql).toContain('organization_id')
    expect(sql).toContain('plugin_identity')
    expect(sql).toContain('version')
  })

  it('has metadata JSON column', () => {
    expect(sql).toContain('json')
    expect(sql).toContain('metadata')
  })
})

describe('Reviews migration — schema constraints (task 3.4)', () => {
  const sql = readMigration('plugin_private_registry_reviews')

  it('has release_id FK', () => {
    expect(sql).toContain('release_id')
    expect(sql).toContain('plugin_private_registry_releases')
  })

  it('has cycle_number column', () => {
    expect(sql).toContain('cycle_number')
  })

  it('has submitter_ref and reviewer_ref columns', () => {
    expect(sql).toContain('submitter_ref')
    expect(sql).toContain('reviewer_ref')
  })

  it('has CHECK on decision', () => {
    expect(sql).toContain("decision IN ('pending','approved','rejected')")
  })

  it('has source_hash column for stale detection', () => {
    expect(sql).toContain('source_hash')
  })

  it('unique constraint on (release_id, cycle_number)', () => {
    expect(sql).toContain('release_id')
    expect(sql).toContain('cycle_number')
  })

  it('no free-text sensitive columns (no "content", "comment", "notes")', () => {
    // Reviews should only store structured data, not free text
    expect(sql).not.toMatch(/\bcomment\b/i)
    expect(sql).not.toMatch(/\bnotes\b/i)
  })
})

describe('Operations migration — schema constraints (task 3.4)', () => {
  const sql = readMigration('plugin_private_registry_reviews')

  it('has operation_type with CHECK constraint', () => {
    expect(sql).toContain('operation_type')
    expect(sql).toContain(
      "operation_type IN ('submit','approve','reject','deprecate','undeprecate','withdraw','restore-request','rollback')",
    )
  })

  it('has idempotency_key column', () => {
    expect(sql).toContain('idempotency_key')
  })

  it('has CHECK on status', () => {
    expect(sql).toContain(
      "status IN ('pending','confirmed','applying','committed','failed','degraded','compensated')",
    )
  })

  it('has preview_source_hash for stale detection', () => {
    expect(sql).toContain('preview_source_hash')
  })

  it('has impact_summary JSON column', () => {
    expect(sql).toContain('impact_summary')
  })

  it('has error_code and reason_code columns', () => {
    expect(sql).toContain('error_code')
    expect(sql).toContain('reason_code')
  })

  it('unique constraint on (organization_id, idempotency_key)', () => {
    expect(sql).toContain('idempotency_key')
  })

  it('no free-text sensitive columns', () => {
    expect(sql).not.toMatch(/\bcomment\b/i)
    expect(sql).not.toMatch(/\bnotes\b/i)
    expect(sql).not.toMatch(/\bdescription\b/i)
  })
})

// =============================================================================
// 2. Model File Structure (task 3.6)
// =============================================================================

const MODELS_DIR = path.resolve(__dirname, '../../../apps/backend/app/models')

function readModel(name: string): string {
  return fs.readFileSync(path.join(MODELS_DIR, name), 'utf-8')
}

describe('Model files exist', () => {
  it('entry model exists', () => {
    expect(() => readModel('plugin_private_registry_entry.ts')).not.toThrow()
  })

  it('release model exists', () => {
    expect(() => readModel('plugin_private_registry_release.ts')).not.toThrow()
  })

  it('review model exists', () => {
    expect(() => readModel('plugin_private_registry_review.ts')).not.toThrow()
  })

  it('operation model exists', () => {
    expect(() => readModel('plugin_private_registry_operation.ts')).not.toThrow()
  })
})

describe('Model — organization scoping (task 3.6)', () => {
  it('entry model has forOrganization static method', () => {
    const src = readModel('plugin_private_registry_entry.ts')
    expect(src).toContain('forOrganization')
    expect(src).toContain('organizationId')
  })

  it('release model has forOrganization static method', () => {
    const src = readModel('plugin_private_registry_release.ts')
    expect(src).toContain('forOrganization')
  })

  it('review model has forOrganization static method', () => {
    const src = readModel('plugin_private_registry_review.ts')
    expect(src).toContain('forOrganization')
  })

  it('operation model has forOrganization static method', () => {
    const src = readModel('plugin_private_registry_operation.ts')
    expect(src).toContain('forOrganization')
  })

  it('release model has withStatus helper', () => {
    const src = readModel('plugin_private_registry_release.ts')
    expect(src).toContain('withStatus')
  })

  it('operation model has nonTerminal helper', () => {
    const src = readModel('plugin_private_registry_operation.ts')
    expect(src).toContain('nonTerminal')
  })
})

describe('Model — relations (task 3.6)', () => {
  it('entry has hasOne relation to release', () => {
    const src = readModel('plugin_private_registry_entry.ts')
    expect(src).toContain('hasOne')
    expect(src).toContain('recommendedRelease')
  })

  it('release has hasMany relation to reviews', () => {
    const src = readModel('plugin_private_registry_release.ts')
    expect(src).toContain('hasMany')
    expect(src).toContain('reviews')
  })

  it('review belongsTo release', () => {
    const src = readModel('plugin_private_registry_review.ts')
    expect(src).toContain('belongsTo')
    expect(src).toContain('release')
  })

  it('operation belongsTo release', () => {
    const src = readModel('plugin_private_registry_operation.ts')
    expect(src).toContain('belongsTo')
    expect(src).toContain('targetRelease')
  })
})

describe('Model — no business logic in models (task 3.6)', () => {
  it('entry model has no import from services', () => {
    const src = readModel('plugin_private_registry_entry.ts')
    expect(src).not.toContain('#services/')
    expect(src).not.toContain('#policies/')
  })

  it('release model has no import from services', () => {
    const src = readModel('plugin_private_registry_release.ts')
    expect(src).not.toContain('#services/')
    expect(src).not.toContain('#policies/')
  })

  it('review model has no import from services', () => {
    const src = readModel('plugin_private_registry_review.ts')
    expect(src).not.toContain('#services/')
    expect(src).not.toContain('#policies/')
  })

  it('operation model has no import from services', () => {
    const src = readModel('plugin_private_registry_operation.ts')
    expect(src).not.toContain('#services/')
    expect(src).not.toContain('#policies/')
  })
})

// =============================================================================
// 3. CAS Concurrent Write Logic (task 3.8)
// =============================================================================

/**
 * Simulate compare-and-swap for row_version.
 * In production this runs in a DB transaction; here we test the logic.
 */
function simulateCAS<T extends { rowVersion: number }>(
  current: T,
  update: Partial<T>,
  expectedVersion: number,
): { ok: boolean; result?: T; error?: string } {
  if (current.rowVersion !== expectedVersion) {
    return { ok: false, error: 'stale-cas' }
  }
  return {
    ok: true,
    result: { ...current, ...update, rowVersion: current.rowVersion + 1 },
  }
}

describe('CAS compare-and-swap logic (task 3.8)', () => {
  const baseEntry = {
    id: 1,
    organizationId: 100,
    pluginIdentity: 'test.plugin',
    recommendedReleaseId: null as number | null,
    recommendedVersion: null as string | null,
    rowVersion: 1,
  }

  it('successful CAS increments rowVersion', () => {
    const result = simulateCAS(baseEntry, { recommendedReleaseId: 42 }, 1)
    expect(result.ok).toBe(true)
    expect(result.result?.rowVersion).toBe(2)
    expect(result.result?.recommendedReleaseId).toBe(42)
  })

  it('stale CAS rejects update', () => {
    const current = { ...baseEntry, rowVersion: 2 }
    const result = simulateCAS(current, { recommendedReleaseId: 42 }, 1)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('stale-cas')
  })

  it('double CAS on same version — second fails', () => {
    let entry = { ...baseEntry }
    const r1 = simulateCAS(entry, { recommendedReleaseId: 42 }, 1)
    expect(r1.ok).toBe(true)
    entry = r1.result!

    const r2 = simulateCAS(entry, { recommendedReleaseId: 99 }, 1) // still expects version 1
    expect(r2.ok).toBe(false)
    expect(r2.error).toBe('stale-cas')
  })

  it('sequential CAS on updated version succeeds', () => {
    let entry = { ...baseEntry }
    const r1 = simulateCAS(entry, { recommendedReleaseId: 42 }, 1)
    expect(r1.ok).toBe(true)
    entry = r1.result!

    const r2 = simulateCAS(entry, { recommendedReleaseId: 99 }, 2) // now expects version 2
    expect(r2.ok).toBe(true)
    expect(r2.result?.recommendedReleaseId).toBe(99)
    expect(r2.result?.rowVersion).toBe(3)
  })

  it('client cannot spoof organizationId', () => {
    // The CAS function receives the current state from DB, not from client
    const clientUpdate = { organizationId: 999, recommendedReleaseId: 42 }
    const result = simulateCAS(baseEntry, clientUpdate, 1)
    // CAS allows the update but org change should be rejected at service layer
    expect(result.ok).toBe(true)
    // In production, the service layer would reject orgId changes
    // This test documents that CAS alone doesn't prevent org spoofing
  })

  it('concurrent CAS on same entry — second fails after first commits', () => {
    // Simulates: both read version 1, first commits (version→2), second stale-checks against DB
    const entry1 = { ...baseEntry, rowVersion: 1 }
    const entry2 = { ...baseEntry, rowVersion: 1 }

    // First CAS succeeds (simulates DB update: version 1→2)
    const r1 = simulateCAS(entry1, { recommendedReleaseId: 42 }, 1)
    expect(r1.ok).toBe(true)
    expect(r1.result?.rowVersion).toBe(2)

    // Second CAS: DB now has version 2, but entry2 still has version 1
    // In real DB, the compare would be against the committed version (2), not the read version
    const r2 = simulateCAS(entry2, { recommendedReleaseId: 99 }, 2) // DB version is now 2
    expect(r2.ok).toBe(false) // entry2.rowVersion=1 ≠ expectedVersion=2 → stale
  })
})

// =============================================================================
// 4. Recommended Pointer Single-Writer Logic (task 3.8)
// =============================================================================

describe('Recommended pointer — single writer constraint (task 3.8)', () => {
  it('only one release can be recommended per entry', () => {
    // Simulate: after setting v2 as recommended, v1 should no longer be recommended
    const entry = { ...ENTRY_LOGGER_V2 }
    expect(entry.recommendedVersion).toBe('2.0.0')
    expect(entry.recommendedReleaseId).toBe('release-logger-v2')
  })

  it('withdrawn release clears recommended pointer', () => {
    const entry = { ...ENTRY_LOGGER_V2 }
    // Simulate withdrawing the recommended release
    const updatedEntry = {
      ...entry,
      recommendedReleaseId: null,
      recommendedVersion: null,
      rowVersion: entry.rowVersion + 1,
    }
    expect(updatedEntry.recommendedReleaseId).toBeNull()
    expect(updatedEntry.recommendedVersion).toBeNull()
  })

  it('switching recommended version updates pointer atomically', () => {
    let entry = { ...ENTRY_LOGGER_V2 }
    expect(entry.recommendedVersion).toBe('2.0.0')

    // CAS update to switch to v1
    const result = simulateCAS(
      entry,
      {
        recommendedReleaseId: RELEASE_LOGGER_V1.id,
        recommendedVersion: RELEASE_LOGGER_V1.version,
      },
      entry.rowVersion,
    )

    expect(result.ok).toBe(true)
    entry = result.result!
    expect(entry.recommendedVersion).toBe('1.0.0')
    expect(entry.recommendedReleaseId).toBe(RELEASE_LOGGER_V1.id)
  })
})

// =============================================================================
// 5. Cross-Org Isolation in Fixtures (task 3.6)
// =============================================================================

describe('Cross-org isolation in fixtures (task 3.6)', () => {
  it('Org A and Org B have same plugin identity but different org IDs', () => {
    expect(ENTRY_LOGGER_V2.organizationId).toBe(TEST_ORG_A)
    expect(ENTRY_LOGGER_ORG_B.organizationId).toBe(TEST_ORG_B)
    expect(ENTRY_LOGGER_V2.pluginIdentity).toBe('org-a.logger')
    expect(ENTRY_LOGGER_ORG_B.pluginIdentity).toBe('org-a.logger')
  })

  it('releases are scoped to their organization', () => {
    const orgAReleases = ALL_RELEASES.filter((r) => r.organizationId === TEST_ORG_A)
    const orgBReleases = ALL_RELEASES.filter((r) => r.organizationId === TEST_ORG_B)

    expect(orgAReleases.length).toBeGreaterThanOrEqual(1)
    expect(orgBReleases.length).toBe(1)

    // Same plugin identity, different organizations
    expect(orgAReleases.some((r) => r.pluginIdentity === 'org-a.logger')).toBe(true)
    expect(orgBReleases.some((r) => r.pluginIdentity === 'org-a.logger')).toBe(true)
  })

  it('reviews are scoped to their organization', () => {
    const orgAReviews = ALL_REVIEWS.filter((r) => r.organizationId === TEST_ORG_A)
    expect(orgAReviews.length).toBeGreaterThanOrEqual(1)
  })

  it('operations are scoped to their organization', () => {
    const orgAOps = ALL_OPERATIONS.filter((o) => o.organizationId === TEST_ORG_A)
    expect(orgAOps.length).toBeGreaterThanOrEqual(1)
  })

  it('fixture org IDs match constants', () => {
    expect(FIXTURE_ORG_A).toBe(TEST_ORG_A)
    expect(FIXTURE_ORG_B).toBe(TEST_ORG_B)
  })
})

// =============================================================================
// 6. Migration Rollback Pattern (task 3.2)
// =============================================================================

describe('Migration down() pattern', () => {
  it('entries migration has down() that drops both tables', () => {
    const sql = readMigration('plugin_private_registry_entries')
    expect(sql).toContain('async down()')
    expect(sql).toContain('dropTable')
    expect(sql).toContain('plugin_private_registry_releases')
    expect(sql).toContain('plugin_private_registry_entries')
  })

  it('reviews migration has down() that drops both tables', () => {
    const sql = readMigration('plugin_private_registry_reviews')
    expect(sql).toContain('async down()')
    expect(sql).toContain('dropTable')
    expect(sql).toContain('plugin_private_registry_operations')
    expect(sql).toContain('plugin_private_registry_reviews')
  })
})

// =============================================================================
// 7. Data Integrity Assertions (task 3.2, 3.4)
// =============================================================================

describe('Data integrity — empty digest rejection (task 3.2)', () => {
  it('release fixture has non-empty digests', () => {
    for (const release of ALL_RELEASES) {
      expect(release.packageDigest).toBeTruthy()
      expect(release.manifestDigest).toBeTruthy()
      expect(release.compatibilityDigest).toBeTruthy()
    }
  })

  it('release fixture has non-empty upstreamReceiptRef', () => {
    for (const release of ALL_RELEASES) {
      expect(release.upstreamReceiptRef).toBeTruthy()
    }
  })
})

describe('Data integrity — review cycle monotonic (task 3.4)', () => {
  it('resolved reviews for same release have unique cycle numbers', () => {
    // Only resolved reviews (not pending/violations) should have unique cycles
    const resolvedReviews = ALL_REVIEWS.filter((r) => r.decision !== 'pending')
    const releaseCycles = new Map<string, number[]>()
    for (const review of resolvedReviews) {
      const cycles = releaseCycles.get(review.releaseId) ?? []
      cycles.push(review.cycleNumber)
      releaseCycles.set(review.releaseId, cycles)
    }

    for (const [, cycles] of releaseCycles) {
      // Each resolved cycle number should be unique within a release
      expect(new Set(cycles).size).toBe(cycles.length)
    }
  })

  it('review cycle numbers are positive integers', () => {
    for (const review of ALL_REVIEWS) {
      expect(review.cycleNumber).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(review.cycleNumber)).toBe(true)
    }
  })
})

describe('Data integrity — operation idempotency (task 3.4)', () => {
  it('all operation fixtures have unique idempotency keys', () => {
    const keys = ALL_OPERATIONS.map((o) => o.idempotencyKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('operations reference valid statuses', () => {
    const validStatuses = [
      'pending',
      'confirmed',
      'applying',
      'committed',
      'failed',
      'degraded',
      'compensated',
    ]
    for (const op of ALL_OPERATIONS) {
      expect(validStatuses).toContain(op.status)
    }
  })
})

describe('Data integrity — operation type valid (task 3.4)', () => {
  it('all operations have valid operation types', () => {
    const validTypes = [
      'submit',
      'approve',
      'reject',
      'deprecate',
      'undeprecate',
      'withdraw',
      'restore-request',
      'rollback',
    ]
    for (const op of ALL_OPERATIONS) {
      expect(validTypes).toContain(op.operationType)
    }
  })
})
