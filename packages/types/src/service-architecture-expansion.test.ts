import { describe, expect, it } from 'vitest'
import {
  SERVICE_ROLES,
  SERVICE_ROLE_VALUES,
  TENANT_MODES,
  TENANT_MODE_VALUES,
  SIDE_EFFECT_CLASSES,
  SIDE_EFFECT_CLASS_VALUES,
  SIDE_EFFECT_CLASSES_REQUIRING_LEDGER,
  EXTERNAL_ACTION_CLASSES,
  EXTERNAL_ACTION_CLASS_VALUES,
  EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION,
  AUDIT_LEDGER_EXPECTATIONS,
  EVIDENCE_FRESHNESS_STATUSES,
  INFRASTRUCTURE_PREREQUISITES,
  REJECTED_INFRASTRUCTURE_PREREQUISITES,
  BOUNDARY_CHECK_CATEGORIES,
  ORCHESTRATION_STEPS,
  EXPECTED_ORCHESTRATION_ORDER,
  PREFLIGHT_STEPS_BEFORE_ADAPTER,
  ARCHITECTURE_REASON_CODES,
  SENSITIVE_PAYLOAD_KEYWORDS,
  isServiceRole,
  isTenantMode,
  isSideEffectClass,
  isExternalActionClass,
  isAuditLedgerExpectation,
  isEvidenceFreshnessStatus,
  isInfrastructurePrerequisite,
  isBoundaryCheckCategory,
  isOrchestrationStep,
  isFindingSeverity,
  isArchitectureReasonCode,
  normalizeCatalogEntry,
  validateCatalogEntry,
  validateCatalog,
  detectMissingDependencyPolicies,
  validateAllowlistEntry,
  detectUnregisteredServiceFolders,
  extractFolderNameFromPathScope,
  classifyLowSensitiveFinding,
  makeLowSensitiveFindingSummary,
  stripSensitivePayload,
  containsSensitivePayload,
  validateOrchestrationFlow,
  detectOrchestratorDuplicateOwnership,
  type ServiceCatalogEntry,
  type ServiceArchitectureFinding,
} from './service-architecture-expansion.js'
import {
  FIXTURE_DOMAIN_SERVICE_ENTRY,
  FIXTURE_ORCHESTRATOR_SERVICE_ENTRY,
  FIXTURE_ADAPTER_SERVICE_ENTRY,
  FIXTURE_PROVIDER_SERVICE_ENTRY,
  FIXTURE_AUDIT_SERVICE_ENTRY,
  FIXTURE_LEDGER_SERVICE_ENTRY,
  FIXTURE_LEGACY_SERVICE_ENTRY,
  FIXTURE_INVALID_CATALOG_ENTRY,
  FIXTURE_REJECTED_INFRA_ENTRY,
  FIXTURE_MISSING_LEDGER_ENTRY,
  FIXTURE_INVALID_ALLOWLIST_ENTRY,
  FIXTURE_VALID_ALLOWLIST_ENTRY,
  FIXTURE_VALID_ORCHESTRATION_FLOW,
  FIXTURE_ADAPTER_WITHOUT_PREFLIGHT_FLOW,
  FIXTURE_FORMAL_WRITE_WITHOUT_CONFIRMATION_FLOW,
  FIXTURE_DUPLICATE_OWNERSHIP_FLOW,
  FIXTURE_SENSITIVE_AUDIT_PAYLOADS,
  FIXTURE_SAFE_AUDIT_PAYLOAD,
  FIXTURE_VALID_CATALOG,
} from './service-architecture-expansion-fixtures.js'

describe('service-architecture-expansion contract', () => {
  describe('enum stability', () => {
    it('keeps service role values stable', () => {
      expect(SERVICE_ROLES).toEqual({
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
      })
      expect(SERVICE_ROLE_VALUES).toHaveLength(11)
    })

    it('keeps tenant mode values stable', () => {
      expect(TENANT_MODE_VALUES).toEqual([
        'tenant-bound',
        'tenant-optional',
        'global-only',
        'tenant-derived',
      ])
    })

    it('keeps side-effect class values stable', () => {
      expect(SIDE_EFFECT_CLASS_VALUES).toContain('formal-write')
      expect(SIDE_EFFECT_CLASS_VALUES).toContain('ai-persistence')
      expect(SIDE_EFFECT_CLASSES_REQUIRING_LEDGER).not.toContain('none')
      expect(SIDE_EFFECT_CLASSES_REQUIRING_LEDGER).toContain('formal-write')
    })

    it('keeps external action class values stable', () => {
      expect(EXTERNAL_ACTION_CLASS_VALUES).toContain('provider-call')
      expect(EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION).toContain('oauth-exchange')
      expect(EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION).not.toContain('none')
    })

    it('keeps rejected infrastructure prerequisites stable', () => {
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).toContain('microservice-split')
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).toContain('kafka')
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).toContain('forced-redis')
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).toContain('container-runtime')
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).toContain('postgresql-cutover')
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).toContain('api-v2-migration')
      expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).not.toContain('none')
    })
  })

  describe('type guards', () => {
    it('validates service role strings', () => {
      expect(isServiceRole('domain-service')).toBe(true)
      expect(isServiceRole('invalid')).toBe(false)
    })

    it('validates tenant mode strings', () => {
      expect(isTenantMode('tenant-bound')).toBe(true)
      expect(isTenantMode('invalid')).toBe(false)
    })

    it('validates side-effect class strings', () => {
      expect(isSideEffectClass('formal-write')).toBe(true)
      expect(isSideEffectClass('invalid')).toBe(false)
    })

    it('validates external action class strings', () => {
      expect(isExternalActionClass('provider-call')).toBe(true)
      expect(isExternalActionClass('invalid')).toBe(false)
    })

    it('validates audit/ledger expectation strings', () => {
      expect(isAuditLedgerExpectation('required')).toBe(true)
      expect(isAuditLedgerExpectation('invalid')).toBe(false)
    })

    it('validates evidence freshness status strings', () => {
      expect(isEvidenceFreshnessStatus('fresh')).toBe(true)
      expect(isEvidenceFreshnessStatus('graph-miss')).toBe(true)
      expect(isEvidenceFreshnessStatus('invalid')).toBe(false)
    })

    it('validates infrastructure prerequisite strings', () => {
      expect(isInfrastructurePrerequisite('none')).toBe(true)
      expect(isInfrastructurePrerequisite('microservice-split')).toBe(true)
      expect(isInfrastructurePrerequisite('invalid')).toBe(false)
    })

    it('validates boundary check category and orchestration step strings', () => {
      expect(isBoundaryCheckCategory('controller')).toBe(true)
      expect(isOrchestrationStep('effective-tenant')).toBe(true)
      expect(isFindingSeverity('high')).toBe(true)
      expect(isArchitectureReasonCode('unregistered-service-folder')).toBe(true)
    })
  })

  describe('normalizeCatalogEntry', () => {
    it('fills defaults for missing optional fields', () => {
      const normalized = normalizeCatalogEntry({ moduleKey: 'test-module' })
      expect(normalized.role).toBe('legacy-service')
      expect(normalized.tenantMode).toBe('tenant-bound')
      expect(normalized.sideEffectClass).toBe('none')
      expect(normalized.externalActionClass).toBe('none')
      expect(normalized.auditLedgerExpectation).toBe('not-required')
      expect(normalized.evidenceFreshness).toBe('needs-source-verification')
      expect(normalized.infrastructurePrerequisite).toBe('none')
      expect(normalized.dependencyPolicy).toEqual({
        allowedConsumers: [],
        allowedDependencies: [],
        forbiddenDependencies: [],
      })
    })

    it('trims module key and path scope', () => {
      const normalized = normalizeCatalogEntry({
        moduleKey: '  test  ',
        pathScope: '  path/**  ',
        role: SERVICE_ROLES.DOMAIN_SERVICE,
        ownerDomain: 'ai',
        dependencyPolicy: {
          allowedConsumers: ['c'],
          allowedDependencies: [],
          forbiddenDependencies: [],
        },
        tenantMode: TENANT_MODES.TENANT_BOUND,
        sideEffectClass: SIDE_EFFECT_CLASSES.READ_ONLY,
        externalActionClass: EXTERNAL_ACTION_CLASSES.NONE,
        auditLedgerExpectation: AUDIT_LEDGER_EXPECTATIONS.NOT_REQUIRED,
        fixtureFirstTestStatus: true,
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      })
      expect(normalized.moduleKey).toBe('test')
      expect(normalized.pathScope).toBe('path/**')
    })
  })

  describe('validateCatalogEntry — valid entries pass', () => {
    it('accepts domain service entry', () => {
      const r = validateCatalogEntry(FIXTURE_DOMAIN_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
      expect(r.errors).toHaveLength(0)
    })

    it('accepts orchestrator service entry with ledger declaration', () => {
      const r = validateCatalogEntry(FIXTURE_ORCHESTRATOR_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
    })

    it('accepts adapter service entry with covered-by-owner', () => {
      const r = validateCatalogEntry(FIXTURE_ADAPTER_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
    })

    it('accepts provider service entry', () => {
      const r = validateCatalogEntry(FIXTURE_PROVIDER_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
    })

    it('accepts audit service entry', () => {
      const r = validateCatalogEntry(FIXTURE_AUDIT_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
    })

    it('accepts ledger service entry', () => {
      const r = validateCatalogEntry(FIXTURE_LEDGER_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
    })

    it('accepts legacy service entry', () => {
      const r = validateCatalogEntry(FIXTURE_LEGACY_SERVICE_ENTRY)
      expect(r.ok).toBe(true)
    })
  })

  describe('validateCatalogEntry — invalid entries fail', () => {
    it('rejects entry with missing required fields and invalid enums', () => {
      const r = validateCatalogEntry(FIXTURE_INVALID_CATALOG_ENTRY)
      expect(r.ok).toBe(false)
      expect(r.errors.length).toBeGreaterThan(0)
      // Should flag missing moduleKey, pathScope, ownerDomain
      const fields = r.errors.map((e) => e.field)
      expect(fields).toContain('moduleKey')
      expect(fields).toContain('pathScope')
      expect(fields).toContain('ownerDomain')
      expect(fields).toContain('dependencyPolicy')
      // Should flag invalid enums
      expect(fields).toContain('role')
      expect(fields).toContain('tenantMode')
      expect(fields).toContain('sideEffectClass')
    })

    it('rejects formal-write side effect without ledger declaration', () => {
      const r = validateCatalogEntry(FIXTURE_MISSING_LEDGER_ENTRY)
      expect(r.ok).toBe(false)
      const ledgerError = r.errors.find((e) => e.reasonCode === 'missing-ledger-declaration')
      expect(ledgerError).toBeDefined()
      expect(ledgerError!.field).toBe('auditLedgerExpectation')
    })
  })

  describe('rejected infrastructure prerequisites', () => {
    it('rejects microservice-split prerequisite', () => {
      const r = validateCatalogEntry(FIXTURE_REJECTED_INFRA_ENTRY)
      expect(r.ok).toBe(false)
      const infraError = r.errors.find(
        (e) => e.reasonCode === 'rejected-infrastructure-prerequisite',
      )
      expect(infraError).toBeDefined()
      expect(infraError!.message).toContain('microservice-split')
    })

    it('rejects all listed rejected prerequisites', () => {
      for (const prereq of REJECTED_INFRASTRUCTURE_PREREQUISITES) {
        const entry: ServiceCatalogEntry = {
          ...FIXTURE_DOMAIN_SERVICE_ENTRY,
          moduleKey: `test-${prereq}`,
          infrastructurePrerequisite: prereq,
        }
        const r = validateCatalogEntry(entry)
        expect(r.ok).toBe(false)
        expect(r.errors.some((e) => e.reasonCode === 'rejected-infrastructure-prerequisite')).toBe(
          true,
        )
      }
    })

    it('accepts none prerequisite', () => {
      const entry: ServiceCatalogEntry = {
        ...FIXTURE_DOMAIN_SERVICE_ENTRY,
        moduleKey: 'test-none-infra',
        infrastructurePrerequisite: INFRASTRUCTURE_PREREQUISITES.NONE,
      }
      const r = validateCatalogEntry(entry)
      expect(r.ok).toBe(true)
    })
  })

  describe('validateCatalog — catalog-level validation', () => {
    it('accepts a valid catalog', () => {
      const r = validateCatalog(FIXTURE_VALID_CATALOG)
      expect(r.ok).toBe(true)
    })

    it('detects duplicate module keys', () => {
      const r = validateCatalog([FIXTURE_DOMAIN_SERVICE_ENTRY, { ...FIXTURE_DOMAIN_SERVICE_ENTRY }])
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.message.includes('duplicate moduleKey'))).toBe(true)
    })
  })

  describe('detectMissingDependencyPolicies', () => {
    it('flags entries with no allowed consumers', () => {
      const findings = detectMissingDependencyPolicies([
        {
          ...FIXTURE_DOMAIN_SERVICE_ENTRY,
          dependencyPolicy: {
            allowedConsumers: [],
            allowedDependencies: [],
            forbiddenDependencies: [],
          },
        },
      ])
      expect(findings.length).toBeGreaterThan(0)
      expect(findings[0].reasonCode).toBe('missing-dependency-policy')
    })

    it('flags overlapping allowed/forbidden dependencies', () => {
      const findings = detectMissingDependencyPolicies([
        {
          ...FIXTURE_DOMAIN_SERVICE_ENTRY,
          dependencyPolicy: {
            allowedConsumers: ['c'],
            allowedDependencies: ['search'],
            forbiddenDependencies: ['search'],
          },
        },
      ])
      expect(findings.some((f) => f.message.includes('allowed and forbidden'))).toBe(true)
    })
  })

  describe('validateAllowlistEntry', () => {
    it('accepts a valid allowlist entry', () => {
      const r = validateAllowlistEntry(FIXTURE_VALID_ALLOWLIST_ENTRY)
      expect(r.ok).toBe(true)
    })

    it('rejects allowlist entry with missing reason/owner/expiry', () => {
      const r = validateAllowlistEntry(FIXTURE_INVALID_ALLOWLIST_ENTRY)
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.field === 'allowlist.reason')).toBe(true)
      expect(r.errors.some((e) => e.field === 'allowlist.owner')).toBe(true)
      expect(r.errors.some((e) => e.field === 'allowlist.expiryOrFollowUp')).toBe(true)
    })
  })

  describe('detectUnregisteredServiceFolders', () => {
    it('flags high-risk folders without catalog entry or legacy exception', () => {
      const findings = detectUnregisteredServiceFolders({
        serviceFolders: [
          { folderName: 'ai_draft', fileCount: 10, highRisk: true },
          { folderName: 'unknown_new', fileCount: 5, highRisk: true },
          { folderName: 'low_risk_dir', fileCount: 2, highRisk: false },
        ],
        registeredEntries: [
          {
            ...FIXTURE_ORCHESTRATOR_SERVICE_ENTRY,
            pathScope: 'apps/backend/app/services/ai_draft/**',
          },
          {
            ...FIXTURE_LEGACY_SERVICE_ENTRY,
            pathScope: 'apps/backend/app/services/pdm_migration/**',
          },
        ],
      })
      const unregistered = findings.filter((f) => f.reasonCode === 'unregistered-service-folder')
      expect(unregistered.length).toBe(1)
      expect(unregistered[0].moduleKey).toBe('unknown_new')
    })

    it('does not flag legacy-exception folders', () => {
      const findings = detectUnregisteredServiceFolders({
        serviceFolders: [{ folderName: 'pdm_migration', fileCount: 3, highRisk: true }],
        registeredEntries: [
          {
            ...FIXTURE_LEGACY_SERVICE_ENTRY,
            pathScope: 'apps/backend/app/services/pdm_migration/**',
          },
        ],
      })
      expect(findings).toHaveLength(0)
    })
  })

  describe('extractFolderNameFromPathScope', () => {
    it('extracts leaf folder name from path scope', () => {
      expect(extractFolderNameFromPathScope('apps/backend/app/services/ai_draft/**')).toBe(
        'ai_draft',
      )
      expect(
        extractFolderNameFromPathScope('apps/backend/app/services/sso/sso_saml_audit_service.ts'),
      ).toBe('sso')
    })
  })

  describe('low-sensitive finding summaries', () => {
    it('classifyLowSensitiveFinding omits sensitive payload fields', () => {
      const finding: ServiceArchitectureFinding = {
        moduleKey: 'test',
        filePath: 'apps/backend/app/services/test/x.ts',
        category: BOUNDARY_CHECK_CATEGORIES.AUDIT_LEDGER,
        reasonCode: ARCHITECTURE_REASON_CODES.SENSITIVE_AUDIT_PAYLOAD,
        severity: 'high',
        message: 'audit payload contained prompt and api_key fields',
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      }
      const summary = classifyLowSensitiveFinding(finding)
      expect(summary.message).toBe('[redacted: sensitive-payload-omitted]')
      // filePath is NOT included in the low-sensitive summary
      expect((summary as unknown as Record<string, unknown>).filePath).toBeUndefined()
    })

    it('makeLowSensitiveFindingSummary omits sensitive fields across all findings', () => {
      const findings: ServiceArchitectureFinding[] = [
        {
          moduleKey: 'a',
          filePath: 'secret/path.ts',
          category: BOUNDARY_CHECK_CATEGORIES.SERVICE,
          reasonCode: ARCHITECTURE_REASON_CODES.SERVICE_HTTP_AUTHORITY,
          severity: 'medium',
          message: 'service read authorization header',
          evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
        },
        {
          moduleKey: 'b',
          filePath: 'another/path.ts',
          category: BOUNDARY_CHECK_CATEGORIES.AUDIT_LEDGER,
          reasonCode: ARCHITECTURE_REASON_CODES.SENSITIVE_AUDIT_PAYLOAD,
          severity: 'high',
          message: 'contained token and password',
          evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
        },
      ]
      const summaries = makeLowSensitiveFindingSummary(findings)
      expect(summaries).toHaveLength(2)
      expect(summaries[0].message).toBe('[redacted: sensitive-payload-omitted]')
      expect(summaries[1].message).toBe('[redacted: sensitive-payload-omitted]')
      // No summary should have a filePath property
      for (const s of summaries) {
        expect((s as unknown as Record<string, unknown>).filePath).toBeUndefined()
      }
    })

    it('stripSensitivePayload redacts sensitive keywords', () => {
      expect(stripSensitivePayload('contains prompt text')).toBe(
        '[redacted: sensitive-payload-omitted]',
      )
      expect(stripSensitivePayload('contains api_key value')).toBe(
        '[redacted: sensitive-payload-omitted]',
      )
      expect(stripSensitivePayload('contains authorization header')).toBe(
        '[redacted: sensitive-payload-omitted]',
      )
      expect(stripSensitivePayload('safe message')).toBe('safe message')
    })
  })

  describe('containsSensitivePayload', () => {
    it('detects sensitive keys in payload', () => {
      for (const fixture of FIXTURE_SENSITIVE_AUDIT_PAYLOADS) {
        expect(containsSensitivePayload(fixture.payload)).toBe(true)
      }
    })

    it('accepts safe audit payload', () => {
      expect(containsSensitivePayload(FIXTURE_SAFE_AUDIT_PAYLOAD)).toBe(false)
    })

    it('detects sensitive values in safe-named keys', () => {
      expect(containsSensitivePayload({ note: 'this contains a token value' })).toBe(true)
    })
  })

  describe('orchestration flow validation', () => {
    it('accepts valid flow with all preflight + confirmation', () => {
      const findings = validateOrchestrationFlow(FIXTURE_VALID_ORCHESTRATION_FLOW)
      expect(findings).toHaveLength(0)
    })

    it('flags adapter call without tenant preflight', () => {
      const findings = validateOrchestrationFlow(FIXTURE_ADAPTER_WITHOUT_PREFLIGHT_FLOW)
      expect(findings.length).toBeGreaterThan(0)
      expect(findings.some((f) => f.reasonCode === 'orchestration-order-violation')).toBe(true)
      expect(findings.some((f) => f.message.includes('effective-tenant'))).toBe(true)
    })

    it('flags formal write without confirmation metadata', () => {
      const findings = validateOrchestrationFlow(FIXTURE_FORMAL_WRITE_WITHOUT_CONFIRMATION_FLOW)
      expect(findings.length).toBeGreaterThan(0)
      expect(findings.some((f) => f.reasonCode === 'formal-write-missing-confirmation')).toBe(true)
    })
  })

  describe('orchestrator duplicate ownership detection', () => {
    it('flags orchestrator declaring itself as alternate source of truth', () => {
      const findings = detectOrchestratorDuplicateOwnership(
        FIXTURE_DUPLICATE_OWNERSHIP_FLOW as never,
      )
      expect(findings.length).toBeGreaterThan(0)
      expect(findings.some((f) => f.reasonCode === 'orchestrator-duplicate-ownership')).toBe(true)
    })
  })

  describe('orchestration ordering constants', () => {
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
  })

  describe('graph-miss evidence handling', () => {
    it('warns when evidence freshness is graph-miss', () => {
      const entry: ServiceCatalogEntry = {
        ...FIXTURE_DOMAIN_SERVICE_ENTRY,
        moduleKey: 'graph-miss-test',
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.GRAPH_MISS,
      }
      const r = validateCatalogEntry(entry)
      expect(r.warnings.some((w) => w.message.includes('graph-miss'))).toBe(true)
    })

    it('warns when evidence freshness is needs-source-verification', () => {
      const entry: ServiceCatalogEntry = {
        ...FIXTURE_DOMAIN_SERVICE_ENTRY,
        moduleKey: 'needs-source-test',
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.NEEDS_SOURCE_VERIFICATION,
      }
      const r = validateCatalogEntry(entry)
      expect(r.warnings.some((w) => w.message.includes('needs-source-verification'))).toBe(true)
    })
  })
})
