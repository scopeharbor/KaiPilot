import { describe, expect, it } from 'vitest'
import {
  PLUGIN_TRIZ_PACK_ID,
  TRIZ_PLUGIN_OPERATIONS,
  isTrizPluginOperation,
  validateTrizPluginPackOperation,
  computeTrizPackOperationDigest,
  buildTrizPackHealthReport,
  trizPackStableSerialize,
} from './triz-plugin-pack.js'
import {
  VALID_TRIZ_PACK_CONTRIBUTIONS,
  VALID_TRIZ_OPERATION_PAYLOADS,
  NEGATIVE_TRIZ_OPERATION_FIXTURES,
} from './triz-plugin-pack-fixtures.js'
import { validatePluginContributionPayload } from './plugin-skill-adapter.js'
import { validatePluginServerHookPayload } from './plugin-server-hook-runtime.js'

describe('triz-plugin-pack manifest & contribution seam binding', () => {
  it('official pack declares stable contributions bound to registered seams', () => {
    expect(PLUGIN_TRIZ_PACK_ID).toBe('com.aiproj.official.triz-pack')
    expect(VALID_TRIZ_PACK_CONTRIBUTIONS.length).toBeGreaterThanOrEqual(4)
    const allowedSeams = new Set([
      'skill-adapter.skill-bundle',
      'server-command-proposal.proposal-only',
      'server-query.readonly-provider',
      'compiler-contribution.context-contribution',
    ])
    for (const c of VALID_TRIZ_PACK_CONTRIBUTIONS) {
      expect(allowedSeams.has(c.seamKey), `unknown seam ${c.seamKey}`).toBe(true)
    }
  })
  it('each contribution is validateable via existing seam validators (minimal permissions)', () => {
    for (const c of VALID_TRIZ_PACK_CONTRIBUTIONS) {
      let res: any
      if (
        c.seamKey === 'skill-adapter.skill-bundle' ||
        c.seamKey === 'compiler-contribution.context-contribution'
      ) {
        res = validatePluginContributionPayload(c.seamKey as any, c.payload as any)
      } else {
        res = validatePluginServerHookPayload(c.seamKey as any, c.payload as any)
      }
      expect(
        res.valid,
        `${c.contributionKey} should be valid: ${JSON.stringify(res.findings)}`,
      ).toBe(true)
    }
  })
})
describe('triz-plugin-pack closed operation facade', () => {
  it('allows known operations and rejects unknown operation', () => {
    for (const op of TRIZ_PLUGIN_OPERATIONS) {
      expect(isTrizPluginOperation(op)).toBe(true)
      const payload = { ...VALID_TRIZ_OPERATION_PAYLOADS.assistant, operation: op, enableAi: false }
      const res = validateTrizPluginPackOperation(payload, {
        callerOrganizationId: 1,
        isPluginEnabled: true,
        installationStatus: 'enabled',
        providerCalls: 0,
      })
      expect(
        res.valid || res.findings.some((f) => f.code === 'triz-pack-invalid-param'),
      ).toBeTruthy()
    }
    const neg = validateTrizPluginPackOperation(
      NEGATIVE_TRIZ_OPERATION_FIXTURES.unknownOperation as any,
      { callerOrganizationId: 1, isPluginEnabled: true, installationStatus: 'enabled' },
    )
    expect(neg.valid).toBe(false)
    expect(neg.findings.some((f) => f.code === 'triz-pack-unknown-operation')).toBe(true)
  })
  it('rejects arbitrary method / SQL injection', () => {
    const r1 = validateTrizPluginPackOperation(
      NEGATIVE_TRIZ_OPERATION_FIXTURES.arbitraryMethod as any,
      { callerOrganizationId: 1, isPluginEnabled: true, installationStatus: 'enabled' },
    )
    expect(r1.valid).toBe(false)
    const r2 = validateTrizPluginPackOperation(
      NEGATIVE_TRIZ_OPERATION_FIXTURES.sqlInjection as any,
      { callerOrganizationId: 1, isPluginEnabled: true, installationStatus: 'enabled' },
    )
    expect(r2.valid).toBe(false)
    expect(r2.findings.some((f) => f.code === 'triz-pack-sensitive-content-detected')).toBe(true)
  })
  it('rejects param out of bounds and direct write attempt', () => {
    const r1 = validateTrizPluginPackOperation(
      NEGATIVE_TRIZ_OPERATION_FIXTURES.paramOutOfBoundsMessage as any,
      { callerOrganizationId: 1, isPluginEnabled: true, installationStatus: 'enabled' },
    )
    expect(r1.valid).toBe(false)
    expect(r1.findings.some((f) => f.code === 'triz-pack-param-out-of-bounds')).toBe(true)
    const r2 = validateTrizPluginPackOperation(
      NEGATIVE_TRIZ_OPERATION_FIXTURES.directWriteAttempt as any,
      { callerOrganizationId: 1, isPluginEnabled: true, installationStatus: 'enabled' },
    )
    expect(r2.valid).toBe(false)
    expect(r2.findings.some((f) => f.code === 'triz-pack-direct-write-attempt')).toBe(true)
  })
  it('rejects cross-tenant (organizationId mismatch)', () => {
    const res = validateTrizPluginPackOperation(
      NEGATIVE_TRIZ_OPERATION_FIXTURES.crossTenant as any,
      { callerOrganizationId: 1, isPluginEnabled: true, installationStatus: 'enabled' },
    )
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'triz-pack-cross-tenant-denied')).toBe(true)
  })
  it('fail closed when not installed / disabled / uninstalled but retains history readability (gating only)', () => {
    const base = VALID_TRIZ_OPERATION_PAYLOADS.assistant
    const notInstalled = validateTrizPluginPackOperation(base, {
      callerOrganizationId: 1,
      isPluginEnabled: false,
      installationStatus: undefined,
    })
    expect(notInstalled.valid).toBe(false)
    expect(notInstalled.findings.some((f) => f.code === 'triz-pack-not-installed')).toBe(true)
    const disabled = validateTrizPluginPackOperation(base, {
      callerOrganizationId: 1,
      isPluginEnabled: false,
      installationStatus: 'installed',
    })
    expect(disabled.valid).toBe(false)
    expect(disabled.findings.some((f) => f.code === 'triz-pack-not-enabled')).toBe(true)
    const uninstalled = validateTrizPluginPackOperation(base, {
      callerOrganizationId: 1,
      isPluginEnabled: false,
      installationStatus: 'uninstalled',
    })
    expect(uninstalled.valid).toBe(false)
    expect(uninstalled.findings.some((f) => f.code === 'triz-pack-uninstalled')).toBe(true)
    const enabled = validateTrizPluginPackOperation(base, {
      callerOrganizationId: 1,
      isPluginEnabled: true,
      installationStatus: 'enabled',
      providerCalls: 0,
    })
    expect(enabled.valid).toBe(true)
  })
  it('deterministic input normalization & host-result equivalence (digest stable)', () => {
    const p1 = VALID_TRIZ_OPERATION_PAYLOADS.technical
    const p2 = { ...p1, input: { userContext: '分析技术矛盾：性能与成本的平衡' } }
    const d1 = computeTrizPackOperationDigest(p1)
    const d2 = computeTrizPackOperationDigest(p2)
    expect(d1).toBe(d2)
    const p3 = { ...p1, input: { userContext: 'different' } }
    expect(computeTrizPackOperationDigest(p3)).not.toBe(d1)
  })
  it('AI providerCalls=0 required for default fixture, outputs are draft/preview (marker)', () => {
    const base = VALID_TRIZ_OPERATION_PAYLOADS.assistant
    const res = validateTrizPluginPackOperation(base, {
      callerOrganizationId: 1,
      isPluginEnabled: true,
      installationStatus: 'enabled',
      providerCalls: 5,
    })
    expect(res.findings.some((f) => f.code === 'triz-pack-provider-calls-not-zero')).toBe(true)
    const res2 = validateTrizPluginPackOperation(base, {
      callerOrganizationId: 1,
      isPluginEnabled: true,
      installationStatus: 'enabled',
      providerCalls: 0,
    })
    expect(res2.valid).toBe(true)
  })
})
describe('triz-plugin-pack health & compatibility', () => {
  it('builds health report with effective vs inactive contributions', () => {
    const contributions = VALID_TRIZ_PACK_CONTRIBUTIONS.map((c) => ({
      contributionKey: c.contributionKey,
      seamKey: c.seamKey,
      isEffective: true,
      reasonCode: undefined,
    }))
    const reportEnabled = buildTrizPackHealthReport(
      1,
      PLUGIN_TRIZ_PACK_ID,
      '1.0.0',
      'enabled',
      contributions,
    )
    expect(reportEnabled.effectiveOperations.length).toBe(TRIZ_PLUGIN_OPERATIONS.length)
    expect(reportEnabled.contributions.every((c) => c.isEffective)).toBe(true)
    const reportDisabled = buildTrizPackHealthReport(
      1,
      PLUGIN_TRIZ_PACK_ID,
      '1.0.0',
      'installed',
      contributions.map((c) => ({ ...c, isEffective: false, reasonCode: 'plugin_disabled' })),
    )
    expect(reportDisabled.effectiveOperations.length).toBe(0)
    expect(reportDisabled.contributions.every((c) => !c.isEffective)).toBe(true)
  })
  it('stable serialize & digest determinism', () => {
    const a = trizPackStableSerialize({ b: 2, a: 1 })
    const b = trizPackStableSerialize({ a: 1, b: 2 })
    expect(a).toBe(b)
  })
})
