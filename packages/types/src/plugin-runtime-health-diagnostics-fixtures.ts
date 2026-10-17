/**
 * plugin-runtime-health-diagnostics-fixtures —— Fixture 工厂（deterministic，无 IO）。
 */

import {
  bucketDuration,
  type PluginRuntimeHealthCircuitState,
  type PluginRuntimeHealthDurationBucket,
  type PluginRuntimeHealthEvent,
  type PluginRuntimeHealthOutcome,
  type PluginRuntimeHealthQuotaKind,
  type PluginRuntimeHealthReasonCode,
  type PluginRuntimeHealthSnapshot,
  type PluginRuntimeHealthStatus,
} from './plugin-runtime-health-diagnostics.js'

let seqCounter = 0
function nextSeq(): number {
  seqCounter += 1
  return seqCounter
}

export function resetHealthFixtureSeq(): void {
  seqCounter = 0
}

export function healthEventFixture(
  overrides?: Partial<PluginRuntimeHealthEvent>,
): PluginRuntimeHealthEvent {
  const seq = nextSeq()
  const outcome: PluginRuntimeHealthOutcome = overrides?.outcome ?? 'success'
  const reasonCode: PluginRuntimeHealthReasonCode =
    overrides?.reasonCode ?? (outcome === 'success' ? 'unknown' : 'crash')
  return {
    id: `evt-${seq}`,
    organizationId: 1,
    installationId: 100 + (seq % 3),
    pluginId: 'com.aiproj.test-health-pack',
    pluginVersion: '1.0.0',
    contributionKey: 'server-query.readonly-provider',
    seamKey: 'server-query.readonly-provider',
    outcome,
    reasonCode,
    quotaKind: (overrides?.quotaKind ?? 'none') as PluginRuntimeHealthQuotaKind,
    durationBucket: (overrides?.durationBucket ??
      bucketDuration(123)) as PluginRuntimeHealthDurationBucket,
    latencyMs: overrides?.latencyMs ?? 123,
    circuitState: (overrides?.circuitState ?? 'closed') as PluginRuntimeHealthCircuitState,
    invocationId: `inv-${seq}-${Date.now()}`,
    occurredAt: new Date(Date.now() - seq * 1000).toISOString(),
    rowVersion: 1,
    ...overrides,
  }
}

export function healthSnapshotFixture(
  overrides?: Partial<PluginRuntimeHealthSnapshot>,
): PluginRuntimeHealthSnapshot {
  const seq = nextSeq()
  const now = new Date().toISOString()
  return {
    id: `snap-${seq}`,
    organizationId: 1,
    installationId: 100,
    pluginId: 'com.aiproj.test-health-pack',
    contributionKey: 'server-query.readonly-provider',
    status: 'healthy',
    reasonCode: 'unknown',
    circuitState: 'closed',
    firstSeenAt: new Date(Date.now() - 60000).toISOString(),
    lastSeenAt: now,
    lastSuccessAt: now,
    lastFailureAt: null,
    recoveredAt: null,
    totalSuccess: 5,
    totalCrash: 0,
    totalTimeout: 0,
    totalQuota: 0,
    totalPermissionDenied: 0,
    totalIncompatible: 0,
    totalIsolationFailed: 0,
    consecutiveFailures: 0,
    isStale: false,
    warningCodes: [],
    rowVersion: 1,
    updatedAt: now,
    ...overrides,
  }
}

// —— 场景化 fixtures ——

export function healthCrashEventFixture(): PluginRuntimeHealthEvent {
  return healthEventFixture({
    outcome: 'crash',
    reasonCode: 'crash',
    circuitState: 'closed',
    latencyMs: 42,
  })
}

export function healthTimeoutEventFixture(): PluginRuntimeHealthEvent {
  return healthEventFixture({
    outcome: 'timeout',
    reasonCode: 'timeout',
    durationBucket: 'gt_5s',
    latencyMs: 6000,
  })
}

export function healthQuotaEventFixture(
  kind: PluginRuntimeHealthQuotaKind = 'call',
): PluginRuntimeHealthEvent {
  const reason: PluginRuntimeHealthReasonCode =
    kind === 'cpu' ? 'cpu_quota' : kind === 'memory' ? 'memory_quota' : 'call_quota'
  return healthEventFixture({
    outcome: 'quota_exceeded',
    reasonCode: reason,
    quotaKind: kind,
  })
}

export function healthPermissionDeniedEventFixture(): PluginRuntimeHealthEvent {
  return healthEventFixture({
    outcome: 'permission_denied',
    reasonCode: 'permission_denied',
  })
}

export function healthIncompatibleEventFixture(): PluginRuntimeHealthEvent {
  return healthEventFixture({
    outcome: 'incompatible',
    reasonCode: 'incompatible',
  })
}

export function healthIsolationFailedEventFixture(): PluginRuntimeHealthEvent {
  return healthEventFixture({
    outcome: 'isolation_failed',
    reasonCode: 'isolation_failed',
  })
}

export function healthUnknownEventFixture(): PluginRuntimeHealthEvent {
  return healthEventFixture({
    outcome: 'unknown',
    reasonCode: 'unknown',
  })
}

export function unhealthySnapshotFixture(): PluginRuntimeHealthSnapshot {
  return healthSnapshotFixture({
    status: 'unhealthy',
    reasonCode: 'crash',
    circuitState: 'open',
    totalCrash: 6,
    consecutiveFailures: 6,
    warningCodes: ['HEALTH_UNHEALTHY', 'CIRCUIT_OPEN'],
  })
}

export function degradedSnapshotFixture(): PluginRuntimeHealthSnapshot {
  return healthSnapshotFixture({
    status: 'degraded',
    reasonCode: 'timeout',
    circuitState: 'closed',
    totalTimeout: 2,
    consecutiveFailures: 2,
    warningCodes: ['HEALTH_DEGRADED'],
  })
}

export function staleSnapshotFixture(): PluginRuntimeHealthSnapshot {
  return healthSnapshotFixture({
    status: 'unknown',
    reasonCode: 'stale',
    isStale: true,
    lastSeenAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    warningCodes: ['HEALTH_STALE'],
  })
}

export function halfOpenSnapshotFixture(): PluginRuntimeHealthSnapshot {
  return healthSnapshotFixture({
    status: 'degraded',
    reasonCode: 'crash',
    circuitState: 'half_open',
    consecutiveFailures: 5,
    warningCodes: ['CIRCUIT_HALF_OPEN'],
  })
}

export function largeHealthSnapshotSet(count = 10): PluginRuntimeHealthSnapshot[] {
  const list: PluginRuntimeHealthSnapshot[] = []
  for (let i = 0; i < count; i++) {
    list.push(
      healthSnapshotFixture({
        installationId: 100 + i,
        pluginId: `com.aiproj.pack-${i}`,
        status: (['healthy', 'degraded', 'unhealthy', 'unknown'] as PluginRuntimeHealthStatus[])[
          i % 4
        ],
        lastSeenAt: new Date(Date.now() - i * 2000).toISOString(),
      }),
    )
  }
  return list
}

export function largeHealthEventSet(count = 10): PluginRuntimeHealthEvent[] {
  const outcomes: PluginRuntimeHealthOutcome[] = [
    'success',
    'crash',
    'timeout',
    'quota_exceeded',
    'permission_denied',
  ]
  return Array.from({ length: count }, (_, i) =>
    healthEventFixture({
      outcome: outcomes[i % outcomes.length],
      reasonCode: outcomes[i % outcomes.length] === 'success' ? 'unknown' : 'crash',
    }),
  )
}
