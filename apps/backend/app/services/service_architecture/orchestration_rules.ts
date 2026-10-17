/**
 * v3-service-architecture-expansion — orchestration & external action rules.
 *
 * Backend helpers that encode the expected high-risk orchestration order and
 * validate fixture flows against it.
 *
 * Task 5.1: encode expected orchestration order.
 * Task 5.2: provider adapter invocation after tenant + RBAC preflight.
 * Task 5.3: formal-write flows without confirmation are reported as gaps.
 * Task 5.4: orchestrators delegate formal reads/writes to domain services.
 * Task 5.5: default provider validation uses fixtures/mocks, no real external calls.
 */
import {
  EXPECTED_ORCHESTRATION_ORDER,
  PREFLIGHT_STEPS_BEFORE_ADAPTER,
  EXTERNAL_ACTION_CLASSES,
  EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION,
  BOUNDARY_CHECK_CATEGORIES,
  ARCHITECTURE_REASON_CODES,
  FINDING_SEVERITIES,
  EVIDENCE_FRESHNESS_STATUSES,
  validateOrchestrationFlow,
  detectOrchestratorDuplicateOwnership,
  type OrchestrationFlowFixture,
  type OrchestrationStep,
  type ExternalActionClass,
  type ServiceArchitectureFinding,
  type AuthorizedRealSmokeRecord,
} from '@aiproj/types'

/**
 * The canonical expected ordering for high-risk flows.
 * Re-exported from the shared contract for backend convenience.
 */
export { EXPECTED_ORCHESTRATION_ORDER, PREFLIGHT_STEPS_BEFORE_ADAPTER }

/**
 * Validate an orchestration flow fixture against the expected ordering.
 * Wraps the shared contract helper and returns findings.
 *
 * Task 5.1, 5.2, 5.3.
 */
export function validateOrchestrationFlowBackend(
  flow: OrchestrationFlowFixture,
): ServiceArchitectureFinding[] {
  return validateOrchestrationFlow(flow)
}

/**
 * Check that provider adapter invocation is modeled after tenant and RBAC preflight.
 *
 * Task 5.2: tests proving provider adapter invocation is modeled after
 * tenant and RBAC preflight in representative fixture flows.
 */
export function checkProviderCallPreflight(
  flow: OrchestrationFlowFixture,
): ServiceArchitectureFinding[] {
  if (!flow.callsAdapter) return []
  const findings = validateOrchestrationFlow(flow)
  return findings.filter(
    (f) => f.reasonCode === ARCHITECTURE_REASON_CODES.ORCHESTRATION_ORDER_VIOLATION,
  )
}

/**
 * Check that formal-write fixture flows have required preview/diff/confirmation metadata.
 *
 * Task 5.3: tests proving formal-write fixture flows without required
 * preview/diff/confirmation metadata are reported as architecture gaps.
 */
export function checkFormalWriteConfirmation(
  flow: OrchestrationFlowFixture,
): ServiceArchitectureFinding[] {
  if (!flow.formalWrite) return []
  const findings = validateOrchestrationFlow(flow)
  return findings.filter(
    (f) => f.reasonCode === ARCHITECTURE_REASON_CODES.FORMAL_WRITE_MISSING_CONFIRMATION,
  )
}

/**
 * Check that orchestrator fixture modules delegate formal reads/writes to
 * owning domain services instead of declaring themselves as alternate sources of truth.
 *
 * Task 5.4.
 */
export function checkOrchestratorDelegation(
  flow: OrchestrationFlowFixture & { declaresOwnOwnership?: boolean },
): ServiceArchitectureFinding[] {
  return detectOrchestratorDuplicateOwnership(flow)
}

/**
 * Assert that default provider validation uses fixtures or mocks and does not
 * require OAuth, token exchange, webhooks, Web Push, real model calls, OCR
 * provider calls, public network writes or external smoke.
 *
 * Task 5.5: tests proving default provider validation uses fixtures or mocks.
 *
 * Returns true if the external action class is safe for default (fixture/mock) mode,
 * false if it requires real authorization.
 */
export function isSafeForDefaultMode(externalActionClass: ExternalActionClass): boolean {
  return !EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION.includes(externalActionClass)
}

/**
 * Check that a provider flow uses fixture/mock mode by default.
 * Returns a finding if the flow's external action class requires real authorization
 * but the flow does not declare an authorization gate.
 *
 * Task 5.5.
 */
export function checkDefaultProviderUsesFixtures(
  flow: OrchestrationFlowFixture & {
    externalActionClass?: ExternalActionClass
    declaresAuthorizationGate?: boolean
  },
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  const actionClass = flow.externalActionClass ?? EXTERNAL_ACTION_CLASSES.NONE

  if (EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION.includes(actionClass)) {
    if (!flow.declaresAuthorizationGate) {
      findings.push({
        moduleKey: flow.moduleKey,
        category: BOUNDARY_CHECK_CATEGORIES.ORCHESTRATION,
        reasonCode: ARCHITECTURE_REASON_CODES.ORCHESTRATION_ORDER_VIOLATION,
        severity: FINDING_SEVERITIES.HIGH,
        message:
          'external action ' +
          actionClass +
          ' requires user authorization gate before real execution; default mode must use fixtures/mocks',
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
    }
  }

  return findings
}

/**
 * Get the list of external action classes that require explicit user authorization.
 * Used to document which actions cannot run in default (fixture/mock) mode.
 */
export function getAuthorizationRequiredActions(): readonly ExternalActionClass[] {
  return EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION
}

/**
 * Validate an authorized real provider smoke record.
 * Ensures the record does not store sensitive payloads and records required boundaries.
 *
 * Task 5.6: document how a future user-authorized real provider smoke must record
 * endpoint/provider/model/call volume/cost/result/redaction boundary without
 * storing sensitive payloads.
 */
export function validateAuthorizedRealSmokeRecord(record: AuthorizedRealSmokeRecord): {
  ok: boolean
  violations: string[]
} {
  const violations: string[] = []

  if (!record.provider || record.provider.trim().length === 0) {
    violations.push('provider is required')
  }
  if (!record.resultSummary || record.resultSummary.trim().length === 0) {
    violations.push('resultSummary is required')
  }
  if (!record.redactionBoundary || record.redactionBoundary.trim().length === 0) {
    violations.push('redactionBoundary is required')
  }
  if (record.callVolume < 0) {
    violations.push('callVolume must be non-negative')
  }
  // CRITICAL: sensitive payloads must never be stored.
  if (record.storedSensitivePayload !== false) {
    violations.push('storedSensitivePayload must be false — sensitive payloads are never stored')
  }

  return { ok: violations.length === 0, violations }
}

// Re-export types for convenience.
export type {
  OrchestrationFlowFixture,
  OrchestrationStep,
  ExternalActionClass,
  ServiceArchitectureFinding,
  AuthorizedRealSmokeRecord,
}
