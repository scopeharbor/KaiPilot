import { describe, expect, it } from 'vitest'
import {
  PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL,
  PLUGIN_SEAM_SERVER_QUERY,
  validatePluginServerHookPayload,
  validateServerQueryPayload,
  validateServerCommandProposalPayload,
  computePreflightResult,
  computeProposalSummary,
  validateProposalSummaryBinding,
  type PluginServerHookRequestContext,
} from './plugin-server-hook-runtime.js'
import {
  fixtureValidServerQueryPayload,
  fixtureValidServerProposalPayload,
  fixtureFieldOutOfBoundsPayload,
  fixtureNetworkViolationPayload,
  fixtureParallelRbacRecreationPayload,
  fixtureParallelTransactionRecreationPayload,
  fixtureParallelAuditRecreationPayload,
  fixtureServerHookSecretDetectedPayload,
  fixtureEmptyPayload,
  fixtureArrayPayload,
  fixtureRequestContext,
} from './plugin-server-hook-runtime-fixtures.js'

describe('plugin-server-hook-runtime payload validation and parallel recreation blocking', () => {
  it('validates legal server-query payload', () => {
    const res = validateServerQueryPayload(fixtureValidServerQueryPayload, '1.0.0')
    expect(res.valid).toBe(true)
    expect(res.findings).toHaveLength(0)
    expect(res.normalizedPayload).toBeDefined()
    expect(res.normalizedPayload?.callbackHandle).toBe('fixture-query-callback')

    // Through dispatch
    const resDispatch = validatePluginServerHookPayload(
      PLUGIN_SEAM_SERVER_QUERY,
      fixtureValidServerQueryPayload,
      '1.0.0',
    )
    expect(resDispatch.valid).toBe(true)
  })

  it('validates legal server-command-proposal payload', () => {
    const res = validateServerCommandProposalPayload(fixtureValidServerProposalPayload, '1.0.0')
    expect(res.valid).toBe(true)
    expect(res.findings).toHaveLength(0)
    expect(res.normalizedPayload).toBeDefined()
    expect(res.normalizedPayload?.callbackHandle).toBe('fixture-proposal-callback')

    // Through dispatch
    const resDispatch = validatePluginServerHookPayload(
      PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL,
      fixtureValidServerProposalPayload,
      '1.0.0',
    )
    expect(resDispatch.valid).toBe(true)
  })

  it('rejects field out of bounds', () => {
    const res = validateServerQueryPayload(fixtureFieldOutOfBoundsPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-unallowed-field')).toBe(true)
    expect(res.findings.some((f) => f.path === 'extraField')).toBe(true)
    expect(res.findings.some((f) => f.path === 'anotherField')).toBe(true)
  })

  it('rejects network policy violation', () => {
    const res = validateServerQueryPayload(fixtureNetworkViolationPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-network-policy-violation')).toBe(
      true,
    )
    expect(res.findings.some((f) => f.path === 'networkPolicy')).toBe(true)
  })

  it('rejects parallel RBAC recreation', () => {
    const res = validateServerQueryPayload(fixtureParallelRbacRecreationPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-parallel-rbac-recreation')).toBe(
      true,
    )
  })

  it('rejects parallel transaction recreation', () => {
    const res = validateServerQueryPayload(fixtureParallelTransactionRecreationPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'plugin-server-hook-parallel-transaction-recreation'),
    ).toBe(true)
  })

  it('rejects parallel audit recreation', () => {
    const res = validateServerQueryPayload(fixtureParallelAuditRecreationPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'plugin-server-hook-parallel-audit-recreation'),
    ).toBe(true)
  })

  it('rejects secret material', () => {
    const res = validateServerQueryPayload(fixtureServerHookSecretDetectedPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-secret-detected')).toBe(true)
  })

  it('rejects empty payload', () => {
    const res = validateServerQueryPayload(fixtureEmptyPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-missing-callback-handle')).toBe(
      true,
    )
  })

  it('rejects array payload', () => {
    const res = validateServerQueryPayload(fixtureArrayPayload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-schema-invalid')).toBe(true)
  })

  it('rejects unknown seamKey via dispatch', () => {
    const res = validatePluginServerHookPayload('unknown.seam', {}, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-unknown-seam')).toBe(true)
  })

  it('rejects missing callbackHandle', () => {
    const payload = { description: 'missing handle' }
    const res = validateServerQueryPayload(payload, '1.0.0')
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-server-hook-missing-callback-handle')).toBe(
      true,
    )
  })

  it('rejects incompatible seam version', () => {
    const res = validateServerQueryPayload(fixtureValidServerQueryPayload, '2.0.0')
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'plugin-server-hook-incompatible-seam-version'),
    ).toBe(true)
  })
})

describe('preflight result computation', () => {
  const orgContext: PluginServerHookRequestContext = {
    organizationId: 1,
    projectId: 100,
    userId: 1001,
    userRoles: ['admin', 'project_manager'],
    requestedPermissions: ['project:task:view'],
    scope: 'project',
  }

  it('allows when organization matches and permissions present', () => {
    const result = computePreflightResult(orgContext, ['admin'], 1)
    expect(result.allowed).toBe(true)
    expect(result.missingPermissions).toHaveLength(0)
    expect(result.visible).toBe(true)
  })

  it('rejects when organization mismatch', () => {
    const result = computePreflightResult(orgContext, ['admin'], 2)
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('organization_mismatch')
  })

  it('rejects when missing permissions', () => {
    const result = computePreflightResult(orgContext, ['super_admin'], 1)
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe('missing_permissions')
    expect(result.missingPermissions).toContain('super_admin')
  })
})

describe('proposal summary binding', () => {
  it('computes deterministic summary', () => {
    const payload = { action: 'create', title: 'test' }
    const summary1 = computeProposalSummary(payload)
    const summary2 = computeProposalSummary(payload)
    expect(summary1).toBe(summary2)
    expect(typeof summary1).toBe('string')
    expect(summary1.length).toBeGreaterThan(0)
  })

  it('validates matching summary', () => {
    const payload = { action: 'create', title: 'test' }
    const summary = computeProposalSummary(payload)
    const result = validateProposalSummaryBinding(summary, payload)
    expect(result.valid).toBe(true)
    expect(result.expectedSummary).toBe(summary)
  })

  it('rejects non-matching summary', () => {
    const payload = { action: 'create', title: 'test' }
    const result = validateProposalSummaryBinding('wrong-summary', payload)
    expect(result.valid).toBe(false)
    expect(result.expectedSummary).toBe(computeProposalSummary(payload))
  })
})
