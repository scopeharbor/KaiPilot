/**
 * plugin-permission-decision-fixtures —— V3 插件权限决策 fixture packs
 * （纯类型 + 常量，零运行时依赖）。
 *
 * 覆盖全部 spec rule families：allow、RBAC deny、grant escalation、
 * manifest mismatch、scope mismatch、replay detection、audit failure、
 * sensitive values（redacted）、budget exceeded、retention expired。
 *
 * 每个 fixture 有稳定 id、完整 decision record 和预期断言字段。
 */

import type {
  PluginPermissionDecisionRecord,
  PluginPermissionDecisionMode,
  PluginPermissionDecisionOperation,
  PluginPermissionDecisionOutcome,
  PluginPermissionReasonCode,
  PluginPermissionRequestedRef,
  PluginPermissionGrantedRef,
  PluginPermissionRuntimeRef,
} from './plugin-permission-decision.js'

// =============================================================================
// Fixture Base Builders
// =============================================================================

function baseRequested(
  overrides: Partial<PluginPermissionRequestedRef> = {},
): PluginPermissionRequestedRef {
  return {
    permissionKey: 'project.tasks.read',
    scopeKind: 'project',
    ...overrides,
  }
}

function baseGranted(
  overrides: Partial<PluginPermissionGrantedRef> = {},
): PluginPermissionGrantedRef {
  return {
    grantId: 'grant-001',
    permissionKey: 'project.tasks.read',
    scopeBinding: { organizationScope: 'org-abc', projectScope: 'proj-123' },
    expired: false,
    revoked: false,
    ...overrides,
  }
}

function baseRuntime(
  overrides: Partial<PluginPermissionRuntimeRef> = {},
): PluginPermissionRuntimeRef {
  return {
    seamKey: 'project.tasks.seam',
    seamAvailability: 'host-ready',
    installState: 'installed',
    confirmationPending: false,
    ...overrides,
  }
}

function baseRecord(
  overrides: Partial<PluginPermissionDecisionRecord> = {},
): PluginPermissionDecisionRecord {
  return {
    decisionId: 'decision-fix-000',
    schemaVersion: '1',
    createdAt: '2026-08-16T00:00:00Z',
    mode: 'plugin-runtime',
    operation: 'execute',
    outcome: 'allowed',
    organizationScope: 'org-abc',
    projectScope: 'proj-123',
    pluginId: 'org.example-plugin',
    pluginVersion: '1.0.0',
    targetRef: 'target:project.tasks.read',
    requestedPermissions: [baseRequested()],
    grantedPermissions: [baseGranted()],
    runtimeRef: baseRuntime(),
    evaluation: {
      outcome: 'allowed',
      evaluatedAt: '2026-08-16T00:00:00Z',
      prerequisiteChecks: [],
    },
    idempotencyKey: 'idem-001',
    inputFingerprint: 'fp-00000000',
    actorRef: 'actor-admin-001',
    observationDegraded: false,
    ...overrides,
  }
}

// =============================================================================
// Fixture Packs (stable ids)
// =============================================================================

/** Happy path: plugin runtime execute → allowed. */
export const FIXTURE_ALLOW_HAPPY_PATH: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-allow-happy-001',
  mode: 'plugin-runtime',
  operation: 'execute',
  outcome: 'allowed',
  evaluation: {
    outcome: 'allowed',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [
      { profile: 'plugin-runtime-read', name: 'valid-install-state', passed: true },
      { profile: 'plugin-runtime-read', name: 'grant-valid', passed: true },
      { profile: 'plugin-runtime-read', name: 'seam-host-ready', passed: true },
      { profile: 'plugin-runtime-read', name: 'scope-matches', passed: true },
    ],
  },
})

/** RBAC denied: host-administration mutation → denied by RBAC. */
export const FIXTURE_DENY_RBAC: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-rbac-001',
  mode: 'host-administration',
  operation: 'enable',
  outcome: 'denied',
  reasonCode: 'rbac-denied',
  actorRef: 'actor-member-002',
  evaluation: {
    outcome: 'denied',
    reasonCode: 'rbac-denied',
    reasonMessage: 'Actor lacks required RBAC role for host-administration mutation.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [
      { profile: 'host-admin-mutation', name: 'valid-install-state', passed: true },
      {
        profile: 'host-admin-mutation',
        name: 'rbac-authorized',
        passed: false,
        reasonCode: 'rbac-denied',
      },
      { profile: 'host-admin-mutation', name: 'scope-matches', passed: true },
    ],
  },
})

/** Grant escalation: requested permission exceeds granted scope. */
export const FIXTURE_DENY_GRANT_ESCALATION: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-escalation-001',
  mode: 'plugin-runtime',
  operation: 'execute',
  outcome: 'denied',
  reasonCode: 'grant-escalation',
  requestedPermissions: [
    baseRequested({ permissionKey: 'project.tasks.write', scopeKind: 'project' }),
  ],
  grantedPermissions: [
    baseGranted({
      permissionKey: 'project.tasks.read',
      scopeBinding: { organizationScope: 'org-abc', projectScope: 'proj-123' },
    }),
  ],
  evaluation: {
    outcome: 'denied',
    reasonCode: 'grant-escalation',
    reasonMessage: 'Requested permission project.tasks.write exceeds granted scope.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [{ profile: 'plugin-runtime-read', name: 'grant-valid', passed: true }],
  },
})

/** Manifest mismatch: plugin manifest does not match expected. */
export const FIXTURE_DENY_MANIFEST_MISMATCH: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-manifest-001',
  mode: 'plugin-runtime',
  operation: 'upgrade',
  outcome: 'denied',
  reasonCode: 'manifest-mismatch',
  pluginVersion: '2.0.0',
  evaluation: {
    outcome: 'denied',
    reasonCode: 'manifest-mismatch',
    reasonMessage: 'Plugin manifest digest does not match expected version.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [],
  },
})

/** Scope mismatch: plugin operation targets different scope. */
export const FIXTURE_DENY_SCOPE_MISMATCH: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-scope-001',
  mode: 'plugin-runtime',
  operation: 'resolve-query',
  outcome: 'denied',
  reasonCode: 'scope-mismatch',
  requestedPermissions: [baseRequested({ scopeKind: 'organization' })],
  grantedPermissions: [
    baseGranted({ scopeBinding: { organizationScope: 'org-abc', projectScope: 'proj-123' } }),
  ],
  evaluation: {
    outcome: 'denied',
    reasonCode: 'scope-mismatch',
    reasonMessage: 'Requested organization scope not covered by project-level grant.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [
      {
        profile: 'plugin-runtime-read',
        name: 'scope-matches',
        passed: false,
        reasonCode: 'scope-mismatch',
      },
    ],
  },
})

/** Replay detection: same idempotency key already processed. */
export const FIXTURE_DENY_REPLAY: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-replay-001',
  idempotencyKey: 'idem-replay-001',
  outcome: 'denied',
  reasonCode: 'replay-detected',
  evaluation: {
    outcome: 'denied',
    reasonCode: 'replay-detected',
    reasonMessage: 'Decision with this idempotency key was already processed.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [],
  },
})

/** Audit failure: audit system unavailable. */
export const FIXTURE_DENY_AUDIT_FAILURE: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-audit-001',
  mode: 'plugin-runtime',
  operation: 'execute',
  outcome: 'denied',
  reasonCode: 'audit-unavailable',
  runtimeRef: baseRuntime(),
  evaluation: {
    outcome: 'denied',
    reasonCode: 'audit-unavailable',
    reasonMessage: 'Audit logging system is unavailable; formal-write blocked.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [
      {
        profile: 'plugin-runtime-formal-write',
        name: 'audit-available',
        passed: false,
        reasonCode: 'audit-unavailable',
      },
    ],
  },
})

/** Sensitive values: record contains redacted values only. */
export const FIXTURE_SENSITIVE_REDACTED: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-sensitive-001',
  pluginId: 'org.redacted-plugin',
  targetRef: 'target:redacted-resource',
  actorRef: 'actor-[REDACTED]',
  evaluation: {
    outcome: 'allowed',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [],
  },
})

/** Budget exceeded: observation budget cap reached. */
export const FIXTURE_DENY_BUDGET_EXCEEDED: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-budget-001',
  outcome: 'denied',
  reasonCode: 'unknown-error',
  evaluation: {
    outcome: 'denied',
    reasonCode: 'unknown-error',
    reasonMessage: 'Observation budget exceeded; query truncated.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [],
  },
})

/** Retention expired: decision record past retention window. */
export const FIXTURE_DENY_RETENTION_EXPIRED: PluginPermissionDecisionRecord = baseRecord({
  decisionId: 'fixture-deny-retention-001',
  createdAt: '2025-01-01T00:00:00Z',
  outcome: 'denied',
  reasonCode: 'unknown-error',
  evaluation: {
    outcome: 'denied',
    reasonCode: 'unknown-error',
    reasonMessage: 'Decision record expired beyond retention window.',
    evaluatedAt: '2026-08-16T00:00:00Z',
    prerequisiteChecks: [],
  },
})

// =============================================================================
// Fixture Collection
// =============================================================================

/** All fixture records indexed by stable id. */
export const PLUGIN_PERMISSION_DECISION_FIXTURES: Record<string, PluginPermissionDecisionRecord> = {
  'allow-happy-path': FIXTURE_ALLOW_HAPPY_PATH,
  'deny-rbac': FIXTURE_DENY_RBAC,
  'deny-grant-escalation': FIXTURE_DENY_GRANT_ESCALATION,
  'deny-manifest-mismatch': FIXTURE_DENY_MANIFEST_MISMATCH,
  'deny-scope-mismatch': FIXTURE_DENY_SCOPE_MISMATCH,
  'deny-replay-detected': FIXTURE_DENY_REPLAY,
  'deny-audit-failure': FIXTURE_DENY_AUDIT_FAILURE,
  'sensitive-redacted': FIXTURE_SENSITIVE_REDACTED,
  'deny-budget-exceeded': FIXTURE_DENY_BUDGET_EXCEEDED,
  'deny-retention-expired': FIXTURE_DENY_RETENTION_EXPIRED,
}

/** Stable fixture IDs (for ordered iteration). */
export const PLUGIN_PERMISSION_DECISION_FIXTURE_IDS: readonly string[] = [
  'allow-happy-path',
  'deny-rbac',
  'deny-grant-escalation',
  'deny-manifest-mismatch',
  'deny-scope-mismatch',
  'deny-replay-detected',
  'deny-audit-failure',
  'sensitive-redacted',
  'deny-budget-exceeded',
  'deny-retention-expired',
]

/** Fixture rule families (for coverage tracking). */
export const PLUGIN_PERMISSION_DECISION_RULE_FAMILIES: readonly string[] = [
  'allow',
  'rbac-deny',
  'grant-escalation',
  'manifest-mismatch',
  'scope-mismatch',
  'replay-detection',
  'audit-failure',
  'sensitive-redaction',
  'budget-exceeded',
  'retention-expired',
]

/** Map from fixture id to rule family. */
export const FIXTURE_TO_RULE_FAMILY: Record<string, string> = {
  'allow-happy-path': 'allow',
  'deny-rbac': 'rbac-deny',
  'deny-grant-escalation': 'grant-escalation',
  'deny-manifest-mismatch': 'manifest-mismatch',
  'deny-scope-mismatch': 'scope-mismatch',
  'deny-replay-detected': 'replay-detection',
  'deny-audit-failure': 'audit-failure',
  'sensitive-redacted': 'sensitive-redaction',
  'deny-budget-exceeded': 'budget-exceeded',
  'deny-retention-expired': 'retention-expired',
}

// =============================================================================
// Expected Assertions per Fixture
// =============================================================================

export interface FixtureExpectedAssertions {
  fixtureId: string
  expectedOutcome: PluginPermissionDecisionOutcome
  expectedReasonCode?: PluginPermissionReasonCode
  expectedMode: PluginPermissionDecisionMode
  expectedOperation: PluginPermissionDecisionOperation
  expectedSchemaVersion: string
  mustContainNoSecrets: boolean
  mustHaveDecisionId: boolean
  mustHaveIdempotencyKey: boolean
}

export const FIXTURE_EXPECTED_ASSERTIONS: FixtureExpectedAssertions[] = [
  {
    fixtureId: 'allow-happy-path',
    expectedOutcome: 'allowed',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-rbac',
    expectedOutcome: 'denied',
    expectedReasonCode: 'rbac-denied',
    expectedMode: 'host-administration',
    expectedOperation: 'enable',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-grant-escalation',
    expectedOutcome: 'denied',
    expectedReasonCode: 'grant-escalation',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-manifest-mismatch',
    expectedOutcome: 'denied',
    expectedReasonCode: 'manifest-mismatch',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'upgrade',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-scope-mismatch',
    expectedOutcome: 'denied',
    expectedReasonCode: 'scope-mismatch',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'resolve-query',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-replay-detected',
    expectedOutcome: 'denied',
    expectedReasonCode: 'replay-detected',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-audit-failure',
    expectedOutcome: 'denied',
    expectedReasonCode: 'audit-unavailable',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'sensitive-redacted',
    expectedOutcome: 'allowed',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-budget-exceeded',
    expectedOutcome: 'denied',
    expectedReasonCode: 'unknown-error',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
  {
    fixtureId: 'deny-retention-expired',
    expectedOutcome: 'denied',
    expectedReasonCode: 'unknown-error',
    expectedMode: 'plugin-runtime',
    expectedOperation: 'execute',
    expectedSchemaVersion: '1',
    mustContainNoSecrets: true,
    mustHaveDecisionId: true,
    mustHaveIdempotencyKey: true,
  },
]
