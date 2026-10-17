// @aiproj/types - V3 Service Architecture Expansion shared contract.
// v3-service-architecture-expansion: service module catalog, role taxonomy,
// five-layer boundary checks, orchestration ordering, adapter/provider authority
// boundaries, low-sensitive audit/ledger constraints and Observation inventory.
// Non-goals: microservice split, service mesh, containerization, Kafka/VectorDB/forced
//   Redis, PostgreSQL cutover, /api/v2|/api/v3 migration, framework replacement,
//   external provider smoke, AI auto-execution, marketplace/plugin platform expansion.

// ─── Service Roles ──────────────────────────────────────────────────
export const SERVICE_ROLES = {
  DOMAIN_SERVICE: 'domain-service',
  ORCHESTRATOR_SERVICE: 'orchestrator-service',
  ADAPTER_SERVICE: 'adapter-service',
  PROVIDER_SERVICE: 'provider-service',
  CATALOG_SERVICE: 'catalog-service',
  LEDGER_SERVICE: 'ledger-service',
  AUDIT_SERVICE: 'audit-service',
  POLICY_HELPER: 'policy-helper',
  PROJECTION_SERVICE: 'projection-service',
  TEST_FIXTURE_SERVICE: 'test-fixture-service',
  LEGACY_SERVICE: 'legacy-service',
} as const

export type ServiceRole = (typeof SERVICE_ROLES)[keyof typeof SERVICE_ROLES]

export const SERVICE_ROLE_VALUES = Object.values(SERVICE_ROLES) as ServiceRole[]

// ─── Tenant Modes ───────────────────────────────────────────────────
export const TENANT_MODES = {
  TENANT_BOUND: 'tenant-bound',
  TENANT_OPTIONAL: 'tenant-optional',
  GLOBAL_ONLY: 'global-only',
  TENANT_DERIVED: 'tenant-derived',
} as const

export type TenantMode = (typeof TENANT_MODES)[keyof typeof TENANT_MODES]

export const TENANT_MODE_VALUES = Object.values(TENANT_MODES) as TenantMode[]

// ─── Side-Effect Classes ────────────────────────────────────────────
export const SIDE_EFFECT_CLASSES = {
  NONE: 'none',
  READ_ONLY: 'read-only',
  FORMAL_WRITE: 'formal-write',
  EXTERNAL_WRITE: 'external-write',
  EXPORT: 'export',
  IDENTITY_PROVISIONING: 'identity-provisioning',
  AI_PERSISTENCE: 'ai-persistence',
  PROTECTED_EVIDENCE_PACKAGE: 'protected-evidence-package',
} as const

export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[keyof typeof SIDE_EFFECT_CLASSES]

export const SIDE_EFFECT_CLASS_VALUES = Object.values(SIDE_EFFECT_CLASSES) as SideEffectClass[]

// Side-effect classes that require audit/ledger declaration or explicit owner coverage.
export const SIDE_EFFECT_CLASSES_REQUIRING_LEDGER: readonly SideEffectClass[] = [
  SIDE_EFFECT_CLASSES.FORMAL_WRITE,
  SIDE_EFFECT_CLASSES.EXTERNAL_WRITE,
  SIDE_EFFECT_CLASSES.EXPORT,
  SIDE_EFFECT_CLASSES.IDENTITY_PROVISIONING,
  SIDE_EFFECT_CLASSES.AI_PERSISTENCE,
  SIDE_EFFECT_CLASSES.PROTECTED_EVIDENCE_PACKAGE,
]

// ─── External Action Classes ────────────────────────────────────────
export const EXTERNAL_ACTION_CLASSES = {
  NONE: 'none',
  PROVIDER_CALL: 'provider-call',
  OAUTH_EXCHANGE: 'oauth-exchange',
  WEBHOOK_DELIVERY: 'webhook-delivery',
  WEB_PUSH: 'web-push',
  NETWORK_WRITE: 'network-write',
  MODEL_CALL: 'model-call',
  OCR_PROVIDER_CALL: 'ocr-provider-call',
} as const

export type ExternalActionClass =
  (typeof EXTERNAL_ACTION_CLASSES)[keyof typeof EXTERNAL_ACTION_CLASSES]

export const EXTERNAL_ACTION_CLASS_VALUES = Object.values(
  EXTERNAL_ACTION_CLASSES,
) as ExternalActionClass[]

// External action classes that require explicit user authorization before real execution.
export const EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION: readonly ExternalActionClass[] = [
  EXTERNAL_ACTION_CLASSES.PROVIDER_CALL,
  EXTERNAL_ACTION_CLASSES.OAUTH_EXCHANGE,
  EXTERNAL_ACTION_CLASSES.WEBHOOK_DELIVERY,
  EXTERNAL_ACTION_CLASSES.WEB_PUSH,
  EXTERNAL_ACTION_CLASSES.NETWORK_WRITE,
  EXTERNAL_ACTION_CLASSES.MODEL_CALL,
  EXTERNAL_ACTION_CLASSES.OCR_PROVIDER_CALL,
]

// ─── Audit / Ledger Expectations ────────────────────────────────────
export const AUDIT_LEDGER_EXPECTATIONS = {
  REQUIRED: 'required',
  COVERED_BY_OWNER: 'covered-by-owner',
  NOT_REQUIRED: 'not-required',
  DEFERRED: 'deferred',
} as const

export type AuditLedgerExpectation =
  (typeof AUDIT_LEDGER_EXPECTATIONS)[keyof typeof AUDIT_LEDGER_EXPECTATIONS]

export const AUDIT_LEDGER_EXPECTATION_VALUES = Object.values(
  AUDIT_LEDGER_EXPECTATIONS,
) as AuditLedgerExpectation[]

// ─── Evidence Freshness ─────────────────────────────────────────────
export const EVIDENCE_FRESHNESS_STATUSES = {
  FRESH: 'fresh',
  STALE: 'stale',
  NEEDS_SOURCE_VERIFICATION: 'needs-source-verification',
  GRAPH_MISS: 'graph-miss',
} as const

export type EvidenceFreshnessStatus =
  (typeof EVIDENCE_FRESHNESS_STATUSES)[keyof typeof EVIDENCE_FRESHNESS_STATUSES]

export const EVIDENCE_FRESHNESS_STATUS_VALUES = Object.values(
  EVIDENCE_FRESHNESS_STATUSES,
) as EvidenceFreshnessStatus[]

// ─── Infrastructure Prerequisites (explicitly rejected) ─────────────
export const INFRASTRUCTURE_PREREQUISITES = {
  NONE: 'none',
  MICROSERVICE_SPLIT: 'microservice-split',
  SERVICE_MESH: 'service-mesh',
  CONTAINER_RUNTIME: 'container-runtime',
  KAFKA: 'kafka',
  VECTOR_DB: 'vector-db',
  FORCED_REDIS: 'forced-redis',
  POSTGRESQL_CUTOVER: 'postgresql-cutover',
  API_V2_MIGRATION: 'api-v2-migration',
  API_V3_MIGRATION: 'api-v3-migration',
} as const

export type InfrastructurePrerequisite =
  (typeof INFRASTRUCTURE_PREREQUISITES)[keyof typeof INFRASTRUCTURE_PREREQUISITES]

export const INFRASTRUCTURE_PREREQUISITE_VALUES = Object.values(
  INFRASTRUCTURE_PREREQUISITES,
) as InfrastructurePrerequisite[]

// Prerequisites that are NOT allowed by this change (must be rejected by validation).
export const REJECTED_INFRASTRUCTURE_PREREQUISITES: readonly InfrastructurePrerequisite[] = [
  INFRASTRUCTURE_PREREQUISITES.MICROSERVICE_SPLIT,
  INFRASTRUCTURE_PREREQUISITES.SERVICE_MESH,
  INFRASTRUCTURE_PREREQUISITES.CONTAINER_RUNTIME,
  INFRASTRUCTURE_PREREQUISITES.KAFKA,
  INFRASTRUCTURE_PREREQUISITES.VECTOR_DB,
  INFRASTRUCTURE_PREREQUISITES.FORCED_REDIS,
  INFRASTRUCTURE_PREREQUISITES.POSTGRESQL_CUTOVER,
  INFRASTRUCTURE_PREREQUISITES.API_V2_MIGRATION,
  INFRASTRUCTURE_PREREQUISITES.API_V3_MIGRATION,
]

// ─── Boundary Check Categories ──────────────────────────────────────
export const BOUNDARY_CHECK_CATEGORIES = {
  CONTROLLER: 'controller',
  SERVICE: 'service',
  VALIDATOR: 'validator',
  POLICY: 'policy',
  ADAPTER_PROVIDER: 'adapter-provider',
  AUDIT_LEDGER: 'audit-ledger',
  ORCHESTRATION: 'orchestration',
} as const

export type BoundaryCheckCategory =
  (typeof BOUNDARY_CHECK_CATEGORIES)[keyof typeof BOUNDARY_CHECK_CATEGORIES]

export const BOUNDARY_CHECK_CATEGORY_VALUES = Object.values(
  BOUNDARY_CHECK_CATEGORIES,
) as BoundaryCheckCategory[]

// ─── Orchestration Steps (expected high-risk ordering) ──────────────
export const ORCHESTRATION_STEPS = {
  AUTHENTICATED_CONTEXT: 'authenticated-context',
  EFFECTIVE_TENANT: 'effective-tenant',
  VALIDATION: 'validation',
  RBAC_DOMAIN_VISIBILITY: 'rbac-domain-visibility',
  PREVIEW_DIFF: 'preview-diff',
  EXPLICIT_CONFIRMATION: 'explicit-confirmation',
  DOMAIN_TRANSACTION: 'domain-transaction',
  ADAPTER_PROVIDER_CALL: 'adapter-provider-call',
  LOW_SENSITIVE_AUDIT_LEDGER: 'low-sensitive-audit-ledger',
} as const

export type OrchestrationStep = (typeof ORCHESTRATION_STEPS)[keyof typeof ORCHESTRATION_STEPS]

export const ORCHESTRATION_STEP_VALUES = Object.values(ORCHESTRATION_STEPS) as OrchestrationStep[]

// The canonical expected ordering for high-risk flows.
export const EXPECTED_ORCHESTRATION_ORDER: readonly OrchestrationStep[] = [
  ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT,
  ORCHESTRATION_STEPS.EFFECTIVE_TENANT,
  ORCHESTRATION_STEPS.VALIDATION,
  ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY,
  ORCHESTRATION_STEPS.PREVIEW_DIFF,
  ORCHESTRATION_STEPS.EXPLICIT_CONFIRMATION,
  ORCHESTRATION_STEPS.DOMAIN_TRANSACTION,
  ORCHESTRATION_STEPS.ADAPTER_PROVIDER_CALL,
  ORCHESTRATION_STEPS.LOW_SENSITIVE_AUDIT_LEDGER,
]

// Steps that MUST occur before an adapter/provider call.
export const PREFLIGHT_STEPS_BEFORE_ADAPTER: readonly OrchestrationStep[] = [
  ORCHESTRATION_STEPS.AUTHENTICATED_CONTEXT,
  ORCHESTRATION_STEPS.EFFECTIVE_TENANT,
  ORCHESTRATION_STEPS.VALIDATION,
  ORCHESTRATION_STEPS.RBAC_DOMAIN_VISIBILITY,
]

// ─── Finding Severity & Reason Codes ────────────────────────────────
export const FINDING_SEVERITIES = {
  INFO: 'info',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const

export type FindingSeverity = (typeof FINDING_SEVERITIES)[keyof typeof FINDING_SEVERITIES]

export const FINDING_SEVERITY_VALUES = Object.values(FINDING_SEVERITIES) as FindingSeverity[]

export const ARCHITECTURE_REASON_CODES = {
  UNREGISTERED_SERVICE_FOLDER: 'unregistered-service-folder',
  CONTROLLER_BUSINESS_LOGIC: 'controller-business-logic',
  SERVICE_HTTP_AUTHORITY: 'service-http-authority',
  VALIDATOR_POLICY_SIDE_EFFECT: 'validator-policy-side-effect',
  ADAPTER_AUTHORITY_SMELL: 'adapter-authority-smell',
  SENSITIVE_AUDIT_PAYLOAD: 'sensitive-audit-payload',
  MISSING_LEDGER_DECLARATION: 'missing-ledger-declaration',
  MISSING_DEPENDENCY_POLICY: 'missing-dependency-policy',
  ORCHESTRATION_ORDER_VIOLATION: 'orchestration-order-violation',
  ORCHESTRATOR_DUPLICATE_OWNERSHIP: 'orchestrator-duplicate-ownership',
  FORMAL_WRITE_MISSING_CONFIRMATION: 'formal-write-missing-confirmation',
  MISSING_ALLOWLIST_REASON: 'missing-allowlist-reason',
  REJECTED_INFRASTRUCTURE_PREREQUISITE: 'rejected-infrastructure-prerequisite',
  GRAPH_MISS_NEEDS_SOURCE: 'graph-miss-needs-source',
} as const

export type ArchitectureReasonCode =
  (typeof ARCHITECTURE_REASON_CODES)[keyof typeof ARCHITECTURE_REASON_CODES]

export const ARCHITECTURE_REASON_CODE_VALUES = Object.values(
  ARCHITECTURE_REASON_CODES,
) as ArchitectureReasonCode[]

// ─── Sensitive Payload Keywords (must NOT appear in audit/ledger) ────
export const SENSITIVE_PAYLOAD_KEYWORDS: readonly string[] = [
  'prompt',
  'model_output',
  'model-output',
  'raw_provider_payload',
  'raw-xml',
  'token',
  'api_key',
  'api-key',
  'authorization',
  'password',
  'private_key',
  'private-key',
  'credential',
  'secret',
  'bearer',
  'cross-tenant-detail',
  'document_body',
  'document-body',
  'unredacted',
]

// ─── Core Catalog Types ─────────────────────────────────────────────
export type ServiceModuleKey = string

export interface DependencyPolicy {
  /** Modules/roles allowed to consume this service module. */
  allowedConsumers: string[]
  /** Module keys this module may depend on. */
  allowedDependencies: string[]
  /** Module keys/paths this module MUST NOT depend on. */
  forbiddenDependencies: string[]
}

export interface ServiceCatalogEntry {
  /** Stable module key, e.g. 'ai-draft', 'compiler', 'sso-saml2'. */
  moduleKey: ServiceModuleKey
  /** Source path scope glob, e.g. 'apps/backend/app/services/ai_draft/**'. */
  pathScope: string
  /** Service role classification. */
  role: ServiceRole
  /** Owning domain, e.g. 'ai', 'compiler', 'security', 'multitenant'. */
  ownerDomain: string
  /** Dependency direction policy. */
  dependencyPolicy: DependencyPolicy
  /** Tenant binding mode. */
  tenantMode: TenantMode
  /** Side-effect classification. */
  sideEffectClass: SideEffectClass
  /** External action classification. */
  externalActionClass: ExternalActionClass
  /** Audit/ledger expectation. */
  auditLedgerExpectation: AuditLedgerExpectation
  /** Whether this module uses fixture-first tests by default. */
  fixtureFirstTestStatus: boolean
  /** Evidence freshness status. */
  evidenceFreshness: EvidenceFreshnessStatus
  /** Optional verification hints (commands or notes). */
  verificationHints?: string[]
  /** Optional allowlist entries for legacy/framework exceptions. */
  allowlist?: AllowlistEntry[]
  /** Optional infrastructure prerequisite (must be 'none' for this change). */
  infrastructurePrerequisite?: InfrastructurePrerequisite
}

export interface AllowlistEntry {
  /** A stable identifier for the exception. */
  id: string
  /** Required: human-readable reason for the exception. */
  reason: string
  /** Required: owner domain or team responsible. */
  owner: string
  /** Required: expiry or follow-up reference (date, ticket, or change id). */
  expiryOrFollowUp: string
  /** The category this allowlist applies to. */
  category: BoundaryCheckCategory
}

export interface ServiceArchitectureFinding {
  /** Module key or path the finding relates to. */
  moduleKey: ServiceModuleKey
  /** File path (relative) if applicable. */
  filePath?: string
  /** Boundary check category. */
  category: BoundaryCheckCategory
  /** Reason code. */
  reasonCode: ArchitectureReasonCode
  /** Severity. */
  severity: FindingSeverity
  /** Low-sensitive message (no sensitive payload). */
  message: string
  /** Evidence freshness that produced this finding. */
  evidenceFreshness: EvidenceFreshnessStatus
}

export interface ServiceArchitectureValidationError {
  field: string
  reasonCode: ArchitectureReasonCode
  message: string
}

export interface ServiceArchitectureValidationWarning {
  field: string
  message: string
}

export interface ServiceArchitectureValidationResult {
  ok: boolean
  errors: ServiceArchitectureValidationError[]
  warnings: ServiceArchitectureValidationWarning[]
}

// ─── Orchestration Flow Fixture (for task 5 tests) ──────────────────
export interface OrchestrationStepRecord {
  step: OrchestrationStep
  /** Whether this step was performed in the flow. */
  performed: boolean
  /** Optional low-sensitive metadata. */
  metadata?: Record<string, string | number | boolean | null>
}

export interface OrchestrationFlowFixture {
  moduleKey: ServiceModuleKey
  flowName: string
  steps: OrchestrationStepRecord[]
  /** Whether the flow calls an external/provider adapter. */
  callsAdapter: boolean
  /** Whether the flow performs a formal write. */
  formalWrite: boolean
  /** Whether required preview/diff/confirmation metadata is present. */
  hasConfirmationMetadata: boolean
}

// ─── Authorized Real Smoke Record (task 5.6) ────────────────────────
export interface AuthorizedRealSmokeRecord {
  provider: string
  endpoint?: string
  model?: string
  callVolume: number
  costOrUsage?: string
  resultSummary: string
  redactionBoundary: string
  /** Must be false — sensitive payloads are never stored. */
  storedSensitivePayload: false
}

// ─── Type Guards ────────────────────────────────────────────────────
export function isServiceRole(value: string): value is ServiceRole {
  return (SERVICE_ROLE_VALUES as readonly string[]).includes(value)
}

export function isTenantMode(value: string): value is TenantMode {
  return (TENANT_MODE_VALUES as readonly string[]).includes(value)
}

export function isSideEffectClass(value: string): value is SideEffectClass {
  return (SIDE_EFFECT_CLASS_VALUES as readonly string[]).includes(value)
}

export function isExternalActionClass(value: string): value is ExternalActionClass {
  return (EXTERNAL_ACTION_CLASS_VALUES as readonly string[]).includes(value)
}

export function isAuditLedgerExpectation(value: string): value is AuditLedgerExpectation {
  return (AUDIT_LEDGER_EXPECTATION_VALUES as readonly string[]).includes(value)
}

export function isEvidenceFreshnessStatus(value: string): value is EvidenceFreshnessStatus {
  return (EVIDENCE_FRESHNESS_STATUS_VALUES as readonly string[]).includes(value)
}

export function isInfrastructurePrerequisite(value: string): value is InfrastructurePrerequisite {
  return (INFRASTRUCTURE_PREREQUISITE_VALUES as readonly string[]).includes(value)
}

export function isBoundaryCheckCategory(value: string): value is BoundaryCheckCategory {
  return (BOUNDARY_CHECK_CATEGORY_VALUES as readonly string[]).includes(value)
}

export function isOrchestrationStep(value: string): value is OrchestrationStep {
  return (ORCHESTRATION_STEP_VALUES as readonly string[]).includes(value)
}

export function isFindingSeverity(value: string): value is FindingSeverity {
  return (FINDING_SEVERITY_VALUES as readonly string[]).includes(value)
}

export function isArchitectureReasonCode(value: string): value is ArchitectureReasonCode {
  return (ARCHITECTURE_REASON_CODE_VALUES as readonly string[]).includes(value)
}

// ─── Pure Helpers ───────────────────────────────────────────────────

/**
 * Normalize a raw catalog entry: trim strings, default optional fields,
 * and coerce known enum values. Does NOT validate — use validateCatalogEntry.
 */
export function normalizeCatalogEntry(
  input: Partial<ServiceCatalogEntry> & { moduleKey: ServiceModuleKey },
): ServiceCatalogEntry {
  const role = input.role ?? SERVICE_ROLES.LEGACY_SERVICE
  const tenantMode = input.tenantMode ?? TENANT_MODES.TENANT_BOUND
  const sideEffectClass = input.sideEffectClass ?? SIDE_EFFECT_CLASSES.NONE
  const externalActionClass = input.externalActionClass ?? EXTERNAL_ACTION_CLASSES.NONE
  const auditLedgerExpectation =
    input.auditLedgerExpectation ?? AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED
  const evidenceFreshness =
    input.evidenceFreshness ?? EVIDENCE_FRESHNESS_STATUSES.NEEDS_SOURCE_VERIFICATION
  const infrastructurePrerequisite =
    input.infrastructurePrerequisite ?? INFRASTRUCTURE_PREREQUISITES.NONE

  return {
    moduleKey: input.moduleKey.trim(),
    pathScope: (input.pathScope ?? '').trim(),
    role,
    ownerDomain: (input.ownerDomain ?? '').trim(),
    dependencyPolicy: input.dependencyPolicy ?? {
      allowedConsumers: [],
      allowedDependencies: [],
      forbiddenDependencies: [],
    },
    tenantMode,
    sideEffectClass,
    externalActionClass,
    auditLedgerExpectation,
    fixtureFirstTestStatus: input.fixtureFirstTestStatus ?? false,
    evidenceFreshness,
    verificationHints: input.verificationHints ?? [],
    allowlist: input.allowlist ?? [],
    infrastructurePrerequisite,
  }
}

/**
 * Validate a single catalog entry for required fields, enum validity,
 * ledger requirements and rejected infrastructure prerequisites.
 */
export function validateCatalogEntry(
  entry: ServiceCatalogEntry,
): ServiceArchitectureValidationResult {
  const errors: ServiceArchitectureValidationError[] = []
  const warnings: ServiceArchitectureValidationWarning[] = []

  if (!entry.moduleKey || entry.moduleKey.trim().length === 0) {
    errors.push({
      field: 'moduleKey',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: 'moduleKey is required',
    })
  }
  if (!entry.pathScope || entry.pathScope.trim().length === 0) {
    errors.push({
      field: 'pathScope',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: 'pathScope is required',
    })
  }
  if (!entry.ownerDomain || entry.ownerDomain.trim().length === 0) {
    errors.push({
      field: 'ownerDomain',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: 'ownerDomain is required',
    })
  }
  if (!isServiceRole(entry.role)) {
    errors.push({
      field: 'role',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: `invalid role: ${entry.role}`,
    })
  }
  if (!isTenantMode(entry.tenantMode)) {
    errors.push({
      field: 'tenantMode',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: `invalid tenantMode: ${entry.tenantMode}`,
    })
  }
  if (!isSideEffectClass(entry.sideEffectClass)) {
    errors.push({
      field: 'sideEffectClass',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: `invalid sideEffectClass: ${entry.sideEffectClass}`,
    })
  }
  if (!isExternalActionClass(entry.externalActionClass)) {
    errors.push({
      field: 'externalActionClass',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: `invalid externalActionClass: ${entry.externalActionClass}`,
    })
  }
  if (!isAuditLedgerExpectation(entry.auditLedgerExpectation)) {
    errors.push({
      field: 'auditLedgerExpectation',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: `invalid auditLedgerExpectation: ${entry.auditLedgerExpectation}`,
    })
  }
  if (!isEvidenceFreshnessStatus(entry.evidenceFreshness)) {
    errors.push({
      field: 'evidenceFreshness',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: `invalid evidenceFreshness: ${entry.evidenceFreshness}`,
    })
  }

  // Ledger requirement: side-effect modules must declare audit/ledger or owner coverage.
  if (
    SIDE_EFFECT_CLASSES_REQUIRING_LEDGER.includes(entry.sideEffectClass) &&
    entry.auditLedgerExpectation === AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED
  ) {
    errors.push({
      field: 'auditLedgerExpectation',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_LEDGER_DECLARATION,
      message: `side-effect class ${entry.sideEffectClass} requires audit/ledger declaration or covered-by-owner`,
    })
  }

  // Reject unsupported infrastructure prerequisites.
  const infra = entry.infrastructurePrerequisite ?? INFRASTRUCTURE_PREREQUISITES.NONE
  if (REJECTED_INFRASTRUCTURE_PREREQUISITES.includes(infra)) {
    errors.push({
      field: 'infrastructurePrerequisite',
      reasonCode: ARCHITECTURE_REASON_CODES.REJECTED_INFRASTRUCTURE_PREREQUISITE,
      message: `infrastructure prerequisite ${infra} is not allowed by service architecture expansion`,
    })
  }

  // Dependency policy presence.
  if (!entry.dependencyPolicy) {
    errors.push({
      field: 'dependencyPolicy',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
      message: 'dependencyPolicy is required',
    })
  }

  // Allowlist entries must have reason/owner/expiry.
  for (const al of entry.allowlist ?? []) {
    const alCheck = validateAllowlistEntry(al)
    if (!alCheck.ok) {
      errors.push(...alCheck.errors)
    }
  }

  if (
    entry.evidenceFreshness === EVIDENCE_FRESHNESS_STATUSES.GRAPH_MISS ||
    entry.evidenceFreshness === EVIDENCE_FRESHNESS_STATUSES.NEEDS_SOURCE_VERIFICATION
  ) {
    warnings.push({
      field: 'evidenceFreshness',
      message: `evidence freshness ${entry.evidenceFreshness}: do not treat empty graph results as absence`,
    })
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Detect entries whose dependencyPolicy is missing allowedConsumers or
 * has overlapping allowed/forbidden dependencies.
 */
export function detectMissingDependencyPolicies(
  entries: ServiceCatalogEntry[],
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  for (const entry of entries) {
    const dp = entry.dependencyPolicy
    if (!dp || dp.allowedConsumers.length === 0) {
      findings.push({
        moduleKey: entry.moduleKey,
        category: BOUNDARY_CHECK_CATEGORIES.SERVICE,
        reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
        severity: FINDING_SEVERITIES.LOW,
        message: `no allowedConsumers declared for ${entry.moduleKey}`,
        evidenceFreshness: entry.evidenceFreshness,
      })
    }
    const overlap = dp?.allowedDependencies.filter((d) => dp.forbiddenDependencies.includes(d))
    if (overlap && overlap.length > 0) {
      findings.push({
        moduleKey: entry.moduleKey,
        category: BOUNDARY_CHECK_CATEGORIES.SERVICE,
        reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
        severity: FINDING_SEVERITIES.MEDIUM,
        message: `dependency appears in both allowed and forbidden: ${overlap.join(', ')}`,
        evidenceFreshness: entry.evidenceFreshness,
      })
    }
  }
  return findings
}

/**
 * Validate an allowlist entry: reason, owner and expiry/follow-up are required.
 */
export function validateAllowlistEntry(entry: AllowlistEntry): ServiceArchitectureValidationResult {
  const errors: ServiceArchitectureValidationError[] = []
  if (!entry.reason || entry.reason.trim().length === 0) {
    errors.push({
      field: 'allowlist.reason',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_ALLOWLIST_REASON,
      message: 'allowlist reason is required',
    })
  }
  if (!entry.owner || entry.owner.trim().length === 0) {
    errors.push({
      field: 'allowlist.owner',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_ALLOWLIST_REASON,
      message: 'allowlist owner is required',
    })
  }
  if (!entry.expiryOrFollowUp || entry.expiryOrFollowUp.trim().length === 0) {
    errors.push({
      field: 'allowlist.expiryOrFollowUp',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_ALLOWLIST_REASON,
      message: 'allowlist expiryOrFollowUp is required',
    })
  }
  if (!isBoundaryCheckCategory(entry.category)) {
    errors.push({
      field: 'allowlist.category',
      reasonCode: ARCHITECTURE_REASON_CODES.MISSING_ALLOWLIST_REASON,
      message: `invalid allowlist category: ${entry.category}`,
    })
  }
  return { ok: errors.length === 0, errors, warnings: [] }
}

/**
 * Validate an entire catalog: per-entry validation + duplicate key detection.
 */
export function validateCatalog(
  entries: ServiceCatalogEntry[],
): ServiceArchitectureValidationResult {
  const allErrors: ServiceArchitectureValidationError[] = []
  const allWarnings: ServiceArchitectureValidationWarning[] = []
  const seenKeys = new Set<string>()
  for (const entry of entries) {
    const r = validateCatalogEntry(entry)
    allErrors.push(...r.errors)
    allWarnings.push(...r.warnings)
    if (seenKeys.has(entry.moduleKey)) {
      allErrors.push({
        field: 'moduleKey',
        reasonCode: ARCHITECTURE_REASON_CODES.MISSING_DEPENDENCY_POLICY,
        message: `duplicate moduleKey: ${entry.moduleKey}`,
      })
    }
    seenKeys.add(entry.moduleKey)
  }
  return { ok: allErrors.length === 0, errors: allErrors, warnings: allWarnings }
}

/**
 * Detect unregistered high-risk service folders: folders in the service tree
 * that have no matching catalog entry (by pathScope prefix) and no legacy exception.
 */
export function detectUnregisteredServiceFolders(params: {
  serviceFolders: Array<{ folderName: string; fileCount: number; highRisk: boolean }>
  registeredEntries: ServiceCatalogEntry[]
}): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  const registeredFolderNames = new Set(
    params.registeredEntries
      .filter((e) => e.role !== SERVICE_ROLES.LEGACY_SERVICE)
      .map((e) => extractFolderNameFromPathScope(e.pathScope))
      .filter((n) => n.length > 0),
  )
  const legacyFolderNames = new Set(
    params.registeredEntries
      .filter((e) => e.role === SERVICE_ROLES.LEGACY_SERVICE)
      .map((e) => extractFolderNameFromPathScope(e.pathScope))
      .filter((n) => n.length > 0),
  )
  for (const folder of params.serviceFolders) {
    if (!folder.highRisk) continue
    if (registeredFolderNames.has(folder.folderName)) continue
    if (legacyFolderNames.has(folder.folderName)) continue
    findings.push({
      moduleKey: folder.folderName,
      category: BOUNDARY_CHECK_CATEGORIES.SERVICE,
      reasonCode: ARCHITECTURE_REASON_CODES.UNREGISTERED_SERVICE_FOLDER,
      severity: FINDING_SEVERITIES.MEDIUM,
      message: `unregistered high-risk service folder: ${folder.folderName} (${folder.fileCount} files)`,
      evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.NEEDS_SOURCE_VERIFICATION,
    })
  }
  return findings
}

/**
 * Extract the leaf folder name from a path scope glob like
 * 'apps/backend/app/services/ai_draft/**' -> 'ai_draft'.
 */
export function extractFolderNameFromPathScope(pathScope: string): string {
  // Normalize backslashes and strip glob patterns.
  let normalized = pathScope.replace(/\\/g, '/').replace(/\/*\*.*$/, '')
  // If the last segment is a file (has an extension), strip it to get the parent folder.
  const parts = normalized.split('/').filter((p) => p.length > 0)
  const last = parts[parts.length - 1] ?? ''
  if (last.includes('.')) {
    // It's a file path — return the parent folder name.
    return parts[parts.length - 2] ?? ''
  }
  return last
}

/**
 * Classify a raw finding into a low-sensitive summary.
 * Strips any sensitive payload fields and keeps only safe metadata.
 */
export function classifyLowSensitiveFinding(finding: ServiceArchitectureFinding): {
  moduleKey: ServiceModuleKey
  category: BoundaryCheckCategory
  reasonCode: ArchitectureReasonCode
  severity: FindingSeverity
  message: string
  evidenceFreshness: EvidenceFreshnessStatus
} {
  return {
    moduleKey: finding.moduleKey,
    category: finding.category,
    reasonCode: finding.reasonCode,
    severity: finding.severity,
    message: stripSensitivePayload(finding.message),
    evidenceFreshness: finding.evidenceFreshness,
  }
}

/**
 * Produce a low-sensitive finding summary array, omitting sensitive payload fields.
 * Used by inventory/checker output to guarantee no sensitive data leaks.
 */
export function makeLowSensitiveFindingSummary(findings: ServiceArchitectureFinding[]): Array<{
  moduleKey: ServiceModuleKey
  category: BoundaryCheckCategory
  reasonCode: ArchitectureReasonCode
  severity: FindingSeverity
  message: string
  evidenceFreshness: EvidenceFreshnessStatus
}> {
  return findings.map((f) => classifyLowSensitiveFinding(f))
}

/**
 * Strip sensitive payload keywords from a message string.
 * Returns a redacted marker if sensitive content is detected.
 */
export function stripSensitivePayload(message: string): string {
  const lower = message.toLowerCase()
  for (const keyword of SENSITIVE_PAYLOAD_KEYWORDS) {
    if (lower.includes(keyword)) {
      return '[redacted: sensitive-payload-omitted]'
    }
  }
  return message
}

/**
 * Check whether a payload object contains any sensitive keys/values.
 * Used by audit/ledger fixture checks.
 */
export function containsSensitivePayload(payload: Record<string, unknown>): boolean {
  for (const key of Object.keys(payload)) {
    // Normalize: treat underscore and hyphen as equivalent for keyword matching.
    const lowerKey = key.toLowerCase().replace(/_/g, '-')
    if (SENSITIVE_PAYLOAD_KEYWORDS.some((kw) => lowerKey.includes(kw.replace(/_/g, '-')))) {
      return true
    }
    const value = payload[key]
    if (typeof value === 'string') {
      const lowerVal = value.toLowerCase().replace(/_/g, '-')
      if (SENSITIVE_PAYLOAD_KEYWORDS.some((kw) => lowerVal.includes(kw.replace(/_/g, '-')))) {
        return true
      }
    }
  }
  return false
}

/**
 * Validate an orchestration flow fixture against the expected ordering.
 * Checks that preflight steps occur before adapter calls and that
 * formal writes have confirmation metadata.
 */
export function validateOrchestrationFlow(
  flow: OrchestrationFlowFixture,
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  const performedSteps = new Set(flow.steps.filter((s) => s.performed).map((s) => s.step))

  // If the flow calls an adapter, all preflight steps must be performed.
  if (flow.callsAdapter) {
    for (const required of PREFLIGHT_STEPS_BEFORE_ADAPTER) {
      if (!performedSteps.has(required)) {
        findings.push({
          moduleKey: flow.moduleKey,
          category: BOUNDARY_CHECK_CATEGORIES.ORCHESTRATION,
          reasonCode: ARCHITECTURE_REASON_CODES.ORCHESTRATION_ORDER_VIOLATION,
          severity: FINDING_SEVERITIES.HIGH,
          message: `adapter call in flow ${flow.flowName} without preflight step: ${required}`,
          evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
        })
      }
    }
  }

  // Formal writes require preview/diff + explicit confirmation metadata.
  if (flow.formalWrite && !flow.hasConfirmationMetadata) {
    findings.push({
      moduleKey: flow.moduleKey,
      category: BOUNDARY_CHECK_CATEGORIES.ORCHESTRATION,
      reasonCode: ARCHITECTURE_REASON_CODES.FORMAL_WRITE_MISSING_CONFIRMATION,
      severity: FINDING_SEVERITIES.HIGH,
      message: `formal write in flow ${flow.flowName} without preview/diff/confirmation metadata`,
      evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
    })
  }

  return findings
}

/**
 * Check that an orchestrator flow delegates formal reads/writes to domain
 * services rather than declaring itself as an alternate source of truth.
 */
export function detectOrchestratorDuplicateOwnership(
  flow: OrchestrationFlowFixture & { declaresOwnOwnership?: boolean },
): ServiceArchitectureFinding[] {
  const findings: ServiceArchitectureFinding[] = []
  if (flow.declaresOwnOwnership) {
    findings.push({
      moduleKey: flow.moduleKey,
      category: BOUNDARY_CHECK_CATEGORIES.ORCHESTRATION,
      reasonCode: ARCHITECTURE_REASON_CODES.ORCHESTRATOR_DUPLICATE_OWNERSHIP,
      severity: FINDING_SEVERITIES.HIGH,
      message: `orchestrator ${flow.moduleKey} declares itself as alternate source of truth`,
      evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
    })
  }
  return findings
}
