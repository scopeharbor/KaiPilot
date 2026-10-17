/**
 * plugin-ui-command-perf.test.ts —— Performance measurement for normalize/project/owner replace
 *
 * 覆盖 task 7.3: 使用代表性批量 fixture 测量 normalize/project/owner replace，
 * 记录样本规模、结果和 performance 对照。
 */

import { describe, it, expect } from 'vitest'
import { normalizeAndProject, contributionCanonical, sortFindings } from './plugin-ui-command.js'
import { generateContributions } from './plugin-ui-command-fixtures.js'
import type { PluginUiCommandContributionV1 } from './plugin-ui-command.js'
import { PLUGIN_UI_COMMAND_SCHEMA_VERSION } from './plugin-ui-command.js'

// =============================================================================
// Performance benchmarks
// =============================================================================

describe('performance: normalizeAndProject', () => {
  const baseArgs = {
    pluginId: 'perf-plugin',
    manifestDigest: 'sha256:perf-test',
    instanceRevision: '1',
    referenceTime: '2026-08-18T12:00:00Z',
    trustedScope: {
      kind: 'project' as const,
      organizationId: 'org-001',
      projectId: 'proj-001',
    },
    hostReadySeams: ['command-palette'],
    effectiveGrantPermissions: ['risk:create', 'project:archive'],
    effectiveGrantExpiry: null as string | null,
    enabled: true,
    quarantined: false,
    coreCommandIds: new Set<string>(),
    existingOwnerCommandIds: new Map<string, Set<string>>(),
  }

  it('100 contributions: normalize + project completes in <100ms', () => {
    const contributions = generateContributions(100)
    const start = performance.now()
    const result = normalizeAndProject(
      contributions,
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    const elapsed = performance.now() - start

    expect(result.accepted).toHaveLength(100)
    expect(result.findings).toHaveLength(0)
    expect(elapsed).toBeLessThan(100) // <100ms for 100 contributions
    console.log(`[perf] 100 contributions: ${elapsed.toFixed(2)}ms`)
  })

  it('500 contributions: normalize + project completes in <500ms', () => {
    const contributions = generateContributions(500)
    const start = performance.now()
    const result = normalizeAndProject(
      contributions,
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    const elapsed = performance.now() - start

    expect(result.accepted).toHaveLength(500)
    expect(result.findings).toHaveLength(0)
    expect(elapsed).toBeLessThan(500) // <500ms for 500 contributions
    console.log(`[perf] 500 contributions: ${elapsed.toFixed(2)}ms`)
  })

  it('1000 contributions: normalize + project completes in <1000ms', () => {
    const contributions = generateContributions(1000)
    const start = performance.now()
    const result = normalizeAndProject(
      contributions,
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    const elapsed = performance.now() - start

    expect(result.accepted).toHaveLength(1000)
    expect(result.findings).toHaveLength(0)
    expect(elapsed).toBeLessThan(1000) // <1000ms for 1000 contributions
    console.log(`[perf] 1000 contributions: ${elapsed.toFixed(2)}ms`)
  })
})

describe('performance: contributionCanonical', () => {
  it('1000 canonical computations in <50ms', () => {
    const contrib = generateContributions(1)[0]
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      contributionCanonical(contrib)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
    console.log(`[perf] 1000 canonical: ${elapsed.toFixed(2)}ms`)
  })
})

describe('performance: sortFindings', () => {
  it('1000 findings sorted in <50ms', () => {
    const findings = Array.from({ length: 1000 }, (_, i) => ({
      reason: (
        [
          'core-conflict',
          'grant-expired',
          'scope-mismatch',
          'revision-stale',
          'unknown-action-kind',
        ] as const
      )[i % 5],
      severity: 'blocking' as const,
      pluginId: `plugin-${i}`,
      contributionKey: `cmd-${i}`,
    }))
    const start = performance.now()
    sortFindings(findings)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
    console.log(`[perf] 1000 findings sort: ${elapsed.toFixed(2)}ms`)
  })
})
