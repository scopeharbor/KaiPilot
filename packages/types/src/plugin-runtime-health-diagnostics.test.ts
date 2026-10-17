/**
 * plugin-runtime-health-diagnostics.test.ts — 纯函数单测（零 IO）
 */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_RUNTIME_HEALTH_REASON_CODES,
  PLUGIN_RUNTIME_HEALTH_STATUSES,
  aggregateHealthSnapshot,
  applyProbeResult,
  bucketDuration,
  canProbeCircuit,
  computeCircuitState,
  computeHealthSnapshotDigest,
  computeHealthStatus,
  computeHealthInvocationKey,
  healthDomainSeparatedHash,
  isPluginRuntimeHealthReasonCode,
  isPluginRuntimeHealthStatus,
  isStaleSnapshot,
  mapOutcomeToReasonCode,
  normalizeHealthReasonCode,
  paginateHealthSnapshots,
  sortHealthSnapshots,
  toHealthEventSummary,
  toHealthSnapshotListItem,
  validateHealthQueryFilter,
  aggregateHealthSummaries,
} from './plugin-runtime-health-diagnostics.js'
import {
  degradedSnapshotFixture,
  halfOpenSnapshotFixture,
  healthCrashEventFixture,
  healthEventFixture,
  healthSnapshotFixture,
  healthTimeoutEventFixture,
  unhealthySnapshotFixture,
} from './plugin-runtime-health-diagnostics-fixtures.js'

describe('type guards', () => {
  it('isPluginRuntimeHealthStatus', () => {
    expect(isPluginRuntimeHealthStatus('healthy')).toBe(true)
    expect(isPluginRuntimeHealthStatus('bogus')).toBe(false)
    for (const s of PLUGIN_RUNTIME_HEALTH_STATUSES)
      expect(isPluginRuntimeHealthStatus(s)).toBe(true)
  })
  it('isPluginRuntimeHealthReasonCode', () => {
    expect(isPluginRuntimeHealthReasonCode('crash')).toBe(true)
    expect(isPluginRuntimeHealthReasonCode('free-text')).toBe(false)
    for (const c of PLUGIN_RUNTIME_HEALTH_REASON_CODES)
      expect(isPluginRuntimeHealthReasonCode(c)).toBe(true)
  })
})

describe('normalizeHealthReasonCode', () => {
  it('known codes pass through', () => {
    expect(normalizeHealthReasonCode('crash')).toBe('crash')
    expect(normalizeHealthReasonCode('timeout')).toBe('timeout')
    expect(normalizeHealthReasonCode('cpu_quota')).toBe('cpu_quota')
  })
  it('unknown free text -> unknown', () => {
    expect(normalizeHealthReasonCode('something-random-xyz')).toBe('unknown')
    expect(normalizeHealthReasonCode('')).toBe('unknown')
    expect(normalizeHealthReasonCode(null)).toBe('unknown')
  })
  it('fuzzy mapping', () => {
    expect(normalizeHealthReasonCode('Crash Exception')).toBe('crash')
    expect(normalizeHealthReasonCode('timed out')).toBe('timeout')
  })
})

describe('bucketDuration', () => {
  it('buckets correctly', () => {
    expect(bucketDuration(0)).toBe('lt_100ms')
    expect(bucketDuration(99)).toBe('lt_100ms')
    expect(bucketDuration(100)).toBe('100_500ms')
    expect(bucketDuration(600)).toBe('500_1000ms')
    expect(bucketDuration(2000)).toBe('1_5s')
    expect(bucketDuration(6000)).toBe('gt_5s')
    expect(bucketDuration(null)).toBe('lt_100ms')
  })
})

describe('mapOutcomeToReasonCode', () => {
  it('maps quota kinds', () => {
    expect(mapOutcomeToReasonCode('quota_exceeded', 'cpu')).toBe('cpu_quota')
    expect(mapOutcomeToReasonCode('quota_exceeded', 'memory')).toBe('memory_quota')
    expect(mapOutcomeToReasonCode('quota_exceeded', 'call')).toBe('call_quota')
    expect(mapOutcomeToReasonCode('crash')).toBe('crash')
    expect(mapOutcomeToReasonCode('timeout')).toBe('timeout')
    expect(mapOutcomeToReasonCode('success')).toBe('unknown')
  })
})

describe('isStaleSnapshot', () => {
  it('detects stale', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(isStaleSnapshot(old)).toBe(true)
    const fresh = new Date().toISOString()
    expect(isStaleSnapshot(fresh)).toBe(false)
  })
})

describe('computeHealthStatus', () => {
  it('healthy when only successes', () => {
    expect(
      computeHealthStatus({
        totalSuccess: 3,
        totalCrash: 0,
        totalTimeout: 0,
        totalQuota: 0,
        consecutiveFailures: 0,
        circuitState: 'closed',
      }),
    ).toBe('healthy')
  })
  it('degraded when consecutive < threshold', () => {
    expect(
      computeHealthStatus({
        totalSuccess: 3,
        totalCrash: 1,
        totalTimeout: 0,
        totalQuota: 0,
        consecutiveFailures: 2,
        circuitState: 'closed',
      }),
    ).toBe('degraded')
  })
  it('unhealthy when open or threshold', () => {
    expect(
      computeHealthStatus({
        totalSuccess: 1,
        totalCrash: 5,
        totalTimeout: 0,
        totalQuota: 0,
        consecutiveFailures: 5,
        circuitState: 'closed',
      }),
    ).toBe('unhealthy')
    expect(
      computeHealthStatus({
        totalSuccess: 10,
        totalCrash: 0,
        totalTimeout: 0,
        totalQuota: 0,
        consecutiveFailures: 0,
        circuitState: 'open',
      }),
    ).toBe('unhealthy')
  })
  it('unknown when no data', () => {
    expect(
      computeHealthStatus({
        totalSuccess: 0,
        totalCrash: 0,
        totalTimeout: 0,
        totalQuota: 0,
        consecutiveFailures: 0,
        circuitState: 'closed',
      }),
    ).toBe('unknown')
  })
})

describe('computeCircuitState', () => {
  it('closed stays closed below threshold', () => {
    expect(
      computeCircuitState({
        previous: 'closed',
        consecutiveFailures: 2,
        lastSeenAt: new Date().toISOString(),
      }),
    ).toBe('closed')
  })
  it('closed opens at threshold', () => {
    expect(
      computeCircuitState({
        previous: 'closed',
        consecutiveFailures: 5,
        lastSeenAt: new Date().toISOString(),
      }),
    ).toBe('open')
  })
  it('open -> half_open after timeout', () => {
    const old = new Date(Date.now() - 70_000).toISOString()
    expect(
      computeCircuitState({
        previous: 'open',
        consecutiveFailures: 5,
        lastSeenAt: old,
        halfOpenTimeoutMs: 60_000,
      }),
    ).toBe('half_open')
  })
  it('open stays open before timeout', () => {
    const fresh = new Date().toISOString()
    expect(
      computeCircuitState({
        previous: 'open',
        consecutiveFailures: 5,
        lastSeenAt: fresh,
        halfOpenTimeoutMs: 60_000,
      }),
    ).toBe('open')
  })
})

describe('aggregateHealthSnapshot', () => {
  it('success increments and resets consecutive', () => {
    const prev = unhealthySnapshotFixture()
    const evt = healthEventFixture({
      outcome: 'success',
      reasonCode: 'unknown',
      circuitState: 'open',
    })
    const next = aggregateHealthSnapshot(prev, evt)
    expect(next.totalSuccess).toBe(prev.totalSuccess + 1)
    expect(next.consecutiveFailures).toBe(0)
    expect(next.recoveredAt).not.toBeNull()
  })
  it('crash increments and keeps open logic', () => {
    const prev = healthSnapshotFixture({ consecutiveFailures: 4, circuitState: 'closed' })
    const evt = healthCrashEventFixture()
    const next = aggregateHealthSnapshot(prev, evt)
    expect(next.totalCrash).toBe(prev.totalCrash + 1)
    expect(next.consecutiveFailures).toBe(5)
    expect(next.circuitState).toBe('open')
  })
  it('permission_denied does not trigger circuit open', () => {
    const prev = healthSnapshotFixture({ consecutiveFailures: 0, circuitState: 'closed' })
    const evt = healthEventFixture({
      outcome: 'permission_denied',
      reasonCode: 'permission_denied',
    })
    const next = aggregateHealthSnapshot(prev, evt)
    expect(next.totalPermissionDenied).toBe(1)
    expect(next.circuitState).toBe('closed')
  })
  it('timeout -> degraded', () => {
    const prev = healthSnapshotFixture({
      consecutiveFailures: 0,
      circuitState: 'closed',
      totalSuccess: 1,
    })
    const evt = healthTimeoutEventFixture()
    const next = aggregateHealthSnapshot(prev, evt)
    expect(next.status).toBe('degraded')
  })
  it('retains rowVersion increment', () => {
    const prev = healthSnapshotFixture({ rowVersion: 2 })
    const evt = healthEventFixture({ outcome: 'success' })
    const next = aggregateHealthSnapshot(prev, evt)
    expect(next.rowVersion).toBe(3)
  })
})

describe('canProbeCircuit / applyProbeResult', () => {
  it('canProbe only half_open', () => {
    expect(canProbeCircuit(halfOpenSnapshotFixture())).toBe(true)
    expect(canProbeCircuit(healthSnapshotFixture())).toBe(false)
  })
  it('applyProbe success -> closed healthy', () => {
    const prev = halfOpenSnapshotFixture()
    const next = applyProbeResult(prev, 'success')
    expect(next.circuitState).toBe('closed')
    expect(next.status).toBe('healthy')
    expect(next.consecutiveFailures).toBe(0)
  })
  it('applyProbe failure -> open unhealthy', () => {
    const prev = halfOpenSnapshotFixture()
    const next = applyProbeResult(prev, 'crash')
    expect(next.circuitState).toBe('open')
    expect(next.status).toBe('unhealthy')
  })
  it('non half_open no change', () => {
    const prev = healthSnapshotFixture()
    const next = applyProbeResult(prev, 'success')
    expect(next).toBe(prev)
  })
})

describe('projections', () => {
  it('toHealthEventSummary strips sensitive', () => {
    const evt = healthEventFixture()
    const sum = toHealthEventSummary(evt)
    expect(sum.pluginId).toBe(evt.pluginId)
    expect((sum as any).latencyMs).toBeUndefined()
    expect((sum as any).invocationId).toBeUndefined()
  })
  it('toHealthSnapshotListItem', () => {
    const snap = degradedSnapshotFixture()
    const item = toHealthSnapshotListItem(snap)
    expect(item.status).toBe(snap.status)
    expect(item.installationId).toBe(snap.installationId)
  })
})

describe('helpers', () => {
  it('computeHealthInvocationKey deterministic', () => {
    const k1 = computeHealthInvocationKey({
      organizationId: 1,
      installationId: 2,
      invocationId: 'a',
    })
    const k2 = computeHealthInvocationKey({
      organizationId: 1,
      installationId: 2,
      invocationId: 'a',
    })
    expect(k1).toBe(k2)
    expect(
      computeHealthInvocationKey({ organizationId: 1, installationId: 2, invocationId: 'b' }),
    ).not.toBe(k1)
  })
  it('computeHealthSnapshotDigest stable', () => {
    const s = healthSnapshotFixture()
    const d1 = computeHealthSnapshotDigest(s)
    const d2 = computeHealthSnapshotDigest({ ...s })
    expect(d1).toBe(d2)
    expect(computeHealthSnapshotDigest({ ...s, totalSuccess: s.totalSuccess + 1 })).not.toBe(d1)
  })
  it('healthDomainSeparatedHash', () => {
    expect(healthDomainSeparatedHash('a', 'b')).not.toBe(healthDomainSeparatedHash('b', 'a'))
  })
})

describe('sort/paginate/aggregate', () => {
  it('sortHealthSnapshots', () => {
    const a = healthSnapshotFixture({
      pluginId: 'a',
      lastSeenAt: new Date(Date.now() - 2000).toISOString(),
    })
    const b = healthSnapshotFixture({ pluginId: 'b', lastSeenAt: new Date().toISOString() })
    const sorted = sortHealthSnapshots([a, b], '-lastSeenAt')
    expect(sorted[0].pluginId).toBe('b')
    const sorted2 = sortHealthSnapshots([a, b], '+pluginId')
    expect(sorted2[0].pluginId).toBe('a')
  })
  it('paginateHealthSnapshots', () => {
    const snaps = [healthSnapshotFixture(), degradedSnapshotFixture(), unhealthySnapshotFixture()]
    const page = paginateHealthSnapshots(snaps, 1, 2)
    expect(page.data.length).toBe(2)
    expect(page.meta.total).toBe(3)
    expect(page.meta.totalPages).toBe(2)
  })
  it('aggregateHealthSummaries', () => {
    const snaps = [healthSnapshotFixture(), degradedSnapshotFixture(), unhealthySnapshotFixture()]
    const agg = aggregateHealthSummaries(snaps)
    expect(agg.totalSnapshots).toBe(3)
    expect(agg.healthy).toBe(1)
    expect(agg.degraded).toBe(1)
    expect(agg.unhealthy).toBe(1)
  })
})

describe('validateHealthQueryFilter', () => {
  it('valid empty', () => {
    const r = validateHealthQueryFilter({})
    expect(r.valid).toBe(true)
  })
  it('invalid status', () => {
    const r = validateHealthQueryFilter({ status: 'bad' })
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })
  it('invalid perPage', () => {
    const r = validateHealthQueryFilter({ perPage: 200 })
    expect(r.valid).toBe(false)
  })
  it('valid with pagination', () => {
    const r = validateHealthQueryFilter({ page: 2, perPage: 20, sort: '-lastSeenAt' })
    expect(r.valid).toBe(true)
    expect(r.filter.page).toBe(2)
  })
})
