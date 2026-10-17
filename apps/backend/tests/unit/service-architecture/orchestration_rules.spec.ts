/**
 * v3-service-architecture-expansion — orchestration & external action rule tests.
 * Task 5.2: provider adapter invocation after tenant + RBAC preflight.
 * Task 5.3: formal-write flows without confirmation reported as gaps.
 * Task 5.4: orchestrators delegate formal reads/writes to domain services.
 * Task 5.5: default provider validation uses fixtures/mocks, no real external calls.
 * Task 5.6: authorized real provider smoke records boundaries.
 */
import { describe, expect, it } from 'vitest'
import {
  validateOrchestrationFlowBackend,
  checkProviderCallPreflight,
  checkFormalWriteConfirmation,
  checkOrchestratorDelegation,
  isSafeForDefaultMode,
  checkDefaultProviderUsesFixtures,
  getAuthorizationRequiredActions,
  validateAuthorizedRealSmokeRecord,
} from '../../../app/services/service_architecture/orchestration_rules.js'
import {
  ORCHESTRATION_STEPS,
  EXTERNAL_ACTION_CLASSES,
  EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION,
  EXPECTED_ORCHESTRATION_ORDER,
  PREFLIGHT_STEPS_BEFORE_ADAPTER,
  type OrchestrationFlowFixture,
  type AuthorizedRealSmokeRecord,
} from '@aiproj/types'

// ─── Fixture flows ──────────────────────────────────────────────────

const VALID_FLOW: OrchestrationFlowFixture = {
  moduleKey: 'ai-draft',
  flowName: 'create-draft-with-provider',
  callsAdapter: true,
  formalWrite: true,
  hasConfirmationMetadata: true,
  steps: [
    { step: ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT, performed: true },
    { step: ORCHESTRATION_STEPS.EFFECTIVE_TENANT, performed: true },
    { step: ORCHESTRATION_STEPS.VALIDATION, performed: true },
    { step: ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY, performed: true },
    { step: ORCHESTRATION_STEPS.PREVIEW_DIFF, performed: true },
    { step: ORCHESTRATION_STEPS.EXPLICIT_CONFIRMATION, performed: true },
    { step: ORCHESTRATION_STEPS.DOMAIN_TRANSACTION, performed: true },
    { step: ORCHESTRATION_STEPS.ADAPTER_PROVIDER_CALL, performed: true },
    { step: ORCHESTRATION_STEPS.LOW_SENSITIVE_AUDIT_LEDGER, performed: true },
  ],
}

const FLOW_ADAPTER_WITHOUT_TENANT: OrchestrationFlowFixture = {
  moduleKey: 'ai-draft',
  flowName: 'bad-adapter-no-tenant',
  callsAdapter: true,
  formalWrite: false,
  hasConfirmationMetadata: true,
  steps: [
    { step: ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT, performed: true },
    // EFFECTIVE_TENANT missing
    { step: ORCHESTRATION_STEPS.VALIDATION, performed: true },
    { step: ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY, performed: true },
    { step: ORCHESTRATION_STEPS.ADAPTER_PROVIDER_CALL, performed: true },
  ],
}

const FLOW_ADAPTER_WITHOUT_RBAC: OrchestrationFlowFixture = {
  moduleKey: 'ai-ocr',
  flowName: 'bad-adapter-no-rbac',
  callsAdapter: true,
  formalWrite: false,
  hasConfirmationMetadata: true,
  steps: [
    { step: ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT, performed: true },
    { step: ORCHESTRATION_STEPS.EFFECTIVE_TENANT, performed: true },
    { step: ORCHESTRATION_STEPS.VALIDATION, performed: true },
    // RBAC_DOMAIN_VISIBILITY missing
    { step: ORCHESTRATION_STEPS.ADAPTER_PROVIDER_CALL, performed: true },
  ],
}

const FLOW_FORMAL_WRITE_NO_CONFIRMATION: OrchestrationFlowFixture = {
  moduleKey: 'compiler',
  flowName: 'bad-formal-write-no-confirm',
  callsAdapter: false,
  formalWrite: true,
  hasConfirmationMetadata: false,
  steps: [
    { step: ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT, performed: true },
    { step: ORCHESTRATION_STEPS.EFFECTIVE_TENANT, performed: true },
    { step: ORCHESTRATION_STEPS.VALIDATION, performed: true },
    { step: ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY, performed: true },
    { step: ORCHESTRATION_STEPS.DOMAIN_TRANSACTION, performed: true },
  ],
}

const FLOW_ORCHESTRATOR_DUPLICATE_OWNERSHIP = {
  moduleKey: 'bad-orchestrator',
  flowName: 'duplicate-ownership',
  callsAdapter: false,
  formalWrite: true,
  hasConfirmationMetadata: true,
  declaresOwnOwnership: true,
  steps: [
    { step: ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT, performed: true },
    { step: ORCHESTRATION_STEPS.EFFECTIVE_TENANT, performed: true },
    { step: ORCHESTRATION_STEPS.VALIDATION, performed: true },
    { step: ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY, performed: true },
    { step: ORCHESTRATION_STEPS.DOMAIN_TRANSACTION, performed: true },
  ],
} as const

const FLOW_ORCHESTRATOR_DELEGATES = {
  moduleKey: 'good-orchestrator',
  flowName: 'delegates-to-domain',
  callsAdapter: false,
  formalWrite: true,
  hasConfirmationMetadata: true,
  declaresOwnOwnership: false,
  steps: [
    { step: ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT, performed: true },
    { step: ORCHESTRATION_STEPS.EFFECTIVE_TENANT, performed: true },
    { step: ORCHESTRATION_STEPS.VALIDATION, performed: true },
    { step: ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY, performed: true },
    { step: ORCHESTRATION_STEPS.DOMAIN_TRANSACTION, performed: true },
  ],
} as const

// ─── Tests ──────────────────────────────────────────────────────────

describe('Orchestration Order (task 5.1)', () => {
  it('expected order starts with authenticated context and ends with audit', () => {
    expect(EXPECTED_ORCHESTRATION_ORDER[0]).toBe('authenticated-context')
    expect(EXPECTED_ORCHESTRATION_ORDER[EXPECTED_ORCHESTRATION_ORDER.length - 1]).toBe(
      'low-sensitive-audit-ledger',
    )
  })

  it('preflight steps include tenant and RBAC before adapter', () => {
    expect(PREFLIGHT_STEPS_BEFORE_ADAPTER).toContain('effective-tenant')
    expect(PREFLIGHT_STEPS_BEFORE_ADAPTER).toContain('rbac-domain-visibility')
    expect(PREFLIGHT_STEPS_BEFORE_ADAPTER).not.toContain('adapter-provider-call')
  })

  it('valid flow passes backend validation with no findings', () => {
    const findings = validateOrchestrationFlowBackend(VALID_FLOW)
    expect(findings).toHaveLength(0)
  })
})

describe('Provider Call Preflight (task 5.2)', () => {
  it('valid flow with all preflight passes', () => {
    const findings = checkProviderCallPreflight(VALID_FLOW)
    expect(findings).toHaveLength(0)
  })

  it('flags provider call without tenant preflight', () => {
    const findings = checkProviderCallPreflight(FLOW_ADAPTER_WITHOUT_TENANT)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.message.includes('effective-tenant'))).toBe(true)
  })

  it('flags provider call without RBAC preflight', () => {
    const findings = checkProviderCallPreflight(FLOW_ADAPTER_WITHOUT_RBAC)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.message.includes('rbac-domain-visibility'))).toBe(true)
  })

  it('does not flag flows that do not call adapters', () => {
    const findings = checkProviderCallPreflight(FLOW_FORMAL_WRITE_NO_CONFIRMATION)
    expect(findings).toHaveLength(0)
  })
})

describe('Formal Write Confirmation (task 5.3)', () => {
  it('flags formal write without confirmation metadata', () => {
    const findings = checkFormalWriteConfirmation(FLOW_FORMAL_WRITE_NO_CONFIRMATION)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.reasonCode === 'formal-write-missing-confirmation')).toBe(true)
  })

  it('does not flag formal write with confirmation metadata', () => {
    const findings = checkFormalWriteConfirmation(VALID_FLOW)
    expect(findings).toHaveLength(0)
  })

  it('does not flag non-formal-write flows', () => {
    const findings = checkFormalWriteConfirmation(FLOW_ADAPTER_WITHOUT_TENANT)
    expect(findings).toHaveLength(0)
  })
})

describe('Orchestrator Delegation (task 5.4)', () => {
  it('flags orchestrator that declares itself as alternate source of truth', () => {
    const findings = checkOrchestratorDelegation(FLOW_ORCHESTRATOR_DUPLICATE_OWNERSHIP as never)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.reasonCode === 'orchestrator-duplicate-ownership')).toBe(true)
  })

  it('does not flag orchestrator that delegates to domain services', () => {
    const findings = checkOrchestratorDelegation(FLOW_ORCHESTRATOR_DELEGATES as never)
    expect(findings).toHaveLength(0)
  })
})

describe('Default Provider Uses Fixtures (task 5.5)', () => {
  it('isSafeForDefaultMode returns true for none action class', () => {
    expect(isSafeForDefaultMode(EXTERNAL_ACTION_CLASSES.NONE)).toBe(true)
  })

  it('isSafeForDefaultMode returns false for all authorization-required actions', () => {
    for (const action of EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION) {
      expect(isSafeForDefaultMode(action)).toBe(false)
    }
  })

  it('authorization-required actions include oauth, model-call, webhook, web-push, ocr-provider-call', () => {
    const required = getAuthorizationRequiredActions()
    expect(required).toContain('oauth-exchange')
    expect(required).toContain('model-call')
    expect(required).toContain('webhook-delivery')
    expect(required).toContain('web-push')
    expect(required).toContain('ocr-provider-call')
    expect(required).toContain('network-write')
    expect(required).toContain('provider-call')
  })

  it('flags flow with authorization-required action but no authorization gate', () => {
    const flow = {
      ...VALID_FLOW,
      externalActionClass: EXTERNAL_ACTION_CLASSES.MODEL_CALL,
      declaresAuthorizationGate: false,
    }
    const findings = checkDefaultProviderUsesFixtures(flow)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.message.includes('authorization gate'))).toBe(true)
  })

  it('does not flag flow with authorization-required action and authorization gate', () => {
    const flow = {
      ...VALID_FLOW,
      externalActionClass: EXTERNAL_ACTION_CLASSES.MODEL_CALL,
      declaresAuthorizationGate: true,
    }
    const findings = checkDefaultProviderUsesFixtures(flow)
    expect(findings).toHaveLength(0)
  })

  it('does not flag flow with none action class', () => {
    const flow = {
      ...VALID_FLOW,
      externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
      declaresAuthorizationGate: false,
    }
    const findings = checkDefaultProviderUsesFixtures(flow)
    expect(findings).toHaveLength(0)
  })
})

describe('Authorized Real Smoke Record (task 5.6)', () => {
  const validRecord: AuthorizedRealSmokeRecord = {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4',
    callVolume: 5,
    costOrUsage: '$0.12',
    resultSummary: '5/5 calls succeeded, 0 errors',
    redactionBoundary: 'no prompt text, model output, tokens or API keys stored',
    storedSensitivePayload: false,
  }

  it('accepts a valid smoke record', () => {
    const result = validateAuthorizedRealSmokeRecord(validRecord)
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('rejects record with missing provider', () => {
    const result = validateAuthorizedRealSmokeRecord({ ...validRecord, provider: '' })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('provider'))).toBe(true)
  })

  it('rejects record with missing resultSummary', () => {
    const result = validateAuthorizedRealSmokeRecord({ ...validRecord, resultSummary: '' })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('resultSummary'))).toBe(true)
  })

  it('rejects record with missing redactionBoundary', () => {
    const result = validateAuthorizedRealSmokeRecord({ ...validRecord, redactionBoundary: '' })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('redactionBoundary'))).toBe(true)
  })

  it('rejects record that stores sensitive payload', () => {
    const result = validateAuthorizedRealSmokeRecord({
      ...validRecord,
      storedSensitivePayload: true as never,
    })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('storedSensitivePayload'))).toBe(true)
  })

  it('rejects record with negative callVolume', () => {
    const result = validateAuthorizedRealSmokeRecord({ ...validRecord, callVolume: -1 })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('callVolume'))).toBe(true)
  })
})
