// @aiproj/types - V3 service architecture expansion fixtures.
// v3-service-architecture-expansion: representative catalog entries + orchestration flows.
import {
  SERVICE_ROLES,
  TENANT_MODES,
  SIDE_EFFECT_CLASSES,
  EXTERNAL_ACTION_CLASSES,
  AUDIT_LEDGER_EXPECTATIONS,
  EVIDENCE_FRESHNESS_STATUSES,
  INFRASTRUCTURE_PREREQUISITES,
  BOUNDARY_CHECK_CATEGORIES,
  ORCHESTRATION_STEPS,
  type ServiceCatalogEntry,
  type OrchestrationFlowFixture,
  type AllowlistEntry,
} from './service-architecture-expansion.js'

// ─── Representative domain service entry ────────────────────────────
export const FIXTURE_DOMAIN_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'knowledge',
  pathScope: 'apps/backend/app/services/knowledge/**',
  role: SERVICE_ROLES.DOMAIN_SERVICE,
  ownerDomain: 'knowledge',
  dependencyPolicy: {
    allowedConsumers: ['compiler', 'search', 'ai-draft'],
    allowedDependencies: ['search', 'cache'],
    forbiddenDependencies: ['adapters', 'sso', 'scim'],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  verificationHints: ['pnpm --filter backend test -- --grep knowledge'],
}

// ─── Representative orchestrator service entry ──────────────────────
export const FIXTURE_ORCHESTRATOR_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'ai-draft',
  pathScope: 'apps/backend/app/services/ai_draft/**',
  role: SERVICE_ROLES.ORCHESTRATOR_SERVICE,
  ownerDomain: 'ai',
  dependencyPolicy: {
    allowedConsumers: ['projects-controller'],
    allowedDependencies: ['knowledge', 'ai-intent', 'ai-m0', 'adapters'],
    forbiddenDependencies: ['sso', 'scim', 'kms'],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.AI_PERSISTENCE,
  externalActionClass: EXTERNAL_ACTION_CLASSES.MODEL_CALL,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  verificationHints: ['pnpm --filter backend test -- --grep ai_draft'],
}

// ─── Representative adapter service entry ───────────────────────────
export const FIXTURE_ADAPTER_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'adapters-watermark',
  pathScope: 'apps/backend/app/services/adapters/**',
  role: SERVICE_ROLES.ADAPTER_SERVICE,
  ownerDomain: 'security',
  dependencyPolicy: {
    allowedConsumers: ['file-v2', 'report-v2', 'ai-ocr'],
    allowedDependencies: ['kms'],
    forbiddenDependencies: ['sso', 'scim', 'rbac-service'],
  },
  tenantMode: TENANT_MODES.TENANT_DERIVED,
  sideEffectClass: SIDE_EFFECT_CLASSES.NONE,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.COVERED_BY_OWNER,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
}

// ─── Representative provider service entry ─────────────────────────
export const FIXTURE_PROVIDER_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'kms-provider',
  pathScope: 'apps/backend/app/services/kms/**',
  role: SERVICE_ROLES.PROVIDER_SERVICE,
  ownerDomain: 'security',
  dependencyPolicy: {
    allowedConsumers: ['kms', 'compliance', 'adapters'],
    allowedDependencies: ['kms'],
    forbiddenDependencies: ['sso', 'scim'],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.PROTECTED_EVIDENCE_PACKAGE,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
}

// ─── Representative audit service entry ─────────────────────────────
export const FIXTURE_AUDIT_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'sso-saml-audit',
  pathScope: 'apps/backend/app/services/sso/sso_saml_audit_service.ts',
  role: SERVICE_ROLES.AUDIT_SERVICE,
  ownerDomain: 'security',
  dependencyPolicy: {
    allowedConsumers: ['sso-saml2', 'sso-oidc'],
    allowedDependencies: [],
    forbiddenDependencies: ['adapters', 'compiler', 'ai-draft'],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
}

// ─── Representative ledger service entry ────────────────────────────
export const FIXTURE_LEDGER_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'kms-event-ledger',
  pathScope: 'apps/backend/app/services/kms/kms_event_ledger_writer.ts',
  role: SERVICE_ROLES.LEDGER_SERVICE,
  ownerDomain: 'security',
  dependencyPolicy: {
    allowedConsumers: ['kms', 'compliance'],
    allowedDependencies: ['kms'],
    forbiddenDependencies: ['adapters', 'sso', 'scim', 'ai-draft'],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.FORMAL_WRITE,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
}

// ─── Representative legacy service entry ────────────────────────────
export const FIXTURE_LEGACY_SERVICE_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'pdm-migration',
  pathScope: 'apps/backend/app/services/pdm_migration/**',
  role: SERVICE_ROLES.LEGACY_SERVICE,
  ownerDomain: 'platform',
  dependencyPolicy: {
    allowedConsumers: [],
    allowedDependencies: [],
    forbiddenDependencies: [],
  },
  tenantMode: TENANT_MODES.GLOBAL_ONLY,
  sideEffectClass: SIDE_EFFECT_CLASSES.NONE,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.DEFERRED,
  fixtureFirstTestStatus: false,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.STALE,
  verificationHints: ['legacy: not yet fully governed; follow-up change needed'],
}

// ─── Invalid catalog entry (missing required fields) ────────────────
export const FIXTURE_INVALID_CATALOG_ENTRY = {
  moduleKey: '',
  pathScope: '',
  role: 'invalid-role',
  ownerDomain: '',
  // dependencyPolicy missing
  tenantMode: 'invalid-tenant',
  sideEffectClass: 'invalid-side-effect',
  externalActionClass: 'invalid-external',
  auditLedgerExpectation: 'invalid-expectation',
  fixtureFirstTestStatus: false,
  evidenceFreshness: 'invalid-freshness',
} as unknown as ServiceCatalogEntry

// ─── Entry with rejected infrastructure prerequisite ────────────────
export const FIXTURE_REJECTED_INFRA_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'should-not-exist',
  pathScope: 'apps/backend/app/services/should-not-exist/**',
  role: SERVICE_ROLES.DOMAIN_SERVICE,
  ownerDomain: 'test',
  dependencyPolicy: {
    allowedConsumers: ['test'],
    allowedDependencies: [],
    forbiddenDependencies: [],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
  infrastructurePrerequisite: INFRASTRUCTURE_PREREQUISITES.MICROSERVICE_SPLIT,
}

// ─── Entry with missing ledger declaration (formal write, not-required) ──
export const FIXTURE_MISSING_LEDGER_ENTRY: ServiceCatalogEntry = {
  moduleKey: 'missing-ledger',
  pathScope: 'apps/backend/app/services/missing_ledger/**',
  role: SERVICE_ROLES.DOMAIN_SERVICE,
  ownerDomain: 'test',
  dependencyPolicy: {
    allowedConsumers: ['test'],
    allowedDependencies: [],
    forbiddenDependencies: [],
  },
  tenantMode: TENANT_MODES.TENANT_BOUND,
  sideEffectClass: SIDE_EFFECT_CLASSES.FORMAL_WRITE,
  externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
  auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
  fixtureFirstTestStatus: true,
  evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
}

// ─── Allowlist entry with missing reason (should fail validation) ──
export const FIXTURE_INVALID_ALLOWLIST_ENTRY: AllowlistEntry = {
  id: 'bad-allowlist',
  reason: '',
  owner: '',
  expiryOrFollowUp: '',
  category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
}

export const FIXTURE_VALID_ALLOWLIST_ENTRY: AllowlistEntry = {
  id: 'legacy-controller-exception',
  reason: 'framework requires HttpContext read in HealthController',
  owner: 'platform',
  expiryOrFollowUp: 'follow-up-change-v3-controller-cleanup',
  category: BOUNDARY_CHECK_CATEGORIES.CONTROLLER,
}

// ─── Orchestration flow fixtures ────────────────────────────────────

/** Valid flow: provider call after all preflight steps + confirmation. */
export const FIXTURE_VALID_ORCHESTRATION_FLOW: OrchestrationFlowFixture = {
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

/** Invalid flow: adapter call without tenant preflight. */
export const FIXTURE_ADAPTER_WITHOUT_PREFLIGHT_FLOW: OrchestrationFlowFixture = {
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

/** Invalid flow: formal write without confirmation metadata. */
export const FIXTURE_FORMAL_WRITE_WITHOUT_CONFIRMATION_FLOW: OrchestrationFlowFixture = {
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

/** Invalid orchestrator: declares itself as alternate source of truth. */
export const FIXTURE_DUPLICATE_OWNERSHIP_FLOW = {
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
    { step: ORCHESTRATION_STEPS.PREVIEW_DIFF, performed: true },
    { step: ORCHESTRATION_STEPS.EXPLICIT_CONFIRMATION, performed: true },
    { step: ORCHESTRATION_STEPS.DOMAIN_TRANSACTION, performed: true },
  ],
} as const

// ─── Sensitive audit payload fixtures (must be rejected) ────────────
export const FIXTURE_SENSITIVE_AUDIT_PAYLOADS: Array<{
  label: string
  payload: Record<string, unknown>
}> = [
  { label: 'prompt', payload: { prompt: 'system prompt text' } },
  { label: 'model_output', payload: { model_output: 'generated text' } },
  { label: 'raw_provider_payload', payload: { raw_provider_payload: '{...}' } },
  { label: 'token', payload: { token: 'eyJ...' } },
  { label: 'api_key', payload: { api_key: 'sk-...' } },
  { label: 'authorization', payload: { authorization: 'Bearer ...' } },
  { label: 'raw-xml', payload: { raw_xml: '<Assertion>...</Assertion>' } },
  { label: 'cross-tenant-detail', payload: { cross_tenant_detail: 'org-123' } },
  { label: 'document_body', payload: { document_body: 'full text...' } },
  { label: 'password', payload: { password: 'secret123' } },
]

export const FIXTURE_SAFE_AUDIT_PAYLOAD: Record<string, unknown> = {
  actorRef: 'user-42',
  orgRef: 'org-1',
  resourceRef: 'project-100',
  eventCode: 'AI_DRAFT_CREATED',
  status: 'success',
  reasonCode: 'ok',
  count: 3,
}

// ─── Full valid catalog fixture ─────────────────────────────────────
export const FIXTURE_VALID_CATALOG: ServiceCatalogEntry[] = [
  FIXTURE_DOMAIN_SERVICE_ENTRY,
  FIXTURE_ORCHESTRATOR_SERVICE_ENTRY,
  FIXTURE_ADAPTER_SERVICE_ENTRY,
  FIXTURE_PROVIDER_SERVICE_ENTRY,
  FIXTURE_AUDIT_SERVICE_ENTRY,
  FIXTURE_LEDGER_SERVICE_ENTRY,
  FIXTURE_LEGACY_SERVICE_ENTRY,
]
